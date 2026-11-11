/**
 * Service worker: owns macro runs. The runner lives here, not in the page, so
 * a run survives the navigations its own tool calls cause. This file only
 * wires `chrome.*` events to the run host in `runHost.ts`.
 */
import { isBackgroundRequest, isToolList, type ContentRequest, type RunEvent } from "../messages";
import type { ToolInfo } from "../macro/types";
import { loadMacros, seedSamples } from "../storage";
import { createRunHost } from "./runHost";
import { createRunStore, resumeState } from "./runStore";

const sendToTab = (tabId: number, request: ContentRequest, frameId = 0): Promise<unknown> =>
  chrome.tabs.sendMessage(tabId, request, { frameId });

const broadcast = (event: RunEvent): void => {
  // Either side may have no listener (no extension page open, tab gone).
  chrome.runtime.sendMessage(event).catch(() => {});
  chrome.tabs.sendMessage(event.tabId, event, { frameId: 0 }).catch(() => {});
};

const runStore = createRunStore(chrome.storage.session);
const tabs = {
  async listTabs() {
    const open = await chrome.tabs.query({});
    return open.flatMap((tab) => (tab.id !== undefined && tab.url ? [{ id: tab.id, url: tab.url }] : []));
  },
  async openTab(url: string) {
    // In the background, so the run's own tab and its launcher keep the focus.
    const tab = await chrome.tabs.create({ url, active: false });
    if (tab.id === undefined) throw new Error(`Could not open ${url}.`);
    return tab.id;
  },
};
const runHost = createRunHost({ sendToTab, broadcast, loadMacros, store: runStore, tabs });

/**
 * Picks up the runs a stopped worker left behind. Each tab's tools are read
 * again first: the cache died with the old worker, and the listing's
 * annotations decide whether an interrupted step may be repeated.
 */
async function resumeRuns(): Promise<void> {
  for (const saved of await runStore.loadAll()) {
    const tabOpen = await chrome.tabs.get(saved.tabId).then(() => true, () => false);
    if (!tabOpen) {
      await runStore.remove(saved.tabId);
      continue;
    }
    // Iframes' tools come back with their next report or the run's first poll.
    let tools: ToolInfo[] = [];
    try {
      const listed = await sendToTab(saved.tabId, { type: "list-tools" });
      if (isToolList(listed)) tools = listed;
    } catch {
      // The page is still loading; the run waits for its tools as usual.
    }
    runHost.setTools(saved.tabId, tools);
    void runHost.resumeRun(saved.tabId, resumeState(saved, tools));
  }
}

void resumeRuns().catch(() => {});

chrome.runtime.onInstalled.addListener(() => void seedSamples().catch(() => {}));
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!isBackgroundRequest(message)) return false;
  // A content script leaves `tabId` out; the side panel names the tab.
  const tabId = ("tabId" in message ? message.tabId : undefined) ?? sender.tab?.id;
  if (tabId === undefined) return false;
  switch (message.type) {
    case "tools-changed": {
      // Chrome sets the frame and origin; the page cannot forge them.
      const frameId = sender.frameId ?? 0;
      runHost.setTools(tabId, message.tools, frameId, sender.origin);
      // The badge counts macros offered on this page, as the launcher in the top frame does.
      if (frameId === 0) {
        chrome.action.setBadgeText({ tabId, text: message.matches ? String(message.matches) : "" }).catch(() => {});
      }
      break;
    }
    case "run-macro":
      void runHost.startRun(tabId, message.macroId, message.inputs);
      break;
    case "stop-run":
      runHost.stopRun(tabId);
      break;
    default:
      throw new Error(`Unhandled request: ${JSON.stringify(message satisfies never)}`);
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  runHost.removeTab(tabId);
  // A run this worker has not resumed yet has no controller to abort.
  runStore.remove(tabId).catch(() => {});
});
