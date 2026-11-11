/**
 * Presets: named sets of input values for one macro, such as "Weekend in
 * Lisbon". They are personal data, so they live in `chrome.storage.local`
 * under `presets:<macroId>` and never in the macro or its share string.
 */
import type { Json, JsonSchema, MacroInput } from "./macro/types";

export interface Preset {
  name: string;
  /** Typed input values by input key. A preset may hold only some of the inputs. */
  values: Record<string, Json>;
}

export const presetsKey = (macroId: string) => `presets:${macroId}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isPreset(value: unknown): value is Preset {
  return isRecord(value) && typeof value.name === "string" && isRecord(value.values);
}

/** Storage can hold anything another version wrote, so keep only well-formed presets. */
export function parsePresets(stored: unknown): Preset[] {
  return Array.isArray(stored) ? stored.filter(isPreset) : [];
}

/** Adds a preset, or replaces the values of the one with the same (trimmed) name in place. */
export function withPreset(presets: readonly Preset[], name: string, values: Record<string, Json>): Preset[] {
  const preset = { name: name.trim(), values };
  const replaced = presets.some((existing) => existing.name === preset.name);
  return replaced ? presets.map((existing) => (existing.name === preset.name ? preset : existing)) : [...presets, preset];
}

/**
 * Renames `from` to `to`, keeping its position. Like saving, a name is unique:
 * another preset already called `to` is replaced.
 */
export function withRenamed(presets: readonly Preset[], from: string, to: string): Preset[] {
  const name = to.trim();
  if (!presets.some((preset) => preset.name === from)) return [...presets];
  return presets
    .filter((preset) => preset.name === from || preset.name !== name)
    .map((preset) => (preset.name === from ? { ...preset, name } : preset));
}

export function withoutPreset(presets: readonly Preset[], name: string): Preset[] {
  return presets.filter((preset) => preset.name !== name);
}

/**
 * Whether a stored value can still fill an input with this schema. Follows the
 * same order as the form's field choice (`fieldFor` in `src/ui/InputForm.tsx`):
 * enum, boolean, number, then string.
 */
export function fitsSchema(schema: JsonSchema, value: Json): boolean {
  if (Array.isArray(schema.enum)) return schema.enum.some((option) => option === value);
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "number" || schema.type === "integer") {
    return typeof value === "number" && Number.isFinite(value) && (schema.type === "number" || Number.isInteger(value));
  }
  return typeof value === "string";
}

/**
 * The preset's values that still apply to the macro's inputs. A preset can
 * outlive edits to the macro, so keys it no longer declares and values that no
 * longer fit their input's schema are dropped.
 */
export function applyPreset(inputs: MacroInput[], values: Record<string, Json>): Record<string, Json> {
  const applied: Record<string, Json> = {};
  for (const input of inputs) {
    // `hasOwn`, because a stored object still inherits keys such as `toString`.
    const value = Object.hasOwn(values, input.key) ? values[input.key] : undefined;
    if (value !== undefined && fitsSchema(input.schema, value)) applied[input.key] = value;
  }
  return applied;
}

/** The macro's presets, in save order. */
export async function loadPresets(macroId: string): Promise<Preset[]> {
  const key = presetsKey(macroId);
  const stored: Record<string, unknown> = await chrome.storage.local.get(key);
  return parsePresets(stored[key]);
}

/**
 * Read-modify-write of the macro's presets; returns the new list. Concurrent
 * writes from different extension contexts can overwrite each other.
 */
async function updatePresets(macroId: string, change: (presets: Preset[]) => Preset[]): Promise<Preset[]> {
  const next = change(await loadPresets(macroId));
  if (next.length === 0) await chrome.storage.local.remove(presetsKey(macroId));
  else await chrome.storage.local.set({ [presetsKey(macroId)]: next });
  return next;
}

export const savePreset = (macroId: string, name: string, values: Record<string, Json>) =>
  updatePresets(macroId, (presets) => withPreset(presets, name, values));

export const renamePreset = (macroId: string, from: string, to: string) =>
  updatePresets(macroId, (presets) => withRenamed(presets, from, to));

export const deletePreset = (macroId: string, name: string) =>
  updatePresets(macroId, (presets) => withoutPreset(presets, name));
