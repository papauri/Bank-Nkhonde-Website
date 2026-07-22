/**
 * admin_dashboard_sql.js — SQL/API port of the LIVE admin dashboard
 * (scripts/admin_dashboard.js). This is the admin's home: group-wide money
 * (collections, active loans, pending approvals, arrears) and the admin actions
 * gated behind it.
 *
 * PATTERN (copied from scripts/user_dashboard_sql.js / select_group_sql.js):
 *   1. import ONLY from ./api.js — no firebaseConfig, no onAuthStateChanged.
 *   2. await requireSession() first; it redirects to login on 401 and never
 *      resolves, so nothing below runs against a dead session.
 *   3. apiGet/apiPost for data, catching ApiError and branching on err.status.
 *   4. Logout calls logout() from api.js, not Firebase signOut.
 *
 * ROLE / GATING: the admin dashboard is an admin surface. Client role is UX ONLY
 * — the server re-checks every call. If the caller is only a plain member of the
 * selected group (either the client role says so, or an admin endpoint returns
 * 403), we bounce to user_dashboard.html (an admin page a member reached by URL).
 *
 * MONEY: the API returns money as canonical 2dp strings (integer minor units on
 * the server). This file NEVER does float arithmetic on money — every sum is done
 * in integer minor units (toMinor / fromMinor) and every amount reaches the DOM
 * via textContent. The server is the source of truth; nothing here re-rounds it.
 *
 * SECURITY: every server string (member names, loan purposes, group names,
 * amounts) is placed with createElement + textContent. The only innerHTML in this
 * file builds the SVG pie charts, which contain ZERO server-authored strings —
 * only computed numbers and hard-coded labels/colours.
 *
 * SCOPE: this is a READ/DISPLAY port. The four stat cards are derived from two
 * list calls (payments.list + loans.list) in integer minor units — no per-member
 * N+1 fetch. Inline "Approve"/"Reject" affordances navigate to the dedicated
 * management pages (manage_loans.html / manage_payments.html), where the money
 * write flow lives; this port does not re-implement money-moving writes. The
 * Firebase original's live-search and notifications widgets are separate Firebase
 * modules and are not re-wired here (named in the report).
 */

import { requireSession, apiGet, logout, ApiError, redirectToLogin } from "./api.js";
import { formatCurrency, formatCurrencyFromMinor } from "./utils_financial.js";

// Admin-equivalent roles: who may see the admin dashboard for a group.
const ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Module state.
let currentUser = null;
let adminGroups = [];
let currentGroup = null;
let memberNameById = new Map();
// Cached loaded data for the selected group, so modals render without refetch.
let groupData = { payments: [], loans: [], members: [], summary: null };

/**
 * Router-compatible entry point. Body is identical to the former
 * DOMContentLoaded handler; the SPA router (scripts/spa-router.js) calls this
 * directly after every content swap, and the guarded bootstrap below covers
 * a normal hard page load.
 * @return {Promise<void>}
 */
export async function init() {
  setupEventListeners();
  updateCurrentDate();
  await loadDashboard();
}

if (!window.__bnSpa) {
  document.addEventListener("DOMContentLoaded", () => {
    init();
  });
}

/* ------------------------------------------------------------------ *
 * Entry point + group resolution
 * ------------------------------------------------------------------ */

/**
 * Gate on the session, resolve the admin group list, then load the selected one.
 */
async function loadDashboard() {
  showSpinner(true);
  currentUser = await requireSession();
  renderIdentity(currentUser);

  let groups = [];
  try {
    const data = await apiGet("groups.mine");
    groups = Array.isArray(data && data.groups) ? data.groups : [];
  } catch (error) {
    handleSessionError(error);
    showToast("Error loading dashboard.", "danger");
    showSpinner(false);
    return;
  }

  // Only groups where this caller is admin-equivalent belong on this dashboard.
  adminGroups = groups.filter((g) =>
    ADMIN_ROLES.includes(typeof g.myRole === "string" ? g.myRole : "member"),
  );

  updateMobileNavUserView();

  if (adminGroups.length === 0) {
    hideGroupSelectionOverlay();
    showSpinner(false);
    return;
  }

  // Resolve the selected group from URL / nav-state (selectedGroupId is nav
  // state, not identity — the session cookie is the only identity).
  const urlParams = new URLSearchParams(window.location.search);
  const urlGroupId = urlParams.get("groupId");
  let selectedGroupId =
    urlGroupId || getSelectedGroupId() || null;

  if (selectedGroupId && !adminGroups.find((g) => g.groupId === selectedGroupId)) {
    // Stored group is not one this caller admins — drop it.
    selectedGroupId = null;
  }

  if (!selectedGroupId) {
    // Auto-select the first admin group, matching the original's behaviour.
    selectedGroupId = adminGroups[0].groupId;
  }

  saveSelectedGroupId(selectedGroupId);
  currentGroup = adminGroups.find((g) => g.groupId === selectedGroupId) || null;

  hideGroupSelectionOverlay();
  updateURLWithGroup(selectedGroupId);
  updateTopbarGroupName();

  await loadDashboardAfterGroupSelection();
  showSpinner(false);
}

/**
 * Load and render every section for the currently selected group.
 */
