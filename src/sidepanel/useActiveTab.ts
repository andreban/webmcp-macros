import { useEffect, useState } from "react";
import type { ToolInfo } from "../macro/types";
import type { ContentRequest } from "../messages";

export interface ActiveTab {
  id?: number;
  url: string;
  tools: ToolInfo[];
}

/** Follows the active tab of this window and the tools its page exposes. */
export function useActiveTab(): ActiveTab {
  const [tab, setTab] = useState<ActiveTab>({ url: "", tools: [] });

  useEffect(() => {
    let current: number | undefined;

    const refresh = async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      current = active?.id;
      if (current === undefined) return setTab({ url: "", tools: [] });
      const request: ContentRequest = { type: "list-tools" };
      const tools = await (chrome.tabs.sendMessage(current, request, { frameId: 0 }) as Promise<ToolInfo[]>).catch(() => []);
      setTab({ id: current, url: active?.url ?? "", tools: tools ?? [] });
    };

    const onMessage = (message: { type?: string }, sender: chrome.runtime.MessageSender) => {
      if (message.type === "tools-changed" && sender.tab?.id === current) void refresh();
    };
    const onUpdated = (tabId: number, info: { status?: string; url?: string }) => {
      if (tabId === current && (info.status === "complete" || info.url)) void refresh();
    };
    const onActivated = () => void refresh();

    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onActivated.addListener(onActivated);
    void refresh();
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  return tab;
}
