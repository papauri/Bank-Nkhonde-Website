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
import { attachCardInfo, infoContent, closeInfoPanel } from "./card_info.js";

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
  // Server-computed loan money (activePrincipal / activeBalance / issuedPrincipal),
  // so the Active Loans info panel quotes a server total instead of re-adding rows.
  groupData.loansSummary =
    loans && loans.summary && typeof loans.summary === "object" ? loans.summary : {};
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

  // Patch static "View All" links so they carry the current groupId — the
  // HTML has bare <a href="manage_payments.html"> without the param, so the
  // target page can't restore the group selection.
  patchViewAllLinks(groupId);

  updateCurrentDate();
  renderDashboardStats();
  renderCollectionTrends();
  loadPendingApprovals();
  loadDuePayments();
  // Re-scope the Collections tile to the month-filter's current selection
  // (defaults to the current month — see setupEventListeners) now that
  // groupData.payments is populated. Runs after renderDashboardStats so it
  // overrides that function's server-summary (whole-group) figure.
  applyDashboardMonthFilter();
}

/**
 * Rewrite every "View All" <a> on the admin dashboard so it carries the
 * current groupId. The HTML ships with bare hrefs like
 * "manage_payments.html" — without the param, the target page shows a
 * group selector that has just lost state.
 * @param {string} groupId
 */
function patchViewAllLinks(groupId) {
  if (!groupId) return;
  // All <a> elements whose href points to a page that expects ?groupId.
  document.querySelectorAll("a[href^='manage_payments.html'], a[href^='manage_loans.html'], a[href^='approve_registrations.html']").forEach((a) => {
    const href = a.getAttribute("href") || "";
    // Resolve relative to the current page so "manage_loans.html" becomes
    // "/pages/manage_loans.html", not "/manage_loans.html".
    const url = new URL(href, window.location.href);
    url.searchParams.set("groupId", groupId);
    a.setAttribute("href", url.pathname + url.search);
  });
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
  // The info panels read groupData at OPEN time (see STAT_CARD_INFO), so there
  // is nothing to re-render here when the stats change.
}

/**
 * Re-scope the Collections stat tile ONLY to the #dashboardMonthFilter
 * selection ("all" = whole current year, or a single month), re-aggregating
 * groupData.payments client-side — no new fetch, no server call. Every other
 * stat tile (Active Loans, Pending, Arrears) and the Collection Trends chart
 * are left untouched by this function.
 *
 * Uses the SAME verified-row extraction as renderCollectionTrends
 * (isVerifiedPayment + toMinor(p.amountPaid)) so this never introduces a new
 * definition of "collected" or any float arithmetic.
 */
