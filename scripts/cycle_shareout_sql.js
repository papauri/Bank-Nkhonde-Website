/**
 * cycle_shareout_sql.js — end-of-cycle share-out page: preview every
 * member's payout, show the pool summary and an explicit reconciliation
 * line, render an already-settled cycle as a record, and let a senior admin
 * settle behind a two-step in-page confirm gate.
 *
 * HARD RULE: NO CLIENT-SIDE MONEY ARITHMETIC OF ANY KIND. Every money figure
 * on this page is a server-returned decimal string passed straight to
 * formatCurrency(). The reconciliation line is never computed here — it
 * renders `summary.balances`, which the server already decided.
 *
 * ENDPOINT CONTRACT (per BUILD_PLAN.md dispatch brief; cycle.payouts.list is
 * being built in parallel by a backend brief and was NOT probed live):
 *   cycle.payout.preview  -> GET, {groupId} ->
 *       {groupId, members:[{uid, fullName, totalContributed, totalBorrowed,
 *         totalInterestPaid, totalPenaltiesPaid, interestRefund,
 *         penaltyShare, payoutAmount}],
 *        summary:{memberCount, groupInterestPool, groupPenaltyPool,
 *         shareOutPenalties, distributedPenalties, totalPayout, balances}}
 *   cycle.payouts.list    -> GET, {groupId} ->
 *       {groupId, settled, cycleStartDate, cycleEndDate, settledAt,
 *        settledBy, summary:{memberCount, groupInterestPool,
 *         groupPenaltyPool, distributedPenalties, totalPayout, balances},
 *        payouts:[{payoutId, uid, fullName, totalContributed, totalBorrowed,
 *         totalInterestPaid, totalPenaltiesPaid, interestRefund,
 *         penaltyShare, payoutAmount, status, settledAt}]}.
 *       `settled:false` with an empty payouts[] is a normal 200, not an
 *       error. Note the settled summary has NO `shareOutPenalties` field —
 *       that key only appears in the preview summary.
 *   cycle.settle          -> POST, {groupId, confirm: true} (confirm MUST be
 *       the boolean literal true). Success is 201. SENIOR ADMIN ONLY,
 *       enforced server-side by require_role($groupId, ['senior_admin']) —
 *       this file only hides the control for other roles as UX.
 *
 * LOAD ORDER: cycle.payouts.list is called FIRST. If settled === true, the
 * settled record renders from its rows and cycle.payout.preview is never
 * called. If settled === false, cycle.payout.preview is called and the
 * preview renders instead.
 *
 * DEFERRED (never invented): there is no "unsettle"/"cancel settlement"
 * endpoint — settling is irreversible in this UI, matching the brief.
 */

import {apiGet, apiPost, requireSession, listMyGroups, ApiError, redirectToLogin} from "./api.js";
import {formatCurrency} from "./utils_financial.js";

const SHAREOUT_ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];

/** Server-supplied refusal messages for cycle.settle, matched verbatim. */
const SETTLE_MESSAGES = {
  CONFIRM: "confirm must be true to settle a cycle.",
  NO_CYCLE: "This group has no cycle configured; a cycle cannot be settled.",
  ALREADY_SETTLED: "This cycle has already been settled.",
  NO_MEMBERS: "This group has no active members to settle.",
  NOT_BALANCED: "The share-out does not balance; the cycle cannot be settled.",
};

let currentUser = null;
let currentGroupId = null;
let currentUserRole = null;
/** Groups the caller administers, from groups.mine — used to resolve role on group switch. */
let adminGroups = [];
/** The summary object currently backing the settle confirm panel (preview mode only). */
let pendingSettleSummary = null;
// Heading for the interest column — depends on the group's sharing method.
let interestColumnLabel = "Interest Share";

