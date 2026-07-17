/**
 * nav_sql.js — session-based navigation module for the SQL/PHP era.
 *
 * Single entry point that covers both the user top-nav (+ mobile menu) and
 * the admin sidebar/topbar/mobile-nav, replacing shared-top-nav.js,
 * unified-navigation.js, and admin-layout.js for ported (_sql.js) pages.
 *
 * Navigation is full-page (anchor href) by default. A pilot SPA content
 * router (scripts/spa-router.js) is bootstrapped from initNav() below and
 * takes over same-app navigation ONLY between the 3 whitelisted pages it
 * knows about (see PAGE_CONFIG in that file); every other page still
 * navigates the normal way, and every converted page's init() still starts
 * with `await requireSession()`, router-driven or not.
 *
 * Imports: api.js for the session/logout calls, and spa-router.js (imported
 * statically so its module-eval side effect — window.__bnSpa = true — lands
 * before any page's own DOMContentLoaded fires). Role/name shown here is UX
 * only — the server (require_role()) is the real gate.
 */

import {getSession, logout as apiLogout, listMyGroups} from "./api.js";
import {initSpaRouter} from "./spa-router.js";

const LOGIN_URL = "../login.html";

/** Roles that route into the admin dashboard on group switch. */
const ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];

/** Static icon markup — no interpolated data, safe as innerHTML. */
const ICONS = {
  logo: `<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>`,
  grid: `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>`,
  bell: `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`,
  logout: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`,
  close: `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  burger: `<span></span><span></span><span></span>`,
  dashboard: `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  loans: `<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`,
  payments: `<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>`,
  members: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  analytics: `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
  switchUser: `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  chevronDown: `<polyline points="6 9 12 15 18 9"/>`,
};

/** Nav items shared by the admin sidebar and admin mobile bottom-nav. */
const ADMIN_NAV_ITEMS = [
  {nav: "dashboard", label: "Dashboard", href: "admin_dashboard.html", icon: ICONS.dashboard},
  {nav: "analytics", label: "Analytics", href: "analytics.html", icon: ICONS.analytics},
  {nav: "loans", label: "Manage Loans", href: "manage_loans.html", icon: ICONS.loans},
  {nav: "payments", label: "Payments", href: "manage_payments.html", icon: ICONS.payments},
  {nav: "members", label: "Members", href: "manage_members.html", icon: ICONS.members},
  {nav: "settings", label: "Settings", href: "settings.html", icon: ICONS.settings},
];

/**
 * Build an SVG element from a static icon key. Never pass user data here.
 * @param {string} key Key into ICONS.
 * @param {string} [size] Width/height attribute value.
 * @return {SVGElement} The svg element.
 */
function svgIcon(key, size = "20") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  // Static, hardcoded icon markup only — never interpolated user/DB data.
  svg.innerHTML = ICONS[key] || "";
  return svg;
}

/**
 * Compute initials from a full name, safely (no HTML involved).
 * @param {string} fullName Display name.
 * @return {string} Up to two uppercase initials.
 */
function initialsFrom(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  const first = parts[0].charAt(0).toUpperCase();
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0).toUpperCase() : "";
  return (first + last) || "U";
}

/**
 * Clear local session UX state and send the user to the login page. Called
 * unconditionally after a logout attempt, whether or not the server call
 * succeeded — never leave a user sitting on a signed-in page.
 */
function clearLocalSessionAndRedirect() {
  try {
    sessionStorage.removeItem("selectedGroupId");
    sessionStorage.removeItem("isAdmin");
    sessionStorage.removeItem("viewMode");
    sessionStorage.removeItem("userRole");
    localStorage.removeItem("selectedGroupId");
    localStorage.removeItem("userEmail");
  } catch (storageError) {
    // Storage may be unavailable (private browsing); ignore and continue.
  }
  window.location.href = LOGIN_URL;
}

/**
 * Perform logout via api.js, then redirect regardless of outcome.
 * @return {Promise<void>}
 */
async function handleLogout() {
  try {
    await apiLogout();
  } catch (error) {
    // Server call failed/rejected — still clear local state below.
  } finally {
    clearLocalSessionAndRedirect();
  }
}

/**
 * Show a toast notification. Message is rendered via textContent, so callers
 * may safely pass dynamic/user-influenced strings.
 * @param {string} message Text to display.
 * @param {string} [type] One of success|warning|danger|info.
 * @param {number} [duration] Milliseconds before auto-dismiss.
 */
export function showToast(message, type = "success", duration = 4000) {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    container.id = "toastContainer";
    document.body.appendChild(container);
  }

  const iconChar = {success: "✓", warning: "⚠", danger: "✕", info: "ℹ"}[type] || "ℹ";

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const iconEl = document.createElement("div");
  iconEl.className = "toast-icon";
  iconEl.textContent = iconChar;

  const contentEl = document.createElement("div");
  contentEl.className = "toast-content";
  const messageEl = document.createElement("p");
  messageEl.className = "toast-message";
  messageEl.textContent = message;
  contentEl.appendChild(messageEl);

  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Dismiss");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => toast.remove());

  toast.appendChild(iconEl);
  toast.appendChild(contentEl);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("exiting");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Persist the chosen group + role and navigate to the group's correct
 * dashboard. Dual-write to localStorage and sessionStorage mirrors
 * select_group_sql.js's selectGroup(). Role is UX only — the server
 * re-checks it on every request.
 * @param {Object} group {groupId, groupName, myRole}
 */
function switchGroup(group) {
  const role = ADMIN_ROLES.includes(group.myRole) ? "admin" : "user";
  try {
    localStorage.setItem("selectedGroupId", group.groupId);
    localStorage.setItem("userRole", role);
    sessionStorage.setItem("selectedGroupId", group.groupId);
    sessionStorage.setItem("userRole", role);
  } catch (storageError) {
    // Storage may be unavailable (private browsing); navigation still proceeds.
  }
  window.location.href = role === "admin" ? "admin_dashboard.html" : "user_dashboard.html";
}

/**
 * Build the in-place group-switcher chip + dropdown. Names are set via
 * textContent only (server data, never trusted as markup).
 * @param {Array<Object>} groups Caller's groups ({groupId, groupName, myRole}).
 * @return {HTMLElement} The wrapper element to insert into the top-nav.
 */
function buildGroupSwitcher(groups) {
  let selectedId = null;
  try {
    selectedId = localStorage.getItem("selectedGroupId");
  } catch (storageError) {
    selectedId = null;
  }
  const currentGroup = groups.find((g) => g.groupId === selectedId) || null;

  const wrapper = document.createElement("div");
  wrapper.className = "current-group-display";
  wrapper.id = "currentGroupDisplay";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "current-group-toggle";
  toggle.id = "currentGroupToggle";
  toggle.title = "Click to change group";
  toggle.setAttribute("aria-haspopup", "listbox");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "currentGroupMenu");

  const groupNameEl = document.createElement("span");
  groupNameEl.className = "current-group-name";
  groupNameEl.id = "currentGroupName";
  groupNameEl.textContent = currentGroup ? (currentGroup.groupName || "Unnamed Group") : "Select a group";

  toggle.appendChild(groupNameEl);
  toggle.appendChild(svgIcon("chevronDown", "16"));

  const menu = document.createElement("ul");
  menu.className = "current-group-menu";
  menu.id = "currentGroupMenu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;

  const closeMenu = () => {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };
  const openMenu = () => {
    if (menu.children.length === 0) return;
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    const selectedItem = menu.querySelector('[aria-selected="true"]') || menu.firstElementChild;
    if (selectedItem) selectedItem.focus();
  };

  groups.forEach((group) => {
    const item = document.createElement("li");
    item.className = "current-group-menu-item";
    item.setAttribute("role", "option");
    item.tabIndex = -1;
    item.textContent = group.groupName || "Unnamed Group";
    if (currentGroup && group.groupId === currentGroup.groupId) {
      item.setAttribute("aria-selected", "true");
    }
    const choose = () => {
      closeMenu();
      if (!currentGroup || group.groupId !== currentGroup.groupId) {
        switchGroup(group);
      }
    };
    item.addEventListener("click", choose);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        toggle.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = Array.from(menu.children);
        const idx = items.indexOf(item);
        const next = e.key === "ArrowDown" ? items[idx + 1] : items[idx - 1];
        if (next) next.focus();
      }
    });
    menu.appendChild(item);
  });

  toggle.addEventListener("click", () => {
    if (menu.hidden) openMenu(); else closeMenu();
  });
  toggle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      openMenu();
    } else if (e.key === "Escape") {
      closeMenu();
    }
  });
  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target)) closeMenu();
  });

  wrapper.appendChild(toggle);
  wrapper.appendChild(menu);
  return wrapper;
}

/* ============================================================
   USER VARIANT — top-nav + mobile menu (mirrors shared-top-nav.js)
   ============================================================ */

/**
 * Build and inject the user top-nav and mobile menu.
 * @param {Object} user Session user ({fullName, email, ...}).
 * @param {Object} opts {showGroupDisplay, showViewToggle, logoLink, isAdmin}
 */
function renderUserNav(user, opts) {
  const {showGroupDisplay = false, showViewToggle = false, logoLink = "user_dashboard.html", groups = []} = opts;

  const nav = document.createElement("nav");
  nav.className = "top-nav";

  const container = document.createElement("div");
  container.className = "top-nav-container";

  // Logo
  const logo = document.createElement("a");
  logo.href = logoLink;
  logo.className = "top-nav-logo";
  const logoIcon = document.createElement("div");
  logoIcon.className = "top-nav-logo-icon";
  logoIcon.appendChild(svgIcon("logo", "24"));
  const logoText = document.createElement("span");
  logoText.className = "top-nav-logo-text";
  logoText.textContent = "Bank Nkhonde";
  logo.appendChild(logoIcon);
  logo.appendChild(logoText);
  container.appendChild(logo);

  // Optional current-group switcher (group names filled via textContent only)
  if (showGroupDisplay) {
    container.appendChild(buildGroupSwitcher(groups));
  }

  // Actions
  const actions = document.createElement("div");
  actions.className = "top-nav-actions";

  if (showViewToggle) {
    const toggle = document.createElement("div");
    toggle.className = "view-toggle";
    toggle.id = "viewToggle";
    const adminBtn = document.createElement("button");
    adminBtn.type = "button";
    adminBtn.className = "view-toggle-btn";
    adminBtn.title = "Switch to Admin Dashboard";
    adminBtn.textContent = "Admin";
    adminBtn.addEventListener("click", () => {
      window.location.href = "admin_dashboard.html";
    });
    const userBtn = document.createElement("button");
    userBtn.type = "button";
    userBtn.className = "view-toggle-btn active";
    userBtn.title = "User Dashboard (Current)";
    userBtn.textContent = "User";
    toggle.appendChild(adminBtn);
    toggle.appendChild(userBtn);
    actions.appendChild(toggle);
  }

  const notifBtn = document.createElement("button");
  notifBtn.type = "button";
  notifBtn.className = "top-nav-btn";
  notifBtn.id = "notificationsBtn";
  notifBtn.setAttribute("aria-label", "Notifications");
  notifBtn.appendChild(svgIcon("bell"));
  const notifBadge = document.createElement("span");
  notifBadge.id = "notificationBadge";
  notifBadge.className = "notification-badge";
  notifBtn.appendChild(notifBadge);
  notifBtn.addEventListener("click", () => {
    if (typeof window.toggleNotifications === "function") {
      window.toggleNotifications();
    }
  });
  actions.appendChild(notifBtn);

  const logoutBtn = document.createElement("button");
  logoutBtn.type = "button";
  logoutBtn.className = "top-nav-btn";
  logoutBtn.id = "logoutBtn";
  logoutBtn.title = "Logout";
  logoutBtn.setAttribute("aria-label", "Logout");
  logoutBtn.appendChild(svgIcon("logout"));
  logoutBtn.addEventListener("click", handleLogout);
  actions.appendChild(logoutBtn);

  const avatar = document.createElement("a");
  avatar.href = "settings.html";
  avatar.className = "top-nav-avatar";
  avatar.id = "userAvatar";
  avatar.title = "Settings & Profile";
  avatar.setAttribute("aria-label", "Settings & Profile");
  if (user && user.profileImageUrl) {
    const avatarImg = document.createElement("img");
    avatarImg.src = user.profileImageUrl;
    avatarImg.alt = (user && user.fullName) || "";
    avatar.appendChild(avatarImg);
  } else {
    const initialsEl = document.createElement("span");
    initialsEl.id = "userInitials";
    initialsEl.textContent = initialsFrom(user && user.fullName);
    avatar.appendChild(initialsEl);
  }
  actions.appendChild(avatar);

  container.appendChild(actions);

  // Mobile burger
  const burgerBtn = document.createElement("button");
  burgerBtn.type = "button";
  burgerBtn.className = "mobile-menu-btn";
  burgerBtn.id = "mobileMenuBtn";
  burgerBtn.setAttribute("aria-label", "Menu");
  burgerBtn.setAttribute("aria-expanded", "false");
  burgerBtn.setAttribute("aria-controls", "mobileMenu");
  burgerBtn.innerHTML = ICONS.burger; // static markup only
  container.appendChild(burgerBtn);

  nav.appendChild(container);

  // Mobile overlay + menu
  const overlay = document.createElement("div");
  overlay.className = "mobile-menu-overlay";
  overlay.id = "mobileMenuOverlay";

  const mobileMenu = document.createElement("div");
  mobileMenu.className = "mobile-menu";
  mobileMenu.id = "mobileMenu";

  const menuHeader = document.createElement("div");
  menuHeader.className = "mobile-menu-header";
  const menuTitle = document.createElement("h2");
  menuTitle.className = "mobile-menu-title";
  menuTitle.textContent = "Menu";
  const menuClose = document.createElement("button");
  menuClose.type = "button";
  menuClose.className = "mobile-menu-close";
  menuClose.id = "mobileMenuClose";
  menuClose.setAttribute("aria-label", "Close menu");
  menuClose.appendChild(svgIcon("close"));
  menuHeader.appendChild(menuTitle);
  menuHeader.appendChild(menuClose);
  mobileMenu.appendChild(menuHeader);

  const menuItems = document.createElement("div");
  menuItems.className = "mobile-menu-items";

  const links = [
    {href: "user_dashboard.html", label: "Dashboard", icon: "dashboard"},
    {href: "settings.html", label: "Settings", icon: "settings"},
  ];
  links.forEach(({href, label, icon}) => {
    const a = document.createElement("a");
    a.href = href;
    a.className = "mobile-menu-item";
    a.appendChild(svgIcon(icon));
    const span = document.createElement("span");
    span.textContent = label;
    a.appendChild(span);
    a.addEventListener("click", closeMobileMenu);
    menuItems.appendChild(a);
  });

  const signOutBtn = document.createElement("button");
  signOutBtn.type = "button";
  signOutBtn.className = "mobile-menu-item danger";
  signOutBtn.id = "mobileLogoutBtn";
  signOutBtn.appendChild(svgIcon("logout"));
  const signOutLabel = document.createElement("span");
  signOutLabel.textContent = "Sign Out";
  signOutBtn.appendChild(signOutLabel);
  signOutBtn.addEventListener("click", handleLogout);
  menuItems.appendChild(signOutBtn);

  mobileMenu.appendChild(menuItems);

  const body = document.body;
  body.insertBefore(mobileMenu, body.firstChild);
  body.insertBefore(overlay, body.firstChild);
  body.insertBefore(nav, body.firstChild);

  wireMobileMenu(burgerBtn, menuClose, overlay, mobileMenu);
}

let _closeMobileMenuFn = null;

/** Programmatic close, exposed to callers within this module (e.g. link clicks). */
function closeMobileMenu() {
  if (_closeMobileMenuFn) _closeMobileMenuFn();
}

/**
 * Wire open/close handlers for the mobile menu; also exposes
 * window.closeMobileMenu for parity with legacy inline handlers elsewhere.
 * @param {HTMLElement} btn Burger button.
 * @param {HTMLElement} closeBtn Close button inside the menu.
 * @param {HTMLElement} overlay Overlay element.
 * @param {HTMLElement} menu Menu panel.
 */
function wireMobileMenu(btn, closeBtn, overlay, menu) {
  let lastFocused = null;

  const focusableSelector = "a[href], button:not([disabled])";
  const getFocusable = () => Array.from(menu.querySelectorAll(focusableSelector));

  const open = () => {
    lastFocused = document.activeElement;
    menu.classList.add("active");
    overlay.classList.add("active");
    if (btn) {
      btn.classList.add("active");
      btn.setAttribute("aria-expanded", "true");
    }
    document.body.style.overflow = "hidden";
    if (closeBtn) closeBtn.focus();
  };
  const close = () => {
    menu.classList.remove("active");
    overlay.classList.remove("active");
    if (btn) {
      btn.classList.remove("active");
      btn.setAttribute("aria-expanded", "false");
    }
    document.body.style.overflow = "";
    if (lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus();
    } else if (btn) {
      btn.focus();
    }
  };

  _closeMobileMenuFn = close;
  window.closeMobileMenu = close;

  if (btn) btn.addEventListener("click", open);
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (overlay) overlay.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (!menu.classList.contains("active")) return;
    if (e.key === "Escape") {
      close();
      return;
    }
    // Simple focus trap while the mobile menu is open.
    if (e.key === "Tab") {
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

/* ============================================================
   ADMIN VARIANT — sidebar + topbar + mobile bottom nav
   ============================================================ */

/**
 * Build and inject the admin sidebar, topbar, and mobile bottom-nav.
 * @param {Object} user Session user ({fullName, role, ...}).
 * @param {Object} opts {activePage, pageTitle}
 */
function renderAdminNav(user, opts) {
  const {activePage = "dashboard", pageTitle = "Dashboard"} = opts;

  const mainContent = document.getElementById("mainContent") || document.querySelector(".main-content");

  // Sidebar
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.id = "sidebar";

  const sidebarHeader = document.createElement("div");
  sidebarHeader.className = "sidebar-header";
  const sidebarLogo = document.createElement("a");
  sidebarLogo.href = "admin_dashboard.html";
  sidebarLogo.className = "sidebar-logo";
  const sidebarLogoIcon = document.createElement("div");
  sidebarLogoIcon.className = "sidebar-logo-icon";
  sidebarLogoIcon.appendChild(svgIcon("logo", "24"));
  const sidebarLogoText = document.createElement("span");
  sidebarLogoText.className = "sidebar-logo-text";
  sidebarLogoText.textContent = "Bank Nkhonde";
  sidebarLogo.appendChild(sidebarLogoIcon);
  sidebarLogo.appendChild(sidebarLogoText);
  sidebarHeader.appendChild(sidebarLogo);
  sidebar.appendChild(sidebarHeader);

  const sidebarNav = document.createElement("nav");
  sidebarNav.className = "sidebar-nav";
  ADMIN_NAV_ITEMS.forEach((item) => {
    const a = document.createElement("a");
    a.href = item.href;
    const isActive = item.nav === activePage;
    a.className = "sidebar-nav-item" + (isActive ? " active" : "");
    a.setAttribute("data-nav", item.nav);
    if (isActive) a.setAttribute("aria-current", "page");
    a.appendChild(svgIcon(item.icon));
    const label = document.createElement("span");
    label.textContent = item.label;
    a.appendChild(label);
    sidebarNav.appendChild(a);
  });
  sidebar.appendChild(sidebarNav);

  const sidebarFooter = document.createElement("div");
  sidebarFooter.className = "sidebar-footer";
  const switchUserLink = document.createElement("a");
  switchUserLink.href = "user_dashboard.html";
  switchUserLink.className = "sidebar-nav-item";
  switchUserLink.title = "Switch to User View";
  switchUserLink.appendChild(svgIcon("switchUser"));
  const switchLabel = document.createElement("span");
  switchLabel.textContent = "Switch to User View";
  switchUserLink.appendChild(switchLabel);
  sidebarFooter.appendChild(switchUserLink);

  const sidebarUser = document.createElement("div");
  sidebarUser.className = "sidebar-user";
  sidebarUser.id = "sidebarUser";
  const sidebarAvatar = document.createElement("div");
  sidebarAvatar.className = "sidebar-user-avatar";
  const sidebarInitials = document.createElement("span");
  sidebarInitials.id = "sidebarUserInitials";
  if (user && user.profileImageUrl) {
    const sidebarImg = document.createElement("img");
    sidebarImg.src = user.profileImageUrl;
    sidebarImg.alt = (user && user.fullName) || "";
    sidebarAvatar.appendChild(sidebarImg);
  } else {
    sidebarInitials.textContent = initialsFrom(user && user.fullName);
    sidebarAvatar.appendChild(sidebarInitials);
  }
  const sidebarInfo = document.createElement("div");
  sidebarInfo.className = "sidebar-user-info";
  const sidebarName = document.createElement("div");
  sidebarName.className = "sidebar-user-name";
  sidebarName.id = "sidebarUserName";
  sidebarName.textContent = (user && user.fullName) || "Admin";
  const sidebarRole = document.createElement("div");
  sidebarRole.className = "sidebar-user-role";
  sidebarRole.textContent = (user && user.role) || "Administrator";
  sidebarInfo.appendChild(sidebarName);
  sidebarInfo.appendChild(sidebarRole);
  sidebarUser.appendChild(sidebarAvatar);
  sidebarUser.appendChild(sidebarInfo);

  const logoutBtnSidebar = document.createElement("button");
  logoutBtnSidebar.type = "button";
  logoutBtnSidebar.className = "user-menu-item danger";
  logoutBtnSidebar.id = "logoutBtnSidebar";
  logoutBtnSidebar.appendChild(svgIcon("logout"));
  const logoutLabel = document.createElement("span");
  logoutLabel.textContent = "Logout";
  logoutBtnSidebar.appendChild(logoutLabel);
  logoutBtnSidebar.addEventListener("click", handleLogout);
  sidebarUser.appendChild(logoutBtnSidebar);

  sidebarFooter.appendChild(sidebarUser);
  sidebar.appendChild(sidebarFooter);

  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  overlay.id = "sidebarOverlay";

  if (mainContent && mainContent.parentElement) {
    mainContent.parentElement.insertBefore(sidebar, mainContent);
    mainContent.parentElement.insertBefore(overlay, mainContent);
  } else {
    document.body.insertBefore(sidebar, document.body.firstChild);
    document.body.insertBefore(overlay, sidebar.nextSibling);
  }

  // Topbar
  const topbar = document.createElement("header");
  topbar.className = "topbar";

  const topbarLeft = document.createElement("div");
  topbarLeft.className = "topbar-left";
  const mobileMenuBtn = document.createElement("button");
  mobileMenuBtn.type = "button";
  mobileMenuBtn.className = "mobile-menu-btn";
  mobileMenuBtn.id = "mobileMenuBtn";
  mobileMenuBtn.setAttribute("aria-label", "Open menu");
  mobileMenuBtn.setAttribute("aria-expanded", "false");
  mobileMenuBtn.setAttribute("aria-controls", "sidebar");
  mobileMenuBtn.innerHTML = ICONS.burger; // static markup only
  const titleWrapper = document.createElement("div");
  titleWrapper.className = "topbar-title-wrapper";
  const titleEl = document.createElement("h1");
  titleEl.className = "topbar-title";
  titleEl.textContent = pageTitle;
  const dateEl = document.createElement("div");
  dateEl.id = "currentDate";
  titleWrapper.appendChild(titleEl);
  titleWrapper.appendChild(dateEl);
  topbarLeft.appendChild(mobileMenuBtn);
  topbarLeft.appendChild(titleWrapper);

  const topbarRight = document.createElement("div");
  topbarRight.className = "topbar-right";
  const notifBtn = document.createElement("button");
  notifBtn.type = "button";
  notifBtn.className = "topbar-btn";
  notifBtn.id = "notificationsBtn";
  notifBtn.setAttribute("aria-label", "Notifications");
  notifBtn.appendChild(svgIcon("bell"));
  const notifBadge = document.createElement("span");
  notifBadge.className = "topbar-btn-badge notification-badge";
  notifBadge.id = "notificationBadge";
  notifBadge.style.display = "none";
  notifBtn.appendChild(notifBadge);
  topbarRight.appendChild(notifBtn);

  const topbarAvatar = document.createElement("a");
  topbarAvatar.href = "settings.html";
  topbarAvatar.className = "topbar-avatar";
  topbarAvatar.id = "topbarAvatar";
  topbarAvatar.title = "Settings & Profile";
  const topbarInitials = document.createElement("span");
  topbarInitials.id = "topbarUserInitials";
  topbarInitials.textContent = initialsFrom(user && user.fullName);
  topbarAvatar.appendChild(topbarInitials);
  topbarRight.appendChild(topbarAvatar);

  topbar.appendChild(topbarLeft);
  topbar.appendChild(topbarRight);

  if (mainContent) {
    mainContent.insertBefore(topbar, mainContent.firstChild);
  } else {
    document.body.insertBefore(topbar, document.body.firstChild);
  }

  updateCurrentDate(dateEl);

  // Mobile bottom nav
  const mobileNav = document.createElement("nav");
  mobileNav.className = "mobile-nav";
  const mobileNavItems = document.createElement("div");
  mobileNavItems.className = "mobile-nav-items";
  ADMIN_NAV_ITEMS.slice(0, 4).forEach((item) => {
    const a = document.createElement("a");
    a.href = item.href;
    const isActive = item.nav === activePage;
    a.className = "mobile-nav-item" + (isActive ? " active" : "");
    a.setAttribute("data-nav", item.nav);
    if (isActive) a.setAttribute("aria-current", "page");
    a.appendChild(svgIcon(item.icon, "20"));
    const span = document.createElement("span");
    span.textContent = item.label;
    a.appendChild(span);
    mobileNavItems.appendChild(a);
  });
  const switchUserMobile = document.createElement("a");
  switchUserMobile.href = "user_dashboard.html";
  switchUserMobile.className = "mobile-nav-item";
  switchUserMobile.appendChild(svgIcon("switchUser", "20"));
  const switchUserLabel = document.createElement("span");
  switchUserLabel.textContent = "User View";
  switchUserMobile.appendChild(switchUserLabel);
  mobileNavItems.appendChild(switchUserMobile);
  mobileNav.appendChild(mobileNavItems);
  document.body.appendChild(mobileNav);

  // Toast container
  if (!document.getElementById("toastContainer")) {
    const toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    toastContainer.id = "toastContainer";
    document.body.appendChild(toastContainer);
  }

  // Sidebar toggle wiring
  if (mobileMenuBtn && sidebar && overlay) {
    const closeSidebar = () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("open");
      mobileMenuBtn.setAttribute("aria-expanded", "false");
      mobileMenuBtn.focus();
    };
    mobileMenuBtn.addEventListener("click", () => {
      const isOpen = sidebar.classList.toggle("open");
      overlay.classList.toggle("open", isOpen);
      mobileMenuBtn.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) {
        const firstLink = sidebar.querySelector("a[href], button:not([disabled])");
        if (firstLink) firstLink.focus();
      }
    });
    overlay.addEventListener("click", closeSidebar);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sidebar.classList.contains("open")) closeSidebar();
    });
  }
}

/**
 * Refresh the topbar's date text.
 * @param {HTMLElement} dateEl Target element (falls back to lookup by id).
 */
function updateCurrentDate(dateEl) {
  const el = dateEl || document.getElementById("currentDate");
  if (!el) return;
  const now = new Date();
  const options = {weekday: "long", year: "numeric", month: "long", day: "numeric"};
  el.textContent = now.toLocaleDateString("en-US", options);
}

/* ============================================================
   PUBLIC ENTRY POINT
   ============================================================ */

/**
 * Initialize navigation for the current page.
 * @param {Object} options
 * @param {"user"|"admin"} options.variant Which nav surface to render.
 * @param {string} [options.activePage] Nav identifier to mark active
 *     (admin variant).
 * @param {boolean} [options.showGroupDisplay] User variant: show the current
 *     group chip.
 * @param {boolean} [options.showViewToggle] User variant: show the
 *     admin/user toggle.
 * @param {string} [options.logoLink] User variant: logo href.
 * @param {string} [options.pageTitle] Admin variant: topbar title.
 * @return {Promise<Object|null>} The session user (or null if the session
 *     lookup failed but rendering still proceeded with a placeholder).
 */
export async function initNav(options = {}) {
  const {variant = "user"} = options;

  let user = null;
  try {
    user = await getSession();
  } catch (error) {
    user = null;
  }

  if (variant === "admin") {
    renderAdminNav(user, options);
  } else {
    let groups = [];
    if (options.showGroupDisplay) {
      try {
        groups = await listMyGroups();
      } catch (error) {
        groups = [];
      }
    }
    renderUserNav(user, {...options, groups});
  }

  // Bootstrap the pilot SPA router once per page load. Inert on any page
  // that isn't one of the 3 whitelisted pages; does not rebuild the sidebar
  // or topbar on navigation — see updateActiveNav() for the chrome update
  // the router does perform on a content swap.
  initSpaRouter();

  return user;
}

/**
 * Update just the active-link highlight (sidebar + admin mobile bottom nav)
 * and the topbar title, without touching or rebuilding any other nav DOM.
 * Called by spa-router.js after each content swap between the whitelisted
 * pages — never rebuilds the sidebar/topbar (no initNav call per navigation).
 * @param {string} activePage Nav identifier, e.g. "loans" (matches
 *     ADMIN_NAV_ITEMS[].nav / the elements' data-nav attribute).
 * @param {string} [pageTitle] New topbar title text.
 */
export function updateActiveNav(activePage, pageTitle) {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    const isActive = el.getAttribute("data-nav") === activePage;
    el.classList.toggle("active", isActive);
    if (isActive) {
      el.setAttribute("aria-current", "page");
    } else {
      el.removeAttribute("aria-current");
    }
  });

  if (typeof pageTitle === "string") {
    const titleEl = document.querySelector(".topbar-title");
    if (titleEl) titleEl.textContent = pageTitle;
  }
}

// Re-export the session gate directly so callers only need to import this
// module for both nav rendering and the page auth gate, if convenient.
export {getSession};
