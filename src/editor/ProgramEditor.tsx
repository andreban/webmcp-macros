import { type Dispatch, type FocusEvent, Fragment, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { Macro, Stmt } from "../macro/types";
import { focusAfterRemove, focusStops, insertionPoint, moveDestination, pathKey } from "./blockNav";
import { type BlockDrag, useBlockDrag } from "./dnd";
import { Palette } from "./Palette";
import { createDefault, type Slot, type StmtOp, statements } from "./registry";
import { StmtSlot } from "./Slot";
import { type EditorAction, getNode, moveTarget, type Path } from "./state";

interface View {
  macro: Macro;
  dispatch: Dispatch<EditorAction>;
  /** The `pathKey` of the statement a run is executing. */
  running?: string;
  /** The one block in the tab order. */
  tabStop: string;
  hintId: string;
  drag: BlockDrag;
}

/**
 * The program as editable blocks. Focus is roving: one block is in the tab
 * order, and the arrow keys move through every statement and empty body.
 * Which one is focused is transient UI state, kept as a path into the macro.
 */
export function ProgramEditor({
  macro,
  dispatch,
  running,
}: {
  macro: Macro;
  dispatch: Dispatch<EditorAction>;
  /** The statement a run is executing, highlighted. */
  running?: Path;
}) {
  const [focus, setFocus] = useState<Path>(["program", 0]);
  // Set by keyboard and palette actions only, so a re-render never steals focus.
  const moveFocus = useRef(false);
  // Whether focus is in the blocks. An undo can re-create the focused element,
  // which drops focus to <body> without a blur that says where it went.
  const hasFocus = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const paletteInput = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const stops = focusStops(macro.program);
  // After an undo the focused path may be gone; the first stop then takes over.
  const current = stops.find((path) => pathKey(path) === pathKey(focus)) ?? stops[0] ?? focus;

  useEffect(() => {
    const dropped = hasFocus.current && document.activeElement === document.body;
    if (!moveFocus.current && !dropped) return;
    moveFocus.current = false;
    root.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(pathKey(current))}"]`)?.focus();
  });

  const go = (path: Path) => {
    moveFocus.current = true;
    setFocus(path);
  };
  const stopAt = (target: EventTarget) => {
    const key = target instanceof HTMLElement ? target.dataset.path : undefined;
    const index = stops.findIndex((path) => pathKey(path) === key);
    return { index, at: stops[index] };
  };

  const onFocus = (event: FocusEvent) => {
    hasFocus.current = true;
    // A slot control taking focus leaves the tab stop where it is; moving it
    // here would re-render the block and could pull focus back to it.
    const { at } = stopAt(event.target);
    if (at) setFocus(at);
  };
  const onBlur = (event: FocusEvent) => {
    const to = event.relatedTarget;
    if (to !== null) hasFocus.current = to instanceof Node && root.current?.contains(to) === true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Only a key pressed on a block itself moves, removes or inserts blocks. Keys
    // from the inputs, selects and buttons of its slots have no `data-path`, so
    // they stay with the control (arrows move the caret, Delete edits the text).
    const { index, at } = stopAt(event.target);
    // Control and Meta combinations belong to the page (undo, redo).
    if (!at || event.ctrlKey || event.metaKey) return;
    const found = getNode(macro, at);
    const isStmt = found?.kind === "stmt" && found.node !== undefined;
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    let next: Path | undefined;
    if (step !== 0 && event.altKey) {
      const to = isStmt ? moveDestination(macro, at, step) : undefined;
      if (to) {
        dispatch({ type: "moveStmt", from: at, to });
        next = moveTarget(at, to);
      }
    } else if (step !== 0) next = stops[index + step];
    else if (event.key === "Home") next = stops[0];
    else if (event.key === "End") next = stops.at(-1);
    else if ((event.key === "Delete" || event.key === "Backspace") && isStmt) {
      dispatch({ type: "removeStmt", at });
      next = focusAfterRemove(macro, at);
    } else if (event.key === "/") paletteInput.current?.focus();
    else return;
    event.preventDefault();
    if (next) go(next);
  };

  const drag = useBlockDrag(macro, dispatch, go);

  const insert = (op: StmtOp) => {
    const at = insertionPoint(macro, current);
    dispatch({ type: "insertStmt", at, stmt: createDefault(op) });
    go(at);
  };

  const view: View = { macro, dispatch, running: running && pathKey(running), tabStop: pathKey(current), hintId, drag };
  return (
    <div className="wmm-program">
      <p id={hintId} className="muted">
        Arrow keys move between blocks, Alt+Up and Alt+Down move a block, Delete removes it, and / inserts after it. Blocks can also be dragged.
      </p>
      <div ref={root} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={onBlur}>
        <Body view={view} body={macro.program} at={["program"]} />
      </div>
      <Palette inputRef={paletteInput} onPick={insert} onCancel={() => go(current)} itemProps={drag.paletteItem} />
    </div>
  );
}

const stop = (view: View, path: Path) => {
  const key = pathKey(path);
  return { "data-path": key, tabIndex: key === view.tabStop ? 0 : -1, "aria-describedby": view.hintId };
};

function Body({ view, body, at }: { view: View; body: readonly Stmt[]; at: Path }) {
  return (
    <ol className="wmm-blocks">
      {body.length === 0 ? (
        <li>
          <div className="wmm-empty" {...stop(view, [...at, 0])} {...view.drag.empty([...at, 0])}>
            empty
          </div>
        </li>
      ) : (
        body.map((stmt, index) => (
          // Statements have no identity of their own; the position is the key.
          <li key={index}>
            <Block view={view} stmt={stmt} at={[...at, index]} />
          </li>
        ))
      )}
    </ol>
  );
}

/** Like ProgramView's block, but its slots are editable and the block takes focus. */
function Block({ view, stmt, at }: { view: View; stmt: Stmt; at: Path }) {
  const { category, verb } = statements[stmt.op];
  const label: readonly (string | Slot)[] = statements[stmt.op].label;
  const isRunning = view.running === pathKey(at);
  return (
    <div
      className={`wmm-block wmm-block--${category}${isRunning ? " wmm-block--running" : ""}`}
      aria-current={isRunning ? "step" : undefined}
      {...stop(view, at)}
      {...view.drag.block(at)}
    >
      <span className="wmm-verb">{verb}</span>{" "}
      {label.map((part, index) =>
        // A label is fixed per op, so the position is a stable key.
        typeof part === "string" ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <StmtSlot
            key={index}
            macro={view.macro}
            at={at}
            stmt={stmt}
            part={part}
            dispatch={view.dispatch}
            renderBody={(body, path) => <Body view={view} body={body} at={path} />}
          />
        ),
      )}
    </div>
  );
}
