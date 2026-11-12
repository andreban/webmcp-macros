import { Fragment } from "react";
import { schemaHash } from "../macro/compat";
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
}

/** The key of the macro's site that covers the tab, falling back to the trigger's site. */
export function pageSite(macro: Macro, url: string | undefined): string {
  const found = url === undefined ? undefined : Object.entries(macro.sites).find(([, site]) => siteMatches(site, url));
  return found?.[0] ?? macro.trigger.site;
}

/** The page's tools in page order, then the macro's tools on `site` that the page does not register. */
export function paletteTools(macro: Macro, page: LivePage | undefined, site: string): PaletteTool[] {
  const live: PaletteTool[] = (page?.tools ?? []).map((tool) => ({ ...tool, live: true }));
  const names = new Set(live.map((tool) => tool.name));
  const absent = Object.values(macro.tools).flatMap((tool) => {
    if (tool.site !== site || names.has(tool.name)) return [];
    names.add(tool.name);
    const entry: PaletteTool = { name: tool.name, live: false };
    if (tool.inputSchema) entry.inputSchema = tool.inputSchema;
    return [entry];
  });
  return [...live, ...absent];
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
 * schema snapshot and its hash are refreshed from the page, so a later change
 * on the site can be detected.
 */
export function toolCall(macro: Macro, tool: PaletteTool, site: string): { stmt: Stmt; tools: Record<string, MacroTool> } {
  const existing = Object.entries(macro.tools).find(([, known]) => known.site === site && known.name === tool.name);
  const alias = existing?.[0] ?? aliasFor(tool.name, Object.keys(macro.tools));
  const entry: MacroTool = { ...existing?.[1], site, name: tool.name };
  if (tool.inputSchema) {
    entry.inputSchema = tool.inputSchema;
    entry.schemaHash = schemaHash(tool.inputSchema);
  }
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
 * page's state, and the snapshot is enough to edit the call.
 */
export function ToolPalette({ macro, page, onPick }: ToolPaletteProps) {
  const site = pageSite(macro, page?.url);
  const tools = paletteTools(macro, page, site);
  return (
    <div className="tool-palette">
      <span>Insert tool call</span>
      {tools.length === 0 ? (
        <p className="muted">{page ? "This tab registers no tools." : "No tab to read tools from."}</p>
      ) : (
        <ul aria-label="Tools" className="palette-options">
          {tools.map((tool) => {
            const slots = schemaSlots(tool.inputSchema);
            const optional = slots.filter((slot) => !slot.required).length;
            return (
              <li key={tool.name}>
                <button
                  type="button"
                  className={`wmm-block wmm-block--call${tool.live ? "" : " wmm-tool--absent"}`}
                  title={tool.description}
                  onClick={() => onPick(toolCall(macro, tool, site))}
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