const groupSelector = () => document.getElementById("groupSelector");
const spinner = () => document.getElementById("spinner");
const shareoutMessage = () => document.getElementById("shareoutMessage");
const shareoutMessageText = () => document.getElementById("shareoutMessageText");
const shareoutContent = () => document.getElementById("shareoutContent");
const stateBannerEl = () => document.getElementById("stateBanner");
const payoutTableBodyEl = () => document.getElementById("payoutTableBody");
const poolSummaryGridEl = () => document.getElementById("poolSummaryGrid");
const reconciliationBannerEl = () => document.getElementById("reconciliationBanner");
const settleSectionEl = () => document.getElementById("settleSection");
const settleBtnEl = () => document.getElementById("settleBtn");
const confirmPanelEl = () => document.getElementById("confirmPanel");
const confirmSummaryTextEl = () => document.getElementById("confirmSummaryText");
const confirmCheckboxEl = () => document.getElementById("confirmCheckbox");
const confirmSettleBtnEl = () => document.getElementById("confirmSettleBtn");
const cancelConfirmBtnEl = () => document.getElementById("cancelConfirmBtn");

/**
 * Router-compatible entry point.
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
  groupSelector()?.addEventListener("change", async (e) => {
    currentGroupId = e.target.value;
    const match = adminGroups.find((g) => (g.groupId || g.id) === currentGroupId);
    currentUserRole = match ? match.myRole : null;
    if (currentGroupId) {
      sessionStorage.setItem("selectedGroupId", currentGroupId);
      await loadShareoutData();
    } else {
      showLoadMessage("Select a group to view the cycle share-out.");
    }
  });

  settleBtnEl()?.addEventListener("click", () => {
    if (settleBtnEl()?.disabled) return;
    showConfirmPanel();
  });

  cancelConfirmBtnEl()?.addEventListener("click", () => {
    hideConfirmPanel();
  });

  confirmCheckboxEl()?.addEventListener("change", (e) => {
    const btn = confirmSettleBtnEl();
    if (btn) btn.disabled = !e.target.checked;
  });

  confirmSettleBtnEl()?.addEventListener("click", () => {
    handleConfirmSettle();
  });
}

async function loadAdminGroups() {
  showSpinner(true);
  try {
    const groups = await listMyGroups();
    adminGroups = groups.filter((g) => SHAREOUT_ADMIN_ROLES.includes(g.myRole));

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
      showLoadMessage("You are not an admin of any groups.");
      return;
    }

    const stored = sessionStorage.getItem("selectedGroupId") || localStorage.getItem("selectedGroupId");
    const match = adminGroups.find((g) => (g.groupId || g.id) === stored);
    const chosen = match || adminGroups[0];
    currentGroupId = chosen.groupId || chosen.id;
    currentUserRole = chosen.myRole;
    if (selector) selector.value = currentGroupId;
    sessionStorage.setItem("selectedGroupId", currentGroupId);

    await loadShareoutData();
  } catch (error) {
    handleApiError(error, "Failed to load groups");
    showLoadMessage("Could not load your groups. Please try again.");
  } finally {
    showSpinner(false);
  }
}

/**
 * Load order per the brief: cycle.payouts.list FIRST. settled:true renders
 * the settled record from its own rows (preview never called); settled:false
 * falls through to cycle.payout.preview.
 */
async function loadShareoutData() {
  if (!currentGroupId) {
    showLoadMessage("Select a group to view the cycle share-out.");
    return;
  }
  showSpinner(true);
  try {
    let listData;
    try {
      listData = await apiGet("cycle.payouts.list", {groupId: currentGroupId});
    } catch (error) {
      handleApiError(error, "Failed to load the cycle share-out record");
      showLoadMessage("Could not load the cycle share-out. Please try again.");
      return;
    }

    if (listData && listData.settled === true) {
      renderPage("settled", listData);
      return;
    }

    try {
      const previewData = await apiGet("cycle.payout.preview", {groupId: currentGroupId});
      renderPage("preview", previewData);
    } catch (error) {
      handleApiError(error, "Failed to load the share-out preview");
      showLoadMessage("Could not load the share-out preview for this cycle.");
    }
  } finally {
    showSpinner(false);
  }
}

