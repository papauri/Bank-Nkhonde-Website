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

import { requireSession, apiGet, apiPost, logout, ApiError, redirectToLogin, listMyGroups } from "./api.js";
import { formatCurrency } from "./utils_financial.js";

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

// Payment Calendar state: the month currently in view, and the last-built
// event map (date-key -> array of event descriptors) so prev/next re-render
// without re-fetching.
let calendarViewMonth = null;
let calendarEventsMap = new Map();
let selectedCalendarDayKey = null;

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
 * Dismiss the "Due" badge on the next-payment stat tile. The badge is
 * re-shown on the next data refresh by renderNextMonthlyPayment() if the
 * obligation is still overdue, so this only hides the current instance.
 * @param {Event} event
 */
window.dismissNextPaymentBadge = function dismissNextPaymentBadge(event) {
  event.stopPropagation(); // badge sits on top of the parent stat tile's own click-through
  event.target.style.display = "none";
};

/**
 * Dismiss the "Due" badge on the active-loans stat tile. The badge is
 * re-shown on the next data refresh by renderActiveLoans() if it decides
 * to show it again, so this only hides the current instance.
 * @param {Event} event
 */
window.dismissActiveLoansBadge = function dismissActiveLoansBadge(event) {
  event.stopPropagation(); // badge sits on top of the parent stat tile's own click-through
  event.target.style.display = "none";
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

  const [obligations, payments, loans, members] = await Promise.all([
    safeGet("payments.obligations", { groupId }),
    safeGet("payments.list", { groupId }),
    safeGet("loans.list", { groupId }),
    safeGet("members.list", { groupId }),
  ]);

  const obligationRows = obligations || emptyObligations();
  const paymentRows = payments && Array.isArray(payments.payments)
    ? payments.payments
    : [];
  const loanRows = loans && Array.isArray(loans.loans) ? loans.loans : [];
  const memberRows = members && Array.isArray(members.members)
    ? members.members
    : [];

  renderFinancialOverview(obligationRows, paymentRows, loanRows);
  renderGroupMembers(memberRows);
  renderNextMonthlyPayment(obligationRows);
  renderUpcomingPayments(obligationRows);
  renderActiveLoans(loanRows);
  await renderPaymentCalendar(obligationRows, loanRows);

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
  // Total VERIFIED contributions (seed + months + service fee) and total
  // arrears (arrears + accrued live penalties), read directly from the
  // server-computed summary — matches this card's scope exactly, so the old
  // client-side seed/months/serviceFee accumulation loops are redundant.
  const summary = (ob && ob.summary) || {};
  setText("totalContributed", formatCurrency(summary.contributed));

  // Pending = un-adjudicated claims (approvalStatus 'pending') from the ledger.
  let pendingMinor = 0;
  for (const row of payments) {
    if (String(row.approvalStatus) === "pending") {
      pendingMinor += toMinor(row.amountPaid);
    }
  }
  setText("pendingPayments", formatCurrency(fromMinor(pendingMinor)));
  renderPendingPopover(payments);

  // Arrears = outstanding arrears + accrued live penalties across obligations
  // (seed + months + service fee).
  const arrearsMinor = toMinor(summary.arrears) + toMinor(summary.penaltyAccrued);
  setText("totalArrears", formatCurrency(fromMinor(arrearsMinor)));
  renderArrearsPopover(summary);

  // Active-loans count (approved / disbursed).
  const active = loans.filter((l) => isActiveLoan(l.status)).length;
  const activeEl = document.getElementById("activeLoans");
  if (activeEl) {
    activeEl.replaceChildren();
    const count = document.createElement("span");
    count.textContent = String(active);
    activeEl.appendChild(count);
  }

  renderContributionChart(ob);
}

/**
 * "Pending" hero-stat popover: the individual un-adjudicated payment rows
 * behind the pending total (already fetched, no new API call), capped so the
 * popover stays a quick glance rather than a full list.
 * @param {Array<Object>} payments payment rows
 */
function renderPendingPopover(payments) {
  const popover = document.getElementById("pendingPaymentsPopover");
  if (!popover) return;
  popover.replaceChildren();

  const pending = payments
    .filter((row) => String(row.approvalStatus) === "pending")
    .map((row) => ({
      type: PAYMENT_TYPE_LABELS[row.paymentType] || String(row.paymentType),
      amountStr: String(row.amountPaid),
      date: parseServerDate(row.submittedAt || row.createdAt),
    }))
    .sort((a, b) => (b.date || 0) - (a.date || 0));

  const title = document.createElement("p");
  title.className = "hero-stat-popover-title";
  title.textContent = pending.length
    ? `${pending.length} pending payment${pending.length === 1 ? "" : "s"}`
    : "No pending payments";
  popover.appendChild(title);

  const CAP = 5;
  pending.slice(0, CAP).forEach((p) => {
    const row = document.createElement("div");
    row.className = "hero-stat-popover-row";
    const label = document.createElement("span");
    label.textContent = p.date ? `${p.type} (${formatDate(p.date)})` : p.type;
    const amount = document.createElement("span");
    amount.textContent = formatCurrency(p.amountStr);
    row.appendChild(label);
    row.appendChild(amount);
    popover.appendChild(row);
  });

  if (pending.length > CAP) {
    const more = document.createElement("p");
    more.className = "hero-stat-popover-more";
    more.textContent = `+${pending.length - CAP} more`;
    popover.appendChild(more);
  }
}

/**
 * "Arrears" hero-stat popover: splits the combined total into its two
 * server-computed components (true arrears vs. accrued live penalties) —
 * a breakdown the arrears modal's row table doesn't otherwise surface.
 * @param {Object} summary ob.summary
 */
function renderArrearsPopover(summary) {
  const popover = document.getElementById("totalArrearsPopover");
  if (!popover) return;
  popover.replaceChildren();

  const rows = [
    ["Arrears", summary.arrears],
    ["Penalties", summary.penaltyAccrued],
  ];
  for (const [label, amountStr] of rows) {
    const row = document.createElement("div");
    row.className = "hero-stat-popover-row";
    const l = document.createElement("span");
    l.textContent = label;
    const v = document.createElement("span");
    v.textContent = formatCurrency(amountStr);
    row.appendChild(l);
    row.appendChild(v);
    popover.appendChild(row);
  }
}

/**
 * "Contributions: Paid vs Outstanding" donut, built entirely with
 * createElementNS/createElement + textContent (no innerHTML, matching this
 * file's convention). Reads the same server-computed summary used above —
 * no extra API call.
 * @param {Object} ob
 */
