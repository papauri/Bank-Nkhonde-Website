/**
 * financial_reports_sql.js — SQL port of financial_reports.js (the
 * treasurer's report: money in, money out, outstanding balances, and
 * per-member standing — mirrors the group's real monthly report). Not wired
 * into any page until the cutover — see BUILD_PLAN.md.
 *
 * HARD RULE: no client-side money math beyond simple summation of
 * already-server-computed figures. Every arrears/interest/repayment/balance
 * figure comes straight from the API. This file only SUMS server-returned
 * decimal strings for report totals — it never derives a new financial
 * figure (no interest, no penalty, no "amount due" calculation happens here).
 *
 * ENDPOINT CONTRACT (verified by reading api/handlers/payments.php,
 * api/handlers/loans.php directly):
 *   groups.mine          -> via listMyGroups(); filtered to
 *                           admin/senior_admin/treasurer (this is the
 *                           treasurer's report).
 *   members.list          -> GET, {groupId} -> {members:[{uid, fullName, ...}]}.
 *   payments.list         -> GET, {groupId[, year]} -> {payments:[...]}. Only
 *                           approved/completed rows are counted as real money
 *                           IN — a pending claim is never counted as income.
 *   payments.obligations  -> GET, {groupId, uid} -> per-member live arrears
 *                           (incl. penalty) — used ONLY to show "who has not
 *                           paid" per member, exactly as
 *                           contributions_overview_sql.js does. Never
 *                           recomputed, read verbatim.
 *   loans.list            -> GET, {groupId} -> {loans:[...]}
 *                           (principalAmount, totalInterest, amountRepaid,
 *                           remainingBalance, status). Money OUT = principal
 *                           disbursed; outstanding balances = remainingBalance,
 *                           both server-computed, summed here only.
 *
 * EXPORT: #exportBtn triggers a server-generated CSV via the
 * exports.report GET endpoint (downloadExport() in api.js — anchor-click
 * browser download, no client-side CSV composition, no innerHTML).
 *
 * DEFERRED (toast + reported, never invented):
 *   - PDF export (the original built a print window from client-composed
 *     HTML strings using innerHTML with server-sourced names/amounts — that
 *     pattern is exactly the XSS risk this port must not carry over; the
 *     CSV export above is the only export endpoint that exists today).
 *   - Emailing a report to members (no reports.email / mail-merge endpoint).
 *   - Scheduled/automated monthly reports (no scheduling endpoint).
 *   - Quarterly/Annual tab granularity — the original had no distinct data
 *     source for these even under Firebase; wiring them would need a
 *     payments.list date-range parameter beyond the existing `year` filter.
 */

import {apiGet, requireSession, listMyGroups, ApiError, redirectToLogin, downloadExport} from "./api.js";
import { formatCurrency } from "./utils_financial.js";

const REPORT_ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];
const SETTLED_STATUSES = ["approved", "completed"];
/**
 * Loan statuses where the money HAS LEFT THE BOX.
 *
 * The DB enum is: pending | approved | rejected | disbursed | completed | defaulted.
 * There is no 'active' status — and `loans.approve` sets 'approved' (nothing in the
 * API ever sets 'disbursed'), so omitting 'approved' here would report the group's
 * total loaned-out as ZERO. 'defaulted' counts too: the cash still went out, and a
 * report that hides defaults understates what the group is owed.
 */
const DISBURSED_LOAN_STATUSES = ["approved", "disbursed", "completed", "defaulted"];

let currentUser = null;
let currentGroupId = null;
let currentGroupName = "";
let members = [];
let payments = [];
let loans = [];
/** loans.list's server-computed `summary` block (ALL-loan-rows scope). */
let loansSummary = null;
/** uid -> obligations response (payments.obligations), live snapshot. */
let obligationsByUid = new Map();
/** payments.accountingSummary response — the group's money-accurate position. */
let accountingSummary = null;

const groupSelector = () => document.getElementById("groupSelector");
const totalIncomeEl = () => document.getElementById("totalIncome");
const totalDisbursementsEl = () => document.getElementById("totalDisbursements");
const netPositionEl = () => document.getElementById("netPosition");
const outstandingLoansEl = () => document.getElementById("outstandingLoans");
const detailedReportEl = () => document.getElementById("detailedReport");
const accountingSummaryBodyEl = () => document.getElementById("accountingSummaryBody");
const exportBtn = () => document.getElementById("exportBtn");
const spinner = () => document.getElementById("spinner");
const statementMemberSelectEl = () => document.getElementById("statementMemberSelect");
const statementExportBtnEl = () => document.getElementById("statementExportBtn");
const statementContributionsEl = () => document.getElementById("statementContributions");
const statementLoanAccountEl = () => document.getElementById("statementLoanAccount");
const statementPenaltiesEl = () => document.getElementById("statementPenalties");

