/**
 * Whether a site's tools still fit a macro. Sites change their tool schemas
 * without notice; a macro is checked against the tools the page registers now
 * before it is offered. Pure: no `chrome.*`, no DOM.
 */
import { canonical, crc32Hex } from "./codec";
import type { JsonSchema, Macro, ToolInfo } from "./types";

/** A short hash of a tool's inputSchema, equal for schemas that differ only in key order. */
export function schemaHash(schema: JsonSchema | undefined): string {
  return crc32Hex(new TextEncoder().encode(JSON.stringify(canonical(schema ?? {}))));
}

/** Why one argument the macro passes no longer fits the tool. */
export interface CompatProblem {
  /** The macro's alias for the tool. */
  alias: string;
  arg: string;
  /** `missing`: the schema no longer has the property. `type`: the property's type changed. */
  reason: "missing" | "type";
}

/**
 * `ok`: nothing changed, or no recorded hash to compare. `changed`: a schema
 * hash differs but every argument still fits, so the macro runs with a
 * warning. `incompatible`: the macro must be updated in the editor first.
 */
export type Compatibility =
  | { status: "ok" }
  | { status: "changed"; aliases: string[] }
  | { status: "incompatible"; problems: CompatProblem[] };

const VALUE_TYPES = ["null", "boolean", "number", "string", "array", "object"] as const;
type ValueType = (typeof VALUE_TYPES)[number];

const isValueType = (value: unknown): value is ValueType => VALUE_TYPES.some((type) => type === value);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeOfValue(value: unknown): ValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  return isValueType(type) ? type : "object";
}

/** The types a schema's `type` keyword allows, with `integer` read as `number`: a whole-number check is about values, not shape. */
function schemaTypes(schema: unknown): ValueType[] | null {
  if (!isRecord(schema)) return null;
  const declared = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type : null;
  if (!declared) return null;
  return declared.flatMap((type: unknown): ValueType[] => (type === "integer" ? ["number"] : isValueType(type) ? [type] : []));
}

/** The type an argument expression produces when it can be told without running the macro. */
function exprType(macro: Macro, expr: unknown): ValueType | null {
  if (!isRecord(expr)) return null;
  if ("lit" in expr) return typeOfValue(expr.lit);
  if ("obj" in expr) return "object";
  if ("list" in expr) return "array";
  if ("not" in expr) return "boolean";
  if (typeof expr.input === "string") {
    const input = macro.inputs?.find((candidate) => candidate.key === expr.input);
    const types = schemaTypes(input?.schema);
    return types?.length === 1 ? (types[0] ?? null) : null;
  }
  return null;
}

/**
 * Every call's arguments by tool alias, from the program and the procedures.
 * The walk is generic over the JSON so new statements are covered without a
 * change here; `lit` values are user data, never code, so they are skipped.
 */
function callArgs(macro: Macro): Map<string, Record<string, unknown>[]> {
  const found = new Map<string, Record<string, unknown>[]>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isRecord(node) || "lit" in node) return;
    const alias = node.op === "call" ? node.tool : node.call;
    if (typeof alias === "string" && isRecord(node.args)) found.set(alias, [...(found.get(alias) ?? []), node.args]);
    Object.values(node).forEach(visit);
  };
  visit(macro.program);
  visit(macro.procedures ?? {});
  return found;
}

/**
 * Checks the macro's trigger-site tools against `tools`, the page's tools now.
 * A tool the page does not register is skipped: tools come and go, and the
 * runner waits for them. So are tools pinned to an iframe's origin, since
 * `tools` lists the top frame only. A tool whose inputSchema declares no
 * `properties` cannot be checked and counts as compatible.
 */
export function checkCompatibility(macro: Macro, tools: readonly ToolInfo[]): Compatibility {
  const live = new Map(tools.map((tool) => [tool.name, tool]));
  const args = callArgs(macro);
  const problems: CompatProblem[] = [];
  const changed: string[] = [];
  for (const [alias, entry] of Object.entries(macro.tools)) {
    const tool = live.get(entry.name);
    if (entry.site !== macro.trigger.site || entry.frameOrigin !== undefined || !tool?.inputSchema) continue;
    if (entry.schemaHash !== undefined && entry.schemaHash !== schemaHash(tool.inputSchema)) changed.push(alias);
    const properties = tool.inputSchema.properties;
    if (!isRecord(properties)) continue;
    for (const call of args.get(alias) ?? []) {
      for (const [arg, expr] of Object.entries(call)) {
        if (problems.some((problem) => problem.alias === alias && problem.arg === arg)) continue;
        if (!Object.hasOwn(properties, arg)) {
          problems.push({ alias, arg, reason: "missing" });
          continue;
        }
        const expected = schemaTypes(properties[arg]);
        const actual = exprType(macro, expr);
        if (expected && actual && !expected.includes(actual)) problems.push({ alias, arg, reason: "type" });
      }
    }
  }
  if (problems.length > 0) return { status: "incompatible", problems };
  return changed.length > 0 ? { status: "changed", aliases: changed } : { status: "ok" };
}