function renderContributionChart(ob) {
  const container = document.getElementById("contributionChart");
  if (!container) return;
  container.replaceChildren();

  const summary = (ob && ob.summary) || {};
  const paidMinor = toMinor(summary.contributed);
  const outstandingMinor = toMinor(summary.arrears) + toMinor(summary.penaltyAccrued);
  const totalMinor = paidMinor + outstandingMinor;

  if (totalMinor <= 0) {
    container.appendChild(buildEmptyState("📊", "No contribution data yet"));
    return;
  }

  const pctPaid = Math.round((paidMinor / totalMinor) * 100);

  const centerX = 120;
  const centerY = 120;
  const radius = 80;
  const strokeWidth = 32;
  const circumference = 2 * Math.PI * radius;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.width = "100%";
  wrapper.style.maxWidth = "240px";
  wrapper.style.margin = "0 auto";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "pie-chart-svg");
  svg.setAttribute("viewBox", "0 0 240 240");
  svg.style.width = "100%";
  svg.style.height = "auto";

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("transform", `rotate(-90 ${centerX} ${centerY})`);

  const track = document.createElementNS(SVG_NS, "circle");
  track.setAttribute("cx", String(centerX));
  track.setAttribute("cy", String(centerY));
  track.setAttribute("r", String(radius));
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", "var(--bn-gray-100)");
  track.setAttribute("stroke-width", String(strokeWidth));
  group.appendChild(track);

  const segments = [
    { value: paidMinor, color: "var(--bn-success)", label: "Paid" },
    { value: outstandingMinor, color: "var(--bn-danger)", label: "Outstanding" },
  ].filter((s) => s.value > 0);

  let cumulativeLength = 0;
  segments.forEach((segment) => {
    const percentage = (segment.value / totalMinor) * 100;
    const arcLength = (percentage / 100) * circumference;
    const dashOffset = -cumulativeLength;
    cumulativeLength += arcLength;

    const seg = document.createElementNS(SVG_NS, "circle");
    seg.setAttribute("class", "pie-chart-segment");
    seg.setAttribute("cx", String(centerX));
    seg.setAttribute("cy", String(centerY));
    seg.setAttribute("r", String(radius));
    seg.setAttribute("fill", "none");
    seg.setAttribute("stroke", segment.color);
    seg.setAttribute("stroke-width", String(strokeWidth));
    seg.setAttribute("stroke-dasharray", `${arcLength} ${circumference - arcLength}`);
    seg.setAttribute("stroke-dashoffset", String(dashOffset));
    seg.setAttribute("stroke-linecap", "butt");
    group.appendChild(seg);
  });

  svg.appendChild(group);
  wrapper.appendChild(svg);

  const center = document.createElement("div");
  center.style.position = "absolute";
  center.style.top = "50%";
  center.style.left = "50%";
  center.style.transform = "translate(-50%, -50%)";
  center.style.textAlign = "center";

  const bigNumber = document.createElement("div");
  bigNumber.style.fontWeight = "700";
  bigNumber.style.fontSize = "var(--bn-text-2xl, 1.5rem)";
  bigNumber.textContent = `${pctPaid}%`;

  const subLabel = document.createElement("div");
  subLabel.style.fontSize = "var(--bn-text-sm)";
  subLabel.style.color = "var(--bn-gray-700)";
  subLabel.textContent = "Paid";

  center.appendChild(bigNumber);
  center.appendChild(subLabel);
  wrapper.appendChild(center);

  container.appendChild(wrapper);

  // Legend
  const legend = document.createElement("div");
  legend.style.marginTop = "var(--bn-space-4)";

  const legendRows = [
    { color: "var(--bn-success)", label: "Paid", minor: paidMinor },
    { color: "var(--bn-danger)", label: "Outstanding", minor: outstandingMinor },
  ];

  legendRows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.style.display = "flex";
    rowEl.style.alignItems = "center";
    rowEl.style.justifyContent = "space-between";
    rowEl.style.padding = "var(--bn-space-1) 0";

    const left = document.createElement("span");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "var(--bn-space-2)";

    const dot = document.createElement("span");
    dot.style.display = "inline-block";
    dot.style.width = "10px";
    dot.style.height = "10px";
    dot.style.borderRadius = "50%";
    dot.style.background = row.color;

    const labelText = document.createElement("span");
    labelText.textContent = row.label;

    left.appendChild(dot);
    left.appendChild(labelText);

    const amount = document.createElement("span");
    amount.style.fontWeight = "600";
    amount.textContent = formatCurrency(fromMinor(row.minor));

    rowEl.appendChild(left);
    rowEl.appendChild(amount);
    legend.appendChild(rowEl);
  });

  container.appendChild(legend);
}

/**
 * "Group Members" hero stat. members.list returns the group roster (any member
 * may read it); count those still in the group (active or suspended — an
 * 'inactive'/removed member has left and no longer occupies a slot). Updates
 * only the count span, preserving the "Members" badge beside it.
 */
function renderGroupMembers(members) {
  const el = document.getElementById("totalMembers");
  if (!el) return;
  const countSpan = el.querySelector("span");
  if (!countSpan) return;
  const count = Array.isArray(members)
    ? members.filter((m) => String(m.status) !== "inactive").length
    : 0;
  countSpan.textContent = String(count);
}

/**
 * "Next monthly payment" card — earliest unpaid monthly obligation with a date.
 * @param {Object} ob
 */
function renderNextMonthlyPayment(ob) {
  const detailsEl = document.getElementById("nextPaymentDetails");
  const badgeEl = document.getElementById("nextPaymentBadge");
  const statEl = document.getElementById("nextPaymentStat");
  const popoverEl = document.getElementById("nextPaymentPopover");
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
    detailsEl.textContent = `${formatCurrency(next.amountStr)} on ${formatDate(next.due)}`;
    detailsEl.style.display = "block";
    if (badgeEl) badgeEl.style.display = next.overdue ? "block" : "none";
    if (statEl) statEl.classList.toggle("flash", next.overdue);

    // Popover adds the two facts not already printed on the card face:
    // which obligation this is, and how many days away it sits.
    if (popoverEl) {
      popoverEl.replaceChildren();
      const days = Math.round((next.due - today) / 86400000);

      const typeRow = document.createElement("div");
      typeRow.className = "hero-stat-popover-row";
      const typeLabel = document.createElement("span");
      typeLabel.textContent = "Type";
      const typeValue = document.createElement("span");
      typeValue.textContent = "Monthly Contribution";
      typeRow.appendChild(typeLabel);
      typeRow.appendChild(typeValue);

      const dueRow = document.createElement("div");
      dueRow.className = `hero-stat-popover-row ${days < 0 ? "overdue" : "on-time"}`;
      const dueLabel = document.createElement("span");
      dueLabel.textContent = days < 0 ? "Overdue by" : "Due in";
      const dueValue = document.createElement("span");
      const absDays = Math.abs(days);
      dueValue.textContent = `${absDays} day${absDays === 1 ? "" : "s"}`;
      dueRow.appendChild(dueLabel);
      dueRow.appendChild(dueValue);

      popoverEl.appendChild(typeRow);
      popoverEl.appendChild(dueRow);
    }
  } else {
    detailsEl.textContent = "No payment due";
    detailsEl.style.display = "block";
    if (badgeEl) badgeEl.style.display = "none";
    if (statEl) statEl.classList.remove("flash");
    if (popoverEl) popoverEl.replaceChildren();
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

  container.appendChild(buildUpcomingTable(items.slice(0, 10)));
}

/**
 * Build a responsive obligations table (real table on desktop, cards on mobile
 * via .table-responsive + data-label). Shared by the dashboard section and the
 * "Upcoming Payments" modal.
 * @param {Array<Object>} items
 * @return {HTMLElement} the .table-container wrapper
 */
