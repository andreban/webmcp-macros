/**
 * Runs a macro's program against a ToolHost. The host is the only way out:
 * the interpreter cannot evaluate code, touch the DOM or make network calls.
 * It is a step machine over the macro JSON: `step` runs one statement of a
 * `RunState` and returns the next state, and `runMacro` loops over it.
 */
import type { BinaryOp, Expr, Json, Macro, MacroTool, Stmt } from "../macro/types";
import { callBase, locate, type Frame, type Loop, type RunState } from "./machine";

/**
 * Every method takes the key into `Macro.sites` whose tab the step runs on:
 * the innermost `onSite`, or the trigger site outside any. The host decides
 * which tab that is.
 */
export interface ToolHost {
  /**
   * Calls a tool by its page name. `null` means the call started a navigation.
   * `frameOrigin` (from `MacroTool`) picks the frame when several register the name.
   */
  callTool(name: string, args: Record<string, Json>, site: string, frameOrigin?: string): Promise<Json>;
  isToolAvailable(name: string, site: string, frameOrigin?: string): Promise<boolean>;
  /** Resolves once the tool is registered; rejects on timeout. */
  waitForTool(name: string, timeoutMs: number, site: string, frameOrigin?: string): Promise<void>;
  message?(text: string): void;
  onStep?(step: StepInfo): void;
}

export interface StepInfo {
  /** Tool calls made so far, including this one. */
  count: number;
  tool: string;
  args: Record<string, Json>;
}

export interface RunOptions {
  inputs?: Record<string, Json>;
  /** Checked before each statement and loop iteration; aborting fails the run with "Stopped by the user.". */
  signal?: AbortSignal;
  /** Upper bound on tool calls plus loop iterations; defaults to `DEFAULT_MAX_STEPS`. */
  maxSteps?: number;
  /** How long a call waits for its tool to be registered, in milliseconds. */
  toolTimeoutMs?: number;
}

/** The outcome of a run. A run never throws: failures are `status: "failed"`. */
export interface RunResult {
  status: "done" | "stopped" | "failed";
  message?: string;
  toolCalls: number;
  vars: Record<string, Json>;
}

/** An error whose message is shown to the user as the reason a run failed. */
export class MacroRunError extends Error {}

/** Thrown by `stop` to unwind the program; not an error. */
class StopSignal {
  constructor(readonly message?: string) {}
}

/** Thrown to leave the current statement and enter a procedure call; not an error. */
class CallSignal {
  constructor(readonly call: NonNullable<Frame["call"]>) {}
}

/** The step limit when `RunOptions.maxSteps` is not given. */
export const DEFAULT_MAX_STEPS = 3000;
const DEFAULT_TOOL_TIMEOUT_MS = 10_000;
const STOPPED_BY_USER = "Stopped by the user.";

export async function runMacro(macro: Macro, host: ToolHost, options: RunOptions = {}): Promise<RunResult> {
  let state = startRun(macro, options);
  for (;;) {
    if (state.status !== "running") {
      const { status, message, toolCalls, vars } = state;
      return { status, message, toolCalls, vars };
    }
    state = await step(state, host, options.signal);
  }
}

/** The state of a run that has not executed anything yet. */
export function startRun(macro: Macro, options: Omit<RunOptions, "signal"> = {}): RunState {
  return {
    status: "running",
    macro,
    inputs: options.inputs ?? {},
    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
    toolTimeoutMs: options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
    frames: [{ pc: 0 }],
    vars: {},
    toolCalls: 0,
    steps: 0,
  };
}

/**
 * Runs the next statement, or ends the block on top of the stack, and returns
 * the next state. It never throws, and it leaves `state` unchanged so a caller
 * can keep it. Expressions run whole within a step, tool calls included, up to
 * the first procedure call: that step enters the procedure, and the statement
 * runs again once it returns (see `machine.ts`).
 */
