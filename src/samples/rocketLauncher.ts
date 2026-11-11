import type { Macro } from "../macro/types";

/**
 * Launches the rocket on the WebMCP Rocket Launcher demo. In `?mode=dynamic`
 * each tool is registered only in the state where it is valid, so every call
 * relies on the runner waiting for its tool to appear.
 */
export const rocketLauncherMacro: Macro = {
  wmm: 1,
  id: "sample-rocket-launcher",
  name: "Launch the rocket",
  description: "Runs diagnostics, fuels for the chosen destination, prepares and ignites.",
  sites: {
    rocket: {
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
    {
      op: "if",
      cond: { get: { var: "prepared" }, path: ["error"] },
      then: [{ op: "fail", message: { get: { var: "prepared" }, path: ["error"] } }],
    },
    { op: "call", tool: "ignite" },
    { op: "message", text: { bin: "+", left: { lit: "Launched to " }, right: { input: "trajectory" } } },
  ],
};
