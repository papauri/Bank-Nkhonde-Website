/**
 * nav_sql.js — session-based navigation module for the SQL/PHP era.
 *
 * Single entry point that covers both the user-sidebar shell and the admin
 * sidebar/topbar/mobile-nav (both built on the shared renderSidebarNav()),
 * replacing shared-top-nav.js, unified-navigation.js, and admin-layout.js
 * for ported (_sql.js) pages. All 6 user pages use the "user-sidebar"
 * variant; the legacy "user" variant name is kept only as an alias to the
 * same sidebar shell, in case a stray/legacy page still declares it.
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

import {
  getSession,
  logout as apiLogout,
  listMyGroups,
  apiPost,
  apiUrl,
  ApiError,
  redirectToLogin,
} from "./api.js";
import {initSpaRouter} from "./spa-router.js?v=20260722";
import {initializeNotifications, cleanupNotifications} from "./notifications-handler_sql.js";

const LOGIN_URL = "../login.html";

/** Roles that route into the admin dashboard on group switch. */
const ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];

/** Static icon markup — no interpolated data, safe as innerHTML. */
const ICONS = {
  logo: `<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>`,
  grid: `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>`,
  bell: `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`,
  logout: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`,
  burger: `<span></span><span></span><span></span>`,
  close: `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  dashboard: `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  loans: `<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`,
  payments: `<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>`,
  members: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  analytics: `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
  switchUser: `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  messages: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  rules: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="8" y1="9" x2="10" y2="9"/>`,
};

/** Nav items shared by the admin sidebar and admin mobile bottom-nav. */
/**
 * Admin sidebar. A `{section: "..."}` entry renders a heading rather than a
 * link, so related pages read as a group instead of a flat list of fourteen.
 *
 * SEVEN of these were fully built, routed and working but had NO nav entry at
 * all — Rules, Financial Reports, Contributions, Seed Money, Interest &
 * Penalties, Approvals and Broadcast were reachable only by typing the URL.
 * Anything added here must also be registered in PAGE_CONFIG (spa-router.js)
 * and carry the data-nav-* body attributes, or the page loads and does nothing.
 */
const ADMIN_NAV_ITEMS = [
  {nav: "dashboard", label: "Dashboard", href: "admin_dashboard.html", icon: ICONS.dashboard},
  {nav: "analytics", label: "Analytics", href: "analytics.html", icon: ICONS.analytics},
  {nav: "shareout", label: "Share-Out", href: "cycle_shareout.html", icon: ICONS.analytics},

  {section: "Money"},
  {nav: "payments", label: "Payments", href: "manage_payments.html", icon: ICONS.payments},
  {nav: "loans", label: "Manage Loans", href: "manage_loans.html", icon: ICONS.loans},
  {nav: "contributions", label: "Contributions", href: "contributions_overview.html", icon: ICONS.payments},
  {nav: "seed-money", label: "Seed Money", href: "seed_money_overview.html", icon: ICONS.payments},
  {nav: "penalties", label: "Interest & Penalties", href: "interest_penalties.html", icon: ICONS.loans},
  {nav: "reports", label: "Financial Reports", href: "financial_reports.html", icon: ICONS.analytics},

  {section: "Admin"},
  {nav: "members", label: "Members", href: "manage_members.html", icon: ICONS.members},
  {nav: "approvals", label: "Approve Registrations", href: "approve_registrations.html", icon: ICONS.members},
  {nav: "rules", label: "Manage Rules", href: "manage_rules.html", icon: ICONS.rules},
  {nav: "broadcast", label: "Broadcast", href: "broadcast_notifications.html", icon: ICONS.messages},
  {nav: "settings", label: "Settings", href: "settings.html", icon: ICONS.settings},
];

/** Nav items for the user-sidebar variant (dormant until pages opt in). */

/* QUICK ACTIONS for the member side, defined ONCE here so every user page
   carries the identical set. They used to exist only on user_dashboard, which
   donated its own hero buttons into the drawer — so the actions simply did not
   exist anywhere else, and a member on Contacts or Rules had no way back to
   "Upload Payment" without navigating home first.
   Every entry is a NAVIGATION, never a modal trigger: the modals live on the
   dashboard, so an action that needs one deep-links to it (?open=...) and the
   dashboard opens it on arrival. A button that silently does nothing off its
   home page is worse than no button. */
const USER_QUICK_ACTIONS = [
  {label: "Request Loan", href: "user_dashboard.html?open=loan-request"},
  {label: "Upload Payment", href: "user_dashboard.html?open=upload-payment"},
  {label: "My Loans", href: "loan_payments.html"},
  {label: "Analytics", href: "user_analytics.html"},
  {label: "Members", href: "contacts.html"},
  {label: "Rules", href: "view_rules.html"},
];

