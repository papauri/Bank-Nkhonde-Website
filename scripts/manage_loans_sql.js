/**
 * manage_loans_sql.js — SQL port of manage_loans.js (the LIVE admin
 * loan-management page, Firebase). Ported to the PHP + MySQL API. Zero
 * Firebase imports. Not wired into a page until the cutover — see
 * BUILD_PLAN.md.
 *
 * HARD RULE: no client-side money math. The server (api/lib/money.php via
 * loans.approve / loans.force / repayments.record / repayments.approve) owns
 * ALL interest, penalty, schedule and balance arithmetic. This file only
 * displays numbers the API already returns (loan.totalInterest,
 * loan.totalRepayment, loan.amountRepaid, loan.remainingBalance).
 *
 * Approve/disburse collapse: loans.approve builds the full repayment
 * schedule and prices the loan in one transactional call. There is no
 * separate loans.disburse endpoint, so the original two-step
 * "Approve" -> "Disburse" UI collapses into a single "Approve" action here.
 * The resulting loan status is 'approved' (per the loans table ENUM:
 * pending/approved/rejected/disbursed/completed/defaulted) and is
 * immediately payable — repayments.record/approve accept status IN
 * ('approved','disbursed'). The 'disbursed' status has no endpoint that
 * ever sets it, so the "Disbursed" tab is kept (matching the shared markup)
 * but is structurally always empty on this system.
 *
 * WIRED (cycle 3): loan settings (rules.get/rules.update), forced-loans
 * config + preview (rules.update + cycle.forced.preview), the pending loan
 * PAYMENTS review queue (repayments.pending/.approve/.reject), and bulk
 * reminders (reminders.send). See each section below for endpoint contracts.
 *
 * KNOWN MARKUP/CONTRACT MISMATCHES (page markup is out of scope for this
 * file — flagged for a follow-up brief rather than silently patched):
 *   - #loanSettingsForm has no inputs for contributionPenaltyDailyAmount,
 *     seedMoneyAmount, monthlyContributionAmount or serviceFeeAmount, so
 *     those group_rules fields cannot be viewed/edited from this modal.
 *   - #loanPenaltyRate is labelled "Late Payment Penalty (%)" but is wired to
 *     loanPenaltyDailyAmount (a flat daily amount, not a percentage) because
 *     it is the only penalty field the markup exposes.
 *   - #forcedLoansMethod offers match_highest/match_average/
 *     percentage_of_highest; the server only supports 'fixed_amount' (target
 *     = loanRulesMinCycleLoanAmount) or 'percentage_of_highest'. Both
 *     match_highest and match_average are sent as 'fixed_amount'.
 *   - #reminderRecipient offers all_overdue/all_active/specific; the server
 *     only supports 'all'/'specific'. Both all_* options are sent as 'all'
 *     (the overdue/active distinction is lost server-side).
 */

import {
  apiGet,
  apiPost,
  requireSession,
  listMyGroups,
  ApiError,
  redirectToLogin,
} from "./api.js";
import { formatCurrency } from "./utils_financial.js";

// ── Global state ────────────────────────────────────────────────────────────
let currentUser = null;
let selectedGroupId = null;
let adminGroups = [];
let members = [];
let loans = [];
let currentTab = "pending";
let groupRules = null;
let pendingPayments = [];

// ── DOM elements (IDs kept identical to the Firebase original) ─────────────
const groupSelector = () => document.getElementById("groupSelector");
const loansContainer = () => document.getElementById("loansContainer");
const pendingCountEl = () => document.getElementById("pendingCount");
const activeCountEl = () => document.getElementById("activeCount");
const totalDisbursedEl = () => document.getElementById("totalDisbursed");
const totalOutstandingEl = () => document.getElementById("totalOutstanding");
const spinner = () => document.getElementById("spinner");

// ── Init ─────────────────────────────────────────────────────────────────────
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
  const selector = groupSelector();
  if (selector) {
    selector.addEventListener("change", async (e) => {
      selectedGroupId = e.target.value;
      if (selectedGroupId) {
        sessionStorage.setItem("selectedGroupId", selectedGroupId);
        await loadGroupData();
      }
    });
  }

  // pages/manage_loans.html has no refresh control (confirmed — no
  // #refreshBtn or equivalent anywhere in the markup). Left as a safe no-op
  // optional-chained lookup rather than fabricating a target; group data is
  // already reloaded via the group selector's change handler above.
  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    if (selectedGroupId) await loadGroupData();
  });

  document.querySelectorAll(".action-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".action-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentTab = tab.dataset.tab;

      const filterDropdown = document.getElementById("loanFilterDropdown");
      if (filterDropdown && filterDropdown.value !== "all") {
        filterDropdown.value = currentTab;
      }

      renderLoans();
    });
  });

  const loanFilterDropdown = document.getElementById("loanFilterDropdown");
  if (loanFilterDropdown) {
    loanFilterDropdown.addEventListener("change", (e) => {
      if (e.target.value !== "all") {
        currentTab = e.target.value;
        document.querySelectorAll(".action-tab").forEach((t) => {
          t.classList.remove("active");
          if (t.dataset.tab === currentTab) t.classList.add("active");
        });
      }
      renderLoans();
    });
  }

  document.getElementById("borrowerFilterDropdown")?.addEventListener("change", renderLoans);

  document.getElementById("newLoanBtn")?.addEventListener("click", () => openNewLoanModal());
  document.getElementById("recordPaymentBtn")?.addEventListener("click", () => openRecordPaymentModal());
  document.getElementById("loanSettingsBtn")?.addEventListener("click", openLoanSettingsModal);
  document.getElementById("communicationsBtn")?.addEventListener("click", () => openCommunicationsModal());
  document.getElementById("configForcedLoansBtn")?.addEventListener("click", openForcedLoansConfigModal);

  setupModalCloseHandlers("newLoanModal", "closeNewLoanModal", "cancelNewLoan");
  setupModalCloseHandlers("recordPaymentModal", "closeRecordPaymentModal", "cancelRecordPayment");
  setupModalCloseHandlers("loanSettingsModal", "closeLoanSettingsModal", "cancelLoanSettings");
  setupModalCloseHandlers("communicationsModal", "closeCommunicationsModal", "cancelCommunications");
  setupModalCloseHandlers("forcedLoansConfigModal", "closeForcedLoansConfigModal", "cancelForcedLoansConfig");

  document.getElementById("newLoanForm")?.addEventListener("submit", handleNewLoan);
  document.getElementById("recordPaymentForm")?.addEventListener("submit", handleRecordPayment);
  document.getElementById("loanSettingsForm")?.addEventListener("submit", handleSaveLoanSettings);
  document.getElementById("communicationsForm")?.addEventListener("submit", handleSendReminder);
  document.getElementById("forcedLoansConfigForm")?.addEventListener("submit", handleSaveForcedLoansConfig);

  // The new-loan interest/total preview is informational only — the server
  // prices the loan for real at approval time. No client math here.
  document.getElementById("loanAmount")?.addEventListener("input", updateLoanPreviewNote);
  document.getElementById("loanPeriod")?.addEventListener("change", updateLoanPreviewNote);
  document.getElementById("loanInterestRate")?.addEventListener("input", updateLoanPreviewNote);

  document.getElementById("reminderRecipient")?.addEventListener("change", (e) => {
    const specificGroup = document.getElementById("specificMemberGroup");
    if (specificGroup) specificGroup.style.display = e.target.value === "specific" ? "block" : "none";
  });

  document.getElementById("messageType")?.addEventListener("change", updateMessageTemplate);

  document.getElementById("forcedLoansMethod")?.addEventListener("change", (e) => {
    const group = document.getElementById("percentageThresholdGroup");
    if (group) group.style.display = e.target.value === "percentage_of_highest" ? "block" : "none";
  });

  document.getElementById("forcedLoansToggle")?.addEventListener("change", handleToggleForcedLoans);
  document.getElementById("calculateForcedLoansBtn")?.addEventListener("click", calculateForcedLoans);
}

