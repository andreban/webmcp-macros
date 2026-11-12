import { type Dispatch, type KeyboardEvent, useEffect, useId, useState } from "react";
import { siteMatches, triggerSatisfied } from "../macro/matcher";
import type { Macro, MacroTrigger, ToolInfo } from "../macro/types";
import { type BackgroundRequest, isFrameToolLists } from "../messages";
import { defaultTrigger } from "./defaultTrigger";
import type { EditorAction } from "./state";

/** The tab the editor edits against: its URL and the tool names registered there now. */
export interface TabPage {
  url: string;
  tools: readonly string[];
}

/** Why `pattern` cannot be added next to `others`, or undefined when it can. */
export function patternError(pattern: string, others: readonly string[]): string | undefined {
  if (pattern === "") return "Enter a URL pattern.";
  if (/\s/.test(pattern)) return "A pattern cannot contain spaces.";
  // A scheme, a host and a path, so a pattern cannot match every site by accident.
  if (!/^(https?|\*):\/\/[^/]+\//.test(pattern)) return "Use a pattern such as https://example.com/*.";
  return others.includes(pattern) ? "This pattern is already listed." : undefined;
}

/** A sentence on whether the macro would be offered on `page` right now. */
export function triggerStatus(macro: Macro, page: TabPage | undefined): string {
  if (!page) return "No tab to check the trigger against.";
  if (triggerSatisfied(macro, page.url, page.tools)) return "Offered on this tab: the trigger is satisfied.";
  const site = Object.hasOwn(macro.sites, macro.trigger.site) ? macro.sites[macro.trigger.site] : undefined;
  if (!site || !siteMatches(site, page.url)) return "Not offered: the trigger site does not match this tab.";
  if (macro.trigger.anyOf.length === 0) return "Not offered: the trigger has no tool set.";
  // Page tool names, not aliases: they are what the author can look for on the page.
  const name = (alias: string) => (Object.hasOwn(macro.tools, alias) ? macro.tools[alias]?.name : undefined) ?? alias;
  const missing = macro.trigger.anyOf.map((set) => set.map(name).filter((tool) => !page.tools.includes(tool)));
  const fewest = missing.reduce((best, set) => (set.length < best.length ? set : best));
  // Every name is registered when a set's tool is declared on another site, which the matcher rejects.
  return fewest.length > 0
    ? `Not offered: this tab does not register ${fewest.join(", ")}.`
    : "Not offered: a trigger tool belongs to another site.";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An iframe's tools, under the origin Chrome reported for the frame. */
export interface PageFrame {
  frameId: number;
  origin: string;
  tools: readonly ToolInfo[];
}

/** The tab with its tools as the page reports them, schemas included. */
export interface LivePage {
  url: string;
  /** The top frame's tools: the ones the trigger is matched against. */
  tools: readonly ToolInfo[];
  /** Iframes that report tools, in frame id order. */
  frames?: readonly PageFrame[];
}

/**
 * `page` with one frame's report applied. An iframe without an origin is left
 * out: a macro could not name it, and the background always knows the origin
 * of a frame that reported.
 */
export function withFrameTools(page: LivePage, frameId: number, origin: string | undefined, value: unknown): LivePage {
  const tools = toolInfos(value);
  if (frameId === 0) return { ...page, tools };
  const others = (page.frames ?? []).filter((frame) => frame.frameId !== frameId);
  const frames = origin === undefined || tools.length === 0 ? others : [...others, { frameId, origin, tools }];
  return { ...page, frames: frames.toSorted((a, b) => a.frameId - b.frameId) };
}

/** The page at `url` from the background's `list-frame-tools` reply; anything malformed lists no tools. */
export function pageFromFrames(url: string, reply: unknown): LivePage {
  const empty: LivePage = { url, tools: [] };
  const lists = isFrameToolLists(reply) ? reply : [];
  return lists.reduce((page, { frameId, origin, tools }) => withFrameTools(page, frameId, origin, tools), empty);
}

/**
 * Tools from a `list-tools` reply or a `tools-changed` message. The page controls
 * them: a tool without a name is dropped, and a malformed description or schema is left out.
 */
export function toolInfos(value: unknown): ToolInfo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tool: unknown) => {
    if (!isRecord(tool) || typeof tool.name !== "string") return [];
    const info: ToolInfo = { name: tool.name };
    if (typeof tool.description === "string") info.description = tool.description;
    if (isRecord(tool.inputSchema)) info.inputSchema = tool.inputSchema;
    return [info];
  });
}

/**
 * Follows the tab's URL and the tools of each of its frames: the background
 * lists them all, and content scripts broadcast `tools-changed` to extension pages too.
 */
