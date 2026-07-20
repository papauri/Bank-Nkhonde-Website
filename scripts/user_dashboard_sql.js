/**
 * user_dashboard_sql.js — SQL/API port of the LIVE member dashboard
 * (scripts/user_dashboard.js). This is the member's financial home page: what
 * they owe (seed money, monthly contributions, service fee, arrears + live
 * penalties) and what they have borrowed.
 *
 * PATTERN (copied from scripts/select_group_sql.js):
 *   1. import ONLY from ./api.js — no firebaseConfig, no onAuthStateChanged.
 *   2. await requireSession() first; it redirects to login on 401 and never
 *      resolves, so nothing below runs against a dead session.
 *   3. apiGet for data, catching ApiError and branching on err.status.
 *   4. Logout calls logout() from api.js, not Firebase signOut.
 *
 * MONEY: the API returns money as canonical 2dp strings (integer minor units on
 * the server). This file NEVER does float arithmetic on money — sums are done in
 * integer minor units (toMinor / fromMinor) and every amount reaches the DOM via
 * textContent. The server is the source of truth; nothing here re-rounds it.
 *
 * SECURITY: every server string (group names, notification titles/messages,
 * money) is placed with createElement + textContent. There is no innerHTML
 * carrying server data anywhere in this file.
 *
 * SCOPE: this is a READ/DISPLAY port. The write flows in the Firebase original
 * (loan-booking form, proof-of-payment upload) require POST endpoints / file
 * storage that are out of this brief's scope, so those buttons surface a toast
 * rather than silently doing nothing. See the report for the named gaps.
 */

import { requireSession, apiGet, logout, ApiError, redirectToLogin, listMyGroups } from "./api.js";

// Admin-equivalent roles: decide the admin toggle and the admin-switch button.
const ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];

// Payment-type labels, matching the Firebase original's display strings.
const PAYMENT_TYPE_LABELS = {
  seed_money: "Seed Money",
  monthly_contribution: "Monthly Contribution",
  service_fee: "Service Fee",
};

// One idle hour, matching the original session timeout.
const SESSION_IDLE_MS = 60 * 60 * 1000;

// Module state.
let currentUser = null;
let userGroups = [];
let currentGroup = null;
let isAdmin = false;
let sessionTimer = null;

export async function init() {
  wireStaticHandlers();
  loadUserDashboardEntry();
}
if (!window.__bnSpa) {
  document.addEventListener("DOMContentLoaded", () => { init(); });
}

/**
 * Re-resolve a group to land on when no valid selectedGroupId is available,
 * mirroring login_sql.js's last-used-else-first logic. Writes the resolution
 * to both storages. Returns true if the caller should continue rendering the
 * CURRENT page in place (a member-role group was resolved), false if it has
 * already navigated away (zero groups, or an admin-role group).
 */
async function resolveGroupOrRedirect() {
  let groups = [];
  try {
    groups = await listMyGroups();
  } catch (error) {
    groups = [];
  }

  if (!groups.length) {
    window.location.href = "admin_registration.html";
    return false;
  }

  const lastGroupId =
    localStorage.getItem("selectedGroupId") ||
    sessionStorage.getItem("selectedGroupId");
  const target = groups.find((g) => g.groupId === lastGroupId) || groups[0];
  const role = ADMIN_ROLES.includes(target.myRole) ? "admin" : "user";

  localStorage.setItem("selectedGroupId", target.groupId);
  localStorage.setItem("userRole", role);
  sessionStorage.setItem("selectedGroupId", target.groupId);
  sessionStorage.setItem("userRole", role);

  if (role === "admin") {
    window.location.href = "admin_dashboard.html";
    return false;
  }

  return true;
}

/**
 * Entry point. Gates on the session, resolves the selected group, then loads it.
 * Renamed from `init` to `loadUserDashboardEntry` so the module can export a
 * top-level `init()` for the SPA router without a duplicate declaration.
 */
async function loadUserDashboardEntry() {
  showSpinner(true);
  currentUser = await requireSession();
  renderIdentity(currentUser);
  resetSessionTimer();

  let groupId = getSelectedGroupId();
  if (!groupId) {
    // No group chosen — resolve one the same way login does instead of
    // bouncing through the retired select_group.html.
    const shouldContinue = await resolveGroupOrRedirect();
    if (!shouldContinue) {
      showSpinner(false);
      return;
    }
    groupId = getSelectedGroupId();
  }

  try {
    const data = await apiGet("groups.mine");
    userGroups = Array.isArray(data && data.groups) ? data.groups : [];
  } catch (error) {
    handleSessionError(error);
    userGroups = [];
  }

  currentGroup = userGroups.find((g) => g.groupId === groupId) || null;

  if (!currentGroup) {
    // The stored group is not one this member belongs to (any more). Re-pick.
    const shouldContinue = await resolveGroupOrRedirect();
    if (!shouldContinue) {
      showSpinner(false);
      return;
    }
    groupId = getSelectedGroupId();
    currentGroup = userGroups.find((g) => g.groupId === groupId) || null;
    if (!currentGroup) {
      // Resolved group still isn't in the cached list (e.g. permissions
      // changed mid-session) — reload so the dashboard re-fetches cleanly.
      window.location.reload();
      return;
    }
  }

  renderGroupsList();
  updateCurrentGroupDisplay();
  applyRole();

  try {
    await loadDashboard(groupId);
  } finally {
    showSpinner(false);
  }
}

