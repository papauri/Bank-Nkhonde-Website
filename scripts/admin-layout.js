/**
 * Admin Layout Component — SPA Navigation
 * Injects shared sidebar, topbar, and mobile nav into admin pages.
 * Navigates between admin pages by swapping only dashboard-content,
 * keeping the sidebar, topbar, and mobile nav intact.
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
let groupName = '';

// SPA state
let _currentPageStyles = [];   // <style> elements injected for current page
let _currentPageScripts = [];  // <script> elements injected for current page
let _isNavigating = false;
let _initialised = false;

// Pages that are part of the admin SPA (relative filenames)
const SPA_PAGES = new Set([
  'admin_dashboard.html', 'analytics.html', 'manage_payments.html',
  'manage_loans.html', 'manage_members.html', 'contributions_overview.html',
  'interest_penalties.html', 'financial_reports.html', 'broadcast_notifications.html',
  'manage_rules.html', 'seed_money_overview.html', 'approve_registrations.html',
  'settings.html',
]);

// Map filename → nav identifier
const PAGE_NAV_MAP = {
  'admin_dashboard.html': 'dashboard',
  'analytics.html': 'analytics',
  'financial_reports.html': 'reports',
  'manage_loans.html': 'loans',
  'manage_payments.html': 'payments',
  'manage_members.html': 'members',
  'contributions_overview.html': 'contributions',
  'interest_penalties.html': 'penalties',
  'seed_money_overview.html': 'seed-money',
  'broadcast_notifications.html': 'broadcast',
  'approve_registrations.html': 'approvals',
  'manage_rules.html': 'rules',
  'settings.html': 'settings',
};

/**
 * Initialize the admin layout with sidebar, topbar, and mobile nav.
 * Call this at the top of each admin page BEFORE the page's own script.
 */
export function initAdminLayout({ pageTitle = 'Dashboard', activeNav = 'dashboard' } = {}) {
  // Get groupId from URL or session
  const urlParams = new URLSearchParams(window.location.search);
  selectedGroupId = urlParams.get('groupId') || sessionStorage.getItem('selectedGroupId');

  // Build groupId query param for nav links
  const gp = selectedGroupId ? `?groupId=${selectedGroupId}` : '';

  // 1. Create and insert sidebar
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.id = 'sidebar';
  sidebar.innerHTML = buildSidebarHTML(gp, activeNav);

  // 2. Create sidebar overlay
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.id = 'sidebarOverlay';

  // 3. Get the main-content element
  const mainContent = document.getElementById('mainContent') || document.querySelector('.main-content');

  if (mainContent) {
    mainContent.parentElement.insertBefore(sidebar, mainContent);
    mainContent.parentElement.insertBefore(overlay, mainContent);

    // 4. Create and prepend topbar into main content
    const topbar = document.createElement('header');
    topbar.className = 'topbar';
    topbar.innerHTML = buildTopbarHTML(pageTitle, gp);
    mainContent.insertBefore(topbar, mainContent.firstChild);
  }

  // 5. Create mobile bottom nav
  const mobileNav = document.createElement('nav');
  mobileNav.className = 'mobile-nav';
  mobileNav.innerHTML = buildMobileNavHTML(gp, activeNav);
  document.body.appendChild(mobileNav);

  // 6. Create toast container if not exists
  if (!document.getElementById('toastContainer')) {
    const toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.id = 'toastContainer';
    document.body.appendChild(toastContainer);
  }

  // 7. Set up auth listener and event handlers
  setupAuth();
  setupEventListeners();

  // 8. Set current date in topbar
  updateCurrentDate();

  // 9. Move spinners/modals that sit outside <main> into .dashboard-content
  //    so they only cover the content area, not the sidebar/topbar.
  const dc = document.querySelector('.dashboard-content');
  if (dc && mainContent) {
    const extrasToMove = [];
    let sib = mainContent.nextElementSibling;
    while (sib) {
      if (sib.tagName === 'SCRIPT' || sib.tagName === 'STYLE') { sib = sib.nextElementSibling; continue; }
      if (sib.id !== 'toastContainer' && !sib.classList.contains('mobile-nav')
          && !sib.classList.contains('sidebar') && !sib.classList.contains('sidebar-overlay')) {
        extrasToMove.push(sib);
      }
      sib = sib.nextElementSibling;
    }
    extrasToMove.forEach(el => dc.appendChild(el));
  }

  // 10. Set up SPA navigation (intercept nav clicks)
  if (!_initialised) {
    _initialised = true;
    setupSPANavigation();
  }
}

