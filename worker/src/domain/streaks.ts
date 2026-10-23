/**
 * Streaks, derived from `study_sessions.local_date`.
 *
 * Pure, and day-keyed rather than timestamp-keyed, because a streak is a
 * calendar fact in the candidate's timezone (UTC+05:45 here) and not a
 * difference between two instants. See `lib/time.ts#dayKey`.
 *
 * WHAT THIS IS AND IS NOT THE SOURCE OF. `streaks.current_length` and
 * `.longest_length` are the authority: they are maintained by the idempotent
 * NQ-32a upsert on every answer and ratcheted by a trigger, so they account for
 * the one-day freeze token that a "count consecutive active days" derivation
 * cannot see. This function supplies `activeDays` (the heatmap) and
 * `todayAnswered`, and its streak numbers stand in only when a user has no
 * `streaks` row yet. `handlers/progress.ts` does that merge.
 *
 * It used to read a `user_daily_activity` table that the reconciled schema
 * does not have, for a good reason: a UTC-keyed day bucket misattributes every
 * late-night session in Kathmandu to the wrong day, which is precisely the bug
 * that breaks a streak. `study_sessions.local_date` is written by the API,
 * which knows the user's timezone.
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
