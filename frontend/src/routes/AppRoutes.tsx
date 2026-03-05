import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from '../pages/Landing';
import AppShell from '../layout/AppShell';
import Dashboard from '../pages/app/Dashboard';
import PracticeHub from '../pages/app/PracticeHub';
import ChapterPracticeSelector from '../pages/app/ChapterPracticeSelector';
import TopicPractice from '../pages/app/TopicPractice';
import MockTests from '../pages/app/MockTests';
import MockTestDetail from '../pages/app/MockTestDetail';
import MockTestQuiz from '../pages/app/MockTestQuiz';
import QuickPractice from '../pages/app/QuickPractice';
import CustomPractice from '../pages/app/CustomPractice';
import StudyHub from '../pages/app/StudyHub';
import TopicStudy from '../pages/app/TopicStudy';
import Flashcards from '../pages/app/Flashcards';
import Bookmarks from '../pages/app/Bookmarks';
import Progress from '../pages/app/Progress';
import Profile from '../pages/app/Profile';
import Settings from '../pages/app/Settings';
import BookPractice from '../pages/app/BookPractice';

export default function AppRoutes() {
  return (
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
  );
}
