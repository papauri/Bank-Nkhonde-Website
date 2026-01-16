/**
 * Shared Sidebar Component
 * Injects persistent sidebar into admin/user pages
 */

import {
  db,
  auth,
  doc,
  getDoc,
  onAuthStateChanged,
  signOut,
} from "./firebaseConfig.js";

let currentUser = null;
let selectedGroupId = null;

// Initialize sidebar on page load
export function initializeSharedSidebar(isAdmin = true) {
  // Check if sidebar already exists
  if (document.getElementById('sharedSidebar')) {
    return; // Sidebar already exists
  }

  // Get groupId from URL or session
  const urlParams = new URLSearchParams(window.location.search);
  selectedGroupId = urlParams.get('groupId') || sessionStorage.getItem('selectedGroupId');

  // Check auth
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    currentUser = user;
    
    // Create sidebar
    const sidebar = createSidebar(isAdmin);
    
    // Insert sidebar before main content
    const mainContent = document.querySelector('main') || document.body;
    mainContent.parentElement.insertBefore(sidebar, mainContent);
    
    // Adjust page layout
    adjustPageLayout();
    
    // Load user data
    await loadUserData();
    
    // Setup event listeners
    setupSidebarListeners(isAdmin);
  });
}

// Create sidebar HTML
function createSidebar(isAdmin) {
  const sidebar = document.createElement('aside');
  sidebar.id = 'sharedSidebar';
  sidebar.className = 'shared-sidebar';
  
  const navItems = isAdmin ? getAdminNavItems() : getUserNavItems();
  
  // Get groupId for URL
  const groupIdParam = selectedGroupId ? `?groupId=${selectedGroupId}` : '';
  const dashboardHref = isAdmin ? `admin_dashboard.html${groupIdParam}` : `user_dashboard.html${groupIdParam}`;
  
  sidebar.innerHTML = `
    <div class="sidebar-header">
      <a href="${dashboardHref}" class="sidebar-logo" id="sidebarHeaderLink">
        <div class="sidebar-logo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span class="sidebar-logo-text">Bank Nkhonde</span>
      </a>
    </div>
    <nav class="sidebar-nav">
      ${navItems}
    </nav>
    <div class="sidebar-footer">
      ${isAdmin ? `
      <a href="user_dashboard.html" class="sidebar-nav-item" style="margin-bottom: var(--bn-space-3); background: rgba(255,255,255,0.05);">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        <span>Switch to User View</span>
      </a>
      ` : ''}
      <div class="sidebar-user" id="sidebarUser">
        <a href="settings.html" class="sidebar-user-avatar" id="sidebarUserAvatar">
          <img id="sidebarProfilePic" src="" alt="Profile" style="display: none;">
          <span id="sidebarUserInitials">U</span>
        </a>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name" id="sidebarUserName">User</div>
          <div class="sidebar-user-role">${isAdmin ? 'Administrator' : 'Member'}</div>
        </div>
      </div>
    </div>
  `;
  
  // Add styles
  addSidebarStyles();
  
  return sidebar;
}

// Get admin navigation items
function getAdminNavItems() {
  const currentPage = window.location.pathname.split('/').pop();
  
  return `
    <div class="sidebar-nav-section">
      <div class="sidebar-nav-label">Main</div>
      <a href="admin_dashboard.html${selectedGroupId ? `?groupId=${selectedGroupId}` : ''}" class="sidebar-nav-item ${currentPage === 'admin_dashboard.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        Dashboard
      </a>
      <a href="analytics.html${selectedGroupId ? `?groupId=${selectedGroupId}` : ''}" class="sidebar-nav-item ${currentPage === 'analytics.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="20" x2="18" y2="10"/>
          <line x1="12" y1="20" x2="12" y2="4"/>
          <line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
        Analytics
      </a>
      <a href="financial_reports.html${selectedGroupId ? `?groupId=${selectedGroupId}` : ''}" class="sidebar-nav-item ${currentPage === 'financial_reports.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        Reports
      </a>
    </div>
    <div class="sidebar-nav-section">
      <div class="sidebar-nav-label">Management</div>
      <a href="manage_loans.html${selectedGroupId ? `?groupId=${selectedGroupId}` : ''}" class="sidebar-nav-item ${currentPage === 'manage_loans.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
        Manage Loans
      </a>
      <a href="manage_payments.html${selectedGroupId ? `?groupId=${selectedGroupId}` : ''}" class="sidebar-nav-item ${currentPage === 'manage_payments.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
          <line x1="1" y1="10" x2="23" y2="10"/>
        </svg>
        Payments
      </a>
      <a href="manage_members.html${selectedGroupId ? `?groupId=${selectedGroupId}` : ''}" class="sidebar-nav-item ${currentPage === 'manage_members.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        Members
      </a>
      <a href="contributions_overview.html${selectedGroupId ? `?groupId=${selectedGroupId}` : ''}" class="sidebar-nav-item ${currentPage === 'contributions_overview.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        Contributions
      </a>
    </div>
    <div class="sidebar-nav-section">
      <div class="sidebar-nav-label">Settings</div>
      <a href="settings.html" class="sidebar-nav-item ${currentPage === 'settings.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        Settings
      </a>
      <button class="sidebar-nav-item" id="logoutBtn" style="border: none; background: none; width: 100%; text-align: left;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Logout
      </button>
    </div>
  `;
}

