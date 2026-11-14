// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

// Pure helpers for the editor page: its URL, a new macro, the dirty check and shortcuts.
import { MACRO_VERSION, type Macro } from "../macro/types";

/** The editor page, relative to the extension root (as `chrome.runtime.getURL` takes it). */
export const EDITOR_PAGE = "src/editor/index.html";

/** What the editor page's URL names: a saved macro, and the tab it edits against. */
export interface EditorParams {
  /** Absent for a new macro. */
  macroId?: string;
  tabId?: number;
}

/** The editor page's path for `params`, ready for `chrome.runtime.getURL`. */
export function editorPath({ macroId, tabId }: EditorParams): string {
  const query = new URLSearchParams();
  if (macroId !== undefined) query.set("macro", macroId);
  if (tabId !== undefined) query.set("tab", String(tabId));
  const search = query.toString();
  return search ? `${EDITOR_PAGE}?${search}` : EDITOR_PAGE;
}

/** Reads the page's query string. Anything malformed is left out rather than guessed. */
export function parseEditorParams(search: string): EditorParams {
  const query = new URLSearchParams(search);
  const params: EditorParams = {};
  const macroId = query.get("macro");
  if (macroId) params.macroId = macroId;
  const tab = query.get("tab");
  if (tab !== null && /^\d+$/.test(tab) && Number.isSafeInteger(Number(tab))) params.tabId = Number(tab);
  return params;
}

/**
 * An empty macro with a fresh id. With an http(s) `pageUrl` its site matches
 * that origin. Only origin and path are kept: a query string can carry
 * personal data, and a macro is shared.
 */
export function createNewMacro(pageUrl: string | undefined, id: string = crypto.randomUUID()): Macro {
  const site = siteFor(pageUrl);
  return {
    wmm: MACRO_VERSION,
    id,
    name: "Untitled macro",
    sites: site ? { main: site } : {},
    tools: {},
    // What `defaultTrigger` proposes for an empty program, so the trigger follows the program from the start.
    trigger: { site: "main", anyOf: [[]] },
    program: [],
  };
}

function siteFor(pageUrl: string | undefined) {
  if (!pageUrl || !URL.canParse(pageUrl)) return undefined;
  const url = new URL(pageUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  return { match: [`${url.origin}/*`], startUrl: `${url.origin}${url.pathname}` };
}

/**
 * Whether `macro` differs from `baseline`, the macro as last saved or loaded.
 * The reducer shares unchanged objects and undo restores earlier ones, so
 * identity settles the usual case before contents are compared.
 */
export function isDirty(macro: Macro, baseline: Macro): boolean {
  return macro !== baseline && JSON.stringify(macro) !== JSON.stringify(baseline);
}

/** The history action a key press asks for: Ctrl/Cmd+Z undoes; with Shift, or Ctrl+Y, redoes. */
export function historyShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.shiftKey) return "redo";
  return null;
}