function applyDashboardMonthFilter() {
  const select = document.getElementById("dashboardMonthFilter");
  const scope = select ? select.value : "all";
  const currentYear = new Date().getFullYear();

  let collectedMinor = 0;
  for (const p of groupData.payments) {
    if (Number(p.year) !== currentYear) continue;
    if (scope !== "all" && String(p.month) !== scope) continue;
    if (!isVerifiedPayment(p)) continue;
    collectedMinor += toMinor(p.amountPaid);
  }

  setText("totalCollections", formatCurrency(fromMinor(collectedMinor)));

  const valueEl = document.getElementById("totalCollections");
  const labelEl = valueEl ? valueEl.nextElementSibling : null;
  if (labelEl) {
    labelEl.textContent =
      scope === "all"
        ? `Collections — ${currentYear}`
        : `Collections — ${scope.slice(0, 3)} ${currentYear}`;
  }
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

  // Range filter — client-side only, over already-fetched rows (no new
  // fetch). "all" keeps every row; "6"/"12" keep rows dated within that many
  // months of now, using createdAt (fallback approvedAt for loans).
  const rangeSelect = document.getElementById("collectionTrendsRangeSelect");
  const rangeValue = rangeSelect ? rangeSelect.value : "all";
  let cutoffDate = null;
  if (rangeValue !== "all") {
    const months = parseInt(rangeValue, 10);
    if (Number.isFinite(months)) {
      cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - months);
    }
  }
  const withinRange = (row, field1, field2) => {
    if (!cutoffDate) return true;
    const d = parseServerDate(row[field1] || row[field2]);
    return d ? d >= cutoffDate : true;
  };
  const rangedPayments = groupData.payments.filter((p) =>
    withinRange(p, "createdAt", "paidAt"),
  );
  const rangedLoans = groupData.loans.filter((l) =>
    withinRange(l, "createdAt", "approvedAt"),
  );

  // Monthly buckets for the primary trend + the aggregate totals the
  // secondary breakdown pies use. All integer minor units.
  const monthlyCollected = {};
  const monthlyDisbursed = {};
  MONTHS.forEach((m) => {
    monthlyCollected[m] = 0;
    monthlyDisbursed[m] = 0;
  });

  let seedMinor = 0;
  let monthlyMinor = 0;
  let approvedMinor = 0;
  let interestMinor = 0;
  const payingMembers = new Set();

  for (const p of rangedPayments) {
    const paidMinor = toMinor(p.amountPaid);
    const verified = isVerifiedPayment(p);
    if (String(p.paymentType) === "seed_money") seedMinor += paidMinor;
    if (String(p.paymentType) === "monthly_contribution") monthlyMinor += paidMinor;
    if (verified) {
      approvedMinor += paidMinor;
      if (p.month && monthlyCollected[p.month] !== undefined) {
        monthlyCollected[p.month] += paidMinor;
      }
    }
    if (paidMinor > 0) payingMembers.add(String(p.uid));
  }

  // A loan's principal counts as "disbursed" once money has left the pot —
  // i.e. any status past pending. Bucket it by the month the money moved
  // (disbursedAt), falling back to approvedAt/createdAt when older rows lack it.
  const DISBURSED_STATUSES = new Set([
    "approved",
    "disbursed",
    "completed",
    "defaulted",
  ]);
  for (const l of rangedLoans) {
    // Interest actually collected = interest on completed loans only.
    if (String(l.status) === "completed") interestMinor += toMinor(l.totalInterest);
    if (!DISBURSED_STATUSES.has(String(l.status))) continue;
    const when = parseServerDate(l.disbursedAt || l.approvedAt || l.createdAt);
    if (!when) continue;
    const m = MONTHS[when.getMonth()];
    if (m && monthlyDisbursed[m] !== undefined) {
      monthlyDisbursed[m] += toMinor(l.approvedAmount || l.principalAmount || "0.00");
    }
  }

  const totalMembers = groupData.members.length;
  const membersWithPayments = payingMembers.size;
  const arrearsMinor = rangedPayments.reduce((acc, p) => {
    let v = toMinor(p.arrears);
    if (p.penalty) v += toMinor(penaltyOwed(p.penalty));
    return acc + v;
  }, 0);

  // Only chart months that actually have activity, in calendar order.
  const activeMonths = MONTHS.filter(
    (m) => monthlyCollected[m] > 0 || monthlyDisbursed[m] > 0,
  );

  // Secondary breakdown pies — each skipped when it has no data to show.
  let pieHTML = "";
  const typeTotal = seedMinor + monthlyMinor;
  if (typeTotal > 0) {
    pieHTML += createPieChart(
      "Payment Type Breakdown",
      [
        { label: "Seed Money", value: seedMinor, color: "var(--bn-success)" },
        { label: "Monthly Contributions", value: monthlyMinor, color: "var(--bn-info)" },
      ],
      typeTotal,
      "Total Collections",
    );
  }
  const financialTotal = approvedMinor + arrearsMinor;
  if (financialTotal > 0) {
    pieHTML += createPieChart(
      "Collections vs Arrears",
      [
        { label: "Collections", value: approvedMinor, color: "var(--bn-success)" },
        { label: "Arrears", value: arrearsMinor, color: "var(--bn-danger)" },
      ],
      financialTotal,
      "Financial Health",
    );
  }
  const financialActivity = typeTotal + financialTotal + interestMinor;
  if (totalMembers > 0 && financialActivity > 0) {
    pieHTML += createPieChart(
      "Member Participation",
      [
        { label: "Active Members", value: membersWithPayments, color: "var(--bn-success)" },
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
    pieHTML += createPieChart(
      "Income Sources",
      [
        { label: "Contributions", value: typeTotal, color: "var(--bn-info)" },
        { label: "Loan Interest", value: interestMinor, color: "var(--bn-accent)" },
      ],
      incomeTotal,
      "Total Income",
    );
  }

  // This card holds a full-width monthly trend on top and (optionally) a grid
  // of breakdown pies below, so drop the grid layout the inline style sets.
  chartContainer.style.display = "block";

  if (activeMonths.length === 0 && !pieHTML) {
    chartContainer.replaceChildren(
      buildEmptyState("\u{1F4CA}", "No collection data for the current cycle yet"),
    );
    return;
  }

  chartContainer.replaceChildren();

  if (activeMonths.length > 0) {
    const maxMinor = activeMonths.reduce(
      (max, m) => Math.max(max, monthlyCollected[m], monthlyDisbursed[m]),
      0,
    );
    // Height as a percentage of the tallest bar; give any non-zero value a
    // visible sliver so a small-but-real month doesn't read as empty.
    const heightPct = (v) =>
      maxMinor > 0 ? Math.max((v / maxMinor) * 100, v > 0 ? 3 : 0) : 0;

    const chart = document.createElement("div");
    chart.className = "trend-chart";

    const legend = document.createElement("div");
    legend.className = "trend-legend";
    [
      ["collected", "Contributions Collected"],
      ["disbursed", "Loans Disbursed"],
    ].forEach(([cls, text]) => {
      const item = document.createElement("span");
      item.className = "trend-legend-item";
      const dot = document.createElement("span");
      dot.className = `trend-legend-dot ${cls}`;
      const lbl = document.createElement("span");
      lbl.textContent = text;
      item.append(dot, lbl);
      legend.appendChild(item);
    });
    chart.appendChild(legend);

    // Y-axis: 4 gridlines/ticks at even thirds of maxMinor (100/66/33/0%),
    // read top-to-bottom so the top tick shows the tallest bar's value. All
    // values are integer minor-unit fractions of the already-aggregated
    // maxMinor (no new money math) formatted through the existing short
    // formatter, and placed via textContent only.
    const yAxis = document.createElement("div");
    yAxis.className = "trend-yaxis";
    [3, 2, 1, 0].forEach((k) => {
      const tickVal = Math.round((maxMinor * k) / 3);
      const tick = document.createElement("div");
      tick.className = "trend-yaxis-label";
      tick.textContent = formatCurrencyShortFromMinor(tickVal);
      yAxis.appendChild(tick);
    });

    const gridlines = document.createElement("div");
    gridlines.className = "trend-gridlines";
    // Offsets match .trend-yaxis-label's 0/33.333/66.667/100% exactly so each
    // gridline lands pixel-for-pixel on its tick label.
    [0, 33.333, 66.667, 100].forEach((pct) => {
      const line = document.createElement("div");
      line.className = pct === 0 ? "trend-gridline trend-gridline-base" : "trend-gridline";
      line.style.bottom = `${pct}%`;
      gridlines.appendChild(line);
    });

    const barsRow = document.createElement("div");
    barsRow.className = "trend-bars";
    if (activeMonths.length === 1) barsRow.classList.add("trend-bars-single");
    activeMonths.forEach((m) => {
      const col = document.createElement("div");
      col.className = "trend-month";

      const pair = document.createElement("div");
      pair.className = "trend-month-bars";
      [
        ["collected", monthlyCollected[m], "Collected"],
        ["disbursed", monthlyDisbursed[m], "Disbursed"],
      ].forEach(([cls, val, nice]) => {
        const bar = document.createElement("div");
        bar.className = `trend-bar ${cls}`;
        bar.style.height = `${heightPct(val)}%`;
        bar.title = `${nice} (${m}): ${formatCurrencyShortFromMinor(val)}`;
        pair.appendChild(bar);
      });
      col.appendChild(pair);

      const lbl = document.createElement("div");
      lbl.className = "trend-month-label";
      lbl.textContent = m.slice(0, 3);
      col.appendChild(lbl);

      barsRow.appendChild(col);
    });

    const plotBody = document.createElement("div");
    plotBody.className = "trend-plot-body";
    plotBody.append(gridlines, barsRow);

    const scroller = document.createElement("div");
    scroller.className = "trend-bars-scroll";
    scroller.appendChild(plotBody);

    const plot = document.createElement("div");
    plot.className = "trend-plot";
    plot.append(yAxis, scroller);

    chart.appendChild(plot);
    chartContainer.appendChild(chart);
  }

  if (pieHTML) {
    const heading = document.createElement("div");
    heading.className = "trend-breakdown-heading";
    heading.textContent = "Breakdowns";
    chartContainer.appendChild(heading);

    const pieGrid = document.createElement("div");
    pieGrid.className = "pie-grid";
    // Numeric-only markup — every value is a computed number and every label
    // is a hard-coded literal run through escapeStatic in createPieChart.
    pieGrid.innerHTML = pieHTML;
    chartContainer.appendChild(pieGrid);
  }
}

/**
 * Build one SVG donut chart as a markup string. Values are minor-unit integers
 * (isCount charts show raw counts). Contains no server-authored strings — every
 * label is a hard-coded literal run through escapeStatic — so it is safe as
 * innerHTML. Segments render fully visible (no fade-in).
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
      `stroke-linecap="butt" data-percentage="${percentage.toFixed(1)}" />`;

    const displayValue = isCount
      ? String(Math.round(segment.value))
      : formatCurrencyFromMinor(segment.value != null ? segment.value : 0);
    legendHTML +=
      `<div class="legend-item">` +
      `<span class="legend-dot" style="background: ${segment.color};"></span>` +
      `<div style="flex: 1; display: flex; justify-content: space-between; align-items: center; gap: var(--bn-space-2); min-width: 0;">` +
      `<span style="font-size: var(--bn-text-sm); color: var(--bn-gray-700); overflow-wrap: anywhere;">${escapeStatic(segment.label)}</span>` +
      `<span style="font-weight: 600; color: var(--bn-dark); white-space: nowrap;">${displayValue}</span>` +
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
    `<svg class="pie-chart-svg" viewBox="0 0 240 240" style="width: 100%; height: 100%;">` +
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
 * Render this month's still-owed contributions as cards.
 *
 * Fetches the server-computed per-member arrears breakdown
 * (payments.memberBreakdown?figure=arrears) so every member who owes money is
 * shown — including members who have never uploaded a payment row, which the
 * old payment-row-only scan could never see. The server is the single source
 * of truth for what each member owes.
 */
async function loadDuePayments() {
  const container = document.getElementById("duePaymentsCards");
  if (!container) return;
  container.replaceChildren();

  const groupId = currentGroup ? currentGroup.groupId : "";
  if (!groupId) {
    container.appendChild(buildEmptyState("📅", "Select a group to see due payments"));
    return;
  }

  // Show a loading placeholder while the server call is in flight.
  const loading = buildEmptyState("⏳", "Loading due payments…");
  loading.style.gridColumn = "1 / -1";
  container.appendChild(loading);

  let breakdown;
  try {
    breakdown = await apiGet("payments.memberBreakdown", { groupId, figure: "arrears" });
  } catch (e) {
    handleSessionError(e);
    container.replaceChildren();
    const err = buildEmptyState("⚠️", "Could not load due payments");
    err.style.gridColumn = "1 / -1";
    container.appendChild(err);
    return;
  }

  container.replaceChildren();

  const members = Array.isArray(breakdown && breakdown.members) ? breakdown.members : [];

  // Only members who actually owe something (amount > 0).
  const due = members
    .filter((m) => toMinor(m.amount) > 0)
    .map((m) => ({
      memberId: String(m.uid),
      memberName: m.memberName || "Unknown Member",
      amountStr: String(m.amount),
      breakdown: Array.isArray(m.breakdown) ? m.breakdown : [],
    }));

  // Sort: highest amount first so the biggest problems are at the top.
  due.sort((a, b) => toMinor(b.amountStr) - toMinor(a.amountStr));

  if (!due.length) {
    const empty = buildEmptyState("✅", "No payments due this month");
    empty.style.gridColumn = "1 / -1";
    container.appendChild(empty);
    return;
  }

  for (const payment of due.slice(0, 6)) {
    const card = buildDuePaymentCard(payment);
    container.appendChild(card);
    // Attach an "i" info toggle that opens a bn-info-panel popover using the
    // same shared pattern as the four stat cards — title, description, rows,
    // and actions — so the UX is consistent across the entire dashboard.
    attachDuePaymentCardInfo(card, payment, groupId);
  }

  if (due.length > 6) {
    container.appendChild(buildMoreDueCard(due.length - 6, groupId));
  }
}

/**
 * One due-payment card — clean, compact summary. No inline action buttons.
 * Tapping the "i" toggle opens a bn-info-panel with the full breakdown and
 * the two actions (View Details / Record Payment).
 *
 * @param {Object} payment  { memberId, memberName, amountStr, breakdown }
 * @return {HTMLElement}
 */
function buildDuePaymentCard(payment) {
  const card = document.createElement("div");
  card.className = "due-payment-card";

  // Top row: avatar + name + amount
  const topRow = document.createElement("div");
  topRow.className = "due-payment-top";

  const avatar = document.createElement("div");
  avatar.className = "due-payment-avatar";
  avatar.textContent = payment.memberName.charAt(0).toUpperCase();

  const name = document.createElement("div");
  name.className = "due-payment-name";
  name.textContent = payment.memberName;

  const amount = document.createElement("div");
  amount.className = "due-payment-amount";
  amount.textContent = formatCurrencyShort(payment.amountStr != null ? payment.amountStr : "0.00");

  topRow.appendChild(avatar);
  topRow.appendChild(name);
  topRow.appendChild(amount);

  // Bottom row: one compact summary line — "3 obligations · 2 penalties".
  // Individual pills overflowed the card when a member owed many months.
  const meta = document.createElement("div");
  meta.className = "due-payment-meta";
  if (Array.isArray(payment.breakdown) && payment.breakdown.length) {
    const obligationCount = payment.breakdown.filter((b) => !String(b.label).includes("penalty")).length;
    const penaltyCount = payment.breakdown.filter((b) => String(b.label).includes("penalty")).length;
    const parts = [];
    if (obligationCount > 0) {
      parts.push(`${obligationCount} obligation${obligationCount === 1 ? "" : "s"}`);
    }
    if (penaltyCount > 0) {
      parts.push(`${penaltyCount} penalty${penaltyCount === 1 ? "" : "ies"}`);
    }
    meta.textContent = parts.length ? parts.join(" · ") : "Due";
  } else {
    meta.textContent = "Due";
  }

  card.appendChild(topRow);
  card.appendChild(meta);
  return card;
}

/**
 * Attach a bn-info-toggle popover to a due-payment card.
 * Uses the shared card_info.js pattern so the popover looks and behaves
 * exactly like the stat-card info panels.
 *
 * @param {HTMLElement} card
 * @param {Object} payment  { memberId, memberName, amountStr, breakdown }
 * @param {string} groupId
 */
function attachDuePaymentCardInfo(card, payment, groupId) {
  // Build the deep-link URL for a specific obligation line.
  const payUrl = (b) => {
    const params = new URLSearchParams({
      groupId,
      memberId: payment.memberId,
      tab: "record",
      paymentType: b.paymentType,
    });
    if (b.month) params.set("month", b.month);
    return `manage_payments.html?${params.toString()}`;
  };

  attachCardInfo(card, {
    label: `About ${payment.memberName}'s payment`,
    content: (host) => {
      // Title
      const title = document.createElement("p");
      title.className = "bn-info-title";
      title.textContent = payment.memberName;
      host.appendChild(title);

      // Description
      const desc = document.createElement("p");
      desc.className = "bn-info-desc";
      desc.textContent = "Tap any row to record a payment for that obligation.";
      host.appendChild(desc);

      // Per-line breakdown — single-line rows, penalty detail in a collapsible dropdown.
      if (Array.isArray(payment.breakdown) && payment.breakdown.length) {
        for (const b of payment.breakdown) {
          const hasPenalty = b.penalty && b.penalty.penaltyType;

          // Main row: label · amount  [▾ toggle if penalty]
          const row = document.createElement("div");
          row.className = "bn-info-row";
          row.style.cssText =
            "cursor:pointer; padding:var(--bn-space-2) 0; border-bottom:1px solid rgba(255,255,255,0.08); transition:background 0.15s;";
          row.title = `Record payment for ${b.label}`;

          const lbl = document.createElement("span");
          lbl.className = "bn-info-row-label";
          lbl.textContent = b.label;

          const right = document.createElement("span");
          right.style.cssText = "display:flex; align-items:center; gap:var(--bn-space-2); flex-shrink:0;";

          const val = document.createElement("span");
          val.className = "bn-info-row-value";
          val.textContent = formatCurrency(b.amount != null ? b.amount : "0.00");
          right.appendChild(val);

          // Toggle for penalty detail
          let toggleBtn = null;
          if (hasPenalty) {
            toggleBtn = document.createElement("button");
            toggleBtn.type = "button";
            toggleBtn.className = "bn-info-row-toggle";
            toggleBtn.textContent = "▾";
            toggleBtn.title = "Show penalty breakdown";
            toggleBtn.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
            });
            right.appendChild(toggleBtn);
          }

          row.append(lbl, right);

          // Clicking the row navigates to pay this exact obligation.
          if (b.paymentType) {
            row.addEventListener("click", (e) => {
              // Don't navigate if the toggle was clicked
              if (e.target.closest(".bn-info-row-toggle")) return;
              e.preventDefault();
              e.stopPropagation();
              closeInfoPanel();
              window.location.href = payUrl(b);
            });
            row.addEventListener("mouseenter", () => {
              row.style.background = "rgba(255,255,255,0.06)";
            });
            row.addEventListener("mouseleave", () => {
              row.style.background = "";
            });
          }

          host.appendChild(row);

          // Collapsible penalty detail
          if (hasPenalty) {
            const pen = b.penalty;
            const detail = document.createElement("div");
            detail.className = "bn-info-row-detail";
            detail.hidden = true;
            detail.style.cssText =
              "display:none; padding:var(--bn-space-2) 0 var(--bn-space-3) var(--bn-space-4); font-size:11px; color:var(--bn-gray-300); line-height:1.6; border-bottom:1px solid rgba(255,255,255,0.08);";

            const lines = [];
            if (pen.penaltyType === "fixed") {
              const periodLabel = pen.penaltyPeriod === "month" ? "month" : "day";
              lines.push(`${formatCurrency(pen.dailyAmount)}/${periodLabel} × ${pen.periodsCharged} ${periodLabel}${pen.periodsCharged === 1 ? "" : "s"} late`);
            } else if (pen.penaltyType === "percentage") {
              const periodLabel = pen.penaltyPeriod === "month" ? "month" : "day";
              lines.push(`${pen.rate}% per ${periodLabel} × ${pen.periodsCharged} ${periodLabel}${pen.periodsCharged === 1 ? "" : "s"}`);
            }
            if (pen.gracePeriodDays > 0) {
              lines.push(`${pen.gracePeriodDays}-day grace period`);
            }
            if (pen.dueDate) {
              lines.push(`Due ${formatDateShort(parseServerDate(pen.dueDate))}`);
            }
            if (pen.amountAccrued && pen.amountAccrued !== "0.00") {
              lines.push(`Accrued: ${formatCurrency(pen.amountAccrued)}`);
            }
            if (pen.amountSettled && pen.amountSettled !== "0.00") {
              lines.push(`Settled: ${formatCurrency(pen.amountSettled)}`);
            }

            detail.textContent = lines.join(" · ");
            host.appendChild(detail);

            // Wire the toggle
            if (toggleBtn) {
              toggleBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const open = !detail.hidden;
                detail.hidden = open;
                detail.style.display = open ? "none" : "block";
                toggleBtn.textContent = open ? "▾" : "▴";
              });
            }
          }
        }
      }

      // Total row
      const totalRow = document.createElement("div");
      totalRow.className = "bn-info-row";
      totalRow.style.cssText = "margin-top:var(--bn-space-2);";
      const totalLbl = document.createElement("span");
      totalLbl.className = "bn-info-row-label";
      totalLbl.textContent = "Total owed";
      const totalVal = document.createElement("span");
      totalVal.className = "bn-info-row-value";
      totalVal.textContent = formatCurrency(payment.amountStr != null ? payment.amountStr : "0.00");
      totalRow.append(totalLbl, totalVal);
      host.appendChild(totalRow);

      // Bottom action — view full payment history
      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "bn-info-action";
      viewBtn.textContent = "View Full Payment History";
      viewBtn.style.cssText = "margin-top:var(--bn-space-3);";
      viewBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeInfoPanel();
        window.location.href = `manage_payments.html?groupId=${encodeURIComponent(groupId)}&memberId=${encodeURIComponent(payment.memberId)}&tab=arrears`;
      });
      host.appendChild(viewBtn);
    },
  });
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

  // Arrears and Collections are per-member MONEY totals. They are fetched from
  // payments.memberBreakdown rather than re-added here, so the rows and the
  // group figure on the card come from one server pass and cannot disagree.
  if (type === "arrears" || type === "collections") {
    renderStatModalLoading(body);
    loadMemberBreakdown(type, body);
    return;
  }

  let items = [];
  if (type === "loans") items = buildActiveLoanItems();
  else if (type === "pending") items = buildPendingItems();

  renderStatModalItems(items, type, body);
}

