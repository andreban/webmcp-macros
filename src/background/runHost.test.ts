import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentRequest, RunEvent } from "../messages";
import type { Macro, Stmt } from "../macro/types";
import { createRunHost, type RunHostDeps } from "./runHost";

const TAB = 7;

function macro(program: Stmt[], id = "m"): Macro {
  return {
    wmm: 1,
    id,
    name: "Test",
    sites: { s: { match: ["*"] } },
    tools: { go: { site: "s", name: "go" } },
    trigger: { site: "s", anyOf: [] },
    program,
  };
}

/** A tab whose content script lists `tools` and answers `execute-tool` with `reply`. */
function setup(macros: Macro[] = [], reply: (request: ContentRequest) => Promise<unknown> = async () => undefined) {
  const tools: string[] = [];
  const events: RunEvent[] = [];
  const requests: ContentRequest[] = [];
  const sendToTab = vi.fn<RunHostDeps["sendToTab"]>(async (_tabId, request) => {
    requests.push(request);
    if (request.type === "list-tools") return tools.map((name) => ({ name }));
    return reply(request);
  });
  const host = createRunHost({ sendToTab, broadcast: (event) => events.push(event), loadMacros: async () => macros });
  return { host, tools, events, requests, sendToTab };
}

describe("waitForTool", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves at once when the tab already lists the tool", async () => {
    const { host, tools } = setup();
    tools.push("go");
    await expect(host.toolHost(TAB, new AbortController().signal).waitForTool("go", 1000)).resolves.toBeUndefined();
  });

  it("resolves when a tools-changed update brings the tool", async () => {
    const { host, sendToTab } = setup();
    const waiting = host.toolHost(TAB, new AbortController().signal).waitForTool("go", 1000);
    await vi.advanceTimersByTimeAsync(0);
    sendToTab.mockClear();
    host.setTools(TAB, [{ name: "go" }]);
    await expect(waiting).resolves.toBeUndefined();
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it("ignores updates for other tabs", async () => {
    const { host } = setup();
    const waiting = host.toolHost(TAB, new AbortController().signal).waitForTool("go", 1000);
    const assertion = expect(waiting).rejects.toThrow("Timed out");
    await vi.advanceTimersByTimeAsync(0);
    host.setTools(TAB + 1, [{ name: "go" }]);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("finds the tool by polling when no update arrives", async () => {
    const { host, tools } = setup();
    const waiting = host.toolHost(TAB, new AbortController().signal).waitForTool("go", 1000);
    await vi.advanceTimersByTimeAsync(0);
    tools.push("go");
    await vi.advanceTimersByTimeAsync(500);
    await expect(waiting).resolves.toBeUndefined();
  });

  it("rejects on timeout and stops polling", async () => {
    const { host, sendToTab } = setup();
    const waiting = host.toolHost(TAB, new AbortController().signal).waitForTool("go", 1000);
    const assertion = expect(waiting).rejects.toThrow('Timed out waiting for "go".');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    sendToTab.mockClear();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it("rejects when the run is aborted", async () => {
    const { host } = setup();
    const controller = new AbortController();
    const waiting = host.toolHost(TAB, controller.signal).waitForTool("go", 10_000);
    const assertion = expect(waiting).rejects.toThrow("Aborted.");
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
  });
});

describe("callTool", () => {
  it("returns the result of a successful call", async () => {
    const { host } = setup([], async () => ({ ok: true, result: { n: 1 } }));
    await expect(host.toolHost(TAB, new AbortController().signal).callTool("go", { a: 1 })).resolves.toEqual({ n: 1 });
  });

  it("throws the tool's error", async () => {
    const { host } = setup([], async () => ({ ok: false, error: "nope" }));
    await expect(host.toolHost(TAB, new AbortController().signal).callTool("go", {})).rejects.toThrow("nope");
  });

  it("rejects a malformed response", async () => {
    const { host } = setup([], async () => ({ ok: "yes" }));
    await expect(host.toolHost(TAB, new AbortController().signal).callTool("go", {})).rejects.toThrow("Invalid response");
  });

  it("treats a closed channel as a navigation: null, and the tab's cache is dropped", async () => {
    const { host, sendToTab } = setup([], async () => {
      throw new Error("The message port closed before a response was received.");
    });
    host.setTools(TAB, [{ name: "go" }]);
    sendToTab.mockRejectedValueOnce(new Error("closed"));
    const toolHost = host.toolHost(TAB, new AbortController().signal);
    await expect(toolHost.callTool("go", {})).resolves.toBeNull();
    // The next listing also fails (new page not ready), so only the cache answers.
    sendToTab.mockRejectedValueOnce(new Error("no receiver"));
    await expect(toolHost.isToolAvailable("go")).resolves.toBe(false);
  });
});

describe("runs", () => {
  it("runs a macro and broadcasts its steps, messages and result", async () => {
    const program: Stmt[] = [{ op: "call", tool: "go" }, { op: "message", text: { lit: "hi" } }];
    const { host, tools, events } = setup([macro(program)], async () => ({ ok: true, result: 1 }));
    tools.push("go");
    await host.startRun(TAB, "m", {});
    expect(events).toEqual([
      { type: "run-step", tabId: TAB, macroId: "m", count: 1, tool: "go" },
      { type: "run-message", tabId: TAB, macroId: "m", text: "hi" },
      { type: "run-finished", tabId: TAB, macroId: "m", result: expect.objectContaining({ status: "done", toolCalls: 1 }) },
    ]);
  });

  it("reports an unknown macro as a failed run", async () => {
    const { host, events } = setup();
    await host.startRun(TAB, "missing", {});
    expect(events).toEqual([
      { type: "run-finished", tabId: TAB, macroId: "missing", result: expect.objectContaining({ status: "failed", message: "Macro not found." }) },
    ]);
  });

  it("allows one run per tab: a second request while busy is ignored", async () => {
    let release = (): void => {};
    const { host, tools, events, requests } = setup([macro([{ op: "call", tool: "go" }])], () => {
      return new Promise((resolve) => (release = () => resolve({ ok: true, result: null })));
    });
    tools.push("go");
    const first = host.startRun(TAB, "m", {});
    await host.startRun(TAB, "m", {});
    await vi.waitFor(() => expect(requests.some((request) => request.type === "execute-tool")).toBe(true));
    release();
    await first;
    expect(events.filter((event) => event.type === "run-finished")).toHaveLength(1);
    expect(requests.filter((request) => request.type === "execute-tool")).toHaveLength(1);
  });

  it("stop-run aborts the run and cancels the tool call in flight", async () => {
    const { host, events, requests } = setup([macro([{ op: "waitForTool", tool: "go", timeoutMs: 60_000 }])]);
    const run = host.startRun(TAB, "m", {});
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    host.stopRun(TAB);
    await run;
    expect(requests).toContainEqual({ type: "abort-tool" });
    expect(events.at(-1)).toMatchObject({ type: "run-finished", result: { status: "failed" } });
  });

  it("a closed tab aborts its run and forgets its tools", async () => {
    const { host, events, requests, sendToTab } = setup([macro([{ op: "waitForTool", tool: "go", timeoutMs: 60_000 }])]);
    host.setTools(TAB, [{ name: "other" }]);
    const run = host.startRun(TAB, "m", {});
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    host.removeTab(TAB);
    await run;
    expect(events.at(-1)).toMatchObject({ type: "run-finished", result: { status: "failed" } });
    sendToTab.mockRejectedValueOnce(new Error("no tab"));
    await expect(host.toolHost(TAB, new AbortController().signal).isToolAvailable("other")).resolves.toBe(false);
  });
});
