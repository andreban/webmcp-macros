// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { addToDate, formatLocalDate, parseRelativeDate, resolveRelativeDate } from "./relativeDate";

// Local-time constructors, so the tests hold in any time zone the suite runs in.
const day = (year: number, month: number, date: number) => new Date(year, month - 1, date, 15, 30);

describe("parseRelativeDate", () => {
  it("parses today and signed offsets in each unit", () => {
    expect(parseRelativeDate("today")).toEqual({ amount: 0, unit: "d" });
    expect(parseRelativeDate("today+14d")).toEqual({ amount: 14, unit: "d" });
    expect(parseRelativeDate("today+2w")).toEqual({ amount: 2, unit: "w" });
    expect(parseRelativeDate("today+1m")).toEqual({ amount: 1, unit: "m" });
    expect(parseRelativeDate("today-3d")).toEqual({ amount: -3, unit: "d" });
  });

  it("ignores case and surrounding spaces", () => {
    expect(parseRelativeDate(" Today + 2W ")).toEqual({ amount: 2, unit: "w" });
  });

  it("rejects anything else", () => {
    for (const text of ["", "2026-11-25", "tomorrow", "today+", "today+d", "today+14", "today+14y", "today14d", "today+1.5d", "today+12345d", "today+14d junk"]) {
      expect(parseRelativeDate(text), text).toBeNull();
    }
  });
});

describe("resolveRelativeDate", () => {
  it("resolves to the local YYYY-MM-DD", () => {
    const today = day(2026, 11, 11);
    expect(resolveRelativeDate("today", today)).toBe("2026-11-11");
    expect(resolveRelativeDate("today+14d", today)).toBe("2026-11-25");
    expect(resolveRelativeDate("today+21d", today)).toBe("2026-12-02");
    expect(resolveRelativeDate("today+2w", today)).toBe("2026-11-25");
    expect(resolveRelativeDate("today-11d", today)).toBe("2026-10-31");
  });

  it("crosses month and year ends", () => {
    expect(resolveRelativeDate("today+1d", day(2026, 12, 31))).toBe("2027-01-01");
    expect(resolveRelativeDate("today+2m", day(2026, 11, 30))).toBe("2027-01-30");
    expect(resolveRelativeDate("today-1m", day(2026, 1, 15))).toBe("2025-12-15");
  });

  it("clamps months to the last day of the target month", () => {
    expect(resolveRelativeDate("today+1m", day(2026, 1, 31))).toBe("2026-02-28");
    expect(resolveRelativeDate("today+1m", day(2028, 1, 31))).toBe("2028-02-29");
    expect(resolveRelativeDate("today+1m", day(2026, 3, 31))).toBe("2026-04-30");
    expect(resolveRelativeDate("today-1m", day(2026, 3, 31))).toBe("2026-02-28");
  });

  it("returns null for text that is not a relative date", () => {
    expect(resolveRelativeDate("2026-11-25", day(2026, 11, 11))).toBeNull();
    expect(resolveRelativeDate("next week", day(2026, 11, 11))).toBeNull();
  });

  it("uses the current day by default", () => {
    expect(resolveRelativeDate("today")).toBe(formatLocalDate(new Date()));
  });
});

describe("addToDate", () => {
  it("counts calendar days, not 24-hour spans", () => {
    // Late evening stays on the same calendar day whatever the zone's DST rules.
    expect(addToDate(new Date(2026, 2, 28, 23, 59), { amount: 1, unit: "d" })).toBe("2026-03-29");
    expect(addToDate(new Date(2026, 9, 24, 0, 0), { amount: 2, unit: "d" })).toBe("2026-10-26");
  });
});
