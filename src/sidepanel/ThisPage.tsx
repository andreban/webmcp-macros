// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { checkCompatibility } from "../macro/compat";
import { matchingMacros } from "../macro/matcher";
import type { Json, Macro, ToolInfo } from "../macro/types";
import { InputForm } from "../ui/InputForm";
import { openEditor } from "./SavedMacros";
import { resultLine, useRun, type RunState } from "../ui/useRun";
import { useActiveTab, type ActiveTab } from "./useActiveTab";

/**
 * What the section shows for a tab. `unreachable` is a tab without our
 * content script (browser pages, or a page still loading); `ready` with no
 * tools is a page that registers none right now, or has no WebMCP at all.
 */
export type PageView =
  | { kind: "no-tab" }
  | { kind: "unreachable" }
  | { kind: "ready"; tools: ToolInfo[]; matches: Macro[] };

/** Derives the section's view from the tab and the saved macros, on every render. */
export function pageView(tab: ActiveTab, macros: readonly Macro[]): PageView {
  if (tab.id === undefined) return { kind: "no-tab" };
  if (tab.tools === null) return { kind: "unreachable" };
  const names = tab.tools.map((tool) => tool.name);
  return { kind: "ready", tools: tab.tools, matches: matchingMacros(macros, tab.url, names) };
}

/** The active tab's tools and matching macros, with Run. */
export function ThisPage({ macros }: { macros: readonly Macro[] }) {
  const tab = useActiveTab();
  // Keyed by tab so a run or open form never carries over to another tab.
  return <TabSection key={tab.id ?? "none"} tab={tab} macros={macros} />;
}

function TabSection({ tab, macros }: { tab: ActiveTab; macros: readonly Macro[] }) {
  const { run, start, stop, clear } = useRun(tab.id);
  const [formFor, setFormFor] = useState<string | null>(null);
  const view = pageView(tab, macros);
  // Derived, so a form closes by itself when its macro stops matching.
  const formMacro = view.kind === "ready" ? (view.matches.find((macro) => macro.id === formFor) ?? null) : null;

  return (
    <ThisPageView
      view={view}
      run={run}
      formMacro={formMacro}
      onRun={(macro) => (macro.inputs?.length ? setFormFor(macro.id) : start(macro, {}))}
      onSubmit={(macro, values) => {
        setFormFor(null);
        start(macro, values);
      }}
      onCancel={() => setFormFor(null)}
      onUpdate={(macro) => void openEditor(macro.id).catch(() => {})}
      onNewMacro={() => void openEditor().catch(() => {})}
      onStop={stop}
      onDismiss={clear}
    />
  );
}

export interface ThisPageViewProps {
  view: PageView;
  run: RunState | null;
  /** The matching macro whose input form is open. */
  formMacro: Macro | null;
  onRun(macro: Macro): void;
  onSubmit(macro: Macro, values: Record<string, Json>): void;
  onCancel(): void;
  /** Opens a macro in the editor: to edit it, or because it no longer fits the page's tools. */
  onUpdate(macro: Macro): void;
  /** Opens the editor on a new macro for this page, so its tools are there to build with. */
  onNewMacro(): void;
  onStop(): void;
  onDismiss(): void;
}

/** The section itself, with every piece of state passed in. */
export function ThisPageView(props: ThisPageViewProps) {
  const { view, run, formMacro, onRun, onSubmit, onCancel, onUpdate, onNewMacro, onStop, onDismiss } = props;
  const running = run !== null && !run.result;
  return (
    <section aria-labelledby="page-heading">
      <h2 id="page-heading">This page</h2>
      {/* Always rendered so screen readers announce progress as it changes. */}
      <div className="actions run">
        <span role="status" className={run?.result?.status === "failed" ? "status failed" : "status"}>
          {run ? resultLine(run) : ""}
        </span>
        {run === null ? null : running ? (
          <button type="button" className="secondary" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="button" className="secondary" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
      {view.kind === "no-tab" ? <p className="muted">No active tab.</p> : null}
      {view.kind === "unreachable" ? <p className="muted">Macros cannot run on this page.</p> : null}
      {view.kind === "ready" ? (
        <>
          {formMacro ? (
            <div className="card">
              <h3>{formMacro.name}</h3>
              <InputForm macro={formMacro} submitLabel="Run" onCancel={onCancel} onSubmit={(values) => onSubmit(formMacro, values)} />
            </div>
          ) : null}
          {view.matches.length === 0 ? (
            <p className="muted">No saved macro matches this page.</p>
          ) : (
            <ul className="cards">
              {view.matches.map((macro) => {
                const compat = checkCompatibility(macro, view.tools);
                return (
                  <li key={macro.id} className="card row">
                    <span>
                      {macro.name}
                      {compat.status === "changed" ? <small className="muted"> (this site changed its tools)</small> : null}
                    </span>
                    {compat.status === "incompatible" ? null : (
                      <button type="button" className="secondary" aria-label={`Edit ${macro.name}`} onClick={() => onUpdate(macro)}>
                        Edit
                      </button>
                    )}
                    {compat.status === "incompatible" ? (
                      <button type="button" className="secondary" onClick={() => onUpdate(macro)}>
                        Needs update
                      </button>
                    ) : (
                      <button type="button" onClick={() => onRun(macro)} disabled={running}>
                        Run
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="actions">
            <button type="button" className={view.tools.length > 0 ? undefined : "secondary"} onClick={onNewMacro}>
              New macro for this page
            </button>
          </div>
          <details>
            <summary>
              {view.tools.length === 0
                ? "No WebMCP tools on this page"
                : `${view.tools.length} WebMCP ${view.tools.length === 1 ? "tool" : "tools"} on this page`}
            </summary>
            <ul className="tools">
              {view.tools.map((tool) => (
                <li key={tool.name}>
                  <code>{tool.name}</code>
                  {tool.description ? <p className="muted">{tool.description}</p> : null}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </section>
  );
}