// Get user navigation items
function getUserNavItems() {
  const currentPage = window.location.pathname.split('/').pop();
  
  return `
    <div class="sidebar-nav-section">
      <div class="sidebar-nav-label">Main</div>
      <a href="user_dashboard.html${selectedGroupId ? `?groupId=${selectedGroupId}` : ''}" class="sidebar-nav-item ${currentPage === 'user_dashboard.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        Dashboard
      </a>
      <a href="contacts.html${selectedGroupId ? `?groupId=${selectedGroupId}` : ''}" class="sidebar-nav-item ${currentPage === 'contacts.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        Contacts
      </a>
      <a href="view_rules.html${selectedGroupId ? `?groupId=${selectedGroupId}` : ''}" class="sidebar-nav-item ${currentPage === 'view_rules.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        Rules
      </a>
    </div>
    <div class="sidebar-nav-section">
      <div class="sidebar-nav-label">Settings</div>
      <a href="settings.html" class="sidebar-nav-item ${currentPage === 'settings.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        Settings
      </a>
      <button class="sidebar-nav-item" id="logoutBtn" style="border: none; background: none; width: 100%; text-align: left;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Logout
      </button>
    </div>
  `;
}

// Add sidebar styles
function addSidebarStyles() {
  if (document.getElementById('sharedSidebarStyles')) return;
  
  const style = document.createElement('style');
  style.id = 'sharedSidebarStyles';
  style.textContent = `
    .shared-sidebar {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: 280px;
      background: var(--bn-dark);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      transition: transform 0.3s ease;
    }
    
    body.has-sidebar {
      margin-left: 280px;
    }
    
    @media (max-width: 1024px) {
      .shared-sidebar {
        transform: translateX(-100%);
      }
      .shared-sidebar.open {
        transform: translateX(0);
      }
      body.has-sidebar {
        margin-left: 0;
      }
    }
    
    .sidebar-header {
      padding: var(--bn-space-6);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    .sidebar-logo {
      display: flex;
      align-items: center;
      gap: var(--bn-space-3);
      text-decoration: none;
    }
    
    .sidebar-logo-icon {
      width: 40px;
      height: 40px;
      background: var(--bn-gradient-accent);
      border-radius: var(--bn-radius-lg);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .sidebar-logo-icon svg {
      width: 22px;
      height: 22px;
      color: var(--bn-dark);
    }
    
    .sidebar-logo-text {
      font-size: var(--bn-text-lg);
      font-weight: 800;
      color: var(--bn-white);
    }
    
    .sidebar-nav {
      flex: 1;
      padding: var(--bn-space-4) var(--bn-space-3);
      overflow-y: auto;
    }
    
    .sidebar-nav-section {
      margin-bottom: var(--bn-space-6);
    }
    
    .sidebar-nav-label {
      font-size: var(--bn-text-xs);
      font-weight: 600;
      color: var(--bn-gray);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: var(--bn-space-3) var(--bn-space-4);
      margin-bottom: var(--bn-space-1);
    }
    
    .sidebar-nav-item {
      display: flex;
      align-items: center;
      gap: var(--bn-space-3);
      padding: var(--bn-space-3) var(--bn-space-4);
      font-size: var(--bn-text-sm);
      font-weight: 500;
      color: var(--bn-gray-400);
      text-decoration: none;
      border-radius: var(--bn-radius-lg);
      transition: all 0.2s;
      margin-bottom: var(--bn-space-1);
      cursor: pointer;
    }
    
    .sidebar-nav-item:hover {
      background: rgba(255, 255, 255, 0.05);
      color: var(--bn-white);
    }
    
    .sidebar-nav-item.active {
      background: rgba(201, 162, 39, 0.15);
      color: var(--bn-accent);
    }
    
    .sidebar-nav-item svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
    
    .sidebar-footer {
      padding: var(--bn-space-4);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    .sidebar-user {
      display: flex;
      align-items: center;
      gap: var(--bn-space-3);
      padding: var(--bn-space-3);
      border-radius: var(--bn-radius-lg);
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .sidebar-user:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    
    .sidebar-user-avatar {
      width: 40px;
      height: 40px;
      border-radius: var(--bn-radius-full);
      background: var(--bn-gradient-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: var(--bn-text-sm);
      color: var(--bn-dark);
      overflow: hidden;
      text-decoration: none;
    }
    
    .sidebar-user-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    .sidebar-user-info {
      flex: 1;
      min-width: 0;
    }
    
    .sidebar-user-name {
      font-size: var(--bn-text-sm);
      font-weight: 600;
      color: var(--bn-white);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .sidebar-user-role {
      font-size: var(--bn-text-xs);
      color: var(--bn-gray);
    }
  `;
  document.head.appendChild(style);
}

