import {
  db,
  auth,
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  where,
  onAuthStateChanged,
  Timestamp,
} from "./firebaseConfig.js";

// Global state
let currentUser = null;
let selectedGroupId = null;
let userGroups = [];
let analyticsData = {
  totalIncome: 0,
  totalExpenses: 0,
  netProfit: 0,
  loanInterest: 0,
  monthlyData: [],
  memberPerformance: [],
};

// DOM Elements
const groupSelector = document.getElementById("groupSelector");
const totalIncomeEl = document.getElementById("totalIncome");
const totalExpensesEl = document.getElementById("totalExpenses");
const netProfitEl = document.getElementById("netProfit");
const loanInterestEl = document.getElementById("loanInterest");
const chartContainer = document.getElementById("chartContainer");
const memberPerformanceEl = document.getElementById("memberPerformance");
const spinner = document.getElementById("spinner");

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
});

// Auth state listener
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadUserGroups();
  } else {
    window.location.href = "../login.html";
  }
});

// Setup event listeners
function setupEventListeners() {
  if (groupSelector) {
    groupSelector.addEventListener("change", async (e) => {
      selectedGroupId = e.target.value;
      if (selectedGroupId) {
        sessionStorage.setItem("selectedGroupId", selectedGroupId);
        await loadAnalytics();
      }
    });
  }

  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      if (selectedGroupId) {
        await loadAnalytics();
      }
    });
  });
}

// Load user groups
async function loadUserGroups() {
  showSpinner(true);

  try {
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    if (!userDoc.exists()) {
      showToast("User profile not found", "error");
      return;
    }

    const userData = userDoc.data();
    const groupsRef = collection(db, "groups");
    const groupsSnapshot = await getDocs(groupsRef);

    userGroups = [];
    groupsSnapshot.forEach((groupDoc) => {
      const groupData = groupDoc.data();
      const groupId = groupDoc.id;

      const isCreator = groupData.createdBy === currentUser.uid;
      const isAdmin = groupData.admins?.some((a) => a.uid === currentUser.uid || a.email === currentUser.email);
      const memberships = userData.groupMemberships || [];
      const isMemberAdmin = memberships.some((m) => m.groupId === groupId && (m.role === "admin" || m.role === "senior_admin"));
      const isMember = memberships.some((m) => m.groupId === groupId);

      if (isCreator || isAdmin || isMemberAdmin || isMember) {
        userGroups.push({ id: groupId, ...groupData });
      }
    });

    // Populate group selector
    groupSelector.innerHTML = '<option value="">Select a group...</option>';
    userGroups.forEach((group) => {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.groupName;
      groupSelector.appendChild(option);
    });

    // Auto-select from session
    const sessionGroupId = sessionStorage.getItem("selectedGroupId");
    if (sessionGroupId && userGroups.find((g) => g.id === sessionGroupId)) {
      groupSelector.value = sessionGroupId;
      selectedGroupId = sessionGroupId;
      await loadAnalytics();
    }
  } catch (error) {
    console.error("Error loading groups:", error);
    showToast("Failed to load groups", "error");
  } finally {
    showSpinner(false);
  }
}

// Load analytics data
async function loadAnalytics() {
  if (!selectedGroupId) return;

  showSpinner(true);

  try {
    const currentYear = new Date().getFullYear();
    const groupDoc = await getDoc(doc(db, "groups", selectedGroupId));
    
    if (!groupDoc.exists()) {
      showToast("Group not found", "error");
      return;
    }

    const groupData = groupDoc.data();

    // Reset analytics data
    analyticsData = {
      totalIncome: 0,
      totalExpenses: 0,
      netProfit: 0,
      loanInterest: 0,
      monthlyData: [],
      memberPerformance: [],
    };

    // Get all members
    const membersRef = collection(db, `groups/${selectedGroupId}/members`);
    const membersSnapshot = await getDocs(membersRef);
    const members = [];
    membersSnapshot.forEach((doc) => {
      members.push({ id: doc.id, ...doc.data() });
    });

    // Calculate income from contributions
    await calculateContributionIncome(currentYear, members);

    // Calculate loan interest
    await calculateLoanInterest();

    // Calculate disbursements (loans given out)
    await calculateDisbursements();

    // Calculate net profit
    analyticsData.netProfit = analyticsData.totalIncome - analyticsData.totalExpenses;

    // Calculate member performance
    calculateMemberPerformance(members);

    // Update UI
    updateAnalyticsUI();
    renderChart();
    renderMemberPerformance();
  } catch (error) {
    console.error("Error loading analytics:", error);
    showToast("Failed to load analytics", "error");
  } finally {
    showSpinner(false);
  }
}

