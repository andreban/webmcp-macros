// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Macro } from "./macro/types";
import { sampleMacros } from "./samples";
import {
  deleteMacro,
  loadMacros,
  loadRememberedInputs,
  onMacrosChanged,
  rememberInputs,
  saveMacro,
  seedSamples,
} from "./storage";
import { fakeChromeStorage } from "./testing/fakeChromeStorage";

function macro(id: string, overrides: Partial<Macro> = {}): Macro {
  return {
    wmm: 1,
    id,
    name: `Macro ${id}`,
    sites: { s: { match: ["https://example.test/*"] } },
    tools: {},
    trigger: { site: "s", anyOf: [] },
    program: [],
    ...overrides,
  };
}

let fake: ReturnType<typeof fakeChromeStorage>;

beforeEach(() => {
  fake = fakeChromeStorage();
  vi.stubGlobal("chrome", { storage: fake.storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("macros", () => {
  it("loads an empty list when nothing is stored", async () => {
    expect(await loadMacros()).toEqual([]);
  });

  it("appends new macros and replaces one with the same id in place", async () => {
    await saveMacro(macro("a"));
    await saveMacro(macro("b"));
    await saveMacro(macro("a", { name: "Renamed" }));
    expect((await loadMacros()).map((m) => [m.id, m.name])).toEqual([
      ["a", "Renamed"],
      ["b", "Macro b"],
    ]);
  });

  it("skips stored entries that are not valid macros", async () => {
    fake.data.set("macros", JSON.stringify([macro("a"), { id: "broken" }, 42]));
    expect((await loadMacros()).map((m) => m.id)).toEqual(["a"]);
    fake.data.set("macros", JSON.stringify({ not: "a list" }));
    expect(await loadMacros()).toEqual([]);
  });

  it("deletes a macro together with its remembered inputs and presets", async () => {
    await saveMacro(macro("a"));
    await saveMacro(macro("b"));
    fake.data.set("inputs:a", JSON.stringify({ city: "Paris" }));
    fake.data.set("presets:a", JSON.stringify([{ name: "Usual", values: { city: "Rome" } }]));
    fake.data.set("presets:b", JSON.stringify([{ name: "Usual", values: { city: "Oslo" } }]));
    await deleteMacro("a");
    expect((await loadMacros()).map((m) => m.id)).toEqual(["b"]);
    expect(fake.data.has("inputs:a")).toBe(false);
    expect(fake.data.has("presets:a")).toBe(false);
    expect(fake.data.has("presets:b")).toBe(true);
  });
});

describe("seedSamples", () => {
  it("writes the samples when no macros key exists", async () => {
    await seedSamples();
    expect(await loadMacros()).toEqual(sampleMacros);
  });

  it("leaves an existing list alone, even an empty one", async () => {
    fake.data.set("macros", "[]");
    await seedSamples();
    expect(await loadMacros()).toEqual([]);
  });
});

describe("onMacrosChanged", () => {
  it("reports the new list and stops after unsubscribing", async () => {
    const listener = vi.fn();
    const unsubscribe = onMacrosChanged(listener);
    await saveMacro(macro("a"));
    expect(listener).toHaveBeenLastCalledWith([macro("a")]);

    unsubscribe();
    expect(fake.listeners.size).toBe(0);
    await saveMacro(macro("b"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys and other storage areas", () => {
    const listener = vi.fn();
    onMacrosChanged(listener);
    for (const handler of fake.listeners) {
      handler({ "inputs:a": { newValue: {} } }, "local");
      handler({ macros: { newValue: [] } }, "sync");
    }
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("remembered inputs", () => {
  const withInputs = macro("m", {
    inputs: [
      { key: "city", label: "City", schema: { type: "string" }, mode: "remember" },
      { key: "date", label: "Date", schema: { type: "string" }, mode: "ask" },
      { key: "seats", label: "Seats", schema: { type: "number" } },
    ],
  });

  it("stores only inputs in remember mode, outside the macro", async () => {
    await saveMacro(withInputs);
    await rememberInputs(withInputs, { city: "Paris", date: "2026-12-01", seats: 2 });
    expect(await loadRememberedInputs("m")).toEqual({ city: "Paris" });
    expect(await loadMacros()).toEqual([withInputs]);
  });

  it("replaces earlier values and clears the key when nothing is left", async () => {
    await rememberInputs(withInputs, { city: "Paris" });
    await rememberInputs(withInputs, { city: "Rome" });
    expect(await loadRememberedInputs("m")).toEqual({ city: "Rome" });
    await rememberInputs(withInputs, { date: "2026-12-01" });
    expect(fake.data.has("inputs:m")).toBe(false);
  });

  it("returns an empty record for missing or malformed data", async () => {
    expect(await loadRememberedInputs("none")).toEqual({});
    fake.data.set("inputs:m", JSON.stringify(["Paris"]));
    expect(await loadRememberedInputs("m")).toEqual({});
  });
});
