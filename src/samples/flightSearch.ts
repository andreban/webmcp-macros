import type { Macro } from "../macro/types";

/**
 * Searches on the GoogleChromeLabs flight demo, then applies preferred
 * filters. `setFilters` is registered only once the results view mounts, so
 * the runner's wait-for-tool covers the route change.
 */
export const flightSearchMacro: Macro = {
  wmm: 1,
  id: "sample-flight-search",
  name: "Search my usual flight",
  description: "Searches, then filters by preferred stops and maximum price.",
  sites: {
    flights: {
      match: ["https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/*"],
      startUrl: "https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/",
    },
  },
  tools: {
    search: { site: "flights", name: "searchFlights" },
    filter: { site: "flights", name: "setFilters" },
    reset: { site: "flights", name: "resetFilters" },
    list: { site: "flights", name: "listFlights" },
  },
  trigger: { site: "flights", anyOf: [["search"]] },
  inputs: [
    { key: "origin", label: "From (IATA)", schema: { type: "string", pattern: "^[A-Z]{3}$" }, mode: "remember", default: "LON" },
    { key: "destination", label: "To (IATA)", schema: { type: "string", pattern: "^[A-Z]{3}$" }, mode: "ask", default: "NYC" },
    { key: "outboundDate", label: "Depart", schema: { type: "string", format: "date" }, mode: "ask" },
    { key: "inboundDate", label: "Return", schema: { type: "string", format: "date" }, mode: "ask" },
    { key: "passengers", label: "Passengers", schema: { type: "number", minimum: 1 }, mode: "remember", default: 1 },
    { key: "maxStops", label: "Stops", schema: { type: "string", enum: ["Non-stop only", "Up to 1 stop"] }, mode: "remember", default: "Up to 1 stop" },
    { key: "maxPrice", label: "Maximum price", schema: { type: "number", minimum: 0 }, mode: "remember", default: 1000 },
  ],
  program: [
    {
      op: "call",
      tool: "search",
      args: {
        origin: { input: "origin" },
        destination: { input: "destination" },
        tripType: { lit: "round-trip" },
        outboundDate: { input: "outboundDate" },
        inboundDate: { input: "inboundDate" },
        passengers: { input: "passengers" },
      },
    },
    { op: "waitForTool", tool: "filter" },
    { op: "call", tool: "reset" },
    { op: "set", var: "stops", value: { lit: [0, 1] } },
    {
      op: "if",
      cond: { bin: "==", left: { input: "maxStops" }, right: { lit: "Non-stop only" } },
      then: [{ op: "set", var: "stops", value: { lit: [0] } }],
    },
    { op: "call", tool: "filter", args: { stops: { var: "stops" }, maxPrice: { input: "maxPrice" } } },
    { op: "call", tool: "list", saveAs: "flights" },
    {
      op: "if",
      cond: { not: { var: "flights" } },
      then: [{ op: "message", text: { lit: "No flights match your preferences." } }],
      else: [{ op: "message", text: { lit: "Filters applied to your search." } }],
    },
  ],
};
