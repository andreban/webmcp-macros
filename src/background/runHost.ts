// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/**
 * The service worker's run host: one run per tab, a cache of tool names per
 * tab and frame, and the `ToolHost` that connects a run to its tab. Chrome is reached
 * only through `RunHostDeps`, so this module runs under Vitest in Node.
 */
import { isExecuteToolResponse, isToolList, type ContentRequest, type FrameToolList, type RunEvent } from "../messages";
import type { Json, Macro, ToolInfo } from "../macro/types";
import { MacroRunError, startRun as initialState, step, type RunResult, type ToolHost } from "../runner/interpreter";
import { statementPath, type RunState } from "../runner/machine";
import type { RunStore } from "./runStore";
import { createSiteRouter, type TabRouterDeps } from "./tabRouter";

export interface RunHostDeps {
  /** Sends to a frame's content script (0 is the top frame); rejects when no listener answers. */
  sendToTab(tabId: number, request: ContentRequest, frameId: number): Promise<unknown>;
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
  /** Records the tools a frame's content script reported and wakes waiting runs. */
  setTools(tabId: number, tools: ToolInfo[], frameId?: number, origin?: string): void;
  /** Re-lists the tab's frames, then returns each frame's tools, the top frame first. */
  listFrames(tabId: number): Promise<FrameToolList[]>;
  /** Runs a saved macro, by id, or the macro given, on the tab. Ignored while that tab already has a run. */
  startRun(tabId: number, macro: string | Macro, inputs: Record<string, Json>): Promise<void>;
  /** Continues a run saved by an earlier worker. Ignored while that tab already has a run. */
  resumeRun(tabId: number, state: RunState): Promise<void>;
  stopRun(tabId: number): void;
  /** Aborts the tab's run and forgets its tools. */
  removeTab(tabId: number): void;
  toolHost(tabId: number, signal: AbortSignal): TabTools;
}

/** The tool methods of a `ToolHost`, bound to one tab, so without a site. */
export interface TabTools {
  callTool(name: string, args: Record<string, Json>, frameOrigin?: string): Promise<Json>;
  isToolAvailable(name: string, frameOrigin?: string): Promise<boolean>;
  waitForTool(name: string, timeoutMs: number, frameOrigin?: string): Promise<void>;
}

const DEFAULT_POLL_MS = 500;
/** How long `isToolAvailable` waits for a newly loaded page to report its tools. */
const DEFAULT_REPORT_TIMEOUT_MS = 10_000;

interface FrameTools {
  /** The frame's origin as Chrome reported it; unknown for a frame only ever polled. */
  origin?: string;
  /** As the frame reported them, so the editor can list them with their schemas. */
  tools: ToolInfo[];
}

