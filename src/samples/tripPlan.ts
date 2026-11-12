import { MACRO_VERSION, type BinaryOp, type Expr, type Json, type Macro, type Stmt } from "../macro/types";

const lit = (value: Json): Expr => ({ lit: value });
const v = (name: string): Expr => ({ var: name });
const input = (key: string): Expr => ({ input: key });
const get = (from: Expr, ...path: (string | number)[]): Expr => ({ get: from, path });
const bin = (op: BinaryOp, left: Expr, right: Expr): Expr => ({ bin: op, left, right });
/** Joins values into one string; `+` concatenates once either side is a string. */
const str = (...parts: Expr[]): Expr => parts.reduce((left, right) => bin("+", left, right), lit(""));
const set = (name: string, value: Expr): Stmt => ({ op: "set", var: name, value });
const when = (cond: Expr, then: Stmt[], otherwise?: Stmt[]): Stmt =>
  otherwise ? { op: "if", cond, then, else: otherwise } : { op: "if", cond, then };
const push = (name: string, value: Expr): Stmt => ({ op: "push", var: name, value });
const row = (...cells: Expr[]): Expr => ({ list: cells });
const onSite = (site: string, body: Stmt[]): Stmt => ({ op: "onSite", site, body });

/** The spreadsheet answers a refused call with `{ error }` instead of throwing. */
const failOnError = (name: string): Stmt =>
  when(bin("!=", get(v(name), "error"), lit(null)), [{ op: "fail", message: get(v(name), "error") }]);

/** The cities the hotel demo has hotels in, with the IATA city code the flight demo knows. */
const CITY_CODES = { "New York": "NYC", Paris: "PAR", Tokyo: "TYO" };
/** How many of the cheapest flights and hotels go into the sheet. */
const PICKS = 3;

/**
 * Plans a trip across three GoogleChromeLabs demos on one origin (spec §12,
 * macro 3): flights on the run's tab, then a new sheet, then hotels, then the
 * sheet again, with values crossing sites only through variables.
 *
 * Macros have no date arithmetic, so the nights between the two dates come
 * from the sheet itself: the trip row holds `=DAYS(...)`, and `set_values`
 * returns the computed value, which then feeds the hotel search.
 *
 * The data rows are collected in `rows` before the single write, so later
 * steps can reuse them.
 */
