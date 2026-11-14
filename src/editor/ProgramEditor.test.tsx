// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { rocketLauncherMacro } from "../samples";
import { GROUPS, matchOps, Palette, paletteEntries } from "./Palette";
import { createNewMacro } from "./page";
import { ProgramEditor } from "./ProgramEditor";
import { statements } from "./registry";

const tabIndexes = (html: string) => [...html.matchAll(/data-path="[^"]*" tabindex="(-?\d)"/g)].map((m) => m[1]);

describe("ProgramEditor", () => {
  it("makes every block focusable, with one tab stop", () => {
    const html = renderToStaticMarkup(<ProgramEditor macro={rocketLauncherMacro} dispatch={() => {}} />);
    const stops = tabIndexes(html);
    expect(stops.length).toBeGreaterThan(1);
    expect(stops.filter((index) => index === "0")).toHaveLength(1);
    expect(html).toContain('role="combobox"');
  });

  it("renders each block's slots as editable controls", () => {
    const macro = { ...rocketLauncherMacro, program: [{ op: "set" as const, var: "n", value: { lit: 2 } }, { op: "wait" as const, ms: 10 }] };
    const html = renderToStaticMarkup(<ProgramEditor macro={macro} dispatch={() => {}} />);
    expect(html).toMatch(/aria-label="variable"[^>]* value="n"/);
    expect(html).toContain('aria-label="Change value"');
    expect(html).toMatch(/aria-label="milliseconds"[^>]* value="10"/);
  });

  it("heads the program with a hat that takes no focus and is not announced", () => {
    const html = renderToStaticMarkup(<ProgramEditor macro={rocketLauncherMacro} dispatch={() => {}} />);
    expect(html).toContain('<div class="wmm-hat" aria-hidden="true">when run</div><ol class="wmm-blocks">');
  });

  it("offers an empty program as a place to insert", () => {
    const html = renderToStaticMarkup(<ProgramEditor macro={{ ...rocketLauncherMacro, program: [] }} dispatch={() => {}} />);
    expect(html).toMatch(/<div class="wmm-empty" data-path="\[&quot;program&quot;,0\]" tabindex="0"[^>]*>empty<\/div>/);
  });
});

describe("Palette", () => {
  it("lists every registry statement, filtered by verb or op", () => {
    expect(matchOps("")).toEqual(Object.keys(statements));
    expect(matchOps("rep")).toEqual(["repeat"]);
    expect(matchOps("show")).toEqual(["message"]);
    expect(matchOps("wait")).toEqual(["waitForTool", "wait"]);
    expect(matchOps("zzz")).toEqual([]);
  });

  it("groups the page's tools first, then each category in turn", () => {
    const page = { url: "https://example.com/", tools: [{ name: "look" }] };
    const entries = paletteEntries(createNewMacro(page.url, "m"), page, "");
    expect(entries[0]).toMatchObject({ group: "page", tool: { name: "look", live: true } });
    const groups = entries.map((entry) => entry.group);
    expect(groups.filter((group, i) => group !== groups[i - 1])).toEqual(GROUPS.map(({ group }) => group));
    expect(paletteEntries(createNewMacro(page.url, "m"), page, "loo").map((entry) => entry.key)).toEqual(["tool  look"]);
  });

  it("is a combobox whose first option is active, with one group per category", () => {
    const html = renderToStaticMarkup(<Palette macro={rocketLauncherMacro} page={undefined} onPick={() => {}} onCancel={() => {}} />);
    expect(html.match(/role="option"/g)).toHaveLength(Object.keys(statements).length + Object.keys(rocketLauncherMacro.tools).length);
    expect(html).toMatch(/aria-activedescendant="([^"]+)"[^]*id="\1" role="option" aria-selected="true"/);
    expect(html.match(/role="group"/g)).toHaveLength(GROUPS.length);
  });
});