async function loadDashboardAfterGroupSelection() {
  if (!currentGroup || !currentGroup.groupId) return;
  const groupId = currentGroup.groupId;

  const failedSections = [];
  const [payments, loans, members, groupArrears] = await Promise.all([
    safeGet("payments.list", { groupId }, "payments", failedSections),
    safeGet("loans.list", { groupId }, "loans", failedSections),
    safeGet("members.list", { groupId }, "members", failedSections),
    safeGet("payments.groupArrears", { groupId }, "arrears", failedSections),
  ]);

  // A 403 on an admin endpoint means a plain member reached this page by URL.
  if (payments === FORBIDDEN || loans === FORBIDDEN || members === FORBIDDEN) {
    window.location.href = "user_dashboard.html";
    return;
  }

  groupData.payments =
    payments && Array.isArray(payments.payments) ? payments.payments : [];
  groupData.summary =
    payments && payments.summary && typeof payments.summary === "object"
      ? payments.summary
      : null;
  // Group-wide arrears derived from OBLIGATIONS (unpaid seed/monthly/service +
  // penalties across all active members), not just recorded payment rows — so
  // an obligation a member never recorded is still counted. Server-computed.
  groupData.groupArrears =
    groupArrears && groupArrears.totalArrears != null ? groupArrears : null;
  groupData.loans = loans && Array.isArray(loans.loans) ? loans.loans : [];
  groupData.members =
    members && Array.isArray(members.members) ? members.members : [];

  // A failed section renders as an empty list above (by design, so the rest of
  // the dashboard still works) — but "zero" must never be silently confused
  // with "we couldn't load it". Surface that distinction to the admin.
  if (failedSections.length) {
    showToast(
      failedSections.length === 1
        ? `Couldn't load ${failedSections[0]} — figures shown may be incomplete.`
        : `Couldn't load ${failedSections.join(", ")} — figures shown may be incomplete.`,
      "danger",
    );
  }

  memberNameById = new Map();
  for (const m of groupData.members) {
    memberNameById.set(String(m.uid), m.fullName || "Unknown Member");
  }

  updateCurrentDate();
  renderDashboardStats();
  renderCollectionTrends();
  loadPendingApprovals();
  loadDuePayments();
}

/**
 * A GET that swallows load errors (returns null), bounces on 401, and returns a
 * sentinel on 403 so the caller can redirect a member off an admin page. On any
 * other failure, the caller's rendering still treats null as "empty" — but the
 * failure is also pushed onto `failedSections` (if given) so the caller can
 * surface a visible signal instead of a silent false-empty dashboard.
 * @param {string} action
 * @param {Object} params
 * @param {string} [sectionLabel] human label pushed to failedSections on error
 * @param {Array<string>} [failedSections] accumulator for failed section labels
 * @return {Promise<*>}
 */
