import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from '../auth/RequireAuth';
import AppShell from '../layout/AppShell';

// Public pages
import Landing from '../pages/Landing';
import Login from '../pages/auth/Login';
import Diagnostic from '../pages/Diagnostic';

// App pages
import Dashboard from '../pages/app/Dashboard';
import PracticeHub from '../pages/app/PracticeHub';
import ChapterPracticeSelector from '../pages/app/ChapterPracticeSelector';
import TopicPractice from '../pages/app/TopicPractice';
import MockTests from '../pages/app/MockTests';
import MockTestDetail from '../pages/app/MockTestDetail';
import StudyHub from '../pages/app/StudyHub';
import TopicStudy from '../pages/app/TopicStudy';
import Flashcards from '../pages/app/Flashcards';
import Progress from '../pages/app/Progress';
import Bookmarks from '../pages/app/Bookmarks';
import Profile from '../pages/app/Profile';
import Settings from '../pages/app/Settings';

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Landing />} />
      <Route path="/auth/login" element={<Login />} />
      <Route path="/diagnostic" element={<Diagnostic />} />
      
      {/* Legacy redirect for old signin route */}
      <Route path="/signin" element={<Navigate to="/auth/login" replace />} />
      <Route path="/dashboard" element={<Navigate to="/app" replace />} />

      {/* Protected app routes */}
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        {/* Dashboard */}
        <Route index element={<Dashboard />} />
        
        {/* Practice routes */}
        <Route path="practice" element={<PracticeHub />} />
        <Route path="practice/chapter/:chapterId" element={<ChapterPracticeSelector />} />
        <Route path="practice/topic/:topicId" element={<TopicPractice />} />
        <Route path="practice/mock-tests" element={<MockTests />} />
        <Route path="practice/mock-tests/:testId" element={<MockTestDetail />} />
        
        {/* Study routes */}
        <Route path="study" element={<StudyHub />} />
        <Route path="study/topic/:topicId" element={<TopicStudy />} />
        
        {/* Other app routes */}
        <Route path="flashcards" element={<Flashcards />} />
        <Route path="progress" element={<Progress />} />
        <Route path="bookmarks" element={<Bookmarks />} />
        <Route path="profile" element={<Profile />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* Catch all - redirect to landing */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