export async function step(state: RunState, host: ToolHost, signal?: AbortSignal): Promise<RunState> {
  if (state.status !== "running") return state;
  const { macro, inputs, toolTimeoutMs, maxSteps } = state;
  const frames = [...state.frames];
  // The scope is the innermost procedure call's, or the program's. `base`
  // becomes -1 when that call returns, and its variables are dropped.
  let base = callBase(frames);
  const inProc = base >= 0;
  // A Map, not an object: variable names come from shared macros, and names
  // such as "__proto__" must not reach Object.prototype.
  const vars = new Map<string, Json>(Object.entries(frames[base]?.call?.locals ?? state.vars));
  let { toolCalls, steps } = state;
  const results: Record<string, Json> = { ...frames.at(-1)?.results };
  let nextSlot = 0;

  // A statement replayed after a procedure call does not repeat the calls it
  // made before: their results are kept by slot, in the order calls start.
  const once = async (run: (slot: number) => Promise<Json>): Promise<Json> => {
    const slot = nextSlot++;
    const kept = ownValue(results, String(slot));
    if (kept !== undefined) return kept;
    const value = await run(slot);
    results[slot] = value;
    return value;
  };

  const checkAborted = () => {
    if (signal?.aborted) throw new MacroRunError(STOPPED_BY_USER);
  };

  // Macros are shared, so a runaway loop must end on its own: every tool call
  // and every loop iteration counts against the limit, even an empty body.
  const tick = () => {
    checkAborted();
    if (++steps > maxSteps) throw new MacroRunError(`Step limit of ${maxSteps} reached.`);
  };

  // Procedures run on their caller's site: the innermost `onSite` on the
  // whole stack counts, not only those of the current procedure.
  const site = (): string => frames.findLast((frame) => frame.site !== undefined)?.site ?? macro.trigger.site;

  const waitFor = async ({ name, frameOrigin }: MacroTool, timeoutMs: number): Promise<void> => {
    try {
      await host.waitForTool(name, timeoutMs, site(), frameOrigin);
    } catch (error: unknown) {
      // A host that knows why the tool is missing says so with a MacroRunError.
      if (error instanceof MacroRunError) throw error;
      throw new MacroRunError(`Tool "${name}" never became available.`);
    }
  };

  // A tool is registered by one site's pages, so calling it from another
  // site's tab could only time out; say what is wrong instead.
  const toolRef = (alias: string): MacroTool => {
    const tool = ownValue(macro.tools, alias);
    if (!tool) throw new MacroRunError(`Unknown tool alias "${alias}".`);
    if (tool.site !== site()) {
      throw new MacroRunError(`Tool "${tool.name}" belongs to site "${tool.site}"; put it in an "on site" block for that site.`);
    }
    return tool;
  };

  // Tools register and unregister as the page changes state, so every call
  // waits for its tool instead of assuming an earlier listing still holds.
  const call = (alias: string, argExprs: Record<string, Expr> = {}): Promise<Json> =>
    once(async () => {
      const tool = toolRef(alias);
      const args = await evaluateRecord(argExprs);
      // Counted after the arguments, which may enter a procedure and replay this call.
      tick();
      await waitFor(tool, toolTimeoutMs);
      toolCalls++;
      host.onStep?.({ count: toolCalls, tool: tool.name, args });
      return host.callTool(tool.name, args, site(), tool.frameOrigin);
    });

  const callProc = (procName: string, argExprs: Record<string, Expr> = {}): Promise<Json> =>
    once(async (slot) => {
      const proc = ownValue(macro.procedures ?? {}, procName);
      if (!proc) throw new MacroRunError(`Unknown procedure "${procName}".`);
      const args = await evaluateRecord(argExprs);
      const extra = Object.keys(args).find((key) => !proc.params.includes(key));
      if (extra !== undefined) throw new MacroRunError(`Procedure "${procName}" has no parameter "${extra}".`);
      // Every call counts, so runaway recursion ends at the step limit.
      tick();
      const locals = Object.fromEntries(proc.params.map((param) => [param, ownValue(args, param) ?? null]));
      throw new CallSignal({ proc: procName, slot, locals });
    });

  const evaluateRecord = async (exprs: Record<string, Expr>): Promise<Record<string, Json>> => {
    const entries: [string, Json][] = [];
    for (const [key, expr] of Object.entries(exprs)) entries.push([key, await evaluate(expr)]);
    // fromEntries defines own properties, so a "__proto__" key stays a key.
    return Object.fromEntries(entries);
  };

  const readVar = (name: string): Json => {
    const value = vars.get(name);
    if (value === undefined) throw new MacroRunError(`Variable "${name}" is not set.`);
    return value;
  };

  const readList = (op: string, name: string): Json[] => {
    const value = readVar(name);
    if (!Array.isArray(value)) throw new MacroRunError(`${op} needs a list in "${name}", got ${kind(value)}.`);
    return value;
  };

  const evaluate = async (expr: Expr): Promise<Json> => {
    if ("lit" in expr) return expr.lit;
    if ("input" in expr) {
      const value = ownValue(inputs, expr.input);
      if (value === undefined) throw new MacroRunError(`Missing input "${expr.input}".`);
      return value;
    }
    if ("var" in expr) return readVar(expr.var);
    if ("get" in expr) {
      let value: Json | undefined = await evaluate(expr.get);
      for (const key of expr.path) {
        if (value === null || typeof value !== "object") return null;
        value = Array.isArray(value) ? value[Number(key)] : ownValue(value, String(key));
        if (value === undefined) return null;
      }
      return value;
    }
    if ("not" in expr) return !truthy(await evaluate(expr.not));
    if ("obj" in expr) return evaluateRecord(expr.obj);
    if ("list" in expr) {
      const out: Json[] = [];
      for (const item of expr.list) out.push(await evaluate(item));
      return out;
    }
    // Kept like call results, so a replayed statement takes the same branches.
    if ("toolAvailable" in expr) return once(() => {
        const { name, frameOrigin } = toolRef(expr.toolAvailable);
        return host.isToolAvailable(name, site(), frameOrigin);
      });
    if ("call" in expr) return call(expr.call, expr.args);
    if ("callProc" in expr) return callProc(expr.callProc, expr.args);
    if ("getKey" in expr) return lookup("getKey", await evaluate(expr.getKey), await evaluate(expr.key)) ?? null;
    if ("hasKey" in expr) return lookup("hasKey", await evaluate(expr.hasKey), await evaluate(expr.key)) !== undefined;
    if ("length" in expr) {
      const value = await evaluate(expr.length);
      if (Array.isArray(value) || typeof value === "string") return value.length;
      if (isDict(value)) return Object.keys(value).length;
      throw new MacroRunError(`length needs a list, a string or a dictionary, got ${kind(value)}.`);
    }
    if ("contains" in expr) {
      const haystack = await evaluate(expr.contains);
      const item = await evaluate(expr.item);
      if (Array.isArray(haystack)) return haystack.some((entry) => binary("==", entry, item));
      if (typeof haystack === "string" && typeof item === "string") return haystack.includes(item);
      if (typeof haystack === "string") throw new MacroRunError(`contains on a string needs a string, got ${kind(item)}.`);
      throw new MacroRunError(`contains needs a list or a string, got ${kind(haystack)}.`);
    }
    if ("keys" in expr) {
      const value = await evaluate(expr.keys);
      if (isDict(value)) return Object.keys(value);
      throw new MacroRunError(`keys needs a dictionary, got ${kind(value)}.`);
    }
    if ("bin" in expr) {
      const left = await evaluate(expr.left);
      // Short-circuit so `and`/`or` can guard a tool call on the right.
      if (expr.bin === "and") return truthy(left) ? truthy(await evaluate(expr.right)) : false;
      if (expr.bin === "or") return truthy(left) ? true : truthy(await evaluate(expr.right));
      return binary(expr.bin, left, await evaluate(expr.right));
    }
    throw new MacroRunError(`Unknown expression: ${JSON.stringify(expr satisfies never)}`);
  };

  // Frames are replaced, never changed, so the previous state stays intact.
  // Moving `pc` drops the results kept for replaying the statement it left.
  const replaceTop = ({ results: _left, ...frame }: Frame) => {
    frames[frames.length - 1] = frame;
  };
  // Pops the call's frames and hands `value` to the statement that made it.
  const returnFrom = (value: Json) => {
    const slot = frames[base]?.call?.slot ?? 0;
    frames.length = base;
    base = -1;
    const caller = frames.at(-1);
    if (caller) frames[frames.length - 1] = { ...caller, results: { ...caller.results, [slot]: value } };
  };
  const enter = (branch: NonNullable<Frame["branch"]>, loop?: Loop) => {
    frames.push(loop ? { branch, pc: 0, loop } : { branch, pc: 0 });
  };

  const execute = async (): Promise<void> => {
    const top = frames.at(-1);
    const at = top && locate(macro, frames);
    if (!top || !at) throw new MacroRunError("The saved run does not match its macro.");
    const stmt = at.block[top.pc];
    if (!stmt) return endBlock(top, at.owner);
    checkAborted();
    switch (stmt.op) {
      case "call": {
        const result = await call(stmt.tool, stmt.args);
        if (stmt.saveAs) vars.set(stmt.saveAs, result);
        break;
      }
      case "set":
        vars.set(stmt.var, await evaluate(stmt.value));
        break;
      case "if": {
        const branch = truthy(await evaluate(stmt.cond)) ? "then" : stmt.else ? "else" : undefined;
        if (branch) return enter(branch);
        break;
      }
      case "repeat": {
        // Capped so the state stays JSON, which has no Infinity; the step
        // limit ends the run before the cap is reached.
        const times = Math.min(Number(await evaluate(stmt.times)), maxSteps + 1);
        if (0 < times) {
          tick();
          return enter("body", { kind: "repeat", i: 0, times });
        }
        break;
      }
      case "while":
        if (truthy(await evaluate(stmt.cond))) {
          tick();
          return enter("body", { kind: "while" });
        }
        break;
      case "forEach": {
        const items = await evaluate(stmt.list);
        if (!Array.isArray(items)) throw new MacroRunError("forEach needs a list.");
        const [first] = items;
        if (first !== undefined) {
          tick();
          vars.set(stmt.var, first);
          return enter("body", { kind: "forEach", i: 0, items });
        }
        break;
      }
      case "waitForTool":
        await waitFor(toolRef(stmt.tool), stmt.timeoutMs ?? toolTimeoutMs);
        break;
      case "onSite":
        // Only declared sites: their `startUrl` is the only place a run may open.
        if (!Object.hasOwn(macro.sites, stmt.site)) throw new MacroRunError(`Unknown site "${stmt.site}".`);
        // Leaving the body pops this frame, which restores the previous site.
        frames.push({ branch: "body", pc: 0, site: stmt.site });
        return;
      case "wait":
        await sleep(stmt.ms, signal);
        break;
      case "message":
        host.message?.(text(await evaluate(stmt.text)));
        break;
      case "stop":
        throw new StopSignal(stmt.message ? text(await evaluate(stmt.message)) : undefined);
      case "fail":
        throw new MacroRunError(text(await evaluate(stmt.message)));
      // The data statements store a new value instead of changing the old
      // one in place: the old one may be a literal in the macro's program,
      // which must read the same on the next run, or be held by another
      // variable too.
      case "setKey": {
        const key = await evaluate(stmt.key);
        const value = await evaluate(stmt.value);
        const dict = readVar(stmt.var);
        if (!isDict(dict)) throw new MacroRunError(`setKey needs a dictionary in "${stmt.var}", got ${kind(dict)}.`);
        if (typeof key !== "string") throw new MacroRunError(`setKey needs a string key, got ${kind(key)}.`);
        // fromEntries defines own properties, so a "__proto__" key stays a key.
        vars.set(stmt.var, Object.fromEntries([...Object.entries(dict), [key, value]]));
        break;
      }
      case "push": {
        const value = await evaluate(stmt.value);
        vars.set(stmt.var, [...readList("push", stmt.var), value]);
        break;
      }
      case "return":
        if (base < 0) throw new MacroRunError("return can only be used inside a procedure.");
        return returnFrom(stmt.value ? await evaluate(stmt.value) : null);
      case "popFront":
      case "popBack": {
        const list = readList(stmt.op, stmt.var);
        const item = stmt.op === "popFront" ? list[0] : list[list.length - 1];
        if (item === undefined) throw new MacroRunError(`${stmt.op} needs a non-empty list; "${stmt.var}" is empty.`);
        vars.set(stmt.var, stmt.op === "popFront" ? list.slice(1) : list.slice(0, -1));
        if (stmt.saveAs) vars.set(stmt.saveAs, item);
        break;
      }
      default:
        throw new MacroRunError(`Unknown statement: ${JSON.stringify(stmt satisfies never)}`);
    }
    replaceTop({ ...top, pc: top.pc + 1 });
  };

  // The end of a block either starts the next loop iteration or returns to
  // the statement after the block's owner.
  const endBlock = async (top: Frame, owner: Stmt | undefined): Promise<void> => {
    const { loop } = top;
    if (loop?.kind === "repeat" && loop.i + 1 < loop.times) {
      tick();
      return replaceTop({ ...top, pc: 0, loop: { ...loop, i: loop.i + 1 } });
    }
    if (loop?.kind === "while" && owner?.op === "while" && truthy(await evaluate(owner.cond))) {
      tick();
      return replaceTop({ ...top, pc: 0 });
    }
    const item = loop?.kind === "forEach" ? loop.items[loop.i + 1] : undefined;
    if (loop?.kind === "forEach" && owner?.op === "forEach" && item !== undefined) {
      tick();
      vars.set(owner.var, item);
      return replaceTop({ ...top, pc: 0, loop: { ...loop, i: loop.i + 1 } });
    }
    if (top.call) return returnFrom(null);
    frames.pop();
    const parent = frames.at(-1);
    if (parent) replaceTop({ ...parent, pc: parent.pc + 1 });
  };

  const result = (status: RunState["status"], message?: string): RunState => {
    const scope = frames[base];
    if (scope?.call) frames[base] = { ...scope, call: { ...scope.call, locals: Object.fromEntries(vars) } };
    const globals = inProc ? state.vars : Object.fromEntries(vars);
    return { ...state, status, message, frames, toolCalls, steps, vars: globals };
  };

  try {
    await execute();
    return result(frames.length > 0 ? "running" : "done");
  } catch (error: unknown) {
    if (error instanceof CallSignal) {
      const top = frames.at(-1);
      if (top) frames[frames.length - 1] = { ...top, results };
      frames.push({ pc: 0, call: error.call });
      return result("running");
    }
    if (error instanceof StopSignal) return result("stopped", error.message);
    return result("failed", error instanceof Error ? error.message : String(error));
  }
}

