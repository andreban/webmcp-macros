import { MACRO_VERSION, type Macro } from "../macro/types";

/**
 * Launches the rocket on the WebMCP Rocket Launcher demo (spec §12, macro 1).
 *
 * In `?mode=dynamic` each step's tool is registered only in the state where it
 * is valid, so every call relies on the runner waiting for its tool to appear.
 * Only `get_page_state` and `calculate_fuel` are registered in every state,
 * which is why they alone make up the trigger.
 */
export const rocketLauncherMacro: Macro = {
  wmm: MACRO_VERSION,
  id: "sample-rocket-launcher",
  name: "Launch the rocket",
  description: "Runs diagnostics, fuels for the chosen destination, prepares and ignites.",
  sites: {
    rocket: {
      // localhost serves the e2e fixture, which registers the same tools.
      match: ["https://bandarra.me/apps/webmcp-rocketlauncher/*", "http://localhost:*/*"],
      startUrl: "https://bandarra.me/apps/webmcp-rocketlauncher/?mode=dynamic",
    },
  },
  tools: {
    state: { site: "rocket", name: "get_page_state" },
    reset: { site: "rocket", name: "reset_system" },
    diagnostics: { site: "rocket", name: "run_diagnostics" },
    fuelPlan: { site: "rocket", name: "calculate_fuel" },
    loadFuel: { site: "rocket", name: "load_fuel" },
    prepare: { site: "rocket", name: "prepare_launch" },
    ignite: { site: "rocket", name: "ignite_engines" },
  },
  trigger: { site: "rocket", anyOf: [["state", "fuelPlan"]] },
  inputs: [
    {
      key: "trajectory",
      label: "Destination",
      schema: { type: "string", enum: ["Moon", "Mars", "ISS", "Jupiter"] },
      mode: "remember",
      default: "Moon",
    },
    {
      key: "authCode",
      label: "Authorization code (shown on the page)",
      schema: { type: "string", pattern: "^[0-9]{4}$" },
      mode: "ask",
    },
  ],
  program: [
    // Start from IDLE: diagnostics is only registered there.
    { op: "call", tool: "state", saveAs: "state" },
    {
      op: "if",
      cond: { bin: "!=", left: { get: { var: "state" }, path: ["status"] }, right: { lit: "IDLE" } },
      then: [{ op: "call", tool: "reset" }],
    },
    { op: "call", tool: "diagnostics" },
    { op: "call", tool: "fuelPlan", args: { trajectory: { input: "trajectory" } }, saveAs: "plan" },
    {
      op: "call",
      tool: "loadFuel",
      args: {
        amount: { get: { var: "plan" }, path: ["amount"] },
        oxidizer_ratio: { get: { var: "plan" }, path: ["oxidizerRatio"] },
      },
    },
    {
      op: "call",
      tool: "prepare",
      args: { auth_code: { input: "authCode" }, trajectory: { input: "trajectory" } },
      saveAs: "prepared",
    },
    // A wrong code is reported in the result, not thrown; ignite would never appear.
    {
      op: "if",
      cond: { get: { var: "prepared" }, path: ["error"] },
      then: [{ op: "fail", message: { get: { var: "prepared" }, path: ["error"] } }],
    },
    { op: "call", tool: "ignite" },
    { op: "message", text: { bin: "+", left: { lit: "Launched to " }, right: { input: "trajectory" } } },
  ],
};
