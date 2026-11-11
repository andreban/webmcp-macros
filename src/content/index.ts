/**
 * Content script, top frame only: answers tool requests from the background
 * through the WebMCP adapter and reports the page's tools when they change.
 */
import type { BackgroundRequest } from "../messages";
import { executeTool, isSupported, listTools, onToolsChanged } from "../webmcp/adapter";
import { createRequestHandler, isContentRequest, reportTools } from "./bridge";

const handle = createRequestHandler({ listTools, executeTool });

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
