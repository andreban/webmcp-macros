import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRelativeDate } from "../macro/relativeDate";
import { MACRO_VERSION, type Macro, type MacroInput } from "../macro/types";
import { flightSearchMacro as flightSearch } from "../samples/flightSearch";
import { coerceValues, fieldFor, fillFromPreset, initialValues, InputFormView, presetValues } from "./InputForm";

describe("fieldFor", () => {
  it("maps each schema shape to its field", () => {
    expect(fieldFor({ type: "string", enum: ["a", 1, { x: 1 }] })).toEqual({ kind: "select", options: ["a", 1] });
    expect(fieldFor({ type: "boolean" })).toEqual({ kind: "checkbox" });
    expect(fieldFor({ type: "integer", minimum: 1, maximum: "9" })).toEqual({
      kind: "number",
      min: 1,
      max: undefined,
      integer: true,
    });
    expect(fieldFor({ type: "number" })).toMatchObject({ kind: "number", integer: false });
    expect(fieldFor({ type: "string", format: "date" })).toEqual({ kind: "date" });
    expect(fieldFor({ type: "string", pattern: "^[A-Z]{3}$" })).toEqual({ kind: "text", pattern: "^[A-Z]{3}$" });
    expect(fieldFor({})).toEqual({ kind: "text", pattern: undefined });
  });
});

describe("initialValues", () => {
  const inputs: MacroInput[] = [
    { key: "kept", label: "Kept", schema: { type: "number" }, mode: "remember", default: 1 },
    { key: "fresh", label: "Fresh", schema: { type: "string" }, mode: "remember", default: "d" },
    { key: "asked", label: "Asked", schema: { type: "string" }, mode: "ask", default: "NYC" },
    { key: "empty", label: "Empty", schema: { type: "string" } },
    { key: "flag", label: "Flag", schema: { type: "boolean" }, default: true },
    { key: "stale", label: "Stale", schema: { type: "string" }, mode: "remember" },
  ];

  it("prefers remembered values, then defaults, then empty", () => {
    const remembered = { kept: 4, asked: "SFO", stale: { old: true } };
    expect(initialValues(inputs, remembered)).toEqual({
      kept: "4",
      fresh: "d",
      // Remembered values only apply to `remember` inputs.
      asked: "NYC",
      empty: "",
      flag: true,
      // A remembered value of the wrong shape falls back to empty.
      stale: "",
    });
  });
});

describe("coerceValues", () => {
  const inputs: MacroInput[] = [
    { key: "n", label: "N", schema: { type: "integer" } },
    { key: "price", label: "Price", schema: { type: "number" } },
    { key: "size", label: "Size", schema: { enum: ["S", 2] } },
    { key: "on", label: "On", schema: { type: "boolean" } },
    { key: "day", label: "Day", schema: { type: "string", format: "date" } },
  ];
  const valid = { n: "3", price: "9.5", size: "2", on: true, day: "2026-12-01" };

  it("types numbers as numbers and enum options as their JSON value", () => {
    expect(coerceValues(inputs, valid)).toEqual({
      ok: true,
      values: { n: 3, price: 9.5, size: 2, on: true, day: "2026-12-01" },
    });
  });

  it("treats an unchecked or missing checkbox as false", () => {
    const result = coerceValues(inputs, { ...valid, on: false });
    expect(result.ok && result.values.on).toBe(false);
  });

  it.each([
    [{ day: "" }, "day", "Day: required"],
    [{ n: "abc" }, "n", "N: not a number"],
    [{ n: "1.5" }, "n", "N: not a whole number"],
    [{ size: "XL" }, "size", "Size: not one of the options"],
  ])("rejects %o", (change, key, error) => {
    expect(coerceValues(inputs, { ...valid, ...change })).toEqual({ ok: false, key, error });
  });
});

describe("presets in the form", () => {
  const inputs: MacroInput[] = [
    { key: "to", label: "To", schema: { type: "string" } },
    { key: "seats", label: "Seats", schema: { type: "integer" } },
    { key: "day", label: "Day", schema: { type: "string", format: "date" } },
    { key: "flexible", label: "Flexible", schema: { type: "boolean" } },
  ];

  it("saves only fields that are valid on their own, typed", () => {
    expect(presetValues(inputs, { to: "LIS", seats: "1.5", day: "", flexible: true })).toEqual({ to: "LIS", flexible: true });
  });

  it("fills held fields from a preset and keeps the others", () => {
    const current = { to: "NYC", seats: "1", day: "2026-12-01", flexible: false };
    const stored = { to: "LIS", seats: 2, flexible: true, day: 20261201, gone: "x" };
    expect(fillFromPreset(inputs, current, stored)).toEqual({ to: "LIS", seats: "2", day: "2026-12-01", flexible: true });
  });
});