// Adjust page layout for sidebar
function adjustPageLayout() {
  document.body.classList.add('has-sidebar');
  
  // Add mobile menu button if it doesn't exist
  if (!document.getElementById('mobileMenuBtn')) {
    const menuBtn = document.createElement('button');
    menuBtn.id = 'mobileMenuBtn';
    menuBtn.className = 'mobile-menu-btn';
    menuBtn.innerHTML = '<span></span><span></span><span></span>';
    menuBtn.style.cssText = `
      display: none;
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 1001;
      width: 40px;
      height: 40px;
      background: var(--bn-dark);
      border: none;
      border-radius: 8px;
      flex-direction: column;
      justify-content: center;
      gap: 4px;
      padding: 8px;
      cursor: pointer;
    `;
    menuBtn.addEventListener('click', () => {
      document.getElementById('sharedSidebar')?.classList.toggle('open');
    });
    document.body.insertBefore(menuBtn, document.body.firstChild);
    
    // Show on mobile
    const mediaQuery = window.matchMedia('(max-width: 1024px)');
    if (mediaQuery.matches) {
      menuBtn.style.display = 'flex';
    }
    mediaQuery.addEventListener('change', (e) => {
      menuBtn.style.display = e.matches ? 'flex' : 'none';
    });
  }
}

// Load user data
async function loadUserData() {
  try {
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      const displayName = userData.fullName || currentUser.email.split("@")[0];
      
      const userNameEl = document.getElementById('sidebarUserName');
      const userInitialsEl = document.getElementById('sidebarUserInitials');
      const profilePicEl = document.getElementById('sidebarProfilePic');
      
      if (userNameEl) userNameEl.textContent = displayName;
      if (userInitialsEl) userInitialsEl.textContent = displayName.charAt(0).toUpperCase();
      
      if (userData.profileImageUrl && profilePicEl) {
        profilePicEl.src = userData.profileImageUrl;
        profilePicEl.style.display = "block";
        if (userInitialsEl) userInitialsEl.style.display = "none";
      }
    }
  } catch (error) {
    console.error("Error loading user data:", error);
  }
}

// Setup sidebar event listeners
function setupSidebarListeners(isAdmin) {
  // Sidebar header link - ensure it preserves auth state
  const sidebarHeaderLink = document.getElementById('sidebarHeaderLink');
  if (sidebarHeaderLink) {
    sidebarHeaderLink.addEventListener('click', (e) => {
      // Don't clear session - just navigate normally
      // Auth state will persist through Firebase
    });
  }
  
  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to logout?')) {
        try {
          await signOut(auth);
          // Only clear session-related data, not all sessionStorage
          const groupId = sessionStorage.getItem('selectedGroupId');
          sessionStorage.clear();
          localStorage.clear();
          window.location.href = "../login.html";
        } catch (error) {
          console.error("Error signing out:", error);
        }
      }
    });
  }
  
  // Update active nav item on navigation
  document.querySelectorAll('.sidebar-nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Update URL with groupId if available
      const href = item.getAttribute('href');
      if (href && selectedGroupId && !href.includes('groupId=')) {
        const separator = href.includes('?') ? '&' : '?';
        item.setAttribute('href', `${href}${separator}groupId=${selectedGroupId}`);
      }
    });
  });
}
