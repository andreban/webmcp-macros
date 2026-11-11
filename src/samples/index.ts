import type { Macro } from "../macro/types";
import { flightSearchMacro } from "./flightSearch";
import { rocketLauncherMacro } from "./rocketLauncher";

export const sampleMacros: Macro[] = [rocketLauncherMacro, flightSearchMacro];