/**
 * Toggle the full-page loading overlay, mirroring admin_dashboard_sql.js.
 * @param {boolean} show
 */
function showSpinner(show) {
  const spinner = document.getElementById("spinner");
  if (!spinner) return;
  if (show) spinner.classList.remove("hidden");
  else spinner.classList.add("hidden");
}

/* ------------------------------------------------------------------ *
 * Identity + role
 * ------------------------------------------------------------------ */

/**
 * Header identity from the session user.
 * @param {Object} user {uid, email, fullName}
 */
function renderIdentity(user) {
  const email = typeof user.email === "string" ? user.email : "";
  const displayName =
    (typeof user.fullName === "string" && user.fullName.trim()) ||
    (email ? email.split("@")[0] : "Member");

  setText("userName", displayName);
  setText("userInitials", getInitials(displayName));

  const avatar = document.getElementById("userAvatar");
  if (avatar && !avatar.querySelector("img")) avatar.textContent =
    getInitials(displayName);
}

/**
 * First-two-letters initials from a display name.
 * @param {string} name
 * @return {string}
 */
function getInitials(name) {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

/**
 * Show admin-only affordances when the caller is admin-equivalent in this group.
 * Client role is UX ONLY — the server re-checks every call.
 */
function applyRole() {
  const role =
    currentGroup && typeof currentGroup.myRole === "string"
      ? currentGroup.myRole
      : "member";
  isAdmin = ADMIN_ROLES.includes(role);

  const viewToggle = document.getElementById("viewToggle");
  if (viewToggle) viewToggle.classList.toggle("hidden", !isAdmin);

  const mobileSwitchToAdmin = document.getElementById("mobileSwitchToAdmin");
  const mobileNav = document.querySelector(".mobile-nav");
  if (mobileSwitchToAdmin) mobileSwitchToAdmin.classList.toggle("hidden", !isAdmin);
  if (mobileNav) mobileNav.classList.toggle("has-admin", isAdmin);
}

/* ------------------------------------------------------------------ *
 * Group list + current-group display
 * ------------------------------------------------------------------ */

/**
 * Render the member's groups in the sidebar list.
 */
function renderGroupsList() {
  const list = document.getElementById("groupSelectionList");
  if (!list) return;
  list.replaceChildren();

  if (!userGroups.length) {
    list.appendChild(
      buildEmptyState(
        "\u{1F4C1}",
        "You're not a member of any groups yet. Contact your group admin to be added.",
      ),
    );
    return;
  }

  for (const group of userGroups) {
    list.appendChild(buildGroupCard(group));
  }
}

/**
 * One sidebar group card.
 * @param {Object} group
 * @return {HTMLElement}
 */
function buildGroupCard(group) {
  const selected = currentGroup && currentGroup.groupId === group.groupId;
  const role = typeof group.myRole === "string" ? group.myRole : "member";

  const card = document.createElement("div");
  card.className = "group-card" + (selected ? " selected" : "");
  if (!selected) {
    card.addEventListener("click", () => selectUserGroup(group.groupId));
  }

  const header = document.createElement("div");
  header.className = "group-card-header";

  const name = document.createElement("h4");
  name.className = "group-name";
  name.textContent = group.groupName || "Unnamed Group";

  const badge = document.createElement("span");
  badge.className =
    "badge badge-" + (ADMIN_ROLES.includes(role) ? "accent" : "secondary");
  badge.textContent = role;

  header.appendChild(name);
  header.appendChild(badge);
  card.appendChild(header);

  const stats = document.createElement("div");
  stats.className = "group-card-stats";
  const stat = document.createElement("div");
  stat.className = "group-stat";
  const statValue = document.createElement("span");
  statValue.className = "group-stat-value";
  statValue.textContent = String(
    (group.statistics && group.statistics.totalMembers) || 0,
  );
  const statLabel = document.createElement("span");
  statLabel.className = "group-stat-label";
  statLabel.textContent = "Members";
  stat.appendChild(statValue);
  stat.appendChild(statLabel);
  stats.appendChild(stat);
  card.appendChild(stats);

  if (selected) {
    const active = document.createElement("div");
    active.className = "group-card-active-badge";
    active.textContent = "Active";
    card.appendChild(active);
  }

  return card;
}

/**
 * Update the current-group chip in the top nav.
 */
function updateCurrentGroupDisplay() {
  const display = document.getElementById("currentGroupDisplay");
  const name = document.getElementById("currentGroupName");
  const icon = document.getElementById("currentGroupIcon");
  if (!display || !name) return;

  if (currentGroup && currentGroup.groupName) {
    display.style.display = "flex";
    name.textContent = currentGroup.groupName;
    if (icon) icon.textContent = currentGroup.groupName.charAt(0).toUpperCase();
  } else {
    display.style.display = "none";
  }
}

/**
 * Switch the selected group and reload. selectedGroupId is navigation state
 * (not identity) — the session cookie is the only identity.
 * @param {string} groupId
 */
async function selectUserGroup(groupId) {
  if (getSelectedGroupId() === groupId) return;
  saveSelectedGroupId(groupId);
  currentGroup = userGroups.find((g) => g.groupId === groupId) || null;
  if (!currentGroup) return;

  renderGroupsList();
  updateCurrentGroupDisplay();
  applyRole();
  showSpinner(true);
  try {
    await loadDashboard(groupId);
  } finally {
    showSpinner(false);
  }
}
window.selectUserGroup = selectUserGroup;

/**
 * Jump to the admin dashboard for the selected group.
 */
window.handleSwitchToAdmin = function handleSwitchToAdmin() {
  const groupId = getSelectedGroupId();
  window.location.href = groupId
    ? `admin_dashboard.html?groupId=${encodeURIComponent(groupId)}`
    : "admin_dashboard.html";
};

/* ------------------------------------------------------------------ *
 * Dashboard load — obligations, payments, loans, notifications
 * ------------------------------------------------------------------ */

/**
 * Load and render every data section for one group.
 * @param {string} groupId
 */
async function loadDashboard(groupId) {
  // Reset per-load so switching groups can surface a fresh warning too.
  fetchFailureWarned = false;

  const [obligations, payments, loans] = await Promise.all([
    safeGet("payments.obligations", { groupId }),
    safeGet("payments.list", { groupId }),
    safeGet("loans.list", { groupId }),
  ]);

  const obligationRows = obligations || emptyObligations();
  const paymentRows = payments && Array.isArray(payments.payments)
    ? payments.payments
    : [];
  const loanRows = loans && Array.isArray(loans.loans) ? loans.loans : [];

  renderFinancialOverview(obligationRows, paymentRows, loanRows);
  renderNextMonthlyPayment(obligationRows);
  renderUpcomingPayments(obligationRows);
  renderActiveLoans(loanRows);

  // Kept so the arrears / all-payments modals can render without re-fetching.
  window.__dashboardData = {
    groupId,
    obligations: obligationRows,
    payments: paymentRows,
    loans: loanRows,
  };

  await loadNotifications(groupId);
}

/**
 * GET that swallows a load error (returning null) but still bounces on a 401.
 * @param {string} action
 * @param {Object} params
 * @return {Promise<*>}
 */
async function safeGet(action, params) {
  try {
    return await apiGet(action, params);
  } catch (error) {
    handleSessionError(error);
    console.error(`Failed to load ${action}:`, error);
    warnFetchFailure();
    return null;
  }
}

// Fires once per page load — a real fetch failure must never look identical
// to a genuinely empty/zero account (see FIX 2).
let fetchFailureWarned = false;

/**
 * Show a single, page-load-scoped toast the first time any dashboard
 * section fails to load. Subsequent failures in the same load are silent
 * (already covered by the one toast) but still console.error individually.
 */
function warnFetchFailure() {
  if (fetchFailureWarned) return;
  fetchFailureWarned = true;
  showToast(
    "Some information couldn't be loaded — try refreshing the page.",
    "danger",
  );
}

/**
 * Financial overview cards: total contributed (verified), pending, arrears
 * (arrears + live penalties), and the active-loans count.
 * @param {Object} ob obligations payload
 * @param {Array<Object>} payments payment rows
 * @param {Array<Object>} loans loan rows
 */
function renderFinancialOverview(ob, payments, loans) {
  // Total VERIFIED contributions this year, summed in minor units.
  let contributedMinor = 0;
  contributedMinor += toMinor(ob.seedMoney && ob.seedMoney.amountPaid);
  for (const m of monthsOf(ob)) contributedMinor += toMinor(m.amountPaid);
  if (ob.serviceFee) contributedMinor += toMinor(ob.serviceFee.amountPaid);
  setText("totalContributed", formatMoney(fromMinor(contributedMinor)));

  // Pending = un-adjudicated claims (approvalStatus 'pending') from the ledger.
  let pendingMinor = 0;
  for (const row of payments) {
    if (String(row.approvalStatus) === "pending") {
      pendingMinor += toMinor(row.amountPaid);
    }
  }
  setText("pendingPayments", formatMoney(fromMinor(pendingMinor)));

  // Arrears = outstanding arrears + accrued live penalties across obligations.
  const arrearsMinor = totalArrearsMinor(ob);
  setText("totalArrears", formatMoney(fromMinor(arrearsMinor)));

  // Active-loans count (approved / disbursed).
  const active = loans.filter((l) => isActiveLoan(l.status)).length;
  const activeEl = document.getElementById("activeLoans");
  if (activeEl) {
    activeEl.replaceChildren();
    const count = document.createElement("span");
    count.textContent = String(active);
    activeEl.appendChild(count);
  }
}

/**
 * Total arrears + accrued penalties, in minor units, across all obligations.
 * @param {Object} ob
 * @return {number}
 */
function totalArrearsMinor(ob) {
  let total = 0;
  const seed = ob.seedMoney;
  if (seed) {
    total += toMinor(seed.arrears);
    total += toMinor(seed.penalty && seed.penalty.amountAccrued);
  }
  for (const m of monthsOf(ob)) {
    total += toMinor(m.arrears);
    total += toMinor(m.penalty && m.penalty.amountAccrued);
  }
  if (ob.serviceFee) {
    total += toMinor(ob.serviceFee.arrears);
    total += toMinor(ob.serviceFee.penalty && ob.serviceFee.penalty.amountAccrued);
  }
  return total;
}

/**
 * "Next monthly payment" card — earliest unpaid monthly obligation with a date.
 * @param {Object} ob
 */
function renderNextMonthlyPayment(ob) {
  const detailsEl = document.getElementById("nextPaymentDetails");
  const badgeEl = document.getElementById("nextPaymentBadge");
  const statEl = document.getElementById("nextPaymentStat");
  if (!detailsEl) return;

  const today = startOfToday();
  let next = null;

  for (const m of monthsOf(ob)) {
    const owed = toMinor(m.arrears) > 0;
    const unsettled = ["unpaid", "pending", "rejected"].includes(
      String(m.approvalStatus),
    );
    const due = parseServerDate(m.dueDate);
    if ((owed || unsettled) && due) {
      if (!next || due < next.due) {
        next = { due, amountStr: pickOwedString(m), overdue: due < today };
      }
    }
  }

  if (next) {
    detailsEl.textContent = `${formatMoney(next.amountStr)} on ${formatDate(next.due)}`;
    detailsEl.style.display = "block";
    if (badgeEl) badgeEl.style.display = next.overdue ? "block" : "none";
    if (statEl) statEl.classList.toggle("flash", next.overdue);
  } else {
    detailsEl.textContent = "No payment due";
    detailsEl.style.display = "block";
    if (badgeEl) badgeEl.style.display = "none";
    if (statEl) statEl.classList.remove("flash");
  }
}

/**
 * Upcoming payments list — obligations due within ~60 days, or overdue.
 * @param {Object} ob
 */
function renderUpcomingPayments(ob) {
  const container = document.getElementById("upcomingPayments");
  if (!container) return;

  const items = upcomingObligationItems(ob, 60);
  container.replaceChildren();

  if (!items.length) {
    container.appendChild(buildEmptyState("\u{1F4C5}", "No upcoming payments"));
    return;
  }

  for (const item of items.slice(0, 10)) {
    container.appendChild(buildUpcomingRow(item));
  }
}

/**
 * Build the list of upcoming obligation items within a day window.
 * @param {Object} ob
 * @param {number} windowDays
 * @return {Array<Object>}
 */
function upcomingObligationItems(ob, windowDays) {
  const today = startOfToday();
  const items = [];

  const consider = (label, month, obl) => {
    if (!obl) return;
    if (toMinor(obl.arrears) <= 0) return;
    const due = parseServerDate(obl.dueDate);
    if (!due) return;
    const days = Math.ceil((due - today) / 86400000);
    if (days > windowDays) return;
    items.push({
      type: label,
      month,
      amountStr: pickOwedString(obl),
      due,
      days,
      overdue: days < 0,
    });
  };

  if (ob.seedMoney && ob.seedMoney.configured) {
    consider("Seed Money", "Seed Money", ob.seedMoney);
  }
  for (const m of monthsOf(ob)) consider("Monthly Contribution", m.month, m);
  if (ob.serviceFee) consider("Service Fee", "Service Fee", ob.serviceFee);

  items.sort((a, b) => a.due - b.due);
  return items;
}

/**
 * One upcoming-payment list row, built entirely from nodes.
 * @param {Object} item
 * @return {HTMLElement}
 */
function buildUpcomingRow(item) {
  const row = document.createElement("div");
  row.className = "list-item";

  const left = document.createElement("div");
  left.style.flex = "1";

  const title = document.createElement("div");
  title.className = "list-item-title";
  title.textContent = `${item.type} - ${item.month}`;

  const subtitle = document.createElement("div");
  subtitle.className = "list-item-subtitle";
  subtitle.textContent = `${formatDate(item.due)} • ${daysText(item)}`;

  left.appendChild(title);
  left.appendChild(subtitle);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.flexDirection = "column";
  right.style.alignItems = "flex-end";
  right.style.gap = "var(--bn-space-2)";

  const amount = document.createElement("div");
  amount.style.fontWeight = "700";
  amount.style.color = "var(--bn-dark)";
  amount.textContent = formatMoney(item.amountStr);

  const badge = document.createElement("span");
  if (item.overdue) {
    badge.className = "badge badge-danger";
    badge.textContent = "Overdue";
  } else if (item.days <= 7) {
    badge.className = "badge badge-warning";
    badge.textContent = "Due Soon";
  } else {
    badge.className = "badge badge-info";
    badge.textContent = "Upcoming";
  }

  right.appendChild(amount);
  right.appendChild(badge);

  row.appendChild(left);
  row.appendChild(right);
  return row;
}

/**
 * Active-loans detail: count, amount received, outstanding balance.
 * @param {Array<Object>} loans
 */
function renderActiveLoans(loans) {
  const detailsEl = document.getElementById("activeLoansDetails");
  const statEl = document.getElementById("activeLoansStat");
  const badgeEl = document.getElementById("activeLoansBadge");

  const active = loans.filter((l) => isActiveLoan(l.status));

  if (!detailsEl) return;

  if (!active.length) {
    detailsEl.style.display = "none";
    if (statEl) statEl.classList.remove("flash");
    if (badgeEl) badgeEl.style.display = "none";
    return;
  }

  let receivedMinor = 0;
  let balanceMinor = 0;
  for (const loan of active) {
    receivedMinor += toMinor(loan.approvedAmount || loan.principalAmount);
    balanceMinor += toMinor(loan.remainingBalance);
  }

  detailsEl.replaceChildren();
  if (receivedMinor > 0) {
    detailsEl.appendChild(
      makeLine(`Received: ${formatMoney(fromMinor(receivedMinor))}`),
    );
  }
  if (balanceMinor > 0) {
    detailsEl.appendChild(
      makeLine(`Balance: ${formatMoney(fromMinor(balanceMinor))}`),
    );
  }
  detailsEl.style.display = "block";
}

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

/**
 * Load the caller's inbox for this group and render up to 4 unread.
 * @param {string} groupId
 */
async function loadNotifications(groupId) {
  const list = document.getElementById("notificationsList");
  const unreadBadge = document.getElementById("unreadBadge");
  if (!list) return;

  const data = await safeGet("notifications.list", { groupId });
  const notifications =
    data && Array.isArray(data.notifications) ? data.notifications : [];
  const unreadCount =
    data && typeof data.unreadCount === "number"
      ? data.unreadCount
      : notifications.filter((n) => !n.read).length;

  if (unreadBadge) {
    if (unreadCount > 0) {
      unreadBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      unreadBadge.classList.remove("hidden");
    } else {
      unreadBadge.classList.add("hidden");
    }
  }

  const unread = notifications.filter((n) => !n.read).slice(0, 4);
  list.replaceChildren();

  if (!unread.length) {
    list.appendChild(buildEmptyState("\u{1F4EC}", "No notifications"));
    return;
  }

  for (const notif of unread) list.appendChild(buildNotificationRow(notif));
}

/**
 * One notification row (icon + title/message + relative time).
 * @param {Object} notif
 * @return {HTMLElement}
 */
function buildNotificationRow(notif) {
  const item = document.createElement("div");
  item.className = "notification-item unread";
  item.style.cursor = "pointer";
  item.addEventListener("click", () => {
    window.location.href = "messages.html";
  });

  const icon = document.createElement("div");
  icon.className = "notification-icon";
  icon.textContent = notificationIcon(String(notif.type || ""));

  const content = document.createElement("div");
  content.className = "notification-content";

  const text = document.createElement("div");
  text.className = "notification-text";
  const message = String(notif.title || notif.message || "Notification").slice(
    0,
    80,
  );
  text.textContent = message;
  text.title = message;

  const time = document.createElement("div");
  time.className = "notification-time";
  time.textContent = timeAgo(parseServerDate(notif.createdAt));

  content.appendChild(text);
  content.appendChild(time);
  item.appendChild(icon);
  item.appendChild(content);
  return item;
}

/**
 * Emoji for a notification type, matching the original mapping.
 * @param {string} type
 * @return {string}
 */
function notificationIcon(type) {
  const icons = {
    loan_booking: "\u{1F4B0}",
    loan_approved: "✅",
    loan_rejected: "❌",
    payment_upload: "\u{1F4E4}",
    payment_approved: "✅",
    payment_rejected: "❌",
    broadcast: "\u{1F4E2}",
    reminder: "⏰",
    message: "\u{1F4AC}",
  };
  return icons[type] || "\u{1F514}";
}

/* ------------------------------------------------------------------ *
 * Arrears modal + all-payments modal
 * ------------------------------------------------------------------ */

/**
 * Open the arrears modal: TRUE arrears only (past-due, still owed).
 */
function openArrearsModal() {
  const modal = document.getElementById("arrearsModal");
  const container = document.getElementById("arrearsTableContainer");
  const totalEl = document.getElementById("arrearsTotal");
  const countEl = document.getElementById("arrearsCount");
  const nextDueEl = document.getElementById("arrearsNextDue");
  const data = window.__dashboardData;
  if (!modal || !container || !data) return;

  modal.classList.remove("hidden");
  modal.style.display = "flex";

  const today = startOfToday();
  const rows = upcomingObligationItems(data.obligations, 3650).filter(
    (item) => item.overdue && item.due < today,
  );

  container.replaceChildren();

  if (!rows.length) {
    const empty = buildEmptyState("✅", "You have no arrears. Great job!");
    container.appendChild(empty);
    if (totalEl) totalEl.textContent = formatMoney("0.00");
    if (countEl) countEl.textContent = "0";
    if (nextDueEl) nextDueEl.textContent = "-";
    return;
  }

  const table = document.createElement("table");
  table.className = "table";
  const thead = document.createElement("thead");
  thead.appendChild(makeRow(["Type", "Due", "Arrears"], "th"));
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  let totalMinor = 0;
  for (const item of rows) {
    totalMinor += toMinor(item.amountStr);
    const tr = document.createElement("tr");
    tr.appendChild(makeCell(`${item.type} (${item.month})`, "Type"));
    tr.appendChild(makeCell(formatDate(item.due), "Due"));
    tr.appendChild(makeCell(formatMoney(item.amountStr), "Arrears"));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  if (totalEl) totalEl.textContent = formatMoney(fromMinor(totalMinor));
  if (countEl) countEl.textContent = String(rows.length);
  if (nextDueEl) nextDueEl.textContent = "Overdue";
}

/**
 * Hide the arrears modal.
 */
function hideArrearsModal() {
  const modal = document.getElementById("arrearsModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.style.display = "none";
}

/**
 * Open the all-payments modal: every VERIFIED (approved/completed) payment.
 */
function showAllPaymentsModal() {
  const modal = document.getElementById("allPaymentsModal");
  const tbody = document.getElementById("allPaymentsTableBody");
  const totalEl = document.getElementById("allPaymentsTotal");
  const data = window.__dashboardData;
  if (!modal || !tbody || !data) return;

  const settled = data.payments
    .filter((row) => ["approved", "completed"].includes(String(row.approvalStatus)))
    .filter((row) => toMinor(row.amountPaid) > 0)
    .map((row) => ({
      type: PAYMENT_TYPE_LABELS[row.paymentType] || String(row.paymentType),
      amountStr: String(row.amountPaid),
      date: parseServerDate(row.paidAt || row.approvedAt || row.createdAt),
    }))
    .sort((a, b) => (b.date || 0) - (a.date || 0));

  tbody.replaceChildren();

  if (!settled.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.style.textAlign = "center";
    td.textContent = "No approved payments found";
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    let totalMinor = 0;
    for (const p of settled) {
      totalMinor += toMinor(p.amountStr);
      const tr = document.createElement("tr");
      tr.appendChild(makeCell(p.type, "Type"));
      tr.appendChild(makeCell(p.date ? formatDate(p.date) : "-", "Date"));
      tr.appendChild(makeCell(formatMoney(p.amountStr), "Amount"));
      tbody.appendChild(tr);
    }
    if (totalEl) totalEl.textContent = formatMoney(fromMinor(totalMinor));
  }

  modal.classList.remove("hidden");
}
window.showAllPaymentsModal = showAllPaymentsModal;

/**
 * Open the upcoming-payments modal (grouped by month), full obligations window.
 */
function openUpcomingPaymentsModal() {
  const modal = document.getElementById("upcomingPaymentsModal");
  const list = document.getElementById("upcomingPaymentsModalList");
  const data = window.__dashboardData;
  if (!modal || !list || !data) return;

  const items = upcomingObligationItems(data.obligations, 3650);
  list.replaceChildren();

  if (!items.length) {
    list.appendChild(
      buildEmptyState("\u{1F4C5}", "No upcoming payments for the next year"),
    );
  } else {
    for (const item of items) list.appendChild(buildUpcomingRow(item));
  }

  if (window.openModal) {
    window.openModal("upcomingPaymentsModal");
  } else {
    modal.classList.remove("hidden");
    modal.classList.add("active");
  }
}

/* ------------------------------------------------------------------ *
 * Static handlers (logout, mobile menu, modals, session timer)
 * ------------------------------------------------------------------ */

/**
 * Wire the buttons and modals that exist independent of loaded data.
 */
function wireStaticHandlers() {
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document
    .getElementById("mobileLogoutBtn")
    ?.addEventListener("click", () => {
      closeMobileMenu();
      handleLogout();
    });

  // Mobile menu.
  const menuBtn = document.getElementById("mobileMenuBtn");
  const menuClose = document.getElementById("mobileMenuClose");
  const overlay = document.getElementById("mobileMenuOverlay");
  menuBtn?.addEventListener("click", openMobileMenu);
  menuClose?.addEventListener("click", closeMobileMenu);
  overlay?.addEventListener("click", closeMobileMenu);
  window.closeMobileMenu = closeMobileMenu;

  // Arrears modal.
  const totalArrears = document.getElementById("totalArrears");
  if (totalArrears) {
    totalArrears.style.cursor = "pointer";
    totalArrears.addEventListener("click", () => openArrearsModalGuarded());
  }
  document
    .getElementById("closeArrearsModal")
    ?.addEventListener("click", hideArrearsModal);
  document
    .getElementById("closeArrearsModalFooter")
    ?.addEventListener("click", hideArrearsModal);
  const arrearsModal = document.getElementById("arrearsModal");
  arrearsModal?.addEventListener("click", (e) => {
    if (e.target === arrearsModal) hideArrearsModal();
  });

  // All-payments modal overlay click.
  const allPaymentsModal = document.getElementById("allPaymentsModal");
  allPaymentsModal?.addEventListener("click", (e) => {
    if (e.target === allPaymentsModal) allPaymentsModal.classList.add("hidden");
  });

  // Upcoming payments modal.
  document
    .getElementById("upcomingPaymentsBtn")
    ?.addEventListener("click", () => openUpcomingPaymentsModalGuarded());
  document
    .getElementById("closeUpcomingPaymentsModal")
    ?.addEventListener("click", () => {
      const modal = document.getElementById("upcomingPaymentsModal");
      if (window.closeModal) {
        window.closeModal("upcomingPaymentsModal");
      } else if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("active");
      }
    });

  // No member-initiated "request a new loan" flow exists anywhere in the
  // ported app yet (grepped loans.request across scripts/*_sql.js — the only
  // caller is the admin-only manage_loans page). Be honest about that rather
  // than dead-ending silently.
  document
    .getElementById("requestLoanBtn")
    ?.addEventListener("click", () =>
      showToast(
        "Requesting a new loan isn't available online yet — please contact your group admin.",
        "info",
      ),
    );
  // Repayment / proof-of-payment upload IS live — on loan_payments.html.
  document
    .getElementById("uploadPaymentBtn")
    ?.addEventListener("click", () => {
      window.location.href = "loan_payments.html";
    });

  // Idle-timeout reset on interaction. These are WINDOW-level listeners, so
  // unlike every other listener in this function (attached to elements that
  // get discarded when the SPA router swaps in a fresh DOM subtree), they
  // are NOT cleaned up by the swap and would accumulate — one full set of 4
  // duplicate listeners per return visit to this page — on every SPA
  // navigation back here, since init() (and therefore wireStaticHandlers())
  // runs again each time. Idle tracking is inherently page-independent, so
  // attach these exactly once ever rather than once per visit.
  if (!window.__bnIdleListenersWired) {
    window.__bnIdleListenersWired = true;
    ["click", "keypress", "mousemove", "scroll"].forEach((evt) =>
      window.addEventListener(evt, resetSessionTimer, { passive: true }),
    );
  }
}

/**
 * Guard the arrears modal so it prompts for a group instead of crashing.
 */
async function openArrearsModalGuarded() {
  if (!getSelectedGroupId()) {
    const shouldContinue = await resolveGroupOrRedirect();
    if (!shouldContinue) return;
    window.location.reload();
    return;
  }
  openArrearsModal();
}

/**
 * Guard the upcoming-payments modal the same way.
 */
async function openUpcomingPaymentsModalGuarded() {
  if (!getSelectedGroupId()) {
    const shouldContinue = await resolveGroupOrRedirect();
    if (!shouldContinue) return;
    window.location.reload();
    return;
  }
  openUpcomingPaymentsModal();
}

/**
 * Open the mobile menu.
 */
function openMobileMenu() {
  const menu = document.getElementById("mobileMenu");
  const btn = document.getElementById("mobileMenuBtn");
  const overlay = document.getElementById("mobileMenuOverlay");
  if (menu && btn && overlay) {
    menu.classList.add("active");
    btn.classList.add("active");
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";
  }
}

/**
 * Close the mobile menu.
 */
function closeMobileMenu() {
  const menu = document.getElementById("mobileMenu");
  const btn = document.getElementById("mobileMenuBtn");
  const overlay = document.getElementById("mobileMenuOverlay");
  if (menu && btn && overlay) {
    menu.classList.remove("active");
    btn.classList.remove("active");
    overlay.classList.remove("active");
    document.body.style.overflow = "";
  }
}

/**
 * Reset the idle-logout timer.
 */
function resetSessionTimer() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    showToast("Your session has expired. You will be logged out.", "info");
    handleLogout();
  }, SESSION_IDLE_MS);
}

