import type { BinaryOp, Expr, Json, Stmt } from "../macro/types";

/**
 * The block registry: one definition per statement `op` and per expression
 * kind. A definition lists the block's label as text and slots in reading
 * order, and creates an empty node. Views, the palette and the slot editors
 * are generated from it, so adding a block is adding an entry here.
 *
 * Pure: no React, no `chrome.*`.
 */

/** What each slot type holds in the macro JSON. */
export interface SlotValues {
  value: Expr;
  body: Stmt[];
  /** A key into `Macro.tools`. */
  tool: string;
  var: string;
  /** A key into `Macro.inputs`. */
  input: string;
  ms: number;
  args: Record<string, Expr>;
  items: Expr[];
  path: (string | number)[];
  literal: Json;
  binOp: BinaryOp;
}

export type SlotType = keyof SlotValues;

/** A slot's type and value, correlated so a `switch` on `type` narrows `value`. */
export type SlotValue = { [T in SlotType]: { type: T; value: SlotValues[T] } }[SlotType];

/**
 * A slot names a field of the node. `prefix` is shown only when the field is
 * present, which is how optional fields carry their own wording; a body's
 * prefix reads as a keyword (for example "else").
 */
export interface Slot<K extends string = string, T extends SlotType = SlotType> {
  slot: K;
  type: T;
  prefix?: string;
}

type Fields<N> = Exclude<keyof N, "op"> & string;

/** The slots a node admits: a field may use a slot type only if its value fits. */
export type SlotOf<N> = {
  [K in Fields<N>]: {
    [T in SlotType]: [Exclude<N[K], undefined>] extends [SlotValues[T]] ? Slot<K, T> : never;
  }[SlotType];
}[Fields<N>];

export type Part<N> = string | SlotOf<N>;

export type Category = "call" | "control" | "data" | "user";

export type StmtOp = Stmt["op"];
export type StmtOf<O extends StmtOp> = Extract<Stmt, { op: O }>;

export interface StmtDef<N> {
  category: Category;
  /** Opens the block, so colour is never the only cue. */
  verb: string;
  label: readonly Part<N>[];
  create: () => N;
}

/** An expression kind is its variant's identifying key. */
export type ExprKind = "lit" | "input" | "var" | "get" | "bin" | "not" | "obj" | "list" | "toolAvailable" | "call";
// Distributes over `K`: `Record<"a" | "b", …>` would demand both keys at once.
export type ExprOf<K extends ExprKind> = K extends ExprKind ? Extract<Expr, Record<K, unknown>> : never;

// Fails to compile when an `Expr` variant has no kind above.
true satisfies [Exclude<Expr, ExprOf<ExprKind>>] extends [never] ? true : false;

export interface ExprDef<N> {
  label: readonly Part<N>[];
  /** A leaf whose single slot is shown as is, not wrapped in a pill. */
  bare?: true;
  create: () => N;
}

