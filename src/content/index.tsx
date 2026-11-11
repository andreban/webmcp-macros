/**
 * Content script: the bridge between the extension and the page's WebMCP
 * tools. It answers tool requests from the runner, reports tool changes, and
 * mounts the launcher when a saved macro matches the page.
 */
import { createRoot, type Root } from "react-dom/client";
import { matchingMacros } from "../macro/matcher";
import type { Macro, ToolInfo } from "../macro/types";
import type { BackgroundRequest, ContentRequest, ExecuteToolResponse } from "../messages";
import { loadMacros, onMacrosChanged } from "../storage";
import { executeTool, isSupported, listTools, onToolsChanged, ToolNotFoundError } from "../webmcp/adapter";
import { Widget } from "./Widget";
import { widgetStyles } from "./widgetStyles";

let macros: Macro[] = [];
let tools: ToolInfo[] = [];
let root: Root | undefined;
let activeCall: AbortController | undefined;

function render(): void {
  const matches = matchingMacros(macros, location.href, tools.map((tool) => tool.name));
  const request: BackgroundRequest = { type: "tools-changed", tools, matches: matches.length };
  chrome.runtime.sendMessage(request).catch(() => {});
  // Mount lazily: pages with no matching macro never get an extra element.
  if (!root) {
    if (matches.length === 0) return;
    const host = document.createElement("webmcp-macros-widget");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = widgetStyles;
    const mount = document.createElement("div");
    shadow.append(style, mount);
    document.documentElement.append(host);
    root = createRoot(mount);
  }
  root.render(<Widget macros={matches} />);
}

async function refresh(): Promise<void> {
  tools = await listTools().catch(() => []);
  render();
}

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, reply) => {
  switch (message.type) {
    case "list-tools":
      void listTools()
        .catch(() => [])
        .then(reply);
      return true;
    case "execute-tool": {
      activeCall = new AbortController();
      executeTool(message.name, message.args, activeCall.signal)
        .then((result): ExecuteToolResponse => ({ ok: true, result }))
        .catch(
          (error: unknown): ExecuteToolResponse => ({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            notFound: error instanceof ToolNotFoundError,
          }),
        )
        .then(reply);
      return true;
    }
    case "abort-tool":
      activeCall?.abort();
      return false;
  }
  return false;
});

if (isSupported()) {
  onToolsChanged(() => void refresh());
  onMacrosChanged((next) => {
    macros = next;
    render();
  });
  // Single-page apps change URL without reloading; site patterns must be re-checked.
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  navigation?.addEventListener("navigatesuccess", () => void refresh());
  void loadMacros().then((loaded) => {
    macros = loaded;
    void refresh();
  });
}
