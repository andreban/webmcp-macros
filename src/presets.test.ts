// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MacroInput } from "./macro/types";
import {
  applyPreset,
  deletePreset,
  fitsSchema,
  loadPresets,
  parsePresets,
  renamePreset,
  savePreset,
  withPreset,
  withRenamed,
  withoutPreset,
  type Preset,
} from "./presets";
import { fakeChromeStorage } from "./testing/fakeChromeStorage";

const lisbon: Preset = { name: "Weekend in Lisbon", values: { destination: "LIS" } };
const rome: Preset = { name: "Rome", values: { destination: "FCO" } };

describe("parsePresets", () => {
  it("keeps only well-formed presets", () => {
    expect(parsePresets([lisbon, { name: 1, values: {} }, { name: "x", values: [] }, { name: "y" }, null])).toEqual([lisbon]);
    expect(parsePresets({ name: "x", values: {} })).toEqual([]);
    expect(parsePresets(undefined)).toEqual([]);
  });
});

describe("list updates", () => {
  it("appends a new name and overwrites an existing one in place, trimming names", () => {
    const saved = withPreset(withPreset([lisbon], "Rome", rome.values), " Weekend in Lisbon ", { destination: "OPO" });
    expect(saved).toEqual([{ name: "Weekend in Lisbon", values: { destination: "OPO" } }, rome]);
  });

  it("renames in place, replacing another preset with the new name", () => {
    expect(withRenamed([lisbon, rome], "Rome", " Roma ")).toEqual([lisbon, { ...rome, name: "Roma" }]);
    expect(withRenamed([lisbon, rome], "Rome", "Weekend in Lisbon")).toEqual([{ ...rome, name: "Weekend in Lisbon" }]);
    expect(withRenamed([lisbon], "Missing", "Rome")).toEqual([lisbon]);
  });

  it("deletes by name", () => {
    expect(withoutPreset([lisbon, rome], "Rome")).toEqual([lisbon]);
  });

  it("never mutates its input", () => {
    const presets = Object.freeze([lisbon, rome]);
    withPreset(presets, "New", {});
    withRenamed(presets, "Rome", "Roma");
    withoutPreset(presets, "Rome");
    expect(presets).toEqual([lisbon, rome]);
  });
});

describe("fitsSchema", () => {
  it.each([
    [{ enum: ["a", 2] }, 2, true],
    [{ enum: ["a", 2] }, "2", false],
    [{ type: "boolean" }, false, true],
    [{ type: "boolean" }, "true", false],
    [{ type: "number" }, 1.5, true],
    [{ type: "integer" }, 1.5, false],
    [{ type: "integer" }, 2, true],
    [{ type: "number" }, "2", false],
    [{ type: "string", format: "date" }, "2026-12-01", true],
    [{ type: "string" }, 3, false],
    [{}, null, false],
  ])("%o with %o is %s", (schema, value, fits) => {
    expect(fitsSchema(schema, value)).toBe(fits);
  });
});

describe("applyPreset", () => {
  const inputs: MacroInput[] = [
    { key: "destination", label: "To", schema: { type: "string" } },
    { key: "passengers", label: "Passengers", schema: { type: "integer" } },
    { key: "stops", label: "Stops", schema: { enum: ["Non-stop only", "Up to 1 stop"] } },
    { key: "toString", label: "Odd key", schema: { type: "string" } },
  ];

  it("keeps declared keys whose value still fits and drops the rest", () => {
    const stored = { destination: "LIS", passengers: 2.5, stops: "Any", removed: "x" };
    expect(applyPreset(inputs, stored)).toEqual({ destination: "LIS" });
    expect(applyPreset(inputs, { passengers: 2, stops: "Non-stop only" })).toEqual({ passengers: 2, stops: "Non-stop only" });
  });

  it("ignores keys a stored object only inherits", () => {
    expect(applyPreset(inputs, JSON.parse("{}"))).toEqual({});
  });
});

describe("preset storage", () => {
  let fake: ReturnType<typeof fakeChromeStorage>;

  beforeEach(() => {
    fake = fakeChromeStorage();
    vi.stubGlobal("chrome", { storage: fake.storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves, renames and deletes under presets:<macroId>, returning the new list", async () => {
    expect(await savePreset("m", "Weekend in Lisbon", lisbon.values)).toEqual([lisbon]);
    await savePreset("m", "Rome", rome.values);
    await savePreset("other", "Rome", { destination: "CIA" });
    expect(await renamePreset("m", "Rome", "Roma")).toEqual([lisbon, { ...rome, name: "Roma" }]);
    expect(JSON.parse(fake.data.get("presets:m") ?? "null")).toEqual([lisbon, { ...rome, name: "Roma" }]);
    expect(await deletePreset("m", "Roma")).toEqual([lisbon]);
    expect(await loadPresets("other")).toEqual([{ name: "Rome", values: { destination: "CIA" } }]);
  });

  it("removes the key when the last preset is deleted", async () => {
    await savePreset("m", "Rome", rome.values);
    await deletePreset("m", "Rome");
    expect(fake.data.has("presets:m")).toBe(false);
  });

  it("loads an empty list for missing or malformed data", async () => {
    expect(await loadPresets("m")).toEqual([]);
    fake.data.set("presets:m", JSON.stringify({ not: "a list" }));
    expect(await loadPresets("m")).toEqual([]);
  });
});
