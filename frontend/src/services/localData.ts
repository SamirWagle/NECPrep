/**
 * Local data service — replaces all Supabase API calls.
 * Questions are loaded from /data/*.json (in public folder).
 * Progress and bookmarks are stored in localStorage.
 */

import { mockTests, getMockTestById } from '../data/topics';
import type { Topic, MockTest } from '../data/topics';
import { bookChapters } from '../data/bookChapters.generated';
import { quarantinedIds } from '../data/quarantine';
import { assignOptionOrders, fisherYates } from './optionOrdering';
export { orderOptions, assignOptionOrders } from './optionOrdering';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Question {
  id: string;           // synthetic: "{topicId}_{index}"
  topicId: string;
  question: string;
  options: string[];
  correctIndex: number;
}

export interface ProgressEntry {
  attempted: string[];  // question ids
  correct: string[];    // question ids
}

export interface ProgressMap {
  [topicId: string]: ProgressEntry;
}

export interface QuizResult {
  topicId: string;
  topicName: string;
  score: number;
  total: number;
  date: string;
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  PROGRESS: 'eng_progress',
  BOOKMARKS: 'eng_bookmarks',
  QUIZ_HISTORY: 'eng_history',
};

// ─── Topics ───────────────────────────────────────────────────────────────────

export { mockTests, getMockTestById, bookChapters };
export type { Topic, MockTest };

// getTopicById — book chapters only (exam topic JSONs have no answer data)
export function getTopicById(id: string): Topic | undefined {
  return bookChapters.find(c => c.id === id);
}

// ─── Questions ────────────────────────────────────────────────────────────────

const questionCache: Record<string, Question[]> = {};

