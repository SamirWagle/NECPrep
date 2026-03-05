import { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';

// Icon components
const Icons = {
  Logo: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a9 9 0 0 1 9 9c0 3.074-1.676 5.59-3.442 7.395a20.194 20.194 0 0 1-2.398 2.064l-.353.256a1.5 1.5 0 0 1-1.614 0l-.353-.256a20.194 20.194 0 0 1-2.398-2.064C8.676 16.59 7 14.074 7 11a9 9 0 0 1 5-8.062"/>
      <circle cx="12" cy="11" r="3"/>
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
  Search: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  Bell: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
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
  const { name } = useUser();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, []);

  // Handle keyboard navigation for user menu
  const handleUserMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setUserMenuOpen(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('userName');
    navigate('/');
  };

  const displayName = name || 'Guest';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="app-shell">
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div 
          className="app-shell-overlay" 
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`app-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-header">
          <NavLink to="/app" className="sidebar-logo" aria-label="EngLicense Dashboard">
            <Icons.Logo />
            {!sidebarCollapsed && <span>EngLicense</span>}
          </NavLink>
          <button 
            className="sidebar-toggle desktop-only"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icons.Menu />
          </button>
          <button 
            className="sidebar-toggle mobile-only"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <Icons.Close />
          </button>
        </div>

        <nav className="sidebar-nav" role="navigation">
          <ul className="nav-list">
            {navItems.map((item) => (
              <li key={item.path}>
                <NavLink 
                  to={item.path} 
                  end={item.end}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => setMobileMenuOpen(false)}
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
                  onClick={() => setMobileMenuOpen(false)}
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
              className="mobile-menu-btn mobile-only"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
            >
              <Icons.Menu />
            </button>
            
            <div className="search-container">
              <Icons.Search />
              <input 
                type="search" 
                placeholder="Search topics, questions..." 
                className="search-input"
                aria-label="Search"
              />
            </div>
          </div>

          <div className="topbar-right">
            <button className="topbar-btn" aria-label="Notifications">
              <Icons.Bell />
            </button>

            {/* User menu */}
            <div 
              className="user-menu-container" 
              ref={userMenuRef}
              onKeyDown={handleUserMenuKeyDown}
            >
              <button
                className="user-menu-trigger"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-expanded={userMenuOpen}
                aria-haspopup="true"
              >
                <div className="user-avatar-placeholder">{initial}</div>
                <span className="user-name desktop-only">
                  {displayName.split(' ')[0]}
                </span>
                <Icons.ChevronDown />
              </button>

              {userMenuOpen && (
                <div className="user-menu" role="menu">
                  <div className="user-menu-header">
                    <div className="user-menu-avatar-placeholder">
                      {initial}
                    </div>
                    <div className="user-menu-info">
                      <span className="user-menu-name">{displayName}</span>
                    </div>
                  </div>
                  
                  <div className="user-menu-divider" />
                  
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
                    <span>Leave</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
