/**
 * Content script, top frame only: answers tool requests from the background
 * through the WebMCP adapter and reports the page's tools when they change.
 */
import type { BackgroundRequest } from "../messages";
import { executeTool, isSupported, listTools, onToolsChanged } from "../webmcp/adapter";
import { createRequestHandler, isContentRequest, reportTools } from "./bridge";

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

// Pages without WebMCP get no reports; `list-tools` still answers `[]` there.
if (isSupported()) {
  const send = (request: BackgroundRequest) => chrome.runtime.sendMessage(request);
  onToolsChanged(() => void reportTools(listTools, send));
  void reportTools(listTools, send);
}
