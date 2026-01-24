import { supabase, getAuthToken } from '../lib/supabase';
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
  Profile
} from '../types/database.types';

const API_URL = import.meta.env.VITE_API_URL || '';

// Helper for API calls with auth
async function fetchWithAuth<T>(
  endpoint: string, 
  options: RequestInit = {}
): Promise<T> {
  const token = await getAuthToken();
  
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.data;
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

export async function getQuestions(options?: {
  topicId?: string;
  limit?: number;
  offset?: number;
  random?: boolean;
}): Promise<{ questions: Question[]; count: number }> {
  const { topicId, limit = 20, offset = 0, random = false } = options || {};

  let query = supabase
    .from('questions')
    .select('*', { count: 'exact' });

  if (topicId) {
    query = query.eq('topic_id', topicId);
  }

  if (random) {
    // For random, fetch all and shuffle client-side
    const { data, error, count } = await query;
    if (error) throw error;
    
    const shuffled = data?.sort(() => Math.random() - 0.5).slice(0, limit) || [];
    return { questions: shuffled, count: count || 0 };
  }

  query = query.range(offset, offset + limit - 1);
  
  const { data, error, count } = await query;
  if (error) throw error;
  
  return { questions: data || [], count: count || 0 };
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
  return data;
}

// ==================== PROGRESS ====================

export async function getUserProgress(): Promise<{
  overall: UserOverallStats | null;
  topics: UserTopicStats[];
}> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const [overallRes, topicsRes] = await Promise.all([
    supabase
      .from('user_overall_stats')
      .select('*')
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('user_topic_stats')
      .select('*')
      .eq('user_id', user.id)
  ]);

  return {
    overall: overallRes.error?.code === 'PGRST116' ? null : overallRes.data,
    topics: topicsRes.data || []
  };
}

export async function getTopicProgress(topicId: string): Promise<UserTopicStats | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('user_topic_stats')
    .select('*')
    .eq('user_id', user.id)
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('user_question_progress')
    .upsert({
      user_id: user.id,
      question_id: questionId,
      topic_id: topicId,
      is_correct: isCorrect,
      last_attempted_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,question_id'
    });

  if (error) throw error;
}