function setupModalCloseHandlers(modalId, closeBtn1, closeBtn2) {
  const closeModal = () => hideModal(modalId);
  document.getElementById(closeBtn1)?.addEventListener("click", (e) => {
    e.preventDefault();
    closeModal();
  });
  document.getElementById(closeBtn2)?.addEventListener("click", (e) => {
    e.preventDefault();
    closeModal();
  });
  document.getElementById(modalId)?.addEventListener("click", (e) => {
    if (e.target.id === modalId) closeModal();
  });
}

// ── Load the caller's admin groups ──────────────────────────────────────────
async function loadAdminGroups() {
  showSpinner(true);
  try {
    const groups = await listMyGroups();
    adminGroups = groups.filter((g) => ["admin", "senior_admin", "treasurer"].includes(g.myRole));

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

    const sessionGroupId = sessionStorage.getItem("selectedGroupId");
    const match = adminGroups.find((g) => (g.groupId || g.id) === sessionGroupId);
    const chosen = match || adminGroups[0];
    selectedGroupId = chosen.groupId || chosen.id;
    sessionStorage.setItem("selectedGroupId", selectedGroupId);
    if (selector) selector.value = selectedGroupId;

    await loadGroupData();
  } catch (error) {
    handleApiError(error, "Failed to load groups");
  } finally {
    showSpinner(false);
  }
}

// ── Load group data ──────────────────────────────────────────────────────────
async function loadGroupData() {
  if (!selectedGroupId) return;
  showSpinner(true);
  try {
    await loadMembers();
    await loadLoans();
    await loadGroupRules();
    await loadPendingRepayments();
    updateStats();
    renderLoans();
  } catch (error) {
    handleApiError(error, "Failed to load group data");
  } finally {
    showSpinner(false);
  }
}

async function loadMembers() {
  try {
    const data = await apiGet("members.list", {groupId: selectedGroupId});
    members = Array.isArray(data && data.members) ? data.members : [];
    populateBorrowerFilter();
  } catch (error) {
    handleApiError(error, "Failed to load members");
  }
}

function populateBorrowerFilter() {
  const dropdown = document.getElementById("borrowerFilterDropdown");
  if (!dropdown) return;
  dropdown.textContent = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All Borrowers";
  dropdown.appendChild(allOption);

  members.forEach((member) => {
    const option = document.createElement("option");
    option.value = member.uid;
    option.textContent = member.fullName || "Unknown";
    dropdown.appendChild(option);
  });
}

async function loadLoans() {
  try {
    const data = await apiGet("loans.list", {groupId: selectedGroupId});
    loans = Array.isArray(data && data.loans) ? data.loans : [];
  } catch (error) {
    loans = [];
    handleApiError(error, "Failed to load loans");
  }
}

// ── Group rules (loan settings + forced-loans config) ───────────────────────
async function loadGroupRules() {
  if (!selectedGroupId) return;
  try {
    const data = await apiGet("rules.get", {groupId: selectedGroupId});
    groupRules = (data && (data.rules || data.groupRules)) || data || {};
  } catch (error) {
    groupRules = null;
    handleApiError(error, "Failed to load group rules");
  }
  updateForcedLoansSectionUI();
}

// ── Pending loan payments review queue ──────────────────────────────────────
async function loadPendingRepayments() {
  if (!selectedGroupId) return;
  try {
    const data = await apiGet("repayments.pending", {groupId: selectedGroupId});
    pendingPayments = Array.isArray(data && data.payments) ? data.payments : [];
  } catch (error) {
    pendingPayments = [];
    handleApiError(error, "Failed to load pending payments");
  }
  renderPendingPayments();
}

function renderPendingPayments() {
  const listEl = document.getElementById("pendingLoanPaymentsList");
  const badge = document.getElementById("pendingPaymentsCountBadge");
  if (badge) badge.textContent = String(pendingPayments.length);
  if (!listEl) return;
  listEl.textContent = "";

  if (pendingPayments.length === 0) {
    listEl.appendChild(emptyTableRow("No pending payments to review", 7));
    return;
  }

  pendingPayments.forEach((payment) => listEl.appendChild(createPendingPaymentRow(payment)));
}

/**
 * Renders one pending loan-payment as a <tr> for the .table.table-responsive
 * component (same pattern as manage_payments_sql.js's createPaymentRow —
 * pure-CSS desktop table / mobile card collapse). Carries every field
 * createPendingPaymentCard() used to show: borrower, loan #/amount/method/
 * date, and the conditional notes/proof-link folded into one "Details" cell
 * that stays empty (data-label="") when neither applies.
 */
