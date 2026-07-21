/**
 * manage_payments_sql.js — SQL port of manage_payments.js (the LIVE admin
 * contribution-payments page, Firebase, ~4700 lines). Ported to the PHP +
 * MySQL API. Zero Firebase imports. Not wired into any page until the
 * cutover — see BUILD_PLAN.md.
 *
 * HARD RULE: no client-side money math. The server (api/handlers/payments.php)
 * owns every obligation total, penalty accrual and settled-amount figure. This
 * file displays numbers the API already returns (payment.totalAmount,
 * payment.amountPaid, payment.arrears, payment.penalty.amountAccrued) and, for
 * the admin dashboard tiles, SUMS those already-server-computed numbers — it
 * never derives a new financial figure (no interest, no penalty, no "amount
 * due" calculation happens here).
 *
 * ENDPOINT CONTRACT (verified by reading api/handlers/payments.php directly):
 *   payments.list        -> GET, {groupId[, year]}. An admin/senior_admin/
 *                            treasurer sees the WHOLE group's rows, each with a
 *                            live-computed `penalty` object. A plain member
 *                            would only see their own (irrelevant here — this
 *                            is the admin page).
 *   payments.record       -> POST. Files a PENDING claim. Accepts `targetUid`
 *                            so an admin/treasurer can record cash a member
 *                            handed over in person — THIS is how "record a
 *                            payment on a member's behalf" actually works;
 *                            there is no separate admin-only endpoint.
 *   payments.approve      -> POST, {paymentId}. No notes/proof params exist on
 *                            this endpoint — see the deferred list below for
 *                            what the original approve modal offered that this
 *                            endpoint cannot accept.
 *   payments.reject       -> POST, {paymentId, rejectionReason}.
 *   rules.get / rules.update -> group_rules row. update_rules() whitelists a
 *                            SPECIFIC subset of contribution columns (see the
 *                            settings-modal section below for exactly which).
 *   reminders.send        -> POST, {groupId, recipient:'all'|'specific', uid?,
 *                            subject, message} — identical contract to the one
 *                            already wired in manage_loans_sql.js.
 *   files.upload          -> multipart proof upload, copied verbatim from
 *                            loan_payments_sql.js's uploadProof().
 *
 * GAP CLOSED (cycle 23): payments.obligations now accepts an optional `uid`, so
 * an admin CAN ask "what does member X currently owe, with their live penalty".
 * The server enforces the privilege (only admin/treasurer may request another
 * member; a plain member passing someone else's uid gets a 403) and that the uid
 * is a real member of the group (404 otherwise). The record-payment modal uses
 * it to show the member's real outstanding figure and pre-fill the amount — the
 * figure is computed SERVER-side, penalties included; the client never derives it.
 *
 * DELIBERATELY DROPPED (client-side money math in the original, forbidden
 * here, and not backed by any endpoint): calculateInterest(),
 * updateInterestDisplay(), updatePaymentAmountFromBase(), the
 * applyInterestCheckbox / interestDetails UI, and the entire "Apply Penalty"
 * bulk-calculation flow (openApplyPenaltyModal's overdueContributionsList +
 * totalPenalties + penaltyRate arithmetic). Penalties are computed live, on
 * read, by the server for every row already — there is nothing to "apply".
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
let allPayments = [];
let groupRules = null;
let currentTab = "pending";

// Activates the given payment tab (by data-tab value): updates the active
// button state, sets currentTab, and re-renders. Shared by the .payment-tab
// click listeners and the clickable stat tiles.
function activateTab(tabName) {
  const tabs = document.querySelectorAll(".payment-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  const target = Array.from(tabs).find((t) => t.dataset.tab === tabName);
  if (target) target.classList.add("active");
  currentTab = tabName || "pending";
  renderCurrentTab();
}

const PAYMENT_ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];
const SETTLED_STATUSES = ["approved", "completed"];

// ── DOM elements (IDs kept identical to the Firebase original) ─────────────
const groupSelector = () => document.getElementById("groupSelector");
const pendingPaymentsList = () => document.getElementById("pendingPaymentsList");
const spinner = () => document.getElementById("spinner");

// ── Init ─────────────────────────────────────────────────────────────────────
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
  document.addEventListener("DOMContentLoaded", () => { init(); });
}

function setupEventListeners() {
  groupSelector()?.addEventListener("change", async (e) => {
    selectedGroupId = e.target.value;
    if (selectedGroupId) {
      sessionStorage.setItem("selectedGroupId", selectedGroupId);
      await loadGroupData();
    }
  });

  // NOTE: manage_payments.html has no "#refreshBtn" (or any refresh control)
  // — confirmed absent, not fabricated. This listener is a documented no-op
  // via optional chaining until a real refresh control is added to the page.
  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    if (selectedGroupId) await loadGroupData();
  });

  document.getElementById("recordPaymentBtn")?.addEventListener("click", () => openRecordPaymentModal());
  document.getElementById("addPaymentInTabBtn")?.addEventListener("click", () => openRecordPaymentModal());
  document.getElementById("paymentSettingsBtn")?.addEventListener("click", openPaymentSettingsModal);
  document.getElementById("sendRemindersBtn")?.addEventListener("click", openSendRemindersModal);
  document.getElementById("viewAllPaymentDetailsBtn")?.addEventListener("click", openAllPaymentDetailsModal);

  // Apply Penalty: penalties are computed live by the server on every read —
  // there is no "apply" endpoint and nothing to persist. See file header.
  document.getElementById("applyPenaltyBtn")?.addEventListener("click", () => {
    showToast("Penalties are calculated automatically whenever a balance is shown — there is nothing to apply manually.", "info");
  });

  setupModalCloseHandlers("recordPaymentModal", "closeRecordPaymentModal", "cancelRecordPayment");
  setupModalCloseHandlers("paymentSettingsModal", "closePaymentSettingsModal", "cancelPaymentSettings");
  setupModalCloseHandlers("sendRemindersModal", "closeSendRemindersModal", "cancelSendReminders");
  setupModalCloseHandlers("allPaymentDetailsModal", "closeAllPaymentDetailsModal", "closeAllPaymentDetailsModal");

  document.getElementById("recordPaymentForm")?.addEventListener("submit", handleRecordPayment);
  document.getElementById("paymentSettingsForm")?.addEventListener("submit", handleSaveSettings);
  document.getElementById("sendRemindersForm")?.addEventListener("submit", handleSendReminders);

  document.querySelectorAll(".payment-tab").forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab || "pending"));
  });

  // Stat tiles: click switches to the related tab. "approved" and "collected"
  // have no dedicated tab predicate, so both map to "recent" (sorted activity,
  // no filter) as the closest match.
  document.getElementById("pendingStat")?.addEventListener("click", () => activateTab("pending"));
  document.getElementById("arrearsStat")?.addEventListener("click", () => activateTab("arrears"));
  document.getElementById("approvedStat")?.addEventListener("click", () => activateTab("recent"));
  document.getElementById("collectedStat")?.addEventListener("click", () => activateTab("recent"));

  document.getElementById("filterByMember")?.addEventListener("change", renderCurrentTab);
  document.getElementById("filterByPaymentType")?.addEventListener("change", renderCurrentTab);
  document.getElementById("filterByMonth")?.addEventListener("change", renderCurrentTab);
  document.getElementById("clearFiltersBtn")?.addEventListener("click", () => {
    const memberFilter = document.getElementById("filterByMember");
    const typeFilter = document.getElementById("filterByPaymentType");
    const monthFilter = document.getElementById("filterByMonth");
    if (memberFilter) memberFilter.value = "all";
    if (typeFilter) typeFilter.value = "all";
    if (monthFilter) monthFilter.value = "all";
    renderCurrentTab();
  });

  // Record-payment form: show/hide the month select for monthly contributions
  // and the "advanced payment" checkbox (monthly only, matches
  // record_payment's isAdvancedPayment contract).
  document.getElementById("paymentType")?.addEventListener("change", (e) => {
    const monthGroup = document.getElementById("monthSelectGroup");
    const isMonthly = e.target.value === "monthly_contribution";
    if (monthGroup) monthGroup.style.display = isMonthly ? "block" : "none";

    const advancedWrap = document.getElementById("isAdvancedPayment")?.parentElement?.parentElement;
    if (advancedWrap) advancedWrap.style.display = isMonthly ? "block" : "none";
    if (!isMonthly) {
      const checkbox = document.getElementById("isAdvancedPayment");
      if (checkbox) checkbox.checked = false;
    }

    updateAmountDueForSelection();
  });

  // The live arrears depend on WHO is paying and WHICH month, not just the type.
  document.getElementById("memberSelect")?.addEventListener("change", updateAmountDueForSelection);
  document.getElementById("paymentMonth")?.addEventListener("change", updateAmountDueForSelection);

  document.getElementById("recordPaymentPOP")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    const preview = document.getElementById("recordPaymentPOPPreview");
    const nameEl = document.getElementById("recordPaymentPOPFileName");
    if (file) {
      if (nameEl) nameEl.textContent = file.name;
      if (preview) preview.style.display = "block";
    } else {
      if (nameEl) nameEl.textContent = "";
      if (preview) preview.style.display = "none";
    }
  });

  document.getElementById("reminderRecipient")?.addEventListener("change", (e) => {
    const specificGroup = document.getElementById("specificMemberGroup");
    if (specificGroup) specificGroup.style.display = e.target.value === "specific" ? "block" : "none";
    updateReminderPreview();
  });
  document.getElementById("specificMemberSelect")?.addEventListener("change", updateReminderPreview);

  document.getElementById("reminderMessageTemplate")?.addEventListener("change", (e) => {
    const textarea = document.getElementById("reminderMessage");
    if (!textarea) return;
    const templates = {
      gentle: "Hello,\n\nThis is a friendly reminder about your outstanding payments. Please settle your arrears at your earliest convenience.\n\nThank you for your cooperation.",
      urgent: "IMPORTANT REMINDER\n\nYou have outstanding payments. Please make payment immediately to avoid additional penalties.\n\nContact the group administrator if you need assistance.",
      custom: "",
    };
    textarea.value = templates[e.target.value] || "";
  });

  document.getElementById("paymentDetailsMemberFilter")?.addEventListener("change", renderAllPaymentDetailsTable);
  document.getElementById("paymentDetailsClearFilterBtn")?.addEventListener("click", () => {
    const filter = document.getElementById("paymentDetailsMemberFilter");
    if (filter) filter.value = "all";
    renderAllPaymentDetailsTable();
  });
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
    adminGroups = groups.filter((g) => PAYMENT_ADMIN_ROLES.includes(g.myRole));

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
    await loadPayments();
    await loadGroupRules();
    updateStats();
    renderCurrentTab();
    renderPendingPreview();
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
    populateMemberDropdowns();
  } catch (error) {
    members = [];
    handleApiError(error, "Failed to load members");
  }
}

function populateMemberDropdowns() {
  const dropdownIds = ["memberSelect", "filterByMember", "specificMemberSelect", "paymentDetailsMemberFilter"];
  dropdownIds.forEach((id) => {
    const dropdown = document.getElementById(id);
    if (!dropdown) return;
    dropdown.textContent = "";

    if (id === "filterByMember" || id === "paymentDetailsMemberFilter") {
      const allOption = document.createElement("option");
      allOption.value = "all";
      allOption.textContent = "All Members";
      dropdown.appendChild(allOption);
    } else {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose a member...";
      dropdown.appendChild(placeholder);
    }

    members.forEach((m) => {
      const option = document.createElement("option");
      option.value = m.uid;
      option.textContent = m.fullName || "Unknown";
      dropdown.appendChild(option);
    });
  });
}

async function loadPayments() {
  try {
    const data = await apiGet("payments.list", {groupId: selectedGroupId});
    allPayments = Array.isArray(data && data.payments) ? data.payments : [];
  } catch (error) {
    allPayments = [];
    handleApiError(error, "Failed to load payments");
  }
}

async function loadGroupRules() {
  try {
    const data = await apiGet("rules.get", {groupId: selectedGroupId});
    groupRules = (data && (data.rules || data.groupRules)) || data || {};
  } catch (error) {
    groupRules = null;
    handleApiError(error, "Failed to load group rules");
  }
}

// ── Stats (sums of server-provided figures only — no new arithmetic) ───────
function updateStats() {
  const pending = allPayments.filter((p) => p.approvalStatus === "pending").length;
  const approved = allPayments.filter((p) => SETTLED_STATUSES.includes(p.approvalStatus)).length;

  let totalCollected = 0;
  let totalArrears = 0;
  allPayments.forEach((p) => {
    if (SETTLED_STATUSES.includes(p.approvalStatus)) {
      totalCollected += numberOf(p.amountPaid);
    }
    totalArrears += numberOf(p.arrears);
  });

  setText("pendingCount", pending);
  setText("approvedCount", approved);
  setText("totalCollected", formatCurrency(totalCollected));
  setText("totalArrears", formatCurrency(totalArrears));
}

// ── Tab rendering ────────────────────────────────────────────────────────────
function memberName(uid) {
  return members.find((m) => m.uid === uid)?.fullName || "Unknown";
}

function filteredPayments() {
  let filtered;
  switch (currentTab) {
    case "pending":
      filtered = allPayments.filter((p) => p.approvalStatus === "pending");
      break;
    case "seed":
      filtered = allPayments.filter((p) => p.paymentType === "seed_money");
      break;
    case "monthly":
      filtered = allPayments.filter((p) => p.paymentType === "monthly_contribution");
      break;
    case "servicefee":
      filtered = allPayments.filter((p) => p.paymentType === "service_fee");
      break;
    case "arrears":
      filtered = allPayments.filter((p) => numberOf(p.arrears) > 0);
      break;
    case "recent":
      filtered = [...allPayments].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      break;
    default:
      filtered = allPayments;
  }

  const memberFilter = document.getElementById("filterByMember")?.value;
  if (memberFilter && memberFilter !== "all") {
    filtered = filtered.filter((p) => p.uid === memberFilter);
  }
  const typeFilter = document.getElementById("filterByPaymentType")?.value;
  if (typeFilter && typeFilter !== "all") {
    filtered = filtered.filter((p) => p.paymentType === typeFilter);
  }
  const monthFilter = document.getElementById("filterByMonth")?.value;
  if (monthFilter && monthFilter !== "all") {
    filtered = filtered.filter((p) => p.month === monthFilter);
  }

  return filtered;
}

function renderCurrentTab() {
  const container = pendingPaymentsList();
  if (!container) return;

  const filtered = filteredPayments();
  container.textContent = "";

  if (filtered.length === 0) {
    container.appendChild(emptyState("💰", `No ${currentTab} payments found`));
    return;
  }

  filtered.forEach((payment) => container.appendChild(createPaymentCard(payment)));
}

function renderPendingPreview() {
  const list = document.getElementById("pendingPaymentsList");
  if (!list || currentTab !== "pending") return;
  renderCurrentTab();
}

// NOTE (dead-code removal): a renderRecentPreview() used to target a
// "#recentPaymentsList" element that never existed in manage_payments.html
// (only "#pendingPaymentsList" does) — it always
// bailed at `if (!list) return` and was unreachable in practice. The
// "Recent" tab is fully served by the .payment-tab click handler ->
// filteredPayments() (case "recent") -> renderCurrentTab(), which renders
// into the real "#pendingPaymentsList" container. Removed as unreachable
// dead code; nothing else called renderRecentPreview().

const PAYMENT_TYPE_LABELS = {
  seed_money: "Seed Money",
  monthly_contribution: "Monthly Contribution",
  service_fee: "Service Fee",
};

function createPaymentCard(payment, showActions = true) {
  const card = el("div", "loan-card");

  const header = el("div", "loan-card-header");
  const info = el("div");
  const name = el("div", "loan-borrower-name");
  const typeLabel = PAYMENT_TYPE_LABELS[payment.paymentType] || payment.paymentType || "Payment";
  const monthSuffix = payment.month ? ` — ${payment.month}` : "";
  name.textContent = `${memberName(payment.uid)} · ${typeLabel}${monthSuffix}`;
  const meta = el("div", "loan-borrower-date");
  meta.textContent = `${formatCurrency(payment.amountPaid)} of ${formatCurrency(payment.totalAmount)} · ${formatDate(payment.paidAt || payment.createdAt)}`;
  info.append(name, meta);
  header.appendChild(info);

  const statusClass = payment.approvalStatus === "completed" || payment.approvalStatus === "approved"
    ? "success"
    : payment.approvalStatus === "rejected"
      ? "danger"
      : "warning";
  const statusBadge = el("span", `badge badge-${statusClass}`);
  statusBadge.textContent = payment.approvalStatus;
  header.appendChild(statusBadge);
  card.appendChild(header);

  const body = el("div", "loan-card-body");
  const grid = el("div", "loan-details-grid");
  grid.append(
    loanDetail(formatCurrency(payment.totalAmount), "Total Due"),
    loanDetail(formatCurrency(payment.amountPaid), "Paid"),
    loanDetail(formatCurrency(payment.arrears), "Arrears", "var(--bn-danger)"),
  );
  body.appendChild(grid);

  const penalty = payment.penalty;
  if (penalty && numberOf(penalty.amountAccrued) > 0) {
    const penaltyNote = el("div");
    penaltyNote.style.cssText = "font-size: var(--bn-text-sm); color: var(--bn-danger); margin-top: var(--bn-space-2);";
    penaltyNote.textContent = `Live penalty: ${formatCurrency(penalty.amountAccrued)} (${penalty.daysCharged} day(s) at ${formatCurrency(penalty.dailyAmount)}/day)`;
    body.appendChild(penaltyNote);
  }

  if (payment.notes) {
    const notes = el("div");
    notes.style.cssText = "font-size: var(--bn-text-sm); color: var(--bn-gray); margin-top: var(--bn-space-2);";
    notes.textContent = `Notes: ${payment.notes}`;
    body.appendChild(notes);
  }

  if (payment.approvalStatus === "rejected" && payment.rejectionReason) {
    const reason = el("div");
    reason.style.cssText = "font-size: var(--bn-text-sm); color: var(--bn-danger); margin-top: var(--bn-space-2);";
    reason.textContent = `Rejected: ${payment.rejectionReason}`;
    body.appendChild(reason);
  }

  if (payment.proofOfPaymentImageUrl) {
    const link = document.createElement("a");
    link.href = payment.proofOfPaymentImageUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View proof";
    link.style.cssText = "display: inline-block; margin-top: var(--bn-space-2); font-size: var(--bn-text-sm);";
    body.appendChild(link);
  }

  if (showActions && payment.approvalStatus === "pending") {
    const actions = el("div", "loan-actions");
    const approveBtn = el("button", "btn btn-accent");
    approveBtn.textContent = "Approve";
    approveBtn.addEventListener("click", () => approvePayment(payment.paymentId));
    const rejectBtn = el("button", "btn btn-danger");
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => rejectPayment(payment));
    actions.append(approveBtn, rejectBtn);
    body.appendChild(actions);
  }

  card.appendChild(body);
  return card;
}

function loanDetail(value, label, color) {
  const wrap = el("div", "loan-detail");
  const valueEl = el("div", "loan-detail-value");
  valueEl.textContent = value;
  if (color) valueEl.style.color = color;
  const labelEl = el("div", "loan-detail-label");
  labelEl.textContent = label;
  wrap.append(valueEl, labelEl);
  return wrap;
}

// ── Approve / reject ─────────────────────────────────────────────────────────
async function approvePayment(paymentId) {
  showSpinner(true);
  try {
    await apiPost("payments.approve", {paymentId});
    showToast("Payment approved", "success");
    await loadGroupData();
  } catch (error) {
    handleApiError(error, "Failed to approve payment");
  } finally {
    showSpinner(false);
  }
}

function rejectPayment(payment) {
  promptForReason({
    title: "Reject Payment",
    label: "Reason for rejection",
    confirmLabel: "Reject Payment",
    onConfirm: async (reason) => {
      showSpinner(true);
      try {
        await apiPost("payments.reject", {paymentId: payment.paymentId, rejectionReason: reason});
        showToast("Payment rejected", "success");
        await loadGroupData();
      } catch (error) {
        handleApiError(error, "Failed to reject payment");
      } finally {
        showSpinner(false);
      }
    },
  });
}

// ── Record payment ───────────────────────────────────────────────────────────
function openRecordPaymentModal(preSelectMemberId = null) {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }

  document.getElementById("recordPaymentForm")?.reset();

  const memberSelect = document.getElementById("memberSelect");
  if (memberSelect && preSelectMemberId) memberSelect.value = preSelectMemberId;

  const monthGroup = document.getElementById("monthSelectGroup");
  if (monthGroup) monthGroup.style.display = "none";

  const paymentDate = document.getElementById("paymentDate");
  if (paymentDate) paymentDate.value = new Date().toISOString().split("T")[0];

  updateAmountDueForSelection();

  showModal("recordPaymentModal");
}

/**
 * Show the SELECTED MEMBER's live arrears for the chosen payment type, and
 * pre-fill the amount with it.
 *
 * payments.obligations now accepts an admin-supplied `uid` (the server enforces
 * that only an admin/treasurer may ask for someone else, and that the uid is a
 * real member of the group), so this is the member's REAL outstanding figure —
 * computed server-side, penalties included. The client never derives it.
 */
