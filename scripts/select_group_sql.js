/**
 * select_group_sql.js — SQL/API port of select_group.js (post-login landing).
 *
 * THE PAGE-GATE PATTERN every future page port copies:
 *   1. import ONLY from ./api.js — no firebaseConfig, no onAuthStateChanged.
 *   2. await requireSession() first; it redirects to login on 401 and never
 *      resolves, so nothing below runs against a dead session.
 *   3. apiGet/apiPost for data, catching ApiError and branching on err.status.
 *   4. Logout calls logout() from api.js, not Firebase signOut.
 *
 * NO identity is stored in localStorage/sessionStorage — the HttpOnly session
 * cookie is the only identity. selectedGroupId is navigation state (which group
 * the user opened), not identity, and is kept so downstream pages know the target.
 *
 * SECURITY: every string below (fullName, email, groupName) is server data.
 * Cards and text are built with createElement + textContent — never innerHTML
 * carrying a server string.
 */

import { requireSession, apiGet, logout, ApiError } from "./api.js";

// DOM elements — the contract preserved from the Firebase original, verbatim.
const spinner = document.getElementById("spinner");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const userAvatar = document.getElementById("userAvatar");
const groupsGrid = document.getElementById("groupsGrid");
const emptyState = document.getElementById("emptyState");
const pendingPaymentsBadge = document.getElementById("pendingPaymentsBadge");
const loanRequestsBadge = document.getElementById("loanRequestsBadge");
const broadcastsBadge = document.getElementById("broadcastsBadge");
const logoutBtn = document.getElementById("logoutBtn");

// Admin-equivalent roles decide the target dashboard and which badges are shown.
const ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];

document.addEventListener("DOMContentLoaded", () => {
  logoutBtn?.addEventListener("click", handleLogout);
  init();
});

/**
 * Entry point. Gates on the session, then loads identity, groups and badges.
 */
async function init() {
  showSpinner(true);
  // Replaces onAuthStateChanged. Redirects to login and never resolves on 401.
  const user = await requireSession();

  renderIdentity(user);

  let groups = [];
  try {
    const data = await apiGet("groups.mine");
    groups = Array.isArray(data && data.groups) ? data.groups : [];
  } catch (error) {
    handleSessionError(error);
    renderGroupsError();
    showSpinner(false);
    return;
  }

  renderGroups(groups);
  await loadBadgeCounts(groups);
  showSpinner(false);
}

/**
 * Populate the header identity from the session user.
 * @param {Object} user {uid, email, fullName, ...}
 */
function renderIdentity(user) {
  const email = typeof user.email === "string" ? user.email : "";
  const displayName =
    (typeof user.fullName === "string" && user.fullName.trim()) ||
    (email ? email.split("@")[0] : "Member");

  if (userName) userName.textContent = displayName;
  if (userEmail) userEmail.textContent = email;
  if (userAvatar) {
    userAvatar.textContent = displayName.charAt(0).toUpperCase();
  }
}

/**
 * Build the group cards, or the empty-state prompt when the user has none.
 * @param {Array<Object>} groups Each {groupId, groupName, myRole, ...}
 */
function renderGroups(groups) {
  if (!groupsGrid) return;
  groupsGrid.replaceChildren();

  if (!groups.length) {
    groupsGrid.appendChild(buildEmptyState());
    return;
  }

  for (const group of groups) {
    groupsGrid.appendChild(buildGroupCard(group));
  }
}

/**
 * One group card, built entirely from nodes — no innerHTML with a group name.
 * @param {Object} group {groupId, groupName, myRole}
 * @return {HTMLElement}
 */
function buildGroupCard(group) {
  const role = typeof group.myRole === "string" ? group.myRole : "member";
  const isAdmin = ADMIN_ROLES.includes(role);

  const card = document.createElement("div");
  card.className = "group-card";
  card.addEventListener("click", () =>
    selectGroup(group.groupId, isAdmin ? "admin" : "user"),
  );

  const header = document.createElement("div");
  header.className = "group-header";

  const name = document.createElement("h3");
  name.className = "group-name";
  name.textContent = group.groupName || "Unnamed Group";

  const roleTag = document.createElement("span");
  roleTag.className = `group-role ${role}`;
  roleTag.textContent = isAdmin ? "Admin" : "Member";

  header.appendChild(name);
  header.appendChild(roleTag);
  card.appendChild(header);

  return card;
}

