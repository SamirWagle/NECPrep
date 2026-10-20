/**
 * Paper selection. Pure, so the picking policy is testable without a database.
 *
 * The blueprint is SERVER data: the client names a template id and nothing
 * else. It cannot ask for a shorter paper, for questions from one easy chapter,
 * or for a specific question it has already seen the answer to.
 */

export interface BlueprintRow {
  chapterId: string;
  questionCount: number;
}

export interface ChapterPool {
  chapterId: string;
  /** Ids of published questions in this chapter, in any order. */
  questionIds: readonly string[];
}

export interface PaperPick {
  questionId: string;
  chapterId: string;
  /** 1-based position on the assembled paper. */
  position: number;
}

export interface PaperShortfall {
  chapterId: string;
  requested: number;
  available: number;
}

export interface SelectedPaper {
  picks: PaperPick[];
  shortfalls: PaperShortfall[];
  requestedTotal: number;
}

/**
 * Draws the blueprint's quota from each chapter, then shuffles the whole paper
 * so chapters are interleaved.
 *
 * A chapter that cannot fill its quota contributes what it has and is recorded
 * in `shortfalls`. This matches what the app does today (`loadQuestionsSlice`
 * takes `min(count, available)`): chapters 5, 6, 7 and 9 hold only 64-71
 * questions each, so a hard failure here would take every mock test offline for
 * a content gap in one chapter. The caller refuses only a completely empty
 * paper, and the attempt records the ACTUAL question count so scoring is never
 * out of a number the paper did not contain.
 *
 * `shuffle` is injected so the tests can make selection deterministic; in
 * production it is `cryptoShuffle`.
 */
export function selectPaper(args: {
  blueprint: readonly BlueprintRow[];
  pools: readonly ChapterPool[];
  shuffle: <T>(xs: readonly T[]) => T[];
}): SelectedPaper {
  const poolByChapter = new Map<string, readonly string[]>();
  for (const pool of args.pools) poolByChapter.set(pool.chapterId, pool.questionIds);

  const drawn: Array<{ questionId: string; chapterId: string }> = [];
  const shortfalls: PaperShortfall[] = [];
  let requestedTotal = 0;

  for (const row of args.blueprint) {
    if (row.questionCount <= 0) continue;
    requestedTotal += row.questionCount;

    const pool = poolByChapter.get(row.chapterId) ?? [];
    const take = Math.min(row.questionCount, pool.length);
    if (take < row.questionCount) {
      shortfalls.push({
        chapterId: row.chapterId,
        requested: row.questionCount,
        available: pool.length,
      });
    }
    for (const questionId of args.shuffle(pool).slice(0, take)) {
      drawn.push({ questionId, chapterId: row.chapterId });
    }
  }

  const picks = args.shuffle(drawn).map((pick, index) => ({
    questionId: pick.questionId,
    chapterId: pick.chapterId,
    position: index + 1,
  }));

  return { picks, shortfalls, requestedTotal };
}
