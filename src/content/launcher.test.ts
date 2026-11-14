// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { launcherAction } from "./launcher";

describe("launcherAction", () => {
  it("mounts when a macro starts matching and re-renders while it still does", () => {
    expect(launcherAction(false, 1, false)).toBe("mount");
    expect(launcherAction(true, 2, false)).toBe("render");
  });

  it("unmounts when nothing matches and no run is shown, and never mounts for nothing", () => {
    expect(launcherAction(true, 0, false)).toBe("unmount");
    expect(launcherAction(false, 0, false)).toBe("none");
  });

  it("stays mounted while a run is shown even after its trigger tools are gone", () => {
    expect(launcherAction(true, 0, true)).toBe("render");
  });
});