const USER_SIDEBAR_NAV_ITEMS = [
  {nav: "user_dashboard", label: "Dashboard", href: "user_dashboard.html", icon: ICONS.dashboard},
  {nav: "user_analytics", label: "Analytics", href: "user_analytics.html", icon: ICONS.analytics},
  {nav: "loan_payments", label: "Loan Payments", href: "loan_payments.html", icon: ICONS.payments},
  {nav: "contacts", label: "Contacts", href: "contacts.html", icon: ICONS.members},
  {nav: "messages", label: "Messages", href: "messages.html", icon: ICONS.messages},
  {nav: "view_rules", label: "Rules", href: "view_rules.html", icon: ICONS.rules},
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
  // Support both key lookup (e.g. "dashboard") and direct path strings
  // (e.g. when nav items store ICONS.dashboard directly).
  svg.innerHTML = ICONS[key] || key || "";
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

/** Matches the server's upload cap (see settings_sql.js MAX_IMAGE_BYTES). */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Upload a new profile photo via files.upload, then persist it via
 * profile.update — the same two-step sequence the settings page's picker
 * uses (settings_sql.js uploadFile/uploadProfileImage), duplicated here
 * because this module must not import from a page-specific script.
 * @param {File} file Image file to upload.
 * @return {Promise<string>} The saved image URL.
 */
async function uploadAndSaveNavAvatar(file) {
  const groupId = sessionStorage.getItem("selectedGroupId") ||
    localStorage.getItem("selectedGroupId") || "";

  const form = new FormData();
  form.append("file", file);
  // files.upload requires a groupId (it gates on group membership).
  form.append("groupId", groupId);

  let response;
  try {
    response = await fetch(apiUrl("files.upload"), {
      method: "POST",
      credentials: "same-origin",
      body: form, // no Content-Type — the browser sets the multipart boundary
    });
  } catch (networkError) {
    throw new ApiError("Unable to reach the server. Check your connection.", 0, null);
  }

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch (parseError) {
    throw new ApiError("Unexpected server response", response.status, null);
  }

  if (!response.ok) {
    throw new ApiError(
      (body && (body.message || body.error)) || "Upload failed.",
      response.status,
      body,
    );
  }
  if (!body || !body.url) {
    throw new ApiError("Upload did not return a file URL.", response.status, body);
  }

  await apiPost("profile.update", {profileImageUrl: body.url});
  return body.url;
}

/* ============================================================
   ADMIN VARIANT — sidebar + topbar + mobile bottom nav
   ============================================================ */

/**
 * Build and inject a sidebar-shell nav (sidebar + topbar + mobile bottom-nav).
 * Shared by the admin variant and the user-sidebar variant; the caller
 * supplies which nav items, logo href, and footer "switch view" link to use.
 * @param {Object} user Session user ({fullName, role, ...}).
 * @param {Object} opts {activePage, pageTitle}
 * @param {Object} config {navItems, logoHref, footerSwitch}
 * @param {Array<Object>} config.navItems Nav item list ({nav, label, href, icon}).
 * @param {string} config.logoHref Sidebar logo link target.
 * @param {?{href: string, label: string, mobileLabel: (string|undefined)}}
 *     config.footerSwitch Optional "switch view" link rendered in the
 *     sidebar footer + mobile nav (mobileLabel overrides the shorter mobile
 *     bottom-nav text; defaults to label); pass null to omit it entirely.
 */
function renderSidebarNav(user, opts, config) {
  const {activePage = "dashboard", pageTitle = "Dashboard"} = opts;
  const {navItems, logoHref, footerSwitch} = config;

  const mainContent = document.getElementById("mainContent") || document.querySelector(".main-content");

  // Sidebar
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.id = "sidebar";

  const sidebarHeader = document.createElement("div");
  sidebarHeader.className = "sidebar-header";
  const sidebarLogo = document.createElement("a");
  sidebarLogo.href = logoHref;
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

  /* Close affordance INSIDE the drawer. The burger that opens the drawer sits
     on the topbar (z-index --z-sticky); the open drawer (--z-fixed + 20) and
     its overlay (+10) both paint over that spot, so re-tapping the burger
     hits the drawer, not the button — the drawer could only be dismissed by
     Escape or by finding the dimmed strip beside it. Raising the burger above
     the drawer instead would float it over this very header. A close control
     in the drawer is the conventional fix and needs no z-order fight. */
  const sidebarCloseBtn = document.createElement("button");
  sidebarCloseBtn.type = "button";
  sidebarCloseBtn.className = "sidebar-close";
  sidebarCloseBtn.id = "sidebarCloseBtn";
  sidebarCloseBtn.setAttribute("aria-label", "Close menu");
  sidebarCloseBtn.appendChild(svgIcon("close", "20"));
  sidebarHeader.appendChild(sidebarCloseBtn);

  sidebar.appendChild(sidebarHeader);

  const sidebarNav = document.createElement("nav");
  sidebarNav.className = "sidebar-nav";
  navItems.forEach((item) => {
    // A section marker is a heading, not a destination.
    if (item.section) {
      const heading = document.createElement("div");
      heading.className = "sidebar-nav-section";
      heading.textContent = item.section;
      sidebarNav.appendChild(heading);
      return;
    }
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

  /* Quick actions in the drawer. On the MEMBER side these are now built here
     from USER_QUICK_ACTIONS, so every user page shows the same six. The slot
     also remains a landing area a page can append to (the admin side and any
     page-owned controls still work exactly as before); it collapses to nothing
     when empty. */
  const sidebarQuickActions = document.createElement("div");
  sidebarQuickActions.className = "sidebar-quick-actions";
  sidebarQuickActions.id = "sidebarQuickActions";

  if (navItems === USER_SIDEBAR_NAV_ITEMS) {
    const qaLabel = document.createElement("div");
    qaLabel.className = "sidebar-quick-actions-label";
    qaLabel.textContent = "Quick Actions";
    sidebarQuickActions.appendChild(qaLabel);

    const qaGrid = document.createElement("div");
    qaGrid.className = "sidebar-quick-actions-grid";
    for (const qa of USER_QUICK_ACTIONS) {
      const a = document.createElement("a");
      a.className = "sidebar-quick-action";
      a.href = qa.href;
      a.textContent = qa.label;
      qaGrid.appendChild(a);
    }
    sidebarQuickActions.appendChild(qaGrid);
  }

  sidebarNav.appendChild(sidebarQuickActions);

  sidebar.appendChild(sidebarNav);

  const sidebarFooter = document.createElement("div");
  sidebarFooter.className = "sidebar-footer";
  if (footerSwitch) {
    const switchUserLink = document.createElement("a");
    switchUserLink.href = footerSwitch.href;
    switchUserLink.className = "sidebar-nav-item";
    switchUserLink.title = footerSwitch.label;
    switchUserLink.appendChild(svgIcon("switchUser"));
    const switchLabel = document.createElement("span");
    switchLabel.textContent = footerSwitch.label;
    switchUserLink.appendChild(switchLabel);
    sidebarFooter.appendChild(switchUserLink);
  }

  const sidebarUser = document.createElement("div");
  sidebarUser.className = "sidebar-user";
  sidebarUser.id = "sidebarUser";
  // Click-to-change profile picture, mirroring the settings page's picker:
  // a <label> wraps a hidden file input so a click opens the OS file picker.
  // Uses its own input id (navProfilePictureInput) — the settings page's own
  // #profilePictureInput must keep working when this nav renders on that
  // same page.
  const sidebarAvatar = document.createElement("label");
  sidebarAvatar.className = "sidebar-user-avatar";
  sidebarAvatar.setAttribute("for", "navProfilePictureInput");
  sidebarAvatar.setAttribute("aria-label", "Change profile picture");
  sidebarAvatar.title = "Change profile picture";
  sidebarAvatar.tabIndex = 0;
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

  const sidebarAvatarInput = document.createElement("input");
  sidebarAvatarInput.type = "file";
  sidebarAvatarInput.accept = "image/*";
  sidebarAvatarInput.id = "navProfilePictureInput";
  sidebarAvatarInput.className = "sidebar-user-avatar-input";
  sidebarAvatar.appendChild(sidebarAvatarInput);

  // Labels aren't in the default tab order in most browsers even with a
  // `for` attribute, so tabIndex above plus this handler is what makes the
  // control keyboard-operable (Enter/Space opens the picker, same as a click).
  sidebarAvatar.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      sidebarAvatarInput.click();
    }
  });

  sidebarAvatarInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("Choose an image file (JPG, PNG or WebP).", "danger");
      sidebarAvatarInput.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      showToast("That image is too large. Maximum size is 5 MB.", "danger");
      sidebarAvatarInput.value = "";
      return;
    }

    try {
      const uploadedUrl = await uploadAndSaveNavAvatar(file);
      sidebarAvatar.querySelectorAll("img").forEach((node) => node.remove());
      if (sidebarInitials.isConnected) sidebarInitials.remove();
      const newImg = document.createElement("img");
      newImg.src = uploadedUrl;
      newImg.alt = (user && user.fullName) || "";
      sidebarAvatar.insertBefore(newImg, sidebarAvatarInput);
      showToast("Profile photo updated", "success");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      showToast((error && error.message) || "Failed to upload your photo.", "danger");
    } finally {
      sidebarAvatarInput.value = "";
    }
  });

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
  if (footerSwitch) {
    const topbarSwitch = document.createElement("a");
    topbarSwitch.href = footerSwitch.href;
    topbarSwitch.className = "topbar-switch";
    topbarSwitch.title = footerSwitch.label;
    topbarSwitch.setAttribute("aria-label", footerSwitch.label);
    topbarSwitch.appendChild(svgIcon("switchUser"));
    const topbarSwitchLabel = document.createElement("span");
    topbarSwitchLabel.className = "topbar-switch-label";
    topbarSwitchLabel.textContent = "User View";
    topbarSwitch.appendChild(topbarSwitchLabel);
    topbarRight.appendChild(topbarSwitch);
  }
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
  // Section markers are sidebar-only headings — filter them out before taking
  // the first four, or the bottom bar renders a heading as a dead tab.
  navItems.filter((item) => !item.section).slice(0, 4).forEach((item) => {
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
  if (footerSwitch) {
    const switchUserMobile = document.createElement("a");
    switchUserMobile.href = footerSwitch.href;
    switchUserMobile.className = "mobile-nav-item";
    switchUserMobile.appendChild(svgIcon("switchUser", "20"));
    const switchUserLabel = document.createElement("span");
    switchUserLabel.textContent = footerSwitch.mobileLabel || footerSwitch.label;
    switchUserMobile.appendChild(switchUserLabel);
    mobileNavItems.appendChild(switchUserMobile);
  }
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
    /* Page-behind scroll lock. The drawer already has overscroll-behavior,
       which stops a flick inside it chaining to the page, but the page was
       still free to scroll under the open drawer via the dimmed strip. */
    const setScrollLock = (locked) => {
      document.body.classList.toggle("bn-drawer-open", locked);
    };
    const closeSidebar = () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("open");
      setScrollLock(false);
      mobileMenuBtn.setAttribute("aria-expanded", "false");
      mobileMenuBtn.focus();
    };
    mobileMenuBtn.addEventListener("click", () => {
      const isOpen = sidebar.classList.toggle("open");
      overlay.classList.toggle("open", isOpen);
      setScrollLock(isOpen);
      mobileMenuBtn.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) {
        // Focus the close control first: it is the way back out, and on a
        // phone it is the only always-visible one.
        if (sidebarCloseBtn) {
          sidebarCloseBtn.focus();
        } else {
          const firstLink = sidebar.querySelector("a[href], button:not([disabled])");
          if (firstLink) firstLink.focus();
        }
      }
    });
    if (sidebarCloseBtn) sidebarCloseBtn.addEventListener("click", closeSidebar);
    overlay.addEventListener("click", closeSidebar);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sidebar.classList.contains("open")) closeSidebar();
    });
  }
}

