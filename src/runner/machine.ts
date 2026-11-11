/**
 * The state of a run as plain JSON: a stack of frames, one per block being
 * executed, with a program counter each, plus the variables and counters.
 * `step` in `interpreter.ts` advances it one statement at a time, so a run
 * can be saved after any step and continued later, even by another worker.
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

/**
 * Finds the statements of the top frame and the statement that owns them, by
 * walking the frames down from the program. `undefined` when the frames do not
 * fit the program, as a state saved for another version of the macro may not.
 */
export function locate(program: Stmt[], frames: readonly Frame[]): { block: Stmt[]; owner?: Stmt } | undefined {
  let block = program;
  let owner: Stmt | undefined;
  for (let depth = 1; depth < frames.length; depth++) {
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
  if (stmt.op === "repeat" || stmt.op === "while" || stmt.op === "forEach") return branch === "body" ? stmt.body : undefined;
  return undefined;
}