function buildUpcomingTable(items) {
  const wrap = document.createElement("div");
  wrap.className = "table-container";

  const table = document.createElement("table");
  table.className = "table table-responsive";

  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  for (const h of ["Payment", "Due Date", "Amount", "Status", "Action"]) {
    const th = document.createElement("th");
    th.textContent = h;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const item of items) {
    tbody.appendChild(createUpcomingTableRow(item));
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
  return wrap;
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
function createUpcomingTableRow(item) {
  const tr = document.createElement("tr");

  const nameTd = document.createElement("td");
  nameTd.setAttribute("data-label", "Payment");
  nameTd.textContent = `${item.type} - ${item.month}`;
  tr.appendChild(nameTd);

  const dueTd = document.createElement("td");
  dueTd.setAttribute("data-label", "Due Date");
  dueTd.textContent = `${formatDate(item.due)} • ${daysText(item)}`;
  tr.appendChild(dueTd);

  const amtTd = document.createElement("td");
  amtTd.setAttribute("data-label", "Amount");
  amtTd.className = "cell-right";
  amtTd.textContent = formatCurrency(item.amountStr);
  tr.appendChild(amtTd);

  const statusTd = document.createElement("td");
  statusTd.setAttribute("data-label", "Status");
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
  statusTd.appendChild(badge);
  tr.appendChild(statusTd);

  const actionTd = document.createElement("td");
  actionTd.setAttribute("data-label", "Action");
  const payBtn = document.createElement("button");
  payBtn.type = "button";
  payBtn.className = "btn btn-accent btn-sm";
  payBtn.textContent = "Pay";
  payBtn.addEventListener("click", () =>
    openPaymentModal({
      paymentType: serverPaymentType(item.type),
      month: item.type === "Monthly Contribution" ? item.month : undefined,
      amount: cleanAmount(item.amountStr),
    }),
  );
  actionTd.appendChild(payBtn);
  tr.appendChild(actionTd);

  return tr;
}

/**
 * Map an obligation's display label to the server paymentType enum the
 * payments.record endpoint accepts.
 */
function serverPaymentType(label) {
  if (label === "Seed Money") return "seed_money";
  if (label === "Monthly Contribution") return "monthly_contribution";
  if (label === "Service Fee") return "service_fee";
  return "";
}

/** Strip any formatting so a number input can accept the pre-filled amount. */
function cleanAmount(value) {
  return String(value == null ? "" : value).replace(/[^0-9.]/g, "");
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
      makeLine(`Received: ${formatCurrency(fromMinor(receivedMinor))}`),
    );
  }
  if (balanceMinor > 0) {
    detailsEl.appendChild(
      makeLine(`Balance: ${formatCurrency(fromMinor(balanceMinor))}`),
    );
  }
  detailsEl.style.display = "block";

  if (badgeEl) {
    const isDue = active.some((loan) => isLoanDue(loan));
    badgeEl.style.display = isDue ? "block" : "none";
  }
}

/**
 * Whether a loan is "due": active status, outstanding balance, and its
 * maturity (approvedAt + repaymentPeriod months, day-clamped) has passed.
 * Same rule as the Overdue tab on manage_loans_sql.js (cycle 65) — kept in
 * sync so "due" means one thing app-wide.
 * @param {Object} loan
 * @return {boolean}
 */
function isLoanDue(loan) {
  if (!isActiveLoan(loan.status)) return false;
  if (toMinor(loan.remainingBalance) <= 0) return false;
  if (!loan.approvedAt) return false;
  const start = new Date(loan.approvedAt);
  if (isNaN(start.getTime())) return false;
  const months = parseInt(loan.repaymentPeriod, 10) || 0;
  const targetMonth = start.getMonth() + months;
  const targetFirst = new Date(start.getFullYear(), targetMonth, 1);
  const daysInTargetMonth = new Date(
    targetFirst.getFullYear(),
    targetFirst.getMonth() + 1,
    0,
  ).getDate();
  const maturity = new Date(targetFirst);
  maturity.setDate(Math.min(start.getDate(), daysInTargetMonth));
  return maturity.getTime() < Date.now();
}

/* ------------------------------------------------------------------ *
 * Payment Calendar — read-only visualization of due dates, sourced from
 * the same obligationRows already fetched in loadDashboard(), plus one
 * loans.get fetch per the caller's own active loan (for its repayment
 * schedule dates, which loans.list does not include).
 * ------------------------------------------------------------------ */

/**
 * Fetch the repayment schedule for each of the caller's own active
 * (approved/disbursed) loans. Best-effort: a single loan's fetch failing
 * does not block the calendar from rendering the rest of its events.
 * @param {Array<Object>} loans
 * @return {Promise<Array<Object>>} flattened schedule rows across all loans
 */
async function fetchActiveLoanSchedules(loans) {
  const active = loans.filter((l) => isActiveLoan(l.status));
  const schedules = [];
  await Promise.all(
    active.map(async (loan) => {
      if (!loan.loanId) return;
      try {
        const data = await apiGet("loans.get", { loanId: loan.loanId });
        const rows =
          data && Array.isArray(data.schedule) ? data.schedule : [];
        schedules.push(...rows);
      } catch (error) {
        console.error("Failed to load loan schedule for calendar:", error);
      }
    }),
  );
  return schedules;
}

/**
 * Build a Map of "YYYY-MM-DD" -> array of {type, overdue, paid, label} event
 * descriptors from the obligation rows and loan schedule rows.
 * @param {Object} ob obligations payload
 * @param {Array<Object>} loanSchedules flattened loans.get schedule rows
 * @return {Map<string, Array<Object>>}
 */
function buildCalendarEvents(ob, loanSchedules) {
  const map = new Map();
  const today = startOfToday();

  const add = (date, type, overdue, paid, label) => {
    if (!date) return;
    const key = dateKey(date);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ type, overdue, paid, label });
  };

  const considerObligation = (type, label, obl) => {
    if (!obl) return;
    const due = parseServerDate(obl.dueDate);
    if (!due) return;
    const arrears = toMinor(obl.arrears);
    const overdue = due < today && arrears > 0;
    const paid = arrears <= 0 && due <= today;
    add(due, type, overdue, paid, `${label} • ${formatCurrency(pickOwedString(obl))}`);
  };

  if (ob.seedMoney && ob.seedMoney.configured) {
    considerObligation("seed", "Seed Money", ob.seedMoney);
  }
  for (const m of monthsOf(ob)) {
    considerObligation("monthly", `Monthly Contribution - ${m.month}`, m);
  }
  if (ob.serviceFee) considerObligation("servicefee", "Service Fee", ob.serviceFee);

  for (const row of loanSchedules) {
    const due = parseServerDate(row.dueDate);
    if (!due) continue;
    const overdue = row.status === "overdue";
    const paid = row.status === "paid";
    add(
      due,
      "loan",
      overdue,
      paid,
      `Loan payment • ${formatCurrency(row.totalDue)}`,
    );
  }

  return map;
}

/**
 * Fetch the calendar's event data and render the currently-viewed month
 * (defaulting to the real current month on first load).
 * @param {Object} obligationRows
 * @param {Array<Object>} loanRows
 */
async function renderPaymentCalendar(obligationRows, loanRows) {
  const schedules = await fetchActiveLoanSchedules(loanRows);
  calendarEventsMap = buildCalendarEvents(obligationRows, schedules);
  if (!calendarViewMonth) calendarViewMonth = startOfMonth(new Date());
  renderCalendarGrid(calendarViewMonth, calendarEventsMap);
}

/**
 * Build and render the 7-column month grid for `monthDate` into
 * #paymentCalendar, using the existing .calendar/.calendar-day/etc CSS
 * contract. Read-only — no create/edit/delete affordances.
 * @param {Date} monthDate any date within the month to render
 * @param {Map<string, Array<Object>>} eventsByDate
 */
