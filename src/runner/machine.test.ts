// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { Expr, Json, Macro, Stmt } from "../macro/types";
import { runMacro, startRun, step, type ToolHost } from "./interpreter";
import { locate, statementPath, type Loop, type RunState } from "./machine";

const lit = (value: Json): Expr => ({ lit: value });
const v = (name: string): Expr => ({ var: name });
const add = (name: string, value: Expr): Stmt => ({ op: "set", var: name, value: { bin: "+", left: v(name), right: value } });

function macro(program: Stmt[]): Macro {
  return {
    wmm: 1,
    id: "test",
    name: "Test",
    sites: { s: { match: ["*"] } },
    tools: { double: { site: "s", name: "double" } },
    trigger: { site: "s", anyOf: [] },
    program,
  };
}

/** A host with one tool, `double`, that records what it was called with. */
function fakeHost() {
  const calls: Json[] = [];
  const host: ToolHost = {
    async callTool(_name, args) {
      calls.push(args.x ?? null);
      return Number(args.x) * 2;
    },
    isToolAvailable: async () => true,
    waitForTool: async () => {},
  };
  return { host, calls };
}

// Every kind of block: loops of each kind, both branches of an `if`, nested.
const program: Stmt[] = [
  { op: "set", var: "sum", value: lit(0) },
  { op: "set", var: "log", value: lit([]) },
  {
    op: "forEach",
    list: lit([1, 2, 3]),
    var: "n",
    body: [
      {
        op: "if",
        cond: { bin: "==", left: { bin: "%", left: v("n"), right: lit(2) }, right: lit(1) },
        then: [
          { op: "call", tool: "double", args: { x: v("n") }, saveAs: "d" },
          add("sum", v("d")),
        ],
        else: [{ op: "push", var: "log", value: v("n") }],
      },
    ],
  },
  { op: "repeat", times: lit(2), body: [add("sum", lit(100))] },
  { op: "while", cond: { bin: "<", left: v("sum"), right: lit(250) }, body: [add("sum", lit(10))] },
];

async function runToEnd(state: RunState, host: ToolHost): Promise<RunState> {
  while (state.status === "running") state = await step(state, host);
  return state;
}

