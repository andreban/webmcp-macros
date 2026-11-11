/**
 * Runs a macro's program against a ToolHost. The host is the only way out:
 * the interpreter cannot evaluate code, touch the DOM or make network calls.
 * It is a plain async tree-walker over the macro JSON.
 */
import type { BinaryOp, Expr, Json, Macro, Stmt } from "../macro/types";

export interface ToolHost {
  /** Calls a tool by its page name. `null` means the call started a navigation. */
  callTool(name: string, args: Record<string, Json>): Promise<Json>;
  isToolAvailable(name: string): Promise<boolean>;
  /** Resolves once the tool is registered; rejects on timeout. */
  waitForTool(name: string, timeoutMs: number): Promise<void>;
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

/** The step limit when `RunOptions.maxSteps` is not given. */
export const DEFAULT_MAX_STEPS = 3000;
const DEFAULT_TOOL_TIMEOUT_MS = 10_000;
const STOPPED_BY_USER = "Stopped by the user.";

export async function runMacro(macro: Macro, host: ToolHost, options: RunOptions = {}): Promise<RunResult> {
  const inputs = options.inputs ?? {};
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const { signal } = options;
  // A Map, not an object: variable names come from shared macros, and names
  // such as "__proto__" must not reach Object.prototype.
  const vars = new Map<string, Json>();
  let toolCalls = 0;
  let steps = 0;

  const checkAborted = () => {
    if (signal?.aborted) throw new MacroRunError(STOPPED_BY_USER);
  };

  // Macros are shared, so a runaway loop must end on its own: every tool call
  // and every loop iteration counts against the limit, even an empty body.
  const tick = () => {
    checkAborted();
    if (++steps > maxSteps) throw new MacroRunError(`Step limit of ${maxSteps} reached.`);
  };

  const waitFor = async (name: string, timeoutMs: number): Promise<void> => {
    try {
      await host.waitForTool(name, timeoutMs);
    } catch {
      throw new MacroRunError(`Tool "${name}" never became available.`);
    }
  };

  const toolName = (alias: string): string => {
    const tool = ownValue(macro.tools, alias);
    if (!tool) throw new MacroRunError(`Unknown tool alias "${alias}".`);
    return tool.name;
  };

  // Tools register and unregister as the page changes state, so every call
  // waits for its tool instead of assuming an earlier listing still holds.
  const call = async (alias: string, argExprs: Record<string, Expr> = {}): Promise<Json> => {
    tick();
    const name = toolName(alias);
    const args = await evaluateRecord(argExprs);
    await waitFor(name, toolTimeoutMs);
    toolCalls++;
    host.onStep?.({ count: toolCalls, tool: name, args });
    return host.callTool(name, args);
  };

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
    if ("toolAvailable" in expr) return host.isToolAvailable(toolName(expr.toolAvailable));
    if ("call" in expr) return call(expr.call, expr.args);
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

  const exec = async (body: Stmt[]): Promise<void> => {
    for (const stmt of body) {
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
        case "if":
          if (truthy(await evaluate(stmt.cond))) await exec(stmt.then);
          else if (stmt.else) await exec(stmt.else);
          break;
        case "repeat": {
          const times = Number(await evaluate(stmt.times));
          for (let i = 0; i < times; i++) {
            tick();
            await exec(stmt.body);
          }
          break;
        }
        case "while":
          while (truthy(await evaluate(stmt.cond))) {
            tick();
            await exec(stmt.body);
          }
          break;
        case "forEach": {
          const list = await evaluate(stmt.list);
          if (!Array.isArray(list)) throw new MacroRunError("forEach needs a list.");
          for (const item of list) {
            tick();
            vars.set(stmt.var, item);
            await exec(stmt.body);
          }
          break;
        }
        case "waitForTool":
          await waitFor(toolName(stmt.tool), stmt.timeoutMs ?? toolTimeoutMs);
          break;
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
    }
  };

  const result = (status: RunResult["status"], message?: string): RunResult => ({
    status,
    message,
    toolCalls,
    vars: Object.fromEntries(vars),
  });

  try {
    await exec(macro.program);
    return result("done");
  } catch (error: unknown) {
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
