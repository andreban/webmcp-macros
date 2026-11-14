// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { Macro } from "./macro/types";
import { isBackgroundRequest, isExecuteToolResponse, isFrameToolLists, isRunEvent, type BackgroundRequest, type RunEvent } from "./messages";

const SAMPLE: Macro = {
  wmm: 1,
  id: "m",
  name: "M",
  sites: { s: { match: ["*"] } },
  tools: {},
  trigger: { site: "s", anyOf: [] },
  program: [],
};
const base = { tabId: 3, macroId: "m" };
const result = { status: "done", toolCalls: 2, vars: { x: 1 } } as const;

describe("isRunEvent", () => {
  it.each<RunEvent>([
    { type: "run-step", ...base, count: 1, tool: "search", path: ["program", 0] },
    { type: "run-at", ...base, path: ["procedures", "p", "body", 2] },
    { type: "run-call", ...base, tool: "search", args: { q: "x" }, result: null, path: ["program", 1, "then", 0] },
    { type: "run-message", ...base, text: "hello" },
    { type: "run-finished", ...base, result },
    { type: "run-finished", ...base, result: { status: "failed", message: "boom", toolCalls: 0, vars: {} } },
  ])("accepts a well-formed $type", (event) => {
    expect(isRunEvent(event)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "run-step"],
    ["another message type", { type: "tools-changed", ...base, tools: [], matches: 0 }],
    ["a missing tabId", { type: "run-message", macroId: "m", text: "hi" }],
    ["a string tabId", { type: "run-message", tabId: "3", macroId: "m", text: "hi" }],
    ["a step without a tool", { type: "run-step", ...base, count: 1, path: [] }],
    ["a step without a path", { type: "run-step", ...base, count: 1, tool: "search" }],
    ["a path with a fractional index", { type: "run-at", ...base, path: ["program", 0.5] }],
    ["a call without a result", { type: "run-call", ...base, tool: "search", args: {}, path: [] }],
    ["a message without text", { type: "run-message", ...base }],
    ["a result with an unknown status", { type: "run-finished", ...base, result: { ...result, status: "ok" } }],
    ["a result without vars", { type: "run-finished", ...base, result: { status: "done", toolCalls: 1 } }],
    ["a non-string result message", { type: "run-finished", ...base, result: { ...result, message: 5 } }],
  ])("rejects %s", (_label, message) => {
    expect(isRunEvent(message)).toBe(false);
  });
});

describe("isBackgroundRequest", () => {
  it.each<BackgroundRequest>([
    { type: "tools-changed", tools: [{ name: "search", description: "d" }], matches: 2 },
    { type: "run-macro", macroId: "m", inputs: { q: "x" } },
    { type: "run-macro", macroId: "m", inputs: {}, tabId: 4 },
    { type: "run-macro", macro: SAMPLE, inputs: {}, tabId: 4 },
    { type: "stop-run" },
    { type: "stop-run", tabId: 4 },
    { type: "list-frame-tools", tabId: 4 },
  ])("accepts a well-formed $type", (message) => {
    expect(isBackgroundRequest(message)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a run event", { type: "run-message", ...base, text: "hi" }],
    ["tools that are not a list", { type: "tools-changed", tools: {}, matches: 0 }],
    ["a tool without a name", { type: "tools-changed", tools: [{ description: "d" }], matches: 0 }],
    ["a missing match count", { type: "tools-changed", tools: [] }],
    ["a run without a macro id", { type: "run-macro", inputs: {} }],
    ["an inline macro that is not a macro", { type: "run-macro", macro: { id: "m" }, inputs: {} }],
    ["both a macro id and an inline macro", { type: "run-macro", macroId: "m", macro: SAMPLE, inputs: {} }],
    ["inputs that are a list", { type: "run-macro", macroId: "m", inputs: [] }],
    ["a string tabId", { type: "stop-run", tabId: "4" }],
    ["a fractional tabId", { type: "run-macro", macroId: "m", inputs: {}, tabId: 1.5 }],
    ["a frame listing without a tab", { type: "list-frame-tools" }],
  ])("rejects %s", (_label, message) => {
    expect(isBackgroundRequest(message)).toBe(false);
  });
});

describe("isFrameToolLists", () => {
  it("accepts frames with or without an origin", () => {
    expect(isFrameToolLists([{ frameId: 0, tools: [{ name: "a" }] }, { frameId: 3, origin: "https://x.test", tools: [] }])).toBe(true);
    expect(isFrameToolLists([])).toBe(true);
  });

  it.each<unknown>([
    null,
    {},
    [{ frameId: "0", tools: [] }],
    [{ frameId: 0, origin: 1, tools: [] }],
    [{ frameId: 0, tools: [{ description: "no name" }] }],
  ])("rejects %j", (value) => expect(isFrameToolLists(value)).toBe(false));
});

describe("isExecuteToolResponse", () => {
  it.each<unknown>([{ ok: true, result: null }, { ok: false, error: "boom" }, { ok: false, error: "gone", notFound: true }])(
    "accepts %j",
    (value) => expect(isExecuteToolResponse(value)).toBe(true),
  );

  it.each<unknown>([null, { ok: true }, { ok: false }, { ok: "true", result: 1 }, { ok: false, error: 3 }])(
    "rejects %j",
    (value) => expect(isExecuteToolResponse(value)).toBe(false),
  );
});
