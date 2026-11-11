import { describe, expect, it } from "vitest";
import type { Expr, Json, Macro, Stmt } from "../macro/types";
import { runMacro, type StepInfo, type ToolHost } from "./interpreter";

/** A host whose tools answer from `handlers`; only tools in `available` can be called. */
function fakeHost(handlers: Record<string, (args: Record<string, Json>) => Json> = {}) {
  const available = new Set(Object.keys(handlers));
  const calls: { name: string; args: Record<string, Json> }[] = [];
  const steps: StepInfo[] = [];
  const messages: string[] = [];
  const waits: { name: string; timeoutMs: number }[] = [];
  const host: ToolHost = {
    async callTool(name, args) {
      calls.push({ name, args });
      const handler = handlers[name];
      if (!handler) throw new Error(`unexpected tool ${name}`);
      return handler(args);
    },
    async isToolAvailable(name) {
      return available.has(name);
    },
    async waitForTool(name, timeoutMs) {
      waits.push({ name, timeoutMs });
      if (!available.has(name)) throw new Error("timeout");
    },
    message: (text) => messages.push(text),
    onStep: (step) => steps.push(step),
  };
  return { host, calls, steps, messages, waits, available };
}

function macro(program: Stmt[], tools: Macro["tools"] = {}): Macro {
  return {
    wmm: 1,
    id: "test",
    name: "Test",
    sites: { s: { match: ["*"] } },
    tools,
    trigger: { site: "s", anyOf: [] },
    program,
  };
}

/** Runs `set x = expr` and returns the value of `x`. */
async function evaluate(expr: Expr, inputs: Record<string, Json> = {}): Promise<Json | undefined> {
  const result = await runMacro(macro([{ op: "set", var: "x", value: expr }]), fakeHost().host, { inputs });
  expect(result.status).toBe("done");
  return result.vars.x;
}

const lit = (value: Json): Expr => ({ lit: value });

