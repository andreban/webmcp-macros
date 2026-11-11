// Editor state: the macro JSON plus undo/redo history, changed only through
// `editorReducer`. Nodes are addressed by paths, so there is no second model.
import type { Expr, Macro, MacroInput, Stmt } from "../macro/types";

/**
 * From the macro root: `["program", 2, "then", 0]` is a statement, `["program", 0, "cond"]`
 * an expression slot. An index equal to a body's length is the position after its end.
 */
export type Path = readonly (string | number)[];

/** What a path points at. Slots can be empty: an optional slot, or the end of a body. */
export type Located =
  | { kind: "body"; node: readonly Stmt[] }
  | { kind: "stmt"; node: Stmt | undefined }
  | { kind: "expr"; node: Expr | undefined };

/** Top-level fields `setMeta` may change; `wmm`, `id` and `program` are not metadata. */
export type MacroMeta = Omit<Macro, "wmm" | "id" | "program">;

export type EditorAction =
  | { type: "insertStmt"; at: Path; stmt: Stmt }
  | { type: "removeStmt"; at: Path }
  /** `to` is a position in the macro as it is before the move. */
  | { type: "moveStmt"; from: Path; to: Path }
  | { type: "replaceNode"; at: Path; node: Stmt | Expr }
  | { type: "setMeta"; meta: Partial<MacroMeta> }
  | { type: "addInput"; input: MacroInput }
  /** Replaces the input at `index`; a new key is renamed in every `{input}` reference. */
  | { type: "updateInput"; index: number; input: MacroInput }
  /** `to` is the input's index after the move. */
  | { type: "moveInput"; from: number; to: number }
  /** Ignored while the program still references the input (see `inputReferences`). */
  | { type: "removeInput"; index: number }
  | { type: "undo" }
  | { type: "redo" };

export interface EditorState {
  readonly macro: Macro;
  /** Earlier macros, oldest first, at most `historyLimit` of them. */
  readonly past: readonly Macro[];
  /** Undone macros, next redo first. */
  readonly future: readonly Macro[];
  readonly historyLimit: number;
}

export const DEFAULT_HISTORY_LIMIT = 100;

export function createEditorState(macro: Macro, historyLimit = DEFAULT_HISTORY_LIMIT): EditorState {
  return { macro, past: [], future: [], historyLimit: Math.max(0, historyLimit) };
}

// `records` holds named expressions (`args`, `obj`); `items` is a list of them.
type Kind = "body" | "stmt" | "expr" | "records" | "items";
type Slots = Readonly<Record<string, Kind>>;

// Typed over every `op`, so a new statement fails the build until its slots are listed.
const STMT_SLOTS: { readonly [K in Stmt["op"]]: Slots } = {
  call: { args: "records" },
  set: { value: "expr" },
  if: { cond: "expr", then: "body", else: "body" },
  repeat: { times: "expr", body: "body" },
  while: { cond: "expr", body: "body" },
  forEach: { list: "expr", body: "body" },
  waitForTool: {},
  wait: {},
  message: { text: "expr" },
  stop: { message: "expr" },
  fail: { message: "expr" },
};

function exprSlots(expr: Expr): Slots {
  if ("get" in expr) return { get: "expr" };
  if ("bin" in expr) return { left: "expr", right: "expr" };
  if ("not" in expr) return { not: "expr" };
  if ("obj" in expr) return { obj: "records" };
  if ("list" in expr) return { list: "items" };
  if ("call" in expr) return { args: "records" };
  return {};
}

const isIndex = (seg: unknown): seg is number => Number.isInteger(seg) && Number(seg) >= 0;

// Own properties only, so keys such as "constructor" never resolve.
const own = (node: object, key: string | number): unknown =>
  Object.hasOwn(node, key) ? Reflect.get(node, key) : undefined;

function childKind(kind: Kind, node: object, seg: string | number): Kind | undefined {
  if (Array.isArray(node)) {
    if (!isIndex(seg) || seg > node.length) return undefined;
    return kind === "body" ? "stmt" : kind === "items" ? "expr" : undefined;
  }
  if (typeof seg !== "string") return undefined;
  if (kind === "records") return "expr";
  // The kind tracked while walking a path tells which type `node` has.
  const slots =
    kind === "stmt" ? STMT_SLOTS[(node as Stmt).op] : kind === "expr" ? exprSlots(node as Expr) : {};
  return Object.hasOwn(slots, seg) ? slots[seg] : undefined;
}

