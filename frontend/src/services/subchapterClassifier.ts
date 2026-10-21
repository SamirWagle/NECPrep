/**
 * Deterministic, offline sub-chapter classification.
 *
 * Given a question and the chapter it is already known to belong to, decide
 * which of that chapter's six sub-chapters it tests — or decline.
 *
 * DESIGN
 * ------
 * The chapter is a fact (it comes from which file the question shipped in), so
 * this is a 1-of-6 decision, never 1-of-60. Within a chapter the six
 * sub-chapters are deliberately disjoint topics, so discriminating vocabulary
 * is enough; see `data/subchapterTerms.ts` for the term lists and why they are
 * weighted.
 *
 * Scoring is a sum over DISTINCT matched terms — a stem that says "pointer"
 * six times scores once. The stem carries full weight and the options carry
 * half, because distractors are routinely drawn from neighbouring topics: a
 * question about `malloc` may well list `fopen` as a wrong answer, and letting
 * options count fully would pull it towards the wrong sub-chapter.
 *
 * REFUSAL IS THE POINT
 * --------------------
 * Two guards must both pass before a label is returned:
 *
 *   - `MIN_SCORE` — the winner needs real evidence, not one weak term.
 *   - `MIN_MARGIN` — the winner must beat the runner-up by a clear margin.
 *
 * A question matching both `tcp` and `subnet` is genuinely ambiguous between
 * 5.3 and 5.4 on vocabulary alone, and the honest answer is "chapter 5". That
 * is why `classify` returns `null` rather than a low-confidence guess:
 * callers cannot accidentally render a coin flip as a syllabus reference.
 *
 * `confidence` is reported in basis points so it can be stored in D1's INTEGER
 * columns without floats, matching `generator_confidence_bp` on `explanations`.
 */

import {
  getChapterByBookChapterId,
  getChapterByCode,
  type SubchapterCode,
} from '../data/syllabus';
import { SUBCHAPTER_TERMS } from '../data/subchapterTerms';

/**
 * Identifies the term lists AND the thresholds that produced a label.
 *
 * Stored in `questions.subchapter_classifier_version`, so a change here makes
 * every stale heuristic label findable with one query. Bump it whenever a term
 * list or a threshold changes in a way that could move a decision — which is
 * any change at all to this file or to `data/subchapterTerms.ts`.
 */
export const CLASSIFIER_VERSION = 'subchapter-terms-v1';

/** Weight of one distinct matched `strong` term. */
const STRONG_WEIGHT = 3;
/** Weight of one distinct matched `weak` term. */
const WEAK_WEIGHT = 1;
/** Options count for half, since distractors borrow neighbouring vocabulary. */
const OPTION_WEIGHT = 0.5;
/**
 * Minimum winning score. 3 = one strong term, or three weak ones in the stem.
 * Below this the match is noise.
 */
const MIN_SCORE = 3;
/**
 * The winner must exceed the runner-up by this much. Set to 2 so that one
 * extra weak term is not enough to break a tie between two sub-chapters that
 * both matched a strong term — that case is a genuine ambiguity.
 */
const MIN_MARGIN = 2;

export interface SubchapterMatch {
  readonly code: SubchapterCode;
  /** Human-facing dotted code, e.g. `'5.4'`. */
  readonly displayCode: string;
  readonly title: string;
  /** Confidence in basis points, 0-10000. */
  readonly confidenceBp: number;
  /** The distinct terms that drove the decision, strongest first. */
  readonly matchedTerms: readonly string[];
}

/**
 * The chapter must be identified, by either id. The frontend knows questions
 * by the `book-chN` file they shipped in; the importer and the Worker know
 * them by the official NEC chapter code. Pass whichever you have — if both
 * are given, `chapterCode` wins, being the canonical one.
 */
export interface ClassifierInput {
  /** The `book-chN` id the question shipped under, e.g. `'book-ch5'`. */
  readonly bookChapterId?: string;
  /** The official NEC chapter code, e.g. `'ACtE05'`. */
  readonly chapterCode?: string;
  readonly question: string;
  readonly options: readonly string[];
}