describe("runMacro", () => {
  it("calls a tool with evaluated arguments and saves the result", async () => {
    const fake = fakeHost({ calculate_fuel: (args) => ({ amount: Number(args.distance) * 2 }) });
    const program: Stmt[] = [
      { op: "set", var: "d", value: lit(40) },
      {
        op: "call",
        tool: "fuel",
        args: { distance: { bin: "+", left: { var: "d" }, right: lit(2) }, target: { input: "target" } },
        saveAs: "plan",
      },
      { op: "set", var: "amount", value: { get: { var: "plan" }, path: ["amount"] } },
    ];
    const tools = { fuel: { site: "s", name: "calculate_fuel" } };
    const result = await runMacro(macro(program, tools), fake.host, { inputs: { target: "Mars" }, toolTimeoutMs: 500 });

    expect(result).toEqual({ status: "done", toolCalls: 1, vars: { d: 40, plan: { amount: 84 }, amount: 84 } });
    expect(fake.calls).toEqual([{ name: "calculate_fuel", args: { distance: 42, target: "Mars" } }]);
    expect(fake.waits).toEqual([{ name: "calculate_fuel", timeoutMs: 500 }]);
    expect(fake.steps).toEqual([{ count: 1, tool: "calculate_fuel", args: { distance: 42, target: "Mars" } }]);
  });

  it("waits 10 seconds for a tool by default", async () => {
    const fake = fakeHost({ t: () => null });
    await runMacro(macro([{ op: "call", tool: "t" }], { t: { site: "s", name: "t" } }), fake.host);
    expect(fake.waits).toEqual([{ name: "t", timeoutMs: 10_000 }]);
  });

  it("calls a tool from an expression", async () => {
    const fake = fakeHost({ status: () => "IDLE" });
    const program: Stmt[] = [{ op: "set", var: "s", value: { call: "status" } }];
    const result = await runMacro(macro(program, { status: { site: "s", name: "status" } }), fake.host);
    expect(result).toMatchObject({ status: "done", toolCalls: 1, vars: { s: "IDLE" } });
  });

  it("fails on a missing input", async () => {
    const result = await runMacro(macro([{ op: "set", var: "x", value: { input: "code" } }]), fakeHost().host);
    expect(result).toEqual({ status: "failed", message: 'Missing input "code".', toolCalls: 0, vars: {} });
  });

  it("does not read inherited properties as inputs", async () => {
    const result = await runMacro(macro([{ op: "set", var: "x", value: { input: "toString" } }]), fakeHost().host);
    expect(result).toMatchObject({ status: "failed", message: 'Missing input "toString".' });
  });

  it("fails on an unset variable", async () => {
    const result = await runMacro(macro([{ op: "message", text: { var: "nope" } }]), fakeHost().host);
    expect(result).toMatchObject({ status: "failed", message: 'Variable "nope" is not set.' });
  });

  it("fails on an unknown tool alias", async () => {
    const fake = fakeHost({ t: () => null });
    const result = await runMacro(macro([{ op: "call", tool: "missing" }]), fake.host);
    expect(result).toMatchObject({ status: "failed", message: 'Unknown tool alias "missing".', toolCalls: 0 });
    expect(fake.calls).toEqual([]);
  });

  it("fails when a tool never becomes available, without calling it", async () => {
    const fake = fakeHost({ a: () => 1, b: () => 2 });
    fake.available.delete("b");
    const tools = { a: { site: "s", name: "a" }, b: { site: "s", name: "b" } };
    const program: Stmt[] = [
      { op: "call", tool: "a", saveAs: "first" },
      { op: "call", tool: "b" },
    ];
    const result = await runMacro(macro(program, tools), fake.host);
    expect(result).toEqual({
      status: "failed",
      message: 'Tool "b" never became available.',
      toolCalls: 1,
      vars: { first: 1 },
    });
    expect(fake.calls.map((c) => c.name)).toEqual(["a"]);
  });

  it("fails with the error a tool call throws", async () => {
    const host: ToolHost = { ...fakeHost({ t: () => null }).host, callTool: () => Promise.reject(new Error("Tool crashed")) };
    const result = await runMacro(macro([{ op: "call", tool: "t" }], { t: { site: "s", name: "t" } }), host);
    expect(result).toMatchObject({ status: "failed", message: "Tool crashed", toolCalls: 1 });
  });

  it("stops with a message and skips the rest of the program", async () => {
    const fake = fakeHost();
    const program: Stmt[] = [
      { op: "message", text: lit("hello") },
      { op: "stop", message: { bin: "+", left: lit("done at "), right: lit(3) } },
      { op: "message", text: lit("unreachable") },
    ];
    const result = await runMacro(macro(program), fake.host);
    expect(result).toMatchObject({ status: "stopped", message: "done at 3" });
    expect(fake.messages).toEqual(["hello"]);
  });

  it("stops without a message", async () => {
    const result = await runMacro(macro([{ op: "stop" }]), fakeHost().host);
    expect(result).toEqual({ status: "stopped", toolCalls: 0, vars: {} });
  });

  it("fails with the evaluated message", async () => {
    const program: Stmt[] = [
      { op: "set", var: "err", value: lit({ error: "Invalid code." }) },
      { op: "fail", message: { get: { var: "err" }, path: ["error"] } },
    ];
    const result = await runMacro(macro(program), fakeHost().host);
    expect(result).toMatchObject({ status: "failed", message: "Invalid code.", vars: { err: { error: "Invalid code." } } });
  });

  it("shows non-string messages as JSON", async () => {
    const fake = fakeHost();
    await runMacro(macro([{ op: "message", text: { obj: { n: lit(1) } } }]), fake.host);
    expect(fake.messages).toEqual(['{"n":1}']);
  });

  it("fails clearly on statements this runner does not handle", async () => {
    const program: Stmt[] = [{ op: "if", cond: lit(true), then: [] }];
    const result = await runMacro(macro(program), fakeHost().host);
    expect(result).toMatchObject({ status: "failed", message: 'The "if" statement is not supported yet.' });
  });
});

