import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, BookOpen, Trophy, Users } from 'lucide-react';
import { useUser } from '../context/user-context';
import { bookChapters } from '../data/bookChapters.generated';
import styles from './Landing.module.css';

// Live content figures, derived from the generated chapter manifest so the
// landing page can never drift from what is actually shipped.
const LIVE_QUESTIONS = bookChapters.reduce((sum, c) => sum + c.questionCount, 0);
const LIVE_CHAPTERS = bookChapters.length;
const SYLLABUS_SUBCHAPTERS = 60; // NEC ACtE: 10 chapters x 6 sub-chapters

// TODO(platform-rebuild): a shared <Dialog> primitive is being built under
// src/components/ui/. When it lands, replace the local focus trap, Escape
// handler, scroll lock and focus restoration below with it, and delete this
// selector list along with `focusableWithin`.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function scrollToFeatures() {
  const el = document.getElementById('features');
  if (!el) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const portalTriggerRef = useRef<HTMLElement | null>(null);

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
      title: 'Open Source',
      description: 'Free, MIT-licensed, and improved by the engineers who use it.'
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

  const openNamePortal = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Remember where focus came from so it can be put back on close.
    portalTriggerRef.current = event.currentTarget;
    setIsNamePortalOpen(true);
    setPortalError('');
  };

  const closeNamePortal = () => {
    setIsNamePortalOpen(false);
    setPortalError('');
  };

  // Everything a role="dialog" aria-modal="true" element has to do and this one
  // previously did not: initial focus, a Tab trap, Escape, a background scroll
  // lock, and focus restoration on close.
  // TODO(platform-rebuild): delete in favour of the shared <Dialog> primitive.
  useEffect(() => {
    if (!isNamePortalOpen) return;

    const trigger = portalTriggerRef.current;
    const previousOverflow = document.body.style.overflow;

    nameInputRef.current?.focus();
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsNamePortalOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableWithin(dialogRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!dialogRef.current?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      // A no-op when the trigger has already unmounted, which is what happens
      // after a successful submit navigates to /app.
      trigger?.focus();
    };
  }, [isNamePortalOpen]);

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

  const handlePortalKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleNamePortalSubmit();
    }
  };

  return (
    <div className={`landing-page ${styles.page}`}>
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
            {/* `.gradient-text` ran a three-stop ramp across the two longest
                words of the largest text on the page, bottoming out at 4.42:1.
                The accent is now one short word on a measured two-stop ramp
                whose darkest point is 6.62:1 — see Landing.module.css. */}
            Master Your{' '}
            <span className={styles.heroAccent}>NEC</span>{' '}
            License Exam
          </motion.h1>
          
          <motion.p 
            className="hero-description"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
          >
            Practise {LIVE_QUESTIONS.toLocaleString()} questions across all {LIVE_CHAPTERS} chapters of the
            NEC Computer Engineering syllabus. Free, open source, and works offline.
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
              type="button"
              onClick={scrollToFeatures}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Learn More
            </motion.button>
          </motion.div>
        </motion.div>
      </section>

      {/* Features Section */}
      <section className="features-section" id="features">
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

      {/* Goals Section — aspirational targets, explicitly labelled as such,
          with the actual shipped figures stated directly underneath. */}
      <section className="stats-section" aria-labelledby="goals-heading">
        <motion.div
          className="stats-wrapper"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <p className="stats-eyebrow" id="goals-heading">Our 2026 goals</p>

          <div className="stats-container">
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
          </div>

          <p className="stats-live">
            <strong>Live today:</strong> {LIVE_QUESTIONS.toLocaleString()} questions
            {' · '}{LIVE_CHAPTERS} chapters
            {' · '}{SYLLABUS_SUBCHAPTERS} NEC syllabus sub-chapters
          </p>
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
            Free and open source. No account needed — enter your name and start practising in seconds.
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
        <div
          className="name-portal-overlay"
          // The dialog role belongs on the dialog, not on its backdrop.
          onClick={(event) => {
            if (event.target === event.currentTarget) closeNamePortal();
          }}
        >
          <motion.div
            ref={dialogRef}
            className="name-portal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="namePortalTitle"
            aria-describedby="namePortalDescription"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <button
              className={`name-portal-close ${styles.dialogClose}`}
              type="button"
              aria-label="Close"
              onClick={closeNamePortal}
            >
              &times;
            </button>

            <div className="name-portal-header">
              {/* Was an <h3> under the page <h1>, skipping h2. */}
              <h2 id="namePortalTitle" className={styles.dialogTitle}>Nice to meet you!</h2>
              <p id="namePortalDescription">
                We&rsquo;ll use this to personalise your dashboard. Nothing leaves your device.
              </p>
            </div>

            <label htmlFor="namePortalInput" className="name-portal-label">
              Full name
            </label>
            <input
              ref={nameInputRef}
              id="namePortalInput"
              className={`name-portal-input ${styles.dialogInput}`}
              type="text"
              placeholder="e.g. Samir Wagle"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              onKeyDown={handlePortalKeyDown}
              aria-invalid={portalError ? true : undefined}
              aria-describedby={portalError ? 'namePortalError' : undefined}
            />

            {portalError && (
              <p className="name-portal-error" id="namePortalError" role="alert">
                {portalError}
              </p>
            )}

            <motion.button
              className="btn-primary name-portal-submit"
              onClick={handleNamePortalSubmit}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.96 }}
            >
              Start studying
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
          {/* Google's consent screen links to /privacy, so it has to be
              reachable from the site itself too - a policy that exists only as
              a URL handed to Google is not a policy anyone can find. */}
          <p className="footer-legal">
            <Link to="/privacy">Privacy Policy</Link>
            <span aria-hidden="true"> · </span>
            <Link to="/terms">Terms of Use</Link>
          </p>
          <p className="footer-disclaimer">
            Not affiliated with, endorsed by, or approved by the Nepal Engineering Council.
          </p>
        </div>
      </footer>
    </div>
  );
}
