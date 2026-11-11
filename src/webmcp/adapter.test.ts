import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../macro/types";
import { ToolNotFoundError, executeTool, isSupported, listTools, onToolsChanged } from "./adapter";

interface FakeTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
  window?: object;
}

type Input = Record<string, Json> | string;

/** Stands in for `document.modelContext`; Node has `EventTarget`, so no DOM is needed. */
class FakeModelContext extends EventTarget {
  tools: FakeTool[] = [];
  calls: Input[] = [];
  run: (input: Input) => unknown = () => undefined;

  async getTools(): Promise<FakeTool[]> {
    return this.tools;
  }

  async executeTool(_tool: FakeTool, input: Input): Promise<unknown> {
    this.calls.push(input);
    return this.run(input);
  }
}

const pageWindow = {};
let context: FakeModelContext;

beforeEach(() => {
  context = new FakeModelContext();
  vi.stubGlobal("window", pageWindow);
  vi.stubGlobal("document", { modelContext: context });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isSupported", () => {
  it("reports whether the document has a model context", () => {
    expect(isSupported()).toBe(true);
    vi.stubGlobal("document", {});
    expect(isSupported()).toBe(false);
  });
});

describe("listTools", () => {
  it("returns only this document's tools", async () => {
    context.tools = [
      { name: "own", window: pageWindow },
      { name: "unattributed" },
      { name: "iframe", window: {} },
    ];
    expect((await listTools()).map((tool) => tool.name)).toEqual(["own", "unattributed"]);
  });

  it("parses schemas given as JSON text and drops ones that are not objects", async () => {
    context.tools = [
      { name: "text", inputSchema: '{"type":"object"}' },
      { name: "object", inputSchema: { type: "object" } },
      { name: "broken", inputSchema: "{" },
      { name: "array", inputSchema: "[1]" },
    ];
    expect((await listTools()).map((tool) => tool.inputSchema)).toEqual([
      { type: "object" },
      { type: "object" },
      undefined,
      undefined,
    ]);
  });

  it("keeps only boolean annotations", async () => {
    context.tools = [{ name: "a", annotations: { readOnlyHint: true, label: "x" } }];
    expect((await listTools())[0]?.annotations).toEqual({ readOnlyHint: true });
  });

  it("is empty without WebMCP", async () => {
    vi.stubGlobal("document", {});
    expect(await listTools()).toEqual([]);
  });
});

describe("executeTool", () => {
  beforeEach(() => {
    context.tools = [{ name: "go" }];
  });

  it.each([
    ["undefined", undefined, null],
    ["null", null, null],
    ['"undefined" text, which Chrome 153 returns for a tool without a result', "undefined", null],
    ["JSON text", '{"ok":true}', { ok: true }],
    ["plain text", "done", "done"],
    ["an object with non-JSON parts", { n: 1, f: () => 1, d: new Date(0) }, { n: 1, d: "1970-01-01T00:00:00.000Z" }],
    ["a function", () => 1, null],
  ])("normalises %s", async (_label, result, expected) => {
    context.run = () => result;
    expect(await executeTool("go", {})).toEqual(expected);
  });

  it("rejects a result JSON cannot represent", async () => {
    context.run = () => ({ big: 1n });
    await expect(executeTool("go", {})).rejects.toThrow(/not JSON/);
  });

  it("throws ToolNotFoundError for an unregistered tool", async () => {
    await expect(executeTool("missing", {})).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it("retries once with JSON text when object input is rejected", async () => {
    context.run = (input) => {
      if (typeof input !== "string") throw new Error("Failed to parse input arguments");
      return "ok";
    };
    expect(await executeTool("go", { a: 1 })).toBe("ok");
    expect(context.calls).toEqual([{ a: 1 }, '{"a":1}']);
  });

  it("does not retry other errors", async () => {
    context.run = () => {
      throw new Error("Out of fuel");
    };
    await expect(executeTool("go", { a: 1 })).rejects.toThrow("Out of fuel");
    expect(context.calls).toHaveLength(1);
  });
});

describe("onToolsChanged", () => {
  it("debounces bursts by 100 ms and stops after unsubscribe", () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = onToolsChanged(listener);
    context.dispatchEvent(new Event("toolchange"));
    vi.advanceTimersByTime(60);
    context.dispatchEvent(new Event("toolchange"));
    vi.advanceTimersByTime(99);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);

    context.dispatchEvent(new Event("toolchange"));
    unsubscribe();
    vi.advanceTimersByTime(200);
    context.dispatchEvent(new Event("toolchange"));
    vi.advanceTimersByTime(200);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
