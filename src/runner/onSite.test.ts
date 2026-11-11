import { describe, expect, it } from "vitest";
import type { Json, Macro, Stmt } from "../macro/types";
import type { RunState } from "./machine";
import { runMacro, startRun, step, type ToolHost } from "./interpreter";

/**
 * Two sites, each with its own tools: a host that routes by site key the way
 * the background does by tab. A tool exists only on its own site.
 */
function twoSiteHost() {
  const pages: Record<string, Record<string, (args: Record<string, Json>) => Json>> = {
    shop: { price: () => 42, stock: () => ({ count: 3 }) },
    sheet: { write: (args) => ({ wrote: args.value ?? null }) },
  };
  const calls: { site: string; name: string; args: Record<string, Json> }[] = [];
  const checks: { site: string; name: string }[] = [];
  const has = (site: string, name: string) => Object.hasOwn(pages[site] ?? {}, name);
  const host: ToolHost = {
    async callTool(name, args, site) {
      calls.push({ site, name, args });
      const handler = pages[site]?.[name];
      if (!handler) throw new Error(`no ${name} on ${site}`);
      return handler(args);
    },
    async isToolAvailable(name, site) {
      checks.push({ site, name });
      return has(site, name);
    },
    async waitForTool(name, _timeoutMs, site) {
      checks.push({ site, name });
      if (!has(site, name)) throw new Error("timeout");
    },
  };
  return { host, calls, checks };
}

function macro(program: Stmt[], procedures?: Macro["procedures"]): Macro {
  return {
    wmm: 1,
    id: "cross",
    name: "Cross-site",
    sites: {
      shop: { match: ["https://shop.test/*"], startUrl: "https://shop.test/" },
      sheet: { match: ["https://sheet.test/*"], startUrl: "https://sheet.test/" },
    },
    tools: {
      price: { site: "shop", name: "price" },
      stock: { site: "shop", name: "stock" },
      write: { site: "sheet", name: "write" },
    },
    trigger: { site: "shop", anyOf: [["price"]] },
    ...(procedures ? { procedures } : {}),
    program,
  };
}

const where = (calls: { site: string; name: string }[]) => calls.map(({ site, name }) => `${site}:${name}`);

describe("onSite", () => {
  it("passes a value from one site to the other through a variable", async () => {
    const fake = twoSiteHost();
    const result = await runMacro(
      macro([
        { op: "call", tool: "price", saveAs: "p" },
        { op: "onSite", site: "sheet", body: [{ op: "call", tool: "write", args: { value: { var: "p" } }, saveAs: "w" }] },
      ]),
      fake.host,
    );
    expect(result).toEqual({ status: "done", toolCalls: 2, vars: { p: 42, w: { wrote: 42 } } });
    expect(fake.calls).toEqual([
      { site: "shop", name: "price", args: {} },
      { site: "sheet", name: "write", args: { value: 42 } },
    ]);
  });

  it("restores the previous site when a nested onSite ends", async () => {
    const fake = twoSiteHost();
    const result = await runMacro(
      macro([
        {
          op: "onSite",
          site: "sheet",
          body: [
            { op: "onSite", site: "shop", body: [{ op: "call", tool: "price" }] },
            { op: "call", tool: "write" },
          ],
        },
        { op: "call", tool: "stock" },
      ]),
      fake.host,
    );
    expect(result.status).toBe("done");
    expect(where(fake.calls)).toEqual(["shop:price", "sheet:write", "shop:stock"]);
  });

  it("sends waits and availability checks to the current site", async () => {
    const fake = twoSiteHost();
    const result = await runMacro(
      macro([
        {
          op: "onSite",
          site: "sheet",
          body: [
            { op: "waitForTool", tool: "write" },
            { op: "set", var: "ok", value: { toolAvailable: "write" } },
          ],
        },
      ]),
      fake.host,
    );
    expect(result).toMatchObject({ status: "done", vars: { ok: true } });
    expect(where(fake.checks)).toEqual(["sheet:write", "sheet:write"]);
  });

  it("runs a procedure on its caller's site", async () => {
    const fake = twoSiteHost();
    const result = await runMacro(
      macro([{ op: "onSite", site: "sheet", body: [{ op: "set", var: "r", value: { callProc: "save" } }] }], {
        save: { params: [], body: [{ op: "return", value: { call: "write", args: { value: { lit: 1 } } } }] },
      }),
      fake.host,
    );
    expect(result).toMatchObject({ status: "done", vars: { r: { wrote: 1 } } });
    expect(where(fake.calls)).toEqual(["sheet:write"]);
  });

  it("fails before calling a tool of another site", async () => {
    const fake = twoSiteHost();
    const result = await runMacro(macro([{ op: "call", tool: "write" }]), fake.host);
    expect(result).toMatchObject({ status: "failed", message: expect.stringContaining('belongs to site "sheet"') });
    expect(fake.calls).toEqual([]);
    expect(fake.checks).toEqual([]);
  });

  it("fails on a site the macro does not declare", async () => {
    const fake = twoSiteHost();
    const result = await runMacro(macro([{ op: "onSite", site: "elsewhere", body: [] }]), fake.host);
    expect(result).toMatchObject({ status: "failed", message: 'Unknown site "elsewhere".' });
  });

  it("keeps the site in the saved state, so a resumed run stays on it", async () => {
    const fake = twoSiteHost();
    const m = macro([
      { op: "onSite", site: "sheet", body: [{ op: "wait", ms: 0 }, { op: "call", tool: "write" }] },
      { op: "call", tool: "price" },
    ]);
    let state = await step(startRun(m), fake.host);
    expect(state.frames.at(-1)).toEqual({ branch: "body", pc: 0, site: "sheet" });
    while (state.status === "running") {
      const restored: RunState = JSON.parse(JSON.stringify(state));
      state = await step(restored, fake.host);
    }
    expect(state.status).toBe("done");
    expect(where(fake.calls)).toEqual(["sheet:write", "shop:price"]);
  });
});