/**
 * Sign out via the API, then to login. Navigation state is cleared.
 */
async function handleLogout() {
  try {
    await logout();
  } catch (error) {
    console.error("Error signing out:", error);
  }
  sessionStorage.removeItem("selectedGroupId");
  sessionStorage.removeItem("userRole");
  localStorage.removeItem("selectedGroupId");
  localStorage.removeItem("userRole");
  window.location.href = "../login.html";
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

/**
 * A 401 anywhere means the session died mid-page — bounce to login.
 * @param {*} error
 */
function handleSessionError(error) {
  if (error instanceof ApiError && error.status === 401) {
    redirectToLogin();
    throw new Promise(() => {});
  }
}

/**
 * Read the navigation-state group id (allowed; not identity).
 * @return {?string}
 */
function getSelectedGroupId() {
  return (
    sessionStorage.getItem("selectedGroupId") ||
    localStorage.getItem("selectedGroupId")
  );
}

/**
 * Persist the navigation-state group id.
 * @param {string} groupId
 */
function saveSelectedGroupId(groupId) {
  if (!groupId) return;
  sessionStorage.setItem("selectedGroupId", groupId);
  localStorage.setItem("selectedGroupId", groupId);
}

/**
 * Set an element's textContent by id, if it exists.
 * @param {string} id
 * @param {string} value
 */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/**
 * The monthly-contribution obligation rows, or an empty array.
 * @param {Object} ob
 * @return {Array<Object>}
 */
function monthsOf(ob) {
  return ob && ob.monthlyContributions && Array.isArray(ob.monthlyContributions.months)
    ? ob.monthlyContributions.months
    : [];
}

/**
 * The amount to show as owed for an obligation: its arrears if any, else its
 * total. Both are 2dp strings from the server — returned as-is, no arithmetic.
 * @param {Object} obl
 * @return {string}
 */
function pickOwedString(obl) {
  return toMinor(obl.arrears) > 0
    ? String(obl.arrears)
    : String(obl.totalAmount || "0.00");
}

/**
 * Whether a loan status counts as active (money out, being repaid).
 * @param {string} status
 * @return {boolean}
 */
function isActiveLoan(status) {
  return status === "approved" || status === "disbursed";
}

/**
 * A short empty-state node.
 * @param {string} icon
 * @param {string} text
 * @return {HTMLElement}
 */
function buildEmptyState(icon, text) {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";

  const iconEl = document.createElement("div");
  iconEl.className = "empty-state-icon";
  iconEl.textContent = icon;

  const textEl = document.createElement("p");
  textEl.className = "empty-state-text";
  textEl.textContent = text;

  wrap.appendChild(iconEl);
  wrap.appendChild(textEl);
  return wrap;
}

/**
 * A single detail line for the active-loans card.
 * @param {string} text
 * @return {HTMLElement}
 */
function makeLine(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div;
}

/**
 * A table row of cells (th/td) from an array of strings.
 * @param {Array<string>} values
 * @param {string} tag "th" or "td"
 * @return {HTMLElement}
 */
function makeRow(values, tag) {
  const tr = document.createElement("tr");
  for (const value of values) {
    const cell = document.createElement(tag);
    cell.textContent = value;
    tr.appendChild(cell);
  }
  return tr;
}

/**
 * A td with a data-label, built with textContent.
 * @param {string} value
 * @param {string} label
 * @return {HTMLElement}
 */
function makeCell(value, label) {
  const td = document.createElement("td");
  td.setAttribute("data-label", label);
  td.textContent = value;
  return td;
}

/**
 * "Overdue" / "Due today" / "Due in N days" text for an upcoming item.
 * @param {Object} item
 * @return {string}
 */
function daysText(item) {
  if (item.overdue) return `${Math.abs(item.days)} days overdue`;
  if (item.days === 0) return "Due today";
  if (item.days === 1) return "Due tomorrow";
  return `Due in ${item.days} days`;
}

/**
 * Show a toast, matching the original pattern (never alert()).
 * @param {string} message
 * @param {string} type
 */
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const span = document.createElement("span");
  span.className = "toast-content toast-message";
  span.textContent = message;
  const close = document.createElement("button");
  close.className = "toast-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss notification");
  close.addEventListener("click", () => toast.remove());

  toast.appendChild(span);
  toast.appendChild(close);
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* ---- money (integer minor units — never float) ---- */

