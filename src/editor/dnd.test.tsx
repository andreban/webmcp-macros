// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Macro, Stmt } from "../macro/types";
import { rocketLauncherMacro } from "../samples";
import { dropAction, dropPosition, landedAt } from "./dnd";
import { ProgramEditor } from "./ProgramEditor";
import { createEditorState, editorReducer } from "./state";

const msg = (text: string): Stmt => ({ op: "message", text: { lit: text } });
const macro: Macro = {
  ...rocketLauncherMacro,
  program: [msg("a"), { op: "repeat", times: { lit: 2 }, body: [msg("b")] }, { op: "while", cond: { lit: true }, body: [] }],
};
const apply = (action: ReturnType<typeof dropAction>) =>
  action ? editorReducer(createEditorState(macro), action).macro.program : undefined;

describe("dropPosition", () => {
  it("drops before a block in its upper half and after it in its lower half", () => {
    expect(dropPosition(["program", 1], false)).toEqual(["program", 1]);
    expect(dropPosition(["program", 1, "body", 0], true)).toEqual(["program", 1, "body", 1]);
  });
});

describe("dropAction", () => {
  it("reorders within a body with the keyboard's moveStmt", () => {
    const action = dropAction(macro, { kind: "stmt", from: ["program", 0] }, ["program", 2]);
    expect(action).toEqual({ type: "moveStmt", from: ["program", 0], to: ["program", 2] });
    expect(apply(action)?.map((stmt) => stmt.op)).toEqual(["repeat", "message", "while"]);
  });

  it("moves between bodies and into an empty body", () => {
    const action = dropAction(macro, { kind: "stmt", from: ["program", 1, "body", 0] }, ["program", 2, "body", 0]);
    expect(apply(action)).toEqual([msg("a"), { op: "repeat", times: { lit: 2 }, body: [] }, { op: "while", cond: { lit: true }, body: [msg("b")] }]);
    expect(landedAt({ kind: "stmt", from: ["program", 0] }, ["program", 2])).toEqual(["program", 1]);
  });

  it("refuses a block into itself, onto its own place, or off the program", () => {
    const repeat = { kind: "stmt", from: ["program", 1] } as const;
    expect(dropAction(macro, repeat, ["program", 1, "body", 0])).toBeUndefined();
    expect(dropAction(macro, repeat, ["program", 1])).toBeUndefined();
    expect(dropAction(macro, repeat, ["program", 2])).toBeUndefined();
    expect(dropAction(macro, repeat, ["program", 9])).toBeUndefined();
  });

  it("inserts a new block from the palette", () => {
    const action = dropAction(macro, { kind: "palette", insert: { stmt: { op: "wait", ms: 1000 } } }, ["program", 2, "body", 0]);
    expect(action?.type).toBe("insertStmt");
    expect(apply(action)?.[2]).toEqual({ op: "while", cond: { lit: true }, body: [{ op: "wait", ms: 1000 }] });
  });
});

describe("ProgramEditor drag sources", () => {
  it("makes blocks and palette options draggable", () => {
    const html = renderToStaticMarkup(<ProgramEditor macro={macro} dispatch={() => {}} />);
    expect(html.match(/class="wmm-block[^"]*"[^>]*draggable="true"/g)?.length).toBeGreaterThan(3);
    expect(html).toMatch(/role="option"[^>]*draggable="true"/);
    expect(html).not.toMatch(/class="wmm-empty"[^>]*draggable/);
  });
});
