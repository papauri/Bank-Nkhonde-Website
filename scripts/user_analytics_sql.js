/**
 * user_analytics_sql.js — SQL port of user_analytics.js (MEMBER-scoped
 * analytics: my contributions over time, my loans, my repayment progress,
 * my standing vs the group). Not wired into any page until cutover — see
 * BUILD_PLAN.md.
 *
 * HARD RULE: no client-side money math beyond summing already-server-computed
 * figures. Every arrears/penalty/obligation figure comes straight from the
 * API and is never recomputed here.
 *
 * ENDPOINT CONTRACT (verified by reading api/handlers/payments.php,
 * api/handlers/loans.php, api/handlers/repayments.php directly):
 *   groups.mine            -> via listMyGroups(); every group the caller
 *                             belongs to, any role (this is a member page).
 *   payments.obligations    -> GET, {groupId[, year]}. NO uid passed — the
 *                             server defaults to the CALLER's own obligations.
 *                             Passing uid is admin-only server-side; never
 *                             attempted here. Returns seedMoney, service fee
 *                             (nullable), monthlyContributions.months[] (each
 *                             with totalAmount/amountPaid/arrears/dueDate/
 *                             approvalStatus), and standing{}.
 *   loans.list               -> GET, {groupId}. The server restricts a plain
 *                             member's rows to their OWN loans (borrowerId =
 *                             caller) — no client-side filtering needed or
 *                             attempted. Used for "my loans" + progress bars.
 *   repayments.mine          -> GET, {groupId}. The CALLER's own loan_payments
 *                             rows across all their loans, every status —
 *                             used for the repayment history list.
 *
 * STATUS CONSTANTS (see loans.status enum: pending | approved | rejected |
 * disbursed | completed | defaulted — there is NO 'active' status, and
 * `loans.approve` sets 'approved', never 'disbursed'):
 *   ISSUED_LOAN_STATUSES — money left the box: approved/disbursed/completed/
 *   defaulted. loans.disbursedAt is never populated by the API, so any
 *   time-keying falls back to approvedAt.
 *
 * DEFERRED (toast + reported, never invented):
 *   - The "loans currently being disbursed" / "booking queue" panels the
 *     Firebase original showed (other members' loans, account numbers) — a
 *     plain member's loans.list call only ever returns THEIR OWN rows
 *     server-side, so there is no endpoint that returns other members' loan
 *     or account data to a member. Showing it would require an admin-only
 *     endpoint this page must not call.
 *   - The entire "Book a Loan" tab/modal (loanBookings collection) — no
 *     booking endpoint exists anywhere in api/ (grepped, zero hits). Booking
 *     a loan slot is not a feature of the SQL API yet.
 *   - CSV/PDF export of any tab — no export endpoint exists.
 *   - Group-wide participation comparison ("standing vs the group") beyond
 *     the server's own `standing` block — cycle.equity carries that
 *     comparison but is admin/senior_admin/treasurer-gated server-side
 *     (require_role in cycle_equity()); a member page must not call it.
 */

import {apiGet, requireSession, listMyGroups, ApiError, redirectToLogin} from "./api.js";

/**
 * Loan statuses where the loan was actually ISSUED (money left the box).
 * See file header — there is no 'active' status and 'disbursed' is never
 * written by the API, so 'approved' must be included or issued loans read
 * as zero.
 */
const ISSUED_LOAN_STATUSES = ["approved", "disbursed", "completed", "defaulted"];

let currentUser = null;
let currentGroupId = null;
let userGroups = [];
let obligations = null;
let myLoans = [];
/** loans.list's server-computed `summary` block — already member-scoped since
 * a plain member's loans.list call only ever returns their own rows. */
let myLoansSummary = null;
let myRepayments = [];

const groupSelectorEl = () => document.getElementById("groupSelector");
const spinner = () => document.getElementById("spinner");
const chartContainerEl = () => document.getElementById("chartContainer");
const groupStatsSectionEl = () => document.getElementById("groupStatsSection");

export async function init() {
  setupEventListeners();

  try {
    currentUser = await requireSession(); // redirects to login on 401
  } catch (error) {
    handleApiError(error, "Could not verify your session.");
    return;
  }

  await loadUserGroups();
}
if (!window.__bnSpa) {
  document.addEventListener("DOMContentLoaded", () => { init(); });
}