/**
 * Build and inject the admin sidebar, topbar, and mobile bottom-nav.
 * Thin wrapper over renderSidebarNav with the admin-specific config.
 * @param {Object} user Session user ({fullName, role, ...}).
 * @param {Object} opts {activePage, pageTitle}
 */
function renderAdminNav(user, opts) {
  renderSidebarNav(user, opts, {
    navItems: ADMIN_NAV_ITEMS,
    logoHref: "admin_dashboard.html",
    footerSwitch: {href: "user_dashboard.html", label: "Switch to User View", mobileLabel: "User View"},
  });
}

/**
 * Build and inject the user-sidebar shell (sidebar + topbar + mobile
 * bottom-nav) using USER_SIDEBAR_NAV_ITEMS. Shows an "Admin View" footer
 * switch link only when the caller is an admin in AT LEAST ONE of their
 * groups — the server is the real gate on any admin page reached from it.
 *
 * Role is PER-GROUP (members.role) and is NOT carried on the session `user`
 * object, so we render the shell immediately without the switch, then
 * asynchronously look up the caller's group roles and inject the link if
 * they administer any group. This keeps the nav rendering instant instead of
 * blocking it on a second network call.
 * @param {Object} user Session user ({fullName, ...}).
 * @param {Object} opts {activePage, pageTitle}
 */