/* ============================================================
   SPA NAVIGATION — fetch pages, swap only dashboard-content
   ============================================================ */

/**
 * Intercept clicks on sidebar, mobile nav, and topbar nav links.
 * If the link points to an admin SPA page, load it without full reload.
 */
function setupSPANavigation() {
  // Track initial page's <style> blocks so they are removed on first SPA navigation
  const initialFilename = window.location.pathname.split('/').pop();
  document.querySelectorAll('head > style, body > style').forEach(s => {
    s.setAttribute('data-spa-page', initialFilename);
    _currentPageStyles.push(s);
  });

  // Track initial page's extras (modals, spinners outside <main>) for cleanup
  const mainEl = document.getElementById('mainContent') || document.querySelector('.main-content');
  if (mainEl) {
    let sib = mainEl.nextElementSibling;
    while (sib) {
      if (sib.tagName === 'SCRIPT' || sib.tagName === 'STYLE') { sib = sib.nextElementSibling; continue; }
      if (sib.id !== 'toastContainer' && !sib.classList.contains('mobile-nav')
          && !sib.classList.contains('sidebar') && !sib.classList.contains('sidebar-overlay')) {
        sib.setAttribute('data-spa-extra', initialFilename);
      }
      sib = sib.nextElementSibling;
    }
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href) return;

    // Extract the filename (strip query params and path)
    const filename = href.split('/').pop().split('?')[0];

    // Only intercept links to SPA admin pages
    if (!SPA_PAGES.has(filename)) return;

    // Don't intercept if modifier keys are held (new tab, etc.)
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;

    e.preventDefault();

    // Build the full href preserving query params
    const targetUrl = href.includes('?') ? href : (selectedGroupId ? `${filename}?groupId=${selectedGroupId}` : filename);

    navigateTo(targetUrl);
  });

  // Handle browser back/forward
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.spaPage) {
      navigateTo(e.state.spaPage, { pushState: false });
    }
  });

  // Save initial state
  const currentFile = window.location.pathname.split('/').pop();
  history.replaceState({ spaPage: currentFile + window.location.search }, '', window.location.href);
}

/**
 * Navigate to a target admin page via SPA — only swaps dashboard-content.
 * @param {string} targetUrl - e.g. "analytics.html?groupId=xxx"
 * @param {Object} options
 * @param {boolean} options.pushState - Whether to push a new history entry (default true)
 */