const FORBIDDEN = Symbol("forbidden");
async function safeGet(action, params, sectionLabel, failedSections) {
  try {
    return await apiGet(action, params);
  } catch (error) {
    handleSessionError(error);
    if (error instanceof ApiError && error.status === 403) return FORBIDDEN;
    console.error(`Failed to load ${action}:`, error);
    if (sectionLabel && Array.isArray(failedSections)) {
      failedSections.push(sectionLabel);
    }
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

/**
 * Populate the sidebar/topbar identity from the session user.
 * @param {Object} user {uid, email, fullName}
 */
function renderIdentity(user) {
  const email = typeof user.email === "string" ? user.email : "";
  const displayName =
    (typeof user.fullName === "string" && user.fullName.trim()) ||
    (email ? email.split("@")[0] : "Admin");

  setText("sidebarUserName", displayName);
  const initial = displayName.charAt(0).toUpperCase();
  setText("sidebarUserInitials", initial);
  setText("topbarUserInitials", initial);
}

/* ------------------------------------------------------------------ *
 * Stat cards — derived from payments + loans in integer minor units
 * ------------------------------------------------------------------ */

/**
 * Whether a payment row counts as verified (money in the box).
 * @param {Object} row
 * @return {boolean}
 */
function isVerifiedPayment(row) {
  return ["approved", "completed"].includes(String(row.approvalStatus));
}

/**
 * Whether a loan status is active (money out, being repaid).
 * @param {string} status
 * @return {boolean}
 */
function isActiveLoan(status) {
  return status === "approved" || status === "disbursed";
}

/**
 * Compute and render the four stat cards from the loaded lists.
 */
function renderDashboardStats() {
  // Total collections + total arrears are server-computed over the same rows
  // (payments.list's `summary` field) — never re-summed client-side.
  const summary = groupData.summary || {};

  // Active loans count.
  const activeLoansCount = groupData.loans.filter((l) =>
    isActiveLoan(l.status),
  ).length;

  // Pending approvals = pending payments + pending loans.
  const pendingPayments = groupData.payments.filter(
    (p) => String(p.approvalStatus) === "pending",
  ).length;
  const pendingLoans = groupData.loans.filter(
    (l) => String(l.status) === "pending",
  ).length;

  setText(
    "totalCollections",
    formatCurrency(summary.verifiedCollected != null ? summary.verifiedCollected : "0.00"),
  );
  setText("activeLoans", String(activeLoansCount));
  setText("pendingApprovals", String(pendingPayments + pendingLoans));
  // Arrears = the GROUP-WIDE obligation arrears + penalties (from
  // payments.groupArrears — counts unpaid obligations with no payment row too),
  // falling back to the recorded-row summary only if that endpoint failed.
  const arrearsValue =
    groupData.groupArrears && groupData.groupArrears.totalArrears != null
      ? groupData.groupArrears.totalArrears
      : summary.totalArrears != null
        ? summary.totalArrears
        : "0.00";
  setText("totalArrears", formatCurrency(arrearsValue));
}

/* ------------------------------------------------------------------ *
 * Collection-trends pie charts (numeric-only; safe innerHTML)
 * ------------------------------------------------------------------ */

/**
 * Render the analytics pie charts from the loaded payments/loans. Every value
 * fed in is a computed number and every label is a hard-coded literal — there is
 * no server-authored string in the generated SVG markup.
 */
function renderCollectionTrends() {
  const chartContainer =
    document.getElementById("chartContainer") ||
    document.querySelector(".chart-container");
  if (!chartContainer) return;

  let seedMinor = 0;
  let monthlyMinor = 0;
  let approvedMinor = 0;
  let interestMinor = 0;
  const monthlyCollections = {};
  MONTHS.forEach((m) => (monthlyCollections[m] = 0));

  const payingMembers = new Set();
  for (const p of groupData.payments) {
    const paidMinor = toMinor(p.amountPaid);
    const verified = isVerifiedPayment(p);
    if (String(p.paymentType) === "seed_money") seedMinor += paidMinor;
    if (String(p.paymentType) === "monthly_contribution") monthlyMinor += paidMinor;
    if (verified) {
      approvedMinor += paidMinor;
      if (p.month && monthlyCollections[p.month] !== undefined) {
        monthlyCollections[p.month] += paidMinor;
      }
    }
    if (paidMinor > 0) payingMembers.add(String(p.uid));
  }

  // Interest actually collected = interest on completed loans only.
  // NOT substituted with loans.list's `summary.totalInterest`: that field sums
  // totalInterest across EVERY loan row regardless of status (pending, approved,
  // disbursed, defaulted, completed), while "collected" here is deliberately
  // scoped to completed loans only. The scopes are genuinely different, so the
  // server summary cannot replace this loop without changing what the number means.
  for (const l of groupData.loans) {
    if (String(l.status) === "completed") interestMinor += toMinor(l.totalInterest);
  }

  const totalMembers = groupData.members.length;
  const membersWithPayments = payingMembers.size;
  const arrearsMinor = groupData.payments.reduce((acc, p) => {
    let v = toMinor(p.arrears);
    if (p.penalty) v += toMinor(p.penalty.amountAccrued);
    return acc + v;
  }, 0);

  let chartHTML = "";

  const typeTotal = seedMinor + monthlyMinor;
  if (typeTotal > 0) {
    chartHTML += createPieChart(
      "Payment Type Breakdown",
      [
        { label: "Seed Money", value: seedMinor, color: "var(--bn-success)" },
        {
          label: "Monthly Contributions",
          value: monthlyMinor,
          color: "var(--bn-info)",
        },
      ],
      typeTotal,
      "Total Collections",
    );
  }

  const financialTotal = approvedMinor + arrearsMinor;
  if (financialTotal > 0) {
    chartHTML += createPieChart(
      "Collections vs Arrears",
      [
        { label: "Collections", value: approvedMinor, color: "var(--bn-success)" },
        { label: "Arrears", value: arrearsMinor, color: "var(--bn-danger)" },
      ],
      financialTotal,
      "Financial Health",
    );
  }

  // Member Participation only earns its place in the "Collection Trends"
  // section when there's actual financial activity to contextualise it — a
  // brand-new group with zero payments/loans has zero "participation" to speak
  // of yet, and a lone 100%-inactive pie next to nothing else reads as broken
  // rather than informative. Gate it on financial activity (not member count,
  // which is always > 0 for any real group) so the whole section shares one
  // intentional empty state until the group has actually started collecting.
  const financialActivity = typeTotal + financialTotal + interestMinor;
  if (totalMembers > 0 && financialActivity > 0) {
    chartHTML += createPieChart(
      "Member Participation",
      [
        {
          label: "Active Members",
          value: membersWithPayments,
          color: "var(--bn-success)",
        },
        {
          label: "Inactive Members",
          value: totalMembers - membersWithPayments,
          color: "var(--bn-gray-400)",
        },
      ],
      totalMembers,
      "Participation",
      true,
    );
  }

  const incomeTotal = typeTotal + interestMinor;
  if (incomeTotal > 0 && interestMinor > 0) {
    chartHTML += createPieChart(
      "Income Sources",
      [
        { label: "Contributions", value: typeTotal, color: "var(--bn-info)" },
        { label: "Loan Interest", value: interestMinor, color: "var(--bn-accent)" },
      ],
      incomeTotal,
      "Total Income",
    );
  }

  if (chartHTML) {
    chartContainer.innerHTML = chartHTML;
    setTimeout(() => {
      chartContainer.querySelectorAll(".pie-chart-svg").forEach((svg, index) => {
        setTimeout(() => {
          svg.style.opacity = "1";
          svg.querySelectorAll(".pie-chart-segment").forEach((segment, i) => {
            setTimeout(() => (segment.style.opacity = "1"), i * 200);
          });
        }, index * 300);
      });
    }, 100);
  } else {
    const empty = buildEmptyState(
      "\u{1F4CA}",
      "No collection data for current cycle yet",
    );
    empty.style.gridColumn = "1 / -1";
    chartContainer.replaceChildren(empty);
  }
}

/**
 * Build one SVG pie chart. Values are minor-unit integers; isCount charts show
 * raw counts. Contains no server-authored strings — safe as innerHTML.
 * @param {string} title
 * @param {Array<Object>} segments {label, value(minor or count), color}
 * @param {number} total
 * @param {string} centerLabel
 * @param {boolean} [isCount]
 * @return {string}
 */
function createPieChart(title, segments, total, centerLabel, isCount = false) {
  const centerX = 120;
  const centerY = 120;
  const radius = 80;
  const strokeWidth = 32;
  const circumference = 2 * Math.PI * radius;

  let segmentsHTML = "";
  let legendHTML = "";
  let cumulativeLength = 0;

  const valid = segments
    .filter((s) => (s.value || 0) > 0)
    .map((s) => ({ ...s, percentage: total > 0 ? (s.value / total) * 100 : 0 }));

  // Background track ring so the donut hole and unfilled arc read clearly
  // even before/without segments animating in.
  segmentsHTML +=
    `<circle class="pie-chart-track" cx="${centerX}" cy="${centerY}" r="${radius}" ` +
    `fill="none" stroke="var(--bn-gray-100)" stroke-width="${strokeWidth}" />`;

  valid.forEach((segment) => {
    const percentage = Math.min(segment.percentage || 0, 100);
    if (percentage <= 0) return;

    const arcLength = (percentage / 100) * circumference;
    const dashArray = `${arcLength} ${circumference - arcLength}`;
    const dashOffset = -cumulativeLength;
    cumulativeLength += arcLength;

    segmentsHTML +=
      `<circle class="pie-chart-segment" cx="${centerX}" cy="${centerY}" r="${radius}" ` +
      `fill="none" stroke="${segment.color}" stroke-width="${strokeWidth}" ` +
      `stroke-dasharray="${dashArray}" stroke-dashoffset="${dashOffset}" ` +
      `stroke-linecap="butt" data-percentage="${percentage.toFixed(1)}" ` +
      `style="opacity: 0; transition: opacity 0.8s ease;" />`;

    const displayValue = isCount
      ? String(Math.round(segment.value))
      : formatCurrencyFromMinor(segment.value != null ? segment.value : 0);
    legendHTML +=
      `<div class="legend-item">` +
      `<span class="legend-dot" style="background: ${segment.color};"></span>` +
      `<div style="flex: 1; display: flex; justify-content: space-between; align-items: center;">` +
      `<span style="font-size: var(--bn-text-sm); color: var(--bn-gray-700);">${escapeStatic(segment.label)}:</span>` +
      `<span style="font-weight: 600; color: var(--bn-dark); margin-left: var(--bn-space-2);">${displayValue}</span>` +
      `</div></div>`;
  });

  const mainPercentage = valid[0]?.percentage || 0;
  const centerDisplay = isCount
    ? `${Math.round(valid[0]?.value || 0)} / ${Math.round(total)}`
    : `${mainPercentage.toFixed(0)}%`;
  const centerSubDisplay = isCount
    ? `${total > 0 ? Math.round(((valid[0]?.value || 0) / total) * 100) : 0}%`
    : formatCurrencyShortFromMinor(total);

  return (
    `<div class="pie-chart-container">` +
    `<div class="pie-chart-title">${escapeStatic(title)}</div>` +
    `<div class="pie-chart-wrapper">` +
    `<svg class="pie-chart-svg" viewBox="0 0 240 240" style="opacity: 0; transition: opacity 0.5s ease; width: 100%; height: 100%;">` +
    `<g transform="rotate(-90 ${centerX} ${centerY})">${segmentsHTML}</g>` +
    `</svg>` +
    `<div class="pie-chart-center">` +
    `<div class="pie-chart-center-value">${centerDisplay}</div>` +
    `<div class="pie-chart-center-label">${escapeStatic(centerLabel)}</div>` +
    `<div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-1);">${centerSubDisplay}</div>` +
    `</div></div>` +
    `<div class="pie-chart-legend">${legendHTML}</div>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------ *
 * Groups list + group selection overlay
 * ------------------------------------------------------------------ */

/**
 * Switch the selected group and reload the dashboard.
 * @param {string} groupId
 */
async function switchGroup(groupId) {
  if (getSelectedGroupId() === groupId) return;
  const next = adminGroups.find((g) => g.groupId === groupId);
  if (!next) return;

  currentGroup = next;
  saveSelectedGroupId(groupId);
  updateURLWithGroup(groupId);
  updateTopbarGroupName();
  showSpinner(true);
  await loadDashboardAfterGroupSelection();
  showSpinner(false);
  showToast(`Switched to ${next.groupName || "group"}`, "success");
}
window.switchGroup = switchGroup;

/**
 * Show the group-selection overlay (built from nodes).
 */
function showGroupSelectionOverlay() {
  const overlay = document.getElementById("groupSelectionOverlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");
  renderGroupSelectionCards();
}

/**
 * Hide the group-selection overlay.
 */
function hideGroupSelectionOverlay() {
  const overlay = document.getElementById("groupSelectionOverlay");
  if (overlay) overlay.classList.add("hidden");
}

/**
 * Render the overlay's group cards.
 */
function renderGroupSelectionCards() {
  const list = document.getElementById("groupSelectionList");
  if (!list) return;
  list.replaceChildren();

  if (adminGroups.length === 0) {
    list.appendChild(
      buildEmptyState("\u{1F4C1}", "You don't manage any groups yet"),
    );
    return;
  }

  for (const group of adminGroups) {
    list.appendChild(buildGroupSelectionCard(group));
  }
}

/**
 * One card in the group-selection overlay.
 * @param {Object} group
 * @return {HTMLElement}
 */
function buildGroupSelectionCard(group) {
  const stats = group.statistics || {};

  const card = document.createElement("div");
  card.className = "group-selection-card";
  card.addEventListener("click", () => selectGroup(group.groupId));

  const icon = document.createElement("div");
  icon.className = "group-selection-icon";
  icon.textContent = group.groupName
    ? group.groupName.charAt(0).toUpperCase()
    : "G";

  const info = document.createElement("div");
  info.className = "group-selection-info";
  const name = document.createElement("div");
  name.className = "group-selection-name";
  name.textContent = group.groupName || "Unnamed Group";
  const meta = document.createElement("div");
  meta.className = "group-selection-meta";
  const membersSpan = document.createElement("span");
  membersSpan.textContent = `${stats.totalMembers || 0} members`;
  const cycleSpan = document.createElement("span");
  cycleSpan.textContent = `${group.cycleLength || 11} month cycle`;
  meta.appendChild(membersSpan);
  meta.appendChild(cycleSpan);
  info.appendChild(name);
  info.appendChild(meta);

  card.appendChild(icon);
  card.appendChild(info);
  return card;
}

/**
 * Choose a group from the overlay, then load it.
 * @param {string} groupId
 */
async function selectGroup(groupId) {
  const next = adminGroups.find((g) => g.groupId === groupId);
  if (!next) return;
  currentGroup = next;
  saveSelectedGroupId(groupId);
  hideGroupSelectionOverlay();
  updateURLWithGroup(groupId);
  updateTopbarGroupName();
  updateMobileNavUserView();
  showSpinner(true);
  await loadDashboardAfterGroupSelection();
  showSpinner(false);
}
window.selectGroup = selectGroup;

/* ------------------------------------------------------------------ *
 * Pending approvals list
 * ------------------------------------------------------------------ */

/**
 * Render up to 5 pending approvals (loans + payments) into the sidebar list.
 */
function loadPendingApprovals() {
  const list = document.getElementById("pendingApprovalsList");
  if (!list) return;
  list.replaceChildren();

  const pending = collectPendingItems();

  if (!pending.length) {
    list.appendChild(buildEmptyState("✅", "No pending approvals"));
    return;
  }

  for (const item of pending.slice(0, 5)) {
    list.appendChild(buildApprovalRow(item));
  }
}

/**
 * Gather pending loans and payments into a common shape.
 * @return {Array<Object>}
 */
function collectPendingItems() {
  const items = [];
  const groupName = (currentGroup && currentGroup.groupName) || "";

  for (const loan of groupData.loans) {
    if (String(loan.status) !== "pending") continue;
    items.push({
      id: loan.loanId,
      type: "loan",
      name: loan.borrowerName || "Member",
      amountStr: String(loan.principalAmount || "0.00"),
      groupName,
    });
  }

  for (const p of groupData.payments) {
    if (String(p.approvalStatus) !== "pending") continue;
    items.push({
      id: p.paymentId,
      type: "payment",
      name: memberNameById.get(String(p.uid)) || "Member",
      amountStr: String(p.amountPaid || "0.00"),
      groupName,
    });
  }
  return items;
}

/**
 * One approval row. "Approve"/"Reject" navigate to the dedicated management page
 * for the money-write flow — this read port does not move money inline.
 * @param {Object} item
 * @return {HTMLElement}
 */
function buildApprovalRow(item) {
  const row = document.createElement("div");
  row.className = "approval-item";

  const avatar = document.createElement("div");
  avatar.className = "approval-avatar";
  avatar.textContent = (item.name || "M").charAt(0);

  const info = document.createElement("div");
  info.className = "approval-info";
  const name = document.createElement("div");
  name.className = "approval-name";
  name.textContent =
    item.type === "loan" ? `Loan - ${item.name}` : `Payment - ${item.name}`;
  const detail = document.createElement("div");
  detail.className = "approval-detail";
  detail.textContent = item.groupName;
  info.appendChild(name);
  info.appendChild(detail);

  const amountWrap = document.createElement("div");
  const amount = document.createElement("div");
  amount.className = "approval-amount";
  amount.textContent = formatCurrencyShort(item.amountStr);
  const typeLabel = document.createElement("div");
  typeLabel.className = "approval-type";
  typeLabel.textContent = item.type;
  amountWrap.appendChild(amount);
  amountWrap.appendChild(typeLabel);

  const actions = document.createElement("div");
  actions.className = "approval-actions";
  const approveBtn = document.createElement("button");
  approveBtn.className = "approval-btn approval-btn-approve";
  approveBtn.title = "Review & approve";
  approveBtn.textContent = "✓";
  approveBtn.addEventListener("click", () => gotoApproval(item));
  const rejectBtn = document.createElement("button");
  rejectBtn.className = "approval-btn approval-btn-reject";
  rejectBtn.title = "Review & reject";
  rejectBtn.textContent = "✕";
  rejectBtn.addEventListener("click", () => gotoApproval(item));
  actions.appendChild(approveBtn);
  actions.appendChild(rejectBtn);

  row.appendChild(avatar);
  row.appendChild(info);
  row.appendChild(amountWrap);
  row.appendChild(actions);
  return row;
}

/**
 * Navigate to the management page where an item is approved/rejected.
 * @param {Object} item
 */
function gotoApproval(item) {
  const groupId = currentGroup ? currentGroup.groupId : "";
  if (!groupId) return;
  window.location.href =
    item.type === "loan"
      ? `manage_loans.html?groupId=${encodeURIComponent(groupId)}`
      : `manage_payments.html?groupId=${encodeURIComponent(groupId)}&tab=pending`;
}

/* ------------------------------------------------------------------ *
 * Due payments this month
 * ------------------------------------------------------------------ */

/**
 * Render this month's still-owed monthly contributions as cards.
 */
function loadDuePayments() {
  const container = document.getElementById("duePaymentsCards");
  if (!container) return;
  container.replaceChildren();

  const now = new Date();
  const currentMonthName = MONTHS[now.getMonth()];
  const currentYear = now.getFullYear();

  const due = [];
  for (const p of groupData.payments) {
    if (String(p.paymentType) !== "monthly_contribution") continue;
    if (String(p.month) !== currentMonthName) continue;
    if (parseInt(p.year, 10) !== currentYear) continue;

    const arrearsMinor = toMinor(p.arrears);
    const totalMinor = toMinor(p.totalAmount);
    const paidMinor = toMinor(p.amountPaid);
    if (totalMinor <= 0) continue;
    if (arrearsMinor <= 0 && paidMinor >= totalMinor) continue;

    const dueDate = parseServerDate(p.dueDate);
    const daysUntilDue = dueDate
      ? Math.ceil((dueDate - now) / 86400000)
      : 0;
    const isOverdue = dueDate ? now > dueDate && arrearsMinor > 0 : arrearsMinor > 0;

    due.push({
      memberId: String(p.uid),
      memberName: memberNameById.get(String(p.uid)) || "Unknown Member",
      amountStr:
        arrearsMinor > 0 ? String(p.arrears) : fromMinor(totalMinor - paidMinor),
      dueDate,
      daysUntilDue,
      isOverdue,
    });
  }

  due.sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    return a.daysUntilDue - b.daysUntilDue;
  });

  if (!due.length) {
    const empty = buildEmptyState("✅", "No payments due this month");
    empty.style.gridColumn = "1 / -1";
    container.appendChild(empty);
    return;
  }

  const groupId = currentGroup ? currentGroup.groupId : "";
  for (const payment of due.slice(0, 6)) {
    container.appendChild(buildDuePaymentCard(payment, groupId));
  }

  if (due.length > 6) {
    container.appendChild(buildMoreDueCard(due.length - 6, groupId));
  }
}

/**
 * One due-payment card.
 * @param {Object} payment
 * @param {string} groupId
 * @return {HTMLElement}
 */
function buildDuePaymentCard(payment, groupId) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "due-payment-card" + (payment.isOverdue ? " overdue" : "");
  card.title = `View ${payment.memberName}'s payments`;
  card.addEventListener("click", () => {
    window.location.href = `manage_payments.html?groupId=${encodeURIComponent(groupId)}&memberId=${encodeURIComponent(payment.memberId)}&tab=arrears`;
  });

  const header = document.createElement("div");
  header.className = "due-payment-card-header";
  const avatar = document.createElement("div");
  avatar.className = "due-payment-avatar";
  avatar.textContent = payment.memberName.charAt(0).toUpperCase();
  const name = document.createElement("div");
  name.className = "due-payment-name";
  name.textContent = payment.memberName;
  header.appendChild(avatar);
  header.appendChild(name);

  const amount = document.createElement("div");
  amount.className = "due-payment-amount";
  amount.textContent = formatCurrency(payment.amountStr != null ? payment.amountStr : "0.00");

  const type = document.createElement("div");
  type.className = "due-payment-type";
  type.textContent = "Monthly Contribution";

  const date = document.createElement("div");
  date.className = "due-payment-date";
  date.textContent = payment.isOverdue
    ? `⚠️ Overdue (${Math.abs(payment.daysUntilDue)} days)`
    : payment.dueDate
      ? `Due: ${formatDateShort(payment.dueDate)}`
      : "Due this month";

  card.appendChild(header);
  card.appendChild(amount);
  card.appendChild(type);
  card.appendChild(date);
  return card;
}

/**
 * The "+N more" due-payments card.
 * @param {number} more
 * @param {string} groupId
 * @return {HTMLElement}
 */
function buildMoreDueCard(more, groupId) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "due-payment-card";
  card.style.cssText =
    "border-left-color: var(--bn-gray-lighter); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-direction: column;";
  card.addEventListener("click", () => {
    window.location.href = `manage_payments.html?groupId=${encodeURIComponent(groupId)}&tab=arrears`;
  });

  const count = document.createElement("div");
  count.style.cssText =
    "font-size: var(--bn-text-2xl); margin-bottom: var(--bn-space-2);";
  count.textContent = `+${more}`;
  const label = document.createElement("div");
  label.style.cssText =
    "font-size: var(--bn-text-xs); color: var(--bn-gray); text-align: center;";
  label.textContent = "More payments";
  card.appendChild(count);
  card.appendChild(label);
  return card;
}

/* ------------------------------------------------------------------ *
 * Stat detail modals (arrears / loans / pending / collections)
 * ------------------------------------------------------------------ */

/**
 * Open a stat detail modal for a card.
 * @param {string} type "arrears" | "loans" | "pending" | "collections"
 */
function openStatModal(type) {
  if (!currentGroup || !currentGroup.groupId) {
    showToast("Please select a group first", "warning");
    return;
  }
  const overlay = document.getElementById("statModalOverlay");
  const titleEl = document.getElementById("statModalTitleText");
  const iconEl = document.getElementById("statModalIcon");
  const body = document.getElementById("statModalBody");
  if (!overlay || !titleEl || !iconEl || !body) return;

  const config = {
    arrears: { title: "Arrears Details", icon: "⚠️" },
    loans: { title: "Active Loans", icon: "\u{1F4B0}" },
    pending: { title: "Pending Approvals", icon: "⏳" },
    collections: { title: "Collections Overview", icon: "\u{1F4B5}" },
  }[type] || { title: "Details", icon: "\u{1F4CA}" };

  titleEl.textContent = config.title;
  iconEl.textContent = config.icon;

  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  let items = [];
  if (type === "arrears") items = buildArrearsItems();
  else if (type === "loans") items = buildActiveLoanItems();
  else if (type === "pending") items = buildPendingItems();
  else if (type === "collections") items = buildCollectionsItems();

  renderStatModalItems(items, type, body);
}
window.openStatModal = openStatModal;

/**
 * Close the stat modal.
 */
function closeStatModal() {
  const overlay = document.getElementById("statModalOverlay");
  if (overlay) {
    overlay.classList.remove("open");
    document.body.style.overflow = "";
  }
}
window.closeStatModal = closeStatModal;

/**
 * Close the stat modal when the overlay backdrop is clicked.
 * @param {Event} event
 */
window.closeStatModalOnOverlay = function closeStatModalOnOverlay(event) {
  if (event.target && event.target.id === "statModalOverlay") closeStatModal();
};

/**
 * Per-member arrears breakdown, highest first.
 * @return {Array<Object>}
 */
function buildArrearsItems() {
  const byMember = new Map();
  for (const p of groupData.payments) {
    let owedMinor = toMinor(p.arrears);
    if (p.penalty) owedMinor += toMinor(p.penalty.amountAccrued);
    if (owedMinor <= 0) continue;

    const uid = String(p.uid);
    if (!byMember.has(uid)) {
      byMember.set(uid, {
        id: uid,
        name: memberNameById.get(uid) || "Unknown Member",
        totalMinor: 0,
        breakdown: [],
      });
    }
    const entry = byMember.get(uid);
    entry.totalMinor += owedMinor;
    entry.breakdown.push({
      type:
        String(p.paymentType) === "monthly_contribution"
          ? `Monthly - ${p.month || "Unknown"}`
          : paymentTypeLabel(p.paymentType),
      amountStr: fromMinor(owedMinor),
    });
  }
  return Array.from(byMember.values()).sort((a, b) => b.totalMinor - a.totalMinor);
}

/**
 * Active loans as modal items.
 * @return {Array<Object>}
 */
function buildActiveLoanItems() {
  return groupData.loans
    .filter((l) => isActiveLoan(l.status))
    .map((l) => ({
      id: l.loanId,
      name: l.borrowerName || "Unknown Borrower",
      amountStr: String(l.approvedAmount || l.principalAmount || "0.00"),
      detail: l.purpose || "",
    }));
}

/**
 * Pending loans + payments as modal items.
 * @return {Array<Object>}
 */
function buildPendingItems() {
  const items = [];
  for (const l of groupData.loans) {
    if (String(l.status) !== "pending") continue;
    items.push({
      id: l.loanId,
      name: l.borrowerName || "Unknown Borrower",
      amountStr: String(l.principalAmount || "0.00"),
      detail: l.purpose || "",
      kind: "loan",
    });
  }
  for (const p of groupData.payments) {
    if (String(p.approvalStatus) !== "pending") continue;
    items.push({
      id: p.paymentId,
      name: memberNameById.get(String(p.uid)) || "Unknown Member",
      amountStr: String(p.amountPaid || "0.00"),
      detail: paymentTypeLabel(p.paymentType),
      kind: "payment",
    });
  }
  return items;
}

/**
 * Per-member verified collections, highest first.
 * @return {Array<Object>}
 */
function buildCollectionsItems() {
  const byMember = new Map();
  for (const p of groupData.payments) {
    if (!isVerifiedPayment(p)) continue;
    const paidMinor = toMinor(p.amountPaid);
    if (paidMinor <= 0) continue;
    const uid = String(p.uid);
    if (!byMember.has(uid)) {
      byMember.set(uid, {
        id: uid,
        name: memberNameById.get(uid) || "Unknown Member",
        totalMinor: 0,
      });
    }
    byMember.get(uid).totalMinor += paidMinor;
  }
  return Array.from(byMember.values())
    .map((e) => ({ ...e, amountStr: fromMinor(e.totalMinor) }))
    .sort((a, b) => b.totalMinor - a.totalMinor);
}

/**
 * Render the stat modal item list (all nodes; no innerHTML with server data).
 * @param {Array<Object>} items
 * @param {string} type
 * @param {HTMLElement} body
 */
function renderStatModalItems(items, type, body) {
  body.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "stat-modal-empty";
    const icon = document.createElement("div");
    icon.className = "stat-modal-empty-icon";
    icon.textContent = "✅";
    const text = document.createElement("p");
    text.className = "stat-modal-empty-text";
    text.textContent = "No items found";
    empty.appendChild(icon);
    empty.appendChild(text);
    body.appendChild(empty);
    return;
  }

  const listWrap = document.createElement("div");
  listWrap.className = "stat-modal-list";
  for (const item of items) {
    listWrap.appendChild(buildStatModalItem(item, type));
  }
  body.appendChild(listWrap);
}

/**
 * One stat-modal row.
 * @param {Object} item
 * @param {string} type
 * @return {HTMLElement}
 */
function buildStatModalItem(item, type) {
  const row = document.createElement("div");
  row.className = "stat-modal-item";

  const avatar = document.createElement("div");
  avatar.className = "stat-modal-item-avatar";
  avatar.textContent = item.name ? item.name.charAt(0).toUpperCase() : "?";

  const info = document.createElement("div");
  info.className = "stat-modal-item-info";
  const name = document.createElement("div");
  name.className = "stat-modal-item-name";
  name.textContent = item.name;
  const detail = document.createElement("div");
  detail.className = "stat-modal-item-detail";
  detail.textContent = item.detail || "";
  if (Array.isArray(item.breakdown) && item.breakdown.length) {
    const small = document.createElement("small");
    small.style.cssText =
      "color: var(--bn-gray); font-size: 0.75rem; display: block;";
    small.textContent = item.breakdown
      .map((b) => `${b.type}: ${formatCurrency(b.amountStr != null ? b.amountStr : "0.00")}`)
      .join(", ");
    detail.appendChild(small);
  }
  info.appendChild(name);
  info.appendChild(detail);

  const amount = document.createElement("div");
  amount.className = "stat-modal-item-amount";
  amount.textContent = formatCurrency(item.amountStr != null ? item.amountStr : "0.00");

  const actions = document.createElement("div");
  actions.className = "stat-modal-item-actions";
  appendStatModalActions(actions, item, type);

  row.appendChild(avatar);
  row.appendChild(info);
  row.appendChild(amount);
  row.appendChild(actions);
  return row;
}

/**
 * Attach the modal action buttons for a row; all navigate to a management page.
 * @param {HTMLElement} actions
 * @param {Object} item
 * @param {string} type
 */
function appendStatModalActions(actions, item, type) {
  const groupId = currentGroup ? currentGroup.groupId : "";

  const makeBtn = (label, primary, href) => {
    const btn = document.createElement("button");
    btn.className =
      "stat-modal-action-btn " +
      (primary
        ? "stat-modal-action-btn-primary"
        : "stat-modal-action-btn-secondary");
    const span = document.createElement("span");
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener("click", () => (window.location.href = href));
    return btn;
  };

  if (type === "arrears") {
    actions.appendChild(
      makeBtn(
        "View",
        true,
        `manage_payments.html?groupId=${encodeURIComponent(groupId)}&memberId=${encodeURIComponent(item.id)}&tab=arrears`,
      ),
    );
  } else if (type === "loans") {
    actions.appendChild(
      makeBtn(
        "Manage",
        true,
        `manage_loans.html?groupId=${encodeURIComponent(groupId)}&loanId=${encodeURIComponent(item.id)}`,
      ),
    );
  } else if (type === "pending") {
    const href =
      item.kind === "loan"
        ? `manage_loans.html?groupId=${encodeURIComponent(groupId)}`
        : `manage_payments.html?groupId=${encodeURIComponent(groupId)}&tab=pending`;
    actions.appendChild(makeBtn("Review", true, href));
  } else if (type === "collections") {
    actions.appendChild(
      makeBtn(
        "History",
        true,
        `manage_payments.html?groupId=${encodeURIComponent(groupId)}&memberId=${encodeURIComponent(item.id)}&tab=collected`,
      ),
    );
  }
}

/**
 * Navigate straight to the management page for a stat type (card click).
 * @param {string} type
 */
window.navigateToStatPage = function navigateToStatPage(type) {
  if (!currentGroup || !currentGroup.groupId) {
    showToast("Please select a group first", "warning");
    return;
  }
  const groupId = currentGroup.groupId;
  const pageMap = {
    arrears: `manage_payments.html?groupId=${encodeURIComponent(groupId)}&tab=arrears`,
    collections: `manage_payments.html?groupId=${encodeURIComponent(groupId)}&tab=collected`,
    pending: `manage_payments.html?groupId=${encodeURIComponent(groupId)}&tab=pending`,
    loans: `manage_loans.html?groupId=${encodeURIComponent(groupId)}`,
  };
  const url = pageMap[type];
  if (url) window.location.href = url;
  else openStatModal(type);
};

/* ------------------------------------------------------------------ *
 * Event wiring, nav, logout
 * ------------------------------------------------------------------ */

/**
 * Wire the static buttons/menus that exist independent of loaded data.
 */
function setupEventListeners() {
  document
    .getElementById("logoutBtnSidebar")
    ?.addEventListener("click", handleLogout);
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);

  // The "Switch to User View" affordances are plain <a href="user_dashboard.html">
  // links injected by nav_sql.js (no id assigned there) — target them by the
  // href they're built with rather than an id that doesn't exist in the DOM.
  document
    .querySelector('a.sidebar-nav-item[href="user_dashboard.html"]')
    ?.addEventListener("click", () => {
      window.location.href = "user_dashboard.html";
    });
  document
    .querySelector('a.mobile-nav-item[href="user_dashboard.html"]')
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "user_dashboard.html";
    });

  const sidebarUser = document.getElementById("sidebarUser");
  if (sidebarUser) {
    sidebarUser.addEventListener("click", (e) => {
      if (e.target.closest("a") || e.target.closest("button")) return;
      e.stopPropagation();
    });
  }
  const statOverlay = document.getElementById("statModalOverlay");
  statOverlay?.addEventListener("click", (e) => {
    if (e.target === statOverlay) closeStatModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeStatModal();
  });
}

