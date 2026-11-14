// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Macro } from "../macro/types";
import { flightSearchMacro, rocketLauncherMacro } from "../samples";
import { InputFormView } from "../ui/InputForm";
import { InputsPanel, inputType, newInput, parseDefault, parseOptions, removeBlocker, schemaFor } from "./InputsPanel";
import { createEditorState, editorReducer } from "./state";

const render = (macro: Macro) => renderToStaticMarkup(<InputsPanel macro={macro} dispatch={() => {}} />);

describe("input types", () => {
  it.each(["text", "number", "integer", "boolean", "date", "choice"] as const)(
    "round-trips %s through its schema",
    (type) => {
      expect(inputType(schemaFor(type))).toBe(type);
    },
  );

  it("reads sample schemas the way the run form draws them", () => {
    expect(flightSearchMacro.inputs?.map((input) => inputType(input.schema))).toEqual([
      "text",
      "text",
      "date",
      "date",
      "number",
      "choice",
      "number",
    ]);
  });
});

describe("parseDefault", () => {
  it("treats blank as no default and keeps text, including relative dates", () => {
    expect(parseDefault("text", "  ")).toEqual({ value: undefined });
    expect(parseDefault("text", "LON")).toEqual({ value: "LON" });
    expect(parseDefault("date", "today+14d")).toEqual({ value: "today+14d" });
  });

  it("parses numbers and rejects what is not one", () => {
    expect(parseDefault("number", "2.5")).toEqual({ value: 2.5 });
    expect(parseDefault("integer", "3")).toEqual({ value: 3 });
    expect(parseDefault("number", "abc")).toEqual({ error: "Not a number." });
    expect(parseDefault("integer", "2.5")).toEqual({ error: "Not a whole number." });
  });
});

describe("helpers", () => {
  it("splits options on commas and drops blanks", () => {
    expect(parseOptions(" a, b ,, c ")).toEqual(["a", "b", "c"]);
  });

  it("names a new input with the first free key", () => {
    const macro: Macro = { ...rocketLauncherMacro, inputs: [newInput(rocketLauncherMacro)] };
    expect(newInput(macro).key).toBe("input2");
  });

  it("explains where a referenced input is used", () => {
    const [origin] = flightSearchMacro.inputs ?? [];
    if (!origin) throw new Error("sample has inputs");
    expect(removeBlocker(flightSearchMacro, origin)).toBe(
      '"From (IATA)" is still used in step 1. Remove those uses first.',
    );
    expect(removeBlocker(flightSearchMacro, { ...origin, key: "unused" })).toBe("");
  });
});

describe("InputsPanel", () => {
  it("shows each input with its key, type, default and mode", () => {
    const html = render(flightSearchMacro);
    expect(html.match(/<fieldset>/g)).toHaveLength(7);
    expect(html).toContain("<legend>From (IATA)</legend>");
    expect(html).toContain('value="origin"');
    expect(html).toContain('<option value="remember" selected="">');
    expect(html).toContain('<option value="choice" selected="">');
    expect(html).toContain('<option value="Up to 1 stop" selected="">');
    expect(html).toContain('placeholder="2026-12-24 or today+14d"');
    expect(html).toContain('disabled="" aria-label="Move From (IATA) up"');
  });

  it("offers adding an input to a macro that has none", () => {
    const html = render({ ...rocketLauncherMacro, inputs: undefined });
    expect(html).not.toContain("<fieldset>");
    expect(html).toContain(">Add input</button>");
  });

  it("adds inputs that the run form then asks for", () => {
    const macro = { ...rocketLauncherMacro, inputs: undefined };
    const state = editorReducer(createEditorState(macro), { type: "addInput", input: newInput(macro) });
    const form = renderToStaticMarkup(
      <InputFormView macro={state.macro} remembered={{}} submitLabel="Run" onSubmit={() => {}} />,
    );
    expect(form).toContain(">Input 1</label>");
  });
});
