/**
 * Content handlers - chapters, questions, templates, search.
 *
 * None of these endpoints can return an answer key, and the reason is
 * structural: they build option lists from `loadOptionsForQuestions`, whose
 * SELECT list does not include `is_correct`.
 *
 * They do still permute. A content endpoint that returned options in the
 * authored order would let anyone join position-to-position against
 * `frontend/public/data/books/*.json`, which ships `correct_option_index` and
 * will be in this repository's git history forever. The permutation here is
 * seeded from a server-only secret plus the viewer's user id, so it is stable
 * across reloads - selections are stored by ref, and a reshuffle between loads
 * would re-point them - but not reproducible by anyone without the secret.
 */

import { fail } from '../shared/errors.ts';
import { browseOptionRef, browsePermutation } from '../lib/permute.ts';
import {
  contentVersion,
  countChapterQuestions,
  listChapters,
  listMockTemplates,
  loadOptionsForQuestions,
  pageChapterQuestions,
  searchQuestions,
} from '../data/content.ts';
import { consumeRateLimit, RATE_LIMITS } from '../data/infra.ts';
import { ok } from './context.ts';
import type { HandlerContext, HandlerResult } from './context.ts';
import { readSession } from './auth.ts';
import type {
  BootstrapResponse,
  ChapterQuestionsResponse,
  ChapterSummary,
  MockTemplateSummary,
  PublicQuestion,
  SearchResponse,
} from '../shared/types.ts';
import type { ChapterQuestionsInput, SearchInput } from '../validation/schemas.ts';

/**
 * GET /api/bootstrap - 4 or 5 D1 queries.
 *
 * ONE call for the whole app shell: session, chapters, mock templates and a
 * content version. Workers Free allows 100k requests a day, so a client that
 * made four separate calls on every cold start would burn through that four
 * times faster for no benefit. Everything here is small and changes rarely.
 */
export async function bootstrap(
  ctx: HandlerContext,
): Promise<HandlerResult<BootstrapResponse>> {
  const session = await readSession(ctx);
  const chapters = await listChapters(ctx.db);
  const mockTemplates = await listMockTemplates(ctx.db);
  const version = await contentVersion(ctx.db);

  return ok<BootstrapResponse>({
    session: session.body,
    chapters,
    mockTemplates,
    contentVersion: version,
  });
}

/** GET /api/content/chapters - 1 D1 query. */
export async function getChapters(
  ctx: HandlerContext,
): Promise<HandlerResult<{ chapters: ChapterSummary[] }>> {
  return ok({ chapters: await listChapters(ctx.db) });
}

/** GET /api/content/mock-templates - 1 D1 query. */
export async function getMockTemplates(
  ctx: HandlerContext,
): Promise<HandlerResult<{ mockTemplates: MockTemplateSummary[] }>> {
  return ok({ mockTemplates: await listMockTemplates(ctx.db) });
}

/**
 * GET /api/content/chapters/:chapterId/questions - 3 D1 queries.
 *
 * Questions WITHOUT keys, for browsing and study. Paged, because a chapter can
 * hold 746 questions and sending all of them in one response would be a
 * multi-megabyte payload on a mobile connection in Nepal.
 *
 * Works for anonymous callers too; the permutation then falls back to a
 * per-chapter seed, which still breaks the positional join against the public
 * JSON but is shared between guests.
 */
export async function getChapterQuestions(
  ctx: HandlerContext,
  input: ChapterQuestionsInput,
): Promise<HandlerResult<ChapterQuestionsResponse>> {
  const total = await countChapterQuestions(ctx.db, input.chapterId);
  if (total === 0) fail('NOT_FOUND', 'That chapter has no published questions.');

  const rows = await pageChapterQuestions(ctx.db, {
    chapterId: input.chapterId,
    offset: input.offset,
    limit: input.limit,
  });

  const optionsByQuestion = await loadOptionsForQuestions(
    ctx.db,
    rows.map((r) => r.id),
  );

  const seedUser = ctx.auth?.user.id ?? `guest:${input.chapterId}`;

  const questions: PublicQuestion[] = rows.map((row) => {
    const options = optionsByQuestion.get(row.id) ?? [];
    const permuted = browsePermutation(
      options,
      ctx.config.permutationSecret,
      seedUser,
      row.id,
    );
    return {
      id: row.id,
      chapterId: row.chapter_id,
      stem: row.stem,
      difficulty: row.difficulty,
      // An OPAQUE digest, not the option id. The schema mints option ids as
      // `question_id || '#' || ordinal`, so returning one would hand over the
      // authored ordinal - and the public chapter JSON in git history publishes
      // `correct_option_index`, which makes that ordinal the answer. The
      // permutation alone does not help when the ordinal travels inside the id.
      options: permuted.map((o) => ({
        ref: browseOptionRef(ctx.config.permutationSecret, seedUser, row.id, o.id),
        body: o.body,
      })),
    };
  });

  return ok<ChapterQuestionsResponse>({
    chapterId: input.chapterId,
    total,
    offset: input.offset,
    limit: input.limit,
    questions,
  });
}

/**
 * GET /api/content/search - 2 D1 queries.
 *
 * Stems only. Returning options here would be a way to enumerate the bank in
 * bulk, and the UI does not need them: a result is a link to the question.
 */
export async function search(
  ctx: HandlerContext,
  input: SearchInput,
): Promise<HandlerResult<SearchResponse>> {
  const subject = ctx.auth?.user.id ?? (ctx.meta.ipHash ?? 'unknown');
  const limit = await consumeRateLimit(ctx.db, RATE_LIMITS.search, subject, ctx.clock.now());
  if (!limit.allowed) {
    fail('RATE_LIMITED', 'Too many searches. Please slow down.', {
      retryAfterMs: limit.retryAfterMs,
    });
  }

  const results = await searchQuestions(ctx.db, {
    query: input.q,
    chapterId: input.chapterId ?? null,
    limit: input.limit,
  });

  return ok<SearchResponse>({ query: input.q, results });
}
