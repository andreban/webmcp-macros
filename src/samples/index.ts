import type { Macro } from "../macro/types";
import { flightSearchMacro } from "./flightSearch";
import { rocketLauncherMacro } from "./rocketLauncher";

export { flightSearchMacro, rocketLauncherMacro };

/** The macros bundled with the extension, seeded into storage on install. */
export const sampleMacros: readonly Macro[] = [rocketLauncherMacro, flightSearchMacro];
