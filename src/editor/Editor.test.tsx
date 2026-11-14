// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { rocketLauncherMacro } from "../samples";
import { EditorView, type EditorViewProps } from "./Editor";
import { createEditorState, editorReducer } from "./state";

function render(overrides: Partial<EditorViewProps> = {}) {
  return renderToStaticMarkup(
    <EditorView
      state={createEditorState(rocketLauncherMacro)}
      dispatch={() => {}}
      status="All changes saved"
      canSave={false}
      onSave={() => {}}
      {...overrides}
    />,
  );
}

const button = (html: string, name: string) => html.match(new RegExp(`<button[^>]*>${name}</button>`))?.[0] ?? "";

describe("EditorView", () => {
  it("shows the name, description and program of the macro", () => {
    const html = render();
    expect(html).toContain(`value="${rocketLauncherMacro.name}"`);
    expect(html).toContain("<textarea");
    expect(html).toContain('class="wmm-program workspace"');
    expect(html).toContain("Macro settings <span class=\"muted\">· 2 inputs. No tab to check the trigger against.</span>");
    expect(html).toContain(`<title>${rocketLauncherMacro.name} · WebMCP Macros</title>`);
  });

  it("highlights the statement a run is executing", () => {
    const html = render({ running: ["program", 0] });
    const highlighted = [...html.matchAll(/<div class="[^"]*wmm-block--running"[^>]*>/g)].map((m) => m[0]);
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toContain('aria-current="step"');
    expect(highlighted[0]).toContain('data-path="[&quot;program&quot;,0]"');
    expect(render()).not.toContain("wmm-block--running");
  });

  it("announces the save status in a live region", () => {
    expect(render({ status: "Unsaved changes" })).toMatch(/<span role="status"[^>]*>Unsaved changes<\/span>/);
  });

  it("enables undo, redo and save only when they would do something", () => {
    const clean = render();
    expect(button(clean, "Undo")).toContain("disabled");
    expect(button(clean, "Redo")).toContain("disabled");
    expect(button(clean, "Save")).toContain("disabled");

    const renamed = editorReducer(createEditorState(rocketLauncherMacro), { type: "setMeta", meta: { name: "Renamed" } });
    const edited = render({ state: renamed, canSave: true });
    expect(edited).toContain('value="Renamed"');
    expect(button(edited, "Undo")).not.toContain("disabled");
    expect(button(edited, "Undo")).toContain('aria-keyshortcuts="Control+Z Meta+Z"');
    expect(button(edited, "Redo")).toContain("disabled");
    expect(button(edited, "Save")).not.toContain("disabled");

    const undone = render({ state: editorReducer(renamed, { type: "undo" }) });
    expect(button(undone, "Redo")).not.toContain("disabled");
  });
});
