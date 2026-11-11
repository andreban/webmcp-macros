// Proposes a trigger from the program, so a new macro is offered on its site
// without the author having to work out which tools the page registers first.
import type { Expr, Macro, MacroTrigger, Stmt } from "../macro/types";

/**
 * The trigger site, and one tool set: every tool on that site that the
 * program calls, in execution order, before the first `waitForTool`.
 *
 * A `waitForTool` marks where the author expects tools to appear later, so
 * what comes after it must not be required up front. Calls inside branches
 * and loops count, since they may run before that point. Tools on other sites
 * are left out because the matcher only checks the trigger site. A program
 * that calls no tool there gets one empty set: offered on the site alone.
 */
export function defaultTrigger(macro: Macro): MacroTrigger {
  const site = Object.hasOwn(macro.sites, macro.trigger.site)
    ? macro.trigger.site
    : (Object.keys(macro.sites)[0] ?? macro.trigger.site);
  const called = new Set<string>();
  collectBody(macro.program, called);
  const aliases = [...called].filter(
    (alias) => Object.hasOwn(macro.tools, alias) && macro.tools[alias]?.site === site,
  );
  return { site, anyOf: [aliases] };
}

// Each collector returns false once it reaches a `waitForTool`, which stops the walk.
function collectBody(body: readonly Stmt[], called: Set<string>): boolean {
  return body.every((stmt) => collectStmt(stmt, called));
}

function collectStmt(stmt: Stmt, called: Set<string>): boolean {
  switch (stmt.op) {
    case "waitForTool":
      return false;
    case "call":
      collectRecord(stmt.args, called);
      called.add(stmt.tool);
      return true;
    case "set":
      return collectExpr(stmt.value, called);
    case "if":
      return collectExpr(stmt.cond, called) && collectBody(stmt.then, called) && collectBody(stmt.else ?? [], called);
    case "repeat":
      return collectExpr(stmt.times, called) && collectBody(stmt.body, called);
    case "while":
      return collectExpr(stmt.cond, called) && collectBody(stmt.body, called);
    case "forEach":
      return collectExpr(stmt.list, called) && collectBody(stmt.body, called);
    case "message":
      return collectExpr(stmt.text, called);
    case "stop":
      return stmt.message === undefined || collectExpr(stmt.message, called);
    case "fail":
      return collectExpr(stmt.message, called);
    case "wait":
      return true;
    default:
      throw new Error(`Unknown statement: ${JSON.stringify(stmt satisfies never)}`);
  }
}

// Expressions never wait, so these always return true; they only gather `call`s.
function collectRecord(record: Readonly<Record<string, Expr>> | undefined, called: Set<string>): true {
  for (const expr of Object.values(record ?? {})) collectExpr(expr, called);
  return true;
}

function collectExpr(expr: Expr, called: Set<string>): true {
  if ("call" in expr) {
    collectRecord(expr.args, called);
    called.add(expr.call);
  } else if ("get" in expr) collectExpr(expr.get, called);
  else if ("bin" in expr) collectRecord({ left: expr.left, right: expr.right }, called);
  else if ("not" in expr) collectExpr(expr.not, called);
  else if ("obj" in expr) collectRecord(expr.obj, called);
  else if ("list" in expr) for (const item of expr.list) collectExpr(item, called);
  return true;
}
