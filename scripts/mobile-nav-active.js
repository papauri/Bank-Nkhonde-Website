/**
 * Mobile Navigation Active State Handler
 * Highlights the active page in mobile navigation
 */

(function() {
  'use strict';

  function highlightActiveNavItem() {
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item[href]');
    if (!mobileNavItems.length) return;

    // Get current page filename
    const currentPage = window.location.pathname.split('/').pop() || window.location.pathname;
    const currentPageName = currentPage.replace('.html', '');

    mobileNavItems.forEach(item => {
      const href = item.getAttribute('href');
      if (!href) return;

      // Extract page name from href
      const pageName = href.split('/').pop().replace('.html', '');

      // Remove active class first
      item.classList.remove('active');

      // Check if this item matches current page
      if (href.includes(currentPage) || pageName === currentPageName) {
        item.classList.add('active');
      }

      // Also check for specific matches
      const pageMappings = {
        'user_dashboard': ['user_dashboard.html', 'user_dashboard_new.html'],
        'admin_dashboard': ['admin_dashboard.html'],
        'group_page': ['group_page.html'],
        'loan_payments': ['loan_payments.html'],
        'manage_loans': ['manage_loans.html'],
        'manage_payments': ['manage_payments.html'],
        'analytics': ['analytics.html'],
        'contacts': ['contacts.html'],
        'settings': ['settings.html'],
        'messages': ['messages.html'],
        'view_rules': ['view_rules.html']
      };

      // Check mappings
      for (const [key, pages] of Object.entries(pageMappings)) {
        if (pages.some(p => currentPage.includes(p.replace('.html', '')))) {
          if (pageName === key || pages.some(p => href.includes(p))) {
            item.classList.add('active');
          }
        }
      }
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', highlightActiveNavItem);
  } else {
    highlightActiveNavItem();
  }

  // Also run after navigation (for SPA-like navigation)
  window.addEventListener('load', highlightActiveNavItem);
  window.addEventListener('hashchange', highlightActiveNavItem);
})();
