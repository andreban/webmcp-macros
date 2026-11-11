import { type Dispatch, type KeyboardEvent, useEffect, useId, useState } from "react";
import { siteMatches, triggerSatisfied } from "../macro/matcher";
import type { Macro, MacroTrigger } from "../macro/types";
import type { ContentRequest } from "../messages";
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

/** Tool names from a `list-tools` reply or a `tools-changed` message; anything malformed is dropped. */
export function toolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tool: unknown) => (isRecord(tool) && typeof tool.name === "string" ? [tool.name] : []));
}

/** Follows the tab's URL and tools: content scripts broadcast `tools-changed` to extension pages too. */
function useTabPage(tabId: number | undefined): TabPage | undefined {
  const [page, setPage] = useState<TabPage>();
  useEffect(() => {
    if (tabId === undefined) return;
    let active = true;
    const refresh = async () => {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      const request: ContentRequest = { type: "list-tools" };
      const reply: unknown = await chrome.tabs.sendMessage(tabId, request).catch(() => []);
      if (active) setPage(tab?.url === undefined ? undefined : { url: tab.url, tools: toolNames(reply) });
    };
    const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== tabId || !isRecord(message) || message.type !== "tools-changed") return;
      const tools = toolNames(message.tools);
      setPage((current) => current && { ...current, tools });
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
export function SitesPanel({ macro, dispatch, tabId }: { macro: Macro; dispatch: Dispatch<EditorAction>; tabId?: number }) {
  const page = useTabPage(tabId);
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