// The mapped types make a missing `op` or kind a build error.
export const statements: { [O in StmtOp]: StmtDef<StmtOf<O>> } = {
  call: {
    category: "call",
    verb: "call",
    label: [{ slot: "tool", type: "tool" }, " ", { slot: "args", type: "args" }, { slot: "saveAs", type: "var", prefix: " as " }],
    create: () => ({ op: "call", tool: "" }),
  },
  set: {
    category: "data",
    verb: "set",
    label: [{ slot: "var", type: "var" }, " to ", { slot: "value", type: "value" }],
    create: () => ({ op: "set", var: "", value: { lit: null } }),
  },
  if: {
    category: "control",
    verb: "if",
    label: [{ slot: "cond", type: "value" }, { slot: "then", type: "body" }, { slot: "else", type: "body", prefix: "else" }],
    create: () => ({ op: "if", cond: { lit: true }, then: [] }),
  },
  repeat: {
    category: "control",
    verb: "repeat",
    label: [{ slot: "times", type: "value" }, " times", { slot: "body", type: "body" }],
    create: () => ({ op: "repeat", times: { lit: 1 }, body: [] }),
  },
  while: {
    category: "control",
    verb: "while",
    label: [{ slot: "cond", type: "value" }, { slot: "body", type: "body" }],
    create: () => ({ op: "while", cond: { lit: false }, body: [] }),
  },
  forEach: {
    category: "control",
    verb: "for each",
    label: [{ slot: "var", type: "var" }, " in ", { slot: "list", type: "value" }, { slot: "body", type: "body" }],
    create: () => ({ op: "forEach", list: { list: [] }, var: "item", body: [] }),
  },
  waitForTool: {
    category: "control",
    verb: "wait until",
    label: [{ slot: "tool", type: "tool" }, " is available", { slot: "timeoutMs", type: "ms", prefix: ", at most " }],
    create: () => ({ op: "waitForTool", tool: "" }),
  },
  wait: {
    category: "control",
    verb: "wait",
    label: [{ slot: "ms", type: "ms" }],
    create: () => ({ op: "wait", ms: 1000 }),
  },
  message: {
    category: "user",
    verb: "show",
    label: [{ slot: "text", type: "value" }],
    create: () => ({ op: "message", text: { lit: "" } }),
  },
  stop: {
    category: "control",
    verb: "stop",
    label: [{ slot: "message", type: "value" }],
    create: () => ({ op: "stop" }),
  },
  fail: {
    category: "control",
    verb: "fail with",
    label: [{ slot: "message", type: "value" }],
    create: () => ({ op: "fail", message: { lit: "" } }),
  },
};

export const expressions: { [K in ExprKind]: ExprDef<ExprOf<K>> } = {
  lit: { bare: true, label: [{ slot: "lit", type: "literal" }], create: () => ({ lit: null }) },
  input: { bare: true, label: [{ slot: "input", type: "input" }], create: () => ({ input: "" }) },
  var: { bare: true, label: [{ slot: "var", type: "var" }], create: () => ({ var: "" }) },
  get: {
    label: [{ slot: "path", type: "path" }, " of ", { slot: "get", type: "value" }],
    create: () => ({ get: { var: "" }, path: [] }),
  },
  bin: {
    label: [{ slot: "left", type: "value" }, " ", { slot: "bin", type: "binOp" }, " ", { slot: "right", type: "value" }],
    create: () => ({ bin: "==", left: { lit: null }, right: { lit: null } }),
  },
  not: { label: ["not ", { slot: "not", type: "value" }], create: () => ({ not: { lit: false } }) },
  obj: { label: ["{ ", { slot: "obj", type: "args" }, " }"], create: () => ({ obj: {} }) },
  list: { label: ["list ", { slot: "list", type: "items" }], create: () => ({ list: [] }) },
  toolAvailable: {
    label: [{ slot: "toolAvailable", type: "tool" }, " available?"],
    create: () => ({ toolAvailable: "" }),
  },
  call: {
    label: ["result of ", { slot: "call", type: "tool" }, " ", { slot: "args", type: "args" }],
    create: () => ({ call: "", args: {} }),
  },
};

/** A new, empty statement of this kind; a fresh object on every call. */
export function createDefault<O extends StmtOp>(op: O): StmtOf<O> {
  return statements[op].create();
}

/** A new, empty expression of this kind; a fresh object on every call. */
export function createDefaultExpr<K extends ExprKind>(kind: K): ExprOf<K> {
  return expressions[kind].create();
}

function isExprKind(key: string): key is ExprKind {
  return Object.hasOwn(expressions, key);
}

/** The kind of an expression, from the one key that identifies its variant. */
export function exprKind(expr: Expr): ExprKind {
  const kind = Object.keys(expr).find(isExprKind);
  if (kind === undefined) throw new Error(`Unknown expression: ${JSON.stringify(expr)}`);
  return kind;
}

/** The slot's value in `node`, or `undefined` when the optional field is absent. */
export function readSlot(node: Stmt | Expr, slot: Slot): SlotValue | undefined {
  const value: unknown = Reflect.get(node, slot.slot);
  if (value === undefined) return undefined;
  // `SlotOf` admits a slot only for a field whose value has the slot type's
  // value type, so the registry proves what the generic lookup cannot.
  return { type: slot.type, value } as SlotValue;
}