function createPendingPaymentRow(payment) {
  const row = el("tr");

  const borrowerCell = el("td");
  borrowerCell.dataset.label = "Borrower";
  borrowerCell.appendChild(borrowerIdentity(payment.userName || "Unknown"));
  row.appendChild(borrowerCell);

  const loanNumCell = el("td");
  loanNumCell.dataset.label = "Loan #";
  loanNumCell.textContent = String(payment.loanNumber || payment.loanId || "—");
  row.appendChild(loanNumCell);

  const amountCell = el("td", "cell-right");
  amountCell.dataset.label = "Amount";
  amountCell.textContent = formatCurrency(payment.amount);
  row.appendChild(amountCell);

  const methodCell = el("td");
  methodCell.dataset.label = "Method";
  methodCell.textContent = payment.paymentMethod || "N/A";
  row.appendChild(methodCell);

  const dateCell = el("td");
  dateCell.dataset.label = "Date";
  dateCell.textContent = formatDate(payment.paidAt || payment.createdAt);
  row.appendChild(dateCell);

  const detailsCell = el("td");
  if (payment.notes) {
    const notes = el("div");
    notes.style.cssText = "font-size: var(--bn-text-sm); color: var(--bn-gray);";
    notes.textContent = `Notes: ${payment.notes}`;
    detailsCell.appendChild(notes);
  }
  if (payment.proofOfPaymentImageUrl) {
    const link = document.createElement("a");
    link.href = payment.proofOfPaymentImageUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View proof";
    link.style.cssText = "display: inline-block; font-size: var(--bn-text-sm);";
    detailsCell.appendChild(link);
  }
  detailsCell.dataset.label = detailsCell.childNodes.length ? "Details" : "";
  row.appendChild(detailsCell);

  const actionsCell = el("td");
  actionsCell.dataset.label = "Actions";
  const actions = el("div", "loan-actions");
  const approveBtn = el("button", "btn btn-accent btn-sm");
  approveBtn.textContent = "Approve";
  approveBtn.addEventListener("click", () => approvePendingPayment(payment.paymentId));
  const rejectBtn = el("button", "btn btn-danger btn-sm");
  rejectBtn.textContent = "Reject";
  rejectBtn.addEventListener("click", () => rejectPendingPayment(payment));
  actions.append(approveBtn, rejectBtn);
  actionsCell.appendChild(actions);
  row.appendChild(actionsCell);

  return row;
}

async function approvePendingPayment(paymentId) {
  showSpinner(true);
  try {
    await apiPost("repayments.approve", {paymentId});
    showToast("Payment approved", "success");
    await loadPendingRepayments();
    await loadLoans();
    updateStats();
    renderLoans();
  } catch (error) {
    handleApiError(error, "Failed to approve payment");
  } finally {
    showSpinner(false);
  }
}

function rejectPendingPayment(payment) {
  promptForReason({
    title: "Reject Payment",
    label: "Reason for rejection",
    confirmLabel: "Reject Payment",
    onConfirm: async (reason) => {
      showSpinner(true);
      try {
        await apiPost("repayments.reject", {
          loanId: payment.loanId,
          paymentId: payment.paymentId,
          rejectionReason: reason,
        });
        showToast("Payment rejected", "success");
        await loadPendingRepayments();
        await loadLoans();
        updateStats();
        renderLoans();
      } catch (error) {
        handleApiError(error, "Failed to reject payment");
      } finally {
        showSpinner(false);
      }
    },
  });
}

// ── Stats ───────────────────────────────────────────────────────────────────
function updateStats() {
  const pending = loans.filter((l) => l.status === "pending").length;
  const active = loans.filter((l) => l.status === "approved" || l.status === "disbursed").length;

  // NOT substituted with loans.list's `summary` block: totalDisbursed here is
  // scoped to approved+disbursed+completed (excludes pending/rejected, which
  // still carry a nonzero requested principalAmount — unlike totalOutstanding
  // below), which matches neither `totalPrincipal` (ALL rows) nor
  // `activePrincipal` (approved+disbursed only, excludes completed). And
  // totalOutstanding here is scoped to approved+disbursed only, excluding
  // 'defaulted' loans that can still carry a nonzero remainingBalance — so it
  // does not equal `summary.totalOutstanding` (which is summed over ALL rows
  // and does include any outstanding balance left on a defaulted loan).
  let totalDisbursed = 0;
  let totalOutstanding = 0;

  loans.forEach((loan) => {
    const principal = numberOf(loan.approvedAmount ?? loan.principalAmount);
    const remaining = numberOf(loan.remainingBalance);

    if (loan.status === "approved" || loan.status === "disbursed" || loan.status === "completed") {
      totalDisbursed += principal;
    }
    if (loan.status === "approved" || loan.status === "disbursed") {
      totalOutstanding += remaining;
    }
  });

  setText("pendingCount", pending);
  setText("activeCount", active);
  const disbursedEl = totalDisbursedEl();
  if (disbursedEl) disbursedEl.textContent = formatCurrency(totalDisbursed);
  const outstandingEl = totalOutstandingEl();
  if (outstandingEl) outstandingEl.textContent = formatCurrency(totalOutstanding);
}

// ── Render loans ─────────────────────────────────────────────────────────────
function renderLoans() {
  const container = loansContainer();
  if (!container) return;

  let filtered = [];
  switch (currentTab) {
    case "pending":
      filtered = loans.filter((l) => l.status === "pending");
      break;
    case "active":
      filtered = loans.filter((l) => l.status === "approved" || l.status === "disbursed");
      break;
    case "repaid":
      filtered = loans.filter((l) => l.status === "completed");
      break;
    case "cancelled":
      filtered = loans.filter((l) => l.status === "rejected");
      break;
    case "overdue":
      // No dueDate/schedule field at the list level, so maturity is derived
      // client-side from approvedAt + repaymentPeriod (months). Balance
      // comparison reuses numberOf() — no money arithmetic is performed here.
      filtered = loans.filter((l) => {
        if (l.status !== "approved" && l.status !== "disbursed") return false;
        if (numberOf(l.remainingBalance) <= 0) return false;
        if (!l.approvedAt) return false;
        const start = new Date(l.approvedAt);
        if (isNaN(start.getTime())) return false;
        const months = parseInt(l.repaymentPeriod, 10) || 0;
        const targetMonth = start.getMonth() + months;
        const targetFirst = new Date(start.getFullYear(), targetMonth, 1);
        const daysInTargetMonth = new Date(targetFirst.getFullYear(), targetFirst.getMonth() + 1, 0).getDate();
        const maturity = new Date(targetFirst);
        maturity.setDate(Math.min(start.getDate(), daysInTargetMonth));
        return maturity.getTime() < Date.now();
      });
      break;
    default:
      filtered = loans;
  }

  const borrowerFilter = document.getElementById("borrowerFilterDropdown")?.value;
  if (borrowerFilter && borrowerFilter !== "all") {
    filtered = filtered.filter((l) => l.borrowerId === borrowerFilter);
  }

  container.textContent = "";

  if (filtered.length === 0) {
    container.appendChild(emptyTableRow(`No ${currentTab} loans found`, 10));
    return;
  }

  filtered.forEach((loan) => container.appendChild(createLoanRow(loan)));
}

