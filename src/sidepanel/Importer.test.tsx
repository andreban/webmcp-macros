import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { encodeMacro } from "../macro/codec";
import type { Macro } from "../macro/types";
import { flightSearchMacro, rocketLauncherMacro } from "../samples";
import { flightSearchPage } from "../samples/flightSearch";
import { Importer, reviewImport, summarizeImport } from "./Importer";

describe("reviewImport", () => {
  it("decodes a share string into a summary without touching storage", async () => {
    const review = await reviewImport(`  ${await encodeMacro(flightSearchMacro)}\n`, [rocketLauncherMacro]);
    expect(review).toEqual({
      ok: true,
      summary: {
        macro: flightSearchMacro,
        sitePatterns: flightSearchPage.match,
        toolNames: ["listFlights", "resetFilters", "searchFlights", "setFilters"],
        replaces: null,
      },
    });
  });

  it("names the saved macro that an import with the same id would replace", async () => {
    const saved: Macro = { ...flightSearchMacro, name: "My edited copy" };
    const review = await reviewImport(await encodeMacro(flightSearchMacro), [rocketLauncherMacro, saved]);
    expect(review.ok && review.summary.replaces).toBe(saved);
  });

  it("asks for input when nothing was pasted", async () => {
    expect(await reviewImport("  \n", [])).toEqual({ ok: false, error: "Paste a macro string first." });
  });

  it("returns the codec's readable message for text that is not a share string", async () => {
    const review = await reviewImport("https://example.com/not-a-macro", []);
    expect(review).toEqual({ ok: false, error: expect.stringContaining('they start with "wmm1."') });
  });

  it("reports a truncated string instead of throwing", async () => {
    const encoded = await encodeMacro(rocketLauncherMacro);
    const [prefix, payload = "", checksum] = encoded.split(".");
    const review = await reviewImport(`${prefix}.${payload.slice(0, payload.length / 2)}.${checksum}`, []);
    expect(review.ok).toBe(false);
  });

  it("explains that a newer format needs an update", async () => {
    const review = await reviewImport("wmm2.abc.00000000", []);
    expect(review).toEqual({ ok: false, error: expect.stringContaining("Update the extension") });
  });
});

describe("summarizeImport", () => {
  it("lists each tool name and site pattern once, sorted", () => {
    const macro: Macro = {
      ...rocketLauncherMacro,
      sites: { a: { match: ["https://b.example/*"] }, b: { match: ["https://a.example/*", "https://b.example/*"] } },
      tools: { one: { site: "a", name: "zeta" }, two: { site: "b", name: "alpha" }, three: { site: "b", name: "zeta" } },
    };
    const summary = summarizeImport(macro, []);
    expect(summary.sitePatterns).toEqual(["https://a.example/*", "https://b.example/*"]);
    expect(summary.toolNames).toEqual(["alpha", "zeta"]);
  });
});

describe("Importer", () => {
  it("starts with a labelled paste box and a disabled Review button", () => {
    const html = renderToStaticMarkup(<Importer saved={[]} />);
    expect(html).toContain('<label for="import-text">Macro string</label>');
    expect(html).toMatch(/<textarea id="import-text"/);
    expect(html).toMatch(/<button type="submit" disabled="">Review<\/button>/);
    expect(html).toContain('role="status"');
  });
});