// Calculate contribution income
async function calculateContributionIncome(year, members) {
  try {
    // Seed Money collections
    const seedMoneyRef = doc(db, `groups/${selectedGroupId}/payments`, `${year}_SeedMoney`);
    const seedMoneyDoc = await getDoc(seedMoneyRef);
    
    if (seedMoneyDoc.exists()) {
      for (const member of members) {
        try {
          const userSeedRef = doc(db, `groups/${selectedGroupId}/payments/${year}_SeedMoney/${member.id}/PaymentDetails`);
          const userSeedDoc = await getDoc(userSeedRef);
          if (userSeedDoc.exists()) {
            const data = userSeedDoc.data();
            analyticsData.totalIncome += parseFloat(data.amountPaid || 0);
          }
        } catch (e) {
          // Member may not have seed money record
        }
      }
    }

    // Monthly Contributions
    const monthlyRef = doc(db, `groups/${selectedGroupId}/payments`, `${year}_MonthlyContributions`);
    const monthlyDoc = await getDoc(monthlyRef);
    
    if (monthlyDoc.exists()) {
      const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const currentMonth = new Date().getMonth();

      for (let i = 0; i <= currentMonth; i++) {
        let monthTotal = 0;
        for (const member of members) {
          try {
            const monthDocRef = doc(db, `groups/${selectedGroupId}/payments/${year}_MonthlyContributions/${member.id}/${year}_${months[i]}`);
            const monthDocSnap = await getDoc(monthDocRef);
            if (monthDocSnap.exists()) {
              const data = monthDocSnap.data();
              monthTotal += parseFloat(data.amountPaid || 0);
            }
          } catch (e) {
            // Member may not have monthly record
          }
        }
        analyticsData.monthlyData.push({
          month: months[i].substring(0, 3),
          income: monthTotal,
          expenses: 0,
        });
        analyticsData.totalIncome += monthTotal;
      }
    }
  } catch (error) {
    console.error("Error calculating contribution income:", error);
  }
}

// Calculate loan interest earned
async function calculateLoanInterest() {
  try {
    const loansRef = collection(db, `groups/${selectedGroupId}/loans`);
    const loansSnapshot = await getDocs(loansRef);

    loansSnapshot.forEach((loanDoc) => {
      const loan = loanDoc.data();
      if (loan.status === "repaid" || loan.status === "active") {
        const interestEarned = parseFloat(loan.interestEarned || loan.totalInterest || 0);
        analyticsData.loanInterest += interestEarned;
        analyticsData.totalIncome += interestEarned;
      }
    });
  } catch (error) {
    console.error("Error calculating loan interest:", error);
  }
}

// Calculate disbursements
async function calculateDisbursements() {
  try {
    const loansRef = collection(db, `groups/${selectedGroupId}/loans`);
    const loansSnapshot = await getDocs(loansRef);

    loansSnapshot.forEach((loanDoc) => {
      const loan = loanDoc.data();
      if (loan.status === "active" || loan.status === "repaid" || loan.status === "approved") {
        const disbursedAmount = parseFloat(loan.amount || loan.loanAmount || 0);
        analyticsData.totalExpenses += disbursedAmount;

        // Update monthly data if we have disbursement date
        if (loan.disbursedAt) {
          const disbursementDate = loan.disbursedAt.toDate ? loan.disbursedAt.toDate() : new Date(loan.disbursedAt);
          const monthIndex = disbursementDate.getMonth();
          if (analyticsData.monthlyData[monthIndex]) {
            analyticsData.monthlyData[monthIndex].expenses += disbursedAmount;
          }
        }
      }
    });
  } catch (error) {
    console.error("Error calculating disbursements:", error);
  }
}

