import { describe, expect, it } from "vitest";
import { matchingMacros, patternToRegExp, siteMatches, triggerSatisfied } from "./matcher";
import { MACRO_VERSION, type Macro } from "./types";

const ROCKET_URL = "https://bandarra.me/apps/webmcp-rocketlauncher/?mode=dynamic";

// Shaped like the rocket launcher sample: the trigger needs the tools of the
// first steps, while `ignite` is registered only after the rocket is prepared.
const rocket: Macro = {
  wmm: MACRO_VERSION,
  id: "rocket",
  name: "Launch the rocket",
  sites: { rocket: { match: ["https://bandarra.me/apps/webmcp-rocketlauncher/*"] } },
  tools: {
    state: { site: "rocket", name: "get_page_state" },
    fuel: { site: "rocket", name: "calculate_fuel" },
    diagnostics: { site: "rocket", name: "run_diagnostics" },
    ignite: { site: "rocket", name: "ignite_engines" },
  },
  trigger: { site: "rocket", anyOf: [["state", "fuel"]] },
  program: [
    { op: "call", tool: "fuel" },
    { op: "waitForTool", tool: "ignite" },
    { op: "call", tool: "ignite" },
  ],
};

// A cross-site macro whose trigger site is "flights"; "hotel" declares a tool
// with the same name as one the trigger needs.
const trip: Macro = {
  wmm: MACRO_VERSION,
  id: "trip",
  name: "Plan a trip",
  sites: {
    flights: { match: ["https://flights.example/*"] },
    hotel: { match: ["https://hotel.example/*"] },
  },
  tools: {
    search: { site: "flights", name: "search" },
    hotelSearch: { site: "hotel", name: "search" },
    book: { site: "hotel", name: "book" },
  },
  trigger: { site: "flights", anyOf: [["search"]] },
  program: [],
};

describe("patternToRegExp", () => {
  it("treats * as any run of characters, including none", () => {
    const re = patternToRegExp("https://*.example.com/*");
    expect(re.test("https://www.example.com/a/b?c=1")).toBe(true);
    expect(re.test("https://.example.com/")).toBe(true);
    expect(re.test("http://www.example.com/")).toBe(false);
  });

  it("anchors the whole URL", () => {
    expect(patternToRegExp("https://example.com/").test("https://example.com/extra")).toBe(false);
    expect(patternToRegExp("https://example.com/").test("xhttps://example.com/")).toBe(false);
  });

  it("matches regex metacharacters literally", () => {
    const re = patternToRegExp("https://a.b/p?q=(1)+[x]|{y}^$\\");
    expect(re.test("https://a.b/p?q=(1)+[x]|{y}^$\\")).toBe(true);
    expect(re.test("https://aXb/p?q=(1)+[x]|{y}^$\\")).toBe(false);
    expect(patternToRegExp("https://a.b/p?q").test("https://a.b/q")).toBe(false);
  });
});

describe("siteMatches", () => {
  it("matches when any pattern matches", () => {
    const site = { match: ["https://a.example/*", "https://b.example/*"] };
    expect(siteMatches(site, "https://b.example/x")).toBe(true);
    expect(siteMatches(site, "https://c.example/x")).toBe(false);
  });
});

describe("triggerSatisfied", () => {
  it("offers a macro when the site and a trigger tool set are present", () => {
    expect(triggerSatisfied(rocket, ROCKET_URL, ["get_page_state", "calculate_fuel", "run_diagnostics"])).toBe(true);
  });

  it("does not require tools that only appear later in the run", () => {
    expect(triggerSatisfied(rocket, ROCKET_URL, ["get_page_state", "calculate_fuel"])).toBe(true);
  });

  it("withholds the macro when a trigger tool is missing", () => {
    expect(triggerSatisfied(rocket, ROCKET_URL, ["get_page_state"])).toBe(false);
  });

  it("withholds the macro on another site even if tool names match", () => {
    expect(triggerSatisfied(rocket, "https://example.com/", ["get_page_state", "calculate_fuel"])).toBe(false);
  });

  it("accepts any one of several tool sets", () => {
    const either: Macro = { ...rocket, trigger: { site: "rocket", anyOf: [["ignite"], ["diagnostics"]] } };
    expect(triggerSatisfied(either, ROCKET_URL, ["run_diagnostics"])).toBe(true);
    expect(triggerSatisfied(either, ROCKET_URL, ["get_page_state"])).toBe(false);
  });

  it("counts only tools declared on the trigger site", () => {
    const viaHotel: Macro = { ...trip, trigger: { site: "flights", anyOf: [["hotelSearch"]] } };
    expect(triggerSatisfied(trip, "https://flights.example/", ["search"])).toBe(true);
    expect(triggerSatisfied(viaHotel, "https://flights.example/", ["search"])).toBe(false);
    expect(triggerSatisfied(trip, "https://hotel.example/", ["search", "book"])).toBe(false);
  });

  it("withholds the macro when the trigger names an unknown site or alias", () => {
    const unknownAlias: Macro = { ...rocket, trigger: { site: "rocket", anyOf: [["nope"]] } };
    const unknownSite: Macro = { ...rocket, trigger: { site: "nope", anyOf: [["state"]] } };
    expect(triggerSatisfied(unknownAlias, ROCKET_URL, ["get_page_state"])).toBe(false);
    expect(triggerSatisfied(unknownSite, ROCKET_URL, ["get_page_state"])).toBe(false);
  });

  it("ignores inherited object keys in site and tool lookups", () => {
    const protoSite: Macro = { ...rocket, trigger: { site: "constructor", anyOf: [[]] } };
    const protoTool: Macro = { ...rocket, trigger: { site: "rocket", anyOf: [["toString"]] } };
    expect(triggerSatisfied(protoSite, ROCKET_URL, [])).toBe(false);
    expect(triggerSatisfied(protoTool, ROCKET_URL, ["toString"])).toBe(false);
  });
});

describe("matchingMacros", () => {
  it("filters a list of macros, keeping their order", () => {
    const found = matchingMacros([trip, rocket], ROCKET_URL, ["get_page_state", "calculate_fuel", "search"]);
    expect(found.map((m) => m.id)).toEqual(["rocket"]);
  });

  it("reads a one-shot iterable of tool names once for all macros", () => {
    const second: Macro = { ...rocket, id: "rocket-2" };
    const names = new Map([["get_page_state", 1], ["calculate_fuel", 2]]).keys();
    expect(matchingMacros([rocket, second], ROCKET_URL, names).map((m) => m.id)).toEqual(["rocket", "rocket-2"]);
  });
});
