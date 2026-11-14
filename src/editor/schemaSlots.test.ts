// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { MACRO_VERSION, type Macro } from "../macro/types";
import { argKind, defaultArg, literalType, missingArgs, newArg, requiredArgs, schemaSlots, toolArgSlots } from "./schemaSlots";

// The rocket fixture's schemas (e2e/fixtures/rocket.html).
const trajectory = { type: "string", enum: ["Moon", "Mars", "ISS", "Jupiter"] };
const rocket = {
  calculate_fuel: { type: "object", properties: { trajectory }, required: ["trajectory"] },
  load_fuel: {
    type: "object",
    properties: { amount: { type: "number" }, oxidizer_ratio: { type: "number" } },
    required: ["amount", "oxidizer_ratio"],
  },
  prepare_launch: {
    type: "object",
    properties: { auth_code: { type: "string" }, trajectory },
    required: ["auth_code", "trajectory"],
  },
};

// Shaped like the flight-search demo's tools, with the arguments the sample macro passes.
const flight = {
  searchFlights: {
    type: "object",
    properties: {
      origin: { type: "string", description: "IATA code" },
      destination: { type: "string" },
      tripType: { type: "string", enum: ["one-way", "round-trip"] },
      outboundDate: { type: "string", format: "date" },
      inboundDate: { type: "string", format: "date" },
      passengers: { type: "integer", minimum: 1 },
    },
    required: ["origin", "destination", "tripType", "outboundDate", "passengers"],
  },
  setFilters: {
    type: "object",
    properties: {
      stops: { type: "array", items: { type: "integer" } },
      maxPrice: { type: "number" },
      airlines: { type: "array", items: { type: "string" } },
      flexible: { type: "boolean" },
      departure: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from"] },
    },
  },
};

describe("schemaSlots", () => {
  it("reads the rocket tools: enums as dropdowns, typed slots, all required", () => {
    expect(schemaSlots(rocket.calculate_fuel)).toEqual([
      { key: "trajectory", required: true, kind: { type: "enum", options: ["Moon", "Mars", "ISS", "Jupiter"] } },
    ]);
    expect(schemaSlots(rocket.load_fuel)).toEqual([
      { key: "amount", required: true, kind: { type: "number" } },
      { key: "oxidizer_ratio", required: true, kind: { type: "number" } },
    ]);
    expect(schemaSlots(rocket.prepare_launch).map((slot) => [slot.key, slot.kind.type])).toEqual([
      ["auth_code", "text"],
      ["trajectory", "enum"],
    ]);
  });

  it("reads the flight tools: required and optional, lists, booleans and nested objects", () => {
    const search = schemaSlots(flight.searchFlights);
    expect(search.filter((slot) => !slot.required).map((slot) => slot.key)).toEqual(["inboundDate"]);
    expect(search[0]).toEqual({ key: "origin", required: true, description: "IATA code", kind: { type: "text" } });
    expect(search.find((slot) => slot.key === "passengers")?.kind).toEqual({ type: "number" });

    const filters = schemaSlots(flight.setFilters);
    expect(filters.every((slot) => !slot.required)).toBe(true);
    expect(filters.map((slot) => slot.kind)).toEqual([
      { type: "list", items: { type: "number" } },
      { type: "number" },
      { type: "list", items: { type: "text" } },
      { type: "boolean" },
      {
        type: "object",
        fields: [
          { key: "from", required: true, kind: { type: "text" } },
          { key: "to", required: false, kind: { type: "text" } },
        ],
      },
    ]);
  });

  it("gives no slots for a tool without arguments or with a malformed schema", () => {
    for (const schema of [undefined, null, "x", [], {}, { type: "object" }, { properties: [] }]) {
      expect(schemaSlots(schema)).toEqual([]);
    }
  });
});

