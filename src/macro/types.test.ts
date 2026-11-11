import { describe, expect, it } from "vitest";
import { isMacro, MACRO_VERSION, type Macro } from "./types";

const valid: Macro = {
  wmm: MACRO_VERSION,
  id: "m1",
  name: "Example",
  sites: { app: { match: ["https://example.com/*"] } },
  tools: { greet: { site: "app", name: "greet" } },
  trigger: { site: "app", anyOf: [["greet"]] },
  inputs: [{ key: "who", label: "Who", schema: { type: "string" } }],
  program: [
    { op: "call", tool: "greet", args: { name: { input: "who" } }, saveAs: "reply" },
    { op: "message", text: { get: { var: "reply" }, path: ["text"] } },
  ],
};

function without(key: keyof Macro): unknown {
  const copy: Record<string, unknown> = { ...valid };
  delete copy[key];
  return copy;
}

describe("isMacro", () => {
  it("accepts a valid macro", () => {
    expect(isMacro(valid)).toBe(true);
  });

  it("accepts a macro that has been through JSON", () => {
    expect(isMacro(JSON.parse(JSON.stringify(valid)))).toBe(true);
  });

  it.each([null, undefined, "wmm1.abc", 1, []])("rejects the non-object %j", (value) => {
    expect(isMacro(value)).toBe(false);
  });

  it("rejects another format version", () => {
    expect(isMacro({ ...valid, wmm: MACRO_VERSION + 1 })).toBe(false);
  });

  it.each(["id", "name", "sites", "tools", "trigger", "program"] as const)("rejects a macro without %s", (key) => {
    expect(isMacro(without(key))).toBe(false);
  });

  it("rejects a trigger without anyOf", () => {
    expect(isMacro({ ...valid, trigger: { site: "app" } })).toBe(false);
  });

  it("rejects a program that is not a list", () => {
    expect(isMacro({ ...valid, program: {} })).toBe(false);
  });
});