/**
 * Render the whole page for a given mode. `data` is either the
 * cycle.payout.preview response (mode "preview") or the cycle.payouts.list
 * response (mode "settled") — both carry a `summary` object and a row list
 * (`members` for preview, `payouts` for settled) whose per-member fields
 * share the same names, so the table renderer is shared.
 * @param {"preview"|"settled"} mode
 * @param {Object} data
 */
function renderPage(mode, data) {
  const summary = data && data.summary && typeof data.summary === "object" ? data.summary : {};
  const rows = mode === "settled"
    ? (Array.isArray(data && data.payouts) ? data.payouts : [])
    : (Array.isArray(data && data.members) ? data.members : []);

  hideLoadMessage();
  const content = shareoutContent();
  if (content) content.hidden = false;

  renderStateBanner(mode, data);
  renderInterestHeading(mode, summary);
  renderMemberTable(rows);
  renderPoolSummary(summary, mode);
  renderReconciliation(summary);
  renderSettleSection(mode, summary);
}

/**
 * "Interest Refund" is only the truth under refund_to_payer. Under either split
 * method the money is a share of the pool, not a refund of what that member
 * paid, and calling it a refund would misdescribe a money column.
 *
 * A SETTLED record does NOT carry the method (deliberately — today's rule is not
 * necessarily the rule in force when the cycle was settled), so it gets the
 * neutral wording rather than a guess.
 */
function renderInterestHeading(mode, summary) {
  const method = summary && summary.shareOutInterestMethod;
  interestColumnLabel = (mode === "preview" && method === "refund_to_payer")
    ? "Interest Refund"
    : "Interest Share";
  const heading = document.getElementById("interestShareHeading");
  if (heading) heading.textContent = interestColumnLabel;
}

function renderStateBanner(mode, data) {
  const banner = stateBannerEl();
  if (!banner) return;
  banner.textContent = "";
  banner.className = mode === "settled" ? "alert alert-success" : "alert alert-warning";

  const text = document.createElement("span");
  if (mode === "settled") {
    text.textContent = `SETTLED on ${formatDateLabel(data && data.settledAt)} — this is the final record.`;
  } else {
    text.textContent = "PREVIEW — this cycle has not been settled.";
  }
  banner.appendChild(text);
}

function renderMemberTable(rows) {
  const tbody = payoutTableBodyEl();
  if (!tbody) return;
  tbody.textContent = "";

  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.appendChild(emptyState("👥", "No members to show for this cycle."));
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((member) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.dataset.label = "Member";
    nameTd.className = "cell-name";
    nameTd.textContent = member.fullName || "Unknown";
    tr.appendChild(nameTd);

    tr.appendChild(moneyTd("Contributed", member.totalContributed));
    tr.appendChild(moneyTd("Borrowed", member.totalBorrowed));
    tr.appendChild(moneyTd("Interest Paid", member.totalInterestPaid));
    tr.appendChild(moneyTd("Penalties Paid", member.totalPenaltiesPaid));
    tr.appendChild(moneyTd(interestColumnLabel, member.interestRefund, "cell-payout"));
    tr.appendChild(moneyTd("Penalty Share", member.penaltyShare, "cell-payout"));
    tr.appendChild(moneyTd("Payout", member.payoutAmount, "cell-payout cell-success"));

    tbody.appendChild(tr);
  });
}

/**
 * A single money table cell. `value` is passed straight to formatCurrency —
 * no arithmetic, no unwrapping. formatCurrency itself already treats a
 * missing/undefined field as "MWK 0.00", so an optional field never renders
 * unit-less.
 */