describe("step", () => {
  it("continues a run from its JSON after any step to the same result", async () => {
    const reference = fakeHost();
    const expected = await runMacro(macro(program), reference.host);
    expect(expected).toMatchObject({ status: "done", toolCalls: 2, vars: { sum: 258, log: [2] } });

    let midLoop = false;
    let midIf = false;
    for (let stopAfter = 0; ; stopAfter++) {
      const fake = fakeHost();
      let state = startRun(macro(program));
      for (let i = 0; i < stopAfter && state.status === "running"; i++) state = await step(state, fake.host);
      if (state.status !== "running") break;
      midLoop ||= state.frames.some((frame) => frame.loop !== undefined);
      midIf ||= state.frames.some((frame) => frame.branch === "then" || frame.branch === "else");

      const restored: RunState = JSON.parse(JSON.stringify(state));
      const final = await runToEnd(restored, fake.host);
      expect(final).toMatchObject({ status: expected.status, toolCalls: expected.toolCalls, vars: expected.vars });
      expect(fake.calls).toEqual(reference.calls);
    }
    expect(midLoop && midIf).toBe(true);
  });

  it("pauses inside a procedure and resumes from JSON without repeating tool calls", async () => {
    // r = double(1) + quad(3) + quad(1), where quad calls double twice.
    const quad = { callProc: "quad", args: { x: lit(3) } };
    const withProcs: Macro = {
      ...macro([
        {
          op: "set",
          var: "r",
          value: {
            bin: "+",
            left: { bin: "+", left: { call: "double", args: { x: lit(1) } }, right: quad },
            right: { ...quad, args: { x: lit(1) } },
          },
        },
      ]),
      procedures: {
        quad: {
          params: ["x"],
          body: [
            { op: "call", tool: "double", args: { x: v("x") }, saveAs: "d" },
            { op: "return", value: { call: "double", args: { x: v("d") } } },
          ],
        },
      },
    };
    const reference = fakeHost();
    expect(await runMacro(withProcs, reference.host)).toMatchObject({ status: "done", vars: { r: 18 } });
    expect(reference.calls).toEqual([1, 3, 6, 1, 2]);

    let paused = false;
    for (let stopAfter = 0; ; stopAfter++) {
      const fake = fakeHost();
      let state = startRun(withProcs);
      for (let i = 0; i < stopAfter && state.status === "running"; i++) {
        const before = JSON.stringify(state);
        const next = await step(state, fake.host);
        expect(JSON.stringify(state)).toBe(before);
        state = next;
      }
      if (state.status !== "running") break;
      const call = state.frames.at(-1)?.call;
      if (call) {
        paused = true;
        expect(call).toMatchObject({ proc: "quad", locals: { x: expect.any(Number) } });
      }
      const restored: RunState = JSON.parse(JSON.stringify(state));
      expect(await runToEnd(restored, fake.host)).toMatchObject({ status: "done", toolCalls: 5, vars: { r: 18 } });
      expect(fake.calls).toEqual(reference.calls);
    }
    expect(paused).toBe(true);
  });

  it("leaves the state it was given unchanged", async () => {
    let state = startRun(macro(program));
    const { host } = fakeHost();
    while (state.status === "running") {
      const before = JSON.stringify(state);
      const next = await step(state, host);
      expect(JSON.stringify(state)).toBe(before);
      state = next;
    }
  });

  it("returns a finished state as it is", async () => {
    const done = await runToEnd(startRun(macro([])), fakeHost().host);
    expect(done.status).toBe("done");
    expect(await step(done, fakeHost().host)).toBe(done);
  });

  it("keeps an endless repeat serialisable and ends it at the step limit", async () => {
    let state = startRun(macro([{ op: "repeat", times: { bin: "/", left: lit(1), right: lit(0) }, body: [] }]), { maxSteps: 5 });
    state = await step(state, fakeHost().host);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(await runToEnd(state, fakeHost().host)).toMatchObject({ status: "failed", message: "Step limit of 5 reached." });
  });

  it("fails a run whose frames do not fit the macro", async () => {
    const state: RunState = { ...startRun(macro(program)), frames: [{ pc: 0 }, { branch: "body", pc: 0 }] };
    expect(await step(state, fakeHost().host)).toMatchObject({
      status: "failed",
      message: "The saved run does not match its macro.",
    });
  });
});

describe("locate", () => {
  it("finds the block of the top frame and its owner", () => {
    const owner = program[2];
    const found = locate(macro(program), [{ pc: 2 }, { branch: "body", pc: 0, loop: { kind: "forEach", i: 0, items: [1] } }]);
    expect(found?.owner).toBe(owner);
    expect(found?.block).toBe(owner?.op === "forEach" ? owner.body : undefined);
    expect(locate(macro(program), [{ pc: 2 }, { branch: "then", pc: 0 }])).toBeUndefined();
    expect(locate(macro(program), [{ pc: 9 }, { branch: "body", pc: 0 }])).toBeUndefined();
  });
});

describe("statementPath", () => {
  const m = macro(program);
  const loop: Loop = { kind: "forEach", i: 0, items: [1] };

  it("walks the frames into nested blocks and procedure bodies", () => {
    expect(statementPath(m, [{ pc: 1 }])).toEqual(["program", 1]);
    expect(statementPath(m, [{ pc: 2 }, { branch: "body", pc: 0, loop }])).toEqual(["program", 2, "body", 0]);
    const call = { proc: "p", slot: 0, locals: {} };
    expect(statementPath(m, [{ pc: 2 }, { pc: 3, call }, { branch: "then", pc: 1 }])).toEqual(["procedures", "p", "body", 3, "then", 1]);
  });

  it("names the owner at the end of a block, where loops decide to go round", () => {
    const owner = program[2];
    const end = owner?.op === "forEach" ? owner.body.length : -1;
    expect(statementPath(m, [{ pc: 2 }, { branch: "body", pc: end, loop }])).toEqual(["program", 2]);
  });
});
