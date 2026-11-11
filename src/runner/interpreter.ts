/**
 * Runs a macro's program against a ToolHost. The host is the only way out:
 * the interpreter cannot evaluate code, touch the DOM or make network calls.
 *
 * This first version is a plain async tree-walker. Making it a resumable step
 * machine (state saved after each step) is the next piece of runner work.
 */
import type { Expr, Json, Macro, Stmt } from "../macro/types";

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
  signal?: AbortSignal;
  /** Upper bound on tool calls plus loop iterations. */
  maxSteps?: number;
  /** How long a call waits for its tool to be registered. */
  toolTimeoutMs?: number;
}

export interface RunResult {
  status: "done" | "stopped" | "failed";
  message?: string;
  toolCalls: number;
  vars: Record<string, Json>;
}

export class MacroRunError extends Error {}

class StopSignal {
  constructor(readonly message?: string) {}
}

const DEFAULT_MAX_STEPS = 3000;
const DEFAULT_TOOL_TIMEOUT_MS = 10_000;

export async function runMacro(macro: Macro, host: ToolHost, options: RunOptions = {}): Promise<RunResult> {
  const inputs = options.inputs ?? {};
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const vars: Record<string, Json> = {};
  let steps = 0;
  let toolCalls = 0;

  const tick = () => {
    if (options.signal?.aborted) throw new MacroRunError("Stopped by the user.");
    if (++steps > maxSteps) throw new MacroRunError(`Step limit of ${maxSteps} reached.`);
  };

  const toolName = (alias: string): string => {
    const tool = macro.tools[alias];
    if (!tool) throw new MacroRunError(`Unknown tool alias "${alias}".`);
    return tool.name;
  };

  const call = async (alias: string, argExprs: Record<string, Expr> = {}): Promise<Json> => {
    tick();
    const name = toolName(alias);
    const args: Record<string, Json> = {};
    for (const [key, expr] of Object.entries(argExprs)) args[key] = await evaluate(expr);
    try {
      await host.waitForTool(name, toolTimeoutMs);
    } catch {
      throw new MacroRunError(`Tool "${name}" never became available.`);
    }
    toolCalls++;
    host.onStep?.({ count: toolCalls, tool: name, args });
    return host.callTool(name, args);
  };

  const evaluate = async (expr: Expr): Promise<Json> => {
    if ("lit" in expr) return expr.lit;
    if ("input" in expr) {
      if (!(expr.input in inputs)) throw new MacroRunError(`Missing input "${expr.input}".`);
      return inputs[expr.input]!;
    }
    if ("var" in expr) {
      if (!(expr.var in vars)) throw new MacroRunError(`Variable "${expr.var}" is not set.`);
      return vars[expr.var]!;
    }
    if ("get" in expr) {
      let value = await evaluate(expr.get);
      for (const key of expr.path) {
        if (value === null || typeof value !== "object") return null;
        value = (Array.isArray(value) ? value[Number(key)] : value[String(key)]) ?? null;
      }
      return value;
    }
    if ("not" in expr) return !truthy(await evaluate(expr.not));
    if ("obj" in expr) {
      const out: Record<string, Json> = {};
      for (const [key, value] of Object.entries(expr.obj)) out[key] = await evaluate(value);
      return out;
    }
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
    throw new MacroRunError(`Unknown expression: ${JSON.stringify(expr)}`);
  };

  const exec = async (body: Stmt[]): Promise<void> => {
    for (const stmt of body) {
      if (options.signal?.aborted) throw new MacroRunError("Stopped by the user.");
      switch (stmt.op) {
        case "call": {
          const result = await call(stmt.tool, stmt.args);
          if (stmt.saveAs) vars[stmt.saveAs] = result;
          break;
        }
        case "set":
          vars[stmt.var] = await evaluate(stmt.value);
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
            vars[stmt.var] = item;
            await exec(stmt.body);
          }
          break;
        }
        case "waitForTool": {
          const name = toolName(stmt.tool);
          try {
            await host.waitForTool(name, stmt.timeoutMs ?? toolTimeoutMs);
          } catch {
            throw new MacroRunError(`Tool "${name}" never became available.`);
          }
          break;
        }
        case "wait":
          await new Promise((resolve) => setTimeout(resolve, stmt.ms));
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

  try {
    await exec(macro.program);
    return { status: "done", toolCalls, vars };
  } catch (error) {
    if (error instanceof StopSignal) return { status: "stopped", message: error.message, toolCalls, vars };
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", message, toolCalls, vars };
  }
}

function truthy(value: Json): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function text(value: Json): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function binary(op: string, left: Json, right: Json): Json {
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
  }
  throw new MacroRunError(`Unknown operator "${op}".`);
}
