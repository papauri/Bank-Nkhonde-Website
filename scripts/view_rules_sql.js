/**
 * view_rules_sql.js — SQL port of view_rules.js. Shows a group's rules to any
 * member: governance text / PDF (from groups.get) and the financial terms (from
 * rules.get, which is member-readable — every member must see the terms they are
 * bound by; only WRITING rules stays senior_admin-only).
 *
 * SQL model note: penalties here are a FIXED DAILY AMOUNT after a grace period
 * (loanPenaltyDailyAmount / contributionPenaltyDailyAmount), NOT a percentage —
 * so this page shows "MWK X / day", not "X% per day" like the Firebase original.
 * Interest is the per-month reducing-balance rate (loanInterestRateMonth1/2/3).
 *
 * No Firebase imports. No data-bearing innerHTML — every value via textContent.
 */

import {apiGet, requireSession, ApiError} from "./api.js";
import {formatCurrency} from "./utils_financial.js";

let selectedGroupId = null;

// DOM elements (same IDs as the Firebase page). Re-queried at the top of
// init() on every call, not just once at module-evaluation time — this
// module is only ever evaluated ONCE by the browser, but init() runs again
// on every SPA navigation back to this page against a freshly-swapped-in
// DOM subtree, so module-level constants captured here once would go stale
// (pointing at detached nodes) after the first visit.
let groupNameEl, textRulesContainer, pdfRulesContainer, noRulesContainer,
    textRulesContent, pdfViewer, downloadPdfBtn, spinner,
    ruleMonthlyContribution, ruleSeedMoney, ruleCycleLength, ruleDueDay,
    rulePenalty, ruleInterest;

function queryDomElements() {
  groupNameEl = document.getElementById("groupName");
  textRulesContainer = document.getElementById("textRulesContainer");
  pdfRulesContainer = document.getElementById("pdfRulesContainer");
  noRulesContainer = document.getElementById("noRulesContainer");
  textRulesContent = document.getElementById("textRulesContent");
  pdfViewer = document.getElementById("pdfViewer");
  downloadPdfBtn = document.getElementById("downloadPdfBtn");
  spinner = document.getElementById("spinner");

  ruleMonthlyContribution = document.getElementById("ruleMonthlyContribution");
  ruleSeedMoney = document.getElementById("ruleSeedMoney");
  ruleCycleLength = document.getElementById("ruleCycleLength");
  ruleDueDay = document.getElementById("ruleDueDay");
  rulePenalty = document.getElementById("rulePenalty");
  ruleInterest = document.getElementById("ruleInterest");
}

function showSpinner(show) {
  if (spinner) spinner.classList.toggle("hidden", !show);
}

export async function init() {
  queryDomElements();
  selectedGroupId = localStorage.getItem("selectedGroupId") || sessionStorage.getItem("selectedGroupId");
  if (!selectedGroupId) {
    window.location.href = "user_dashboard.html";
    return;
  }

  try {
    await requireSession(); // redirects to login on 401
  } catch (error) {
    return;
  }

  await loadGroupRules();
}
if (!window.__bnSpa) {
  document.addEventListener("DOMContentLoaded", () => { init(); });
}

async function loadGroupRules() {
  if (!selectedGroupId) {
    window.location.href = "user_dashboard.html";
    return;
  }

  showSpinner(true);
  try {
    // Group identity + governance docs. groups.get is any-member.
    let group = {};
    try {
      const groupResp = await apiGet("groups.get", {groupId: selectedGroupId});
      group = (groupResp && (groupResp.group || groupResp)) || {};
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        showNoRules("Group not found");
        return;
      }
      throw error;
    }

    if (groupNameEl) {
      groupNameEl.textContent = group.groupName || group.name || "Group Rules";
    }

    // Governance text/PDF — the real columns (migration 010), returned by groups.get.
    const textRules = firstString(group.governanceRulesText);
    const pdfUrl = firstString(group.rulesDocumentUrl);

    let hasContent = false;
    if (textRules && textRules.trim()) {
      if (textRulesContainer) textRulesContainer.style.display = "block";
      if (textRulesContent) textRulesContent.textContent = textRules; // never innerHTML
      hasContent = true;
    }
    if (pdfUrl && pdfUrl.trim()) {
      if (pdfRulesContainer) pdfRulesContainer.style.display = "block";
      if (pdfViewer) pdfViewer.src = pdfUrl;
      if (downloadPdfBtn) downloadPdfBtn.href = pdfUrl;
      hasContent = true;
    }
    if (noRulesContainer) {
      noRulesContainer.style.display = hasContent ? "none" : "block";
    }

    // Financial rules: rules.get (member-readable). 404 = no rules configured yet.
    try {
      const rules = await apiGet("rules.get", {groupId: selectedGroupId});
      displayFinancialRules((rules && (rules.rules || rules.groupRules)) || rules || {});
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        throw error;
      }
      // No rules row yet — leave the financial fields at their default markup.
    }
  } catch (error) {
    console.error("Error loading group rules:", error);
    showNoRules("Error loading rules. Please try again.");
  } finally {
    showSpinner(false);
  }
}

function displayFinancialRules(rules) {
  if (ruleMonthlyContribution) {
    ruleMonthlyContribution.textContent = formatCurrency(rules.monthlyContributionAmount);
  }
  if (ruleSeedMoney) {
    ruleSeedMoney.textContent = formatCurrency(rules.seedMoneyAmount);
  }
  if (ruleCycleLength) {
    const months = rules.cycleDurationMonths || 11;
    ruleCycleLength.textContent = `${months} months`;
  }
  if (ruleDueDay) {
    const day = Number(rules.monthlyContributionDayOfMonth) || 0;
    if (day >= 1) {
      const suffix = day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th";
      ruleDueDay.textContent = `${day}${suffix} of month`;
    } else {
      ruleDueDay.textContent = "End of month";
    }
  }

  // SQL model: a fixed MWK/day after grace, not a percentage. Show both the loan
  // and contribution daily amounts, built with textContent (no innerHTML).
  if (rulePenalty) {
    rulePenalty.textContent = "";
    const loanDaily = parseFloat(rules.loanPenaltyDailyAmount);
    const contribDaily = parseFloat(rules.contributionPenaltyDailyAmount);

    const parts = [];
    if (Number.isFinite(loanDaily) && loanDaily > 0) {
      parts.push(`Loan: ${formatCurrency(loanDaily)}/day`);
    }
    if (Number.isFinite(contribDaily) && contribDaily > 0) {
      parts.push(`Contribution: ${formatCurrency(contribDaily)}/day`);
    }
    rulePenalty.textContent = parts.length ? parts.join(" • ") : "No penalty configured";
  }

  if (ruleInterest) {
    const m1 = rules.loanInterestRateMonth1 ?? 0;
    const m2 = rules.loanInterestRateMonth2 ?? 0;
    const m3 = rules.loanInterestRateMonth3 ?? 0;
    ruleInterest.textContent = `${m1}% / ${m2}% / ${m3}%`;
  }
}

/** First argument that is a non-empty string, else "". */
function firstString(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function showNoRules(message) {
  if (noRulesContainer) {
    noRulesContainer.style.display = "block";
    const titleEl = noRulesContainer.querySelector(".no-rules-title");
    if (titleEl) titleEl.textContent = message;
  }
  if (textRulesContainer) textRulesContainer.style.display = "none";
  if (pdfRulesContainer) pdfRulesContainer.style.display = "none";
}
