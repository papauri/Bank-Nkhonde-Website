/**
 * interest_penalties_sql.js — SQL port of interest_penalties.js (admin
 * read-only overview: interest earned and penalties charged across the
 * group's loans/contributions, plus a rate-editing modal). Not wired into
 * any page until the cutover — see BUILD_PLAN.md.
 *
 * HARD RULE: no client-side money math. Every interest/penalty figure comes
 * straight from the API (loans.list's totalInterest/penaltiesCharged,
 * payments.obligations' live-computed penalty.amountAccrued). This file only
 * SUMS already-server-computed numbers for the summary tile — it never
 * derives a new interest or penalty figure.
 *
 * ENDPOINT CONTRACT (verified by reading api/handlers/rules.php,
 * api/handlers/payments.php, api/handlers/loans.php directly):
 *   groups.mine        -> via listMyGroups(); filtered to
 *                        admin/senior_admin/treasurer (this is an admin page).
 *   rules.get           -> GET, {groupId} -> the group_rules row directly:
 *                        loanInterestRateMonth1/2/3, loanPenaltyDailyAmount,
 *                        loanPenaltyGracePeriodDays,
 *                        contributionPenaltyDailyAmount,
 *                        contributionPenaltyGracePeriodDays. There is no
 *                        percentage-rate column for penalties any more (the
 *                        model moved to a flat daily amount) — the
 *                        "Late Penalty" tile below shows the loan penalty's
 *                        daily amount, not a rate, and the edit modal follows
 *                        the same shape.
 *   rules.update         -> POST, SENIOR ADMIN ONLY. Whitelists a SPECIFIC
 *                        subset of columns (see rules.php update_rules) —
 *                        only the interest/penalty fields below are sent.
 *                        seedMoneyAmount / monthlyContributionAmount are
 *                        also whitelisted but belong to the payment-settings
 *                        modal on manage_payments_sql.js, not here — this
 *                        page's "Edit Rates" scope is interest & penalties.
 *   members.list        -> GET, {groupId} -> {members:[...]}.
 *   payments.obligations -> GET, {groupId, uid} -> per-member obligations
 *                        with a live-computed `penalty` object on seedMoney
 *                        and each month of monthlyContributions. Called once
 *                        per member with Promise.all (N+1 acceptable here,
 *                        never sequential awaits).
 *   loans.list           -> GET, {groupId} -> {loans:[...]}. Filtered here to
 *                        disbursed/completed loans with totalInterest > 0 for
 *                        the "Collected Interest" list.
 *
 * DEFERRED (toast + reported, never invented): CSV/PDF export of either list
 * (no export endpoint); a percentage-based penalty "rate" — the API only
 * exposes a flat daily amount now, so the original rate inputs for
 * loanPenalty.rate / monthlyPenalty.rate have no server field to write to.
 */

import {apiGet, apiPost, requireSession, listMyGroups, ApiError, redirectToLogin} from "./api.js";

const RATES_ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];

let currentUser = null;
let currentGroupId = null;
let currentUserRole = null;
let groupRules = null;
let members = [];

const groupSelector = () => document.getElementById("groupSelector");
const editRatesBtn = () => document.getElementById("editRatesBtn");
const pendingPenaltiesList = () => document.getElementById("pendingPenaltiesList");
const collectedInterestList = () => document.getElementById("collectedInterestList");
const spinner = () => document.getElementById("spinner");
const editModal = () => document.getElementById("editModal");
const modalForm = () => document.getElementById("modalForm");
const modalTitle = () => document.getElementById("modalTitle");

