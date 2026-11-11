/**
 * Share strings: `wmm1.<base64url(deflate-raw(canonical JSON))>.<crc32 hex>`.
 *
 * The prefix names the format version, so a string from a newer extension is
 * recognised and refused instead of misread. The checksum covers the JSON
 * rather than the compressed bytes, so it also catches a payload that inflates
 * cleanly but is not the one that was encoded. Compression uses the platform's
 * `CompressionStream`, which exists in extension pages, service workers and
 * Node, so this module needs no dependency.
 */
import { isMacro, type Macro } from "./types";

const PREFIX = "wmm1";
const SHARE_STRING = new RegExp(`^${PREFIX}\\.[A-Za-z0-9_-]+\\.[0-9a-f]{8}$`);

/** Thrown by `decodeMacro`; the message is written to be shown to the user. */
export class MacroDecodeError extends Error {
  override name = "MacroDecodeError";
}

/** CRC-32 (IEEE), as lowercase hex padded to 8 digits. */
function crc32Hex(bytes: Uint8Array): string {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Throws on characters outside the base64url alphabet (via `atob`). */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Copies a JSON value with object keys sorted at every depth, so the same
 * macro always yields the same string whatever order the editor wrote its keys
 * in. Array order is meaningful and kept.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    // Macros are plain JSON objects, so indexing by own keys is safe here.
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, canonical(source[key])]),
    );
  }
  return value;
}

/** Encodes a macro as a share string. Equal macros give equal strings. */
export async function encodeMacro(macro: Macro): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(canonical(macro)));
  const packed = await pipe(json, new CompressionStream("deflate-raw"));
  return `${PREFIX}.${toBase64Url(packed)}.${crc32Hex(json)}`;
}

/**
 * Decodes a share string, tolerating surrounding whitespace from a paste.
 * Rejects with `MacroDecodeError` when the string is not a share string, is
 * damaged or truncated, or does not hold a valid macro.
 */
export async function decodeMacro(text: string): Promise<Macro> {
  const [prefix, payload, checksum, ...rest] = text.trim().split(".");
  if (prefix !== PREFIX && prefix !== undefined && /^wmm\d+$/.test(prefix)) {
    throw new MacroDecodeError(
      `This macro uses format "${prefix}", which this version of WebMCP Macros cannot read. Update the extension and try again.`,
    );
  }
  if (prefix !== PREFIX || !payload || !checksum || rest.length > 0) {
    throw new MacroDecodeError(`This is not a WebMCP Macros string (they start with "${PREFIX}.").`);
  }

  let json: Uint8Array<ArrayBuffer>;
  try {
    json = await pipe(fromBase64Url(payload), new DecompressionStream("deflate-raw"));
  } catch {
    throw new MacroDecodeError("The macro string is damaged or incomplete and could not be unpacked.");
  }
  if (crc32Hex(json) !== checksum) {
    throw new MacroDecodeError("The macro string is incomplete or was altered (checksum mismatch).");
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    throw new MacroDecodeError("The macro string does not contain readable macro data.");
  }
  if (!isMacro(value)) {
    throw new MacroDecodeError("The macro string does not contain a valid macro.");
  }
  return value;
}

/**
 * True when text has the shape of a share string, for paste detection. It does
 * not inflate or verify the payload; `decodeMacro` does that.
 */
export function looksLikeMacroString(text: string): boolean {
  return SHARE_STRING.test(text.trim());
}