// Calculate member performance
function calculateMemberPerformance(members) {
  analyticsData.memberPerformance = members.map((member) => {
    const financialSummary = member.financialSummary || {};
    const totalPaid = parseFloat(financialSummary.totalPaid || 0);
    const totalArrears = parseFloat(financialSummary.totalArrears || 0);
    const totalDue = totalPaid + totalArrears;
    const paymentRate = totalDue > 0 ? ((totalPaid / totalDue) * 100).toFixed(1) : 0;

    return {
      id: member.id,
      name: member.fullName || "Unknown",
      totalPaid,
      totalArrears,
      paymentRate: parseFloat(paymentRate),
      status: parseFloat(paymentRate) >= 80 ? "good" : parseFloat(paymentRate) >= 50 ? "warning" : "danger",
    };
  });

  // Sort by payment rate descending
  analyticsData.memberPerformance.sort((a, b) => b.paymentRate - a.paymentRate);
}

// Update analytics UI
function updateAnalyticsUI() {
  if (totalIncomeEl) totalIncomeEl.textContent = formatCurrency(analyticsData.totalIncome);
  if (totalExpensesEl) totalExpensesEl.textContent = formatCurrency(analyticsData.totalExpenses);
  if (netProfitEl) netProfitEl.textContent = formatCurrency(analyticsData.netProfit);
  if (loanInterestEl) loanInterestEl.textContent = formatCurrency(analyticsData.loanInterest);
}

// Render chart
function renderChart() {
  if (!chartContainer) return;

  const maxValue = Math.max(
    ...analyticsData.monthlyData.map((d) => Math.max(d.income, d.expenses)),
    1
  );

  let chartHTML = "";
  analyticsData.monthlyData.forEach((data) => {
    const incomeHeight = ((data.income / maxValue) * 100).toFixed(0);
    chartHTML += `
      <div class="chart-bar-wrapper">
        <div class="chart-bar animated" style="height: 200px; --bar-height: ${incomeHeight}%;" title="Income: ${formatCurrency(data.income)}"></div>
        <span class="chart-label">${data.month}</span>
      </div>
    `;
  });

  if (chartHTML) {
    chartContainer.innerHTML = chartHTML;
  } else {
    chartContainer.innerHTML = `
      <div class="empty-state" style="width: 100%;">
        <div class="empty-state-icon">📊</div>
        <p class="empty-state-text">No financial data available yet</p>
      </div>
    `;
  }
}

// Render member performance
function renderMemberPerformance() {
  if (!memberPerformanceEl) return;

  if (analyticsData.memberPerformance.length === 0) {
    memberPerformanceEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">👥</div>
        <p class="empty-state-text">No members found</p>
      </div>
    `;
    return;
  }

  let html = '<div class="performance-list">';
  analyticsData.memberPerformance.slice(0, 10).forEach((member, index) => {
    const statusClass = member.status;
    const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "";
    
    html += `
      <div class="performance-item">
        <div class="performance-rank">${medal || (index + 1)}</div>
        <div class="performance-info">
          <div class="performance-name">${member.name}</div>
          <div class="performance-stats">
            <span class="text-success">Paid: ${formatCurrency(member.totalPaid)}</span>
            <span class="text-danger">Arrears: ${formatCurrency(member.totalArrears)}</span>
          </div>
        </div>
        <div class="performance-rate ${statusClass}">${member.paymentRate}%</div>
      </div>
    `;
  });
  html += "</div>";

  memberPerformanceEl.innerHTML = html;
}

// Utility functions
function formatCurrency(amount) {
  return `MWK ${(parseFloat(amount) || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function showSpinner(show) {
  if (spinner) {
    spinner.classList.toggle("hidden", !show);
  }
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) {
    alert(message);
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span><button class="toast-close" onclick="this.parentElement.remove()">&times;</button>`;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
