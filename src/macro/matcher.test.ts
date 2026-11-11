import { describe, expect, it } from "vitest";
import { flightSearchMacro } from "../samples/flightSearch";
import { rocketLauncherMacro } from "../samples/rocketLauncher";
import { matchingMacros, triggerSatisfied } from "./matcher";

const ROCKET_URL = "https://bandarra.me/apps/webmcp-rocketlauncher/?mode=dynamic";

describe("trigger matching", () => {
  it("offers a macro when the site and a trigger tool set are present", () => {
    expect(triggerSatisfied(rocketLauncherMacro, ROCKET_URL, ["get_page_state", "calculate_fuel", "run_diagnostics"])).toBe(true);
  });

  it("does not require tools that only appear later in the run", () => {
    // ignite_engines is registered only in the PREPARED state.
    expect(triggerSatisfied(rocketLauncherMacro, ROCKET_URL, ["get_page_state", "calculate_fuel"])).toBe(true);
  });

  it("withholds the macro when a trigger tool is missing", () => {
    expect(triggerSatisfied(rocketLauncherMacro, ROCKET_URL, ["get_page_state"])).toBe(false);
  });

  it("withholds the macro on another site even if tool names match", () => {
    expect(triggerSatisfied(rocketLauncherMacro, "https://example.com/", ["get_page_state", "calculate_fuel"])).toBe(false);
  });

  it("filters a list of macros", () => {
    const found = matchingMacros([rocketLauncherMacro, flightSearchMacro], ROCKET_URL, ["get_page_state", "calculate_fuel"]);
    expect(found.map((m) => m.id)).toEqual(["sample-rocket-launcher"]);
  });
});
