import { describe, expect, it } from "vitest";
import { isToolList, reportedTools } from "./useActiveTab";

describe("isToolList", () => {
  it("accepts tools with a name and an optional string description", () => {
    expect(isToolList([])).toBe(true);
    expect(isToolList([{ name: "a" }, { name: "b", description: "B", inputSchema: {} }])).toBe(true);
  });

  it("rejects anything a page could send that is not a tool list", () => {
    expect(isToolList(null)).toBe(false);
    expect(isToolList(undefined)).toBe(false);
    expect(isToolList({ name: "a" })).toBe(false);
    expect(isToolList([{ description: "no name" }])).toBe(false);
    expect(isToolList([{ name: 1 }])).toBe(false);
    expect(isToolList([{ name: "a", description: { html: "<b>" } }])).toBe(false);
    expect(isToolList([null])).toBe(false);
  });
});

describe("reportedTools", () => {
  it("returns the tools of a valid tools-changed report", () => {
    expect(reportedTools({ type: "tools-changed", tools: [{ name: "a" }], matches: 0 })).toEqual([{ name: "a" }]);
  });

  it("ignores other messages and malformed reports", () => {
    expect(reportedTools({ type: "run-step", tabId: 1, macroId: "m", count: 1, tool: "a", path: [] })).toBeNull();
    expect(reportedTools({ type: "tools-changed", tools: "a" })).toBeNull();
    expect(reportedTools("tools-changed")).toBeNull();
  });
});
