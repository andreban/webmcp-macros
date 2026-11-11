import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { rocketLauncherMacro } from "../samples";
import { RunBar, type RunBarProps } from "./RunBar";
import { idleRun } from "./useEditorRun";

const render = (overrides: Partial<RunBarProps> = {}) =>
  renderToStaticMarkup(
    <RunBar macro={rocketLauncherMacro} tabId={3} trace={idleRun} onRun={() => {}} onStop={() => {}} onDismiss={() => {}} {...overrides} />,
  );

describe("RunBar", () => {
  it("offers Run only with a tab to run on", () => {
    expect(render()).toMatch(/<button type="button">Run<\/button>/);
    const noTab = render({ tabId: undefined });
    expect(noTab).toMatch(/<button type="button" disabled="">Run<\/button>/);
    expect(noTab).toContain("Open the editor from the side panel");
  });

  it("announces progress and offers Stop while running", () => {
    const html = render({ trace: { run: { macroId: "m", messages: [], step: { count: 2, tool: "launch" } }, calls: [] } });
    expect(html).toMatch(/<span role="status" class="status">Step 2: launch<\/span>/);
    expect(html).toContain(">Stop</button>");
    expect(html).not.toContain(">Run</button>");
  });

  it("logs each tool call with its arguments and result", () => {
    const calls = [{ tool: "set_target", args: { planet: "Mars" }, result: { ok: true } }];
    const html = render({ trace: { run: { macroId: "m", messages: [], result: { status: "done", toolCalls: 1, vars: {} } }, calls } });
    expect(html).toContain('<ol class="run-log" aria-label="Tool calls">');
    expect(html).toContain("set_target({&quot;planet&quot;:&quot;Mars&quot;}) → {&quot;ok&quot;:true}");
    expect(html).toContain(">Dismiss</button>");
  });
});
