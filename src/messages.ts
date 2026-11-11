import type { Json, ToolInfo } from "./macro/types";
import type { RunResult } from "./runner/interpreter";

/** Background or side panel → content script. */
export type ContentRequest =
  | { type: "list-tools" }
  | { type: "execute-tool"; name: string; args: Record<string, Json> }
  | { type: "abort-tool" };

export type ExecuteToolResponse = { ok: true; result: Json } | { ok: false; error: string; notFound?: boolean };

/** Content script or side panel → background. */
export type BackgroundRequest =
  | { type: "tools-changed"; tools: ToolInfo[]; matches: number }
  | { type: "run-macro"; macroId: string; inputs: Record<string, Json>; tabId?: number }
  | { type: "stop-run"; tabId?: number };

/** Background → everyone, while a macro runs. */
export type RunEvent =
  | { type: "run-step"; tabId: number; macroId: string; count: number; tool: string }
  | { type: "run-message"; tabId: number; macroId: string; text: string }
  | { type: "run-finished"; tabId: number; macroId: string; result: RunResult };

export function isRunEvent(message: unknown): message is RunEvent {
  const type = (message as { type?: unknown } | null)?.type;
  return type === "run-step" || type === "run-message" || type === "run-finished";
}
