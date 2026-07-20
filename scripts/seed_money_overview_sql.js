/**
 * seed_money_overview_sql.js — SQL port of seed_money_overview.js (admin
 * read-only overview: seed-money status per member — paid / partial /
 * outstanding — and the group total). Not wired into any page until the
 * cutover — see BUILD_PLAN.md.
 *
 * HARD RULE: no client-side money math. Every arrears/penalty figure comes
 * from `payments.obligations` (computed server-side, live penalty included).
 * This file only SUMS already-server-computed numbers for the tiles — it
 * never derives a new arrears or penalty figure.
 *
 * ENDPOINT CONTRACT (verified by reading api/handlers/payments.php directly):
 *   groups.mine        -> via listMyGroups(); filtered to
 *                         admin/senior_admin/treasurer (this is an admin page).
 *   members.list        -> GET, {groupId} -> {members:[{uid, fullName, ...}]}.
 *   payments.obligations -> GET, {groupId, uid} -> {seedMoney:{totalAmount,
 *                         amountPaid, arrears, dueDate, penalty:{amountAccrued,
 *                         daysCharged, dailyAmount}}, ...}. Called once per
 *                         member with Promise.all (group max ~30 — N+1 is
 *                         acceptable, sequential awaiting is not).
 *
 * DEFERRED (toast + reported, never invented): CSV/PDF export of the seed
 * money table (no export endpoint exists).
 */

import {apiGet, requireSession, listMyGroups, ApiError, redirectToLogin} from "./api.js";
import { formatCurrency } from "./utils_financial.js";

const SEED_MONEY_ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];

let currentUser = null;
let currentGroupId = null;
let members = [];
/** Rows built from payments.obligations, one per member. */
let allSeedMoneyData = [];

const groupSelector = () => document.getElementById("groupSelector");
const seedMoneyList = () => document.getElementById("seedMoneyList");
const spinner = () => document.getElementById("spinner");

