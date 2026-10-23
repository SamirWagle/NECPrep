/**
 * Paper selection. Pure, so the picking policy is testable without a database.
 *
 * The blueprint is SERVER data: the client names a template id and nothing
 * else. It cannot ask for a shorter paper, for questions from one easy chapter,
 * or for a specific question it has already seen the answer to.
 *
 * ===========================================================================
 * THE BLUEPRINT IS SUB-CHAPTER LEVEL
 * ===========================================================================
 *
 * The official NEC syllabus for Computer Engineering publishes 10 chapters of
 * exactly 6 sub-chapters each -- 60 codes -- and
 * `frontend/src/data/examBlueprint.ts` already models a 100-question paper at
 * that granularity under a documented rule
 * (`equal-chapter-weight-largest-remainder`: 10 per chapter, split 2/2/2/2/1/1
 * across its six codes). This module used to allocate per CHAPTER, which
 * matched neither the syllabus nor the client. It now takes the 60 rules the
 * template stores and spends them, with the SAME two-pass fallback the frontend
 * planner uses:
 *
 *   pass 1  satisfy each rule from questions actually TAGGED with its
 *           sub-chapter, in full, before any fallback -- so the result does not
 *           depend on rule iteration order;
 *   pass 2  top up each rule's deficit from its chapter's pool, and record the
 *           rule as APPROXIMATED.
 *
 * Pass 1 draws for real as of migration 0009. The source JSON has no syllabus
 * field, so `questions.subchapter_id` was NULL for all 2,290 imported
 * questions and every rule was approximated -- the paper was chapter-level in
 * all but name. The importer now classifies each question with the
 * deterministic term-matching classifier the app uses, which labels about two
 * thirds of the bank and declines the rest, and all 60 sub-chapters are
 * populated well enough that every rule of all three shipped templates is
 * satisfied from pass 1 alone.
 *
 * Two things follow, and neither is a detail:
 *
 *   * Those labels are HEURISTIC. `questions.subchapter_source` says so, and a
 *     paper built from them is only as well-balanced as the classifier is
 *     accurate. This planner does not read `subchapter_source` -- requiring
 *     human labels would empty pass 1 again -- so if that policy is ever
 *     wanted, it belongs in `drawBlueprintPools`, not here.
 *   * The decline rate is not a shortfall. A declined question keeps its
 *     chapter, so it stays available to pass 2 exactly as before.
 *
 * `approximatedSubchapterCodes` still reports whatever pass 2 has to cover, so
 * a term-list regression that empties a sub-chapter shows up as approximation
 * rather than as a silently worse paper.
 *
 * A chapter that cannot fill its quota contributes what it has and is recorded
 * in `shortfalls`. This matches what the app does today
 * (`loadQuestionsSlice` takes `min(count, available)`): chapters 5, 6, 7 and 9
 * hold only 64-71 questions each, so a hard failure here would take every mock
 * test offline for a content gap in one chapter. The caller refuses only a
 * completely empty paper, and the attempt records the ACTUAL question count so
 * scoring is never out of a number the paper did not contain.
 */

export interface BlueprintRule {
  chapterId: string;
  /** Official NEC syllabus code, e.g. '1.1'. `null` for a chapter-wide rule. */
  subchapterCode: string | null;
  questionCount: number;
}

/** Published questions carrying a given sub-chapter tag. Empty today. */
export interface SubchapterPool {
  subchapterCode: string;
  questionIds: readonly string[];
}

/** Published questions in a chapter, for the fallback top-up. */
export interface ChapterPool {
  chapterId: string;
  /** Ids of published questions in this chapter, in any order. */
  questionIds: readonly string[];
}

export interface PaperPick {
  questionId: string;
  chapterId: string;
  /** The rule this pick was drawn for, or `null` for a chapter-wide rule. */
  subchapterCode: string | null;
  /** `true` when it came from the chapter pool rather than a tagged question. */
  approximated: boolean;
  /** 1-based position on the assembled paper. */
  position: number;
}

export interface PaperShortfall {
  chapterId: string;
  subchapterCode: string | null;
  requested: number;
  /** Tagged questions available for this rule. */
  availableTagged: number;
  /** What the rule actually raised, tagged plus fallback. */
  planned: number;
}

