import { describe, expect, it, vi } from "vitest";
import type { ContentRequest, RunEvent } from "../messages";
import type { Macro, Stmt, ToolInfo } from "../macro/types";
import { startRun } from "../runner/interpreter";
import { createRunHost } from "./runHost";
import { createRunStore, resumeState, type RunStorageArea } from "./runStore";

const TAB = 7;

function macro(program: Stmt[]): Macro {
  return {
    wmm: 1,
    id: "m",
    name: "Test",
    sites: { s: { match: ["*"] } },
    tools: { read: { site: "s", name: "read" }, write: { site: "s", name: "write" } },
    trigger: { site: "s", anyOf: [] },
    program,
  };
}

/** An in-memory storage area that round-trips values through JSON, as Chrome does. */
function fakeArea() {
  const data = new Map<string, string>();
  const area: RunStorageArea = {
    async get() {
      return Object.fromEntries([...data].map(([key, raw]) => [key, JSON.parse(raw)]));
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, JSON.stringify(value));
    },
    async remove(key) {
      data.delete(key);
    },
  };
  return { data, area };
}

describe("runStore", () => {
  it("saves a run per tab and loads it back", async () => {
    const { area } = fakeArea();
    const store = createRunStore(area);
    const state = startRun(macro([]), { inputs: { a: 1 } });
    await store.save(TAB, state, ["read"]);
    await store.save(TAB + 1, state);
    expect(await store.loadAll()).toEqual([
      { tabId: TAB, state, inFlight: ["read"] },
      { tabId: TAB + 1, state },
    ]);
    await store.remove(TAB);
    expect((await store.loadAll()).map((run) => run.tabId)).toEqual([TAB + 1]);
  });

  it("drops entries that are unreadable or finished, and ignores other keys", async () => {
    const { data, area } = fakeArea();
    const store = createRunStore(area);
    data.set("run:1", JSON.stringify({ tabId: 1, state: { status: "running" } }));
    data.set("run:2", JSON.stringify({ tabId: 2, state: { ...startRun(macro([])), status: "done" } }));
    data.set("run:3", JSON.stringify({ tabId: 3, state: startRun(macro([])), inFlight: [1] }));
    data.set("other", "1");
    expect(await store.loadAll()).toEqual([]);
    expect([...data.keys()]).toEqual(["other"]);
  });
});

describe("resumeState", () => {
  const state = startRun(macro([]));
  const tools: ToolInfo[] = [{ name: "read", annotations: { readOnlyHint: true } }, { name: "write" }];

  it("continues a run saved between steps", () => {
    expect(resumeState({ tabId: TAB, state }, [])).toBe(state);
  });

  it("repeats an interrupted step whose calls are all read-only", () => {
    expect(resumeState({ tabId: TAB, state, inFlight: ["read"] }, tools)).toBe(state);
  });

  it("fails when an interrupted call is not read-only, or its tool is not listed", () => {
    for (const inFlight of [["read", "write"], ["gone"]]) {
      const resumed = resumeState({ tabId: TAB, state, inFlight }, tools);
      expect(resumed.status).toBe("failed");
      expect(resumed.message).toContain(`"${inFlight.at(-1)}" was running`);
    }
  });
});

describe("a worker restart mid-run", () => {
  /**
   * Runs `program` on a first host until a call to `hangOn` never answers,
   * as when Chrome stops the worker, then resumes it on a second host that
   * shares only the storage area, as a new worker would.
   */
  async function restartDuring(program: Stmt[], hangOn: string, tools: ToolInfo[]) {
    const { area, data } = fakeArea();
    const calls: string[] = [];
    const tab = (hang: boolean) =>
      vi.fn(async (_tabId: number, request: ContentRequest): Promise<unknown> => {
        if (request.type === "list-tools") return tools;
        if (request.type !== "execute-tool") return undefined;
        calls.push(request.name);
        if (hang && request.name === hangOn) return new Promise(() => {});
        return { ok: true, result: request.name };
      });
    const first = createRunHost({ sendToTab: tab(true), broadcast: () => {}, loadMacros: async () => [macro(program)], store: createRunStore(area) });
    void first.startRun(TAB, "m", {});
    await vi.waitFor(() => expect(calls).toContain(hangOn));

    const store = createRunStore(area);
    const events: RunEvent[] = [];
    const second = createRunHost({ sendToTab: tab(false), broadcast: (event) => events.push(event), loadMacros: async () => [], store });
    const [saved] = await store.loadAll();
    if (!saved) throw new Error("No saved run.");
    second.setTools(TAB, tools);
    await second.resumeRun(TAB, resumeState(saved, tools));
    return { calls, events, data };
  }

  const program: Stmt[] = [
    { op: "call", tool: "write", saveAs: "w" },
    { op: "call", tool: "read", saveAs: "r" },
  ];

  it("repeats a read-only call in flight, and not the steps before it", async () => {
    const tools = [{ name: "read", annotations: { readOnlyHint: true } }, { name: "write" }];
    const { calls, events, data } = await restartDuring(program, "read", tools);
    expect(calls).toEqual(["write", "read", "read"]);
    expect(events.at(-1)).toMatchObject({ result: { status: "done", toolCalls: 2, vars: { w: "write", r: "read" } } });
    expect(data.size).toBe(0);
  });

  it("fails cleanly rather than repeat a call that may have had effects", async () => {
    const { calls, events, data } = await restartDuring(program, "write", [{ name: "read" }, { name: "write" }]);
    expect(calls).toEqual(["write"]);
    expect(events.at(-1)).toMatchObject({ type: "run-finished", result: { status: "failed", message: expect.stringContaining('"write" was running') } });
    expect(data.size).toBe(0);
  });
});