/**
 * Placeholder while the server breakdown is in flight — an empty modal reads as
 * "nothing to show", which is a different and wrong message.
 * @param {HTMLElement} body
 */
function renderStatModalLoading(body) {
  body.replaceChildren();
  const p = document.createElement("p");
  p.className = "stat-modal-empty-text";
  p.textContent = "Loading…";
  body.appendChild(p);
}

/**
 * Fetch and render the per-member breakdown behind a stat card.
 * @param {string} figure "arrears" | "collections"
 * @param {HTMLElement} body
 */
async function loadMemberBreakdown(figure, body) {
  const groupId = currentGroup && currentGroup.groupId;
  if (!groupId) return;

  let data;
  try {
    data = await apiGet("payments.memberBreakdown", { groupId, figure });
  } catch (e) {
    body.replaceChildren();
    const p = document.createElement("p");
    p.className = "stat-modal-empty-text";
    p.textContent = "Could not load the breakdown. Please try again.";
    body.appendChild(p);
    return;
  }

  const members = Array.isArray(data && data.members) ? data.members : [];
  const items = members.map((m) => ({
    id: m.uid,
    name: m.memberName,
    amountStr: m.amount,
    breakdown: Array.isArray(m.breakdown)
      ? m.breakdown.map((b) => ({ type: b.label, amountStr: b.amount }))
      : [],
  }));

  renderStatModalItems(items, figure, body);

  // The server's own total for exactly these rows, shown above them so an admin
  // can see the card's figure and the people behind it in one place.
  if (data && data.total !== undefined) {
    const summary = document.createElement("p");
    summary.className = "stat-modal-empty-text";
    summary.style.cssText =
      "text-align:left; font-weight:600; margin:0 0 var(--bn-space-3);";
    const count = members.length;
    summary.textContent =
      `${formatCurrency(data.total)} across ${count} member${count === 1 ? "" : "s"}`;
    body.insertBefore(summary, body.firstChild);
  }
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

/*
 * buildArrearsItems() and buildCollectionsItems() used to live here. Both added
 * money up in the browser, per member, from the cached payments list — the exact
 * thing A2 forbids, and they were WRONG as well as disallowed: arrears is derived
 * from group_rules, so an obligation with no payment row is invisible to the
 * ledger. Against live QA data they produced 0.00 for a group whose true position
 * was 200,000.00. Both are replaced by payments.memberBreakdown, which returns
 * the rows and their total from one server pass. Do not reintroduce them.
 */

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

  document
    .getElementById("collectionTrendsRangeSelect")
    ?.addEventListener("change", () => renderCollectionTrends());

  // Month/period filter — defaults to the current month; re-scopes ONLY the
  // Collections stat tile (client-side re-aggregation of the cached payments
  // list, see applyDashboardMonthFilter).
  const monthFilter = document.getElementById("dashboardMonthFilter");
  if (monthFilter) {
    monthFilter.value = MONTHS[new Date().getMonth()];
    monthFilter.addEventListener("change", applyDashboardMonthFilter);
  }

  setupStatCardPopovers();
}

