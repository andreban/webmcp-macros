/**
 * The service worker's run host: one run per tab, a per-tab cache of tool
 * names, and the `ToolHost` that connects a run to its tab. Chrome is reached
 * only through `RunHostDeps`, so this module runs under Vitest in Node.
 */
import { isExecuteToolResponse, isToolList, type ContentRequest, type RunEvent } from "../messages";
import type { Json, Macro, ToolInfo } from "../macro/types";
import { startRun as initialState, step, type RunResult, type ToolHost } from "../runner/interpreter";
import type { RunState } from "../runner/machine";
import type { RunStore } from "./runStore";

export interface RunHostDeps {
  /** Sends to the tab's top-frame content script; rejects when no listener answers. */
  sendToTab(tabId: number, request: ContentRequest): Promise<unknown>;
  /** Delivers a run event to the tab and to every extension page. */
  broadcast(event: RunEvent): void;
  loadMacros(): Promise<Macro[]>;
  /** Where runs are saved after each step, so a later worker can resume them. */
  store?: Pick<RunStore, "save" | "remove">;
  /** How often `waitForTool` re-lists tools, in milliseconds. */
  pollMs?: number;
}

export interface RunHost {
  /** Records the tools a tab's content script reported and wakes waiting runs. */
  setTools(tabId: number, tools: ToolInfo[]): void;
  /** Runs the macro on the tab. Ignored while that tab already has a run. */
  startRun(tabId: number, macroId: string, inputs: Record<string, Json>): Promise<void>;
  /** Continues a run saved by an earlier worker. Ignored while that tab already has a run. */
  resumeRun(tabId: number, state: RunState): Promise<void>;
  stopRun(tabId: number): void;
  /** Aborts the tab's run and forgets its tools. */
  removeTab(tabId: number): void;
  toolHost(tabId: number, signal: AbortSignal): ToolHost;
}

const DEFAULT_POLL_MS = 500;

export function createRunHost(deps: RunHostDeps): RunHost {
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const toolsByTab = new Map<number, string[]>();
  const waitersByTab = new Map<number, Set<() => void>>();
  const activeRuns = new Map<number, AbortController>();

  const setTools = (tabId: number, tools: ToolInfo[]): void => {
    toolsByTab.set(tabId, tools.map((tool) => tool.name));
    for (const wake of waitersByTab.get(tabId) ?? []) wake();
  };

  const refreshTools = async (tabId: number): Promise<string[]> => {
    try {
      const tools = await deps.sendToTab(tabId, { type: "list-tools" });
      if (isToolList(tools)) setTools(tabId, tools);
    } catch {
      // No content script yet (the page is still loading): keep the cache.
    }
    return toolsByTab.get(tabId) ?? [];
  };

  const toolHost = (tabId: number, signal: AbortSignal): ToolHost => ({
    async isToolAvailable(name) {
      return (await refreshTools(tabId)).includes(name);
    },

    async waitForTool(name, timeoutMs) {
      if ((await refreshTools(tabId)).includes(name)) return;
      await new Promise<void>((resolve, reject) => {
        const waiters = waitersByTab.get(tabId) ?? new Set();
        waitersByTab.set(tabId, waiters);
        const finish = (settle: () => void) => {
          clearTimeout(timer);
          clearInterval(poll);
          waiters.delete(check);
          signal.removeEventListener("abort", onAbort);
          settle();
        };
        const check = () => {
          if (toolsByTab.get(tabId)?.includes(name)) finish(resolve);
        };
        const onAbort = () => finish(() => reject(new Error("Aborted.")));
        if (signal.aborted) return onAbort();
        const timer = setTimeout(() => finish(() => reject(new Error(`Timed out waiting for "${name}".`))), timeoutMs);
        // `tools-changed` normally wakes the waiter; the poll covers a reloaded
        // page whose content script has not reported in yet.
        const poll = setInterval(() => void refreshTools(tabId).then(check), pollMs);
        waiters.add(check);
        signal.addEventListener("abort", onAbort);
      });
    },

    async callTool(name, args) {
      let response: unknown;
      try {
        response = await deps.sendToTab(tabId, { type: "execute-tool", name, args });
      } catch {
        // The channel closed mid-call: the tool navigated the page, which the
        // runner treats as a null result. The new page reports its own tools.
        toolsByTab.delete(tabId);
        return null;
      }
      if (response === undefined) return null;
      if (!isExecuteToolResponse(response)) throw new Error(`Invalid response from tool "${name}".`);
      if (!response.ok) throw new Error(response.error);
      return response.result;
    },
  });

  /**
   * Claims the tab, then steps the run to its end, saving it after each step.
   * Before each tool call the saved run gains an in-flight marker, so a worker
   * that resumes it knows the step may already have had effects.
   */
  const drive = async (tabId: number, macroId: string, load: () => Promise<RunState | undefined>): Promise<void> => {
    if (activeRuns.has(tabId)) return;
    // Claim the tab before the first await so a second request cannot slip in.
    const controller = new AbortController();
    activeRuns.set(tabId, controller);
    const finished = (result: RunResult) => deps.broadcast({ type: "run-finished", tabId, macroId, result });
    try {
      const loaded = await load();
      if (!loaded) return finished({ status: "failed", message: "Macro not found.", toolCalls: 0, vars: {} });
      let state = loaded;
      let inFlight: string[] = [];
      const tabHost = toolHost(tabId, controller.signal);
      const host: ToolHost = {
        ...tabHost,
        async callTool(name, args) {
          inFlight = [...inFlight, name];
          // `state` is still the one before this step: a resume repeats the step.
          await deps.store?.save(tabId, state, inFlight);
          return tabHost.callTool(name, args);
        },
        onStep: ({ count, tool }) => deps.broadcast({ type: "run-step", tabId, macroId, count, tool }),
        message: (text) => deps.broadcast({ type: "run-message", tabId, macroId, text }),
      };
      while (state.status === "running") {
        inFlight = [];
        state = await step(state, host, controller.signal);
        if (state.status === "running") await deps.store?.save(tabId, state);
      }
      const { status, message, toolCalls, vars } = state;
      finished({ status, message, toolCalls, vars });
    } catch (error: unknown) {
      // step never throws; this is storage failing. Report it so the
      // surfaces that started the run do not wait forever.
      finished({ status: "failed", message: error instanceof Error ? error.message : String(error), toolCalls: 0, vars: {} });
    } finally {
      activeRuns.delete(tabId);
      await deps.store?.remove(tabId).catch(() => {});
    }
  };

  const startRun = (tabId: number, macroId: string, inputs: Record<string, Json>): Promise<void> =>
    drive(tabId, macroId, async () => {
      const macro = (await deps.loadMacros()).find((candidate) => candidate.id === macroId);
      return macro && initialState(macro, { inputs });
    });

  return {
    setTools,
    startRun,
    resumeRun: (tabId, state) => drive(tabId, state.macro.id, async () => state),
    stopRun(tabId) {
      activeRuns.get(tabId)?.abort();
      // Also cancel a tool call in flight, which the signal cannot reach.
      deps.sendToTab(tabId, { type: "abort-tool" }).catch(() => {});
    },
    removeTab(tabId) {
      activeRuns.get(tabId)?.abort();
      toolsByTab.delete(tabId);
      waitersByTab.delete(tabId);
    },
    toolHost,
  };
}
