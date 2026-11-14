// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import type { ContentRequest, RunEvent } from "../messages";
import type { Macro, Stmt } from "../macro/types";
import { createRunHost } from "./runHost";
import { createSiteRouter, type TabRouterDeps } from "./tabRouter";

const HOME = 1;

function macro(program: Stmt[] = [], sheet: Macro["sites"][string] = { match: ["https://sheet.test/*"], startUrl: "https://sheet.test/new" }): Macro {
  return {
    wmm: 1,
    id: "m",
    name: "Cross-site",
    sites: { shop: { match: ["https://shop.test/*"] }, sheet },
    tools: { price: { site: "shop", name: "price" }, write: { site: "sheet", name: "write" } },
    trigger: { site: "shop", anyOf: [] },
    program,
  };
}

/** Open tabs by id and URL; `openTab` adds one with the next id. */
function fakeTabs(open: Record<number, string> = {}) {
  const tabs = new Map(Object.entries(open).map(([id, url]) => [Number(id), url]));
  const opened: string[] = [];
  const deps: TabRouterDeps = {
    listTabs: async () => [...tabs].map(([id, url]) => ({ id, url })),
    openTab: async (url) => {
      opened.push(url);
      const id = Math.max(HOME, ...tabs.keys()) + 1;
      tabs.set(id, url);
      return id;
    },
  };
  return { deps, tabs, opened };
}

describe("createSiteRouter", () => {
  it("runs the trigger site on the run's own tab, whatever its URL", async () => {
    const { deps } = fakeTabs({ 5: "https://shop.test/" });
    await expect(createSiteRouter(deps, macro(), HOME)("shop")).resolves.toBe(HOME);
  });

  it("uses an open tab that matches the site", async () => {
    const { deps, opened } = fakeTabs({ [HOME]: "https://shop.test/", 4: "https://sheet.test/doc" });
    await expect(createSiteRouter(deps, macro(), HOME)("sheet")).resolves.toBe(4);
    expect(opened).toEqual([]);
  });

  it("opens the start URL once, then keeps that tab even after it navigates away", async () => {
    const { deps, tabs, opened } = fakeTabs({ [HOME]: "https://shop.test/" });
    const route = createSiteRouter(deps, macro(), HOME);
    const id = await route("sheet");
    expect(opened).toEqual(["https://sheet.test/new"]);
    tabs.set(id, "https://login.test/");
    await expect(route("sheet")).resolves.toBe(id);
    expect(opened).toHaveLength(1);
  });

  it("finds another tab when the one it used was closed", async () => {
    const { deps, tabs } = fakeTabs({ [HOME]: "https://shop.test/", 4: "https://sheet.test/a" });
    const route = createSiteRouter(deps, macro(), HOME);
    await route("sheet");
    tabs.delete(4);
    tabs.set(6, "https://sheet.test/b");
    await expect(route("sheet")).resolves.toBe(6);
  });

  it("fails without a matching tab or a start URL, and never opens an undeclared or non-web URL", async () => {
    const { deps, opened } = fakeTabs();
    await expect(createSiteRouter(deps, macro([], { match: ["https://sheet.test/*"] }), HOME)("sheet")).rejects.toThrow(
      'No open tab matches site "sheet"',
    );
    await expect(createSiteRouter(deps, macro(), HOME)("nowhere")).rejects.toThrow('Unknown site "nowhere".');
    await expect(createSiteRouter(deps, macro(), HOME)("__proto__")).rejects.toThrow("Unknown site");
    const evil = macro([], { match: ["https://sheet.test/*"], startUrl: "javascript:alert(1)" });
    await expect(createSiteRouter(deps, evil, HOME)("sheet")).rejects.toThrow("not a web page");
    expect(opened).toEqual([]);
  });
});

describe("runs across sites", () => {
  /** Each tab lists its own tools and answers calls with `<tool>@<tab>`. */
  function setup(program: Stmt[], open: Record<number, string>) {
    const toolsByTab: Record<number, string[]> = { [HOME]: ["price"], 2: ["write"], 4: ["write"] };
    const requests: { tabId: number; request: ContentRequest }[] = [];
    const events: RunEvent[] = [];
    const sendToTab = vi.fn(async (tabId: number, request: ContentRequest): Promise<unknown> => {
      requests.push({ tabId, request });
      if (request.type === "list-tools") return (toolsByTab[tabId] ?? []).map((name) => ({ name }));
      if (request.type === "execute-tool") return { ok: true, result: `${request.name}@${tabId}:${JSON.stringify(request.args)}` };
      return undefined;
    });
    const tabs = fakeTabs(open);
    const host = createRunHost({ sendToTab, broadcast: (event) => events.push(event), loadMacros: async () => [macro(program)], tabs: tabs.deps });
    return { host, requests, events, tabs };
  }

  it("routes each site's calls to its tab and passes values through variables", async () => {
    const { host, requests, events } = setup(
      [
        { op: "call", tool: "price", saveAs: "p" },
        { op: "onSite", site: "sheet", body: [{ op: "call", tool: "write", args: { v: { var: "p" } }, saveAs: "w" }] },
      ],
      { [HOME]: "https://shop.test/", 4: "https://sheet.test/doc" },
    );
    await host.startRun(HOME, "m", {});
    const calls = requests.filter(({ request }) => request.type === "execute-tool").map(({ tabId }) => tabId);
    expect(calls).toEqual([HOME, 4]);
    expect(events.at(-1)).toMatchObject({ result: { status: "done", vars: { p: "price@1:{}", w: 'write@4:{"v":"price@1:{}"}' } } });
  });

  it("opens the start URL for a site with no open tab, and Stop reaches that tab", async () => {
    // The new tab gets id 2 from `fakeTabs`.
    const { host, requests, tabs } = setup(
      [{ op: "onSite", site: "sheet", body: [{ op: "call", tool: "write" }, { op: "wait", ms: 60_000 }] }],
      { [HOME]: "https://shop.test/" },
    );
    const run = host.startRun(HOME, "m", {});
    await vi.waitFor(() => expect(requests.some(({ request }) => request.type === "execute-tool")).toBe(true));
    expect(tabs.opened).toEqual(["https://sheet.test/new"]);
    host.stopRun(HOME);
    await run;
    const aborts = requests.filter(({ request }) => request.type === "abort-tool").map(({ tabId }) => tabId);
    expect(aborts.toSorted()).toEqual([HOME, 2]);
  });
});
