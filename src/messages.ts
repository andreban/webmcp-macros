// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/**
 * Messages between the content script, the background service worker and the
 * extension pages. Every union is discriminated on `type`; add a variant here
 * first, then handle it on both sides.
 */
import { isMacro, type Json, type Macro, type ToolInfo } from "./macro/types";
import type { RunResult, StepInfo } from "./runner/interpreter";
import type { NodePath } from "./runner/machine";

/** Background or side panel → the content script of one frame of a tab. */
export type ContentRequest =
  | { type: "list-tools" }
  | { type: "execute-tool"; name: string; args: Record<string, Json> }
  | { type: "abort-tool" };

/**
 * The content script's reply to `execute-tool`. It never throws across the
 * channel; `notFound` says the tool is not registered on the page right now,
 * and `navigated` that the call started loading another document.
 */
export type ExecuteToolResponse =
  | { ok: true; result: Json; navigated?: boolean }
  | { ok: false; error: string; notFound?: boolean };

/** Content script or side panel → background. */
export type BackgroundRequest =
  | { type: "tools-changed"; tools: ToolInfo[]; matches: number }
  /** `tabId` is left out by a content script: the background uses the sender's tab. */
  /**
   * Runs a saved macro by id, or, from an extension page only, the `macro`
   * given inline, so the editor can run unsaved edits.
   */
  | ({ type: "run-macro"; inputs: Record<string, Json>; tabId?: number } & ({ macroId: string } | { macro: Macro }))
  | { type: "stop-run"; tabId?: number }
  /** From an extension page: the tab's tools in every frame. The reply is a `FrameToolList[]`. */
  | { type: "list-frame-tools"; tabId: number };

/**
 * One frame's tools as the background knows them, top frame (id 0) first.
 * `origin` comes from Chrome, so the page cannot forge it; it is unknown for
 * a frame that has only been polled.
 */
export interface FrameToolList {
  frameId: number;
  origin?: string;
  tools: ToolInfo[];
}

/**
 * Background → the tab and every extension page, while a macro runs. A step
 * carries the tool name but not its arguments: they can hold the user's
 * inputs, and the tab's page is not ours. The events in `PAGE_ONLY_EVENTS`
 * go to extension pages only.
 */
export type RunEvent =
  | ({ type: "run-step"; tabId: number; macroId: string } & Pick<StepInfo, "count" | "tool" | "path">)
  /** The statement the run is about to execute, sent before every step. */
  | { type: "run-at"; tabId: number; macroId: string; path: NodePath }
  /** A tool call that returned, with its arguments and result. */
  | ({ type: "run-call"; tabId: number; macroId: string; result: Json } & Pick<StepInfo, "tool" | "args" | "path">)
  | { type: "run-message"; tabId: number; macroId: string; text: string }
  | { type: "run-finished"; tabId: number; macroId: string; result: RunResult };

/** Events that are not sent to the tab: a call's arguments and result may hold the user's data. */
export const PAGE_ONLY_EVENTS: ReadonlySet<RunEvent["type"]> = new Set(["run-at", "run-call"]);

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

function isNodePath(value: unknown): value is NodePath {
  return Array.isArray(value) && value.every((seg) => typeof seg === "string" || Number.isInteger(seg));
}

/**
 * Narrows an incoming runtime message to a `RunEvent`. Listeners also receive
 * every other message sent in the extension, so check before reading fields.
 */
export function isRunEvent(message: unknown): message is RunEvent {
  if (!isRecord(message) || typeof message.tabId !== "number" || typeof message.macroId !== "string") return false;
  switch (message.type) {
    case "run-step":
      return typeof message.count === "number" && typeof message.tool === "string" && isNodePath(message.path);
    case "run-at":
      return isNodePath(message.path);
    case "run-call":
      return typeof message.tool === "string" && isRecord(message.args) && "result" in message && isNodePath(message.path);
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
      return (
        (typeof message.macroId === "string") !== isMacro(message.macro) &&
        isRecord(message.inputs) &&
        isOptionalTabId(message.tabId)
      );
    case "stop-run":
      return isOptionalTabId(message.tabId);
    case "list-frame-tools":
      return Number.isInteger(message.tabId);
    default:
      return false;
  }
}

/**
 * Narrows the reply to `list-frame-tools`. Tool fields other than the name
 * still come from the page and are checked where they are used.
 */
export function isFrameToolLists(value: unknown): value is FrameToolList[] {
  return (
    Array.isArray(value) &&
    value.every(
      (frame) =>
        isRecord(frame) &&
        Number.isInteger(frame.frameId) &&
        (frame.origin === undefined || typeof frame.origin === "string") &&
        isToolList(frame.tools),
    )
  );
}

/** Narrows the content script's reply to `execute-tool`. */
export function isExecuteToolResponse(value: unknown): value is ExecuteToolResponse {
  if (!isRecord(value)) return false;
  return value.ok === true
    ? "result" in value && (value.navigated === undefined || typeof value.navigated === "boolean")
    : value.ok === false && typeof value.error === "string";
}
