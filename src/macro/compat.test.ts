import { describe, expect, it } from "vitest";
import { rocketLauncherMacro } from "../samples";
import { checkCompatibility, schemaHash } from "./compat";
import type { JsonSchema, Macro, ToolInfo } from "./types";

const searchProperties = { origin: { type: "string" }, passengers: { type: "integer" }, nonstop: { type: "boolean" } };
const searchSchema: JsonSchema = { type: "object", properties: searchProperties, required: ["origin"] };

const macro: Macro = {
  wmm: 1,
  id: "m",
  name: "Search",
  sites: { app: { match: ["https://app.example/*"] } },
  tools: { search: { site: "app", name: "search_flights", schemaHash: schemaHash(searchSchema) } },
  trigger: { site: "app", anyOf: [["search"]] },
  inputs: [{ key: "from", label: "From", schema: { type: "string" } }],
  program: [
    {
      op: "call",
      tool: "search",
      args: { origin: { input: "from" }, passengers: { lit: 2 }, nonstop: { var: "direct" } },
    },
  ],
};

const tools = (inputSchema: JsonSchema | undefined): ToolInfo[] => [
  inputSchema ? { name: "search_flights", inputSchema } : { name: "search_flights" },
];

const withProperties = (properties: Record<string, unknown>): JsonSchema => ({ ...searchSchema, properties });

describe("schemaHash", () => {
  it("is stable under key order at every depth", () => {
    const reordered = {
      required: ["origin"],
      properties: { nonstop: { type: "boolean" }, passengers: { type: "integer" }, origin: { type: "string" } },
      type: "object",
    };
    expect(schemaHash(reordered)).toBe(schemaHash(searchSchema));
    expect(schemaHash(searchSchema)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when the schema does", () => {
    expect(schemaHash(withProperties({ origin: { type: "number" } }))).not.toBe(schemaHash(searchSchema));
    expect(schemaHash(undefined)).toBe(schemaHash({}));
  });
});

describe("checkCompatibility", () => {
  it("is ok for the same schema", () => {
    expect(checkCompatibility(macro, tools(searchSchema))).toEqual({ status: "ok" });
  });

  it("only warns when an optional property was added", () => {
    const added = withProperties({ ...searchProperties, cabin: { type: "string" } });
    expect(checkCompatibility(macro, tools(added))).toEqual({ status: "changed", aliases: ["search"] });
  });

  it("needs an update when a property the macro passes was removed", () => {
    const removed = withProperties({ origin: { type: "string" }, passengers: { type: "integer" } });
    expect(checkCompatibility(macro, tools(removed))).toEqual({
      status: "incompatible",
      problems: [{ alias: "search", arg: "nonstop", reason: "missing" }],
    });
  });

  it("needs an update when a property's type changed, for literals and typed inputs", () => {
    const changed = withProperties({ origin: { type: "number" }, passengers: { type: "string" }, nonstop: { type: "boolean" } });
    expect(checkCompatibility(macro, tools(changed))).toEqual({
      status: "incompatible",
      problems: [
        { alias: "search", arg: "origin", reason: "type" },
        { alias: "search", arg: "passengers", reason: "type" },
      ],
    });
  });

  it("accepts number for integer, type lists, untyped properties and values it cannot type", () => {
    const loose = withProperties({ origin: {}, passengers: { type: "number" }, nonstop: { type: "string" } });
    expect(checkCompatibility(macro, tools(loose)).status).toBe("changed");
    const union = withProperties({ origin: { type: ["string", "null"] }, passengers: { type: "integer" }, nonstop: {} });
    expect(checkCompatibility(macro, tools(union)).status).toBe("changed");
  });

  it("finds calls in expressions and procedures, but not inside literal values", () => {
    const nested: Macro = {
      ...macro,
      program: [{ op: "set", var: "x", value: { lit: { call: "search", args: { gone: 1 } } } }],
      procedures: {
        find: { params: [], body: [{ op: "return", value: { call: "search", args: { gone: { lit: 1 } } } }] },
      },
    };
    expect(checkCompatibility(nested, tools(searchSchema))).toEqual({
      status: "incompatible",
      problems: [{ alias: "search", arg: "gone", reason: "missing" }],
    });
  });

  it("skips tools it cannot check: absent, schemaless, pinned to a frame or on another site", () => {
    const removed = withProperties({});
    expect(checkCompatibility(macro, [])).toEqual({ status: "ok" });
    expect(checkCompatibility(macro, tools(undefined))).toEqual({ status: "ok" });
    expect(checkCompatibility(rocketLauncherMacro, [{ name: "calculate_fuel", inputSchema: { type: "object" } }])).toEqual({
      status: "ok",
    });
    const framed: Macro = { ...macro, tools: { search: { site: "app", name: "search_flights", frameOrigin: "https://f.example" } } };
    expect(checkCompatibility(framed, tools(removed))).toEqual({ status: "ok" });
    const elsewhere: Macro = { ...macro, tools: { search: { site: "other", name: "search_flights" } } };
    expect(checkCompatibility(elsewhere, tools(removed))).toEqual({ status: "ok" });
  });

  it("does not warn about a tool whose hash was never recorded", () => {
    const unhashed: Macro = { ...macro, tools: { search: { site: "app", name: "search_flights" } } };
    expect(checkCompatibility(unhashed, tools(withProperties({ ...searchProperties, x: {} })))).toEqual({ status: "ok" });
  });
});
