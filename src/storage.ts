/**
 * Saved macros and remembered inputs, in `chrome.storage.local`. Remembered
 * inputs are personal data: they are kept under their own key per macro and
 * never written into a macro, so they never reach a share string.
 */
import { isMacro, type Json, type Macro } from "./macro/types";
import { sampleMacros } from "./samples";

const MACROS_KEY = "macros";
const inputsKey = (macroId: string) => `inputs:${macroId}`;

/**
 * Storage can hold anything another version of the extension wrote, so keep
 * only entries that are valid macros.
 */
function parseMacros(stored: unknown): Macro[] {
  return Array.isArray(stored) ? stored.filter(isMacro) : [];
}

/** All saved macros, in save order. Invalid stored entries are skipped. */
export async function loadMacros(): Promise<Macro[]> {
  const stored = await chrome.storage.local.get(MACROS_KEY);
  return parseMacros(stored[MACROS_KEY]);
}

/**
 * Saves `macro`, replacing the saved macro with the same id or appending it.
 * This is a read-modify-write: concurrent saves from different extension
 * contexts can overwrite each other.
 */
export async function saveMacro(macro: Macro): Promise<void> {
  const macros = await loadMacros();
  const replaced = macros.some((existing) => existing.id === macro.id);
  const next = replaced ? macros.map((existing) => (existing.id === macro.id ? macro : existing)) : [...macros, macro];
  await chrome.storage.local.set({ [MACROS_KEY]: next });
}

/** Deletes the macro with `macroId` and its remembered inputs. */
export async function deleteMacro(macroId: string): Promise<void> {
  const macros = await loadMacros();
  await chrome.storage.local.set({ [MACROS_KEY]: macros.filter((macro) => macro.id !== macroId) });
  await chrome.storage.local.remove(inputsKey(macroId));
}

/**
 * Installs the bundled samples when no macro list exists yet. An empty list
 * means the user deleted them, so it is left alone.
 */
export async function seedSamples(): Promise<void> {
  const stored = await chrome.storage.local.get(MACROS_KEY);
  if (!(MACROS_KEY in stored)) await chrome.storage.local.set({ [MACROS_KEY]: [...sampleMacros] });
}

/**
 * Calls `listener` with the full macro list whenever it changes in any
 * extension context. Returns a function that unsubscribes.
 */
export function onMacrosChanged(listener: (macros: Macro[]) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: chrome.storage.AreaName) => {
    const change = changes[MACROS_KEY];
    if (area === "local" && change) listener(parseMacros(change.newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/**
 * The last values used for the macro's inputs in `remember` mode, by input
 * key. Empty when nothing is remembered.
 */
export async function loadRememberedInputs(macroId: string): Promise<Record<string, Json>> {
  const key = inputsKey(macroId);
  const stored: Record<string, unknown> = await chrome.storage.local.get(key);
  const value = stored[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  // chrome.storage round-trips values through JSON, so a plain object read
  // back from it holds only JSON values.
  return value as Record<string, Json>;
}

/**
 * Stores the values of the macro's `remember` inputs from `values`, replacing
 * what was remembered before. Values of `ask` inputs are never stored.
 */
export async function rememberInputs(macro: Macro, values: Record<string, Json>): Promise<void> {
  const remembered: Record<string, Json> = {};
  for (const input of macro.inputs ?? []) {
    const value = values[input.key];
    if (input.mode === "remember" && value !== undefined) remembered[input.key] = value;
  }
  const key = inputsKey(macro.id);
  if (Object.keys(remembered).length === 0) await chrome.storage.local.remove(key);
  else await chrome.storage.local.set({ [key]: remembered });
}
