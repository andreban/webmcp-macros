import { describe, expect, it } from "vitest";
import { MACRO_VERSION, type Macro, type Stmt } from "../macro/types";
import { bodiesOf, focusAfterRemove, focusStops, insertionPoint, moveDestination } from "./blockNav";
import { createDefault } from "./registry";
import { createEditorState, editorReducer, moveTarget, type Path } from "./state";

const msg = (text: string): Stmt => ({ op: "message", text: { lit: text } });
const macroOf = (program: Stmt[]): Macro => ({
  wmm: MACRO_VERSION,
  id: "m",
  name: "M",
  sites: {},
  tools: {},
  trigger: { site: "", anyOf: [] },
  program,
});

// [a, if { then: [b] }, c]
const sample = macroOf([msg("a"), { op: "if", cond: { lit: true }, then: [msg("b")] }, msg("c")]);

describe("focusStops", () => {
  it("lists statements in document order and stands in for empty bodies", () => {
    expect(focusStops(sample.program)).toEqual([
      ["program", 0],
      ["program", 1],
      ["program", 1, "then", 0],
      ["program", 2],
    ]);
    expect(focusStops([])).toEqual([["program", 0]]);
    expect(focusStops([createDefault("repeat")])).toEqual([["program", 0], ["program", 0, "body", 0]]);
  });

  it("does not offer an absent optional body", () => {
    expect(bodiesOf(createDefault("if")).map((body) => body.slot)).toEqual(["then"]);
    expect(bodiesOf({ op: "if", cond: { lit: true }, then: [], else: [] }).map((body) => body.slot)).toEqual(["then", "else"]);
  });
});

describe("moveDestination", () => {
  const moved = (from: Path, direction: -1 | 1) => {
    const to = moveDestination(sample, from, direction);
    if (!to) return undefined;
    const next = editorReducer(createEditorState(sample), { type: "moveStmt", from, to }).macro;
    return { at: moveTarget(from, to), program: next.program };
  };

  it("steps into a following body, then out past its end", () => {
    const into = moved(["program", 0], 1);
    expect(into?.at).toEqual(["program", 0, "then", 0]);
    expect(into?.program).toEqual([{ op: "if", cond: { lit: true }, then: [msg("a"), msg("b")] }, msg("c")]);
    expect(moved(["program", 1, "then", 0], 1)?.at).toEqual(["program", 2]);
    expect(moved(["program", 1, "then", 0], -1)?.at).toEqual(["program", 1]);
    expect(moved(["program", 2], -1)?.at).toEqual(["program", 1, "then", 1]);
  });

  it("moves a block with a body as a unit, and stops at the ends", () => {
    expect(moved(["program", 1], 1)?.program.map((stmt) => stmt.op)).toEqual(["message", "message", "if"]);
    expect(moved(["program", 1], -1)?.at).toEqual(["program", 0]);
    expect(moveDestination(sample, ["program", 0], -1)).toBeUndefined();
    expect(moveDestination(sample, ["program", 2], 1)).toBeUndefined();
  });
});

describe("insertion and removal", () => {
  it("inserts after a statement, or into the focused empty body", () => {
    expect(insertionPoint(sample, ["program", 1])).toEqual(["program", 2]);
    const empty = macroOf([createDefault("repeat")]);
    expect(insertionPoint(empty, ["program", 0, "body", 0])).toEqual(["program", 0, "body", 0]);
  });

  it("focuses the next statement, else the previous, else the emptied body", () => {
    expect(focusAfterRemove(sample, ["program", 0])).toEqual(["program", 0]);
    expect(focusAfterRemove(sample, ["program", 2])).toEqual(["program", 1]);
    expect(focusAfterRemove(sample, ["program", 1, "then", 0])).toEqual(["program", 1, "then", 0]);
  });

  it("builds a macro with if, repeat and message from keyboard actions alone", () => {
    let state = createEditorState(macroOf([]));
    let focus: Path = ["program", 0];
    const insert = (op: "if" | "repeat" | "message") => {
      const at = insertionPoint(state.macro, focus);
      state = editorReducer(state, { type: "insertStmt", at, stmt: createDefault(op) });
      focus = at;
    };
    insert("if");
    focus = focusStops(state.macro.program)[1] ?? focus; // ArrowDown into the empty `then`
    insert("repeat");
    focus = focusStops(state.macro.program)[2] ?? focus; // ArrowDown into the empty repeat body
    insert("message");
    insert("message");
    const from = focus;
    const to = moveDestination(state.macro, from, 1); // Alt+Down: out of the repeat
    if (to) state = editorReducer(state, { type: "moveStmt", from, to });
    expect(state.macro.program).toEqual([
      { op: "if", cond: { lit: true }, then: [{ ...createDefault("repeat"), body: [createDefault("message")] }, createDefault("message")] },
    ]);
  });
});
