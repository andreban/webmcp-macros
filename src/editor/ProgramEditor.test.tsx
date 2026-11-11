import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { rocketLauncherMacro } from "../samples";
import { matchOps, Palette } from "./Palette";
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

  it("is a combobox whose first option is active", () => {
    const html = renderToStaticMarkup(<Palette onPick={() => {}} onCancel={() => {}} />);
    expect(html.match(/role="option"/g)).toHaveLength(Object.keys(statements).length);
    expect(html).toMatch(/aria-activedescendant="([^"]+)"[^]*id="\1" role="option" aria-selected="true"/);
  });
});