/**
 * Router-compatible entry point. Body is identical to the former
 * DOMContentLoaded handler; the SPA router (scripts/spa-router.js) calls this
 * directly after every content swap, and the guarded bootstrap below covers
 * a normal hard page load.
 * @return {Promise<void>}
 */
export async function init() {
  setupEventListeners();

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
  groupSelector()?.addEventListener("change", async (e) => {
    currentGroupId = e.target.value;
    currentGroupName = e.target.selectedOptions?.[0]?.textContent || "";
    if (currentGroupId) {
      sessionStorage.setItem("selectedGroupId", currentGroupId);
      await loadReportData();
    }
  });

  // #downloadBtn does not exist in pages/financial_reports.html — the real
  // control is #exportBtn, wired here to the server-generated CSV
  // (exports.report) via downloadExport() — no client-side CSV composition.
  exportBtn()?.addEventListener("click", () => {
    if (!currentGroupId) {
      showToast("Select a group first", "info");
      return;
    }
    downloadExport("exports.report", {groupId: currentGroupId});
  });

  // Admin per-member Account Statement: uses the members array already loaded
  // by loadMembers() for this group — populateStatementMemberSelect() fills
  // #statementMemberSelect from that same `members` module var.
  statementMemberSelectEl()?.addEventListener("change", (e) => {
    loadMemberStatement(e.target.value);
  });

  statementExportBtnEl()?.addEventListener("click", () => {
    if (!currentGroupId) {
      showToast("Select a group first", "info");
      return;
    }
    const uid = statementMemberSelectEl()?.value;
    if (!uid) {
      showToast("Select a member first", "info");
      return;
    }
    downloadExport("exports.statement", {groupId: currentGroupId, uid});
  });

  // Monthly/Quarterly/Annual tabs: no distinct data source exists yet (see
  // DEFERRED note) — every tab reloads the same monthly report rather than
  // silently doing nothing.
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      if (tab.textContent?.trim() !== "Monthly") {
        showToast("Quarterly/Annual breakdowns are not available yet — showing the monthly report.", "info");
      }
      if (currentGroupId) {
        await loadReportData();
        document.getElementById("detailedReport")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

async function loadAdminGroups() {
  showSpinner(true);
  try {
    const groups = await listMyGroups();
    const adminGroups = groups.filter((g) => REPORT_ADMIN_ROLES.includes(g.myRole));

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
    currentGroupName = chosen.groupName || chosen.name || "";
    if (selector) selector.value = currentGroupId;
    sessionStorage.setItem("selectedGroupId", currentGroupId);

    await loadReportData();
  } catch (error) {
    handleApiError(error, "Failed to load groups");
  } finally {
    showSpinner(false);
  }
}

async function loadReportData() {
  if (!currentGroupId) return;
  showSpinner(true);
  try {
    await loadMembers();
    await loadPayments();
    await loadLoans();
    await loadLiveObligations();
    await loadAccountingSummary();

    renderSummaryTiles();
    renderAccountingSummary();
    renderDetailedReport();
    populateStatementMemberSelect();
  } catch (error) {
    handleApiError(error, "Failed to load report data");
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

/** Live per-member arrears snapshot — "who has not paid", server-computed. */
async function loadLiveObligations() {
  obligationsByUid = new Map();
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
    members.forEach((m, index) => obligationsByUid.set(m.uid, results[index]));
  } catch (error) {
    console.error("Failed to load live obligations", error);
  }
}

/**
 * The group's money-accurate position — every figure server-computed, no
 * client-side aggregation. Failure here must never block the rest of the
 * report; the summary tiles/section simply show a muted note.
 */
async function loadAccountingSummary() {
  try {
    accountingSummary = await apiGet("payments.accountingSummary", {groupId: currentGroupId});
  } catch (error) {
    accountingSummary = null;
    handleApiError(error, "Failed to load accounting summary");
  }
}

/** Sum of a member's live arrears across seed money, service fee and every month. */
function liveArrearsFor(uid) {
  const obligations = obligationsByUid.get(uid);
  if (!obligations) return 0;
  let total = numberOf(obligations.seedMoney?.arrears) + numberOf(obligations.serviceFee?.arrears);
  const months = obligations.monthlyContributions?.months;
  if (Array.isArray(months)) {
    months.forEach((m) => {
      total += numberOf(m.arrears);
    });
  }
  return total;
}

// ── Summary tiles (each figure a single server field — no client math) ────
function renderSummaryTiles() {
  if (!accountingSummary) {
    // Server figure unavailable — leave tiles showing their last-known/default
    // value rather than inventing a client-computed number.
    return;
  }
  setText(totalIncomeEl(), formatCurrency(accountingSummary.totalContributed));
  setText(totalDisbursementsEl(), formatCurrency(accountingSummary.totalDisbursed));
  setText(netPositionEl(), formatCurrency(accountingSummary.cashPosition));
  setText(outstandingLoansEl(), formatCurrency(accountingSummary.outstandingLoanPrincipal));
}

// ── Group Accounting: full authoritative breakdown, one row per server
// field — no client-side aggregation, no innerHTML. ───────────────────────
function renderAccountingSummary() {
  const tbody = accountingSummaryBodyEl();
  if (!tbody) return;
  tbody.textContent = "";

  if (!accountingSummary) {
    const row = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 2;
    td.appendChild(emptyState("📊", "Accounting summary unavailable right now"));
    row.appendChild(td);
    tbody.appendChild(row);
    return;
  }

  const rows = [
    {label: "Total Contributed", key: "totalContributed"},
    {label: "Total Disbursed", key: "totalDisbursed"},
    {label: "Outstanding Loan Principal", key: "outstandingLoanPrincipal"},
    {label: "Interest Earned", key: "interestEarned"},
    {label: "Loan Repayments Received", key: "loanRepaymentsReceived"},
    {label: "Penalties Charged", key: "penaltiesCharged", group: true},
    {label: "Penalties Collected", key: "penaltiesCollected", group: true},
    {label: "Penalties Waived", key: "penaltiesWaived", group: true},
    {label: "Penalties Outstanding", key: "penaltiesOutstanding", group: true},
    {label: "Cash Position", key: "cashPosition", emphasis: true},
  ];

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (row.group) tr.className = "cell-muted";

    const labelTd = document.createElement("td");
    labelTd.dataset.label = "Figure";
    labelTd.textContent = row.label;
    tr.appendChild(labelTd);

    const valueTd = document.createElement("td");
    valueTd.dataset.label = "Amount (MWK)";
    valueTd.className = row.emphasis ? "cell-right cell-nowrap text-emphasis" : "cell-right cell-nowrap";
    valueTd.textContent = formatCurrency(accountingSummary[row.key]);
    tr.appendChild(valueTd);

    tbody.appendChild(tr);
  });
}

// ── Detailed report: per-member contribution standing + loan summary ──────
function renderDetailedReport() {
  const container = detailedReportEl();
  if (!container) return;
  container.textContent = "";

  container.appendChild(reportHeader());
  container.appendChild(memberContributionsSection());
  container.appendChild(loanSummarySection());
}

function reportHeader() {
  const header = el("div", "report-header");
  const title = el("h3");
  title.textContent = currentGroupName ? `${currentGroupName} — Financial Report` : "Financial Report";
  const generated = document.createElement("p");
  generated.className = "cell-muted";
  generated.textContent = `Generated: ${new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  })}`;
  header.append(title, generated);
  return header;
}

function memberContributionsSection() {
  const section = el("div");
  const heading = el("h4");
  heading.textContent = "Member Contributions";
  section.appendChild(heading);

  if (members.length === 0) {
    section.appendChild(emptyState("👥", "No members in this group yet"));
    return section;
  }

  const rows = members.map((member) => {
    const memberPayments = payments.filter(
      (p) => p.uid === member.uid && SETTLED_STATUSES.includes(p.approvalStatus),
    );
    const totalPaid = memberPayments.reduce((sum, p) => sum + numberOf(p.amountPaid), 0);
    const arrears = liveArrearsFor(member.uid);
    return {
      name: member.fullName || "Unknown",
      totalPaid,
      arrears,
      paying: arrears <= 0 && totalPaid > 0,
    };
  });

  const table = document.createElement("table");
  table.className = "table table-responsive";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Member", "Total Paid (MWK)", "Outstanding (MWK)", "Standing"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  let totalPaidSum = 0;
  let arrearsSum = 0;

  rows.forEach((row) => {
    totalPaidSum += row.totalPaid;
    arrearsSum += row.arrears;

    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.dataset.label = "Member";
    nameTd.className = "cell-name";
    nameTd.textContent = row.name;
    tr.appendChild(nameTd);

    tr.appendChild(moneyCell("Total Paid", row.totalPaid, "cell-success"));
    tr.appendChild(moneyCell("Outstanding", row.arrears, row.arrears > 0 ? "cell-danger" : "cell-success"));

    const standingTd = document.createElement("td");
    standingTd.dataset.label = "Standing";
    const badge = el("span", `status-badge ${row.paying ? "completed" : "unpaid"}`);
    badge.textContent = row.paying ? "Up to date" : "Behind";
    standingTd.appendChild(badge);
    tr.appendChild(standingTd);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const tfoot = document.createElement("tfoot");
  const totalRow = document.createElement("tr");
  const totalLabel = document.createElement("td");
  totalLabel.textContent = "TOTAL";
  totalRow.appendChild(totalLabel);
  totalRow.appendChild(moneyCell("Total Paid", totalPaidSum));
  totalRow.appendChild(moneyCell("Outstanding", arrearsSum));
  const blankTd = document.createElement("td");
  totalRow.appendChild(blankTd);
  tfoot.appendChild(totalRow);
  table.appendChild(tfoot);

  section.appendChild(table);
  return section;
}

function loanSummarySection() {
  const section = el("div");
  const heading = el("h4");
  heading.textContent = "Loan Summary";
  section.appendChild(heading);

  if (loans.length === 0) {
    section.appendChild(emptyState("💰", "No loans recorded"));
    return section;
  }

  const table = document.createElement("table");
  table.className = "table table-responsive";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Borrower", "Principal (MWK)", "Interest (MWK)", "Repaid (MWK)", "Remaining (MWK)", "Status"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  loans.forEach((loan) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.dataset.label = "Borrower";
    nameTd.className = "cell-name";
    nameTd.textContent = loan.borrowerName || "Unknown";
    tr.appendChild(nameTd);

    tr.appendChild(moneyCell("Principal", numberOf(loan.principalAmount ?? loan.approvedAmount)));
    tr.appendChild(moneyCell("Interest", numberOf(loan.totalInterest)));
    tr.appendChild(moneyCell("Repaid", numberOf(loan.amountRepaid), "cell-success"));
    tr.appendChild(moneyCell("Remaining", numberOf(loan.remainingBalance), "cell-danger"));

    const statusTd = document.createElement("td");
    statusTd.dataset.label = "Status";
    const statusClass = loan.status === "completed" ? "success" : loan.status === "active" || loan.status === "disbursed" ? "info" : "warning";
    const badge = el("span", `badge badge-${statusClass}`);
    badge.textContent = loan.status || "unknown";
    statusTd.appendChild(badge);
    tr.appendChild(statusTd);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

// ── Admin per-member Account Statement ─────────────────────────────────────
/**
 * Fills #statementMemberSelect from the module-level `members` array
 * (already loaded by loadMembers() for the current group — see line ~213)
 * and resets the picker + ledger sections whenever the group changes.
 */
function populateStatementMemberSelect() {
  const select = statementMemberSelectEl();
  if (!select) return;
  select.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a member…";
  select.appendChild(placeholder);

  members.forEach((member) => {
    const option = document.createElement("option");
    option.value = member.uid;
    option.textContent = member.fullName || "Unknown";
    select.appendChild(option);
  });
  select.value = "";
  clearStatementSections();
}

function clearStatementSections() {
  [statementContributionsEl(), statementLoanAccountEl(), statementPenaltiesEl()].forEach((container) => {
    if (!container) return;
    container.textContent = "";
    container.appendChild(emptyState("📄", "Select a member to view their statement"));
  });
}

async function loadMemberStatement(uid) {
  if (!currentGroupId || !uid) {
    clearStatementSections();
    return;
  }
  showSpinner(true);
  try {
    const data = await apiGet("statement.get", {groupId: currentGroupId, uid});
    renderContributionsLedger(data?.contributions);
    renderLoanAccountLedger(data?.loanAccount);
    renderPenaltiesLedger(data?.penalties);
  } catch (error) {
    clearStatementSections();
    handleApiError(error, "Failed to load member statement");
  } finally {
    showSpinner(false);
  }
}

function buildLedgerTable(headers) {
  const wrapper = el("div", "table-container");
  const table = el("table", "table table-responsive");
  const thead = el("thead");
  const headRow = el("tr");
  headers.forEach((h) => {
    const th = el("th");
    th.textContent = h;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  const tbody = el("tbody");
  table.append(thead, tbody);
  wrapper.appendChild(table);
  return {wrapper, tbody};
}

function ledgerCell(label, text) {
  const td = el("td");
  td.setAttribute("data-label", label);
  td.textContent = text;
  return td;
}

function renderContributionsLedger(contributions) {
  const container = statementContributionsEl();
  if (!container) return;
  container.textContent = "";

  const lines = Array.isArray(contributions?.lines) ? contributions.lines : [];
  const {wrapper, tbody} = buildLedgerTable(["Date", "Type", "Description", "Amount", "Running Balance"]);

  if (lines.length === 0) {
    const row = el("tr");
    const td = ledgerCell("Status", "No entries");
    td.colSpan = 5;
    row.appendChild(td);
    tbody.appendChild(row);
  } else {
    lines.forEach((line) => {
      const row = el("tr");
      row.appendChild(ledgerCell("Date", formatDateLabel(line.date)));
      row.appendChild(ledgerCell("Type", line.type || ""));
      row.appendChild(ledgerCell("Description", line.description || ""));
      row.appendChild(ledgerCell("Amount", formatCurrency(line.amount)));
      row.appendChild(ledgerCell("Running Balance", formatCurrency(line.runningBalance)));
      tbody.appendChild(row);
    });
    const footerRow = el("tr");
    const labelCell = ledgerCell("Total", "Total");
    labelCell.colSpan = 3;
    footerRow.appendChild(labelCell);
    footerRow.appendChild(ledgerCell("Amount", ""));
    footerRow.appendChild(ledgerCell("Running Balance", formatCurrency(contributions?.total)));
    tbody.appendChild(footerRow);
  }

  container.appendChild(wrapper);
}

function renderLoanAccountLedger(loanAccount) {
  const container = statementLoanAccountEl();
  if (!container) return;
  container.textContent = "";

  const lines = Array.isArray(loanAccount?.lines) ? loanAccount.lines : [];
  const {wrapper, tbody} = buildLedgerTable(["Date", "Event", "Loan", "Amount", "Running Outstanding"]);

  if (lines.length === 0) {
    const row = el("tr");
    const td = ledgerCell("Status", "No entries");
    td.colSpan = 5;
    row.appendChild(td);
    tbody.appendChild(row);
  } else {
    lines.forEach((line) => {
      const row = el("tr");
      row.appendChild(ledgerCell("Date", formatDateLabel(line.date)));
      row.appendChild(ledgerCell("Event", line.event || ""));
      row.appendChild(ledgerCell("Loan", line.loanNumber || ""));
      row.appendChild(ledgerCell("Amount", formatCurrency(line.amount)));
      row.appendChild(ledgerCell("Running Outstanding", formatCurrency(line.runningOutstanding)));
      tbody.appendChild(row);
    });
    const footerRow = el("tr");
    const labelCell = ledgerCell("Outstanding", "Outstanding");
    labelCell.colSpan = 4;
    footerRow.appendChild(labelCell);
    footerRow.appendChild(ledgerCell("Running Outstanding", formatCurrency(loanAccount?.outstanding)));
    tbody.appendChild(footerRow);
  }

  container.appendChild(wrapper);
}

function renderPenaltiesLedger(penalties) {
  const container = statementPenaltiesEl();
  if (!container) return;
  container.textContent = "";

  const lines = Array.isArray(penalties?.lines) ? penalties.lines : [];
  const {wrapper, tbody} = buildLedgerTable(["Date", "Event", "Amount", "Context"]);

  if (lines.length === 0) {
    const row = el("tr");
    const td = ledgerCell("Status", "No entries");
    td.colSpan = 4;
    row.appendChild(td);
    tbody.appendChild(row);
  } else {
    lines.forEach((line) => {
      const row = el("tr");
      row.appendChild(ledgerCell("Date", formatDateLabel(line.date)));
      row.appendChild(ledgerCell("Event", line.event || ""));
      row.appendChild(ledgerCell("Amount", formatCurrency(line.amount)));
      row.appendChild(ledgerCell("Context", line.context || ""));
      tbody.appendChild(row);
    });
    const footerRow = el("tr");
    footerRow.appendChild(ledgerCell("Charged", `Charged: ${formatCurrency(penalties?.totalCharged)}`));
    footerRow.appendChild(ledgerCell("Waived", `Waived: ${formatCurrency(penalties?.totalWaived)}`));
    footerRow.appendChild(ledgerCell("Net", `Net: ${formatCurrency(penalties?.net)}`));
    const spacer = ledgerCell("", "");
    footerRow.appendChild(spacer);
    tbody.appendChild(footerRow);
  }

  container.appendChild(wrapper);
}

function formatDateLabel(value) {
  if (!value) return "N/A";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}

function moneyCell(label, amount, cssClass) {
  const td = document.createElement("td");
  td.dataset.label = label;
  td.className = cssClass ? `cell-right cell-nowrap ${cssClass}` : "cell-right cell-nowrap";
  td.textContent = numberOf(amount).toLocaleString();
  return td;
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
