import { useCallback, useEffect, useState } from "react";
import type { Json, Macro } from "../macro/types";
import { isRunEvent, type BackgroundRequest } from "../messages";
import type { RunResult } from "../runner/interpreter";
import { rememberInputs } from "../storage";

export interface RunState {
  macroId: string;
  step?: { count: number; tool: string };
  messages: string[];
  result?: RunResult;
}

function send(request: BackgroundRequest): void {
  chrome.runtime.sendMessage(request).catch(() => {});
}

/**
 * Starts, stops and follows a macro run. `tabId` is the tab to run in; leave
 * it out in a content script, where the background uses the sender's tab.
 */
export function useRun(tabId?: number) {
  const [run, setRun] = useState<RunState | null>(null);

  useEffect(() => {
    const listener = (message: unknown) => {
      if (!isRunEvent(message)) return;
      if (tabId !== undefined && message.tabId !== tabId) return;
      setRun((current) => {
        const base = current?.macroId === message.macroId && !current.result ? current : { macroId: message.macroId, messages: [] };
        switch (message.type) {
          case "run-step":
            return { ...base, step: { count: message.count, tool: message.tool } };
          case "run-message":
            return { ...base, messages: [...base.messages, message.text] };
          case "run-finished":
            return { ...base, result: message.result };
        }
      });
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [tabId]);

  const start = useCallback(
    (macro: Macro, inputs: Record<string, Json>) => {
      void rememberInputs(macro, inputs);
      setRun({ macroId: macro.id, messages: [] });
      send({ type: "run-macro", macroId: macro.id, inputs, tabId });
    },
    [tabId],
  );
  const stop = useCallback(() => send({ type: "stop-run", tabId }), [tabId]);
  const clear = useCallback(() => setRun(null), []);

  return { run, running: run !== null && !run.result, start, stop, clear };
}

export function resultLine(run: RunState): string {
  const result = run.result;
  if (!result) return run.step ? `Step ${run.step.count}: ${run.step.tool}` : "Starting…";
  const last = run.messages.at(-1);
  if (result.status === "failed") return `Failed: ${result.message ?? "unknown error"}`;
  return result.message ?? last ?? `Done in ${result.toolCalls} tool calls.`;
}
