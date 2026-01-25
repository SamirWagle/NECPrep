-- =====================================================
-- FRESH START - DROP EVERYTHING AND RECREATE
-- Copy this entire file and run it in Supabase SQL Editor
-- =====================================================

-- Drop all existing objects
DROP VIEW IF EXISTS public.user_overall_stats CASCADE;
DROP VIEW IF EXISTS public.user_topic_stats CASCADE;
DROP TRIGGER IF EXISTS on_study_session_created ON public.study_sessions;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.update_user_streak() CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP TABLE IF EXISTS public.study_sessions CASCADE;
DROP TABLE IF EXISTS public.user_settings CASCADE;
DROP TABLE IF EXISTS public.flashcard_progress CASCADE;
DROP TABLE IF EXISTS public.mock_test_attempts CASCADE;
DROP TABLE IF EXISTS public.mock_tests CASCADE;
DROP TABLE IF EXISTS public.bookmarks CASCADE;
DROP TABLE IF EXISTS public.user_question_progress CASCADE;
DROP TABLE IF EXISTS public.questions CASCADE;
DROP TABLE IF EXISTS public.topics CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- PROFILES TABLE (extends auth.users)
-- =====================================================
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  streak_days INTEGER DEFAULT 0,
  last_activity_date DATE,
  total_study_time_minutes INTEGER DEFAULT 0,
  rank TEXT DEFAULT 'Beginner'
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- TOPICS TABLE
-- =====================================================
CREATE TABLE public.topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT 'BookOpen',
  color TEXT DEFAULT '#6366f1',
  question_count INTEGER DEFAULT 0,
  data_file TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Topics are viewable by everyone" ON public.topics
  FOR SELECT USING (true);

-- =====================================================
-- QUESTIONS TABLE (1-based indexing: 1-4)
-- =====================================================
CREATE TABLE public.questions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  topic_id TEXT REFERENCES public.topics(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  option_1 TEXT NOT NULL,
  option_2 TEXT NOT NULL,
  option_3 TEXT NOT NULL,
  option_4 TEXT NOT NULL,
  correct_option TEXT NOT NULL,
  correct_option_index INTEGER NOT NULL CHECK (correct_option_index BETWEEN 1 AND 4),
  explanation TEXT,
  difficulty TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Questions are viewable by authenticated users" ON public.questions
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE INDEX idx_questions_topic ON public.questions(topic_id);
CREATE INDEX idx_questions_difficulty ON public.questions(difficulty);

-- =====================================================
-- USER QUESTION PROGRESS TABLE
-- =====================================================
CREATE TABLE public.user_question_progress (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES public.topics(id) ON DELETE CASCADE,
  is_correct BOOLEAN,
  attempts INTEGER DEFAULT 1,
  last_attempted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, question_id)
);

ALTER TABLE public.user_question_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own progress" ON public.user_question_progress
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own progress" ON public.user_question_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own progress" ON public.user_question_progress
  FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX idx_user_progress_user ON public.user_question_progress(user_id);
CREATE INDEX idx_user_progress_topic ON public.user_question_progress(topic_id);

-- =====================================================
-- BOOKMARKS TABLE
-- =====================================================
CREATE TABLE public.bookmarks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES public.topics(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, question_id)
);

ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own bookmarks" ON public.bookmarks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own bookmarks" ON public.bookmarks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own bookmarks" ON public.bookmarks
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_bookmarks_user ON public.bookmarks(user_id);

-- =====================================================
-- MOCK TESTS TABLE
-- =====================================================
CREATE TABLE public.mock_tests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER DEFAULT 90,
  question_count INTEGER DEFAULT 100,
  passing_score INTEGER DEFAULT 50,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.mock_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Mock tests are viewable by authenticated users" ON public.mock_tests
  FOR SELECT USING (auth.role() = 'authenticated');

-- =====================================================
-- MOCK TEST ATTEMPTS TABLE
-- =====================================================
CREATE TABLE public.mock_test_attempts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  mock_test_id TEXT REFERENCES public.mock_tests(id) ON DELETE CASCADE,
  score INTEGER DEFAULT 0,
  total_questions INTEGER NOT NULL,
  correct_answers INTEGER DEFAULT 0,
  time_taken_seconds INTEGER,
  is_passed BOOLEAN DEFAULT false,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  answers JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public.mock_test_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own attempts" ON public.mock_test_attempts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own attempts" ON public.mock_test_attempts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own attempts" ON public.mock_test_attempts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX idx_mock_attempts_user ON public.mock_test_attempts(user_id);
