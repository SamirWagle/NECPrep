/**
 * The expiry clamp. Pure, so it is unit-testable against a wound-forward clock
 * rather than a sleep.
 *
 * THE ATTACK IT DEFEATS. In the implementation this replaces, the timer was a
 * client `setInterval` and the deadline lived in localStorage, so pausing the
 * tab, editing the stored `endsAt`, or simply breaking in the debugger bought
 * unlimited time. Moving the countdown display to the server's `expiresAt` is
 * NOT a fix on its own: the display is cosmetic, and a client can always hold
 * its submission back and keep working.
 *
 * THE RULE. A mock answer counts only if the SERVER received it before the
 * deadline. That is the only claim the server can actually verify, so it is the
 * only one the scoring trusts.
 *
 * - While the attempt is live, the client pushes its answer map to
 *   `POST /api/mock/sync`. The UPDATE carries `AND ?now <= expires_at`, so the
 *   stored snapshot is by construction a pre-deadline state.
 * - On `POST /api/mock/submit` inside the grace window, the submitted payload
 *   is scored - the normal path.
 * - On a submission after the grace window, the payload is DISCARDED and the
 *   last stored snapshot is scored instead. Stalling therefore cannot gain a
 *   single mark; it can only lose the answers that were never synced.
 *
 * No client timestamp appears anywhere in this file. There is deliberately no
 * `answeredAt` field on the wire, because a client-asserted answer time is
 * exactly the thing a cheater would forge, and accepting one would reintroduce
 * the hole through a different door.
 */

/**
 * Slack for network latency and client clock skew on an honest submission sent
 * right on the buzzer. Ten seconds is worth roughly two questions of guessing
 * on a 45-minute paper, which is within the noise of the paper itself, and it
 * is short enough that it cannot be used as extra working time.
 */
export const SUBMIT_GRACE_MS = 10_000;

export type SubmissionTiming = 'on_time' | 'expired';

export interface AnswerMap {
  readonly [questionId: string]: string;
}

export interface ClampInput {
  /** Server clock. Never a client-supplied value. */
  now: number;
  startedAt: number;
  /** Server-authored at start and immutable thereafter. */
  expiresAt: number;
  /** The answers in the submit payload. */
  submitted: AnswerMap;
  /** The last snapshot the server accepted strictly before `expiresAt`. */
  syncedSnapshot: AnswerMap | null;
  graceMs?: number;
}

export interface ClampResult {
  timing: SubmissionTiming;
  /** The answers that will actually be scored. */
  answers: AnswerMap;
  /** `min(now, expiresAt)` - the instant the paper was frozen. */
  scoredAt: number;
  /** Entries in `submitted` that the clamp refused to honour. */
  droppedLateAnswers: number;
  /** Whether the payload was scored (false means the snapshot was). */
  usedPayload: boolean;
  remainingMs: number;
}

export function clampSubmission(input: ClampInput): ClampResult {
  const grace = input.graceMs ?? SUBMIT_GRACE_MS;
  const scoredAt = Math.min(input.now, input.expiresAt);
  const remainingMs = Math.max(0, input.expiresAt - input.now);
  const onTime = input.now <= input.expiresAt + grace;

  if (onTime) {
    return {
      timing: 'on_time',
      answers: input.submitted,
      scoredAt,
      droppedLateAnswers: 0,
      usedPayload: true,
      remainingMs,
    };
  }

  const snapshot = input.syncedSnapshot ?? {};

  // Count what the clamp cost the candidate, so the result screen can say so
  // rather than silently showing a lower score than they expected. An entry is
  // "dropped" when the payload carries a selection the pre-deadline snapshot
  // does not already agree with.
  let dropped = 0;
  for (const questionId of Object.keys(input.submitted)) {
    if (snapshot[questionId] !== input.submitted[questionId]) dropped++;
  }

  return {
    timing: 'expired',
    answers: snapshot,
    scoredAt,
    droppedLateAnswers: dropped,
    usedPayload: false,
    remainingMs: 0,
  };
}

/**
 * Whether a sync may be stored. The same predicate is ALSO expressed as a WHERE
 * clause on the UPDATE (see `data/mock.ts`), so a race between this check and
 * the write cannot let a post-deadline snapshot through. This copy exists to
 * give the endpoint an honest `reason` to report.
 */
export function syncDecision(args: {
  now: number;
  expiresAt: number;
  status: string;
}): { accepted: boolean; reason?: 'past_deadline' | 'not_in_progress' } {
  if (args.status !== 'in_progress') return { accepted: false, reason: 'not_in_progress' };
  if (args.now > args.expiresAt) return { accepted: false, reason: 'past_deadline' };
  return { accepted: true };
}

/** The deadline for an attempt started now. Server-side only. */
export function deadlineFor(startedAt: number, durationSeconds: number): number {
  return startedAt + durationSeconds * 1000;
}
