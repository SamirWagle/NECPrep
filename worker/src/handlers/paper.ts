/**
 * Turning a stored paper into a client payload.
 *
 * The one place that assembles option lists for an attempt, and the reason the
 * assembly is centralised: it reads `optionOrder` (real option ids, server-side
 * only) and emits ONLY a derived ref per option. An option id never reaches a
 * client.
 *
 * That matters less than it used to, and the reason is worth knowing. Option
 * ids used to be `question_id || '#' || ordinal`, so an id in a payload WAS the
 * answer key for any question in the public JSON bank -- and this layer was the
 * only thing standing between the two. `migrations/0002_content.sql` now mints
 * ids with a CSPRNG `opt_key`, so the leak is closed at the root. The refs stay
 * because they still buy something real: a ref is per attempt, so one captured
 * paper teaches nothing about another, and a ref carries no stable handle a
 * client could accumulate across sessions.
 */

import { attemptOptionRef, cryptoShuffle, permuteOptions } from '../lib/permute.ts';
import type { OptionRow } from '../lib/permute.ts';
import type { PaperRowInput, StoredPaperRow } from '../data/attempts.ts';
import type { PaperQuestion } from '../domain/scoring.ts';
import type { AttemptQuestion, PublicOption } from '../shared/types.ts';

/** A stored paper row with this attempt's refs attached. */
export interface DeliverablePaperRow extends PaperQuestion {
  stem: string;
  explanation: string | null;
}

/**
 * Builds the per-attempt option permutation for each pick.
 *
 * The permutation is a CSPRNG shuffle and it is PERSISTED, so a reload reads it
 * back rather than recomputing it -- which is what lets the refs be derived
 * from the stored order rather than stored alongside it.
 *
 * Options flagged `question_options.is_pinned` ('All of the above' and friends,
 * 450 of them in the bank, every one authored in slot 4) are held at the end.
 * Shuffling one into the middle makes the question nonsense, and the flag is
 * the schema's rather than a regex over the text, so a mis-detected option is a
 * data fix and not a deploy.
 */
export function buildAttemptPaper(
  picks: ReadonlyArray<{ questionId: string; position: number }>,
  optionsByQuestion: ReadonlyMap<string, OptionRow[]>,
): PaperRowInput[] {
  const out: PaperRowInput[] = [];

  for (const pick of picks) {
    const options = optionsByQuestion.get(pick.questionId);
    // A question with fewer than two options cannot be answered. Dropping it
    // here keeps it off the paper rather than letting it be auto-wrong.
    if (!options || options.length < 2) continue;

    const permuted = permuteOptions(options, cryptoShuffle);
    out.push({
      questionId: pick.questionId,
      position: out.length + 1,
      optionOrder: permuted.map((o) => o.id),
    });
  }

  return out;
}

export interface RefContext {
  /** `CONTENT_PERMUTATION_SECRET`. Server-only, and the key of the digest. */
  secret: string;
  /** `attempts.option_seed`. CSPRNG per attempt. */
  optionSeed: number;
  /** `attempts.public_id`. */
  attemptPublicId: string;
}

/**
 * Derives this attempt's refs for a stored paper. No database access, no
 * storage: see `lib/permute.ts#attemptOptionRef` for why they are computed
 * rather than kept.
 */
export function attachRefs(
  rows: readonly StoredPaperRow[],
  ctx: RefContext,
): DeliverablePaperRow[] {
  return rows.map((row) => ({
    questionId: row.questionId,
    chapterId: row.chapterId,
    position: row.position,
    optionOrder: row.optionOrder,
    optionRefs: row.optionOrder.map((optionId) =>
      attemptOptionRef(ctx.secret, ctx.optionSeed, ctx.attemptPublicId, optionId),
    ),
    stem: row.stem,
    explanation: row.explanation,
  }));
}

/** The same derivation for a single stored question. */
export function attachRefsToOne<T extends { optionOrder: string[] }>(
  row: T,
  ctx: RefContext,
): T & { optionRefs: string[] } {
  return {
    ...row,
    optionRefs: row.optionOrder.map((optionId) =>
      attemptOptionRef(ctx.secret, ctx.optionSeed, ctx.attemptPublicId, optionId),
    ),
  };
}

/** Option bodies in the stored permuted order, labelled only by ref. */
export function publicOptionsFor(
  paper: PaperQuestion,
  bodies: ReadonlyMap<string, string>,
): PublicOption[] {
  const out: PublicOption[] = [];
  for (let i = 0; i < paper.optionOrder.length; i++) {
    const body = bodies.get(paper.optionOrder[i]);
    const ref = paper.optionRefs[i];
    // Skip an option whose row has gone, rather than emitting a blank choice.
    if (body === undefined || ref === undefined) continue;
    out.push({ ref, body });
  }
  return out;
}

/**
 * `optionId -> body` across several questions.
 *
 * Built from `loadOptionsForQuestions`, which reads a table with no answer
 * column, so this map cannot carry a key even in principle.
 */
export function bodyIndex(
  optionsByQuestion: ReadonlyMap<string, OptionRow[]>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const options of optionsByQuestion.values()) {
    for (const option of options) out.set(option.id, option.body);
  }
  return out;
}

export function toAttemptQuestions(
  paper: readonly DeliverablePaperRow[],
  optionsByQuestion: ReadonlyMap<string, OptionRow[]>,
): AttemptQuestion[] {
  const bodies = bodyIndex(optionsByQuestion);
  return paper.map((row) => ({
    questionId: row.questionId,
    chapterId: row.chapterId,
    position: row.position,
    stem: row.stem,
    options: publicOptionsFor(row, bodies),
  }));
}
