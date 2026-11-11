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
    } catch (error: unknown) {
      // A host that knows why the tool is missing says so with a MacroRunError.
      if (error instanceof MacroRunError) throw error;
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

  const evaluate = async (expr: Expr): Promise<Json> => {
    if ("lit" in expr) return expr.lit;
    if ("input" in expr) {
      const value = ownValue(inputs, expr.input);
      if (value === undefined) throw new MacroRunError(`Missing input "${expr.input}".`);
      return value;
    }
    if ("var" in expr) {
      const value = vars.get(expr.var);
      if (value === undefined) throw new MacroRunError(`Variable "${expr.var}" is not set.`);
      return value;
    }
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