export async function getAnsweredQuestions(topicId: string): Promise<{
  questionId: string;
  isCorrect: boolean;
  attempts: number;
}[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('user_question_progress')
    .select('question_id, is_correct, attempts')
    .eq('user_id', user.id)
    .eq('topic_id', topicId);

  if (error) throw error;
  
  return (data || []).map(d => ({
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  let query = supabase
    .from('bookmarks')
    .select(`
      *,
      question:questions(*),
      topic:topics(*)
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (topicId) {
    query = query.eq('topic_id', topicId);
  }

  const { data, error } = await query;
  if (error) throw error;
  
  return (data || []) as (Bookmark & { question: Question; topic: Topic })[];
}

export async function addBookmark(questionId: string, topicId: string): Promise<Bookmark> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('bookmarks')
    .insert({
      user_id: user.id,
      question_id: questionId,
      topic_id: topicId
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeBookmark(questionId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('bookmarks')
    .delete()
    .eq('user_id', user.id)
    .eq('question_id', questionId);

  if (error) throw error;
}

export async function isBookmarked(questionId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data, error } = await supabase
    .from('bookmarks')
    .select('id')
    .eq('user_id', user.id)
    .eq('question_id', questionId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return !!data;
}

// ==================== MOCK TESTS ====================

export async function getMockTests(): Promise<MockTest[]> {
  const { data, error } = await supabase
    .from('mock_tests')
    .select('*')
    .eq('is_active', true)
    .order('created_at');

  if (error) throw error;
  return data || [];
}

export async function getMockTest(id: string): Promise<MockTest | null> {
  const { data, error } = await supabase
    .from('mock_tests')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function startMockTest(testId: string): Promise<{
  attemptId: string;
  questions: Question[];
  test: MockTest;
}> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Get mock test config
  const { data: mockTest, error: testError } = await supabase
    .from('mock_tests')
    .select('*')
    .eq('id', testId)
    .single();

  if (testError) throw testError;
  if (!mockTest) throw new Error('Mock test not found');

  // Create attempt
  const { data: attempt, error: attemptError } = await supabase
    .from('mock_test_attempts')
    .insert({
      user_id: user.id,
      mock_test_id: testId,
      score: 0,
      total_questions: mockTest.question_count,
      correct_answers: 0,
      answers: []
    })
    .select()
    .single();

  if (attemptError) throw attemptError;

  // Get random questions
  const { data: questions, error: questionsError } = await supabase
    .from('questions')
    .select('id, question_text, option_1, option_2, option_3, option_4, topic_id');

  if (questionsError) throw questionsError;

  const shuffled = questions?.sort(() => Math.random() - 0.5).slice(0, mockTest.question_count) || [];

  return {
    attemptId: attempt.id,
    questions: shuffled as Question[],
    test: mockTest
  };
}

export async function submitMockTest(
  attemptId: string,
  answers: { questionId: string; selectedOption: number }[],
  timeTakenSeconds: number
): Promise<MockTestAttempt & { isPassed: boolean }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Get question correct answers
  const questionIds = answers.map(a => a.questionId);
  const { data: questions, error: questionsError } = await supabase
    .from('questions')
    .select('id, correct_option_index')
    .in('id', questionIds);

  if (questionsError) throw questionsError;

  const correctMap = new Map(questions?.map(q => [q.id, q.correct_option_index]));

  // Grade answers
  let correctCount = 0;
  const gradedAnswers = answers.map(a => {
    const isCorrect = correctMap.get(a.questionId) === a.selectedOption;
    if (isCorrect) correctCount++;
    return { question_id: a.questionId, selected_option: a.selectedOption, is_correct: isCorrect };
  });

  // Get attempt to calculate score
  const { data: attempt, error: attemptError } = await supabase
    .from('mock_test_attempts')
    .select('*, mock_tests(*)')
    .eq('id', attemptId)
    .single();

  if (attemptError) throw attemptError;

  const score = Math.round((correctCount / attempt.total_questions) * 100);
  const mockTest = attempt.mock_tests as MockTest;
  const isPassed = score >= mockTest.passing_score;

  // Update attempt
  const { data: updated, error: updateError } = await supabase
    .from('mock_test_attempts')
    .update({
      score,
      correct_answers: correctCount,
      time_taken_seconds: timeTakenSeconds,
      is_passed: isPassed,
      completed_at: new Date().toISOString(),
      answers: gradedAnswers
    })
    .eq('id', attemptId)
    .select()
    .single();

  if (updateError) throw updateError;

  return { ...updated, isPassed };
}

export async function getMockTestHistory(): Promise<(MockTestAttempt & { mockTest: MockTest })[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('mock_test_attempts')
    .select('*, mockTest:mock_tests(*)')
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false });

  if (error) throw error;
  return (data || []) as (MockTestAttempt & { mockTest: MockTest })[];
}

// ==================== FLASHCARDS ====================

export async function getFlashcards(topicId?: string): Promise<(Question & {
  progress?: { status: string; reviewCount: number };
})[]> {
  const { data: { user } } = await supabase.auth.getUser();

  let questionsQuery = supabase
    .from('questions')
    .select('*')
    .limit(50);

  if (topicId) {
    questionsQuery = questionsQuery.eq('topic_id', topicId);
  }

  const { data: questions, error: questionsError } = await questionsQuery;
  if (questionsError) throw questionsError;

  if (!user) return questions || [];

  // Get progress
  const { data: progress, error: progressError } = await supabase
    .from('flashcard_progress')
    .select('question_id, status, review_count')
    .eq('user_id', user.id);

  if (progressError) throw progressError;

  const progressMap = new Map(progress?.map(p => [p.question_id, {
    status: p.status,
    reviewCount: p.review_count
  }]));

  return (questions || []).map(q => ({
    ...q,
    progress: progressMap.get(q.id)
  }));
}

export async function updateFlashcardProgress(
  questionId: string,
  status: 'known' | 'learning' | 'review'
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  let nextReviewAt: string | null = null;
  if (status === 'review') {
    nextReviewAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  } else if (status === 'learning') {
    nextReviewAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  }

  const { error } = await supabase
    .from('flashcard_progress')
    .upsert({
      user_id: user.id,
      question_id: questionId,
      status,
      last_reviewed_at: new Date().toISOString(),
      next_review_at: nextReviewAt
    }, {
      onConflict: 'user_id,question_id'
    });

  if (error) throw error;
}

// ==================== STUDY SESSIONS ====================

export async function startStudySession(
  sessionType: 'practice' | 'mock_test' | 'flashcard' | 'study',
  topicId?: string
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('study_sessions')
    .insert({
      user_id: user.id,
      topic_id: topicId || null,
      session_type: sessionType
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

export async function endStudySession(
  sessionId: string,
  questionsAnswered: number,
  correctAnswers: number
): Promise<void> {
  const { data: session, error: fetchError } = await supabase
    .from('study_sessions')
    .select('started_at')
    .eq('id', sessionId)
    .single();

  if (fetchError) throw fetchError;

  const durationSeconds = Math.floor(
    (Date.now() - new Date(session.started_at).getTime()) / 1000
  );

  const { error } = await supabase
    .from('study_sessions')
    .update({
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
      questions_answered: questionsAnswered,
      correct_answers: correctAnswers
    })
    .eq('id', sessionId);

  if (error) throw error;
}

export async function getRecentSessions(limit = 10): Promise<(StudySession & { topic?: Topic })[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('study_sessions')
    .select('*, topic:topics(*)')
    .eq('user_id', user.id)
    .not('ended_at', 'is', null)
    .order('ended_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as (StudySession & { topic?: Topic })[];
}

// ==================== USER ====================

export async function getUserProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateUserProfile(updates: {
  fullName?: string;
  avatarUrl?: string;
}): Promise<Profile> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('profiles')
    .update({
      full_name: updates.fullName,
      avatar_url: updates.avatarUrl,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getUserSettings(): Promise<UserSettings | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateUserSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('user_settings')
    .upsert({
      user_id: user.id,
      ...settings,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
