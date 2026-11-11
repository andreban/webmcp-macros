import { describe, expect, it } from "vitest";
import { decodeMacro, encodeMacro, looksLikeMacroString, MacroDecodeError } from "./codec";
import { MACRO_VERSION, type Macro } from "./types";

const macro: Macro = {
  wmm: MACRO_VERSION,
  id: "m1",
  name: "Grüße ✈ example",
  description: "Greets someone, then reports the reply.",
  sites: { app: { match: ["https://example.com/*"], startUrl: "https://example.com/" } },
  tools: { greet: { site: "app", name: "greet", schemaHash: "abc123" } },
  trigger: { site: "app", anyOf: [["greet"]] },
  inputs: [{ key: "who", label: "Who", schema: { type: "string" }, mode: "remember", default: "Ada" }],
  program: [
    { op: "call", tool: "greet", args: { name: { input: "who" } }, saveAs: "reply" },
    {
      op: "if",
      cond: { bin: "==", left: { get: { var: "reply" }, path: ["ok"] }, right: { lit: true } },
      then: [{ op: "message", text: { get: { var: "reply" }, path: ["text"] } }],
      else: [{ op: "fail", message: { lit: "No reply" } }],
    },
  ],
};

/** Reverses key order at every depth, without changing the value. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reverseKeys(child)]),
    );
  }
  return value;
}

/** Splits a share string into its three parts, failing the test if it has fewer. */
function parts(text: string): [string, string, string] {
  const [prefix, payload, checksum] = text.split(".");
  if (prefix === undefined || payload === undefined || checksum === undefined) {
    throw new Error(`Unexpected share string: ${text}`);
  }
  return [prefix, payload, checksum];
}

/** Packs arbitrary bytes the way the codec does, to forge payloads. */
async function pack(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const byte of packed) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function expectDecodeError(text: string, message: RegExp): Promise<void> {
  const decoding = decodeMacro(text);
  await expect(decoding).rejects.toBeInstanceOf(MacroDecodeError);
  await expect(decoding).rejects.toThrow(message);
}

describe("encodeMacro and decodeMacro", () => {
  it("round-trips a macro to a deep-equal copy", async () => {
    const text = await encodeMacro(macro);
    expect(text).toMatch(/^wmm1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
    expect(await decodeMacro(text)).toEqual(macro);
  });

  it("encodes the same macro identically whatever its key order", async () => {
    // reverseKeys keeps the value, so the cast only restates the known type.
    const reordered = reverseKeys(macro) as Macro;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(macro));
    expect(await encodeMacro(reordered)).toBe(await encodeMacro(macro));
  });

  it("ignores whitespace around a pasted string", async () => {
    const text = await encodeMacro(macro);
    expect(await decodeMacro(`\n  ${text}  \n`)).toEqual(macro);
  });

  it("uses the standard CRC-32 for the checksum", async () => {
    // Known check value for this sentence; the payload is not JSON, so only
    // a correct checksum gets the decoder as far as parsing it.
    const bytes = new TextEncoder().encode("The quick brown fox jumps over the lazy dog");
    await expectDecodeError(`wmm1.${await pack(bytes)}.414fa339`, /readable macro data/);
  });
});

describe("decodeMacro rejections", () => {
  it("rejects a truncated payload", async () => {
    const [prefix, payload, checksum] = parts(await encodeMacro(macro));
    await expectDecodeError(`${prefix}.${payload.slice(0, -6)}.${checksum}`, /damaged or incomplete/);
  });

  it("rejects a payload with characters outside base64url", async () => {
    const [prefix, payload, checksum] = parts(await encodeMacro(macro));
    await expectDecodeError(`${prefix}.${payload}!!.${checksum}`, /damaged or incomplete/);
  });

  it("rejects a wrong checksum", async () => {
    const [prefix, payload] = parts(await encodeMacro(macro));
    await expectDecodeError(`${prefix}.${payload}.00000000`, /checksum mismatch/);
  });

  it("rejects a wrong prefix", async () => {
    const [, payload, checksum] = parts(await encodeMacro(macro));
    await expectDecodeError(`abc1.${payload}.${checksum}`, /not a WebMCP Macros string/);
  });

  it("names the format of a string from a newer version", async () => {
    const [, payload, checksum] = parts(await encodeMacro(macro));
    await expectDecodeError(`wmm2.${payload}.${checksum}`, /format "wmm2"/);
  });

  it.each(["", "hello", "wmm1", "wmm1..", "wmm1.abc", "wmm1.abc.00000000.extra"])(
    "rejects %j as not a share string",
    async (text) => {
      await expectDecodeError(text, /not a WebMCP Macros string/);
    },
  );

  it("rejects a payload that is JSON but not a macro", async () => {
    // Deliberately mistyped: the encoder accepts any JSON at runtime, which is
    // the easiest way to produce a well-formed string around a non-macro.
    const text = await encodeMacro({ hello: "world" } as unknown as Macro);
    await expectDecodeError(text, /not contain a valid macro/);
  });
});

describe("looksLikeMacroString", () => {
  it("accepts an encoded macro, with or without surrounding whitespace", async () => {
    const text = await encodeMacro(macro);
    expect(looksLikeMacroString(text)).toBe(true);
    expect(looksLikeMacroString(` ${text}\n`)).toBe(true);
  });

  it.each(["", "hello", "wmm1.abc", "wmm2.abc.0123abcd", "wmm1.a+b.0123abcd", "wmm1.abc.0123ABCD"])(
    "rejects %j",
    (text) => {
      expect(looksLikeMacroString(text)).toBe(false);
    },
  );
});
