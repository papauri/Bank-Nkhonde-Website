import { getSession, listMyGroups, logout, apiGet } from './api.js';

const ADMIN_ROLES = ['admin', 'senior_admin', 'treasurer'];
const POLL_INTERVAL_MS = 60000;

let currentUser = null;
let notifPollTimer = null;
let notifVisibilityHandler = null;
let currentNotifGroupId = null;

// Handle window resize to update mobile sign in button visibility
function updateMobileSignButtons() {
  const navSignInMobile = document.getElementById('navSignInMobile');
  const navSignOutMobile = document.getElementById('navSignOutMobile');
  const isMobile = window.innerWidth <= 768;

  if (currentUser) {
    // User is signed in - sign out is in bottom nav, not here
    if (navSignInMobile) navSignInMobile.style.display = 'none';
    if (navSignOutMobile) navSignOutMobile.style.display = 'none';
  } else {
    // User is not signed in
    if (navSignInMobile) navSignInMobile.style.display = isMobile ? 'inline-flex' : 'none';
    if (navSignOutMobile) navSignOutMobile.style.display = 'none';
  }
}

window.addEventListener('resize', updateMobileSignButtons);

async function handleSignOut(e) {
  if (e) e.preventDefault();
  try {
    await logout();
  } catch (error) {
    console.error('Error signing out:', error);
  } finally {
    sessionStorage.clear();
    localStorage.removeItem('selectedGroupId');
    localStorage.removeItem('isAdmin');
    window.location.reload();
  }
}

function hideNotificationBadge() {
  const badge = document.getElementById('indexNotificationBadge');
  if (!badge) return;
  badge.style.display = 'none';
  if (badge.parentElement) badge.parentElement.classList.remove('has-notifications');
}

async function refreshIndexNotificationBadge() {
  const badge = document.getElementById('indexNotificationBadge');
  if (!badge || !currentNotifGroupId) return;
  try {
    const data = await apiGet('notifications.list', {groupId: currentNotifGroupId});
    // Trust the server's unreadCount, not a client-side filter.
    const unreadCount = Number(data && data.unreadCount) || 0;
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      badge.style.display = 'flex';
      if (badge.parentElement) badge.parentElement.classList.add('has-notifications');
    } else {
      hideNotificationBadge();
    }
  } catch (error) {
    // Background poll failure — never toast/spam, just keep the last-known badge state.
  }
}

function stopNotificationPolling() {
  if (notifPollTimer !== null) {
    clearInterval(notifPollTimer);
    notifPollTimer = null;
  }
  if (notifVisibilityHandler) {
    document.removeEventListener('visibilitychange', notifVisibilityHandler);
    notifVisibilityHandler = null;
  }
  currentNotifGroupId = null;
}

function startNotificationPolling(groupId) {
  stopNotificationPolling();
  currentNotifGroupId = groupId;

  notifVisibilityHandler = () => {
    if (document.hidden) {
      if (notifPollTimer !== null) {
        clearInterval(notifPollTimer);
        notifPollTimer = null;
      }
    } else {
      refreshIndexNotificationBadge();
      if (notifPollTimer === null) {
        notifPollTimer = setInterval(refreshIndexNotificationBadge, POLL_INTERVAL_MS);
      }
    }
  };
  document.addEventListener('visibilitychange', notifVisibilityHandler);

  refreshIndexNotificationBadge();
  if (!document.hidden) {
    notifPollTimer = setInterval(refreshIndexNotificationBadge, POLL_INTERVAL_MS);
  }
}

