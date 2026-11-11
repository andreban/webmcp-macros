import type { Macro } from "../macro/types";
import { adventureMacro } from "./adventure";
import { flightSearchMacro } from "./flightSearch";
import { mazeMacro } from "./maze";
import { rocketLauncherMacro } from "./rocketLauncher";

export { adventureMacro, flightSearchMacro, mazeMacro, rocketLauncherMacro };

/** The macros bundled with the extension, seeded into storage on install. */
export const sampleMacros: readonly Macro[] = [rocketLauncherMacro, flightSearchMacro, adventureMacro, mazeMacro];
