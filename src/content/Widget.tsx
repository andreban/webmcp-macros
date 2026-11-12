import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { checkCompatibility } from "../macro/compat";
import type { Json, Macro, ToolInfo } from "../macro/types";
import { InputForm } from "../ui/InputForm";
import { resultLine, useRun, type RunState } from "../ui/useRun";
import { widgetStyles } from "./widgetStyles";

export interface WidgetViewProps {
  macros: Macro[];
  /** The page's tools now, which each macro is checked against. */
  tools: readonly ToolInfo[];
  open: boolean;
  /** The macro whose input form is shown, if any. */
  selected: Macro | null;
  run: RunState | null;
  running: boolean;
  onToggle(): void;
  onLaunch(macro: Macro): void;
  onSubmit(values: Record<string, Json>): void;
  onCancel(): void;
  onStop(): void;
  onClose(): void;
}

/** The launcher's markup for a given state, without hooks into `chrome.*`, so it renders in tests. */
export function WidgetView(props: WidgetViewProps) {
  const { macros, tools, open, selected, run, running } = props;
  const status = run ? (
    <div className="wmm-run">
      <p className={`wmm-status ${run.result?.status ?? ""}`} role="status">
        {resultLine(run)}
      </p>
      <button type="button" className="wmm-secondary" onClick={running ? props.onStop : props.onClose}>
        {running ? "Stop" : "Close"}
      </button>
    </div>
  ) : null;
  const body = selected ? (
    <>
      <p className="wmm-title">{selected.name}</p>
      <InputForm macro={selected} submitLabel="Run" onSubmit={props.onSubmit} onCancel={props.onCancel} />
    </>
  ) : macros.length > 0 ? (
    <>
      <p className="wmm-title">Macros for this page</p>
      {macros.map((macro) => {
        const compat = checkCompatibility(macro, tools);
        return (
          <div className="wmm-macro" key={macro.id}>
            <div>
              {macro.name}
              {compat.status === "changed" ? <small>This site changed its tools since the macro was made.</small> : null}
              {macro.description ? <small>{macro.description}</small> : null}
            </div>
            {/* Opening the editor needs an extension page; the side panel offers it. */}
            {compat.status === "incompatible" ? (
              <span className="wmm-stale" title="This site's tools changed. Update the macro in the editor.">
                Needs update
              </span>
            ) : (
              <button type="button" disabled={running} onClick={() => props.onLaunch(macro)}>
                Run
              </button>
            )}
          </div>
        );
      })}
    </>
  ) : null;

  return (
    <div
      className="wmm-root"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) props.onToggle();
      }}
    >
      {/* A run keeps the panel out even when collapsed, so its status and Stop stay reachable. */}
      {open || run ? (
        <div className="wmm-panel">
          {open ? body : null}
          {status}
        </div>
      ) : null}
      <button
        type="button"
        className="wmm-launcher"
        aria-label={`WebMCP Macros: ${macros.length} available`}
        aria-expanded={open}
        onClick={props.onToggle}
      >
        ▶{macros.length > 0 ? <span className="wmm-badge">{macros.length}</span> : null}
      </button>
    </div>
  );
}

/** The launcher with its state. `onBusyChange` reports whether a run is shown, which keeps it mounted. */
export function Widget({ macros, tools, onBusyChange }: { macros: Macro[]; tools: readonly ToolInfo[]; onBusyChange(busy: boolean): void }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Macro | null>(null);
  const { run, running, start, stop, clear } = useRun();
  const busy = run !== null;

  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  const launch = (macro: Macro) => {
    if (running) return;
    if (macro.inputs?.length) setSelected(macro);
    else start(macro, {});
  };

  return (
    <WidgetView
      macros={macros}
      tools={tools}
      open={open}
      selected={selected}
      run={run}
      running={running}
      onToggle={() => setOpen((current) => !current)}
      onLaunch={launch}
      onSubmit={(values) => {
        // The form stays usable while a run starts elsewhere; the background runs one macro per tab.
        if (selected && !running) start(selected, values);
        setSelected(null);
      }}
      onCancel={() => setSelected(null)}
      onStop={stop}
      onClose={clear}
    />
  );
}

export interface Launcher {
  render(macros: Macro[], tools: readonly ToolInfo[]): void;
  unmount(): void;
}

/**
 * Mounts the launcher in a closed shadow root on a custom element appended to
 * `documentElement`, so the page's styles and scripts cannot reach it and its
 * fixed-position content takes no space in the page's layout. Nothing here
 * moves focus.
 */
export function mountLauncher(onBusyChange: (busy: boolean) => void): Launcher {
  const host = document.createElement("webmcp-macros-launcher");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = widgetStyles;
  const container = document.createElement("div");
  shadow.append(style, container);
  document.documentElement.append(host);
  const root = createRoot(container);
  return {
    render: (macros, tools) => root.render(<Widget macros={macros} tools={tools} onBusyChange={onBusyChange} />),
    unmount: () => {
      root.unmount();
      host.remove();
    },
  };
}
