/**
 * The content script's tool bridge, kept free of `chrome.*` so it runs under
 * Vitest: `index.ts` wires it to the runtime channel and the WebMCP adapter.
 */
import type { Json, ToolInfo } from "../macro/types";
import type { ContentRequest, ExecuteToolResponse } from "../messages";
import { ToolNotFoundError } from "../webmcp/adapter";

/** The adapter functions the bridge uses, passed in so tests can fake them. */
export interface ToolAccess {
  listTools(): Promise<ToolInfo[]>;
  executeTool(name: string, args: Record<string, Json>, signal: AbortSignal): Promise<Json>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows a runtime message to a `ContentRequest`. The listener also sees
 * every other message sent to the tab, which it must leave unanswered.
 */
export function isContentRequest(message: unknown): message is ContentRequest {
  if (!isRecord(message)) return false;
  switch (message.type) {
    case "list-tools":
    case "abort-tool":
      return true;
    case "execute-tool":
      // Arguments come from our own runner via structured clone, so a record is enough.
      return typeof message.name === "string" && isRecord(message.args);
    default:
      return false;
  }
}

/** What the bridge sends back: a promise of the reply, or `undefined` for none. */
export type RequestHandler = (
  request: ContentRequest,
) => Promise<ToolInfo[]> | Promise<ExecuteToolResponse> | undefined;

/**
 * Creates the handler for requests to this tab. Replies never reject: the
 * other side of a message channel cannot tell a thrown error from a closed
 * port, so failures are part of the reply. `documentLoads` counts the
 * navigations that started loading another document in this tab; a call
 * during which it grows is reported as `navigated`.
 */
export function createRequestHandler(tools: ToolAccess, documentLoads: () => number = () => 0): RequestHandler {
  // The runner calls one tool at a time per tab, so one controller suffices.
  let inFlight: AbortController | undefined;

  async function execute(name: string, args: Record<string, Json>): Promise<ExecuteToolResponse> {
    const controller = new AbortController();
    inFlight = controller;
    const loadsBefore = documentLoads();
    try {
      const result = await tools.executeTool(name, args, controller.signal);
      // This document is about to be replaced; the background then waits for the next one.
      return documentLoads() > loadsBefore ? { ok: true, result, navigated: true } : { ok: true, result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return error instanceof ToolNotFoundError ? { ok: false, error: message, notFound: true } : { ok: false, error: message };
    } finally {
      if (inFlight === controller) inFlight = undefined;
    }
  }

  return (request) => {
    switch (request.type) {
      case "list-tools":
        return tools.listTools().catch((): ToolInfo[] => []);
      case "execute-tool":
        return execute(request.name, request.args);
      case "abort-tool":
        inFlight?.abort();
        return undefined;
      default:
        throw new Error(`Unknown request: ${JSON.stringify(request satisfies never)}`);
    }
  };
}
