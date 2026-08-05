/**
 * analytics_sql.js — SQL port of analytics.js (admin read-only trends page:
 * contributions collected over time, loans issued/repaid, member
 * participation, arrears). Not wired into any page until the cutover — see
 * BUILD_PLAN.md.
 *
 * HARD RULE: no client-side money math beyond simple summation of
 * already-server-computed figures. Every arrears/penalty/interest/payout
 * figure comes straight from the API. This file only SUMS or GROUPS BY MONTH
 * numbers the server already returned — it never derives a new financial
 * figure (no interest, no penalty, no "amount due", no payout).
 *
 * ENDPOINT CONTRACT (verified by reading api/handlers/payments.php,
 * api/handlers/loans.php, api/handlers/cycle.php directly):
 *   groups.mine          -> via listMyGroups(); filtered to
 *                           admin/senior_admin/treasurer (this is an admin page).
 *   members.list          -> GET, {groupId} -> {members:[{uid, fullName, ...}]}.
 *   payments.list         -> GET, {groupId[, year]} -> {payments:[...]}. Rows
 *                           carry paymentType, approvalStatus, amountPaid,
 *                           month, createdAt/paidAt. Only approved/completed
 *                           rows are counted as real collected income — a
 *                           pending claim is never counted.
 *   payments.obligations  -> GET, {groupId, uid[, year]} -> live arrears
 *                           (incl. penalty), used ONLY for the "outstanding
 *                           arrears right now" tile — the same source
 *                           contributions_overview_sql.js uses.
 *   loans.list            -> GET, {groupId} -> {loans:[...]}
 *                           (principalAmount, totalInterest, amountRepaid,
 *                           remainingBalance, status, disbursedAt). Used for
 *                           "loans issued" (disbursed/completed/active) and
 *                           "loans repaid" (amountRepaid) trend totals — plain
 *                           sums of server-returned decimal strings.
 *   cycle.equity          -> GET, {groupId} -> the authoritative per-member
 *                           borrowing/contribution/interest-paid view AND the
 *                           group-level interest pool
 *                           (summary.groupInterestPool = interest actually
 *                           paid this cycle). This is the "member
 *                           participation" table and the interest tile — never
 *                           recomputed client-side, read verbatim.
 *
 * DEFERRED (toast + reported, never invented):
 *   - CSV/PDF export of the charts or tables (no export endpoint exists for
 *     this page's data — would need a dedicated reports.export action).
 *   - A true historical arrears TREND (arrears at each point in the past) —
 *     payments.obligations only answers "as of now" (or a past YEAR's
 *     monthly-contribution obligations); there is no endpoint that returns a
 *     time series of arrears snapshots, so the arrears figure shown here is
 *     the live snapshot only, not a trend line.
 *   - Week/Year tab granularity (the original had Week/Month/Year tabs with
 *     no distinct data source even in Firebase) — the tabs are wired to
 *     reload the same monthly view; a true week-level breakdown would need a
 *     payments.list day-level endpoint that does not exist.
 */

import {apiGet, requireSession, listMyGroups, ApiError, redirectToLogin} from "./api.js";
import { makeStatClickable, scrollToId } from "./ui.js";
import { formatCurrency } from "./utils_financial.js";
import { attachCardInfo, infoContent } from "./card_info.js";

const ANALYTICS_ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SETTLED_STATUSES = ["approved", "completed"];
/**
 * Loan statuses where the loan was actually ISSUED (money left the box).
 *
 * The DB enum is: pending | approved | rejected | disbursed | completed | defaulted.
 * There is no 'active' status — and `loans.approve` sets 'approved' (nothing in the
 * API ever sets 'disbursed'), so omitting 'approved' would report zero loans issued.
 * 'defaulted' counts: the money still went out.
 */
const ISSUED_LOAN_STATUSES = ["approved", "disbursed", "completed", "defaulted"];

let currentUser = null;
let currentGroupId = null;
let members = [];
let payments = [];
let loans = [];
/** loans.list's server-computed `summary` block (totalPrincipal/totalOutstanding/
 * totalInterest/activePrincipal, all ALL-loan-rows scope) — used only where a
 * client-side sum's filter scope genuinely matches it. */
let loansSummary = null;
let cycleEquity = null;
/** Sum of live arrears across all members, current year — no client math beyond +=. */
let liveArrearsTotal = 0;

const groupSelector = () => document.getElementById("groupSelector");
const totalIncomeEl = () => document.getElementById("totalIncome");
const totalExpensesEl = () => document.getElementById("totalExpenses");
const netProfitEl = () => document.getElementById("netProfit");
const loanInterestEl = () => document.getElementById("loanInterest");
const monthlyTrendChart = () => document.getElementById("monthlyTrendChart");
const chartContainer = () => document.getElementById("chartContainer");
const memberPerformanceEl = () => document.getElementById("memberPerformance");
const spinner = () => document.getElementById("spinner");

/**
 * Router-compatible entry point. Body is identical to the former
 * DOMContentLoaded handler; the SPA router (scripts/spa-router.js) calls this
 * directly after every content swap, and the guarded bootstrap below covers
 * a normal hard page load.
 * @return {Promise<void>}
 */
export async function init() {
  setupEventListeners();
  initStaticStatPopovers();

  try {
    currentUser = await requireSession(); // redirects to login on 401
  } catch (error) {
    handleApiError(error, "Could not verify your session.");
    return;
  }

  await loadAdminGroups();
}

if (!window.__bnSpa) {
  document.addEventListener("DOMContentLoaded", () => {
    init();
  });
}