/**
 * Renders one loan as a <tr> for the .table.table-responsive component (same
 * pattern as manage_payments_sql.js's createPaymentRow — pure-CSS desktop
 * table / mobile card collapse). Carries every field createLoanCard() used
 * to show: borrower+applied date, status badge, the four money figures, the
 * approved/disbursed-only progress bar, action buttons that vary by status,
 * and the conditional purpose/rejection-reason boxes folded into one
 * optional "Details" cell that stays empty (data-label="") when neither
 * applies.
 */
function createLoanRow(loan) {
  const borrower = members.find((m) => m.uid === loan.borrowerId) || {};
  const borrowerName = borrower.fullName || loan.borrowerName || "Unknown";

  const principal = numberOf(loan.approvedAmount ?? loan.principalAmount);
  const interest = numberOf(loan.totalInterest);
  const repaid = numberOf(loan.amountRepaid);
  const totalDue = numberOf(loan.totalRepayment);
  const remaining = numberOf(loan.remainingBalance);
  const progressPercent = totalDue > 0 ? Math.min((repaid / totalDue) * 100, 100) : 0;

  const createdDate = formatDate(loan.requestedAt);

  const statusClass = loan.status === "completed" ? "success"
    : (loan.status === "approved" || loan.status === "disbursed") ? "info"
      : loan.status === "rejected" ? "danger"
        : "warning";

  const row = el("tr");

  const borrowerCell = el("td");
  borrowerCell.dataset.label = "Borrower";
  borrowerCell.appendChild(borrowerIdentity(borrowerName));
  row.appendChild(borrowerCell);

  const appliedCell = el("td");
  appliedCell.dataset.label = "Applied";
  appliedCell.textContent = createdDate;
  row.appendChild(appliedCell);

  const statusCell = el("td");
  statusCell.dataset.label = "Status";
  const statusBadge = el("span", `badge badge-${statusClass}`);
  statusBadge.textContent = loan.status;
  statusCell.appendChild(statusBadge);
  row.appendChild(statusCell);

  const principalCell = el("td", "cell-right");
  principalCell.dataset.label = "Principal";
  principalCell.textContent = formatCurrency(principal);
  row.appendChild(principalCell);

  const interestCell = el("td", "cell-right");
  interestCell.dataset.label = "Interest";
  interestCell.textContent = formatCurrency(interest);
  row.appendChild(interestCell);

  const repaidCell = el("td", "cell-right");
  repaidCell.dataset.label = "Repaid";
  repaidCell.textContent = formatCurrency(repaid);
  repaidCell.style.color = "var(--bn-success)";
  row.appendChild(repaidCell);

  const remainingCell = el("td", "cell-right");
  remainingCell.dataset.label = "Remaining";
  remainingCell.textContent = formatCurrency(remaining);
  remainingCell.style.color = "var(--bn-danger)";
  row.appendChild(remainingCell);

  const progressCell = el("td");
  if (loan.status === "approved" || loan.status === "disbursed") {
    const progress = el("div", "loan-progress");
    const bar = el("div", "loan-progress-bar");
    const fill = el("div", "loan-progress-fill");
    fill.style.width = `${progressPercent}%`;
    bar.appendChild(fill);
    const textRow = el("div", "loan-progress-text");
    const percentSpan = el("span");
    percentSpan.textContent = `${progressPercent.toFixed(0)}% repaid`;
    textRow.appendChild(percentSpan);
    progress.append(bar, textRow);
    progressCell.appendChild(progress);
    progressCell.dataset.label = "Progress";
  } else {
    progressCell.dataset.label = "";
  }
  row.appendChild(progressCell);

  const detailsCell = el("td");
  if (loan.status === "pending" && loan.purpose) {
    const bookingInfo = el("div");
    bookingInfo.style.cssText = "background: var(--bn-accent-subtle); padding: var(--bn-space-3); border-radius: var(--bn-radius-md);";
    const label = el("div");
    label.style.cssText = "font-size: var(--bn-text-xs); color: var(--bn-gray); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;";
    label.textContent = "Loan Request Details";
    const purposeLine = el("div");
    purposeLine.style.cssText = "font-size: var(--bn-text-xs); color: var(--bn-gray);";
    purposeLine.textContent = `Purpose: ${loan.purpose}`;
    const periodLine = el("div");
    periodLine.style.cssText = "font-size: var(--bn-text-xs); color: var(--bn-gray);";
    periodLine.textContent = `Repayment Period: ${loan.repaymentPeriod} month(s)`;
    bookingInfo.append(label, purposeLine, periodLine);
    detailsCell.appendChild(bookingInfo);
  }
  if (loan.status === "rejected" && loan.rejectionReason) {
    const rejectInfo = el("div");
    rejectInfo.style.cssText = "background: #fee; padding: var(--bn-space-3); border-radius: var(--bn-radius-md); border-left: 3px solid var(--bn-danger);";
    const label = el("div");
    label.style.cssText = "font-size: var(--bn-text-xs); color: var(--bn-danger); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;";
    label.textContent = "Loan Rejected";
    const reasonLine = el("div");
    reasonLine.style.cssText = "font-size: var(--bn-text-sm); color: var(--bn-dark);";
    reasonLine.textContent = `Reason: ${loan.rejectionReason}`;
    rejectInfo.append(label, reasonLine);
    detailsCell.appendChild(rejectInfo);
  }
  detailsCell.dataset.label = detailsCell.childNodes.length ? "Details" : "";
  row.appendChild(detailsCell);

  const actionsCell = el("td");
  actionsCell.dataset.label = "Actions";
  const actions = el("div", "loan-actions");
  if (loan.status === "pending") {
    const approveBtn = el("button", "btn btn-accent btn-sm");
    approveBtn.textContent = "Approve";
    approveBtn.addEventListener("click", () => approveLoan(loan.loanId));
    const rejectBtn = el("button", "btn btn-danger btn-sm");
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => rejectLoan(loan.loanId));
    actions.append(approveBtn, rejectBtn);
  } else if (loan.status === "approved" || loan.status === "disbursed") {
    const paymentBtn = el("button", "btn btn-accent btn-sm");
    paymentBtn.textContent = "Record Payment";
    paymentBtn.addEventListener("click", () => openRecordPaymentModal(loan.loanId));
    const reminderBtn = el("button", "btn btn-secondary btn-sm");
    reminderBtn.textContent = "Send Reminder";
    reminderBtn.addEventListener("click", () => openCommunicationsModal(loan.borrowerId));
    const detailsBtn = el("button", "btn btn-ghost btn-sm");
    detailsBtn.textContent = "View Details";
    detailsBtn.addEventListener("click", () => showLoanDetails(loan.loanId));
    actions.append(paymentBtn, reminderBtn, detailsBtn);
  } else {
    const detailsBtn = el("button", "btn btn-ghost btn-sm");
    detailsBtn.textContent = "View Details";
    detailsBtn.addEventListener("click", () => showLoanDetails(loan.loanId));
    actions.appendChild(detailsBtn);
  }
  actionsCell.appendChild(actions);
  row.appendChild(actionsCell);

  return row;
}

