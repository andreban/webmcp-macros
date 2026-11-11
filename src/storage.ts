/** Macros and remembered inputs live in chrome.storage.local. */
import type { Json, Macro } from "./macro/types";
import { sampleMacros } from "./samples";

const MACROS_KEY = "macros";
const inputsKey = (macroId: string) => `inputs:${macroId}`;

export async function loadMacros(): Promise<Macro[]> {
  const stored = await chrome.storage.local.get(MACROS_KEY);
  return (stored[MACROS_KEY] as Macro[] | undefined) ?? [];
}

export async function saveMacro(macro: Macro): Promise<void> {
  const macros = await loadMacros();
  const index = macros.findIndex((existing) => existing.id === macro.id);
  if (index >= 0) macros[index] = macro;
  else macros.push(macro);
  await chrome.storage.local.set({ [MACROS_KEY]: macros });
}

export async function deleteMacro(macroId: string): Promise<void> {
  const macros = (await loadMacros()).filter((macro) => macro.id !== macroId);
  await chrome.storage.local.set({ [MACROS_KEY]: macros });
  await chrome.storage.local.remove(inputsKey(macroId));
}

/** Installs the bundled samples once, on first install. */
export async function seedSamples(): Promise<void> {
  const stored = await chrome.storage.local.get(MACROS_KEY);
  if (stored[MACROS_KEY] === undefined) await chrome.storage.local.set({ [MACROS_KEY]: sampleMacros });
}

export function onMacrosChanged(listener: (macros: Macro[]) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[MACROS_KEY]) listener((changes[MACROS_KEY].newValue as Macro[] | undefined) ?? []);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/** Last-used values for inputs in "remember" mode. Never part of a shared macro. */
export async function loadRememberedInputs(macroId: string): Promise<Record<string, Json>> {
  const stored = await chrome.storage.local.get(inputsKey(macroId));
  return (stored[inputsKey(macroId)] as Record<string, Json> | undefined) ?? {};
}

export async function rememberInputs(macro: Macro, values: Record<string, Json>): Promise<void> {
  const remembered: Record<string, Json> = {};
  for (const input of macro.inputs ?? []) {
    const value = values[input.key];
    if (input.mode === "remember" && value !== undefined) remembered[input.key] = value;
  }
  await chrome.storage.local.set({ [inputsKey(macro.id)]: remembered });
}
