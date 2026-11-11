import type { Expr } from "../macro/types";

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
