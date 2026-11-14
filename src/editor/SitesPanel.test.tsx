// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Macro } from "../macro/types";
import { flightSearchMacro, rocketLauncherMacro } from "../samples";
import { pageFromFrames, patternError, SitesPanel, toolInfos, triggerStatus, withFrameTools } from "./SitesPanel";
import { createEditorState, type EditorAction, editorReducer } from "./state";

const rocketUrl = "https://bandarra.me/apps/webmcp-rocketlauncher/?mode=dynamic";

describe("patternError", () => {
  it("accepts a scheme, host and path, with wildcards", () => {
    expect(patternError("https://example.com/*", [])).toBeUndefined();
    expect(patternError("*://*.example.com/app/*", [])).toBeUndefined();
  });

  it.each([
    ["", "Enter a URL pattern."],
    ["https://exa mple.com/*", "A pattern cannot contain spaces."],
    ["example.com/*", "Use a pattern such as https://example.com/*."],
    ["https://example.com", "Use a pattern such as https://example.com/*."],
    ["*", "Use a pattern such as https://example.com/*."],
    ["https://a.test/*", "This pattern is already listed."],
  ])("rejects %j", (pattern, message) => {
    expect(patternError(pattern, ["https://a.test/*"])).toBe(message);
  });
});

describe("triggerStatus", () => {
  it("says when the trigger holds", () => {
    const page = { url: rocketUrl, tools: ["get_page_state", "calculate_fuel"] };
    expect(triggerStatus(rocketLauncherMacro, page)).toMatch(/^Offered/);
  });

  it("names the site mismatch, an empty trigger, or the missing tools of the closest set", () => {
    expect(triggerStatus(rocketLauncherMacro, { url: "https://other.test/", tools: [] })).toMatch(/site does not match/);
    const empty: Macro = { ...rocketLauncherMacro, trigger: { site: "rocket", anyOf: [] } };
    expect(triggerStatus(empty, { url: rocketUrl, tools: [] })).toMatch(/no tool set/);
    const two: Macro = { ...rocketLauncherMacro, trigger: { site: "rocket", anyOf: [["state", "fuelPlan"], ["ignite"]] } };
    expect(triggerStatus(two, { url: rocketUrl, tools: ["get_page_state"] })).toBe(
      "Not offered: this tab does not register calculate_fuel.",
    );
    expect(triggerStatus(rocketLauncherMacro, undefined)).toMatch(/No tab/);
  });
});

describe("toolInfos", () => {
  it("keeps named tools and only their well-formed description and schema", () => {
    const schema = { type: "object", properties: {} };
    expect(
      toolInfos([
        { name: "a" },
        { name: 1 },
        null,
        "b",
        { name: "c", description: "x", inputSchema: schema, extra: true },
        { name: "d", description: 2, inputSchema: [] },
        { name: "e", outputSchema: schema },
        { name: "f", outputSchema: "text" },
      ]),
    ).toEqual([
      { name: "a" },
      { name: "c", description: "x", inputSchema: schema },
      { name: "d" },
      { name: "e", outputSchema: schema },
      { name: "f" },
    ]);
    expect(toolInfos({ name: "a" })).toEqual([]);
  });
});

describe("pageFromFrames and withFrameTools", () => {
  const url = "http://localhost/frames";
  const reply = [
    { frameId: 0, origin: "http://localhost", tools: [{ name: "whoami" }] },
    { frameId: 5, origin: "http://b.test", tools: [{ name: "b" }] },
    { frameId: 2, origin: "http://a.test", tools: [{ name: "a", inputSchema: [] }] },
    { frameId: 4, tools: [{ name: "unnamed" }] },
  ];

  it("keeps the top frame's tools apart and lists iframes with their origin, in frame order", () => {
    expect(pageFromFrames(url, reply)).toEqual({
      url,
      tools: [{ name: "whoami" }],
      frames: [
        { frameId: 2, origin: "http://a.test", tools: [{ name: "a" }] },
        { frameId: 5, origin: "http://b.test", tools: [{ name: "b" }] },
      ],
    });
    expect(pageFromFrames(url, { not: "a list" })).toEqual({ url, tools: [] });
  });

  it("applies one frame's report and drops an iframe that reports no tools", () => {
    const page = pageFromFrames(url, reply);
    expect(withFrameTools(page, 0, "http://localhost", [{ name: "x" }]).tools).toEqual([{ name: "x" }]);
    expect(withFrameTools(page, 0, "http://localhost", [{ name: "x" }]).frames).toEqual(page.frames);
    expect(withFrameTools(page, 2, "http://a.test", []).frames?.map((frame) => frame.frameId)).toEqual([5]);
    expect(withFrameTools(page, 3, "http://c.test", [{ name: "c" }]).frames?.map((frame) => frame.frameId)).toEqual([2, 3, 5]);
  });
});

describe("SitesPanel", () => {
  const render = (macro: Macro) => renderToStaticMarkup(<SitesPanel macro={macro} dispatch={() => {}} />);

  it("lists each pattern with a remove button, an add field, and a tool set per trigger set", () => {
    const html = render(rocketLauncherMacro);
    for (const pattern of rocketLauncherMacro.sites.rocket?.match ?? []) expect(html).toContain(`value="${pattern}"`);
    expect(html).toContain("Remove pattern 2</button>");
    expect(html).toContain('aria-label="Add a pattern"');
    expect(html).toContain("Tool set 1</legend>");
    expect(html.match(/type="checkbox" checked=""/g)).toHaveLength(2);
    expect(html).toMatch(/<span role="status"[^>]*>No tab to check the trigger against.<\/span>/);
  });

  it("disables the proposal when the trigger already equals it", () => {
    expect(render(flightSearchMacro)).toMatch(/<button type="button" disabled=""[^>]*>Use proposed trigger/);
    expect(render(rocketLauncherMacro)).not.toMatch(/disabled=""[^>]*>Use proposed trigger/);
  });

  it("marks a saved pattern that is not valid", () => {
    const macro: Macro = { ...flightSearchMacro, sites: { flights: { match: ["flights"] } } };
    expect(render(macro)).toContain('aria-invalid="true"');
  });
});

describe("pattern and trigger edits through setMeta", () => {
  it("adds, edits and removes a pattern, each one undo step", () => {
    const site = rocketLauncherMacro.sites.rocket;
    if (!site) throw new Error("sample has no rocket site");
    const set = (match: string[]): EditorAction => ({
      type: "setMeta",
      meta: { sites: { ...rocketLauncherMacro.sites, rocket: { ...site, match } } },
    });
    let state = createEditorState(rocketLauncherMacro);
    state = editorReducer(state, set([...site.match, "https://b.test/*"]));
    state = editorReducer(state, set(site.match.with(0, "https://c.test/*")));
    expect(state.macro.sites.rocket).toEqual({ ...site, match: ["https://c.test/*", "http://localhost:*/*"] });
    expect(state.macro.sites.rocket?.startUrl).toBe(site.startUrl);
    state = editorReducer(state, { type: "undo" });
    expect(state.macro.sites.rocket?.match).toHaveLength(3);
  });
});
