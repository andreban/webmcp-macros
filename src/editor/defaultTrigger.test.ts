import { describe, expect, it } from "vitest";
import type { Macro } from "../macro/types";
import { flightSearchMacro, rocketLauncherMacro } from "../samples";
import { defaultTrigger } from "./defaultTrigger";

const twoSites: Macro = {
  ...flightSearchMacro,
  sites: { a: { match: ["https://a.test/*"] }, b: { match: ["https://b.test/*"] } },
  tools: {
    one: { site: "a", name: "one" },
    two: { site: "a", name: "two" },
    other: { site: "b", name: "other" },
    later: { site: "a", name: "later" },
  },
  trigger: { site: "a", anyOf: [] },
  program: [],
};

describe("defaultTrigger", () => {
  it("proposes the flight sample's trigger: only the search runs before it waits for filters", () => {
    expect(defaultTrigger(flightSearchMacro)).toEqual(flightSearchMacro.trigger);
  });

  it("proposes every rocket tool, in call order, since that program never waits", () => {
    // The sample's hand-tuned trigger is narrower: in dynamic mode only two tools are
    // always registered, which the program cannot tell. The author edits the proposal.
    expect(defaultTrigger(rocketLauncherMacro)).toEqual({
      site: "rocket",
      anyOf: [["state", "reset", "diagnostics", "fuelPlan", "loadFuel", "prepare", "ignite"]],
    });
  });

  it("stops at a waitForTool nested in a branch and skips tools of other sites", () => {
    const macro: Macro = {
      ...twoSites,
      program: [
        { op: "call", tool: "other" },
        { op: "if", cond: { lit: true }, then: [{ op: "call", tool: "one" }, { op: "waitForTool", tool: "later" }] },
        { op: "call", tool: "later" },
      ],
    };
    expect(defaultTrigger(macro)).toEqual({ site: "a", anyOf: [["one"]] });
  });

  it("counts tools called from expressions, before the call that uses them", () => {
    const macro: Macro = {
      ...twoSites,
      program: [
        { op: "call", tool: "one", args: { x: { bin: "+", left: { lit: 1 }, right: { call: "two" } } } },
        { op: "message", text: { not: { call: "later" } } },
      ],
    };
    expect(defaultTrigger(macro).anyOf).toEqual([["two", "one", "later"]]);
  });

  it("proposes the site alone for a program without tool calls", () => {
    expect(defaultTrigger(twoSites)).toEqual({ site: "a", anyOf: [[]] });
  });

  it("falls back to the first site when the trigger names none of them", () => {
    const macro: Macro = { ...twoSites, trigger: { site: "gone", anyOf: [] }, program: [{ op: "call", tool: "one" }] };
    expect(defaultTrigger(macro)).toEqual({ site: "a", anyOf: [["one"]] });
  });
});