/**
 * Wire the four stat-card detail popovers. Each card keeps its EXISTING
 * navigateToStatPage(...) click-through unchanged; a separate small
 * ".stat-card-info-toggle" button (sibling, not nested inside the nav
 * button) opens/closes the popover on tap for touch/no-hover devices, while
 * hover/focus-within is handled purely in CSS for desktop/keyboard users. A
 * document-level listener closes any open popover on an outside click.
 */
function setupStatCardPopovers() {
  document.querySelectorAll(".stat-card-wrap").forEach((wrap) => {
    // The in-card .stat-card-popover div is never displayed — the panel renders
    // on <body> instead, because nested in the card it was clipped by
    // .stats-grid's horizontal overflow and confined by the card's own stacking
    // context. It is kept in the markup only so existing ids stay valid.
    const source = wrap.querySelector(".stat-card-popover");
    const oldToggle = wrap.querySelector(".stat-card-info-toggle");
    if (source) source.hidden = true;
    // The markup's own toggle is replaced by the shared one, so there is never
    // a second, dead "i" button sitting next to the working one.
    if (oldToggle) oldToggle.remove();

    const key = source ? STAT_CARD_KEY_BY_POPOVER_ID[source.id] : null;
    const label = wrap.querySelector(".stat-label")?.textContent?.trim();

    attachCardInfo(wrap, {
      label: label ? `About ${label}` : "More information",
      // Built at OPEN time, not at attach time, so the panel always reflects the
      // latest loaded data (and the month filter) without re-attaching.
      content: (host) => {
        const spec = key ? STAT_CARD_INFO[key] : null;
        if (!spec) {
          return infoContent({
            title: label || "Details",
            description: "No details are available for this card.",
          })(host);
        }
        return infoContent({
          title: spec.title,
          description: spec.description,
          rows: spec.rows(),
          action: {
            label: spec.actionLabel,
            onClick: () => openStatModal(spec.modal),
          },
        })(host);
      },
    });
  });
}