function setupEventListeners() {
  groupSelectorEl()?.addEventListener("change", async (e) => {
    currentGroupId = e.target.value;
    if (currentGroupId) {
      sessionStorage.setItem("selectedGroupId", currentGroupId);
      await loadGroupData();
    } else {
      obligations = null;
      myLoans = [];
      myRepayments = [];
      const section = groupStatsSectionEl();
      if (section) section.style.display = "none";
      const container = chartContainerEl();
      if (container) {
        container.textContent = "";
        container.appendChild(emptyState("📊", "Select a group to view contribution trends"));
      }
      const activity = document.getElementById("recentActivity");
      if (activity) {
        activity.textContent = "";
        activity.appendChild(emptyState("📊", "Select a group to view recent activity"));
      }
    }
  });
}

async function loadUserGroups() {
  showSpinner(true);
  try {
    userGroups = await listMyGroups();

    const selector = groupSelectorEl();
    if (selector) {
      selector.textContent = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a group...";
      selector.appendChild(placeholder);

      userGroups.forEach((group) => {
        const option = document.createElement("option");
        option.value = group.groupId || group.id;
        option.textContent = group.groupName || group.name || "Unnamed group";
        selector.appendChild(option);
      });
    }

    if (userGroups.length === 0) {
      showToast("You are not a member of any groups yet.", "warning");
      return;
    }

    const stored = sessionStorage.getItem("selectedGroupId") || localStorage.getItem("selectedGroupId");
    const match = userGroups.find((g) => (g.groupId || g.id) === stored);
    const chosen = match || userGroups[0];
    currentGroupId = chosen.groupId || chosen.id;
    if (selector) selector.value = currentGroupId;
    sessionStorage.setItem("selectedGroupId", currentGroupId);

    await loadGroupData();
  } catch (error) {
    handleApiError(error, "Failed to load your groups");
  } finally {
    showSpinner(false);
  }
}

// Loads both contribution obligations and loan/repayment data for the
// selected group, then renders every stat block the real markup exposes.
async function loadGroupData() {
  if (!currentGroupId) return;
  await loadContributions();
  await loadLoans();
}

// ── Contributions ───────────────────────────────────────────────────────────
async function loadContributions() {
  if (!currentGroupId) return;
  showSpinner(true);
  try {
    obligations = await apiGet("payments.obligations", {groupId: currentGroupId});

    renderTopStats();
    renderContributionTrendChart();
  } catch (error) {
    obligations = null;
    handleApiError(error, "Failed to load your contributions");
  } finally {
    showSpinner(false);
  }
}

function renderTopStats() {
  // totalContributed/totalArrears below span seed money + monthly
  // contributions + service fee combined — the exact scope the server's
  // obligations `summary.contributed` / `summary.arrears` fields cover, so
  // they're read directly instead of re-summed client-side. (Note:
  // summary.arrears alone, without penaltyAccrued, matches this page's prior
  // scope — it never folded live-penalty accrual into "arrears" either.)
  const summary = obligations?.summary || {};
  const totalContributed = numberOf(summary.contributed);
  const totalArrears = numberOf(summary.arrears);

  // Substituted with the server summary: remainingBalance is '0.00' for every
  // loan outside ISSUED_LOAN_STATUSES (pending/rejected never had a balance
  // set, completed loans are repaid to 0), so summing over ALL of this caller's
  // rows (`summary.totalOutstanding` — loans.list is already member-scoped)
  // equals this filtered client-side sum.
  const outstanding = myLoansSummary ? numberOf(myLoansSummary.totalOutstanding) : 0;
  // NOT substituted with `summary.totalPrincipal`/`activePrincipal`: totalPrincipal
  // sums over ALL rows including pending/rejected (which still carry a nonzero
  // requested principalAmount), and activePrincipal excludes completed/defaulted.
  // Neither scope matches ISSUED_LOAN_STATUSES, so this stays a client-side sum.
  const totalBorrowed = myLoans
    .filter((l) => ISSUED_LOAN_STATUSES.includes(l.status))
    .reduce((sum, l) => sum + numberOf(l.principalAmount ?? l.approvedAmount), 0);

  setText(document.getElementById("totalContributed"), formatCurrency(totalContributed));
  setText(document.getElementById("totalBorrowed"), formatCurrency(totalBorrowed));
  setText(document.getElementById("outstanding"), formatCurrency(outstanding));
  setText(document.getElementById("totalArrears"), formatCurrency(totalArrears));

  setText(document.getElementById("userTotalContributed"), formatCurrency(totalContributed));
  setText(document.getElementById("userTotalLoans"), formatCurrency(totalBorrowed));
  setText(document.getElementById("userLoanOutstanding"), formatCurrency(outstanding));
  setText(document.getElementById("userTotalArrears"), formatCurrency(totalArrears));
  setText(
      document.getElementById("userActiveLoans"),
      String(myLoans.filter((l) => ISSUED_LOAN_STATUSES.includes(l.status)).length),
  );
  setText(document.getElementById("userGroupsCount"), String(userGroups.length));

  // groupTotalContributed mirrors totalContributed: obligations is already
  // scoped to currentGroupId, so "you contributed" for the selected group is
  // the same figure as the top-of-page total.
  setText(document.getElementById("groupTotalContributed"), formatCurrency(totalContributed));

  const section = groupStatsSectionEl();
  if (section) section.style.display = "";
}

