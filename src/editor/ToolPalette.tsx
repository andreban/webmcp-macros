import { Fragment } from "react";
import { siteMatches } from "../macro/matcher";
import type { JsonSchema, Macro, MacroTool, Stmt } from "../macro/types";
import { type ArgSlot, requiredArgs, schemaSlots } from "./schemaSlots";
import type { LivePage } from "./SitesPanel";

/** A tool the palette offers: one the page registers now, or one the macro already uses. */
export interface PaletteTool {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
  /** Registered on the tab now. Absent tools stay insertable from the macro's snapshot. */
  live: boolean;
  /** The iframe origin the tool is listed under; absent for the top frame. */
  origin?: string;
  /** Recorded on the `tools` entry: set only when another frame registers the same name. */
  frameOrigin?: string;
}

/** The key of the macro's site that covers the tab, falling back to the trigger's site. */
export function pageSite(macro: Macro, url: string | undefined): string {
  const found = url === undefined ? undefined : Object.entries(macro.sites).find(([, site]) => siteMatches(site, url));
  return found?.[0] ?? macro.trigger.site;
}

/**
 * The top frame's tools, then each iframe origin's, in page order, then the
 * macro's tools on `site` that the page does not register. Frames of one
 * origin are merged: a macro can only tell frames apart by origin.
 */
export function paletteTools(macro: Macro, page: LivePage | undefined, site: string): PaletteTool[] {
  const byOrigin = new Map<string | undefined, Map<string, PaletteTool>>([[undefined, new Map()]]);
  for (const { origin, tools } of [{ origin: undefined, tools: page?.tools ?? [] }, ...(page?.frames ?? [])]) {
    const listed = byOrigin.get(origin) ?? new Map<string, PaletteTool>();
    byOrigin.set(origin, listed);
    for (const tool of tools) {
      if (!listed.has(tool.name)) listed.set(tool.name, origin === undefined ? { ...tool, live: true } : { ...tool, live: true, origin });
    }
  }
  const groups = [...byOrigin.values()];
  const shown = groups.flatMap((group) => [...group.values()]);
  // Without `frameOrigin` the top frame wins, then the lowest frame id; naming the origin is only needed on a clash.
  for (const tool of shown) {
    if (tool.origin !== undefined && groups.filter((group) => group.has(tool.name)).length > 1) tool.frameOrigin = tool.origin;
  }
  // A macro tool is on the page when its name is, in the frame its `frameOrigin` names if it has one.
  const topOrigin = page && URL.canParse(page.url) ? new URL(page.url).origin : undefined;
  for (const { site: toolSite, name, inputSchema, frameOrigin } of Object.values(macro.tools)) {
    const known = (tool: PaletteTool) => tool.name === name && (frameOrigin === undefined || frameOrigin === (tool.origin ?? topOrigin));
    if (toolSite !== site || shown.some(known)) continue;
    const entry: PaletteTool = { name, live: false };
    if (inputSchema) entry.inputSchema = inputSchema;
    if (frameOrigin !== undefined) {
      entry.frameOrigin = frameOrigin;
      if (frameOrigin !== topOrigin) entry.origin = frameOrigin;
    }
    shown.push(entry);
  }
  return shown;
}

/** An alias for a page tool name: an identifier, unique among `taken`. */
export function aliasFor(name: string, taken: readonly string[]): string {
  const base = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(?=\d|$)/, "t");
  let alias = base;
  for (let n = 2; taken.includes(alias); n++) alias = `${base}${n}`;
  return alias;
}

/**
 * A call block for `tool` with its required arguments, and the `Macro.tools`
 * entry to merge: an alias already pointing at the tool is reused, and the
 * schema snapshot is refreshed from the page.
 */
export function toolCall(macro: Macro, tool: PaletteTool, site: string): { stmt: Stmt; tools: Record<string, MacroTool> } {
  const existing = Object.entries(macro.tools).find(
    ([, known]) => known.site === site && known.name === tool.name && known.frameOrigin === tool.frameOrigin,
  );
  const alias = existing?.[0] ?? aliasFor(tool.name, Object.keys(macro.tools));
  const entry: MacroTool = { ...existing?.[1], site, name: tool.name };
  if (tool.inputSchema) entry.inputSchema = tool.inputSchema;
  if (tool.frameOrigin !== undefined) entry.frameOrigin = tool.frameOrigin;
  const args = requiredArgs(schemaSlots(tool.inputSchema));
  const stmt: Stmt = Object.keys(args).length > 0 ? { op: "call", tool: alias, args } : { op: "call", tool: alias };
  return { stmt, tools: { [alias]: entry } };
}

const describeSlot = (slot: ArgSlot) => (slot.kind.type === "enum" ? `${slot.key}: ${slot.kind.options.join(" | ")}` : `${slot.key}: ${slot.kind.type}`);

export interface ToolPaletteProps {
  macro: Macro;
  page: LivePage | undefined;
  onPick: (call: ReturnType<typeof toolCall>) => void;
}

/**
 * One call block per tool, generated from the tools' schemas. Tools the tab
 * does not register now are greyed out, not hidden: tools come and go with the
 * page's state, and the snapshot is enough to edit the call. Iframe tools
 * are listed under their frame's origin.
 */
export function ToolPalette({ macro, page, onPick }: ToolPaletteProps) {
  const site = pageSite(macro, page?.url);
  const tools = paletteTools(macro, page, site);
  // The top frame's tools first, then one group per iframe origin.
  const groups = new Map<string | undefined, PaletteTool[]>([[undefined, []]]);
  for (const tool of tools) groups.set(tool.origin, [...(groups.get(tool.origin) ?? []), tool]);
  return (
    <div className="tool-palette">
      <span>Insert tool call</span>
      {tools.length === 0 ? <p className="muted">{page ? "This tab registers no tools." : "No tab to read tools from."}</p> : null}
      {[...groups].map(([origin, group]) =>
        group.length === 0 ? null : (
          <Fragment key={origin ?? ""}>
            {origin === undefined ? null : <span className="muted">In an iframe from {origin}</span>}
            <ul aria-label={origin === undefined ? "Tools" : `Tools in an iframe from ${origin}`} className="palette-options">
              {group.map((tool) => (
                <li key={tool.name}>
                  <ToolOption tool={tool} onPick={() => onPick(toolCall(macro, tool, site))} />
                </li>
              ))}
            </ul>
          </Fragment>
        ),
      )}
    </div>
  );
}

function ToolOption({ tool, onPick }: { tool: PaletteTool; onPick: () => void }) {
  const slots = schemaSlots(tool.inputSchema);
  const optional = slots.filter((slot) => !slot.required).length;
  return (
    <button
      type="button"
      className={`wmm-block wmm-block--call${tool.live ? "" : " wmm-tool--absent"}`}
      title={tool.description}
      onClick={onPick}
    >
      <span className="wmm-verb">call</span> {tool.name}
      {slots.filter((slot) => slot.required).map((slot) => (
        <Fragment key={slot.key}>
          {" "}
          <span className="wmm-pill">{describeSlot(slot)}</span>
        </Fragment>
      ))}
      {optional > 0 ? <span className="muted"> +{optional} optional</span> : null}
      {tool.live ? null : <span className="muted"> (not on this page)</span>}
    </button>
  );
}
