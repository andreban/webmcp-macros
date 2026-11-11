import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sampleMacros } from "../samples";
import { SavedMacros } from "./SavedMacros";

describe("SavedMacros", () => {
  it("points to the importer when nothing is saved", () => {
    const html = renderToStaticMarkup(<SavedMacros macros={[]} />);
    expect(html).toContain("Nothing saved yet");
    expect(html).not.toContain("<details");
  });

  it("renders one collapsible card per macro, in save order, with its blocks and actions", () => {
    const html = renderToStaticMarkup(<SavedMacros macros={sampleMacros} />);
    const names = [...html.matchAll(/<summary>([^<]*)<\/summary>/g)].map((match) => match[1]);
    expect(names).toEqual(sampleMacros.map((macro) => macro.name));
    expect(html.match(/class="wmm-program"/g)).toHaveLength(sampleMacros.length);
    expect(html.match(/<button type="button"[^>]*>Copy share string<\/button>/g)).toHaveLength(sampleMacros.length);
    expect(html.match(/<button type="button"[^>]*>Delete<\/button>/g)).toHaveLength(sampleMacros.length);
    // The copy confirmation needs a live region that exists before it changes.
    expect(html.match(/role="status"/g)).toHaveLength(sampleMacros.length);
  });
});