/**
 * The "no groups yet" prompt, built as nodes to match the original markup.
 * @return {HTMLElement}
 */
function buildEmptyState() {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  wrap.style.gridColumn = "1 / -1";

  const icon = document.createElement("div");
  icon.className = "empty-state-icon";
  icon.textContent = "\u{1F4C1}";

  const text = document.createElement("p");
  text.className = "empty-state-text";
  text.textContent = "You haven't joined any groups yet.";

  const link = document.createElement("a");
  link.href = "admin_registration.html";
  link.className = "btn btn-accent";
  link.textContent = "Create Your First Group";

  wrap.appendChild(icon);
  wrap.appendChild(text);
  wrap.appendChild(link);
  return wrap;
}

/**
 * Render the load-error state into the grid without any interpolated string.
 */
function renderGroupsError() {
  if (!groupsGrid) return;
  groupsGrid.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  wrap.style.gridColumn = "1 / -1";

  const icon = document.createElement("div");
  icon.className = "empty-state-icon";
  icon.textContent = "❌";

  const text = document.createElement("p");
  text.className = "empty-state-text";
  text.textContent = "Error loading groups. Please try again.";

  wrap.appendChild(icon);
  wrap.appendChild(text);
  groupsGrid.appendChild(wrap);
}

/**
 * Fetch each group's badge counts (one call per group, in PARALLEL — never a
 * serial per-member loop), then aggregate into the three header badges exactly
 * as the Firebase original did.
 * @param {Array<Object>} groups The caller's groups.
 */
async function loadBadgeCounts(groups) {
  if (!groups.length) {
    setBadge(pendingPaymentsBadge, 0);
    setBadge(loanRequestsBadge, 0);
    setBadge(broadcastsBadge, 0);
    return;
  }

  const results = await Promise.all(
    groups.map(async (group) => {
      try {
        return await apiGet("dashboard.badges", { groupId: group.groupId });
      } catch (error) {
        // A single group's badge failure must not blank the whole header.
        handleSessionError(error);
        return null;
      }
    }),
  );

  let pendingPayments = 0;
  let loanRequests = 0;
  let broadcasts = 0;
  for (const r of results) {
    if (!r) continue;
    pendingPayments += Number(r.pendingPayments) || 0;
    loanRequests += Number(r.loanRequests) || 0;
    broadcasts += Number(r.broadcasts) || 0;
  }

  setBadge(pendingPaymentsBadge, pendingPayments);
  setBadge(loanRequestsBadge, loanRequests);
  setBadge(broadcastsBadge, broadcasts);
}

/**
 * Set a badge count and show/hide it, matching the original display toggle.
 * @param {?HTMLElement} el Badge element.
 * @param {number} count Value to display.
 */
function setBadge(el, count) {
  if (!el) return;
  el.textContent = String(count);
  el.style.display = count > 0 ? "flex" : "none";
}

/**
 * A 401 anywhere means the session died mid-page — bounce back to login.
 * @param {*} error The caught error.
 */
function handleSessionError(error) {
  if (error instanceof ApiError && error.status === 401) {
    window.location.replace("/login.html");
    throw new Promise(() => {});
  }
}

/**
 * Sign out via the API (server destroys the session cookie), then to login.
 */
async function handleLogout() {
  try {
    await logout();
  } catch (error) {
    // Even a failed logout call should not trap the user on this page.
    console.error("Error signing out:", error);
  }
  window.location.href = "../login.html";
}

/**
 * Open a group. selectedGroupId is navigation state (not identity), kept so the
 * next page knows the target group. Role is UX only; the server re-checks it.
 * @param {string} groupId The group to open.
 * @param {string} role "admin" or "user".
 */
function selectGroup(groupId, role) {
  localStorage.setItem("selectedGroupId", groupId);
  localStorage.setItem("userRole", role);
  sessionStorage.setItem("selectedGroupId", groupId);
  sessionStorage.setItem("userRole", role);

  window.location.href =
    role === "admin" ? "admin_dashboard.html" : "user_dashboard.html";
}

/**
 * Toggle the full-page spinner.
 * @param {boolean} show Whether to show it.
 */
function showSpinner(show) {
  if (show) {
    spinner?.classList.remove("hidden");
  } else {
    spinner?.classList.add("hidden");
  }
}
