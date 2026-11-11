/**
 * The service worker's run host: one run per tab, a per-tab cache of tool
 * names, and the `ToolHost` that connects a run to its tab. Chrome is reached
 * only through `RunHostDeps`, so this module runs under Vitest in Node.
 */
import { isExecuteToolResponse, isToolList, type ContentRequest, type RunEvent } from "../messages";
import type { Json, Macro, ToolInfo } from "../macro/types";
import { MacroRunError, startRun as initialState, step, type RunResult, type ToolHost } from "../runner/interpreter";
import type { RunState } from "../runner/machine";
import type { RunStore } from "./runStore";
import { createSiteRouter, type TabRouterDeps } from "./tabRouter";

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
  /** Finds and opens tabs for a macro's other sites; without it every site runs on the run's tab. */
  tabs?: TabRouterDeps;
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
  toolHost(tabId: number, signal: AbortSignal): TabTools;
}

/** The tool methods of a `ToolHost`, bound to one tab, so without a site. */
export interface TabTools {
  callTool(name: string, args: Record<string, Json>): Promise<Json>;
  isToolAvailable(name: string): Promise<boolean>;
  waitForTool(name: string, timeoutMs: number): Promise<void>;
}

const DEFAULT_POLL_MS = 500;
/** How long `isToolAvailable` waits for a newly loaded page to report its tools. */
const DEFAULT_REPORT_TIMEOUT_MS = 10_000;

export function createRunHost(deps: RunHostDeps): RunHost {
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const toolsByTab = new Map<number, string[]>();
  const waitersByTab = new Map<number, Set<() => void>>();
  const activeRuns = new Map<number, AbortController>();
  // The tabs each run has called tools on, keyed by the run's own tab, so
  // Stop reaches a call in flight on another site's tab too.
  const runTabs = new Map<number, Set<number>>();
  // Tabs whose last tool call loaded another document. Until that document's
  // content script sends `tools-changed`, the old page may still answer
  // `list-tools` while it unloads, so neither its answers nor the cache count.
  const awaitingReport = new Set<number>();

  const setTools = (tabId: number, tools: ToolInfo[]): void => {
    awaitingReport.delete(tabId);
    toolsByTab.set(tabId, tools.map((tool) => tool.name));
    for (const wake of waitersByTab.get(tabId) ?? []) wake();
  };

  const refreshTools = async (tabId: number): Promise<void> => {
    if (awaitingReport.has(tabId)) return;
    try {
      const tools = await deps.sendToTab(tabId, { type: "list-tools" });
      // A navigation may have started while the listing was in flight.
      if (isToolList(tools) && !awaitingReport.has(tabId)) setTools(tabId, tools);
    } catch {
      // No content script yet (the page is still loading): keep the cache.
    }
  };

  const navigated = (tabId: number): null => {
    toolsByTab.delete(tabId);
    awaitingReport.add(tabId);
    return null;
  };

  const hasTool = (tabId: number, name: string): boolean =>
    !awaitingReport.has(tabId) && (toolsByTab.get(tabId)?.includes(name) ?? false);

  /**
   * Resolves `true` once `ready()` holds, re-checked on every report and poll,
   * or `false` after `timeoutMs`. Rejects when the run is aborted.
   */
  const until = (tabId: number, ready: () => boolean, timeoutMs: number, signal: AbortSignal): Promise<boolean> =>
    new Promise((resolve, reject) => {
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
        if (ready()) finish(() => resolve(true));
      };
      const onAbort = () => finish(() => reject(new Error("Aborted.")));
      if (signal.aborted) return onAbort();
      const timer = setTimeout(() => finish(() => resolve(false)), timeoutMs);
      // `tools-changed` normally wakes the waiter; the poll covers tools that
      // changed without a report reaching us.
      const poll = setInterval(() => void refreshTools(tabId).then(check), pollMs);
      waiters.add(check);
      signal.addEventListener("abort", onAbort);
      void refreshTools(tabId).then(check);
    });

  const toolHost = (tabId: number, signal: AbortSignal): TabTools => ({
    async isToolAvailable(name) {
      if (awaitingReport.has(tabId)) {
        await until(tabId, () => !awaitingReport.has(tabId), DEFAULT_REPORT_TIMEOUT_MS, signal);
      }
      await refreshTools(tabId);
      return hasTool(tabId, name);
    },

    async waitForTool(name, timeoutMs) {
      if (await until(tabId, () => hasTool(tabId, name), timeoutMs, signal)) return;
      // A MacroRunError's message becomes the run's failure message.
      throw new MacroRunError(
        awaitingReport.has(tabId)
          ? `The tab navigated and the new page did not report its tools within ${timeoutMs} ms (it may not support WebMCP).`
          : `Timed out waiting for "${name}".`,
      );
    },

    async callTool(name, args) {
      let response: unknown;
      try {
        response = await deps.sendToTab(tabId, { type: "execute-tool", name, args });
      } catch {
        // The channel closed mid-call: the page unloaded under the tool.
        return navigated(tabId);
      }
      if (response === undefined) return null;
      if (!isExecuteToolResponse(response)) throw new Error(`Invalid response from tool "${name}".`);
      if (!response.ok) throw new Error(response.error);
      // Whatever the tool returned, a call that loads another page is null to the macro.
      return response.navigated ? navigated(tabId) : response.result;
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
      const route = deps.tabs ? createSiteRouter(deps.tabs, loaded.macro, tabId) : async () => tabId;
      const used = new Set([tabId]);
      runTabs.set(tabId, used);
      const tabTools = async (site: string): Promise<TabTools> => {
        const id = await route(site);
        used.add(id);
        return toolHost(id, controller.signal);
      };
      const host: ToolHost = {
        isToolAvailable: async (name, site) => (await tabTools(site)).isToolAvailable(name),
        waitForTool: async (name, timeoutMs, site) => (await tabTools(site)).waitForTool(name, timeoutMs),
        async callTool(name, args, site) {
          const tools = await tabTools(site);
          inFlight = [...inFlight, name];
          // `state` is still the one before this step: a resume repeats the step.
          await deps.store?.save(tabId, state, inFlight);
          return tools.callTool(name, args);
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
      runTabs.delete(tabId);
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
      for (const id of runTabs.get(tabId) ?? [tabId]) deps.sendToTab(id, { type: "abort-tool" }).catch(() => {});
    },
    removeTab(tabId) {
      activeRuns.get(tabId)?.abort();
      toolsByTab.delete(tabId);
      waitersByTab.delete(tabId);
      awaitingReport.delete(tabId);
    },
    toolHost,
  };
}