/**
 * Shared empty-state <tr> for both tables on this page — colspan varies per
 * table (10 for the loan table, 7 for the pending-payment-review table).
 */
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

// ── Approve / reject ─────────────────────────────────────────────────────────
async function approveLoan(loanId) {
  showSpinner(true);
  try {
    await apiPost("loans.approve", {loanId});
    showToast("Loan approved successfully", "success");
    await loadGroupData();
  } catch (error) {
    handleApiError(error, "Failed to approve loan");
  } finally {
    showSpinner(false);
  }
}

function rejectLoan(loanId) {
  promptForReason({
    title: "Reject Loan",
    label: "Reason for rejection",
    confirmLabel: "Reject Loan",
    onConfirm: async (reason) => {
      showSpinner(true);
      try {
        await apiPost("loans.reject", {loanId, rejectionReason: reason});
        showToast("Loan rejected", "success");
        await loadGroupData();
      } catch (error) {
        handleApiError(error, "Failed to reject loan");
      } finally {
        showSpinner(false);
      }
    },
  });
}

// ── New loan (admin-originated -> loans.force) ──────────────────────────────
/**
 * @param {{memberId:string, amount:number}|null} prefill Optional — used by
 * the forced-loans "Originate" action to pre-select a member/amount.
 */
function openNewLoanModal(prefill = null) {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }

  const memberSelect = document.getElementById("loanMember");
  if (memberSelect) {
    memberSelect.textContent = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a member...";
    memberSelect.appendChild(placeholder);
    members.forEach((m) => {
      const option = document.createElement("option");
      option.value = m.uid;
      option.textContent = m.fullName || "Unknown";
      memberSelect.appendChild(option);
    });
  }

  document.getElementById("newLoanForm")?.reset();
  const disbursementDate = document.getElementById("loanDisbursementDate");
  if (disbursementDate) disbursementDate.value = new Date().toISOString().split("T")[0];

  if (prefill) {
    if (memberSelect) memberSelect.value = prefill.memberId;
    const amountInput = document.getElementById("loanAmount");
    if (amountInput) amountInput.value = prefill.amount;
  }

  updateLoanPreviewNote();

  showModal("newLoanModal");
}

/**
 * The original computed a live interest preview client-side. The server owns
 * that arithmetic now; this just tells the admin the total is finalized on
 * approval rather than guessing at a number here.
 */
function updateLoanPreviewNote() {
  const interestEl = document.getElementById("calculatedInterest");
  const totalEl = document.getElementById("calculatedTotal");
  if (interestEl) interestEl.textContent = "Finalized on approval";
  if (totalEl) totalEl.textContent = "Finalized on approval";
}

async function handleNewLoan(e) {
  e.preventDefault();

  const memberId = document.getElementById("loanMember")?.value;
  const amount = parseFloat(document.getElementById("loanAmount")?.value || 0);
  const period = parseInt(document.getElementById("loanPeriod")?.value || 1, 10);
  const purpose = document.getElementById("loanPurpose")?.value || "";

  if (!memberId || !amount) {
    showToast("Please fill in all required fields", "error");
    return;
  }

  showSpinner(true);
  try {
    await apiPost("loans.force", {
      groupId: selectedGroupId,
      borrowerId: memberId,
      principalAmount: amount,
      repaymentPeriod: period,
      forcedReason: purpose || "Admin-originated loan",
    });
    hideModal("newLoanModal");
    showToast("Loan created successfully", "success");
    await loadGroupData();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      showToast("An admin cannot create a loan for themselves.", "error");
    } else {
      handleApiError(error, "Failed to create loan");
    }
  } finally {
    showSpinner(false);
  }
}

// ── Record payment ───────────────────────────────────────────────────────────
function openRecordPaymentModal(loanId = null) {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }

  const loanSelect = document.getElementById("paymentLoanSelect");
  if (loanSelect) {
    loanSelect.textContent = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose an active loan...";
    loanSelect.appendChild(placeholder);

    const activeLoans = loans.filter((l) => l.status === "approved" || l.status === "disbursed");
    activeLoans.forEach((loan) => {
      const borrowerName = members.find((m) => m.uid === loan.borrowerId)?.fullName || "Unknown";
      const remaining = numberOf(loan.remainingBalance);
      const option = document.createElement("option");
      option.value = loan.loanId;
      option.textContent = `${borrowerName} - ${formatCurrency(remaining)} remaining`;
      loanSelect.appendChild(option);
    });

    if (loanId) loanSelect.value = loanId;
  }

  const paymentDate = document.getElementById("paymentDate");
  if (paymentDate) paymentDate.value = new Date().toISOString().split("T")[0];
  document.getElementById("recordPaymentForm")?.reset();
  if (paymentDate) paymentDate.value = new Date().toISOString().split("T")[0];

  showModal("recordPaymentModal");
}

async function handleRecordPayment(e) {
  e.preventDefault();

  const loanId = document.getElementById("paymentLoanSelect")?.value;
  const amount = parseFloat(document.getElementById("paymentAmount")?.value || 0);
  const method = document.getElementById("paymentMethod")?.value;
  const notes = document.getElementById("paymentNotes")?.value;

  if (!loanId || !amount) {
    showToast("Please fill in all required fields", "error");
    return;
  }
  if (amount <= 0) {
    showToast("Payment amount must be greater than 0", "error");
    return;
  }

  showSpinner(true);
  try {
    // Server computes the split (principal/interest/penalty) and files the
    // payment as PENDING; nothing on the ledger moves until it is approved.
    await apiPost("repayments.record", {
      loanId,
      amount,
      paymentMethod: method,
      notes: notes || undefined,
    });
    hideModal("recordPaymentModal");
    showToast("Payment recorded — awaiting approval", "success");
    await loadGroupData();
  } catch (error) {
    handleApiError(error, "Failed to record payment");
  } finally {
    showSpinner(false);
  }
}

// ── Loan settings ─────────────────────────────────────────────────────────────
// The modal only exposes a subset of the group_rules row (see the file-header
// mismatch note): interest months 1-3, one penalty amount, and min/max loan.
const LOAN_SETTINGS_FIELD_MAP = [
  ["interestMonth1", "loanInterestRateMonth1"],
  ["interestMonth2", "loanInterestRateMonth2"],
  ["interestMonth3", "loanInterestRateMonth3"],
  ["loanPenaltyRate", "loanPenaltyDailyAmount"],
  ["minLoanAmount", "loanRulesMinCycleLoanAmount"],
  ["maxLoanAmount", "loanRulesMaxLoanAmount"],
];

