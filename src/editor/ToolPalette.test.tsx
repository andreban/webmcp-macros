import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Macro } from "../macro/types";
import { rocketLauncherMacro } from "../samples";
import { createNewMacro } from "./page";
import type { LivePage } from "./SitesPanel";
import { createEditorState, editorReducer } from "./state";
import { aliasFor, pageSite, paletteTools, ToolPalette, toolCall } from "./ToolPalette";

const fuelSchema = {
  type: "object",
  properties: { amount: { type: "number" }, oxidizer_ratio: { type: "number" }, note: { type: "string" } },
  required: ["amount", "oxidizer_ratio"],
};
const page: LivePage = {
  url: "http://localhost:4173/rocket.html",
  tools: [{ name: "get_page_state" }, { name: "load_fuel", description: "Step 2.", inputSchema: fuelSchema }],
};

describe("pageSite", () => {
  it("picks the site covering the tab, else the trigger's site", () => {
    expect(pageSite(rocketLauncherMacro, page.url)).toBe("rocket");
    const macro: Macro = { ...rocketLauncherMacro, sites: { a: { match: ["https://a.example/*"] } }, trigger: { site: "b", anyOf: [] } };
    expect(pageSite(macro, page.url)).toBe("b");
    expect(pageSite(macro, undefined)).toBe("b");
  });
});

describe("paletteTools", () => {
  it("lists the page's tools, then the macro's tools on the site that the page lacks", () => {
    const tools = paletteTools(rocketLauncherMacro, page, "rocket");
    expect(tools.slice(0, 2).map((tool) => [tool.name, tool.live])).toEqual([
      ["get_page_state", true],
      ["load_fuel", true],
    ]);
    expect(tools.slice(2).every((tool) => !tool.live)).toBe(true);
    expect(tools.map((tool) => tool.name)).toContain("ignite_engines");
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    expect(paletteTools(rocketLauncherMacro, page, "other")).toHaveLength(2);
  });

  it("keeps a snapshot schema for a tool that is not on the page", () => {
    const macro: Macro = { ...rocketLauncherMacro, tools: { fuel: { site: "rocket", name: "load_fuel", inputSchema: fuelSchema } } };
    expect(paletteTools(macro, undefined, "rocket")).toEqual([{ name: "load_fuel", inputSchema: fuelSchema, live: false }]);
  });
});

describe("iframe tools", () => {
  const inner = "http://127.0.0.1:4173";
  const framed: LivePage = {
    url: "http://localhost:4173/frames",
    tools: [{ name: "whoami" }],
    frames: [
      { frameId: 3, origin: inner, tools: [{ name: "whoami" }, { name: "stamp_inner" }] },
      // A second frame of the same origin is merged into the first.
      { frameId: 4, origin: inner, tools: [{ name: "stamp_inner" }, { name: "only_in_4" }] },
    ],
  };
  const macro = createNewMacro(framed.url, "m1");

  it("lists iframe tools under their origin and records frameOrigin only for a shared name", () => {
    expect(paletteTools(macro, framed, "main")).toEqual([
      { name: "whoami", live: true },
      { name: "whoami", live: true, origin: inner, frameOrigin: inner },
      { name: "stamp_inner", live: true, origin: inner },
      { name: "only_in_4", live: true, origin: inner },
    ]);
  });

  it("records frameOrigin when two iframe origins share a name, and never for the top frame", () => {
    const page: LivePage = {
      url: framed.url,
      tools: [],
      frames: [
        { frameId: 3, origin: "https://a.test", tools: [{ name: "save" }] },
        { frameId: 4, origin: "https://b.test", tools: [{ name: "save" }] },
      ],
    };
    expect(paletteTools(macro, page, "main").map((tool) => tool.frameOrigin)).toEqual(["https://a.test", "https://b.test"]);
  });

  it("inserts a shared iframe tool as its own alias with frameOrigin, and reuses that alias later", () => {
    const [top, shared, single] = paletteTools(macro, framed, "main");
    if (!top || !shared || !single) throw new Error("missing tools");
    const first = toolCall(macro, top, "main");
    expect(first.tools).toEqual({ whoami: { site: "main", name: "whoami" } });
    const withTop: Macro = { ...macro, tools: first.tools };
    const second = toolCall(withTop, shared, "main");
    expect(second.tools).toEqual({ whoami2: { site: "main", name: "whoami", frameOrigin: inner } });
    expect(toolCall(withTop, single, "main").tools).toEqual({ stamp_inner: { site: "main", name: "stamp_inner" } });
    const both: Macro = { ...withTop, tools: { ...withTop.tools, ...second.tools } };
    expect(toolCall(both, shared, "main").stmt).toEqual({ op: "call", tool: "whoami2" });
  });

  it("shows a macro tool for an iframe that is gone under its origin, greyed out", () => {
    const saved: Macro = { ...macro, tools: { w: { site: "main", name: "whoami", frameOrigin: inner } } };
    expect(paletteTools(saved, { url: framed.url, tools: [{ name: "whoami" }] }, "main")).toEqual([
      { name: "whoami", live: true },
      { name: "whoami", live: false, origin: inner, frameOrigin: inner },
    ]);
    expect(paletteTools(saved, framed, "main").filter((tool) => !tool.live)).toEqual([]);
    const html = renderToStaticMarkup(<ToolPalette macro={macro} page={framed} onPick={() => {}} />);
    expect(html).toContain(`In an iframe from ${inner}</span><ul aria-label="Tools in an iframe from ${inner}"`);
    expect(html.indexOf('aria-label="Tools"')).toBeLessThan(html.indexOf("In an iframe"));
  });
});

