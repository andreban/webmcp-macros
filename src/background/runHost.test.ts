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

});

describe("navigation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const closedChannel = async () => {
    throw new Error("The message port closed before a response was received.");
  };

  it("treats a closed channel as a navigation and waits for the new page's report, not the old page's listing", async () => {
    const { host, tools, requests } = setup([], closedChannel);
    // The old page still answers list-tools with the tool while it unloads.
    tools.push("go");
    const toolHost = host.toolHost(TAB, new AbortController().signal);
    await expect(toolHost.callTool("go", {})).resolves.toBeNull();
    let found = false;
    const waiting = toolHost.waitForTool("go", 5000).then(() => (found = true));
    await vi.advanceTimersByTimeAsync(2000);
    expect(found).toBe(false);
    expect(requests.filter((request) => request.type === "list-tools")).toHaveLength(0);
    host.setTools(TAB, [{ name: "go" }]);
    await waiting;
  });

  it("returns null for a call the page reports as navigated, whatever its result", async () => {
    const { host } = setup([], async () => ({ ok: true, result: "bye", navigated: true }));
    const toolHost = host.toolHost(TAB, new AbortController().signal);
    await expect(toolHost.callTool("go", {})).resolves.toBeNull();
    const waiting = toolHost.waitForTool("next", 5000);
    host.setTools(TAB, [{ name: "next" }]);
    await expect(waiting).resolves.toBeUndefined();
  });

  it("does not wait after a call that stayed on the page", async () => {
    const { host, tools } = setup([], async () => ({ ok: true, result: null }));
    tools.push("next");
    const toolHost = host.toolHost(TAB, new AbortController().signal);
    await expect(toolHost.callTool("go", {})).resolves.toBeNull();
    await expect(toolHost.waitForTool("next", 5000)).resolves.toBeUndefined();
  });

  it("fails with a clear message when no new page reports in before the timeout", async () => {
    const { host } = setup([], closedChannel);
    const toolHost = host.toolHost(TAB, new AbortController().signal);
    await toolHost.callTool("go", {});
    const assertion = expect(toolHost.waitForTool("next", 3000)).rejects.toThrow(
      "The tab navigated and the new page did not report its tools within 3000 ms",
    );
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it("answers isToolAvailable from the new page's report, or false when none comes", async () => {
    const { host, tools } = setup([], closedChannel);
    const toolHost = host.toolHost(TAB, new AbortController().signal);
    await toolHost.callTool("go", {});
    const available = toolHost.isToolAvailable("next");
    tools.push("next");
    host.setTools(TAB, [{ name: "next" }]);
    await expect(available).resolves.toBe(true);

    await toolHost.callTool("go", {});
    const gone = toolHost.isToolAvailable("next");
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(gone).resolves.toBe(false);
  });

  it("runs a macro across a navigation: the macro sees null and continues on the new page", async () => {
    const program: Stmt[] = [
      { op: "call", tool: "go", saveAs: "left" },
      { op: "call", tool: "go", saveAs: "arrived" },
    ];
    let calls = 0;
    const { host, tools, events } = setup([macro(program)], async () =>
      ++calls === 1 ? { ok: true, result: null, navigated: true } : { ok: true, result: "B" },
    );
    tools.push("go");
    const run = host.startRun(TAB, "m", {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(1);
    host.setTools(TAB, [{ name: "go" }]);
    await run;
    expect(events.at(-1)).toMatchObject({
      type: "run-finished",
      result: { status: "done", toolCalls: 2, vars: { left: null, arrived: "B" } },
    });
  });

  it("fails the run with the navigation message when the new page never reports", async () => {
    const program: Stmt[] = [{ op: "call", tool: "go" }, { op: "call", tool: "go" }];
    const { host, tools, events } = setup([macro(program)], async () => ({ ok: true, result: null, navigated: true }));
    tools.push("go");
    const run = host.startRun(TAB, "m", {});
    await vi.advanceTimersByTimeAsync(10_000);
    await run;
    expect(events.at(-1)).toMatchObject({
      type: "run-finished",
      result: { status: "failed", message: expect.stringContaining("did not report its tools"), toolCalls: 1 },
    });
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

describe("frames", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const IFRAME = 3;

  /** A tab whose frames list the tools in `frames`; a frame missing from it has no listener. */
  function framedSetup(reply: (request: ContentRequest, frameId: number) => Promise<unknown> = async () => ({ ok: true, result: "ok" })) {
    const frames = new Map<number, string[]>([[0, []]]);
    const sent: { request: ContentRequest; frameId: number }[] = [];
    const sendToTab = vi.fn<RunHostDeps["sendToTab"]>(async (_tabId, request, frameId) => {
      sent.push({ request, frameId });
      const names = frames.get(frameId);
      if (!names) throw new Error("Could not establish connection. Receiving end does not exist.");
      if (request.type === "list-tools") return names.map((name) => ({ name }));
      return reply(request, frameId);
    });
    const host = createRunHost({ sendToTab, broadcast: () => {}, loadMacros: async () => [] });
    return { host, frames, sent, toolHost: host.toolHost(TAB, new AbortController().signal) };
  }

  const callsTo = (sent: { request: ContentRequest; frameId: number }[]) =>
    sent.filter(({ request }) => request.type === "execute-tool").map(({ frameId }) => frameId);

  it("finds a tool an iframe reported and calls it in that frame", async () => {
    const { host, frames, sent, toolHost } = framedSetup();
    frames.set(IFRAME, ["inner"]);
    host.setTools(TAB, [{ name: "inner" }], IFRAME, "https://widget.example");
    await expect(toolHost.isToolAvailable("inner")).resolves.toBe(true);
    await expect(toolHost.callTool("inner", {})).resolves.toBe("ok");
    expect(callsTo(sent)).toEqual([IFRAME]);
  });

  it("prefers the top frame for a shared name unless frameOrigin names the iframe", async () => {
    const { host, frames, sent, toolHost } = framedSetup();
    frames.set(0, ["save"]);
    frames.set(IFRAME, ["save"]);
    host.setTools(TAB, [{ name: "save" }], 0, "https://app.example");
    host.setTools(TAB, [{ name: "save" }], IFRAME, "https://widget.example");
    await toolHost.callTool("save", {});
    await toolHost.callTool("save", {}, "https://widget.example");
    expect(callsTo(sent)).toEqual([0, IFRAME]);
    await expect(toolHost.isToolAvailable("save", "https://other.example")).resolves.toBe(false);
  });

  it("polls known iframes and drops one that no longer answers", async () => {
    const { host, frames, toolHost } = framedSetup();
    frames.set(IFRAME, ["inner"]);
    host.setTools(TAB, [{ name: "inner" }], IFRAME);
    frames.delete(IFRAME);
    await expect(toolHost.isToolAvailable("inner")).resolves.toBe(false);
  });

  it("after an iframe navigates, forgets its old tools but keeps the top frame's", async () => {
    const { host, frames, toolHost } = framedSetup(async () => ({ ok: true, result: null, navigated: true }));
    frames.set(0, ["top"]);
    // The unloading iframe would still list its tool if it were asked.
    frames.set(IFRAME, ["inner"]);
    host.setTools(TAB, [{ name: "top" }], 0);
    host.setTools(TAB, [{ name: "inner" }], IFRAME);
    await expect(toolHost.callTool("inner", {})).resolves.toBeNull();
    await expect(toolHost.isToolAvailable("inner")).resolves.toBe(false);
    await expect(toolHost.isToolAvailable("top")).resolves.toBe(true);
    const waiting = toolHost.waitForTool("next", 5000);
    host.setTools(TAB, [{ name: "next" }], IFRAME);
    await expect(waiting).resolves.toBeUndefined();
  });

  it("drops the iframes' tools when the top frame navigates", async () => {
    const { host, frames, toolHost } = framedSetup(async () => ({ ok: true, result: null, navigated: true }));
    frames.set(0, ["go"]);
    frames.set(IFRAME, ["inner"]);
    host.setTools(TAB, [{ name: "go" }], 0);
    host.setTools(TAB, [{ name: "inner" }], IFRAME);
    await toolHost.callTool("go", {});
    // The old iframe would still answer a poll; it must not be asked.
    host.setTools(TAB, [], 0);
    await expect(toolHost.isToolAvailable("inner")).resolves.toBe(false);
  });

  it("sends abort-tool to every known frame on stop", () => {
    const { host, sent } = framedSetup();
    host.setTools(TAB, [], IFRAME);
    host.stopRun(TAB);
    expect(sent.filter(({ request }) => request.type === "abort-tool").map(({ frameId }) => frameId)).toEqual([0, IFRAME]);
  });
});