async function updateAmountDueForSelection() {
  // NOTE: manage_payments.html has no "#paymentAmountHint" element (confirmed
  // absent, not fabricated). The record-payment modal only exposes a static
  // instructional <small> next to the "#autoFillAmountBtn" button — that
  // button isn't wired to anything in this file either. Wiring a real hint
  // display / auto-fill click handler is out of scope for this fix; this
  // stays a documented no-op via the early return below.
  const hint = document.getElementById("paymentAmountHint");
  const amountInput = document.getElementById("paymentAmount");
  const targetUid = document.getElementById("memberSelect")?.value;
  const paymentType = document.getElementById("paymentType")?.value;

  if (!hint) return;
  if (!selectedGroupId || !targetUid || !paymentType) {
    hint.textContent = "";
    return;
  }

  hint.textContent = "Checking what this member owes…";

  try {
    const obligations = await apiGet("payments.obligations", {
      groupId: selectedGroupId,
      uid: targetUid,
    });

    const arrears = arrearsFor(obligations, paymentType);
    if (arrears === null) {
      hint.textContent = "";
      return;
    }

    if (arrears > 0) {
      hint.textContent = `Outstanding for this member: ${formatCurrency(arrears)} (penalties included).`;
      // Pre-fill with the server's figure; the admin can still edit it (a member
      // may be paying only part of what they owe).
      if (amountInput && !amountInput.value) amountInput.value = arrears;
    } else {
      hint.textContent = "This member has nothing outstanding for that item.";
    }
  } catch (error) {
    // Never block recording a payment because the hint failed to load.
    hint.textContent = "Could not load this member's outstanding balance.";
  }
}