function loadUserPersonalization(user, isAdmin, groupsCount) {
  const userName = user.fullName || user.email || 'Member';

  const userDisplayName = document.getElementById('userDisplayName');
  if (userDisplayName) userDisplayName.textContent = userName;

  const userGreeting = document.getElementById('userGreeting');
  const userSubGreeting = document.getElementById('userSubGreeting');
  const userDescription = document.getElementById('userDescription');
  const userQuickStats = document.getElementById('userQuickStats');

  // Special experience for standard users (not admins)
  if (!isAdmin) {
    // Personalized greetings
    const greetings = [
      'Your financial journey continues',
      'Building wealth, one contribution at a time',
      'Your savings story continues',
      'Growing together, saving together'
    ];
    const subGreetings = [
      'Track, save, and grow together',
      'Every contribution counts',
      'Your financial future starts here',
      'Empowering your savings journey'
    ];

    const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
    const randomSubGreeting = subGreetings[Math.floor(Math.random() * subGreetings.length)];

    if (userGreeting) userGreeting.textContent = randomGreeting;
    if (userSubGreeting) userSubGreeting.textContent = randomSubGreeting;

    if (userDescription) {
      userDescription.textContent = `Welcome back, ${userName}! Track your contributions, manage your loans, and stay connected with your savings groups. Your financial success is our priority.`;
    }

    // Display quick stats — group count only; no cross-group money aggregate endpoint exists.
    if (userQuickStats) {
      userQuickStats.classList.remove('hidden');
      const groupsCountEl = document.getElementById('userGroupsCount');
      const upcomingPaymentsEl = document.getElementById('userUpcomingPayments');
      const totalSavingsEl = document.getElementById('userTotalSavings');

      if (groupsCountEl) groupsCountEl.textContent = String(groupsCount || 0);
      if (upcomingPaymentsEl) upcomingPaymentsEl.textContent = '—';
      if (totalSavingsEl) totalSavingsEl.textContent = '—';
    }
  } else {
    // Admin experience
    if (userGreeting) userGreeting.textContent = 'Welcome back, Administrator!';
    if (userSubGreeting) userSubGreeting.textContent = 'Manage your groups and members';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const navCtaGuest = document.querySelector('.nav-cta-guest');
  const navCtaUser = document.querySelector('.nav-cta-user');
  const heroContentGuest = document.querySelector('.hero-content-guest');
  const heroContentUser = document.querySelector('.hero-content-user');
  const ctaContentGuest = document.querySelector('.cta-content-guest');
  const ctaContentUser = document.querySelector('.cta-content-user');
  const notificationBtn = document.getElementById('indexNotificationBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const navSignOutMobile = document.getElementById('navSignOutMobile');

  const navMobileToggle = document.getElementById('navMobileToggle');
  const navLinks = document.getElementById('navLinks');
  if (navMobileToggle && navLinks) {
    navMobileToggle.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('is-open');
      navMobileToggle.classList.toggle('is-active', isOpen);
      navMobileToggle.setAttribute('aria-expanded', String(isOpen));
    });
    navLinks.querySelectorAll('.nav-link').forEach((link) => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('is-open');
        navMobileToggle.classList.remove('is-active');
        navMobileToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  let user = null;
  try {
    user = await getSession();
  } catch (error) {
    console.error('Error checking session:', error);
  }
  currentUser = user;

  if (user) {
    let groups = [];
    try {
      groups = await listMyGroups();
    } catch (error) {
      console.error('Error loading groups:', error);
    }

    const selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
    const selectedGroup = selectedGroupId
      ? groups.find((g) => String(g.id) === String(selectedGroupId))
      : null;
    const isAdmin = selectedGroup ? ADMIN_ROLES.includes(selectedGroup.myRole) : false;
    const dashboardUrl = isAdmin ? 'pages/admin_dashboard.html' : 'pages/user_dashboard.html';

    navCtaGuest.classList.add('hidden');
    navCtaUser.classList.remove('hidden');
    heroContentGuest.classList.add('hidden');
    heroContentUser.classList.remove('hidden');
    ctaContentGuest.classList.add('hidden');
    ctaContentUser.classList.remove('hidden');
    if (notificationBtn) notificationBtn.classList.remove('hidden');

    // Show Sign Out on mobile, hide Sign In
    updateMobileSignButtons();

    // Update mobile bottom nav
    if (typeof window.updateMobileBottomNav === 'function') {
      window.updateMobileBottomNav(user);
    }

    const navDashboardLink = document.getElementById('navDashboardLink');
    if (navDashboardLink) {
      navDashboardLink.href = dashboardUrl;
      navDashboardLink.textContent = isAdmin ? 'Admin Dashboard' : 'Dashboard';
    }
    const heroDashboardLink = document.getElementById('heroDashboardLink');
    if (heroDashboardLink) heroDashboardLink.href = dashboardUrl;
    const ctaDashboardLink = document.getElementById('ctaDashboardLink');
    if (ctaDashboardLink) ctaDashboardLink.href = dashboardUrl;

    // "My Groups" / "Manage Groups" / "Switch Group" links previously pointed
    // at the retired select_group.html; they now resolve to the same
    // dashboard target (the nav's group-switcher dropdown, built in
    // nav_sql.js, is the actual group-switching UI).
    const navMyGroupsLink = document.getElementById('navMyGroupsLink');
    if (navMyGroupsLink) navMyGroupsLink.href = dashboardUrl;
    const heroManageGroupsLink = document.getElementById('heroManageGroupsLink');
    if (heroManageGroupsLink) heroManageGroupsLink.href = dashboardUrl;
    const ctaSwitchGroupLink = document.getElementById('ctaSwitchGroupLink');
    if (ctaSwitchGroupLink) ctaSwitchGroupLink.href = dashboardUrl;

    // Update mobile bottom nav dashboard link
    const mobileDashboardLink = document.getElementById('mobileDashboardLink');
    if (mobileDashboardLink) {
      mobileDashboardLink.href = dashboardUrl;
    }

    // Personalize experience
    loadUserPersonalization(user, isAdmin, groups.length);

    // Notification badge polling
    if (selectedGroupId) {
      startNotificationPolling(selectedGroupId);
    } else {
      hideNotificationBadge();
    }

    // Logout handler
    if (logoutBtn) logoutBtn.onclick = handleSignOut;

    // Mobile Sign Out handler
    if (navSignOutMobile) navSignOutMobile.onclick = handleSignOut;
  } else {
    navCtaGuest.classList.remove('hidden');
    navCtaUser.classList.add('hidden');
    heroContentGuest.classList.remove('hidden');
    heroContentUser.classList.add('hidden');
    ctaContentGuest.classList.remove('hidden');
    ctaContentUser.classList.add('hidden');
    if (notificationBtn) notificationBtn.classList.add('hidden');

    // Show Sign In on mobile, hide Sign Out
    updateMobileSignButtons();

    // Hide mobile bottom nav for guests
    if (typeof window.updateMobileBottomNav === 'function') {
      window.updateMobileBottomNav(null);
    }

    // Stop any notification polling
    stopNotificationPolling();
    hideNotificationBadge();
  }
});
