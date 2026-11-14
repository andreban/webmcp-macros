// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/**
 * When the on-page launcher exists. Kept free of `chrome.*`, React and the DOM
 * so it runs under Vitest: `index.ts` applies the answer.
 */

/** What to do with the launcher after the page's matches or the run changed. */
export type LauncherAction = "mount" | "render" | "unmount" | "none";

/**
 * The launcher exists while a macro matches the page or a run is shown
 * (`busy`): a run's trigger tools often unregister mid-run, and its status
 * must stay visible until the user closes it. Pages with no matching macro
 * never get an element, and never load React.
 */
export function launcherAction(mounted: boolean, matchCount: number, busy: boolean): LauncherAction {
  const wanted = matchCount > 0 || busy;
  if (wanted) return mounted ? "render" : "mount";
  return mounted ? "unmount" : "none";
}
