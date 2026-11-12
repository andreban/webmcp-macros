/**
 * The only module that touches `document.modelContext`. WebMCP is in an
 * origin trial and its shape still changes between Chrome releases, so every
 * call goes through here and version quirks stay in this file.
 *
 * The content script calls this from the isolated world; `getTools`,
 * `executeTool` and `toolchange` are all reachable from there.
 */
import type { Json, JsonSchema, ToolInfo } from "../macro/types";

/** A tool as `getTools()` reports it. Declarative `<form toolname>` tools look the same. */
interface PageTool {
  name: string;
  description?: string;
  /** Some Chrome versions report the schema as JSON text. */
  inputSchema?: JsonSchema | string;
  /** Absent before Chrome reports it, and on most tools; parsed like `inputSchema`. */
  outputSchema?: JsonSchema | string;
  annotations?: Record<string, unknown>;
  /** The window that registered the tool; iframes' tools are listed too. */
  window?: Window;
}

/** The part of the API this extension uses. Not in the DOM typings yet. */
interface ModelContext extends EventTarget {
  getTools(): Promise<PageTool[]>;
  executeTool(tool: PageTool, input: Record<string, Json> | string, options?: { signal?: AbortSignal }): Promise<unknown>;
}

function modelContext(): ModelContext | undefined {
  return (document as Document & { modelContext?: ModelContext }).modelContext;
}

/** Whether this document exposes WebMCP at all. */
export function isSupported(): boolean {
  return modelContext() !== undefined;
}

/** Tools registered by this document, not by its iframes. */
async function pageTools(context: ModelContext): Promise<PageTool[]> {
  const tools = await context.getTools();
  return tools.filter((tool) => tool.window === undefined || tool.window === window);
}

function isSchemaObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The site controls the schema, so anything that is not an object is dropped. */
function parseSchema(schema: unknown): JsonSchema | undefined {
  if (typeof schema !== "string") return isSchemaObject(schema) ? schema : undefined;
  try {
    const parsed: unknown = JSON.parse(schema);
    return isSchemaObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function booleanAnnotations(annotations: PageTool["annotations"]): Record<string, boolean> | undefined {
  if (!annotations) return undefined;
  const entries = Object.entries(annotations).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean");
  return Object.fromEntries(entries);
}

/** This document's tools, reduced to data that can cross a message channel. */
export async function listTools(): Promise<ToolInfo[]> {
  const context = modelContext();
  if (!context) return [];
  return (await pageTools(context)).map((tool) => {
    const info: ToolInfo = {
      name: tool.name,
      description: tool.description,
      inputSchema: parseSchema(tool.inputSchema),
      annotations: booleanAnnotations(tool.annotations),
    };
    const outputSchema = parseSchema(tool.outputSchema);
    if (outputSchema) info.outputSchema = outputSchema;
    return info;
  });
}

/** The named tool is not registered by this document right now. */
export class ToolNotFoundError extends Error {
  override name = "ToolNotFoundError";
}

/**
 * Chrome before 155 takes the input as JSON text and rejects an object with
 * "Failed to parse input arguments" before the tool runs, so a retry with a
 * string cannot execute the tool twice. Any other error is the tool's own.
 */
function rejectedObjectInput(error: unknown): boolean {
  return error instanceof Error && /failed to parse input arguments/i.test(error.message);
}

/**
 * Normalises a tool result: `null` for none (a call that started a navigation
 * resolves without one), JSON text parsed so macros can read its fields, and
 * everything else reduced to what JSON can represent.
 */
function toJson(result: unknown): Json {
  // Chrome 153 hands back the text "undefined" for a tool that returns
  // nothing. A tool returning that bare word as text reads as null too.
  if (result === undefined || result === null || result === "undefined") return null;
  if (typeof result === "string") return parseText(result);
  let text: string | undefined;
  try {
    text = JSON.stringify(result);
  } catch {
    // Cycles and bigints.
    throw new Error("The tool returned a result that is not JSON.");
  }
  // `undefined` for functions and symbols, which JSON cannot hold.
  return text === undefined ? null : (JSON.parse(text) as Json);
}

/** One text block of an MCP tool result. */
function isTextBlock(block: Json): block is { type: "text"; text: string } {
  return typeof block === "object" && block !== null && !Array.isArray(block) && block.type === "text" && typeof block.text === "string";
}

/** Parses `text` when it is JSON, else keeps it as text. */
function parseText(text: string): Json {
  try {
    // JSON.parse only produces JSON values.
    return JSON.parse(text) as Json;
  } catch {
    return text;
  }
}

/**
 * Pages built on MCP helpers, such as the `use-webmcp-tool` React hook, wrap
 * every result as an MCP tool result: `{content: [{type: "text", text}]}`,
 * with the value as JSON text and `isError: true` for a failure. Macros read
 * the value itself, so it is unwrapped here: `structuredContent` when given,
 * else the text blocks joined and parsed like any JSON text. An error result
 * throws its text, as a failed call does. Results with non-text blocks, such
 * as images, are left as they are.
 */
function unwrapMcpResult(value: Json): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const { content, isError, structuredContent, ...rest } = value;
  if (!Array.isArray(content) || Object.keys(rest).length > 0 || !content.every(isTextBlock)) return value;
  const text = content.map((block) => block.text).join("\n");
  if (isError === true) throw new Error(text || "The tool reported an error.");
  if (structuredContent !== undefined) return structuredContent;
  return content.length === 0 ? null : parseText(text);
}

/**
 * Runs a tool registered by this document. Resolves `null` when the call
 * started a navigation or returned nothing. Throws `ToolNotFoundError` when
 * the tool is not registered, and rejects when `signal` aborts the call.
 */
export async function executeTool(name: string, args: Record<string, Json>, signal?: AbortSignal): Promise<Json> {
  const context = modelContext();
  if (!context) throw new Error("WebMCP is not available on this page.");
  const tool = (await pageTools(context)).find((candidate) => candidate.name === name);
  if (!tool) throw new ToolNotFoundError(`Tool "${name}" is not registered.`);
  let result: unknown;
  try {
    result = await context.executeTool(tool, args, { signal });
  } catch (error) {
    if (!rejectedObjectInput(error)) throw error;
    result = await context.executeTool(tool, JSON.stringify(args), { signal });
  }
  return unwrapMcpResult(toJson(result));
}

/**
 * Calls `listener` 100 ms after the page's tool set stops changing, since
 * pages often register several tools in a burst. Returns an unsubscribe.
 */
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
