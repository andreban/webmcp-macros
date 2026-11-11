/**
 * Messages between the content script, the background service worker and the
 * extension pages. Every union is discriminated on `type`; add a variant here
 * first, then handle it on both sides.
 */
import type { Json, ToolInfo } from "./macro/types";
import type { RunResult, StepInfo } from "./runner/interpreter";

/** Background or side panel → content script of a tab (top frame). */
export type ContentRequest =
  | { type: "list-tools" }
  | { type: "execute-tool"; name: string; args: Record<string, Json> }
  | { type: "abort-tool" };

/**
 * The content script's reply to `execute-tool`. It never throws across the
 * channel; `notFound` says the tool is not registered on the page right now.
 */
export type ExecuteToolResponse = { ok: true; result: Json } | { ok: false; error: string; notFound?: boolean };

/** Content script or side panel → background. */
export type BackgroundRequest =
  | { type: "tools-changed"; tools: ToolInfo[]; matches: number }
  /** `tabId` is left out by a content script: the background uses the sender's tab. */
  | { type: "run-macro"; macroId: string; inputs: Record<string, Json>; tabId?: number }
  | { type: "stop-run"; tabId?: number };

/**
 * Background → the tab and every extension page, while a macro runs. A step
 * carries the tool name but not its arguments: they can hold the user's
 * inputs, and the tab's page is not ours.
 */
export type RunEvent =
  | ({ type: "run-step"; tabId: number; macroId: string } & Pick<StepInfo, "count" | "tool">)
  | { type: "run-message"; tabId: number; macroId: string; text: string }
  | { type: "run-finished"; tabId: number; macroId: string; result: RunResult };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunResult(value: unknown): value is RunResult {
  return (
    isRecord(value) &&
    (value.status === "done" || value.status === "stopped" || value.status === "failed") &&
    (value.message === undefined || typeof value.message === "string") &&
    typeof value.toolCalls === "number" &&
    isRecord(value.vars)
  );
}

/**
 * Narrows an incoming runtime message to a `RunEvent`. Listeners also receive
 * every other message sent in the extension, so check before reading fields.
 */
export function isRunEvent(message: unknown): message is RunEvent {
  if (!isRecord(message) || typeof message.tabId !== "number" || typeof message.macroId !== "string") return false;
  switch (message.type) {
    case "run-step":
      return typeof message.count === "number" && typeof message.tool === "string";
    case "run-message":
      return typeof message.text === "string";
    case "run-finished":
      return isRunResult(message.result);
    default:
      return false;
  }
}

/**
 * Narrows a tool listing from a content script. Only the names are relied on;
 * the rest comes from the page, which the extension does not control.
 */
export function isToolList(value: unknown): value is ToolInfo[] {
  return Array.isArray(value) && value.every((tool) => isRecord(tool) && typeof tool.name === "string");
}

function isOptionalTabId(value: unknown): value is number | undefined {
  return value === undefined || Number.isInteger(value);
}

/**
 * Narrows an incoming runtime message to a `BackgroundRequest`. The service
 * worker hears every message sent in the extension, including from content
 * scripts in pages it does not control, so check before reading fields.
 * Extension messages are JSON-serialised, so a record of inputs holds JSON.
 */
export function isBackgroundRequest(message: unknown): message is BackgroundRequest {
  if (!isRecord(message)) return false;
  switch (message.type) {
    case "tools-changed":
      return isToolList(message.tools) && typeof message.matches === "number";
    case "run-macro":
      return typeof message.macroId === "string" && isRecord(message.inputs) && isOptionalTabId(message.tabId);
    case "stop-run":
      return isOptionalTabId(message.tabId);
    default:
      return false;
  }
}

/** Narrows the content script's reply to `execute-tool`. */
export function isExecuteToolResponse(value: unknown): value is ExecuteToolResponse {
  if (!isRecord(value)) return false;
  return value.ok === true ? "result" in value : value.ok === false && typeof value.error === "string";
}
