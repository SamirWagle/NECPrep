import { useState, useRef, useEffect, useCallback } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../context/user-context';
import { useAuth } from '../auth/auth-context';
import styles from './AppShell.module.css';

// Matches the `@media (max-width: 1024px)` breakpoint in App.css at which the
// sidebar becomes an off-canvas drawer (`transform: translateX(-100%)`).
const NARROW_VIEWPORT_QUERY = '(max-width: 1024px)';

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

// Icon components
const Icons = {
  Logo: () => (
    <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style={{ width: '28px', height: '28px' }}>
      <rect width="32" height="32" rx="7" fill="#4F46E5"/>
      <path d="M16 9 C13 9 10 10 8 11.5 L8 23 C10 21.5 13 21 16 21 C19 21 22 21.5 24 23 L24 11.5 C22 10 19 9 16 9Z" fill="none" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
      <line x1="16" y1="9" x2="16" y2="21" stroke="white" strokeWidth="1.5"/>
      <circle cx="24" cy="24" r="5" fill="#22C55E"/>
      <polyline points="21.5,24 23.2,25.8 26.5,22.5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Dashboard: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/>
      <rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/>
    </svg>
  ),
  Practice: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <line x1="10" y1="9" x2="8" y2="9"/>
    </svg>
  ),
  Study: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  ),
  Flashcards: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="M10 4v4"/>
      <path d="M2 8h20"/>
      <path d="M6 4v4"/>
    </svg>
  ),
  Progress: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10"/>
      <line x1="18" y1="20" x2="18" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="16"/>
    </svg>
  ),
  Bookmarks: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  Profile: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  Settings: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  Logout: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  Books: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      <line x1="12" y1="6" x2="16" y2="6"/>
      <line x1="12" y1="10" x2="16" y2="10"/>
    </svg>
  ),
  Menu: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  ),
  Close: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  ChevronDown: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
};

// Navigation items configuration
const navItems = [
  { path: '/app', icon: Icons.Dashboard, label: 'Dashboard', end: true },
  { path: '/app/practice', icon: Icons.Practice, label: 'Practice' },
  { path: '/app/books', icon: Icons.Books, label: 'Books' },
  { path: '/app/study', icon: Icons.Study, label: 'Study' },
  { path: '/app/flashcards', icon: Icons.Flashcards, label: 'Flashcards' },
  { path: '/app/progress', icon: Icons.Progress, label: 'Progress' },
  { path: '/app/bookmarks', icon: Icons.Bookmarks, label: 'Bookmarks' },
];

const secondaryNavItems = [
  { path: '/app/profile', icon: Icons.Profile, label: 'Profile' },
  { path: '/app/settings', icon: Icons.Settings, label: 'Settings' },
];

