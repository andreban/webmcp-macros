import { describe, expect, it } from "vitest";
import { isRunEvent, type RunEvent } from "./messages";

const base = { tabId: 3, macroId: "m" };
const result = { status: "done", toolCalls: 2, vars: { x: 1 } } as const;

describe("isRunEvent", () => {
  it.each<RunEvent>([
    { type: "run-step", ...base, count: 1, tool: "search" },
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
    ["a step without a tool", { type: "run-step", ...base, count: 1 }],
    ["a message without text", { type: "run-message", ...base }],
    ["a result with an unknown status", { type: "run-finished", ...base, result: { ...result, status: "ok" } }],
    ["a result without vars", { type: "run-finished", ...base, result: { status: "done", toolCalls: 1 } }],
    ["a non-string result message", { type: "run-finished", ...base, result: { ...result, message: 5 } }],
  ])("rejects %s", (_label, message) => {
    expect(isRunEvent(message)).toBe(false);
  });
});
