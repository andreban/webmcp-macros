import { MACRO_VERSION, type Macro, type MacroSite } from "../macro/types";

const FLIGHT_DEMO = "https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/";

/**
 * The flight demo's search page only. The demo uses a hash router, and its
 * results page (`#/results?...`) registers `searchFlights` too, but that copy
 * never reports completion, so the call fails after five seconds with "Timed
 * out waiting for UI to update". Macros that start with a search are only
 * offered where the search answers. Once a run has the tab, it keeps it
 * whatever the URL (spec §11), so the search can navigate to the results.
 */
export const flightSearchPage: MacroSite = {
  match: [FLIGHT_DEMO, `${FLIGHT_DEMO}#/`, `${FLIGHT_DEMO}index.html`, `${FLIGHT_DEMO}index.html#/`],
  startUrl: FLIGHT_DEMO,
};

/**
 * Searches on the GoogleChromeLabs flight demo, then applies preferred filters
 * (spec §12, macro 2).
 *
 * `setFilters` is registered only once the results view mounts after the
 * search, so the trigger lists `searchFlights` alone and the program waits for
 * `setFilters` before it touches the results.
 */
export const flightSearchMacro: Macro = {
  wmm: MACRO_VERSION,
  id: "sample-flight-search",
  name: "Search my usual flight",
  description: "Searches, then filters by preferred stops and maximum price.",
  sites: {
    flights: flightSearchPage,
  },
  tools: {
    search: { site: "flights", name: "searchFlights" },
    filter: { site: "flights", name: "setFilters" },
    reset: { site: "flights", name: "resetFilters" },
    list: { site: "flights", name: "listFlights" },
  },
  trigger: { site: "flights", anyOf: [["search"]] },
  inputs: [
    {
      key: "origin",
      label: "From (IATA)",
      schema: { type: "string", pattern: "^[A-Z]{3}$" },
      mode: "remember",
      default: "LON",
    },
    {
      key: "destination",
      label: "To (IATA)",
      schema: { type: "string", pattern: "^[A-Z]{3}$" },
      mode: "ask",
      default: "NYC",
    },
    // Relative defaults, resolved when the form opens, so the sample never offers a past date.
    { key: "outboundDate", label: "Depart", schema: { type: "string", format: "date" }, mode: "ask", default: "today+14d" },
    { key: "inboundDate", label: "Return", schema: { type: "string", format: "date" }, mode: "ask", default: "today+21d" },
    {
      key: "passengers",
      label: "Passengers",
      schema: { type: "number", minimum: 1 },
      mode: "remember",
      default: 1,
    },
    {
      key: "maxStops",
      label: "Stops",
      schema: { type: "string", enum: ["Non-stop only", "Up to 1 stop"] },
      mode: "remember",
      default: "Up to 1 stop",
    },
    {
      key: "maxPrice",
      label: "Maximum price",
      schema: { type: "number", minimum: 0 },
      mode: "remember",
      default: 1000,
    },
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