function moneyTd(label, value, extraClass) {
  const td = document.createElement("td");
  td.dataset.label = label;
  td.className = extraClass ? `cell-right cell-nowrap ${extraClass}` : "cell-right cell-nowrap";
  td.textContent = formatCurrency(value);
  return td;
}

function renderPoolSummary(summary, mode) {
  const grid = poolSummaryGridEl();
  if (!grid) return;
  grid.textContent = "";

  // summary.shareOutPenalties only exists in the preview payload (per the
  // brief's contract, the settled summary omits it) — shown verbatim when
  // present, never inferred from another field.
  const shareOutValue = typeof summary.shareOutPenalties === "boolean"
    ? (summary.shareOutPenalties ? "Yes" : "No")
    : "—";

  const tiles = [
    {title: "Interest Pool", value: formatCurrency(summary.groupInterestPool), meta: "Total interest collected this cycle"},
    {title: "Penalty Pool", value: formatCurrency(summary.groupPenaltyPool), meta: "Total penalties collected this cycle"},
    {title: "Penalties Shared Out", value: shareOutValue, meta: "Group rule for this cycle"},
    {title: "Penalties Distributed", value: formatCurrency(summary.distributedPenalties), meta: "Actually paid out to members"},
    {title: "Total Payout", value: formatCurrency(summary.totalPayout), meta: mode === "settled" ? "Paid out to members" : "Would be paid out to members"},
    {title: "Member Count", value: String(summary.memberCount ?? 0), meta: "Members included in this cycle"},
  ];

  tiles.forEach((tile) => {
    const card = el("div", "info-card");

    const header = el("div", "info-card-header");
    const title = el("span", "info-card-title");
    title.textContent = tile.title;
    header.appendChild(title);
    card.appendChild(header);

    const value = el("div", "info-card-value");
    value.textContent = tile.value;
    card.appendChild(value);

    const footer = el("div", "info-card-footer");
    const meta = el("span", "info-card-meta");
    meta.textContent = tile.meta;
    footer.appendChild(meta);
    card.appendChild(footer);

    grid.appendChild(card);
  });
}

/**
 * The explicit reconciliation line. Renders `summary.balances` exactly as
 * the server sent it — never computed here.
 */
function renderReconciliation(summary) {
  const banner = reconciliationBannerEl();
  if (!banner) return;
  banner.textContent = "";

  const balances = summary.balances === true;
  banner.className = balances ? "alert alert-success" : "alert alert-danger";

  const headline = document.createElement("p");
  headline.textContent = balances
    ? "Reconciles: total payout equals the interest pool plus the penalties distributed."
    : "DOES NOT RECONCILE — this cycle cannot be settled.";
  banner.appendChild(headline);

  const detail = document.createElement("p");
  detail.className = "cell-muted";
  detail.textContent = `Total payout: ${formatCurrency(summary.totalPayout)} · `
    + `Interest pool: ${formatCurrency(summary.groupInterestPool)} · `
    + `Penalties distributed: ${formatCurrency(summary.distributedPenalties)}`;
  banner.appendChild(detail);
}

/**
 * Settle block: only shown in preview mode to a senior_admin, and only
 * enabled when the server says the cycle balances. This is UX only — the
 * real gate is require_role($groupId, ['senior_admin']) inside cycle.settle.
 */
function renderSettleSection(mode, summary) {
  const section = settleSectionEl();
  if (!section) return;

  hideConfirmPanel();

  if (mode !== "preview" || currentUserRole !== "senior_admin") {
    section.hidden = true;
    pendingSettleSummary = null;
    return;
  }

  section.hidden = false;
  pendingSettleSummary = summary;

  const canSettle = summary.balances === true;
  const btn = settleBtnEl();
  if (btn) {
    btn.disabled = !canSettle;
    btn.title = canSettle ? "" : "This cycle does not reconcile and cannot be settled.";
  }
}

