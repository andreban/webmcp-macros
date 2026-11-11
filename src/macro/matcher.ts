/**
 * Decides whether a macro should be offered on a page: its trigger site must
 * match the URL and one of its trigger tool sets must be registered right now.
 * Callers re-run this on every `toolchange` and URL change, so the answer
 * follows dynamic tool registration. Pure: no `chrome.*`, no DOM.
 */
import type { Macro, MacroSite } from "./types";

/**
 * Compiles a site URL pattern to an anchored RegExp. `*` matches any run of
 * characters (including none); every other character is literal, because a
 * pattern such as `https://example.com/?q=1` must not treat `.` or `?` as
 * regex syntax.
 */
export function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split("*")
    .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`);
}

/** True when any of the site's URL patterns matches the whole URL. */
export function siteMatches(site: MacroSite, url: string): boolean {
  return site.match.some((pattern) => patternToRegExp(pattern).test(url));
}

/**
 * True when the macro's trigger site matches `url` and every tool alias in
 * at least one `trigger.anyOf` set resolves to a tool that is registered.
 *
 * Only tools declared on the trigger site count: a tool with the right name
 * but declared for another site of a cross-site macro does not satisfy the
 * trigger. Tools the program needs later are not required here; the runner
 * waits for them. An empty set is satisfied by the site match alone.
 */
export function triggerSatisfied(macro: Macro, url: string, toolNames: Iterable<string>): boolean {
  return satisfies(macro, url, toolNames instanceof Set ? toolNames : new Set(toolNames));
}

/** The macros from `macros` whose trigger is satisfied, in their original order. */
export function matchingMacros(macros: readonly Macro[], url: string, toolNames: Iterable<string>): Macro[] {
  const available = new Set(toolNames);
  return macros.filter((macro) => satisfies(macro, url, available));
}

function satisfies(macro: Macro, url: string, available: ReadonlySet<string>): boolean {
  const siteKey = macro.trigger.site;
  // Macros arrive from share strings, so keys are untrusted: own-property
  // lookups keep names like "constructor" from resolving to Object.prototype.
  const site = Object.hasOwn(macro.sites, siteKey) ? macro.sites[siteKey] : undefined;
  if (!site || !siteMatches(site, url)) return false;
  return macro.trigger.anyOf.some((aliases) =>
    aliases.every((alias) => {
      const tool = Object.hasOwn(macro.tools, alias) ? macro.tools[alias] : undefined;
      return tool !== undefined && tool.site === siteKey && available.has(tool.name);
    }),
  );
}
