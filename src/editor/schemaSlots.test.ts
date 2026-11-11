import { describe, expect, it } from "vitest";
import { argKind, defaultArg, requiredArgs, schemaSlots } from "./schemaSlots";

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
