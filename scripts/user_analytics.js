/**
 * User Analytics - Contributions, loans, and booking system
 */

import {
  db,
  auth,
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  onAuthStateChanged,
  query,
  where,
  orderBy,
  Timestamp,
} from "./firebaseConfig.js";

let currentUser = null;
let userGroups = [];
let currentGroupId = null;

document.addEventListener("DOMContentLoaded", () => {
  const groupSelector = document.getElementById("groupSelector");
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");
  const bookLoanBtn = document.getElementById("bookLoanBtn");
  const bookLoanModal = document.getElementById("bookLoanModal");
  const closeBookLoanModal = document.getElementById("closeBookLoanModal");
  const bookLoanForm = document.getElementById("bookLoanForm");

  // Auth state
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    currentUser = user;
    await loadUserGroups();
  });

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      
      // Update buttons
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      // Update content
      tabContents.forEach(content => {
        content.classList.remove("active");
        content.style.display = "none";
      });
      
      const activeTab = document.getElementById(`${tab}Tab`);
      if (activeTab) {
        activeTab.classList.add("active");
        activeTab.style.display = "block";
      }

      // Load data for active tab
      if (currentGroupId) {
        if (tab === "contributions") {
          loadContributions();
        } else if (tab === "loans") {
          loadLoans();
        } else if (tab === "bookings") {
          loadBookings();
        }
      }
    });
  });

  // Group selector
  if (groupSelector) {
    groupSelector.addEventListener("change", async (e) => {
      currentGroupId = e.target.value;
      if (currentGroupId) {
        const activeTab = document.querySelector(".tab-btn.active");
        if (activeTab) {
          const tab = activeTab.dataset.tab;
          if (tab === "contributions") {
            await loadContributions();
          } else if (tab === "loans") {
            await loadLoans();
          } else if (tab === "bookings") {
            await loadBookings();
          }
        } else {
          // Default to contributions if no tab active
          await loadContributions();
        }
        // Reload user overall stats after group change
        await loadUserOverallStats();
      } else {
        // Hide group stats when no group selected
        document.getElementById("groupStatsSection").style.display = "none";
        // Clear chart
        const chartContainer = document.getElementById("chartContainer");
        if (chartContainer) {
          chartContainer.innerHTML = `
            <div class="empty-state" style="width: 100%;">
              <div class="empty-state-icon">📊</div>
              <p class="empty-state-text">Select a group to view contribution trends</p>
            </div>
          `;
        }
      }
    });
  }

  // Book loan button
  if (bookLoanBtn) {
    bookLoanBtn.addEventListener("click", () => {
      if (!currentGroupId) {
        alert("Please select a group first.");
        return;
      }
      openModal(bookLoanModal);
    });
  }

  // Close modal
  if (closeBookLoanModal) {
    closeBookLoanModal.addEventListener("click", () => closeModal(bookLoanModal));
  }

  // Book loan form
  if (bookLoanForm) {
    bookLoanForm.addEventListener("submit", handleBookLoan);
  }

  /**
   * Load user groups and calculate overall stats
   */
  async function loadUserGroups() {
    try {
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      if (!userDoc.exists()) return;

      const userData = userDoc.data();
      const groupMemberships = userData.groupMemberships || [];

      userGroups = [];
      for (const membership of groupMemberships) {
        const groupDoc = await getDoc(doc(db, "groups", membership.groupId));
        if (groupDoc.exists()) {
          userGroups.push({ ...groupDoc.data(), id: membership.groupId });
        }
      }

      // Populate selector
      if (groupSelector) {
        groupSelector.innerHTML = '<option value="">Select a group...</option>';
        userGroups.forEach(group => {
          const option = document.createElement("option");
          option.value = group.id;
          option.textContent = group.groupName;
          groupSelector.appendChild(option);
        });

        // Auto-select first group and load data
        if (userGroups.length > 0) {
          groupSelector.value = userGroups[0].id;
          currentGroupId = userGroups[0].id;
          // Load contributions (which includes the trend chart)
          await loadContributions();
        }
      }

      // Load overall user stats across all groups
      await loadUserOverallStats();
    } catch (error) {
      console.error("Error loading groups:", error);
    }
  }

  /**
   * Load user overall stats across all groups
   */
  async function loadUserOverallStats() {
    try {
      let totalContributed = 0;
      let totalBorrowed = 0;
      let totalLoanOutstanding = 0;
      let totalArrears = 0;
      let activeLoansCount = 0;
      const currentYear = new Date().getFullYear();
      const previousYear = currentYear - 1;
      const years = [previousYear, currentYear]; // Check both current and previous year

      // Calculate stats across all groups
      for (const group of userGroups) {
        const groupId = group.id;

        try {
          // Calculate contributions and arrears from actual payment records
          for (const year of years) {
            // Get monthly contributions
            for (let month = 1; month <= 12; month++) {
              const monthNames = ["January", "February", "March", "April", "May", "June", 
                                "July", "August", "September", "October", "November", "December"];
              const monthName = monthNames[month - 1];
              
              try {
                const monthlyRef = doc(db, `groups/${groupId}/payments/${year}_MonthlyContributions/${currentUser.uid}/${year}_${monthName}`);
                const monthlyDoc = await getDoc(monthlyRef);
                
                if (monthlyDoc.exists()) {
                  const monthlyData = monthlyDoc.data();
                  const amountPaid = parseFloat(monthlyData.amountPaid || 0);
                  const arrears = parseFloat(monthlyData.arrears || 0);
                  
                  // Only count approved or completed payments
                  if (monthlyData.approvalStatus === "approved" || monthlyData.paymentStatus === "Paid" || monthlyData.paymentStatus === "Completed") {
                    totalContributed += amountPaid;
                  }
                  
                  // Only count arrears if payment is overdue (check dueDate)
                  if (arrears > 0 && monthlyData.dueDate) {
                    const dueDate = monthlyData.dueDate.toDate ? monthlyData.dueDate.toDate() : new Date(monthlyData.dueDate);
                    if (dueDate < new Date()) {
                      totalArrears += arrears;
                    }
                  }
                }
              } catch (error) {
                // Skip if document doesn't exist
              }
            }
            
            // Get seed money contributions
            try {
              const seedMoneyRef = doc(db, `groups/${groupId}/payments/${year}_SeedMoney/${currentUser.uid}/PaymentDetails`);
              const seedMoneyDoc = await getDoc(seedMoneyRef);
              
              if (seedMoneyDoc.exists()) {
                const seedData = seedMoneyDoc.data();
                const amountPaid = parseFloat(seedData.amountPaid || 0);
                const arrears = parseFloat(seedData.arrears || 0);
                
                // Only count approved payments
                if (seedData.approvalStatus === "approved" || seedData.paymentStatus === "Paid") {
                  totalContributed += amountPaid;
                }
                
                // Only count arrears if payment is overdue
                if (arrears > 0 && seedData.dueDate) {
                  const dueDate = seedData.dueDate.toDate ? seedData.dueDate.toDate() : new Date(seedData.dueDate);
                  if (dueDate < new Date()) {
                    totalArrears += arrears;
                  }
                }
              }
            } catch (error) {
              // Skip if document doesn't exist
            }
            
            // Get service fee contributions
            try {
              const serviceFeeRef = doc(db, `groups/${groupId}/payments/${year}_ServiceFee/${currentUser.uid}/PaymentDetails`);
              const serviceFeeDoc = await getDoc(serviceFeeRef);
              
              if (serviceFeeDoc.exists()) {
                const feeData = serviceFeeDoc.data();
                const amountPaid = parseFloat(feeData.amountPaid || 0);
                const arrears = parseFloat(feeData.arrears || 0);
                
                // Only count approved payments
                if (feeData.approvalStatus === "approved" || feeData.paymentStatus === "Paid") {
                  totalContributed += amountPaid;
                }
                
                // Only count arrears if payment is overdue
                if (arrears > 0 && feeData.dueDate) {
                  const dueDate = feeData.dueDate.toDate ? feeData.dueDate.toDate() : new Date(feeData.dueDate);
                  if (dueDate < new Date()) {
                    totalArrears += arrears;
                  }
                }
              }
            } catch (error) {
              // Skip if document doesn't exist
            }
          }

          // Get user's loans (all time, not just current year)
          const loansRef = collection(db, `groups/${groupId}/loans`);
          const userLoansQuery = query(loansRef, where("borrowerId", "==", currentUser.uid));
          const loansSnapshot = await getDocs(userLoansQuery);

          loansSnapshot.forEach(loanDoc => {
            const loan = loanDoc.data();
            const amount = parseFloat(loan.amount || loan.loanAmount || 0);
            const repaid = parseFloat(loan.amountRepaid || 0);
            const totalRepayable = parseFloat(loan.totalRepayable || (amount + parseFloat(loan.totalInterest || 0)));
            
            // Only count active/disbursed loans
            if (loan.status === "active") {
              totalBorrowed += amount;
              const outstanding = Math.max(0, totalRepayable - repaid);
              totalLoanOutstanding += outstanding;
              activeLoansCount++;
            }
          });
        } catch (error) {
          console.error(`Error loading stats for group ${groupId}:`, error);
        }
      }

      // Update page-stats (top bar)
      document.getElementById("totalContributed").textContent = formatCurrency(totalContributed);
      document.getElementById("totalBorrowed").textContent = formatCurrency(totalBorrowed);
      document.getElementById("outstanding").textContent = formatCurrency(totalLoanOutstanding);
      document.getElementById("totalArrears").textContent = formatCurrency(totalArrears);

      // Update user overview stats
      document.getElementById("userTotalContributed").textContent = formatCurrency(totalContributed);
      document.getElementById("userTotalLoans").textContent = formatCurrency(totalBorrowed);
      document.getElementById("userLoanOutstanding").textContent = formatCurrency(totalLoanOutstanding);
      document.getElementById("userTotalArrears").textContent = formatCurrency(totalArrears);
      document.getElementById("userActiveLoans").textContent = activeLoansCount;
      document.getElementById("userGroupsCount").textContent = userGroups.length;
      
      console.log("User Overall Stats Loaded:", {
        totalContributed,
        totalBorrowed,
        totalLoanOutstanding,
        totalArrears,
        activeLoansCount,
        groupsCount: userGroups.length
      });
    } catch (error) {
      console.error("Error loading user overall stats:", error);
    }
  }

  /**
   * Load contributions data
   */
  async function loadContributions() {
    if (!currentGroupId) return;

    try {
      const currentYear = new Date().getFullYear();
      const groupDoc = await getDoc(doc(db, "groups", currentGroupId));
      const groupData = groupDoc.data();
      
      const monthlyAmount = parseFloat(groupData?.rules?.monthlyContribution?.amount || 0);
      const seedMoneyAmount = parseFloat(groupData?.rules?.seedMoney?.amount || 0);

      // Get user's payments
      let userMonthlyTotal = 0;
      let userYearlyTotal = 0;
      let groupMonthlyTotal = 0;
      let groupYearlyTotal = 0;
      const monthlyBreakdown = [];
      const contributionHistory = [];

      // Get all members to calculate group totals
      const membersSnapshot = await getDocs(collection(db, `groups/${currentGroupId}/members`));
      
      // Calculate monthly contributions
      for (let month = 1; month <= 12; month++) {
        const monthName = new Date(currentYear, month - 1).toLocaleString("default", { month: "long" });
        let userMonthPaid = 0;
        let groupMonthPaid = 0;

        // User's monthly contribution - check new structure first
        const userMonthlyRef = doc(db, `groups/${currentGroupId}/payments/${currentYear}_MonthlyContributions/${currentUser.uid}/${currentYear}_${monthName}`);
        const userMonthlyDoc = await getDoc(userMonthlyRef);
        if (userMonthlyDoc.exists()) {
          const monthlyData = userMonthlyDoc.data();
          // Check new structure (amountPaid) or old structure (paid array)
          if (monthlyData.amountPaid !== undefined) {
            // New structure
            const amountPaid = parseFloat(monthlyData.amountPaid || 0);
            if (monthlyData.approvalStatus === "approved" || monthlyData.paymentStatus === "completed") {
              userMonthPaid = amountPaid;
              groupMonthPaid += amountPaid;
            }
          } else if (monthlyData.paid && Array.isArray(monthlyData.paid)) {
            // Old structure - array of payments
            const totalPaid = monthlyData.paid.reduce((sum, p) => {
              if (p.approvalStatus === "approved") {
                return sum + parseFloat(p.amount || 0);
              }
              return sum;
            }, 0);
            userMonthPaid = totalPaid;
            groupMonthPaid += totalPaid;
          }
        }

        // Group totals
        membersSnapshot.forEach(memberDoc => {
          const memberId = memberDoc.id;
          if (memberId !== currentUser.uid) {
            // This would need async iteration, but for now we'll calculate it differently
          }
        });

        monthlyBreakdown.push({
          month: monthName,
          expected: monthlyAmount,
          userPaid: userMonthPaid,
          groupPaid: groupMonthPaid
        });

        userYearlyTotal += userMonthPaid;
        groupYearlyTotal += groupMonthPaid;
      }

      // Get seed money
      const userSeedMoneyRef = doc(db, `groups/${currentGroupId}/payments/${currentYear}_SeedMoney/${currentUser.uid}/PaymentDetails`);
      const userSeedMoneyDoc = await getDoc(userSeedMoneyRef);
      if (userSeedMoneyDoc.exists()) {
        const seedMoneyData = userSeedMoneyDoc.data();
        const seedPaid = parseFloat(seedMoneyData.amountPaid || 0);
        userYearlyTotal += seedPaid;
      }

      // Get service fee (if enabled)
      const serviceFeeRef = doc(db, `groups/${currentGroupId}/payments/${currentYear}_ServiceFee/${currentUser.uid}/PaymentDetails`);
      const serviceFeeDoc = await getDoc(serviceFeeRef);
      if (serviceFeeDoc.exists()) {
        const serviceFeeData = serviceFeeDoc.data();
        const serviceFeePaid = parseFloat(serviceFeeData.amountPaid || 0);
        userYearlyTotal += serviceFeePaid;
      }

      // Update UI (if elements exist)
      const monthlyContributionEl = document.getElementById("monthlyContribution");
      if (monthlyContributionEl) monthlyContributionEl.textContent = formatCurrency(monthlyAmount);
      
      const yearlyTotalEl = document.getElementById("yearlyTotal");
      if (yearlyTotalEl) yearlyTotalEl.textContent = formatCurrency(userYearlyTotal);
      
      const yourContributionsEl = document.getElementById("yourContributions");
      if (yourContributionsEl) yourContributionsEl.textContent = formatCurrency(userYearlyTotal);
      
      const groupTotalEl = document.getElementById("groupTotal");
      if (groupTotalEl) groupTotalEl.textContent = formatCurrency(groupYearlyTotal);

      // Update group stats
      await updateGroupStats(currentGroupId, userYearlyTotal);

      displayMonthlyBreakdown(monthlyBreakdown);
      displayContributionHistory(contributionHistory);
      renderContributionTrendChart(monthlyBreakdown);
      
      // Load recent activity
      await loadRecentActivity(currentGroupId);
      
      // Reload user overall stats to ensure accuracy
      await loadUserOverallStats();
    } catch (error) {
      console.error("Error loading contributions:", error);
    }
  }

  /**
   * Render contribution trend bar chart
   */
  function renderContributionTrendChart(monthlyBreakdown) {
    const chartContainer = document.getElementById("chartContainer");
    if (!chartContainer) return;

    if (!monthlyBreakdown || monthlyBreakdown.length === 0) {
      chartContainer.innerHTML = `
        <div class="empty-state" style="width: 100%;">
          <div class="empty-state-icon">📊</div>
          <p class="empty-state-text">No contribution data available yet</p>
        </div>
      `;
      return;
    }

    // Get last 6 months for the chart (or all available months) - filter to show months with data
    const monthsWithData = monthlyBreakdown.filter(m => (m.userPaid || 0) > 0 || (m.expected || 0) > 0);
    const monthsToShow = monthsWithData.length > 0 ? monthsWithData.slice(-6) : monthlyBreakdown.slice(-6);
    
    // Calculate max amount from both userPaid and expected to ensure bars are visible
    const maxAmount = Math.max(
      ...monthsToShow.map(m => Math.max(m.userPaid || 0, m.expected || 0)),
      1
    );

    let chartHTML = '';
    if (monthsToShow.length > 0) {
      monthsToShow.forEach(monthData => {
        const paidAmount = monthData.userPaid || 0;
        const expectedAmount = monthData.expected || 0;
        const percentage = expectedAmount > 0 ? (paidAmount / expectedAmount) * 100 : 0;
        const barHeight = maxAmount > 0 ? (paidAmount / maxAmount) * 100 : 0;

        const monthLabel = monthData.month.substring(0, 3); // Short month name

        chartHTML += `
          <div class="chart-bar-wrapper">
            <div class="chart-bar" style="height: 160px; --bar-height: ${Math.max(barHeight, 2)}%;" data-amount="${paidAmount}" data-expected="${expectedAmount}" title="${monthData.month}: ${formatCurrency(paidAmount)} / ${formatCurrency(expectedAmount)}">
            </div>
            <span class="chart-label">${monthLabel}</span>
          </div>
        `;
      });
    } else {
      // Show placeholder bars if no data
      const currentMonth = new Date().getMonth();
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      for (let i = 5; i >= 0; i--) {
        const monthIndex = (currentMonth - i + 12) % 12;
        chartHTML += `
          <div class="chart-bar-wrapper">
            <div class="chart-bar" style="height: 160px; --bar-height: 0%;" title="No data">
            </div>
            <span class="chart-label">${monthNames[monthIndex]}</span>
          </div>
        `;
      }
    }

    chartContainer.innerHTML = chartHTML;

    // Animate bars after a short delay
    setTimeout(() => {
      chartContainer.querySelectorAll('.chart-bar').forEach(bar => {
        bar.classList.add('animated');
      });
    }, 100);
  }

  /**
   * Display monthly breakdown
   */
  function displayMonthlyBreakdown(breakdown) {
    const container = document.getElementById("monthlyBreakdown");
    if (!container) return;

    if (breakdown.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><p class="empty-state-text">No breakdown available</p></div>';
      return;
    }

    container.innerHTML = '';
    breakdown.forEach(month => {
      const div = document.createElement("div");
      div.className = "list-item";
      const paidPercent = month.expected > 0 ? (month.userPaid / month.expected) * 100 : 0;
      
      div.innerHTML = `
        <div style="flex: 1;">
          <div class="list-item-title">${month.month}</div>
          <div style="margin-top: 8px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.875rem;">
              <span>Expected: <strong>${formatCurrency(month.expected)}</strong></span>
              <span>Paid: <strong>${formatCurrency(month.userPaid)}</strong></span>
            </div>
            <div style="background: rgba(255, 255, 255, 0.1); border-radius: 4px; height: 8px; overflow: hidden;">
              <div style="background: ${paidPercent >= 100 ? 'var(--bn-success)' : 'var(--bn-primary)'}; height: 100%; width: ${Math.min(100, paidPercent)}%; transition: width 0.3s;"></div>
            </div>
            <div style="margin-top: 4px; font-size: 0.75rem; color: rgba(255, 255, 255, 0.7);">
              ${paidPercent.toFixed(1)}% complete
            </div>
          </div>
        </div>
      `;
      container.appendChild(div);
    });
  }

  /**
   * Display contribution history
   */
  function displayContributionHistory(history) {
    const container = document.getElementById("contributionHistory");
    if (!container) return;

    // This would be populated with actual payment history
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">No contribution history</p></div>';
  }

  /**
   * Load recent activity (payments, loans, etc.)
   */
  async function loadRecentActivity(groupId) {
    if (!groupId) {
      const recentActivityEl = document.getElementById("recentActivity");
      if (recentActivityEl) {
        recentActivityEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <p class="empty-state-text">Select a group to view recent activity</p>
          </div>
        `;
      }
      return;
    }

    try {
      const recentActivity = [];
      const currentYear = new Date().getFullYear();

      // Get recent monthly contribution payments
      try {
        const monthlyRef = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${currentUser.uid}`);
        const monthlySnapshot = await getDocs(monthlyRef);
        
        monthlySnapshot.forEach(monthDoc => {
          const monthData = monthDoc.data();
          const isApproved = monthData.approvalStatus === "approved" || monthData.paymentStatus === "completed";
          const amountPaid = parseFloat(monthData.amountPaid || 0);
          
          if (isApproved && amountPaid > 0) {
            const paidAt = monthData.paidAt || monthData.approvedAt || monthData.updatedAt;
            if (paidAt) {
              recentActivity.push({
                type: "Monthly Contribution",
                amount: amountPaid,
                date: paidAt,
                month: monthDoc.id
              });
            }
          }
        });
      } catch (error) {
        console.error("Error loading monthly contributions for recent activity:", error);
      }

      // Get seed money payment
      try {
        const seedRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${currentUser.uid}/PaymentDetails`);
        const seedDoc = await getDoc(seedRef);
        if (seedDoc.exists()) {
          const seedData = seedDoc.data();
          if (seedData.approvalStatus === "approved" && seedData.updatedAt) {
            recentActivity.push({
              type: "Seed Money",
              amount: parseFloat(seedData.amountPaid || 0),
              date: seedData.updatedAt
            });
          }
        }
      } catch (error) {
        console.error("Error loading seed money for recent activity:", error);
      }

      // Get service fee payment
      try {
        const serviceFeeRef = doc(db, `groups/${groupId}/payments/${currentYear}_ServiceFee/${currentUser.uid}/PaymentDetails`);
        const serviceFeeDoc = await getDoc(serviceFeeRef);
        if (serviceFeeDoc.exists()) {
          const serviceFeeData = serviceFeeDoc.data();
          const isApproved = serviceFeeData.approvalStatus === "approved" || serviceFeeData.paymentStatus === "completed";
          const amountPaid = parseFloat(serviceFeeData.amountPaid || 0);
          
          if (isApproved && amountPaid > 0) {
            const paidAt = serviceFeeData.paidAt || serviceFeeData.approvedAt || serviceFeeData.updatedAt;
            if (paidAt) {
              recentActivity.push({
                type: "Service Fee",
                amount: amountPaid,
                date: paidAt
              });
            }
          }
        }
      } catch (error) {
        console.error("Error loading service fee for recent activity:", error);
      }

      // Get loan payments
      try {
        const loansRef = collection(db, `groups/${groupId}/loans`);
        const userLoansQuery = query(loansRef, where("borrowerId", "==", currentUser.uid));
        const loansSnapshot = await getDocs(userLoansQuery);

        for (const loanDoc of loansSnapshot.docs) {
          const loanData = loanDoc.data();
          if (loanData.lastPaymentDate) {
            recentActivity.push({
              type: "Loan Payment",
              amount: parseFloat(loanData.lastPaymentAmount || 0),
              date: loanData.lastPaymentDate,
              loanId: loanDoc.id
            });
          }
        }
      } catch (error) {
        console.error("Error loading loan payments for recent activity:", error);
      }

      // Sort by date (most recent first)
      recentActivity.sort((a, b) => {
        const dateA = a.date?.toDate ? a.date.toDate() : new Date(a.date);
        const dateB = b.date?.toDate ? b.date.toDate() : new Date(b.date);
        return dateB - dateA;
      });

      // Display recent activity
      displayRecentActivity(recentActivity.slice(0, 10)); // Show last 10
    } catch (error) {
      console.error("Error loading recent activity:", error);
      const recentActivityEl = document.getElementById("recentActivity");
      if (recentActivityEl) {
        recentActivityEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">❌</div>
            <p class="empty-state-text">Error loading recent activity</p>
          </div>
        `;
      }
    }
  }

  /**
   * Display recent activity
   */
  function displayRecentActivity(activities) {
    const container = document.getElementById("recentActivity");
    if (!container) return;

    if (activities.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <p class="empty-state-text">No recent activity</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    activities.forEach(activity => {
      const div = document.createElement("div");
      div.className = "list-item";
      const activityDate = activity.date?.toDate ? activity.date.toDate().toLocaleDateString() : "N/A";
      
      const typeColors = {
        "Monthly Contribution": "var(--bn-primary)",
        "Seed Money": "var(--bn-success)",
        "Service Fee": "var(--bn-info)",
        "Loan Payment": "var(--bn-accent)"
      };
      
      div.innerHTML = `
        <div style="flex: 1;">
          <div class="list-item-title">${activity.type}</div>
          <div class="list-item-subtitle">${activityDate}${activity.month ? ` • ${activity.month}` : ''}</div>
        </div>
        <div>
          <span style="font-size: 1.125rem; font-weight: 700; color: ${typeColors[activity.type] || 'var(--bn-primary)'};">
            ${formatCurrency(activity.amount)}
          </span>
        </div>
      `;
      container.appendChild(div);
    });
  }

  /**
   * Load loans data
   */
  async function loadLoans() {
    if (!currentGroupId) return;

    try {
      // Get user's loans
      const loansRef = collection(db, `groups/${currentGroupId}/loans`);
      const q = query(
        loansRef,
        where("borrowerId", "==", currentUser.uid),
        orderBy("requestedAt", "desc")
      );
      const loansSnapshot = await getDocs(q);

      const userLoans = [];
      let totalOutstanding = 0;
      let totalPaid = 0;

      loansSnapshot.forEach(loanDoc => {
        const loan = { id: loanDoc.id, ...loanDoc.data() };
        userLoans.push(loan);
        totalOutstanding += parseFloat(loan.amountRemaining || 0);
        totalPaid += parseFloat(loan.amountPaid || 0);
      });

      // Get all disbursed loans
      const allLoansQ = query(
        loansRef,
        where("status", "in", ["approved", "disbursed", "active"]),
        orderBy("disbursedAt", "desc")
      );
      const allLoansSnapshot = await getDocs(allLoansQ);
      const disbursedLoans = [];
      let nextDisbursement = 0;

      allLoansSnapshot.forEach(loanDoc => {
        const loan = { id: loanDoc.id, ...loanDoc.data() };
        disbursedLoans.push(loan);
        nextDisbursement += parseFloat(loan.loanAmount || 0);
      });

      // Update stats (if elements exist)
      const activeLoansCountEl = document.getElementById("activeLoansCount");
      if (activeLoansCountEl) activeLoansCountEl.textContent = userLoans.filter(l => l.status === "active" || l.status === "approved").length;
      
      const outstandingLoansEl = document.getElementById("outstandingLoans");
      if (outstandingLoansEl) outstandingLoansEl.textContent = formatCurrency(totalOutstanding);
      
      const totalLoansPaidEl = document.getElementById("totalLoansPaid");
      if (totalLoansPaidEl) totalLoansPaidEl.textContent = formatCurrency(totalPaid);
      
      const nextDisbursementEl = document.getElementById("nextDisbursement");
      if (nextDisbursementEl) nextDisbursementEl.textContent = formatCurrency(nextDisbursement);

      await displayDisbursedLoans(disbursedLoans);
      displayYourLoans(userLoans);
      
      // Reload user overall stats to ensure accuracy
      await loadUserOverallStats();
    } catch (error) {
      console.error("Error loading loans:", error);
    }
  }

  /**
   * Display disbursed loans
   */
  async function displayDisbursedLoans(loans) {
    const container = document.getElementById("disbursedLoans");
    if (!container) return;

    if (loans.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💰</div><p class="empty-state-text">No loans being disbursed</p></div>';
      return;
    }

    container.innerHTML = '';
    
    // Fetch account information for each loan borrower
    const loansWithAccounts = await Promise.all(loans.slice(0, 10).map(async (loan) => {
      let accountInfo = '';
      try {
        if (loan.borrowerId && currentGroupId) {
          const memberRef = doc(db, `groups/${currentGroupId}/members`, loan.borrowerId);
          const memberDoc = await getDoc(memberRef);
          if (memberDoc.exists()) {
            const memberData = memberDoc.data();
            if (memberData.accountNumber || memberData.bankName) {
              const accountNumber = memberData.accountNumber ? `****${memberData.accountNumber.slice(-4)}` : '';
              const bankName = memberData.bankName || '';
              accountInfo = accountNumber && bankName 
                ? `<div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: 4px;">Account: ${accountNumber} (${bankName})</div>`
                : accountNumber 
                  ? `<div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: 4px;">Account: ${accountNumber}</div>`
                  : bankName
                    ? `<div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: 4px;">Bank: ${bankName}</div>`
                    : '';
            }
          }
        }
      } catch (error) {
        console.error('Error fetching account info:', error);
      }
      return { loan, accountInfo };
    }));

    loansWithAccounts.forEach(({ loan, accountInfo }) => {
      const div = document.createElement("div");
      div.className = "list-item";
      const disbursedDate = loan.disbursedAt?.toDate ? loan.disbursedAt.toDate().toLocaleDateString() : "N/A";
      
      div.innerHTML = `
        <div style="flex: 1;">
          <div class="list-item-title">${loan.borrowerName || "Unknown"}</div>
          <div class="list-item-subtitle">Disbursed ${disbursedDate}</div>
          ${accountInfo}
          <div style="margin-top: 8px; font-size: 1.125rem; font-weight: 700; color: var(--bn-primary);">
            ${formatCurrency(loan.loanAmount || 0)}
          </div>
        </div>
      `;
      container.appendChild(div);
    });
  }

  /**
   * Display user's loans
   */
  function displayYourLoans(loans) {
    const container = document.getElementById("yourLoans");
    if (!container) return;

    if (loans.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">No loans found</p></div>';
      return;
    }

    container.innerHTML = '';
    loans.forEach(loan => {
      const div = document.createElement("div");
      div.className = "list-item";
      const requestedDate = loan.requestedAt?.toDate ? loan.requestedAt.toDate().toLocaleDateString() : "N/A";
      const progress = loan.totalRepayable > 0 ? (loan.amountPaid / loan.totalRepayable) * 100 : 0;
      
      div.innerHTML = `
        <div style="flex: 1;">
          <div class="list-item-title">Loan #${loan.id.substring(0, 8)}</div>
          <div class="list-item-subtitle">${loan.purpose || "Not specified"} • Requested ${requestedDate}</div>
          <div style="margin-top: 12px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.875rem;">
              <span>Amount: <strong>${formatCurrency(loan.loanAmount || 0)}</strong></span>
              <span>Paid: <strong>${formatCurrency(loan.amountPaid || 0)}</strong></span>
            </div>
            <div style="background: rgba(255, 255, 255, 0.1); border-radius: 4px; height: 8px; overflow: hidden;">
              <div style="background: var(--bn-primary); height: 100%; width: ${Math.min(100, progress)}%;"></div>
            </div>
            <div style="margin-top: 4px; font-size: 0.75rem; color: rgba(255, 255, 255, 0.7);">
              ${progress.toFixed(1)}% complete • Remaining: ${formatCurrency(loan.amountRemaining || 0)}
            </div>
          </div>
        </div>
        <div>
          <span class="badge badge-${loan.status === "active" ? "success" : "warning"}">${loan.status}</span>
        </div>
      `;
      container.appendChild(div);
    });
  }

  /**
   * Load bookings
   */
  async function loadBookings() {
    if (!currentGroupId) return;

    try {
      // Get user's bookings
      const bookingsRef = collection(db, `groups/${currentGroupId}/loanBookings`);
      const userBookingsQ = query(
        bookingsRef,
        where("memberId", "==", currentUser.uid),
        orderBy("createdAt", "desc")
      );
      const userBookingsSnapshot = await getDocs(userBookingsQ);

      const userBookings = [];
      userBookingsSnapshot.forEach(bookingDoc => {
        userBookings.push({ id: bookingDoc.id, ...bookingDoc.data() });
      });

      // Get all bookings (queue)
      const allBookingsQ = query(
        bookingsRef,
        orderBy("createdAt", "asc")
      );
      const allBookingsSnapshot = await getDocs(allBookingsQ);
      const allBookings = [];

      for (const bookingDoc of allBookingsSnapshot.docs) {
        const booking = { id: bookingDoc.id, ...bookingDoc.data() };
        // Get member name
        const memberDoc = await getDoc(doc(db, `groups/${currentGroupId}/members`, booking.memberId));
        if (memberDoc.exists()) {
          booking.memberName = memberDoc.data().fullName || "Unknown";
        }
        allBookings.push(booking);
      }

      displayYourBookings(userBookings);
      displayBookingQueue(allBookings);
    } catch (error) {
      console.error("Error loading bookings:", error);
    }
  }

  /**
   * Display user's bookings
   */
  function displayYourBookings(bookings) {
    const container = document.getElementById("yourBookings");
    if (!container) return;

    if (bookings.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div><p class="empty-state-text">No bookings found</p></div>';
      return;
    }

    container.innerHTML = '';
    bookings.forEach(booking => {
      const div = document.createElement("div");
      div.className = "list-item";
      const createdDate = booking.createdAt?.toDate ? booking.createdAt.toDate().toLocaleDateString() : "N/A";
      
      div.innerHTML = `
        <div style="flex: 1;">
          <div class="list-item-title">${booking.preferredAmount ? formatCurrency(booking.preferredAmount) : "Any Amount"}</div>
          <div class="list-item-subtitle">${booking.purpose || "Not specified"} • Booked ${createdDate}</div>
          ${booking.description ? `<div style="margin-top: 4px; font-size: 0.875rem; color: rgba(255, 255, 255, 0.7);">${booking.description}</div>` : ''}
        </div>
        <div>
          <span class="badge badge-${booking.status === "pending" ? "warning" : booking.status === "approved" ? "success" : "secondary"}">${booking.status || "pending"}</span>
        </div>
      `;
      container.appendChild(div);
    });
  }

  /**
   * Display booking queue
   */
  function displayBookingQueue(bookings) {
    const container = document.getElementById("bookingQueue");
    if (!container) return;

    if (bookings.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><p class="empty-state-text">No bookings in queue</p></div>';
      return;
    }

    container.innerHTML = '';
    bookings.forEach((booking, index) => {
      const div = document.createElement("div");
      div.className = "list-item";
      const createdDate = booking.createdAt?.toDate ? booking.createdAt.toDate().toLocaleDateString() : "N/A";
      const isCurrentUser = booking.memberId === currentUser.uid;
      
      div.innerHTML = `
        <div style="flex: 1;">
          <div class="list-item-title">
            ${index + 1}. ${booking.memberName || "Unknown"}${isCurrentUser ? " (You)" : ""}
          </div>
          <div class="list-item-subtitle">${booking.preferredAmount ? formatCurrency(booking.preferredAmount) : "Any Amount"} • ${booking.purpose || "Not specified"} • Booked ${createdDate}</div>
        </div>
        <div>
          <span class="badge badge-${booking.status === "pending" ? "warning" : booking.status === "approved" ? "success" : "secondary"}">${booking.status || "pending"}</span>
        </div>
      `;
      container.appendChild(div);
    });
  }

  /**
   * Handle book loan
   */
  async function handleBookLoan(e) {
    e.preventDefault();

    const preferredAmount = parseFloat(document.getElementById("preferredAmount").value);
    const purpose = document.getElementById("loanPurpose").value;
    const description = document.getElementById("loanDescription").value.trim();
    const preferredCycle = document.getElementById("preferredCycle").value;

    if (!purpose) {
      alert("Please select a loan purpose.");
      return;
    }

    try {
      const bookingData = {
        memberId: currentUser.uid,
        memberEmail: currentUser.email,
        preferredAmount: preferredAmount || null,
        purpose: purpose,
        description: description || "",
        preferredCycle: preferredCycle || null,
        status: "pending",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      const bookingsRef = collection(db, `groups/${currentGroupId}/loanBookings`);
      await addDoc(bookingsRef, bookingData);

      alert("Loan booking submitted successfully! You'll be notified when loans are available.");
      closeModal(bookLoanModal);
      bookLoanForm.reset();
      
      await loadBookings();
    } catch (error) {
      console.error("Error booking loan:", error);
      alert("Error submitting booking. Please try again.");
    }
  }

  /**
   * Format currency
   */
  function formatCurrency(amount) {
    return `MWK ${parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Modal functions
   */
  function openModal(modal) {
    if (modal) {
      modal.classList.remove("hidden");
      modal.classList.add("active");
    }
  }

  function closeModal(modal) {
    if (modal) {
      modal.classList.remove("active");
      modal.classList.add("hidden");
    }
  }
});
