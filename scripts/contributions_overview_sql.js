/**
 * contributions_overview_sql.js — SQL port of contributions_overview.js (admin
 * read-only overview: who has paid their monthly contribution this month, who
 * is behind, and per-member / group totals). Not wired into any page until
 * the cutover — see BUILD_PLAN.md.
 *
 * HARD RULE: no client-side money math. Every arrears/penalty figure comes
 * from `payments.obligations` (computed server-side, live penalty included).
 * This file only SUMS already-server-computed numbers for the group-total
 * tiles and history rows — it never derives a new arrears or penalty figure.
 *
 * ENDPOINT CONTRACT (verified by reading api/handlers/payments.php,
 * api/handlers/rules.php directly):
 *   groups.mine           -> via listMyGroups(); filtered to
 *                            admin/senior_admin/treasurer (this is an admin
 *                            overview page).
 *   members.list           -> GET, {groupId} -> {members:[{uid, fullName, ...}]}.
 *   rules.get               -> GET, {groupId} -> the group_rules row directly
 *                            (monthlyContributionAmount, etc — no wrapper).
 *   payments.list           -> GET, {groupId[, year]} -> {payments:[...]}. Used
 *                            here ONLY for the multi-year history section
 *                            (already-settled amountPaid, summed per month —
 *                            no live penalty needed for history).
 *   payments.obligations    -> GET, {groupId, uid} -> per-member obligations
 *                            INCLUDING live penalty. `monthlyContributions` is
 *                            NOT itself an array — it WRAPS a `.months` array
 *                            of {month, totalAmount, amountPaid, arrears,
 *                            dueDate, approvalStatus, penalty}. This is the
 *                            ONLY source used for "who is behind right now".
 *                            It accepts an explicit `year` (added cycle 25), so
 *                            the live arrears view follows the year selector and
 *                            can show a PAST cycle — it is not pinned to "now".
 *                            The settled-history section still uses payments.list.
 *
 * DEFERRED (toast + reported, never invented): CSV/PDF export of the
 * contributions table (no export endpoint); "send reminder" bulk action from
 * this page (reminders.send exists — see manage_payments_sql.js — but wiring
 * it here was not asked for and would duplicate that page's flow).
 */

import {apiGet, requireSession, listMyGroups, ApiError} from "./api.js";

const CONTRIBUTION_ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

let currentUser = null;
let currentGroupId = null;
let members = [];
let groupRules = null;
/** uid -> obligations response (payments.obligations), for the SELECTED YEAR only if it is the current year. */
let obligationsByUid = new Map();
/** Raw payments.list rows for the year picked in the history selector. */
let historyPayments = [];

const groupSelector = () => document.getElementById("groupSelector");
const monthSelector = () => document.getElementById("monthSelector");
const historyYearSelector = () => document.getElementById("historyYearSelector");
const contributionsList = () => document.getElementById("contributionsList");
const contributionHistory = () => document.getElementById("contributionHistory");
const breakdownCards = () => document.getElementById("breakdownCards");
const spinner = () => document.getElementById("spinner");

document.addEventListener("DOMContentLoaded", async () => {
  const backButton = document.querySelector(".page-back-btn");
  backButton?.addEventListener("click", () => {
    window.location.href = "admin_dashboard.html";
  });

  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    if (currentGroupId && monthSelector()?.value) {
      await loadCurrentMonthView();
    }
  });

  groupSelector()?.addEventListener("change", async (e) => {
    currentGroupId = e.target.value;
    if (!currentGroupId) return;
    sessionStorage.setItem("selectedGroupId", currentGroupId);
    await loadGroupData();
  });

  monthSelector()?.addEventListener("change", loadCurrentMonthView);

  // The year now drives BOTH sections: relabel the months for that year, refresh
  // the live arrears view for it, and reload the settled history.
  historyYearSelector()?.addEventListener("change", async () => {
    populateMonthSelector();
    await Promise.all([loadCurrentMonthView(), loadHistory()]);
  });

  populateMonthSelector();
  populateYearSelector();

  try {
    currentUser = await requireSession(); // redirects to login on 401
  } catch (error) {
    handleApiError(error, "Could not verify your session.");
    return;
  }

  await loadAdminGroups();
});

/**
 * The year the page is currently showing. Driven by the year selector; falls back
 * to the current calendar year. payments.obligations accepts this year explicitly
 * (added cycle 25), so the live arrears view can show a past cycle rather than
 * silently only ever answering for "now".
 */
function selectedYear() {
  const value = parseInt(historyYearSelector()?.value || "", 10);
  return Number.isFinite(value) ? value : new Date().getFullYear();
}

function populateMonthSelector() {
  const select = monthSelector();
  if (!select) return;
  select.textContent = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select Month...";
  select.appendChild(placeholder);

  const year = selectedYear();
  const now = new Date();
  const isCurrentYear = year === now.getFullYear();

  MONTH_NAMES.forEach((name, index) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = `${name} ${year}`;
    // Default to the current month in the current year; to January otherwise.
    if (isCurrentYear ? index === now.getMonth() : index === 0) option.selected = true;
    select.appendChild(option);
  });
}