/** Reads the body, statement or expression slot at `path`, or undefined when it names none. */
export function getNode(macro: Macro, path: Path): Located | undefined {
  if (path[0] !== "program") return undefined;
  let kind: Kind = "body";
  let node: unknown = macro.program;
  for (const seg of path.slice(1)) {
    // A missing optional container (`else`, `args`) reads as empty.
    if (node === undefined && kind !== "stmt" && kind !== "expr") node = kind === "records" ? {} : [];
    if (typeof node !== "object" || node === null) return undefined;
    const next = childKind(kind, node, seg);
    if (!next) return undefined;
    kind = next;
    node = own(node, seg);
  }
  // The walk only follows slots the format declares, so `kind` names the node's type.
  if (kind === "body") return { kind, node: (node ?? []) as Stmt[] };
  return kind === "stmt" || kind === "expr" ? ({ kind, node } as Located) : undefined;
}

/** Copies only the containers along `path`; everything else is shared. */
function write(node: unknown, path: Path, value: unknown): unknown {
  const [seg, ...rest] = path;
  if (seg === undefined) return value;
  const container = typeof node === "object" && node !== null ? node : undefined;
  const child = write(container && own(container, seg), rest, value);
  if (typeof seg === "string") return { ...container, [seg]: child };
  const copy: unknown[] = Array.isArray(container) ? [...container] : [];
  copy[seg] = child;
  return copy;
}

// Callers only write paths that `getNode` accepted, with values of the slot's type.
const writeMacro = (macro: Macro, path: Path, value: unknown) => write(macro, path, value) as Macro;

function position(macro: Macro, at: Path) {
  const index = at.at(-1);
  const bodyPath = at.slice(0, -1);
  const found = getNode(macro, bodyPath);
  if (found?.kind !== "body" || !isIndex(index) || index > found.node.length) return undefined;
  return { bodyPath, body: found.node, index };
}

function insertStmt(macro: Macro, at: Path, stmt: Stmt): Macro | undefined {
  const pos = position(macro, at);
  return pos && writeMacro(macro, pos.bodyPath, pos.body.toSpliced(pos.index, 0, stmt));
}

function removeStmt(macro: Macro, at: Path): Macro | undefined {
  const pos = position(macro, at);
  if (!pos || pos.index >= pos.body.length) return undefined;
  return writeMacro(macro, pos.bodyPath, pos.body.toSpliced(pos.index, 1));
}

const startsWith = (path: Path, prefix: Path): boolean =>
  prefix.length <= path.length && prefix.every((seg, i) => path[i] === seg);

/** Where a statement moved from `from` to `to` ends up, since removing it shifts what follows. */
export function moveTarget(from: Path, to: Path): Path {
  const depth = from.length - 1;
  const index = from[depth];
  const toIndex = to[depth];
  if (typeof index !== "number" || typeof toIndex !== "number") return to;
  return startsWith(to, from.slice(0, depth)) && toIndex > index ? to.with(depth, toIndex - 1) : to;
}

function moveStmt(macro: Macro, from: Path, to: Path): Macro | undefined {
  const stmt = getNode(macro, from);
  if (stmt?.kind !== "stmt" || !stmt.node || !position(macro, to)) return undefined;
  if (startsWith(to, from)) return undefined; // into itself or its descendants
  const target = moveTarget(from, to);
  if (target.length === from.length && startsWith(target, from)) return undefined; // same place
  const removed = removeStmt(macro, from);
  return removed && insertStmt(removed, target, stmt.node);
}

function replaceNode(macro: Macro, at: Path, node: Stmt | Expr): Macro | undefined {
  const found = getNode(macro, at);
  if (!found || found.kind === "body" || found.node === node) return undefined;
  // Statements are replaced only where one exists; expressions may fill empty slots.
  const fits = found.kind === "stmt" ? "op" in node && found.node !== undefined : !("op" in node);
  return fits ? writeMacro(macro, at, node) : undefined;
}

function setMeta(macro: Macro, meta: Partial<MacroMeta>): Macro | undefined {
  const same = Object.entries(meta).every(([key, value]) => Object.is(value, Reflect.get(macro, key)));
  return same ? undefined : { ...macro, ...meta };
}

/** Input keys are identifiers, so they read well in blocks and never clash with object internals. */
export const isInputKey = (key: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);

/** Why `key` cannot name the input at `index` (or a new one), or undefined when it can. */
export function inputKeyError(macro: Macro, key: string, index = -1): string | undefined {
  if (!isInputKey(key)) return "Use letters, digits and _, not starting with a digit.";
  const clash = (macro.inputs ?? []).some((input, i) => i !== index && input.key === key);
  return clash ? `Another input is already called "${key}".` : undefined;
}

