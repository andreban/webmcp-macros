/**
 * Relative dates for date inputs (spec §11): a default or preset can say
 * `today+14d` instead of a fixed day, so a shared macro or a saved preset
 * does not go stale. The text is stored as is and resolved when a run's form
 * opens, in the user's local time zone.
 *
 * Grammar: `today`, optionally followed by `+` or `-`, a count and a unit
 * (`d` days, `w` weeks, `m` months). Case and spaces around the parts are
 * ignored, so `Today + 2W` is accepted.
 */

export type RelativeDateUnit = "d" | "w" | "m";

export interface RelativeDate {
  /** Signed offset from today, in `unit`s. */
  amount: number;
  unit: RelativeDateUnit;
}

// The count is capped at four digits: enough for any trip, and it keeps the
// arithmetic far from the range where `Date` gives up.
const PATTERN = /^\s*today\s*(?:([+-])\s*(\d{1,4})\s*([dwm]))?\s*$/i;

const isUnit = (value: string): value is RelativeDateUnit => value === "d" || value === "w" || value === "m";

/** The offset `text` describes, or `null` when it is not a relative date. */
export function parseRelativeDate(text: string): RelativeDate | null {
  const match = PATTERN.exec(text);
  if (match === null) return null;
  const [, sign, count, unit] = match;
  if (sign === undefined || count === undefined || unit === undefined) return { amount: 0, unit: "d" };
  const lower = unit.toLowerCase();
  if (!isUnit(lower)) return null;
  const amount = Number(count);
  return { amount: sign === "-" ? -amount : amount, unit: lower };
}

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/** `date`'s local calendar day as `YYYY-MM-DD`, the value format of `<input type="date">`. */
export function formatLocalDate(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/**
 * The local day `offset` lands on, counted from `today`'s local day. Months
 * keep the day of the month but clamp to the target month's last day, so
 * 31 January + 1 month is the last day of February rather than early March.
 */
export function addToDate(today: Date, { amount, unit }: RelativeDate): string {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
  if (unit === "m") {
    // Day 0 of the following month is the last day of the target month.
    const lastDay = new Date(year, month + amount + 1, 0).getDate();
    return formatLocalDate(new Date(year, month + amount, Math.min(day, lastDay)));
  }
  // Calendar arithmetic on local fields, not milliseconds, so a daylight-saving
  // change between today and the target cannot shift the day.
  return formatLocalDate(new Date(year, month, day + amount * (unit === "w" ? 7 : 1)));
}

/** `text` resolved to `YYYY-MM-DD` relative to `today` (the current time by default), or `null` when it is not a relative date. */
export function resolveRelativeDate(text: string, today: Date = new Date()): string | null {
  const offset = parseRelativeDate(text);
  return offset === null ? null : addToDate(today, offset);
}