async function navigateTo(targetUrl, { pushState = true } = {}) {
  if (_isNavigating) return;
  _isNavigating = true;

  const filename = targetUrl.split('/').pop().split('?')[0];
  const activeNav = PAGE_NAV_MAP[filename] || 'dashboard';

  // Show loading indicator inside dashboard-content only (sidebar/topbar stay fully interactive)
  const dashboardContent = document.querySelector('.dashboard-content');
  let spaLoader = null;
  if (dashboardContent) {
    spaLoader = document.createElement('div');
    spaLoader.className = 'spa-loading-bar';
    dashboardContent.style.position = 'relative';
    dashboardContent.prepend(spaLoader);
  }

  try {
    // 1. Dispatch cleanup event so current page scripts can unsubscribe listeners
    window.dispatchEvent(new CustomEvent('adminPageUnload'));

    // 2. Fetch the target page HTML
    const response = await fetch(targetUrl);
    if (!response.ok) throw new Error(`Failed to load ${targetUrl}: ${response.status}`);
    const html = await response.text();

    // 3. Parse the fetched HTML
    const parser = new DOMParser();
    const newDoc = parser.parseFromString(html, 'text/html');

    // 4. Extract the new dashboard-content
    const newDashContent = newDoc.querySelector('.dashboard-content');
    if (!newDashContent) throw new Error('No .dashboard-content found in target page');

    // 5. Extract page-specific <style> tags from <head> AND <body>
    const newPageStyles = [
      ...newDoc.querySelectorAll('head > style'),
      ...newDoc.querySelectorAll('body > style'),
    ];

    // 6. Extract page-specific scripts (skip admin-layout.js init, skip firebase compat CDN)
    const pageScripts = [];
    const allScripts = newDoc.querySelectorAll('body script');
    allScripts.forEach(s => {
      const src = s.getAttribute('src') || '';
      const text = s.textContent || '';
      // Skip the admin-layout init script
      if (text.includes('initAdminLayout')) return;
      // Skip admin-layout.js itself
      if (src.includes('admin-layout.js')) return;
      // Skip Firebase compat CDN scripts (already loaded globally)
      if (src.includes('firebase') && src.includes('compat')) return;
      pageScripts.push({ src, text, type: s.getAttribute('type') || '' });
    });

    // 7. Extract page title from newDoc
    const newTitle = newDoc.querySelector('title')?.textContent || 'Bank Nkhonde';

    // 8. Also grab any elements after </main> and before scripts (spinners, modals, overlays)
    const newExtras = [];
    const newMain = newDoc.querySelector('main.main-content, main#mainContent');
    if (newMain) {
      let sibling = newMain.nextElementSibling;
      while (sibling) {
        if (sibling.tagName === 'SCRIPT') break;
        // Skip body <style> tags (handled as page styles), toast container, mobile-nav
        if (sibling.tagName === 'STYLE') { sibling = sibling.nextElementSibling; continue; }
        if (sibling.id !== 'toastContainer' && sibling.tagName !== 'NAV') {
          newExtras.push(sibling.cloneNode(true));
        }
        sibling = sibling.nextElementSibling;
      }
    }

    // === APPLY CHANGES ===

    // 9. Remove old page-specific styles
    _currentPageStyles.forEach(el => el.remove());
    _currentPageStyles = [];

    // 10. Inject new page-specific styles
    newPageStyles.forEach(style => {
      const s = document.createElement('style');
      s.setAttribute('data-spa-page', filename);
      s.textContent = style.textContent;
      document.head.appendChild(s);
      _currentPageStyles.push(s);
    });

    // 11. Swap dashboard-content innerHTML
    if (dashboardContent) {
      dashboardContent.innerHTML = newDashContent.innerHTML;
    }

    // 12. Remove old extra elements (spinners, modals)
    document.querySelectorAll('[data-spa-extra]').forEach(el => el.remove());

    // 13. Inject new extras (spinners, modals) INSIDE dashboard-content so they
    //     are scoped visually to the content area, not covering sidebar/topbar.
    if (dashboardContent) {
      newExtras.forEach(el => {
        el.setAttribute('data-spa-extra', filename);
        dashboardContent.appendChild(el);
      });
    }

    // 14. Remove old page-specific scripts
    _currentPageScripts.forEach(el => el.remove());
    _currentPageScripts = [];

    // 15. Patch DOMContentLoaded so dynamically loaded scripts run their init code.
    //     After DOMContentLoaded has already fired, new listeners for it are never called.
    //     This shim intercepts addEventListener('DOMContentLoaded', cb) and calls cb immediately.
    const _origAddEventListener = document.addEventListener.bind(document);
    document.addEventListener = function(type, fn, opts) {
      if (type === 'DOMContentLoaded') {
        // DOM is already loaded, so fire the callback immediately (async to mimic real behavior)
        setTimeout(fn, 0);
        return;
      }
      return _origAddEventListener(type, fn, opts);
    };

    // 16. Load new page scripts sequentially
    for (const scriptInfo of pageScripts) {
      await loadScript(scriptInfo, filename);
    }

    // Restore original addEventListener after scripts have been loaded
    document.addEventListener = _origAddEventListener;

    // 17. Update sidebar active state
    document.querySelectorAll('.sidebar-nav-item').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-nav') === activeNav);
    });

    // 18. Update mobile nav active state
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
      // Match by href filename
      const itemHref = (item.getAttribute('href') || '').split('?')[0];
      item.classList.toggle('active', itemHref === filename);
    });

    // 19. Update topbar title
    const topbarTitle = document.querySelector('.topbar-title');
    if (topbarTitle) {
      const pageTitleMap = {
        'admin_dashboard.html': 'Dashboard',
        'analytics.html': 'Analytics',
        'manage_payments.html': 'Manage Payments',
        'manage_loans.html': 'Manage Loans',
        'manage_members.html': 'Manage Members',
        'contributions_overview.html': 'Contributions',
        'interest_penalties.html': 'Interest & Penalties',
        'financial_reports.html': 'Financial Reports',
        'broadcast_notifications.html': 'Broadcast Notifications',
        'manage_rules.html': 'Group Rules',
        'seed_money_overview.html': 'Seed Money',
        'approve_registrations.html': 'Approvals',
        'settings.html': 'Settings',
      };
      topbarTitle.textContent = pageTitleMap[filename] || newTitle;
    }

    // 20. Update browser document title
    document.title = newTitle;

    // 21. Push history state
    if (pushState) {
      const fullUrl = targetUrl.startsWith('http') ? targetUrl : targetUrl;
      history.pushState({ spaPage: targetUrl }, newTitle, fullUrl);
    }

    // 22. Remove loading indicator
    if (spaLoader && spaLoader.parentElement) spaLoader.remove();

    // 23. Scroll to top of content
    if (mainContent) mainContent.scrollTop = 0;
    window.scrollTo(0, 0);

    // 24. Close mobile sidebar if open
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (sidebarOverlay) sidebarOverlay.classList.remove('open');

  } catch (error) {
    console.error('SPA navigation error:', error);
    if (spaLoader && spaLoader.parentElement) spaLoader.remove();
    // Fallback: do a full page navigation
    window.location.href = targetUrl;
  } finally {
    _isNavigating = false;
  }
}