/** Which stat card each in-markup popover div belongs to. */
const STAT_CARD_KEY_BY_POPOVER_ID = {
  totalCollectionsPopover: "collections",
  activeLoansPopover: "loans",
  pendingApprovalsPopover: "pending",
  totalArrearsPopover: "arrears",
};

/**
 * The four admin stat cards, described ONE way.
 *
 * Every panel answers the same three questions in the same order — what the
 * figure is, what it means, and where the number came from — and then offers a
 * route into the underlying detail. Previously each card hand-built its own
 * body: some listed per-member rows, some a sentence, none offered a way
 * through to the breakdown, and two of them re-summed money in the browser.
 *
 * MONEY HERE IS READ, NEVER ADDED. Each row quotes a figure the server already
 * totalled (`payments.list` summary, `payments.groupArrears`, `loans.list`
 * summary). Counts are counts, not money, so counting rows is fine.
 */
const STAT_CARD_INFO = {
  collections: {
    title: "Collections",
    description:
      "Money members have paid in that an admin has verified. A payment a member has uploaded but nobody has approved yet is not counted here — it sits under Pending.",
    modal: "collections",
    actionLabel: "See who has paid →",
    rows: () => {
      const s = groupData.summary || {};
      return [
        ["Verified collections", formatCurrency(s.verifiedCollected ?? "0.00")],
        ["Awaiting approval", formatCurrency(s.pending ?? "0.00")],
        ["Members who have paid", String(countMembersWithVerifiedPayment())],
      ];
    },
  },
  loans: {
    title: "Active loans",
    description:
      "Loans that have been approved or disbursed and are not yet fully repaid. Received is the money handed over; balance is what is still owed on it.",
    modal: "loans",
    actionLabel: "See each active loan →",
    rows: () => {
      const s = groupData.loansSummary || {};
      return [
        ["Active loans", String(groupData.loans.filter((l) => isActiveLoan(l.status)).length)],
        ["Money handed out", formatCurrency(s.activePrincipal ?? "0.00")],
        ["Still owed", formatCurrency(s.activeBalance ?? "0.00")],
      ];
    },
  },
  pending: {
    title: "Pending approvals",
    description:
      "Things waiting on an admin decision: payments members say they have made, and loans they have requested. Nothing here has affected the group's money yet.",
    modal: "pending",
    actionLabel: "Review what is waiting →",
    rows: () => {
      const s = groupData.summary || {};
      const payments = groupData.payments.filter(
        (p) => String(p.approvalStatus) === "pending",
      ).length;
      const loans = groupData.loans.filter((l) => String(l.status) === "pending").length;
      return [
        ["Payments to verify", String(payments)],
        ["Value awaiting approval", formatCurrency(s.pending ?? "0.00")],
        ["Loan requests to decide", String(loans)],
      ];
    },
  },
  arrears: {
    title: "Arrears",
    description:
      "What members owe the group and have not paid: overdue contributions plus any penalties on them. This counts obligations nobody has recorded a payment against, not just late payment rows.",
    modal: "arrears",
    actionLabel: "See who owes what →",
    rows: () => {
      const ga = groupData.groupArrears;
      if (!ga) {
        return [["Breakdown", "Unavailable right now"]];
      }
      return [
        ["Overdue contributions", formatCurrency(ga.arrears ?? "0.00")],
        ["Penalties accrued", formatCurrency(ga.penaltyAccrued ?? "0.00")],
        ["Total owed", formatCurrency(ga.totalArrears ?? "0.00")],
        // membersInArrears, NOT memberCount — the latter is every active member
        // the server considered, so labelling it "behind" told an admin the whole
        // group was in arrears. This matches the row count in the breakdown modal.
        ["Members behind", `${ga.membersInArrears ?? 0} of ${ga.memberCount ?? 0}`],
      ];
    },
  },
};