describe("expressions", () => {
  it.each<[string, Expr, Json]>([
    ["+", { bin: "+", left: lit(2), right: lit(3) }, 5],
    ["-", { bin: "-", left: lit(2), right: lit(3) }, -1],
    ["*", { bin: "*", left: lit(4), right: lit(3) }, 12],
    ["/", { bin: "/", left: lit(9), right: lit(2) }, 4.5],
    ["%", { bin: "%", left: lit(9), right: lit(4) }, 1],
    ["numeric strings", { bin: "*", left: lit("3"), right: lit(2) }, 6],
    ["concatenation", { bin: "+", left: lit("fuel: "), right: lit(120) }, "fuel: 120"],
    ["concatenation of JSON", { bin: "+", left: lit([1]), right: lit("!") }, "[1]!"],
    ["<", { bin: "<", left: lit(1), right: lit(2) }, true],
    ["<=", { bin: "<=", left: lit(2), right: lit(2) }, true],
    [">", { bin: ">", left: lit(1), right: lit(2) }, false],
    [">=", { bin: ">=", left: lit(1), right: lit(2) }, false],
    ["== on values", { bin: "==", left: lit({ a: [1] }), right: lit({ a: [1] }) }, true],
    ["== across types", { bin: "==", left: lit(1), right: lit("1") }, false],
    ["!=", { bin: "!=", left: lit("a"), right: lit("b") }, true],
    ["not", { not: lit([]) }, true],
    ["and", { bin: "and", left: lit(1), right: lit("") }, false],
    ["or", { bin: "or", left: lit(0), right: lit("x") }, true],
    ["obj and list", { obj: { a: { list: [lit(1), { not: lit(1) }] } } }, { a: [1, false] }],
    ["get into a list", { get: lit({ items: [{ id: 7 }] }), path: ["items", 0, "id"] }, 7],
    ["get on a missing key", { get: lit({ a: 1 }), path: ["b", "c"] }, null],
    ["get past a scalar", { get: lit({ a: 1 }), path: ["a", "b"] }, null],
    ["get out of range", { get: lit([1]), path: [5] }, null],
    ["get on an inherited key", { get: lit({}), path: ["constructor"] }, null],
  ])("%s", async (_name, expr, expected) => {
    expect(await evaluate(expr)).toEqual(expected);
  });

  it("reads inputs", async () => {
    expect(await evaluate({ input: "n" }, { n: 3 })).toBe(3);
  });

  it("short-circuits and/or so the right side is not evaluated", async () => {
    const fake = fakeHost({ t: () => true });
    const tools = { t: { site: "s", name: "t" } };
    const program: Stmt[] = [
      { op: "set", var: "a", value: { bin: "and", left: lit(false), right: { call: "t" } } },
      { op: "set", var: "o", value: { bin: "or", left: lit(true), right: { call: "t" } } },
      { op: "set", var: "both", value: { bin: "and", left: lit(true), right: { call: "t" } } },
    ];
    const result = await runMacro(macro(program, tools), fake.host);
    expect(result).toMatchObject({ status: "done", toolCalls: 1, vars: { a: false, o: true, both: true } });
  });

  it("asks the host whether a tool is available", async () => {
    const fake = fakeHost({ here: () => null });
    const tools = { here: { site: "s", name: "here" }, gone: { site: "s", name: "gone" } };
    const program: Stmt[] = [
      { op: "set", var: "here", value: { toolAvailable: "here" } },
      { op: "set", var: "gone", value: { toolAvailable: "gone" } },
    ];
    const result = await runMacro(macro(program, tools), fake.host);
    expect(result).toMatchObject({ status: "done", toolCalls: 0, vars: { here: true, gone: false } });
  });

  it("keeps __proto__ as a plain key in objects and variables", async () => {
    const program: Stmt[] = [
      { op: "set", var: "__proto__", value: lit(1) },
      { op: "set", var: "o", value: { obj: JSON.parse('{"__proto__": {"lit": 2}}') as Record<string, Expr> } },
    ];
    const result = await runMacro(macro(program), fakeHost().host);
    expect(Object.hasOwn(result.vars, "__proto__")).toBe(true);
    const o = result.vars.o;
    expect(o !== null && typeof o === "object" && Object.hasOwn(o, "__proto__")).toBe(true);
  });
});