describe("aliasFor", () => {
  it("makes an identifier that no other alias uses", () => {
    expect(aliasFor("load_fuel", [])).toBe("load_fuel");
    expect(aliasFor("load-fuel", ["load_fuel", "load_fuel2"])).toBe("load_fuel3");
    expect(aliasFor("3d", [])).toBe("t3d");
  });
});

describe("toolCall", () => {
  const macro = createNewMacro(page.url, "m1");
  const live = paletteTools(macro, page, "main");

  it("adds the tool with a schema snapshot and fills required arguments", () => {
    const fuel = live.find((tool) => tool.name === "load_fuel");
    if (!fuel) throw new Error("missing tool");
    expect(toolCall(macro, fuel, "main")).toEqual({
      stmt: { op: "call", tool: "load_fuel", args: { amount: { lit: 0 }, oxidizer_ratio: { lit: 0 } } },
      tools: { load_fuel: { site: "main", name: "load_fuel", inputSchema: fuelSchema } },
    });
  });

  it("reuses an existing alias and its fields, and inserts in one undo step", () => {
    const state = createEditorState(rocketLauncherMacro);
    const call = toolCall(state.macro, { name: "get_page_state", live: true }, "rocket");
    expect(call).toEqual({ stmt: { op: "call", tool: "state" }, tools: { state: { site: "rocket", name: "get_page_state" } } });

    const fresh = createEditorState(macro);
    const fuel = toolCall(macro, { name: "load_fuel", inputSchema: fuelSchema, live: true }, "main");
    const next = editorReducer(fresh, { type: "insertStmt", at: ["program", 0], ...fuel });
    expect(next.macro.program).toEqual([fuel.stmt]);
    expect(next.macro.tools).toEqual(fuel.tools);
    expect(editorReducer(next, { type: "undo" }).macro).toBe(macro);
  });
});

describe("ToolPalette", () => {
  it("shows required slots, counts optional ones and greys out tools missing from the page", () => {
    const html = renderToStaticMarkup(<ToolPalette macro={rocketLauncherMacro} page={page} onPick={() => {}} />);
    expect(html).toContain("amount: number</span>");
    expect(html).toContain(" +1 optional</span>");
    expect(html).toMatch(/wmm-tool--absent"[^>]*><span class="wmm-verb">call<\/span> ignite_engines/);
    expect(html).not.toMatch(/wmm-tool--absent"[^>]*><span class="wmm-verb">call<\/span> load_fuel/);
  });

  it("says when there is no tab", () => {
    const html = renderToStaticMarkup(<ToolPalette macro={createNewMacro(undefined, "m")} page={undefined} onPick={() => {}} />);
    expect(html).toContain("No tab to read tools from.");
  });
});
