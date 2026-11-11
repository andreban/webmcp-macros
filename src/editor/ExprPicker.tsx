import { useState } from "react";
import type { Expr, Json, Macro, Stmt } from "../macro/types";
import { createDefaultExpr, type ExprKind, type ExprOf } from "./registry";

/** What a literal typed into a slot must be. Tool schemas map onto it: `array` is "list". */
export type LiteralType = "any" | "text" | "number" | "boolean" | "list" | "object";

export type Parsed = { ok: true; value: Json } | { ok: false; error: string };

function parseJson(text: string): Json | undefined {
  try {
    const value: Json = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

/** Parses what the user typed for a literal of `type`; the error is shown next to the slot. */
export function parseLiteral(text: string, type: LiteralType): Parsed {
  const trimmed = text.trim();
  switch (type) {
    case "text":
      return { ok: true, value: text };
    case "number": {
      const value = Number(trimmed);
      return trimmed !== "" && Number.isFinite(value) ? { ok: true, value } : { ok: false, error: "Enter a number." };
    }
    case "boolean":
      return trimmed === "true" || trimmed === "false"
        ? { ok: true, value: trimmed === "true" }
        : { ok: false, error: "Enter true or false." };
    case "list":
    case "object": {
      const value = parseJson(trimmed);
      const isObject = typeof value === "object" && value !== null;
      if (isObject && Array.isArray(value) === (type === "list")) return { ok: true, value };
      return { ok: false, error: type === "list" ? "Enter a JSON list, such as [1, 2]." : 'Enter a JSON object, such as {"a": 1}.' };
    }
    case "any": {
      // JSON when it parses, so 42 and true keep their types; anything else is text. Quotes force text.
      const value = parseJson(trimmed);
      return { ok: true, value: value === undefined ? text : value };
    }
    default:
      throw new Error(`Unknown literal type: ${JSON.stringify(type satisfies never)}`);
  }
}

/** The text `parseLiteral` turns back into `value`. */
export function formatLiteral(value: Json, type: LiteralType): string {
  if (typeof value === "string" && (type === "text" || parseJson(value.trim()) === undefined)) return value;
  return JSON.stringify(value);
}

/** Names the program assigns, so the picker can offer them. */
export function variableNames(program: readonly Stmt[]): string[] {
  const names = new Set<string>();
  const visit = (body: readonly Stmt[]): void => {
    for (const stmt of body) {
      if (stmt.op === "set" || stmt.op === "forEach") names.add(stmt.var);
      if ((stmt.op === "call" || stmt.op === "popFront" || stmt.op === "popBack") && stmt.saveAs) names.add(stmt.saveAs);
      if (stmt.op === "if") visit([...stmt.then, ...(stmt.else ?? [])]);
      if ("body" in stmt) visit(stmt.body);
    }
  };
  visit(program);
  names.delete("");
  return [...names].toSorted();
}

/** `expr: null` clears an optional slot. */
export interface Choice {
  label: string;
  expr: Expr | null;
}

interface Context {
  macro: Macro;
  current: Expr | undefined;
  /** What a wrapping kind wraps: the current value, so "not" or "x == …" build on it. */
  inner: Expr;
  tool: string;
}

// Typed over every kind, so a new expression fails the build until it is offered here.
const CHOICES: { [K in ExprKind]: (ctx: Context) => { label: string; expr: ExprOf<K> }[] } = {
  lit: ({ current }) => [{ label: "Typed value", expr: current && "lit" in current ? current : createDefaultExpr("lit") }],
  input: ({ macro }) => (macro.inputs ?? []).map((input) => ({ label: `Input: ${input.label}`, expr: { input: input.key } })),
  var: ({ macro }) => [
    ...variableNames(macro.program).map((name) => ({ label: `Variable: ${name}`, expr: { var: name } })),
    { label: "Other variable", expr: createDefaultExpr("var") },
  ],
  get: ({ inner }) => [{ label: "Field of this value", expr: { get: inner, path: [] } }],
  bin: ({ inner }) => [{ label: "Compare or calculate", expr: { ...createDefaultExpr("bin"), left: inner } }],
  not: ({ inner }) => [{ label: "Not this value", expr: { not: inner } }],
  obj: () => [{ label: "Object", expr: createDefaultExpr("obj") }],
  list: () => [{ label: "List", expr: createDefaultExpr("list") }],
  toolAvailable: ({ tool }) => [{ label: "Whether a tool is available", expr: { toolAvailable: tool } }],
  call: ({ tool }) => [{ label: "Result of a tool", expr: { call: tool, args: {} } }],
  callProc: ({ macro }) => {
    const names = Object.keys(macro.procedures ?? {});
    return names.length > 0
      ? names.map((name) => ({ label: `Result of procedure: ${name}`, expr: { callProc: name, args: {} } }))
      : [{ label: "Result of a procedure", expr: createDefaultExpr("callProc") }];
  },
  getKey: ({ inner }) => [{ label: "Item or key of this value", expr: { ...createDefaultExpr("getKey"), getKey: inner } }],
  hasKey: ({ inner }) => [{ label: "Whether this value has a key", expr: { ...createDefaultExpr("hasKey"), hasKey: inner } }],
  length: ({ inner }) => [{ label: "Length of this value", expr: { length: inner } }],
  contains: ({ inner }) => [{ label: "Whether this value contains an item", expr: { ...createDefaultExpr("contains"), contains: inner } }],
  keys: ({ inner }) => [{ label: "Keys of this dictionary", expr: { keys: inner } }],
};

/** Everything a slot can hold, in the order the picker lists it. */
export function pickerChoices(macro: Macro, current: Expr | undefined, optional: boolean): Choice[] {
  const ctx: Context = { macro, current, inner: current ?? createDefaultExpr("lit"), tool: Object.keys(macro.tools)[0] ?? "" };
  const choices: Choice[] = Object.values(CHOICES).flatMap((choose): Choice[] => choose(ctx));
  return optional && current ? [...choices, { label: "Nothing", expr: null }] : choices;
}

export interface ExprPickerProps {
  macro: Macro;
  current: Expr | undefined;
  optional: boolean;
  /** Names the slot, such as "condition". */
  label: string;
  onPick: (expr: Expr | null) => void;
  onCancel: () => void;
}

/** A listbox of what the slot can hold: arrows move, Enter or a click picks, Escape cancels. */
export function ExprPicker({ macro, current, optional, label, onPick, onCancel }: ExprPickerProps) {
  const choices = pickerChoices(macro, current, optional);
  const [selected, setSelected] = useState(0);
  const pick = (index: number) => {
    const choice = choices[index];
    if (choice) onPick(choice.expr);
  };
  return (
    <select
      className="wmm-picker"
      aria-label={`Choose ${label}`}
      size={Math.min(choices.length, 8)}
      autoFocus
      value={selected}
      onChange={(event) => setSelected(Number(event.target.value))}
      onClick={(event) => event.target instanceof HTMLOptionElement && pick(Number(event.target.value))}
      onBlur={onCancel}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Enter") pick(selected);
        else onCancel();
      }}
    >
      {choices.map((choice, index) => (
        // The list is rebuilt from the macro on each render; positions are its identity.
        <option key={index} value={index}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}