function setupEventListeners() {
  // Headline tiles now take you to the detail they summarise.
  makeStatClickable("totalIncome", {onClick: scrollToId("accountingFiguresBlock"), label: "Show the accounting breakdown"});
  makeStatClickable("totalExpenses", {onClick: scrollToId("accountingFiguresBlock"), label: "Show the accounting breakdown"});
  makeStatClickable("netProfit", {onClick: scrollToId("accountingFiguresBlock"), label: "Show the accounting breakdown"});
  makeStatClickable("loanInterest", {onClick: scrollToId("accountingFiguresBlock"), label: "Show the accounting breakdown"});

  groupSelector()?.addEventListener("change", async (e) => {
    currentGroupId = e.target.value;
    if (currentGroupId) {
      sessionStorage.setItem("selectedGroupId", currentGroupId);
      await loadAnalytics();
    }
  });

  // Week/Year tabs: no distinct data source exists (see DEFERRED note in the
  // file header) — every tab reloads the same monthly view rather than
  // silently doing nothing.
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      if (tab.textContent?.trim() !== "Month") {
        showToast("Week/Year breakdowns are not available yet — showing the monthly view.", "info");
      }
      if (currentGroupId) {
        await loadAnalytics();
        document.getElementById("memberPerformanceTable")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

async function loadAdminGroups() {
  showSpinner(true);
  try {
    const groups = await listMyGroups();
    const adminGroups = groups.filter((g) => ANALYTICS_ADMIN_ROLES.includes(g.myRole));

    const selector = groupSelector();
    if (selector) {
      selector.textContent = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a group...";
      selector.appendChild(placeholder);

      adminGroups.forEach((group) => {
        const option = document.createElement("option");
        option.value = group.groupId || group.id;
        option.textContent = group.groupName || group.name || "Unnamed group";
        selector.appendChild(option);
      });
    }

    if (adminGroups.length === 0) {
      showToast("You are not an admin of any groups", "warning");
      return;
    }

    const stored = sessionStorage.getItem("selectedGroupId") || localStorage.getItem("selectedGroupId");
    const match = adminGroups.find((g) => (g.groupId || g.id) === stored);
    const chosen = match || adminGroups[0];
    currentGroupId = chosen.groupId || chosen.id;
    if (selector) selector.value = currentGroupId;
    sessionStorage.setItem("selectedGroupId", currentGroupId);

    await loadAnalytics();
  } catch (error) {
    handleApiError(error, "Failed to load groups");
  } finally {
    showSpinner(false);
  }
}

async function loadAnalytics() {
  if (!currentGroupId) return;
  showSpinner(true);
  try {
    await loadMembers();
    await Promise.all([loadPayments(), loadLoans(), loadCycleEquity(), loadLiveArrears()]);

    renderMonthlyTrendChart();
    renderMemberParticipation();

    // Group accounting position (H5, admin-gated server-side). Also populates
    // the four headline tiles so they reconcile with the accounting block.
    try {
      const summary = await apiGet("payments.accountingSummary", {groupId: currentGroupId});
      applySummaryTilesFromServer(summary);
      renderAccountingFigures(summary);
      renderGroupHealth(summary);
      renderFollowUpList();
    } catch (e) {
      handleApiError(e, "Failed to load accounting summary");
      renderAccountingFigures(null);
    }
  } catch (error) {
    handleApiError(error, "Failed to load analytics");
  } finally {
    showSpinner(false);
  }
}

async function loadMembers() {
  try {
    const data = await apiGet("members.list", {groupId: currentGroupId});
    members = Array.isArray(data && data.members) ? data.members : [];
  } catch (error) {
    members = [];
    handleApiError(error, "Failed to load members");
  }
}

async function loadPayments() {
  try {
    const data = await apiGet("payments.list", {groupId: currentGroupId});
    payments = Array.isArray(data && data.payments) ? data.payments : [];
  } catch (error) {
    payments = [];
    handleApiError(error, "Failed to load payments");
  }
}

async function loadLoans() {
  try {
    const data = await apiGet("loans.list", {groupId: currentGroupId});
    loans = Array.isArray(data && data.loans) ? data.loans : [];
    loansSummary = data && data.summary && typeof data.summary === "object" ? data.summary : null;
  } catch (error) {
    loans = [];
    loansSummary = null;
    handleApiError(error, "Failed to load loans");
  }
}

/** Authoritative per-member borrowing/contribution/interest-paid view. */
async function loadCycleEquity() {
  try {
    cycleEquity = await apiGet("cycle.equity", {groupId: currentGroupId});
  } catch (error) {
    cycleEquity = null;
    handleApiError(error, "Failed to load cycle equity data");
  }
}

/** Live arrears snapshot, summed across members — same source as contributions_overview_sql.js. */
async function loadLiveArrears() {
  liveArrearsTotal = 0;
  if (members.length === 0) return;

  try {
    const results = await Promise.all(
      members.map((m) =>
        apiGet("payments.obligations", {groupId: currentGroupId, uid: m.uid})
          .catch((error) => {
            console.error(`Failed to load obligations for ${m.uid}`, error);
            return null;
          }),
      ),
    );

    results.forEach((obligations) => {
      if (!obligations) return;
      liveArrearsTotal += numberOf(obligations.seedMoney?.arrears);
      liveArrearsTotal += numberOf(obligations.serviceFee?.arrears);
      const months = obligations.monthlyContributions?.months;
      if (Array.isArray(months)) {
        months.forEach((m) => {
          liveArrearsTotal += numberOf(m.arrears);
        });
      }
    });
  } catch (error) {
    console.error("Failed to load live arrears total", error);
  }
}

// ── Summary tiles — read from the server's accountingSummary (H5) so the
// figures reconcile with the #accountingFiguresBlock right below them.
// Populated asynchronously in loadAnalytics; called from renderAccountingFigures
// once the server data arrives. Until then, the HTML shows "MWK 0" defaults.
let accounting = null;

function applySummaryTilesFromServer(summary) {
  accounting = summary;
  if (!summary) return;
  // These four tiles map to the four most meaningful server figures.
  setText(totalIncomeEl(), formatCurrency(summary.totalContributed));
  setText(totalExpensesEl(), formatCurrency(summary.totalDisbursed));
  setText(netProfitEl(), formatCurrency(summary.cashPosition));
  setText(loanInterestEl(), formatCurrency(summary.interestEarned));
}

// ── Monthly trend chart: collected contributions vs loans disbursed ───────
function renderMonthlyTrendChart() {
  const container = monthlyTrendChart();
  if (!container) return;
  container.textContent = "";

  const currentMonth = new Date().getMonth();
  const monthly = MONTH_NAMES.slice(0, currentMonth + 1).map((name) => ({
    month: name,
    collected: 0,
    disbursed: 0,
  }));

  payments
    .filter((p) => p.paymentType === "monthly_contribution" && SETTLED_STATUSES.includes(p.approvalStatus))
    .forEach((p) => {
      const idx = MONTH_NAMES.indexOf(p.month);
      if (idx >= 0 && idx <= currentMonth) monthly[idx].collected += numberOf(p.amountPaid);
    });

  // Not substituted with loans.list's `summary` (a single group-wide total, not
  // a per-month breakdown) — this loop needs disbursed amounts bucketed by month,
  // which no summary field provides.
  loans
    .filter((l) => ISSUED_LOAN_STATUSES.includes(l.status))
    .forEach((l) => {
      // `loans.approve` sets approvedAt and does the disbursement in the same call;
      // it never writes disbursedAt (that column is unused by the API). Keying the
      // chart on disbursedAt alone would leave it permanently empty, so fall back
      // to approvedAt — the moment the money was actually committed.
      const when = l.disbursedAt || l.approvedAt;
      if (!when) return;
      const d = new Date(when);
      if (Number.isNaN(d.getTime())) return;
      const idx = d.getMonth();
      if (idx >= 0 && idx <= currentMonth) monthly[idx].disbursed += numberOf(l.principalAmount ?? l.approvedAmount);
    });

  const totalCollected = monthly.reduce((s, m) => s + m.collected, 0);
  const totalDisbursed = monthly.reduce((s, m) => s + m.disbursed, 0);
  const net = totalCollected - totalDisbursed;

  const card = el("div", "content-section-body");
  const title = el("h3");
  title.textContent = "Monthly Contributions Collected vs Loans Disbursed";
  card.appendChild(title);

  if (totalCollected === 0 && totalDisbursed === 0) {
    card.appendChild(emptyState("📊", "No contributions or disbursements recorded yet"));
    container.appendChild(card);
    return;
  }

  // Compact axis-tick formatter (major-unit numbers).
  const shortMoney = (n) => {
    if (n >= 1000000) return "MWK " + (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + "M";
    if (n >= 1000) return "MWK " + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
    return "MWK " + Math.round(n);
  };

  // KPI summary — the hard numbers an accountant reads first.
  const kpis = el("div", "fin-kpis");
  [
    ["Total Collected", formatCurrency(totalCollected), "pos"],
    ["Total Disbursed", formatCurrency(totalDisbursed), ""],
    ["Net Flow", formatCurrency(net), net >= 0 ? "pos" : "neg"],
  ].forEach(([label, value, cls]) => {
    const kpi = el("div", "fin-kpi");
    const l = el("span", "fin-kpi-label");
    l.textContent = label;
    const v = el("span", "fin-kpi-value" + (cls ? " " + cls : ""));
    v.textContent = value;
    kpi.append(l, v);
    kpis.appendChild(kpi);
  });
  card.appendChild(kpis);

  // Legend (two series → always shown, so identity is never colour-alone).
  const legend = el("div", "fin-legend");
  [
    ["collected", "Contributions Collected"],
    ["disbursed", "Loans Disbursed"],
  ].forEach(([c, text]) => {
    const item = el("span", "fin-legend-item");
    const dot = el("span", "fin-legend-dot " + c);
    const t = el("span");
    t.textContent = text;
    item.append(dot, t);
    legend.appendChild(item);
  });
  card.appendChild(legend);

  // Plot: a left value axis + horizontal gridlines behind grouped monthly bars.
  const PLOT_H = 220;
  const axisMax = Math.max(1000, ...monthly.map((m) => Math.max(m.collected, m.disbursed)));

  const plot = el("div", "fin-plot");

  const yaxis = el("div", "fin-yaxis");
  for (let i = 0; i <= 3; i++) {
    const tick = el("span");
    tick.textContent = shortMoney(axisMax * (1 - i / 3));
    yaxis.appendChild(tick);
  }
  plot.appendChild(yaxis);

  const scroll = el("div", "fin-scroll");
  const area = el("div", "fin-plot-area");
  for (let i = 0; i <= 3; i++) {
    const line = el("div", "fin-gridline");
    line.style.top = `${(i / 3) * PLOT_H}px`;
    area.appendChild(line);
  }

  const barsRow = el("div", "fin-bars");
  monthly.forEach((m) => {
    const col = el("div", "fin-month");
    const pair = el("div", "fin-month-bars");
    pair.style.height = `${PLOT_H}px`;

    const cBar = el("div", "fin-bar collected");
    cBar.style.height = `${Math.max((m.collected / axisMax) * 100, m.collected > 0 ? 2 : 0)}%`;
    cBar.title = `Collected (${m.month}): ${formatCurrency(m.collected)}`;

    const dBar = el("div", "fin-bar disbursed");
    dBar.style.height = `${Math.max((m.disbursed / axisMax) * 100, m.disbursed > 0 ? 2 : 0)}%`;
    dBar.title = `Disbursed (${m.month}): ${formatCurrency(m.disbursed)}`;

    pair.append(cBar, dBar);
    const lbl = el("div", "fin-month-label");
    lbl.textContent = m.month.slice(0, 3);
    col.append(pair, lbl);
    barsRow.appendChild(col);
  });
  area.appendChild(barsRow);
  scroll.appendChild(area);
  plot.appendChild(scroll);
  card.appendChild(plot);

  container.appendChild(card);
}

// ── Group-level breakdown pie: contributions vs loan interest vs disbursed ─
function renderChartContainer() {
  const container = chartContainer();
  if (!container) return;
  container.textContent = "";

  const collected = payments
    .filter((p) => SETTLED_STATUSES.includes(p.approvalStatus))
    .reduce((sum, p) => sum + numberOf(p.amountPaid), 0);
  // Same scope mismatch as renderSummaryTiles's `disbursed` above — see comment
  // there. Left as a client-side sum, not substituted with `summary`.
  const disbursed = loans
    .filter((l) => ISSUED_LOAN_STATUSES.includes(l.status))
    .reduce((sum, l) => sum + numberOf(l.principalAmount ?? l.approvedAmount), 0);

  if (collected === 0 && disbursed === 0) {
    container.appendChild(emptyState("📊", "No financial data available yet"));
    return;
  }

  container.appendChild(statCard(
    "Contributions Collected",
    formatCurrency(collected),
    "Settled member contributions received over the selected period."
  ));
  container.appendChild(statCard(
    "Loans Disbursed",
    formatCurrency(disbursed),
    "Total loan principal paid out to members."
  ));
  container.appendChild(statCard(
    "Outstanding Arrears (live)",
    formatCurrency(liveArrearsTotal),
    "Contributions and penalties currently overdue across the group, computed live."
  ));

  // Substituted with the server summary: remainingBalance is 0.00 for every
  // loan outside ISSUED_LOAN_STATUSES (pending/rejected never had a balance set,
  // and completed loans are repaid to 0) — so summing it over ALL rows
  // (`summary.totalOutstanding`) is mathematically identical to this filtered
  // client-side sum. Verified against api/handlers/loans.php's remainingBalance
  // writes (default '0.00' on insert, only ever set on approve/repay).
  const outstandingLoans = loansSummary ? numberOf(loansSummary.totalOutstanding) : 0;
  container.appendChild(statCard(
    "Outstanding Loan Balances",
    formatCurrency(outstandingLoans),
    "Loan principal members still owe on active loans."
  ));
}

/**
 * @param {string} label
 * @param {string} value - already-formatted display string (formatCurrency output)
 * @param {string} [infoText] - when passed, attaches a "i" info-toggle popover
 *   (see attachCardPopover) explaining the figure. Optional — existing 2-arg
 *   callers are unaffected.
 */
function statCard(label, value, field, summary) {
  const card = el("div", "breakdown-card");
  const header = el("div", "breakdown-card-header");
  const title = el("span", "breakdown-card-title");
  title.textContent = label;
  header.appendChild(title);
  const valueEl = el("div", "breakdown-card-value");
  valueEl.textContent = value;
  card.append(header, valueEl);

  // Standardized info toggle using infoContent() builder — same shape as
  // every other "i" button in the app: what, what it means, derivation.
  if (field && summary) {
    attachCardInfo(card, {
      label: `About ${label}`,
      content: buildAccountingInfoContent(label, field, summary),
    });
  }
  return card;
}

/**
 * Build an infoContent() builder for one accounting-figure card, quoting the
 * live server value so the derivation shows the current number.
 */
function buildAccountingInfoContent(label, field, summary) {
  const display = summary[field] != null ? formatCurrency(summary[field]) : "—";
  const rows = [[label, display]];

  // Add contextual rows for figures that have a known breakdown
  if (field === "totalContributed") {
    rows.push(
      ["Seed money", formatCurrency(summary.seedMoneyContributed ?? "0.00")],
      ["Monthly contributions", formatCurrency(summary.monthlyContributionContributed ?? "0.00")],
      ["Service fees", formatCurrency(summary.serviceFeeContributed ?? "0.00")],
    );
  }
  if (field === "totalDisbursed") {
    rows.push(
      ["Outstanding principal", formatCurrency(summary.outstandingLoanPrincipal ?? "0.00")],
    );
  }
  if (field === "penaltiesCharged") {
    rows.push(
      ["Collected", formatCurrency(summary.penaltiesCollected ?? "0.00")],
      ["Waived", formatCurrency(summary.penaltiesWaived ?? "0.00")],
      ["Outstanding", formatCurrency(summary.penaltiesOutstanding ?? "0.00")],
    );
  }
  if (field === "cashPosition") {
    rows.push(
      ["= Contributed + Repaid + Penalties − Disbursed", ""],
      ["Contributed", formatCurrency(summary.totalContributed ?? "0.00")],
      ["Repayments", formatCurrency(summary.loanRepaymentsReceived ?? "0.00")],
      ["Disbursed", formatCurrency(summary.totalDisbursed ?? "0.00")],
    );
  }

  return infoContent({
    title: label,
    description: getAccountingFigureDescription(field),
    rows,
  });
}

function getAccountingFigureDescription(field) {
  const map = {
    totalContributed: "All settled contributions — seed money, monthly dues and service fees — that an admin has verified.",
    seedMoneyContributed: "One-off joining contributions paid by members when they enter the group.",
    monthlyContributionContributed: "Recurring monthly dues collected from members.",
    serviceFeeContributed: "Service fees collected from members.",
    totalDisbursed: "Total loan principal paid out to members.",
    outstandingLoanPrincipal: "Loan principal still owed and not yet repaid.",
    interestEarned: "Interest received from approved loan repayments.",
    loanRepaymentsReceived: "Total loan repayments received — principal, interest and penalties combined.",
    penaltiesCharged: "Total penalties levied on late contributions and loans (= collected + waived + outstanding).",
    penaltiesCollected: "Penalty amounts members have actually paid.",
    penaltiesWaived: "Penalty amounts an admin has cancelled (forgiven).",
    penaltiesOutstanding: "Live outstanding penalties — accrued and not yet collected or waived.",
    cashPosition: "Net cash on hand = total contributed + loan repayments + penalty collections − total disbursed.",
  };
  return map[field] || "A server-computed figure from the group's accounting summary.";
}

// ── Group accounting position (H5, admin-gated server-side) — pure display of
// ten already-server-computed money STRINGS, no client arithmetic. ───────────
const ACCOUNTING_FIGURES = [
  // Contributions — blended total first, then broken down by source
  ["totalContributed", "Total Contributed", "All settled contributions combined — seed money, monthly dues and service fees."],
  ["seedMoneyContributed", "Seed Money Contributed", "One-off joining contributions paid by members when they enter the group."],
  ["monthlyContributionContributed", "Monthly Contributions", "Recurring monthly dues collected from members."],
  ["serviceFeeContributed", "Service Fees Contributed", "Service fees collected from members."],
  // Loans
  ["totalDisbursed", "Total Disbursed", "Total loan principal paid out to members."],
  ["outstandingLoanPrincipal", "Outstanding Loan Principal", "Loan principal still owed and not yet repaid."],
  // Interest & repayments
  ["interestEarned", "Interest Earned", "Interest received from approved loan repayments."],
  ["loanRepaymentsReceived", "Loan Repayments Received", "Total loan repayments received — principal, interest and penalties combined."],
  // Penalties
  ["penaltiesCharged", "Penalties Charged", "Total penalties levied on late contributions and loans."],
  ["penaltiesCollected", "Penalties Collected", "Penalty amounts members have actually paid."],
  ["penaltiesWaived", "Penalties Waived", "Penalty amounts an admin has cancelled."],
  ["penaltiesOutstanding", "Penalties Outstanding", "Live outstanding penalties across contributions and loans — accrued and not yet collected or waived."],
  // Position
  ["cashPosition", "Cash Position", "Total contributed and repaid minus total disbursed — the group's net cash on hand."],
];

function renderAccountingFigures(summary) {
  const block = document.getElementById("accountingFiguresBlock");
  if (!block) return;
  block.textContent = "";

  if (!summary) {
    block.appendChild(emptyState("📊", "No accounting data available"));
    return;
  }

  const titleEl = el("h3");
  titleEl.textContent = "Group Accounting Position";
  block.appendChild(titleEl);

  ACCOUNTING_FIGURES.forEach(([field, label]) => {
    const card = statCard(label, formatCurrency(summary[field]), field, summary);

    // FLOW figures only (J3 D1). A flow is money that MOVED in a period, so
    // "what made this up in March" is a real question with real rows behind it.
    // Balance/derived figures — outstanding principal, penalties outstanding,
    // cash position — are point-in-time; inventing "March's outstanding
    // principal" would be fabricating a number, so those stay display-only.
    if (DRILLABLE_FIGURES[field]) {
      card.classList.add("is-drillable");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${label} — see the payments behind this figure`);
      const open = () => openAccountingDrill(field, label);
      card.addEventListener("click", (e) => {
        // The "i" toggle lives inside this card and opens its own panel.
        if (e.target.closest(".bn-info-toggle") || e.target.closest(".bn-info-panel")) return;
        open();
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    }

    block.appendChild(card);
  });
}

/**
 * The four figures `payments.accountingSummary` can break down by period, and
 * the columns each one's rows carry. Mirrors the server's own allowlist — a
 * figure absent here is one the server will 422 on.
 */
const DRILLABLE_FIGURES = {
  totalContributed: {
    columns: [["memberName", "Member"], ["type", "Type"], ["month", "Month"], ["amountPaid", "Amount"]],
    money: "amountPaid",
  },
  totalDisbursed: {
    columns: [["borrowerName", "Borrower"], ["status", "Status"], ["approvedAt", "Approved"], ["principalAmount", "Amount"]],
    money: "principalAmount",
  },
  loanRepaymentsReceived: {
    columns: [["borrowerName", "Borrower"], ["approvedAt", "Approved"], ["amount", "Amount"]],
    money: "amount",
  },
  interestEarned: {
    columns: [["borrowerName", "Borrower"], ["approvedAt", "Approved"], ["interestPortion", "Interest"]],
    money: "interestPortion",
  },
};

const DRILL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Same payment-type vocabulary the payments pages already use. */
const PAYMENT_TYPE_LABELS = {
  seed_money: "Seed money",
  monthly_contribution: "Monthly contribution",
  service_fee: "Service fee",
};

/** Humanise a payment type the label map does not know, rather than printing a raw column value. */
function paymentTypeLabel(type) {
  const key = String(type == null ? "" : type);
  if (PAYMENT_TYPE_LABELS[key]) return PAYMENT_TYPE_LABELS[key];
  if (!key) return "Other";
  return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Open the period drill-down for one accounting figure.
 *
 * The period total and every row come from the server in one call — the browser
 * never sums the rows it was handed, so the modal's total and the card above it
 * cannot drift apart.
 *
 * @param {string} field one of DRILLABLE_FIGURES
 * @param {string} label the card's own title
 */
function openAccountingDrill(field, label) {
  const overlay = el("div", "modal-overlay active");
  overlay.id = "accountingDrillModal";

  const content = el("div", "modal-content");
  content.style.maxWidth = "620px";

  const header = el("div", "modal-header");
  const title = el("h2", "modal-title");
  title.textContent = label;
  const closeBtn = el("button", "modal-close");
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", () => overlay.remove());
  header.append(title, closeBtn);

  const body = el("div", "modal-body");

  // --- Period picker. Year is required by the server; month is optional. ---
  const controls = el("div", "drill-controls");

  const yearLabel = el("label", "form-label");
  yearLabel.textContent = "Year";
  const yearSelect = document.createElement("select");
  yearSelect.className = "form-input";
  const thisYear = new Date().getFullYear();
  for (let y = thisYear; y >= thisYear - 4; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }

  const monthLabel = el("label", "form-label");
  monthLabel.textContent = "Month";
  const monthSelect = document.createElement("select");
  monthSelect.className = "form-input";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "Whole year";
  monthSelect.appendChild(allOpt);
  for (const m of DRILL_MONTHS) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    monthSelect.appendChild(opt);
  }

  const yearWrap = el("div", "form-group");
  yearWrap.append(yearLabel, yearSelect);
  const monthWrap = el("div", "form-group");
  monthWrap.append(monthLabel, monthSelect);
  controls.append(yearWrap, monthWrap);
  body.appendChild(controls);

  const result = el("div");
  body.appendChild(result);

  const load = async () => {
    result.replaceChildren();
    const loading = el("p");
    loading.textContent = "Loading…";
    result.appendChild(loading);

    let data;
    try {
      const params = { groupId: currentGroupId, figure: field, year: yearSelect.value };
      if (monthSelect.value) params.month = monthSelect.value;
      data = await apiGet("payments.accountingSummary", params);
    } catch (error) {
      result.replaceChildren();
      const err = el("p");
      err.textContent = "Could not load the breakdown for this period.";
      result.appendChild(err);
      return;
    }
    renderAccountingDrillResult(result, field, data);
  };

  yearSelect.addEventListener("change", load);
  monthSelect.addEventListener("change", load);

  content.append(header, body);
  overlay.appendChild(content);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onEsc); }
  });

  load();
}

/**
 * Render one drill response: the server's period total, then its rows.
 * @param {HTMLElement} host
 * @param {string} field
 * @param {Object} data payments.accountingSummary drill response
 */
function renderAccountingDrillResult(host, field, data) {
  host.replaceChildren();
  const spec = DRILLABLE_FIGURES[field];
  const rows = Array.isArray(data && data.rows) ? data.rows : [];

  // The server's own total for exactly these rows — never a client re-sum.
  const total = el("p", "drill-total");
  const period = data && data.month ? `${data.month} ${data.year}` : `${data && data.year}`;
  total.textContent = `${formatCurrency(data && data.periodTotal)} in ${period}`;
  host.appendChild(total);

  /* D4 — the year's one-time money that belongs to no month (seed money is
   * the joining stake, not a monthly obligation, so its rows carry no month).
   * Without this line a month-by-month reading of the year silently comes up
   * short and looks like missing money. Rendered BEFORE the empty-state
   * return on purpose: a month with no rows of its own still needs the
   * context, otherwise that month reads as "nothing happened all year".
   * Every amount is a server string passed straight to formatCurrency —
   * nothing is added up here. */
  const unmonthed = data && data.unmonthed;
  if (unmonthed && Array.isArray(unmonthed.byType) && unmonthed.byType.length) {
    const note = el("p", "drill-unmonthed");
    const single = unmonthed.byType.length === 1;
    const lead = single
      ? `${paymentTypeLabel(unmonthed.byType[0].type)} (one-time, not tied to a month): `
        + `${formatCurrency(unmonthed.byType[0].amount)}`
      : `One-time payments not tied to a month: ${formatCurrency(unmonthed.total)}`
        + ` — ${unmonthed.byType.map((e) => `${paymentTypeLabel(e.type)} ${formatCurrency(e.amount)}`).join(" · ")}`;
    const tail = unmonthed.includedInPeriodTotal
      ? " · included in the total above"
      : ` · not included in the ${data.month} total above`;
    note.textContent = lead + tail;
    host.appendChild(note);
  }

  if (!rows.length) {
    host.appendChild(emptyState("📭", "Nothing recorded for this period"));
    return;
  }

  const table = el("table", "table table-responsive");
  const thead = el("thead");
  const headRow = el("tr");
  for (const [, heading] of spec.columns) {
    const th = el("th");
    th.textContent = heading;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    for (const [key, heading] of spec.columns) {
      const td = el("td");
      td.dataset.label = heading;
      const raw = row[key];
      if (key === spec.money) {
        td.className = "cell-right";
        td.textContent = formatCurrency(raw);
      } else if (key === "approvedAt") {
        td.textContent = raw ? String(raw).slice(0, 10) : "—";
      } else {
        td.textContent = raw == null || raw === "" ? "—" : String(raw);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  host.appendChild(table);
}

// ── Member participation table — straight from cycle.equity, no re-derivation ──
// Renders one member as a <tr> for the .table.table-responsive component (same
// pure-CSS desktop table / mobile card collapse pattern as
// manage_loans_sql.js's createLoanRow). Carries every field the former
// participationItem() card showed: name, contributed, borrowed, interest
// paid, on-target/needs-forced-loan badge, and the conditional shortfall
// note folded into the Status cell.
function renderMemberParticipation() {
  const container = memberPerformanceEl();
  if (!container) return;
  container.textContent = "";

  renderChartContainer();

  const rows = Array.isArray(cycleEquity?.members) ? cycleEquity.members : [];
  if (rows.length === 0) {
    container.appendChild(emptyTableRow("No member equity data available", 6));
    return;
  }

  rows.forEach((row) => container.appendChild(createParticipationRow(row)));
}

function createParticipationRow(row) {
  const tr = el("tr");

  const memberCell = el("td");
  memberCell.dataset.label = "Member";
  memberCell.textContent = row.fullName || "Unknown";
  tr.appendChild(memberCell);

  const contributedCell = el("td", "cell-right");
  contributedCell.dataset.label = "Contributed";
  contributedCell.textContent = formatCurrency(row.totalContributed);
  contributedCell.style.color = "var(--bn-success)";
  tr.appendChild(contributedCell);

  const borrowedCell = el("td", "cell-right");
  borrowedCell.dataset.label = "Borrowed";
  borrowedCell.textContent = formatCurrency(row.totalBorrowed);
  tr.appendChild(borrowedCell);

  const interestPaidCell = el("td", "cell-right");
  interestPaidCell.dataset.label = "Interest Paid";
  interestPaidCell.textContent = formatCurrency(row.totalInterestPaid);
  tr.appendChild(interestPaidCell);

  // Money the member still owes in loan interest — contractually agreed,
  // not yet collected. An accountant reads this as "interest receivable".
  const interestOwed = numberOf(row.interestOwed);
  const interestOwedCell = el("td", "cell-right" + (interestOwed > 0 ? " cell-danger" : ""));
  interestOwedCell.dataset.label = "Interest Owed";
  interestOwedCell.textContent = formatCurrency(row.interestOwed);
  tr.appendChild(interestOwedCell);

  const statusCell = el("td");
  statusCell.dataset.label = "Status";
  const badge = el("span", `status-badge ${row.needsForcedLoan ? "danger" : "success"}`);
  badge.textContent = row.needsForcedLoan ? "Needs forced loan" : "On target";
  statusCell.appendChild(badge);
  if (row.needsForcedLoan) {
    const shortfallNote = el("div", "cell-danger");
    shortfallNote.textContent = `Shortfall vs target: ${formatCurrency(row.shortfallVsTarget)}`;
    statusCell.appendChild(shortfallNote);
  }
  tr.appendChild(statusCell);

  return tr;
}

/** Empty-state <tr> spanning all columns, matching manage_loans_sql.js's emptyTableRow. */
function emptyTableRow(text, colspan) {
  const row = el("tr");
  const cell = el("td");
  cell.colSpan = colspan;
  cell.dataset.label = "";
  cell.style.cssText = "text-align: center; padding: var(--bn-space-4); color: var(--bn-gray);";
  cell.textContent = text;
  row.appendChild(cell);
  return row;
}

// ── Group Health KPIs — derived from accountingSummary, no client math
// beyond simple ratios of already-server-computed totals. ──────────
function renderGroupHealth(summary) {
  if (!summary) return;

  const contributed = numberOf(summary.totalContributed);
  const disbursed = numberOf(summary.totalDisbursed);
  const interest = numberOf(summary.interestEarned);
  const penaltiesCharged = numberOf(summary.penaltiesCharged);
  const penaltiesCollected = numberOf(summary.penaltiesCollected);
  const memberCount = members.filter((m) => String(m.status) !== "inactive").length;
  const monthsCounted = Math.max(1, new Date().getMonth() + 1);

  // Collection rate: % of expected contributions that have actually been collected
  // (seed + monthly dues × months × members). Estimated expected = actual + outstanding.
  const totalExpectedMinor = contributed * 100 + numberOf(summary.outstandingLoanPrincipal) * 100; // approximation
  const collectionRate = memberCount > 0 && contributed > 0
    ? Math.min(100, Math.round((contributed / (contributed + numberOf(summary.outstandingLoanPrincipal || "0"))) * 100))
    : 0;

  // Members paying: count members with at least one settled payment
  const payingUids = new Set();
  payments
    .filter((p) => SETTLED_STATUSES.includes(p.approvalStatus))
    .forEach((p) => payingUids.add(p.uid));
  const membersPaying = payingUids.size;

  // AVG contribution per member
  const avgContribution = memberCount > 0 ? contributed / memberCount : 0;

  // Loan utilisation: what % of collected funds have been disbursed
  const loanUtilisation = contributed > 0 ? Math.round((disbursed / contributed) * 100) : 0;

  // Interest yield: interest earned as % of total loan principal
  const interestYield = disbursed > 0 ? Math.round((interest / disbursed) * 100) : 0;

  // Penalty recovery rate
  const penaltyRecovery = penaltiesCharged > 0
    ? Math.round((penaltiesCollected / penaltiesCharged) * 100)
    : 0;

  setText(document.getElementById("healthCollectionRate"), `${collectionRate}%`);
  setText(document.getElementById("healthMembersPaying"), `${membersPaying}/${memberCount}`);
  setText(document.getElementById("healthAvgContribution"), formatCurrency(avgContribution));
  setText(document.getElementById("healthLoanUtilisation"), `${loanUtilisation}%`);
  setText(document.getElementById("healthInterestYield"), `${interestYield}%`);
  setText(document.getElementById("healthPenaltyRate"), `${penaltyRecovery}%`);

  // Color-code: green for healthy, red for concerning
  const rateEl = document.getElementById("healthCollectionRate");
  if (rateEl) rateEl.className = collectionRate >= 80 ? "health-card-value pos" : collectionRate >= 50 ? "health-card-value warn" : "health-card-value neg";

  const loanEl = document.getElementById("healthLoanUtilisation");
  if (loanEl) loanEl.className = loanUtilisation <= 100 ? "health-card-value pos" : "health-card-value neg";

  const penaltyEl = document.getElementById("healthPenaltyRate");
  if (penaltyEl) penaltyEl.className = penaltyRecovery >= 70 ? "health-card-value pos" : penaltyRecovery >= 40 ? "health-card-value warn" : "health-card-value neg";
}

// ── Members to Follow Up — ranked by urgency (highest arrears + interest owed) ──
function renderFollowUpList() {
  const container = document.getElementById("followupList");
  const countEl = document.getElementById("followupCount");
  if (!container) return;

  if (!cycleEquity?.members?.length) {
    container.textContent = "";
    container.appendChild(emptyState("📊", "No member data available"));
    if (countEl) countEl.textContent = "0";
    return;
  }

  // Pick members with anything outstanding: arrears from obligations + interest owed on loans
  const flagged = [];
  for (const row of cycleEquity.members) {
    const arrears = liveArrearsForMember(row.uid);
    const interestOwed = numberOf(row.interestOwed || "0");
    const totalOwed = arrears + interestOwed;
    if (totalOwed > 0) {
      flagged.push({
        name: row.fullName || "Unknown",
        uid: row.uid,
        arrears,
        interestOwed,
        totalOwed,
      });
    }
  }

  flagged.sort((a, b) => b.totalOwed - a.totalOwed);

  container.textContent = "";
  if (countEl) countEl.textContent = String(flagged.length);

  if (flagged.length === 0) {
    container.appendChild(emptyState("✅", "All members are up to date — nothing to follow up"));
    return;
  }

  const list = el("div");
  flagged.slice(0, 10).forEach((f) => {
    const item = el("div", "followup-item");
    const info = el("div");
    const name = el("div", "followup-name");
    name.textContent = f.name;
    const detail = el("div", "followup-detail");
    const parts = [];
    if (f.arrears > 0) parts.push(`${formatCurrency(f.arrears)} arrears`);
    if (f.interestOwed > 0) parts.push(`${formatCurrency(f.interestOwed)} interest owed`);
    detail.textContent = parts.join(" · ");
    info.append(name, detail);

    const amount = el("div", "followup-amount");
    amount.textContent = formatCurrency(f.totalOwed);

    item.append(info, amount);
    list.appendChild(item);
  });
  container.appendChild(list);

  if (flagged.length > 10) {
    const more = el("div");
    more.style.cssText = "text-align: center; padding: var(--bn-space-3); color: var(--bn-gray); font-size: var(--bn-text-sm);";
    more.textContent = `+${flagged.length - 10} more members to follow up`;
    container.appendChild(more);
  }
}

/** Sum live arrears for a single member from the pre-loaded liveArrears data. */
function liveArrearsForMember(uid) {
  // Reuse the live-arrairs snapshot loaded in loadLiveArrears — we need
  // per-member granularity. Since we already fetch per-member obligations
  // there, store the per-member totals.
  let total = 0;
  // Use the existing members array and the pre-computed values.
  // For now, use cycleEquity which already has totalContributed and shortfall.
  const memberRow = cycleEquity?.members?.find((m) => String(m.uid) === String(uid));
  if (memberRow) {
    // shortfallVsTarget is what they're behind on contributions
    total += numberOf(memberRow.shortfallVsTarget || "0");
  }
  total += numberOf(memberRow?.interestOwed || "0");
  return total;
}

// ── Card-info popovers ──────────────────────────────────────────────────────
// Page-local adaptation of admin_dashboard_sql.js's setupStatCardPopovers
// (not imported — that mechanism is hard-scoped to admin_dashboard's
// .stat-card-wrap and is left untouched). Attaches a small "i" toggle +
// popover to a positioned card ancestor (.page-stat or .breakdown-card, both
// given `position: relative` in analytics.html's inline <style>).
const STATIC_TILE_INFO = [
  ["totalIncome", "Total Income",
    "Settled member contributions plus loan interest earned — the money flowing into the group this period."],
  ["totalExpenses", "Total Expenses",
    "Loan principal disbursed to members (approved, disbursed, completed and defaulted loans)."],
  ["netProfit", "Net Profit",
    "Total income minus loans disbursed — the group's net position for the period."],
  ["loanInterest", "Loan Interest",
    "Interest paid into the group's interest pool from loan repayments this cycle."],
];

/**
 * Attach the "i" info affordance to a card.
 *
 * Delegates to the SHARED card_info module, which renders the panel on
 * <body> rather than inside the card. The previous in-card implementation was
 * clipped by ancestor overflow (the stat row and chart grid scroll) and
 * trapped by the cards' hover transform, which creates a containing block
 * that even position:fixed cannot escape — so the panel was cut off.
 * @param {HTMLElement} cardEl the card to attach to
 * @param {string} infoText plain-text explanation
 * @param {string} ariaLabel accessible name for the toggle
 */
function attachCardPopover(cardEl, infoText, ariaLabel, cardTitle) {
  if (!cardEl || !infoText) return;
  // Routed through the shared infoContent() so these panels carry the same
  // title-then-explanation structure as every other "i" button in the app,
  // instead of opening as one unlabelled paragraph.
  const title = cardTitle
    || cardEl.querySelector(".breakdown-card-title, .page-stat-label, .stat-label")?.textContent?.trim()
    || "";
  attachCardInfo(cardEl, {
    label: ariaLabel,
    content: infoContent({title, description: infoText}),
  });
}

/**
 * One-shot init: attach the "i" popover to each of the 4 static summary
 * tiles. Display/affordance only — no data dependency, safe to run before
 * any group is selected.
 */
function initStaticStatPopovers() {
  STATIC_TILE_INFO.forEach(([id, label, infoText]) => {
    const valueEl = document.getElementById(id);
    const wrap = valueEl?.closest(".page-stat");
    if (!wrap) return;
    attachCardPopover(wrap, infoText, `${label} explanation`);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function emptyState(icon, text) {
  const wrap = el("div", "empty-state");
  const i = el("div", "empty-state-icon");
  i.textContent = icon;
  const p = el("p", "empty-state-text");
  p.textContent = text;
  wrap.append(i, p);
  return wrap;
}

function numberOf(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function setText(node, value) {
  if (node) node.textContent = value;
}

function showSpinner(show) {
  const node = spinner();
  if (node) node.classList.toggle("hidden", !show);
}

function handleApiError(error, fallback) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      redirectToLogin();
      return;
    }
    if (error.status === 403) {
      showToast("You do not have permission to view this.", "error");
      return;
    }
    showToast(error.message || fallback, "error");
    return;
  }
  console.error(fallback, error);
  showToast(fallback, "error");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) {
    console.log(`[${type}] ${message}`);
    return;
  }
  const toast = el("div", `toast toast-${type}`);
  const span = document.createElement("span");
  span.textContent = message;
  const close = el("button", "toast-close");
  close.innerHTML = "&times;"; // static entity only, no user data
  close.addEventListener("click", () => toast.remove());
  toast.append(span, close);
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