async function openLoanSettingsModal() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }
  showSpinner(true);
  try {
    const data = await apiGet("rules.get", {groupId: selectedGroupId});
    groupRules = (data && (data.rules || data.groupRules)) || data || {};
  } catch (error) {
    handleApiError(error, "Failed to load loan settings");
    showSpinner(false);
    return;
  }
  showSpinner(false);

  LOAN_SETTINGS_FIELD_MAP.forEach(([inputId, ruleField]) => {
    const node = document.getElementById(inputId);
    if (node && groupRules[ruleField] !== undefined && groupRules[ruleField] !== null) {
      node.value = groupRules[ruleField];
    }
  });

  showModal("loanSettingsModal");
}

async function handleSaveLoanSettings(e) {
  e.preventDefault();
  if (!selectedGroupId) return;

  const payload = {groupId: selectedGroupId};
  let changed = false;

  LOAN_SETTINGS_FIELD_MAP.forEach(([inputId, ruleField]) => {
    const node = document.getElementById(inputId);
    if (!node || node.value === "") return;
    const value = parseFloat(node.value);
    if (!Number.isFinite(value)) return;
    const original = groupRules ? numberOf(groupRules[ruleField]) : NaN;
    if (!groupRules || value !== original) {
      payload[ruleField] = value;
      changed = true;
    }
  });

  if (!changed) {
    showToast("No changes to save", "info");
    return;
  }

  showSpinner(true);
  try {
    await apiPost("rules.update", payload);
    showToast("Loan settings saved", "success");
    hideModal("loanSettingsModal");
    await loadGroupRules();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      showToast("Only a senior admin can change group rules.", "error");
    } else {
      handleApiError(error, "Failed to save loan settings");
    }
  } finally {
    showSpinner(false);
  }
}

// ── Forced loans ─────────────────────────────────────────────────────────────
function updateForcedLoansSectionUI() {
  const enabled = !!(groupRules && Number(groupRules.forcedLoansEnabled) === 1);

  const toggle = document.getElementById("forcedLoansToggle");
  if (toggle) toggle.checked = enabled;
  setText("forcedLoansStatus", enabled ? "Enabled" : "Disabled");

  const configBtn = document.getElementById("configForcedLoansBtn");
  if (configBtn) configBtn.style.display = enabled ? "inline-flex" : "none";
  const calcBtn = document.getElementById("calculateForcedLoansBtn");
  if (calcBtn) calcBtn.style.display = enabled ? "inline-flex" : "none";

  const configDisplay = document.getElementById("forcedLoansConfig");
  if (configDisplay) configDisplay.style.display = enabled ? "block" : "none";

  const emptyState = document.getElementById("forcedLoansEmptyState");
  const resultsEl = document.getElementById("forcedLoansResults");
  if (!enabled) {
    if (resultsEl) resultsEl.style.display = "none";
    if (emptyState) emptyState.style.display = "block";
  }

  if (groupRules && enabled) {
    const methodLabel = groupRules.forcedLoansMethod === "percentage_of_highest"
      ? `Percentage of Highest (${numberOf(groupRules.forcedLoansPercentageOfHighest)}%)`
      : "Fixed Amount";
    setText("configMethod", methodLabel);
    setText("configMinDeficit", formatCurrency(groupRules.loanRulesMinCycleLoanAmount));
  }
}

async function handleToggleForcedLoans(e) {
  const enabled = e.target.checked;
  if (!selectedGroupId) {
    e.target.checked = !enabled;
    showToast("Please select a group first", "error");
    return;
  }
  showSpinner(true);
  try {
    await apiPost("rules.update", {groupId: selectedGroupId, forcedLoansEnabled: enabled ? 1 : 0});
    showToast(`Forced loans ${enabled ? "enabled" : "disabled"}`, "success");
    await loadGroupRules();
  } catch (error) {
    e.target.checked = !enabled;
    if (error instanceof ApiError && error.status === 403) {
      showToast("Only a senior admin can change group rules.", "error");
    } else {
      handleApiError(error, "Failed to update forced-loans setting");
    }
  } finally {
    showSpinner(false);
  }
}

function openForcedLoansConfigModal() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }

  const methodSelect = document.getElementById("forcedLoansMethod");
  const percentInput = document.getElementById("percentageThreshold");
  const percentGroup = document.getElementById("percentageThresholdGroup");

  if (methodSelect) {
    methodSelect.value = (groupRules && groupRules.forcedLoansMethod === "percentage_of_highest")
      ? "percentage_of_highest"
      : "match_highest";
  }
  if (percentInput && groupRules && groupRules.forcedLoansPercentageOfHighest != null) {
    percentInput.value = numberOf(groupRules.forcedLoansPercentageOfHighest);
  }
  if (percentGroup && methodSelect) {
    percentGroup.style.display = methodSelect.value === "percentage_of_highest" ? "block" : "none";
  }

  showModal("forcedLoansConfigModal");
}

async function handleSaveForcedLoansConfig(e) {
  e.preventDefault();
  if (!selectedGroupId) return;

  const methodValue = document.getElementById("forcedLoansMethod")?.value;
  // Server only supports 'fixed_amount' | 'percentage_of_highest' — see the
  // file-header mismatch note for why match_highest/match_average collapse
  // to 'fixed_amount'.
  const apiMethod = methodValue === "percentage_of_highest" ? "percentage_of_highest" : "fixed_amount";

  const payload = {groupId: selectedGroupId, forcedLoansMethod: apiMethod};

  if (apiMethod === "percentage_of_highest") {
    const pct = parseFloat(document.getElementById("percentageThreshold")?.value || "");
    if (!Number.isFinite(pct) || pct <= 0) {
      showToast("Enter a valid percentage", "error");
      return;
    }
    // Stored as a raw percentage (e.g. 15 == 15%), same scale as the interest
    // rate columns — the server does pct/100 in the target math, so do NOT
    // pre-divide here.
    payload.forcedLoansPercentageOfHighest = pct;
  } else {
    payload.forcedLoansPercentageOfHighest = null;
  }

  showSpinner(true);
  try {
    await apiPost("rules.update", payload);
    hideModal("forcedLoansConfigModal");
    showToast("Forced-loans configuration saved", "success");
    await loadGroupRules();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      showToast("Only a senior admin can change group rules.", "error");
    } else {
      handleApiError(error, "Failed to save forced-loans configuration");
    }
  } finally {
    showSpinner(false);
  }
}

async function calculateForcedLoans() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }
  showSpinner(true);
  let data;
  try {
    data = await apiGet("cycle.forced.preview", {groupId: selectedGroupId});
  } catch (error) {
    handleApiError(error, "Failed to calculate forced loans");
    showSpinner(false);
    return;
  }
  showSpinner(false);
  renderForcedLoansResults(data || {});
}