export function useTabPage(tabId: number | undefined): LivePage | undefined {
  const [page, setPage] = useState<LivePage>();
  useEffect(() => {
    if (tabId === undefined) return;
    let active = true;
    const refresh = async () => {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      const request: BackgroundRequest = { type: "list-frame-tools", tabId };
      const reply: unknown = await chrome.runtime.sendMessage(request).catch(() => []);
      if (active) setPage(tab?.url === undefined ? undefined : pageFromFrames(tab.url, reply));
    };
    const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== tabId || !isRecord(message) || message.type !== "tools-changed") return;
      const { frameId = 0, origin } = sender;
      setPage((current) => current && withFrameTools(current, frameId, origin, message.tools));
    };
    const onUpdated = (updatedId: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (updatedId === tabId && (change.url !== undefined || change.status === "complete")) void refresh();
    };
    void refresh();
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      active = false;
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [tabId]);
  return page;
}

/** Edits each site's URL patterns and the trigger's tool sets, and shows whether the trigger holds on the tab. */
export function SitesPanel({ macro, dispatch, page: live }: { macro: Macro; dispatch: Dispatch<EditorAction>; page?: LivePage }) {
  const page = live && { url: live.url, tools: live.tools.map((tool) => tool.name) };
  const { trigger } = macro;
  const setTrigger = (next: MacroTrigger) => dispatch({ type: "setMeta", meta: { trigger: next } });
  const siteTools = Object.entries(macro.tools).filter(([, tool]) => tool.site === trigger.site);
  const proposal = defaultTrigger(macro);
  const proposed = JSON.stringify(proposal) === JSON.stringify(trigger);
  return (
    <section aria-labelledby="sites-heading">
      <h2 id="sites-heading">Sites and trigger</h2>
      {Object.entries(macro.sites).map(([key, site]) => {
        const setMatch = (match: string[]) =>
          dispatch({ type: "setMeta", meta: { sites: { ...macro.sites, [key]: { ...site, match } } } });
        return (
          <fieldset key={key}>
            <legend>Site {key}: URL patterns (* matches anything)</legend>
            {site.match.map((pattern, i) => (
              <PatternField
                key={i}
                label={`Pattern ${i + 1}`}
                value={pattern}
                others={site.match.toSpliced(i, 1)}
                onCommit={(next) => setMatch(site.match.with(i, next))}
                onRemove={() => setMatch(site.match.toSpliced(i, 1))}
              />
            ))}
            <PatternField label="Add a pattern" value="" others={site.match} onCommit={(next) => setMatch([...site.match, next])} />
          </fieldset>
        );
      })}
      <h3>Trigger on site {trigger.site}</h3>
      <p className="muted">Offered when every tool of any one set is registered. An empty set needs the site alone.</p>
      {trigger.anyOf.map((set, i) => (
        <fieldset key={i}>
          <legend>Tool set {i + 1}</legend>
          {siteTools.map(([alias, tool]) => (
            <label key={alias}>
              <input
                type="checkbox"
                checked={set.includes(alias)}
                onChange={(event) => {
                  const next = event.target.checked ? [...set, alias] : set.filter((other) => other !== alias);
                  setTrigger({ ...trigger, anyOf: trigger.anyOf.with(i, next) });
                }}
              />{" "}
              {alias} <code>{tool.name}</code>
            </label>
          ))}
          <button type="button" className="secondary" onClick={() => setTrigger({ ...trigger, anyOf: trigger.anyOf.toSpliced(i, 1) })}>
            Remove set {i + 1}
          </button>
        </fieldset>
      ))}
      <div className="actions">
        <span role="status" className="status">
          {triggerStatus(macro, page)}
        </span>
        <button type="button" className="secondary" onClick={() => setTrigger({ ...trigger, anyOf: [...trigger.anyOf, []] })}>
          Add tool set
        </button>
        <button type="button" disabled={proposed} title={proposal.anyOf[0]?.join(", ")} onClick={() => setTrigger(proposal)}>
          Use proposed trigger
        </button>
      </div>
    </section>
  );
}

/** A pattern draft, validated and committed on Enter or blur; Escape restores the saved value. */
function PatternField(props: {
  label: string;
  value: string;
  others: readonly string[];
  onCommit: (pattern: string) => void;
  onRemove?: () => void;
}) {
  const { label, value, others, onCommit, onRemove } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const errorId = useId();
  const text = draft ?? value;
  // An empty add field stays quiet; any other draft, or a saved pattern, is checked.
  const error = value === "" && text.trim() === "" ? undefined : patternError(text.trim(), others);
  const commit = () => {
    const next = text.trim();
    if (draft === null || next === value || error) return;
    onCommit(next);
    setDraft(null);
  };
  return (
    <div className="field">
      <span>{label}</span>
      <input
        type="text"
        value={text}
        aria-label={label}
        aria-invalid={error !== undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "Enter") commit();
          else if (event.key === "Escape") setDraft(null);
        }}
      />
      {error ? (
        <span id={errorId} className="status failed">
          {error}
        </span>
      ) : null}
      {onRemove ? (
        <button type="button" className="secondary" onClick={onRemove}>
          Remove {label.toLowerCase()}
        </button>
      ) : null}
    </div>
  );
}