/** Resolves after `ms`, or rejects as soon as `signal` aborts so Stop does not wait out a long pause. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new MacroRunError(STOPPED_BY_USER));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Reads only own properties, so keys such as "constructor" are not inherited values. */
function ownValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

type Dict = { [key: string]: Json };

function isDict(value: Json): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Names a value's type for error messages, in the words the editor uses. */
function kind(value: Json): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return isDict(value) ? "a dictionary" : `a ${typeof value}`;
}

/**
 * Reads a dictionary entry by string key or a list item by integer index;
 * `undefined` when there is none. Keys come from macros and tool results, so
 * only own properties count.
 */
function lookup(op: string, container: Json, key: Json): Json | undefined {
  if (Array.isArray(container)) {
    if (typeof key !== "number" || !Number.isInteger(key)) {
      throw new MacroRunError(`${op} on a list needs an integer index, got ${kind(key)}.`);
    }
    return container[key];
  }
  if (isDict(container)) {
    if (typeof key !== "string") throw new MacroRunError(`${op} on a dictionary needs a string key, got ${kind(key)}.`);
    return ownValue(container, key);
  }
  throw new MacroRunError(`${op} needs a dictionary or a list, got ${kind(container)}.`);
}

function truthy(value: Json): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function text(value: Json): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** `+` concatenates when either side is a string; other arithmetic and ordering coerce to numbers. */
function binary(op: Exclude<BinaryOp, "and" | "or">, left: Json, right: Json): Json {
  switch (op) {
    case "==":
      return JSON.stringify(left) === JSON.stringify(right);
    case "!=":
      return JSON.stringify(left) !== JSON.stringify(right);
    case "+":
      return typeof left === "string" || typeof right === "string"
        ? text(left) + text(right)
        : Number(left) + Number(right);
  }
  const a = Number(left);
  const b = Number(right);
  switch (op) {
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return a / b;
    case "%":
      return a % b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    default:
      throw new MacroRunError(`Unknown operator: ${JSON.stringify(op satisfies never)}`);
  }
}
