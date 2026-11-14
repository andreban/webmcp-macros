// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

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
 * A procedure call counts the procedure's body where the call is made. An
 * `onSite` for another site ends the walk like a `waitForTool`.
 */
export function defaultTrigger(macro: Macro): MacroTrigger {
  const site = Object.hasOwn(macro.sites, macro.trigger.site)
    ? macro.trigger.site
    : (Object.keys(macro.sites)[0] ?? macro.trigger.site);
  const walk: Walk = { macro, called: new Set(), entered: new Set() };
  collectBody(macro.program, walk);
  const aliases = [...walk.called].filter(
    (alias) => Object.hasOwn(macro.tools, alias) && macro.tools[alias]?.site === site,
  );
  return { site, anyOf: [aliases] };
}

interface Walk {
  macro: Macro;
  called: Set<string>;
  /** Procedures already walked: a body adds the same calls each time, and recursion must end. */
  entered: Set<string>;
}

// Each collector returns false once it reaches a `waitForTool`, which stops the walk.
function collectBody(body: readonly Stmt[], walk: Walk): boolean {
  return body.every((stmt) => collectStmt(stmt, walk));
}

function collectStmt(stmt: Stmt, walk: Walk): boolean {
  switch (stmt.op) {
    case "waitForTool":
      return false;
    // The trigger covers the first steps on its own site; once the program
    // moves to another site, later steps are not needed up front.
    case "onSite":
      return stmt.site === walk.macro.trigger.site && collectBody(stmt.body, walk);
    case "call":
      if (!collectRecord(stmt.args, walk)) return false;
      walk.called.add(stmt.tool);
      return true;
    case "set":
    case "push":
      return collectExpr(stmt.value, walk);
    case "if":
      return collectExpr(stmt.cond, walk) && collectBody(stmt.then, walk) && collectBody(stmt.else ?? [], walk);
    case "repeat":
      return collectExpr(stmt.times, walk) && collectBody(stmt.body, walk);
    case "while":
      return collectExpr(stmt.cond, walk) && collectBody(stmt.body, walk);
    case "forEach":
      return collectExpr(stmt.list, walk) && collectBody(stmt.body, walk);
    case "message":
      return collectExpr(stmt.text, walk);
    case "stop":
      return stmt.message === undefined || collectExpr(stmt.message, walk);
    case "return":
      return stmt.value === undefined || collectExpr(stmt.value, walk);
    case "fail":
      return collectExpr(stmt.message, walk);
    case "setKey":
      return collectExpr(stmt.key, walk) && collectExpr(stmt.value, walk);
    case "wait":
    case "popFront":
    case "popBack":
      return true;
    default:
      throw new Error(`Unknown statement: ${JSON.stringify(stmt satisfies never)}`);
  }
}

function collectRecord(record: Readonly<Record<string, Expr>> | undefined, walk: Walk): boolean {
  return Object.values(record ?? {}).every((expr) => collectExpr(expr, walk));
}

// Only a procedure call can reach a `waitForTool` from inside an expression.
function collectExpr(expr: Expr, walk: Walk): boolean {
  if ("call" in expr) {
    if (!collectRecord(expr.args, walk)) return false;
    walk.called.add(expr.call);
    return true;
  }
  if ("callProc" in expr) {
    if (!collectRecord(expr.args, walk)) return false;
    const procedure = walk.macro.procedures?.[expr.callProc];
    if (!procedure || walk.entered.has(expr.callProc)) return true;
    walk.entered.add(expr.callProc);
    return collectBody(procedure.body, walk);
  }
  if ("get" in expr) return collectExpr(expr.get, walk);
  if ("bin" in expr) return collectExpr(expr.left, walk) && collectExpr(expr.right, walk);
  if ("not" in expr) return collectExpr(expr.not, walk);
  if ("obj" in expr) return collectRecord(expr.obj, walk);
  if ("list" in expr) return expr.list.every((item) => collectExpr(item, walk));
  if ("getKey" in expr) return collectExpr(expr.getKey, walk) && collectExpr(expr.key, walk);
  if ("hasKey" in expr) return collectExpr(expr.hasKey, walk) && collectExpr(expr.key, walk);
  if ("length" in expr) return collectExpr(expr.length, walk);
  if ("contains" in expr) return collectExpr(expr.contains, walk) && collectExpr(expr.item, walk);
  if ("keys" in expr) return collectExpr(expr.keys, walk);
  return true;
}