/* ------------------------------------------------------------------ *
 * Term matching.
 * ------------------------------------------------------------------ */

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * A word-boundary matcher for one term.
 *
 * `\b` is only asserted on an end that is actually a word character. Several
 * terms are not word-bounded — `main()`, `vector<`, `a*`, `i/o` — and wrapping
 * those in `\b` would either never match or match in the wrong place.
 *
 * PLURALS
 * -------
 * Every word in a term may carry an optional trailing `s` or `es`, so the term
 * `requirement elicitation` matches "Requirements elicitation" and `pointer`
 * matches "pointers". Without this, a `\b` sitting immediately before the `s`
 * fails, and measuring the bank showed that single detail suppressing a large
 * share of otherwise clean matches.
 *
 * This is not stemming. It only ever WIDENS a term — nothing is reduced to a
 * root — so `routing` can never collapse into `route`, which is the distinction
 * the term lists depend on.
 *
 * SEPARATORS
 * ----------
 * Words are split on any run of whitespace or hyphens and rejoined as
 * `[\s-]+`, so one term covers every way the bank writes a compound: `open
 * loop` matches "open-loop", `non-functional requirement` matches "non
 * functional requirements", and a line break between words does not break the
 * match. Writing both spellings of every compound by hand was the alternative,
 * and the bank is inconsistent enough that it would have been missed.
 */
function termPattern(term: string): RegExp {
  const words = term.split(/[\s-]+/).map(word => word.replace(REGEX_SPECIALS, '\\$&'));
  const body = words
    // An optional plural is only meaningful after a word character.
    .map(word => (/\w$/.test(word) ? word + '(?:e?s)?' : word))
    .join('[\\s-]+');
  const prefix = /^\w/.test(term) ? '\\b' : '';
  const suffix = /\w$/.test(term) ? '\\b' : '';
  return new RegExp(prefix + body + suffix, 'i');
}

/**
 * Compiled once per term, not once per question. Classifying the whole bank
 * otherwise rebuilds a few thousand regexes per question.
 */
const PATTERN_CACHE = new Map<string, RegExp>();

function patternFor(term: string): RegExp {
  const cached = PATTERN_CACHE.get(term);
  if (cached) return cached;
  const compiled = termPattern(term);
  PATTERN_CACHE.set(term, compiled);
  return compiled;
}

interface Scored {
  readonly code: SubchapterCode;
  /** Evidence found in the stem only. */
  readonly stemScore: number;
  /** Stem evidence plus option evidence at `OPTION_WEIGHT`. */
  readonly totalScore: number;
  readonly matched: readonly string[];
}

function scoreSubchapter(
  code: SubchapterCode,
  stem: string,
  optionText: string
): Scored {
  const terms = SUBCHAPTER_TERMS[code];
  let stemScore = 0;
  let optionScore = 0;
  const matched: string[] = [];

  const tally = (list: readonly string[], weight: number): void => {
    for (const term of list) {
      const pattern = patternFor(term);
      if (pattern.test(stem)) {
        stemScore += weight;
        matched.push(term);
      } else if (pattern.test(optionText)) {
        optionScore += weight * OPTION_WEIGHT;
        matched.push(term);
      }
    }
  };

  // Strong terms first, so `matched` reads strongest-first for the caller.
  tally(terms.strong, STRONG_WEIGHT);
  tally(terms.weak, WEAK_WEIGHT);

  return { code, stemScore, totalScore: stemScore + optionScore, matched };
}

/**
 * Apply the two guards to one ranking and return the winner, or null.
 *
 * Shared by both passes in `classifySubchapter` so the thresholds cannot drift
 * apart between them.
 */
