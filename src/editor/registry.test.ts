import { describe, expect, it } from "vitest";
import { MACRO_VERSION, isMacro, type Expr, type Macro, type Stmt } from "../macro/types";
import {
  createDefault,
  createDefaultExpr,
  exprKind,
  expressions,
  readSlot,
  statements,
  type ExprKind,
  type Slot,
  type StmtOp,
} from "./registry";

const ops = Object.keys(statements).filter((op): op is StmtOp => op in statements);
const kinds = Object.keys(expressions).filter((kind): kind is ExprKind => kind in expressions);

const macroOf = (program: Stmt[]): Macro => ({
  wmm: MACRO_VERSION,
  id: "defaults",
  name: "Defaults",
  sites: {},
  tools: {},
  trigger: { site: "", anyOf: [] },
  program,
});

const slotNames = (label: readonly (string | Slot)[]) =>
  label.flatMap((part) => (typeof part === "string" ? [] : [part.slot]));

describe("createDefault", () => {
  it("creates a node of the requested op for every statement", () => {
    expect(ops).toHaveLength(16);
    for (const op of ops) expect(createDefault(op).op).toBe(op);
  });

  it("builds a valid macro from every statement and expression", () => {
    const program: Stmt[] = [
      ...ops.map((op) => createDefault(op)),
      ...kinds.map((kind): Stmt => ({ op: "message", text: createDefaultExpr(kind) })),
    ];
    const macro = macroOf(program);
    expect(isMacro(macro)).toBe(true);
    expect(isMacro(JSON.parse(JSON.stringify(macro)))).toBe(true);
  });

  it("returns a fresh node on every call", () => {
    const first = createDefault("if");
    first.then.push(createDefault("stop"));
    expect(createDefault("if").then).toEqual([]);
    expect(createDefaultExpr("list")).not.toBe(createDefaultExpr("list"));
  });

  it("gives every field of a default node a slot in the label", () => {
    for (const op of ops) {
      const fields = Object.keys(createDefault(op)).filter((key) => key !== "op");
      expect(slotNames(statements[op].label)).toEqual(expect.arrayContaining(fields));
    }
    for (const kind of kinds) {
      expect(slotNames(expressions[kind].label)).toEqual(expect.arrayContaining(Object.keys(createDefaultExpr(kind))));
    }
  });
});

describe("exprKind", () => {
  it("identifies every expression kind by its key", () => {
    expect(kinds).toHaveLength(16);
    for (const kind of kinds) expect(exprKind(createDefaultExpr(kind))).toBe(kind);
  });

  it("ignores companion keys such as path and args", () => {
    expect(exprKind({ get: { var: "x" }, path: ["a"] })).toBe("get");
    expect(exprKind({ call: "t", args: {} })).toBe("call");
    expect(exprKind({ key: { lit: "a" }, getKey: { var: "d" } })).toBe("getKey");
    expect(exprKind({ item: { lit: 1 }, contains: { var: "l" } })).toBe("contains");
  });

  it("rejects an object that is no expression", () => {
    expect(() => exprKind(JSON.parse('{"path":[]}') as Expr)).toThrow(/Unknown expression/);
  });
});

describe("readSlot", () => {
  it("reads a slot with its type, and skips an absent optional field", () => {
    expect(readSlot({ op: "wait", ms: 5 }, { slot: "ms", type: "ms" })).toEqual({ type: "ms", value: 5 });
    expect(readSlot({ op: "stop" }, { slot: "message", type: "value" })).toBeUndefined();
  });
});
