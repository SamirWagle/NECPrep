/**
 * Streaks, derived from the `user_daily_activity` rollup.
 *
 * Pure, and day-keyed rather than timestamp-keyed, because a streak is a
 * calendar fact in the candidate's timezone (UTC+05:45 here) and not a
 * difference between two instants. See `lib/time.ts#dayKey`.
 */

import { dayKeyDiff } from '../lib/time.ts';
import type { DayKey, StreakInfo } from '../shared/types.ts';

export interface ActivityDay {
  day: DayKey;
  answered: number;
}

/**
 * `days` must be newest-first, which is the order the query returns.
 *
 * A streak survives "nothing done yet today": if the most recent active day is
 * yesterday, the current streak still counts, because the day is not over. It
 * breaks only once a full day has been skipped.
 */
export function computeStreaks(days: readonly ActivityDay[], today: DayKey): StreakInfo {
  const activeDays = days.map((d) => d.day);
  const todayAnswered = days.find((d) => d.day === today)?.answered ?? 0;

  let currentStreak = 0;
  if (days.length > 0) {
    const gapToNewest = dayKeyDiff(today, days[0].day);
    if (gapToNewest !== null && gapToNewest <= 1) {
      currentStreak = 1;
      for (let i = 1; i < days.length; i++) {
        const gap = dayKeyDiff(days[i - 1].day, days[i].day);
        if (gap !== 1) break;
        currentStreak++;
      }
    }
  }

  let longestStreak = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    if (i === 0) {
      run = 1;
    } else {
      const gap = dayKeyDiff(days[i - 1].day, days[i].day);
      run = gap === 1 ? run + 1 : 1;
    }
    if (run > longestStreak) longestStreak = run;
  }

  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
    todayAnswered,
    activeDays,
  };
}