/** How many distinct members have at least one verified payment. A COUNT, not money. */
function countMembersWithVerifiedPayment() {
  const seen = new Set();
  for (const p of groupData.payments) {
    if (isVerifiedPayment(p)) seen.add(String(p.uid));
  }
  return seen.size;
}

/*
 * renderCollectionsPopover / renderActiveLoansPopover / renderPendingPopover /
 * renderArrearsPopover / appendPopoverLines used to live here. Each hand-built its
 * own popover body, so the four cards read differently, none offered a route to the
 * detail behind the number, and two of them re-summed money per member in the
 * browser (A2). They are replaced by STAT_CARD_INFO above, which describes all four
 * cards one way and quotes server totals. Do not reintroduce them.
 */

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
  if (show) {
    // Populate the group name in the loader for a branded loading experience
    const nameEl = document.getElementById("spinnerGroupName");
    if (nameEl && currentGroup && currentGroup.groupName) {
      nameEl.textContent = currentGroup.groupName;
    }
    spinner.classList.remove("hidden");
  } else {
    spinner.classList.add("hidden");
  }
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

/**
 * The penalty a member still OWES — net of anything already paid or waived.
 *
 * Use this anywhere the figure means "owed". amountAccrued is the GROSS charge
 * and ignores waivers, so showing it as owed would keep billing a member for a
 * penalty an admin already wrote off.
 * @param {Object} penalty payment.penalty from the server
 * @return {string} money string
 */
function penaltyOwed(penalty) {
  if (!penalty) return "0.00";
  return penalty.amountOutstanding != null
    ? penalty.amountOutstanding
    : penalty.amountAccrued;
}