/**
 * Parse a 2dp money string into integer minor units. No float arithmetic.
 * @param {*} value e.g. "1234.56"
 * @return {number} minor units (e.g. 123456)
 */
function toMinor(value) {
  const s = String(value == null ? "0" : value).trim();
  if (s === "") return 0;
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intPart, fracRaw = ""] = body.split(".");
  const frac = (fracRaw + "00").slice(0, 2);
  const cents =
    (parseInt(intPart || "0", 10) || 0) * 100 + (parseInt(frac || "0", 10) || 0);
  return neg ? -cents : cents;
}

/**
 * Render integer minor units back to a canonical 2dp string.
 * @param {number} cents
 * @return {string}
 */
function fromMinor(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/**
 * Format a 2dp money string as "MWK 1,234.56" using string ops only.
 * @param {*} value 2dp string from the server (or from fromMinor).
 * @return {string}
 */
function formatMoney(value) {
  const s = String(value == null ? "0.00" : value).trim();
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  let [intPart, frac = "00"] = body.split(".");
  frac = (frac + "00").slice(0, 2);
  intPart = (intPart || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `MWK ${neg ? "-" : ""}${intPart}.${frac}`;
}

/* ---- dates ---- */

/**
 * Parse a server datetime ("Y-m-d H:i:s" or "Y-m-d") into a Date, or null.
 * @param {*} value
 * @return {?Date}
 */
function parseServerDate(value) {
  if (!value) return null;
  const s = String(value).trim().replace(" ", "T");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Today at local midnight.
 * @return {Date}
 */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * "Jul 15, 2026" style date.
 * @param {Date} date
 * @return {string}
 */
function formatDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Relative "time ago" for a notification timestamp.
 * @param {?Date} date
 * @return {string}
 */
function timeAgo(date) {
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

/**
 * An empty obligations shape, so a failed load renders zeros not a crash.
 * @return {Object}
 */
function emptyObligations() {
  return {
    year: new Date().getFullYear(),
    seedMoney: null,
    monthlyContributions: { months: [] },
    serviceFee: null,
  };
}