function populateYearSelector() {
  const select = historyYearSelector();
  if (!select) return;
  select.textContent = "";

  const currentYear = new Date().getFullYear();
  for (let i = 0; i < 5; i++) {
    const year = currentYear - i;
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    if (i === 0) option.selected = true;
    select.appendChild(option);
  }
}

async function loadAdminGroups() {
  showSpinner(true);
  try {
    const groups = await listMyGroups();
    const adminGroups = groups.filter((g) => CONTRIBUTION_ADMIN_ROLES.includes(g.myRole));

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
    await loadMembers();
    await loadRules();
    await loadCurrentMonthView();
    await loadHistory();
  } catch (error) {
    handleApiError(error, "Failed to load group data");
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

async function loadRules() {
  try {
    groupRules = await apiGet("rules.get", {groupId: currentGroupId});
  } catch (error) {
    groupRules = null;
    handleApiError(error, "Failed to load group rules");
  }
}

/** Live view of the selected month, sourced entirely from payments.obligations. */
async function loadCurrentMonthView() {
  if (!currentGroupId || members.length === 0) {
    renderBreakdownCards(null);
    renderContributionsList([]);
    return;
  }

  showSpinner(true);
  try {
    const results = await Promise.all(
      members.map((m) =>
        apiGet("payments.obligations", {
          groupId: currentGroupId,
          uid: m.uid,
          // The endpoint now accepts an explicit year (added cycle 25), so the
          // live arrears view is no longer pinned to the current calendar year.
          year: selectedYear(),
        })
          .catch((error) => {
            console.error(`Failed to load obligations for ${m.uid}`, error);
            return null;
          }),
      ),
    );

    obligationsByUid = new Map();
    members.forEach((m, index) => obligationsByUid.set(m.uid, results[index]));

    const selectedMonth = monthSelector()?.value || MONTH_NAMES[new Date().getMonth()];
    const rows = buildMonthRows(selectedMonth);
    renderBreakdownCards(summarize(rows));
    renderContributionsList(rows);
  } catch (error) {
    handleApiError(error, "Failed to load contribution obligations");
  } finally {
    showSpinner(false);
  }
}

function buildMonthRows(month) {
  return members.map((member) => {
    const obligations = obligationsByUid.get(member.uid);
    const monthEntry = obligations?.monthlyContributions?.months?.find((m) => m.month === month) || null;

    const totalAmount = numberOf(monthEntry?.totalAmount);
    const amountPaid = numberOf(monthEntry?.amountPaid);
    const arrears = numberOf(monthEntry?.arrears);
    const approvalStatus = monthEntry?.approvalStatus || "unpaid";
    const penaltyAccrued = numberOf(monthEntry?.penalty?.amountAccrued);

    let status = "unpaid";
    if (approvalStatus === "approved" || approvalStatus === "completed") {
      status = arrears > 0 ? "partial" : "completed";
    } else if (approvalStatus === "pending") {
      status = "pending";
    }

    return {
      memberId: member.uid,
      memberName: member.fullName || "Unknown",
      expected: totalAmount,
      paid: amountPaid,
      arrears,
      penaltyAccrued,
      status,
      approvalStatus,
      dueDate: monthEntry?.dueDate || null,
    };
  });
}

/** Sum already-server-computed figures for the tiles. No new money math. */
function summarize(rows) {
  let expectedTotal = 0;
  let collected = 0;
  let outstanding = 0;
  let paidCount = 0;

  rows.forEach((row) => {
    expectedTotal += row.expected;
    if (row.status === "completed" || row.status === "partial") {
      collected += row.paid;
      paidCount++;
    }
    outstanding += row.arrears;
  });

  return {expectedTotal, collected, outstanding, paidCount, totalMembers: rows.length};
}

function renderBreakdownCards(stats) {
  const container = breakdownCards();
  if (!container) return;
  container.textContent = "";

  const s = stats || {expectedTotal: 0, collected: 0, outstanding: 0, paidCount: 0, totalMembers: 0};

  setText("totalContributed", formatCurrency(s.collected));
  setText("thisMonth", formatCurrency(s.collected));
  setText("pendingAmount", formatCurrency(s.outstanding));
  setText("memberCount", `${s.paidCount}/${s.totalMembers}`);

  container.append(
    statCard("Expected", formatCurrency(s.expectedTotal)),
    statCard("Collected", formatCurrency(s.collected)),
    statCard("Outstanding (incl. penalties)", formatCurrency(s.outstanding)),
    statCard("Members Paid", `${s.paidCount} of ${s.totalMembers}`),
  );
}

function statCard(label, value) {
  const card = el("div", "breakdown-card");
  const header = el("div", "breakdown-card-header");
  const title = el("span", "breakdown-card-title");
  title.textContent = label;
  header.appendChild(title);
  const valueEl = el("div", "breakdown-card-value");
  valueEl.textContent = value;
  card.append(header, valueEl);
  return card;
}

const STATUS_LABELS = {completed: "Completed", partial: "Partial", pending: "Pending", unpaid: "Unpaid"};

function renderContributionsList(rows) {
  const container = contributionsList();
  if (!container) return;
  container.textContent = "";

  if (rows.length === 0) {
    container.appendChild(emptyState("📊", "No contribution data available"));
    return;
  }

  const table = document.createElement("table");
  table.className = "table table-responsive";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Member Name", "Expected (MWK)", "Paid (MWK)", "Arrears (MWK)", "Status", "Due Date"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.dataset.label = "Member";
    nameTd.className = "cell-name";
    nameTd.textContent = row.memberName;
    tr.appendChild(nameTd);

    tr.appendChild(moneyCell("Expected", row.expected));
    tr.appendChild(moneyCell("Paid", row.paid));

    const arrearsTd = moneyCell("Arrears", row.arrears);
    arrearsTd.classList.add(row.arrears > 0 ? "cell-danger" : "cell-success");
    tr.appendChild(arrearsTd);

    const statusTd = document.createElement("td");
    statusTd.dataset.label = "Status";
    const badge = el("span", `status-badge ${row.status}`);
    badge.textContent = STATUS_LABELS[row.status] || row.status;
    statusTd.appendChild(badge);
    if (row.penaltyAccrued > 0) {
      const penaltyNote = document.createElement("span");
      penaltyNote.className = "cell-danger";
      penaltyNote.style.marginLeft = "6px";
      penaltyNote.textContent = `(+${formatCurrency(row.penaltyAccrued)} penalty)`;
      statusTd.appendChild(penaltyNote);
    }
    tr.appendChild(statusTd);

    const dueTd = document.createElement("td");
    dueTd.dataset.label = "Due Date";
    dueTd.className = "cell-muted";
    dueTd.textContent = formatDate(row.dueDate);
    tr.appendChild(dueTd);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

function moneyCell(label, amount) {
  const td = document.createElement("td");
  td.dataset.label = label;
  td.className = "cell-right cell-nowrap";
  td.textContent = numberOf(amount).toLocaleString();
  return td;
}

/**
 * History section — settled totals per month for the chosen year, built from
 * payments.list rows. No live penalty is shown here (a past year has none
 * still accruing); this is deliberately simpler than the live monthly view.
 */
async function loadHistory() {
  if (!currentGroupId) return;
  const container = contributionHistory();
  if (!container) return;

  const year = historyYearSelector()?.value;
  showSpinner(true);
  try {
    const data = await apiGet("payments.list", {groupId: currentGroupId, year});
    historyPayments = Array.isArray(data && data.payments) ? data.payments : [];
    renderHistory();
  } catch (error) {
    container.textContent = "";
    container.appendChild(emptyState("❌", "Error loading history"));
    handleApiError(error, "Failed to load contribution history");
  } finally {
    showSpinner(false);
  }
}

const SETTLED_STATUSES = ["approved", "completed"];

function renderHistory() {
  const container = contributionHistory();
  if (!container) return;
  container.textContent = "";

  const monthly = historyPayments.filter((p) => p.paymentType === "monthly_contribution" && SETTLED_STATUSES.includes(p.approvalStatus));

  const byMonth = new Map();
  monthly.forEach((p) => {
    const key = p.month || "Unknown";
    const entry = byMonth.get(key) || {month: key, collected: 0, paidCount: 0};
    entry.collected += numberOf(p.amountPaid);
    entry.paidCount += 1;
    byMonth.set(key, entry);
  });

  const rows = Array.from(byMonth.values()).sort(
    (a, b) => MONTH_NAMES.indexOf(b.month) - MONTH_NAMES.indexOf(a.month),
  );

  if (rows.length === 0) {
    container.appendChild(emptyState("📋", "No contribution history available"));
    return;
  }

  rows.forEach((row) => container.appendChild(historyItem(row)));
}

function historyItem(row) {
  const wrap = el("div", "history-item");
  const card = el("div", "history-item-card");

  const header = el("div", "history-item-header");
  const monthEl = el("div", "history-item-month");
  monthEl.textContent = row.month;
  header.appendChild(monthEl);
  card.appendChild(header);

  const stats = el("div", "history-item-stats");
  stats.append(
    historyStat("Collected", formatCurrency(row.collected)),
    historyStat("Members Paid", String(row.paidCount)),
  );
  card.appendChild(stats);

  wrap.appendChild(card);
  return wrap;
}

function historyStat(label, value) {
  const wrap = el("div", "history-stat");
  const labelEl = el("div", "history-stat-label");
  labelEl.textContent = label;
  const valueEl = el("div", "history-stat-value");
  valueEl.textContent = value;
  wrap.append(labelEl, valueEl);
  return wrap;
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

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
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
