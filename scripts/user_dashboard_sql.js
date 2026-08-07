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

import { requireSession, apiGet, apiPost, logout, ApiError, redirectToLogin, listMyGroups, apiUrl } from "./api.js";
import { attachCardInfo, infoContent } from "./card_info.js";
import { renderQuickAmounts } from "./ui.js";
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
  setupQuickActionsRelocation();
  loadUserDashboardEntry();
}

/**
 * Move the hero's Quick Actions block into the sidebar drawer on mobile, and
 * back into the hero on desktop.
 *
 * The block is MOVED, never cloned: every button in it is wired by id
 * (#requestLoanBtn, #uploadPaymentBtn, ...), so a copy would duplicate those
 * ids and only one of each pair would keep working. appendChild relocates the
 * live nodes with their listeners intact.
 *
 * Why: on a phone the hero was carrying a greeting, a period select, six stat
 * tiles AND nine action buttons, which pushed the actual dashboard cards far
 * below the fold. The drawer is empty space that only exists on mobile, so the
 * actions live there and the hero stays a summary.
 *
 * The slot (#sidebarQuickActions) is created by nav_sql.js, which may not have
 * injected the sidebar yet when this runs — hence the observer.
 */
function setupQuickActionsRelocation() {
  const mq = window.matchMedia("(max-width: 1024px)");

  const place = () => {
    const block = document.querySelector(".hero-quick-actions");
    if (!block) return;
    const target = mq.matches
      ? document.getElementById("sidebarQuickActions")
      : document.querySelector(".hero-container");
    if (target && block.parentElement !== target) target.appendChild(block);
  };

  place();
  mq.addEventListener("change", place);

  if (!document.getElementById("sidebarQuickActions")) {
    const observer = new MutationObserver(() => {
      if (!document.getElementById("sidebarQuickActions")) return;
      observer.disconnect();
      place();
    });
    observer.observe(document.body, {childList: true, subtree: true});
    // Give up rather than observing the whole document for the page's life.
    setTimeout(() => observer.disconnect(), 5000);
  }
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
  const paymentsSummary = (payments && payments.summary) || {};
  const loanRows = loans && Array.isArray(loans.loans) ? loans.loans : [];
  const loansSummary = (loans && loans.summary) || {};
  const obligationsSummary = (obligations && obligations.summary) || {};
  const memberRows = members && Array.isArray(members.members)
    ? members.members
    : [];

  renderFinancialOverview(obligationRows, paymentRows, loanRows, paymentsSummary);
  renderGroupMembers(memberRows);
  renderNextMonthlyPayment(obligationRows);
  renderPaymentSplit(obligationRows);  // overdue + upcoming, split
  renderActiveLoans(loanRows, loansSummary);
  renderBorrowingPower(groupId);
  renderWhatIOwe(obligationRows, obligationsSummary);
  renderMyStanding(obligationRows, loanRows, loansSummary, obligationsSummary);
  await renderPaymentCalendar(obligationRows, loanRows);

  // Kept so the arrears / all-payments modals can render without re-fetching.
  // The summaries travel with the rows: every modal footer below is a SERVER
  // total, so it must come from the same response that produced the rows it sits
  // under. Caching the rows without their summary is what forced the old
  // client-side re-summation.
  window.__dashboardData = {
    groupId,
    obligations: obligationRows,
    payments: paymentRows,
    loans: loanRows,
    obligationsSummary,
    paymentsSummary,
    loansSummary,
    // A COUNT, for the Group Members info panel. Cached here so the panel does
    // not have to read it back out of the DOM it just wrote.
    memberCount: memberRows.length,
  };

  // Re-scope Contributed/Pending to the month-filter's current selection
  // (defaults to the current month) now that payments are cached.
  applyDashboardMonthFilter();

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
 * @param {Object} paymentsSummary payments.list summary (member-scoped)
 */
function renderFinancialOverview(ob, payments, loans, paymentsSummary) {
  // Total VERIFIED contributions (seed + months + service fee) and total
  // arrears (arrears + accrued live penalties), read directly from the
  // server-computed summary — matches this card's scope exactly, so the old
  // client-side seed/months/serviceFee accumulation loops are redundant.
  const summary = (ob && ob.summary) || {};
  setText("totalContributed", formatCurrency(summary.contributed));

  // Populate "i" popover with the type breakdown so the member can see HOW
  // their contributions split across seed money, monthly dues and service fees.
  // The server returns the split as its own `contributionBreakdown` object —
  // NOT as summary.seedMoneyContributed/monthlyContributed/serviceFeeContributed,
  // which are names it has never sent. Reading those undefined keys is what left
  // this popover empty, and an empty popover makes the "i" button a silent no-op.
  const contributedPopover = document.getElementById("totalContributedPopover");
  if (contributedPopover) {
    const breakdown = (ob && ob.contributionBreakdown) || {};
    const parts = [
      ["Seed money", breakdown.seedMoney],
      ["Monthly contributions", breakdown.monthly],
      ["Service fees", breakdown.serviceFee],
    ].filter(([, amount]) => amount !== undefined && toMinor(amount) > 0);

    // Only replace the card's shipped explanation once there is a real breakdown
    // to show in its place — never blank it and leave nothing behind.
    if (parts.length) {
      contributedPopover.replaceChildren();

      const title = document.createElement("p");
      title.className = "hero-stat-popover-title";
      title.textContent = "How your contributions break down";
      contributedPopover.appendChild(title);

      for (const [label, amount] of parts) {
        const row = document.createElement("div");
        row.className = "hero-stat-popover-row";
        const l = document.createElement("span");
        l.textContent = label;
        const v = document.createElement("span");
        v.textContent = formatCurrency(amount);
        row.append(l, v);
        contributedPopover.appendChild(row);
      }

      // The derivation, closed: the parts above are the server's own split of
      // this same server total, so the member can see the headline figure add up.
      const totalRow = document.createElement("div");
      totalRow.className = "hero-stat-popover-row";
      const tl = document.createElement("span");
      tl.textContent = "Total contributed";
      const tv = document.createElement("span");
      tv.textContent = formatCurrency(summary.contributed);
      totalRow.append(tl, tv);
      contributedPopover.appendChild(totalRow);
    }
  }

  // Plain‑language breakdown under the tile: what "Contributed" actually means.
  const contributedDetails = document.getElementById("totalContributedStat");
  if (contributedDetails) {
    const detail = contributedDetails.querySelector(".hero-stat-details");
    if (detail) {
      const cMinor = toMinor(summary.contributed);
      detail.textContent = cMinor > 0
        ? `${formatCurrency(fromMinor(cMinor))} collected so far — all your approved payments`
        : "No approved payments yet — upload proof to get started";
    }
  }

  // Pending = un-adjudicated claims (approvalStatus 'pending'), read directly
  // from the payments.list server summary — matches the ledger's own scope.
  setText("pendingPayments", formatCurrency(paymentsSummary.pending));
  renderPendingPopover(payments);

  // Plain‑language breakdown under the tile: what "Pending" means.
  const pendingDetailEl = document.getElementById("pendingPaymentsStat");
  if (pendingDetailEl) {
    const detail = pendingDetailEl.querySelector(".hero-stat-details");
    if (detail) {
      const pMinor = toMinor(paymentsSummary.pending);
      detail.textContent = pMinor > 0
        ? `Waiting for admin to verify ${formatCurrency(fromMinor(pMinor))} — tap to see details`
        : "Nothing waiting — every payment is verified";
    }
  }

  // Arrears = outstanding arrears + accrued live penalties across obligations
  // (seed + months + service fee), read directly from the server-computed
  // summary.
  setText("totalArrears", formatCurrency(summary.totalOwed));
  renderArrearsPopover(summary);

  // Plain‑language breakdown under the tile: split arrears from penalties.
  const arrearsDetailEl = document.getElementById("totalArrearsStat");
  if (arrearsDetailEl) {
    const detail = arrearsDetailEl.querySelector(".hero-stat-details");
    if (detail) {
      /* A2: read the split the server already sends; do NOT re-derive it.
         This used to compute `totalOwed - penaltyAccrued` in the browser and
         display the result — but the server sends that exact figure as
         `summary.arrears`, and builds totalOwed FROM it
         (totalOwed = arrears + penaltyAccrued), so the subtraction was
         re-deriving a number it had already been given. The toMinor() calls
         below only choose a branch; no displayed figure is computed here. */
      if (toMinor(summary.totalOwed) <= 0) {
        detail.textContent = "All paid up — nothing owed";
      } else if (toMinor(summary.penaltyAccrued) > 0) {
        detail.textContent = `${formatCurrency(summary.arrears)} to pay + ${formatCurrency(summary.penaltyAccrued)} in late penalties`;
      } else {
        detail.textContent = `${formatCurrency(summary.totalOwed)} still to pay`;
      }
    }
  }

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
 * Re-scope the Contributed and Pending hero-stat tiles to the
 * #dashboardMonthFilter selection, re-aggregating the already-cached
 * window.__dashboardData.payments array client-side — no re-fetch, no
 * server call. Every other tile (Next Payment, Loans, Arrears, Group
 * Members) and the Payment Calendar are untouched.
 *
 * Uses the exact per-row amount extraction/toMinor call the base
 * renderFinancialOverview() pending sum uses (row.amountPaid via toMinor),
 * so this never introduces new float math or a new field name. Contributed
 * here is computed the same way, scoped to approved/completed rows, rather
 * than read from the obligations summary — that's what lets it be re-scoped
 * by month on the client without a server round-trip.
 */
function applyDashboardMonthFilter() {
  const select = document.getElementById("dashboardMonthFilter");
  const data = window.__dashboardData;
  if (!select || !data || !Array.isArray(data.payments)) return;

  const scope = select.value || "all";
  const currentYear = new Date().getFullYear();

  const inScope = (row) =>
    Number(row.year) === currentYear && (scope === "all" || String(row.month) === scope);

  let contributedMinor = 0;
  let pendingMinor = 0;
  for (const row of data.payments) {
    if (!inScope(row)) continue;
    const status = String(row.approvalStatus);
    if (status === "approved" || status === "completed") {
      contributedMinor += toMinor(row.amountPaid);
    } else if (status === "pending") {
      pendingMinor += toMinor(row.amountPaid);
    }
  }

  setText("totalContributed", formatCurrency(fromMinor(contributedMinor)));
  setText("pendingPayments", formatCurrency(fromMinor(pendingMinor)));

  const scopeLabel = scope === "all" ? String(currentYear) : scope.slice(0, 3);
  setText("totalContributedLabel", `Contributed (${scopeLabel})`);
  setText("pendingPaymentsLabel", `Pending (${scopeLabel})`);
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
  // outstanding = arrears + accrued penalties, read from the server total
  // (summary.totalOwed, cycle 123) instead of summing two money fields client-side.
  const outstandingMinor = toMinor(summary.totalOwed);
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
 * J13 — "What I Owe": a complete, per-obligation breakdown of everything the
 * member still owes, with a Pay button on every row. Seed money is always
 * listed FIRST (it is the entry obligation that capitalises the group), then
 * monthly contributions, then service fee. Every figure is a server string
 * rendered as-is — nothing is summed client-side.
 *
 * @param {Object} ob payments.obligations response
 * @param {Object} summary ob.summary
 */
function renderWhatIOwe(ob, summary) {
  const card = document.getElementById("whatIOweCard");
  const body = document.getElementById("whatIOweBody");
  const totalEl = document.getElementById("whatIOweTotal");
  if (!card || !body) return;

  const rows = [];

  // Seed money first — the entry obligation.
  if (ob.seedMoney && ob.seedMoney.configured && toMinor(ob.seedMoney.arrears) > 0) {
    rows.push({
      type: "seed_money",
      label: "🌱 Seed Money (entry obligation)",
      month: null,
      amountStr: String(ob.seedMoney.arrears),
      dueDate: ob.seedMoney.dueDate,
      penalty: ob.seedMoney.penalty || null,
    });
  }

  // Monthly contributions, in calendar order.
  for (const m of monthsOf(ob)) {
    if (toMinor(m.arrears) <= 0) continue;
    rows.push({
      type: "monthly_contribution",
      label: `Monthly Contribution — ${m.month}`,
      month: m.month,
      amountStr: String(m.arrears),
      dueDate: m.dueDate,
      penalty: m.penalty || null,
    });
  }

  // Service fee.
  if (ob.serviceFee && ob.serviceFee.configured && toMinor(ob.serviceFee.arrears) > 0) {
    rows.push({
      type: "service_fee",
      label: "Service Fee",
      month: null,
      amountStr: String(ob.serviceFee.arrears),
      dueDate: ob.serviceFee.dueDate,
      penalty: ob.serviceFee.penalty || null,
    });
  }

  if (!rows.length) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  body.replaceChildren();

  // Summary total — the server's own totalOwed (arrears + penalties).
  if (totalEl) totalEl.textContent = formatCurrency(summary.totalOwed || "0.00");

  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "payment-item";

    const info = document.createElement("div");
    info.className = "payment-info";

    const title = document.createElement("h4");
    title.textContent = row.label;
    info.appendChild(title);

    const due = parseServerDate(row.dueDate);
    const dueText = document.createElement("p");
    dueText.textContent = due ? `Due ${formatDate(due)}` : "Due now";
    info.appendChild(dueText);

    if (row.penalty && toMinor(row.penalty.amountOutstanding) > 0) {
      const pen = document.createElement("p");
      pen.style.color = "var(--bn-danger)";
      pen.textContent = `+ ${formatCurrency(row.penalty.amountOutstanding)} late penalty`;
      info.appendChild(pen);
    }

    const amountWrap = document.createElement("div");
    amountWrap.className = "payment-amount";

    const amount = document.createElement("div");
    amount.className = "payment-amount-value";
    amount.textContent = formatCurrency(row.amountStr);
    amountWrap.appendChild(amount);

    const payBtn = document.createElement("button");
    payBtn.type = "button";
    payBtn.className = "btn btn-accent btn-sm";
    payBtn.textContent = "Pay";
    payBtn.addEventListener("click", () =>
      openPaymentModal({
        paymentType: row.type,
        month: row.month || undefined,
        amount: cleanAmount(row.amountStr),
      }),
    );
    amountWrap.appendChild(payBtn);

    item.appendChild(info);
    item.appendChild(amountWrap);
    body.appendChild(item);
  }
}

/**
 * J13 — "My Standing": a quick summary of the member's financial position.
 * Shows eligibility, active loans, contribution history, and next payment.
 * All figures are server strings rendered as-is.
 *
 * @param {Object} ob payments.obligations response
 * @param {Array<Object>} loans loans.list rows
 * @param {Object} loansSummary loans.list summary
 * @param {Object} obligationsSummary ob.summary
 */
function renderMyStanding(ob, loans, loansSummary, obligationsSummary) {
  const card = document.getElementById("myStandingCard");
  const body = document.getElementById("myStandingBody");
  const badge = document.getElementById("myStandingBadge");
  if (!card || !body) return;

  card.hidden = false;
  body.replaceChildren();

  const active = loans.filter((l) => isActiveLoan(l.status));
  const summary = obligationsSummary || {};

  /* Eligibility badge.
     Reads ob.standing.eligibleForLoan — the field the server actually sends.
     It previously tested `summary.eligibleForLoan === 1`, and the obligations
     summary carries NO such key (verified live: 'eligibleForLoan' in summary
     === false), so the badge was pinned to "Not eligible" for everyone. It read
     correctly only by coincidence whenever the member genuinely was ineligible;
     a member who qualified was still told they did not. */
  const standing = (ob && ob.standing) || {};
  const eligible = standing.eligibleForLoan === true || standing.eligibleForLoan === 1;
  if (badge) {
    badge.textContent = eligible ? "Eligible" : "Not eligible";
    badge.className = "badge " + (eligible ? "badge-success" : "badge-danger");
  }

  // Say WHY, from the server's own two standing flags. "Not eligible" with no
  // reason leaves a member no way to know what to fix.
  if (!eligible) {
    const blockers = [];
    if (standing.seedMoneyPaid === false) blockers.push("seed money not fully paid");
    if (standing.monthlyContributionsCurrent === false) {
      blockers.push("monthly contributions behind");
    }
    if (blockers.length) {
      const why = document.createElement("p");
      why.style.cssText =
        "margin: 0 0 var(--bn-space-3); color: var(--bn-gray); font-size: var(--bn-text-sm);";
      why.textContent = `Why: ${blockers.join(" · ")}.`;
      body.appendChild(why);
    }
  }

  /* Overdue and not-yet-due are shown SEPARATELY, matching the arrears modal.
     A single "Arrears" line here meant the same word named a different figure
     depending on which surface you read. Both are server strings. */
  const rows = [
    ["Total outstanding", formatCurrency(summary.totalOwed || "0.00")],
    ["Overdue now", formatCurrency(summary.overdue || "0.00")],
  ];
  if (Number(summary.notYetDue || 0) > 0) {
    rows.push(["Not yet due", formatCurrency(summary.notYetDue)]);
  }
  rows.push(
    ["Late penalties", formatCurrency(summary.penaltyAccrued || "0.00")],
    ["Active loans", String(active.length)],
    ["Loan balance", formatCurrency(loansSummary.activeBalance || "0.00")],
  );

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "payment-due-row";
    const l = document.createElement("span");
    l.textContent = label;
    const v = document.createElement("span");
    v.textContent = value;
    row.append(l, v);
    body.appendChild(row);
  }

  // Next payment
  const next = upcomingObligationItems(ob, 60).find((i) => i.due >= startOfToday());
  if (next) {
    const row = document.createElement("div");
    row.className = "payment-due-row";
    const l = document.createElement("span");
    l.textContent = "Next payment";
    const v = document.createElement("span");
    v.textContent = `${formatCurrency(next.amountStr)} on ${formatDate(next.due)}`;
    row.append(l, v);
    body.appendChild(row);
  }
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

/* What the Next Payment card should DO when tapped, resolved by the same pass
 * that decides what it SAYS — so the button can never offer to pay something
 * different from the figure printed on it (J13).
 *   {kind:'pay',     prefill:{...}}  a future obligation, pay it directly
 *   {kind:'overdue'}                 nothing future, but money is late
 *   {kind:'none'}                    all caught up
 */
let nextPaymentAction = { kind: "none" };

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
  let nextFuture = null;  // first UNPAID obligation due in the future
  let hasOverdue = false; // whether ANY unpaid obligation has already passed

  for (const m of monthsOf(ob)) {
    const owed = toMinor(m.arrears) > 0;
    const unsettled = ["unpaid", "pending", "rejected"].includes(
      String(m.approvalStatus),
    );
    const due = parseServerDate(m.dueDate);
    if (!(owed || unsettled) || !due) continue;

    if (due < today) {
      hasOverdue = true;
      continue;  // don't consider past-due obligations for "next payment"
    }

    // Future obligation — pick the earliest
    if (!nextFuture || due < nextFuture.due) {
      nextFuture = { due, amountStr: pickOwedString(m), month: m.month };
    }
  }

  // First row of details: either the next payment or a status note
  if (nextFuture) {
    detailsEl.textContent = `${formatCurrency(nextFuture.amountStr)} on ${formatDate(nextFuture.due)}`;
    /* Same branch that produced the text produces the action, so the card
       cannot say one amount and pay another. The amount is the server's own
       owed string for that month — nothing is recomputed here. */
    nextPaymentAction = {
      kind: "pay",
      prefill: {
        paymentType: "monthly_contribution",
        month: nextFuture.month,
        amount: cleanAmount(nextFuture.amountStr),
      },
    };
  } else if (hasOverdue) {
    detailsEl.textContent = "Everything is overdue — pay now";
    // Nothing is due in future, but money IS late. The arrears modal is the
    // honest destination: it lists every late item with its own Pay button,
    // rather than guessing which one the member meant.
    nextPaymentAction = { kind: "overdue" };
  } else {
    detailsEl.textContent = "All caught up — nothing due";
    nextPaymentAction = { kind: "none" };
  }
  detailsEl.style.display = "block";
  applyNextPaymentAffordance();

  // Badge shows when there is ANY unpaid obligation (past or future)
  if (badgeEl) badgeEl.style.display = hasOverdue ? "block" : "none";
  if (statEl) {
    statEl.classList.toggle("flash", hasOverdue && !nextFuture);
  }

  // Popover: always gives full context
  if (popoverEl) {
    popoverEl.replaceChildren();

    if (nextFuture) {
      const days = Math.round((nextFuture.due - today) / 86400000);

      const typeRow = document.createElement("div");
      typeRow.className = "hero-stat-popover-row";
      const typeLabel = document.createElement("span");
      typeLabel.textContent = "Type";
      const typeValue = document.createElement("span");
      typeValue.textContent = "Monthly Contribution";
      typeRow.append(typeLabel, typeValue);

      const dueRow = document.createElement("div");
      dueRow.className = "hero-stat-popover-row on-time";
      const dueLabel = document.createElement("span");
      dueLabel.textContent = "Due in";
      const dueValue = document.createElement("span");
      dueValue.textContent = `${days} day${days === 1 ? "" : "s"}`;
      dueRow.append(dueLabel, dueValue);

      popoverEl.append(typeRow, dueRow);
    }

    if (hasOverdue) {
      const statusRow = document.createElement("div");
      statusRow.className = "hero-stat-popover-row overdue";
      const sLabel = document.createElement("span");
      sLabel.textContent = "Overdue items";
      const sValue = document.createElement("span");
      sValue.textContent = "Yes — pay below";
      statusRow.append(sLabel, sValue);
      popoverEl.appendChild(statusRow);
    }
  }
}

/**
 * Split obligations into overdue (red card) and upcoming (clean card).
 * @param {Object} ob
 */
function renderPaymentSplit(ob) {
  const allItems = upcomingObligationItems(ob, 60);
  const today = startOfToday();

  const overdue = allItems.filter((item) => item.due < today);
  const upcoming = allItems.filter((item) => item.due >= today);

  // Overdue card — only shown when there are overdue items
  const overdueCard = document.getElementById("overduePaymentsCard");
  const overdueContainer = document.getElementById("overduePayments");
  const overdueCount = document.getElementById("overduePaymentsCount");

  if (overdueCard && overdueContainer) {
    if (overdue.length > 0) {
      overdueCard.hidden = false;
      if (overdueCount) overdueCount.textContent = String(overdue.length);
      overdueContainer.replaceChildren();
      overdueContainer.appendChild(buildUpcomingTable(overdue.slice(0, 10)));
    } else {
      overdueCard.hidden = true;
    }
  }

  // Upcoming card
  const upcomingContainer = document.getElementById("upcomingPayments");
  if (upcomingContainer) {
    upcomingContainer.replaceChildren();
    if (!upcoming.length) {
      upcomingContainer.appendChild(buildEmptyState("\u{1F4C5}", "No upcoming payments"));
    } else {
      upcomingContainer.appendChild(buildUpcomingTable(upcoming.slice(0, 10)));
    }
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
 * The obligations that are genuinely LATE, selected by the server's own rule.
 *
 * Deliberately NOT `upcomingObligationItems(...).filter(due < today)`. That
 * compares due dates in the browser and so counts a month the group's cycle
 * never raised — the server marks those `counts: false`, owes nothing on them
 * and refuses to collect a penalty against them, so listing one as arrears
 * quotes the member a debt the app would then decline to take. Seed money and
 * the service fee have no future-dated grace in the server's summary either:
 * outstanding means overdue. Matching that rule here is what lets the modal
 * footer be a server total instead of a client re-summation.
 *
 * @param {Object} ob payments.obligations response
 * @return {Array<Object>} rows with {type, month, amountStr, due}
 */
function overdueObligationItems(ob) {
  const items = [];

  const consider = (label, month, obl) => {
    if (!obl) return;
    if (toMinor(obl.arrears) <= 0) return;
    items.push({
      type: label,
      month,
      amountStr: String(obl.arrears),
      due: parseServerDate(obl.dueDate),
      // The server already computes the penalty and every term behind it
      // (J2 Slice 3). Carried through verbatim so the modal can SHOW the
      // derivation instead of just asserting a number.
      penalty: obl.penalty || null,
    });
  };

  if (ob.seedMoney && ob.seedMoney.configured) {
    consider("Seed Money", "Seed Money", ob.seedMoney);
  }
  for (const m of monthsOf(ob)) {
    if (m.counts === true && m.overdue === true) {
      consider("Monthly Contribution", m.month, m);
    }
  }
  if (ob.serviceFee) consider("Service Fee", "Service Fee", ob.serviceFee);

  items.sort((a, b) => (a.due || 0) - (b.due || 0));
  return items;
}

/**
 * Make the Next Payment card look and read as actionable only when it IS.
 * A card that offers "Pay now" when nothing is owed is worse than a card that
 * offers nothing — the member taps it, gets an empty form, and stops trusting
 * the number above it.
 */
function applyNextPaymentAffordance() {
  const statEl = document.getElementById("nextPaymentStat");
  if (!statEl) return;
  const actionable = nextPaymentAction.kind !== "none";
  statEl.classList.toggle("is-actionable", actionable);
  if (actionable) {
    statEl.setAttribute("role", "button");
    statEl.setAttribute(
      "title",
      nextPaymentAction.kind === "pay"
        ? "Pay this now"
        : "See everything you are behind on",
    );
  } else {
    statEl.removeAttribute("role");
    statEl.removeAttribute("title");
  }
}

/**
 * Act on the Next Payment card (J13): pay the next obligation straight from
 * the dashboard instead of navigating to a payments page to find it again.
 */
function handleNextPaymentActivate() {
  if (nextPaymentAction.kind === "pay") {
    openPaymentModal(nextPaymentAction.prefill);
  } else if (nextPaymentAction.kind === "overdue") {
    openArrearsModalGuarded();
  }
  // kind 'none' deliberately does nothing — there is nothing to pay.
}

/**
 * Plain-English derivation of one penalty, built ONLY from the terms the
 * server returned with it (J2 Slice 3).
 *
 * "Transparency over mystery": a member who is charged a penalty is entitled
 * to see the sum behind it, not just the result. Nothing is calculated here —
 * every number in the sentence is a value the penalty engine already
 * reported, so this text can never disagree with the amount beside it.
 *
 * @param {Object} p A payments.obligations `penalty` object.
 * @return {string} "" when there is nothing to explain.
 */
function penaltyDerivationText(p) {
  if (!p) return "";
  const periods = Number(p.periodsCharged || 0);
  if (periods <= 0) return "";
  /* penaltyPeriod is the cadence the engine actually charged on and is set in
     both fixed and percentage mode. ratePeriod is the percentage rate's own
     period and is null in fixed mode — reading it alone would caption a
     fixed/month penalty as "N days late". */
  const unit = (p.penaltyPeriod || p.ratePeriod) === "month" ? "month" : "day";
  const plural = periods === 1 ? unit : `${unit}s`;
  let basis;
  if (p.penaltyType === "percentage") {
    basis = `${p.rate}% per ${unit} × ${periods} ${plural} late`;
  } else {
    basis = `${periods} ${plural} late × ${formatCurrency(p.dailyAmount)} per ${unit}`;
  }
  // Only mention settlement when some of the accrual has actually been
  // paid or waived, so the common case stays a single clean sentence.
  if (toMinor(p.amountSettled) > 0) {
    return `${basis}, less ${formatCurrency(p.amountSettled)} already settled`;
  }
  return basis;
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
 * @param {Array<Object>} loans Rows from loans.list — used for the COUNT and the
 *   due badge only; never for money.
 * @param {Object} summary loans.list `summary` — supplies activePrincipal and
 *   activeBalance, both already totalled server-side over the same statuses.
 */
function renderActiveLoans(loans, summary = {}) {
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

  // A2: both figures are SERVER totals over the same ['approved','disbursed']
  // set this function filters on — activePrincipal is the principal actually
  // handed over, activeBalance what is still owed on it. The client adds nothing.
  const receivedStr = summary.activePrincipal;
  const balanceStr = summary.activeBalance;

  detailsEl.replaceChildren();
  if (receivedStr !== undefined && toMinor(receivedStr) > 0) {
    detailsEl.appendChild(makeLine(`Received: ${formatCurrency(receivedStr)}`));
  }
  if (balanceStr !== undefined && toMinor(balanceStr) > 0) {
    detailsEl.appendChild(makeLine(`Balance: ${formatCurrency(balanceStr)}`));
  }
  detailsEl.style.display = "block";

  if (badgeEl) {
    const isDue = active.some((loan) => isLoanDue(loan));
    badgeEl.style.display = isDue ? "block" : "none";
  }
}

/**
 * J7 — "Borrowing Power": what this member actually qualifies for, shown before
 * they apply rather than discovered when a request is refused.
 *
 * Every figure comes from loans.eligibility, which is the SAME
 * loan_eligibility_check() that request_loan() enforces — so this card can never
 * promise a loan the server then rejects, and never denies one it would allow.
 *
 * @param {string} groupId
 */
async function renderBorrowingPower(groupId) {
  const valueEl = document.getElementById("borrowingPowerValue");
  const detailsEl = document.getElementById("borrowingPowerDetails");
  const popoverEl = document.getElementById("borrowingPowerPopover");
  if (!valueEl || !detailsEl) return;

  let data;
  try {
    data = await apiGet("loans.eligibility", { groupId });
  } catch (e) {
    // Never imply eligibility we could not confirm.
    valueEl.textContent = "—";
    detailsEl.textContent = "We could not check your borrowing power just now.";
    if (popoverEl) popoverEl.textContent = "Please refresh to try again.";
    return;
  }

  const eligible = data.eligible === true;
  const reasons = Array.isArray(data.reasons) ? data.reasons : [];
  // A group with no configured ceiling has NO limit — not a limit of zero.
  const hasCap = data.maxLoanAmount !== null && data.maxLoanAmount !== undefined;

  if (eligible) {
    valueEl.textContent = hasCap ? formatCurrency(data.maxLoanAmount) : "Available";
    detailsEl.textContent = hasCap
      ? "You can request up to this amount"
      : "You can request a loan — this group sets no fixed limit";
  } else {
    valueEl.textContent = "Not eligible";
    // The FIRST reason inline; the popover carries all of them. A member is
    // owed the actual reason, never a generic "you do not qualify".
    detailsEl.textContent = reasons.length
      ? reasons[0]
      : "You cannot request a loan right now";
  }

  if (popoverEl) {
    popoverEl.replaceChildren();

    const title = document.createElement("p");
    title.className = "hero-stat-popover-title";
    title.textContent = eligible
      ? "You qualify for a loan"
      : "Why you cannot borrow right now";
    popoverEl.appendChild(title);

    if (!eligible) {
      for (const reason of reasons) {
        const row = document.createElement("div");
        row.className = "hero-stat-popover-row";
        const span = document.createElement("span");
        span.textContent = reason;
        row.appendChild(span);
        popoverEl.appendChild(row);
      }
    }

    const facts = [
      ["Maximum single loan", hasCap ? formatCurrency(data.maxLoanAmount) : "No fixed limit"],
      ["Active loans", `${data.activeLoanCount ?? 0} of ${data.maxActiveLoans ?? 0} allowed`],
      ["You currently owe", formatCurrency(data.totalRemaining || "0.00")],
      ["You have contributed", formatCurrency(data.contributed || "0.00")],
    ];
    const exposure = data.exposure || {};
    facts.push([
      "Debt vs contributions",
      exposure.debtToContributionPercent === null
        || exposure.debtToContributionPercent === undefined
        ? "Not applicable yet"
        : `${exposure.debtToContributionPercent}%`,
    ]);

    for (const [label, value] of facts) {
      const row = document.createElement("div");
      row.className = "hero-stat-popover-row";
      const l = document.createElement("span");
      l.textContent = label;
      const v = document.createElement("span");
      v.textContent = value;
      row.append(l, v);
      popoverEl.appendChild(row);
    }
  }

  applyLoanRequestGate(eligible, reasons);
}

/**
 * Reflect eligibility on the Request Loan button.
 *
 * UX ONLY — the server's gate is what actually refuses a loan. The button is
 * left CLICKABLE when ineligible so a member can still open the modal and read
 * the full standing panel; disabling it outright would hide the explanation
 * behind a control they cannot press.
 *
 * @param {boolean} eligible
 * @param {Array<string>} reasons
 */
function applyLoanRequestGate(eligible, reasons) {
  const btn = document.getElementById("requestLoanBtn");
  if (!btn) return;

  if (eligible) {
    btn.removeAttribute("title");
    btn.removeAttribute("aria-describedby");
    btn.classList.remove("is-ineligible");
    return;
  }

  btn.classList.add("is-ineligible");
  btn.setAttribute(
    "title",
    reasons.length
      ? `You may not qualify right now: ${reasons.join(" ")}`
      : "You may not qualify for a loan right now.",
  );
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

  const rows = overdueObligationItems(data.obligations);

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
  thead.appendChild(makeRow(["Type", "Due", "Arrears", "Late penalty", "Action"], "th"));
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const item of rows) {
    const tr = document.createElement("tr");
    tr.appendChild(makeCell(`${item.type} (${item.month})`, "Type"));
    tr.appendChild(makeCell(item.due ? formatDate(item.due) : "-", "Due"));
    tr.appendChild(makeCell(formatCurrency(item.amountStr), "Arrears"));

    /* J2 Slice 3 — the penalty, and the sum behind it. The Arrears tile this
       modal opens from includes penalties in its total, but the modal used to
       show only the arrears column, so the tile and the rows behind it could
       never be made to agree by reading them. */
    const penaltyTd = document.createElement("td");
    penaltyTd.setAttribute("data-label", "Late penalty");
    const penalty = item.penalty;
    if (penalty && toMinor(penalty.amountOutstanding) > 0) {
      const amount = document.createElement("div");
      amount.className = "penalty-amount";
      amount.textContent = formatCurrency(penalty.amountOutstanding);
      penaltyTd.appendChild(amount);
      const why = penaltyDerivationText(penalty);
      if (why) {
        const note = document.createElement("div");
        note.className = "penalty-why";
        note.textContent = why;
        penaltyTd.appendChild(note);
      }
    } else {
      penaltyTd.textContent = "—";
    }
    tr.appendChild(penaltyTd);

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

  /* J2 Slice 3 — make the modal reconcile with the tile that opened it.
     The Arrears tile shows `totalOwed` (arrears + penalties); this modal's
     header total shows overdue arrears only. Shown side by side those two
     look like a discrepancy, so the three server figures are spelled out
     here. All three are server strings rendered as-is: arrears and penalties
     are the parts, total owed is the server's own sum of them — this code
     does not add anything up. */
  const obSummary = data.obligationsSummary;
  if (obSummary) {
    const recon = document.createElement("div");
    recon.className = "arrears-reconcile";
    /* "Arrears" is split into its two SERVER-PROVIDED parts on purpose.
       It previously rendered `summary.arrears` (ALL outstanding) on a line
       labelled "Arrears", directly under a table listing only the OVERDUE
       rows and a header also labelled "TOTAL ARREARS". Live proof: rows and
       header said 40,000.00 while this line said 50,000.00 — the same word
       carrying two values 10,000.00 apart, with the difference (money owed
       but not yet due) never shown. Splitting it makes the block add up to
       the rows above it AND to Total owed:
         overdue + notYetDue + penalties === totalOwed
       Every figure is still a server string; nothing is summed here. */
    const parts = [
      ["Overdue now", obSummary.overdue],
      ["Not yet due", obSummary.notYetDue],
      ["Late penalties", obSummary.penaltyAccrued],
      ["Total owed", obSummary.totalOwed],
    ];
    for (const [label, value] of parts) {
      if (value == null) continue;
      // Hide a zero "Not yet due" — an all-overdue member should not be shown
      // an empty category, but a non-zero one must never be silently dropped.
      if (label === "Not yet due" && Number(value) === 0) continue;
      const row = document.createElement("div");
      row.className = "arrears-reconcile-row";
      const l = document.createElement("span");
      l.textContent = label;
      const v = document.createElement("span");
      v.textContent = formatCurrency(value);
      row.appendChild(l);
      row.appendChild(v);
      recon.appendChild(row);
    }
    if (recon.childElementCount) container.appendChild(recon);
  }

  // A2: the footer is the server's own overdue total. Because the rows above are
  // selected by the SAME server flags that produced it, footer and rows always
  // reconcile — nothing is re-added here.
  if (totalEl) {
    totalEl.textContent = formatCurrency(
      (data.obligationsSummary && data.obligationsSummary.overdue) || "0.00",
    );
  }
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

  /* EVERY OBLIGATION, NOT JUST THE SETTLED ONES.
     This listed approved payments only, so a member could see what had cleared
     but never what was awaiting approval or what was still to come — and the
     due date was nowhere at all. Seed money, monthly contributions and the
     service fee now appear whatever their state, each with the date it was DUE
     and the date it was PAID, newest activity first.
     Rows with nothing paid and nothing owed are still skipped: an obligation
     that never existed is noise, not history. */
  /* THIS IS THE "MY" DASHBOARD, so it shows the SIGNED-IN PERSON's rows only.
     `payments.list` scopes to the caller for a plain member, but returns the
     whole group for an admin — so an admin opening their own dashboard saw
     every member's obligations listed together, four identical "Monthly
     Contribution — August" rows and no way to tell whose was whose.
     Filtering by uid here makes the screen mean the same thing for everybody.
     This is presentation, not protection: the server-side scoping above is what
     actually stops a member seeing anyone else's payments. */
  const myUid = currentUser && currentUser.uid;
  const settled = data.payments
    .filter((row) => !myUid || String(row.uid) === String(myUid))
    .filter((row) => toMinor(row.amountPaid) > 0 || toMinor(row.arrears) > 0)
    .map((row) => {
      const status = String(row.approvalStatus);
      const paidDate = parseServerDate(row.paidAt || row.approvedAt);
      const dueDate = parseServerDate(row.dueDate);
      const cleared = ["approved", "completed"].includes(status);
      return {
        type: PAYMENT_TYPE_LABELS[row.paymentType] || String(row.paymentType),
        month: row.month || null,
        // What the member actually parted with, or what they still owe.
        amountStr: cleared || status === "pending" ? String(row.amountPaid) : String(row.arrears),
        paidDate,
        dueDate,
        status,
        cleared,
        // Sort by whatever date the row has, so the list reads chronologically
        // whether an item is history or still ahead.
        sortDate: paidDate || dueDate,
      };
    })
    .sort((a, b) => (b.sortDate || 0) - (a.sortDate || 0));

  tbody.replaceChildren();

  if (!settled.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.style.textAlign = "center";
    td.textContent = "No payments or obligations yet";
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    const today = new Date();
    for (const p of settled) {
      const tr = document.createElement("tr");
      tr.appendChild(makeCell(p.month ? `${p.type} — ${p.month}` : p.type, "Type"));
      tr.appendChild(makeCell(p.dueDate ? formatDate(p.dueDate) : "—", "Due"));
      tr.appendChild(makeCell(p.paidDate ? formatDate(p.paidDate) : "—", "Paid"));
      tr.appendChild(makeCell(formatCurrency(p.amountStr), "Amount"));

      // Plain words, not jargon: a member should not have to decode
      // "unpaid vs pending" to know where they stand.
      let label = "Paid";
      let cls = "badge badge-success";
      if (!p.cleared) {
        if (p.status === "pending") { label = "Awaiting approval"; cls = "badge badge-warning"; }
        /* REJECTED IS ITS OWN OUTCOME. Without this branch a rejected payment
           fell through to "Due" while still showing the date it was submitted —
           telling a member their money is merely outstanding when in fact their
           payment was turned down and they need to do something about it. */
        else if (p.status === "rejected") { label = "Rejected"; cls = "badge badge-danger"; }
        else if (p.dueDate && p.dueDate < today) { label = "Overdue"; cls = "badge badge-danger"; }
        else { label = "Due"; cls = "badge badge-warning"; }
      }
      const statusCell = document.createElement("td");
      statusCell.dataset.label = "Status";
      const badge = document.createElement("span");
      badge.className = cls;
      badge.textContent = label;
      statusCell.appendChild(badge);
      tr.appendChild(statusCell);

      tbody.appendChild(tr);
    }
    // A2: verifiedCollected is payments.list's own total over the SAME
    // approved/completed rows this table lists, from the same response — so the
    // footer matches the rows by construction rather than by re-adding them.
    if (totalEl) {
      totalEl.textContent = formatCurrency(
        (data.paymentsSummary && data.paymentsSummary.verifiedCollected) || "0.00",
      );
    }
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
  // Hero stat-band month/period filter — defaults to the current month and
  // re-scopes only the Contributed/Pending tiles from the already-cached
  // payments array (see applyDashboardMonthFilter). No re-fetch here.
  const monthFilter = document.getElementById("dashboardMonthFilter");
  if (monthFilter) {
    monthFilter.value = LOAN_MONTHS[new Date().getMonth()];
    monthFilter.addEventListener("change", applyDashboardMonthFilter);
  }

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
  // J13: the Loans card now opens the repayment modal in place rather than
  // navigating to loan_payments.html. That page is still the full loan history;
  // this is the "pay it" shortcut the owner asked for.
  const activeLoansStat = document.getElementById("activeLoansStat");
  activeLoansStat?.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target === activeLoansStat) {
      e.preventDefault();
      openLoanRepayModal();
    }
  });
  activeLoansStat?.addEventListener("click", (e) => {
    // Let the nested "i" popover toggle and any inner button do their own job.
    if (e.target.closest("button") && e.target !== activeLoansStat) return;
    openLoanRepayModal();
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
  // ignoreSelector is no longer needed: the info toggle is its own button and
  // stops propagation, so a card's primary action can never be hijacked by it.
  initHeroStatPopover("nextPaymentStat", "nextPaymentPopover");
  initHeroStatPopover("pendingPaymentsStat", "pendingPaymentsPopover");
  initHeroStatPopover("totalArrearsStat", "totalArrearsPopover");
  initHeroStatPopover("activeLoansStat", "activeLoansPopover");
  // These two previously had NO toggle at all — their popovers were reachable
  // only by mouse-hover/keyboard-focus, so touch users could never read them.
  // Now they get the same explicit "i" as every other tile.
  initHeroStatPopover("membersStat", "membersPopover");
  initHeroStatPopover("totalContributedStat", "totalContributedPopover");
  initHeroStatPopover("borrowingPowerStat", "borrowingPowerPopover");
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

  // J13 loan repayment modal: close button, overlay click and Escape, matching
  // the behaviour of every other modal on this page.
  document
    .getElementById("closeLoanRepayModal")
    ?.addEventListener("click", closeLoanRepayModal);
  const loanRepayModal = document.getElementById("loanRepayModal");
  loanRepayModal?.addEventListener("click", (e) => {
    if (e.target === loanRepayModal) closeLoanRepayModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const m = document.getElementById("loanRepayModal");
    if (m && !m.classList.contains("hidden")) closeLoanRepayModal();
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

  /* Next Payment card → pay it, without leaving the dashboard (J13).
     The dismiss badge lives INSIDE this card and has its own handler, so
     clicks originating there must not also fire a payment. */
  const nextPaymentStatEl = document.getElementById("nextPaymentStat");
  if (nextPaymentStatEl) {
    nextPaymentStatEl.addEventListener("click", (e) => {
      if (e.target.closest("#nextPaymentBadge")) return;
      handleNextPaymentActivate();
    });
    nextPaymentStatEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest("#nextPaymentBadge")) return;
      e.preventDefault(); // Space would otherwise scroll the page
      handleNextPaymentActivate();
    });
  }

  /* The member-initiated loan-request flow. (The comment that used to sit
     here said no such flow existed anywhere in the app — that was true when
     written and has been false since the flow below was built; the request
     modal, its eligibility panel and its loans.request submit are all wired
     in this file.) */
  document
    .getElementById("requestLoanBtn")
    ?.addEventListener("click", () => openLoanModal());

  /* Deep link: ?open=loan-request opens the request modal straight away.
     This is the entry point for the "Request a Loan" button on
     loan_payments.html — the member's own loans page, which previously had no
     route into borrowing at all. Linking to the one modal that already exists
     keeps a single origination flow rather than cloning it onto a second
     page. The param is cleared from the URL afterwards so a refresh or a
     bookmark does not reopen it. */
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("open") === "loan-request") {
      params.delete("open");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
      );
      openLoanModal();
    }
  } catch (err) {
    // A malformed query string must never stop the dashboard wiring up.
    console.warn("[dashboard] could not read deep-link params", err);
  }

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
    refreshContributionQuickAmounts();
  });
  document.getElementById("paymentMonth")?.addEventListener("change", () => {
    updateAdvancedPaymentVisibility();
    updatePaymentDueInfo();
    refreshContributionQuickAmounts();
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
  const source = document.getElementById(popoverId);
  if (!card || !source) return;

  // The in-card .hero-stat-popover div stays as the CONTENT SOURCE — the
  // render functions on this page (renderPendingPopover, renderArrearsPopover,
  // the next-payment builder) already fill it — but it is no longer what the
  // user sees.
  //
  // WHY: nested inside .hero-stat it was clipped by the stat band and confined
  // by the hero's own stacking/transform context, so it opened cut off. The
  // shared card_info module renders on <body>, which nothing can clip.
  source.hidden = true;

  // The explanation the page SHIPS with, captured before any render function can
  // overwrite it. card_info refuses to open an empty panel (deliberately — it
  // will not flash an empty box), so a renderer that blanks this source turns the
  // card's "i" button into a button that visibly does nothing. That is exactly
  // how the Contributed toggle died. This fallback makes that failure impossible
  // for every hero card at once, whatever a future renderer does.
  const shippedText = (source.textContent || "").trim();

  // The card keeps its own primary action (navigate / open modal) — the info
  // toggle is a separate button that stops propagation, so the two never
  // collide. That also makes the old `ignoreSelector` workaround unnecessary.
  const label = card.querySelector(".hero-stat-label")?.textContent?.trim();
  attachCardInfo(card, {
    label: label ? `About ${label}` : "More information",
    // Read lazily on each open, so content written later by a re-render (or a
    // month-filter change) is always the content shown.
    content: (host) => {
      /* PREFER a structured panel built from the server data this dashboard
         already holds. These seven panels used to clone whatever ad-hoc markup
         the hidden .hero-stat-popover happened to contain, which is why the
         member's own dashboard — the screen they actually live on — was the
         only place in the app whose "i" panels had no description, no
         derivation rows and no action. The cloned markup remains the fallback,
         so a card without a spec still says what it always said. */
      const spec = heroStatInfoSpec(cardId, label);
      if (spec) {
        infoContent({
          title: label || spec.title,
          description: spec.description,
          rows: spec.rows,
          action: spec.action,
        })(host);
        if (host.childNodes.length) return;
      }

      if (label) {
        const heading = document.createElement("p");
        heading.className = "bn-info-title";
        heading.textContent = label;
        host.appendChild(heading);
      }

      const before = host.childNodes.length;
      source.childNodes.forEach((n) => host.appendChild(n.cloneNode(true)));
      if (host.childNodes.length > before) return;

      const p = document.createElement("p");
      p.className = "bn-info-desc";
      p.textContent = shippedText || "No details available for this period.";
      host.appendChild(p);
    },
  });
}

/**
 * The structured panel for one hero card, built from `window.__dashboardData`
 * at OPEN time. Returns null when the card has no spec (the caller then falls
 * back to the page's own popover markup).
 *
 * Every money figure is a SERVER string rendered as-is. Counts are counts.
 * Nothing here adds anything up.
 *
 * @param {string} cardId e.g. "totalContributedStat"
 * @param {string} label the card's own label
 * @return {?Object} {description, rows, action}
 */
function heroStatInfoSpec(cardId, label) {
  const d = window.__dashboardData;
  if (!d) return null;
  const ob = d.obligations || {};
  const sum = d.obligationsSummary || {};
  const ls = d.loansSummary || {};
  const months = monthsOf(ob);
  const myUid = currentUser && (currentUser.uid || currentUser.userId);
  const activeLoans = (Array.isArray(d.loans) ? d.loans : []).filter((l) =>
    isActiveLoan(l.status),
  );
  const myLoans = activeLoans.filter(
    (l) => !myUid || String(l.borrowerId) === String(myUid),
  );

  if (cardId === "totalArrearsStat") {
    return {
      description:
        "What you owe the group and have not yet paid, plus any late penalties that have built up on it.",
      rows: [
        ["Overdue now", formatCurrency(sum.overdue || "0.00")],
        ["Not yet due", formatCurrency(sum.notYetDue || "0.00")],
        {
          label: "Late penalties",
          value: formatCurrency(sum.penaltyAccrued || "0.00"),
          detail: () =>
            months
              .filter((m) => m.penalty && toMinor(m.penalty.amountOutstanding) > 0)
              .map((m) => [m.month, formatCurrency(m.penalty.amountOutstanding)]),
          detailLabel: "Show which months carry a penalty",
        },
        ["Total owed", formatCurrency(sum.totalOwed || "0.00")],
      ],
      action: { label: "See what you owe →", onClick: () => openArrearsModalGuarded() },
    };
  }

  if (cardId === "totalContributedStat") {
    const cb = ob.contributionBreakdown || {};
    return {
      description:
        "Everything you have paid in and the group has verified, split by what it was for.",
      rows: [
        ["Seed money", formatCurrency(cb.seedMoney || "0.00")],
        {
          label: "Monthly contributions",
          value: formatCurrency(cb.monthly || "0.00"),
          detail: () =>
            months
              .filter((m) => toMinor(m.amountPaid) > 0)
              .map((m) => [m.month, formatCurrency(m.amountPaid)]),
          detailLabel: "Show what you paid each month",
        },
        ["Service fee", formatCurrency(cb.serviceFee || "0.00")],
        ["Contributed in total", formatCurrency(sum.contributed || "0.00")],
      ],
      action: {
        label: "See every payment →",
        onClick: () => showAllPaymentsModal(),
      },
    };
  }

  if (cardId === "activeLoansStat") {
    return {
      description:
        "Loans you have taken that are not fully repaid. Received is the money handed to you; balance is what is still owed.",
      rows: [
        {
          label: "Active loans",
          value: String(myLoans.length),
          detail: () =>
            myLoans.map((l) => [
              l.loanNumber ? String(l.loanNumber) : "Loan",
              formatCurrency(l.remainingBalance ?? "0.00"),
            ]),
          detailLabel: "Show each loan and its balance",
        },
        ["Money you received", formatCurrency(ls.activePrincipal || "0.00")],
        ["Still owed", formatCurrency(ls.activeBalance || "0.00")],
      ],
      action: myLoans.length
        ? { label: "Make a repayment →", onClick: () => openLoanRepayModal() }
        : undefined,
    };
  }

  if (cardId === "pendingPaymentsStat") {
    const pend = (Array.isArray(d.payments) ? d.payments : []).filter(
      (p) => String(p.approvalStatus) === "pending",
    );
    return {
      description:
        "Payments you have submitted that an admin has not approved yet. They do not count toward your standing until they are approved.",
      rows: [
        {
          label: "Awaiting approval",
          value: String(pend.length),
          detail: () =>
            pend.map((p) => [
              `${PAYMENT_TYPE_LABELS[p.paymentType] || "Payment"}${p.month ? ` · ${p.month}` : ""}`,
              formatCurrency(p.amountPaid ?? "0.00"),
            ]),
          detailLabel: "Show what is waiting",
        },
      ],
    };
  }

  if (cardId === "nextPaymentStat") {
    const next = upcomingObligationItems(ob, 60).find((i) => i.due >= startOfToday());
    if (!next) {
      return {
        description: "You have nothing falling due in the next 60 days.",
        rows: [["Overdue now", formatCurrency(sum.overdue || "0.00")]],
      };
    }
    return {
      description: "The next thing the group's rules ask you to pay, and when it is due.",
      rows: [
        ["What", next.label || "Contribution"],
        ["Amount", formatCurrency(next.amountStr)],
        ["Due", formatDate(next.due)],
        ["Overdue now", formatCurrency(sum.overdue || "0.00")],
      ],
    };
  }

  if (cardId === "membersStat") {
    return {
      description:
        "Everyone currently in this savings group. A member who has left no longer occupies a place.",
      rows: [["Members in the group", String(d.memberCount ?? "—")]],
    };
  }

  // borrowingPowerStat keeps its own renderer's popover: that card already
  // writes a full server-backed explanation (eligibility + reasons) and
  // duplicating it here would give two places to keep in step.
  return null;
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
  refreshContributionQuickAmounts();

  modal.classList.remove("hidden");
  modal.style.display = "flex";
}

/**
 * Preset amounts for the contribution being recorded.
 *
 * A payment row is ONE type and ONE month, so the honest presets are that
 * obligation's own two server figures: what is still owed on it, and its full
 * amount. There is deliberately no "pay everything overdue" button — that would
 * span several obligations and could not be filed as a single payment, so the
 * server would reject the very figure the button suggested.
 *
 * Both values are read straight from payments.obligations. Nothing is computed.
 */
function refreshContributionQuickAmounts() {
  const container = document.getElementById("paymentQuickAmounts");
  const input = document.getElementById("paymentAmount");
  if (!container || !input) return;

  const data = window.__dashboardData;
  const ob = data && data.obligations;
  const type = document.getElementById("paymentType")?.value || "";
  const month = document.getElementById("paymentMonth")?.value || "";

  let row = null;
  if (ob) {
    if (type === "seed_money") row = ob.seedMoney;
    else if (type === "service_fee") row = ob.serviceFee;
    else if (type === "monthly_contribution") {
      row = monthsOf(ob).find((m) => String(m.month) === month) || null;
    }
  }

  if (!row) {
    renderQuickAmounts(container, [], input);
    return;
  }

  const options = [];
  if (row.arrears !== undefined && toMinor(row.arrears) > 0) {
    options.push({
      key: "outstanding",
      label: "Amount still owed",
      description: "What remains unpaid on this obligation.",
      amount: row.arrears,
      dueDate: row.dueDate || null,
    });
  }
  if (row.totalAmount !== undefined && toMinor(row.totalAmount) > 0) {
    options.push({
      key: "full",
      label: "Full amount",
      description: "The whole amount for this obligation, ignoring anything already paid.",
      amount: row.totalAmount,
      dueDate: row.dueDate || null,
    });
  }

  renderQuickAmounts(container, options, input, "Another amount");
  renderSeedMoneyFirstNote(container, ob, type);
}

/**
 * Seed money comes FIRST in a village-banking cycle — it is the joining stake
 * that capitalises the box, and it is due before monthly contributions run and
 * before the group lends anything out. A member paying a monthly contribution
 * while their seed money is still short is paying out of order, and the group's
 * own eligibility rules already treat unpaid seed money as a bar to borrowing.
 *
 * This is a PROMPT, not a block: the server accepts the payment either way, and
 * pretending otherwise here would be the UI inventing a rule the ledger does not
 * enforce. It simply makes the ordering visible at the moment it matters.
 *
 * @param {HTMLElement} container the quick-amounts container to append to
 * @param {Object} ob payments.obligations response
 * @param {string} type the payment type being recorded
 */
function renderSeedMoneyFirstNote(container, ob, type) {
  if (!container || type === "seed_money") return;

  const seed = ob && ob.seedMoney;
  if (!seed || seed.configured === false) return;
  if (seed.arrears === undefined || toMinor(seed.arrears) <= 0) return;

  const note = document.createElement("p");
  note.className = "quick-amount-note";
  note.textContent =
    `Seed money of ${formatCurrency(seed.arrears)} is still outstanding. `
    + "Seed money is normally settled first — it is what capitalises the group, "
    + "and it must be cleared before you can borrow.";
  container.appendChild(note);
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
  // Read the server-computed total (arrears + accrued penalties) directly —
  // summary.totalOwed (cycle 123), no client-side money addition.
  panel.appendChild(
    buildDueInfoRow(
      `Total outstanding across all obligations: ${formatCurrency(summary.totalOwed)}`,
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
    response = await fetch(apiUrl("files.upload"), {
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
      // The chosen purpose IS the loan's type — sent as its own field so the
      // server can store it on loans.loanType and lending can be reported by
      // type. The server re-validates it against its own allowlist.
      loanType: purpose,
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

/* ── J13: repay a loan from the dashboard ────────────────────────────────────
   The Loans hero card used to navigate to loan_payments.html. It now opens this
   modal, so a member can pay without leaving the dashboard.

   MONEY RULES OBSERVED:
   - Preset amounts and upcoming instalments come from repayments.balance, which
     computes them against the SAME schedule and penalty that repayments.record
     allocates against. A preset can therefore never be rejected by the endpoint
     it was built for, and NOTHING is calculated here. (That is also why "next
     instalment" already includes any outstanding penalty — section 6: a preset
     omitting it would not actually clear the instalment.)
   - Proof of payment is REQUIRED, matching every other member-initiated payment
     path in this app. The server does not enforce it, the app's policy does, and
     a shortcut that quietly dropped it would be a weaker route to the same
     endpoint.
   - Only the member's OWN loans are listed. repayments.record 403s on paying
     someone else's loan, and an ADMIN viewing this page gets the whole group's
     rows from loans.list — so this filter is what stops an admin being offered a
     member's loan as though it were their own.
──────────────────────────────────────────────────────────────────────────── */

/** Loans currently offered in the repayment modal, in render order. */
let loanRepayChoices = [];

/** Open the loan repayment modal. */
function openLoanRepayModal() {
  const modal = document.getElementById("loanRepayModal");
  const body = document.getElementById("loanRepayBody");
  if (!modal || !body) return;

  const data = window.__dashboardData || {};
  const myUid = currentUser && (currentUser.uid || currentUser.userId);
  const active = (Array.isArray(data.loans) ? data.loans : []).filter(
    (l) => isActiveLoan(l.status) && (!myUid || String(l.borrowerId) === String(myUid)),
  );
  loanRepayChoices = active;

  modal.classList.remove("hidden");
  body.replaceChildren();

  if (!active.length) {
    const p = document.createElement("p");
    p.className = "empty-state-text";
    p.textContent = "You have no active loans to repay.";
    body.appendChild(p);
    return;
  }

  const inputCss =
    "width:100%; padding:var(--bn-space-3); border:1px solid var(--bn-gray-300); " +
    "border-radius:var(--bn-radius-md); font-family:var(--bn-font-sans); " +
    "font-size:var(--bn-text-base); min-height:44px;";
  const labelCss =
    "display:block; font-size:var(--bn-text-sm); font-weight:600; " +
    "margin-bottom:var(--bn-space-2); color:var(--bn-gray-700);";

  const field = (labelText, control) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom: var(--bn-space-4);";
    const l = document.createElement("label");
    l.textContent = labelText;
    l.style.cssText = labelCss;
    if (control.id) l.setAttribute("for", control.id);
    wrap.append(l, control);
    return wrap;
  };

  const select = document.createElement("select");
  select.id = "loanRepaySelect";
  select.style.cssText = inputCss;
  active.forEach((l, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    const bal = l.remainingBalance != null ? l.remainingBalance : l.totalRepayment;
    opt.textContent = `Loan ${l.loanNumber || i + 1} — ${formatCurrency(bal || "0.00")} outstanding`;
    select.appendChild(opt);
  });
  body.appendChild(field("Which loan?", select));

  const presets = document.createElement("div");
  presets.id = "loanRepayPresets";
  presets.style.cssText =
    "display:flex; flex-wrap:wrap; gap:var(--bn-space-2); margin-bottom:var(--bn-space-4);";
  body.appendChild(presets);

  const amount = document.createElement("input");
  amount.id = "loanRepayAmount";
  amount.type = "number";
  amount.min = "0";
  amount.step = "0.01";
  amount.style.cssText = inputCss;
  body.appendChild(field("Amount you are paying", amount));

  const upcoming = document.createElement("div");
  upcoming.id = "loanRepayUpcoming";
  upcoming.style.cssText =
    "font-size:var(--bn-text-sm); color:var(--bn-gray); margin-bottom:var(--bn-space-4);";
  body.appendChild(upcoming);

  const method = document.createElement("select");
  method.id = "loanRepayMethod";
  method.style.cssText = inputCss;
  [
    ["cash", "Cash"],
    ["bank_transfer", "Bank transfer"],
    ["mobile_money", "Mobile money"],
  ].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    method.appendChild(o);
  });
  body.appendChild(field("How did you pay?", method));

  const proof = document.createElement("input");
  proof.id = "loanRepayProof";
  proof.type = "file";
  proof.accept = "image/*,application/pdf";
  proof.style.cssText = inputCss;
  body.appendChild(field("Proof of payment (required)", proof));

  const notes = document.createElement("input");
  notes.id = "loanRepayNotes";
  notes.type = "text";
  notes.placeholder = "Optional reference or note";
  notes.style.cssText = inputCss;
  body.appendChild(field("Note (optional)", notes));

  const hint = document.createElement("p");
  hint.style.cssText =
    "font-size:var(--bn-text-sm); color:var(--bn-gray); margin-bottom:var(--bn-space-4);";
  hint.textContent =
    "Your payment is submitted for approval. The group splits it across penalty, interest and principal.";
  body.appendChild(hint);

  const submit = document.createElement("button");
  submit.id = "loanRepaySubmit";
  submit.className = "btn btn-primary";
  submit.style.cssText = "width:100%; min-height:44px;";
  submit.textContent = "Submit repayment";
  submit.addEventListener("click", submitLoanRepayment);
  body.appendChild(submit);

  select.addEventListener("change", () => loadLoanRepayPresets());
  loadLoanRepayPresets();
}

/**
 * Pull the server's preset amounts and upcoming instalments for the selected
 * loan. A failure leaves the amount field usable — it never guesses a figure.
 */
async function loadLoanRepayPresets() {
  const select = document.getElementById("loanRepaySelect");
  const presets = document.getElementById("loanRepayPresets");
  const amount = document.getElementById("loanRepayAmount");
  const upcoming = document.getElementById("loanRepayUpcoming");
  if (!select || !presets || !amount) return;

  const loan = loanRepayChoices[Number(select.value) || 0];
  if (!loan) return;
  presets.replaceChildren();
  if (upcoming) upcoming.textContent = "";
  amount.value = "";

  let data = null;
  try {
    data = await apiGet("repayments.balance", { loanId: loan.loanId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    return;
  }

  for (const q of Array.isArray(data.quickAmounts) ? data.quickAmounts : []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.style.cssText = "min-height:44px; font-size:var(--bn-text-sm);";
    btn.textContent = `${q.label} — ${formatCurrency(q.amount)}`;
    if (q.description) btn.title = q.description;
    btn.addEventListener("click", () => {
      amount.value = String(q.amount);
    });
    presets.appendChild(btn);
    // Default to the first preset (the next instalment) so the common case is
    // one tap — still editable for a part payment.
    if (!amount.value) amount.value = String(q.amount);
  }

  const next = (Array.isArray(data.upcoming) ? data.upcoming : [])[0];
  if (next && upcoming) {
    const due = String(next.dueDate || "").slice(0, 10);
    upcoming.textContent = next.overdue
      ? `Next instalment ${formatCurrency(next.amount)} was due ${due} — overdue`
      : `Next instalment ${formatCurrency(next.amount)} due ${due}`;
  }
}

/** File the repayment. The server computes the split; nothing is derived here. */
async function submitLoanRepayment() {
  const select = document.getElementById("loanRepaySelect");
  const amountEl = document.getElementById("loanRepayAmount");
  const methodEl = document.getElementById("loanRepayMethod");
  const proofEl = document.getElementById("loanRepayProof");
  const notesEl = document.getElementById("loanRepayNotes");
  const submit = document.getElementById("loanRepaySubmit");
  if (!select || !amountEl || !submit) return;

  const loan = loanRepayChoices[Number(select.value) || 0];
  const raw = String(amountEl.value || "").trim();
  const proofFile = proofEl && proofEl.files ? proofEl.files[0] : null;

  if (!loan) return;
  if (!raw || !(Number(raw) > 0)) {
    showToast("Enter the amount you are paying.", "error");
    amountEl.focus();
    return;
  }
  if (!proofFile) {
    showToast("Attach a proof of payment (photo or PDF of the receipt).", "error");
    return;
  }

  submit.disabled = true;
  submit.textContent = "Submitting…";
  try {
    const groupId = getSelectedGroupId();
    const proofUrl = await uploadProof(proofFile, groupId);
    await apiPost("repayments.record", {
      loanId: loan.loanId,
      amount: raw,
      paymentMethod: String(methodEl.value || "cash"),
      notes: String((notesEl && notesEl.value) || "").trim() || undefined,
      proofOfPaymentImageUrl: proofUrl,
    });
    closeLoanRepayModal();
    showToast("Repayment submitted — awaiting admin approval.", "success");
    await loadDashboard(groupId);
  } catch (error) {
    submit.disabled = false;
    submit.textContent = "Submit repayment";
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    showToast(
      error instanceof ApiError && error.message
        ? error.message
        : "Could not submit that repayment.",
      "error",
    );
  }
}

/** Close the loan repayment modal. */
function closeLoanRepayModal() {
  document.getElementById("loanRepayModal")?.classList.add("hidden");
  loanRepayChoices = [];
}
