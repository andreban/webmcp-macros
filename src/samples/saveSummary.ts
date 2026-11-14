// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Expr, MacroSite, MacroTool, Stmt } from "../macro/types";

/**
 * Saving a summary into the WebMCP Text Editor on bandarra.me (spec §12,
 * macro 6): a second origin, with a tool that pauses for on-page approval.
 * These are building blocks for a sample's macro JSON, not a macro of their
 * own: the summary is only worth saving at the end of a macro that gathered
 * something, so a macro adds `editorSite` under `EDITOR_SITE`, spreads
 * `editorTools` into its tools and puts `saveSummary(...)` in its program.
 */

/** The key the editor goes under in `Macro.sites`. */
export const EDITOR_SITE = "editor";

export const editorSite: MacroSite = {
  match: ["https://bandarra.me/apps/webmcp-text-editor/*"],
  startUrl: "https://bandarra.me/apps/webmcp-text-editor/",
};

/**
 * `create_document({title, content?})` asks the user in a modal, then opens
 * the new document holding `content`. It resolves `{created, id, title}`, or
 * `{error, code}` with code "REJECTED" when the user declines; it never
 * throws, since WebMCP turns a rejection into a bare UnknownError.
 */
export const editorTools = {
  createDocument: { site: EDITOR_SITE, name: "create_document" },
} satisfies Record<string, MacroTool>;

/**
 * The editor tab may be new, and its app registers tools only once Monaco has
 * loaded, which can take longer than the default wait. This bounds only the
 * wait for the tool: the call itself has no time limit, because it stays
 * pending for as long as the approval modal is open.
 */
const EDITOR_LOAD_MS = 30_000;

const replyField = (saveAs: string, field: string): Expr => ({ get: { var: saveAs }, path: [field] });
const isSet = (expr: Expr): Expr => ({ bin: "!=", left: expr, right: { lit: null } });

/**
 * Statements that save `content` as a new document titled `title`, leaving
 * the editor's reply in the variable `saveAs`. Declining the approval is the
 * user's choice, not a failure: the run goes on and `saveAs` holds
 * `{error, code: "REJECTED"}`, so the caller can say the summary was not
 * saved. Any other error fails the run.
 */
export function saveSummary(title: Expr, content: Expr, saveAs: string): Stmt[] {
  return [
    {
      op: "onSite",
      site: EDITOR_SITE,
      body: [
        { op: "waitForTool", tool: "createDocument", timeoutMs: EDITOR_LOAD_MS },
        // The router opens the editor in a background tab, so the user has to go there to approve.
        { op: "message", text: { lit: "Approve the new document in the Text Editor tab." } },
        { op: "call", tool: "createDocument", args: { title, content }, saveAs },
        {
          op: "if",
          cond: {
            bin: "and",
            left: isSet(replyField(saveAs, "error")),
            right: { bin: "!=", left: replyField(saveAs, "code"), right: { lit: "REJECTED" } },
          },
          then: [{ op: "fail", message: replyField(saveAs, "error") }],
        },
      ],
    },
  ];
}
