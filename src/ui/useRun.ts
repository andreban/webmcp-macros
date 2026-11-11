import { useCallback, useEffect, useReducer } from "react";
import type { Json, Macro } from "../macro/types";
import { isRunEvent, type BackgroundRequest, type RunEvent } from "../messages";
import type { RunResult } from "../runner/interpreter";
import { rememberInputs } from "../storage";

/**
 * The run a surface is showing. `null` (no run) is idle; without `result` the
 * run is in progress; with it, finished.
 */
export interface RunState {
  macroId: string;
  step?: { count: number; tool: string };
  messages: string[];
  result?: RunResult;
}

export type RunAction =
  | { type: "start"; macroId: string }
  /** `tabId` is the tab this surface follows; undefined follows any tab. */
  | { type: "event"; event: RunEvent; tabId?: number }
  | { type: "clear" };

/**
 * Pure state transitions for `useRun`. While a run is in progress, events for
 * another macro are ignored: the background runs one macro per tab, so they
 * are stale. When idle or finished, an event starts following that run, so a
 * surface also shows runs started from another surface on the same tab.
 */
export function runReducer(state: RunState | null, action: RunAction): RunState | null {
  switch (action.type) {
    case "start":
      return { macroId: action.macroId, messages: [] };
    case "clear":
      return null;
    case "event": {
      const { event, tabId } = action;
      if (tabId !== undefined && event.tabId !== tabId) return state;
      const inProgress = state !== null && !state.result;
      if (inProgress && state.macroId !== event.macroId) return state;
      const base: RunState = inProgress ? state : { macroId: event.macroId, messages: [] };
      switch (event.type) {
        case "run-step":
          return { ...base, step: { count: event.count, tool: event.tool } };
        case "run-message":
          return { ...base, messages: [...base.messages, event.text] };
        case "run-finished":
          return { ...base, result: event.result };
        default:
          throw new Error(`Unknown run event: ${JSON.stringify(event satisfies never)}`);
      }
    }
    default:
      throw new Error(`Unknown run action: ${JSON.stringify(action satisfies never)}`);
  }
}

function send(request: BackgroundRequest): void {
  // Rejects when no listener is awake to receive it; the run then never
  // starts and the surface keeps showing "Starting…" until cleared.
  chrome.runtime.sendMessage(request).catch(() => {});
}

/**
 * Starts, stops and follows a macro run. `tabId` is the tab to run in; leave
 * it out in a content script, where the background uses the sender's tab.
 */
export function useRun(tabId?: number) {
  const [run, dispatch] = useReducer(runReducer, null);

  useEffect(() => {
    const listener = (message: unknown) => {
      if (isRunEvent(message)) dispatch({ type: "event", event: message, tabId });
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [tabId]);

  const start = useCallback(
    (macro: Macro, inputs: Record<string, Json>) => {
      // Remembered inputs are stored first so the next form shows them, even
      // if this run fails. A storage error must not block the run.
      void rememberInputs(macro, inputs).catch(() => {});
      dispatch({ type: "start", macroId: macro.id });
      send({ type: "run-macro", macroId: macro.id, inputs, tabId });
    },
    [tabId],
  );
  const stop = useCallback(() => send({ type: "stop-run", tabId }), [tabId]);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  return { run, running: run !== null && !run.result, start, stop, clear };
}

/** One line of status text for a run, for the launcher and the side panel. */
export function resultLine(run: RunState): string {
  const result = run.result;
  if (!result) return run.step ? `Step ${run.step.count}: ${run.step.tool}` : "Starting…";
  if (result.status === "failed") return `Failed: ${result.message ?? "unknown error"}`;
  return result.message ?? run.messages.at(-1) ?? `Done in ${result.toolCalls} tool calls.`;
}
