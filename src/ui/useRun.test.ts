import { describe, expect, it } from "vitest";
import type { RunEvent } from "../messages";
import type { RunResult } from "../runner/interpreter";
import { resultLine, runReducer, type RunAction, type RunState } from "./useRun";

const done = (overrides: Partial<RunResult> = {}): RunResult => ({ status: "done", toolCalls: 3, vars: {}, ...overrides });

const step = (count: number, tool: string, macroId = "m1", tabId = 7): RunEvent => ({
  type: "run-step",
  tabId,
  macroId,
  count,
  tool,
});
const message = (text: string, macroId = "m1", tabId = 7): RunEvent => ({ type: "run-message", tabId, macroId, text });
const finished = (result: RunResult, macroId = "m1", tabId = 7): RunEvent => ({
  type: "run-finished",
  tabId,
  macroId,
  result,
});

function reduce(actions: RunAction[], initial: RunState | null = null): RunState | null {
  return actions.reduce(runReducer, initial);
}

const event = (e: RunEvent, tabId?: number): RunAction => ({ type: "event", event: e, tabId });

describe("runReducer", () => {
  it("starts a run with no step or messages", () => {
    expect(reduce([{ type: "start", macroId: "m1" }])).toEqual({ macroId: "m1", messages: [] });
  });

  it("restarts from scratch, dropping a previous run's state", () => {
    const previous: RunState = { macroId: "m1", messages: ["old"], result: done() };
    expect(runReducer(previous, { type: "start", macroId: "m2" })).toEqual({ macroId: "m2", messages: [] });
  });

  it("tracks the latest step's count and tool", () => {
    const state = reduce([{ type: "start", macroId: "m1" }, event(step(1, "search")), event(step(2, "book"))]);
    expect(state).toEqual({ macroId: "m1", messages: [], step: { count: 2, tool: "book" } });
  });

  it("appends messages in order without losing the step", () => {
    const state = reduce([
      { type: "start", macroId: "m1" },
      event(step(1, "search")),
      event(message("a")),
      event(message("b")),
    ]);
    expect(state).toEqual({ macroId: "m1", messages: ["a", "b"], step: { count: 1, tool: "search" } });
  });

  it("finishes with the result and keeps step and messages", () => {
    const result = done({ message: "ok" });
    const state = reduce([{ type: "start", macroId: "m1" }, event(step(1, "x")), event(message("hi")), event(finished(result))]);
    expect(state).toEqual({ macroId: "m1", messages: ["hi"], step: { count: 1, tool: "x" }, result });
  });

  it("clears to idle", () => {
    expect(reduce([{ type: "start", macroId: "m1" }, { type: "clear" }])).toBeNull();
  });

  it("ignores events for another tab when following one", () => {
    const start = runReducer(null, { type: "start", macroId: "m1" });
    expect(runReducer(start, event(step(1, "x", "m1", 8), 7))).toBe(start);
    expect(runReducer(null, event(message("hi", "m1", 8), 7))).toBeNull();
  });

  it("accepts events from any tab when no tab is given", () => {
    expect(reduce([event(step(1, "x", "m1", 99))])).toEqual({ macroId: "m1", messages: [], step: { count: 1, tool: "x" } });
  });

  it("ignores events for another macro while a run is in progress", () => {
    const start = reduce([{ type: "start", macroId: "m1" }, event(message("mine"))]);
    expect(runReducer(start, event(step(1, "x", "m2")))).toBe(start);
    expect(runReducer(start, event(finished(done(), "m2")))).toBe(start);
  });

  it("follows a run started elsewhere when idle", () => {
    expect(reduce([event(message("hello", "m2"), 7)], null)).toEqual({ macroId: "m2", messages: ["hello"] });
  });

  it("follows a new run after the previous one finished, starting fresh", () => {
    const ended = reduce([{ type: "start", macroId: "m1" }, event(message("old")), event(finished(done()))]);
    expect(runReducer(ended, event(step(1, "y", "m2")))).toEqual({ macroId: "m2", messages: [], step: { count: 1, tool: "y" } });
    // A rerun of the same macro also starts fresh rather than reopening the old result.
    expect(runReducer(ended, event(step(1, "y")))).toEqual({ macroId: "m1", messages: [], step: { count: 1, tool: "y" } });
  });
});

describe("resultLine", () => {
  const base: RunState = { macroId: "m1", messages: [] };

  it("says starting before the first step", () => {
    expect(resultLine(base)).toBe("Starting…");
  });

  it("shows the step in progress", () => {
    expect(resultLine({ ...base, step: { count: 2, tool: "book_flight" } })).toBe("Step 2: book_flight");
  });

  it("shows a failure with its message, or a fallback", () => {
    const messages = ["earlier"];
    expect(resultLine({ ...base, messages, result: done({ status: "failed", message: "Tool missing" }) })).toBe(
      "Failed: Tool missing",
    );
    expect(resultLine({ ...base, messages, result: done({ status: "failed" }) })).toBe("Failed: unknown error");
  });

  it("shows the stop message over the last message", () => {
    expect(resultLine({ ...base, messages: ["m"], result: done({ status: "stopped", message: "No seats" }) })).toBe(
      "No seats",
    );
  });

  it("shows the last message when the result has none", () => {
    expect(resultLine({ ...base, messages: ["first", "last"], result: done({ status: "stopped" }) })).toBe("last");
  });

  it("falls back to the done text with the tool call count", () => {
    expect(resultLine({ ...base, step: { count: 3, tool: "x" }, result: done() })).toBe("Done in 3 tool calls.");
  });
});