function renderCalendarGrid(monthDate, eventsByDate) {
  const container = document.getElementById("paymentCalendar");
  if (!container) return;

  setText(
    "calendarMonthYear",
    monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  );

  container.replaceChildren();

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const today = startOfToday();

  const header = document.createElement("div");
  header.className = "calendar-header";
  for (const d of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]) {
    const nameEl = document.createElement("div");
    nameEl.className = "calendar-day-name";
    nameEl.textContent = d;
    header.appendChild(nameEl);
  }
  container.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "calendar";

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstWeekday + 1;
    let cellDate;
    let otherMonth = false;
    if (dayNum < 1) {
      cellDate = new Date(year, month - 1, daysInPrevMonth + dayNum);
      otherMonth = true;
    } else if (dayNum > daysInMonth) {
      cellDate = new Date(year, month + 1, dayNum - daysInMonth);
      otherMonth = true;
    } else {
      cellDate = new Date(year, month, dayNum);
    }

    const cell = document.createElement("div");
    cell.className = "calendar-day";
    if (otherMonth) cell.classList.add("other-month");
    if (isSameDay(cellDate, today)) cell.classList.add("today");

    const numberEl = document.createElement("div");
    numberEl.className = "calendar-day-number";
    numberEl.textContent = String(cellDate.getDate());
    cell.appendChild(numberEl);

    const dayEvents = eventsByDate.get(dateKey(cellDate));
    if (dayEvents && dayEvents.length) {
      cell.classList.add("has-event");
      const eventsWrap = document.createElement("div");
      eventsWrap.className = "calendar-day-events";
      for (const ev of dayEvents) {
        const dot = document.createElement("span");
        dot.className = ev.overdue
          ? "calendar-event-note overdue"
          : ev.paid
            ? `calendar-event-note approved ${ev.type}`
            : `calendar-event-note ${ev.type}`;
        dot.title = ev.label;
        eventsWrap.appendChild(dot);
      }
      cell.appendChild(eventsWrap);

      // Only days with events are interactive — tap/click or keyboard
      // activation reveals the day's agenda in the on-screen details
      // panel (#calendarDayDetails). This replaces reliance on the dot's
      // `title` tooltip, which never fires on touch devices.
      cell.setAttribute("tabindex", "0");
      cell.setAttribute("role", "button");
      cell.setAttribute(
        "aria-label",
        `${cellDate.toLocaleDateString("en-US", { month: "long", day: "numeric" })}, ` +
          `${dayEvents.length} payment event${dayEvents.length === 1 ? "" : "s"} — view details`,
      );
      if (dateKey(cellDate) === selectedCalendarDayKey) {
        cell.classList.add("selected");
      }

      cell.addEventListener("click", () => {
        selectCalendarDay(cell, grid, cellDate, dayEvents);
      });
      // Guard mirrors the existing #activeLoansStat pattern: only fire
      // when the event target is the cell itself (not a nested child),
      // and only for Enter/Space.
      cell.addEventListener("keydown", (e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === cell) {
          e.preventDefault();
          selectCalendarDay(cell, grid, cellDate, dayEvents);
        }
      });
    }

    grid.appendChild(cell);
  }

  container.appendChild(grid);
}

/**
 * Mark `cell` as the sole selected day within `grid` and populate the
 * details panel with its events.
 * @param {HTMLElement} cell
 * @param {HTMLElement} grid
 * @param {Date} cellDate
 * @param {Array<Object>} dayEvents
 */
function selectCalendarDay(cell, grid, cellDate, dayEvents) {
  grid
    .querySelectorAll(".calendar-day.selected")
    .forEach((el) => el.classList.remove("selected"));
  cell.classList.add("selected");
  selectedCalendarDayKey = dateKey(cellDate);
  renderCalendarDayDetails(cellDate, dayEvents);
}

/**
 * Render the click/tap-revealed agenda for a single calendar day into
 * #calendarDayDetails — the on-screen replacement for the dot's native
 * `title` tooltip, which works identically on touch and desktop.
 * @param {Date} cellDate
 * @param {Array<Object>} dayEvents
 */
function renderCalendarDayDetails(cellDate, dayEvents) {
  const panel = document.getElementById("calendarDayDetails");
  if (!panel) return;

  panel.replaceChildren();

  const dateEl = document.createElement("p");
  dateEl.className = "calendar-day-details-date";
  dateEl.textContent = cellDate.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  panel.appendChild(dateEl);

  for (const ev of dayEvents) {
    const row = document.createElement("div");
    row.className = "calendar-day-details-row";

    const dot = document.createElement("span");
    dot.className = ev.overdue
      ? "calendar-day-details-dot calendar-event-note overdue"
      : ev.paid
        ? `calendar-day-details-dot calendar-event-note approved ${ev.type}`
        : `calendar-day-details-dot calendar-event-note ${ev.type}`;
    row.appendChild(dot);

    const label = document.createElement("span");
    label.textContent = ev.label;
    row.appendChild(label);

    const status = document.createElement("span");
    status.className = "calendar-day-details-status";
    status.textContent = ev.overdue ? "Overdue" : ev.paid ? "Paid" : "Upcoming";
    row.appendChild(status);

    panel.appendChild(row);
  }
}

/**
 * Reset #calendarDayDetails to its placeholder state and clear the
 * selected-day marker — used on month navigation so a stale day's
 * details don't linger after the grid changes.
 */
function clearCalendarDayDetails() {
  selectedCalendarDayKey = null;
  const panel = document.getElementById("calendarDayDetails");
  if (!panel) return;
  panel.replaceChildren();
  const placeholder = document.createElement("p");
  placeholder.className = "empty-state-text";
  placeholder.id = "calendarDayDetailsPlaceholder";
  placeholder.textContent = "Tap a highlighted day to see payment details";
  panel.appendChild(placeholder);
}

/**
 * Move the calendar's in-view month by `delta` months and re-render using
 * the already-fetched event map (no re-fetch on navigation).
 * @param {number} delta
 */
function shiftCalendarMonth(delta) {
  if (!calendarViewMonth) calendarViewMonth = startOfMonth(new Date());
  calendarViewMonth = new Date(
    calendarViewMonth.getFullYear(),
    calendarViewMonth.getMonth() + delta,
    1,
  );
  clearCalendarDayDetails();
  renderCalendarGrid(calendarViewMonth, calendarEventsMap);
}

/**
 * Midnight on the first of the month containing `date`.
 * @param {Date} date
 * @return {Date}
 */
function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Whether two dates fall on the same calendar day (ignoring time).
 * @param {Date} a
 * @param {Date} b
 * @return {boolean}
 */
