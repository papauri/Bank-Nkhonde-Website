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
    await calculateMemberPerformance(members);

    // Calculate monthly trend data for line/bar chart
    calculateMonthlyTrends();

    // Update UI
    updateAnalyticsUI();
    renderChart();
    renderMonthlyTrendChart();
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
    // Seed Money collections - only count approved payments
    let seedMoneyTotal = 0;
    let serviceFeeTotal = 0;
    
    for (const member of members) {
      try {
        const userSeedRef = doc(db, `groups/${selectedGroupId}/payments/${year}_SeedMoney/${member.id}/PaymentDetails`);
        const userSeedDoc = await getDoc(userSeedRef);
        if (userSeedDoc.exists()) {
          const data = userSeedDoc.data();
          // Only count approved seed money payments
          if (data.approvalStatus === "approved" || data.paymentStatus === "completed") {
            const amountPaid = parseFloat(data.amountPaid || 0);
            seedMoneyTotal += amountPaid;
            analyticsData.totalIncome += amountPaid;
          }
        }
      } catch (e) {
        // Member may not have seed money record
      }

      // Service Fee collections - only count approved payments
      try {
        const serviceFeeRef = doc(db, `groups/${selectedGroupId}/payments/${year}_ServiceFee/${member.id}/PaymentDetails`);
        const serviceFeeDoc = await getDoc(serviceFeeRef);
        if (serviceFeeDoc.exists()) {
          const data = serviceFeeDoc.data();
          // Only count approved service fee payments
          if (data.approvalStatus === "approved" || data.paymentStatus === "completed") {
            const amountPaid = parseFloat(data.amountPaid || 0);
            serviceFeeTotal += amountPaid;
            analyticsData.totalIncome += amountPaid;
          }
        }
      } catch (e) {
        // Member may not have service fee record (service fee is optional)
      }
    }
    
    // Monthly Contributions - get from each member's monthly collection
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currentMonth = new Date().getMonth();

    // Initialize monthly data array for all months up to current
    for (let i = 0; i <= currentMonth; i++) {
      analyticsData.monthlyData.push({
        month: months[i].substring(0, 3),
        fullMonth: months[i],
        income: 0,
        expenses: 0,
      });
    }

    // Get monthly contributions for each member
    for (const member of members) {
      try {
        const monthlyRef = collection(db, `groups/${selectedGroupId}/payments/${year}_MonthlyContributions/${member.id}`);
        const monthlySnapshot = await getDocs(monthlyRef);
        
        monthlySnapshot.forEach((monthDoc) => {
          const data = monthDoc.data();
          const monthName = data.month;
          const monthIndex = months.indexOf(monthName);
          
          // Only count approved payments
          if (monthIndex >= 0 && monthIndex <= currentMonth && (data.approvalStatus === "approved" || data.paymentStatus === "completed")) {
            const amountPaid = parseFloat(data.amountPaid || 0);
            analyticsData.monthlyData[monthIndex].income += amountPaid;
            analyticsData.totalIncome += amountPaid;
          }
        });
      } catch (e) {
        // Member may not have monthly contributions collection
      }
    }
    
    // Add seed money and service fee to first month if monthlyData exists (as initial contributions)
    // This ensures seed money and service fee appear in the chart
    if ((seedMoneyTotal > 0 || serviceFeeTotal > 0) && analyticsData.monthlyData.length > 0) {
      analyticsData.monthlyData[0].income += seedMoneyTotal + serviceFeeTotal;
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

// Calculate monthly trends for trend chart display
function calculateMonthlyTrends() {
  // This ensures monthlyData has complete data for trend visualization
  // Data is already populated in calculateContributionIncome and calculateDisbursements
  // This function can be extended for additional trend calculations
}

// Render monthly trend bar/line chart showing income vs expenses over months
function renderMonthlyTrendChart() {
  const trendChartContainer = document.getElementById("monthlyTrendChart");
  if (!trendChartContainer) return; // Element might not exist in HTML

  if (!analyticsData.monthlyData || analyticsData.monthlyData.length === 0) {
    return;
  }

  // Find max value for scaling
  const maxValue = Math.max(
    ...analyticsData.monthlyData.map(d => Math.max(d.income || 0, d.expenses || 0)),
    1000 // Minimum scale
  );

  let chartHTML = `
    <div style="padding: var(--bn-space-4); background: var(--bn-white); border-radius: var(--bn-radius-xl); box-shadow: var(--bn-shadow-sm); margin-bottom: var(--bn-space-6);">
      <h3 style="font-size: var(--bn-text-base); font-weight: 600; color: var(--bn-dark); margin-bottom: var(--bn-space-4); text-align: center;">
        Monthly Income vs Expenses Trend
      </h3>
      <div style="display: flex; align-items: flex-end; gap: var(--bn-space-2); height: 200px; padding: var(--bn-space-4) 0; border-bottom: 2px solid var(--bn-gray-lighter);">
  `;

  analyticsData.monthlyData.forEach((monthData) => {
    const incomeHeight = maxValue > 0 ? ((monthData.income || 0) / maxValue) * 100 : 0;
    const expenseHeight = maxValue > 0 ? ((monthData.expenses || 0) / maxValue) * 100 : 0;

    chartHTML += `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: var(--bn-space-1); height: 100%;">
        <div style="flex: 1; display: flex; align-items: flex-end; gap: 2px; width: 100%; max-width: 50px;">
          <div style="flex: 1; background: var(--bn-success); border-radius: var(--bn-radius-sm) var(--bn-radius-sm) 0 0; height: ${incomeHeight}%; min-height: ${incomeHeight > 0 ? '4px' : '0'}; transition: height 0.8s ease; opacity: ${incomeHeight > 0 ? '1' : '0.3'};" title="Income: ${formatCurrency(monthData.income || 0)}"></div>
          <div style="flex: 1; background: var(--bn-danger); border-radius: var(--bn-radius-sm) var(--bn-radius-sm) 0 0; height: ${expenseHeight}%; min-height: ${expenseHeight > 0 ? '4px' : '0'}; transition: height 0.8s ease; opacity: ${expenseHeight > 0 ? '1' : '0.3'};" title="Expenses: ${formatCurrency(monthData.expenses || 0)}"></div>
        </div>
        <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); font-weight: 500; margin-top: var(--bn-space-1);">${monthData.month}</div>
      </div>
    `;
  });

  chartHTML += `
      </div>
      <div style="display: flex; justify-content: center; gap: var(--bn-space-6); margin-top: var(--bn-space-4); padding-top: var(--bn-space-4); border-top: 1px solid var(--bn-gray-lighter);">
        <div style="display: flex; align-items: center; gap: var(--bn-space-2);">
          <div style="width: 12px; height: 12px; background: var(--bn-success); border-radius: var(--bn-radius-sm);"></div>
          <span style="font-size: var(--bn-text-sm); color: var(--bn-gray-700);">Income</span>
        </div>
        <div style="display: flex; align-items: center; gap: var(--bn-space-2);">
          <div style="width: 12px; height: 12px; background: var(--bn-danger); border-radius: var(--bn-radius-sm);"></div>
          <span style="font-size: var(--bn-text-sm); color: var(--bn-gray-700);">Expenses</span>
        </div>
      </div>
    </div>
  `;

  trendChartContainer.innerHTML = chartHTML;

  // Animate bars after a short delay
  setTimeout(() => {
    trendChartContainer.querySelectorAll('[style*="height"]').forEach((bar, index) => {
      setTimeout(() => {
        bar.style.transition = 'height 0.8s ease, opacity 0.8s ease';
      }, index * 50);
    });
  }, 100);
}

// Calculate member performance
async function calculateMemberPerformance(members) {
  const currentYear = new Date().getFullYear();
  const performanceData = [];

  for (const member of members) {
    const financialSummary = member.financialSummary || {};
    const totalPaid = parseFloat(financialSummary.totalPaid || 0);
    const totalArrears = parseFloat(financialSummary.totalArrears || 0);
    const totalDue = totalPaid + totalArrears;
    const paymentRate = totalDue > 0 ? ((totalPaid / totalDue) * 100).toFixed(1) : 0;

    // Get payment breakdown by type
    let seedMoneyPaid = 0;
    let seedMoneyDue = 0;
    let monthlyPaid = 0;
    let monthlyDue = 0;
    let serviceFeePaid = 0;
    let serviceFeeDue = 0;
    const paymentBreakdown = [];

    // Check seed money
    try {
      const seedMoneyRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_SeedMoney/${member.id}/PaymentDetails`);
      const seedMoneyDoc = await getDoc(seedMoneyRef);
      if (seedMoneyDoc.exists()) {
        const seedData = seedMoneyDoc.data();
        seedMoneyPaid = parseFloat(seedData.amountPaid || 0);
        seedMoneyDue = parseFloat(seedData.totalAmount || 0);
        if (seedMoneyDue > 0) {
          paymentBreakdown.push({
            type: 'Seed Money',
            paid: seedMoneyPaid,
            due: seedMoneyDue
          });
        }
      }
    } catch (e) {}

    // Check monthly contributions
    try {
      const monthlyRef = collection(db, `groups/${selectedGroupId}/payments/${currentYear}_MonthlyContributions/${member.id}`);
      const monthlySnapshot = await getDocs(monthlyRef);
      monthlySnapshot.forEach((monthDoc) => {
        const monthData = monthDoc.data();
        const monthPaid = parseFloat(monthData.amountPaid || 0);
        const monthDue = parseFloat(monthData.totalAmount || 0);
        monthlyPaid += monthPaid;
        monthlyDue += monthDue;
        if (monthDue > 0) {
          paymentBreakdown.push({
            type: `Monthly (${monthData.month || 'Unknown'})`,
            paid: monthPaid,
            due: monthDue
          });
        }
      });
    } catch (e) {}

    // Check service fee payments
    try {
      const serviceFeeRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_ServiceFee/${member.id}/PaymentDetails`);
      const serviceFeeDoc = await getDoc(serviceFeeRef);
      if (serviceFeeDoc.exists()) {
        const serviceFeeData = serviceFeeDoc.data();
        serviceFeePaid = parseFloat(serviceFeeData.amountPaid || 0);
        serviceFeeDue = parseFloat(serviceFeeData.totalAmount || 0);
        if (serviceFeeDue > 0) {
          paymentBreakdown.push({
            type: 'Service Fee',
            paid: serviceFeePaid,
            due: serviceFeeDue
          });
        }
      }
    } catch (e) {}

    performanceData.push({
      id: member.id,
      name: member.fullName || "Unknown",
      totalPaid,
      totalArrears,
      paymentRate: parseFloat(paymentRate),
      status: parseFloat(paymentRate) >= 80 ? "good" : parseFloat(paymentRate) >= 50 ? "warning" : "danger",
      paymentBreakdown,
      seedMoneyPaid,
      monthlyPaid,
      serviceFeePaid,
    });
  }

  // Sort by payment rate descending
  performanceData.sort((a, b) => b.paymentRate - a.paymentRate);
  analyticsData.memberPerformance = performanceData;
}

