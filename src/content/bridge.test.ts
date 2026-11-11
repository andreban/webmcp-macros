import { describe, expect, it, vi } from "vitest";
import type { Json, ToolInfo } from "../macro/types";
import { ToolNotFoundError } from "../webmcp/adapter";
import { type ToolAccess, createRequestHandler, isContentRequest } from "./bridge";

const tools: ToolInfo[] = [{ name: "search", description: "Find flights" }];

function fakeAccess(overrides: Partial<ToolAccess> = {}): ToolAccess {
  return {
    listTools: async () => tools,
    executeTool: async () => ({ found: 3 }),
    ...overrides,
  };
}

describe("isContentRequest", () => {
  it.each([
    [{ type: "list-tools" }],
    [{ type: "abort-tool" }],
    [{ type: "execute-tool", name: "search", args: { to: "LIS" } }],
  ])("accepts %j", (message) => {
    expect(isContentRequest(message)).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "list-tools"],
    ["an unknown type", { type: "run-macro", macroId: "m" }],
    ["execute-tool without a name", { type: "execute-tool", args: {} }],
    ["execute-tool with array args", { type: "execute-tool", name: "search", args: [] }],
  ])("rejects %s", (_label, message) => {
    expect(isContentRequest(message)).toBe(false);
  });
});

describe("createRequestHandler", () => {
  it("answers list-tools with the page's tools", async () => {
    const handle = createRequestHandler(fakeAccess());
    await expect(handle({ type: "list-tools" })).resolves.toEqual(tools);
  });

  it("answers list-tools with [] when listing fails", async () => {
    const handle = createRequestHandler(fakeAccess({ listTools: () => Promise.reject(new Error("gone")) }));
    await expect(handle({ type: "list-tools" })).resolves.toEqual([]);
  });

  it("passes the name and args through and replies with the result", async () => {
    const executeTool = vi.fn(async (): Promise<Json> => ({ found: 3 }));
    const handle = createRequestHandler(fakeAccess({ executeTool }));
    const reply = await handle({ type: "execute-tool", name: "search", args: { to: "LIS" } });
    expect(reply).toEqual({ ok: true, result: { found: 3 } });
    expect(executeTool).toHaveBeenCalledWith("search", { to: "LIS" }, expect.any(AbortSignal));
  });

  it("flags a call during which the page started loading another document", async () => {
    let loads = 4;
    const executeTool = async (name: string): Promise<Json> => {
      if (name === "leave") loads++;
      return null;
    };
    const handle = createRequestHandler(fakeAccess({ executeTool }), () => loads);
    await expect(handle({ type: "execute-tool", name: "leave", args: {} })).resolves.toEqual({
      ok: true,
      result: null,
      navigated: true,
    });
    // An earlier load does not mark the next call.
    await expect(handle({ type: "execute-tool", name: "stay", args: {} })).resolves.toEqual({ ok: true, result: null });
  });

  it("replies with the error instead of rejecting", async () => {
    const handle = createRequestHandler(fakeAccess({ executeTool: () => Promise.reject(new Error("Sold out")) }));
    await expect(handle({ type: "execute-tool", name: "book", args: {} })).resolves.toEqual({
      ok: false,
      error: "Sold out",
    });
  });

  it("stringifies a non-Error rejection", async () => {
    const handle = createRequestHandler(fakeAccess({ executeTool: () => Promise.reject("nope") }));
    await expect(handle({ type: "execute-tool", name: "book", args: {} })).resolves.toEqual({ ok: false, error: "nope" });
  });

  it("marks a missing tool as notFound", async () => {
    const executeTool = () => Promise.reject(new ToolNotFoundError('Tool "book" is not registered.'));
    const handle = createRequestHandler(fakeAccess({ executeTool }));
    await expect(handle({ type: "execute-tool", name: "book", args: {} })).resolves.toEqual({
      ok: false,
      error: 'Tool "book" is not registered.',
      notFound: true,
    });
  });

  it("aborts the in-flight call's signal on abort-tool and sends no reply", async () => {
    let seen: AbortSignal | undefined;
    const executeTool = (_name: string, _args: Record<string, Json>, signal: AbortSignal) =>
      new Promise<Json>((_resolve, reject) => {
        seen = signal;
        signal.addEventListener("abort", () => reject(new Error("Aborted")));
      });
    const handle = createRequestHandler(fakeAccess({ executeTool }));
    const pending = handle({ type: "execute-tool", name: "search", args: {} });
    expect(handle({ type: "abort-tool" })).toBeUndefined();
    expect(seen?.aborted).toBe(true);
    await expect(pending).resolves.toEqual({ ok: false, error: "Aborted" });
  });

  it("does not abort a later call with an abort-tool that arrives after the call finished", async () => {
    const signals: AbortSignal[] = [];
    const executeTool = async (_name: string, _args: Record<string, Json>, signal: AbortSignal): Promise<Json> => {
      signals.push(signal);
      return null;
    };
    const handle = createRequestHandler(fakeAccess({ executeTool }));
    await handle({ type: "execute-tool", name: "a", args: {} });
    handle({ type: "abort-tool" });
    await handle({ type: "execute-tool", name: "b", args: {} });
    expect(signals.map((signal) => signal.aborted)).toEqual([false, false]);
  });
});