/** Calls `visit` with the path of every expression under `node`, nested ones included. */
function eachExpr(kind: Kind, node: unknown, path: Path, visit: (path: Path, expr: Expr) => void): void {
  if (typeof node !== "object" || node === null) return;
  if (kind === "expr") visit(path, node as Expr);
  // The slot tables `getNode` uses, so literals are never searched and every path found is writable.
  const slots =
    kind === "stmt" ? STMT_SLOTS[(node as Stmt).op] : kind === "expr" ? exprSlots(node as Expr) : undefined;
  const children: [string | number, Kind][] = slots
    ? Object.entries(slots)
    : Object.keys(node).map((key) => [Array.isArray(node) ? Number(key) : key, kind === "body" ? "stmt" : "expr"]);
  for (const [seg, child] of children) eachExpr(child, own(node, seg), [...path, seg], visit);
}

/** Paths of the `{input: key}` expressions in the program. */
export function inputReferences(macro: Macro, key: string): Path[] {
  const found: Path[] = [];
  eachExpr("body", macro.program, ["program"], (path, expr) => {
    if ("input" in expr && expr.input === key) found.push(path);
  });
  return found;
}

const BODY_SLOTS = new Set(
  Object.values(STMT_SLOTS).flatMap((slots) => Object.keys(slots).filter((slot) => slots[slot] === "body")),
);

/** The statement a path is in, as people count: `["program", 1, "then", 0, "cond"]` reads "step 2 › then 1". */
export function describePath(path: Path): string {
  return path
    .flatMap((seg, i) => {
      const parent = path[i - 1];
      if (typeof seg !== "number" || typeof parent !== "string") return [];
      if (parent === "program" && i === 1) return [`step ${seg + 1}`];
      return BODY_SLOTS.has(parent) ? [`${parent} ${seg + 1}`] : [];
    })
    .join(" › ");
}

function updateInput(macro: Macro, index: number, input: MacroInput): Macro | undefined {
  const inputs = macro.inputs ?? [];
  const old = inputs[index];
  if (!old || old === input) return undefined;
  if (old.key === input.key) return { ...macro, inputs: inputs.with(index, input) };
  if (inputKeyError(macro, input.key, index)) return undefined;
  const renamed = inputReferences(macro, old.key).reduce(
    (next, path) => writeMacro(next, path, { input: input.key }),
    macro,
  );
  return { ...renamed, inputs: inputs.with(index, input) };
}

type InputAction = Extract<EditorAction, { type: "addInput" | "updateInput" | "moveInput" | "removeInput" }>;

function inputAction(macro: Macro, action: InputAction): Macro | undefined {
  const inputs = macro.inputs ?? [];
  switch (action.type) {
    case "addInput":
      return inputKeyError(macro, action.input.key) ? undefined : { ...macro, inputs: [...inputs, action.input] };
    case "updateInput":
      return updateInput(macro, action.index, action.input);
    case "moveInput": {
      const moved = inputs[action.from];
      if (!moved || action.from === action.to || !isIndex(action.to) || action.to >= inputs.length) return undefined;
      return { ...macro, inputs: inputs.toSpliced(action.from, 1).toSpliced(action.to, 0, moved) };
    }
    case "removeInput": {
      const removed = inputs[action.index];
      if (!removed || inputReferences(macro, removed.key).length > 0) return undefined;
      return { ...macro, inputs: inputs.toSpliced(action.index, 1) };
    }
    default:
      throw new Error(`Unknown input action: ${JSON.stringify(action satisfies never)}`);
  }
}

// An edit that does nothing returns the same state, so it adds no history.
function commit(state: EditorState, next: Macro | undefined): EditorState {
  if (!next || next === state.macro) return state;
  const past = [...state.past, state.macro];
  const kept = past.slice(Math.max(0, past.length - state.historyLimit));
  return { ...state, macro: next, past: kept, future: [] };
}

/** Applies `action`. An invalid or ineffective action returns `state` itself. */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const { macro, past, future } = state;
  switch (action.type) {
    case "insertStmt":
      return commit(state, insertStmt(macro, action.at, action.stmt));
    case "removeStmt":
      return commit(state, removeStmt(macro, action.at));
    case "moveStmt":
      return commit(state, moveStmt(macro, action.from, action.to));
    case "replaceNode":
      return commit(state, replaceNode(macro, action.at, action.node));
    case "setMeta":
      return commit(state, setMeta(macro, action.meta));
    case "addInput":
    case "updateInput":
    case "moveInput":
    case "removeInput":
      return commit(state, inputAction(macro, action));
    case "undo": {
      const previous = past.at(-1);
      if (!previous) return state;
      return { ...state, macro: previous, past: past.slice(0, -1), future: [macro, ...future] };
    }
    case "redo": {
      const [next, ...rest] = future;
      return next ? { ...state, macro: next, past: [...past, macro], future: rest } : state;
    }
    default:
      throw new Error(`Unknown editor action: ${JSON.stringify(action satisfies never)}`);
  }
}