/**
 * Pull the arrears figure for one payment type out of the obligations response.
 * Reads only server-computed values — no client-side arithmetic.
 */
function arrearsFor(obligations, paymentType) {
  if (!obligations || typeof obligations !== "object") return null;

  // Server shape (payments.php my_obligations):
  //   { seedMoney: {...arrears}, monthlyContributions: { months: [ {month, arrears} ] },
  //     serviceFee: {...arrears} }
  if (paymentType === "seed_money") {
    return numberOf(obligations.seedMoney?.arrears);
  }
  if (paymentType === "service_fee") {
    return numberOf(obligations.serviceFee?.arrears);
  }
  if (paymentType === "monthly_contribution") {
    const months = obligations.monthlyContributions?.months;
    if (!Array.isArray(months)) return null;

    // The month the admin picked, else the total owed across every month.
    const month = document.getElementById("paymentMonth")?.value;
    if (month) {
      const row = months.find((m) => String(m.month) === String(month));
      return row ? numberOf(row.arrears) : 0;
    }
    // Scope note: this totals monthly_contribution arrears ONLY (this branch
    // never sees seed money or service fee types). The new obligations
    // `summary.arrears` field spans seed + months + service fee combined, so
    // it does not match this narrower per-payment-type figure — left as a
    // client-side sum intentionally.
    return months.reduce((sum, m) => sum + numberOf(m.arrears), 0);
  }
  return null;
}