/**
 * Show/hide the "Switch to User View" affordance based on admin membership.
 */
function updateMobileNavUserView() {
  const el = document.querySelector('a.mobile-nav-item[href="user_dashboard.html"]');
  if (el) el.style.display = adminGroups.length > 0 ? "flex" : "none";
}

/**
 * Update the URL's groupId query param without a navigation.
 * @param {string} groupId
 */
function updateURLWithGroup(groupId) {
  if (!groupId) return;
  const url = new URL(window.location.href);
  url.searchParams.set("groupId", groupId);
  window.history.replaceState({}, "", url);
}

/**
 * Update the topbar title with the current group's name (built from nodes).
 */
function updateTopbarGroupName() {
  const topbarTitle = document.querySelector(".topbar-title");
  if (!topbarTitle || !currentGroup) return;
  topbarTitle.replaceChildren();

  const name = document.createElement("span");
  name.style.cssText =
    "font-size: 14px; font-weight: 600; color: var(--bn-dark); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;";
  name.textContent = currentGroup.groupName || "Dashboard";

  const sub = document.createElement("span");
  sub.style.cssText =
    "font-size: 11px; color: var(--bn-gray); font-weight: 400; display: block; margin-top: 1px;";
  sub.textContent = "Admin Dashboard";

  topbarTitle.appendChild(name);
  topbarTitle.appendChild(sub);
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
 * Human label for a payment type.
 * @param {string} type
 * @return {string}
 */
function paymentTypeLabel(type) {
  return (
    {
      seed_money: "Seed Money",
      monthly_contribution: "Monthly Contribution",
      service_fee: "Service Fee",
    }[String(type)] || String(type)
  );
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
 * Escape a hard-coded literal before it enters innerHTML (defence in depth; these
 * are never server data, but the escaping keeps the pie-chart builder honest).
 * @param {string} s
 * @return {string}
 */
function escapeStatic(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Show a toast, matching the shared pattern (never alert()).
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

/**
 * Toggle the full-page spinner.
 * @param {boolean} show
 */
function showSpinner(show) {
  const spinner = document.getElementById("spinner");
  if (!spinner) return;
  if (show) spinner.classList.remove("hidden");
  else spinner.classList.add("hidden");
}

/**
 * Update the current-date display.
 */
function updateCurrentDate() {
  const el = document.getElementById("currentDate");
  if (!el) return;
  el.textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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
 * Shortened currency ("MWK 1.2M" / "MWK 12.3K") from a 2dp money string.
 * @param {*} value 2dp string.
 * @return {string}
 */
function formatCurrencyShort(value) {
  return formatCurrencyShortFromMinor(toMinor(value));
}

/**
 * Shortened currency from integer minor units.
 * @param {number} cents
 * @return {string}
 */
function formatCurrencyShortFromMinor(cents) {
  const neg = cents < 0;
  const whole = Math.abs(cents) / 100;
  let out;
  if (whole >= 1000000) out = `${(whole / 1000000).toFixed(1)}M`;
  else if (whole >= 1000) out = `${(whole / 1000).toFixed(1)}K`;
  else out = Math.round(whole).toLocaleString("en-US");
  return `MWK ${neg ? "-" : ""}${out}`;
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
 * "Jul 15" style short date.
 * @param {Date} date
 * @return {string}
 */
function formatDateShort(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
