/**
 * The state of a run as plain JSON: a stack of frames, one per block being
 * executed, with a program counter each, plus the variables and counters.
 * `step` in `interpreter.ts` advances it one statement at a time, so a run
 * can be saved after any step and continued later, even by another worker.
 *
 * A procedure call pushes a frame for the procedure's body that holds its
 * variables, so a run paused inside a procedure saves its scope too. The
 * calling statement is evaluated again when the call returns: the results of
 * the calls it already made are kept in its frame and replayed, so no tool is
 * called twice. Evaluation is otherwise pure and the caller's variables cannot
 * change meanwhile, so the replay takes the same path.
 */
import type { Json, Macro, Stmt } from "../macro/types";

/** What to do when a loop's body block reaches its end. */
export type Loop =
  | { kind: "repeat"; i: number; times: number }
  | { kind: "while" }
  | { kind: "forEach"; i: number; items: Json[] };

/**
 * One block in execution. `pc` is the index of the next statement; while a
 * child block runs it stays on the statement that owns the child, and moves
 * on when the child ends. The bottom frame is the program and has no branch.
 */
export interface Frame {
  branch?: "then" | "else" | "body";
  pc: number;
  loop?: Loop;
  /** Set on the body of an `onSite`: the key into `Macro.sites` its steps run on. */
  site?: string;
  /** Starts the body of a procedure call; `slot` is where the caller expects its result. */
  call?: { proc: string; slot: number; locals: Record<string, Json> };
  /**
   * Results of the tool and procedure calls made so far by the statement at
   * `pc` (or by the loop check at the end of the block), keyed by the order in
   * which the calls start. Cleared when `pc` moves.
   */
  results?: Record<string, Json>;
}

export interface RunState {
  status: "running" | "done" | "stopped" | "failed";
  message?: string;
  macro: Macro;
  inputs: Record<string, Json>;
  maxSteps: number;
  toolTimeoutMs: number;
  frames: Frame[];
  vars: Record<string, Json>;
  toolCalls: number;
  /** Tool calls plus loop iterations so far, counted against `maxSteps`. */
  steps: number;
}

/** The index of the innermost procedure call's frame, or -1 outside any procedure. */
export function callBase(frames: readonly Frame[]): number {
  return frames.findLastIndex((frame) => frame.call !== undefined);
}

/**
 * Finds the statements of the top frame and the statement that owns them, by
 * walking the frames down from the program or the innermost procedure body.
 * `undefined` when the frames do not fit the macro, as a state saved for
 * another version of the macro may not.
 */
export function locate(macro: Macro, frames: readonly Frame[]): { block: Stmt[]; owner?: Stmt } | undefined {
  const base = Math.max(0, callBase(frames));
  const proc = frames[base]?.call?.proc;
  const procs = macro.procedures ?? {};
  let block = proc === undefined ? macro.program : Object.hasOwn(procs, proc) ? procs[proc]?.body : undefined;
  if (!block) return undefined;
  let owner: Stmt | undefined;
  for (let depth = base + 1; depth < frames.length; depth++) {
    const parent = frames[depth - 1];
    const branch = frames[depth]?.branch;
    owner = parent && block[parent.pc];
    if (!owner || !branch) return undefined;
    const next = branchOf(owner, branch);
    if (!next) return undefined;
    block = next;
  }
  return { block, owner };
}

function branchOf(stmt: Stmt, branch: NonNullable<Frame["branch"]>): Stmt[] | undefined {
  if (stmt.op === "if") return branch === "body" ? undefined : stmt[branch];
  if (stmt.op === "repeat" || stmt.op === "while" || stmt.op === "forEach" || stmt.op === "onSite") {
    return branch === "body" ? stmt.body : undefined;
  }
  return undefined;
}
