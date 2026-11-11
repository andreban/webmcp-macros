import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MACRO_VERSION, isMacro, type Expr, type Json, type Macro } from "../macro/types";
import { ExprPicker, formatLiteral, type LiteralType, parseLiteral, pickerChoices, variableNames } from "./ExprPicker";
import { exprKind, expressions } from "./registry";
import { createEditorState, editorReducer } from "./state";

const macro: Macro = {
  wmm: MACRO_VERSION,
  id: "m",
  name: "M",
  sites: { app: { match: ["https://example.com/*"] } },
  tools: { look: { site: "app", name: "look_around" } },
  trigger: { site: "app", anyOf: [["look"]] },
  inputs: [{ key: "code", label: "Auth code", schema: { type: "string" } }],
  program: [
    { op: "call", tool: "look", saveAs: "view" },
    { op: "if", cond: { lit: true }, then: [{ op: "set", var: "count", value: { lit: 0 } }] },
    { op: "repeat", times: { lit: 2 }, body: [{ op: "forEach", var: "item", list: { list: [] }, body: [] }] },
    { op: "stop", message: { lit: "done" } },
  ],
};

describe("parseLiteral", () => {
  it.each<[string, LiteralType, Json]>([
    ["hello", "text", "hello"],
    [" 42 ", "text", " 42 "],
    ["42", "number", 42],
    ["-1.5", "number", -1.5],
    ["true", "boolean", true],
    ["false", "boolean", false],
    ["[1, 2]", "list", [1, 2]],
    ['{"a": 1}', "object", { a: 1 }],
    ["42", "any", 42],
    ["null", "any", null],
    ['"42"', "any", "42"],
    ["north", "any", "north"],
    ["", "any", ""],
  ])("parses %j as %s", (text, type, value) => {
    expect(parseLiteral(text, type)).toEqual({ ok: true, value });
  });

  it.each<[string, LiteralType, string]>([
    ["abc", "number", "Enter a number."],
    ["", "number", "Enter a number."],
    ["Infinity", "number", "Enter a number."],
    ["yes", "boolean", "Enter true or false."],
    ['{"a": 1}', "list", "Enter a JSON list, such as [1, 2]."],
    ["[1", "list", "Enter a JSON list, such as [1, 2]."],
    ["[1]", "object", 'Enter a JSON object, such as {"a": 1}.'],
    ["null", "object", 'Enter a JSON object, such as {"a": 1}.'],
  ])("rejects %j as %s", (text, type, error) => {
    expect(parseLiteral(text, type)).toEqual({ ok: false, error });
  });

  it("formats values so they parse back to themselves", () => {
    const values: Json[] = ["north", "42", " 42", "", 42, true, null, [1, "a"], { a: { b: 1 } }];
    for (const value of values) expect(parseLiteral(formatLiteral(value, "any"), "any")).toEqual({ ok: true, value });
    expect(formatLiteral("42", "text")).toBe("42");
    expect(formatLiteral("42", "any")).toBe('"42"');
  });
});

describe("variableNames", () => {
  it("collects the names the program assigns, at any depth", () => {
    expect(variableNames(macro.program)).toEqual(["count", "item", "view"]);
  });
});

describe("pickerChoices", () => {
  it("offers every expression kind, each of which can fill a slot", () => {
    const choices = pickerChoices(macro, { lit: 1 }, false);
    const kinds = new Set(choices.flatMap(({ expr }) => (expr ? [exprKind(expr)] : [])));
    expect([...kinds].toSorted()).toEqual(Object.keys(expressions).toSorted());
    const start = createEditorState(macro);
    for (const { expr } of choices) {
      if (!expr) continue;
      const next = editorReducer(start, { type: "replaceNode", at: ["program", 2, "times"], node: expr });
      expect(isMacro(next.macro)).toBe(true);
      expect(next.macro.program[2]).toMatchObject({ op: "repeat", times: expr });
    }
  });

  it("offers inputs and variables by name, and tools by their first alias", () => {
    const exprs = pickerChoices(macro, undefined, false).map((choice) => choice.expr);
    expect(exprs).toContainEqual({ input: "code" });
    expect(exprs).toContainEqual({ var: "view" });
    expect(exprs).toContainEqual({ call: "look", args: {} });
    expect(exprs).toContainEqual({ toolAvailable: "look" });
  });

  it("wraps the current value and keeps a literal as it is", () => {
    const current: Expr = { var: "count" };
    const exprs = pickerChoices(macro, current, false).map((choice) => choice.expr);
    expect(exprs).toContainEqual({ not: current });
    expect(exprs).toContainEqual({ get: current, path: [] });
    expect(exprs).toContainEqual({ bin: "==", left: current, right: { lit: null } });
    const literal = { lit: 7 };
    expect(pickerChoices(macro, literal, false).find((choice) => choice.label === "Typed value")?.expr).toBe(literal);
  });

  it("offers to clear only an optional slot that holds a value", () => {
    const clears = (current: Expr | undefined, optional: boolean) =>
      pickerChoices(macro, current, optional).some((choice) => choice.expr === null);
    expect(clears({ lit: "done" }, true)).toBe(true);
    expect(clears(undefined, true)).toBe(false);
    expect(clears({ lit: "done" }, false)).toBe(false);
  });
});

describe("ExprPicker", () => {
  it("renders a listbox named after the slot", () => {
    const html = renderToStaticMarkup(
      <ExprPicker macro={macro} current={undefined} optional={false} label="condition" onPick={() => {}} onCancel={() => {}} />,
    );
    expect(html).toMatch(/^<select[^>]*aria-label="Choose condition"[^>]*size="8"/);
    expect(html).toContain(">Input: Auth code</option>");
    expect(html).toContain(">Result of a tool</option>");
  });
});
