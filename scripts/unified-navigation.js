/**
 * Unified Navigation - Mobile Menu Handler
 * Handles mobile menu open/close functionality for all pages
 * Also handles modal body scroll locking
 */

// Modal Body Scroll Lock Handler
function handleModalScrollLock() {
  const modals = document.querySelectorAll('.modal-overlay');
  
  modals.forEach(modal => {
    const observer = new MutationObserver(() => {
      if (modal.classList.contains('active') || !modal.classList.contains('hidden')) {
        document.body.classList.add('modal-open');
      } else {
        document.body.classList.remove('modal-open');
      }
    });

    observer.observe(modal, {
      attributes: true,
      attributeFilter: ['class']
    });

    // Also check on click events
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        // Clicked on overlay, close modal
        modal.classList.add('hidden');
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
      }
    });
  });

  // Handle modal close buttons
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-close') || e.target.closest('.modal-close')) {
      const modal = e.target.closest('.modal-overlay');
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
      }
    }
  });
}

export function initializeUnifiedNavigation() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileMenuClose = document.getElementById('mobileMenuClose');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');

  if (!mobileMenuBtn || !mobileMenu || !mobileMenuOverlay) {
    return; // Navigation elements not present
  }

  function openMobileMenu() {
    mobileMenu.classList.add('active');
    mobileMenuOverlay.classList.add('active');
    if (mobileMenuBtn) mobileMenuBtn.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileMenu() {
    mobileMenu.classList.remove('active');
    mobileMenuOverlay.classList.remove('active');
    if (mobileMenuBtn) mobileMenuBtn.classList.remove('active');
    document.body.style.overflow = '';
  }

  // Open menu
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', openMobileMenu);
  }

  // Close menu
  if (mobileMenuClose) {
    mobileMenuClose.addEventListener('click', closeMobileMenu);
  }

  // Close on overlay click
  if (mobileMenuOverlay) {
    mobileMenuOverlay.addEventListener('click', closeMobileMenu);
  }

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileMenu?.classList.contains('active')) {
      closeMobileMenu();
    }
  });

  // Expose to window for onclick handlers
  window.closeMobileMenu = closeMobileMenu;
}

/**
 * Handle mobile navigation logout
 * Works across all pages with Firebase auth
 */
async function handleMobileNavLogout() {
  try {
    // Import auth and signOut dynamically
    const { auth, signOut } = await import('./firebaseConfig.js');
    await signOut(auth);
    window.location.href = '../login.html';
  } catch (error) {
    console.error('Error signing out:', error);
    // Fallback: try to redirect anyway
    window.location.href = '../login.html';
  }
}

// Expose to window for onclick handlers
window.handleMobileNavLogout = handleMobileNavLogout;
// Also expose as handleMobileLogout (alias used on some pages)
window.handleMobileLogout = handleMobileNavLogout;

/**
 * Handle "Switch to Admin" navigation
 * Redirects to the admin dashboard page
 */
function handleSwitchToAdmin() {
  window.location.href = 'admin_dashboard.html';
}
window.handleSwitchToAdmin = handleSwitchToAdmin;

/**
 * Setup shared desktop nav buttons (logoutBtn, notificationsBtn)
 * These exist across multiple user-facing pages but were previously
 * only handled in user_dashboard.js
 */
function setupSharedNavButtons() {
  // Desktop logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn && !logoutBtn._hasLogoutHandler) {
    logoutBtn._hasLogoutHandler = true;
    logoutBtn.addEventListener('click', async () => {
      try {
        const { auth, signOut } = await import('./firebaseConfig.js');
        await signOut(auth);
        window.location.href = '../login.html';
      } catch (error) {
        console.error('Error signing out:', error);
        window.location.href = '../login.html';
      }
    });
  }

  // Notifications button - open notification panel or show dropdown
  const notificationsBtn = document.getElementById('notificationsBtn');
  if (notificationsBtn && !notificationsBtn._hasNotifHandler) {
    notificationsBtn._hasNotifHandler = true;
    notificationsBtn.addEventListener('click', () => {
      // Check if notifications-handler is loaded (on dashboard pages)
      if (window.toggleNotifications) {
        window.toggleNotifications();
      } else {
        // Fallback: show a simple alert for pages without full notification support
        alert('Notifications: No new notifications');
      }
    });
  }
}

// Auto-initialize on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeUnifiedNavigation();
    handleModalScrollLock();
    setupSharedNavButtons();
  });
} else {
  initializeUnifiedNavigation();
  handleModalScrollLock();
  setupSharedNavButtons();
}
