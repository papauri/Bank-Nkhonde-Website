/**
 * loan_payments_sql.js — SQL port of loan_payments.js (the MEMBER loan-repayment
 * page: view my loans, submit a repayment with proof, track pending + history).
 *
 * Not wired into any page until the atomic M4 cutover.
 *
 * Endpoints:
 *   loans.list        -> my loans (server restricts a member to their OWN rows)
 *   repayments.mine   -> my repayments, every status (pending / approved / rejected)
 *   files.upload      -> multipart proof upload; returns {url}
 *   repayments.record -> files the repayment as PENDING; the SERVER computes the
 *                        penalty/interest/principal split. The client sends only
 *                        the amount — it never does money math.
 *
 * Money: every figure displayed comes from the API. Nothing is recomputed here.
 * DOM: no data-bearing innerHTML — the Firebase original's giant template strings
 * are rebuilt with createElement + textContent.
 */

import {apiGet, apiPost, requireSession, listMyGroups, ApiError, redirectToLogin, logout, apiUrl} from "./api.js";
import { emptyState as uiEmptyState, skeletonRows, renderQuickAmounts, renderUpcomingInstalments } from "./ui.js";
import { formatCurrency } from "./utils_financial.js";

let currentUser = null;
let currentGroupId = null;
let allLoans = [];
let activeLoans = [];
let pendingPayments = [];
let paymentHistory = [];
let currentLoanTab = "active";

/** A loan that can actually receive a repayment (matches the server's payable set). */
const PAYABLE_STATUSES = ["approved", "disbursed"];

export async function init() {
  setupEventListeners();

  try {
    currentUser = await requireSession(); // redirects to login on 401
  } catch (error) {
    return;
  }

  await loadUserGroups();
}
if (!window.__bnSpa) {
  document.addEventListener("DOMContentLoaded", () => { init(); });
}

function setupEventListeners() {
  const groupSelector = document.getElementById("groupSelector");
  if (groupSelector) {
    groupSelector.addEventListener("change", async (e) => {
      currentGroupId = e.target.value;
      if (currentGroupId) {
        localStorage.setItem("selectedGroupId", currentGroupId);
        sessionStorage.setItem("selectedGroupId", currentGroupId);
        await loadLoanData();
      } else {
        clearDisplay();
      }
    });
  }

  // NOTE: #makePaymentBtn does not exist in the real markup (pages/loan_payments.html) —
  // the page opens the payment modal per-loan instead, via the "Make Payment" button
  // built in createLoanRow(). This listener is a guarded no-op kept only in case a
  // future top-level trigger is added with this id.
  document.getElementById("makePaymentBtn")?.addEventListener("click", () => {
    if (activeLoans.length > 0) openPaymentModal(activeLoans[0]);
  });

  document.getElementById("closePaymentModal")?.addEventListener("click", closePaymentModal);
  document.getElementById("loanPaymentForm")?.addEventListener("submit", handlePaymentSubmit);

  const paymentDateInput = document.getElementById("paymentDate");
  if (paymentDateInput) paymentDateInput.value = new Date().toISOString().split("T")[0];

  document.querySelectorAll(".action-tab[data-tab]").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      document.querySelectorAll(".action-tab").forEach((t) => t.classList.remove("active"));
      const el = e.currentTarget;
      el.classList.add("active");
      currentLoanTab = el.dataset.tab;
      displayLoansByTab();
      document.getElementById("loansList")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.getElementById("loanStatusFilter")?.addEventListener("change", (e) => {
    displayLoansByTab(e.target.value);
  });
}

// ── Groups ──────────────────────────────────────────────────────────────────
async function loadUserGroups() {
  const groupSelector = document.getElementById("groupSelector");
  try {
    const groups = await listMyGroups();

    if (groupSelector) {
      groupSelector.textContent = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a group...";
      groupSelector.appendChild(placeholder);

      groups.forEach((group) => {
        const option = document.createElement("option");
        option.value = group.groupId || group.id;
        option.textContent = group.groupName || group.name || "Unnamed group";
        groupSelector.appendChild(option);
      });
    }

    if (groups.length === 0) {
      clearDisplay();
      return;
    }

    const saved = localStorage.getItem("selectedGroupId") || sessionStorage.getItem("selectedGroupId");
    const match = groups.find((g) => (g.groupId || g.id) === saved);
    const chosen = match || groups[0];
    currentGroupId = chosen.groupId || chosen.id;
    if (groupSelector) groupSelector.value = currentGroupId;

    await loadLoanData();
  } catch (error) {
    handleApiError(error, "Failed to load groups");
  }
}

