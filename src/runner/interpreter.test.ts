import { afterEach, describe, expect, it, vi } from "vitest";
import type { Expr, Json, Macro, Stmt } from "../macro/types";
import { DEFAULT_MAX_STEPS, runMacro, type StepInfo, type ToolHost } from "./interpreter";

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
});

const v = (name: string): Expr => ({ var: name });
const add = (name: string, amount: Expr): Stmt => ({
  op: "set",
  var: name,
  value: { bin: "+", left: v(name), right: amount },
});

describe("control flow", () => {
  it("takes the then or the else branch", async () => {
    const program: Stmt[] = [
      {
        op: "if",
        cond: lit(1),
        then: [{ op: "set", var: "a", value: lit("then") }],
        else: [{ op: "set", var: "a", value: lit("else") }],
      },
      {
        op: "if",
        cond: lit(""),
        then: [{ op: "set", var: "b", value: lit("then") }],
        else: [{ op: "set", var: "b", value: lit("else") }],
      },
      { op: "if", cond: lit([]), then: [{ op: "set", var: "c", value: lit("then") }] },
    ];
    const result = await runMacro(macro(program), fakeHost().host);
    expect(result).toMatchObject({ status: "done", vars: { a: "then", b: "else" } });
    expect(result.vars).not.toHaveProperty("c");
  });

  it("repeats a body the evaluated number of times", async () => {
    const program: Stmt[] = [
      { op: "set", var: "n", value: lit(0) },
      { op: "repeat", times: { bin: "+", left: lit(1), right: lit(2) }, body: [add("n", lit(1))] },
      { op: "repeat", times: lit("not a number"), body: [add("n", lit(100))] },
    ];
    expect(await runMacro(macro(program), fakeHost().host)).toMatchObject({ status: "done", vars: { n: 3 } });
  });

  it("loops while the condition holds", async () => {
    const program: Stmt[] = [
      { op: "set", var: "n", value: lit(0) },
      { op: "while", cond: { bin: "<", left: v("n"), right: lit(5) }, body: [add("n", lit(2))] },
    ];
    expect(await runMacro(macro(program), fakeHost().host)).toMatchObject({ status: "done", vars: { n: 6 } });
  });

  it("binds each list item in forEach", async () => {
    const program: Stmt[] = [
      { op: "set", var: "sum", value: lit(0) },
      { op: "forEach", list: lit([1, 2, 3]), var: "item", body: [add("sum", v("item"))] },
    ];
    expect(await runMacro(macro(program), fakeHost().host)).toMatchObject({
      status: "done",
      vars: { sum: 6, item: 3 },
    });
  });

  it("fails forEach over something that is not a list", async () => {
    const program: Stmt[] = [{ op: "forEach", list: lit({ a: 1 }), var: "x", body: [] }];
    const result = await runMacro(macro(program), fakeHost().host);
    expect(result).toMatchObject({ status: "failed", message: "forEach needs a list." });
  });

  it("stops from inside a loop", async () => {
    const program: Stmt[] = [{ op: "while", cond: lit(true), body: [{ op: "stop", message: lit("out") }] }];
    expect(await runMacro(macro(program), fakeHost().host)).toMatchObject({ status: "stopped", message: "out" });
  });

  it("waits for a tool with its own timeout or the default", async () => {
    const fake = fakeHost({ t: () => null });
    const tools = { t: { site: "s", name: "t" }, gone: { site: "s", name: "gone" } };
    const program: Stmt[] = [
      { op: "waitForTool", tool: "t", timeoutMs: 2500 },
      { op: "waitForTool", tool: "t" },
      { op: "waitForTool", tool: "gone" },
    ];
    const result = await runMacro(macro(program, tools), fake.host, { toolTimeoutMs: 700 });
    expect(result).toMatchObject({ status: "failed", message: 'Tool "gone" never became available.', toolCalls: 0 });
    expect(fake.waits).toEqual([
      { name: "t", timeoutMs: 2500 },
      { name: "t", timeoutMs: 700 },
      { name: "gone", timeoutMs: 700 },
    ]);
  });
});

