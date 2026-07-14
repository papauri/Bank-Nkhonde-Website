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
 * DEFERRED (toast + reported, never invented):
 *   - PDF export (the original built a print window from client-composed
 *     HTML strings using innerHTML with server-sourced names/amounts — that
 *     pattern is exactly the XSS risk this port must not carry over, and
 *     there is no reports.export/download endpoint to redirect to instead).
 *   - Excel/CSV export (same reasoning — no export endpoint exists; the
 *     original built the CSV entirely client-side from Firestore data with
 *     no server involvement at all).
 *   - Emailing a report to members (no reports.email / mail-merge endpoint).
 *   - Scheduled/automated monthly reports (no scheduling endpoint).
 *   - Quarterly/Annual tab granularity — the original had no distinct data
 *     source for these even under Firebase; wiring them would need a
 *     payments.list date-range parameter beyond the existing `year` filter.
 */

import {apiGet, requireSession, listMyGroups, ApiError} from "./api.js";

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
/** uid -> obligations response (payments.obligations), live snapshot. */
let obligationsByUid = new Map();

const groupSelector = () => document.getElementById("groupSelector");
const totalIncomeEl = () => document.getElementById("totalIncome");
const totalDisbursementsEl = () => document.getElementById("totalDisbursements");
const netPositionEl = () => document.getElementById("netPosition");
const outstandingLoansEl = () => document.getElementById("outstandingLoans");
const detailedReportEl = () => document.getElementById("detailedReport");
const downloadBtn = () => document.getElementById("downloadBtn");
const exportBtn = () => document.getElementById("exportBtn");
const spinner = () => document.getElementById("spinner");

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();

  try {
    currentUser = await requireSession(); // redirects to login on 401
  } catch (error) {
    handleApiError(error, "Could not verify your session.");
    return;
  }

  await loadAdminGroups();
});

function setupEventListeners() {
  groupSelector()?.addEventListener("change", async (e) => {
    currentGroupId = e.target.value;
    currentGroupName = e.target.selectedOptions?.[0]?.textContent || "";
    if (currentGroupId) {
      sessionStorage.setItem("selectedGroupId", currentGroupId);
      await loadReportData();
    }
  });

  // No export endpoint exists yet — see DEFERRED note in the file header.
  // Never re-implement the original's client-composed-HTML print/CSV flow;
  // that pattern is the exact XSS risk this port must not carry over.
  downloadBtn()?.addEventListener("click", () => {
    showToast("PDF export is not available yet — it needs a reports.export endpoint.", "info");
  });
  exportBtn()?.addEventListener("click", () => {
    showToast("Report export is not available yet — it needs a reports.export endpoint.", "info");
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
      if (currentGroupId) await loadReportData();
    });
  });
}

async function loadAdminGroups() {
  showSpinner(true);
  try {
    const groups = await listMyGroups();
    const adminGroups = groups.filter((g) => REPORT_ADMIN_ROLES.includes(g.role));

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

    renderSummaryTiles();
    renderDetailedReport();
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
  } catch (error) {
    loans = [];
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

// ── Summary tiles (sums of already-server-computed figures only) ──────────
function renderSummaryTiles() {
  const settled = payments.filter((p) => SETTLED_STATUSES.includes(p.approvalStatus));
  // Interest counts as income on any loan whose money actually went out (same
  // status set as disbursements — 'active' is not a status this schema has).
  const totalIncome = settled.reduce((sum, p) => sum + numberOf(p.amountPaid), 0)
    + loans
      .filter((l) => DISBURSED_LOAN_STATUSES.includes(l.status))
      .reduce((sum, l) => sum + numberOf(l.totalInterest), 0);

  const totalDisbursements = loans
    .filter((l) => DISBURSED_LOAN_STATUSES.includes(l.status))
    .reduce((sum, l) => sum + numberOf(l.principalAmount ?? l.approvedAmount), 0);

  const netPosition = totalIncome - totalDisbursements;

  const outstandingLoans = loans
    .filter((l) => DISBURSED_LOAN_STATUSES.includes(l.status))
    .reduce((sum, l) => sum + numberOf(l.remainingBalance), 0);

  setText(totalIncomeEl(), formatCurrency(totalIncome));
  setText(totalDisbursementsEl(), formatCurrency(totalDisbursements));
  setText(netPositionEl(), formatCurrency(netPosition));
  setText(outstandingLoansEl(), formatCurrency(outstandingLoans));
}

// ── Detailed report: per-member contribution standing + loan summary ──────
function renderDetailedReport() {
  const container = detailedReportEl();
  if (!container) return;
  container.textContent = "";

  container.appendChild(reportHeader());
  container.appendChild(memberContributionsSection());
  container.appendChild(loanSummarySection());
  container.appendChild(exportNotice());
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

function exportNotice() {
  const note = document.createElement("p");
  note.className = "cell-muted";
  note.textContent = "PDF/Excel export is not available yet.";
  return note;
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

function formatCurrency(amount) {
  return `MWK ${numberOf(amount).toLocaleString("en-US", {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;
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
      window.location.replace("/login.html");
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
