import { describe, expect, it } from "vitest";
import type { Json, Macro } from "../macro/types";
import { rocketLauncherMacro } from "../samples/rocketLauncher";
import { runMacro, type ToolHost } from "./interpreter";

/** A stand-in for the rocket demo in dynamic mode: tools exist only in their state. */
function fakeRocket(authCode: string) {
  let status = "IDLE";
  const calls: string[] = [];
  const always = ["get_page_state", "calculate_fuel", "reset_system"];
  const byState: Record<string, string[]> = {
    IDLE: ["run_diagnostics"],
    DIAGNOSTICS: ["load_fuel"],
    FUELED: ["prepare_launch"],
    PREPARED: ["ignite_engines"],
    LAUNCHED: [],
  };
  const available = () => [...always, ...(byState[status] ?? [])];
  const host: ToolHost = {
    async isToolAvailable(name) {
      return available().includes(name);
    },
    async waitForTool(name) {
      if (!available().includes(name)) throw new Error("timeout");
    },
    async callTool(name, args): Promise<Json> {
      calls.push(name);
      switch (name) {
        case "get_page_state":
          return { status, fuel: 0 };
        case "reset_system":
          status = "IDLE";
          return { status };
        case "calculate_fuel":
          return { trajectory: args.trajectory!, amount: 120, oxidizerRatio: 2.5 };
        case "run_diagnostics":
          status = "DIAGNOSTICS";
          return { status };
        case "load_fuel":
          if (args.amount !== 120 || args.oxidizer_ratio !== 2.5) return { error: "bad fuel", code: "INVALID_INPUT" };
          status = "FUELED";
          return { status };
        case "prepare_launch":
          if (args.auth_code !== authCode) return { error: "Invalid authorization code.", code: "INVALID_AUTH_CODE" };
          status = "PREPARED";
          return { status };
        case "ignite_engines":
          status = "LAUNCHED";
          return { status };
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
  return { host, calls, status: () => status, setStatus: (s: string) => (status = s) };
}

describe("runMacro", () => {
  it("launches the rocket through dynamically registered tools", async () => {
    const rocket = fakeRocket("1234");
    const result = await runMacro(rocketLauncherMacro, rocket.host, { inputs: { trajectory: "Mars", authCode: "1234" } });
    expect(result.status).toBe("done");
    expect(rocket.status()).toBe("LAUNCHED");
    expect(rocket.calls).toEqual(["get_page_state", "run_diagnostics", "calculate_fuel", "load_fuel", "prepare_launch", "ignite_engines"]);
  });

  it("resets first when the rocket is not idle", async () => {
    const rocket = fakeRocket("1234");
    rocket.setStatus("FUELED");
    const result = await runMacro(rocketLauncherMacro, rocket.host, { inputs: { trajectory: "Moon", authCode: "1234" } });
    expect(result.status).toBe("done");
    expect(rocket.calls.slice(0, 2)).toEqual(["get_page_state", "reset_system"]);
  });

  it("fails with the tool's error on a wrong authorization code", async () => {
    const rocket = fakeRocket("1234");
    const result = await runMacro(rocketLauncherMacro, rocket.host, { inputs: { trajectory: "Moon", authCode: "0000" } });
    expect(result).toMatchObject({ status: "failed", message: "Invalid authorization code." });
    expect(rocket.status()).toBe("FUELED");
  });

  it("fails when a tool never becomes available", async () => {
    const host: ToolHost = {
      callTool: async () => null,
      isToolAvailable: async () => false,
      waitForTool: async () => {
        throw new Error("timeout");
      },
    };
    const result = await runMacro(rocketLauncherMacro, host, { inputs: { trajectory: "Moon", authCode: "1" } });
    expect(result).toMatchObject({ status: "failed", message: 'Tool "get_page_state" never became available.' });
  });

  const loop: Macro = {
    wmm: 1,
    id: "loop",
    name: "loop",
    sites: { s: { match: ["*"] } },
    tools: { t: { site: "s", name: "t" } },
    trigger: { site: "s", anyOf: [["t"]] },
    program: [{ op: "while", cond: { lit: true }, body: [{ op: "call", tool: "t" }] }],
  };
  const idle: ToolHost = { callTool: async () => null, isToolAvailable: async () => true, waitForTool: async () => {} };

  it("enforces the step limit on runaway loops", async () => {
    const result = await runMacro(loop, idle, { maxSteps: 50 });
    expect(result).toMatchObject({ status: "failed", message: "Step limit of 50 reached." });
  });

  it("stops when the abort signal fires", async () => {
    const controller = new AbortController();
    let calls = 0;
    const host: ToolHost = { ...idle, callTool: async () => (++calls === 3 ? (controller.abort(), null) : null) };
    const result = await runMacro(loop, host, { signal: controller.signal });
    expect(result).toMatchObject({ status: "failed", message: "Stopped by the user.", toolCalls: 3 });
  });

  it("evaluates loops, variables and arithmetic", async () => {
    const macro: Macro = {
      ...loop,
      program: [
        { op: "set", var: "sum", value: { lit: 0 } },
        { op: "forEach", list: { lit: [1, 2, 3] }, var: "n", body: [{ op: "set", var: "sum", value: { bin: "+", left: { var: "sum" }, right: { var: "n" } } }] },
        { op: "if", cond: { bin: ">", left: { var: "sum" }, right: { lit: 5 } }, then: [{ op: "stop", message: { lit: "big" } }] },
      ],
    };
    const result = await runMacro(macro, idle);
    expect(result).toMatchObject({ status: "stopped", message: "big", vars: { sum: 6 } });
  });
});
