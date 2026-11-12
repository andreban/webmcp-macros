import { describe, expect, it } from "vitest";
import { MACRO_VERSION, type Macro, type MacroInput, type Stmt } from "../macro/types";
import { createNewMacro } from "./page";
import {
  createEditorState,
  describePath,
  editorReducer,
  getNode,
  inputKeyError,
  inputReferences,
  isOptionalSlot,
  moveTarget,
  type EditorAction,
  type EditorState,
} from "./state";

const msg = (text: string): Stmt => ({ op: "message", text: { lit: text } });

function sample(): Macro {
  return {
    wmm: MACRO_VERSION,
    id: "m1",
    name: "Sample",
    sites: { app: { match: ["https://example.com/*"] } },
    tools: { look: { site: "app", name: "look" } },
    trigger: { site: "app", anyOf: [["look"]] },
    program: [
      msg("a"),
      {
        op: "if",
        cond: { bin: "==", left: { var: "x" }, right: { lit: 1 } },
        then: [msg("then0"), msg("then1")],
      },
      { op: "repeat", times: { lit: 3 }, body: [msg("loop0")] },
      { op: "call", tool: "look", args: { dir: { lit: "north" } } },
    ],
  };
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

const texts = (body: readonly Stmt[] | undefined) =>
  body?.map((s) => (s.op === "message" && "lit" in s.text ? s.text.lit : s.op));

describe("getNode", () => {
  const macro = sample();

  it("reads bodies, statements and expression slots", () => {
    expect(getNode(macro, ["program"])).toEqual({ kind: "body", node: macro.program });
    expect(getNode(macro, ["program", 1, "then", 1])).toEqual({ kind: "stmt", node: msg("then1") });
    expect(getNode(macro, ["program", 1, "cond", "left"])).toEqual({ kind: "expr", node: { var: "x" } });
    expect(getNode(macro, ["program", 3, "args", "dir"])).toEqual({ kind: "expr", node: { lit: "north" } });
  });

  it("reads a missing else as an empty body, and the end of a body or an unset arg as an empty slot", () => {
    expect(getNode(macro, ["program", 1, "else"])).toEqual({ kind: "body", node: [] });
    expect(getNode(macro, ["program", 4])).toEqual({ kind: "stmt", node: undefined });
    expect(getNode(macro, ["program", 3, "args", "constructor"])).toEqual({ kind: "expr", node: undefined });
  });

  it("reads the slots of data statements and expressions", () => {
    const data: Macro = {
      ...macro,
      program: [
        { op: "setKey", var: "d", key: { lit: "k" }, value: { length: { keys: { var: "d" } } } },
        { op: "push", var: "q", value: { contains: { var: "q" }, item: { getKey: { var: "d" }, key: { lit: "k" } } } },
        { op: "popFront", var: "q", saveAs: "x" },
      ],
    };
    expect(getNode(data, ["program", 0, "key"])).toEqual({ kind: "expr", node: { lit: "k" } });
    expect(getNode(data, ["program", 0, "value", "length", "keys"])).toEqual({ kind: "expr", node: { var: "d" } });
    expect(getNode(data, ["program", 1, "value", "item", "key"])).toEqual({ kind: "expr", node: { lit: "k" } });
    expect(getNode(data, ["program", 1, "value", "contains"])).toEqual({ kind: "expr", node: { var: "q" } });
    // Variable names are not expression slots.
    expect(getNode(data, ["program", 2, "saveAs"])).toBeUndefined();
    expect(getNode(data, ["program", 0, "var"])).toBeUndefined();
  });

  it.each([
    [["sites"]],
    [["program", 5]],
    [["program", -1]],
    [["program", 0.5]],
    [["program", "0"]],
    [["program", 0, "then"]],
    [["program", 2, "cond"]],
    [["program", 1, "cond", "path"]],
    [["program", 1, "then", 0, "text", "lit"]],
  ])("rejects %j", (path) => {
    expect(getNode(macro, path)).toBeUndefined();
  });
});

describe("editorReducer", () => {
  it("inserts into the program and into if.then, if.else and loop bodies", () => {
    const state = run(
      createEditorState(sample()),
      { type: "insertStmt", at: ["program", 0], stmt: msg("first") },
      { type: "insertStmt", at: ["program", 2, "then", 2], stmt: msg("then2") },
      { type: "insertStmt", at: ["program", 2, "else", 0], stmt: msg("else0") },
      { type: "insertStmt", at: ["program", 3, "body", 0], stmt: msg("loopA") },
    );
    const [, , ifStmt, loop] = state.macro.program;
    expect(texts(state.macro.program)).toEqual(["first", "a", "if", "repeat", "call"]);
    expect(ifStmt?.op === "if" && texts(ifStmt.then)).toEqual(["then0", "then1", "then2"]);
    expect(ifStmt?.op === "if" && texts(ifStmt.else)).toEqual(["else0"]);
    expect(loop?.op === "repeat" && texts(loop.body)).toEqual(["loopA", "loop0"]);
  });

  it("removes nested statements", () => {
    const state = run(createEditorState(sample()), { type: "removeStmt", at: ["program", 1, "then", 0] });
    expect(texts(getNode(state.macro, ["program", 1, "then"])?.node as Stmt[])).toEqual(["then1"]);
  });

  it("moves forward within a body using positions from before the move", () => {
    const state = run(createEditorState(sample()), { type: "moveStmt", from: ["program", 0], to: ["program", 3] });
    expect(texts(state.macro.program)).toEqual(["if", "repeat", "a", "call"]);
    expect(moveTarget(["program", 0], ["program", 3])).toEqual(["program", 2]);
  });

  it("moves backward within a nested body", () => {
    const state = run(createEditorState(sample()), {
      type: "moveStmt",
      from: ["program", 1, "then", 1],
      to: ["program", 1, "then", 0],
    });
    expect(texts(getNode(state.macro, ["program", 1, "then"])?.node as Stmt[])).toEqual(["then1", "then0"]);
  });

  it("moves across bodies, including into the body of a later sibling", () => {
    const state = run(
      createEditorState(sample()),
      { type: "moveStmt", from: ["program", 0], to: ["program", 2, "body", 1] },
      { type: "moveStmt", from: ["program", 0, "then", 0], to: ["program", 0, "else", 0] },
      { type: "moveStmt", from: ["program", 1, "body", 0], to: ["program", 0] },
    );
    const [loop0, ifStmt, loop] = state.macro.program;
    expect(loop0).toEqual(msg("loop0"));
    expect(ifStmt?.op === "if" && [texts(ifStmt.then), texts(ifStmt.else)]).toEqual([["then1"], ["then0"]]);
    expect(loop?.op === "repeat" && texts(loop.body)).toEqual(["a"]);
  });

  it("replaces statements and expression slots, sharing untouched nodes", () => {
    const before = sample();
    const state = run(
      createEditorState(before),
      { type: "replaceNode", at: ["program", 1, "cond", "right"], node: { lit: 2 } },
      { type: "replaceNode", at: ["program", 2], node: msg("swapped") },
      { type: "replaceNode", at: ["program", 3, "args", "speed"], node: { lit: 5 } },
    );
    const ifStmt = state.macro.program[1];
    expect(ifStmt?.op === "if" && ifStmt.cond).toEqual({ bin: "==", left: { var: "x" }, right: { lit: 2 } });
    expect(state.macro.program[2]).toEqual(msg("swapped"));
    expect(getNode(state.macro, ["program", 3, "args", "speed"])?.node).toEqual({ lit: 5 });
    expect(state.macro.program[0]).toBe(before.program[0]);
    expect(state.macro.sites).toBe(before.sites);
    expect(ifStmt?.op === "if" && ifStmt.then).toBe(before.program[1]?.op === "if" && before.program[1].then);
  });

  it("adds the tools a replaced node needs in the same undo step", () => {
    const before = sample();
    const look = { site: before.trigger.site, name: "look_around" };
    const state = run(createEditorState(before), {
      type: "replaceNode",
      at: ["program", 2],
      node: { op: "call", tool: "look" },
      tools: { look },
    });
    expect(state.macro.tools.look).toEqual(look);
    expect(state.macro.program[2]).toEqual({ op: "call", tool: "look" });
    expect(run(state, { type: "undo" }).macro).toBe(before);
  });

  it("never mutates the previous macro", () => {
    const before = sample();
    const snapshot = structuredClone(before);
    run(
      createEditorState(before),
      { type: "insertStmt", at: ["program", 1, "else", 0], stmt: msg("x") },
      { type: "removeStmt", at: ["program", 1, "then", 0] },
      { type: "moveStmt", from: ["program", 2, "body", 0], to: ["program", 0] },
      { type: "replaceNode", at: ["program", 1, "cond", "left"], node: { lit: true } },
      { type: "setMeta", meta: { name: "Renamed" } },
    );
    expect(before).toEqual(snapshot);
  });

  it("clears an optional field and records one undo step", () => {
    const start = createEditorState(sample());
    const withMessage = run(start, { type: "insertStmt", at: ["program", 0], stmt: { op: "stop", message: { lit: "bye" } } });
    const cleared = run(withMessage, { type: "clearSlot", at: ["program", 0, "message"] });
    expect(cleared.macro.program[0]).toEqual({ op: "stop" });
    expect(cleared.past).toHaveLength(2);
    const noArgs = run(start, { type: "clearSlot", at: ["program", 3, "args"] });
    expect(noArgs.macro.program[3]).toEqual({ op: "call", tool: "look" });
    expect(run(noArgs, { type: "undo" }).macro).toBe(start.macro);
  });

  it("knows which statement fields may be absent", () => {
    expect(isOptionalSlot("return", "value")).toBe(true);
    expect(isOptionalSlot("if", "else")).toBe(true);
    expect(isOptionalSlot("if", "then")).toBe(false);
    expect(isOptionalSlot("set", "value")).toBe(false);
    const start = createEditorState({ ...sample(), program: [{ op: "return", value: { lit: 1 } }] });
    expect(run(start, { type: "clearSlot", at: ["program", 0, "value"] }).macro.program[0]).toEqual({ op: "return" });
  });

  it("updates metadata and ignores a patch that changes nothing", () => {
    const start = createEditorState(sample());
    const renamed = run(start, { type: "setMeta", meta: { name: "New", description: "Does things" } });
    expect(renamed.macro).toMatchObject({ name: "New", description: "Does things", id: "m1" });
    expect(run(renamed, { type: "setMeta", meta: { name: "New" } })).toBe(renamed);
  });

  it.each<EditorAction>([
    { type: "insertStmt", at: ["program", 9], stmt: msg("x") },
    { type: "insertStmt", at: ["program", 0, "then", 0], stmt: msg("x") },
    { type: "insertStmt", at: ["sites", 0], stmt: msg("x") },
    { type: "removeStmt", at: ["program", 4] },
    { type: "removeStmt", at: ["program", 1, "cond"] },
    { type: "moveStmt", from: ["program", 1], to: ["program", 1, "then", 0] },
    { type: "moveStmt", from: ["program", 1], to: ["program", 1, "else", 0] },
    { type: "moveStmt", from: ["program", 1], to: ["program", 1] },
    { type: "moveStmt", from: ["program", 1], to: ["program", 2] },
    { type: "moveStmt", from: ["program", 7], to: ["program", 0] },
    { type: "moveStmt", from: ["program", 0], to: ["program", 9] },
    { type: "replaceNode", at: ["program", 1, "cond"], node: msg("x") },
    { type: "replaceNode", at: ["program", 1], node: { lit: 1 } },
    { type: "replaceNode", at: ["program", 4], node: msg("x") },
    { type: "replaceNode", at: ["program", 0, "cond"], node: { lit: 1 } },
    { type: "clearSlot", at: ["program", 1, "cond"] },
    { type: "clearSlot", at: ["program", 1, "else"] },
    { type: "clearSlot", at: ["program", 1, "cond", "left"] },
    { type: "clearSlot", at: ["program", 3, "tool"] },
    { type: "clearSlot", at: ["program", 9, "else"] },
    { type: "clearSlot", at: ["program"] },
    { type: "undo" },
    { type: "redo" },
  ])("returns the same state for %j", (action) => {
    const state = createEditorState(sample());
    expect(editorReducer(state, action)).toBe(state);
  });

  it("undoes and redoes, and a new edit clears the redo stack", () => {
    const start = createEditorState(sample());
    const edited = run(
      start,
      { type: "removeStmt", at: ["program", 0] },
      { type: "setMeta", meta: { name: "Two" } },
    );
    const undone = run(edited, { type: "undo" }, { type: "undo" });
    expect(undone.macro).toBe(start.macro);
    expect(undone.future).toHaveLength(2);
    const redone = run(undone, { type: "redo" });
    expect(redone.macro.program).toHaveLength(3);
    expect(redone.macro.name).toBe("Sample");
    expect(run(redone, { type: "redo" }).macro).toBe(edited.macro);
    const branched = run(redone, { type: "setMeta", meta: { name: "Other" } });
    expect(branched.future).toEqual([]);
    expect(run(branched, { type: "redo" })).toBe(branched);
  });

  it("keeps at most historyLimit undo steps", () => {
    let state = createEditorState(sample(), 3);
    for (let i = 0; i < 5; i++) state = run(state, { type: "setMeta", meta: { name: `n${i}` } });
    expect(state.past.map((m) => m.name)).toEqual(["n1", "n2", "n3"]);
    state = run(state, { type: "undo" }, { type: "undo" }, { type: "undo" }, { type: "undo" });
    expect(state.macro.name).toBe("n1");
    expect(run(createEditorState(sample(), 0), { type: "setMeta", meta: { name: "x" } }).past).toEqual([]);
  });
});

describe("input actions", () => {
  const text = (key: string): MacroInput => ({ key, label: key.toUpperCase(), schema: { type: "string" } });

  // `when` is referenced in a nested body, inside an object and in a call argument;
  // the literal that only looks like a reference must never be touched.
  function withInputs(): Macro {
    const macro = sample();
    return {
      ...macro,
      inputs: [text("when"), text("who"), text("spare")],
      program: [
        ...macro.program,
        {
          op: "if",
          cond: { not: { input: "who" } },
          then: [{ op: "message", text: { input: "when" } }],
          else: [{ op: "set", var: "o", value: { obj: { at: { input: "when" }, raw: { lit: { input: "when" } } } } }],
        },
        { op: "call", tool: "look", args: { dir: { list: [{ input: "when" }] } } },
      ],
    };
  }

  it("finds references by path and describes them as people count", () => {
    const refs = inputReferences(withInputs(), "when");
    expect(refs).toEqual([
      ["program", 4, "then", 0, "text"],
      ["program", 4, "else", 0, "value", "obj", "at"],
      ["program", 5, "args", "dir", "list", 0],
    ]);
    expect(refs.map(describePath)).toEqual(["step 5 › then 1", "step 5 › else 1", "step 6"]);
    expect(inputReferences(withInputs(), "spare")).toEqual([]);
  });

  it("renames a key in every reference, but not inside literals, as one undo step", () => {
    const start = createEditorState(withInputs());
    const state = run(start, { type: "updateInput", index: 0, input: { ...text("when"), key: "date" } });
    expect(state.macro.inputs?.map((i) => i.key)).toEqual(["date", "who", "spare"]);
    expect(inputReferences(state.macro, "when")).toEqual([]);
    expect(inputReferences(state.macro, "date")).toHaveLength(3);
    expect(getNode(state.macro, ["program", 4, "else", 0, "value", "obj", "raw"])?.node).toEqual({
      lit: { input: "when" },
    });
    expect(getNode(state.macro, ["program", 4, "cond"])?.node).toEqual({ not: { input: "who" } });
    expect(state.past).toHaveLength(1);
    expect(run(state, { type: "undo" }).macro).toBe(start.macro);
  });

  it.each(["who", "2nd", "has space", "", "a-b"])("rejects the key %j when renaming or adding", (key) => {
    const start = createEditorState(withInputs());
    expect(run(start, { type: "updateInput", index: 0, input: { ...text("when"), key } })).toBe(start);
    expect(run(start, { type: "addInput", input: text(key) })).toBe(start);
    expect(inputKeyError(start.macro, key)).toBeTypeOf("string");
  });

  it("edits other fields without touching the program", () => {
    const start = createEditorState(withInputs());
    const state = run(start, { type: "updateInput", index: 1, input: { ...text("who"), mode: "remember" } });
    expect(state.macro.inputs?.[1]?.mode).toBe("remember");
    expect(state.macro.program).toBe(start.macro.program);
    expect(inputKeyError(start.macro, "who", 1)).toBeUndefined();
    expect(run(start, { type: "updateInput", index: 9, input: text("x") })).toBe(start);
  });

  it("adds to a macro without inputs, and moves inputs", () => {
    const added = run(
      createEditorState(sample()),
      { type: "addInput", input: text("a") },
      { type: "addInput", input: text("b") },
    );
    expect(added.macro.inputs?.map((i) => i.key)).toEqual(["a", "b"]);
    expect(run(added, { type: "moveInput", from: 1, to: 0 }).macro.inputs?.map((i) => i.key)).toEqual(["b", "a"]);
    for (const [from, to] of [[0, 0], [0, 2], [2, 0], [0, -1]] as const) {
      expect(run(added, { type: "moveInput", from, to })).toBe(added);
    }
  });

  it("removes an unused input and refuses one that is still referenced", () => {
    const start = createEditorState(withInputs());
    expect(run(start, { type: "removeInput", index: 0 })).toBe(start);
    expect(run(start, { type: "removeInput", index: 1 })).toBe(start);
    expect(run(start, { type: "removeInput", index: 2 }).macro.inputs?.map((i) => i.key)).toEqual(["when", "who"]);
  });
});

describe("trigger following the program", () => {
  const fresh = (): Macro => ({
    ...createNewMacro("https://example.com/", "m"),
    tools: { look: { site: "main", name: "look" }, go: { site: "main", name: "go" } },
  });

  it("keeps a proposed trigger in step with each program edit, in the same undo step", () => {
    const start = createEditorState(fresh());
    const one = editorReducer(start, { type: "insertStmt", at: ["program", 0], stmt: { op: "call", tool: "look" } });
    expect(one.macro.trigger).toEqual({ site: "main", anyOf: [["look"]] });
    const two = editorReducer(one, { type: "insertStmt", at: ["program", 0], stmt: { op: "waitForTool", tool: "go" } });
    expect(two.macro.trigger).toEqual({ site: "main", anyOf: [[]] });
    expect(editorReducer(two, { type: "undo" }).macro).toBe(one.macro);
  });

  it("stops following once the trigger is edited by hand", () => {
    const start = createEditorState(fresh());
    const own = { site: "main", anyOf: [["go"]] };
    const edited = editorReducer(start, { type: "setMeta", meta: { trigger: own } });
    const next = editorReducer(edited, { type: "insertStmt", at: ["program", 0], stmt: { op: "call", tool: "look" } });
    expect(next.macro.trigger).toBe(own);
  });
});