// Update analytics UI
function updateAnalyticsUI() {
  if (totalIncomeEl) totalIncomeEl.textContent = formatCurrency(analyticsData.totalIncome);
  if (totalExpensesEl) totalExpensesEl.textContent = formatCurrency(analyticsData.totalExpenses);
  if (netProfitEl) netProfitEl.textContent = formatCurrency(analyticsData.netProfit);
  if (loanInterestEl) loanInterestEl.textContent = formatCurrency(analyticsData.loanInterest);
}

// Render pie charts
function renderChart() {
  if (!chartContainer) return;

  // Calculate totals from analytics data
  const totalCollected = analyticsData.totalIncome || 0;
  
  // Calculate total arrears from all payment records
  let totalArrears = 0;
  let totalDue = 0;
  
  // Sum up arrears from member performance or calculate from payments
  if (analyticsData.memberPerformance && analyticsData.memberPerformance.length > 0) {
    analyticsData.memberPerformance.forEach((member) => {
      totalArrears += member.totalArrears || 0;
      totalDue += (member.totalPaid || 0) + (member.totalArrears || 0);
    });
  }
  
  // Calculate breakdown by payment type
  let seedMoneyPaid = 0;
  let seedMoneyDue = 0;
  let monthlyPaid = 0;
  let monthlyDue = 0;
    let serviceFeePaid = 0;
    let serviceFeeDue = 0;

  analyticsData.memberPerformance.forEach((member) => {
    if (member.paymentBreakdown) {
      member.paymentBreakdown.forEach((item) => {
        if (item.type === 'Seed Money') {
          seedMoneyPaid += item.paid || 0;
          seedMoneyDue += item.due || 0;
        } else if (item.type?.includes('Monthly')) {
          monthlyPaid += item.paid || 0;
          monthlyDue += item.due || 0;
          } else if (item.type === 'Service Fee') {
            serviceFeePaid += item.paid || 0;
            serviceFeeDue += item.due || 0;
        }
      });
    }
  });

  // Use calculated totalDue or calculate from collected + arrears
  if (totalDue === 0) {
    totalDue = totalCollected + totalArrears;
  }
  const paymentProgress = totalDue > 0 ? (totalCollected / totalDue) * 100 : 0;
  const seedMoneyProgress = seedMoneyDue > 0 ? (seedMoneyPaid / seedMoneyDue) * 100 : 0;
  const monthlyProgress = monthlyDue > 0 ? (monthlyPaid / monthlyDue) * 100 : 0;

  let chartHTML = '';

  // Chart 1: Overall Payment Status (Paid vs Left)
  if (totalDue > 0) {
    chartHTML += createPieChart(
      'overall-payment-chart',
      'Overall Payment Status',
      [
        { label: 'Paid', value: totalCollected, color: 'var(--bn-success)', percentage: paymentProgress },
        { label: 'Remaining', value: totalArrears, color: 'var(--bn-danger)', percentage: 100 - paymentProgress }
      ],
      totalDue,
      'Total Due'
    );
  }

  // Chart 2: Seed Money Status
  if (seedMoneyDue > 0) {
    chartHTML += createPieChart(
      'seed-money-chart',
      'Seed Money Status',
      [
        { label: 'Paid', value: seedMoneyPaid, color: 'var(--bn-success)', percentage: seedMoneyProgress },
        { label: 'Remaining', value: seedMoneyDue - seedMoneyPaid, color: 'var(--bn-danger)', percentage: 100 - seedMoneyProgress }
      ],
      seedMoneyDue,
      'Seed Money'
    );
  }

  // Chart 3: Monthly Contributions Status
  if (monthlyDue > 0) {
    chartHTML += createPieChart(
      'monthly-contributions-chart',
      'Monthly Contributions Status',
      [
        { label: 'Paid', value: monthlyPaid, color: 'var(--bn-success)', percentage: monthlyProgress },
        { label: 'Remaining', value: monthlyDue - monthlyPaid, color: 'var(--bn-danger)', percentage: 100 - monthlyProgress }
      ],
      monthlyDue,
      'Monthly Due'
    );
  }

  // Chart 4: Service Fee Status (if service fee is enabled)
  const serviceFeeProgress = serviceFeeDue > 0 ? (serviceFeePaid / serviceFeeDue) * 100 : 0;
  if (serviceFeeDue > 0) {
    chartHTML += createPieChart(
      'service-fee-chart',
      'Service Fee Status',
      [
        { label: 'Paid', value: serviceFeePaid, color: 'var(--bn-info)', percentage: serviceFeeProgress },
        { label: 'Remaining', value: serviceFeeDue - serviceFeePaid, color: 'var(--bn-warning)', percentage: 100 - serviceFeeProgress }
      ],
      serviceFeeDue,
      'Service Fee'
    );
  }

  // Chart 5: Income vs Expenses (if available)
  if (analyticsData.totalExpenses > 0 || analyticsData.totalIncome > 0) {
    const totalFinancial = analyticsData.totalIncome + analyticsData.totalExpenses;
    const incomePercentage = totalFinancial > 0 ? (analyticsData.totalIncome / totalFinancial) * 100 : 0;
    
    chartHTML += createPieChart(
      'income-expenses-chart',
      'Income vs Expenses',
      [
        { label: 'Collections', value: analyticsData.totalIncome, color: 'var(--bn-accent)', percentage: incomePercentage },
        { label: 'Disbursements', value: analyticsData.totalExpenses, color: 'var(--bn-gray-600)', percentage: 100 - incomePercentage }
      ],
      totalFinancial,
      'Total'
    );
  }

  if (chartHTML) {
    chartContainer.innerHTML = chartHTML;
    
    // Animate pie charts after render
    setTimeout(() => {
      chartContainer.querySelectorAll('.pie-chart-svg').forEach((svg, index) => {
        setTimeout(() => {
          svg.style.opacity = '1';
          // Segments are already positioned correctly via stroke-dasharray
          // Just animate opacity
          svg.querySelectorAll('.pie-chart-segment').forEach((segment, segIndex) => {
            setTimeout(() => {
              segment.style.opacity = '1';
            }, segIndex * 200);
          });
        }, index * 300);
      });
    }, 100);
  } else {
    chartContainer.innerHTML = `
      <div class="empty-state" style="width: 100%;">
        <div class="empty-state-icon">📊</div>
        <p class="empty-state-text">No financial data available yet</p>
        <p style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-2);">
          Data will appear after members make payments
        </p>
      </div>
    `;
  }
}

