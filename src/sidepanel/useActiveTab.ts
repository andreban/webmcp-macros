import { useEffect, useState } from "react";
import type { ToolInfo } from "../macro/types";
import type { ContentRequest } from "../messages";

/**
 * The active tab of the side panel's window. `tools` is `null` while the tab's
 * content script has not answered, and stays `null` when it cannot (browser
 * pages, the Web Store, a page still loading): such a page cannot run macros.
 */
export interface ActiveTab {
  id?: number;
  url: string;
  tools: ToolInfo[] | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Tool lists come from the page's content script, and their contents from the
 * site, so names and descriptions are checked before they are rendered.
 */
export function isToolList(value: unknown): value is ToolInfo[] {
  return (
    Array.isArray(value) &&
    value.every(
      (tool) =>
        isRecord(tool) &&
        typeof tool.name === "string" &&
        (tool.description === undefined || typeof tool.description === "string"),
    )
  );
}

/** The tools of a `tools-changed` report, or `null` for any other message. */
export function reportedTools(message: unknown): ToolInfo[] | null {
  return isRecord(message) && message.type === "tools-changed" && isToolList(message.tools) ? message.tools : null;
}

/**
 * Follows the active tab of this window and the tools its page has right now:
 * refreshed on tab switch and navigation, and replaced by each `tools-changed`
 * report from that tab's content script.
 */
export function useActiveTab(): ActiveTab {
  const [tab, setTab] = useState<ActiveTab>({ url: "", tools: null });

  useEffect(() => {
    let current: number | undefined;
    // Answers can arrive out of order after quick tab switches; only the
    // latest refresh may write.
    let generation = 0;
    let active = true;

    const refresh = async () => {
      const mine = ++generation;
      const [focused] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      if (!active || mine !== generation) return;
      current = focused?.id;
      if (current === undefined) return setTab({ url: "", tools: null });
      const id = current;
      const url = focused?.url ?? "";
      setTab((previous) => (previous.id === id && previous.url === url ? previous : { id, url, tools: null }));
      const request: ContentRequest = { type: "list-tools" };
      const reply: unknown = await chrome.tabs.sendMessage(id, request, { frameId: 0 }).catch(() => null);
      if (!active || mine !== generation) return;
      setTab({ id, url, tools: isToolList(reply) ? reply : null });
    };

    const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
      const tools = reportedTools(message);
      const id = sender.tab?.id;
      if (!tools || id === undefined || id !== current || sender.frameId !== 0) return;
      setTab((previous) => (previous.id === id ? { ...previous, tools } : previous));
    };
    const onUpdated = (tabId: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (tabId === current && (info.status === "complete" || info.url !== undefined)) void refresh();
    };
    const onActivated = () => void refresh();

    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onActivated.addListener(onActivated);
    void refresh();
    return () => {
      active = false;
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  return tab;
}
