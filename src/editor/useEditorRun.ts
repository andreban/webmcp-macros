// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useReducer } from "react";
import type { Json, Macro } from "../macro/types";
import { isRunEvent, type BackgroundRequest } from "../messages";
import type { NodePath } from "../runner/machine";
import { rememberInputs } from "../storage";
import { runReducer, type RunAction, type RunState } from "../ui/useRun";

export interface ToolCallEntry {
  tool: string;
  args: Record<string, Json>;
  result: Json;
}

/** The run the editor follows, plus its trace: where it is, and the tool calls it made. */
export interface EditorRun {
  run: RunState | null;
  /** The statement executing now; absent once the run ends. */
  at?: NodePath;
  calls: ToolCallEntry[];
}

export const idleRun: EditorRun = { run: null, calls: [] };

/**
 * `runReducer` decides which run is followed; the trace follows the same run
 * and starts empty whenever a new one is followed.
 */
export function editorRunReducer(state: EditorRun, action: RunAction): EditorRun {
  const run = runReducer(state.run, action);
  if (action.type !== "event") return { run, calls: [] };
  const { event, tabId } = action;
  const followed = (tabId === undefined || event.tabId === tabId) && run?.macroId === event.macroId;
  if (!followed) return run === state.run ? state : { ...state, run };
  const fresh = state.run === null || (state.run.result !== undefined && run !== state.run);
  const trace = fresh ? idleRun : state;
  switch (event.type) {
    case "run-at":
      return { ...trace, run, at: event.path };
    case "run-call":
      return { ...trace, run, calls: [...trace.calls, { tool: event.tool, args: event.args, result: event.result }] };
    case "run-finished":
      return { run, calls: trace.calls };
    default:
      return { ...trace, run };
  }
}

function send(request: BackgroundRequest): void {
  // Rejects when no listener is awake; the bar then stays on "Starting…" until dismissed.
  chrome.runtime.sendMessage(request).catch(() => {});
}

/** Runs the macro being edited, unsaved edits included, on `tabId` and follows it. */
export function useEditorRun(tabId: number | undefined) {
  const [state, dispatch] = useReducer(editorRunReducer, idleRun);

  useEffect(() => {
    if (tabId === undefined) return;
    const listener = (message: unknown) => {
      if (isRunEvent(message)) dispatch({ type: "event", event: message, tabId });
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [tabId]);

  const start = useCallback(
    (macro: Macro, inputs: Record<string, Json>) => {
      if (tabId === undefined) return;
      void rememberInputs(macro, inputs).catch(() => {});
      dispatch({ type: "start", macroId: macro.id });
      send({ type: "run-macro", macro, inputs, tabId });
    },
    [tabId],
  );
  const stop = useCallback(() => send({ type: "stop-run", tabId }), [tabId]);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);
  return { ...state, start, stop, clear };
}
