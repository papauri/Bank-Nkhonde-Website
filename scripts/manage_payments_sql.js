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
 *                            endpoint cannot accept. Returns `penaltySettled`:
 *                            the penalty banked from the claim's penalty portion.
 *   payments.reject       -> POST, {paymentId, rejectionReason}.
 *   rules.get / rules.update -> group_rules row. update_rules() whitelists a
 *                            SPECIFIC subset of contribution columns (see the
 *                            settings-modal section below for exactly which).
 *   reminders.send        -> POST, {groupId, recipient:'all'|'specific', uid?,
 *                            subject, message} — identical contract to the one
 *                            already wired in manage_loans_sql.js.
 *   files.upload          -> multipart proof upload. Replies with the standard
 *                            {ok, data:{url, fileName, fileSize}} envelope —
 *                            fetch() is used directly here (multipart), so the
 *                            envelope must be unwrapped BY HAND. Reading a flat
 *                            body.url made every proof upload on this page fail.
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
 * updateInterestDisplay(), updatePaymentAmountFromBase(), and the entire
 * "Apply Penalty" bulk-calculation flow (openApplyPenaltyModal's
 * overdueContributionsList + totalPenalties + penaltyRate arithmetic).
 * Penalties are computed live, on read, by the server for every row already —
 * there is nothing to "apply".
 *
 * RESTORED, SERVER-SIDE: the applyInterestCheckbox / interestDetails UI is live
 * again — but it derives nothing. It DISPLAYS the server's own
 * payment.penalty.amountOutstanding and, when ticked, sends `penaltyAmount` to
 * payments.record so the penalty is collected with the contribution and written
 * to penalty_settlements at approval. See updatePenaltyBreakdown(). The original
 * was dropped because it did the arithmetic in the browser; this one asks the
 * server. The dropped thing was the maths, not the capability.
 */

import {
  apiGet,
  apiPost,
  requireSession,
  listMyGroups,
  ApiError,
  apiUrl,
  redirectToLogin,
  downloadExport,
} from "./api.js";
import { formatCurrency, formatCurrencyFromMinor } from "./utils_financial.js";
import { attachCardInfo, pageStatInfo } from "./card_info.js";
import { emptyState, skeletonRows, renderQuickAmounts } from "./ui.js";

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
  // Deep-link support: the admin dashboard's due-payment "Pay" buttons land
  // here with ?groupId=...&memberId=...&tab=record&paymentType=...&month=...
  // so the record modal opens pre-selected for the exact obligation.
  applyUrlDeepLink();
}
if (!window.__bnSpa) {
  document.addEventListener("DOMContentLoaded", () => { init(); });
}

/**
 * Deep-link support: the admin dashboard's due-payment "Pay" buttons land here
 * with ?groupId=...&memberId=...&tab=record&paymentType=...&month=... so the
 * record modal opens pre-selected for the exact obligation. Runs after
 * loadAdminGroups() so the group selector and member list are populated.
 */
function applyUrlDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const groupId = params.get("groupId");
  const memberId = params.get("memberId");
  const tab = params.get("tab");
  const paymentType = params.get("paymentType");
  const month = params.get("month");

  if (!groupId || !memberId) return;

  // The group must be one the caller admins — never trust the URL blindly.
  const group = adminGroups.find((g) => (g.groupId || g.id) === groupId);
  if (!group) return;

  // Switch the group selector to the deep-linked group.
  selectedGroupId = groupId;
  sessionStorage.setItem("selectedGroupId", groupId);
  const selector = groupSelector();
  if (selector) selector.value = groupId;

  // The member must be a real member of this group.
  const member = members.find((m) => m.uid === memberId);
  if (!member) return;

  // Open the record modal pre-selected for this member.
  openRecordPaymentModal(memberId);

  // Pre-select the payment type and month if provided.
  if (paymentType) {
    const typeSelect = document.getElementById("paymentType");
    if (typeSelect && Array.from(typeSelect.options).some((o) => o.value === paymentType)) {
      typeSelect.value = paymentType;
      const monthGroup = document.getElementById("monthSelectGroup");
      if (monthGroup) {
        monthGroup.style.display = paymentType === "monthly_contribution" ? "block" : "none";
      }
      const advancedWrap = document.getElementById("isAdvancedPayment")?.parentElement?.parentElement;
      if (advancedWrap) advancedWrap.style.display = paymentType === "monthly_contribution" ? "block" : "none";
    }
  }

  if (month) {
    const monthSelect = document.getElementById("paymentMonth");
    if (monthSelect && Array.from(monthSelect.options).some((o) => o.value === month && !o.disabled)) {
      monthSelect.value = month;
    }
  }

  // Re-derive the owed panel + penalty for the pre-selected obligation.
  refreshRecordModal({reloadMonths: false});
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

  document.getElementById("exportCsvBtn")?.addEventListener("click", () => {
    if (!selectedGroupId) {
      showToast("Select a group first", "info");
      return;
    }
    downloadExport("exports.payments", {groupId: selectedGroupId});
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
    tab.addEventListener("click", () => {
      activateTab(tab.dataset.tab || "pending");
      document.getElementById("pendingPaymentsList")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // Stat tiles: click switches to the related tab. "approved" and "collected"
  // have no dedicated tab predicate, so both map to "recent" (sorted activity,
  // no filter) as the closest match.
  document.getElementById("pendingStat")?.addEventListener("click", () => activateTab("pending"));
  document.getElementById("arrearsStat")?.addEventListener("click", () => activateTab("arrears"));
  document.getElementById("approvedStat")?.addEventListener("click", () => activateTab("recent"));
  document.getElementById("collectedStat")?.addEventListener("click", () => activateTab("recent"));

  // Standardized info toggles on the four headline stat cards
  attachPageStatInfo("pendingCount", "Pending Payments",
    "Payments members have submitted that are waiting for an admin to approve or reject. None of this money is counted as received yet.",
    [["Click the card", "to see pending payments"]]);
  attachPageStatInfo("approvedCount", "Approved Payments",
    "Payments an admin has verified — the money has been received and counted toward the member's standing.",
    [["Click the card", "to see recent activity"]]);
  attachPageStatInfo("totalCollected", "Total Collected",
    "Total verified money received from members — seed money, monthly contributions and service fees combined.",
    [["Click the card", "to see recent activity"]]);
  attachPageStatInfo("totalArrears", "Outstanding Arrears",
    "What members still owe the group right now. This is today's live position — contributions not yet paid plus any penalties.",
    [["Click the card", "to see members in arrears"]]);

  document.getElementById("filterByMember")?.addEventListener("change", renderCurrentTab);
  document.getElementById("filterByPaymentType")?.addEventListener("change", renderCurrentTab);
  document.getElementById("filterByMonth")?.addEventListener("change", renderCurrentTab);
  document.getElementById("acctPeriodFilter")?.addEventListener("change", renderAccountantSummary);
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

    refreshRecordModal();
  });

  // The owed info depends on WHO is paying and WHICH month, not just the type.
  // A new member invalidates the cached obligations, so the month list is rebuilt
  // from THAT member's position — otherwise it would still show the last
  // member's paid/unpaid months.
  document.getElementById("memberSelect")?.addEventListener("change", () => {
    recordModalObligations = null;
    refreshRecordModal();
  });
  // The month list itself does not change when the month changes — only the
  // owed panel and the penalty do. Rebuilding it here would fight the select.
  document.getElementById("paymentMonth")?.addEventListener("change", () => {
    refreshRecordModal({reloadMonths: false});
  });

  // "Apply Interest/Penalty" — see updatePenaltyBreakdown() for what it means.
  document.getElementById("applyInterestCheckbox")?.addEventListener("change", updatePenaltyBreakdown);
  // The breakdown's base figure is whatever the admin has typed so far.
  document.getElementById("paymentAmount")?.addEventListener("input", updatePenaltyBreakdown);

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
  // Content-shaped placeholders while the data is in flight, so the table
  // holds its shape instead of collapsing and snapping back.
  const list = pendingPaymentsList();
  if (list) {
    list.textContent = "";
    list.appendChild(skeletonRows(5, 5));
  }
  showSpinner(true);
  try {
    await loadMembers();
    await loadPayments();
    await loadGroupRules();
    updateStats();
    // Load compliance BEFORE rendering the accountant summary, so the "All
    // caught up" banner can use the server's complete picture (including seed
    // money) rather than just the payments list (which only has rows for
    // payments that have been recorded).
    await loadCompliance();
    renderAccountantSummary();
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

// The month ENUM, in calendar order — matches PAYMENT_MONTHS server-side.
const PAYMENT_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Fill the "Filter by Month" control and reveal its container.
 *
 * The select shipped with only an "All Months" placeholder and no code ever
 * added an option or un-hid #monthFilterContainer, so the filter at
 * applyFilters() could never match anything — a dead control, same defect as the
 * record modal's month select.
 */
function populateMonthFilter() {
  const select = document.getElementById("filterByMonth");
  const container = document.getElementById("monthFilterContainer");
  if (!select) return;

  const previous = select.value;
  select.textContent = "";

  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All Months";
  select.appendChild(all);

  // Only months the group actually has contribution rows for — offering a
  // filter that can only ever return nothing is worse than not offering it.
  const present = new Set(
    allPayments
      .filter((p) => p.month)
      .map((p) => String(p.month))
  );
  PAYMENT_MONTH_NAMES.filter((m) => present.has(m)).forEach((m) => {
    const option = document.createElement("option");
    option.value = m;
    option.textContent = m;
    select.appendChild(option);
  });

  select.value = Array.from(select.options).some((o) => o.value === previous)
    ? previous
    : "all";

  if (container) container.style.display = present.size ? "" : "none";
}

async function loadPayments() {
  try {
    const data = await apiGet("payments.list", {groupId: selectedGroupId});
    allPayments = Array.isArray(data && data.payments) ? data.payments : [];
  } catch (error) {
    allPayments = [];
    handleApiError(error, "Failed to load payments");
  }
  // Depends on the rows just loaded — the filter only offers months that exist.
  populateMonthFilter();
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

// ── Accounting summary (status banner + period totals + follow-up list) ──────
// Whether a payment's actual date (paidAt, falling back to createdAt) falls in
// the selected reporting period. Relative periods (month/quarter/year) are
// scoped to the current calendar year; q1–q4 pick a specific quarter of it.
function inAcctPeriod(dateStr, period) {
  if (period === "all") return true;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  if (d.getFullYear() !== now.getFullYear()) return false;
  const m = d.getMonth();
  switch (period) {
    case "month": return m === now.getMonth();
    case "quarter": return Math.floor(m / 3) === Math.floor(now.getMonth() / 3);
    case "year": return true;
    case "q1": return m <= 2;
    case "q2": return m >= 3 && m <= 5;
    case "q3": return m >= 6 && m <= 8;
    case "q4": return m >= 9;
    default: return true;
  }
}

/**
 * One figure tile in the accounting summary.
 *
 * @param {string} label
 * @param {string} value
 * @param {string} cls emphasis class ("pos" | "neg" | "warn" | "")
 * @param {{onClick: (function()|undefined), info: (string|undefined)}=} opts
 *     onClick makes the whole tile a button that drills into the matching
 *     list; info adds the "i" explainer.
 */
function acctTotalTile(label, value, cls, opts = {}) {
  // A tile that drills down is a real <button> so it is keyboard-operable and
  // announced as interactive — not a div with a click handler.
  const tile = document.createElement(opts.onClick ? "button" : "div");
  tile.className = "acct-total" + (opts.onClick ? " is-clickable" : "");
  if (opts.onClick) {
    tile.type = "button";
    tile.addEventListener("click", opts.onClick);
  }

  const l = document.createElement("div");
  l.className = "acct-total-label";
  l.textContent = label;
  const v = document.createElement("div");
  v.className = "acct-total-value" + (cls ? " " + cls : "");
  v.textContent = value;
  tile.append(l, v);

  if (opts.info) {
    attachCardInfo(tile, {label: `About ${label}`, content: opts.info});
  }
  return tile;
}

/** Latest payments.compliance response for the selected group, or null. */
let complianceData = null;

/**
 * Load the group's rule-based position for the current month — what the rules
 * say SHOULD come in, what actually has, and exactly who is short. Every figure
 * is computed server-side; this only renders.
 */
async function loadCompliance() {
  if (!selectedGroupId) return;
  try {
    complianceData = await apiGet("payments.compliance", {groupId: selectedGroupId});
  } catch (error) {
    // A group with no rules configured yet legitimately has nothing to compare
    // against — that's not an error worth interrupting the page for.
    complianceData = null;
  }
  renderCompliance();
}

/**
 * One "collected vs expected" row: a title, a figure pair, a progress track and
 * a plain-language note. Both scopes of the compliance panel are the same shape,
 * so they are built by the same function — which is also what stops the two from
 * drifting into different visual languages.
 *
 * @param {string} title
 * @param {string} collectedText already-formatted money
 * @param {string} expectedText already-formatted money
 * @param {number} pct server-computed 0-100
 * @param {(Node|string)[]} noteParts
 * @return {HTMLElement}
 */
function complianceRow(title, collectedText, expectedText, pct, noteParts) {
  const row = document.createElement("div");
  row.className = "compliance-row";

  const head = document.createElement("div");
  head.className = "compliance-head";
  const titleEl = document.createElement("span");
  titleEl.className = "compliance-title";
  titleEl.textContent = title;
  const figures = document.createElement("span");
  figures.className = "compliance-figures";
  const collected = document.createElement("strong");
  collected.textContent = collectedText;
  figures.append(collected, document.createTextNode(` of ${expectedText}`));
  head.append(titleEl, figures);
  row.appendChild(head);

  const track = document.createElement("div");
  track.className = "compliance-track";
  const fill = document.createElement("span");
  fill.className = "compliance-fill" + (pct < 50 ? " low" : pct < 90 ? " mid" : "");
  fill.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
  track.appendChild(fill);
  row.appendChild(track);

  const note = document.createElement("div");
  note.className = "compliance-note";
  note.append(...noteParts);
  row.appendChild(note);

  return row;
}

/** Short human date for a due date, e.g. "31 Jul". */
function shortDueDate(value) {
  if (!value) return "";
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {day: "numeric", month: "short"});
}

/**
 * Render the group's collection position: THIS MONTH and CYCLE-TO-DATE, as two
 * separate rows, then exactly who owes what.
 *
 * WHY TWO ROWS. These are different questions and the panel used to answer them
 * in one sentence — a month-scoped headline ("0% collected, 50,000 short this
 * month") sitting directly above a cycle-scoped member list whose rows were
 * 60,000 each and summed to 220,000. Nothing reconciled, because nothing was
 * measuring the same thing. The per-member list belongs to the cycle-to-date
 * row and now sums exactly to that row's outstanding figure (the server
 * guarantees it — see group_compliance_summary).
 *
 * Every figure here is rendered, never derived: no client-side money math.
 */
function renderCompliance() {
  const host = document.getElementById("acctCompliance");
  if (!host) return;
  host.textContent = "";

  const d = complianceData;
  // Nothing to compare against unless the group actually sets a monthly due.
  if (!d || !d.monthlyDuePerMember) return;
  const toDate = d.toDate || null;

  const panel = document.createElement("div");
  panel.className = "compliance";

  // ── Row 1: the current month, on its own ──────────────────────────────────
  const monthPct = Number(d.percentCollected) || 0;
  const monthNote = [];
  if (monthPct >= 100) {
    monthNote.push(document.createTextNode(`100% collected · every member has paid for ${d.month}.`));
  } else if (d.monthIsOverdue) {
    const s = document.createElement("strong");
    s.textContent = formatCurrency(d.shortfallThisMonth);
    monthNote.push(
      document.createTextNode(`${monthPct}% collected · `),
      s,
      document.createTextNode(" still to come in — this month is past its due date.")
    );
  } else {
    // Not yet due: outstanding, but nobody is late. Saying "short" here would
    // accuse members of missing a deadline that has not arrived.
    const due = shortDueDate(d.monthDueDate);
    monthNote.push(
      document.createTextNode(
        `${monthPct}% collected · ${formatCurrency(d.shortfallThisMonth)} still expected` +
        (due ? ` — not due until ${due}.` : " this month.")
      )
    );
  }
  panel.appendChild(
    complianceRow(
      `${d.month} ${d.year} — this month`,
      formatCurrency(d.collectedThisMonth),
      formatCurrency(d.expectedThisMonth),
      monthPct,
      monthNote
    )
  );

  // ── Row 2: cycle-to-date — the row the member list reconciles to ───────────
  if (toDate) {
    const toDatePct = Number(toDate.percentCollected) || 0;
    const monthsCounted = Array.isArray(toDate.monthsCounted) ? toDate.monthsCounted.length : 0;
    const toDateNote = [];

    if (Number(d.membersOwing) === 0) {
      toDateNote.push(
        document.createTextNode(`${toDatePct}% collected · all ${d.memberCount} members are fully paid up.`)
      );
    } else {
      const owingEl = document.createElement("strong");
      owingEl.textContent = `${d.membersOwing} of ${d.memberCount} members`;
      toDateNote.push(
        document.createTextNode(`${toDatePct}% collected · `),
        owingEl,
        document.createTextNode(` owe ${formatCurrency(toDate.outstanding)}`)
      );
      // Overdue vs not-yet-due is the difference between a follow-up list and a
      // calendar. Only the overdue half is anybody's fault.
      if (Number(d.membersBehind) > 0) {
        const lateEl = document.createElement("strong");
        lateEl.textContent = `${formatCurrency(toDate.overdue)} overdue`;
        toDateNote.push(document.createTextNode(" · "), lateEl);
        toDateNote.push(
          document.createTextNode(` across ${d.membersBehind} member${Number(d.membersBehind) === 1 ? "" : "s"}.`)
        );
      } else {
        toDateNote.push(document.createTextNode(" · nothing is overdue yet."));
      }
    }

    const scopeLabel = monthsCounted === 0
      ? "Cycle to date — seed money"
      : `Cycle to date — seed money + ${monthsCounted} month${monthsCounted === 1 ? "" : "s"}`;

    const row = complianceRow(
      scopeLabel,
      formatCurrency(toDate.collected),
      formatCurrency(toDate.expected),
      toDatePct,
      toDateNote
    );
    row.classList.add("has-info");
    attachCardInfo(row, {
      label: "About cycle to date",
      content:
        "Everything the group's rules have actually asked for since the cycle began: seed money once per "
        + "member, plus one contribution per member for each month of the cycle that has started. Months "
        + "before the cycle started were never owed, and months that have not begun are not counted. "
        + "The member list below adds up to exactly the outstanding figure on this row.",
    });
    panel.appendChild(row);
  }

  // Exactly who, and which obligation they're missing. This list belongs to the
  // cycle-to-date row above and sums to its outstanding total.
  if (Array.isArray(d.behind) && d.behind.length) {
    const listHead = document.createElement("div");
    listHead.className = "compliance-list-head";
    listHead.textContent = toDate
      ? `Who owes what — ${formatCurrency(toDate.outstanding)} in total`
      : "Who owes what";
    panel.appendChild(listHead);

    const list = document.createElement("div");
    list.className = "acct-followups-list";
    d.behind.slice(0, 8).forEach((m) => {
      const row = document.createElement("div");
      row.className = "acct-followup-row";

      const who = document.createElement("span");
      who.className = "acct-followup-name";
      who.textContent = m.name;

      const what = document.createElement("span");
      what.className = "field-hint";
      what.style.margin = "0";
      what.textContent = Array.isArray(m.missing) ? m.missing.join(", ") : "";

      const amt = document.createElement("span");
      amt.className = "acct-followup-amt";
      amt.textContent = formatCurrency(m.owed);

      // A member who owes money that is not yet due is not "behind" — label the
      // two states differently so the treasurer knows who to actually chase.
      const state = document.createElement("span");
      state.className = "acct-followup-state" + (m.isOverdue ? " is-overdue" : " is-pending");
      state.textContent = m.isOverdue ? `${formatCurrency(m.overdue)} overdue` : "not due yet";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost btn-sm";
      btn.textContent = "Remind";
      btn.addEventListener("click", () => openSendRemindersModal());

      row.append(who, what, amt, state, btn);
      list.appendChild(row);
    });
    panel.appendChild(list);

    if (d.behind.length > 8) {
      const more = document.createElement("div");
      more.className = "acct-followup-more";
      more.textContent = `+${d.behind.length - 8} more owing`;
      panel.appendChild(more);
    }
  }

  host.appendChild(panel);
}

/**
 * Plain-language explanation of HOW a live penalty was arrived at, so the
 * figure is never an unexplained number. Handles both configured modes:
 * 'fixed' (a flat amount per day) and 'percentage' (a rate per day or month).
 * Falls back to the day-count alone when the server sends no type — older
 * responses, and the all-zero "nothing owed" shape.
 * @param {Object} penalty the payment.penalty object from the server
 * @return {string}
 */
function describePenaltyBasis(penalty) {
  const periods = Number(penalty.periodsCharged ?? penalty.daysCharged ?? 0);
  if (penalty.penaltyType === "percentage" && penalty.rate) {
    const unit = penalty.ratePeriod === "month" ? "month" : "day";
    return `${penalty.rate}% of arrears x ${periods} ${unit}${periods === 1 ? "" : "s"}`;
  }
  if (penalty.penaltyType === "fixed" || penalty.dailyAmount) {
    return `${periods} day${periods === 1 ? "" : "s"} at ${formatCurrency(penalty.dailyAmount)}/day`;
  }
  return `${periods} day${periods === 1 ? "" : "s"} late`;
}

// The payment categories a group collects, in the order a treasurer thinks
// about them: joining money first, then the recurring dues.
const PAYMENT_CATEGORIES = [
  {type: "seed_money", label: "Seed Money", cls: "seed", tab: "seed"},
  {type: "monthly_contribution", label: "Monthly Contributions", cls: "monthly", tab: "monthly"},
  {type: "service_fee", label: "Service Fee", cls: "servicefee", tab: "servicefee"},
];

/**
 * One card per payment category showing what's been collected in the selected
 * period, plus what's still owed and how many members are behind — so an admin
 * can see each category's health at a glance instead of reading the whole
 * table. Clicking a card jumps to that category's tab.
 *
 * Penalties shown here are the server's own live-computed figures
 * (payment.penalty.amountAccrued) — this adds no client-side penalty maths.
 * @param {string} period the selected reporting period
 */
function renderCategoryBreakdown(period) {
  const host = document.getElementById("acctCategories");
  const label = document.getElementById("acctCategoriesLabel");
  if (!host) return;
  host.textContent = "";

  const rows = PAYMENT_CATEGORIES.map((cat) => {
    let collected = 0;
    let outstanding = 0;
    let penalties = 0;
    const behind = new Set();
    let present = false;

    allPayments.forEach((p) => {
      if (String(p.paymentType) !== cat.type) return;
      present = true;
      if (
        SETTLED_STATUSES.includes(p.approvalStatus) &&
        inAcctPeriod(p.paidAt || p.createdAt, period)
      ) {
        collected += numberOf(p.amountPaid);
      }
      // Arrears/penalties are the CURRENT receivable — deliberately not
      // period-scoped, so "who is behind" is always today's truth.
      const owed = numberOf(p.arrears);
      if (owed > 0) {
        outstanding += owed;
        behind.add(p.uid);
      }
      if (p.penalty) penalties += numberOf(penaltyOwed(p.penalty));
    });

    return {cat, collected, outstanding, penalties, behind: behind.size, present};
  }).filter((r) => r.present);

  if (label) label.style.display = rows.length ? "" : "none";

  // The "Service Fee" tab ships hidden (style="display:none") and no code ever
  // revealed it — so a group that DOES collect service fees had no way to view
  // that category. Reveal it exactly when such payments exist, so the tab the
  // category card links to is actually reachable.
  const hasServiceFee = rows.some((r) => r.cat.type === "service_fee");
  const serviceFeeTab = document.querySelector('.payment-tab[data-tab="servicefee"]');
  if (serviceFeeTab && hasServiceFee) serviceFeeTab.style.display = "";

  if (!rows.length) return;

  rows.forEach((r) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "acct-category";
    card.setAttribute(
      "aria-label",
      `${r.cat.label}: ${formatCurrency(r.collected)} collected. Open ${r.cat.label} payments.`
    );

    const head = document.createElement("div");
    head.className = "acct-category-head";
    const dot = document.createElement("span");
    dot.className = `acct-category-dot ${r.cat.cls}`;
    const name = document.createElement("span");
    name.className = "acct-category-name";
    name.textContent = r.cat.label;
    head.append(dot, name);

    const amount = document.createElement("div");
    amount.className = "acct-category-amount";
    amount.textContent = formatCurrency(r.collected);

    const meta = document.createElement("div");
    meta.className = "acct-category-meta";

    const collectedNote = document.createElement("span");
    collectedNote.textContent = "collected";
    meta.appendChild(collectedNote);

    if (r.outstanding > 0) {
      const owed = document.createElement("span");
      owed.className = "acct-category-flag";
      owed.textContent = `${formatCurrency(r.outstanding)} owed`;
      meta.appendChild(owed);

      const who = document.createElement("span");
      who.className = "acct-category-flag";
      who.textContent = `${r.behind} behind`;
      meta.appendChild(who);
    } else {
      const ok = document.createElement("span");
      ok.className = "acct-category-ok";
      ok.textContent = "✓ all paid";
      meta.appendChild(ok);
    }

    if (r.penalties > 0) {
      const pen = document.createElement("span");
      pen.className = "acct-category-flag";
      pen.textContent = `${formatCurrency(r.penalties)} penalties`;
      meta.appendChild(pen);
    }

    card.append(head, amount, meta);
    card.addEventListener("click", () => {
      activateTab(r.cat.tab);
      document.getElementById("pendingPaymentsList")
        ?.scrollIntoView({behavior: "smooth", block: "start"});
    });
    host.appendChild(card);
  });
}

function renderAccountantSummary() {
  const section = document.getElementById("accountantSummary");
  if (!section) return;
  if (!allPayments.length && !members.length) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";

  const period = document.getElementById("acctPeriodFilter")?.value || "all";

  // Period totals — scoped to the selected reporting period by the real date.
  let collected = 0;
  let recorded = 0;
  let pending = 0;
  allPayments.forEach((p) => {
    if (!inAcctPeriod(p.paidAt || p.createdAt, period)) return;
    recorded += 1;
    if (SETTLED_STATUSES.includes(p.approvalStatus)) collected += numberOf(p.amountPaid);
    if (p.approvalStatus === "pending") pending += 1;
  });

  // Current arrears per member = the live receivable (not period-scoped): who
  // is behind right now, ranked most-behind first.
  const arrearsByMember = new Map();
  allPayments.forEach((p) => {
    const a = numberOf(p.arrears);
    if (a > 0) arrearsByMember.set(p.uid, (arrearsByMember.get(p.uid) || 0) + a);
  });
  const followups = Array.from(arrearsByMember.entries())
    .map(([uid, amt]) => ({ uid, amt, name: memberName(uid) }))
    .sort((a, b) => b.amt - a.amt);
  const totalArrears = followups.reduce((s, f) => s + f.amt, 0);

  // Status banner — use the server's compliance data (which includes seed money
  // and all obligations) rather than just the payments list (which only has rows
  // for payments that have been recorded). A group with no payment rows at all
  // is NOT "caught up" — it's empty, and seed money may still be owed.
  const banner = document.getElementById("acctStatusBanner");
  if (banner) {
    banner.textContent = "";
    const b = document.createElement("div");

    // The compliance endpoint returns membersOwing (anyone with an outstanding
    // balance, including seed money) and membersBehind (anyone LATE). Use
    // membersOwing for the "caught up" check — if anyone owes anything, the
    // group is not caught up, even if nothing is overdue yet.
    const membersOwing = Number(complianceData?.membersOwing ?? 0);
    const membersBehind = Number(complianceData?.membersBehind ?? 0);
    const complianceOutstanding = toMinorSafe(complianceData?.toDate?.outstanding ?? "0");

    if (membersOwing === 0 && followups.length === 0) {
      b.className = "acct-banner caught-up";
      b.textContent = "✓ All caught up — no outstanding arrears";
    } else if (membersBehind > 0 || followups.length > 0) {
      b.className = "acct-banner follow-up";
      const count = Math.max(membersBehind, followups.length);
      b.textContent =
        `⚠ ${count} member${count === 1 ? "" : "s"} to follow up · ` +
        `${formatCurrency(Math.max(complianceOutstanding / 100, totalArrears))} outstanding`;
    } else {
      // membersOwing > 0 but membersBehind === 0: people owe money but nothing
      // is overdue yet (e.g., seed money due next week).
      b.className = "acct-banner follow-up";
      b.textContent =
        `⚠ ${membersOwing} member${membersOwing === 1 ? "" : "s"} still owe money · ` +
        `${formatCurrency(complianceOutstanding / 100)} outstanding`;
    }
    banner.appendChild(b);
  }

  // Period totals tiles.
  const totals = document.getElementById("acctTotals");
  if (totals) {
    totals.textContent = "";
    const jump = (tab) => () => {
      activateTab(tab);
      document.getElementById("pendingPaymentsList")
        ?.scrollIntoView({behavior: "smooth", block: "start"});
    };

    totals.append(
      acctTotalTile("Collected", formatCurrency(collected), "pos", {
        onClick: jump("recent"),
        info: "Money actually received in the selected period — payments approved or completed. "
          + "Pending payments are not counted until an admin approves them.",
      }),
      acctTotalTile("Payments recorded", String(recorded), "", {
        onClick: jump("recent"),
        info: "How many payment entries were logged in the selected period, whatever their status.",
      }),
      acctTotalTile("Pending approval", String(pending), pending > 0 ? "warn" : "", {
        onClick: jump("pending"),
        info: "Payments members have submitted that still need an admin to approve or reject them.",
      }),
      acctTotalTile("Outstanding arrears", formatCurrency(totalArrears), totalArrears > 0 ? "neg" : "", {
        onClick: jump("arrears"),
        info: "Total still owed across the group right now. This is today's position, not the "
          + "selected period — it is what members currently owe.",
      }),
    );
  }

  renderCategoryBreakdown(period);

  // Follow-up list.
  const fu = document.getElementById("acctFollowups");
  if (fu) {
    fu.textContent = "";
    if (followups.length > 0) {
      const head = document.createElement("div");
      head.className = "acct-followups-head";
      const h = document.createElement("span");
      h.textContent = "Who to follow up on";
      const remindAll = document.createElement("button");
      remindAll.type = "button";
      remindAll.className = "btn btn-accent btn-sm";
      remindAll.textContent = "Send reminders";
      remindAll.addEventListener("click", () => openSendRemindersModal());
      head.append(h, remindAll);
      fu.appendChild(head);

      // Summary total — the figure every row below adds up to, so the
      // list is never a stack of unexplained numbers.
      const summary = document.createElement("div");
      summary.className = "acct-followups-summary";
      summary.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: var(--bn-space-4) var(--bn-space-5); background: var(--bn-gray-50); border-radius: var(--bn-radius-lg); margin-bottom: var(--bn-space-3); border: 1px solid var(--bn-gray-lighter);";
      const summaryLabel = document.createElement("span");
      summaryLabel.style.cssText = "font-weight: 700; color: var(--bn-dark); font-size: var(--bn-text-base);";
      summaryLabel.textContent = `${followups.length} member${followups.length === 1 ? "" : "s"} behind · total owed`;
      const summaryAmt = document.createElement("span");
      summaryAmt.style.cssText = "font-weight: 800; color: var(--bn-danger-dark); font-size: var(--bn-text-lg); font-variant-numeric: tabular-nums;";
      summaryAmt.textContent = formatCurrency(totalArrears);
      summary.append(summaryLabel, summaryAmt);
      fu.appendChild(summary);

      const list = document.createElement("div");
      list.className = "acct-followups-list";
      followups.slice(0, 8).forEach((f) => {
        const row = buildFollowupRow(f);
        list.appendChild(row);
      });
      fu.appendChild(list);

      if (followups.length > 8) {
        const more = document.createElement("div");
        more.className = "acct-followup-more";
        more.textContent = `+${followups.length - 8} more with arrears`;
        fu.appendChild(more);
      }
    }
  }
}

/**
 * Build a rich follow-up row for a member in arrears — shows what they owe
 * with an expandable dropdown showing each obligation separately.
 *
 * SEED MONEY IS THE ENTRY OBLIGATION. It is always listed first — before
 * any monthly contributions — because it must be paid before a member can
 * access loans or be considered in good standing. The dropdown makes this
 * ordering explicit so no one reads a seed-money figure as "just another
 * monthly contribution".
 *
 * @param {{uid:string, amt:number, name:string}} f
 * @return {HTMLElement}
 */
function buildFollowupRow(f) {
  const row = document.createElement("div");
  row.className = "acct-followup-row";

  // Gather obligations from allPayments, ordering seed money FIRST
  const obligations = [];
  const now = new Date();
  let hasOverdue = false;
  let totalPenalty = 0;

  for (const p of allPayments) {
    if (String(p.uid) !== String(f.uid)) continue;
    const a = numberOf(p.arrears);
    if (a <= 0) continue;
    const label = PAYMENT_TYPE_LABELS[p.paymentType] || p.paymentType;
    const penaltyMinor = p.penalty ? toMinorSafe(penaltyOwed(p.penalty)) : 0;
    const due = p.dueDate ? new Date(String(p.dueDate).replace(" ", "T")) : null;
    const isOverdue = (p.paymentType === "seed_money" && a > 0)
      || (due && !Number.isNaN(due.getTime()) && due < now);

    if (isOverdue) hasOverdue = true;
    totalPenalty += penaltyMinor;

    obligations.push({
      type: p.paymentType,
      label,
      month: p.month || null,
      arrears: a,
      penalty: penaltyMinor,
      isOverdue,
      totalAmount: numberOf(p.totalAmount || "0"),
      paid: numberOf(p.amountPaid || "0"),
    });
  }

  // Sort: seed_money first, then monthly by month order, then rest
  obligations.sort((a, b) => {
    if (a.type === "seed_money" && b.type !== "seed_money") return -1;
    if (b.type === "seed_money" && a.type !== "seed_money") return 1;
    return 0;
  });

  // Left: member name + summary
  const left = document.createElement("div");
  left.style.cssText = "flex: 1; min-width: 0;";

  const name = document.createElement("div");
  name.style.cssText = "font-weight: 600; color: var(--bn-dark); margin-bottom: 2px;";
  name.textContent = f.name;

  const summary = document.createElement("div");
  summary.style.cssText = "font-size: var(--bn-text-xs); color: var(--bn-gray); line-height: 1.5;";
  const seedCount = obligations.filter((o) => o.type === "seed_money").length;
  const monthlyCount = obligations.filter((o) => o.type === "monthly_contribution").length;
  const summaryParts = [];
  if (seedCount > 0) summaryParts.push(`${seedCount} seed obligation`);
  if (monthlyCount > 0) summaryParts.push(`${monthlyCount} month${monthlyCount === 1 ? "" : "s"}`);
  summaryParts.push("behind");
  if (totalPenalty > 0) summaryParts.push(`+ ${formatCurrencyFromMinor(totalPenalty)} penalty`);
  summary.textContent = summaryParts.join(" · ");
  left.append(name, summary);

  // Right: amount + state badge + dropdown toggle + remind
  const right = document.createElement("div");
  right.style.cssText = "display: flex; align-items: center; gap: var(--bn-space-3); flex-shrink: 0;";

  const amt = document.createElement("span");
  amt.className = "acct-followup-amt";
  amt.textContent = formatCurrency(f.amt);

  const state = document.createElement("span");
  state.className = "acct-followup-state" + (hasOverdue ? " is-overdue" : " is-pending");
  state.textContent = hasOverdue ? `${formatCurrency(f.amt)} overdue` : "not due yet";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "btn btn-ghost btn-sm";
  toggleBtn.textContent = "▾ Detail";
  toggleBtn.style.cssText = "font-size: var(--bn-text-xs);";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-ghost btn-sm";
  btn.textContent = "Remind";
  btn.addEventListener("click", () => openSendRemindersModal());

  right.append(amt, state, toggleBtn, btn);
  row.append(left, right);

  // ── Expandable detail dropdown ──────────────────────────────────────────
  const detail = document.createElement("div");
  detail.className = "acct-followup-detail";
  detail.hidden = true;
  detail.style.cssText = "padding: var(--bn-space-3) 0 0 var(--bn-space-6); margin-top: var(--bn-space-3); border-top: 1px solid var(--bn-gray-100); display: none;";

  toggleBtn.addEventListener("click", () => {
    const open = !detail.hidden;
    detail.hidden = open;
    detail.style.display = open ? "none" : "block";
    toggleBtn.textContent = open ? "▾ Detail" : "▴ Detail";
  });

  obligations.forEach((ob) => {
    const item = document.createElement("div");
    item.style.cssText = "display: flex; justify-content: space-between; align-items: center; gap: var(--bn-space-3); padding: var(--bn-space-1) 0; font-size: var(--bn-text-xs);";

    const label = document.createElement("span");
    label.style.cssText = "color: var(--bn-gray-700); font-weight: 500;";
    // Seed money label is distinguished from monthly labels
    if (ob.type === "seed_money") {
      label.style.cssText += "color: var(--bn-warning-dark);";
      label.textContent = "🌱 Seed Money (entry obligation)";
    } else {
      label.textContent = ob.month ? `${ob.month}` : ob.label;
    }
    if (ob.isOverdue) {
      label.style.cssText += "text-decoration: none;";
    }

    const values = document.createElement("span");
    values.style.cssText = "text-align: right; white-space: nowrap;";
    const amtSpan = document.createElement("span");
    amtSpan.style.cssText = `font-weight: 600; color: ${ob.isOverdue ? "var(--bn-danger-dark)" : "var(--bn-dark)"};`;
    amtSpan.textContent = formatCurrency(ob.arrears);
    values.appendChild(amtSpan);

    if (ob.penalty > 0) {
      const pen = document.createElement("span");
      pen.style.cssText = "color: var(--bn-danger); margin-left: var(--bn-space-2);";
      pen.textContent = `+ ${formatCurrencyFromMinor(ob.penalty)} penalty`;
      values.appendChild(pen);
    }

    // Show progress: paid / total
    const progress = document.createElement("span");
    progress.style.cssText = "display: block; color: var(--bn-gray-500); font-size: 0.7rem;";
    progress.textContent = `${formatCurrency(ob.paid)} of ${formatCurrency(ob.totalAmount)} paid`;
    values.appendChild(progress);

    item.append(label, values);
    detail.appendChild(item);
  });

  row.appendChild(detail);
  return row;
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

/**
 * The empty state for a tab, as a full-width table row. Each tab gets wording
 * and an action that actually fit its situation — an empty "arrears" tab is
 * GOOD news and should say so, while an empty "pending" tab means there is
 * simply nothing awaiting approval. Previously every tab showed the same
 * dead-end "No <tab> payments found".
 * @param {string} tab
 * @return {HTMLElement}
 */
function emptyStateRow(tab) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 5;
  td.style.padding = "0";

  const record = {
    label: "Record a payment",
    variant: "accent",
    onClick: () => openRecordPaymentModal(),
  };

  const byTab = {
    pending: {
      icon: "✅",
      title: "Nothing awaiting approval",
      description: "Every submitted payment has been reviewed.",
      good: true,
      actions: [record],
    },
    arrears: {
      icon: "✅",
      title: "No one is in arrears",
      description: "Every member is up to date on what they owe.",
      good: true,
      actions: [],
    },
    seed: {
      icon: "🌱",
      title: "No seed money recorded yet",
      description: "Seed money is the joining contribution each member pays once.",
      actions: [record],
    },
    monthly: {
      icon: "📅",
      title: "No monthly contributions yet",
      description: "Monthly contributions will appear here as members pay them.",
      actions: [record],
    },
    servicefee: {
      icon: "🧾",
      title: "No service fees recorded",
      description: "Service fees appear here once the group starts collecting them.",
      actions: [record],
    },
    recent: {
      icon: "📄",
      title: "No payment activity yet",
      description: "Recorded payments will show here, newest first.",
      actions: [record],
    },
  };

  td.appendChild(emptyState(byTab[tab] || byTab.recent));
  tr.appendChild(td);
  return tr;
}

function renderCurrentTab() {
  const container = pendingPaymentsList();
  if (!container) return;

  const filtered = filteredPayments();
  container.textContent = "";

  if (filtered.length === 0) {
    container.appendChild(emptyStateRow(currentTab));
    return;
  }

  filtered.forEach((payment) => container.appendChild(createPaymentRow(payment)));
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

/**
 * Renders one payment as a <tr> for the .table.table-responsive component
 * (pure-CSS desktop table / mobile card collapse — see design-system.css).
 * Carries every field createPaymentCard() used to show: member, type+month,
 * amount paid/of total, arrears, status badge, approve/reject actions, and
 * the conditional extras (live penalty, notes, rejection reason, proof link)
 * which don't map to a fixed column — those are folded into one optional
 * "Details" cell that stays empty (and hides itself, per the existing
 * `td[data-label=""]` / `td:empty` mobile rule) when none apply.
 */
function createPaymentRow(payment, showActions = true) {
  const row = el("tr");

  const memberCell = el("td");
  memberCell.dataset.label = "Member";
  memberCell.textContent = memberName(payment.uid);
  row.appendChild(memberCell);

  const typeCell = el("td");
  typeCell.dataset.label = "Type";
  const typeLabel = PAYMENT_TYPE_LABELS[payment.paymentType] || payment.paymentType || "Payment";
  const monthSuffix = payment.month ? ` — ${payment.month}` : "";
  typeCell.textContent = `${typeLabel}${monthSuffix}`;
  row.appendChild(typeCell);

  const amountCell = el("td", "cell-right");
  amountCell.dataset.label = "Amount";
  amountCell.textContent = `${formatCurrency(payment.amountPaid)} of ${formatCurrency(payment.totalAmount)} · ${formatDate(payment.paidAt || payment.createdAt)}`;
  row.appendChild(amountCell);

  const arrears = numberOf(payment.arrears);
  const arrearsCell = el("td", arrears > 0 ? "cell-right cell-danger" : "cell-right");
  arrearsCell.dataset.label = "Arrears";
  arrearsCell.textContent = formatCurrency(payment.arrears);
  row.appendChild(arrearsCell);

  const statusCell = el("td");
  statusCell.dataset.label = "Status";
  const statusClass = payment.approvalStatus === "completed" || payment.approvalStatus === "approved"
    ? "success"
    : payment.approvalStatus === "rejected"
      ? "danger"
      : "warning";
  const statusBadge = el("span", `badge badge-${statusClass}`);
  statusBadge.textContent = payment.approvalStatus;
  statusCell.appendChild(statusBadge);
  row.appendChild(statusCell);

  const detailsCell = el("td");
  const penalty = payment.penalty;
  if (penalty && numberOf(penaltyOwed(penalty)) > 0) {
    const penaltyNote = el("div");
    penaltyNote.style.cssText = "font-size: var(--bn-text-sm); color: var(--bn-danger);";
    penaltyNote.textContent =
      `Live penalty: ${formatCurrency(penaltyOwed(penalty))} (${describePenaltyBasis(penalty)})`;
    detailsCell.appendChild(penaltyNote);
  }
  if (payment.notes) {
    const notes = el("div");
    notes.style.cssText = "font-size: var(--bn-text-sm); color: var(--bn-gray);";
    notes.textContent = `Notes: ${payment.notes}`;
    detailsCell.appendChild(notes);
  }
  if (payment.approvalStatus === "rejected" && payment.rejectionReason) {
    const reason = el("div");
    reason.style.cssText = "font-size: var(--bn-text-sm); color: var(--bn-danger);";
    reason.textContent = `Rejected: ${payment.rejectionReason}`;
    detailsCell.appendChild(reason);
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
  // Empty when none of the above apply — data-label="" matches the existing
  // "hide empty cells on mobile" rule (design-system.css ~922-925) and an
  // empty <td> is simply blank on desktop.
  detailsCell.dataset.label = detailsCell.childNodes.length ? "Details" : "";
  row.appendChild(detailsCell);

  const actionsCell = el("td");
  actionsCell.dataset.label = "Actions";
  if (showActions && payment.approvalStatus === "pending") {
    const actions = el("div", "loan-actions");
    const approveBtn = el("button", "btn btn-accent btn-sm");
    approveBtn.textContent = "Approve";
    approveBtn.addEventListener("click", () => approvePayment(payment.paymentId));
    const rejectBtn = el("button", "btn btn-danger btn-sm");
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => rejectPayment(payment));
    actions.append(approveBtn, rejectBtn);
    actionsCell.appendChild(actions);
  } else {
    actionsCell.dataset.label = "";
  }
  row.appendChild(actionsCell);

  return row;
}

function emptyTableRow(text) {
  const row = el("tr");
  const cell = el("td");
  cell.colSpan = 7;
  cell.dataset.label = "";
  cell.style.cssText = "text-align: center; padding: var(--bn-space-4); color: var(--bn-gray);";
  cell.textContent = text;
  row.appendChild(cell);
  return row;
}

// ── Approve / reject ─────────────────────────────────────────────────────────
async function approvePayment(paymentId) {
  showSpinner(true);
  try {
    const result = await apiPost("payments.approve", {paymentId});
    // A claim recorded with "Apply Interest/Penalty" settles its penalty at
    // approval — say how much was banked rather than leaving the admin to check.
    const settled = toMinorSafe(result?.penaltySettled);
    showToast(
      settled > 0
        ? `Payment approved — ${formatCurrencyFromMinor(settled)} penalty settled`
        : "Payment approved",
      "success"
    );
    recordModalObligations = null;
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

/**
 * Render the preset amount buttons for one obligation row. Values are read
 * straight off the server row — nothing is computed here.
 * @param {?Object} row an obligation row (seedMoney / a month / serviceFee)
 */
function renderObligationQuickAmounts(row) {
  const container = document.getElementById("paymentQuickAmounts");
  const input = document.getElementById("paymentAmount");
  if (!container || !input) return;

  const options = [];
  if (row && row.arrears !== undefined && Number(row.arrears) > 0) {
    options.push({
      key: "outstanding",
      label: "Amount still owed",
      description: "What remains unpaid on this obligation.",
      amount: row.arrears,
    });
  }
  if (row && row.totalAmount !== undefined && Number(row.totalAmount) > 0) {
    options.push({
      key: "full",
      label: "Full amount",
      description: "The whole amount for this obligation, ignoring anything already paid.",
      amount: row.totalAmount,
    });
  }
  renderQuickAmounts(container, options, input, "Another amount");
}

/**
 * The obligations payload for the member currently selected in the record modal,
 * plus whose uid it belongs to. One fetch per member instead of one per keystroke
 * — the month list, the owed panel and the penalty breakdown all read from it, so
 * they can never show three different versions of the same member's position.
 * @type {{uid: string, data: Object}|null}
 */
let recordModalObligations = null;

/** The obligation row (seed / a month / service fee) the modal is currently on. */
function selectedObligationRow() {
  const ob = recordModalObligations?.data;
  if (!ob) return null;
  const type = document.getElementById("paymentType")?.value;
  if (type === "seed_money") return ob.seedMoney ?? null;
  if (type === "service_fee") return ob.serviceFee ?? null;
  if (type === "monthly_contribution") {
    const month = document.getElementById("paymentMonth")?.value;
    if (!month) return null;
    const months = ob.monthlyContributions?.months;
    return Array.isArray(months)
      ? months.find((m) => String(m.month) === String(month)) ?? null
      : null;
  }
  return null;
}

/** Outstanding penalty on a row, as a bare decimal string ("0.00" when none). */
function rowPenaltyOutstanding(row) {
  return row?.penalty?.amountOutstanding ?? "0.00";
}

/** True when this obligation has nothing left to pay. */
function rowFullyPaid(row) {
  return !!row && toMinorSafe(row.arrears) <= 0 && toMinorSafe(row.totalAmount) > 0;
}

/**
 * Fetch (and cache) the selected member's obligations for the record modal.
 * @param {boolean} force refetch even if the cache is for this same member
 */
async function loadRecordModalObligations(force = false) {
  const uid = document.getElementById("memberSelect")?.value;
  if (!selectedGroupId || !uid) {
    recordModalObligations = null;
    return null;
  }
  if (!force && recordModalObligations && recordModalObligations.uid === uid) {
    return recordModalObligations.data;
  }
  const data = await apiGet("payments.obligations", {groupId: selectedGroupId, uid});
  recordModalObligations = {uid, data};
  return data;
}

/**
 * Fill the month dropdown from the member's real position — the control was
 * never populated at all, so choosing "Monthly Contribution" produced an empty
 * required select and the form could not be submitted.
 *
 * Each month is labelled with its actual state, and a month that is already
 * settled in full is DISABLED: the server refuses the overpayment anyway (409),
 * but letting an admin pick it, type an amount and only then be refused is a
 * trap. Months are never hidden — an admin needs to see that March is paid.
 */
function populateMonthSelect() {
  const select = document.getElementById("paymentMonth");
  if (!select) return;

  const previous = select.value;
  select.textContent = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select month...";
  select.appendChild(placeholder);

  const ob = recordModalObligations?.data;
  const months = ob?.monthlyContributions?.months;

  if (!Array.isArray(months) || !months.length) {
    placeholder.textContent = ob
      ? "No monthly contribution is configured for this group"
      : "Select a member first";
    return;
  }

  months.forEach((m) => {
    const option = document.createElement("option");
    option.value = m.month;

    const paid = rowFullyPaid(m);
    const outstanding = formatCurrency(m.arrears ?? "0");
    const penalty = toMinorSafe(rowPenaltyOutstanding(m));

    if (paid) {
      option.textContent = `${m.month} — paid in full`;
      option.disabled = true;
    } else if (m.approvalStatus === "pending") {
      // record_payment refuses a second claim while one is un-adjudicated.
      option.textContent = `${m.month} — awaiting approval`;
      option.disabled = true;
    } else if (m.counts === false) {
      // Outside the group's cycle, or a month that has not begun: payable in
      // advance, but nothing is owed for it yet.
      option.textContent = `${m.month} — not yet due (advance)`;
    } else {
      option.textContent = `${m.month} — ${outstanding} outstanding`
        + (penalty > 0 ? ` + ${formatCurrency(rowPenaltyOutstanding(m))} penalty` : "");
    }

    select.appendChild(option);
  });

  // Keep the admin's choice across a refresh if it is still selectable;
  // otherwise land on the first month that can actually be paid.
  const stillValid = Array.from(select.options).some(
    (o) => o.value === previous && !o.disabled
  );
  if (previous && stillValid) {
    select.value = previous;
  } else {
    const firstPayable = Array.from(select.options).find((o) => o.value && !o.disabled);
    select.value = firstPayable ? firstPayable.value : "";
  }
}

/**
 * The "Apply Interest/Penalty" breakdown.
 *
 * WHAT IT MEANS: this obligation is late, so the group's rules have charged a
 * penalty on top of the contribution. Ticking the box means the cash being
 * recorded also settles that penalty — the payment carries both, and on approval
 * a penalty_settlements row is written so the member stops being charged for
 * days they have now paid for. Leaving it unticked records the contribution only
 * and the penalty keeps accruing.
 *
 * Every figure is the SERVER's (payment.penalty.amountOutstanding); the only
 * arithmetic here is adding two already-computed totals for display.
 */
function updatePenaltyBreakdown() {
  const checkbox = document.getElementById("applyInterestCheckbox");
  const details = document.getElementById("interestDetails");
  const wrapper = checkbox?.closest(".form-group");
  if (!checkbox || !details) return;

  const row = selectedObligationRow();
  const penaltyMinor = toMinorSafe(rowPenaltyOutstanding(row));

  // Nothing late = nothing to apply. Hiding the control beats offering an
  // action that would be refused.
  if (penaltyMinor <= 0) {
    checkbox.checked = false;
    checkbox.disabled = true;
    details.style.display = "none";
    if (wrapper) wrapper.style.display = "none";
    return;
  }

  checkbox.disabled = false;
  if (wrapper) wrapper.style.display = "";

  if (!checkbox.checked) {
    details.style.display = "none";
    return;
  }

  details.style.display = "block";

  const baseMinor = toMinorSafe(document.getElementById("paymentAmount")?.value);
  const basisEl = details.querySelector("div");
  if (basisEl && row?.penalty) {
    basisEl.textContent =
      `Late-payment penalty charged by this group's rules: ${describePenaltyBasis(row.penalty)}. `
      + "Ticking this box collects it with this payment and records it as settled once approved.";
  }

  const baseEl = document.getElementById("interestBaseAmount");
  const penaltyEl = document.getElementById("interestAmount");
  const totalEl = document.getElementById("interestTotalAmount");
  if (baseEl) baseEl.textContent = formatCurrencyFromMinor(baseMinor);
  if (penaltyEl) penaltyEl.textContent = formatCurrencyFromMinor(penaltyMinor);
  if (totalEl) totalEl.textContent = formatCurrencyFromMinor(baseMinor + penaltyMinor);
}

/**
 * Everything that must re-derive when the member / type / month changes: the
 * month list, the owed panel and the penalty breakdown, all off ONE fetch.
 */
async function refreshRecordModal({reloadMonths = true} = {}) {
  try {
    await loadRecordModalObligations();
  } catch (error) {
    recordModalObligations = null;
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
  }
  if (reloadMonths) populateMonthSelect();
  await updatePaymentOwedInfo();
  updatePenaltyBreakdown();
}

function openRecordPaymentModal(preSelectMemberId = null) {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }

  document.getElementById("recordPaymentForm")?.reset();
  recordModalObligations = null;

  const memberSelect = document.getElementById("memberSelect");
  if (memberSelect && preSelectMemberId) memberSelect.value = preSelectMemberId;

  const monthGroup = document.getElementById("monthSelectGroup");
  if (monthGroup) {
    monthGroup.style.display =
      document.getElementById("paymentType")?.value === "monthly_contribution" ? "block" : "none";
  }

  const paymentDate = document.getElementById("paymentDate");
  if (paymentDate) paymentDate.value = new Date().toISOString().split("T")[0];

  updatePenaltyBreakdown();
  refreshRecordModal();

  showModal("recordPaymentModal");
}

/**
 * Read-only "what does this member owe" panel for the admin record-payment
 * modal. Renders into #paymentOwedInfo — never touches #paymentAmount. The
 * admin still types the amount themselves (partial/advance payments are
 * legitimate); this is context only, never an auto-fill.
 *
 * payments.obligations accepts an admin-supplied `uid` (the server enforces
 * that only an admin/treasurer may ask for someone else, and that the uid is
 * a real member of the group), so every figure here is computed SERVER-side,
 * penalties included — the client never derives a financial figure.
 */
async function updatePaymentOwedInfo() {
  const container = document.getElementById("paymentOwedInfo");
  if (!container) return;

  container.textContent = "";

  const targetUid = document.getElementById("memberSelect")?.value;
  const paymentType = document.getElementById("paymentType")?.value;
  const month = document.getElementById("paymentMonth")?.value;

  if (!selectedGroupId || !targetUid) {
    const hint = el("small", "text-muted");
    hint.textContent = "Select a member to see what they owe.";
    container.appendChild(hint);
    return;
  }

  const loading = el("small", "text-muted");
  loading.textContent = "Checking what this member owes…";
  container.appendChild(loading);

  let obligations;
  try {
    // Shared with the month list and the penalty breakdown — one fetch per
    // member, so the three cannot disagree about the same position.
    obligations = await loadRecordModalObligations();
  } catch (error) {
    container.textContent = "";
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    const note = el("small", "text-muted");
    note.textContent = "Could not load this member's outstanding balance.";
    container.appendChild(note);
    return;
  }

  container.textContent = "";

  if (!obligations || typeof obligations !== "object") {
    const note = el("small", "text-muted");
    note.textContent = "Could not load this member's outstanding balance.";
    container.appendChild(note);
    return;
  }

  // Resolve the obligation row for the selected payment type (+ month).
  let row = null;
  let notConfiguredLabel = "";
  if (paymentType === "seed_money") {
    row = obligations.seedMoney ?? null;
    notConfiguredLabel = "seed money";
  } else if (paymentType === "service_fee") {
    row = obligations.serviceFee ?? null;
    notConfiguredLabel = "service fee";
  } else if (paymentType === "monthly_contribution") {
    notConfiguredLabel = "monthly contribution";
    if (!month) {
      const note = el("small", "text-muted");
      note.textContent = "Select a month to see what this member owes.";
      container.appendChild(note);
      appendTotalsLine(container, obligations);
      return;
    }
    const months = obligations.monthlyContributions?.months;
    row = Array.isArray(months)
      ? months.find((m) => String(m.month) === String(month)) ?? null
      : null;
  }

  const monthlyNotConfigured =
    paymentType === "monthly_contribution" &&
    obligations.monthlyContributions?.configured === false;

  if (!row || row.configured === false || monthlyNotConfigured) {
    const note = el("p", "text-muted");
    note.textContent = `No ${notConfiguredLabel} due.`;
    container.appendChild(note);
    appendTotalsLine(container, obligations);
    return;
  }

  // Preset amounts for exactly this obligation, from the SAME server row the
  // lines below display. One payment record is one type and one month, so the
  // only honest presets are this row's two figures — see the member-side note in
  // user_dashboard_sql.js for why there is no "pay everything" button.
  renderObligationQuickAmounts(row);

  const dueLine = el("p");
  dueLine.textContent = `Amount due: ${formatCurrency(row.totalAmount ?? "0")}`;
  const paidLine = el("p");
  paidLine.textContent = `Already paid: ${formatCurrency(row.amountPaid ?? "0")}`;
  const outstandingLine = el("p", "text-emphasis");
  outstandingLine.textContent = `Outstanding: ${formatCurrency(row.arrears ?? "0")}`;

  container.append(dueLine, paidLine, outstandingLine);

  // Say plainly when there is nothing left to collect, instead of letting the
  // admin fill the form and be refused by the server.
  if (rowFullyPaid(row)) {
    const done = el("p", "text-emphasis");
    done.textContent = "✓ This obligation is already paid in full — no further payment is due.";
    container.appendChild(done);
  }

  // The late-payment penalty on THIS obligation, server-computed.
  const penaltyMinor = toMinorSafe(rowPenaltyOutstanding(row));
  if (penaltyMinor > 0) {
    const penaltyLine = el("p");
    penaltyLine.textContent =
      `Penalty outstanding: ${formatCurrencyFromMinor(penaltyMinor)} (${describePenaltyBasis(row.penalty)})`;
    container.appendChild(penaltyLine);
  }

  appendTotalsLine(container, obligations);
}

/**
 * Appends the muted "total outstanding (arrears + penalties)" line, summing
 * the two already server-computed summary totals in minor units (no
 * per-item money is re-derived here — only two already-summed totals added).
 */
function appendTotalsLine(container, obligations) {
  const arrearsMinor = toMinorSafe(obligations.summary?.arrears);
  const penaltyMinor = toMinorSafe(obligations.summary?.penaltyAccrued);
  const totalLine = el("small", "text-muted");
  totalLine.textContent =
    `Total outstanding (arrears + penalties): ${formatCurrencyFromMinor(arrearsMinor + penaltyMinor)}`;
  container.appendChild(totalLine);
}

// Bare decimal string -> integer minor units (cents), matching the server's
// money_to_minor convention. Used only to sum two already-server-computed
// totals — never to derive a new financial figure.
function toMinorSafe(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
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

  // Refuse locally what the server would refuse anyway (409/422), so the admin
  // gets a plain sentence instead of an error toast after filling the form.
  const row = selectedObligationRow();
  if (rowFullyPaid(row)) {
    showToast("That obligation is already paid in full — nothing further is due.", "error");
    return;
  }
  const outstandingMinor = toMinorSafe(row?.arrears);
  if (row && outstandingMinor > 0 && toMinorSafe(amountRaw) > outstandingMinor) {
    showToast(
      `That is more than is outstanding (${formatCurrencyFromMinor(outstandingMinor)}). `
      + "Overpayments are not held as credit.",
      "error"
    );
    return;
  }

  // The penalty portion. The checkbox collects the FULL outstanding penalty on
  // this obligation; the server re-derives and validates the figure, so this is
  // a request, never an authority.
  const collectPenalty = !!document.getElementById("applyInterestCheckbox")?.checked;
  const penaltyOutstanding = rowPenaltyOutstanding(row);
  const penaltyAmount = collectPenalty && toMinorSafe(penaltyOutstanding) > 0
    ? penaltyOutstanding
    : undefined;

  showSpinner(true);
  try {
    let proof = null;
    if (proofFile) {
      proof = await uploadProof(proofFile, selectedGroupId);
    }

    await apiPost("payments.record", {
      groupId: selectedGroupId,
      targetUid,
      paymentType,
      month: paymentType === "monthly_contribution" ? month : undefined,
      amount,
      penaltyAmount,
      paymentMethod: method,
      notes: notes || undefined,
      proofOfPaymentImageUrl: proof?.url,
      proofOfPaymentFileName: proof?.fileName ?? undefined,
      proofOfPaymentFileSize: proof?.fileSize ?? undefined,
      isAdvancedPayment: paymentType === "monthly_contribution" ? !!isAdvanced : undefined,
    });

    hideModal("recordPaymentModal");
    showToast(
      penaltyAmount
        ? `Payment recorded with ${formatCurrency(penaltyAmount)} penalty — awaiting approval`
        : "Payment recorded — awaiting approval",
      "success"
    );
    // The member's position has moved, so the cached obligations are stale.
    recordModalObligations = null;
    await loadGroupData();
  } catch (error) {
    handleApiError(error, "Failed to record payment");
  } finally {
    showSpinner(false);
  }
}

/**
 * POST the file to files.upload (multipart) and return {url, fileName, fileSize}.
 * Same contract as loan_payments_sql.js's uploadProof().
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
  // files.upload replies with the standard {ok, data:{url, fileName, fileSize}}
  // envelope — the url is at body.data.url. Reading a flat body.url made EVERY
  // proof upload on this page fail with "Upload did not return a file URL."
  // even though the file had uploaded fine. Flat fallback kept for safety.
  const payload = (body && body.data) || body || {};
  if (!payload.url) {
    throw new ApiError("Upload did not return a file URL.", response.status, body);
  }
  return {
    url: payload.url,
    fileName: payload.fileName || null,
    fileSize: payload.fileSize ?? null,
  };
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
    container.appendChild(emptyState({ icon: "📋", title: "No payments found" }));
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
  const COL_LABELS = ["Member", "Type", "Month", "Total Due", "Paid", "Arrears", "Status", "Date"];
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
    cells.forEach((value, i) => {
      const td = document.createElement("td");
      td.textContent = value;
      td.dataset.label = COL_LABELS[i] || "";
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

// ── Page-stat info toggles ──────────────────────────────────────────────────
/**
 * Attach a standardized "i" info toggle to a `.page-stat` card identified by
 * the id of its value element (e.g. "pendingCount").
 */
function attachPageStatInfo(valueElId, title, description, rows) {
  const valueEl = document.getElementById(valueElId);
  const card = valueEl?.closest(".page-stat");
  if (!card) return;
  pageStatInfo(card, { title, description, rows });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
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

/**
 * The penalty a member still OWES — net of anything already paid or waived.
 *
 * Use this anywhere the figure means "owed". amountAccrued is the GROSS charge
 * and ignores waivers, so showing it as owed would keep billing a member for a
 * penalty an admin already wrote off.
 * @param {Object} penalty payment.penalty from the server
 * @return {string} money string
 */
function penaltyOwed(penalty) {
  if (!penalty) return "0.00";
  return penalty.amountOutstanding != null
    ? penalty.amountOutstanding
    : penalty.amountAccrued;
}
