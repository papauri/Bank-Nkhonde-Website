/**
 * Shared Top Navigation Component
 * Injects consistent top navigation across all user pages
 */

(function() {
  'use strict';

  /**
   * Initialize top navigation
   * @param {Object} options - Configuration options
   * @param {boolean} options.showGroupDisplay - Show current group display (default: false)
   * @param {boolean} options.showViewToggle - Show admin/user view toggle (default: false)
   * @param {string} options.logoLink - Link for logo (default: 'user_dashboard.html')
   */
  window.initTopNav = function(options = {}) {
    const {
      showGroupDisplay = false,
      showViewToggle = false,
      logoLink = 'user_dashboard.html'
    } = options;

    const navHTML = `
      <!-- Top Navigation -->
      <nav class="top-nav">
        <div class="top-nav-container">
          <a href="${logoLink}" class="top-nav-logo">
            <div class="top-nav-logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span class="top-nav-logo-text">Bank Nkhonde</span>
          </a>

          ${showGroupDisplay ? `
          <!-- Current Group Display -->
          <div id="currentGroupDisplay" class="current-group-display" onclick="window.location.href='select_group.html'" title="Click to change group" style="display: none; flex: 1; max-width: 300px; margin: 0 var(--bn-space-4); padding: var(--bn-space-2) var(--bn-space-3); background: rgba(255, 255, 255, 0.1); border-radius: var(--bn-radius-md); cursor: pointer; transition: background var(--bn-transition-fast);">
            <div style="display: flex; align-items: center; gap: var(--bn-space-2);">
              <div style="width: 32px; height: 32px; background: var(--bn-gradient-accent); border-radius: var(--bn-radius-md); display: flex; align-items: center; justify-content: center; font-weight: 800; color: var(--bn-dark); font-size: var(--bn-text-sm);" id="currentGroupIcon">G</div>
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: var(--bn-text-xs); color: rgba(255, 255, 255, 0.7); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">Current Group</div>
                <div style="font-size: var(--bn-text-sm); font-weight: 600; color: var(--bn-white); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" id="currentGroupName">Loading...</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0; color: rgba(255, 255, 255, 0.5);">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
          ` : ''}

          <div class="top-nav-actions">
            ${showViewToggle ? `
            <!-- View Toggle (only shows if user is admin) -->
            <div class="view-toggle hidden" id="viewToggle">
              <button class="view-toggle-btn" onclick="handleSwitchToAdmin()" title="Switch to Admin Dashboard">Admin</button>
              <button class="view-toggle-btn active" title="User Dashboard (Current)">User</button>
            </div>
            ` : ''}
            <!-- Desktop: Select Group button -->
            <button class="top-nav-btn" onclick="window.location.href='select_group.html'" title="Select Group">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="12" y1="8" x2="12" y2="16"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
            </button>
            <button class="top-nav-btn" id="notificationsBtn" aria-label="Notifications" style="position: relative;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <span id="notificationBadge" class="notification-badge"></span>
            </button>
            <!-- Desktop: Logout button -->
            <button class="top-nav-btn" id="logoutBtn" title="Logout">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
            <a href="settings.html" class="top-nav-avatar" id="userAvatar" title="Settings & Profile">
              <img id="userProfilePic" src="" alt="Profile" style="display: none;">
              <span id="userInitials">U</span>
            </a>
          </div>
          
          <!-- Mobile: Burger menu button -->
          <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Menu">
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </nav>

      <!-- Mobile Menu Overlay -->
      <div class="mobile-menu-overlay" id="mobileMenuOverlay"></div>
      
      <!-- Mobile Menu Sidebar -->
      <div class="mobile-menu" id="mobileMenu">
        <div class="mobile-menu-header">
          <h2 class="mobile-menu-title">Menu</h2>
          <button class="mobile-menu-close" id="mobileMenuClose" aria-label="Close menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="mobile-menu-items">
          <a href="user_dashboard.html" class="mobile-menu-item" onclick="closeMobileMenu()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <span>Dashboard</span>
          </a>
          <a href="select_group.html" class="mobile-menu-item" onclick="closeMobileMenu()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            <span>Select Group</span>
          </a>
          <a href="settings.html" class="mobile-menu-item" onclick="closeMobileMenu()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v6m0 6v6m9-9h-6m-6 0H3m15.364 6.364l-4.243-4.243m-4.242 0L5.636 17.364M18.364 6.636l-4.243 4.243m-4.242 0L5.636 6.636"/>
            </svg>
            <span>Settings</span>
          </a>
          <button class="mobile-menu-item danger" id="mobileLogoutBtn" onclick="handleMobileLogout()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    `;

    // Insert navigation at the start of body
    const body = document.body;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = navHTML;
    
    // Insert all children from tempDiv to the start of body
    while (tempDiv.firstChild) {
      body.insertBefore(tempDiv.firstChild, body.firstChild);
    }

    // Initialize mobile menu handlers
    initMobileMenuHandlers();
  };

  /**
   * Initialize mobile menu handlers
   */
  function initMobileMenuHandlers() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileMenuClose = document.getElementById('mobileMenuClose');
    const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');
    const mobileMenu = document.getElementById('mobileMenu');

    if (mobileMenuBtn && mobileMenu && mobileMenuOverlay) {
      mobileMenuBtn.addEventListener('click', () => {
        mobileMenu.classList.add('active');
        mobileMenuOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
      });

      const closeMobileMenuHandler = () => {
        mobileMenu.classList.remove('active');
        mobileMenuOverlay.classList.remove('active');
        document.body.style.overflow = '';
      };

      if (mobileMenuClose) {
        mobileMenuClose.addEventListener('click', closeMobileMenuHandler);
      }

      if (mobileMenuOverlay) {
        mobileMenuOverlay.addEventListener('click', closeMobileMenuHandler);
      }

      // Expose closeMobileMenu globally for onclick handlers
      window.closeMobileMenu = closeMobileMenuHandler;
    }
  }

  /**
   * Default mobile logout handler
   */
  window.handleMobileLogout = function() {
    if (window.auth && typeof window.auth.signOut === 'function') {
      window.auth.signOut().then(() => {
        window.location.href = '../login.html';
      }).catch((error) => {
        console.error('Error signing out:', error);
        alert('Error signing out. Please try again.');
      });
    } else {
      // Fallback if auth not available
      window.location.href = '../login.html';
    }
  };

  /**
   * Default mobile nav logout handler (for bottom nav)
   */
  window.handleMobileNavLogout = function() {
    window.handleMobileLogout();
  };

})();
