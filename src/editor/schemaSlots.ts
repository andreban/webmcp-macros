import type { Expr, Macro } from "../macro/types";
import type { LiteralType } from "./ExprPicker";

/**
 * Argument slots for a call block, read from a tool's `inputSchema`. The
 * schema comes from the page, so every field is checked before it is used and
 * anything unrecognised becomes an untyped slot rather than an error.
 *
 * Pure: no React, no `chrome.*`.
 */

/** A value an `enum` dropdown can show and a literal can hold. */
export type EnumOption = string | number | boolean | null;

/** What an argument slot edits. The non-enum types match `LiteralType`, so a slot can pass them on. */
export type ArgKind =
  | { type: "enum"; options: EnumOption[] }
  | { type: "text" }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "list"; items: ArgKind }
  | { type: "object"; fields: ArgSlot[] }
  | { type: "any" };

export interface ArgSlot {
  key: string;
  /** Required slots are shown on the block; optional ones are added with "+". */
  required: boolean;
  description?: string;
  kind: ArgKind;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isEnumOption = (value: unknown): value is EnumOption =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

/** The schema's type, the first non-null one when it lists several (`["string", "null"]`). */
function schemaType(schema: Record<string, unknown>): string | undefined {
  const { type } = schema;
  if (typeof type === "string") return type;
  if (Array.isArray(type)) return type.find((name): name is string => typeof name === "string" && name !== "null");
  return isRecord(schema.properties) ? "object" : undefined;
}

/** The slot kind for one property schema. */
export function argKind(schema: unknown): ArgKind {
  if (!isRecord(schema)) return { type: "any" };
  const options = Array.isArray(schema.enum) ? schema.enum : "const" in schema ? [schema.const] : undefined;
  if (options && options.length > 0 && options.every(isEnumOption)) return { type: "enum", options };
  switch (schemaType(schema)) {
    case "string":
      return { type: "text" };
    case "number":
    case "integer":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "array":
      return { type: "list", items: argKind(schema.items) };
    case "object":
      return { type: "object", fields: schemaSlots(schema) };
    default:
      return { type: "any" };
  }
}

/** One slot per property of an object schema, in the schema's order. A schema without properties has none. */
export function schemaSlots(schema: unknown): ArgSlot[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) return [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(schema.properties).map(([key, property]) => {
    const slot: ArgSlot = { key, required: required.includes(key), kind: argKind(property) };
    if (isRecord(property) && typeof property.description === "string") slot.description = property.description;
    return slot;
  });
}

/** A starting value of the slot's kind: the first enum option, an empty text, zero, and so on. */
export function defaultArg(kind: ArgKind): Expr {
  switch (kind.type) {
    case "enum":
      return { lit: kind.options[0] ?? null };
    case "text":
      return { lit: "" };
    case "number":
      return { lit: 0 };
    case "boolean":
      return { lit: false };
    case "list":
      return { list: [] };
    case "object":
      return { obj: requiredArgs(kind.fields) };
    case "any":
      return { lit: null };
    default:
      throw new Error(`Unknown argument kind: ${JSON.stringify(kind satisfies never)}`);
  }
}

/** The arguments a new call block starts with: every required slot, at its default. */
export function requiredArgs(slots: readonly ArgSlot[]): Record<string, Expr> {
  return Object.fromEntries(slots.filter((slot) => slot.required).map((slot) => [slot.key, defaultArg(slot.kind)]));
}

/**
 * The argument slots of a call to `alias`, from the schema saved in the macro.
 * `undefined` when the tool is unknown or has no saved schema: the editor then
 * edits the arguments as a free-form record.
 */
export function toolArgSlots(macro: Macro, alias: string): ArgSlot[] | undefined {
  const schema = Object.hasOwn(macro.tools, alias) ? macro.tools[alias]?.inputSchema : undefined;
  return schema === undefined ? undefined : schemaSlots(schema);
}

/** The schema's arguments that `args` does not set yet, in the schema's order: the keys to offer. */
export function missingArgs(slots: readonly ArgSlot[], args: Readonly<Record<string, Expr>>): ArgSlot[] {
  return slots.filter((slot) => !Object.hasOwn(args, slot.key));
}

/**
 * What a newly added argument starts as: its schema default for a key the
 * schema knows, null for any other key (which stays allowed, so a macro written
 * against an older schema can be fixed by hand).
 */
export function newArg(slots: readonly ArgSlot[] | undefined, key: string): Expr {
  const slot = slots?.find((candidate) => candidate.key === key);
  return slot ? defaultArg(slot.kind) : { lit: null };
}

/** How a literal in a slot of this kind is typed and shown; enums and untyped slots take any value. */
export function literalType(kind: ArgKind): LiteralType {
  switch (kind.type) {
    case "enum":
    case "any":
      return "any";
    case "text":
    case "number":
    case "boolean":
    case "list":
    case "object":
      return kind.type;
    default:
      throw new Error(`Unknown argument kind: ${JSON.stringify(kind satisfies never)}`);
  }
}
