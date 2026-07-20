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

import {apiGet, apiPost, requireSession, listMyGroups, ApiError, redirectToLogin} from "./api.js";

let currentUser = null;
let currentGroupId = null;
let allLoans = [];
let activeLoans = [];
let pendingPayments = [];
let paymentHistory = [];
let currentLoanTab = "pending";

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
  // built in createLoanCard(). This listener is a guarded no-op kept only in case a
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
    loansList.appendChild(emptyState("💰", `No ${activeFilter === "all" ? "" : activeFilter} loans found`));
    return;
  }

  filtered.forEach((loan) => loansList.appendChild(createLoanCard(loan)));
}

function createLoanCard(loan) {
  const div = el("div", "list-item");

  const principal = numberOf(loan.principalAmount ?? loan.approvedAmount);
  const totalRepayment = numberOf(loan.totalRepayment);
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

  // Header: title + status badge
  const body = el("div");
  body.style.flex = "1";

  const header = el("div");
  header.style.cssText = "display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: var(--bn-space-2);";
  const title = el("div", "list-item-title");
  title.textContent = `Loan ${loan.loanNumber || `#${String(loan.loanId || "").substring(0, 8).toUpperCase()}`}`;
  const badge = el("span", `badge badge-${badgeClass}`);
  badge.textContent = label;
  header.append(title, badge);

  const subtitle = el("div", "list-item-subtitle");
  const purpose = loan.purpose ? `Purpose: ${loan.purpose}` : "Loan";
  const when = loan.approvedAt || loan.createdAt || loan.requestedAt;
  subtitle.textContent = when ? `${purpose} • ${new Date(when).toLocaleDateString()}` : purpose;

  body.append(header, subtitle);

  // Figures — all straight from the API.
  const grid = el("div");
  grid.style.cssText = "display:grid; grid-template-columns:repeat(2,1fr); gap: var(--bn-space-3); margin-top: var(--bn-space-3);";
  grid.append(
    figure("Loan Amount", formatCurrency(principal)),
    figure("Amount Paid", formatCurrency(repaid)),
  );
  if (interest > 0) grid.appendChild(figure("Interest", formatCurrency(interest)));
  if (totalRepayment > 0) grid.appendChild(figure("Total Repayable", formatCurrency(totalRepayment)));
  if (PAYABLE_STATUSES.includes(loan.status)) {
    grid.appendChild(figure("Remaining Balance", formatCurrency(remaining)));
    if (loan.dueDate) {
      grid.appendChild(figure("Due Date", new Date(loan.dueDate).toLocaleDateString()));
    }
  }
  body.appendChild(grid);

  div.appendChild(body);

  // Pay button only when the loan is payable AND something is still owed.
  const canPay = PAYABLE_STATUSES.includes(loan.status) && remaining > 0;
  if (canPay) {
    const actions = el("div");
    const payBtn = el("button", "btn btn-primary btn-sm");
    payBtn.textContent = "Make Payment";
    payBtn.addEventListener("click", () => openPaymentModal(loan));
    actions.appendChild(payBtn);
    div.appendChild(actions);
  }

  return div;
}

function figure(label, value) {
  const wrap = el("div");
  const l = el("div");
  l.style.cssText = "font-size:0.75rem; color: var(--bn-gray); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px; font-weight:600;";
  l.textContent = label;
  const v = el("div");
  v.style.cssText = "font-size:1rem; font-weight:700; color: var(--bn-dark);";
  v.textContent = value;
  wrap.append(l, v);
  return wrap;
}

// ── Pending + history lists ─────────────────────────────────────────────────
function displayPendingPayments() {
  const list = document.getElementById("pendingPaymentsList");
  if (!list) return;
  list.textContent = "";

  if (pendingPayments.length === 0) {
    list.appendChild(emptyState("⏳", "No pending payments"));
    return;
  }
  pendingPayments.forEach((p) => list.appendChild(createPaymentRow(p, "pending")));
}

function displayPaymentHistory() {
  const list = document.getElementById("paymentHistoryList");
  if (!list) return;
  list.textContent = "";

  if (paymentHistory.length === 0) {
    list.appendChild(emptyState("📋", "No payment history"));
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
function openPaymentModal(loan) {
  if (!loan) return;

  const remaining = numberOf(loan.remainingBalance);

  setValue("paymentLoanId", loan.loanId);
  setValue("loanReference", loan.loanNumber || `LOAN-${String(loan.loanId || "").substring(0, 8).toUpperCase()}`);

  setText("outstandingBalance", formatCurrency(remaining));
  setText("totalPaidAmount", formatCurrency(numberOf(loan.amountRepaid)));
  setText("totalLoanAmount", formatCurrency(numberOf(loan.totalRepayment)));

  const amountInput = document.getElementById("paymentAmount");
  if (amountInput) {
    amountInput.value = "";
    amountInput.max = remaining;
    amountInput.placeholder = `Max: ${formatCurrency(remaining)}`;
  }
  const hint = document.getElementById("paymentAmountHint");
  if (hint) {
    // The server computes the penalty/interest/principal split on submission —
    // do not preview a breakdown here, it would be a client-side guess.
    hint.textContent = `Maximum: ${formatCurrency(remaining)}. Your payment is applied to penalty, then interest, then principal.`;
  }

  const dateInput = document.getElementById("paymentDate");
  if (dateInput) dateInput.value = new Date().toISOString().split("T")[0];

  showModal("paymentModal");
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
  // The real markup (pages/loan_payments.html) has no payment-method selector at
  // all — there is no #paymentMethod element to read, so this is not a lost user
  // choice, it is a missing control. "cash" is one of the server's accepted values
  // (repayments.php REPAYMENT_METHODS: cash, bank_transfer, mobile_money), so this
  // sends a valid value rather than an invalid guess. A method selector needs to be
  // added to the modal markup (out of scope here) before this can reflect the
  // member's actual choice.
  const method = "cash";

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
    response = await fetch("/api/index.php?action=files.upload", {
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
  if (!body || !body.url) {
    throw new ApiError("Upload did not return a file URL.", response.status, body);
  }
  return body.url;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function clearDisplay() {
  const loansList = document.getElementById("loansList");
  const pending = document.getElementById("pendingPaymentsList");
  const history = document.getElementById("paymentHistoryList");

  if (loansList) {
    loansList.textContent = "";
    loansList.appendChild(emptyState("💰", "Select a group to view loans"));
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

function formatCurrency(amount) {
  return `MWK ${numberOf(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