export async function init() {
  document.querySelectorAll(".tab[data-filter]").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab[data-filter]").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      applyFilter(tab.dataset.filter);
    });
  });

  groupSelector()?.addEventListener("change", async (e) => {
    currentGroupId = e.target.value;
    if (currentGroupId) {
      sessionStorage.setItem("selectedGroupId", currentGroupId);
      await loadSeedMoneyData();
    } else {
      renderEmpty("Select a group to view seed money status");
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
    const adminGroups = groups.filter((g) => SEED_MONEY_ADMIN_ROLES.includes(g.myRole));

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

    await loadSeedMoneyData();
  } catch (error) {
    handleApiError(error, "Failed to load groups");
  } finally {
    showSpinner(false);
  }
}

async function loadSeedMoneyData() {
  if (!currentGroupId) return;
  showSpinner(true);
  try {
    const membersData = await apiGet("members.list", {groupId: currentGroupId});
    members = Array.isArray(membersData && membersData.members) ? membersData.members : [];

    if (members.length === 0) {
      allSeedMoneyData = [];
      updateStats(allSeedMoneyData);
      renderEmpty("No members in this group yet");
      return;
    }

    const results = await Promise.all(
      members.map((m) =>
        apiGet("payments.obligations", {groupId: currentGroupId, uid: m.uid})
          .catch((error) => {
            console.error(`Failed to load obligations for ${m.uid}`, error);
            return null;
          }),
      ),
    );

    allSeedMoneyData = members.map((member, index) => buildRow(member, results[index]));
    updateStats(allSeedMoneyData);

    const activeFilter = document.querySelector(".tab[data-filter].active")?.dataset.filter || "all";
    applyFilter(activeFilter);
  } catch (error) {
    handleApiError(error, "Failed to load seed money data");
  } finally {
    showSpinner(false);
  }
}

function buildRow(member, obligations) {
  const seed = obligations?.seedMoney;
  const required = numberOf(seed?.totalAmount);
  const paid = numberOf(seed?.amountPaid);
  const outstanding = numberOf(seed?.arrears);
  const penaltyAccrued = numberOf(seed?.penalty?.amountAccrued);

  let status = "Unpaid";
  if (paid >= required && required > 0) {
    status = "Paid";
  } else if (paid > 0) {
    status = "Partially Paid";
  }

  return {
    memberName: member.fullName || "Unknown",
    required,
    paid,
    outstanding,
    penaltyAccrued,
    status,
    dueDate: seed?.dueDate || null,
  };
}

/** Sum already-server-computed figures for the tiles. No new money math. */
function updateStats(rows) {
  let totalCollected = 0;
  let totalOutstanding = 0;
  let paidCount = 0;

  rows.forEach((row) => {
    totalCollected += row.paid;
    totalOutstanding += row.outstanding;
    if (row.status === "Paid") paidCount++;
  });

  setText("totalCollected", formatCurrency(totalCollected));
  setText("pendingAmount", formatCurrency(totalOutstanding));
  setText("paidCount", String(paidCount));
  setText("unpaidCount", String(rows.length - paidCount));
}

function applyFilter(filter) {
  let filtered = allSeedMoneyData;
  if (filter === "paid") {
    filtered = allSeedMoneyData.filter((m) => m.status === "Paid");
  } else if (filter === "pending") {
    filtered = allSeedMoneyData.filter((m) => m.status !== "Paid");
  }
  displaySeedMoneyTable(filtered);
}

function displaySeedMoneyTable(data) {
  const container = seedMoneyList();
  if (!container) return;
  container.textContent = "";

  if (data.length === 0) {
    container.appendChild(emptyState("🌱", "No seed money data available"));
    return;
  }

  data.forEach((item) => container.appendChild(memberCard(item)));
}

function memberCard(item) {
  const card = el("div", "member-card");

  const header = el("div", "member-card-header");
  const info = el("div", "member-info");
  const name = el("div", "member-name");
  name.textContent = item.memberName;
  const badgeClass = item.status === "Paid" ? "success" : item.status === "Partially Paid" ? "warning" : "danger";
  const badge = el("span", `badge badge-${badgeClass}`);
  badge.textContent = item.status;
  info.append(name, badge);
  header.appendChild(info);
  card.appendChild(header);

  const body = el("div", "member-card-body");
  const grid = el("div", "member-details-grid");
  grid.append(
    memberDetail("Required", formatCurrency(item.required)),
    memberDetail("Paid", formatCurrency(item.paid), "var(--bn-success)"),
    memberDetail("Outstanding", formatCurrency(item.outstanding), item.outstanding > 0 ? "var(--bn-danger)" : "var(--bn-success)"),
    memberDetail("Due Date", formatDate(item.dueDate)),
  );
  body.appendChild(grid);

  if (item.penaltyAccrued > 0) {
    const penaltyNote = el("div");
    penaltyNote.style.cssText = "font-size: var(--bn-text-sm); color: var(--bn-danger); margin-top: var(--bn-space-2);";
    penaltyNote.textContent = `Live penalty accrued: ${formatCurrency(item.penaltyAccrued)}`;
    body.appendChild(penaltyNote);
  }

  const progressPercent = item.required > 0 ? Math.min((item.paid / item.required) * 100, 100) : 0;
  const progressWrap = el("div", "progress-bar");
  progressWrap.style.marginTop = "var(--bn-space-4)";
  const progressFill = el("div", "progress-bar-fill");
  progressFill.style.width = `${progressPercent}%`;
  progressWrap.appendChild(progressFill);
  body.appendChild(progressWrap);

  const progressLabel = el("div");
  progressLabel.style.cssText = "text-align:center; font-size: var(--bn-text-sm); color: var(--bn-gray); margin-top: var(--bn-space-2);";
  progressLabel.textContent = `${progressPercent.toFixed(1)}% Complete`;
  body.appendChild(progressLabel);

  card.appendChild(body);
  return card;
}

function memberDetail(label, value, color) {
  const wrap = el("div", "member-detail");
  const labelEl = el("div", "member-detail-label");
  labelEl.textContent = label;
  const valueEl = el("div", "member-detail-value");
  valueEl.textContent = value;
  if (color) valueEl.style.color = color;
  wrap.append(labelEl, valueEl);
  return wrap;
}

function renderEmpty(text) {
  const container = seedMoneyList();
  if (!container) return;
  container.textContent = "";
  container.appendChild(emptyState("🌱", text));
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