// ── Load loans + repayments ─────────────────────────────────────────────────
async function loadLoanData() {
  if (!currentGroupId) return;

  // Hold the table's shape while the two requests are in flight, so the page
  // doesn't collapse to nothing and then snap back.
  const loansList = document.getElementById("loansList");
  if (loansList) {
    loansList.textContent = "";
    loansList.appendChild(skeletonRows(3, 8));
  }

  try {
    const [loansResp, paymentsResp] = await Promise.all([
      apiGet("loans.list", {groupId: currentGroupId}),
      apiGet("repayments.mine", {groupId: currentGroupId}),
    ]);

    allLoans = Array.isArray(loansResp && loansResp.loans) ? loansResp.loans : [];
    activeLoans = allLoans.filter((l) => PAYABLE_STATUSES.includes(l.status));

    const payments = Array.isArray(paymentsResp && paymentsResp.payments)
      ? paymentsResp.payments : [];
    pendingPayments = payments.filter((p) => p.status === "pending");
    // History = everything adjudicated, so a rejection is visible with its reason.
    paymentHistory = payments.filter((p) => p.status === "approved" || p.status === "rejected");

    updateStats();
    displayLoansByTab();
    displayPendingPayments();
    displayPaymentHistory();
  } catch (error) {
    handleApiError(error, "Failed to load loan data");
  }
}

// ── Stats ───────────────────────────────────────────────────────────────────
function updateStats() {
  // Sum server-provided figures only — no recomputation of any balance.
  let totalOutstanding = 0;
  let totalPaid = 0;
  activeLoans.forEach((loan) => {
    totalOutstanding += numberOf(loan.remainingBalance);
    totalPaid += numberOf(loan.amountRepaid);
  });

  // NOTE: #activeLoansCount and #totalOutstanding do not exist anywhere in the real
  // markup (pages/loan_payments.html has no summary stat cards on this page) — these
  // are guarded no-ops until such elements are added to the page.
  setText("activeLoansCount", activeLoans.length);
  setText("totalOutstanding", formatCurrency(totalOutstanding));
  // #totalPaidAmount is the real id (also reused inside the payment modal for a
  // single loan's amount-paid figure). Since the modal is hidden by default and
  // openPaymentModal() always overwrites this element with the correct per-loan
  // value before the modal is shown, writing the aggregate figure here first is safe.
  setText("totalPaidAmount", formatCurrency(totalPaid));
  setText("pendingPaymentsCount", pendingPayments.length);

  // NOTE: #makePaymentBtn does not exist in the real markup — see setupEventListeners().
  const makePaymentBtn = document.getElementById("makePaymentBtn");
  if (makePaymentBtn) {
    makePaymentBtn.style.display = activeLoans.length > 0 ? "block" : "none";
  }
}

// ── Loans list ──────────────────────────────────────────────────────────────
function displayLoansByTab(filterValue = null) {
  const loansList = document.getElementById("loansList");
  if (!loansList) return;

  const activeFilter = filterValue || currentLoanTab;

  let filtered;
  if (activeFilter === "all") {
    filtered = allLoans;
  } else if (activeFilter === "active") {
    filtered = allLoans.filter((l) => PAYABLE_STATUSES.includes(l.status));
  } else if (activeFilter === "repaid") {
    filtered = allLoans.filter((l) => l.status === "repaid" || l.status === "completed");
  } else {
    filtered = allLoans.filter((l) => l.status === activeFilter);
  }

  const titles = {
    pending: "Pending Loan Requests",
    approved: "Approved Loans",
    active: "Active Loans",
    repaid: "Repaid Loans",
    all: "All My Loans",
  };
  setText("loansSectionTitle", titles[activeFilter] || "My Loans");

  loansList.textContent = "";

  if (filtered.length === 0) {
    loansList.appendChild(loansEmptyRow(activeFilter));
    return;
  }

  filtered.forEach((loan) => loansList.appendChild(createLoanRow(loan)));
}

/**
 * Renders one loan as a <tr> for the .table.table-responsive component
 * (pure-CSS desktop table / mobile card collapse — see design-system.css).
 * Carries every field createLoanCard() used to show: loan title, status
 * badge, purpose+date, loan amount, amount paid, and the conditional extras
 * (interest, total repayable, remaining balance, due date) which don't map
 * to a fixed column — those are folded into one optional "Details" cell that
 * stays empty (data-label="") when none apply, matching the pilot's pattern
 * in manage_payments_sql.js's createPaymentRow().
 */