CREATE INDEX idx_mock_attempts_test ON public.mock_test_attempts(mock_test_id);

-- =====================================================
-- FLASHCARD PROGRESS TABLE
-- =====================================================
CREATE TABLE public.flashcard_progress (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'learning', 'review', 'mastered')),
  review_count INTEGER DEFAULT 0,
  last_reviewed_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, question_id)
);

ALTER TABLE public.flashcard_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own flashcards" ON public.flashcard_progress
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_flashcards_user ON public.flashcard_progress(user_id);
CREATE INDEX idx_flashcards_next_review ON public.flashcard_progress(next_review_at);

-- =====================================================
-- USER SETTINGS TABLE
-- =====================================================
CREATE TABLE public.user_settings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  dark_mode BOOLEAN DEFAULT true,
  sound_effects BOOLEAN DEFAULT true,
  notifications_enabled BOOLEAN DEFAULT true,
  email_reminders BOOLEAN DEFAULT false,
  questions_per_session INTEGER DEFAULT 20,
  auto_advance BOOLEAN DEFAULT false,
  show_explanations BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id);

-- =====================================================
-- STUDY SESSIONS TABLE
-- =====================================================
CREATE TABLE public.study_sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES public.topics(id) ON DELETE SET NULL,
  session_type TEXT DEFAULT 'practice',
  questions_answered INTEGER DEFAULT 0,
  correct_answers INTEGER DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sessions" ON public.study_sessions
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_sessions_user ON public.study_sessions(user_id);
CREATE INDEX idx_sessions_started ON public.study_sessions(started_at);

-- =====================================================
-- VIEWS FOR STATISTICS
-- =====================================================

-- User topic statistics view
CREATE OR REPLACE VIEW public.user_topic_stats AS
SELECT 
  uqp.user_id,
  uqp.topic_id,
  t.name as topic_name,
  COUNT(DISTINCT uqp.question_id) as total_questions_attempted,
  COUNT(DISTINCT CASE WHEN uqp.is_correct THEN uqp.question_id END) as total_correct_answers,
  t.question_count as total_questions,
  ROUND(
    (COUNT(DISTINCT uqp.question_id)::NUMERIC / NULLIF(t.question_count, 0)) * 100, 2
  ) as completion_percentage,
  ROUND(
    (COUNT(DISTINCT CASE WHEN uqp.is_correct THEN uqp.question_id END)::NUMERIC / 
    NULLIF(COUNT(DISTINCT uqp.question_id), 0)) * 100, 2
  ) as accuracy_percentage
FROM public.user_question_progress uqp
JOIN public.topics t ON t.id = uqp.topic_id
GROUP BY uqp.user_id, uqp.topic_id, t.name, t.question_count;

-- User overall statistics view
CREATE OR REPLACE VIEW public.user_overall_stats AS
SELECT 
  u.id as user_id,
  COALESCE(pr.streak_days, 0) as streak_days,
  COALESCE(pr.rank, 'Beginner') as rank,
  COALESCE(qp.total_attempted, 0) as total_questions_attempted,
  COALESCE(qp.total_correct, 0) as total_correct_answers,
  COALESCE(ss.total_seconds, 0) as total_study_time_seconds,
  CASE 
    WHEN COALESCE(qp.total_attempted, 0) > 0 
    THEN ROUND((COALESCE(qp.total_correct, 0)::NUMERIC / qp.total_attempted) * 100, 2)
    ELSE 0 
  END as accuracy_percentage,
  COALESCE(ts.topics_started, 0) as topics_started
FROM auth.users u
LEFT JOIN public.profiles pr ON u.id = pr.id
LEFT JOIN (
  SELECT user_id, 
    COUNT(*) as total_attempted, 
    COUNT(CASE WHEN is_correct THEN 1 END) as total_correct
  FROM public.user_question_progress
  GROUP BY user_id
) qp ON u.id = qp.user_id
LEFT JOIN (
  SELECT user_id, SUM(duration_seconds) as total_seconds
  FROM public.study_sessions
  GROUP BY user_id
) ss ON u.id = ss.user_id
LEFT JOIN (
  SELECT user_id, COUNT(DISTINCT topic_id) as topics_started
  FROM public.user_question_progress
  GROUP BY user_id
) ts ON u.id = ts.user_id;

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to update user streak
CREATE OR REPLACE FUNCTION public.update_user_streak()
RETURNS TRIGGER AS $$
DECLARE
  last_date DATE;
