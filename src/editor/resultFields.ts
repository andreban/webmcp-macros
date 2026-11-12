import type { Expr, Json, JsonSchema, Macro, Stmt } from "../macro/types";

/**
 * Field paths to suggest for a `get`, read from the `outputSchema` snapshots
 * of the macro's tools. Suggestions only: a schema may be missing, stale or
 * wrong, so the editor never restricts a path to them.
 */

const isSchema = (value: unknown): value is JsonSchema => typeof value === "object" && value !== null && !Array.isArray(value);

/** The schema and its `oneOf`/`anyOf` branches, so a success-or-error result offers both sides' fields. */
function branches(schema: JsonSchema): JsonSchema[] {
  const alternatives = [schema.oneOf, schema.anyOf].flatMap((list) => (Array.isArray(list) ? list.filter(isSchema) : []));
  return [schema, ...alternatives.flatMap(branches)];
}

function properties(schema: JsonSchema): Map<string, JsonSchema> {
  const merged = new Map<string, JsonSchema>();
  for (const branch of branches(schema)) {
    if (!isSchema(branch.properties)) continue;
    for (const [key, value] of Object.entries(branch.properties)) {
      if (isSchema(value) && !merged.has(key)) merged.set(key, value);
    }
  }
  return merged;
}

function items(schema: JsonSchema): JsonSchema | undefined {
  return branches(schema).map((branch) => branch.items).find(isSchema);
}

/** The schema of the value at `path` inside a value described by `schema`. */
export function schemaAt(schema: JsonSchema | undefined, path: readonly (string | number)[]): JsonSchema | undefined {
  let current = schema;
  for (const key of path) {
    if (!current) return undefined;
    current = typeof key === "number" ? items(current) : properties(current).get(key);
  }
  return current;
}

/** Dotted paths to the object properties under `schema`, parents first. Arrays are not expanded. */
export function fieldPaths(schema: JsonSchema | undefined, depth = 3): string[] {
  if (!schema || depth === 0) return [];
  return [...properties(schema)].flatMap(([key, child]) => [key, ...fieldPaths(child, depth - 1).map((path) => `${key}.${path}`)]);
}

function* statements(body: readonly Stmt[]): Generator<Stmt> {
  for (const stmt of body) {
    yield stmt;
    if (stmt.op === "if") yield* statements([...stmt.then, ...(stmt.else ?? [])]);
    if ("body" in stmt) yield* statements(stmt.body);
  }
}

/** Result schemas learned from a run, by page tool name, for tools whose page declares no outputSchema. */
export type ObservedSchemas = Readonly<Record<string, JsonSchema>>;

/**
 * The shape of `value` as a schema: object keys, list items (from the first
 * item) and leaf types. Only the shape is kept, never the values, and it is
 * only ever a suggestion, so a list whose items differ is not merged.
 */
export function inferSchema(value: Json, depth = 4): JsonSchema {
  if (Array.isArray(value)) {
    const [first] = value;
    return first === undefined || depth === 0 ? { type: "array" } : { type: "array", items: inferSchema(first, depth - 1) };
  }
  if (value !== null && typeof value === "object") {
    if (depth === 0) return { type: "object" };
    const entries = Object.entries(value).slice(0, 50);
    return { type: "object", properties: Object.fromEntries(entries.map(([key, child]) => [key, inferSchema(child, depth - 1)])) };
  }
  return value === null ? { type: "null" } : { type: typeof value };
}

/** Schemas of the results a run returned, the latest call of each tool winning. */
export function observedSchemas(calls: readonly { tool: string; result: Json }[]): ObservedSchemas {
  return Object.fromEntries(calls.map((call) => [call.tool, inferSchema(call.result)]));
}

/** A tool's declared outputSchema, or else the shape its last result had. */
function toolOutput(macro: Macro, alias: string, observed: ObservedSchemas | undefined): JsonSchema | undefined {
  const tool = Object.hasOwn(macro.tools, alias) ? macro.tools[alias] : undefined;
  if (!tool) return undefined;
  return tool.outputSchema ?? (observed && Object.hasOwn(observed, tool.name) ? observed[tool.name] : undefined);
}

/**
 * The schema of a value: a tool call's result, a variable saved from one, a
 * `for each` variable over a list inside one, or a field of any of these.
 * A variable is traced to the first statement that sets it; `seen` stops
 * `set x = field of x` from looping.
 */
export function valueSchema(
  macro: Macro,
  expr: Expr,
  observed?: ObservedSchemas,
  seen: ReadonlySet<string> = new Set(),
): JsonSchema | undefined {
  if ("call" in expr) return toolOutput(macro, expr.call, observed);
  if ("get" in expr) return schemaAt(valueSchema(macro, expr.get, observed, seen), expr.path);
  if (!("var" in expr) || seen.has(expr.var)) return undefined;
  const name = expr.var;
  const bodies = [macro.program, ...Object.values(macro.procedures ?? {}).map((procedure) => procedure.body)];
  for (const stmt of bodies.flatMap((body) => [...statements(body)])) {
    const inner = new Set([...seen, name]);
    if (stmt.op === "call" && stmt.saveAs === name) return toolOutput(macro, stmt.tool, observed);
    if (stmt.op === "forEach" && stmt.var === name) {
      const list = valueSchema(macro, stmt.list, observed, inner);
      return list && items(list);
    }
    if (stmt.op === "set" && stmt.var === name) return valueSchema(macro, stmt.value, observed, inner);
  }
  return undefined;
}

/** Paths to suggest for the field slot of a `get` whose value is `of`. */
export function resultFields(macro: Macro, of: Expr, observed?: ObservedSchemas): string[] {
  return fieldPaths(valueSchema(macro, of, observed));
}
