import { describe, expect, it } from "vitest";
import { isMacro, type Expr, type Macro, type Stmt } from "../macro/types";
import { adventureMacro, flightSearchMacro, rocketLauncherMacro, sampleMacros } from "./index";

/** Every tool alias and input key a program refers to, at any depth. */
interface References {
  tools: Set<string>;
  inputs: Set<string>;
}

function walkArgs(args: Record<string, Expr> | undefined, refs: References): void {
  for (const value of Object.values(args ?? {})) walkExpr(value, refs);
}

function walkExpr(expr: Expr, refs: References): void {
  if ("lit" in expr || "var" in expr) return;
  if ("input" in expr) {
    refs.inputs.add(expr.input);
  } else if ("get" in expr) {
    walkExpr(expr.get, refs);
  } else if ("bin" in expr) {
    walkExpr(expr.left, refs);
    walkExpr(expr.right, refs);
  } else if ("not" in expr) {
    walkExpr(expr.not, refs);
  } else if ("obj" in expr) {
    walkArgs(expr.obj, refs);
  } else if ("list" in expr) {
    for (const item of expr.list) walkExpr(item, refs);
  } else if ("toolAvailable" in expr) {
    refs.tools.add(expr.toolAvailable);
  } else if ("call" in expr) {
    refs.tools.add(expr.call);
    walkArgs(expr.args, refs);
  } else if ("callProc" in expr) {
    walkArgs(expr.args, refs);
  } else if ("getKey" in expr || "hasKey" in expr) {
    walkExpr("getKey" in expr ? expr.getKey : expr.hasKey, refs);
    walkExpr(expr.key, refs);
  } else if ("contains" in expr) {
    walkExpr(expr.contains, refs);
    walkExpr(expr.item, refs);
  } else if ("length" in expr) {
    walkExpr(expr.length, refs);
  } else if ("keys" in expr) {
    walkExpr(expr.keys, refs);
  } else {
    throw new Error(`Unknown expression: ${JSON.stringify(expr satisfies never)}`);
  }
}

function walkStmts(stmts: Stmt[], refs: References): void {
  for (const stmt of stmts) {
    switch (stmt.op) {
      case "call":
        refs.tools.add(stmt.tool);
        walkArgs(stmt.args, refs);
        break;
      case "waitForTool":
        refs.tools.add(stmt.tool);
        break;
      case "set":
        walkExpr(stmt.value, refs);
        break;
      case "if":
        walkExpr(stmt.cond, refs);
        walkStmts(stmt.then, refs);
        walkStmts(stmt.else ?? [], refs);
        break;
      case "repeat":
        walkExpr(stmt.times, refs);
        walkStmts(stmt.body, refs);
        break;
      case "while":
        walkExpr(stmt.cond, refs);
        walkStmts(stmt.body, refs);
        break;
      case "forEach":
        walkExpr(stmt.list, refs);
        walkStmts(stmt.body, refs);
        break;
      case "onSite":
        walkStmts(stmt.body, refs);
        break;
      case "message":
        walkExpr(stmt.text, refs);
        break;
      case "stop":
        if (stmt.message) walkExpr(stmt.message, refs);
        break;
      case "fail":
        walkExpr(stmt.message, refs);
        break;
      case "setKey":
        walkExpr(stmt.key, refs);
        walkExpr(stmt.value, refs);
        break;
      case "push":
        walkExpr(stmt.value, refs);
        break;
      case "return":
        if (stmt.value) walkExpr(stmt.value, refs);
        break;
      case "wait":
      case "popFront":
      case "popBack":
        break;
      default:
        throw new Error(`Unknown statement: ${JSON.stringify(stmt satisfies never)}`);
    }
  }
}

function references(stmts: Stmt[]): References {
  const refs: References = { tools: new Set(), inputs: new Set() };
  walkStmts(stmts, refs);
  return refs;
}

describe("references", () => {
  it("finds tools and inputs in nested bodies and expressions", () => {
    const refs = references([
      {
        op: "while",
        cond: { toolAvailable: "a" },
        body: [
          {
            op: "forEach",
            list: { list: [{ input: "i1" }] },
            var: "x",
            body: [
              {
                op: "if",
                cond: { not: { var: "x" } },
                then: [{ op: "waitForTool", tool: "b" }],
                else: [
                  {
                    op: "set",
                    var: "y",
                    value: { obj: { k: { call: "c", args: { q: { input: "i2" } } } } },
                  },
                ],
              },
            ],
          },
        ],
      },
      { op: "repeat", times: { get: { input: "i3" }, path: ["n"] }, body: [{ op: "call", tool: "d" }] },
      { op: "stop", message: { bin: "+", left: { lit: "" }, right: { input: "i4" } } },
    ]);
    expect([...refs.tools].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...refs.inputs].sort()).toEqual(["i1", "i2", "i3", "i4"]);
  });
});

describe("sample macros", () => {
  it("bundles the acceptance macros", () => {
    expect(sampleMacros).toEqual([rocketLauncherMacro, flightSearchMacro, adventureMacro]);
  });

  it("have unique ids", () => {
    const ids = sampleMacros.map((macro) => macro.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(sampleMacros.map((macro): [string, Macro] => [macro.id, macro]))("%s", (_id, macro) => {
    it("is accepted by isMacro, also after a JSON round trip", () => {
      expect(isMacro(macro)).toBe(true);
      expect(isMacro(JSON.parse(JSON.stringify(macro)))).toBe(true);
    });

    it("declares every tool alias its program uses", () => {
      const { tools } = references(macro.program);
      expect(tools.size).toBeGreaterThan(0);
      for (const alias of tools) expect(Object.keys(macro.tools)).toContain(alias);
    });

    it("declares every input its program reads", () => {
      const declared = (macro.inputs ?? []).map((input) => input.key);
      expect(new Set(declared).size).toBe(declared.length);
      for (const key of references(macro.program).inputs) expect(declared).toContain(key);
    });

    it("puts every tool on a declared site", () => {
      for (const tool of Object.values(macro.tools)) expect(Object.keys(macro.sites)).toContain(tool.site);
    });

    it("triggers only on declared tools of the trigger site", () => {
      expect(Object.keys(macro.sites)).toContain(macro.trigger.site);
      expect(macro.trigger.anyOf.length).toBeGreaterThan(0);
      for (const set of macro.trigger.anyOf) {
        expect(set.length).toBeGreaterThan(0);
        for (const alias of set) expect(macro.tools[alias]?.site).toBe(macro.trigger.site);
      }
    });
  });
});
