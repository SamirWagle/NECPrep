/**
 * Progress, bookmarks and spaced repetition.
 *
 * All read-scoped by `userId` in the SQL, never filtered in TypeScript after
 * the fact. D1 has no row-level security; a `WHERE user_id = ?` that is missing
 * is a data breach, not a bug, so the data layer takes the id as a required
 * argument and there is no overload that omits it.
 */

import { fail } from '../shared/errors.ts';
import { dayKey } from '../lib/time.ts';
import { computeStreaks } from '../domain/streaks.ts';
import { loadOptionsForQuestions, loadQuestionStems } from '../data/content.ts';
import { readAttemptHistory } from '../data/attempts.ts';
import {
  applySrsReview,
  countBookmarks,
  isBookmarked,
  listBookmarks,
  readActivityDays,
  readDueCards,
  readProgressStats,
  readStreak,
  setBookmark,
} from '../data/progress.ts';
import { browseOptionRef, browsePermutation } from '../lib/permute.ts';
import { ok, requireUser } from './context.ts';
import type { HandlerContext, HandlerResult } from './context.ts';
import type {
  AttemptHistoryItem,
  AttemptHistoryResponse,
  AttemptStatus,
  BookmarkListResponse,
  BookmarkSetResponse,
  ProgressOverview,
  SrsDueResponse,
  SrsReviewResponse,
} from '../shared/types.ts';
import type {
  BookmarkSetInput,
  HistoryInput,
  SrsDueInput,
  SrsReviewInput,
} from '../validation/schemas.ts';

function toAttemptStatus(raw: string): AttemptStatus {
  switch (raw) {
    case 'in_progress':
    case 'submitted':
    case 'expired':
    case 'abandoned':
      return raw;
    default:
      return 'abandoned';
  }
}

/**
 * GET /api/progress/overview - 4 D1 queries.
 *
 * ONE call for the whole dashboard: chapter stats, streaks and recent attempts.
 * The previous client computed all of this by reading every chapter's JSON and
 * walking localStorage; this is four indexed queries over rollup tables.
 *
 * STREAKS COME FROM `streaks`, NOT FROM COUNTING DAYS. `current_length` and
 * `longest_length` are maintained by the idempotent NQ-32a upsert on every
 * answer and ratcheted by a trigger, so they already account for the
 * freeze-token grace that a naive "count consecutive active days" derivation
 * cannot see. `computeStreaks` over `study_sessions.local_date` still runs, for
 * the heatmap and for today's count -- and as a cross-check: if the two
 * disagree the stored row wins, because it is the one that saw every answer as
 * it happened rather than reconstructing them from a 400-day window.
 */
export async function getProgressOverview(
  ctx: HandlerContext,
): Promise<HandlerResult<ProgressOverview>> {
  const auth = requireUser(ctx);
  const now = ctx.clock.now();

  const stats = await readProgressStats(ctx.db, auth.user.id);
  const days = await readActivityDays(ctx.db, auth.user.id);
  const stored = await readStreak(ctx.db, auth.user.id);
  const history = await readAttemptHistory(ctx.db, {
    userId: auth.user.id,
    limit: 10,
    beforeStartedAt: null,
  });

  const recent: AttemptHistoryItem[] = history.map((row) => ({
    kind: row.kind,
    id: row.id,
    label: row.label,
    score: row.score,
    total: row.total,
    accuracyPct: row.total === 0 ? 0 : Math.round((row.score / row.total) * 100),
    at: row.at,
    status: toAttemptStatus(row.status),
  }));

  const derived = computeStreaks(days, dayKey(now));

  return ok<ProgressOverview>({
    stats,
    streak: {
      ...derived,
      currentStreak: stored?.current_length ?? derived.currentStreak,
      longestStreak: stored?.longest_length ?? derived.longestStreak,
    },
    recent,
  });
}

/** GET /api/progress/history - 1 D1 query. Cursor-paged. */
export async function getAttemptHistory(
  ctx: HandlerContext,
  input: HistoryInput,
): Promise<HandlerResult<AttemptHistoryResponse>> {
  const auth = requireUser(ctx);

  // The cursor is the `started_at` of the last row seen. Opaque to the client
  // by convention, and validated as a token, so a malformed cursor is a 400
  // rather than a NaN that silently pages from the beginning.
  let before: number | null = null;
  if (input.cursor !== undefined) {
    const parsed = Number.parseInt(input.cursor, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      fail('BAD_REQUEST', 'Invalid cursor.', { fields: { cursor: 'Malformed.' } });
    }
    before = parsed;
  }

  const rows = await readAttemptHistory(ctx.db, {
    userId: auth.user.id,
    limit: input.limit,
    beforeStartedAt: before,
  });

  const items: AttemptHistoryItem[] = rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    label: row.label,
    score: row.score,
    total: row.total,
    accuracyPct: row.total === 0 ? 0 : Math.round((row.score / row.total) * 100),
    at: row.at,
    status: toAttemptStatus(row.status),
  }));

  return ok<AttemptHistoryResponse>({
    items,
    nextCursor:
      items.length === input.limit ? String(items[items.length - 1].at) : null,
  });
}