function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Local "YYYY-MM-DD" key for a date, used to bucket calendar events by day.
 * @param {Date} date
 * @return {string}
 */
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
    if (totalEl) totalEl.textContent = formatCurrency("0.00");
    if (countEl) countEl.textContent = "0";
    if (nextDueEl) nextDueEl.textContent = "-";
    return;
  }

  const table = document.createElement("table");
  table.className = "table";
  const thead = document.createElement("thead");
  thead.appendChild(makeRow(["Type", "Due", "Arrears", "Action"], "th"));
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  let totalMinor = 0;
  for (const item of rows) {
    totalMinor += toMinor(item.amountStr);
    const tr = document.createElement("tr");
    tr.appendChild(makeCell(`${item.type} (${item.month})`, "Type"));
    tr.appendChild(makeCell(formatDate(item.due), "Due"));
    tr.appendChild(makeCell(formatCurrency(item.amountStr), "Arrears"));

    const actionTd = document.createElement("td");
    actionTd.setAttribute("data-label", "Action");
    const payBtn = document.createElement("button");
    payBtn.type = "button";
    payBtn.className = "btn btn-accent btn-sm";
    payBtn.textContent = "Pay";
    payBtn.addEventListener("click", () => {
      hideArrearsModal();
      openPaymentModal({
        paymentType: serverPaymentType(item.type),
        month: item.type === "Monthly Contribution" ? item.month : undefined,
        amount: cleanAmount(item.amountStr),
      });
    });
    actionTd.appendChild(payBtn);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  if (totalEl) totalEl.textContent = formatCurrency(fromMinor(totalMinor));
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
      tr.appendChild(makeCell(formatCurrency(p.amountStr), "Amount"));
      tbody.appendChild(tr);
    }
    if (totalEl) totalEl.textContent = formatCurrency(fromMinor(totalMinor));
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
    list.appendChild(buildUpcomingTable(items));
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

  // Active-loans stat tile: keyboard access (it's a div, not a button,
  // because its nested badge is itself a button — button-in-button is
  // invalid HTML). Guard against double-firing when Enter/Space is
  // pressed while focus is on the nested badge button.
  const activeLoansStat = document.getElementById("activeLoansStat");
  activeLoansStat?.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target === activeLoansStat) {
      e.preventDefault();
      window.location.href = "loan_payments.html";
    }
  });

  // Arrears modal (tapping/clicking the amount opens the full arrears modal —
  // unchanged). The popover toggle below is scoped to the rest of the card so
  // it doesn't fight with this click.
  const totalArrears = document.getElementById("totalArrears");
  if (totalArrears) {
    totalArrears.style.cursor = "pointer";
    totalArrears.addEventListener("click", () => openArrearsModalGuarded());
  }

  // Hero-stat popovers: hover/focus-within (CSS) already covers mouse and
  // keyboard; the click-toggle below is the touch fallback (no :hover there).
  // "Arrears" excludes the amount itself so it keeps opening the full modal.
  initHeroStatPopover("nextPaymentStat", "nextPaymentPopover", {
    ignoreSelector: "#nextPaymentBadge",
  });
  initHeroStatPopover("pendingPaymentsStat", "pendingPaymentsPopover");
  initHeroStatPopover("totalArrearsStat", "totalArrearsPopover", {
    ignoreSelector: "#totalArrears",
  });
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

  // Payment Calendar month navigation — re-renders from the already-fetched
  // event map, no re-fetch on prev/next.
  document
    .getElementById("calendarPrevMonth")
    ?.addEventListener("click", () => shiftCalendarMonth(-1));
  document
    .getElementById("calendarNextMonth")
    ?.addEventListener("click", () => shiftCalendarMonth(1));

  // No member-initiated "request a new loan" flow exists anywhere in the
  // ported app yet (grepped loans.request across scripts/*_sql.js — the only
  // caller is the admin-only manage_loans page). Be honest about that rather
  // than dead-ending silently.
  document
    .getElementById("requestLoanBtn")
    ?.addEventListener("click", () => openLoanModal());

  // Loan-request modal wiring (loans.request). Members may book a loan per the
  // group rulebook; the request lands PENDING for admin approval.
  document
    .getElementById("closeLoanModal")
    ?.addEventListener("click", closeLoanModal);
  const loanModalEl = document.getElementById("loanModal");
  loanModalEl?.addEventListener("click", (e) => {
    if (e.target === loanModalEl) closeLoanModal();
  });
  document
    .getElementById("loanRequestForm")
    ?.addEventListener("submit", handleLoanSubmit);
  document
    .getElementById("loanAmount")
    ?.addEventListener("input", updateLoanPreview);
  document
    .getElementById("loanRepaymentPeriod")
    ?.addEventListener("change", updateLoanPreview);

  // "Payment Details" opens the all-verified-payments modal (the modal + its
  // renderer existed but nothing opened it).
  document
    .getElementById("viewPaymentDetailsBtn")
    ?.addEventListener("click", () => showAllPaymentsModal());
  // Repayment / proof-of-payment upload IS live — on loan_payments.html.
  document
    .getElementById("uploadPaymentBtn")
    ?.addEventListener("click", () => openPaymentModal());

  // Contribution-payment modal wiring (seed money / monthly contribution /
  // service fee + proof upload → payments.record). The member pays their own
  // obligation; the server defaults targetUid to the caller.
  document
    .getElementById("closePaymentModal")
    ?.addEventListener("click", closePaymentModal);
  const paymentModalEl = document.getElementById("paymentModal");
  paymentModalEl?.addEventListener("click", (e) => {
    if (e.target === paymentModalEl) closePaymentModal();
  });
  // Show the Month selector only for a monthly contribution.
  document.getElementById("paymentType")?.addEventListener("change", (e) => {
    const monthGroup = document.getElementById("paymentMonthGroup");
    if (monthGroup) {
      monthGroup.style.display =
        e.target.value === "monthly_contribution" ? "block" : "none";
    }
    updateAdvancedPaymentVisibility();
    updatePaymentDueInfo();
  });
  document.getElementById("paymentMonth")?.addEventListener("change", () => {
    updateAdvancedPaymentVisibility();
    updatePaymentDueInfo();
  });
  document
    .getElementById("paymentUploadForm")
    ?.addEventListener("submit", handlePaymentSubmit);

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
 * Wire a hero-stat card's popover for tap/keyboard access. Hover and
 * focus-within reveal it via CSS for mouse/keyboard already; this adds the
 * click-toggle path touch devices need (they have no :hover), matching the
 * calendar day-details dual-path pattern elsewhere in this file. A
 * document-level listener (registered once, below) closes any open popover
 * on an outside tap.
 * @param {string} cardId hero-stat card element id
 * @param {string} popoverId popover element id (already referenced by the
 *   card's aria-describedby in the HTML)
 * @param {{ignoreSelector: (string|undefined)}=} opts elements within the
 *   card (e.g. an existing action button/link) that should not toggle the
 *   popover — their own click handler still fires normally.
 */
function initHeroStatPopover(cardId, popoverId, opts = {}) {
  const card = document.getElementById(cardId);
  const popover = document.getElementById(popoverId);
  if (!card || !popover) return;
  const ignoreSelector = opts.ignoreSelector;

  const setOpen = (open) => {
    card.classList.toggle("popover-open", open);
    card.setAttribute("aria-expanded", String(open));
  };
  card.setAttribute("aria-expanded", "false");

  card.addEventListener("click", (e) => {
    if (ignoreSelector && e.target.closest(ignoreSelector)) return;
    setOpen(!card.classList.contains("popover-open"));
  });

  card.addEventListener("keydown", (e) => {
    if (e.target !== card) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(!card.classList.contains("popover-open"));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  });
}

// Close any open hero-stat popover on an outside tap/click — the touch
// equivalent of a hover ending.
document.addEventListener("click", (e) => {
  document.querySelectorAll(".hero-stat.popover-open").forEach((card) => {
    if (!card.contains(e.target)) {
      card.classList.remove("popover-open");
      card.setAttribute("aria-expanded", "false");
    }
  });
});

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
/* ── Contribution payment: modal → files.upload → payments.record ──────────── */

/**
 * Open the contribution-payment modal, pre-populating the group select with the
 * member's current group. `prefill` (optional, from a per-obligation Pay button)
 * can pre-select {paymentType, month, amount}.
 */
function openPaymentModal(prefill) {
  const modal = document.getElementById("paymentModal");
  const form = document.getElementById("paymentUploadForm");
  if (!modal) return;
  if (form) form.reset();

  const groupSelect = document.getElementById("paymentGroup");
  if (groupSelect && currentGroup && currentGroup.groupId) {
    groupSelect.replaceChildren();
    const opt = document.createElement("option");
    opt.value = currentGroup.groupId;
    opt.textContent = currentGroup.groupName || "Current group";
    groupSelect.appendChild(opt);
    groupSelect.value = currentGroup.groupId;
  }

  const typeSelect = document.getElementById("paymentType");
  const monthGroup = document.getElementById("paymentMonthGroup");
  const monthSelect = document.getElementById("paymentMonth");
  const amountInput = document.getElementById("paymentAmount");
  if (prefill && typeSelect) {
    if (prefill.paymentType) typeSelect.value = prefill.paymentType;
    if (monthGroup) {
      monthGroup.style.display =
        prefill.paymentType === "monthly_contribution" ? "block" : "none";
    }
    if (prefill.month && monthSelect) monthSelect.value = prefill.month;
    if (prefill.amount != null && amountInput) amountInput.value = prefill.amount;
  } else if (monthGroup) {
    monthGroup.style.display = "none";
  }

  updateAdvancedPaymentVisibility();
  updatePaymentDueInfo();

  modal.classList.remove("hidden");
  modal.style.display = "flex";
}

function closePaymentModal() {
  const modal = document.getElementById("paymentModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.style.display = "none";
}

/**
 * Advanced payment = paying a monthly contribution for a month whose due date
 * has NOT yet arrived (paying ahead). It is NOT valid for a payment that is
 * already due or overdue, so the "Advanced Payment" checkbox is shown ONLY when
 * the selected month is genuinely in the future; otherwise it is hidden and
 * force-unchecked (a due/overdue payment can never be an advance).
 */
function updateAdvancedPaymentVisibility() {
  const group = document.getElementById("advancedPaymentGroup");
  const checkbox = document.getElementById("isAdvancedPayment");
  if (!group) return;
  const type = document.getElementById("paymentType")?.value || "";
  const month = document.getElementById("paymentMonth")?.value || "";
  const show = type === "monthly_contribution" && isFutureContributionMonth(month);
  group.style.display = show ? "block" : "none";
  if (!show && checkbox) checkbox.checked = false;
}

/**
 * True only when the given month's monthly-contribution obligation has a due
 * date strictly in the future — the one case where paying it is an advance.
 */
function isFutureContributionMonth(month) {
  if (!month) return false;
  const data = window.__dashboardData;
  const months =
    data && data.obligations && data.obligations.monthlyContributions
      ? data.obligations.monthlyContributions.months || []
      : [];
  const obl = months.find((m) => m.month === month);
  if (!obl) return false;
  const due = parseServerDate(obl.dueDate);
  return due ? due > startOfToday() : false;
}

/**
 * Look up the obligation object matching the payment modal's current
 * type/month selection, reusing the same window.__dashboardData.obligations
 * shape read everywhere else in this file (no extra API call).
 * @param {Object} ob obligations payload
 * @param {string} type server paymentType enum (seed_money / monthly_contribution / service_fee)
 * @param {string} month month name, only relevant for monthly_contribution
 * @return {Object|null}
 */
function findObligationForPaymentModal(ob, type, month) {
  if (type === "seed_money") return ob.seedMoney || null;
  if (type === "service_fee") return ob.serviceFee || null;
  if (type === "monthly_contribution") {
    const months = (ob.monthlyContributions && ob.monthlyContributions.months) || [];
    return months.find((m) => m.month === month) || null;
  }
  return null;
}

/** Build one muted hint/status line for the payment-due-info panel. */
function buildDueInfoHint(text) {
  const hint = document.createElement("div");
  hint.className = "payment-due-hint";
  hint.textContent = text;
  return hint;
}

/** Build one labelled amount line for the payment-due-info panel. */
function buildDueInfoRow(text, className) {
  const row = document.createElement("div");
  row.className = className || "payment-due-row";
  row.textContent = text;
  return row;
}

/**
 * Populate #paymentDueInfo with what's due/paid/outstanding for the payment
 * modal's current type + month selection, straight from
 * window.__dashboardData.obligations (no new API call, no client money math
 * beyond the existing arrears+penalty minor-unit sum already used elsewhere in
 * this file). Also offers to prefill an empty #paymentAmount with the known
 * outstanding amount, without ever overwriting a value the user typed.
 */
function updatePaymentDueInfo() {
  const panel = document.getElementById("paymentDueInfo");
  if (!panel) return;
  panel.replaceChildren();

  const data = window.__dashboardData;
  const ob = data && data.obligations;
  if (!ob) return;

  const type = document.getElementById("paymentType")?.value || "";
  if (!type) return;
  const month = document.getElementById("paymentMonth")?.value || "";

  if (type === "monthly_contribution" && !month) {
    panel.appendChild(buildDueInfoHint("Select a month to see what's due"));
    return;
  }

  const obl = findObligationForPaymentModal(ob, type, month);
  const typeLabel =
    type === "seed_money"
      ? "seed money"
      : type === "service_fee"
        ? "service fee"
        : "monthly contribution";

  if (!obl || obl.configured === false) {
    panel.appendChild(buildDueInfoHint(`No ${typeLabel} due`));
    return;
  }

  panel.appendChild(buildDueInfoRow(`Amount due: ${formatCurrency(obl.totalAmount)}`));
  panel.appendChild(buildDueInfoRow(`Already paid: ${formatCurrency(obl.amountPaid)}`));
  panel.appendChild(
    buildDueInfoRow(
      `Outstanding: ${formatCurrency(obl.arrears)}`,
      "payment-due-row payment-due-outstanding",
    ),
  );

  const summary = ob.summary || {};
  const totalOutstandingMinor = toMinor(summary.arrears) + toMinor(summary.penaltyAccrued);
  panel.appendChild(
    buildDueInfoRow(
      `Total outstanding across all obligations: ${formatCurrency(fromMinor(totalOutstandingMinor))}`,
      "payment-due-hint",
    ),
  );

  const amountInput = document.getElementById("paymentAmount");
  const outstandingMinor = toMinor(obl.arrears);
  if (amountInput && !amountInput.value && outstandingMinor > 0) {
    amountInput.value = cleanAmount(obl.arrears);
  }
}

/**
 * Submit a contribution payment: upload the proof, then record the payment as a
 * PENDING claim for admin approval. No money math here — the member's entered
 * amount is sent as-is; the server owns everything else.
 */
async function handlePaymentSubmit(event) {
  event.preventDefault();

  const groupId =
    document.getElementById("paymentGroup")?.value ||
    (currentGroup && currentGroup.groupId) ||
    "";
  const paymentType = document.getElementById("paymentType")?.value || "";
  const month = document.getElementById("paymentMonth")?.value || "";
  const amount = document.getElementById("paymentAmount")?.value || "";
  const method = document.getElementById("paymentMethod")?.value || "";
  const notes = document.getElementById("paymentNotes")?.value || "";
  const isAdvance =
    document.getElementById("isAdvancedPayment")?.checked || false;
  const proofFile = document.getElementById("paymentProof")?.files?.[0] || null;

  if (!groupId) return showToast("No group selected.", "danger");
  if (!paymentType) return showToast("Please choose a payment type.", "danger");
  if (paymentType === "monthly_contribution" && !month) {
    return showToast("Please choose the month this contribution is for.", "danger");
  }
  if (!amount || Number(amount) <= 0) {
    return showToast("Please enter a valid amount.", "danger");
  }
  if (!method) return showToast("Please choose a payment method.", "danger");
  if (!proofFile) {
    return showToast("Please attach your proof of payment.", "danger");
  }

  const submitBtn = document.querySelector(
    "#paymentUploadForm button[type=submit]",
  );
  if (submitBtn) submitBtn.disabled = true;

  try {
    const proofUrl = await uploadProof(proofFile, groupId);

    const payload = {
      groupId,
      paymentType,
      amount,
      paymentMethod: method,
      proofOfPaymentImageUrl: proofUrl,
      proofOfPaymentFileName: proofFile.name,
      proofOfPaymentFileSize: proofFile.size,
    };
    if (paymentType === "monthly_contribution") {
      payload.month = month;
      payload.isAdvancedPayment = isAdvance;
    }
    if (notes.trim()) payload.notes = notes.trim();

    await apiPost("payments.record", payload);

    closePaymentModal();
    document.getElementById("paymentUploadForm")?.reset();
    showToast("Payment submitted — awaiting admin approval.", "success");

    if (currentGroup && currentGroup.groupId) {
      await loadDashboard(currentGroup.groupId);
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    const msg =
      error instanceof ApiError && error.message
        ? error.message
        : "Failed to submit payment. Please try again.";
    showToast(msg, "danger");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * POST a proof file to files.upload (multipart) and return the stored URL.
 * Mirrors api.js: same-origin credentials, defensive JSON parse, ApiError out.
 * files.upload responds with the standard {ok, data:{url,...}} envelope, so the
 * url is read from body.data.url (with a flat-shape fallback for safety).
 */
async function uploadProof(file, groupId) {
  const form = new FormData();
  form.append("file", file);
  form.append("groupId", groupId);

  let response;
  try {
    response = await fetch("/api/index.php?action=files.upload", {
      method: "POST",
      credentials: "same-origin",
      body: form, // no Content-Type — the browser sets the multipart boundary
    });
  } catch (networkError) {
    throw new ApiError(
      "Unable to reach the server. Check your connection.",
      0,
      null,
    );
  }

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch (parseError) {
    throw new ApiError("Unexpected server response", response.status, null);
  }

  if (!response.ok) {
    const message =
      (body && (body.message || body.error)) || "Upload failed.";
    throw new ApiError(message, response.status, body);
  }

  const url = (body && body.data && body.data.url) || (body && body.url);
  if (!url) {
    throw new ApiError(
      "Upload did not return a file URL.",
      response.status,
      body,
    );
  }
  return url;
}

/* ── Loan request: modal → loans.request ──────────────────────────────────── */

const LOAN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Tracks whether the member's own loans.eligibility check passed for the
// group currently open in the loan-request modal. A UX guard only — the
// server re-checks eligibility on submit regardless of this flag.
let loanEligible = true;
let loanPreviewDebounceId = null;

/**
 * Open the loan-request modal, populating the group select with the member's
 * current group and the target-month select with calendar months (that field
 * is `required` in the markup but empty; the server ignores its value — it is
 * the member's intended loaning cycle per the rulebook).
 */
async function openLoanModal() {
  const modal = document.getElementById("loanModal");
  const form = document.getElementById("loanRequestForm");
  if (!modal) return;
  if (form) form.reset();

  const groupSelect = document.getElementById("loanGroup");
  if (groupSelect && currentGroup && currentGroup.groupId) {
    groupSelect.replaceChildren();
    const opt = document.createElement("option");
    opt.value = currentGroup.groupId;
    opt.textContent = currentGroup.groupName || "Current group";
    groupSelect.appendChild(opt);
    groupSelect.value = currentGroup.groupId;
  }

  const monthSelect = document.getElementById("loanTargetMonth");
  if (monthSelect) {
    monthSelect.replaceChildren();
    for (const m of LOAN_MONTHS) {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      monthSelect.appendChild(o);
    }
  }

  resetLoanCalculationSummary();

  modal.classList.remove("hidden");
  modal.style.display = "flex";

  await loadLoanStanding();
}

/** Reset the calc-summary spans to their zero state (server-priced only). */
function resetLoanCalculationSummary() {
  const principalEl = document.getElementById("loanPrincipalDisplay");
  const interestEl = document.getElementById("loanInterestDisplay");
  const totalEl = document.getElementById("loanTotalDisplay");
  if (principalEl) principalEl.textContent = "MWK 0";
  if (interestEl) interestEl.textContent = "MWK 0";
  if (totalEl) totalEl.textContent = "MWK 0";
}

/**
 * Fetch the member's own loans.eligibility standing for the group open in the
 * modal and render it. Never throws out of the caller — a fetch hiccup should
 * not block the modal, since the server still enforces eligibility on submit.
 */
async function loadLoanStanding() {
  const panel = document.getElementById("loanStandingPanel");
  if (!panel) return;

  const groupId = currentGroup && currentGroup.groupId;
  loanEligible = true;
  setLoanSubmitDisabled(false);

  if (!groupId) {
    panel.replaceChildren();
    return;
  }

  panel.replaceChildren();
  const checking = document.createElement("p");
  checking.style.fontSize = "12px";
  checking.style.color = "var(--bn-gray)";
  checking.textContent = "Checking your standing…";
  panel.appendChild(checking);

  try {
    const elig = await apiGet("loans.eligibility", { groupId });
    renderLoanStanding(elig);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    panel.replaceChildren();
    const note = document.createElement("p");
    note.style.fontSize = "12px";
    note.style.color = "var(--bn-gray)";
    note.textContent = "Couldn't load standing.";
    panel.appendChild(note);
  }
}

/** Enable/disable the loan-request submit button. */
function setLoanSubmitDisabled(disabled) {
  const submitBtn = document.querySelector(
    "#loanRequestForm button[type=submit]",
  );
  if (submitBtn) submitBtn.disabled = disabled;
}

/**
 * Render the member's loan standing (active loans, arrears, penalties) into
 * #loanStandingPanel, and disable submit with reasons listed when ineligible.
 * Built with createElement/textContent only — no innerHTML in this file.
 */
function renderLoanStanding(elig) {
  const panel = document.getElementById("loanStandingPanel");
  if (!panel) return;
  panel.replaceChildren();

  const wrap = document.createElement("div");
  wrap.style.background = "var(--bn-gray-100)";
  wrap.style.padding = "var(--bn-space-4)";
  wrap.style.borderRadius = "var(--bn-radius-lg)";
  wrap.style.marginBottom = "var(--bn-space-4)";

  const heading = document.createElement("p");
  heading.style.fontWeight = "600";
  heading.style.marginBottom = "var(--bn-space-2)";
  heading.textContent = "Your standing";
  wrap.appendChild(heading);

  const activeLoanCount = Number(elig?.activeLoanCount || 0);
  const activeRow = document.createElement("div");
  activeRow.style.display = "flex";
  activeRow.style.justifyContent = "space-between";
  const activeLabel = document.createElement("span");
  activeLabel.style.color = "var(--bn-gray)";
  activeLabel.textContent = "Active loans:";
  const activeValue = document.createElement("span");
  activeValue.style.fontWeight = "600";
  activeValue.textContent = String(activeLoanCount);
  activeRow.appendChild(activeLabel);
  activeRow.appendChild(activeValue);
  wrap.appendChild(activeRow);

  if (activeLoanCount > 0 && Array.isArray(elig.activeLoans)) {
    const list = document.createElement("ul");
    list.style.margin = "var(--bn-space-2) 0";
    list.style.paddingLeft = "18px";
    list.style.fontSize = "12px";
    for (const loan of elig.activeLoans) {
      const li = document.createElement("li");
      li.textContent =
        `${loan.loanNumber} — balance ${formatCurrency(loan.remainingBalance)} ` +
        `(${loan.status})`;
      list.appendChild(li);
    }
    wrap.appendChild(list);
  }

  const arrearsRow = document.createElement("div");
  arrearsRow.style.display = "flex";
  arrearsRow.style.justifyContent = "space-between";
  const arrearsLabel = document.createElement("span");
  arrearsLabel.style.color = "var(--bn-gray)";
  arrearsLabel.textContent = "Outstanding arrears:";
  const arrearsValue = document.createElement("span");
  arrearsValue.style.fontWeight = "600";
  arrearsValue.textContent = elig?.arrears != null ? formatCurrency(elig.arrears) : "MWK 0";
  arrearsRow.appendChild(arrearsLabel);
  arrearsRow.appendChild(arrearsValue);
  wrap.appendChild(arrearsRow);

  const penaltiesRow = document.createElement("div");
  penaltiesRow.style.display = "flex";
  penaltiesRow.style.justifyContent = "space-between";
  const penaltiesLabel = document.createElement("span");
  penaltiesLabel.style.color = "var(--bn-gray)";
  penaltiesLabel.textContent = "Penalties:";
  const penaltiesValue = document.createElement("span");
  penaltiesValue.style.fontWeight = "600";
  penaltiesValue.textContent = elig?.penalties != null ? formatCurrency(elig.penalties) : "MWK 0";
  penaltiesRow.appendChild(penaltiesLabel);
  penaltiesRow.appendChild(penaltiesValue);
  wrap.appendChild(penaltiesRow);

  panel.appendChild(wrap);

  if (!elig?.eligible) {
    const warning = document.createElement("div");
    warning.style.background = "var(--bn-danger)";
    warning.style.opacity = "0.9";
    warning.style.color = "#fff";
    warning.style.padding = "var(--bn-space-3)";
    warning.style.borderRadius = "var(--bn-radius-lg)";
    warning.style.marginBottom = "var(--bn-space-4)";
    warning.style.fontSize = "13px";

    const reasons = Array.isArray(elig?.reasons) ? elig.reasons : [];
    if (reasons.length === 0) {
      warning.textContent = "You are not eligible for a new loan right now.";
    } else {
      const list = document.createElement("ul");
      list.style.margin = "0";
      list.style.paddingLeft = "18px";
      for (const reason of reasons) {
        const li = document.createElement("li");
        li.textContent = reason;
        list.appendChild(li);
      }
      warning.appendChild(list);
    }
    panel.appendChild(warning);

    loanEligible = false;
    setLoanSubmitDisabled(true);
  } else {
    loanEligible = true;
    setLoanSubmitDisabled(false);
  }
}

/**
 * Debounced server-priced loan preview. No client-side interest math — the
 * principal/period the member is typing are sent to loans.eligibility, which
 * returns a formatted schedule preview; the calc-summary spans just display
 * the server's strings.
 */
function updateLoanPreview() {
  if (loanPreviewDebounceId) clearTimeout(loanPreviewDebounceId);
  loanPreviewDebounceId = setTimeout(fetchLoanPreview, 400);
}

async function fetchLoanPreview() {
  const groupId =
    document.getElementById("loanGroup")?.value ||
    (currentGroup && currentGroup.groupId) ||
    "";
  const principalAmount = document.getElementById("loanAmount")?.value || "";
  const repaymentPeriod =
    document.getElementById("loanRepaymentPeriod")?.value || "";

  if (!groupId || !principalAmount || Number(principalAmount) <= 0 ||
      !repaymentPeriod) {
    resetLoanCalculationSummary();
    return;
  }

  try {
    const elig = await apiGet("loans.eligibility", {
      groupId,
      principal: principalAmount,
      repaymentPeriod,
    });
    const preview = elig?.preview;
    const principalEl = document.getElementById("loanPrincipalDisplay");
    const interestEl = document.getElementById("loanInterestDisplay");
    const totalEl = document.getElementById("loanTotalDisplay");

    if (preview) {
      if (principalEl) {
        principalEl.textContent =
          preview.principal ?? formatCurrency(Number(principalAmount));
      }
      if (interestEl) {
        interestEl.textContent =
          preview.totalInterest != null ? formatCurrency(preview.totalInterest) : "MWK 0";
      }
      if (totalEl) {
        totalEl.textContent =
          preview.totalRepayment != null ? formatCurrency(preview.totalRepayment) : "MWK 0";
      }
    } else {
      resetLoanCalculationSummary();
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    resetLoanCalculationSummary();
  }
}

function closeLoanModal() {
  const modal = document.getElementById("loanModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.style.display = "none";
}

/**
 * Submit a loan request. No money math here — the member's requested principal +
 * period go to the server, which prices, schedules and (on approval) disburses.
 */
async function handleLoanSubmit(event) {
  event.preventDefault();

  if (loanEligible === false) {
    return showToast(
      "You are not currently eligible for a new loan.",
      "danger",
    );
  }

  const groupId =
    document.getElementById("loanGroup")?.value ||
    (currentGroup && currentGroup.groupId) ||
    "";
  const principalAmount = document.getElementById("loanAmount")?.value || "";
  const repaymentPeriod =
    document.getElementById("loanRepaymentPeriod")?.value || "";
  const purposeSel = document.getElementById("loanPurpose")?.value || "";
  const description = document.getElementById("loanDescription")?.value || "";

  if (!groupId) return showToast("No group selected.", "danger");
  if (!principalAmount || Number(principalAmount) <= 0) {
    return showToast("Please enter a valid loan amount.", "danger");
  }
  if (!repaymentPeriod) {
    return showToast("Please choose a repayment period.", "danger");
  }
  if (!purposeSel) return showToast("Please choose a loan purpose.", "danger");

  const purpose = description.trim()
    ? `${purposeSel} - ${description.trim()}`
    : purposeSel;

  const submitBtn = document.querySelector(
    "#loanRequestForm button[type=submit]",
  );
  if (submitBtn) submitBtn.disabled = true;

  try {
    await apiPost("loans.request", {
      groupId,
      principalAmount,
      repaymentPeriod: Number(repaymentPeriod),
      purpose,
    });

    closeLoanModal();
    document.getElementById("loanRequestForm")?.reset();
    showToast("Loan request submitted — awaiting admin approval.", "success");

    if (currentGroup && currentGroup.groupId) {
      await loadDashboard(currentGroup.groupId);
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    const msg =
      error instanceof ApiError && error.message
        ? error.message
        : "Failed to submit loan request. Please try again.";
    showToast(msg, "danger");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

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