export default function AppShell() {
  const { name, setName } = useUser();
  // The server is the authority on identity; `useUser` only holds a locally
  // typed-in name, which is all a build with no backend configured has.
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);

  // The sidebar is translated off-canvas below 1024px but stays in the DOM, so
  // without this it contributed ~10 invisible tab stops on every mobile page.
  // Read once during render (no setState in an effect) and then subscribed to.
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => window.matchMedia(NARROW_VIEWPORT_QUERY).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsNarrowViewport(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Closing the drawer must return focus to the control that opened it,
  // otherwise focus is left on a node that has just gone off-canvas.
  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
    mobileToggleRef.current?.focus();
  }, []);

  // Drawer focus management: move focus in on open, trap Tab inside it while it
  // is open, and close on Escape. setMobileMenuOpen is only ever called from an
  // event handler here, never synchronously during the effect body.
  useEffect(() => {
    if (!mobileMenuOpen) return;

    drawerCloseRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobileMenu();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableWithin(sidebarRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!sidebarRef.current?.contains(active)) {
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
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen, closeMobileMenu]);

  // Close user menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close both menus on navigation. The previous effect had empty deps despite
  // a comment claiming it ran on route change, so the mobile drawer stayed open
  // after every navigation. Adjusting state during render is React's
  // recommended pattern for responding to a changed value.
  const { pathname } = useLocation();
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
  }

  // Handle keyboard navigation for user menu
  const handleUserMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setUserMenuOpen(false);
    }
  };

  const handleLogout = () => {
    // Revoke the SESSION first, then clear the local name.
    //
    // This used to do only the second half, which was enough when there was no
    // backend and a lie once there was: the session is an HttpOnly cookie, so
    // dropping a local string left a live cookie that the next page load
    // happily turned back into a signed-in user. `logout()` asks the server to
    // revoke it.
    //
    // Clearing the local name still matters for the same reason it did before:
    // leaving it set greeted the logged-out visitor by name on the landing
    // page.
    void logout().finally(() => {
      setName('');
      navigate('/');
    });
  };

  // Precedence: what the server knows, then what the visitor typed, then
  // 'Guest'. An anonymous session has a null `displayName`, so a guest who
  // typed a name locally still sees it.
  const displayName = user?.displayName ?? (name || 'Guest');
  const initial = displayName.charAt(0).toUpperCase();
  // Only true with a backend configured; a local-only build has no concept of
  // an account to upgrade to.
  const isGuest = status === 'ready' && user !== null && user.isAnonymous;

  // A real fragment jump would push a hash onto the router history and, in
  // several browsers, scroll without moving focus. Move focus explicitly;
  // .focus() scrolls the target into view on its own.
  const handleSkipToContent = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    mainRef.current?.focus();
  };

  // Following a drawer link closes the drawer. Focus has to leave with it or it
  // would be stranded on a node that is about to go off-canvas and inert.
  const handleNavigateFromDrawer = () => {
    if (!mobileMenuOpen) return;
    setMobileMenuOpen(false);
    mainRef.current?.focus();
  };

  return (
    <div className={`app-shell ${styles.shell}`}>
      {/* First tab stop on every page in the shell. */}
      <a href="#main-content" className={styles.skipLink} onClick={handleSkipToContent}>
        Skip to main content
      </a>

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="app-shell-overlay"
          onClick={closeMobileMenu}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        id="app-sidebar"
        ref={sidebarRef}
        className={`app-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}
        aria-label="Main navigation"
        // Below 1024px a closed drawer is off-canvas but still in the DOM.
        // `inert` removes its ten-odd tab stops and hides it from the
        // accessibility tree until it is actually open.
        inert={isNarrowViewport && !mobileMenuOpen}
      >
        <div className="sidebar-header">
          <NavLink to="/app" className="sidebar-logo" aria-label="NECPrep Dashboard">
            <Icons.Logo />
            {!sidebarCollapsed && <span>NECPrep</span>}
          </NavLink>
          <button
            className={`sidebar-toggle desktop-only ${styles.iconButton}`}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
            aria-controls="app-sidebar"
          >
            <Icons.Menu />
          </button>
          <button
            ref={drawerCloseRef}
            className={`sidebar-toggle mobile-only ${styles.iconButton}`}
            onClick={closeMobileMenu}
            aria-label="Close navigation menu"
          >
            <Icons.Close />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Sections">
          <ul className="nav-list">
            {navItems.map((item) => (
              <li key={item.path}>
                <NavLink 
                  to={item.path} 
                  end={item.end}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  aria-label={item.label}
                  onClick={handleNavigateFromDrawer}
                >
                  <item.icon />
                  {!sidebarCollapsed && <span>{item.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="nav-divider" />

          <ul className="nav-list secondary">
            {secondaryNavItems.map((item) => (
              <li key={item.path}>
                <NavLink 
                  to={item.path}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  aria-label={item.label}
                  onClick={handleNavigateFromDrawer}
                >
                  <item.icon />
                  {!sidebarCollapsed && <span>{item.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="sidebar-footer">
          <button
            className="nav-link logout-btn"
            onClick={handleLogout}
            aria-label="Leave"
          >
            <Icons.Logout />
            {!sidebarCollapsed && <span>Leave</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="app-main">
        {/* Top bar */}
        <header className="app-topbar">
          <div className="topbar-left">
            <button
              ref={mobileToggleRef}
              className={`mobile-menu-btn mobile-only ${styles.iconButton}`}
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="app-sidebar"
            >
              <Icons.Menu />
            </button>
            {/* The search input and notifications bell that used to live here
                were wired to nothing: two focusable dead ends with no index to
                search and no notification source to read. Removed rather than
                faked. */}
          </div>

          <div className="topbar-right">
            {/* User menu */}
            <div
              className="user-menu-container"
              ref={userMenuRef}
              onKeyDown={handleUserMenuKeyDown}
            >
              <button
                className={`user-menu-trigger ${styles.userMenuTrigger}`}
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-expanded={userMenuOpen}
                aria-haspopup="true"
                aria-controls="user-menu"
                aria-label={`Account menu for ${displayName}`}
              >
                <div className="user-avatar-placeholder">{initial}</div>
                <span className="user-name desktop-only">
                  {displayName.split(' ')[0]}
                </span>
                <Icons.ChevronDown />
              </button>

              {userMenuOpen && (
                <div className="user-menu" role="menu" id="user-menu">
                  <div className="user-menu-header">
                    <div className="user-menu-avatar-placeholder">
                      {initial}
                    </div>
                    <div className="user-menu-info">
                      <span className="user-menu-name">{displayName}</span>
                      {user?.email && (
                        <span className="user-menu-email">{user.email}</span>
                      )}
                    </div>
                  </div>
                  
                  <div className="user-menu-divider" />

                  {/* A guest's work is already being recorded server-side
                      against an identity that survives an upgrade, so this is
                      an invitation rather than a warning. */}
                  {isGuest && (
                    <NavLink
                      to="/signup"
                      className="user-menu-item"
                      role="menuitem"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <Icons.Profile />
                      <span>Create an account to save your progress</span>
                    </NavLink>
                  )}

                  <NavLink 
                    to="/app/profile" 
                    className="user-menu-item"
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <Icons.Profile />
                    <span>Profile</span>
                  </NavLink>
                  
                  <NavLink 
                    to="/app/settings" 
                    className="user-menu-item"
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <Icons.Settings />
                    <span>Settings</span>
                  </NavLink>
                  
                  <div className="user-menu-divider" />
                  
                  <button 
                    className="user-menu-item logout"
                    role="menuitem"
                    onClick={handleLogout}
                  >
                    <Icons.Logout />
                    <span>{user ? 'Sign out' : 'Leave'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className={`app-content ${styles.mainContent}`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
