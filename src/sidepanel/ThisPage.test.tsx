import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Macro } from "../macro/types";
import { flightSearchMacro, rocketLauncherMacro, sampleMacros } from "../samples";
import type { RunState } from "../ui/useRun";
import { pageView, ThisPageView, type PageView, type ThisPageViewProps } from "./ThisPage";

const rocketUrl = "https://bandarra.me/apps/webmcp-rocketlauncher/?mode=dynamic";
const rocketTools = [{ name: "get_page_state", description: "Reads the console." }, { name: "calculate_fuel" }];
const noInputs: Macro = { ...rocketLauncherMacro, id: "no-inputs", name: "Quick check", inputs: [] };

describe("pageView", () => {
  it("has no page without an active tab", () => {
    expect(pageView({ url: "", tools: null }, sampleMacros)).toEqual({ kind: "no-tab" });
  });

  it("is unreachable while the content script has not answered", () => {
    expect(pageView({ id: 3, url: "chrome://settings/", tools: null }, sampleMacros)).toEqual({ kind: "unreachable" });
  });

  it("lists the macros whose trigger the URL and current tools satisfy", () => {
    const view = pageView({ id: 3, url: rocketUrl, tools: rocketTools }, sampleMacros);
    expect(view).toEqual({ kind: "ready", tools: rocketTools, matches: [rocketLauncherMacro] });
  });

  it("matches nothing when a trigger tool is not registered right now", () => {
    const view = pageView({ id: 3, url: rocketUrl, tools: [{ name: "get_page_state" }] }, sampleMacros);
    expect(view.kind === "ready" && view.matches).toEqual([]);
  });
});

const noop = () => {};
function render(view: PageView, overrides: Partial<ThisPageViewProps> = {}): string {
  return renderToStaticMarkup(
    <ThisPageView
      view={view}
      run={null}
      formMacro={null}
      onRun={noop}
      onSubmit={noop}
      onCancel={noop}
      onUpdate={noop}
      onStop={noop}
      onDismiss={noop}
      {...overrides}
    />,
  );
}

const ready: PageView = { kind: "ready", tools: rocketTools, matches: [rocketLauncherMacro, noInputs] };

describe("ThisPageView", () => {
  it("says when there is no tab or the page cannot run macros", () => {
    expect(render({ kind: "no-tab" })).toContain("No active tab.");
    const html = render({ kind: "unreachable" });
    expect(html).toContain("Macros cannot run on this page.");
    expect(html).not.toContain("<details");
  });

  it("shows the empty states of a page with no tools and no matches", () => {
    const html = render({ kind: "ready", tools: [], matches: [] });
    expect(html).toContain("No saved macro matches this page.");
    expect(html).toContain("<summary>No WebMCP tools on this page</summary>");
  });

  it("lists matching macros with Run, and tools with name and description", () => {
    const html = render(ready);
    expect(html.match(/<button type="button">Run<\/button>/g)).toHaveLength(2);
    expect(html).toContain("<summary>2 WebMCP tools on this page</summary>");
    expect(html).toContain('<code>get_page_state</code><p class="muted">Reads the console.</p>');
    expect(html).toContain("<code>calculate_fuel</code></li>");
  });

  it("offers needs update instead of Run for a macro the page's tools no longer fit", () => {
    const tools = [{ name: "get_page_state" }, { name: "calculate_fuel", inputSchema: { type: "object", properties: {} } }];
    const html = render({ kind: "ready", tools, matches: [rocketLauncherMacro] });
    expect(html).toContain('<button type="button" class="secondary">Needs update</button>');
    expect(html).not.toContain(">Run</button>");
  });

  it("keeps an empty status region before any run", () => {
    expect(render(ready)).toContain('<span role="status" class="status"></span>');
  });

  it("shows progress with Stop and disables Run while a run is in progress", () => {
    const run: RunState = { macroId: rocketLauncherMacro.id, step: { count: 2, tool: "calculate_fuel" }, messages: [] };
    const html = render(ready, { run });
    expect(html).toContain('<span role="status" class="status">Step 2: calculate_fuel</span>');
    expect(html).toContain(">Stop</button>");
    expect(html.match(/<button type="button" disabled="">Run<\/button>/g)).toHaveLength(2);
  });

  it("shows a failed result with Dismiss and enables Run again", () => {
    const run: RunState = {
      macroId: rocketLauncherMacro.id,
      messages: [],
      result: { status: "failed", message: "No fuel", toolCalls: 1, vars: {} },
    };
    const html = render(ready, { run });
    expect(html).toContain('<span role="status" class="status failed">Failed: No fuel</span>');
    expect(html).toContain(">Dismiss</button>");
    expect(html).not.toContain(">Stop</button>");
    expect(html).not.toContain("disabled");
  });

  it("opens a card for the macro whose input form is shown", () => {
    const html = render({ kind: "ready", tools: [], matches: [flightSearchMacro] }, { formMacro: flightSearchMacro });
    expect(html).toContain(`<div class="card"><h3>${flightSearchMacro.name}</h3>`);
  });
});
