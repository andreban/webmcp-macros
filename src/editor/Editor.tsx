// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useReducer, useState } from "react";
import type { Macro } from "../macro/types";
import type { NodePath } from "../runner/machine";
import { loadMacros, saveMacro } from "../storage";
import { InputsPanel } from "./InputsPanel";
import { createNewMacro, type EditorParams, editorPath, historyShortcut, isDirty } from "./page";
import { ProgramEditor } from "./ProgramEditor";
import { type ObservedSchemas, observedSchemas } from "./resultFields";
import { RunBar } from "./RunBar";
import { type LivePage, SitesPanel, triggerStatus, useTabPage } from "./SitesPanel";
import { createEditorState, type EditorAction, editorReducer, type EditorState } from "./state";
import { useEditorRun } from "./useEditorRun";

type Loaded =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; macro: Macro; isNew: boolean };

/** The editor page: loads the macro its URL names, or starts a new one for the tab's site. */
export function EditorPage({ params }: { params: EditorParams }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  useEffect(() => {
    let active = true;
    void loadInitial(params).then(
      (next) => active && setLoaded(next),
      () => active && setLoaded({ status: "missing" }),
    );
    return () => {
      active = false;
    };
  }, [params]);

  if (loaded.status === "loading") return <main aria-busy="true" />;
  if (loaded.status === "missing") {
    return (
      <main>
        <h1>Macro not found</h1>
        <p>This macro is no longer saved.</p>
        <a href={`/${editorPath({ tabId: params.tabId })}`}>Start a new macro</a>
      </main>
    );
  }
  return <EditorSession initial={loaded.macro} isNew={loaded.isNew} tabId={params.tabId} />;
}

async function loadInitial({ macroId, tabId }: EditorParams): Promise<Loaded> {
  if (macroId !== undefined) {
    const macro = (await loadMacros()).find((saved) => saved.id === macroId);
    return macro ? { status: "ready", macro, isNew: false } : { status: "missing" };
  }
  // The tab may have closed since the side panel linked here; then the site starts empty.
  const url = tabId === undefined ? undefined : await chrome.tabs.get(tabId).then((tab) => tab.url, () => undefined);
  return { status: "ready", macro: createNewMacro(url), isNew: true };
}