function renderContributionTrendChart() {
  const container = chartContainerEl();
  if (!container) return;
  container.textContent = "";

  const months = obligations?.monthlyContributions?.months || [];
  if (months.length === 0) {
    container.appendChild(emptyState("📊", "No contribution data available yet"));
    return;
  }

  const monthsWithData = months.filter((m) => numberOf(m.amountPaid) > 0 || numberOf(m.totalAmount) > 0);
  const monthsToShow = (monthsWithData.length > 0 ? monthsWithData : months).slice(-6);

  const maxAmount = Math.max(
      1,
      ...monthsToShow.map((m) => Math.max(numberOf(m.amountPaid), numberOf(m.totalAmount))),
  );

  monthsToShow.forEach((month) => {
    const paid = numberOf(month.amountPaid);
    const expected = numberOf(month.totalAmount);
    const barHeight = maxAmount > 0 ? (paid / maxAmount) * 100 : 0;

    const wrapper = el("div", "chart-bar-wrapper");
    const bar = el("div", "chart-bar animated");
    bar.style.cssText = `height:160px; --bar-height: ${Math.max(barHeight, 2)}%;`;
    bar.title = `${month.month}: ${formatCurrency(paid)} / ${formatCurrency(expected)}`;

    const label = el("span", "chart-label");
    label.textContent = month.month.slice(0, 3);

    wrapper.append(bar, label);
    container.appendChild(wrapper);
  });
}

// ── Loans / repayment history ───────────────────────────────────────────────
async function loadLoans() {
  if (!currentGroupId) return;
  showSpinner(true);
  try {
    const data = await apiGet("loans.list", {groupId: currentGroupId});
    // The server already restricts a plain member's rows to their own loans —
    // no client-side filtering by borrowerId is performed or needed here.
    myLoans = Array.isArray(data && data.loans) ? data.loans : [];
    myLoansSummary = data && data.summary && typeof data.summary === "object" ? data.summary : null;

    const repayData = await apiGet("repayments.mine", {groupId: currentGroupId});
    myRepayments = Array.isArray(repayData && repayData.payments) ? repayData.payments : [];

    renderRepaymentHistory();

    // Re-derive the top stats now that loans are loaded (totalBorrowed,
    // outstanding, userActiveLoans depend on myLoans).
    renderTopStats();
  } catch (error) {
    myLoans = [];
    myLoansSummary = null;
    myRepayments = [];
    handleApiError(error, "Failed to load your loans");
  } finally {
    showSpinner(false);
  }
}

function renderRepaymentHistory() {
  const container = document.getElementById("recentActivity");
  if (!container) return;
  container.textContent = "";

  if (!currentGroupId) {
    container.appendChild(emptyState("📊", "Select a group to view recent activity"));
    return;
  }

  if (myRepayments.length === 0) {
    container.appendChild(emptyState("📊", "No recent activity"));
    return;
  }

  myRepayments.slice(0, 10).forEach((payment) => {
    const div = el("div", "list-item");

    const info = el("div");
    info.style.flex = "1";
    const title = el("div", "list-item-title");
    title.textContent = `Loan Payment${payment.loanNumber ? ` — ${payment.loanNumber}` : ""}`;
    info.appendChild(title);

    const when = payment.paidAt || payment.createdAt;
    const dateLabel = when ? new Date(when).toLocaleDateString() : "N/A";
    const subtitle = el("div", "list-item-subtitle");
    subtitle.textContent = `${dateLabel} • ${payment.status}`;
    info.appendChild(subtitle);

    div.appendChild(info);

    const amountWrap = el("div");
    const amountSpan = document.createElement("span");
    amountSpan.style.cssText = "font-size:1.125rem; font-weight:700; color: var(--bn-accent);";
    amountSpan.textContent = formatCurrency(payment.amount);
    amountWrap.appendChild(amountSpan);
    div.appendChild(amountWrap);

    container.appendChild(div);
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

function formatCurrency(amount) {
  return `MWK ${numberOf(amount).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
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
