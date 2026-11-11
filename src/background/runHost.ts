/**
 * The service worker's run host: one run per tab, a per-tab cache of tool
 * names, and the `ToolHost` that connects a run to its tab. Chrome is reached
 * only through `RunHostDeps`, so this module runs under Vitest in Node.
 */
import { isExecuteToolResponse, isToolList, type ContentRequest, type RunEvent } from "../messages";
import type { Json, Macro, ToolInfo } from "../macro/types";
import { MacroRunError, runMacro, type RunResult, type ToolHost } from "../runner/interpreter";

export interface RunHostDeps {
  /** Sends to the tab's top-frame content script; rejects when no listener answers. */
  sendToTab(tabId: number, request: ContentRequest): Promise<unknown>;
  /** Delivers a run event to the tab and to every extension page. */
  broadcast(event: RunEvent): void;
  loadMacros(): Promise<Macro[]>;
  /** How often `waitForTool` re-lists tools, in milliseconds. */
  pollMs?: number;
}

export interface RunHost {
  /** Records the tools a tab's content script reported and wakes waiting runs. */
  setTools(tabId: number, tools: ToolInfo[]): void;
  /** Runs the macro on the tab. Ignored while that tab already has a run. */
  startRun(tabId: number, macroId: string, inputs: Record<string, Json>): Promise<void>;
  stopRun(tabId: number): void;
  /** Aborts the tab's run and forgets its tools. */
  removeTab(tabId: number): void;
  toolHost(tabId: number, signal: AbortSignal): ToolHost;
}

const DEFAULT_POLL_MS = 500;
/** How long `isToolAvailable` waits for a newly loaded page to report its tools. */
const DEFAULT_REPORT_TIMEOUT_MS = 10_000;

export function createRunHost(deps: RunHostDeps): RunHost {
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const toolsByTab = new Map<number, string[]>();
  const waitersByTab = new Map<number, Set<() => void>>();
  const activeRuns = new Map<number, AbortController>();
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

  const toolHost = (tabId: number, signal: AbortSignal): ToolHost => ({
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

  const startRun = async (tabId: number, macroId: string, inputs: Record<string, Json>): Promise<void> => {
    if (activeRuns.has(tabId)) return;
    // Claim the tab before the first await so a second request cannot slip in.
    const controller = new AbortController();
    activeRuns.set(tabId, controller);
    const finished = (result: RunResult) => deps.broadcast({ type: "run-finished", tabId, macroId, result });
    try {
      const macro = (await deps.loadMacros()).find((candidate) => candidate.id === macroId);
      if (!macro) return finished({ status: "failed", message: "Macro not found.", toolCalls: 0, vars: {} });
      const host = toolHost(tabId, controller.signal);
      host.onStep = ({ count, tool }) => deps.broadcast({ type: "run-step", tabId, macroId, count, tool });
      host.message = (text) => deps.broadcast({ type: "run-message", tabId, macroId, text });
      finished(await runMacro(macro, host, { inputs, signal: controller.signal }));
    } catch (error: unknown) {
      // runMacro never throws; this is storage failing. Report it so the
      // surfaces that started the run do not wait forever.
      finished({ status: "failed", message: error instanceof Error ? error.message : String(error), toolCalls: 0, vars: {} });
    } finally {
      activeRuns.delete(tabId);
    }
  };

  return {
    setTools,
    startRun,
    stopRun(tabId) {
      activeRuns.get(tabId)?.abort();
      // Also cancel a tool call in flight, which the signal cannot reach.
      deps.sendToTab(tabId, { type: "abort-tool" }).catch(() => {});
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
