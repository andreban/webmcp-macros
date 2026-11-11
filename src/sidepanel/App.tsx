import { useEffect, useState } from "react";
import { decodeMacro, encodeMacro } from "../macro/codec";
import { matchingMacros } from "../macro/matcher";
import type { Macro } from "../macro/types";
import { deleteMacro, loadMacros, onMacrosChanged, saveMacro } from "../storage";
import { InputForm } from "../ui/InputForm";
import { resultLine, useRun } from "../ui/useRun";
import { ProgramView } from "./ProgramView";
import { useActiveTab } from "./useActiveTab";

export function App() {
  const tab = useActiveTab();
  const [macros, setMacros] = useState<Macro[]>([]);
  const [selected, setSelected] = useState<Macro | null>(null);
  const { run, running, start, stop, clear } = useRun(tab.id);

  useEffect(() => {
    void loadMacros().then(setMacros);
    return onMacrosChanged(setMacros);
  }, []);

  const matches = matchingMacros(macros, tab.url, tab.tools.map((tool) => tool.name));
  const launch = (macro: Macro) => (macro.inputs?.length ? setSelected(macro) : start(macro, {}));

  return (
    <main>
      <h1>WebMCP Macros</h1>

      <section>
        <h2>This page</h2>
        {run && (
          <div className="run">
            <p className={`status ${run.result?.status ?? ""}`} role="status">
              {resultLine(run)}
            </p>
            <button className="secondary" onClick={running ? stop : clear}>
              {running ? "Stop" : "Dismiss"}
            </button>
          </div>
        )}
        {selected && (
          <div className="card">
            <h3>{selected.name}</h3>
            <InputForm
              macro={selected}
              submitLabel="Run"
              onCancel={() => setSelected(null)}
              onSubmit={(values) => {
                start(selected, values);
                setSelected(null);
              }}
            />
          </div>
        )}
        {matches.length === 0 ? (
          <p className="muted">No saved macro matches this page.</p>
        ) : (
          matches.map((macro) => (
            <div className="row" key={macro.id}>
              <span>{macro.name}</span>
              <button onClick={() => launch(macro)} disabled={running}>
                Run
              </button>
            </div>
          ))
        )}
        <details>
          <summary>
            {tab.tools.length} WebMCP {tab.tools.length === 1 ? "tool" : "tools"} on this page
          </summary>
          <ul className="tools">
            {tab.tools.map((tool) => (
              <li key={tool.name}>
                <code>{tool.name}</code>
                {tool.description && <p className="muted">{tool.description}</p>}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section>
        <h2>Saved macros</h2>
        {macros.length === 0 && <p className="muted">Nothing saved yet. Import a macro below.</p>}
        {macros.map((macro) => (
          <MacroCard key={macro.id} macro={macro} />
        ))}
      </section>

      <section>
        <h2>Import</h2>
        <Importer />
      </section>
    </main>
  );
}

function MacroCard({ macro }: { macro: Macro }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    await navigator.clipboard.writeText(await encodeMacro(macro));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <details className="card">
      <summary>{macro.name}</summary>
      {macro.description && <p className="muted">{macro.description}</p>}
      <ProgramView macro={macro} />
      <div className="actions">
        <button className="secondary" onClick={() => void deleteMacro(macro.id)}>
          Delete
        </button>
        <button onClick={() => void share()}>{copied ? "Copied" : "Copy share string"}</button>
      </div>
    </details>
  );
}

/** Paste a share string, review what the macro can do, then save it. */
function Importer() {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Macro | null>(null);
  const [error, setError] = useState("");

  const review = async () => {
    setError("");
    try {
      setPending(await decodeMacro(text));
    } catch (cause) {
      setPending(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (pending) {
    const sites = Object.values(pending.sites).flatMap((site) => site.match);
    const tools = [...new Set(Object.values(pending.tools).map((tool) => tool.name))];
    return (
      <div className="card">
        <h3>{pending.name}</h3>
        {pending.description && <p className="muted">{pending.description}</p>}
        <p>Runs on:</p>
        <ul>
          {sites.map((site) => (
            <li key={site}>
              <code>{site}</code>
            </li>
          ))}
        </ul>
        <p>
          Calls these tools: {tools.map((tool) => <code key={tool}>{tool}</code>).reduce<React.ReactNode[]>((all, node) => (all.length ? [...all, ", ", node] : [node]), [])}
        </p>
        <ProgramView macro={pending} />
        <div className="actions">
          <button className="secondary" onClick={() => setPending(null)}>
            Cancel
          </button>
          <button
            onClick={() => {
              void saveMacro(pending);
              setPending(null);
              setText("");
            }}
          >
            Save macro
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste a wmm1.… share string" rows={3} />
      {error && <p className="status failed">{error}</p>}
      <div className="actions">
        <button onClick={() => void review()} disabled={!text.trim()}>
          Review
        </button>
      </div>
    </>
  );
}
