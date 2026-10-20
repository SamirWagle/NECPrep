/**
 * Turning a stored paper into a client payload.
 *
 * The one place that assembles option lists for an attempt, and the reason the
 * assembly is centralised: it reads `optionOrder` (real option ids, server-side
 * only) and `optionRefs` (opaque per-attempt tokens) in parallel and emits ONLY
 * the refs. An option id never reaches a client, so there is nothing to join
 * against the option ordering in the public chapter JSON in git history, and a
 * ref captured from one attempt means nothing in another.
 */

import { newOptionRef } from '../lib/ids.ts';
import { cryptoShuffle, permuteOptions } from '../lib/permute.ts';
import type { OptionRow } from '../lib/permute.ts';
import type { PaperQuestion } from '../domain/scoring.ts';
import type { AttemptQuestion, PublicOption } from '../shared/types.ts';

export interface StoredPaperRow extends PaperQuestion {
  stem: string;
  explanation: string | null;
}

/**
 * Builds the per-attempt permutation and the opaque refs for one question.
 *
 * Both are minted here, at start time, and stored on the attempt row. The
 * permutation is a CSPRNG shuffle rather than a seeded one because there is
 * nothing to be gained from reproducibility: the order is persisted, so a
 * reload reads it back rather than recomputing it.
 */
export function buildAttemptPaper(
  picks: ReadonlyArray<{ questionId: string; chapterId: string; position: number }>,
  optionsByQuestion: ReadonlyMap<string, OptionRow[]>,
): PaperQuestion[] {
  const out: PaperQuestion[] = [];

  for (const pick of picks) {
    const options = optionsByQuestion.get(pick.questionId);
    // A question with fewer than two options cannot be answered. Dropping it
    // here keeps it off the paper rather than letting it be auto-wrong.
    if (!options || options.length < 2) continue;

    const permuted = permuteOptions(options, cryptoShuffle);
    out.push({
      questionId: pick.questionId,
      chapterId: pick.chapterId,
      position: out.length + 1,
      optionOrder: permuted.map((o) => o.id),
      optionRefs: permuted.map(() => newOptionRef()),
    });
  }

  return out;
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

/** `optionId -> body` across several questions. Never carries `is_correct`. */
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
  paper: readonly StoredPaperRow[],
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