function renderUserSidebarNav(user, opts) {
  renderSidebarNav(user, opts, {
    navItems: USER_SIDEBAR_NAV_ITEMS,
    logoHref: "user_dashboard.html",
    footerSwitch: null,
  });

  listMyGroups()
    .then((groups) => {
      const isAdminSomewhere = Array.isArray(groups) &&
        groups.some((g) => g && ADMIN_ROLES.includes(g.myRole));
      if (isAdminSomewhere) injectAdminViewSwitch();
    })
    .catch(() => {
      // A failed group lookup just means the switch link is omitted this
      // load — the admin portal is still reachable directly by URL and every
      // admin page re-checks the role server-side. Not fatal to the nav.
    });
}

/**
 * Insert the "Admin View" switch link into the already-rendered user-sidebar
 * footer and mobile bottom-nav. Idempotent — a second call (e.g. an SPA
 * re-render) is a no-op. Used only on the user shell, once the caller is
 * confirmed to administer at least one group.
 */
function injectAdminViewSwitch() {
  const href = "admin_dashboard.html";

  const sidebarFooter = document.querySelector(".sidebar-footer");
  if (
    sidebarFooter &&
    !sidebarFooter.querySelector('[data-nav="admin-switch"]')
  ) {
    const link = document.createElement("a");
    link.href = href;
    link.className = "sidebar-nav-item";
    link.setAttribute("data-nav", "admin-switch");
    link.title = "Admin View";
    link.appendChild(svgIcon("switchUser"));
    const span = document.createElement("span");
    span.textContent = "Admin View";
    link.appendChild(span);
    // Match renderSidebarNav's footerSwitch position: above the user block.
    sidebarFooter.insertBefore(
      link,
      sidebarFooter.querySelector(".sidebar-user")
    );
  }

  const mobileItems = document.querySelector(".mobile-nav .mobile-nav-items");
  if (
    mobileItems &&
    !mobileItems.querySelector('[data-nav="admin-switch"]')
  ) {
    const link = document.createElement("a");
    link.href = href;
    link.className = "mobile-nav-item";
    link.setAttribute("data-nav", "admin-switch");
    link.appendChild(svgIcon("switchUser", "20"));
    const span = document.createElement("span");
    span.textContent = "Admin";
    link.appendChild(span);
    mobileItems.appendChild(link);
  }

  const topbarRight = document.querySelector(".topbar-right");
  if (
    topbarRight &&
    !topbarRight.querySelector('[data-nav="admin-switch-top"]')
  ) {
    const topbarLink = document.createElement("a");
    topbarLink.href = href;
    topbarLink.className = "topbar-switch";
    topbarLink.setAttribute("data-nav", "admin-switch-top");
    topbarLink.title = "Admin View";
    topbarLink.setAttribute("aria-label", "Admin View");
    topbarLink.appendChild(svgIcon("switchUser"));
    const topbarSpan = document.createElement("span");
    topbarSpan.className = "topbar-switch-label";
    topbarSpan.textContent = "Admin View";
    topbarLink.appendChild(topbarSpan);
    topbarRight.insertBefore(topbarLink, topbarRight.firstChild);
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
 * @param {"user"|"admin"|"user-sidebar"} options.variant Which nav surface to
 *     render ("admin" renders the admin sidebar; "user-sidebar" and the
 *     legacy "user" alias both render the user-sidebar shell).
 * @param {string} [options.activePage] Nav identifier to mark active.
 * @param {string} [options.pageTitle] Topbar title.
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
    // "user-sidebar" is the only live user variant; "user" is kept as an
    // alias to the same sidebar shell for any stray/legacy page.
    renderUserSidebarNav(user, options);
  }

  // Bootstrap the pilot SPA router once per page load. Inert on any page
  // that isn't one of the 3 whitelisted pages; does not rebuild the sidebar
  // or topbar on navigation — see updateActiveNav() for the chrome update
  // the router does perform on a content swap.
  initSpaRouter();

  // Wire up the notification bell + badge polling. The bell is rendered by
  // renderSidebarNav() above; initializeNotifications() attaches the click
  // handler, dropdown, and starts the 60s polling loop. Safe to call even
  // if the bell isn't present (it returns early).
  const notifBtn = document.getElementById("notificationsBtn");
  if (notifBtn) {
    // The groupId is resolved from the session-selected group; if none is
    // selected yet the handler will skip polling until one is picked.
    const groupId = sessionStorage.getItem("selectedGroupId") || "";
    initializeNotifications(user && user.userId, groupId);
  }

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