describe("limits", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const tools = { t: { site: "s", name: "t" } };
  const forever: Stmt[] = [{ op: "while", cond: lit(true), body: [{ op: "call", tool: "t" }] }];

  it("fails a while-true loop at the step limit", async () => {
    const fake = fakeHost({ t: () => null });
    const result = await runMacro(macro(forever, tools), fake.host, { maxSteps: 50 });
    // Each iteration is one loop step plus one tool call.
    expect(result).toMatchObject({ status: "failed", message: "Step limit of 50 reached.", toolCalls: 25 });
  });

  it("counts empty loop iterations, with a default limit of 3000", async () => {
    const program: Stmt[] = [{ op: "while", cond: lit(true), body: [] }];
    const result = await runMacro(macro(program), fakeHost().host);
    expect(DEFAULT_MAX_STEPS).toBe(3000);
    expect(result).toMatchObject({ status: "failed", message: `Step limit of ${DEFAULT_MAX_STEPS} reached.` });
  });

  it("allows exactly maxSteps steps", async () => {
    const program: Stmt[] = [{ op: "repeat", times: lit(2), body: [{ op: "call", tool: "t" }] }];
    const result = await runMacro(macro(program, tools), fakeHost({ t: () => null }).host, { maxSteps: 4 });
    expect(result).toMatchObject({ status: "done", toolCalls: 2 });
  });

  it("stops mid-run when aborted and reports the calls made", async () => {
    const controller = new AbortController();
    let count = 0;
    const fake = fakeHost({
      t: () => {
        if (++count === 3) controller.abort();
        return count;
      },
    });
    const result = await runMacro(macro(forever, tools), fake.host, { signal: controller.signal });
    expect(result).toMatchObject({ status: "failed", message: "Stopped by the user.", toolCalls: 3 });
    expect(fake.calls).toHaveLength(3);
  });

  it("does not start when already aborted", async () => {
    const fake = fakeHost({ t: () => null });
    const result = await runMacro(macro([{ op: "call", tool: "t" }], tools), fake.host, {
      signal: AbortSignal.abort(),
    });
    expect(result).toEqual({ status: "failed", message: "Stopped by the user.", toolCalls: 0, vars: {} });
    expect(fake.calls).toEqual([]);
  });

  it("pauses for wait", async () => {
    vi.useFakeTimers();
    const program: Stmt[] = [
      { op: "wait", ms: 1000 },
      { op: "set", var: "after", value: lit(true) },
    ];
    let settled = false;
    const run = runMacro(macro(program), fakeHost().host).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await run).toMatchObject({ status: "done", vars: { after: true } });
  });

  it("ends a wait as soon as the run is aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const program: Stmt[] = [
      { op: "wait", ms: 60_000 },
      { op: "set", var: "after", value: lit(true) },
    ];
    const run = runMacro(macro(program), fakeHost().host, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    expect(await run).toEqual({ status: "failed", message: "Stopped by the user.", toolCalls: 0, vars: {} });
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** A stand-in for the rocket demo in dynamic mode: each tool is registered only in its state. */
function fakeRocket(authCode: string, initialStatus = "IDLE") {
  let status = initialStatus;
  const calls: string[] = [];
  const always = ["get_page_state", "calculate_fuel", "reset_system"];
  const byState: Record<string, string[]> = {
    IDLE: ["run_diagnostics"],
    DIAGNOSTICS: ["load_fuel"],
    FUELED: ["prepare_launch"],
    PREPARED: ["ignite_engines"],
  };
  const available = (name: string) => always.includes(name) || (byState[status] ?? []).includes(name);
  const host: ToolHost = {
    async isToolAvailable(name) {
      return available(name);
    },
    async waitForTool(name) {
      if (!available(name)) throw new Error("timeout");
    },
    async callTool(name, args): Promise<Json> {
      if (!available(name)) throw new Error(`tool ${name} is not registered`);
      calls.push(name);
      switch (name) {
        case "get_page_state":
          return { status };
        case "reset_system":
          status = "IDLE";
          return { status };
        case "calculate_fuel":
          return { trajectory: args.trajectory ?? null, amount: 120, oxidizerRatio: 2.5 };
        case "run_diagnostics":
          status = "DIAGNOSTICS";
          return { status };
        case "load_fuel":
          if (args.amount !== 120 || args.oxidizer_ratio !== 2.5) return { error: "Bad fuel." };
          status = "FUELED";
          return { status };
        case "prepare_launch":
          if (args.auth_code !== authCode) return { error: "Invalid authorization code." };
          status = "PREPARED";
          return { status };
        case "ignite_engines":
          status = "LAUNCHED";
          return { status };
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
  return { host, calls, status: () => status };
}

const rocketMacro = macro(
  [
    { op: "call", tool: "state", saveAs: "state" },
    {
      op: "if",
      cond: { bin: "!=", left: { get: v("state"), path: ["status"] }, right: lit("IDLE") },
      then: [{ op: "call", tool: "reset" }],
    },
    { op: "call", tool: "diagnostics" },
    { op: "call", tool: "fuelPlan", args: { trajectory: { input: "trajectory" } }, saveAs: "plan" },
    {
      op: "call",
      tool: "loadFuel",
      args: {
        amount: { get: v("plan"), path: ["amount"] },
        oxidizer_ratio: { get: v("plan"), path: ["oxidizerRatio"] },
      },
    },
    { op: "call", tool: "prepare", args: { auth_code: { input: "authCode" } }, saveAs: "prepared" },
    {
      op: "if",
      cond: { get: v("prepared"), path: ["error"] },
      then: [{ op: "fail", message: { get: v("prepared"), path: ["error"] } }],
    },
    { op: "call", tool: "ignite" },
  ],
  {
    state: { site: "s", name: "get_page_state" },
    reset: { site: "s", name: "reset_system" },
    diagnostics: { site: "s", name: "run_diagnostics" },
    fuelPlan: { site: "s", name: "calculate_fuel" },
    loadFuel: { site: "s", name: "load_fuel" },
    prepare: { site: "s", name: "prepare_launch" },
    ignite: { site: "s", name: "ignite_engines" },
  },
);

describe("rocket macro", () => {
  it("drives the rocket to LAUNCHED through tools that appear per state", async () => {
    const rocket = fakeRocket("1234");
    const result = await runMacro(rocketMacro, rocket.host, { inputs: { trajectory: "Mars", authCode: "1234" } });
    expect(result).toMatchObject({ status: "done", toolCalls: 6 });
    expect(rocket.status()).toBe("LAUNCHED");
    expect(rocket.calls).toEqual([
      "get_page_state",
      "run_diagnostics",
      "calculate_fuel",
      "load_fuel",
      "prepare_launch",
      "ignite_engines",
    ]);
  });

  it("resets first when the rocket is not idle", async () => {
    const rocket = fakeRocket("1234", "FUELED");
    const result = await runMacro(rocketMacro, rocket.host, { inputs: { trajectory: "Moon", authCode: "1234" } });
    expect(result.status).toBe("done");
    expect(rocket.calls.slice(0, 3)).toEqual(["get_page_state", "reset_system", "run_diagnostics"]);
    expect(rocket.status()).toBe("LAUNCHED");
  });

  it("fails with the tool's error on a wrong authorization code", async () => {
    const rocket = fakeRocket("1234");
    const result = await runMacro(rocketMacro, rocket.host, { inputs: { trajectory: "Moon", authCode: "0000" } });
    expect(result).toMatchObject({ status: "failed", message: "Invalid authorization code.", toolCalls: 5 });
    expect(rocket.status()).toBe("FUELED");
    expect(rocket.calls).not.toContain("ignite_engines");
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

describe("data operations", () => {
  /** Runs the program and returns the failure message. */
  async function failure(program: Stmt[]): Promise<string | undefined> {
    const result = await runMacro(macro(program), fakeHost().host);
    expect(result.status).toBe("failed");
    return result.message;
  }

  const dict = lit({ a: 1, b: { c: 2 } });

  it("reads keys and list items, with null when missing", async () => {
    expect(await evaluate({ getKey: dict, key: { bin: "+", left: lit("b"), right: lit("") } })).toEqual({ c: 2 });
    expect(await evaluate({ getKey: dict, key: lit("z") })).toBeNull();
    expect(await evaluate({ getKey: dict, key: lit("constructor") })).toBeNull();
    expect(await evaluate({ getKey: lit(["x", "y"]), key: lit(1) })).toBe("y");
    expect(await evaluate({ getKey: lit(["x", "y"]), key: lit(2) })).toBeNull();
  });

  it("tells whether a key or index exists", async () => {
    expect(await evaluate({ hasKey: dict, key: lit("a") })).toBe(true);
    expect(await evaluate({ hasKey: dict, key: lit("toString") })).toBe(false);
    expect(await evaluate({ hasKey: lit([null]), key: lit(0) })).toBe(true);
    expect(await evaluate({ hasKey: lit([null]), key: lit(-1) })).toBe(false);
  });

  it("measures lists, strings and dictionaries", async () => {
    expect(await evaluate({ length: lit([1, 2, 3]) })).toBe(3);
    expect(await evaluate({ length: lit("abcd") })).toBe(4);
    expect(await evaluate({ length: dict })).toBe(2);
  });

  it("finds equal items in lists and substrings in strings", async () => {
    expect(await evaluate({ contains: lit([1, { x: [2] }]), item: lit({ x: [2] }) })).toBe(true);
    expect(await evaluate({ contains: lit([1, 2]), item: lit("1") })).toBe(false);
    expect(await evaluate({ contains: lit("north,east"), item: lit("east") })).toBe(true);
  });

  it("lists a dictionary's keys", async () => {
    expect(await evaluate({ keys: dict })).toEqual(["a", "b"]);
  });

  it("fails expressions on the wrong type with a clear message", async () => {
    const set = (value: Expr): Stmt[] => [{ op: "set", var: "x", value }];
    expect(await failure(set({ getKey: lit(5), key: lit("a") }))).toBe("getKey needs a dictionary or a list, got a number.");
    expect(await failure(set({ getKey: dict, key: lit(1) }))).toBe("getKey on a dictionary needs a string key, got a number.");
    expect(await failure(set({ hasKey: lit([]), key: lit("0") }))).toBe("hasKey on a list needs an integer index, got a string.");
    expect(await failure(set({ hasKey: lit([]), key: lit(0.5) }))).toBe("hasKey on a list needs an integer index, got a number.");
    expect(await failure(set({ length: lit(null) }))).toBe("length needs a list, a string or a dictionary, got null.");
    expect(await failure(set({ contains: dict, item: lit("a") }))).toBe("contains needs a list or a string, got a dictionary.");
    expect(await failure(set({ contains: lit("abc"), item: lit(1) }))).toBe("contains on a string needs a string, got a number.");
    expect(await failure(set({ keys: lit([1]) }))).toBe("keys needs a dictionary, got a list.");
  });

  it("sets keys, pushes and pops without changing shared values", async () => {
    const program: Stmt[] = [
      { op: "set", var: "d", value: lit({ a: 1 }) },
      { op: "set", var: "alias", value: v("d") },
      { op: "setKey", var: "d", key: lit("a"), value: lit(2) },
      { op: "setKey", var: "d", key: lit("__proto__"), value: lit(3) },
      { op: "set", var: "q", value: lit([1, 2, 3]) },
      { op: "set", var: "qAlias", value: v("q") },
      { op: "push", var: "q", value: lit(4) },
      { op: "popFront", var: "q", saveAs: "first" },
      { op: "popBack", var: "q", saveAs: "last" },
      { op: "popBack", var: "q" },
    ];
    const run = () => runMacro(macro(program), fakeHost().host);
    const result = await run();
    expect(result).toMatchObject({ status: "done", vars: { alias: { a: 1 }, q: [2], qAlias: [1, 2, 3], first: 1, last: 4 } });
    const d = result.vars.d;
    expect(d !== null && typeof d === "object" && !Array.isArray(d) && Object.hasOwn(d, "__proto__")).toBe(true);
    expect(JSON.stringify(d)).toBe('{"a":2,"__proto__":3}');
    // The literals in the program are untouched, so a second run starts the same.
    expect((await run()).vars).toEqual(result.vars);
  });

  it("fails data statements on the wrong type, an unset variable or an empty list", async () => {
    const withVar = (value: Json, stmt: Stmt): Stmt[] => [{ op: "set", var: "x", value: lit(value) }, stmt];
    expect(await failure(withVar([], { op: "setKey", var: "x", key: lit("a"), value: lit(1) }))).toBe(
      'setKey needs a dictionary in "x", got a list.',
    );
    expect(await failure(withVar({}, { op: "setKey", var: "x", key: lit(1), value: lit(1) }))).toBe(
      "setKey needs a string key, got a number.",
    );
    expect(await failure(withVar({}, { op: "push", var: "x", value: lit(1) }))).toBe('push needs a list in "x", got a dictionary.');
    expect(await failure(withVar("ab", { op: "popFront", var: "x" }))).toBe('popFront needs a list in "x", got a string.');
    expect(await failure(withVar([], { op: "popBack", var: "x" }))).toBe('popBack needs a non-empty list; "x" is empty.');
    expect(await failure([{ op: "push", var: "nope", value: lit(1) }])).toBe('Variable "nope" is not set.');
  });

  // A small maze as the maze macro would record it: each cell maps to the
  // cells reachable from it. Dead end at 2,0; exit at 2,2.
  const grid = lit({
    "0,0": ["1,0"],
    "1,0": ["0,0", "2,0", "1,1"],
    "2,0": ["1,0"],
    "1,1": ["1,0", "1,2"],
    "1,2": ["1,1", "2,2"],
    "2,2": ["1,2"],
  });

  it("expresses a breadth-first search for the shortest path", async () => {
    const program: Stmt[] = [
      { op: "set", var: "grid", value: grid },
      { op: "set", var: "prev", value: lit({ "0,0": null }) },
      { op: "set", var: "queue", value: lit(["0,0"]) },
      {
        op: "while",
        cond: { bin: ">", left: { length: v("queue") }, right: lit(0) },
        body: [
          { op: "popFront", var: "queue", saveAs: "cell" },
          {
            op: "forEach",
            list: { getKey: v("grid"), key: v("cell") },
            var: "next",
            body: [
              {
                op: "if",
                cond: { not: { hasKey: v("prev"), key: v("next") } },
                then: [
                  { op: "setKey", var: "prev", key: v("next"), value: v("cell") },
                  { op: "push", var: "queue", value: v("next") },
                ],
              },
            ],
          },
        ],
      },
      // Walk back from the exit to build the path.
      { op: "set", var: "path", value: lit([]) },
      { op: "set", var: "at", value: lit("2,2") },
      {
        op: "while",
        cond: { bin: "!=", left: v("at"), right: lit(null) },
        body: [
          { op: "push", var: "path", value: v("at") },
          { op: "set", var: "at", value: { getKey: v("prev"), key: v("at") } },
        ],
      },
    ];
    const result = await runMacro(macro(program), fakeHost().host);
    expect(result).toMatchObject({ status: "done", vars: { path: ["2,2", "1,2", "1,1", "1,0", "0,0"] } });
  });

  it("expresses a depth-first search with a visited set and a stack", async () => {
    const program: Stmt[] = [
      { op: "set", var: "grid", value: grid },
      { op: "set", var: "visited", value: lit({}) },
      { op: "set", var: "order", value: lit([]) },
      { op: "set", var: "stack", value: lit(["0,0"]) },
      {
        op: "while",
        cond: { bin: ">", left: { length: v("stack") }, right: lit(0) },
        body: [
          { op: "popBack", var: "stack", saveAs: "cell" },
          {
            op: "if",
            cond: { not: { contains: { keys: v("visited") }, item: v("cell") } },
            then: [
              { op: "setKey", var: "visited", key: v("cell"), value: lit(true) },
              { op: "push", var: "order", value: v("cell") },
              {
                op: "forEach",
                list: { getKey: v("grid"), key: v("cell") },
                var: "next",
                body: [{ op: "push", var: "stack", value: v("next") }],
              },
            ],
          },
        ],
      },
    ];
    const result = await runMacro(macro(program), fakeHost().host);
    expect(result).toMatchObject({ status: "done", vars: { order: ["0,0", "1,0", "1,1", "1,2", "2,2", "2,0"] } });
  });
});

describe("procedures", () => {
  const n = v("n");
  const withProcs = (program: Stmt[], procedures: Macro["procedures"], tools: Macro["tools"] = {}): Macro => ({
    ...macro(program, tools),
    procedures,
  });
  const factorial: Macro["procedures"] = {
    fact: {
      params: ["n"],
      body: [
        { op: "if", cond: { bin: "<=", left: n, right: lit(1) }, then: [{ op: "return", value: lit(1) }] },
        {
          op: "return",
          value: { bin: "*", left: n, right: { callProc: "fact", args: { n: { bin: "-", left: n, right: lit(1) } } } },
        },
      ],
    },
  };

  it("returns a value to the expression that called it", async () => {
    const procs: Macro["procedures"] = {
      double: { params: ["x"], body: [{ op: "return", value: { bin: "*", left: v("x"), right: lit(2) } }] },
    };
    const program: Stmt[] = [
      { op: "set", var: "y", value: { bin: "+", left: { callProc: "double", args: { x: lit(21) } }, right: lit(1) } },
    ];
    expect(await runMacro(withProcs(program, procs), fakeHost().host)).toMatchObject({ status: "done", vars: { y: 43 } });
  });

  it("returns null without a return value, returns from a loop, and binds missing parameters to null", async () => {
    const isEven: Expr = { not: { bin: "%", left: v("item"), right: lit(2) } };
    const procs: Macro["procedures"] = {
      nothing: { params: [], body: [] },
      firstEven: {
        params: ["items"],
        body: [
          { op: "forEach", list: v("items"), var: "item", body: [{ op: "if", cond: isEven, then: [{ op: "return", value: v("item") }] }] },
          { op: "return" },
        ],
      },
      echo: { params: ["a"], body: [{ op: "return", value: v("a") }] },
    };
    const program: Stmt[] = [
      { op: "set", var: "a", value: { callProc: "nothing" } },
      { op: "set", var: "b", value: { callProc: "firstEven", args: { items: lit([1, 3, 4, 6]) } } },
      { op: "set", var: "c", value: { callProc: "firstEven", args: { items: lit([1]) } } },
      { op: "set", var: "d", value: { callProc: "echo" } },
    ];
    const result = await runMacro(withProcs(program, procs), fakeHost().host);
    expect(result).toMatchObject({ status: "done", vars: { a: null, b: 4, c: null, d: null } });
  });

  it("keeps parameters and locals inside the call, and hides the caller's variables", async () => {
    const procs: Macro["procedures"] = {
      shadow: {
        params: ["a"],
        body: [
          { op: "set", var: "a", value: lit(5) },
          { op: "set", var: "local", value: lit(2) },
          { op: "return", value: { bin: "+", left: v("a"), right: v("local") } },
        ],
      },
      peek: { params: [], body: [{ op: "return", value: v("outer") }] },
    };
    const program: Stmt[] = [
      { op: "set", var: "a", value: lit(1) },
      { op: "set", var: "r", value: { callProc: "shadow", args: { a: lit(0) } } },
    ];
    const result = await runMacro(withProcs(program, procs), fakeHost().host);
    expect(result.status).toBe("done");
    expect(result.vars).toEqual({ a: 1, r: 7 });

    const peek: Stmt[] = [
      { op: "set", var: "outer", value: lit(1) },
      { op: "set", var: "r", value: { callProc: "peek" } },
    ];
    expect(await runMacro(withProcs(peek, procs), fakeHost().host)).toMatchObject({
      status: "failed",
      message: 'Variable "outer" is not set.',
    });
  });

  it("recurses (factorial)", async () => {
    const program: Stmt[] = [{ op: "set", var: "f", value: { callProc: "fact", args: { n: lit(10) } } }];
    expect(await runMacro(withProcs(program, factorial), fakeHost().host)).toMatchObject({
      status: "done",
      vars: { f: 3628800 },
    });
  });

  it("ends runaway recursion at the step limit", async () => {
    const procs: Macro["procedures"] = { loop: { params: [], body: [{ op: "return", value: { callProc: "loop" } }] } };
    const program: Stmt[] = [{ op: "set", var: "x", value: { callProc: "loop" } }];
    expect(await runMacro(withProcs(program, procs), fakeHost().host, { maxSteps: 50 })).toMatchObject({
      status: "failed",
      message: "Step limit of 50 reached.",
    });
    expect(await runMacro(withProcs(program, procs), fakeHost().host)).toMatchObject({
      status: "failed",
      message: `Step limit of ${DEFAULT_MAX_STEPS} reached.`,
    });
  });

  it("fails cleanly on return outside a procedure", async () => {
    const program: Stmt[] = [
      { op: "set", var: "a", value: lit(1) },
      { op: "return", value: lit(2) },
      { op: "set", var: "b", value: lit(3) },
    ];
    expect(await runMacro(macro(program), fakeHost().host)).toEqual({
      status: "failed",
      message: "return can only be used inside a procedure.",
      toolCalls: 0,
      vars: { a: 1 },
    });
  });

  it("fails on an unknown procedure or argument", async () => {
    const run = (expr: Expr) => runMacro(withProcs([{ op: "set", var: "x", value: expr }], factorial), fakeHost().host);
    expect(await run({ callProc: "missing" })).toMatchObject({ status: "failed", message: 'Unknown procedure "missing".' });
    expect(await run({ callProc: "toString" })).toMatchObject({ status: "failed", message: 'Unknown procedure "toString".' });
    expect(await run({ callProc: "fact", args: { m: lit(1) } })).toMatchObject({
      status: "failed",
      message: 'Procedure "fact" has no parameter "m".',
    });
  });

  it("makes each tool call once in a statement that also calls a procedure", async () => {
    let count = 0;
    const fake = fakeHost({ next: () => ++count });
    const procs: Macro["procedures"] = { id: { params: ["x"], body: [{ op: "return", value: v("x") }] } };
    const next: Expr = { call: "next" };
    const below2: Expr = { bin: "<", left: { callProc: "id", args: { x: v("i") } }, right: lit(2) };
    const program: Stmt[] = [
      { op: "set", var: "i", value: lit(0) },
      {
        op: "while",
        cond: { bin: "and", left: { toolAvailable: "next" }, right: below2 },
        body: [{ op: "set", var: "i", value: { bin: "+", left: v("i"), right: lit(1) } }],
      },
      { op: "set", var: "sum", value: { bin: "+", left: next, right: { callProc: "id", args: { x: next } } } },
    ];
    const result = await runMacro(withProcs(program, procs, { next: { site: "s", name: "next" } }), fake.host);
    expect(result).toMatchObject({ status: "done", toolCalls: 2, vars: { i: 2, sum: 3 } });
    expect(fake.calls).toHaveLength(2);
  });
});

describe("frameOrigin", () => {
  it("passes the tool's frameOrigin to every host method", async () => {
    const seen: (string | undefined)[] = [];
    const host: ToolHost = {
      async callTool(_name, _args, frameOrigin) {
        seen.push(`call ${frameOrigin}`);
        return null;
      },
      async isToolAvailable(_name, frameOrigin) {
        seen.push(`available ${frameOrigin}`);
        return true;
      },
      async waitForTool(_name, _timeoutMs, frameOrigin) {
        seen.push(`wait ${frameOrigin}`);
      },
    };
    const tools = { inner: { site: "s", name: "save", frameOrigin: "https://widget.example" } };
    const result = await runMacro(
      macro(
        [
          { op: "set", var: "here", value: { toolAvailable: "inner" } },
          { op: "waitForTool", tool: "inner" },
          { op: "call", tool: "inner" },
        ],
        tools,
      ),
      host,
    );
    expect(result.status).toBe("done");
    const origin = "https://widget.example";
    expect(seen).toEqual([`available ${origin}`, `wait ${origin}`, `wait ${origin}`, `call ${origin}`]);
  });
});