/** Holds one macro's editing session: history, the saved baseline, saving and shortcuts. */
function EditorSession({ initial, isNew, tabId }: { initial: Macro; isNew: boolean; tabId: number | undefined }) {
  const [state, dispatch] = useReducer(editorReducer, initial, createEditorState);
  // A new macro starts unsaved but unchanged, so leaving it untouched does not warn.
  const [baseline, setBaseline] = useState(initial);
  const [everSaved, setEverSaved] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = isDirty(state.macro, baseline);
  const { start, stop, clear, ...trace } = useEditorRun(tabId);
  // Result shapes from runs, kept after the run bar is dismissed so field suggestions stay.
  const [observed, setObserved] = useState<ObservedSchemas>({});
  const [seenCalls, setSeenCalls] = useState(trace.calls);
  if (trace.calls !== seenCalls) {
    setSeenCalls(trace.calls);
    if (trace.calls.length > 0) setObserved({ ...observed, ...observedSchemas(trace.calls) });
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Inside a text field the keys undo typing, as users expect there.
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const action = historyShortcut(event);
      if (!action) return;
      event.preventDefault();
      dispatch({ type: action });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = async () => {
    const macro = state.macro;
    setSaving(true);
    setError("");
    try {
      await saveMacro(macro);
      setBaseline(macro);
      setEverSaved(true);
      // A reload now reopens the saved macro instead of starting another new one.
      history.replaceState(null, "", `/${editorPath({ macroId: macro.id, tabId })}`);
    } catch (caught) {
      setError(`Could not save: ${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setSaving(false);
    }
  };

  const status = saving ? "Saving…" : error || (dirty || !everSaved ? "Unsaved changes" : "All changes saved");
  return (
    <EditorView
      state={state}
      dispatch={dispatch}
      status={status}
      canSave={!saving && (dirty || !everSaved)}
      onSave={() => void save()}
      tabId={tabId}
      runBar={
        <RunBar
          macro={state.macro}
          tabId={tabId}
          trace={trace}
          onRun={(inputs) => start(state.macro, inputs)}
          onStop={stop}
          onDismiss={clear}
        />
      }
      running={trace.at}
      observed={observed}
    />
  );
}

export interface EditorViewProps {
  state: EditorState;
  /** Every edit goes through the reducer; later panels receive this too. */
  dispatch: Dispatch<EditorAction>;
  /** Announced through `role="status"`. */
  status: string;
  canSave: boolean;
  onSave: () => void;
  /** The tab the macro is edited against, if any. */
  tabId?: number;
  /** Runs the macro; rendered above the program. */
  runBar?: ReactNode;
  /** The statement a run is executing, highlighted in the program. */
  running?: NodePath;
  /** Result shapes seen in runs, for field suggestions; never saved into the macro. */
  observed?: ObservedSchemas;
}

/** The editor's layout, from state passed in, so it renders without `chrome.*`. */
export function EditorView({ state, dispatch, status, canSave, onSave, tabId, runBar, running, observed }: EditorViewProps) {
  const { macro } = state;
  const page = useTabPage(tabId);
  return (
    <main className="editor">
      <title>{`${macro.name || "Untitled macro"} · WebMCP Macros`}</title>
      <header className="toolbar">
        <h1>Edit macro</h1>
        <span role="status" className="status">
          {status}
        </span>
        <button
          type="button"
          className="secondary"
          disabled={state.past.length === 0}
          aria-keyshortcuts="Control+Z Meta+Z"
          onClick={() => dispatch({ type: "undo" })}
        >
          Undo
        </button>
        <button
          type="button"
          className="secondary"
          disabled={state.future.length === 0}
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
          onClick={() => dispatch({ type: "redo" })}
        >
          Redo
        </button>
        <button type="button" disabled={!canSave} onClick={onSave}>
          Save
        </button>
      </header>
      <MetaField label="Name" value={macro.name} onCommit={(name) => dispatch({ type: "setMeta", meta: { name } })} />
      {/* Settings are set once and rarely revisited, so they fold away and leave the program in view. */}
      <details className="settings">
        <summary>
          Macro settings <span className="muted">· {settingsSummary(macro, page)}</span>
        </summary>
        <MetaField
          label="Description"
          multiline
          value={macro.description ?? ""}
          onCommit={(text) => dispatch({ type: "setMeta", meta: { description: text || undefined } })}
        />
        <InputsPanel macro={macro} dispatch={dispatch} />
        <SitesPanel macro={macro} dispatch={dispatch} page={page} />
      </details>
      {runBar}
      <ProgramEditor macro={macro} dispatch={dispatch} page={page} running={running} observed={observed} />
    </main>
  );
}

/** The settings' one-line summary: the inputs, then whether the trigger holds on the tab. */
export function settingsSummary(macro: Macro, page: LivePage | undefined): string {
  const count = macro.inputs?.length ?? 0;
  const inputs = count === 0 ? "No inputs" : count === 1 ? "1 input" : `${count} inputs`;
  const live = page && { url: page.url, tools: page.tools.map((tool) => tool.name) };
  return `${inputs}. ${triggerStatus(macro, live)}`;
}

/**
 * A text field that commits on blur or Enter, so a word typed is one undo
 * step rather than one per keystroke. The draft is transient UI state; it
 * shows the macro's value whenever no edit is in progress (after undo, too).
 */
function MetaField({
  label,
  value,
  multiline = false,
  onCommit,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  const field = {
    value: draft ?? value,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: commit,
    onKeyDown: (event: ReactKeyboardEvent) => {
      if (event.key === "Escape") setDraft(null);
      else if (event.key === "Enter" && (!multiline || event.ctrlKey || event.metaKey)) commit();
    },
  };
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? <textarea rows={2} {...field} /> : <input type="text" {...field} />}
    </label>
  );
}
