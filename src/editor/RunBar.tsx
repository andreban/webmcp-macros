// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import type { Json, Macro } from "../macro/types";
import { InputForm } from "../ui/InputForm";
import { resultLine } from "../ui/useRun";
import type { EditorRun } from "./useEditorRun";

export interface RunBarProps {
  macro: Macro;
  /** The tab to run in; without one the macro cannot run. */
  tabId?: number;
  trace: EditorRun;
  onRun(inputs: Record<string, Json>): void;
  onStop(): void;
  onDismiss(): void;
}

/** Runs the macro as edited against the editor's tab, with its status and a log of tool calls. */
export function RunBar({ macro, tabId, trace, onRun, onStop, onDismiss }: RunBarProps) {
  const [formOpen, setFormOpen] = useState(false);
  const { run, calls } = trace;
  const running = run !== null && !run.result;
  const openRun = () => (macro.inputs?.length ? setFormOpen(true) : onRun({}));
  return (
    <section aria-labelledby="run-heading" className="run-bar">
      <div className="toolbar">
        <h2 id="run-heading">Run</h2>
        {/* Always rendered so screen readers announce progress as it changes. */}
        <span role="status" className={run?.result?.status === "failed" ? "status failed" : "status"}>
          {run ? resultLine(run) : tabId === undefined ? "Open the editor from the side panel to run on a tab." : ""}
        </span>
        {running ? (
          <button type="button" className="secondary" onClick={onStop}>
            Stop
          </button>
        ) : (
          <>
            {run ? (
              <button type="button" className="secondary" onClick={onDismiss}>
                Dismiss
              </button>
            ) : null}
            <button type="button" disabled={tabId === undefined || formOpen} onClick={openRun}>
              Run
            </button>
          </>
        )}
      </div>
      {formOpen ? (
        <InputForm
          macro={macro}
          submitLabel="Run"
          onCancel={() => setFormOpen(false)}
          onSubmit={(values) => {
            setFormOpen(false);
            onRun(values);
          }}
        />
      ) : null}
      {calls.length > 0 ? (
        <ol className="run-log" aria-label="Tool calls">
          {calls.map((call, index) => (
            <li key={index}>
              <code>
                {call.tool}({JSON.stringify(call.args)}) → {JSON.stringify(call.result)}
              </code>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
