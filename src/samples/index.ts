// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Macro } from "../macro/types";
import { adventureMacro } from "./adventure";
import { flightSearchMacro } from "./flightSearch";
import { mazeMacro } from "./maze";
import { rocketLauncherMacro } from "./rocketLauncher";
import { tripPlanMacro } from "./tripPlan";

export { adventureMacro, flightSearchMacro, mazeMacro, rocketLauncherMacro, tripPlanMacro };

/** The macros bundled with the extension, seeded into storage on install. */
export const sampleMacros: readonly Macro[] = [rocketLauncherMacro, flightSearchMacro, tripPlanMacro, adventureMacro, mazeMacro];