function createLoanRow(loan) {
  const row = el("tr");

  const principal = numberOf(loan.principalAmount ?? loan.approvedAmount);
  const repaid = numberOf(loan.amountRepaid);
  const remaining = numberOf(loan.remainingBalance);
  const interest = numberOf(loan.totalInterest);

  const statusLabels = {
    pending: "Pending",
    approved: "Approved",
    disbursed: "Active",
    repaid: "Repaid",
    completed: "Repaid",
    rejected: "Rejected",
  };
  const statusClasses = {
    pending: "warning",
    approved: "success",
    disbursed: "info",
    repaid: "success",
    completed: "success",
    rejected: "danger",
  };
  const label = statusLabels[loan.status] || "Unknown";
  const badgeClass = statusClasses[loan.status] || "secondary";

  const loanCell = el("td");
  loanCell.dataset.label = "Loan";
  const loanRef = loan.loanNumber || `#${String(loan.loanId || "").substring(0, 8).toUpperCase()}`;
  loanCell.textContent = `Loan ${loanRef}`;
  row.appendChild(loanCell);

  const statusCell = el("td");
  statusCell.dataset.label = "Status";
  const badge = el("span", `badge badge-${badgeClass}`);
  badge.textContent = label;
  statusCell.appendChild(badge);
  row.appendChild(statusCell);

  const principalCell = el("td", "cell-right");
  principalCell.dataset.label = "Principal";
  principalCell.textContent = formatCurrency(principal);
  row.appendChild(principalCell);

  const remainingCell = el("td", "cell-right" + (remaining > 0 ? " cell-danger" : ""));
  remainingCell.dataset.label = "Remaining";
  remainingCell.textContent = formatCurrency(remaining);
  row.appendChild(remainingCell);

  const paidCell = el("td", "cell-right");
  paidCell.dataset.label = "Paid";
  paidCell.textContent = formatCurrency(repaid);
  row.appendChild(paidCell);

  const interestCell = el("td", "cell-right");
  interestCell.dataset.label = "Interest";
  interestCell.textContent = formatCurrency(interest);
  row.appendChild(interestCell);

  // Next payment date — loans.list returns dueDate. For active loans with
  // a remaining balance, show whether the next scheduled date is overdue.
  const nextCell = el("td");
  nextCell.dataset.label = "Next Payment";
  if (PAYABLE_STATUSES.includes(loan.status) && loan.dueDate) {
    const due = new Date(String(loan.dueDate).replace(" ", "T"));
    if (!Number.isNaN(due.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isOverdue = due < today;
      const dayStr = due.toLocaleDateString(undefined, { day: "numeric", month: "short" });
      const yearStr = due.getFullYear() !== today.getFullYear()
        ? ` ${due.getFullYear()}` : "";
      if (isOverdue) {
        const days = Math.floor((today - due) / 86400000);
        const span = el("span", "badge badge-danger");
        span.textContent = `Overdue ${days}d`;
        const detail = el("div");
        detail.style.cssText = "font-size: 10px; color: var(--bn-gray);";
        detail.textContent = `Was ${dayStr}${yearStr}`;
        nextCell.append(span, detail);
      } else {
        const span = el("span");
        span.style.cssText = "font-weight: 600; color: var(--bn-dark);";
        span.textContent = dayStr + yearStr;
        nextCell.appendChild(span);
      }
    } else {
      nextCell.textContent = "—";
    }
  } else {
    nextCell.textContent = "—";
  }
  row.appendChild(nextCell);

  // Actions: Pay button + History link
  const actionsCell = el("td");
  const actionsDiv = el("div");
  actionsDiv.style.cssText = "display: flex; gap: 4px; flex-wrap: wrap;";

  const canPay = PAYABLE_STATUSES.includes(loan.status) && remaining > 0;
  if (canPay) {
    const payBtn = el("button", "btn btn-accent btn-sm");
    payBtn.textContent = "Pay";
    payBtn.addEventListener("click", () => openPaymentModal(loan));
    actionsDiv.appendChild(payBtn);
  }

  // History button — shows all repayments for this specific loan
  const historyBtn = el("button", "btn btn-ghost btn-sm");
  historyBtn.textContent = "History";
  historyBtn.addEventListener("click", () => showLoanHistory(loan.loanId));
  actionsDiv.appendChild(historyBtn);

  actionsCell.appendChild(actionsDiv);
  if (actionsDiv.childNodes.length) {
    actionsCell.dataset.label = "Actions";
  } else {
    actionsCell.dataset.label = "";
  }
  row.appendChild(actionsCell);

  return row;
}

/**
 * Show repayment history for a single loan in a modal.
 * Repayments.mine already has every payment for the member's loans — filter
 * client-side rather than making a separate fetch.
 * @param {string} loanId
 */
/**
 * A server datetime ("2025-04-15 00:00:00") as a short local date. Returns "—"
 * for a missing or unparseable value rather than "Invalid Date".
 * @param {string} value
 * @return {string}
 */
function formatDateOnly(value) {
  if (!value) return "—";
  // Safari rejects the space-separated form; the T separator parses everywhere.
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

async function showLoanHistory(loanId) {
  const relevant = paymentHistory.filter((p) => String(p.loanId) === String(loanId));
  const loan = allLoans.find((l) => String(l.loanId) === String(loanId));
  const ref = loan ? (loan.loanNumber || `#${String(loan.loanId || "").substring(0, 8)}`) : "loan";

  const modal = document.getElementById("loanHistoryModal");
  if (!modal) return;

  const title = modal.querySelector("#loanHistoryTitle");
  const body = modal.querySelector("#loanHistoryBody");
  if (title) title.textContent = `Loan ${ref} — payments and schedule`;
  if (!body) return;
  body.textContent = "";

  /* The member could see what they had PAID but never what was still to come.
     "When is my next instalment and how much" is the question this modal is
     opened to answer, so the schedule is fetched alongside the history.
     Failure is non-fatal: the payments list below still renders. */
  let schedule = null;
  let loanHistory = null;
  try {
    const balance = await apiGet("repayments.balance", { loanId });
    schedule = balance && balance.schedule;
    loanHistory = balance && balance.history;
  } catch (e) {
    schedule = null;
  }

  /* THE PAYMENT LIST IS SCOPED TO THIS LOAN, not to the viewer.
     It used to filter `repayments.mine` — the caller's OWN repayments — which
     is right for a member looking at their own loan but wrong for an admin
     using this page: `loans.list` returns every loan in the group for an admin,
     while `repayments.mine` returns only their own, so the modal showed
     "No repayments recorded" over a schedule that plainly said Paid.
     The loan's own history answers the question the modal is actually asking.
     Falls back to the filtered list if the fetch failed. */
  const rows = Array.isArray(loanHistory) ? loanHistory : relevant;

  if (!rows.length) {
    const empty = el("div", "empty-state");
    const icon = el("div", "empty-state-icon");
    icon.textContent = "📋";
    const text = el("p", "empty-state-text");
    text.textContent = "No repayments recorded for this loan yet.";
    empty.append(icon, text);
    body.appendChild(empty);
  } else {
    /* TOTAL REPAID COMES FROM THE SERVER.
       This used to be `relevant.reduce(...)` — adding money up in the browser,
       and subtracting the penalty portion as it went. That is the defect class
       this project has shipped repeatedly: a second, independently-derived
       total that is free to drift from the one the rest of the app shows.
       `loan.amountRepaid` is the figure every other surface uses. */
    const summary = el("div");
    summary.style.cssText = "margin-bottom: var(--bn-space-3); padding: var(--bn-space-3); background: var(--bn-gray-50); border-radius: var(--bn-radius-md);";
    const sLabel = document.createElement("span");
    sLabel.style.cssText = "font-size: var(--bn-text-sm); color: var(--bn-gray);";
    sLabel.textContent = "Total repaid: ";
    const sValue = document.createElement("strong");
    sValue.textContent = formatCurrency((loan && loan.amountRepaid) || "0.00");
    summary.append(sLabel, sValue);
    if (loan && loan.remainingBalance != null) {
      const still = document.createElement("span");
      still.style.cssText = "font-size: var(--bn-text-sm); color: var(--bn-gray); margin-left: var(--bn-space-3);";
      still.textContent = `Still owed: ${formatCurrency(loan.remainingBalance)}`;
      summary.appendChild(still);
    }
    body.appendChild(summary);

    rows.forEach((p) => {
      const row = el("div");
      row.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: var(--bn-space-2) 0; border-bottom: 1px solid var(--bn-gray-100); font-size: var(--bn-text-sm);";

      const left = el("span");
      const when = p.paidAt ? new Date(p.paidAt).toLocaleDateString() : "N/A";
      left.textContent = `${when} · ${formatCurrency(p.amount)}`;
      row.appendChild(left);

      const right = el("span");
      const cls = p.status === "approved" ? "badge badge-success" : p.status === "rejected" ? "badge badge-danger" : "badge badge-warning";
      const badgeEl = el("span", cls);
      badgeEl.textContent = p.status || "pending";
      right.appendChild(badgeEl);
      row.appendChild(right);

      body.appendChild(row);
    });
  }

  /* WHAT IS STILL TO COME. Every instalment with its due date, whether it is
     settled, due, or already late, and how much of it remains. A member could
     previously see only what they had paid — never what was next. */
  if (Array.isArray(schedule) && schedule.length) {
    const schedHeading = el("div");
    schedHeading.style.cssText =
      "margin-top: var(--bn-space-4); margin-bottom: var(--bn-space-2); font-size: var(--bn-text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--bn-gray);";
    schedHeading.textContent = "Repayment schedule";
    body.appendChild(schedHeading);

    schedule.forEach((s) => {
      const outstanding = numberOf(s.balance);
      const settled = outstanding <= 0;
      // Driven by the actual balance, not the stored status flag — a row can be
      // marked "paid" while still carrying a rounding remainder.
      const late = !settled && s.dueDate
        && new Date(String(s.dueDate).replace(" ", "T")) < new Date();

      const row = el("div");
      row.style.cssText =
        "display: flex; justify-content: space-between; align-items: baseline; gap: var(--bn-space-3); padding: var(--bn-space-2) 0; border-bottom: 1px solid var(--bn-gray-100); font-size: var(--bn-text-sm);";

      const left = el("div");
      const when = el("div");
      when.style.cssText = "font-weight: 600;";
      when.textContent = `Month ${s.month} · due ${formatDateOnly(s.dueDate)}`;
      const note = el("div");
      note.style.cssText = "color: var(--bn-gray); font-size: var(--bn-text-xs);";
      note.textContent = settled
        ? (s.paidAt ? `Paid ${formatDateOnly(s.paidAt)}` : "Paid")
        : `${formatCurrency(s.balance)} still to pay`;
      left.append(when, note);

      const right = el("div");
      right.style.cssText = "text-align: right; white-space: nowrap;";
      const amt = el("div");
      amt.style.cssText = "font-weight: 700;";
      amt.textContent = formatCurrency(s.totalDue);
      const badgeEl = el("span", settled
        ? "badge badge-success"
        : late ? "badge badge-danger" : "badge badge-warning");
      badgeEl.textContent = settled ? "settled" : late ? "overdue" : "due";
      right.append(amt, badgeEl);

      row.append(left, right);
      body.appendChild(row);
    });
  }

  // Show the modal using the same pattern as other modals on the page
  modal.classList.remove("hidden");
  modal.classList.add("active");
  modal.style.display = "flex";
}

/**
 * Empty state for the loans table, worded for the filter in play. An empty
 * "repaid" tab is a neutral fact; an empty "all" tab means this member simply
 * has no loans yet and should be told where to request one.
 * @param {string} filter the active status filter
 * @return {HTMLElement} a full-width table row
 */
function loansEmptyRow(filter) {
  const row = el("tr");
  const cell = el("td");
  cell.colSpan = 8;
  cell.dataset.label = "";
  cell.style.padding = "0";

  const byFilter = {
    pending: {
      icon: "⏳",
      title: "No loan requests waiting",
      description: "Requests you submit stay here until an admin approves them.",
    },
    approved: {
      icon: "📄",
      title: "No approved loans",
      description: "Approved loans appear here once an admin signs them off.",
    },
    active: {
      icon: "✅",
      title: "No active loans",
      description: "You have nothing to repay right now.",
      good: true,
    },
    repaid: {
      icon: "🎉",
      title: "No loans fully repaid yet",
      description: "Loans you finish paying off are kept here as a record.",
    },
  };

  const fallback = {
    icon: "💰",
    title: "You have no loans yet",
    description: "When you request a loan and it is approved, it will show here "
      + "with its repayment schedule.",
    actions: [{label: "Go to dashboard", href: "user_dashboard.html", variant: "accent"}],
  };

  cell.appendChild(uiEmptyState(byFilter[filter] || fallback));
  row.appendChild(cell);
  return row;
}

function emptyTableRow(text) {
  const row = el("tr");
  const cell = el("td");
  cell.colSpan = 8;
  cell.dataset.label = "";
  cell.style.cssText = "text-align: center; padding: var(--bn-space-4); color: var(--bn-gray);";
  cell.textContent = text;
  row.appendChild(cell);
  return row;
}

// ── Pending + history lists ─────────────────────────────────────────────────
function displayPendingPayments() {
  const list = document.getElementById("pendingPaymentsList");
  if (!list) return;
  list.textContent = "";

  if (pendingPayments.length === 0) {
    list.appendChild(uiEmptyState({
      icon: "✅",
      title: "No payments awaiting approval",
      description: "Payments you submit appear here until an admin approves them.",
      good: true,
    }));
    return;
  }
  pendingPayments.forEach((p) => list.appendChild(createPaymentRow(p, "pending")));
}

function displayPaymentHistory() {
  const list = document.getElementById("paymentHistoryList");
  if (!list) return;
  list.textContent = "";

  if (paymentHistory.length === 0) {
    list.appendChild(uiEmptyState({
      icon: "📋",
      title: "No payments yet",
      description: "Once you make a repayment it will be listed here with its date and amount.",
    }));
    return;
  }
  paymentHistory.slice(0, 10).forEach((p) => list.appendChild(createPaymentRow(p, p.status)));
}

function createPaymentRow(payment, status) {
  const div = el("div", "list-item");

  const body = el("div");
  body.style.flex = "1";

  const title = el("div", "list-item-title");
  const penalty = numberOf(payment.penaltyPortion);
  title.textContent = formatCurrency(numberOf(payment.amount));
  if (penalty > 0) {
    const pen = document.createElement("span");
    pen.style.color = "var(--bn-danger)";
    pen.textContent = ` (incl. ${formatCurrency(penalty)} penalty)`;
    title.appendChild(pen);
  }

  const subtitle = el("div", "list-item-subtitle");
  const loanRef = payment.loanNumber || `#${String(payment.loanId || "").substring(0, 8)}`;
  const paidDate = payment.paidAt ? new Date(payment.paidAt).toLocaleDateString() : "N/A";
  subtitle.textContent = `Loan ${loanRef} • Paid ${paidDate}`;

  body.append(title, subtitle);

  if (payment.notes) {
    const notes = el("div");
    notes.style.cssText = "margin-top:4px; font-size:0.875rem; color: var(--bn-gray);";
    notes.textContent = `📝 ${payment.notes}`;
    body.appendChild(notes);
  }
  if (status === "rejected" && payment.rejectionReason) {
    const reason = el("div");
    reason.style.cssText = "margin-top:4px; font-size:0.875rem; color: var(--bn-danger);";
    reason.textContent = `Rejected: ${payment.rejectionReason}`;
    body.appendChild(reason);
  }

  const side = el("div");
  const badgeClass = status === "pending" ? "warning" : status === "rejected" ? "danger" : "success";
  const badgeText = status === "pending" ? "Pending Approval" : status === "rejected" ? "Rejected" : "Approved";
  const badge = el("span", `badge badge-${badgeClass}`);
  badge.textContent = badgeText;
  side.appendChild(badge);

  if (payment.proofOfPaymentImageUrl) {
    const link = document.createElement("a");
    link.href = payment.proofOfPaymentImageUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "btn btn-ghost btn-sm";
    link.style.marginTop = "8px";
    link.textContent = "View Proof";
    side.appendChild(link);
  }

  div.append(body, side);
  return div;
}

// ── Payment modal ───────────────────────────────────────────────────────────
/**
 * "How this loan adds up", in plain language: what was borrowed, what the
 * interest came to (with the per-month rates spelled out, since they differ by
 * month), the total repayable, what's been paid, and what's still owed.
 *
 * IMPORTANT: every figure here is read straight off the loan row — all of it
 * was computed server-side at approval (api/lib/money.php). Nothing on this
 * screen recalculates money; it only formats what the server already decided.
 * @param {Object} loan
 * @param {number} remaining loan.remainingBalance, already parsed
 */
function renderLoanMaths(loan, remaining) {
  const host = document.getElementById("loanMaths");
  if (!host) return;
  host.textContent = "";

  const principal = numberOf(loan.principalAmount ?? loan.approvedAmount);
  const interest = numberOf(loan.totalInterest);
  const total = numberOf(loan.totalRepayment);
  const paid = numberOf(loan.amountRepaid);
  const months = parseInt(loan.repaymentPeriod, 10) || 0;

  // Nothing meaningful to show until the loan has been priced at approval.
  if (total <= 0 && principal <= 0) return;

  const title = document.createElement("div");
  title.className = "loan-maths-title";
  title.textContent = "How this loan adds up";
  host.appendChild(title);

  const row = (label, value, cls) => {
    const r = document.createElement("div");
    r.className = "loan-maths-row" + (cls ? ` ${cls}` : "");
    const l = document.createElement("span");
    l.className = "lm-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "lm-value";
    v.textContent = value;
    r.append(l, v);
    host.appendChild(r);
  };

  row("Amount borrowed", formatCurrency(principal));

  // The group charges a different rate per month of the term, so name them
  // rather than showing one blended number the member can't reconcile.
  const rates = [loan.interestRateMonth1, loan.interestRateMonth2, loan.interestRateMonth3]
    .slice(0, months > 0 ? months : 3)
    .map((r) => (r === null || r === undefined || r === "" ? null : `${numberOf(r)}%`))
    .filter(Boolean);
  const rateLabel = rates.length
    ? `Interest (${rates.join(" → ")} per month)`
    : "Interest";
  row(rateLabel, formatCurrency(interest));

  row("Total to repay", formatCurrency(total), "is-total");
  row("Paid so far", formatCurrency(paid));
  row("Still owed", formatCurrency(remaining), "is-owing");

  const note = document.createElement("div");
  note.className = "loan-maths-note";
  // Deliberately NOT quoting loans.monthlyPayment as "your monthly payment":
  // that column is totalRepayment / period, a flat average. Under this app's
  // reducing-balance schedule the real instalments differ month to month (on
  // LN-0001: 21,666.67 / 21,666.67 / 19,999.99 against an average of
  // 21,111.11), so quoting it would misstate what is actually owed. The exact
  // per-month figures are listed in the schedule below.
  if (months > 0) {
    note.textContent =
      `Repaid over ${months} month${months === 1 ? "" : "s"}. Interest is charged `
      + `on the balance still outstanding, so each instalment differs — the exact `
      + `amounts are listed below, and paying early reduces what you pay overall.`;
  } else {
    note.textContent =
      "Interest is charged on the balance still outstanding, so paying early "
      + "reduces what you pay overall.";
  }
  host.appendChild(note);
}

/**
 * Load and render this loan's month-by-month repayment schedule.
 *
 * The schedule is NOT computed here — it is stored server-side in
 * loan_repayment_schedule (written when the loan is approved) and returned by
 * loans.get. Each row already carries its due date, its principal/interest
 * split, how much has been paid against it, and its status. This only formats
 * that, so the months shown always agree with what the server will actually
 * charge.
 * @param {string} loanId
 */
async function renderLoanSchedule(loanId) {
  const host = document.getElementById("loanSchedule");
  if (!host) return;
  host.textContent = "";

  let rows;
  try {
    const data = await apiGet("loans.get", {loanId});
    rows = Array.isArray(data && data.schedule) ? data.schedule : [];
  } catch (error) {
    // The payment form is still perfectly usable without the schedule, so a
    // failure here must not block it — show nothing rather than an error wall.
    return;
  }
  if (!rows.length) return;

  const title = document.createElement("div");
  title.className = "loan-schedule-title";
  title.textContent = "Payment schedule";
  host.appendChild(title);

  // The next instalment = the first that isn't fully settled. Highlighted so
  // the member can see at a glance what to pay now.
  const nextIndex = rows.findIndex(
    (r) => numberOf(r.amountPaid) < numberOf(r.totalDue)
  );

  // ACCOUNTING FIX: pre-fill the amount from the ACTUAL next instalment, not
  // loans.monthlyPayment. That column is totalRepayment / period — a flat
  // average which, under this app's reducing-balance schedule, matches no real
  // instalment. On LN-0001 it reads 21,111.11 while the true instalments are
  // 21,666.67 / 21,666.67 / 19,999.99, so a member paying the pre-filled figure
  // would UNDERPAY month 2 by 555.56 and think they were square.
  if (nextIndex >= 0) {
    const next = rows[nextIndex];
    const stillDue = numberOf(next.totalDue) - numberOf(next.amountPaid);
    const input = document.getElementById("paymentAmount");
    const hint = document.getElementById("paymentAmountHint");
    if (input && stillDue > 0) {
      input.value = String(stillDue);
      if (hint) {
        hint.textContent =
          `Pre-filled with instalment ${next.month} (${formatCurrency(stillDue)}). `
          + `You can pay any amount up to your full outstanding balance. `
          + `Payments clear penalties first, then interest, then the principal.`;
      }
    }
  }

  rows.forEach((r, i) => {
    const due = numberOf(r.totalDue);
    const paid = numberOf(r.amountPaid);
    const settled = paid >= due && due > 0;

    const row = document.createElement("div");
    row.className = "sched-row"
      + (i === nextIndex ? " is-next" : "")
      + (settled ? " is-paid" : "");

    const month = document.createElement("span");
    month.className = "sched-month";
    month.textContent = `Month ${r.month}`;

    const when = document.createElement("span");
    when.className = "sched-date";
    const d = r.dueDate ? new Date(String(r.dueDate).replace(" ", "T")) : null;
    const dateText = d && !Number.isNaN(d.getTime())
      ? d.toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"})
      : "";
    if (settled) {
      when.textContent = dateText ? `Paid · due ${dateText}` : "Paid";
    } else if (i === nextIndex) {
      when.textContent = dateText ? `Next payment · due ${dateText}` : "Next payment";
    } else {
      when.textContent = dateText ? `Due ${dateText}` : "";
    }

    const amount = document.createElement("span");
    amount.className = "sched-amount";
    amount.textContent = formatCurrency(due);
    // Show WHY the instalment is that size — principal vs interest — which is
    // the part members most often ask about.
    const interest = numberOf(r.interestDue);
    if (interest > 0) {
      const split = document.createElement("span");
      split.className = "sched-split";
      split.textContent =
        `${formatCurrency(numberOf(r.principalDue))} principal + ${formatCurrency(interest)} interest`;
      amount.appendChild(split);
    }

    row.append(month, when, amount);
    host.appendChild(row);
  });
}

function openPaymentModal(loan) {
  if (!loan) return;

  const remaining = numberOf(loan.remainingBalance);

  setValue("paymentLoanId", loan.loanId);
  setValue("loanReference", loan.loanNumber || `LOAN-${String(loan.loanId || "").substring(0, 8).toUpperCase()}`);

  setText("outstandingBalance", formatCurrency(remaining));
  setText("totalPaidAmount", formatCurrency(numberOf(loan.amountRepaid)));
  setText("totalLoanAmount", formatCurrency(numberOf(loan.totalRepayment)));

  renderLoanMaths(loan, remaining);
  // Fire-and-forget: the schedule fills in when it arrives; the form is usable
  // immediately either way.
  renderLoanSchedule(loan.loanId);

  // Pre-fill with the scheduled instalment (or the remaining balance when
  // that's smaller — never suggest paying more than is owed). The field stays
  // editable; this is a starting point, not a constraint.
  const scheduled = numberOf(loan.monthlyPayment);
  const suggested = scheduled > 0 && scheduled < remaining ? scheduled : remaining;

  const amountInput = document.getElementById("paymentAmount");
  if (amountInput) {
    amountInput.value = suggested > 0 ? String(suggested) : "";
    amountInput.max = remaining;
    amountInput.placeholder = `Max: ${formatCurrency(remaining)}`;
  }
  const hint = document.getElementById("paymentAmountHint");
  if (hint) {
    // The server computes the penalty/interest/principal split on submission —
    // do not preview a breakdown here, it would be a client-side guess.
    const lead = scheduled > 0 && scheduled < remaining
      ? `Pre-filled with your scheduled instalment (${formatCurrency(scheduled)}). `
      : `Pre-filled with your full outstanding balance. `;
    hint.textContent =
      `${lead}You can pay any amount up to ${formatCurrency(remaining)}. `
      + `Payments clear penalties first, then interest, then the principal.`;
  }

  const dateInput = document.getElementById("paymentDate");
  if (dateInput) dateInput.value = new Date().toISOString().split("T")[0];

  // Server-computed presets ("next instalment", "everything overdue", "pay off
  // in full"). Fire-and-forget like the schedule above — the form is usable
  // immediately and the presets appear when they arrive.
  loadRepaymentQuickAmounts(loan.loanId);

  showModal("paymentModal");
}

/**
 * Fetch and render the preset amounts for a loan.
 *
 * The figures come from repayments.balance, which computes them against the
 * SAME schedule and penalty that repayments.record allocates against — so a
 * preset can never be rejected by the endpoint it was built for. Nothing is
 * calculated here.
 * @param {string} loanId
 */
async function loadRepaymentQuickAmounts(loanId) {
  const container = document.getElementById("paymentQuickAmounts");
  const input = document.getElementById("paymentAmount");
  if (!container || !input) return;

  container.hidden = true;
  try {
    const data = await apiGet("repayments.balance", { loanId });
    renderQuickAmounts(container, data && data.quickAmounts, input, "Another amount");
    renderUpcomingInstalments(document.getElementById("paymentUpcoming"), data && data.upcoming);
  } catch (e) {
    // No presets is a fine outcome — the amount field still works. Never guess
    // a figure here as a fallback.
    container.hidden = true;
  }
}

function closePaymentModal() {
  hideModal("paymentModal");
}

async function handlePaymentSubmit(e) {
  e.preventDefault();

  const loanId = document.getElementById("paymentLoanId")?.value;
  const amount = parseFloat(document.getElementById("paymentAmount")?.value || "");
  const proofFile = document.getElementById("paymentProof")?.files?.[0];
  const notes = document.getElementById("paymentNotes")?.value.trim() || "";
  // Read the member's choice from the #paymentMethod select in the modal markup
  // (pages/loan_payments.html). Falls back to "cash" — a valid server enum value
  // (repayments.php REPAYMENT_METHODS: cash, bank_transfer, mobile_money) — only if
  // the element is somehow missing.
  const method = document.getElementById("paymentMethod")?.value || "cash";

  if (!loanId || !Number.isFinite(amount) || amount <= 0) {
    showToast("Enter a valid payment amount.", "error");
    return;
  }
  // Proof is required, as in the original — an unevidenced claim is not a payment.
  if (!proofFile) {
    showToast("Attach a proof of payment (photo or PDF of the receipt).", "error");
    return;
  }

  const loan = allLoans.find((l) => l.loanId === loanId);
  if (!loan) {
    showToast("Loan not found.", "error");
    return;
  }
  if (!PAYABLE_STATUSES.includes(loan.status)) {
    showToast("Payments can only be made once the loan is approved and disbursed.", "error");
    return;
  }

  const submitBtn = document.querySelector("#loanPaymentForm button[type=submit]");
  if (submitBtn) submitBtn.disabled = true;

  try {
    // 1) Upload the proof. Multipart — api.js only sends JSON, so a direct fetch,
    //    mirroring its credentials + defensive parsing.
    const proofUrl = await uploadProof(proofFile, currentGroupId);

    // 2) File the repayment. It lands PENDING; the SERVER computes the split.
    await apiPost("repayments.record", {
      loanId,
      amount,
      paymentMethod: method,
      notes: notes || undefined,
      proofOfPaymentImageUrl: proofUrl,
    });

    closePaymentModal();
    document.getElementById("loanPaymentForm")?.reset();
    const dateInput = document.getElementById("paymentDate");
    if (dateInput) dateInput.value = new Date().toISOString().split("T")[0];

    showToast("Payment submitted — awaiting admin approval.", "success");
    await loadLoanData();
  } catch (error) {
    handleApiError(error, "Failed to submit payment");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * POST the file to files.upload (multipart) and return the stored URL.
 * Mirrors api.js: same-origin credentials, defensive JSON parse, ApiError out.
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
      body: form, // no Content-Type header — the browser sets the multipart boundary
    });
  } catch (networkError) {
    throw new ApiError("Unable to reach the server. Check your connection.", 0, null);
  }

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch (parseError) {
    throw new ApiError("Unexpected server response", response.status, null);
  }

  if (!response.ok) {
    const message = (body && (body.message || body.error)) || "Upload failed.";
    throw new ApiError(message, response.status, body);
  }
  // files.upload responds with the standard {ok, data:{url,...}} envelope, so
  // the url is at body.data.url (a flat body.url fallback kept for safety).
  const url = (body && body.data && body.data.url) || (body && body.url);
  if (!url) {
    throw new ApiError("Upload did not return a file URL.", response.status, body);
  }
  return url;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function clearDisplay() {
  const loansList = document.getElementById("loansList");
  const pending = document.getElementById("pendingPaymentsList");
  const history = document.getElementById("paymentHistoryList");

  if (loansList) {
    loansList.textContent = "";
    loansList.appendChild(emptyTableRow("Select a group to view loans"));
  }
  if (pending) {
    pending.textContent = "";
    pending.appendChild(emptyState("⏳", "Select a group to view payments"));
  }
  if (history) {
    history.textContent = "";
    history.appendChild(emptyState("📋", "Select a group to view history"));
  }

  allLoans = [];
  activeLoans = [];
  pendingPayments = [];
  paymentHistory = [];
  updateStats();
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

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function setValue(id, value) {
  const node = document.getElementById(id);
  if (node) node.value = value == null ? "" : String(value);
}

/** Parse an API decimal string to a Number for DISPLAY ONLY. */
function numberOf(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function showModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.classList.add("active");
}

function hideModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("active");
  modal.classList.add("hidden");
}

function handleApiError(error, fallback) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      redirectToLogin();
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
  close.innerHTML = "&times;"; // static entity only, never user data
  close.addEventListener("click", () => toast.remove());
  toast.append(span, close);
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
