import { describe, expect, it } from "vitest";
import { sampleMacros } from "../samples";
import { decodeMacro, encodeMacro, looksLikeMacroString, MacroDecodeError } from "./codec";

describe("share string codec", () => {
  it("round-trips every sample macro", async () => {
    for (const macro of sampleMacros) {
      const text = await encodeMacro(macro);
      expect(looksLikeMacroString(text)).toBe(true);
      expect(await decodeMacro(text)).toEqual(macro);
    }
  });

  it("is stable regardless of key order", async () => {
    const macro = sampleMacros[0]!;
    const reordered = Object.fromEntries(Object.entries(macro).reverse()) as typeof macro;
    expect(await encodeMacro(reordered)).toBe(await encodeMacro(macro));
  });

  it("rejects a truncated string", async () => {
    const text = await encodeMacro(sampleMacros[0]!);
    const [prefix, payload, crc] = text.split(".");
    await expect(decodeMacro(`${prefix}.${payload!.slice(0, -6)}.${crc}`)).rejects.toBeInstanceOf(MacroDecodeError);
  });

  it("rejects a string with the wrong checksum", async () => {
    const text = await encodeMacro(sampleMacros[0]!);
    await expect(decodeMacro(text.slice(0, -8) + "00000000")).rejects.toThrow(/Checksum/);
  });

  it("rejects text that is not a share string", async () => {
    await expect(decodeMacro("hello")).rejects.toBeInstanceOf(MacroDecodeError);
  });
});