function clearPOPUpload() {
  const input = document.getElementById("recordPaymentPOP");
  const preview = document.getElementById("recordPaymentPOPPreview");
  const nameEl = document.getElementById("recordPaymentPOPFileName");
  if (input) input.value = "";
  if (preview) preview.style.display = "none";
  if (nameEl) nameEl.textContent = "";
}
window.clearPOPUpload = clearPOPUpload;

async function handleRecordPayment(e) {
  e.preventDefault();
  if (!selectedGroupId) return;

  const targetUid = document.getElementById("memberSelect")?.value;
  const paymentType = document.getElementById("paymentType")?.value;
  const month = document.getElementById("paymentMonth")?.value;
  const amountRaw = document.getElementById("paymentAmount")?.value;
  const method = document.getElementById("paymentMethod")?.value;
  const notes = document.getElementById("paymentNotes")?.value?.trim();
  const isAdvanced = document.getElementById("isAdvancedPayment")?.checked;
  const proofFile = document.getElementById("recordPaymentPOP")?.files?.[0];

  if (!targetUid || !paymentType) {
    showToast("Please choose a member and a payment type", "error");
    return;
  }
  const amount = parseFloat(amountRaw || "");
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Enter a valid payment amount", "error");
    return;
  }
  if (paymentType === "monthly_contribution" && !month) {
    showToast("Please choose a month for a monthly contribution", "error");
    return;
  }

  showSpinner(true);
  try {
    let proofUrl;
    if (proofFile) {
      proofUrl = await uploadProof(proofFile, selectedGroupId);
    }

    await apiPost("payments.record", {
      groupId: selectedGroupId,
      targetUid,
      paymentType,
      month: paymentType === "monthly_contribution" ? month : undefined,
      amount,
      paymentMethod: method,
      notes: notes || undefined,
      proofOfPaymentImageUrl: proofUrl,
      isAdvancedPayment: paymentType === "monthly_contribution" ? !!isAdvanced : undefined,
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

/**
 * POST the file to files.upload (multipart) and return the stored URL.
 * Copied from loan_payments_sql.js's uploadProof() — same contract.
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
      body: form,
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

// ── Payment settings ─────────────────────────────────────────────────────────
// update_rules() whitelists a SPECIFIC subset of contribution columns. Fields
// the original modal exposed but the server cannot update
// (seedMoneyDueDate, "cycle length") are shown read-only with a note, not
// silently dropped.
const SETTINGS_FIELD_MAP = [
  ["settingsSeedMoney", "seedMoneyAmount"],
  ["settingsMonthlyContribution", "monthlyContributionAmount"],
  ["settingsMonthlyDueDay", "monthlyContributionDayOfMonth"],
  ["settingsMonthlyPenalty", "contributionPenaltyDailyAmount"],
  ["settingsMonthlyGracePeriod", "contributionPenaltyGracePeriodDays"],
];

async function openPaymentSettingsModal() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }
  showSpinner(true);
  try {
    const data = await apiGet("rules.get", {groupId: selectedGroupId});
    groupRules = (data && (data.rules || data.groupRules)) || data || {};
  } catch (error) {
    handleApiError(error, "Failed to load payment settings");
    showSpinner(false);
    return;
  }
  showSpinner(false);

  SETTINGS_FIELD_MAP.forEach(([inputId, ruleField]) => {
    const node = document.getElementById(inputId);
    if (node && groupRules[ruleField] !== undefined && groupRules[ruleField] !== null) {
      node.value = groupRules[ruleField];
    }
  });

  // Read-only fields the API cannot update yet — show, don't edit.
  const seedDueDate = document.getElementById("settingsSeedMoneyDueDate");
  if (seedDueDate) {
    seedDueDate.value = groupRules.seedMoneyDueDate ? String(groupRules.seedMoneyDueDate).slice(0, 10) : "";
    seedDueDate.disabled = true;
    seedDueDate.title = "Not yet editable from this API — contact a developer to change the seed money due date.";
  }
  const cycleLength = document.getElementById("settingsCycleLength");
  if (cycleLength) {
    cycleLength.disabled = true;
    cycleLength.title = "Cycle length has no group_rules column — not editable from this page.";
  }

  showModal("paymentSettingsModal");
}

async function handleSaveSettings(e) {
  e.preventDefault();
  if (!selectedGroupId) return;

  const payload = {groupId: selectedGroupId};
  let changed = false;

  SETTINGS_FIELD_MAP.forEach(([inputId, ruleField]) => {
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
    showToast("Payment settings saved", "success");
    hideModal("paymentSettingsModal");
    await loadGroupRules();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      showToast("Only a senior admin can change group rules.", "error");
    } else {
      handleApiError(error, "Failed to save payment settings");
    }
  } finally {
    showSpinner(false);
  }
}

// ── Send reminders ───────────────────────────────────────────────────────────
function openSendRemindersModal() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }
  document.getElementById("sendRemindersForm")?.reset();
  const specificGroup = document.getElementById("specificMemberGroup");
  if (specificGroup) specificGroup.style.display = "none";
  updateReminderPreview();
  showModal("sendRemindersModal");
}

function updateReminderPreview() {
  const preview = document.getElementById("reminderPreview");
  const countEl = document.getElementById("reminderPreviewCount");
  const membersEl = document.getElementById("reminderPreviewMembers");
  if (!preview) return;

  const recipient = document.getElementById("reminderRecipient")?.value;
  if (recipient === "specific") {
    const uid = document.getElementById("specificMemberSelect")?.value;
    const name = uid ? memberName(uid) : "";
    if (countEl) countEl.textContent = uid ? "1" : "0";
    if (membersEl) membersEl.textContent = name;
  } else {
    if (countEl) countEl.textContent = String(members.length);
    if (membersEl) membersEl.textContent = members.map((m) => m.fullName || "Unknown").join(", ");
  }
}

async function handleSendReminders(e) {
  e.preventDefault();
  if (!selectedGroupId) return;

  const recipient = document.getElementById("reminderRecipient")?.value === "specific" ? "specific" : "all";
  const uid = recipient === "specific" ? document.getElementById("specificMemberSelect")?.value : undefined;
  const message = document.getElementById("reminderMessage")?.value?.trim();
  const paymentTypeContext = document.getElementById("reminderPaymentType")?.value;

  if (recipient === "specific" && !uid) {
    showToast("Please choose a member", "error");
    return;
  }
  if (!message) {
    showToast("Please enter a message", "error");
    return;
  }

  const subject = paymentTypeContext && paymentTypeContext !== "all"
    ? `Payment Reminder — ${PAYMENT_TYPE_LABELS[paymentTypeContext] || paymentTypeContext}`
    : "Payment Reminder";

  showSpinner(true);
  try {
    const data = await apiPost("reminders.send", {
      groupId: selectedGroupId,
      recipient,
      uid,
      subject,
      message,
    });
    hideModal("sendRemindersModal");
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
      handleApiError(error, "Failed to send reminders");
    }
  } finally {
    showSpinner(false);
  }
}

// ── All Payment Details (built from already-loaded payments.list rows) ─────
function openAllPaymentDetailsModal() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }
  renderAllPaymentDetailsTable();
  showModal("allPaymentDetailsModal");
}

function renderAllPaymentDetailsTable() {
  const container = document.getElementById("allPaymentDetailsTableContainer");
  if (!container) return;
  container.textContent = "";

  const memberFilter = document.getElementById("paymentDetailsMemberFilter")?.value;
  const rows = memberFilter && memberFilter !== "all"
    ? allPayments.filter((p) => p.uid === memberFilter)
    : allPayments;

  if (rows.length === 0) {
    container.appendChild(emptyState("📋", "No payments found"));
    return;
  }

  const table = document.createElement("table");
  table.className = "data-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Member", "Type", "Month", "Total Due", "Paid", "Arrears", "Status", "Date"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((p) => {
    const tr = document.createElement("tr");
    const cells = [
      memberName(p.uid),
      PAYMENT_TYPE_LABELS[p.paymentType] || p.paymentType || "",
      p.month || "—",
      formatCurrency(p.totalAmount),
      formatCurrency(p.amountPaid),
      formatCurrency(p.arrears),
      p.approvalStatus || "",
      formatDate(p.createdAt),
    ];
    cells.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

// ── Generic reason-prompt modal (replaces prompt()) ─────────────────────────
/**
 * Copied from manage_loans_sql.js's promptForReason — built entirely with
 * createElement/textContent, no innerHTML with any variable content.
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
  closeBtn.innerHTML = "&times;"; // static entity only, no user data
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
