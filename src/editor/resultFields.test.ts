import { describe, expect, it } from "vitest";
import { MACRO_VERSION, type JsonSchema, type Macro, type Stmt } from "../macro/types";
import { fieldPaths, inferSchema, observedSchemas, resultFields, schemaAt, valueSchema } from "./resultFields";

const wish = { type: "object", properties: { toy: { type: "string" }, colour: { type: "string" } } };
const letter: JsonSchema = {
  type: "object",
  properties: {
    child: { type: "string" },
    chimney: { type: "string" },
    wishes: { type: "array", items: wish },
    from: { type: "object", properties: { town: { type: "string" } } },
  },
};
const sleigh: JsonSchema = {
  oneOf: [
    { type: "object", properties: { delivered: { const: true }, child: { type: "string" } } },
    { type: "object", properties: { error: { type: "string" }, code: { type: "string" } } },
  ],
};

function macro(program: Stmt[], procedures: Macro["procedures"] = {}): Macro {
  return {
    wmm: MACRO_VERSION,
    id: "santa",
    name: "Santa",
    sites: { shop: { match: ["https://example.com/*"] } },
    tools: {
      open: { site: "shop", name: "open_letter", outputSchema: letter },
      load: { site: "shop", name: "load_sleigh", outputSchema: sleigh },
      plain: { site: "shop", name: "no_schema" },
    },
    trigger: { site: "shop", anyOf: [["open"]] },
    procedures,
    program,
  };
}

describe("schemaAt and fieldPaths", () => {
  it("walks properties and list items", () => {
    expect(schemaAt(letter, ["wishes", 0, "toy"])).toEqual({ type: "string" });
    expect(schemaAt(letter, ["missing"])).toBeUndefined();
    expect(schemaAt(undefined, [])).toBeUndefined();
  });

  it("lists nested object fields but not array items", () => {
    expect(fieldPaths(letter)).toEqual(["child", "chimney", "wishes", "from", "from.town"]);
  });

  it("merges oneOf and anyOf branches", () => {
    expect(fieldPaths(sleigh)).toEqual(["delivered", "child", "error", "code"]);
    expect(fieldPaths({ anyOf: [wish, "junk"] })).toEqual(["toy", "colour"]);
  });
});

describe("valueSchema", () => {
  it("follows a saved call result, a for-each item and a set", () => {
    const loop: Stmt = { op: "forEach", list: { get: { var: "letter" }, path: ["wishes"] }, var: "wish", body: [] };
    const m = macro([
      { op: "call", tool: "open", saveAs: "letter" },
      { op: "if", cond: { lit: true }, then: [loop] },
      { op: "set", var: "town", value: { get: { var: "letter" }, path: ["from"] } },
    ]);
    expect(resultFields(m, { var: "letter" })).toEqual(["child", "chimney", "wishes", "from", "from.town"]);
    expect(resultFields(m, { var: "wish" })).toEqual(["toy", "colour"]);
    expect(resultFields(m, { var: "town" })).toEqual(["town"]);
    expect(resultFields(m, { get: { var: "letter" }, path: ["from"] })).toEqual(["town"]);
  });

  it("reads an inline call and variables set inside procedures", () => {
    const m = macro([], { deliver: { params: [], body: [{ op: "call", tool: "load", saveAs: "result" }] } });
    expect(resultFields(m, { call: "open" })).toContain("wishes");
    expect(resultFields(m, { var: "result" })).toContain("error");
  });

  it("offers nothing without a schema, and does not loop on self-reference", () => {
    const m = macro([
      { op: "call", tool: "plain", saveAs: "x" },
      { op: "set", var: "loop", value: { get: { var: "loop" }, path: ["a"] } },
    ]);
    expect(resultFields(m, { var: "x" })).toEqual([]);
    expect(resultFields(m, { var: "unknown" })).toEqual([]);
    expect(valueSchema(m, { var: "loop" })).toBeUndefined();
    expect(resultFields(m, { call: "toString" })).toEqual([]);
  });
});

describe("observed schemas", () => {
  it("infers a schema from a value, with list items from the first one", () => {
    expect(inferSchema({ child: "Ada", wishes: [{ toy: "kite" }], age: 7, good: true, note: null })).toEqual({
      type: "object",
      properties: {
        child: { type: "string" },
        wishes: { type: "array", items: { type: "object", properties: { toy: { type: "string" } } } },
        age: { type: "number" },
        good: { type: "boolean" },
        note: { type: "null" },
      },
    });
  });

  it("offers fields from a run for a tool without an outputSchema; a declared schema wins", () => {
    const m = macro([
      { op: "call", tool: "plain", saveAs: "x" },
      { op: "forEach", var: "w", list: { get: { var: "x" }, path: ["wishes"] }, body: [] },
      { op: "call", tool: "open", saveAs: "l" },
    ]);
    const observed = observedSchemas([
      { tool: "no_schema", result: { wishes: [{ toy: "kite", colour: "red" }] } },
      { tool: "open_letter", result: { other: 1 } },
    ]);
    expect(resultFields(m, { var: "x" }, observed)).toEqual(["wishes"]);
    expect(resultFields(m, { var: "w" }, observed)).toEqual(["toy", "colour"]);
    expect(resultFields(m, { var: "l" }, observed)).toContain("wishes");
  });
});
