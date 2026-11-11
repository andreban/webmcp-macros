/**
 * Share strings: `wmm1.<base64url(deflate-raw(json))>.<crc32 hex>`.
 * The prefix names the format version; the checksum catches truncated pastes.
 */
import { isMacro, type Macro } from "./types";

const PREFIX = "wmm1";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function pipe(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Stable key order, so the same macro always yields the same string. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, canonical(source[key])]),
    );
  }
  return value;
}

export async function encodeMacro(macro: Macro): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(canonical(macro)));
  const packed = await pipe(json, new CompressionStream("deflate-raw"));
  const checksum = crc32(json).toString(16).padStart(8, "0");
  return `${PREFIX}.${toBase64Url(packed)}.${checksum}`;
}

export class MacroDecodeError extends Error {}

export async function decodeMacro(text: string): Promise<Macro> {
  const parts = text.trim().split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    throw new MacroDecodeError(`Not a WebMCP Macros string (expected "${PREFIX}.…").`);
  }
  let json: Uint8Array;
  try {
    json = await pipe(fromBase64Url(parts[1]!), new DecompressionStream("deflate-raw"));
  } catch {
    throw new MacroDecodeError("The string is damaged and could not be unpacked.");
  }
  if (crc32(json).toString(16).padStart(8, "0") !== parts[2]) {
    throw new MacroDecodeError("Checksum mismatch: the string is incomplete or was altered.");
  }
  const value: unknown = JSON.parse(new TextDecoder().decode(json));
  if (!isMacro(value)) throw new MacroDecodeError("The string does not contain a valid macro.");
  return value;
}

/** True when text looks like a share string, for paste detection. */
export function looksLikeMacroString(text: string): boolean {
  return /^wmm1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/.test(text.trim());
}
