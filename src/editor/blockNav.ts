// Keyboard navigation over the program, in paths. Pure, so the rules are
// unit-tested without a DOM; the component only maps keys to these.
import type { Macro, Stmt } from "../macro/types";
import { readSlot, type Slot, statements } from "./registry";
import { getNode, type Path } from "./state";

const same = (a: Path, b: Path) => a.length === b.length && a.every((seg, i) => seg === b[i]);

/** The bodies a statement has, in reading order. An absent optional body (`else`) is not one. */
export function bodiesOf(stmt: Stmt): { slot: string; body: Stmt[] }[] {
  const label: readonly (string | Slot)[] = statements[stmt.op].label;
  return label.flatMap((part) => {
    if (typeof part === "string") return [];
    const slot = readSlot(stmt, part);
    return slot?.type === "body" ? [{ slot: part.slot, body: slot.value }] : [];
  });
}

/**
 * Every place focus can rest, in document order: each statement, and the
 * position 0 of each empty body, which stands in for it so a statement can be
 * inserted there.
 */
export function focusStops(body: readonly Stmt[], at: Path = ["program"]): Path[] {
  if (body.length === 0) return [[...at, 0]];
  return body.flatMap((stmt, i) => {
    const path = [...at, i];
    return [path, ...bodiesOf(stmt).flatMap((inner) => focusStops(inner.body, [...path, inner.slot]))];
  });
}

/** Every insertion position in document order, leaving out those inside `skip`. */
function positions(body: readonly Stmt[], at: Path, skip: Path): Path[] {
  const inside = body.flatMap((stmt, i) => {
    const path = [...at, i];
    if (same(path, skip)) return [path];
    return [path, ...bodiesOf(stmt).flatMap((inner) => positions(inner.body, [...path, inner.slot], skip))];
  });
  return [...inside, [...at, body.length]];
}

/**
 * Where Alt+Up or Alt+Down sends the statement at `from`: the neighbouring
 * insertion position, so a block steps into and out of bodies one at a time.
 * The result is a `moveStmt` target (a position before the move).
 */
export function moveDestination(macro: Macro, from: Path, direction: -1 | 1): Path | undefined {
  const all = positions(macro.program, ["program"], from);
  const before = all.findIndex((path) => same(path, from));
  if (before < 0) return undefined;
  // The positions just before and just after the statement become one once it leaves.
  return all[direction < 0 ? before - 1 : before + 2];
}

/** Where a new statement goes: after the focused one, or into the focused empty body. */
export function insertionPoint(macro: Macro, focus: Path): Path {
  const found = getNode(macro, focus);
  const index = focus.at(-1);
  return found?.kind === "stmt" && found.node && typeof index === "number" ? focus.with(-1, index + 1) : focus;
}

/** Focus after removing the statement at `at`: the next one slides into place, else the previous, else the empty body. */
export function focusAfterRemove(macro: Macro, at: Path): Path {
  const body = getNode(macro, at.slice(0, -1));
  const index = at.at(-1);
  if (body?.kind !== "body" || typeof index !== "number") return at;
  return at.with(-1, Math.max(0, Math.min(index, body.node.length - 2)));
}

export const pathKey = (path: Path) => JSON.stringify(path);
