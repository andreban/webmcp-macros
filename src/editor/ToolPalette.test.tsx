import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { schemaHash } from "../macro/compat";
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

  it("adds the tool with a schema snapshot and its hash, and fills required arguments", () => {
    const fuel = live.find((tool) => tool.name === "load_fuel");
    if (!fuel) throw new Error("missing tool");
    expect(toolCall(macro, fuel, "main")).toEqual({
      stmt: { op: "call", tool: "load_fuel", args: { amount: { lit: 0 }, oxidizer_ratio: { lit: 0 } } },
      tools: { load_fuel: { site: "main", name: "load_fuel", inputSchema: fuelSchema, schemaHash: schemaHash(fuelSchema) } },
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

  it("refreshes a stale hash from the page's schema", () => {
    const stale: Macro = { ...macro, tools: { fuel: { site: "main", name: "load_fuel", schemaHash: "00000000" } } };
    const fuel = toolCall(stale, { name: "load_fuel", inputSchema: fuelSchema, live: true }, "main");
    expect(fuel.tools.fuel?.schemaHash).toBe(schemaHash(fuelSchema));
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
