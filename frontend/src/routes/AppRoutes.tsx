import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from '../pages/Landing';

// Landing is the entry point and stays in the initial chunk. Everything behind
// /app is split, so a visitor who never signs in never downloads the app, and
// opening a quiz does not pull in the dashboard, flashcards and progress charts.
const AppShell                 = lazy(() => import('../layout/AppShell'));
const Dashboard                = lazy(() => import('../pages/app/Dashboard'));
const PracticeHub              = lazy(() => import('../pages/app/PracticeHub'));
const ChapterPracticeSelector  = lazy(() => import('../pages/app/ChapterPracticeSelector'));
const TopicPractice            = lazy(() => import('../pages/app/TopicPractice'));
const MockTests                = lazy(() => import('../pages/app/MockTests'));
const MockTestDetail           = lazy(() => import('../pages/app/MockTestDetail'));
const MockTestQuiz             = lazy(() => import('../pages/app/MockTestQuiz'));
const QuickPractice            = lazy(() => import('../pages/app/QuickPractice'));
const CustomPractice           = lazy(() => import('../pages/app/CustomPractice'));
const StudyHub                 = lazy(() => import('../pages/app/StudyHub'));
const TopicStudy               = lazy(() => import('../pages/app/TopicStudy'));
const Flashcards               = lazy(() => import('../pages/app/Flashcards'));
const Bookmarks                = lazy(() => import('../pages/app/Bookmarks'));
const Progress                 = lazy(() => import('../pages/app/Progress'));
const Profile                  = lazy(() => import('../pages/app/Profile'));
const Settings                 = lazy(() => import('../pages/app/Settings'));
const BookPractice             = lazy(() => import('../pages/app/BookPractice'));

function RouteFallback() {
  return (
    <div className="loading-container" role="status" aria-live="polite">
      <div className="loading-spinner" />
      <p>Loading…</p>
    </div>
  );
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="practice" element={<PracticeHub />} />
          <Route path="practice/chapter/:chapterId" element={<ChapterPracticeSelector />} />
          <Route path="practice/topic/:topicId" element={<TopicPractice />} />
          <Route path="practice/quick" element={<QuickPractice />} />
          <Route path="practice/custom" element={<CustomPractice />} />
          <Route path="mock-tests" element={<MockTests />} />
          <Route path="mock-tests/:testId" element={<MockTestDetail />} />
          <Route path="mock-tests/:testId/quiz" element={<MockTestQuiz />} />
          <Route path="study" element={<StudyHub />} />
          <Route path="study/topic/:topicId" element={<TopicStudy />} />
          <Route path="flashcards" element={<Flashcards />} />
          <Route path="bookmarks" element={<Bookmarks />} />
          <Route path="books" element={<BookPractice />} />
          <Route path="progress" element={<Progress />} />
          <Route path="profile" element={<Profile />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