export const tripPlanMacro: Macro = {
  wmm: MACRO_VERSION,
  id: "sample-trip-plan",
  name: "Plan a trip",
  description: "Finds the cheapest flights and hotels for one set of dates and writes them into a new sheet.",
  sites: {
    flights: {
      match: ["https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/*"],
      startUrl: "https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/",
    },
    hotels: {
      match: ["https://googlechromelabs.github.io/webmcp-tools/demos/hotel-chain/*"],
      startUrl: "https://googlechromelabs.github.io/webmcp-tools/demos/hotel-chain/",
    },
    sheet: {
      match: ["https://googlechromelabs.github.io/webmcp-tools/demos/spreadsheet/*"],
      startUrl: "https://googlechromelabs.github.io/webmcp-tools/demos/spreadsheet/",
    },
  },
  tools: {
    searchFlights: { site: "flights", name: "searchFlights" },
    filterFlights: { site: "flights", name: "setFilters" },
    listFlights: { site: "flights", name: "listFlights" },
    searchHotels: { site: "hotels", name: "search_location" },
    listHotels: { site: "hotels", name: "get_hotel_search_results" },
    addSheet: { site: "sheet", name: "add_sheet" },
    setValues: { site: "sheet", name: "set_values" },
  },
  trigger: { site: "flights", anyOf: [["searchFlights"]] },
  inputs: [
    { key: "origin", label: "From (IATA)", schema: { type: "string", pattern: "^[A-Z]{3}$" }, mode: "remember", default: "LON" },
    {
      key: "city",
      label: "Destination",
      schema: { type: "string", enum: Object.keys(CITY_CODES) },
      mode: "ask",
      default: "Paris",
    },
    { key: "checkIn", label: "Arrive", schema: { type: "string", format: "date" }, mode: "ask", default: "today+14d" },
    { key: "checkOut", label: "Leave", schema: { type: "string", format: "date" }, mode: "ask", default: "today+21d" },
    { key: "travellers", label: "Travellers", schema: { type: "number", minimum: 1 }, mode: "remember", default: 1 },
    { key: "directOnly", label: "Direct flights only", schema: { type: "boolean" }, mode: "remember", default: false },
  ],
  procedures: {
    // The `count` items with the lowest `price`, cheapest first.
    cheapest: {
      params: ["items", "count"],
      body: [
        set("picked", { list: [] }),
        {
          op: "repeat",
          times: v("count"),
          body: [
            set("best", lit(null)),
            {
              op: "forEach",
              list: v("items"),
              var: "item",
              body: [
                when(
                  bin(
                    "and",
                    { not: { contains: v("picked"), item: v("item") } },
                    bin("or", bin("==", v("best"), lit(null)), bin("<", get(v("item"), "price"), get(v("best"), "price"))),
                  ),
                  [set("best", v("item"))],
                ),
              ],
            },
            when(bin("!=", v("best"), lit(null)), [push("picked", v("best"))]),
          ],
        },
        { op: "return", value: v("picked") },
      ],
    },
  },
  program: [
    {
      op: "call",
      tool: "searchFlights",
      args: {
        origin: input("origin"),
        destination: { getKey: lit(CITY_CODES), key: input("city") },
        tripType: lit("round-trip"),
        outboundDate: input("checkIn"),
        inboundDate: input("checkOut"),
        passengers: input("travellers"),
      },
    },
    // The results view registers setFilters and listFlights once it mounts.
    { op: "waitForTool", tool: "filterFlights" },
    set("stops", lit([])),
    when(input("directOnly"), [set("stops", lit([0]))]),
    { op: "call", tool: "filterFlights", args: { stops: v("stops") } },
    { op: "call", tool: "listFlights", saveAs: "allFlights" },
    set("flights", { callProc: "cheapest", args: { items: v("allFlights"), count: lit(PICKS) } }),

    onSite("sheet", [
      // add_sheet refuses a name in use, as on a second run; then take the next free name.
      { op: "call", tool: "addSheet", args: { name: str(lit("Trip to "), input("city")) }, saveAs: "added" },
      when(bin("!=", get(v("added"), "error"), lit(null)), [{ op: "call", tool: "addSheet", saveAs: "added" }]),
      failOnError("added"),
      // A new sheet is not the one on screen, so every range names it.
      set("sheetRef", str(lit("'"), get(v("added"), "name"), lit("'!"))),
      {
        op: "call",
        tool: "setValues",
        args: {
          range: str(v("sheetRef"), lit("A1")),
          values: {
            list: [
              row(lit("Trip to"), lit("Arrive"), lit("Leave"), lit("Nights")),
              row(input("city"), input("checkIn"), input("checkOut"), lit("=DAYS(C2,B2)")),
            ],
          },
        },
        saveAs: "trip",
      },
      failOnError("trip"),
      set("nights", get(v("trip"), "values", 1, 3)),
      // Also catches a formula error, which reads as text such as "#VALUE!".
      when({ not: bin(">=", v("nights"), lit(1)) }, [{ op: "fail", message: lit("Leave must be after Arrive.") }]),
    ]),

    onSite("hotels", [
      {
        op: "call",
        tool: "searchHotels",
        args: { query: input("city"), checkin_date: input("checkIn"), nights: v("nights"), adults: input("travellers") },
      },
      // The results page registers its tools once the search has navigated to it.
      { op: "waitForTool", tool: "listHotels" },
      { op: "call", tool: "listHotels", saveAs: "hotelResults" },
      set("hotels", { callProc: "cheapest", args: { items: get(v("hotelResults"), "hotels"), count: lit(PICKS) } }),
    ]),

    // set_values takes every cell as typed text, so numbers are joined into strings.
    set("rows", { list: [row(lit("Flight"), lit("From"), lit("To"), lit("Departs"), lit("Stops"), lit("Price"))] }),
    {
      op: "forEach",
      list: v("flights"),
      var: "f",
      body: [
        push(
          "rows",
          row(
            get(v("f"), "airline"),
            get(v("f"), "origin"),
            get(v("f"), "destination"),
            get(v("f"), "departureTime"),
            str(get(v("f"), "stops")),
            str(lit("$"), get(v("f"), "price")),
          ),
        ),
      ],
    },
    push("rows", row(lit("Hotel"), lit("Rating"), lit("Per night"), lit("Total"))),
    {
      op: "forEach",
      list: v("hotels"),
      var: "h",
      body: [
        push(
          "rows",
          row(
            get(v("h"), "name"),
            str(get(v("h"), "rating")),
            str(lit("$"), get(v("h"), "price")),
            str(lit("$"), bin("*", get(v("h"), "price"), v("nights"))),
          ),
        ),
      ],
    },

    onSite("sheet", [
      { op: "call", tool: "setValues", args: { range: str(v("sheetRef"), lit("A4")), values: v("rows") }, saveAs: "written" },
      failOnError("written"),
    ]),
    {
      op: "message",
      text: str(lit("Trip to "), input("city"), lit(" written to sheet "), get(v("added"), "name"), lit(".")),
    },
  ],
};
