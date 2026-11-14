// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

// Drag and drop for the program, on the browser's native HTML5 events. A drop
// dispatches the same `moveStmt` and `insertStmt` actions as Alt+arrows and the
// palette, and the reducer decides what is allowed, so both ways in agree.
import { type Dispatch, type DragEvent, type HTMLAttributes, type PointerEvent, useRef, useState } from "react";
import type { Macro } from "../macro/types";
import { pathKey } from "./blockNav";
import type { Insert } from "./Palette";
import { createEditorState, type EditorAction, editorReducer, moveTarget, type Path } from "./state";

/** What is being dragged: a statement of the program, or a new block from the palette. */
export type DragItem = { kind: "stmt"; from: Path } | { kind: "palette"; insert: Insert };

/** Where a drop on a block lands: before it in the upper half, after it in the lower half. */
export function dropPosition(at: Path, lowerHalf: boolean): Path {
  const index = at.at(-1);
  return lowerHalf && typeof index === "number" ? at.with(-1, index + 1) : at;
}

/**
 * The action a drop of `item` at insertion position `to` dispatches, or
 * undefined when the reducer would ignore it: a block into itself or one of
 * its bodies, onto its own place, or at a path that is no insertion position.
 */
export function dropAction(macro: Macro, item: DragItem, to: Path): EditorAction | undefined {
  const action: EditorAction =
    item.kind === "stmt"
      ? { type: "moveStmt", from: item.from, to }
      : { type: "insertStmt", at: to, stmt: item.insert.stmt, tools: item.insert.tools };
  return editorReducer(createEditorState(macro, 0), action).macro === macro ? undefined : action;
}

/** Where the dropped statement ends up, for focus. */
export const landedAt = (item: DragItem, to: Path): Path => (item.kind === "stmt" ? moveTarget(item.from, to) : to);

// A type of our own, so a drop on a text field elsewhere does not paste anything.
const MIME = "application/x-wmm-block";

/**
 * Chrome starts a drag of the draggable ancestor when the pointer moves with
 * its button down in a text field, so the text in a slot could not be
 * selected with the mouse. A press in a field turns dragging off on every
 * draggable around it until the button is released. It runs in the capture
 * phase so each enclosing block, not only the innermost, sees the press.
 */
function suspendDragInFields(event: PointerEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest("input, textarea, select, [contenteditable]")) return;
  const block = event.currentTarget;
  block.draggable = false;
  const restore = () => {
    block.draggable = true;
    window.removeEventListener("pointerup", restore, true);
    window.removeEventListener("pointercancel", restore, true);
  };
  window.addEventListener("pointerup", restore, true);
  window.addEventListener("pointercancel", restore, true);
}

type Side = "before" | "after" | "into";
type DragProps = HTMLAttributes<HTMLElement> & { "data-drop"?: Side };

export interface BlockDrag {
  /** A statement: it can be dragged, and blocks dropped before or after it. */
  block: (at: Path) => DragProps;
  /** An empty body, at its position 0: blocks dropped into it. */
  empty: (at: Path) => DragProps;
  /** A palette option: dragging it inserts its block, with any tool it adds to the macro. */
  paletteItem: (insert: Insert) => DragProps;
}

/** `onDropped` gets the path of the dropped statement, so focus can follow it. */
export function useBlockDrag(macro: Macro, dispatch: Dispatch<EditorAction>, onDropped: (at: Path) => void): BlockDrag {
  // The dragged item stays in this document, so a ref carries it; dragover events cannot read dataTransfer.
  const dragged = useRef<DragItem | null>(null);
  const [over, setOver] = useState<{ key: string; side: Side } | null>(null);
  const clear = () => setOver(null);

  const source = (item: DragItem): DragProps => ({
    draggable: true,
    onPointerDownCapture: suspendDragInFields,
    onDragStart(event: DragEvent) {
      // Blocks nest; only the innermost one under the pointer is dragged.
      event.stopPropagation();
      dragged.current = item;
      event.dataTransfer.effectAllowed = item.kind === "stmt" ? "move" : "copy";
      event.dataTransfer.setData(MIME, item.kind === "stmt" ? pathKey(item.from) : item.insert.stmt.op);
    },
    onDragEnd() {
      dragged.current = null;
      clear();
    },
  });

  const target = (at: Path, empty: boolean): DragProps => {
    const key = pathKey(at);
    const resolve = (event: DragEvent) => {
      const item = dragged.current;
      if (!item) return undefined;
      // The innermost block under the pointer is the target, not the blocks around it.
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const lower = !empty && event.clientY > rect.top + rect.height / 2;
      const to = empty ? at : dropPosition(at, lower);
      const action = dropAction(macro, item, to);
      const side: Side = empty ? "into" : lower ? "after" : "before";
      return action && { item, to, action, side };
    };
    return {
      "data-drop": over?.key === key ? over.side : undefined,
      onDragOver(event: DragEvent) {
        if (!dragged.current) return;
        const drop = resolve(event);
        if (!drop) return clear();
        event.preventDefault();
        event.dataTransfer.dropEffect = drop.item.kind === "stmt" ? "move" : "copy";
        setOver((prev) => (prev?.key === key && prev.side === drop.side ? prev : { key, side: drop.side }));
      },
      onDragLeave(event: DragEvent) {
        const to = event.relatedTarget;
        if (!(to instanceof Node && event.currentTarget.contains(to))) setOver((prev) => (prev?.key === key ? null : prev));
      },
      onDrop(event: DragEvent) {
        const drop = resolve(event);
        clear();
        if (!drop) return;
        event.preventDefault();
        dragged.current = null;
        dispatch(drop.action);
        // Chrome ignores focus() until the drag session ends, after this handler and dragend.
        const landed = landedAt(drop.item, drop.to);
        setTimeout(() => onDropped(landed), 0);
      },
    };
  };

  return {
    block: (at) => ({ ...source({ kind: "stmt", from: at }), ...target(at, false) }),
    empty: (at) => target(at, true),
    paletteItem: (insert) => source({ kind: "palette", insert }),
  };
}
