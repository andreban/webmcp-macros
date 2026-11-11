/**
 * The macro format. A macro is plain JSON: the editor renders it, the runner
 * interprets it, and the share string encodes it. There is no other
 * representation.
 */

export const MACRO_VERSION = 1;

/** A JSON Schema fragment. Kept loose on purpose; sites define these. */
export type JsonSchema = Record<string, unknown>;

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export interface MacroSite {
  /** URL patterns: `*` matches any run of characters. */
  match: string[];
  /** Where to open the site when no matching tab exists (cross-site runs). */
  startUrl?: string;
}

export interface MacroTool {
  /** Key into `Macro.sites`. */
  site: string;
  /** The tool's registered name on the page. */
  name: string;
  /** Hash of the tool's inputSchema when the macro was authored. */
  schemaHash?: string;
}

export interface MacroTrigger {
  site: string;
  /** Sets of tool aliases. The macro is offered when any one set is present. */
  anyOf: string[][];
}

export interface MacroInput {
  key: string;
  label: string;
  schema: JsonSchema;
  /** ask: always empty. remember: pre-filled with the last value used. */
  mode?: "ask" | "remember";
  default?: Json;
}

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "and"
  | "or";

/** Expressions produce a value and, apart from `call`, have no side effects. */
export type Expr =
  | { lit: Json }
  | { input: string }
  | { var: string }
  | { get: Expr; path: (string | number)[] }
  | { bin: BinaryOp; left: Expr; right: Expr }
  | { not: Expr }
  | { obj: Record<string, Expr> }
  | { list: Expr[] }
  | { toolAvailable: string }
  | { call: string; args?: Record<string, Expr> };

export type Stmt =
  | { op: "call"; tool: string; args?: Record<string, Expr>; saveAs?: string }
  | { op: "set"; var: string; value: Expr }
  | { op: "if"; cond: Expr; then: Stmt[]; else?: Stmt[] }
  | { op: "repeat"; times: Expr; body: Stmt[] }
  | { op: "while"; cond: Expr; body: Stmt[] }
  | { op: "forEach"; list: Expr; var: string; body: Stmt[] }
  | { op: "waitForTool"; tool: string; timeoutMs?: number }
  | { op: "wait"; ms: number }
  | { op: "message"; text: Expr }
  | { op: "stop"; message?: Expr }
  | { op: "fail"; message: Expr };

export interface Macro {
  wmm: typeof MACRO_VERSION;
  id: string;
  name: string;
  description?: string;
  sites: Record<string, MacroSite>;
  tools: Record<string, MacroTool>;
  trigger: MacroTrigger;
  inputs?: MacroInput[];
  program: Stmt[];
}

/** A tool as reported by a page, reduced to what crosses message channels. */
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
  annotations?: Record<string, boolean>;
}

export function isMacro(value: unknown): value is Macro {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Partial<Macro>;
  return (
    m.wmm === MACRO_VERSION &&
    typeof m.id === "string" &&
    typeof m.name === "string" &&
    typeof m.sites === "object" &&
    m.sites !== null &&
    typeof m.tools === "object" &&
    m.tools !== null &&
    typeof m.trigger === "object" &&
    m.trigger !== null &&
    Array.isArray(m.trigger.anyOf) &&
    Array.isArray(m.program)
  );
}