describe("relative dates in the form", () => {
  const inputs: MacroInput[] = [
    { key: "out", label: "Out", schema: { type: "string", format: "date" }, default: "today+14d" },
    { key: "fixed", label: "Fixed", schema: { type: "string", format: "date" }, default: "2026-12-24" },
    { key: "text", label: "Text", schema: { type: "string" }, default: "today+1d" },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 31, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves relative date defaults when the form opens and leaves other values alone", () => {
    expect(initialValues(inputs, {})).toEqual({ out: "2026-02-14", fixed: "2026-12-24", text: "today+1d" });
  });

  it("resolves a relative date held by a preset", () => {
    const current = { out: "2026-02-14", fixed: "2026-12-24", text: "x" };
    expect(fillFromPreset(inputs, current, { out: "today+1m", fixed: "today" })).toEqual({
      out: "2026-02-28",
      fixed: "2026-01-31",
      text: "x",
    });
  });
});

describe("InputFormView", () => {
  const macro: Macro = {
    ...flightSearch,
    inputs: [
      ...(flightSearch.inputs ?? []),
      { key: "flexible", label: "Flexible dates", schema: { type: "boolean" } },
    ],
  };
  const html = renderToStaticMarkup(
    <InputFormView macro={macro} remembered={{ origin: "SFO" }} submitLabel="Run" onSubmit={() => {}} onCancel={() => {}} />,
  );
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** The control a label points at, as its tag name and attributes. */
  const control = (label: string) => {
    const forId = new RegExp(`<label for="([^"]+)">${escape(label)}</label>`).exec(html)?.[1];
    expect(forId, `label ${label}`).toBeDefined();
    const match = new RegExp(`<(input|select) ([^>]*id="${escape(forId ?? "")}"[^>]*?)/?>`).exec(html);
    expect(match, `control for ${label}`).not.toBeNull();
    const attrs = Object.fromEntries([...(match?.[2] ?? "").matchAll(/([a-z]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    return { tag: match?.[1], ...attrs };
  };

  it("gives every input a visible label tied to its control", () => {
    for (const input of macro.inputs ?? []) control(input.label);
  });

  it("chooses the control from the schema", () => {
    expect(control("Stops")).toMatchObject({ tag: "select", required: "" });
    expect(html).toContain('<option value="">Choose…</option>');
    expect(html).toContain('<option value="Up to 1 stop" selected="">');
    expect(control("Passengers")).toMatchObject({ type: "number", value: "1", min: "1", step: "any", required: "" });
    expect(control("Depart")).toMatchObject({ type: "date", value: resolveRelativeDate("today+14d"), required: "" });
    expect(control("Return")).toMatchObject({ type: "date", value: resolveRelativeDate("today+21d") });
    expect(control("To (IATA)")).toMatchObject({ type: "text", value: "NYC", pattern: "^[A-Z]{3}$", required: "" });
    expect(control("Flexible dates")).toMatchObject({ type: "checkbox" });
    expect(control("Flexible dates")).not.toHaveProperty("required");
  });

  it("pre-fills remembered values over defaults", () => {
    expect(control("From (IATA)")).toMatchObject({ value: "SFO" });
  });

  it("offers presets above the fields without making the name field required", () => {
    expect(html).toMatch(/^<form class="wmm-form"><fieldset class="wmm-presets"><legend>Presets<\/legend>/);
    expect(control("Preset name")).toMatchObject({ type: "text" });
    expect(control("Preset name")).not.toHaveProperty("required");
    expect(html).not.toMatch(/<button(?![^>]*type="button")[^>]*>(Save values|Rename|Delete)</);
  });

  it("renders the submit and cancel actions", () => {
    expect(html).toMatch(/<div class="wmm-actions"><button type="button" class="wmm-secondary">Cancel<\/button><button type="submit">Run<\/button><\/div>/);
    expect(html).toMatch(/^<form class="wmm-form">/);
  });
});

describe("InputFormView with no inputs", () => {
  it("renders only the actions", () => {
    const macro: Macro = {
      wmm: MACRO_VERSION,
      id: "x",
      name: "X",
      sites: {},
      tools: {},
      trigger: { site: "s", anyOf: [] },
      program: [],
    };
    const html = renderToStaticMarkup(<InputFormView macro={macro} remembered={{}} submitLabel="Go" onSubmit={() => {}} />);
    expect(html).toBe('<form class="wmm-form"><div class="wmm-actions"><button type="submit">Go</button></div></form>');
  });
});
