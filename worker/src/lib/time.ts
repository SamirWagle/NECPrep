/**
 * Server time.
 *
 * Every timestamp this API stores or compares comes from a `Clock`. Nothing
 * reads `Date.now()` directly outside this module, which is what lets the
 * expiry tests drive the deadline deterministically instead of sleeping.
 */

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** A clock the tests can wind forward by hand. */
export function fixedClock(start: number): Clock & { set(t: number): void; advance(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    set: (next: number) => {
      t = next;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * Nepal Standard Time, UTC+05:45. Streaks and the daily activity rollup are
 * bucketed in the candidate's local day, not UTC, or a 9pm study session in
 * Kathmandu would land on the next UTC day and break the streak.
 */
export const ACTIVITY_TZ_OFFSET_MINUTES = 345;

/** `YYYY-MM-DD` in the activity timezone. */
export function dayKey(epochMs: number, offsetMinutes = ACTIVITY_TZ_OFFSET_MINUTES): string {
  const shifted = new Date(epochMs + offsetMinutes * MINUTE);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days between two `YYYY-MM-DD` keys. `null` if either is malformed. */
export function dayKeyDiff(later: string, earlier: string): number | null {
  const a = Date.parse(`${later}T00:00:00Z`);
  const b = Date.parse(`${earlier}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / DAY);
}