/**
 * Dynamically load a script element.
 * For module scripts, appends a cache-busting param to force re-execution.
 */
function loadScript(scriptInfo, pageId) {
  return new Promise((resolve) => {
    const el = document.createElement('script');
    el.setAttribute('data-spa-page', pageId);

    if (scriptInfo.type) el.type = scriptInfo.type;

    if (scriptInfo.src) {
      // Add cache-busting for module scripts so they re-execute
      let src = scriptInfo.src;
      if (scriptInfo.type === 'module') {
        const sep = src.includes('?') ? '&' : '?';
        src += `${sep}_t=${Date.now()}`;
      }
      el.src = src;
      el.onload = resolve;
      el.onerror = () => {
        console.warn('Failed to load script:', src);
        resolve(); // Don't block on script failures
      };
      _currentPageScripts.push(el);
      document.body.appendChild(el);
    } else if (scriptInfo.text) {
      el.textContent = scriptInfo.text;
      _currentPageScripts.push(el);
      document.body.appendChild(el);
      // Inline scripts execute synchronously when appended to DOM
      resolve();
    } else {
      resolve();
    }
  });
}

// Expose navigateTo globally for programmatic navigation
window.adminNavigateTo = navigateTo;

function buildSidebarHTML(gp, activeNav) {
  const navItems = [
    { section: 'Main', items: [
      { nav: 'dashboard', label: 'Dashboard', href: `admin_dashboard.html${gp}`, icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
      { nav: 'analytics', label: 'Analytics', href: `analytics.html${gp}`, icon: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
      { nav: 'reports', label: 'Reports', href: `financial_reports.html${gp}`, icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' },
    ]},
    { section: 'Management', items: [
      { nav: 'loans', label: 'Manage Loans', href: `manage_loans.html${gp}`, icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', badgeId: 'loansBadge' },
      { nav: 'payments', label: 'Payments', href: `manage_payments.html${gp}`, icon: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>', badgeId: 'paymentsBadge' },
      { nav: 'members', label: 'Members', href: `manage_members.html${gp}`, icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
      { nav: 'contributions', label: 'Contributions', href: `contributions_overview.html${gp}`, icon: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>' },
      { nav: 'penalties', label: 'Interest & Penalties', href: `interest_penalties.html${gp}`, icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' },
      { nav: 'seed-money', label: 'Seed Money', href: `seed_money_overview.html${gp}`, icon: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    ]},
    { section: 'Groups', items: [
      { nav: 'groups', label: 'Your Groups', href: 'select_group.html', icon: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' },
      { nav: 'create-group', label: 'Create Group', href: 'admin_registration.html', icon: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>' },
    ]},
    { section: 'Communications', items: [
      { nav: 'broadcast', label: 'Broadcast', href: `broadcast_notifications.html${gp}`, icon: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>' },
      { nav: 'approvals', label: 'Approvals', href: `approve_registrations.html${gp}`, icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>' },
      { nav: 'rules', label: 'Rules', href: `manage_rules.html${gp}`, icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>' },
      { nav: 'settings', label: 'Settings', href: `settings.html${gp}`, icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
    ]},
  ];

  let navHTML = '';
  for (const section of navItems) {
    navHTML += `<div class="sidebar-nav-section">
      <div class="sidebar-nav-label">${section.section}</div>`;
    for (const item of section.items) {
      const isActive = item.nav === activeNav ? ' active' : '';
      const badge = item.badgeId ? `<span class="sidebar-nav-badge" id="${item.badgeId}" style="display: none;">0</span>` : '';
      navHTML += `<a href="${item.href}" class="sidebar-nav-item${isActive}" data-nav="${item.nav}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>
        ${item.label}
        ${badge}
      </a>`;
    }
    navHTML += `</div>`;
  }

  return `
    <div class="sidebar-header">
      <a href="admin_dashboard.html${gp}" class="sidebar-logo">
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
      ${navHTML}
    </nav>
    <div class="sidebar-footer">
      <a href="user_dashboard.html" class="sidebar-nav-item" style="margin-bottom: var(--bn-space-3); background: rgba(255,255,255,0.05);" title="Switch to User View">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        <span>Switch to User View</span>
      </a>
      <div class="sidebar-user" id="sidebarUser">
        <div class="sidebar-user-avatar" id="sidebarUserAvatar" title="Profile">
          <img id="sidebarProfilePic" src="" alt="Profile" style="display: none;">
          <span id="sidebarUserInitials">A</span>
        </div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name" id="sidebarUserName">Admin</div>
          <div class="sidebar-user-role">Administrator</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--bn-gray);">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        <div class="user-menu-dropdown" id="userMenuDropdown">
          <a href="settings.html" class="user-menu-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span>Settings</span>
          </a>
          <a href="user_dashboard.html" class="user-menu-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <span>Switch to User View</span>
          </a>
          <button class="user-menu-item danger" id="logoutBtnSidebar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function buildTopbarHTML(pageTitle, gp) {
  return `
    <div class="topbar-left">
      <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Open menu">
        <span></span>
        <span></span>
        <span></span>
      </button>
      <div class="topbar-title-wrapper">
        <h1 class="topbar-title">${pageTitle}</h1>
        <div id="currentDate" style="font-size: var(--bn-text-xs); color: var(--bn-gray); font-weight: 500; margin-top: 2px;"></div>
      </div>
      <div class="topbar-search">
        <svg class="topbar-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="text" class="topbar-search-input" placeholder="Search members, groups, transactions...">
      </div>
    </div>
    <div class="topbar-right">
      <select class="form-select" id="currencySelector" style="width: auto; padding: 6px 12px; font-size: 12px; min-width: 90px;">
        <option value="MWK" selected>MWK</option>
        <option value="USD">USD</option>
        <option value="ZAR">ZAR</option>
        <option value="GBP">GBP</option>
      </select>
      <div class="view-toggle">
        <button class="view-toggle-btn active" id="adminViewBtn" title="Admin Dashboard">Admin</button>
        <button class="view-toggle-btn" id="userViewBtn" title="User Dashboard" onclick="window.location.href='user_dashboard.html'">User</button>
      </div>
      <button class="topbar-btn" id="selectGroupBtn" aria-label="Select Group" title="Select Group" onclick="window.location.href='select_group.html'">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3h18v18H3zM12 8v8M8 12h8"/>
        </svg>
      </button>
      <button class="topbar-btn" id="notificationsBtn" aria-label="Notifications">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span class="topbar-btn-badge notification-badge" id="notificationBadge" style="display: none;"></span>
      </button>
      <a href="settings.html" class="topbar-avatar" id="topbarAvatar" title="Settings & Profile">
        <img id="topbarProfilePic" src="" alt="Profile" style="display: none;">
        <span id="topbarUserInitials">A</span>
      </a>
    </div>
  `;
}

function buildMobileNavHTML(gp, activeNav) {
  const items = [
    { nav: 'dashboard', label: 'Home', href: `admin_dashboard.html${gp}`, icon: '🏠' },
    { nav: 'loans', label: 'Loans', href: `manage_loans.html${gp}`, icon: '💰' },
    { nav: 'payments', label: 'Payments', href: `manage_payments.html${gp}`, icon: '💳' },
    { nav: 'analytics', label: 'Analytics', href: `analytics.html${gp}`, icon: '📊' },
    { nav: 'user-view', label: 'User View', href: 'user_dashboard.html', icon: '👤' },
  ];

  let html = '<div class="mobile-nav-items">';
  for (const item of items) {
    const isActive = item.nav === activeNav ? ' active' : '';
    html += `<a href="${item.href}" class="mobile-nav-item${isActive}">
      <span class="mobile-nav-icon">${item.icon}</span>
      <span>${item.label}</span>
    </a>`;
  }
  html += '</div>';
  return html;
}

function setupAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = '../login.html';
      return;
    }
    currentUser = user;

    try {
      // Load user profile for sidebar and topbar
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const displayName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || user.email;
        const initials = getInitials(userData.firstName, userData.lastName);

        // Update sidebar user info
        const sidebarName = document.getElementById('sidebarUserName');
        const sidebarInitials = document.getElementById('sidebarUserInitials');
        const sidebarPic = document.getElementById('sidebarProfilePic');

        if (sidebarName) sidebarName.textContent = displayName;
        if (sidebarInitials) sidebarInitials.textContent = initials;

        if (userData.profilePicUrl && sidebarPic) {
          sidebarPic.src = userData.profilePicUrl;
          sidebarPic.style.display = 'block';
          if (sidebarInitials) sidebarInitials.style.display = 'none';
        }

        // Update topbar user info
        const topbarInitials = document.getElementById('topbarUserInitials');
        const topbarPic = document.getElementById('topbarProfilePic');

        if (topbarInitials) topbarInitials.textContent = initials;
        if (userData.profilePicUrl && topbarPic) {
          topbarPic.src = userData.profilePicUrl;
          topbarPic.style.display = 'block';
          if (topbarInitials) topbarInitials.style.display = 'none';
        }
      }

      // Load group name if available
      if (selectedGroupId) {
        try {
          const groupDoc = await getDoc(doc(db, 'groups', selectedGroupId));
          if (groupDoc.exists()) {
            groupName = groupDoc.data().name || 'Group';
            // Optionally update topbar title subtitle
            const dateEl = document.getElementById('currentDate');
            if (dateEl && groupName) {
              const dateText = dateEl.textContent;
              if (!dateText.includes('•')) {
                dateEl.textContent = `${groupName} • ${dateText}`;
              }
            }
          }
        } catch (e) {
          console.warn('Could not load group name:', e);
        }
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  });
}

function setupEventListeners() {
  // Mobile menu toggle
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');

  if (mobileMenuBtn && sidebar && sidebarOverlay) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      sidebarOverlay.classList.toggle('open');
    });

    sidebarOverlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('open');
    });
  }

  // User menu dropdown
  const sidebarUser = document.getElementById('sidebarUser');
  const userMenuDropdown = document.getElementById('userMenuDropdown');

  if (sidebarUser && userMenuDropdown) {
    sidebarUser.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenuDropdown.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      userMenuDropdown.classList.remove('show');
    });
  }

  // Logout button in sidebar dropdown
  const logoutBtn = document.getElementById('logoutBtnSidebar');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }

  // Currency selector
  const currencySelector = document.getElementById('currencySelector');
  if (currencySelector) {
    // Load saved currency
    const savedCurrency = localStorage.getItem('selectedCurrency') || 'MWK';
    currencySelector.value = savedCurrency;
    currencySelector.addEventListener('change', (e) => {
      localStorage.setItem('selectedCurrency', e.target.value);
      // Dispatch event for other scripts to respond
      window.dispatchEvent(new CustomEvent('currencyChanged', { detail: e.target.value }));
    });
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    sessionStorage.removeItem('selectedGroupId');
    sessionStorage.removeItem('isAdmin');
    sessionStorage.removeItem('viewMode');
    sessionStorage.removeItem('userRole');
    localStorage.removeItem('selectedGroupId');
    localStorage.removeItem('userEmail');
    window.location.href = '../login.html';
  } catch (error) {
    console.error('Logout error:', error);
    alert('An error occurred while logging out. Please try again.');
  }
}

function updateCurrentDate() {
  const dateEl = document.getElementById('currentDate');
  if (dateEl) {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateEl.textContent = now.toLocaleDateString('en-US', options);
  }
}

function getInitials(first, last) {
  const f = (first || '').charAt(0).toUpperCase();
  const l = (last || '').charAt(0).toUpperCase();
  return f + l || 'A';
}

/**
 * Show a toast notification.
 * Can be called from any admin page.
 */
export function showToast(message, type = 'success', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '✓',
    warning: '⚠',
    danger: '✕',
    info: 'ℹ'
  };

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      <p class="toast-message">${message}</p>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('exiting');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