export async function loadTopicQuestions(topicId: string): Promise<Question[]> {
  if (questionCache[topicId]) return questionCache[topicId];

  const topic = getTopicById(topicId);
  if (!topic) return [];

  try {
    const res = await fetch(`/data/${topic.dataFile}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw: Array<{
      qsns: string;
      opt1: string;
      opt2: string;
      opt3: string;
      opt4: string;
      correct_option: string;
      correct_option_index: number;
    }> = await res.json();

    // Book chapters store 1-based indices (1=opt1 … 4=opt4).
    // Exam topic JSONs have correct_option_index:0 + correct_option:"" — no answer data.
    const isBookChapter = topic.dataFile.startsWith('books/');

    const parsed = raw.map((q, i) => {
      let correctIndex: number;
      const opts = [q.opt1, q.opt2, q.opt3, q.opt4].filter(Boolean);
      if (isBookChapter) {
        // 1-based → 0-based
        correctIndex = typeof q.correct_option_index === 'number' ? q.correct_option_index - 1 : -1;
      } else {
        // Try matching the correct_option text against the option strings
        if (q.correct_option) {
          const idx = opts.findIndex(o => o === q.correct_option);
          correctIndex = idx >= 0 ? idx : -1;
        } else {
          correctIndex = -1; // no answer data in this file
        }
      }
      return { id: `${topicId}_${i}`, question: q.qsns, options: opts, correctIndex };
    });

    // Withhold questions the validator proved the app would mis-grade: answer
    // keys that contradict themselves, indices pointing past the last option,
    // and duplicated option text. See src/data/quarantine.ts. Filtering happens
    // after id assignment, so ids stay tied to the original array position.
    //
    // Quarantined rows are dropped BEFORE ordering, so they cannot consume slots
    // in the balance of a chapter a student never sees.
    const kept = parsed.filter((q) => !quarantinedIds.has(q.id));

    // Assign option order across the whole chapter at once, so the slot holding
    // the correct answer is balanced by construction rather than sampled. See
    // optionOrdering.ts for why per-question seeding is not sufficient.
    const ordered = assignOptionOrders(kept);

    const usable: Question[] = kept.map((q, i) => ({
      id: q.id,
      topicId,
      question: q.question,
      options: ordered[i].options,
      correctIndex: ordered[i].correctIndex,
    }));

    questionCache[topicId] = usable;
    return usable;
  } catch (err) {
    console.error(`Failed to load questions for ${topicId}:`, err);
    return [];
  }
}

export async function loadQuestionsSlice(topicId: string, count: number): Promise<Question[]> {
  const all = await loadTopicQuestions(topicId);
  // Fisher-Yates. This was `sort(() => Math.random() - 0.5)`, which is not a
  // uniform shuffle and is comparator-implementation dependent - and it is the
  // shuffle that decides which questions a student practises.
  return fisherYates(all).slice(0, Math.min(count, all.length));
}

// ─── Progress ─────────────────────────────────────────────────────────────────

export function getProgress(): ProgressMap {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.PROGRESS) || '{}');
  } catch {
    return {};
  }
}

function saveProgress(p: ProgressMap) {
  localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(p));
}

export function recordAttempt(questionId: string, topicId: string, isCorrect: boolean) {
  const progress = getProgress();
  if (!progress[topicId]) progress[topicId] = { attempted: [], correct: [] };
  const entry = progress[topicId];
  if (!entry.attempted.includes(questionId)) entry.attempted.push(questionId);
  if (isCorrect && !entry.correct.includes(questionId)) entry.correct.push(questionId);
  saveProgress(progress);
}

export function getTopicProgress(topicId: string): ProgressEntry {
  const progress = getProgress();
  return progress[topicId] || { attempted: [], correct: [] };
}

export function getOverallStats(chapters: Topic[] = bookChapters) {
  const progress = getProgress();
  let attempted = 0;
  let correct = 0;
  for (const entry of Object.values(progress)) {
    attempted += entry.attempted.length;
    correct += entry.correct.length;
  }
  const totalAvailable = chapters.reduce((s, c) => s + c.questionCount, 0);
  return { attempted, correct, totalAvailable };
}

// ─── Quiz History ─────────────────────────────────────────────────────────────

export function saveQuizResult(result: QuizResult) {
  const history = getQuizHistory();
  history.unshift(result);
  localStorage.setItem(STORAGE_KEYS.QUIZ_HISTORY, JSON.stringify(history.slice(0, 50)));
}

export function getQuizHistory(): QuizResult[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.QUIZ_HISTORY) || '[]');
  } catch {
    return [];
  }
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────

export function getBookmarks(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.BOOKMARKS) || '[]');
  } catch {
    return [];
  }
}

export function addBookmark(questionId: string) {
  const bm = getBookmarks();
  if (!bm.includes(questionId)) {
    bm.push(questionId);
    localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(bm));
  }
}

export function removeBookmark(questionId: string) {
  const bm = getBookmarks().filter(id => id !== questionId);
  localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(bm));
}

export function isBookmarked(questionId: string): boolean {
  return getBookmarks().includes(questionId);
}

/**
 * Returns all bookmarked questions across all topics.
 * Because questions are identified as "{topicId}_{index}" we can parse them back.
 */
export async function loadBookmarkedQuestions(): Promise<Question[]> {
  const bookmarkIds = getBookmarks();
  if (bookmarkIds.length === 0) return [];

  // Group by topic
  const byTopic: Record<string, number[]> = {};
  for (const id of bookmarkIds) {
    const lastUnderscore = id.lastIndexOf('_');
    const topicId = id.slice(0, lastUnderscore);
    const index = parseInt(id.slice(lastUnderscore + 1), 10);
    if (!byTopic[topicId]) byTopic[topicId] = [];
    byTopic[topicId].push(index);
  }

  const results: Question[] = [];
  for (const [topicId, indices] of Object.entries(byTopic)) {
    const questions = await loadTopicQuestions(topicId);
    for (const idx of indices) {
      if (questions[idx]) results.push(questions[idx]);
    }
  }
  return results;
}

/**
 * Loads specific questions by id, preserving the order of `ids`.
 *
 * Ids are the synthetic `{topicId}_{index}` form minted by loadTopicQuestions,
 * so this groups by topic, loads each topic once, then maps back. Used to
 * reconstruct an in-progress mock test after a page reload. Ids that no longer
 * resolve are dropped, so callers must compare lengths before trusting the
 * result as a faithful restore.
 */
export async function loadQuestionsByIds(ids: string[]): Promise<Question[]> {
  const topicIds = new Set<string>();
  for (const id of ids) {
    const cut = id.lastIndexOf('_');
    if (cut > 0) topicIds.add(id.slice(0, cut));
  }

  const lookup = new Map<string, Question>();
  for (const topicId of topicIds) {
    for (const q of await loadTopicQuestions(topicId)) lookup.set(q.id, q);
  }

  return ids
    .map(id => lookup.get(id))
    .filter((q): q is Question => q !== undefined);
}

export function clearAllData() {
  localStorage.removeItem(STORAGE_KEYS.PROGRESS);
  localStorage.removeItem(STORAGE_KEYS.BOOKMARKS);
  localStorage.removeItem(STORAGE_KEYS.QUIZ_HISTORY);
  // Also drop any in-progress mock attempt, or a reset would leave a stale
  // draft that resumes an exam the user believes they deleted.
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('eng_mock_draft_v1:')) localStorage.removeItem(key);
  }
}

/** Everything this browser holds for the current user, for the export button. */
export function exportAllData() {
  return {
    schema: 'necprep-export-v1',
    exportedAt: new Date().toISOString(),
    userName: localStorage.getItem('userName') ?? null,
    progress: getProgress(),
    bookmarks: getBookmarks(),
    quizHistory: getQuizHistory(),
  };
}
