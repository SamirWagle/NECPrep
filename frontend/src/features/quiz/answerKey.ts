/**
 * Quiz engine — what `Question.correctIndex` means when it is not an index.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `Question.correctIndex` is a required `number`, and two of its values are not
 * positions at all. Before this file those meanings were spelled `>= 0` and
 * `< 0` inline in the reducer, the selectors, the hook and two components, so
 * adding a second non-index meaning would have been five silent edits. Now
 * every read of a sentinel goes through a named predicate here.
 *
 * THE SENTINELS
 * -------------
 *  * `NO_ANSWER_KEY` (-1) — the LOCAL bank has no usable key for this
 *    question. Some chapter JSONs ship `correct_option_index: 0` with an empty
 *    `correct_option`; `localData.loadTopicQuestions` maps those to -1. Such a
 *    question is never scored and is excluded from the percentage denominator,
 *    because counting it wrong would understate every score containing one.
 *
 *  * `KEY_HELD_BY_SERVER` (-2) — a key EXISTS, but this client has never seen
 *    it and must never see it before submission. This is what a remote mock
 *    attempt uses: the Worker sends `PublicQuestion`/`AttemptQuestion`, which
 *    have no correct-answer field of any kind, and scores the paper itself.
 *
 * WHY A SENTINEL AND NOT A SEPARATE TYPE
 * --------------------------------------
 * The honest alternative is a discriminated union — `KeyedQuestion |
 * UnkeyedQuestion` — so that reading an answer key off a remote question is a
 * compile error rather than a value check. It was rejected, deliberately:
 * `correctIndex` is part of `localData.Question`, which is the element type of
 * `QuizState.questions`, `QuizDraft.questionIds`' companion arrays,
 * `loadQuestionsByIds`, `loadTopicQuestions`, `describeReference` and every
 * quiz component's props. Splitting it would ripple through the persistence
 * format and all four quiz surfaces for a guarantee that the server already
 * enforces at the only boundary that matters: the wire. A remote paper cannot
 * carry a key, because `AttemptQuestion` has no field to carry one in.
 *
 * What a sentinel buys instead is that the engine needs NO new branch to be
 * safe. -2 is `< 0`, so every existing guard that already refused to score an
 * unkeyed question refuses to score a server-keyed one, and a future reader
 * who forgets this file still falls into the safe path rather than reading
 * option -2 of an array.
 *
 * NEVER fake a real index for a remote question. `correctIndex: 0` would make
 * the engine score the paper locally, display a verdict mid-exam, and be
 * wrong — which is exactly the bug this file prevents.
 */

/** The local bank has no usable answer key for this question. */
export const NO_ANSWER_KEY = -1;

/** A key exists, but only the server holds it. Set on remote mock papers. */
export const KEY_HELD_BY_SERVER = -2;

/** The two `correctIndex` values that are not option positions. */
export type AnswerKeySentinel = typeof NO_ANSWER_KEY | typeof KEY_HELD_BY_SERVER;

/**
 * True when `correctIndex` is a real option position this client can grade
 * against. The one predicate the reducer, the selectors and the write-through
 * to local progress all ask.
 */
export function hasLocalKey(correctIndex: number): boolean {
  return correctIndex >= 0;
}

/**
 * True when the key for this question lives on the server.
 *
 * Distinct from `!hasLocalKey`: a question with no key anywhere (-1) is a
 * content defect to report, while a server-keyed one (-2) is working as
 * designed and will be marked on submission.
 */
export function isServerKeyed(correctIndex: number): boolean {
  return correctIndex === KEY_HELD_BY_SERVER;
}
