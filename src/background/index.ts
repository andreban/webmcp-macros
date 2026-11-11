/**
 * Service worker: runs macros. The runner lives here, not in the page, so a
 * run survives the navigations its own tool calls cause.
 */
import type { BackgroundRequest, ContentRequest, ExecuteToolResponse, RunEvent } from "../messages";
import type { Json, ToolInfo } from "../macro/types";
import { runMacro, type ToolHost } from "../runner/interpreter";
import { loadMacros, seedSamples } from "../storage";

chrome.runtime.onInstalled.addListener(() => void seedSamples());
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

/** Latest tool names per tab, kept current by each content script. */
const toolsByTab = new Map<number, string[]>();
const toolWaiters = new Map<number, Set<() => void>>();
const activeRuns = new Map<number, AbortController>();

function setTools(tabId: number, tools: ToolInfo[]): void {
  toolsByTab.set(tabId, tools.map((tool) => tool.name));
  for (const wake of toolWaiters.get(tabId) ?? []) wake();
}

function sendToTab<T>(tabId: number, request: ContentRequest): Promise<T> {
  return chrome.tabs.sendMessage(tabId, request, { frameId: 0 }) as Promise<T>;
}

async function refreshTools(tabId: number): Promise<string[]> {
  try {
    setTools(tabId, await sendToTab<ToolInfo[]>(tabId, { type: "list-tools" }));
  } catch {
    // No content script yet (page still loading); the cache stays as it is.
  }
  return toolsByTab.get(tabId) ?? [];
}

function broadcast(event: RunEvent): void {
  chrome.runtime.sendMessage(event).catch(() => {});
  chrome.tabs.sendMessage(event.tabId, event, { frameId: 0 }).catch(() => {});
}

function hostForTab(tabId: number, signal: AbortSignal): ToolHost {
  return {
    async isToolAvailable(name) {
      return (await refreshTools(tabId)).includes(name);
    },

    async waitForTool(name, timeoutMs) {
      if ((await refreshTools(tabId)).includes(name)) return;
      await new Promise<void>((resolve, reject) => {
        const waiters = toolWaiters.get(tabId) ?? new Set();
        toolWaiters.set(tabId, waiters);
        const finish = (settle: () => void) => {
          clearTimeout(timer);
          clearInterval(poll);
          waiters.delete(check);
          signal.removeEventListener("abort", onAbort);
          settle();
        };
        const check = () => {
          if (toolsByTab.get(tabId)?.includes(name)) finish(resolve);
        };
        const onAbort = () => finish(() => reject(new Error("aborted")));
        const timer = setTimeout(() => finish(() => reject(new Error("timeout"))), timeoutMs);
        // Belt and braces alongside toolchange: covers a reloaded page whose
        // content script has not reported in yet.
        const poll = setInterval(() => void refreshTools(tabId).then(check), 500);
        waiters.add(check);
        signal.addEventListener("abort", onAbort);
      });
    },

    async callTool(name, args) {
      let response: ExecuteToolResponse;
      try {
        response = await sendToTab<ExecuteToolResponse>(tabId, { type: "execute-tool", name, args });
      } catch {
        // The page went away mid-call: the tool navigated. Same as a null result.
        toolsByTab.delete(tabId);
        return null;
      }
      if (response === undefined) return null;
      if (!response.ok) throw new Error(response.error);
      return response.result;
    },
  };
}

async function startRun(tabId: number, macroId: string, inputs: Record<string, Json>): Promise<void> {
  if (activeRuns.has(tabId)) return;
  const macro = (await loadMacros()).find((candidate) => candidate.id === macroId);
  if (!macro) return;
  const controller = new AbortController();
  activeRuns.set(tabId, controller);
  const host = hostForTab(tabId, controller.signal);
  host.onStep = (step) => broadcast({ type: "run-step", tabId, macroId, count: step.count, tool: step.tool });
  host.message = (text) => broadcast({ type: "run-message", tabId, macroId, text });
  try {
    const result = await runMacro(macro, host, { inputs, signal: controller.signal });
    broadcast({ type: "run-finished", tabId, macroId, result });
  } finally {
    activeRuns.delete(tabId);
  }
}

chrome.runtime.onMessage.addListener((message: BackgroundRequest, sender) => {
  switch (message.type) {
    case "tools-changed":
      if (sender.tab?.id !== undefined) {
        setTools(sender.tab.id, message.tools);
        // The badge counts macros offered on this page, mirroring the widget.
        const text = message.matches ? String(message.matches) : "";
        chrome.action.setBadgeText({ tabId: sender.tab.id, text }).catch(() => {});
      }
      break;
    case "run-macro": {
      const tabId = message.tabId ?? sender.tab?.id;
      if (tabId !== undefined) void startRun(tabId, message.macroId, message.inputs);
      break;
    }
    case "stop-run": {
      const tabId = message.tabId ?? sender.tab?.id;
      if (tabId === undefined) break;
      activeRuns.get(tabId)?.abort();
      sendToTab(tabId, { type: "abort-tool" }).catch(() => {});
      break;
    }
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activeRuns.get(tabId)?.abort();
  toolsByTab.delete(tabId);
  toolWaiters.delete(tabId);
});