export interface SelectedPaper {
  picks: PaperPick[];
  shortfalls: PaperShortfall[];
  requestedTotal: number;
  /** Rules whose quota was partly or wholly satisfied at chapter level. */
  approximatedSubchapterCodes: string[];
}

/**
 * Draws each rule's quota, then shuffles the whole paper so chapters and
 * sub-chapters are interleaved.
 *
 * `shuffle` is injected so the tests can make selection deterministic; in
 * production it is `cryptoShuffle`.
 *
 * `strictSubchapter` disables the chapter-level fallback entirely, which turns
 * an untagged bank into 60 shortfalls. It exists so the flag in the stored
 * blueprint means something; it must stay false until tagging coverage is real.
 */
export function selectPaper(args: {
  blueprint: readonly BlueprintRule[];
  subchapterPools: readonly SubchapterPool[];
  chapterPools: readonly ChapterPool[];
  shuffle: <T>(xs: readonly T[]) => T[];
  strictSubchapter?: boolean;
}): SelectedPaper {
  const strict = args.strictSubchapter ?? false;

  const taggedByCode = new Map<string, readonly string[]>();
  for (const pool of args.subchapterPools) {
    taggedByCode.set(pool.subchapterCode, pool.questionIds);
  }

  // Shuffled once per chapter, then consumed with a cursor, so two rules for
  // the same chapter cannot be handed the same question.
  const chapterQueue = new Map<string, string[]>();
  for (const pool of args.chapterPools) {
    chapterQueue.set(pool.chapterId, args.shuffle(pool.questionIds));
  }

  /** Every question already on the paper, so the two pools cannot overlap. */
  const taken = new Set<string>();

  const drawn: Array<Omit<PaperPick, 'position'>> = [];
  const shortfalls: PaperShortfall[] = [];
  const approximatedSubchapterCodes: string[] = [];
  let requestedTotal = 0;

  // ---- pass 1: tagged questions, in full, for every rule ------------------
  const fromTagged: number[] = [];
  args.blueprint.forEach((rule, ruleIndex) => {
    fromTagged[ruleIndex] = 0;
    if (rule.questionCount <= 0 || rule.subchapterCode === null) return;
    const pool = taggedByCode.get(rule.subchapterCode) ?? [];
    for (const questionId of args.shuffle(pool)) {
      if (fromTagged[ruleIndex] >= rule.questionCount) break;
      if (taken.has(questionId)) continue;
      taken.add(questionId);
      drawn.push({
        questionId,
        chapterId: rule.chapterId,
        subchapterCode: rule.subchapterCode,
        approximated: false,
      });
      fromTagged[ruleIndex]++;
    }
  });

  // ---- pass 2: top up each deficit from the chapter pool ------------------
  args.blueprint.forEach((rule, ruleIndex) => {
    if (rule.questionCount <= 0) return;
    requestedTotal += rule.questionCount;

    const tagged = fromTagged[ruleIndex] ?? 0;
    const availableTagged =
      rule.subchapterCode === null ? 0 : (taggedByCode.get(rule.subchapterCode) ?? []).length;
    let deficit = rule.questionCount - tagged;
    let fallback = 0;

    if (deficit > 0 && !strict) {
      const queue = chapterQueue.get(rule.chapterId) ?? [];
      while (deficit > 0 && queue.length > 0) {
        const questionId = queue.pop() as string;
        if (taken.has(questionId)) continue;
        taken.add(questionId);
        drawn.push({
          questionId,
          chapterId: rule.chapterId,
          subchapterCode: rule.subchapterCode,
          approximated: true,
        });
        fallback++;
        deficit--;
      }
    }

    if (fallback > 0 && rule.subchapterCode !== null) {
      approximatedSubchapterCodes.push(rule.subchapterCode);
    }

    const planned = tagged + fallback;
    if (planned < rule.questionCount) {
      shortfalls.push({
        chapterId: rule.chapterId,
        subchapterCode: rule.subchapterCode,
        requested: rule.questionCount,
        availableTagged,
        planned,
      });
    }
  });

  const picks = args.shuffle(drawn).map((pick, index) => ({
    ...pick,
    position: index + 1,
  }));

  return { picks, shortfalls, requestedTotal, approximatedSubchapterCodes };
}
