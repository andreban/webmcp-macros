/**
 * Content script, top frame only: answers tool requests from the background
 * through the WebMCP adapter, reports the page's tools and how many saved
 * macros match, and shows the launcher while one does.
 */
import { matchingMacros } from "../macro/matcher";
import type { Macro, ToolInfo } from "../macro/types";
import type { BackgroundRequest } from "../messages";
import { loadMacros, onMacrosChanged } from "../storage";
import { executeTool, isSupported, listTools, onToolsChanged } from "../webmcp/adapter";
import { createRequestHandler, isContentRequest } from "./bridge";
import { launcherAction } from "./launcher";
import type { Launcher } from "./Widget";

// Counts navigations that will replace this document. Same-document ones
// (pushState, or a navigation a router intercepts) keep this content script,
// so the run goes on with the usual tool waits. A router's listener may run
// after this one, so interception is checked once dispatch has finished.
let documentLoads = 0;
window.navigation?.addEventListener("navigate", (event) => {
  if (event.destination.sameDocument) return;
  queueMicrotask(() => {
    if (!event.defaultPrevented && !window.navigation?.transition) documentLoads++;
  });
});

const handle = createRequestHandler({ listTools, executeTool }, () => documentLoads);

chrome.runtime.onMessage.addListener((message: unknown, _sender, reply) => {
  if (!isContentRequest(message)) return false;
  const pending = handle(message);
  if (!pending) return false;
  void pending.then(reply);
  // Keeps the channel open for the asynchronous reply.
  return true;
});

let macros: Macro[] = [];
let matches: Macro[] = [];
let busy = false;
let refreshes = 0;
// A promise because the widget loads on demand; calls chained on it run in order.
let launcher: Promise<Launcher> | undefined;

function applyLauncher(): void {
  const current = matches;
  const action = launcherAction(launcher !== undefined, current.length, busy);
  switch (action) {
    case "mount":
      // React and the widget load only on pages where a macro matches.
      launcher = import("./Widget").then(({ mountLauncher }) =>
        mountLauncher((next) => {
          busy = next;
          applyLauncher();
        }),
      );
      void launcher.then((mounted) => mounted.render(current));
      return;
    case "render":
      void launcher?.then((mounted) => mounted.render(current));
      return;
    case "unmount":
      void launcher?.then((mounted) => mounted.unmount());
      launcher = undefined;
      return;
    case "none":
      return;
    default:
      throw new Error(`Unknown launcher action: ${JSON.stringify(action satisfies never)}`);
  }
}

async function refresh(): Promise<void> {
  const id = ++refreshes;
  const tools = await listTools().catch((): ToolInfo[] => []);
  // A later refresh started while this one listed tools; its answer is newer.
  if (id !== refreshes) return;
  matches = matchingMacros(macros, location.href, tools.map((tool) => tool.name));
  const request: BackgroundRequest = { type: "tools-changed", tools, matches: matches.length };
  // Rejects when no extension page is listening; there is nothing to do then.
  chrome.runtime.sendMessage(request).catch(() => {});
  applyLauncher();
}

// Pages without WebMCP get no reports and no launcher; `list-tools` still answers `[]` there.
if (isSupported()) {
  onToolsChanged(() => void refresh());
  onMacrosChanged((next) => {
    macros = next;
    void refresh();
  });
  // Single-page apps change URL without reloading, so site patterns are re-checked.
  window.navigation?.addEventListener("navigatesuccess", () => void refresh());
  void loadMacros()
    .catch((): Macro[] => [])
    .then((loaded) => {
      macros = loaded;
      return refresh();
    });
}
