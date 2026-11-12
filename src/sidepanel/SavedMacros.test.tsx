import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleMacros } from "../samples";
import { openEditor, SavedMacros } from "./SavedMacros";

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
    // Edit is outside the folded part, so it shows without opening the card.
    const edits = [...html.matchAll(/<\/details><button type="button"[^>]*aria-label="Edit ([^"]*)">Edit<\/button>/g)];
    expect(edits.map((match) => match[1])).toEqual(sampleMacros.map((macro) => macro.name));
    expect(html.match(/<button type="button"[^>]*>New macro<\/button>/g)).toHaveLength(1);
    // The copy confirmation needs a live region that exists before it changes.
    expect(html.match(/role="status"/g)).toHaveLength(sampleMacros.length);
  });
});

describe("openEditor", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens the editor in a new tab, for a saved or a new macro, against the active tab", async () => {
    const create = vi.fn(async (_: { url: string }) => ({}));
    vi.stubGlobal("chrome", {
      tabs: { query: vi.fn(async () => [{ id: 7 }]), create },
      runtime: { getURL: (path: string) => `chrome-extension://ext/${path}` },
    });
    await openEditor("m1");
    await openEditor();
    expect(create.mock.calls).toEqual([
      [{ url: "chrome-extension://ext/src/editor/index.html?macro=m1&tab=7" }],
      [{ url: "chrome-extension://ext/src/editor/index.html?tab=7" }],
    ]);
  });
});
