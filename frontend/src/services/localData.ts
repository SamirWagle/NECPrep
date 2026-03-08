/**
 * Local data service — replaces all Supabase API calls.
 * Questions are loaded from /data/*.json (in public folder).
 * Progress and bookmarks are stored in localStorage.
 */

import { mockTests, getMockTestById } from '../data/topics';
import type { Topic, MockTest } from '../data/topics';
import { bookChapters } from '../data/bookChapters.generated';

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

    const questions: Question[] = raw.map((q, i) => {
      let correctIndex: number;
      if (isBookChapter) {
        // 1-based → 0-based
        correctIndex = typeof q.correct_option_index === 'number' ? q.correct_option_index - 1 : -1;
      } else {
        // Try matching the correct_option text against the option strings
        const opts = [q.opt1, q.opt2, q.opt3, q.opt4].filter(Boolean);
        if (q.correct_option) {
          const idx = opts.findIndex(o => o === q.correct_option);
          correctIndex = idx >= 0 ? idx : -1;
        } else {
          correctIndex = -1; // no answer data in this file
        }
      }
      return {
        id: `${topicId}_${i}`,
        topicId,
        question: q.qsns,
        options: [q.opt1, q.opt2, q.opt3, q.opt4].filter(Boolean),
        correctIndex,
      };
    });

    questionCache[topicId] = questions;
    return questions;
  } catch (err) {
    console.error(`Failed to load questions for ${topicId}:`, err);
    return [];
  }
}

export async function loadQuestionsSlice(topicId: string, count: number): Promise<Question[]> {
  const all = await loadTopicQuestions(topicId);
  // Shuffle and take `count` questions
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
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

export function clearAllData() {
  localStorage.removeItem(STORAGE_KEYS.PROGRESS);
  localStorage.removeItem(STORAGE_KEYS.BOOKMARKS);
  localStorage.removeItem(STORAGE_KEYS.QUIZ_HISTORY);
}
