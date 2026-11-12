import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { flightSearchMacro, rocketLauncherMacro } from "../samples";
import type { RunState } from "../ui/useRun";
import { WidgetView, type WidgetViewProps } from "./Widget";

const noop = () => {};

function render(overrides: Partial<WidgetViewProps> = {}): string {
  return renderToStaticMarkup(
    <WidgetView
      macros={[rocketLauncherMacro, flightSearchMacro]}
      tools={[]}
      open={false}
      selected={null}
      run={null}
      running={false}
      onToggle={noop}
      onLaunch={noop}
      onSubmit={noop}
      onCancel={noop}
      onStop={noop}
      onClose={noop}
      {...overrides}
    />,
  );
}

const inProgress: RunState = { macroId: rocketLauncherMacro.id, step: { count: 2, tool: "load_fuel" }, messages: [] };
const finished: RunState = { ...inProgress, result: { status: "failed", message: "No fuel", toolCalls: 2, vars: {} } };

describe("WidgetView", () => {
  it("collapsed: only the launcher button, with the match count", () => {
    const html = render();
    expect(html).not.toContain("wmm-panel");
    expect(html).toContain('aria-label="WebMCP Macros: 2 available"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('<span class="wmm-badge">2</span>');
  });

  it("open: lists the matching macros with enabled Run buttons", () => {
    const html = render({ open: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Launch the rocket");
    expect(html).toContain("Search my usual flight");
    expect(html.match(/<button type="button">Run<\/button>/g)).toHaveLength(2);
    expect(html).not.toContain('role="status"');
  });

  it("open: shows needs update instead of Run when the page's tools no longer fit", () => {
    const tools = [{ name: "calculate_fuel", inputSchema: { type: "object", properties: { destination: { type: "string" } } } }];
    const html = render({ open: true, tools });
    expect(html).toContain('<span class="wmm-stale" title="This site&#x27;s tools changed. Update the macro in the editor.">Needs update</span>');
    expect(html.match(/<button type="button">Run<\/button>/g)).toHaveLength(1);
  });

  it("open: warns when a recorded schema hash changed but the arguments still fit", () => {
    const hashed = { ...rocketLauncherMacro, tools: { ...rocketLauncherMacro.tools, fuelPlan: { site: "rocket", name: "calculate_fuel", schemaHash: "00000000" } } };
    const tools = [{ name: "calculate_fuel", inputSchema: { type: "object", properties: { trajectory: { type: "string" } } } }];
    const html = render({ open: true, macros: [hashed], tools });
    expect(html).toContain("<small>This site changed its tools since the macro was made.</small>");
    expect(html).toContain('<button type="button">Run</button>');
  });

  it("input form: shows the selected macro instead of the list", () => {
    const html = render({ open: true, selected: flightSearchMacro });
    expect(html).toContain('<p class="wmm-title">Search my usual flight</p>');
    expect(html).not.toContain("Launch the rocket");
  });

  it("running: announces the step, offers Stop and disables Run, even when collapsed", () => {
    expect(render({ run: inProgress, running: true })).toContain('role="status">Step 2: load_fuel</p>');
    const html = render({ open: true, run: inProgress, running: true });
    expect(html).toContain(">Stop</button>");
    expect(html.match(/<button type="button" disabled="">Run<\/button>/g)).toHaveLength(2);
  });

  it("finished: shows the result and Close, and stays visible with no matching macro", () => {
    const html = render({ macros: [], run: finished });
    expect(html).toContain('class="wmm-status failed" role="status">Failed: No fuel</p>');
    expect(html).toContain(">Close</button>");
    expect(html).not.toContain("wmm-badge");
  });
});
