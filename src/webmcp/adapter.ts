/**
 * The only module that touches `document.modelContext`. WebMCP is in an
 * origin trial and its shape still changes between Chrome releases, so every
 * call goes through here.
 */
import type { Json, JsonSchema, ToolInfo } from "../macro/types";

interface PageTool {
  name: string;
  description?: string;
  inputSchema?: JsonSchema | string;
  annotations?: Record<string, boolean>;
  window?: Window;
}

interface ModelContext extends EventTarget {
  getTools(options?: { fromOrigins?: string[] }): Promise<PageTool[]>;
  executeTool(tool: PageTool, input?: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
}

function modelContext(): ModelContext | undefined {
  return (document as Document & { modelContext?: ModelContext }).modelContext;
}

export function isSupported(): boolean {
  return modelContext() !== undefined;
}

/** Tools registered by this document (not its iframes). */
async function pageTools(): Promise<PageTool[]> {
  const context = modelContext();
  if (!context) return [];
  const tools = await context.getTools();
  return tools.filter((tool) => tool.window === undefined || tool.window === window);
}

function parseSchema(schema: PageTool["inputSchema"]): JsonSchema | undefined {
  if (typeof schema !== "string") return schema;
  try {
    return JSON.parse(schema) as JsonSchema;
  } catch {
    return undefined;
  }
}

export async function listTools(): Promise<ToolInfo[]> {
  return (await pageTools()).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: parseSchema(tool.inputSchema),
    annotations: tool.annotations ? { ...tool.annotations } : undefined,
  }));
}

export class ToolNotFoundError extends Error {}

/**
 * Runs a tool. Resolves `null` when the call started a navigation. Results
 * that arrive as JSON text are parsed so macros can read their fields.
 */
export async function executeTool(name: string, args: Record<string, Json>, signal?: AbortSignal): Promise<Json> {
  const context = modelContext();
  if (!context) throw new Error("WebMCP is not available on this page.");
  const tool = (await pageTools()).find((candidate) => candidate.name === name);
  if (!tool) throw new ToolNotFoundError(`Tool "${name}" is not registered.`);
  let result: unknown;
  try {
    result = await context.executeTool(tool, args, { signal });
  } catch (error) {
    // Chrome before 155 takes the input as JSON text and rejects an object
    // before the tool runs, so retrying cannot execute the tool twice.
    if (!(error instanceof Error) || !/parse input arguments/i.test(error.message)) throw error;
    result = await context.executeTool(tool, JSON.stringify(args), { signal });
  }
  if (result === undefined || result === null) return null;
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as Json;
    } catch {
      return result;
    }
  }
  // Drop anything that cannot cross a message channel.
  return JSON.parse(JSON.stringify(result)) as Json;
}

/** Calls `listener` whenever the page's tool set changes. Returns an unsubscribe. */
export function onToolsChanged(listener: () => void): () => void {
  const context = modelContext();
  if (!context) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(listener, 100);
  };
  context.addEventListener("toolchange", debounced);
  return () => {
    clearTimeout(timer);
    context.removeEventListener("toolchange", debounced);
  };
}
