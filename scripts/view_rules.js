import {
  db,
  auth,
  doc,
  getDoc,
  onAuthStateChanged,
} from "./firebaseConfig.js";

// Global state
let currentUser = null;
let selectedGroupId = null;
let groupData = null;

// DOM Elements
const groupNameEl = document.getElementById("groupName");
const textRulesContainer = document.getElementById("textRulesContainer");
const pdfRulesContainer = document.getElementById("pdfRulesContainer");
const noRulesContainer = document.getElementById("noRulesContainer");
const textRulesContent = document.getElementById("textRulesContent");
const pdfViewer = document.getElementById("pdfViewer");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const spinner = document.getElementById("spinner");

// Financial rule elements
const ruleMonthlyContribution = document.getElementById("ruleMonthlyContribution");
const ruleSeedMoney = document.getElementById("ruleSeedMoney");
const ruleCycleLength = document.getElementById("ruleCycleLength");
const ruleDueDay = document.getElementById("ruleDueDay");
const rulePenalty = document.getElementById("rulePenalty");
const ruleInterest = document.getElementById("ruleInterest");

// Format currency
function formatCurrency(amount) {
  return `MWK ${parseInt(amount || 0).toLocaleString('en-US')}`;
}

// Show/hide spinner
function showSpinner(show) {
  if (spinner) {
    spinner.classList.toggle('hidden', !show);
  }
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  // Check localStorage first, then sessionStorage
  selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
  
  if (!selectedGroupId) {
    window.location.href = 'user_dashboard.html';
    return;
  }
});

// Auth state listener
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadGroupRules();
  } else {
    window.location.href = "../login.html";
  }
});

// Load group rules
async function loadGroupRules() {
  if (!selectedGroupId) {
    window.location.href = 'user_dashboard.html';
    return;
  }

  showSpinner(true);

  try {
    // Get group data
    const groupDoc = await getDoc(doc(db, "groups", selectedGroupId));
    
    if (!groupDoc.exists()) {
      showNoRules("Group not found");
      return;
    }

    groupData = groupDoc.data();
    
    // Update group name
    if (groupNameEl) {
      groupNameEl.textContent = groupData.groupName || "Group Rules";
    }

    // Check for text rules - check all possible field names
    const textRules = groupData.governance?.rules || 
                      groupData.governance?.text || 
                      groupData.governanceRules || 
                      groupData.rules || 
                      groupData.textRules || 
                      "";

    // Check for PDF URL - check all possible field names
    const pdfUrl = groupData.governance?.rulesDocumentUrl || 
                   groupData.governance?.documentUrl || 
                   groupData.governance?.pdfUrl || 
                   groupData.rulesDocumentUrl || 
                   groupData.documentUrl || 
                   groupData.pdfUrl || 
                   "";

    let hasContent = false;

    // Display text rules
    if (textRules && textRules.trim()) {
      if (textRulesContainer) textRulesContainer.style.display = 'block';
      if (textRulesContent) textRulesContent.textContent = textRules;
      hasContent = true;
    }

    // Display PDF
    if (pdfUrl && pdfUrl.trim()) {
      if (pdfRulesContainer) pdfRulesContainer.style.display = 'block';
      if (pdfViewer) pdfViewer.src = pdfUrl;
      if (downloadPdfBtn) downloadPdfBtn.href = pdfUrl;
      hasContent = true;
    }

    // Show/hide no rules container
    if (noRulesContainer) {
      noRulesContainer.style.display = hasContent ? 'none' : 'block';
    }

    // Display financial rules from group settings
    displayFinancialRules();

  } catch (error) {
    console.error("Error loading group rules:", error);
    showNoRules("Error loading rules. Please try again.");
  } finally {
    showSpinner(false);
  }
}

// Display financial rules
function displayFinancialRules() {
  if (!groupData) return;

  const rules = groupData.rules || {};

  // Monthly contribution
  if (ruleMonthlyContribution) {
    const amount = rules.monthlyContribution?.amount || groupData.monthlyContribution || 0;
    ruleMonthlyContribution.textContent = formatCurrency(amount);
  }

  // Seed money
  if (ruleSeedMoney) {
    const amount = rules.seedMoney?.amount || groupData.seedMoney || 0;
    ruleSeedMoney.textContent = formatCurrency(amount);
  }

  // Cycle length
  if (ruleCycleLength) {
    const months = rules.cycleDuration?.months || groupData.cycleLength || 11;
    ruleCycleLength.textContent = `${months} months`;
  }

  // Due day
  if (ruleDueDay) {
    const day = rules.monthlyContribution?.dayOfMonth || groupData.contributionDueDay || 15;
    const suffix = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
    ruleDueDay.textContent = `${day}${suffix} of month`;
  }

  // Penalty - Calculate for both monthly contribution and seed money
  if (rulePenalty) {
    const rate = groupData.penaltySettings?.dailyRate || 
                 rules.contributionPenalty?.dailyRate || 
                 rules.penalty?.dailyRate ||
                 groupData.dailyPenaltyRate || 
                 groupData.monthlyPenalty || 
                 1;
    
    // Get monthly contribution and seed money amounts for calculation
    const monthlyAmount = parseFloat(rules.monthlyContribution?.amount || groupData.monthlyContribution || 0);
    const seedMoneyAmount = parseFloat(rules.seedMoney?.amount || groupData.seedMoney || 0);
    
    // Calculate daily penalty in money value
    const monthlyDailyPenalty = (monthlyAmount * rate / 100).toFixed(2);
    const seedDailyPenalty = (seedMoneyAmount * rate / 100).toFixed(2);
    
    // Display both percentage and money values
    let penaltyText = `${rate}% per day`;
    if (monthlyAmount > 0 || seedMoneyAmount > 0) {
      penaltyText += '<br><span style="font-size: 0.85em; color: var(--bn-gray); font-weight: 400;">';
      if (monthlyAmount > 0) {
        penaltyText += `Monthly: ${formatCurrency(monthlyDailyPenalty)}/day`;
      }
      if (seedMoneyAmount > 0) {
        if (monthlyAmount > 0) penaltyText += ' • ';
        penaltyText += `Seed: ${formatCurrency(seedDailyPenalty)}/day`;
      }
      penaltyText += '</span>';
    }
    
    rulePenalty.innerHTML = penaltyText;
  }

  // Interest rates
  if (ruleInterest) {
    const interest = rules.loanInterest || {};
    const m1 = interest.month1 || groupData.interestRateMonth1 || 10;
    const m2 = interest.month2 || groupData.interestRateMonth2 || 5;
    const m3 = interest.month3AndBeyond || groupData.interestRateMonth3 || 3;
    ruleInterest.textContent = `${m1}% / ${m2}% / ${m3}%`;
  }
}

// Show no rules message
function showNoRules(message) {
  if (noRulesContainer) {
    noRulesContainer.style.display = 'block';
    const titleEl = noRulesContainer.querySelector('.no-rules-title');
    if (titleEl) titleEl.textContent = message;
  }
  if (textRulesContainer) textRulesContainer.style.display = 'none';
  if (pdfRulesContainer) pdfRulesContainer.style.display = 'none';
}
