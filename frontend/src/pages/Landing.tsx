import { useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, BookOpen, Trophy, Users } from 'lucide-react';
import ThreeBackground from '../components/ThreeBackground';
import { useUser } from '../context/UserContext';

// Inline brand icon — matches the favicon book+checkmark design
function NECPrepIcon({ small }: { small?: boolean }) {
  const size = small ? 24 : 32;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#4F46E5"/>
      <path d="M16 9 C13 9 10 10 8 11.5 L8 23 C10 21.5 13 21 16 21 C19 21 22 21.5 24 23 L24 11.5 C22 10 19 9 16 9Z" fill="none" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
      <line x1="16" y1="9" x2="16" y2="21" stroke="white" strokeWidth="1.5"/>
      <circle cx="11" cy="15" r="1" fill="white" opacity="0.7"/>
      <circle cx="13.5" cy="13" r="1" fill="white" opacity="0.7"/>
      <line x1="11" y1="15" x2="13.5" y2="13" stroke="white" strokeWidth="0.8" opacity="0.7"/>
      <circle cx="24" cy="24" r="5" fill="#22C55E"/>
      <polyline points="21.5,24 23.2,25.8 26.5,22.5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { setName } = useUser();
  const [isNamePortalOpen, setIsNamePortalOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [portalError, setPortalError] = useState('');

  const features = [
    {
      icon: <BookOpen className="w-8 h-8" />,
      title: 'Comprehensive Study Materials',
      description: 'Access curated content covering all engineering license exam topics.'
    },
    {
      icon: <Trophy className="w-8 h-8" />,
      title: 'Smart Practice',
      description: 'Practice with curated question banks and get instant feedback.'
    },
    {
      icon: <ArrowRight className="w-8 h-8" />,
      title: 'Track Your Progress',
      description: 'Monitor your improvement with detailed analytics and insights.'
    },
    {
      icon: <Users className="w-8 h-8" />,
      title: 'Community Support',
      description: 'Join thousands of engineers preparing for their license exam.'
    }
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2
      }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        duration: 0.5
      }
    }
  };

  const openNamePortal = () => {
    setIsNamePortalOpen(true);
    setPortalError('');
  };

  const closeNamePortal = () => {
    setIsNamePortalOpen(false);
    setPortalError('');
  };

  const handleNamePortalSubmit = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setPortalError('Please enter your name so we can guide you.');
      return;
    }

    setName(trimmed);
    closeNamePortal();
    setNameInput('');
    navigate('/app');
  };

  const handlePortalKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleNamePortalSubmit();
    }
  };

  return (
    <div className="landing-page">
      <ThreeBackground />
      
      {/* Navigation */}
      <nav className="nav-container">
        <div className="nav-content">
          <motion.div 
            className="logo"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <NECPrepIcon />
            <span className="logo-text">NECPrep</span>
          </motion.div>
          
          <motion.button
            className="btn-signin"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            onClick={() => navigate('/auth/login')}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Sign In
          </motion.button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero-section">
        <motion.div
          className="hero-content"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <motion.span 
            className="hero-badge"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            🎯 Nepal Engineering Council License Exam Prep
          </motion.span>
          
          <motion.h1 
            className="hero-title"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
          >
            Master Your
            <span className="gradient-text"> NEC License </span>
            Exam
          </motion.h1>
          
          <motion.p 
            className="hero-description"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
          >
            The most comprehensive platform to study, practice, and ace your 
            NEC license examination. Powered by proven study methods, built by engineers, for engineers.
          </motion.p>
          
          <motion.div 
            className="hero-buttons"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
          >
            <motion.button
              className="btn-primary"
              onClick={openNamePortal}
              whileHover={{ scale: 1.05, boxShadow: '0 0 30px rgba(99, 102, 241, 0.5)' }}
              whileTap={{ scale: 0.95 }}
            >
              Get Started Free
              <ArrowRight className="w-5 h-5 ml-2" />
            </motion.button>
            
            <motion.button
              className="btn-secondary"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Learn More
            </motion.button>
          </motion.div>
        </motion.div>
      </section>

      {/* Features Section */}
      <section className="features-section">
        <motion.div
          className="features-container"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
        >
          <motion.h2 className="features-title" variants={itemVariants}>
            Everything You Need to Succeed
          </motion.h2>
          
          <div className="features-grid">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                className="feature-card"
                variants={itemVariants}
                whileHover={{ 
                  scale: 1.05, 
                  borderColor: 'rgba(99, 102, 241, 0.5)',
                  boxShadow: '0 0 30px rgba(99, 102, 241, 0.2)'
                }}
              >
                <div className="feature-icon">{feature.icon}</div>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-description">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Stats Section */}
      <section className="stats-section">
        <motion.div
          className="stats-container"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="stat-item">
            <span className="stat-number">10,000+</span>
            <span className="stat-label">Practice Questions</span>
          </div>
          <div className="stat-divider"></div>
          <div className="stat-item">
            <span className="stat-number">95%</span>
            <span className="stat-label">Pass Rate</span>
          </div>
          <div className="stat-divider"></div>
          <div className="stat-item">
            <span className="stat-number">5,000+</span>
            <span className="stat-label">Students</span>
          </div>
          <div className="stat-divider"></div>
          <div className="stat-item">
            <span className="stat-number">12</span>
            <span className="stat-label">Subject Areas</span>
          </div>
        </motion.div>
      </section>

      {/* CTA Section */}
      <section className="cta-section">
        <motion.div
          className="cta-container"
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="cta-title">Ready to Start Your Journey?</h2>
          <p className="cta-description">
            Join thousands of engineers who have successfully passed their license exam with our platform.
          </p>
          <motion.button
            className="btn-primary btn-large"
            onClick={openNamePortal}
            whileHover={{ scale: 1.05, boxShadow: '0 0 40px rgba(99, 102, 241, 0.6)' }}
            whileTap={{ scale: 0.95 }}
          >
            Start Preparing Now
            <ArrowRight className="w-5 h-5 ml-2" />
          </motion.button>
        </motion.div>
      </section>

      {isNamePortalOpen && (
        <div className="name-portal-overlay" role="dialog" aria-modal="true" aria-label="Welcome portal">
          <motion.div
            className="name-portal-card"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <button
              className="name-portal-close"
              type="button"
              aria-label="Close portal"
              onClick={closeNamePortal}
            >
              &times;
            </button>

            <div className="name-portal-header">
              <h3>Nice to meet you!</h3>
              <p>Tell us your name so we can keep this stoplight-ready proof of concept tidy.</p>
            </div>

            <label htmlFor="namePortalInput" className="name-portal-label">
              Full name
            </label>
            <input
              id="namePortalInput"
              className="name-portal-input"
              type="text"
              placeholder="e.g. Samir Wagle"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              onKeyDown={handlePortalKeyDown}
            />

            {portalError && <p className="name-portal-error">{portalError}</p>}

            <motion.button
              className="btn-primary name-portal-submit"
              onClick={handleNamePortalSubmit}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.96 }}
            >
              Continue to login
              <ArrowRight className="w-5 h-5 ml-2" />
            </motion.button>
          </motion.div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-logo">
            <NECPrepIcon small />
            <span>NECPrep</span>
          </div>
          <p className="footer-text">
            © 2026 NECPrep. Built for Nepal Engineering Council License Exam Preparation.
          </p>
        </div>
      </footer>
    </div>
  );
}