function decide(
  ranked: readonly Scored[],
  scoreOf: (s: Scored) => number
): { winner: Scored; runnerUpScore: number } | null {
  const winner = ranked[0];
  if (!winner) return null;
  const top = scoreOf(winner);
  if (top < MIN_SCORE) return null;
  const runnerUpScore = ranked[1] ? scoreOf(ranked[1]) : 0;
  if (top - runnerUpScore < MIN_MARGIN) return null;
  return { winner, runnerUpScore };
}

/* ------------------------------------------------------------------ *
 * Public API.
 * ------------------------------------------------------------------ */

/**
 * Classify one question into a sub-chapter of its known chapter.
 *
 * Returns `null` when the chapter is unknown, when no sub-chapter clears
 * `MIN_SCORE`, or when the top two are within `MIN_MARGIN` of each other.
 * Callers must treat `null` as "chapter only", never as an error.
 */
export function classifySubchapter(input: ClassifierInput): SubchapterMatch | null {
  const chapter = input.chapterCode
    ? getChapterByCode(input.chapterCode)
    : input.bookChapterId
      ? getChapterByBookChapterId(input.bookChapterId)
      : undefined;
  if (!chapter) return null;

  const stem = input.question;
  const optionText = input.options.join(' • ');

  const scored = chapter.subchapters.map(sub =>
    scoreSubchapter(sub.code, stem, optionText)
  );

  // Pass 1 — the stem alone. A stem that names its topic outright should not be
  // overruled by a distractor: "NOT a phase in the project life cycle?" with
  // "Depreciation" among the wrong answers is a 10.4 question, and letting the
  // distractor's 10.2 vocabulary close the margin turned a decisive stem into a
  // refusal. Options can only ever BREAK a tie, never create one.
  const byStem = [...scored].sort((a, b) => b.stemScore - a.stemScore);
  const stemCall = decide(byStem, s => s.stemScore);
  if (stemCall) {
    return build(chapter.subchapters, stemCall.winner, stemCall.runnerUpScore, s => s.stemScore);
  }

  // Pass 2 — stem plus options. Reached when the stem is generic ("Which of the
  // following is NOT...") and the options carry the only topical vocabulary.
  const byTotal = [...scored].sort((a, b) => b.totalScore - a.totalScore);
  const totalCall = decide(byTotal, s => s.totalScore);
  if (totalCall) {
    return build(
      chapter.subchapters,
      totalCall.winner,
      totalCall.runnerUpScore,
      s => s.totalScore
    );
  }

  return null;
}

function build(
  subchapters: readonly { code: SubchapterCode; displayCode: string; title: string }[],
  winner: Scored,
  runnerUpScore: number,
  scoreOf: (s: Scored) => number
): SubchapterMatch | null {
  const sub = subchapters.find(s => s.code === winner.code);
  if (!sub) return null;
  return {
    code: sub.code,
    displayCode: sub.displayCode,
    title: sub.title,
    confidenceBp: confidenceBp(scoreOf(winner), runnerUpScore),
    matchedTerms: winner.matched,
  };
}

/**
 * Map a (score, margin) pair onto 0-10000.
 *
 * Deliberately conservative: a question can only reach the top of the range by
 * matching several strong terms AND leaving the runner-up far behind. The
 * ceiling is 9000, because no amount of keyword agreement makes a heuristic
 * certain, and a UI that reads 100% would be lying.
 */
export function confidenceBp(topScore: number, runnerUpScore: number): number {
  // Evidence: saturates at 4 strong-term-equivalents.
  const evidence = Math.min(topScore / (STRONG_WEIGHT * 4), 1);
  // Separation: saturates when the winner doubles the runner-up.
  const separation =
    topScore <= 0 ? 0 : Math.min((topScore - runnerUpScore) / topScore, 1);
  const combined = 0.6 * evidence + 0.4 * separation;
  return Math.round(combined * 9000);
}

/** Exposed for the coverage report and for tests that assert the thresholds. */
export const CLASSIFIER_THRESHOLDS = {
  STRONG_WEIGHT,
  WEAK_WEIGHT,
  OPTION_WEIGHT,
  MIN_SCORE,
  MIN_MARGIN,
} as const;
