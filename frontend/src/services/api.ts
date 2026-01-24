/**
 * API Service - Direct Supabase Integration
 * All database operations are performed directly from the frontend
 * Security is handled via Supabase Row Level Security (RLS)
 */

import { supabase } from '../lib/supabase';
import type { 
  Topic, 
  Question, 
  Bookmark, 
  MockTest, 
  MockTestAttempt,
  UserSettings,
  StudySession,
  UserTopicStats,
  UserOverallStats,
  Profile,
  QuestionRow,
  MockTestRow
} from '../types/database.types';
import { enhanceQuestion, enhanceMockTest } from '../types/database.types';

// ==================== HELPER ====================

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// ==================== TOPICS ====================

export async function getTopics(): Promise<Topic[]> {
  const { data, error } = await supabase
    .from('topics')
    .select('*')
    .order('display_order');

  if (error) throw error;
  return data || [];
}

export async function getTopic(id: string): Promise<Topic | null> {
  const { data, error } = await supabase
    .from('topics')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

// ==================== QUESTIONS ====================

export async function getQuestions(options: {
  topicId?: string;
  difficulty?: string;
  limit?: number;
  offset?: number;
  shuffle?: boolean;
} = {}): Promise<{ questions: Question[]; count: number }> {
  const { topicId, difficulty, limit = 50, offset = 0, shuffle = false } = options;
  
  let query = supabase
    .from('questions')
    .select('*', { count: 'exact' });

  if (topicId) {
    query = query.eq('topic_id', topicId);
  }

  if (difficulty) {
    query = query.eq('difficulty', difficulty);
  }

  if (shuffle) {
    // For shuffle, get all and randomize client-side
    const { data, error, count } = await query;
    if (error) throw error;
    
    const enhanced = (data || []).map((q: QuestionRow) => enhanceQuestion(q));
    const shuffled = enhanced
      .sort(() => Math.random() - 0.5)
      .slice(0, limit);
    return { questions: shuffled, count: count || 0 };
  }

  query = query.range(offset, offset + limit - 1);
  
  const { data, error, count } = await query;
  if (error) throw error;
  
  const enhanced = (data || []).map((q: QuestionRow) => enhanceQuestion(q));
  return { questions: enhanced, count: count || 0 };
}

export async function getQuestionsByTopic(
  topicId: string, 
  limit = 50, 
  offset = 0
): Promise<{ questions: Question[]; count: number }> {
  return getQuestions({ topicId, limit, offset });
}

export async function getQuestion(id: string): Promise<Question | null> {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data ? enhanceQuestion(data as QuestionRow) : null;
}

// ==================== USER PROGRESS ====================

export async function getUserProgress(): Promise<{
  overall: UserOverallStats | null;
  topics: UserTopicStats[];
}> {
  const userId = await getCurrentUserId();

  const [overallRes, topicsRes] = await Promise.all([
    supabase
      .from('user_overall_stats')
      .select('*')
      .eq('user_id', userId)
      .single(),
    supabase
      .from('user_topic_stats')
      .select('*')
      .eq('user_id', userId)
  ]);

  return {
    overall: overallRes.error?.code === 'PGRST116' ? null : overallRes.data,
    topics: topicsRes.data || []
  };
}

export async function getTopicProgress(topicId: string): Promise<UserTopicStats | null> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('user_topic_stats')
    .select('*')
    .eq('user_id', userId)
    .eq('topic_id', topicId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function recordQuestionAttempt(
  questionId: string,
  topicId: string,
  isCorrect: boolean
): Promise<void> {
  const userId = await getCurrentUserId();

  // Check if progress exists
  const { data: existing } = await supabase
    .from('user_question_progress')
    .select('id, attempts')
    .eq('user_id', userId)
    .eq('question_id', questionId)
    .single();

  if (existing) {
    // Update existing
    const { error } = await supabase
      .from('user_question_progress')
      .update({
        is_correct: isCorrect,
        attempts: existing.attempts + 1,
        last_attempted_at: new Date().toISOString()
      })
      .eq('id', existing.id);

    if (error) throw error;
  } else {
    // Insert new
    const { error } = await supabase
      .from('user_question_progress')
      .insert({
        user_id: userId,
        question_id: questionId,
        topic_id: topicId,
        is_correct: isCorrect,
        attempts: 1,
        last_attempted_at: new Date().toISOString()
      });

    if (error) throw error;
  }
}

export async function getAnsweredQuestions(topicId: string): Promise<{
  questionId: string;
  isCorrect: boolean;
  attempts: number;
}[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('user_question_progress')
    .select('question_id, is_correct, attempts')
    .eq('user_id', userId)
    .eq('topic_id', topicId);

  if (error) throw error;
  
  return (data || []).map((d: { question_id: string; is_correct: boolean | null; attempts: number }) => ({
    questionId: d.question_id,
    isCorrect: d.is_correct || false,
    attempts: d.attempts
  }));
}

// ==================== BOOKMARKS ====================

export async function getBookmarks(topicId?: string): Promise<(Bookmark & { 
  question: Question;
  topic: Topic;
})[]> {
  const userId = await getCurrentUserId();

  let query = supabase
    .from('bookmarks')
    .select(`
      *,
      question:questions(*),
      topic:topics(*)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (topicId) {
    query = query.eq('topic_id', topicId);
  }

  const { data, error } = await query;
  if (error) throw error;
  
  return (data || []) as (Bookmark & { question: Question; topic: Topic })[];
}

export async function addBookmark(questionId: string, topicId: string, notes?: string): Promise<Bookmark> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('bookmarks')
    .insert({
      user_id: userId,
      question_id: questionId,
      topic_id: topicId,
      notes: notes || null
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeBookmark(questionId: string): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('bookmarks')
    .delete()
    .eq('user_id', userId)
    .eq('question_id', questionId);

  if (error) throw error;
}

export async function isBookmarked(questionId: string): Promise<boolean> {
  try {
    const userId = await getCurrentUserId();

    const { data, error } = await supabase
      .from('bookmarks')
      .select('id')
      .eq('user_id', userId)
      .eq('question_id', questionId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  } catch {
    return false;
  }
}

// ==================== MOCK TESTS ====================

export async function getMockTests(): Promise<MockTest[]> {
  const { data, error } = await supabase
    .from('mock_tests')
    .select('*')
    .eq('is_active', true)
    .order('created_at');

  if (error) throw error;
  return (data || []).map((mt: MockTestRow) => enhanceMockTest(mt));
}

export async function getMockTest(id: string): Promise<MockTest | null> {
  const { data, error } = await supabase
    .from('mock_tests')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data ? enhanceMockTest(data as MockTestRow) : null;
}

export async function startMockTest(mockTestId: string): Promise<{
  attemptId: string;
  questions: Question[];
}> {
  const userId = await getCurrentUserId();

  // Get mock test details
  const mockTest = await getMockTest(mockTestId);
  if (!mockTest) throw new Error('Mock test not found');

  // Get random questions
  const { questions } = await getQuestions({
    limit: mockTest.question_count,
    shuffle: true
  });

  // Create attempt record
  const { data: attempt, error } = await supabase
    .from('mock_test_attempts')
    .insert({
      user_id: userId,
      mock_test_id: mockTestId,
      score: 0,
      total_questions: questions.length,
      correct_answers: 0,
      answers: {},
      started_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;

  return {
    attemptId: attempt.id,
    questions
  };
}

export async function submitMockTestAnswer(
  attemptId: string,
  questionId: string,
  selectedAnswer: number,
  isCorrect: boolean
): Promise<void> {
  const userId = await getCurrentUserId();

  // Get current attempt
  const { data: attempt, error: fetchError } = await supabase
    .from('mock_test_attempts')
    .select('answers, correct_answers')
    .eq('id', attemptId)
    .eq('user_id', userId)
    .single();

  if (fetchError) throw fetchError;

  const answers = attempt.answers as Record<string, any> || {};
  answers[questionId] = { selectedAnswer, isCorrect };

  const newCorrectCount = isCorrect ? attempt.correct_answers + 1 : attempt.correct_answers;

  const { error } = await supabase
    .from('mock_test_attempts')
    .update({
      answers,
      correct_answers: newCorrectCount
    })
    .eq('id', attemptId);

  if (error) throw error;
}

export async function completeMockTest(attemptId: string): Promise<MockTestAttempt> {
  const userId = await getCurrentUserId();

  // Get attempt details
  const { data: attempt, error: fetchError } = await supabase
    .from('mock_test_attempts')
    .select('*, mock_test:mock_tests(*)')
    .eq('id', attemptId)
    .eq('user_id', userId)
    .single();

  if (fetchError) throw fetchError;

  const score = Math.round((attempt.correct_answers / attempt.total_questions) * 100);
  const mockTest = attempt.mock_test as MockTest;
  const isPassed = score >= mockTest.passing_score;

  const startedAt = new Date(attempt.started_at);
  const timeTaken = Math.round((Date.now() - startedAt.getTime()) / 1000);

  const { data, error } = await supabase
    .from('mock_test_attempts')
    .update({
      score,
      is_passed: isPassed,
      time_taken_seconds: timeTaken,
      completed_at: new Date().toISOString()
    })
    .eq('id', attemptId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getMockTestHistory(): Promise<(MockTestAttempt & { mock_test: MockTest })[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('mock_test_attempts')
    .select(`
      *,
      mock_test:mock_tests(*)
    `)
    .eq('user_id', userId)
    .order('started_at', { ascending: false });

  if (error) throw error;
  
  // Enhance the mock_test in each attempt
  return (data || []).map((attempt: MockTestAttempt & { mock_test: MockTestRow }) => ({
    ...attempt,
    mock_test: enhanceMockTest(attempt.mock_test)
  })) as (MockTestAttempt & { mock_test: MockTest })[];
}

// ==================== FLASHCARDS ====================

export async function getFlashcards(topicId?: string): Promise<any[]> {
  const userId = await getCurrentUserId();

  let query = supabase
    .from('flashcard_progress')
    .select(`
      *,
      question:questions(*, topic:topics(*))
    `)
    .eq('user_id', userId)
    .order('next_review_at', { ascending: true, nullsFirst: true });

  if (topicId) {
    // Filter by topic through the question relation
    query = query.eq('question.topic_id', topicId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return data || [];
}

export async function getFlashcardsDue(): Promise<any[]> {
  const userId = await getCurrentUserId();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('flashcard_progress')
    .select(`
      *,
      question:questions(*, topic:topics(*))
    `)
    .eq('user_id', userId)
    .or(`next_review_at.is.null,next_review_at.lte.${now}`)
    .order('next_review_at', { ascending: true, nullsFirst: true });

  if (error) throw error;
  return data || [];
}

export async function addToFlashcards(questionId: string): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('flashcard_progress')
    .insert({
      user_id: userId,
      question_id: questionId,
      status: 'new',
      review_count: 0,
      last_reviewed_at: new Date().toISOString()
    });

  if (error) throw error;
}

export async function updateFlashcardProgress(
  flashcardId: string,
  status: 'new' | 'learning' | 'review' | 'mastered',
  nextReviewAt: Date | null
): Promise<void> {
  const userId = await getCurrentUserId();

  const { data: current, error: fetchError } = await supabase
    .from('flashcard_progress')
    .select('review_count')
    .eq('id', flashcardId)
    .eq('user_id', userId)
    .single();

  if (fetchError) throw fetchError;

  const { error } = await supabase
    .from('flashcard_progress')
    .update({
      status,
      review_count: current.review_count + 1,
      last_reviewed_at: new Date().toISOString(),
      next_review_at: nextReviewAt?.toISOString() || null
    })
    .eq('id', flashcardId);

  if (error) throw error;
}

export async function removeFromFlashcards(flashcardId: string): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('flashcard_progress')
    .delete()
    .eq('id', flashcardId)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function isInFlashcards(questionId: string): Promise<{ isInFlashcards: boolean; flashcardId?: string }> {
  try {
    const userId = await getCurrentUserId();

    const { data, error } = await supabase
      .from('flashcard_progress')
      .select('id')
      .eq('user_id', userId)
      .eq('question_id', questionId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return { isInFlashcards: !!data, flashcardId: data?.id };
  } catch {
    return { isInFlashcards: false };
  }
}

// ==================== STUDY SESSIONS ====================

export async function startStudySession(topicId: string | null, sessionType: string): Promise<StudySession> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('study_sessions')
    .insert({
      user_id: userId,
      topic_id: topicId,
      session_type: sessionType,
      questions_answered: 0,
      correct_answers: 0,
      duration_seconds: 0,
      started_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateStudySession(
  sessionId: string,
  questionsAnswered: number,
  correctAnswers: number
): Promise<void> {
  const { error } = await supabase
    .from('study_sessions')
    .update({
      questions_answered: questionsAnswered,
      correct_answers: correctAnswers
    })
    .eq('id', sessionId);

  if (error) throw error;
}

export async function endStudySession(sessionId: string): Promise<StudySession> {
  const { data: session, error: fetchError } = await supabase
    .from('study_sessions')
    .select('started_at')
    .eq('id', sessionId)
    .single();

  if (fetchError) throw fetchError;

  const startedAt = new Date(session.started_at);
  const durationSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);

  const { data, error } = await supabase
    .from('study_sessions')
    .update({
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds
    })
    .eq('id', sessionId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getStudySessions(limit = 20): Promise<(StudySession & { topic: Topic | null })[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('study_sessions')
    .select(`
      *,
      topic:topics(*)
    `)
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as (StudySession & { topic: Topic | null })[];
}

// ==================== USER PROFILE & SETTINGS ====================

export async function getUserProfile(): Promise<Profile | null> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateUserProfile(updates: Partial<Profile>): Promise<Profile> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('profiles')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getUserSettings(): Promise<UserSettings | null> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateUserSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const userId = await getCurrentUserId();

  // Check if settings exist
  const existing = await getUserSettings();

  if (existing) {
    const { data, error } = await supabase
      .from('user_settings')
      .update({
        ...settings,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase
      .from('user_settings')
      .insert({
        user_id: userId,
        ...settings
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

// ==================== DASHBOARD ====================

export async function getDashboardStats(): Promise<{
  overall: UserOverallStats | null;
  topicProgress: UserTopicStats[];
  recentSessions: StudySession[];
  flashcardsDueCount: number;
  bookmarksCount: number;
}> {
  const userId = await getCurrentUserId();
  const now = new Date().toISOString();

  const [
    overallRes,
    topicsRes,
    sessionsRes,
    flashcardsRes,
    bookmarksRes
  ] = await Promise.all([
    supabase
      .from('user_overall_stats')
      .select('*')
      .eq('user_id', userId)
      .single(),
    supabase
      .from('user_topic_stats')
      .select('*')
      .eq('user_id', userId),
    supabase
      .from('study_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(5),
    supabase
      .from('flashcard_progress')
      .select('id', { count: 'exact' })
      .eq('user_id', userId)
      .or(`next_review_at.is.null,next_review_at.lte.${now}`),
    supabase
      .from('bookmarks')
      .select('id', { count: 'exact' })
      .eq('user_id', userId)
  ]);

  return {
    overall: overallRes.error?.code === 'PGRST116' ? null : overallRes.data,
    topicProgress: topicsRes.data || [],
    recentSessions: sessionsRes.data || [],
    flashcardsDueCount: flashcardsRes.count || 0,
    bookmarksCount: bookmarksRes.count || 0
  };
}