// --- Bookmarks --------------------------------------------------------------

/** GET /api/bookmarks - 1 D1 query. */
export async function getBookmarks(
  ctx: HandlerContext,
): Promise<HandlerResult<BookmarkListResponse>> {
  const auth = requireUser(ctx);
  return ok<BookmarkListResponse>({ items: await listBookmarks(ctx.db, auth.user.id) });
}

/**
 * PUT /api/bookmarks - 3 D1 queries.
 *
 * Expressed as a desired end state (`desired: true | false`) rather than as
 * add/remove verbs, which is what makes it replay-safe: `INSERT ... ON CONFLICT
 * DO NOTHING` and a `DELETE` of a missing row both converge, so the offline
 * outbox can replay the same entry any number of times. An idempotency key is
 * accepted but not required, and the handler ignores it when absent rather than
 * refusing the request.
 */
export async function putBookmark(
  ctx: HandlerContext,
  input: BookmarkSetInput,
): Promise<HandlerResult<BookmarkSetResponse>> {
  const auth = requireUser(ctx);
  const now = ctx.clock.now();

  await setBookmark(ctx.db, {
    userId: auth.user.id,
    questionId: input.questionId,
    desired: input.desired,
    now,
  });

  // Read back rather than trusting the request: adding a bookmark for an
  // unpublished question is a silent no-op in the SQL, and the client must be
  // told the truth about the resulting state.
  const bookmarked = await isBookmarked(ctx.db, auth.user.id, input.questionId);
  const total = await countBookmarks(ctx.db, auth.user.id);

  return ok<BookmarkSetResponse>({
    questionId: input.questionId,
    bookmarked,
    total,
  });
}

// --- Spaced repetition ------------------------------------------------------

/**
 * GET /api/srs/due - 3 D1 queries.
 *
 * The due queue with question payloads, so starting a review session is one
 * round trip. Options are permuted with the stable browse permutation and
 * carry no key.
 */
export async function getSrsDue(
  ctx: HandlerContext,
  input: SrsDueInput,
): Promise<HandlerResult<SrsDueResponse>> {
  const auth = requireUser(ctx);
  const now = ctx.clock.now();

  const cards = await readDueCards(ctx.db, {
    userId: auth.user.id,
    now,
    limit: input.limit,
  });

  if (cards.length === 0) {
    return ok<SrsDueResponse>({ serverNow: now, dueCount: 0, questions: [], cards: {} });
  }

  const questionIds = cards.map((c) => c.questionId);
  const stems = await loadQuestionStems(ctx.db, questionIds);
  const optionsByQuestion = await loadOptionsForQuestions(ctx.db, questionIds);

  const stemById = new Map(stems.map((s) => [s.id, s]));
  const cardMap: Record<string, (typeof cards)[number]> = {};
  for (const card of cards) cardMap[card.questionId] = card;

  return ok<SrsDueResponse>({
    serverNow: now,
    dueCount: cards.length,
    questions: cards
      .map((card, index) => {
        const stem = stemById.get(card.questionId);
        if (!stem) return null;
        const permuted = browsePermutation(
          optionsByQuestion.get(card.questionId) ?? [],
          ctx.config.permutationSecret,
          auth.user.id,
          card.questionId,
        );
        return {
          questionId: card.questionId,
          chapterId: stem.chapter_id,
          position: index + 1,
          stem: stem.stem,
          // Opaque, for the same reason as the chapter-browsing payload: an
          // option id carries its authored ordinal, and the published JSON
          // turns that ordinal into the key.
          options: permuted.map((o) => ({
            ref: browseOptionRef(
              ctx.config.permutationSecret,
              auth.user.id,
              card.questionId,
              o.id,
            ),
            body: o.body,
          })),
        };
      })
      .filter((q): q is NonNullable<typeof q> => q !== null),
    cards: cardMap,
  });
}

/**
 * POST /api/srs/review - 3 or 4 D1 queries.
 *
 * Idempotent through the `revision` field rather than through a key: the write
 * carries `AND revision = ?expected`, so a replayed outbox entry whose revision
 * the server has already moved past changes nothing and comes back with
 * `applied: false` and the current card. That is strictly better than a key
 * here, because it also makes a stale review from a second device a no-op
 * instead of a conflict.
 */
export async function reviewSrsCard(
  ctx: HandlerContext,
  input: SrsReviewInput,
): Promise<HandlerResult<SrsReviewResponse>> {
  const auth = requireUser(ctx);
  const now = ctx.clock.now();

  const stems = await loadQuestionStems(ctx.db, [input.questionId]);
  if (stems.length === 0) fail('NOT_FOUND', 'That question does not exist.');

  const outcome = await applySrsReview(ctx.db, {
    userId: auth.user.id,
    questionId: input.questionId,
    grade: input.grade,
    expectedRevision: input.revision,
    now,
  });

  if (!outcome) fail('CONFLICT', 'That card could not be reviewed.');

  return ok<SrsReviewResponse>({ card: outcome.card, applied: outcome.applied });
}