describe("argKind", () => {
  it("falls back to an untyped slot for what it does not recognise", () => {
    expect(argKind({ type: "string", enum: [{ a: 1 }] })).toEqual({ type: "text" });
    expect(argKind({ enum: [] })).toEqual({ type: "any" });
    expect(argKind({ type: "array" })).toEqual({ type: "list", items: { type: "any" } });
    expect(argKind({ oneOf: [] })).toEqual({ type: "any" });
  });

  it("reads nullable types, const values and properties without a type", () => {
    expect(argKind({ type: ["null", "integer"] })).toEqual({ type: "number" });
    expect(argKind({ const: "fixed" })).toEqual({ type: "enum", options: ["fixed"] });
    expect(argKind({ properties: { a: {} } })).toEqual({
      type: "object",
      fields: [{ key: "a", required: false, kind: { type: "any" } }],
    });
  });
});

describe("requiredArgs", () => {
  it("starts each required argument at a default of its kind", () => {
    expect(requiredArgs(schemaSlots(rocket.prepare_launch))).toEqual({ auth_code: { lit: "" }, trajectory: { lit: "Moon" } });
    expect(requiredArgs(schemaSlots(flight.setFilters))).toEqual({});
    expect(defaultArg(argKind(flight.setFilters.properties.departure))).toEqual({ obj: { from: { lit: "" } } });
    expect(defaultArg({ type: "boolean" })).toEqual({ lit: false });
    expect(defaultArg({ type: "list", items: { type: "number" } })).toEqual({ list: [] });
  });
});

describe("argument suggestions", () => {
  const macro: Macro = {
    wmm: MACRO_VERSION,
    id: "m",
    name: "M",
    sites: { app: { match: ["https://example.com/*"] } },
    tools: {
      launch: { site: "app", name: "prepare_launch", inputSchema: rocket.prepare_launch },
      bare: { site: "app", name: "bare" },
    },
    trigger: { site: "app", anyOf: [["launch"]] },
    program: [],
  };

  it("reads a tool's saved schema, and nothing for a tool without one", () => {
    expect(toolArgSlots(macro, "launch")?.map((slot) => [slot.key, slot.required])).toEqual([
      ["auth_code", true],
      ["trajectory", true],
    ]);
    expect(toolArgSlots(macro, "bare")).toBeUndefined();
    expect(toolArgSlots(macro, "gone")).toBeUndefined();
    expect(toolArgSlots(macro, "toString")).toBeUndefined();
  });

  it("offers the schema keys not set yet, in the schema's order", () => {
    const slots = schemaSlots(flight.searchFlights);
    const offered = missingArgs(slots, { origin: { lit: "SFO" }, legacy: { lit: 1 } }).map((slot) => slot.key);
    expect(offered[0]).toBe("destination");
    expect(offered).not.toContain("origin");
    expect(offered).not.toContain("legacy");
    expect(offered).toContain("inboundDate");
  });

  it("starts a new argument at its schema type's default, and a key outside the schema at null", () => {
    const slots = [...schemaSlots(rocket.prepare_launch), ...schemaSlots(flight.searchFlights), ...schemaSlots(flight.setFilters)];
    expect(newArg(slots, "auth_code")).toEqual({ lit: "" });
    expect(newArg(slots, "trajectory")).toEqual({ lit: "Moon" });
    expect(newArg(slots, "passengers")).toEqual({ lit: 0 });
    expect(newArg(slots, "flexible")).toEqual({ lit: false });
    expect(newArg(slots, "legacy")).toEqual({ lit: null });
    expect(newArg(undefined, "auth_code")).toEqual({ lit: null });
  });

  it("types an argument's literal by its kind, enums and untyped ones as any value", () => {
    expect(literalType({ type: "text" })).toBe("text");
    expect(literalType({ type: "number" })).toBe("number");
    expect(literalType({ type: "enum", options: ["a"] })).toBe("any");
    expect(literalType({ type: "any" })).toBe("any");
  });
});
