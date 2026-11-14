// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/**
 * Keeps each tab's run in `chrome.storage.session` so a run outlives the
 * service worker: Chrome stops an idle worker after about 30 seconds, and a
 * long run waiting on a page would otherwise be lost. Storage is reached only
 * through `RunStorageArea`, so this module runs under Vitest in Node.
 */
import { isMacro, type ToolInfo } from "../macro/types";
import type { RunState } from "../runner/machine";

/** The part of `chrome.storage.StorageArea` the store uses. */
export interface RunStorageArea {
  get(keys: null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string): Promise<void>;
}

export interface SavedRun {
  tabId: number;
  /** The state before the step that was running, or after the last step. */
  state: RunState;
  /**
   * The tools the running step has called so far. Present only while a step
   * makes calls: if the worker dies then, those calls may have taken effect.
   */
  inFlight?: string[];
}

export interface RunStore {
  save(tabId: number, state: RunState, inFlight?: string[]): Promise<void>;
  remove(tabId: number): Promise<void>;
  /** Every saved run that is still running; unreadable entries are dropped. */
  loadAll(): Promise<SavedRun[]>;
}

const PREFIX = "run:";

export function createRunStore(area: RunStorageArea): RunStore {
  return {
    async save(tabId, state, inFlight) {
      const saved: SavedRun = inFlight ? { tabId, state, inFlight } : { tabId, state };
      await area.set({ [PREFIX + tabId]: saved });
    },
    async remove(tabId) {
      await area.remove(PREFIX + tabId);
    },
    async loadAll() {
      const runs: SavedRun[] = [];
      for (const [key, value] of Object.entries(await area.get(null))) {
        if (!key.startsWith(PREFIX)) continue;
        if (isSavedRun(value) && value.state.status === "running") runs.push(value);
        else await area.remove(key);
      }
      return runs;
    },
  };
}

/**
 * The state to continue a saved run from. Its step is run again from the
 * start, which repeats every call it had made; that is safe only when each of
 * those tools is read-only. `tools` is the tab's listing, re-read after the
 * restart: a tool missing from it cannot be shown to be read-only.
 */
export function resumeState({ state, inFlight = [] }: SavedRun, tools: readonly ToolInfo[]): RunState {
  const unsafe = inFlight.find((name) => tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint !== true);
  if (unsafe === undefined) return state;
  return {
    ...state,
    status: "failed",
    message: `The extension restarted while "${unsafe}" was running. It may have taken effect, so the run was not continued.`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STATUSES: readonly unknown[] = ["running", "done", "stopped", "failed"];

/**
 * Session storage is private to the extension, but a saved run may come from
 * an older build. Frames are only checked for shape: `step` fails a run whose
 * frames do not fit its macro.
 */
function isRunState(value: unknown): value is RunState {
  if (!isRecord(value)) return false;
  return (
    STATUSES.includes(value.status) &&
    isMacro(value.macro) &&
    isRecord(value.inputs) &&
    isRecord(value.vars) &&
    Array.isArray(value.frames) &&
    value.frames.length > 0 &&
    value.frames.every((frame) => isRecord(frame) && Number.isInteger(frame.pc)) &&
    [value.maxSteps, value.toolTimeoutMs, value.toolCalls, value.steps].every((n) => typeof n === "number")
  );
}

function isSavedRun(value: unknown): value is SavedRun {
  return (
    isRecord(value) &&
    Number.isInteger(value.tabId) &&
    isRunState(value.state) &&
    (value.inFlight === undefined || (Array.isArray(value.inFlight) && value.inFlight.every((name) => typeof name === "string")))
  );
}