export async function init() {
  const backButton = document.querySelector(".page-back-btn");
  backButton?.addEventListener("click", () => {
    window.location.href = "admin_dashboard.html";
  });

  document.getElementById("closeModal")?.addEventListener("click", closeEditRatesModal);
  document.getElementById("cancelModalBtn")?.addEventListener("click", closeEditRatesModal);
  editModal()?.addEventListener("click", (e) => {
    if (e.target === editModal()) closeEditRatesModal();
  });

  editRatesBtn()?.addEventListener("click", () => {
    if (!currentGroupId) {
      showToast("Please select a group first", "error");
      return;
    }
    openEditRatesModal();
  });

  document.getElementById("saveModalBtn")?.addEventListener("click", saveRateChanges);

  groupSelector()?.addEventListener("change", async (e) => {
    currentGroupId = e.target.value;
    if (currentGroupId) {
      sessionStorage.setItem("selectedGroupId", currentGroupId);
      await loadGroupData();
    }
  });

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

async function loadAdminGroups() {
  showSpinner(true);
  try {
    const groups = await listMyGroups();
    const adminGroups = groups.filter((g) => RATES_ADMIN_ROLES.includes(g.myRole));

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

    const urlParams = new URLSearchParams(window.location.search);
    const stored = urlParams.get("groupId")
      || sessionStorage.getItem("selectedGroupId")
      || localStorage.getItem("selectedGroupId");
    const match = adminGroups.find((g) => (g.groupId || g.id) === stored);
    const chosen = match || adminGroups[0];
    currentGroupId = chosen.groupId || chosen.id;
    currentUserRole = chosen.myRole;
    if (selector) selector.value = currentGroupId;
    sessionStorage.setItem("selectedGroupId", currentGroupId);

    await loadGroupData();
  } catch (error) {
    handleApiError(error, "Failed to load groups");
  } finally {
    showSpinner(false);
  }
}

async function loadGroupData() {
  if (!currentGroupId) return;
  showSpinner(true);
  try {
    await loadRules();
    await loadMembers();
    await Promise.all([loadPendingPenalties(), loadCollectedInterest()]);
  } catch (error) {
    handleApiError(error, "Failed to load group data");
  } finally {
    showSpinner(false);
  }
}

async function loadRules() {
  try {
    groupRules = await apiGet("rules.get", {groupId: currentGroupId});
  } catch (error) {
    groupRules = null;
    handleApiError(error, "Failed to load group rules");
    return;
  }
  renderRateSummary();
}

function renderRateSummary() {
  const loanInterestEl = document.getElementById("loanInterestRate");
  if (loanInterestEl) {
    const m1 = numberOf(groupRules?.loanInterestRateMonth1);
    const m2 = numberOf(groupRules?.loanInterestRateMonth2);
    const m3 = numberOf(groupRules?.loanInterestRateMonth3);
    loanInterestEl.textContent = m1 > 0 || m2 > 0 || m3 > 0
      ? `${m1}% (M1), ${m2}% (M2), ${m3}% (M3+)`
      : "0%";
  }

  // The API models penalties as a flat daily amount, not a percentage rate —
  // this tile shows the loan penalty's daily amount accordingly.
  const latePenaltyEl = document.getElementById("latePenaltyRate");
  if (latePenaltyEl) {
    latePenaltyEl.textContent = `${formatCurrency(groupRules?.loanPenaltyDailyAmount)}/day`;
  }

  const gracePeriodEl = document.getElementById("gracePeriod");
  if (gracePeriodEl) {
    gracePeriodEl.textContent = `${numberOf(groupRules?.loanPenaltyGracePeriodDays)} days`;
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

/**
 * Every member's live obligations, in parallel (never a sequential loop of
 * single awaits). Penalty figures here are computed server-side, on read.
 */
async function loadPendingPenalties() {
  const container = pendingPenaltiesList();
  if (!container) return;

  if (members.length === 0) {
    container.textContent = "";
    container.appendChild(emptyState("⚖️", "No members in this group yet"));
    return;
  }

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

    const rows = [];
    members.forEach((member, index) => {
      const obligations = results[index];
      if (!obligations) return;

      const seedArrears = numberOf(obligations.seedMoney?.arrears);
      if (seedArrears > 0) {
        rows.push({
          memberName: member.fullName || "Unknown",
          type: "Seed Money",
          amount: seedArrears,
          penaltyAccrued: numberOf(obligations.seedMoney?.penalty?.amountAccrued),
          dueDate: obligations.seedMoney?.dueDate || null,
        });
      }

      const months = obligations.monthlyContributions?.months;
      if (Array.isArray(months)) {
        months.forEach((month) => {
          const arrears = numberOf(month.arrears);
          if (arrears > 0) {
            rows.push({
              memberName: member.fullName || "Unknown",
              type: `Monthly Contribution (${month.month})`,
              amount: arrears,
              penaltyAccrued: numberOf(month.penalty?.amountAccrued),
              dueDate: month.dueDate || null,
            });
          }
        });
      }

      const feeArrears = numberOf(obligations.serviceFee?.arrears);
      if (feeArrears > 0) {
        rows.push({
          memberName: member.fullName || "Unknown",
          type: "Service Fee",
          amount: feeArrears,
          penaltyAccrued: numberOf(obligations.serviceFee?.penalty?.amountAccrued),
          dueDate: obligations.serviceFee?.dueDate || null,
        });
      }
    });

    renderPendingPenalties(rows);
  } catch (error) {
    container.textContent = "";
    container.appendChild(emptyState("❌", "Error loading penalties"));
    handleApiError(error, "Failed to load penalties data");
  }
}

function renderPendingPenalties(rows) {
  const container = pendingPenaltiesList();
  if (!container) return;
  container.textContent = "";

  if (rows.length === 0) {
    container.appendChild(emptyState("⚖️", "No outstanding arrears"));
    return;
  }

  const list = el("div", "penalties-list");
  rows.forEach((row) => list.appendChild(penaltyItem(row)));
  container.appendChild(list);
}

function penaltyItem(row) {
  const item = el("div", "penalty-item");

  const info = el("div", "penalty-info");
  const member = el("div", "penalty-member");
  member.textContent = row.memberName;
  const type = el("div", "penalty-type");
  type.textContent = row.type;
  const amount = el("div", "penalty-amount");
  amount.textContent = formatCurrency(row.amount);
  const date = el("div", "penalty-date");
  date.textContent = `Due: ${formatDate(row.dueDate)}`;
  info.append(member, type, amount, date);

  if (row.penaltyAccrued > 0) {
    const penaltyLine = el("div", "penalty-date");
    penaltyLine.style.color = "var(--bn-danger)";
    penaltyLine.textContent = `Live penalty: ${formatCurrency(row.penaltyAccrued)}`;
    info.appendChild(penaltyLine);
  }

  item.appendChild(info);

  const statusWrap = el("div", "penalty-status");
  const badge = el("span", `badge badge-${row.penaltyAccrued > 0 ? "danger" : "warning"}`);
  badge.textContent = row.penaltyAccrued > 0 ? "Penalty accruing" : "Outstanding";
  statusWrap.appendChild(badge);
  item.appendChild(statusWrap);

  return item;
}

/** Interest already booked into loans.list rows for disbursed/completed loans. */
async function loadCollectedInterest() {
  const container = collectedInterestList();
  if (!container) return;

  try {
    const data = await apiGet("loans.list", {groupId: currentGroupId});
    const loans = Array.isArray(data && data.loans) ? data.loans : [];

    const interestLoans = loans.filter(
      (loan) => ["disbursed", "completed"].includes(loan.status) && numberOf(loan.totalInterest) > 0,
    );

    renderCollectedInterest(interestLoans);
  } catch (error) {
    container.textContent = "";
    container.appendChild(emptyState("❌", "Error loading interest data"));
    handleApiError(error, "Failed to load loan interest data");
  }
}

function renderCollectedInterest(loans) {
  const container = collectedInterestList();
  if (!container) return;
  container.textContent = "";

  if (loans.length === 0) {
    container.appendChild(emptyState("💰", "No interest collected yet"));
    return;
  }

  // Sum already-server-computed totalInterest figures — no new arithmetic.
  // NOT substituted with loans.list's `summary.totalInterest`: that field sums
  // totalInterest across ALL rows including 'approved' loans (which already have
  // a nonzero totalInterest set at approval time, before disbursement), while
  // this list is filtered to ['disbursed', 'completed'] only — 'approved' loans
  // are deliberately excluded here. The scopes do not match.
  const totalInterest = loans.reduce((sum, loan) => sum + numberOf(loan.totalInterest), 0);

  const summary = el("div", "interest-summary");
  const summaryCard = el("div", "summary-card");
  const label = el("div", "summary-label");
  label.textContent = "Total Interest Collected";
  const value = el("div", "summary-value");
  value.textContent = formatCurrency(totalInterest);
  summaryCard.append(label, value);
  summary.appendChild(summaryCard);
  container.appendChild(summary);

  const list = el("div", "interest-list");
  loans.forEach((loan) => list.appendChild(interestItem(loan)));
  container.appendChild(list);
}

function interestItem(loan) {
  const item = el("div", "interest-item");

  const info = el("div", "interest-info");
  const borrower = el("div", "interest-borrower");
  borrower.textContent = loan.borrowerName || "Unknown";
  const amount = el("div", "interest-loan");
  amount.textContent = `Loan: ${formatCurrency(loan.principalAmount ?? loan.approvedAmount)}`;
  const interest = el("div", "interest-amount");
  interest.textContent = `Interest: ${formatCurrency(loan.totalInterest)}`;
  const date = el("div", "interest-date");
  date.textContent = `Disbursed: ${formatDate(loan.disbursedAt)}`;
  info.append(borrower, amount, interest, date);
  item.appendChild(info);

  const statusWrap = el("div", "interest-status");
  const badge = el("span", `badge badge-${loan.status === "completed" ? "success" : "info"}`);
  badge.textContent = loan.status;
  statusWrap.appendChild(badge);
  item.appendChild(statusWrap);

  return item;
}

// ── Edit Rates modal ─────────────────────────────────────────────────────────
/**
 * Only the fields update_rules() actually whitelists for interest/penalties
 * are editable. seedMoneyAmount / monthlyContributionAmount are whitelisted
 * too but belong to manage_payments_sql.js's settings modal, not this page.
 * loanPenalty.rate / monthlyPenalty.rate from the original modal have no
 * server column any more (flat daily amount replaced the rate) — deferred.
 */
function openEditRatesModal() {
  if (!groupRules) {
    showToast("Rate data is not loaded yet — try again in a moment.", "error");
    return;
  }
  if (currentUserRole !== "senior_admin") {
    showToast("Only a senior admin can edit interest & penalty rates.", "warning");
    // Still show the form read-only-ish so an admin can see current values;
    // the server is the real gate and will reject a save with 403.
  }

  if (modalTitle()) modalTitle().textContent = "Edit Interest Rates & Penalties";

  const form = modalForm();
  if (!form) return;
  form.textContent = "";

  form.append(
    formSection("Loan Interest Rates", [
      numberField("editLoanInterestM1", "Month 1 Rate (%)", groupRules.loanInterestRateMonth1, {step: "0.1", min: "0"}),
      numberField("editLoanInterestM2", "Month 2 Rate (%)", groupRules.loanInterestRateMonth2, {step: "0.1", min: "0"}),
      numberField("editLoanInterestM3", "Month 3+ Rate (%)", groupRules.loanInterestRateMonth3, {step: "0.1", min: "0"}),
    ]),
    formSection("Loan Penalty", [
      numberField("editLoanPenaltyDailyAmount", "Daily Penalty (MWK)", groupRules.loanPenaltyDailyAmount, {step: "0.01", min: "0"}),
      numberField("editLoanGracePeriod", "Grace Period (days)", groupRules.loanPenaltyGracePeriodDays, {min: "0"}),
    ]),
    formSection("Contribution Penalty", [
      numberField("editContributionPenaltyDailyAmount", "Daily Penalty (MWK)", groupRules.contributionPenaltyDailyAmount, {step: "0.01", min: "0"}),
      numberField("editContributionGracePeriod", "Grace Period (days)", groupRules.contributionPenaltyGracePeriodDays, {min: "0"}),
    ]),
  );

  showModal("editModal");
}

function formSection(title, fields) {
  const section = el("div", "form-section");
  const heading = el("h4", "form-section-title");
  heading.textContent = title;
  section.appendChild(heading);
  const row = el("div", "form-row");
  fields.forEach((f) => row.appendChild(f));
  section.appendChild(row);
  return section;
}

function numberField(id, label, value, attrs = {}) {
  const group = el("div", "form-group");
  const labelEl = el("label", "form-label");
  labelEl.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.className = "form-input";
  input.id = id;
  input.value = value !== undefined && value !== null ? String(value) : "0";
  Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));
  group.append(labelEl, input);
  return group;
}

