// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { Fragment, type HTMLAttributes, type KeyboardEvent, type Ref, useId, useState } from "react";
import type { Macro, MacroTool, Stmt } from "../macro/types";
import { type Category, createDefault, type StmtOp, statements } from "./registry";
import { type ArgSlot, schemaSlots } from "./schemaSlots";
import type { LivePage } from "./SitesPanel";
import { NO_TAB, pageSite, type PaletteTool, paletteTools, toolCall } from "./ToolPalette";

const OPS = Object.keys(statements).filter((op): op is StmtOp => Object.hasOwn(statements, op));

/** The statement kinds whose verb or op contains `query`, in registry order. */
export function matchOps(query: string): StmtOp[] {
  const wanted = query.trim().toLowerCase();
  return OPS.filter((op) => statements[op].verb.includes(wanted) || op.toLowerCase().includes(wanted));
}

/** A palette group: the page's tools first, then the registry's categories. */
export type Group = "page" | Category;

export const GROUPS: readonly { group: Group; heading: string }[] = [
  { group: "page", heading: "Page tools" },
  { group: "call", heading: "Tools" },
  { group: "control", heading: "Control" },
  { group: "data", heading: "Data" },
  { group: "user", heading: "Messages" },
];

/** One palette block: a statement kind, or a call to one of the page's tools. */
export type Entry = { key: string; group: Group } & ({ op: StmtOp } | { tool: PaletteTool });

/** What inserting `entry` adds: a statement, and for a page tool its `Macro.tools` entry. */
export type Insert = { stmt: Stmt; tools?: Record<string, MacroTool> };

/** The palette's blocks matching `query`, grouped in `GROUPS` order. */
export function paletteEntries(macro: Macro, page: LivePage | undefined, query: string): Entry[] {
  const wanted = query.trim().toLowerCase();
  const tools: Entry[] = paletteTools(macro, page, pageSite(macro, page?.url))
    .filter((tool) => tool.name.toLowerCase().includes(wanted) || "call".includes(wanted))
    .map((tool) => ({ key: `tool ${tool.origin ?? ""} ${tool.name}`, group: "page", tool }));
  const ops: Entry[] = matchOps(query).map((op) => ({ key: op, group: statements[op].category, op }));
  return GROUPS.flatMap(({ group }) => [...tools, ...ops].filter((entry) => entry.group === group));
}

export const insertFor = (macro: Macro, page: LivePage | undefined, entry: Entry): Insert =>
  "op" in entry ? { stmt: createDefault(entry.op) } : toolCall(macro, entry.tool, pageSite(macro, page?.url));

export interface PaletteProps {
  macro: Macro;
  page: LivePage | undefined;
  inputRef?: Ref<HTMLInputElement>;
  onPick: (insert: Insert) => void;
  /** Escape: the caller puts focus back where it was. */
  onCancel: () => void;
  /** Extra props for each option, such as making it draggable into the program. */
  itemProps?: (insert: Insert) => HTMLAttributes<HTMLElement>;
}

/**
 * The block palette: the page's tools, then every statement from the registry,
 * under one heading per category. It is a combobox, so one control serves
 * both ways in: typing filters, arrows choose, Enter inserts; "/" on a block
 * focuses it as the quick insert.
 */
export function Palette({ macro, page, inputRef, onPick, onCancel, itemProps }: PaletteProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const entries = paletteEntries(macro, page, query);
  const current = Math.min(active, entries.length - 1);
  const pick = (entry: Entry) => {
    setQuery("");
    setActive(0);
    onPick(insertFor(macro, page, entry));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : entries.length - 1;
      setActive(entries.length === 0 ? 0 : (current + step) % entries.length);
    } else if (event.key === "Enter") {
      const entry = entries[current];
      if (entry === undefined) return;
      event.preventDefault();
      pick(entry);
    } else if (event.key === "Escape") {
      setQuery("");
      onCancel();
    }
  };
  // Option ids come from the position, since a tool name is not a valid id.
  const optionId = (index: number) => `${id}-option-${index}`;
  const activeEntry = entries[current];
  return (
    <div className="palette">
      <label htmlFor={`${id}-input`}>Blocks</label>
      <input
        id={`${id}-input`}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls={`${id}-list`}
        aria-activedescendant={activeEntry === undefined ? undefined : optionId(current)}
        placeholder="Type to filter, Enter to insert"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div id={`${id}-list`} role="listbox" aria-label="Blocks" className="palette-groups">
        {GROUPS.map(({ group, heading }) => {
          const shown = entries.flatMap((entry, index) => (entry.group === group ? [{ entry, index }] : []));
          // The page's group stays visible when empty, to say why it has no tools.
          if (shown.length === 0 && (group !== "page" || query !== "")) return null;
          return (
            <div key={group} role="group" aria-labelledby={`${id}-${group}`} className={`palette-group palette-group--${group}`}>
              <span id={`${id}-${group}`} className="palette-heading">
                {heading}
              </span>
              {shown.length === 0 ? <p className="muted">{page ? "This tab registers no tools right now." : NO_TAB}</p> : null}
              <ul className="palette-options">
                {shown.map(({ entry, index }) => (
                  <li
                    key={entry.key}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === current}
                    className={`wmm-block wmm-block--${"op" in entry ? statements[entry.op].category : "call"}${"tool" in entry && !entry.tool.live ? " wmm-tool--absent" : ""}`}
                    title={"tool" in entry ? entry.tool.description : undefined}
                    onClick={() => pick(entry)}
                    {...itemProps?.(insertFor(macro, page, entry))}
                  >
                    {"op" in entry ? <span className="wmm-verb">{statements[entry.op].verb}</span> : <ToolLabel tool={entry.tool} />}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const describeSlot = (slot: ArgSlot) => (slot.kind.type === "enum" ? `${slot.key}: ${slot.kind.options.join(" | ")}` : `${slot.key}: ${slot.kind.type}`);

/** A tool call block's face: its required arguments, a count of optional ones, and where the tool is. */
function ToolLabel({ tool }: { tool: PaletteTool }) {
  const slots = schemaSlots(tool.inputSchema);
  const optional = slots.filter((slot) => !slot.required).length;
  return (
    <>
      <span className="wmm-verb">call</span> {tool.name}
      {slots.filter((slot) => slot.required).map((slot) => (
        <Fragment key={slot.key}>
          {" "}
          <span className="wmm-pill">{describeSlot(slot)}</span>
        </Fragment>
      ))}
      {optional > 0 ? <span className="muted"> +{optional} optional</span> : null}
      {tool.origin === undefined ? null : <span className="muted"> in an iframe from {tool.origin}</span>}
      {tool.live ? null : <span className="muted"> (not on this page)</span>}
    </>
  );
}
