-- =====================================================
-- Engineering License Exam Prep - Database Schema
-- =====================================================
-- Run this SQL in Supabase SQL Editor to create all tables
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- PROFILES TABLE (extends Supabase auth.users)
-- =====================================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    streak_days INTEGER DEFAULT 0,
    last_activity_date DATE,
    total_study_time_minutes INTEGER DEFAULT 0,
    rank TEXT DEFAULT 'Beginner',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create profile automatically when user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =====================================================
-- TOPICS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    description TEXT,
    icon TEXT DEFAULT 'book',
    color TEXT DEFAULT '#6366f1',
    question_count INTEGER DEFAULT 0,
    data_file TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- QUESTIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    option_1 TEXT NOT NULL,
    option_2 TEXT NOT NULL,
    option_3 TEXT NOT NULL,
    option_4 TEXT NOT NULL,
    correct_option TEXT NOT NULL,
    correct_option_index INTEGER NOT NULL CHECK (correct_option_index >= 0 AND correct_option_index <= 3),
    explanation TEXT,
    difficulty TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_questions_topic ON questions(topic_id);
CREATE INDEX idx_questions_difficulty ON questions(difficulty);

-- =====================================================
-- USER QUESTION PROGRESS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS user_question_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    is_correct BOOLEAN,
    attempts INTEGER DEFAULT 1,
    last_attempted_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, question_id)
);

CREATE INDEX idx_progress_user ON user_question_progress(user_id);
CREATE INDEX idx_progress_topic ON user_question_progress(topic_id);

-- =====================================================
-- BOOKMARKS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS bookmarks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, question_id)
);

CREATE INDEX idx_bookmarks_user ON bookmarks(user_id);

-- =====================================================
-- MOCK TESTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS mock_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    question_count INTEGER NOT NULL DEFAULT 50,
    passing_score INTEGER NOT NULL DEFAULT 60,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- MOCK TEST ATTEMPTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS mock_test_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    mock_test_id UUID NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
    score INTEGER DEFAULT 0,
    total_questions INTEGER NOT NULL,
    correct_answers INTEGER DEFAULT 0,
    answers JSONB DEFAULT '{}',
    is_passed BOOLEAN DEFAULT false,
    time_taken_seconds INTEGER,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_attempts_user ON mock_test_attempts(user_id);
CREATE INDEX idx_attempts_test ON mock_test_attempts(mock_test_id);

-- =====================================================
-- FLASHCARD PROGRESS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS flashcard_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'learning', 'review', 'mastered')),
    review_count INTEGER DEFAULT 0,
    last_reviewed_at TIMESTAMPTZ,
    next_review_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, question_id)
);

CREATE INDEX idx_flashcards_user ON flashcard_progress(user_id);
CREATE INDEX idx_flashcards_next_review ON flashcard_progress(next_review_at);

-- =====================================================
-- USER SETTINGS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS user_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    daily_goal_minutes INTEGER DEFAULT 30,
    notification_enabled BOOLEAN DEFAULT true,
    theme TEXT DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- STUDY SESSIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS study_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    session_type TEXT DEFAULT 'practice',
    questions_answered INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user ON study_sessions(user_id);
CREATE INDEX idx_sessions_started ON study_sessions(started_at);

-- =====================================================
-- VIEWS FOR STATISTICS
-- =====================================================

-- User topic statistics view
CREATE OR REPLACE VIEW user_topic_stats AS
SELECT 
    p.user_id,
    p.topic_id,
    t.name as topic_name,
    COUNT(p.id) as total_questions_attempted,
    COUNT(CASE WHEN p.is_correct THEN 1 END) as total_correct_answers,
    t.question_count as total_questions,
    CASE 
        WHEN t.question_count > 0 
        THEN ROUND((COUNT(p.id)::NUMERIC / t.question_count) * 100, 2)
        ELSE 0 
    END as completion_percentage,
    CASE 
        WHEN COUNT(p.id) > 0 
        THEN ROUND((COUNT(CASE WHEN p.is_correct THEN 1 END)::NUMERIC / COUNT(p.id)) * 100, 2)
        ELSE 0 
    END as accuracy_percentage
FROM user_question_progress p
JOIN topics t ON p.topic_id = t.id
GROUP BY p.user_id, p.topic_id, t.name, t.question_count;

-- User overall statistics view
CREATE OR REPLACE VIEW user_overall_stats AS
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
LEFT JOIN profiles pr ON u.id = pr.id
LEFT JOIN (
    SELECT user_id, COUNT(*) as total_attempted, COUNT(CASE WHEN is_correct THEN 1 END) as total_correct
    FROM user_question_progress
    GROUP BY user_id
) qp ON u.id = qp.user_id
LEFT JOIN (
    SELECT user_id, SUM(duration_seconds) as total_seconds
    FROM study_sessions
    GROUP BY user_id
) ss ON u.id = ss.user_id
LEFT JOIN (
    SELECT user_id, COUNT(DISTINCT topic_id) as topics_started
    FROM user_question_progress
    GROUP BY user_id
) ts ON u.id = ts.user_id;

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all user-related tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_question_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcard_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Question progress policies
CREATE POLICY "Users can view own progress" ON user_question_progress FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own progress" ON user_question_progress FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own progress" ON user_question_progress FOR UPDATE USING (auth.uid() = user_id);

-- Bookmarks policies
CREATE POLICY "Users can view own bookmarks" ON bookmarks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own bookmarks" ON bookmarks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own bookmarks" ON bookmarks FOR DELETE USING (auth.uid() = user_id);

-- Mock test attempts policies
CREATE POLICY "Users can view own attempts" ON mock_test_attempts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own attempts" ON mock_test_attempts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own attempts" ON mock_test_attempts FOR UPDATE USING (auth.uid() = user_id);

-- Flashcard progress policies
CREATE POLICY "Users can view own flashcards" ON flashcard_progress FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own flashcards" ON flashcard_progress FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own flashcards" ON flashcard_progress FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own flashcards" ON flashcard_progress FOR DELETE USING (auth.uid() = user_id);

-- User settings policies
CREATE POLICY "Users can view own settings" ON user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON user_settings FOR UPDATE USING (auth.uid() = user_id);

-- Study sessions policies
CREATE POLICY "Users can view own sessions" ON study_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sessions" ON study_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON study_sessions FOR UPDATE USING (auth.uid() = user_id);

-- Public read access for topics, questions, mock_tests
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Topics are viewable by everyone" ON topics FOR SELECT USING (true);
CREATE POLICY "Questions are viewable by everyone" ON questions FOR SELECT USING (true);
CREATE POLICY "Mock tests are viewable by everyone" ON mock_tests FOR SELECT USING (true);

-- =====================================================
-- DONE! Your database is ready.
-- =====================================================