BEGIN
  SELECT last_activity_date INTO last_date
  FROM public.profiles WHERE id = NEW.user_id;
  
  IF last_date IS NULL OR last_date < CURRENT_DATE - INTERVAL '1 day' THEN
    UPDATE public.profiles 
    SET streak_days = 1, last_activity_date = CURRENT_DATE, updated_at = NOW()
    WHERE id = NEW.user_id;
  ELSIF last_date < CURRENT_DATE THEN
    UPDATE public.profiles 
    SET streak_days = streak_days + 1, last_activity_date = CURRENT_DATE, updated_at = NOW()
    WHERE id = NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update streak on study session
CREATE TRIGGER on_study_session_created
  AFTER INSERT ON public.study_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_user_streak();

-- =====================================================
-- SEED DATA: TOPICS
-- =====================================================
INSERT INTO public.topics (id, name, short_name, description, icon, color, question_count, data_file, display_order) VALUES
('programming-language', 'Programming Language and Its Application', 'Programming', 'C, C++, Java fundamentals and OOP concepts', 'Code', '#6366f1', 0, 'programming-language-and-its-application.json', 1),
('data-structures', 'Data Structures, Algorithm, Database & OS', 'DSA & DB', 'Arrays, linked lists, trees, SQL, and operating systems', 'Database', '#8b5cf6', 0, 'data-structures-and-algorithm-database-system-and-operating-system.json', 2),
('digital-logic', 'Digital Logic and Microprocessor', 'Digital Logic', 'Boolean algebra, logic gates, and microprocessor architecture', 'Cpu', '#ec4899', 0, 'digital-logic-and-microprocessor.json', 3),
('computer-network', 'Computer Network and Network Security', 'Networks', 'OSI model, TCP/IP, protocols, and security concepts', 'Network', '#14b8a6', 0, 'concept-of-computer-network-and-network-security-system.json', 4),
('software-engineering', 'Software Engineering and OOAD', 'Software Eng', 'SDLC, UML, design patterns, and testing methodologies', 'Settings', '#f59e0b', 0, 'software-engineering-and-object-oriented-analysis-and-design.json', 5),
('computer-organization', 'Computer Organization and Embedded Systems', 'Comp Org', 'CPU architecture, memory systems, and embedded programming', 'HardDrive', '#ef4444', 0, 'computer-organization-and-embedded-system.json', 6),
('ai-neural-networks', 'Artificial Intelligence and Neural Networks', 'AI & ML', 'Machine learning, neural networks, and AI fundamentals', 'Brain', '#10b981', 0, 'artificial-intelligence-and-neural-networks.json', 7),
('theory-computation', 'Theory of Computation and Computer Graphics', 'Theory & Graphics', 'Automata, formal languages, and graphics algorithms', 'Palette', '#6366f1', 0, 'theory-of-computation-and-computer-graphics.json', 8),
('electrical-electronics', 'Basic Electrical and Electronics Engineering', 'Electronics', 'Circuit analysis, semiconductors, and digital electronics', 'Zap', '#f97316', 0, 'concept-of-basic-electrical-and-electronics-engineering.json', 9),
('project-planning', 'Project Planning, Design and Implementation', 'Project Mgmt', 'Project management, documentation, and implementation', 'ClipboardList', '#84cc16', 0, 'project-planning-design-and-implementation.json', 10);

-- =====================================================
-- SEED DATA: MOCK TESTS
-- =====================================================
INSERT INTO public.mock_tests (id, name, description, duration_minutes, question_count, passing_score) VALUES
('full-mock-1', 'Full Mock Test 1', 'Complete exam simulation with questions from all topics', 90, 100, 50),
('full-mock-2', 'Full Mock Test 2', 'Second full-length practice exam', 90, 100, 50),
('quick-test', 'Quick Assessment', 'Short 30-question test to assess your knowledge', 30, 30, 15);

-- =====================================================
-- DONE! Your database is ready.
-- Next: Use seed.py to load questions from your JSON files
-- =====================================================
