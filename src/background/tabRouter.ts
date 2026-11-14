// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/**
 * Decides which tab each site of a run uses. The trigger site is the tab the
 * run started on. Another site uses the tab it used before while that tab is
 * open, else an open tab whose URL matches the site, else a new tab at the
 * site's `startUrl`. The router only ever opens a declared `startUrl`, so a
 * macro cannot send the browser anywhere its sites do not name. Chrome is
 * reached only through `TabRouterDeps`, so this runs under Vitest in Node.
 */
import { siteMatches } from "../macro/matcher";
import type { Macro } from "../macro/types";
import { MacroRunError } from "../runner/interpreter";

export interface TabRouterDeps {
  /** The open tabs whose URL the extension can read. */
  listTabs(): Promise<{ id: number; url: string }[]>;
  /** Opens a tab at `url` and resolves its id. */
  openTab(url: string): Promise<number>;
}

/** Resolves a key into `Macro.sites` to the id of the tab its steps run on. */
export type SiteRouter = (site: string) => Promise<number>;

export function createSiteRouter(deps: TabRouterDeps, macro: Macro, homeTabId: number): SiteRouter {
  // A run's own calls may navigate a routed tab off its patterns; it stays
  // that site's tab for the rest of the run.
  const routed = new Map<string, number>();
  return async (key) => {
    if (key === macro.trigger.site) return homeTabId;
    const site = Object.hasOwn(macro.sites, key) ? macro.sites[key] : undefined;
    if (!site) throw new MacroRunError(`Unknown site "${key}".`);
    const tabs = await deps.listTabs();
    const known = routed.get(key);
    if (known !== undefined && tabs.some((tab) => tab.id === known)) return known;
    const open = tabs.find((tab) => siteMatches(site, tab.url));
    if (open) {
      routed.set(key, open.id);
      return open.id;
    }
    if (!site.startUrl) throw new MacroRunError(`No open tab matches site "${key}", and it has no start URL.`);
    // Shared macros come from anyone: never open a javascript:, data: or extension URL.
    if (!/^https?:\/\//i.test(site.startUrl)) throw new MacroRunError(`The start URL of site "${key}" is not a web page.`);
    const id = await deps.openTab(site.startUrl);
    routed.set(key, id);
    return id;
  };
}
