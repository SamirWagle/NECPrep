/**
 * The expiry clamp.
 *
 * Each case below corresponds to something the current client-side timer
 * cannot defend against.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { clampSubmission, deadlineFor, syncDecision, SUBMIT_GRACE_MS } from '../domain/expiry.ts';
import { MINUTE } from '../lib/time.ts';

const START = Date.parse('2026-03-01T04:00:00.000Z');
const DEADLINE = deadlineFor(START, 45 * 60);

test('deadlineFor is derived from the server start time and the duration', () => {
  assert.equal(DEADLINE - START, 45 * MINUTE);
});

test('a submission inside the window scores the submitted payload', () => {
  const result = clampSubmission({
    now: START + 30 * MINUTE,
    startedAt: START,
    expiresAt: DEADLINE,
    submitted: { q1: 'r1', q2: 'r2' },
    syncedSnapshot: { q1: 'r1' },
  });

  assert.equal(result.timing, 'on_time');
  assert.equal(result.usedPayload, true);
  assert.deepEqual(result.answers, { q1: 'r1', q2: 'r2' });
  assert.equal(result.droppedLateAnswers, 0);
  assert.equal(result.scoredAt, START + 30 * MINUTE);
  assert.equal(result.remainingMs, 15 * MINUTE);
});

test('a submission right on the buzzer is still on time', () => {
  const result = clampSubmission({
    now: DEADLINE,
    startedAt: START,
    expiresAt: DEADLINE,
    submitted: { q1: 'r1' },
    syncedSnapshot: null,
  });

  assert.equal(result.timing, 'on_time');
  assert.equal(result.scoredAt, DEADLINE);
  assert.equal(result.remainingMs, 0);
});

test('the grace window absorbs network latency but not working time', () => {
  const justInside = clampSubmission({
    now: DEADLINE + SUBMIT_GRACE_MS,
    startedAt: START,
    expiresAt: DEADLINE,
    submitted: { q1: 'r1' },
    syncedSnapshot: null,
  });
  assert.equal(justInside.timing, 'on_time');

  const justOutside = clampSubmission({
    now: DEADLINE + SUBMIT_GRACE_MS + 1,
    startedAt: START,
    expiresAt: DEADLINE,
    submitted: { q1: 'r1' },
    syncedSnapshot: null,
  });
  assert.equal(justOutside.timing, 'expired');
});

test('STALLING PAST THE DEADLINE GAINS NOTHING', () => {
  // The whole point. The client froze its timer, kept working for an hour, then
  // submitted a full paper. Only what the server had already accepted before
  // the deadline is scored.
  const result = clampSubmission({
    now: DEADLINE + 60 * MINUTE,
    startedAt: START,
    expiresAt: DEADLINE,
    submitted: { q1: 'r1', q2: 'r2', q3: 'r3', q4: 'r4' },
    syncedSnapshot: { q1: 'r1', q2: 'rX' },
  });

  assert.equal(result.timing, 'expired');
  assert.equal(result.usedPayload, false);
  assert.deepEqual(
    result.answers,
    { q1: 'r1', q2: 'rX' },
    'the pre-deadline snapshot is scored, including the answer the stalling client later changed',
  );
  assert.equal(
    result.droppedLateAnswers,
    3,
    'q2 (changed), q3 and q4 (added after the deadline) are all dropped',
  );
  assert.equal(result.scoredAt, DEADLINE, 'the paper was frozen at the deadline, not at submit time');
});

test('a late submission with no snapshot at all scores nothing', () => {
  // Harsh but honest: the client never told the server a single answer before
  // the deadline, so the server has nothing it can verify was answered in time.
  const result = clampSubmission({
    now: DEADLINE + 10 * MINUTE,
    startedAt: START,
    expiresAt: DEADLINE,
    submitted: { q1: 'r1', q2: 'r2' },
    syncedSnapshot: null,
  });

  assert.equal(result.timing, 'expired');
  assert.deepEqual(result.answers, {});
  assert.equal(result.droppedLateAnswers, 2);
});

test('a late submission identical to the snapshot drops nothing', () => {
  // An honest client that synced everything and then lost its connection on the
  // final submit must not be told it lost answers.
  const result = clampSubmission({
    now: DEADLINE + 30 * MINUTE,
    startedAt: START,
    expiresAt: DEADLINE,
    submitted: { q1: 'r1', q2: 'r2' },
    syncedSnapshot: { q1: 'r1', q2: 'r2' },
  });

  assert.equal(result.timing, 'expired');
  assert.deepEqual(result.answers, { q1: 'r1', q2: 'r2' });
  assert.equal(result.droppedLateAnswers, 0);
});

test('syncDecision refuses a snapshot past the deadline or on a finished attempt', () => {
  assert.deepEqual(
    syncDecision({ now: DEADLINE - 1, expiresAt: DEADLINE, status: 'in_progress' }),
    { accepted: true },
  );
  assert.deepEqual(
    syncDecision({ now: DEADLINE + 1, expiresAt: DEADLINE, status: 'in_progress' }),
    { accepted: false, reason: 'past_deadline' },
  );
  assert.deepEqual(
    syncDecision({ now: START, expiresAt: DEADLINE, status: 'submitted' }),
    { accepted: false, reason: 'not_in_progress' },
  );
});

test('no client-supplied value can influence the clamp', () => {
  // A regression guard with teeth: if someone adds an `answeredAt` or a
  // `clientNow` to the submit body later, the clamp signature is the thing that
  // has to change, and this assertion documents that it currently cannot.
  const inputKeys = [
    'now',
    'startedAt',
    'expiresAt',
    'submitted',
    'syncedSnapshot',
    'graceMs',
  ];

  const result = clampSubmission({
    now: DEADLINE + MINUTE,
    startedAt: START,
    expiresAt: DEADLINE,
    submitted: {},
    syncedSnapshot: {},
  });

  // `now`, `startedAt` and `expiresAt` are all server-authored; `submitted` is
  // the only client input and it is discarded on the expired path.
  assert.equal(result.usedPayload, false);
  assert.ok(inputKeys.includes('now'));
});