function renderForcedLoansResults(data) {
  const resultsEl = document.getElementById("forcedLoansResults");
  const emptyEl = document.getElementById("forcedLoansEmptyState");
  const listEl = document.getElementById("forcedLoansList");
  if (!listEl || !emptyEl || !resultsEl) return;
  listEl.textContent = "";

  if (!data.enabled) {
    resultsEl.style.display = "none";
    emptyEl.textContent = "";
    const wrap = el("div", "empty-state");
    const icon = el("div", "empty-state-icon");
    icon.textContent = "⚙️";
    const text = el("p", "empty-state-text");
    text.textContent = "Enable forced loans in Settings first.";
    wrap.append(icon, text);
    emptyEl.appendChild(wrap);
    emptyEl.style.display = "block";
    return;
  }

  const membersList = Array.isArray(data.members) ? data.members : [];
  emptyEl.style.display = membersList.length ? "none" : "block";
  resultsEl.style.display = "block";

  const withShortfall = membersList.filter((m) => numberOf(m.shortfall) > 0);
  setText("totalForcedLoans", withShortfall.length);
  // Server-computed sum of every member's shortfall (cycle.forced.preview's
  // totalShortfall) — same scope as membersList, so no client-side re-sum.
  setText("totalDeficitAmount", formatCurrency(numberOf(data.totalShortfall)));
  setText("membersAffected", membersList.length);
  const targetEl = document.getElementById("highestInterestPaid");
  if (targetEl) targetEl.textContent = formatCurrency(data.target);

  membersList.forEach((member) => listEl.appendChild(createForcedLoanRow(member)));
}

function createForcedLoanRow(member) {
  const row = el("div", "loan-card");
  row.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: var(--bn-space-3); margin-bottom: var(--bn-space-2);";

  const info = el("div");
  const name = el("div", "loan-borrower-name");
  name.textContent = member.fullName || "Unknown";
  const detail = el("div", "loan-borrower-date");
  detail.textContent = `Borrowed: ${formatCurrency(member.borrowed)} · Shortfall: ${formatCurrency(member.shortfall)}`;
  info.append(name, detail);
  row.appendChild(info);

  const shortfall = numberOf(member.shortfall);
  if (shortfall > 0) {
    const btn = el("button", "btn btn-accent");
    btn.textContent = "Originate";
    btn.addEventListener("click", () => openNewLoanModal({memberId: member.uid, amount: shortfall}));
    row.appendChild(btn);
  }

  return row;
}

// ── Communications ───────────────────────────────────────────────────────────
function openCommunicationsModal(specificMemberId = null) {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }

  const specificSelect = document.getElementById("specificMember");
  if (specificSelect) {
    specificSelect.textContent = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose member...";
    specificSelect.appendChild(placeholder);
    members.forEach((m) => {
      const option = document.createElement("option");
      option.value = m.uid;
      option.textContent = m.fullName || "Unknown";
      specificSelect.appendChild(option);
    });
  }

  document.getElementById("communicationsForm")?.reset();

  const recipientSelect = document.getElementById("reminderRecipient");
  const specificGroup = document.getElementById("specificMemberGroup");
  if (specificMemberId) {
    if (recipientSelect) recipientSelect.value = "specific";
    if (specificSelect) specificSelect.value = specificMemberId;
    if (specificGroup) specificGroup.style.display = "block";
  } else if (specificGroup) {
    specificGroup.style.display = "none";
  }

  updateMessageTemplate();
  showModal("communicationsModal");
}

function messageTypeToSubject(type) {
  switch (type) {
    case "overdue_notice":
      return "Overdue Loan Notice";
    case "penalty_warning":
      return "Loan Penalty Warning";
    case "custom":
      return "Message from your group admin";
    default:
      return "Loan Payment Reminder";
  }
}

const MESSAGE_TEMPLATES = {
  payment_reminder: "This is a reminder that you have an upcoming loan payment due. Please make your payment at your earliest convenience.",
  overdue_notice: "Your loan payment is overdue. Please settle the outstanding balance as soon as possible to avoid further penalties.",
  penalty_warning: "Your loan payment is overdue and penalties are accruing daily. Please make payment immediately to limit further charges.",
  custom: "",
};

function updateMessageTemplate() {
  const type = document.getElementById("messageType")?.value;
  const textarea = document.getElementById("reminderMessage");
  if (!textarea || textarea.value.trim()) return; // don't clobber the admin's own text
  textarea.value = MESSAGE_TEMPLATES[type] || "";
}

async function handleSendReminder(e) {
  e.preventDefault();
  if (!selectedGroupId) return;

  const recipientValue = document.getElementById("reminderRecipient")?.value;
  // Server only supports 'all' | 'specific' — see the file-header mismatch
  // note for why all_overdue/all_active both collapse to 'all'.
  const recipient = recipientValue === "specific" ? "specific" : "all";
  const uid = recipient === "specific" ? document.getElementById("specificMember")?.value : undefined;
  const messageType = document.getElementById("messageType")?.value;
  const message = document.getElementById("reminderMessage")?.value?.trim();

  if (recipient === "specific" && !uid) {
    showToast("Please choose a member", "error");
    return;
  }
  if (!message) {
    showToast("Please enter a message", "error");
    return;
  }

  showSpinner(true);
  try {
    const data = await apiPost("reminders.send", {
      groupId: selectedGroupId,
      recipient,
      uid,
      subject: messageTypeToSubject(messageType),
      message,
    });
    hideModal("communicationsModal");
    const notified = numberOf(data && data.notified);
    const emailed = numberOf(data && data.emailed);
    const emailFailed = numberOf(data && data.emailFailed);
    let toastMsg = `Notified ${notified} member(s), emailed ${emailed}.`;
    if (emailFailed) toastMsg += ` ${emailFailed} email(s) failed to send.`;
    showToast(toastMsg, "success");
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      showToast("You do not have permission to send reminders.", "error");
    } else {
      handleApiError(error, "Failed to send reminder");
    }
  } finally {
    showSpinner(false);
  }
}

