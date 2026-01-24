import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  BookOpen, 
  Brain, 
  LayoutDashboard, 
  LogOut, 
  Menu, 
  X, 
  ChevronRight,
  Target,
  Clock,
  TrendingUp,
  Award,
  BookMarked,
  FileQuestion,
  BarChart3,
  Calendar,
  Bell,
  Settings,
  User
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type ViewMode = 'dashboard' | 'study' | 'practice';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/');
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  const sidebarItems = [
    { id: 'dashboard' as ViewMode, icon: <LayoutDashboard className="w-5 h-5" />, label: 'Dashboard' },
    { id: 'study' as ViewMode, icon: <BookOpen className="w-5 h-5" />, label: 'Study' },
    { id: 'practice' as ViewMode, icon: <FileQuestion className="w-5 h-5" />, label: 'Practice' },
  ];

  const subjects = [
    { name: 'Artificial Intelligence & Neural Networks', progress: 45, questions: 150 },
    { name: 'Computer Organization & Embedded System', progress: 30, questions: 120 },
    { name: 'Basic Electrical & Electronics', progress: 60, questions: 100 },
    { name: 'Computer Network & Security', progress: 25, questions: 130 },
    { name: 'Data Structures & Algorithms', progress: 55, questions: 180 },
    { name: 'Digital Logic & Microprocessor', progress: 40, questions: 110 },
    { name: 'Programming Languages', progress: 70, questions: 200 },
    { name: 'Project Planning & Implementation', progress: 35, questions: 90 },
    { name: 'Software Engineering & OOAD', progress: 50, questions: 140 },
    { name: 'Theory of Computation & Graphics', progress: 20, questions: 160 },
  ];

  const recentActivity = [
    { type: 'practice', subject: 'Programming Languages', score: 85, time: '2 hours ago' },
    { type: 'study', subject: 'Data Structures', duration: '45 min', time: '5 hours ago' },
    { type: 'practice', subject: 'Computer Networks', score: 72, time: '1 day ago' },
    { type: 'study', subject: 'AI & Neural Networks', duration: '1 hr', time: '2 days ago' },
  ];

  const renderDashboard = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="dashboard-content"
    >
      {/* Welcome Section */}
      <div className="welcome-section">
        <div className="welcome-text">
          <h1>Welcome back, {user?.displayName?.split(' ')[0] || 'Engineer'}! 👋</h1>
          <p>Ready to continue your preparation journey?</p>
        </div>
        <div className="welcome-date">
          <Calendar className="w-5 h-5" />
          <span>{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats-grid">
        <motion.div 
          className="stat-card"
          whileHover={{ scale: 1.02, borderColor: 'rgba(99, 102, 241, 0.5)' }}
        >
          <div className="stat-icon stat-icon-purple">
            <Target className="w-6 h-6" />
          </div>
          <div className="stat-info">
            <span className="stat-value">1,234</span>
            <span className="stat-label">Questions Attempted</span>
          </div>
        </motion.div>

        <motion.div 
          className="stat-card"
          whileHover={{ scale: 1.02, borderColor: 'rgba(34, 197, 94, 0.5)' }}
        >
          <div className="stat-icon stat-icon-green">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div className="stat-info">
            <span className="stat-value">78%</span>
            <span className="stat-label">Accuracy Rate</span>
          </div>
        </motion.div>

        <motion.div 
          className="stat-card"
          whileHover={{ scale: 1.02, borderColor: 'rgba(251, 191, 36, 0.5)' }}
        >
          <div className="stat-icon stat-icon-yellow">
            <Clock className="w-6 h-6" />
          </div>
          <div className="stat-info">
            <span className="stat-value">42h</span>
            <span className="stat-label">Study Time</span>
          </div>
        </motion.div>

        <motion.div 
          className="stat-card"
          whileHover={{ scale: 1.02, borderColor: 'rgba(236, 72, 153, 0.5)' }}
        >
          <div className="stat-icon stat-icon-pink">
            <Award className="w-6 h-6" />
          </div>
          <div className="stat-info">
            <span className="stat-value">7</span>
            <span className="stat-label">Subjects Covered</span>
          </div>
        </motion.div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <h2>Quick Actions</h2>
        <div className="action-cards">
          <motion.div 
            className="action-card action-study"
            onClick={() => setCurrentView('study')}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
          >
            <BookOpen className="w-12 h-12" />
            <h3>Study Materials</h3>
            <p>Access comprehensive study guides and notes</p>
            <ChevronRight className="action-arrow" />
          </motion.div>

          <motion.div 
            className="action-card action-practice"
            onClick={() => setCurrentView('practice')}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
          >
            <FileQuestion className="w-12 h-12" />
            <h3>Practice Questions</h3>
            <p>Test your knowledge with 10,000+ questions</p>
            <ChevronRight className="action-arrow" />
          </motion.div>
        </div>
      </div>

      {/* Progress Overview */}
      <div className="progress-section">
        <div className="section-header">
          <h2>Subject Progress</h2>
          <button className="btn-view-all">View All</button>
        </div>
        <div className="progress-grid">
          {subjects.slice(0, 4).map((subject, index) => (
            <motion.div 
              key={index}
              className="progress-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ borderColor: 'rgba(99, 102, 241, 0.5)' }}
            >
              <h4>{subject.name}</h4>
              <div className="progress-bar-container">
                <div 
                  className="progress-bar-fill"
                  style={{ width: `${subject.progress}%` }}
                ></div>
              </div>
              <div className="progress-info">
                <span>{subject.progress}% Complete</span>
                <span>{subject.questions} Questions</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="activity-section">
        <div className="section-header">
          <h2>Recent Activity</h2>
        </div>
        <div className="activity-list">
          {recentActivity.map((activity, index) => (
            <motion.div 
              key={index}
              className="activity-item"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <div className={`activity-icon ${activity.type === 'practice' ? 'practice' : 'study'}`}>
                {activity.type === 'practice' ? <FileQuestion className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
              </div>
              <div className="activity-details">
                <span className="activity-title">
                  {activity.type === 'practice' ? 'Practiced' : 'Studied'} {activity.subject}
                </span>
                <span className="activity-meta">
                  {activity.type === 'practice' ? `Score: ${activity.score}%` : `Duration: ${activity.duration}`}
                </span>
              </div>
              <span className="activity-time">{activity.time}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );

  const renderStudy = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="study-content"
    >
      <div className="page-header">
        <h1><BookMarked className="w-8 h-8" /> Study Materials</h1>
        <p>Choose a subject to start studying</p>
      </div>

      <div className="subjects-grid">
        {subjects.map((subject, index) => (
          <motion.div
            key={index}
            className="subject-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            whileHover={{ scale: 1.02, borderColor: 'rgba(99, 102, 241, 0.5)' }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="subject-icon">
              <BookOpen className="w-8 h-8" />
            </div>
            <h3>{subject.name}</h3>
            <div className="subject-progress">
              <div className="progress-bar-container">
                <div 
                  className="progress-bar-fill"
                  style={{ width: `${subject.progress}%` }}
                ></div>
              </div>
              <span>{subject.progress}% Complete</span>
            </div>
            <button className="btn-continue">
              Continue Learning
              <ChevronRight className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );

  const renderPractice = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="practice-content"
    >
      <div className="page-header">
        <h1><Brain className="w-8 h-8" /> Practice Questions</h1>
        <p>Select a subject or take a mixed quiz</p>
      </div>

      {/* Practice Modes */}
      <div className="practice-modes">
        <motion.div 
          className="mode-card mode-quick"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Clock className="w-10 h-10" />
          <h3>Quick Quiz</h3>
          <p>10 random questions, 10 minutes</p>
          <button className="btn-start">Start Quiz</button>
        </motion.div>

        <motion.div 
          className="mode-card mode-full"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <BarChart3 className="w-10 h-10" />
          <h3>Full Mock Test</h3>
          <p>100 questions, simulate real exam</p>
          <button className="btn-start">Start Test</button>
        </motion.div>

        <motion.div 
          className="mode-card mode-custom"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Target className="w-10 h-10" />
          <h3>Custom Practice</h3>
          <p>Choose subjects and difficulty</p>
          <button className="btn-start">Customize</button>
        </motion.div>
      </div>

      {/* Subject-wise Practice */}
      <div className="subject-practice">
        <h2>Practice by Subject</h2>
        <div className="subjects-grid">
          {subjects.map((subject, index) => (
            <motion.div
              key={index}
              className="subject-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              whileHover={{ scale: 1.02, borderColor: 'rgba(99, 102, 241, 0.5)' }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="subject-icon">
                <FileQuestion className="w-8 h-8" />
              </div>
              <h3>{subject.name}</h3>
              <div className="subject-stats">
                <span>{subject.questions} Questions</span>
                <span>•</span>
                <span>{subject.progress}% Mastered</span>
              </div>
              <button className="btn-practice">
                Practice Now
                <ChevronRight className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className="dashboard-page">
      {/* Sidebar */}
      <motion.aside
        className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}
        initial={false}
        animate={{ width: sidebarOpen ? 280 : 80 }}
        transition={{ duration: 0.3 }}
      >
        <div className="sidebar-header">
          <motion.div 
            className="sidebar-logo"
            animate={{ opacity: sidebarOpen ? 1 : 0 }}
          >
            <Brain className="w-8 h-8 text-indigo-500" />
            {sidebarOpen && <span>EngLicense</span>}
          </motion.div>
          <button 
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        <nav className="sidebar-nav">
          {sidebarItems.map((item) => (
            <motion.button
              key={item.id}
              className={`nav-item ${currentView === item.id ? 'active' : ''}`}
              onClick={() => setCurrentView(item.id)}
              whileHover={{ backgroundColor: 'rgba(99, 102, 241, 0.1)' }}
              whileTap={{ scale: 0.98 }}
            >
              {item.icon}
              {sidebarOpen && <span>{item.label}</span>}
            </motion.button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <motion.button
            className="nav-item logout"
            onClick={handleLogout}
            whileHover={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
            whileTap={{ scale: 0.98 }}
          >
            <LogOut className="w-5 h-5" />
            {sidebarOpen && <span>Logout</span>}
          </motion.button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Top Bar */}
        <header className="top-bar">
          <div className="search-container">
            <input 
              type="text" 
              placeholder="Search subjects, questions..." 
              className="search-input"
            />
          </div>
          <div className="top-bar-actions">
            <motion.button 
              className="icon-btn"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <Bell className="w-5 h-5" />
            </motion.button>
            <motion.button 
              className="icon-btn"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <Settings className="w-5 h-5" />
            </motion.button>
            <div className="user-profile">
              {user?.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || 'User'} className="user-avatar" />
              ) : (
                <div className="user-avatar-placeholder">
                  <User className="w-5 h-5" />
                </div>
              )}
              <span className="user-name">{user?.displayName?.split(' ')[0]}</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="page-content">
          <AnimatePresence mode="wait">
            {currentView === 'dashboard' && renderDashboard()}
            {currentView === 'study' && renderStudy()}
            {currentView === 'practice' && renderPractice()}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
