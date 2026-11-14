// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/** Test helper: an in-memory `chrome.storage` that round-trips values through JSON, as Chrome does. */

export type ChangeListener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;

export function fakeChromeStorage() {
  const data = new Map<string, string>();
  const listeners = new Set<ChangeListener>();
  const read = (key: string): unknown => {
    const raw = data.get(key);
    return raw === undefined ? undefined : JSON.parse(raw);
  };
  const notify = (key: string, oldValue: unknown, newValue: unknown) => {
    for (const listener of listeners) listener({ [key]: { oldValue, newValue } }, "local");
  };
  return {
    data,
    listeners,
    storage: {
      local: {
        async get(key: string) {
          return data.has(key) ? { [key]: read(key) } : {};
        },
        async set(items: Record<string, unknown>) {
          for (const [key, value] of Object.entries(items)) {
            const oldValue = read(key);
            data.set(key, JSON.stringify(value));
            notify(key, oldValue, read(key));
          }
        },
        async remove(keys: string | string[]) {
          for (const key of typeof keys === "string" ? [keys] : keys) {
            const oldValue = read(key);
            if (data.delete(key)) notify(key, oldValue, undefined);
          }
        },
      },
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.add(listener),
        removeListener: (listener: ChangeListener) => listeners.delete(listener),
      },
    },
  };
}
