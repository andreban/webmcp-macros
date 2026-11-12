import { describe, expect, it } from "vitest";
import type { Json } from "../macro/types";
import { runMacro, type ToolHost } from "../runner/interpreter";
import { tripPlanMacro } from "./tripPlan";

type Tool = (args: Record<string, Json>) => Json;

const DAY_MS = 86_400_000;

/**
 * The three demos, reduced to what the macro relies on: the flight results
 * tools and the hotel results tool appear only after a search, and the
 * spreadsheet refuses a sheet name in use with `{ error }`, takes typed text
 * and evaluates the one formula the macro writes.
 */
function fakeDemos(options: { sheets?: string[] } = {}) {
  const flights = [
    { id: 1, airline: "Air France", origin: "LHR", destination: "CDG", departureTime: "09:10", stops: 0, price: 310 },
    { id: 2, airline: "Iberia", origin: "LGW", destination: "ORY", departureTime: "07:45", stops: 1, price: 120 },
    { id: 3, airline: "Lufthansa", origin: "LCY", destination: "CDG", departureTime: "12:00", stops: 1, price: 180 },
    { id: 4, airline: "British Airways", origin: "LHR", destination: "ORY", departureTime: "18:30", stops: 0, price: 205 },
    { id: 5, airline: "Emirates", origin: "STN", destination: "CDG", departureTime: "21:05", stops: 0, price: 450 },
  ];
  const hotels = [
    { id: "paris-1", name: "L'Atelier Rive Gauche", rating: 4.9, price: 420 },
    { id: "paris-2", name: "L'Atelier Marais", rating: 4.6, price: 160 },
  ];
  const sheets = new Set(options.sheets ?? ["Sheet1"]);
  const writes: { range: string; values: Json }[] = [];
  const state = { stops: [] as Json[], searched: false, hotelQuery: "" };
  const calls: string[] = [];

  const pages: Record<string, Record<string, Tool>> = {
    flights: {
      searchFlights: () => {
        state.searched = true;
        return "A new flight search was started.";
      },
      setFilters: ({ stops }) => {
        state.stops = Array.isArray(stops) ? stops : [];
        return "Filters successfully updated.";
      },
      listFlights: () => flights.filter((f) => state.stops.length === 0 || state.stops.includes(f.stops)),
    },
    hotels: {
      search_location: ({ query }) => {
        state.hotelQuery = String(query);
        return { success: true, message: `Navigated to search results for ${String(query)}` };
      },
      get_hotel_search_results: () => ({ success: true, count: hotels.length, hotels }),
    },
    sheet: {
      add_sheet: ({ name }): Json => {
        const sheet = typeof name === "string" ? name : `Sheet${sheets.size + 1}`;
        if (sheets.has(sheet)) return { error: `There is already a sheet named "${sheet}".` };
        sheets.add(sheet);
        return { name: sheet, position: sheets.size };
      },
      set_values: ({ range, values }): Json => {
        writes.push({ range: String(range), values: values ?? null });
        if (!Array.isArray(values)) return { error: "values must be a list." };
        // Only the trip row's =DAYS(C2,B2) needs evaluating.
        const computed = values.map((cells) =>
          Array.isArray(cells) ? cells.map((cell) => (cell === "=DAYS(C2,B2)" ? daysBetween(values) : cell)) : cells,
        );
        return { range: String(range), values: computed };
      },
    },
  };
  const present = (site: string, name: string): boolean => {
    if (!Object.hasOwn(pages[site] ?? {}, name)) return false;
    if (site === "flights" && name !== "searchFlights") return state.searched;
    if (site === "hotels" && name === "get_hotel_search_results") return state.hotelQuery !== "";
    return true;
  };
  const host: ToolHost = {
    async callTool(name, args, site) {
      calls.push(`${site}:${name}`);
      const tool = pages[site]?.[name];
      if (!tool || !present(site, name)) throw new Error(`${name} is not registered on ${site}`);
      return tool(args);
    },
    async isToolAvailable(name, site) {
      return present(site, name);
    },
    async waitForTool(name, _timeoutMs, site) {
      if (!present(site, name)) throw new Error(`Timed out waiting for ${name}`);
    },
  };
  return { host, calls, writes, state, sheets };
}

