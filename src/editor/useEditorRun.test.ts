import { describe, expect, it } from "vitest";
import type { RunEvent } from "../messages";
import type { RunAction } from "../ui/useRun";
import { editorRunReducer, idleRun, type EditorRun } from "./useEditorRun";

const TAB = 7;
const at = (path: (string | number)[], macroId = "m", tabId = TAB): RunAction => ({
  type: "event",
  tabId: TAB,
  event: { type: "run-at", tabId, macroId, path },
});
const call = (tool: string, macroId = "m"): RunAction => ({
  type: "event",
  tabId: TAB,
  event: { type: "run-call", tabId: TAB, macroId, tool, args: { q: 1 }, result: "ok", path: ["program", 0] },
});
const finished: RunEvent = { type: "run-finished", tabId: TAB, macroId: "m", result: { status: "done", toolCalls: 1, vars: {} } };
const reduce = (actions: RunAction[], initial: EditorRun = idleRun) => actions.reduce(editorRunReducer, initial);

describe("editorRunReducer", () => {
  it("follows the executing statement and logs each call, then clears the highlight at the end", () => {
    const running = reduce([{ type: "start", macroId: "m" }, at(["program", 0]), call("go"), at(["program", 1, "then", 0])]);
    expect(running.at).toEqual(["program", 1, "then", 0]);
    expect(running.calls).toEqual([{ tool: "go", args: { q: 1 }, result: "ok" }]);
    const ended = editorRunReducer(running, { type: "event", tabId: TAB, event: finished });
    expect(ended.at).toBeUndefined();
    expect(ended.calls).toHaveLength(1);
    expect(ended.run?.result?.status).toBe("done");
  });

  it("ignores another tab and another macro's run while one is in progress", () => {
    const running = reduce([{ type: "start", macroId: "m" }, at(["program", 0])]);
    expect(editorRunReducer(running, at(["program", 3], "m", TAB + 1))).toBe(running);
    expect(editorRunReducer(running, call("other", "x"))).toBe(running);
  });

  it("starts an empty trace for a new run and when cleared", () => {
    const ended = reduce([{ type: "start", macroId: "m" }, call("go"), { type: "event", tabId: TAB, event: finished }]);
    expect(reduce([at(["program", 2], "n")], ended)).toMatchObject({ at: ["program", 2], calls: [] });
    expect(reduce([{ type: "start", macroId: "m" }], ended).calls).toEqual([]);
    expect(reduce([{ type: "clear" }], ended)).toEqual(idleRun);
  });
});
