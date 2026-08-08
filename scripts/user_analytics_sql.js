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

import {apiGet, requireSession, listMyGroups, ApiError, redirectToLogin, logout, downloadExport} from "./api.js";
import { formatCurrency } from "./utils_financial.js";
import { emptyState as uiEmptyState } from "./ui.js";
import { attachCardInfo, infoContent } from "./card_info.js";

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
/* This member's own row from loans.transparency — server-computed per-member
   lending totals. Needed because loans.list's SUMMARY is group-wide for an
   admin, so the summary figures cannot be trusted as "mine" on this page. */
let myLendingRow = null;
/** loans.list's server-computed `summary` block — already member-scoped since
 * a plain member's loans.list call only ever returns their own rows. */
let myLoansSummary = null;
let myRepayments = [];
let showAllRepayments = false;
let showAllChartMonths = false;
let statementYear = "";

const groupSelectorEl = () => document.getElementById("groupSelector");
const spinner = () => document.getElementById("spinner");
const chartContainerEl = () => document.getElementById("chartContainer");
const groupStatsSectionEl = () => document.getElementById("groupStatsSection");
const statementYearFilterEl = () => document.getElementById("statementYearFilter");
const statementExportBtnEl = () => document.getElementById("statementExportBtn");

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
    showAllRepayments = false;
    showAllChartMonths = false;
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
        container.parentElement?.querySelector("#chartMonthsToggle")?.remove();
        container.appendChild(emptyState("📊", "Select a group to view contribution trends"));
      }
      const activity = document.getElementById("recentActivity");
      if (activity) {
        activity.textContent = "";
        activity.appendChild(emptyState("📊", "Select a group to view recent activity"));
      }
      clearStatementSections();
    }
  });

  statementYearFilterEl()?.addEventListener("change", async (e) => {
    statementYear = e.target.value || "";
    await loadAccountStatement();
  });

  statementExportBtnEl()?.addEventListener("click", () => {
    if (!currentGroupId) {
      showToast("Select a group first", "info");
      return;
    }
    downloadExport("exports.statement", {groupId: currentGroupId});
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
  await loadAccountStatement();
  await loadGroupStats();
}

// ── Group stats (group-wide, member-gated to caller's own group) ───────────
async function loadGroupStats() {
  if (!currentGroupId) return;
  try {
    const stats = await apiGet("payments.groupStats", {groupId: currentGroupId});
    setText(document.getElementById("groupTotalMembers"), String(stats.memberCount));
    setText(document.getElementById("groupTotalCollections"), formatCurrency(numberOf(stats.groupTotalContributed)));
    setText(document.getElementById("groupActiveLoans"), String(stats.activeLoanCount));
  } catch (error) {
    handleApiError(error, "Failed to load group stats");
  }
}

// ── Contributions ───────────────────────────────────────────────────────────
async function loadContributions() {
  if (!currentGroupId) return;
  showSpinner(true);
  try {
    obligations = await apiGet("payments.obligations", {groupId: currentGroupId});
    renderPaymentBreakdown(obligations);

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
  /* PER-MEMBER, not per-group. The note below used to say "loans.list is
     already member-scoped" — true for a MEMBER, false for an ADMIN, where the
     endpoint returns the whole group and its summary with it. That is why this
     page showed an admin the group's 140,000 as their own borrowing.
     myLendingRow is the server's own per-member total; the summary remains the
     fallback, which is correct for a plain member. */
  const outstanding = myLendingRow
    ? numberOf(myLendingRow.outstanding)
    : (myLoansSummary ? numberOf(myLoansSummary.totalOutstanding) : 0);
  // Substituted with the server summary: `summary.issuedPrincipal` sums
  // approvedAmount (falling back to principalAmount) over exactly the
  // approved/disbursed/completed/defaulted rows — the same scope
  // ISSUED_LOAN_STATUSES filtered client-side — so the old filter+reduce is
  // redundant.
  const totalBorrowed = myLendingRow
    ? numberOf(myLendingRow.totalBorrowed)
    : (myLoansSummary ? numberOf(myLoansSummary.issuedPrincipal) : 0);

  setText(document.getElementById("totalContributed"), formatCurrency(totalContributed));
  setText(document.getElementById("totalBorrowed"), formatCurrency(totalBorrowed));
  setText(document.getElementById("outstanding"), formatCurrency(outstanding));
  setText(document.getElementById("totalArrears"), formatCurrency(totalArrears));

  setText(document.getElementById("userTotalContributed"), formatCurrency(totalContributed));
  setText(document.getElementById("userTotalLoans"), formatCurrency(totalBorrowed));
  setText(document.getElementById("userLoanOutstanding"), formatCurrency(outstanding));
  setText(document.getElementById("userTotalArrears"), formatCurrency(totalArrears));
  /* THESE TWO WROTE TO IDS THAT DO NOT EXIST ON THIS PAGE.
     The markup carries #activeLoans and #groupsCount; the script targeted
     #userActiveLoans / #userGroupsCount, so both cards sat on their hard-coded
     "0" forever — a member with a live loan was shown "Active Loans 0".
     setText on a missing element is a silent no-op, which is why it never
     surfaced as an error. The legacy ids are kept alongside in case another
     surface still renders them. */
  const activeLoanCount = String(myLoans.filter((l) => ISSUED_LOAN_STATUSES.includes(l.status)).length);
  setText(document.getElementById("activeLoans"), activeLoanCount);
  setText(document.getElementById("userActiveLoans"), activeLoanCount);
  setText(document.getElementById("groupsCount"), String(userGroups.length));
  setText(document.getElementById("userGroupsCount"), String(userGroups.length));

  // groupTotalContributed mirrors totalContributed: obligations is already
  // scoped to currentGroupId, so "you contributed" for the selected group is
  // the same figure as the top-of-page total.
  setText(document.getElementById("groupTotalContributed"), formatCurrency(totalContributed));

  renderBreakdownPopovers();

  const section = groupStatsSectionEl();
  if (section) section.style.display = "";
}

// ── Card-info popovers (ported from analytics.html / analytics_sql.js) ─────
// Adapted to take structured [label, valueString] rows instead of a single
// text blob, since these cards break a total down into server-computed
// line items rather than one sentence of context.
/**
 * Attach the "i" info affordance to a card, showing structured label/value rows.
 *
 * Delegates to the SHARED card_info module, which renders the panel on <body>.
 * The previous in-card panel was clipped by ancestor overflow and trapped by
 * the card hover transform, so it never displayed in full.
 * @param {HTMLElement} cardEl the card to attach to
 * @param {string} ariaLabel accessible name for the toggle
 * @param {Array<Array<string>>} rows [label, value] pairs, already formatted
 */
function attachCardPopover(cardEl, ariaLabel, rows, opts = {}) {
  if (!cardEl || !Array.isArray(rows) || rows.length === 0) return;
  /* Delegates to the shared infoContent() instead of hand-building rows.
     This panel used to render rows ONLY — no title and no plain-language
     sentence — so it was the one "i" on the app that opened straight into a
     table of figures with nothing saying what they were. The shared builder
     fixes the order (title → sentence → rows → action) in one place. */
  attachCardInfo(cardEl, {
    label: ariaLabel,
    content: infoContent({
      title: opts.title || ariaLabel,
      description: opts.description,
      rows,
      action: opts.action,
    }),
  });
}

// Re-attaches the 4 breakdown popovers against the current `obligations`
// figures. Idempotent: removes any toggle+popover a previous render left
// before re-attaching, so switching groups / re-rendering never duplicates.
function renderBreakdownPopovers() {
  const cb = obligations?.contributionBreakdown || {};
  const months = obligations?.monthlyContributions?.months || [];

  const contributedRows = [
    ["Seed money", formatCurrency(numberOf(cb.seedMoney))],
    {
      label: "Monthly contributions",
      value: formatCurrency(numberOf(cb.monthly)),
      // Second level: what was actually paid each month. Each figure is that
      // month's own server field — nothing is re-totalled here.
      detail: () =>
        months
          .filter((m) => numberOf(m.amountPaid) > 0)
          .map((m) => [m.month, formatCurrency(numberOf(m.amountPaid))]),
      detailLabel: "Show what was paid each month",
    },
    ["Service fee", formatCurrency(numberOf(cb.serviceFee))],
  ];

  const summary = obligations?.summary || {};
  const arrearsRows = [
    {
      label: "Contribution arrears",
      value: formatCurrency(numberOf(summary.arrears)),
      detail: () =>
        months
          .filter((m) => numberOf(m.arrears) > 0)
          .map((m) => [m.month, formatCurrency(numberOf(m.arrears))]),
      detailLabel: "Show which months are short",
    },
    {
      label: "Penalties accrued",
      value: formatCurrency(numberOf(summary.penaltyAccrued)),
      detail: () =>
        months
          .filter((m) => m.penalty && numberOf(m.penalty.amountOutstanding) > 0)
          .map((m) => [m.month, formatCurrency(numberOf(m.penalty.amountOutstanding))]),
      detailLabel: "Show which months carry a penalty",
    },
  ];

  const contributedInfo = {
    title: "Contributions breakdown",
    description:
      "Everything you have paid into the group, split by what it was for. Seed money is your one-off joining stake; monthly contributions run for each month of the cycle.",
  };
  const arrearsInfo = {
    title: "Arrears breakdown",
    description:
      "What you still owe and have not paid, plus any late penalties that have built up on it.",
  };

  /* SELECTOR LIST, not ".page-stat" / ".stat-card" alone.
     This page was redesigned onto a `.hero-section` / `.hero-stat` layout and
     these attach calls were never updated, so closest() matched nothing and
     ALL FOUR "i" toggles on the member's analytics page silently never
     rendered — no toggle, no panel, no error. (`userTotalContributed` and
     `userTotalArrears` no longer exist at all; the two live ids are enough, and
     attachBreakdown no-ops safely on a missing one.) Listing every card shell
     this app uses keeps the attach working through the next re-skin. */
  const CARD = ".hero-stat, .page-stat, .stat-card";
  attachBreakdown("totalContributed", CARD, "Contributions breakdown", contributedRows, contributedInfo);
  attachBreakdown("userTotalContributed", CARD, "Contributions breakdown", contributedRows, contributedInfo);
  attachBreakdown("totalArrears", CARD, "Arrears breakdown", arrearsRows, arrearsInfo);
  attachBreakdown("userTotalArrears", CARD, "Arrears breakdown", arrearsRows, arrearsInfo);
}

function attachBreakdown(valueElId, wrapSelector, ariaLabel, rows, opts) {
  const valueEl = document.getElementById(valueElId);
  const wrap = valueEl?.closest(wrapSelector);
  if (!wrap) return;
  // attachCardInfo() is itself idempotent (it removes any existing toggle
  // before adding a new one), so no manual cleanup is needed here — the panel
  // now lives on <body>, not in the card.
  attachCardPopover(wrap, ariaLabel, rows, opts);
}


/**
 * Compact money for a chart label only ("12.5k"). Six full currency strings
 * will not fit across a phone; every figure a member acts on elsewhere still
 * uses formatCurrency at full precision.
 * @param {number} n
 * @return {string}
 */
function shortMoney(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(/\.0$/, "") + "m";
  if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(Math.round(v));
}
function renderContributionTrendChart() {
  const container = chartContainerEl();
  if (!container) return;
  container.textContent = "";
  container.parentElement?.querySelector("#chartMonthsToggle")?.remove();

  /* THE CHART CSS NEVER APPLIED. Every .chart-container rule in the page was
     written against a class that no element carried — the host is
     <div class="content-card-body" id="chartContainer">, so the bars inherited
     display:block and stacked VERTICALLY, one full-width bar per row. That is
     the "giant column" the chart has always rendered as.
     The class is added here, on the element that actually holds the bars, and
     removed for the empty state so an empty box is not laid out as a plot. */
  container.classList.remove("chart-container");

  const months = obligations?.monthlyContributions?.months || [];
  if (months.length === 0) {
    container.appendChild(uiEmptyState({
      icon: "📊",
      title: "No contributions recorded yet",
      description: "Once you start making monthly contributions, your trend will build up here.",
      actions: [{label: "Go to dashboard", href: "user_dashboard.html", variant: "accent"}],
    }));
    return;
  }

  const monthsWithData = months.filter((m) => numberOf(m.amountPaid) > 0 || numberOf(m.totalAmount) > 0);
  const source = monthsWithData.length > 0 ? monthsWithData : months;
  const monthsToShow = showAllChartMonths ? source : source.slice(-6);

  const maxAmount = Math.max(
      1,
      ...monthsToShow.map((m) => Math.max(numberOf(m.amountPaid), numberOf(m.totalAmount))),
  );

  container.classList.add("chart-container");
  const legend = document.getElementById("chartLegend");
  if (legend) legend.hidden = false;

  monthsToShow.forEach((month) => {
    const paid = numberOf(month.amountPaid);
    const expected = numberOf(month.totalAmount);
    const barHeight = maxAmount > 0 ? (paid / maxAmount) * 100 : 0;
    // The TARGET drawn behind the paid bar, so "how much of what I owed did I
    // actually pay" is visible as a shape rather than inferred from a tooltip.
    const targetHeight = maxAmount > 0 ? (expected / maxAmount) * 100 : 0;

    /* STATUS, not category: settled / part-paid / nothing.
       Palette validated with the dataviz validator against the page surface —
       --bn-success-dark + --bn-warning separate at ΔE 11.0 under protanopia,
       where the lighter --bn-success paired at 7.9 (the band that is only legal
       WITH secondary encoding). Both tokens already exist in the design system.
       The value label below is that secondary encoding regardless: status must
       never be carried by colour alone, and a tooltip is unreachable on touch —
       which is why every bar is labelled instead of hover-only. */
    let state = "none";
    if (paid > 0 && expected > 0 && paid + 0.001 >= expected) state = "full";
    else if (paid > 0) state = "part";

    const wrapper = el("div", "chart-bar-wrapper");

    // Amount above the bar, abbreviated so six of them fit a phone width.
    const value = el("span", "chart-value");
    value.textContent = paid > 0 ? shortMoney(paid) : "—";

    const track = el("div", "chart-track");
    const target = el("div", "chart-target");
    target.style.height = `${Math.max(targetHeight, 2)}%`;

    const bar = el("div", `chart-bar animated is-${state}`);
    bar.style.setProperty("--bar-height", `${Math.max(barHeight, paid > 0 ? 4 : 0)}%`);

    track.append(target, bar);

    const label = el("span", "chart-label");
    label.textContent = month.month.slice(0, 3);

    // Screen readers and hover both get the full figures; sighted touch users
    // already have the number printed above the bar.
    const state_word = state === "full" ? "fully paid" : state === "part" ? "part paid" : "nothing paid";
    wrapper.title = `${month.month}: ${formatCurrency(paid)} of ${formatCurrency(expected)} — ${state_word}`;
    wrapper.setAttribute("aria-label", wrapper.title);

    wrapper.append(value, track, label);
    container.appendChild(wrapper);
  });

  if (source.length > 6) {
    const host = container.parentElement;
    if (host) {
      const t = el("button", "btn btn-secondary");
      t.type = "button";
      t.id = "chartMonthsToggle";
      t.style.marginTop = "var(--bn-space-3)";
      t.setAttribute("aria-expanded", String(showAllChartMonths));
      t.textContent = showAllChartMonths ? "Show last 6 months" : ("Show all months (" + source.length + ")");
      t.addEventListener("click", () => {
        showAllChartMonths = !showAllChartMonths;
        renderContributionTrendChart();
      });
      host.appendChild(t);
    }
  }
}

// ── Loans / repayment history ───────────────────────────────────────────────

/**
 * Payment Breakdown — how this member's contributions split by type.
 *
 * WAS DEAD MARKUP. #paymentBreakdown existed in the page but no code ever
 * wrote to it, so it sat on its "Select a group…" empty state forever, even
 * with a group selected. Every figure here is a server string from
 * payments.obligations (already fetched for this page) passed straight to
 * formatCurrency — nothing is totalled in the browser.
 * @param {Object|null} ob obligations response
 */
function renderPaymentBreakdown(ob) {
  const host = document.getElementById("paymentBreakdown");
  if (!host) return;

  const b = ob && ob.contributionBreakdown;
  const summary = (ob && ob.summary) || {};
  if (!b) return; // leave the shipped empty state when there is genuinely nothing

  host.replaceChildren();

  const rows = [
    {label: "Seed money", value: b.seedMoney, accent: "var(--bn-success-dark)"},
    {label: "Monthly contributions", value: b.monthly, accent: "var(--bn-primary)"},
    {label: "Service fee", value: b.serviceFee, accent: "var(--bn-gray)"},
  ];

  const list = document.createElement("div");
  list.style.cssText = "display:flex; flex-direction:column; gap:var(--bn-space-2);";

  for (const r of rows) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; justify-content:space-between; align-items:baseline; gap:var(--bn-space-3); padding:var(--bn-space-2) 0; border-bottom:1px solid var(--bn-gray-lighter);";
    const label = document.createElement("span");
    label.style.cssText = "font-size:var(--bn-text-sm); color:var(--bn-gray-600);";
    label.textContent = r.label;
    const value = document.createElement("span");
    value.style.cssText = "font-weight:700; white-space:nowrap; color:" + r.accent + ";";
    value.textContent = formatCurrency(r.value != null ? r.value : "0.00");
    row.append(label, value);
    list.appendChild(row);
  }

  // Total comes from the server's own contributed figure, NOT from adding the
  // three rows above — two independently derived totals are free to drift.
  const total = document.createElement("div");
  total.style.cssText = "display:flex; justify-content:space-between; align-items:baseline; gap:var(--bn-space-3); padding-top:var(--bn-space-3); font-weight:800;";
  const tLabel = document.createElement("span");
  tLabel.textContent = "Total contributed";
  const tValue = document.createElement("span");
  tValue.style.whiteSpace = "nowrap";
  tValue.textContent = formatCurrency(summary.contributed != null ? summary.contributed : "0.00");
  total.append(tLabel, tValue);
  list.appendChild(total);

  host.appendChild(list);
}
async function loadLoans() {
  if (!currentGroupId) return;
  showSpinner(true);
  try {
    const data = await apiGet("loans.list", {groupId: currentGroupId});
    // The server already restricts a plain member's rows to their own loans —
    // no client-side filtering by borrowerId is performed or needed here.
    /* SCOPED TO THE SIGNED-IN MEMBER. loans.list restricts itself to the
       caller for a plain member but returns the WHOLE GROUP for an admin, so
       "Active Loans" on this member-facing page read 4 for someone with one
       loan. Same defect, same fix, as the user dashboard. Presentation only —
       the server-side scoping is what actually protects a member's data. */
    const myUid = currentUser && currentUser.uid;
    myLoans = (Array.isArray(data && data.loans) ? data.loans : [])
      .filter((l) => !myUid || String(l.borrowerId) === String(myUid));

    // Per-member totals, computed server-side. Non-fatal if it fails: the
    // summary fallback below is correct for a plain member either way.
    try {
      const tr = await apiGet("loans.transparency", {groupId: currentGroupId});
      const rows = (tr && Array.isArray(tr.members)) ? tr.members : [];
      myLendingRow = myUid ? rows.find((m) => String(m.uid) === String(myUid)) || null : null;
    } catch (e) {
      myLendingRow = null;
    }
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
    container.appendChild(uiEmptyState({
      icon: "🗓️",
      title: "No activity yet",
      description: "Your payments and loan repayments will appear here as you make them.",
    }));
    return;
  }

  const REPAY_CAP = 10;
  const rows = showAllRepayments ? myRepayments : myRepayments.slice(0, REPAY_CAP);
  rows.forEach((payment) => {
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

  if (myRepayments.length > REPAY_CAP) {
    const t = el("button", "btn btn-secondary");
    t.type = "button";
    t.style.marginTop = "var(--bn-space-3)";
    t.setAttribute("aria-expanded", String(showAllRepayments));
    t.textContent = showAllRepayments ? "Show less" : ("Show all (" + myRepayments.length + ")");
    t.addEventListener("click", () => {
      showAllRepayments = !showAllRepayments;
      renderRepaymentHistory();
    });
    container.appendChild(t);
  }
}

// ── Account statement ───────────────────────────────────────────────────────
async function loadAccountStatement() {
  if (!currentGroupId) {
    clearStatementSections();
    return;
  }
  showSpinner(true);
  try {
    const params = {groupId: currentGroupId};
    if (statementYear) params.year = statementYear;
    const data = await apiGet("statement.get", params);

    renderContributionsLedger(data?.contributions);
    renderLoanAccountLedger(data?.loanAccount);
    renderPenaltiesLedger(data?.penalties);
  } catch (error) {
    clearStatementSections();
    handleApiError(error, "Failed to load your account statement");
  } finally {
    showSpinner(false);
  }
}

function clearStatementSections() {
  const contributions = document.getElementById("statementContributions");
  if (contributions) {
    contributions.textContent = "";
    contributions.appendChild(emptyState("📄", "Select a group to view your statement"));
  }
  const loanAccount = document.getElementById("statementLoanAccount");
  if (loanAccount) {
    loanAccount.textContent = "";
    loanAccount.appendChild(emptyState("📄", "Select a group to view your statement"));
  }
  const penalties = document.getElementById("statementPenalties");
  if (penalties) {
    penalties.textContent = "";
    penalties.appendChild(emptyState("📄", "Select a group to view your statement"));
  }
}

function buildLedgerTable(headers) {
  const wrapper = el("div", "table-container");
  const table = el("table", "table table-responsive");
  const thead = el("thead");
  const headRow = el("tr");
  headers.forEach((h) => {
    const th = el("th");
    th.textContent = h;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  const tbody = el("tbody");
  table.append(thead, tbody);
  wrapper.appendChild(table);
  return {wrapper, tbody};
}

function ledgerCell(label, text) {
  const td = el("td");
  td.setAttribute("data-label", label);
  td.textContent = text;
  return td;
}

function renderContributionsLedger(contributions) {
  const container = document.getElementById("statementContributions");
  if (!container) return;
  container.textContent = "";

  const lines = Array.isArray(contributions?.lines) ? contributions.lines : [];
  const {wrapper, tbody} = buildLedgerTable(["Date", "Type", "Description", "Amount", "Running Balance"]);

  if (lines.length === 0) {
    const row = el("tr");
    const td = ledgerCell("Status", "No entries");
    td.colSpan = 5;
    row.appendChild(td);
    tbody.appendChild(row);
  } else {
    lines.forEach((line) => {
      const row = el("tr");
      row.appendChild(ledgerCell("Date", formatDateLabel(line.date)));
      row.appendChild(ledgerCell("Type", line.type || ""));
      row.appendChild(ledgerCell("Description", line.description || ""));
      row.appendChild(ledgerCell("Amount", formatCurrency(line.amount)));
      row.appendChild(ledgerCell("Running Balance", formatCurrency(line.runningBalance)));
      tbody.appendChild(row);
    });
    const footerRow = el("tr");
    const labelCell = ledgerCell("Total", "Total");
    labelCell.colSpan = 3;
    footerRow.appendChild(labelCell);
    footerRow.appendChild(ledgerCell("Amount", ""));
    footerRow.appendChild(ledgerCell("Running Balance", formatCurrency(contributions?.total)));
    tbody.appendChild(footerRow);
  }

  container.appendChild(wrapper);
}

function renderLoanAccountLedger(loanAccount) {
  const container = document.getElementById("statementLoanAccount");
  if (!container) return;
  container.textContent = "";

  const lines = Array.isArray(loanAccount?.lines) ? loanAccount.lines : [];
  const {wrapper, tbody} = buildLedgerTable(["Date", "Event", "Loan", "Amount", "Running Outstanding"]);

  if (lines.length === 0) {
    const row = el("tr");
    const td = ledgerCell("Status", "No entries");
    td.colSpan = 5;
    row.appendChild(td);
    tbody.appendChild(row);
  } else {
    lines.forEach((line) => {
      const row = el("tr");
      row.appendChild(ledgerCell("Date", formatDateLabel(line.date)));
      row.appendChild(ledgerCell("Event", line.event || ""));
      row.appendChild(ledgerCell("Loan", line.loanNumber || ""));
      row.appendChild(ledgerCell("Amount", formatCurrency(line.amount)));
      row.appendChild(ledgerCell("Running Outstanding", formatCurrency(line.runningOutstanding)));
      tbody.appendChild(row);
    });
    const footerRow = el("tr");
    const labelCell = ledgerCell("Outstanding", "Outstanding");
    labelCell.colSpan = 4;
    footerRow.appendChild(labelCell);
    footerRow.appendChild(ledgerCell("Running Outstanding", formatCurrency(loanAccount?.outstanding)));
    tbody.appendChild(footerRow);
  }

  container.appendChild(wrapper);
}

function renderPenaltiesLedger(penalties) {
  const container = document.getElementById("statementPenalties");
  if (!container) return;
  container.textContent = "";

  const lines = Array.isArray(penalties?.lines) ? penalties.lines : [];
  const {wrapper, tbody} = buildLedgerTable(["Date", "Event", "Amount", "Context"]);

  if (lines.length === 0) {
    const row = el("tr");
    const td = ledgerCell("Status", "No entries");
    td.colSpan = 4;
    row.appendChild(td);
    tbody.appendChild(row);
  } else {
    lines.forEach((line) => {
      const row = el("tr");
      row.appendChild(ledgerCell("Date", formatDateLabel(line.date)));
      row.appendChild(ledgerCell("Event", line.event || ""));
      row.appendChild(ledgerCell("Amount", formatCurrency(line.amount)));
      row.appendChild(ledgerCell("Context", line.context || ""));
      tbody.appendChild(row);
    });
    const footerRow = el("tr");
    footerRow.appendChild(ledgerCell("Charged", `Charged: ${formatCurrency(penalties?.totalCharged)}`));
    footerRow.appendChild(ledgerCell("Waived", `Waived: ${formatCurrency(penalties?.totalWaived)}`));
    footerRow.appendChild(ledgerCell("Net", `Net: ${formatCurrency(penalties?.net)}`));
    const spacer = ledgerCell("", "");
    footerRow.appendChild(spacer);
    tbody.appendChild(footerRow);
  }

  container.appendChild(wrapper);
}

function formatDateLabel(value) {
  if (!value) return "N/A";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
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