function closeEditRatesModal() {
  hideModal("editModal");
}

const RATE_FIELD_MAP = [
  ["editLoanInterestM1", "loanInterestRateMonth1"],
  ["editLoanInterestM2", "loanInterestRateMonth2"],
  ["editLoanInterestM3", "loanInterestRateMonth3"],
  ["editLoanPenaltyDailyAmount", "loanPenaltyDailyAmount"],
  ["editLoanGracePeriod", "loanPenaltyGracePeriodDays"],
  ["editContributionPenaltyDailyAmount", "contributionPenaltyDailyAmount"],
  ["editContributionGracePeriod", "contributionPenaltyGracePeriodDays"],
];

async function saveRateChanges() {
  if (!currentGroupId) {
    showToast("No group selected", "error");
    return;
  }

  const payload = {groupId: currentGroupId};
  RATE_FIELD_MAP.forEach(([inputId, ruleField]) => {
    const node = document.getElementById(inputId);
    if (!node || node.value === "") return;
    const value = parseFloat(node.value);
    if (Number.isFinite(value)) payload[ruleField] = value;
  });

  showSpinner(true);
  try {
    await apiPost("rules.update", payload);
    showToast("Rates updated successfully", "success");
    closeEditRatesModal();
    await loadGroupData();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      showToast("Only a senior admin can change group rules.", "error");
    } else {
      handleApiError(error, "Failed to save rate changes");
    }
  } finally {
    showSpinner(false);
  }
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
  return `MWK ${numberOf(amount).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

function formatDate(value) {
  if (!value) return "N/A";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "N/A" : d.toLocaleDateString();
}

function showModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.classList.add("active");
  document.body.style.overflow = "hidden";
}

function hideModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("active");
  document.body.style.overflow = "";
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