// Create a pie chart using SVG paths
function createPieChart(id, title, segments, total, centerLabel) {
  const radius = 80;
  const centerX = 120;
  const centerY = 120;
  
  let segmentsHTML = '';
  let legendHTML = '';
  let currentAngle = -90; // Start at top (12 o'clock)
  
  segments.forEach((segment, index) => {
    const percentage = Math.min(segment.percentage || 0, 100);
    if (percentage <= 0) return;
    
    // Calculate angles for this segment
    const angle = (percentage / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle += angle;
    
    // Convert to radians
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    
    // Calculate path coordinates
    const x1 = centerX + radius * Math.cos(startRad);
    const y1 = centerY + radius * Math.sin(startRad);
    const x2 = centerX + radius * Math.cos(endRad);
    const y2 = centerY + radius * Math.sin(endRad);
    
    // Large arc flag (1 if angle > 180, 0 otherwise)
    const largeArcFlag = angle > 180 ? 1 : 0;
    
    // Create path for this segment (pie slice)
    const pathData = [
      `M ${centerX} ${centerY}`, // Move to center
      `L ${x1} ${y1}`, // Line to start point
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`, // Arc to end point
      'Z' // Close path back to center
    ].join(' ');
    
    segmentsHTML += `
      <path
        class="pie-chart-segment"
        d="${pathData}"
        fill="${segment.color}"
        stroke="var(--bn-white)"
        stroke-width="2"
        data-percentage="${percentage.toFixed(1)}"
        style="opacity: 0; transition: opacity 0.8s ease;"
      />
    `;
    
    legendHTML += `
      <div class="legend-item" style="display: flex; align-items: center; gap: var(--bn-space-2);">
        <span class="legend-dot" style="background: ${segment.color}; width: 12px; height: 12px; border-radius: 50%;"></span>
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: var(--bn-text-sm); color: var(--bn-gray-700);">${segment.label}:</span>
          <span style="font-weight: 600; color: var(--bn-dark); margin-left: var(--bn-space-2);">${formatCurrency(segment.value)}</span>
        </div>
      </div>
    `;
  });

  // Calculate paid percentage for center display
  const paidPercentage = segments.find(s => s.label === 'Paid' || s.label === 'Collections')?.percentage || 0;
  
  return `
    <div class="pie-chart-container">
      <div class="pie-chart-title">${title}</div>
      <div class="pie-chart-wrapper">
        <svg class="pie-chart-svg" viewBox="0 0 240 240" style="opacity: 0; transition: opacity 0.5s ease; width: 100%; height: 100%;">
          ${segmentsHTML}
        </svg>
        <div class="pie-chart-center">
          <div class="pie-chart-center-value">${paidPercentage.toFixed(0)}%</div>
          <div class="pie-chart-center-label">${centerLabel}</div>
          <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-1);">${formatCurrencyShort(total)}</div>
        </div>
      </div>
      <div class="pie-chart-legend">
        ${legendHTML}
      </div>
    </div>
  `;
}

// Format currency for chart center (shortened)
function formatCurrencyShort(amount) {
  const value = parseFloat(amount) || 0;
  if (value >= 1000000) {
    return `MWK ${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `MWK ${(value / 1000).toFixed(1)}K`;
  }
  return `MWK ${value.toLocaleString('en-US')}`;
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
    
    // Build payment breakdown text
    let paymentDetails = [];
    if (member.paymentBreakdown && member.paymentBreakdown.length > 0) {
      member.paymentBreakdown.forEach(item => {
        if (item.paid > 0) {
          paymentDetails.push(`${item.type}: ${formatCurrency(item.paid)}`);
        }
      });
    }
    
    // Fallback if no breakdown but has totals
    if (paymentDetails.length === 0 && member.totalPaid > 0) {
      if (member.seedMoneyPaid > 0) {
        paymentDetails.push(`Seed Money: ${formatCurrency(member.seedMoneyPaid)}`);
      }
      if (member.monthlyPaid > 0) {
        paymentDetails.push(`Monthly: ${formatCurrency(member.monthlyPaid)}`);
      }
      if (paymentDetails.length === 0) {
        paymentDetails.push('Contributions');
      }
    }
    
    const paymentDetailsText = paymentDetails.length > 0 
      ? paymentDetails.slice(0, 2).join(', ') + (paymentDetails.length > 2 ? '...' : '')
      : 'No payments yet';
    
    html += `
      <div class="performance-item">
        <div class="performance-rank">${medal || (index + 1)}</div>
        <div class="performance-info">
          <div class="performance-name">${member.name}</div>
          <div class="performance-stats">
            <span class="text-success">Paid: ${formatCurrency(member.totalPaid)}</span>
            ${member.totalArrears > 0 ? `<span class="text-danger">Arrears: ${formatCurrency(member.totalArrears)}</span>` : ''}
          </div>
          <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-1);">
            ${paymentDetailsText}
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
    console.warn("Toast container not found:", message);
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
