import { useEffect, useState } from "react";
import type { Macro } from "../macro/types";
import { InputForm } from "../ui/InputForm";
import { resultLine, useRun } from "../ui/useRun";

/**
 * The on-page launcher: a small corner button that only exists while at least
 * one macro matches the page. It never takes focus on its own.
 */
export function Widget({ macros }: { macros: Macro[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Macro | null>(null);
  const { run, running, start, stop, clear } = useRun();

  // Keep the panel open while a run is in flight, even if its trigger tools
  // unregister mid-run (they usually do, as the page changes state).
  const visible = macros.length > 0 || run !== null;

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  if (!visible) return null;

  const launch = (macro: Macro) => {
    if (macro.inputs?.length) setSelected(macro);
    else start(macro, {});
  };

  let panel = null;
  if (run) {
    panel = (
      <>
        <p className={`wmm-status ${run.result?.status ?? ""}`} role="status">
          {resultLine(run)}
        </p>
        <div className="wmm-actions">
          {running ? (
            <button className="wmm-secondary" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="wmm-secondary" onClick={clear}>
              Close
            </button>
          )}
        </div>
      </>
    );
  } else if (selected) {
    panel = (
      <>
        <p className="wmm-title">{selected.name}</p>
        <InputForm
          macro={selected}
          submitLabel="Run"
          onCancel={() => setSelected(null)}
          onSubmit={(values) => {
            start(selected, values);
            setSelected(null);
          }}
        />
      </>
    );
  } else {
    panel = (
      <>
        <p className="wmm-title">Macros for this page</p>
        {macros.map((macro) => (
          <div className="wmm-macro" key={macro.id}>
            <div>
              {macro.name}
              {macro.description && <small>{macro.description}</small>}
            </div>
            <button onClick={() => launch(macro)}>Run</button>
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="wmm-root">
      {(open || run) && <div className="wmm-panel">{panel}</div>}
      <button
        className="wmm-launcher"
        aria-label={`WebMCP Macros: ${macros.length} available`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ▶{macros.length > 0 && <span className="wmm-badge">{macros.length}</span>}
      </button>
    </div>
  );
}