function daysBetween(values: Json[]): Json {
  const trip = values[1];
  if (!Array.isArray(trip)) return "#VALUE!";
  return (Date.parse(String(trip[2])) - Date.parse(String(trip[1]))) / DAY_MS;
}

const inputs = {
  origin: "LON",
  city: "Paris",
  checkIn: "2026-12-01",
  checkOut: "2026-12-05",
  travellers: 2,
  directOnly: false,
};

describe("tripPlanMacro", () => {
  it("writes the cheapest flights and hotels into a new sheet", async () => {
    const demos = fakeDemos();
    const result = await runMacro(tripPlanMacro, demos.host, { inputs });

    expect(result).toMatchObject({ status: "done", vars: { nights: 4 } });
    expect(demos.calls).toEqual([
      "flights:searchFlights",
      "flights:setFilters",
      "flights:listFlights",
      "sheet:add_sheet",
      "sheet:set_values",
      "hotels:search_location",
      "hotels:get_hotel_search_results",
      "sheet:set_values",
    ]);
    expect(demos.writes).toEqual([
      {
        range: "'Trip to Paris'!A1",
        values: [
          ["Trip to", "Arrive", "Leave", "Nights"],
          ["Paris", "2026-12-01", "2026-12-05", "=DAYS(C2,B2)"],
        ],
      },
      {
        range: "'Trip to Paris'!A4",
        values: [
          ["Flight", "From", "To", "Departs", "Stops", "Price"],
          ["Iberia", "LGW", "ORY", "07:45", "1", "$120"],
          ["Lufthansa", "LCY", "CDG", "12:00", "1", "$180"],
          ["British Airways", "LHR", "ORY", "18:30", "0", "$205"],
          ["Hotel", "Rating", "Per night", "Total"],
          ["L'Atelier Marais", "4.6", "$160", "$640"],
          ["L'Atelier Rive Gauche", "4.9", "$420", "$1680"],
        ],
      },
    ]);
  });

  it("passes the city code, the computed nights and the travellers to the demos", async () => {
    const demos = fakeDemos();
    const calls: { name: string; args: Record<string, Json> }[] = [];
    const callTool = demos.host.callTool.bind(demos.host);
    const host: ToolHost = {
      ...demos.host,
      callTool(name, args, site) {
        calls.push({ name, args });
        return callTool(name, args, site);
      },
    };
    await runMacro(tripPlanMacro, host, { inputs: { ...inputs, city: "Tokyo", directOnly: true } });

    expect(calls.find((c) => c.name === "searchFlights")?.args).toEqual({
      origin: "LON",
      destination: "TYO",
      tripType: "round-trip",
      outboundDate: "2026-12-01",
      inboundDate: "2026-12-05",
      passengers: 2,
    });
    expect(calls.find((c) => c.name === "setFilters")?.args).toEqual({ stops: [0] });
    expect(calls.find((c) => c.name === "search_location")?.args).toEqual({
      query: "Tokyo",
      checkin_date: "2026-12-01",
      nights: 4,
      adults: 2,
    });
  });

  it("takes the next free sheet name when the trip's name is in use", async () => {
    const demos = fakeDemos({ sheets: ["Sheet1", "Trip to Paris"] });
    const result = await runMacro(tripPlanMacro, demos.host, { inputs });

    expect(result).toMatchObject({ status: "done", message: undefined });
    expect(demos.writes.map((w) => w.range)).toEqual(["'Sheet3'!A1", "'Sheet3'!A4"]);
  });

  it("stops before the hotel search when Leave is not after Arrive", async () => {
    const demos = fakeDemos();
    const result = await runMacro(tripPlanMacro, demos.host, { inputs: { ...inputs, checkOut: "2026-12-01" } });

    expect(result).toMatchObject({ status: "failed", message: "Leave must be after Arrive." });
    expect(demos.calls).not.toContain("hotels:search_location");
  });
});
