/**
 * Decides whether a macro should be offered on a page: its trigger site must
 * match the URL and one of its trigger tool sets must be registered right now.
 * Called again on every `toolchange`, so the answer follows dynamic tools.
 */
import type { Macro, MacroSite } from "./types";

export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function siteMatches(site: MacroSite, url: string): boolean {
  return site.match.some((pattern) => patternToRegExp(pattern).test(url));
}

export function triggerSatisfied(macro: Macro, url: string, toolNames: Iterable<string>): boolean {
  const site = macro.sites[macro.trigger.site];
  if (!site || !siteMatches(site, url)) return false;
  const available = new Set(toolNames);
  return macro.trigger.anyOf.some((set) =>
    set.every((alias) => {
      const tool = macro.tools[alias];
      return tool !== undefined && tool.site === macro.trigger.site && available.has(tool.name);
    }),
  );
}

export function matchingMacros(macros: Macro[], url: string, toolNames: Iterable<string>): Macro[] {
  const names = [...toolNames];
  return macros.filter((macro) => triggerSatisfied(macro, url, names));
}