// ── Loan details ─────────────────────────────────────────────────────────────
async function showLoanDetails(loanId) {
  showSpinner(true);
  let data;
  try {
    data = await apiGet("loans.get", {loanId});
  } catch (error) {
    handleApiError(error, "Failed to load loan details");
    showSpinner(false);
    return;
  }
  showSpinner(false);

  const loan = data.loan || {};
  const borrower = members.find((m) => m.uid === loan.borrowerId) || {};
  const borrowerName = borrower.fullName || loan.borrowerName || "Unknown";
  const initials = borrowerName.split(" ").map((n) => n[0]).filter(Boolean).join("").toUpperCase().substring(0, 2) || "??";

  const principal = numberOf(loan.approvedAmount ?? loan.principalAmount);
  const interest = numberOf(loan.totalInterest);
  const totalDue = numberOf(loan.totalRepayment);
  const repaid = numberOf(loan.amountRepaid);

  const modal = el("div", "modal-overlay active");
  modal.id = "loanDetailsModal";

  const content = el("div", "modal-content");
  content.style.maxWidth = "520px";

  const modalHeader = el("div", "modal-header");
  const title = el("h2", "modal-title");
  title.textContent = "Loan Details";
  const closeBtn = el("button", "modal-close");
  closeBtn.innerHTML = "&times;"; // static entity only, no user data
  closeBtn.addEventListener("click", () => modal.remove());
  modalHeader.append(title, closeBtn);

  const modalBody = el("div", "modal-body");

  const identityRow = el("div");
  identityRow.style.cssText = "display: flex; align-items: center; gap: var(--bn-space-4); margin-bottom: var(--bn-space-6); padding-bottom: var(--bn-space-4); border-bottom: 1px solid var(--bn-gray-lighter);";
  const avatar = el("div");
  avatar.style.cssText = "width: 56px; height: 56px; border-radius: 50%; background: var(--bn-gradient-primary); color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.25rem;";
  avatar.textContent = initials;
  const idInfo = el("div");
  const idName = el("div");
  idName.style.cssText = "font-weight: 700; font-size: var(--bn-text-lg);";
  idName.textContent = borrowerName;
  const idPhone = el("div");
  idPhone.style.cssText = "font-size: var(--bn-text-sm); color: var(--bn-gray);";
  idPhone.textContent = borrower.phone || "";
  idInfo.append(idName, idPhone);
  identityRow.append(avatar, idInfo);
  modalBody.appendChild(identityRow);

  const grid = el("div");
  grid.style.cssText = "display: grid; grid-template-columns: 1fr 1fr; gap: var(--bn-space-4);";
  grid.append(
    detailPair("Principal", formatCurrency(principal)),
    detailPair("Interest", formatCurrency(interest)),
    detailPair("Total Repayable", formatCurrency(totalDue)),
    detailPair("Repaid", formatCurrency(repaid)),
    detailPair("Status", loan.status || "N/A"),
    detailPair("Requested", formatDate(loan.requestedAt)),
  );
  modalBody.appendChild(grid);

  if (loan.purpose) {
    const purposeWrap = el("div");
    purposeWrap.style.cssText = "margin-top: var(--bn-space-4); padding: var(--bn-space-3); background: var(--bn-gray-100); border-radius: var(--bn-radius-md);";
    const label = el("span");
    label.style.cssText = "color: var(--bn-gray); font-size: var(--bn-text-xs); text-transform: uppercase;";
    label.textContent = "Purpose";
    const value = el("div");
    value.style.cssText = "font-size: var(--bn-text-sm);";
    value.textContent = loan.purpose;
    purposeWrap.append(label, value);
    modalBody.appendChild(purposeWrap);
  }

  content.append(modalHeader, modalBody);
  modal.appendChild(content);
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}

function detailPair(label, value) {
  const wrap = el("div");
  const labelEl = el("span");
  labelEl.style.cssText = "color: var(--bn-gray); font-size: var(--bn-text-sm);";
  labelEl.textContent = label;
  const valueEl = el("div");
  valueEl.style.fontWeight = "700";
  valueEl.textContent = value;
  wrap.append(labelEl, valueEl);
  return wrap;
}

// ── Generic reason-prompt modal (replaces prompt()) ─────────────────────────
/**
 * Builds a small, self-contained modal with a textarea, in place of the
 * disallowed prompt(). Built entirely with createElement/textContent.
 * @param {{title:string, label:string, confirmLabel:string, onConfirm:(reason:string)=>void}} opts
 */
function promptForReason(opts) {
  const overlay = el("div", "modal-overlay active");
  overlay.id = "reasonPromptModal";

  const content = el("div", "modal-content");
  content.style.maxWidth = "440px";

  const header = el("div", "modal-header");
  const title = el("h2", "modal-title");
  title.textContent = opts.title;
  const closeBtn = el("button", "modal-close");
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => overlay.remove());
  header.append(title, closeBtn);

  const body = el("div", "modal-body");
  const label = el("label", "form-label");
  label.textContent = opts.label;
  const textarea = document.createElement("textarea");
  textarea.className = "form-textarea";
  textarea.rows = 4;
  textarea.style.width = "100%";
  body.append(label, textarea);

  const footer = el("div", "modal-footer");
  const cancelBtn = el("button", "btn btn-ghost");
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => overlay.remove());
  const confirmBtn = el("button", "btn btn-danger");
  confirmBtn.textContent = opts.confirmLabel;
  confirmBtn.addEventListener("click", () => {
    const reason = textarea.value.trim();
    if (!reason) {
      showToast("A reason is required", "error");
      return;
    }
    overlay.remove();
    opts.onConfirm(reason);
  });
  footer.append(cancelBtn, confirmBtn);

  content.append(header, body, footer);
  overlay.appendChild(content);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  textarea.focus();
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * Small inline avatar+name for the Borrower table cell (.table-borrower /
 * .table-borrower-avatar, styles/manage_loans.html-local). Denser stand-in
 * for the card view's .loan-borrower-avatar, used in both the Loans table
 * and the Pending Payments review table.
 */
function borrowerIdentity(name) {
  const safeName = name || "Unknown";
  const initials = safeName.split(" ").map((n) => n[0]).filter(Boolean).join("").toUpperCase().substring(0, 2) || "?";
  const wrap = el("div", "table-borrower");
  const avatar = el("span", "table-borrower-avatar");
  avatar.textContent = initials;
  avatar.setAttribute("aria-hidden", "true");
  const nameEl = el("span", "table-borrower-name");
  nameEl.textContent = safeName;
  wrap.append(avatar, nameEl);
  return wrap;
}

function numberOf(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(value) {
  if (!value) return "N/A";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "N/A" : d.toLocaleDateString();
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function showModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add("active");
  modal.classList.remove("hidden");
  modal.style.display = "flex";
}

function hideModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("active");
  modal.classList.add("hidden");
  modal.style.display = "none";
}

function showSpinner(show) {
  const node = spinner();
  if (node) node.classList.toggle("hidden", !show);
}

/** Centralised ApiError handling: 401 -> login (already handled by requireSession). */
function handleApiError(error, fallback) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      redirectToLogin();
      return;
    }
    if (error.status === 403) {
      showToast("You do not have permission to do that.", "error");
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