export function createRunHost(deps: RunHostDeps): RunHost {
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  // Each frame runs its own content script and reports its own tools.
  const framesByTab = new Map<number, Map<number, FrameTools>>();
  const waitersByTab = new Map<number, Set<() => void>>();
  const activeRuns = new Map<number, AbortController>();
  // The tabs each run has called tools on, keyed by the run's own tab, so
  // Stop reaches a call in flight on another site's tab too.
  const runTabs = new Map<number, Set<number>>();
  // Tabs whose last tool call loaded another top document. Until that
  // document's content script sends `tools-changed`, the old page may still
  // answer `list-tools` while it unloads, so neither its answers nor the cache count.
  const awaitingReport = new Set<number>();

  const frames = (tabId: number): Map<number, FrameTools> => {
    const known = framesByTab.get(tabId) ?? new Map<number, FrameTools>();
    framesByTab.set(tabId, known);
    return known;
  };

  /** The top frame, which may not have reported yet, and every iframe that has. */
  const frameIds = (tabId: number): Set<number> => new Set([0, ...(framesByTab.get(tabId)?.keys() ?? [])]);

  const wake = (tabId: number): void => {
    for (const check of waitersByTab.get(tabId) ?? []) check();
  };

  const setTools = (tabId: number, tools: ToolInfo[], frameId = 0, origin?: string): void => {
    if (frameId === 0) awaitingReport.delete(tabId);
    const known = frames(tabId);
    known.set(frameId, { origin: origin ?? known.get(frameId)?.origin, tools });
    wake(tabId);
  };

  const refreshFrame = async (tabId: number, frameId: number): Promise<void> => {
    try {
      const tools = await deps.sendToTab(tabId, { type: "list-tools" }, frameId);
      // A navigation may have started while the listing was in flight.
      const current = frameId === 0 ? !awaitingReport.has(tabId) : framesByTab.get(tabId)?.has(frameId);
      if (isToolList(tools) && current) setTools(tabId, tools, frameId);
    } catch {
      // The top frame may still be loading: keep its cache. An iframe that
      // does not answer was removed, or left for a page without WebMCP.
      if (frameId !== 0 && framesByTab.get(tabId)?.delete(frameId)) wake(tabId);
    }
  };

  const refreshTools = async (tabId: number): Promise<void> => {
    if (awaitingReport.has(tabId)) return;
    await Promise.all([...frameIds(tabId)].map((frameId) => refreshFrame(tabId, frameId)));
  };

  const navigated = (tabId: number, frameId: number): null => {
    if (frameId === 0) {
      // A new top document replaces every iframe along with its tools.
      framesByTab.delete(tabId);
      awaitingReport.add(tabId);
    } else {
      // The rest of the page stays. The iframe is no longer polled, so its
      // unloading document cannot answer; the new one reports when it loads.
      framesByTab.get(tabId)?.delete(frameId);
    }
    return null;
  };

  /** The frame that serves `name`: the top frame first, then the earliest iframe. */
  const frameFor = (tabId: number, name: string, frameOrigin?: string): number | undefined => {
    if (awaitingReport.has(tabId)) return undefined;
    const candidates = [...(framesByTab.get(tabId) ?? [])]
      .filter(([, frame]) => frame.tools.some((tool) => tool.name === name) && (frameOrigin === undefined || frame.origin === frameOrigin))
      .map(([id]) => id);
    return candidates.length > 0 ? Math.min(...candidates) : undefined;
  };

  const hasTool = (tabId: number, name: string, frameOrigin?: string): boolean =>
    frameFor(tabId, name, frameOrigin) !== undefined;

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
    async isToolAvailable(name, frameOrigin) {
      if (awaitingReport.has(tabId)) {
        await until(tabId, () => !awaitingReport.has(tabId), DEFAULT_REPORT_TIMEOUT_MS, signal);
      }
      await refreshTools(tabId);
      return hasTool(tabId, name, frameOrigin);
    },

    async waitForTool(name, timeoutMs, frameOrigin) {
      if (await until(tabId, () => hasTool(tabId, name, frameOrigin), timeoutMs, signal)) return;
      // A MacroRunError's message becomes the run's failure message.
      throw new MacroRunError(
        awaitingReport.has(tabId)
          ? `The tab navigated and the new page did not report its tools within ${timeoutMs} ms (it may not support WebMCP).`
          : `Timed out waiting for "${name}".`,
      );
    },

    async callTool(name, args, frameOrigin) {
      // Not in the cache: the top frame answers, with "not found" if need be.
      const frameId = frameFor(tabId, name, frameOrigin) ?? 0;
      let response: unknown;
      try {
        response = await deps.sendToTab(tabId, { type: "execute-tool", name, args }, frameId);
      } catch {
        // The channel closed mid-call: the page unloaded under the tool.
        return navigated(tabId, frameId);
      }
      if (response === undefined) return null;
      if (!isExecuteToolResponse(response)) throw new Error(`Invalid response from tool "${name}".`);
      if (!response.ok) throw new Error(response.error);
      // Whatever the tool returned, a call that loads another page is null to the macro.
      return response.navigated ? navigated(tabId, frameId) : response.result;
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
        isToolAvailable: async (name, site, frameOrigin) => (await tabTools(site)).isToolAvailable(name, frameOrigin),
        waitForTool: async (name, timeoutMs, site, frameOrigin) => (await tabTools(site)).waitForTool(name, timeoutMs, frameOrigin),
        async callTool(name, args, site, frameOrigin) {
          const tools = await tabTools(site);
          inFlight = [...inFlight, name];
          // `state` is still the one before this step: a resume repeats the step.
          await deps.store?.save(tabId, state, inFlight);
          const result = await tools.callTool(name, args, frameOrigin);
          deps.broadcast({ type: "run-call", tabId, macroId, tool: name, args, result, path: statementPath(state.macro, state.frames) });
          return result;
        },
        onStep: ({ count, tool, path }) => deps.broadcast({ type: "run-step", tabId, macroId, count, tool, path }),
        message: (text) => deps.broadcast({ type: "run-message", tabId, macroId, text }),
      };
      while (state.status === "running") {
        inFlight = [];
        deps.broadcast({ type: "run-at", tabId, macroId, path: statementPath(state.macro, state.frames) });
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

  const startRun = (tabId: number, macro: string | Macro, inputs: Record<string, Json>): Promise<void> =>
    typeof macro === "string"
      ? drive(tabId, macro, async () => {
          const saved = (await deps.loadMacros()).find((candidate) => candidate.id === macro);
          return saved && initialState(saved, { inputs });
        })
      : drive(tabId, macro.id, async () => initialState(macro, { inputs }));

  return {
    setTools,
    async listFrames(tabId) {
      // The poll also drops iframes that went away since they last reported.
      await refreshTools(tabId);
      return [...(framesByTab.get(tabId) ?? [])]
        .toSorted(([a], [b]) => a - b)
        .map(([frameId, { origin, tools }]) => (origin === undefined ? { frameId, tools } : { frameId, origin, tools }));
    },
    startRun,
    resumeRun: (tabId, state) => drive(tabId, state.macro.id, async () => state),
    stopRun(tabId) {
      activeRuns.get(tabId)?.abort();
      // Also cancel a tool call in flight, which the signal cannot reach.
      for (const id of runTabs.get(tabId) ?? [tabId]) {
        for (const frameId of frameIds(id)) deps.sendToTab(id, { type: "abort-tool" }, frameId).catch(() => {});
      }
    },
    removeTab(tabId) {
      activeRuns.get(tabId)?.abort();
      framesByTab.delete(tabId);
      waitersByTab.delete(tabId);
      awaitingReport.delete(tabId);
    },
    toolHost,
  };
}