function showConfirmPanel() {
  const summary = pendingSettleSummary || {};
  const text = confirmSummaryTextEl();
  if (text) {
    text.textContent = `This will settle the cycle for ${summary.memberCount ?? 0} member(s), `
      + `totalling ${formatCurrency(summary.totalPayout)}. This cannot be undone in the app.`;
  }
  const checkbox = confirmCheckboxEl();
  if (checkbox) checkbox.checked = false;
  const confirmBtn = confirmSettleBtnEl();
  if (confirmBtn) confirmBtn.disabled = true;
  const panel = confirmPanelEl();
  if (panel) panel.hidden = false;
  settleBtnEl()?.setAttribute("aria-expanded", "true");
}

function hideConfirmPanel() {
  const panel = confirmPanelEl();
  if (panel) panel.hidden = true;
  const checkbox = confirmCheckboxEl();
  if (checkbox) checkbox.checked = false;
  const confirmBtn = confirmSettleBtnEl();
  if (confirmBtn) confirmBtn.disabled = true;
  settleBtnEl()?.setAttribute("aria-expanded", "false");
}

/**
 * Confirm settlement. Disables the confirm button for the duration of the
 * request so a double-tap cannot settle twice. confirm is sent as the
 * boolean literal `true`, never a string or 1.
 */
async function handleConfirmSettle() {
  const btn = confirmSettleBtnEl();
  if (!btn || btn.disabled) return;
  if (!confirmCheckboxEl()?.checked) return;

  btn.disabled = true;
  try {
    const result = await apiPost("cycle.settle", {groupId: currentGroupId, confirm: true});
    showToast("Cycle settled. This is now the final record.", "success");
    hideConfirmPanel();

    await loadShareoutData();
  } catch (error) {
    handleSettleError(error);
    btn.disabled = false;
  }
}

/**
 * Every cycle.settle refusal handled explicitly, keyed on status + the
 * server's own message text — no generic "something went wrong" fallback for
 * a recognized refusal.
 */
function handleSettleError(error) {
  if (!(error instanceof ApiError)) {
    console.error("cycle.settle failed", error);
    showToast("Unable to reach the server. Please try again.", "error");
    return;
  }

  if (error.status === 401) {
    redirectToLogin();
    return;
  }

  if (error.status === 403) {
    showToast("Only a senior admin can settle a cycle.", "error");
    return;
  }

  const msg = error.message || "";

  if (error.status === 409 && msg === SETTLE_MESSAGES.ALREADY_SETTLED) {
    // The record now exists — flip the page into settled state.
    showToast(msg, "info");
    hideConfirmPanel();
    loadShareoutData();
    return;
  }

  if (
    (error.status === 422 && msg === SETTLE_MESSAGES.CONFIRM) ||
    (error.status === 409 && msg === SETTLE_MESSAGES.NO_CYCLE) ||
    (error.status === 409 && msg === SETTLE_MESSAGES.NO_MEMBERS) ||
    (error.status === 500 && msg === SETTLE_MESSAGES.NOT_BALANCED)
  ) {
    showToast(msg, "error");
    return;
  }

  // Any other server-supplied message is still shown verbatim — the
  // server's own words, never a paraphrase.
  showToast(msg || "The server rejected the settlement request.", "error");
}

// ── Load-path empty/error state ────────────────────────────────────────────
function showLoadMessage(text) {
  const msgText = shareoutMessageText();
  if (msgText) msgText.textContent = text;
  const msg = shareoutMessage();
  if (msg) msg.hidden = false;
  const content = shareoutContent();
  if (content) content.hidden = true;
}

function hideLoadMessage() {
  const msg = shareoutMessage();
  if (msg) msg.hidden = true;
}

// ── Helpers ──────────────────────────────────────────────────────────────
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

function formatDateLabel(value) {
  if (!value) return "an unknown date";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
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
  close.textContent = "×"; // static entity, no user data
  close.addEventListener("click", () => toast.remove());
  toast.append(span, close);
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
