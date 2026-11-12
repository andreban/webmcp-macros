import { createContext } from "react";
import { schemaHash } from "../macro/compat";
import { siteMatches } from "../macro/matcher";
import type { JsonSchema, Macro, MacroTool, Stmt } from "../macro/types";
import { requiredArgs, schemaSlots } from "./schemaSlots";
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
 * The alias for `tool` and the `Macro.tools` entry to merge: an alias already
 * pointing at the tool is reused, and the schema snapshot and its hash are
 * refreshed from the page, so a later change on the site can be detected.
 */
export function toolEntry(macro: Macro, tool: PaletteTool, site: string): { alias: string; tools: Record<string, MacroTool> } {
  const existing = Object.entries(macro.tools).find(
    ([, known]) => known.site === site && known.name === tool.name && known.frameOrigin === tool.frameOrigin,
  );
  const alias = existing?.[0] ?? aliasFor(tool.name, Object.keys(macro.tools));
  const entry: MacroTool = { ...existing?.[1], site, name: tool.name };
  if (tool.inputSchema) {
    entry.inputSchema = tool.inputSchema;
    entry.schemaHash = schemaHash(tool.inputSchema);
  }
  if (tool.frameOrigin !== undefined) entry.frameOrigin = tool.frameOrigin;
  return { alias, tools: { [alias]: entry } };
}

/** A call block for `tool` with its required arguments, and the `Macro.tools` entry to merge (see `toolEntry`). */
export function toolCall(macro: Macro, tool: PaletteTool, site: string): { stmt: Stmt; tools: Record<string, MacroTool> } {
  const { alias, tools } = toolEntry(macro, tool, site);
  const args = requiredArgs(schemaSlots(tool.inputSchema));
  const stmt: Stmt = Object.keys(args).length > 0 ? { op: "call", tool: alias, args } : { op: "call", tool: alias };
  return { stmt, tools };
}

/** The palette's tools and the site they are added on, for tool slots deep in the program. */
export interface PageTools {
  tools: readonly PaletteTool[];
  site: string;
}

/** Provided by the program editor; without it, tool slots offer only the macro's own tools. */
export const PageToolsContext = createContext<PageTools | undefined>(undefined);

/** Shown wherever tools are missing because the editor was not opened from a page. */
export const NO_TAB = "No page to read tools from. Open the page you want to automate and choose New macro for this page in the side panel.";
