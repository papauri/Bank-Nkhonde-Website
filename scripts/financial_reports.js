import {
  db,
  auth,
  collection,
  getDocs,
  doc,
  getDoc,
  onAuthStateChanged,
} from "./firebaseConfig.js";

document.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("backButton");
  const groupSelector = document.getElementById("groupSelector");
  const reportType = document.getElementById("reportType");
  const periodSelector = document.getElementById("periodSelector");
  const generateReportBtn = document.getElementById("generateReportBtn");
  
  // Report sections
  const reportSummary = document.getElementById("reportSummary");
  const reportDetails = document.getElementById("reportDetails");
  const exportSection = document.getElementById("exportSection");
  const chartsSection = document.getElementById("chartsSection");

  // Summary elements
  const totalIncome = document.getElementById("totalIncome");
  const totalDisbursed = document.getElementById("totalDisbursed");
  const netBalance = document.getElementById("netBalance");
  const activeMembers = document.getElementById("activeMembers");

  let currentGroupId = null;
  let currentReportData = null;

  // Navigate back
  backButton.addEventListener("click", () => {
    window.location.href = "admin_dashboard.html";
  });

  // Load admin groups
  async function loadAdminGroups(user) {
    try {
      const groupsSnapshot = await getDocs(collection(db, "groups"));
      groupSelector.innerHTML = '<option value="">Select a group...</option>';

      groupsSnapshot.forEach((doc) => {
        const groupData = doc.data();
        const isAdmin = groupData.admins?.some(
          (admin) => admin.uid === user.uid || admin.email === user.email
        );

        if (isAdmin) {
          const option = document.createElement("option");
          option.value = doc.id;
          option.textContent = groupData.groupName;
          groupSelector.appendChild(option);
        }
      });
    } catch (error) {
      console.error("Error loading groups:", error);
      alert("Error loading groups. Please try again.");
    }
  }

  // Populate period selector based on report type
  function populatePeriodSelector(type) {
    periodSelector.innerHTML = '<option value="">Select Period...</option>';

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();

    if (type === "monthly") {
      const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      
      months.forEach((month, index) => {
        const option = document.createElement("option");
        option.value = `${currentYear}_${month}`;
        option.textContent = `${month} ${currentYear}`;
        
        if (index === currentMonth) {
          option.selected = true;
        }
        
        periodSelector.appendChild(option);
      });
    } else if (type === "yearly") {
      for (let year = currentYear; year >= currentYear - 5; year--) {
        const option = document.createElement("option");
        option.value = year.toString();
        option.textContent = year.toString();
        periodSelector.appendChild(option);
      }
    } else if (type === "cycle") {
      // Load cycles from group data
      periodSelector.innerHTML = '<option value="">Loading cycles...</option>';
    }
  }

  // Generate report
  generateReportBtn.addEventListener("click", async () => {
    const groupId = groupSelector.value;
    const type = reportType.value;
    const period = periodSelector.value;

    if (!groupId) {
      alert("Please select a group");
      return;
    }

    if (!period) {
      alert("Please select a period");
      return;
    }

    await generateReport(groupId, type, period);
  });

  // Generate financial report
  async function generateReport(groupId, type, period) {
    try {
      currentGroupId = groupId;

      // Get group data
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      const groupData = groupDoc.data();

      // Get members
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      const members = membersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      let reportData = {
        groupName: groupData.groupName,
        type: type,
        period: period,
        generatedAt: new Date(),
        income: {
          seedMoney: 0,
          monthlyContributions: 0,
          loanRepayments: 0,
          penalties: 0,
          total: 0,
        },
        expenditure: {
          loansDisbursed: 0,
          withdrawals: 0,
          fees: 0,
          total: 0,
        },
        members: [],
        loans: [],
      };

      // Calculate income and expenditure based on period
      if (type === "monthly") {
        const [year, month] = period.split("_");
        reportData = await calculateMonthlyReport(groupId, year, month, members, reportData);
      } else if (type === "yearly") {
        reportData = await calculateYearlyReport(groupId, period, members, reportData);
      }

      currentReportData = reportData;

      // Display report
      displayReportSummary(reportData);
      displayReportDetails(reportData);
      displayCharts(reportData);

      // Show sections
      reportSummary.style.display = "block";
      reportDetails.style.display = "block";
      exportSection.style.display = "block";
      chartsSection.style.display = "block";

    } catch (error) {
      console.error("Error generating report:", error);
      alert("Error generating report. Please try again.");
    }
  }

  // Calculate monthly report
  async function calculateMonthlyReport(groupId, year, month, members, reportData) {
    const currentYear = new Date().getFullYear();

    // Calculate seed money (if in same year)
    if (parseInt(year) === currentYear) {
      for (const member of members) {
        const seedMoneyRef = doc(db, `groups/${groupId}/payments/${year}_SeedMoney/${member.id}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);

        if (seedMoneyDoc.exists()) {
          const payment = seedMoneyDoc.data();
          if (payment.paymentStatus === "Completed") {
            reportData.income.seedMoney += payment.amountPaid || 0;
          }
        }
      }
    }

    // Calculate monthly contributions
    for (const member of members) {
      const sanitizedName = member.fullName.replace(/\s+/g, "_");
      const monthlyRef = doc(db, `groups/${groupId}/payments/${year}_MonthlyContributions/${sanitizedName}/${year}_${month}`);
      const monthlyDoc = await getDoc(monthlyRef);

      if (monthlyDoc.exists()) {
        const payment = monthlyDoc.data();
        const totalPaid = payment.paid?.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0;
        
        if (payment.paymentStatus === "Completed" || totalPaid > 0) {
          reportData.income.monthlyContributions += totalPaid;
        }
      }
    }

    // Calculate total income
    reportData.income.total = 
      reportData.income.seedMoney + 
      reportData.income.monthlyContributions + 
      reportData.income.loanRepayments + 
      reportData.income.penalties;

    // Calculate loans disbursed (placeholder - would need actual transaction data)
    // This would query the transactions subcollection

    reportData.expenditure.total = 
      reportData.expenditure.loansDisbursed + 
      reportData.expenditure.withdrawals + 
      reportData.expenditure.fees;

    return reportData;
  }

  // Calculate yearly report
  async function calculateYearlyReport(groupId, year, members, reportData) {
    // This would aggregate data for the entire year
    // Similar to monthly but loops through all months
    return reportData;
  }

  // Display report summary
  function displayReportSummary(data) {
    totalIncome.textContent = `MWK ${data.income.total.toLocaleString()}`;
    totalDisbursed.textContent = `MWK ${data.expenditure.total.toLocaleString()}`;
    const balance = data.income.total - data.expenditure.total;
    netBalance.textContent = `MWK ${balance.toLocaleString()}`;
    activeMembers.textContent = data.members.length || "N/A";
  }

  // Display report details
  function displayReportDetails(data) {
    // Income breakdown
    const incomeBreakdown = document.getElementById("incomeBreakdown");
    incomeBreakdown.innerHTML = `
      <table class="styled-table">
        <thead>
          <tr><th>Source</th><th>Amount (MWK)</th></tr>
        </thead>
        <tbody>
          <tr><td>Seed Money</td><td>${data.income.seedMoney.toLocaleString()}</td></tr>
          <tr><td>Monthly Contributions</td><td>${data.income.monthlyContributions.toLocaleString()}</td></tr>
          <tr><td>Loan Repayments</td><td>${data.income.loanRepayments.toLocaleString()}</td></tr>
          <tr><td>Penalties</td><td>${data.income.penalties.toLocaleString()}</td></tr>
          <tr class="total-row"><td><strong>Total</strong></td><td><strong>${data.income.total.toLocaleString()}</strong></td></tr>
        </tbody>
      </table>
    `;

    // Expenditure breakdown
    const expenditureBreakdown = document.getElementById("expenditureBreakdown");
    expenditureBreakdown.innerHTML = `
      <table class="styled-table">
        <thead>
          <tr><th>Item</th><th>Amount (MWK)</th></tr>
        </thead>
        <tbody>
          <tr><td>Loans Disbursed</td><td>${data.expenditure.loansDisbursed.toLocaleString()}</td></tr>
          <tr><td>Withdrawals</td><td>${data.expenditure.withdrawals.toLocaleString()}</td></tr>
          <tr><td>Fees</td><td>${data.expenditure.fees.toLocaleString()}</td></tr>
          <tr class="total-row"><td><strong>Total</strong></td><td><strong>${data.expenditure.total.toLocaleString()}</strong></td></tr>
        </tbody>
      </table>
    `;
  }

  // Display charts
  function displayCharts(data) {
    // Income vs Expenditure Chart
    const incomeExpCtx = document.getElementById("incomeExpChart").getContext("2d");
    new Chart(incomeExpCtx, {
      type: "bar",
      data: {
        labels: ["Income", "Expenditure"],
        datasets: [{
          label: "Amount (MWK)",
          data: [data.income.total, data.expenditure.total],
          backgroundColor: [
            "rgba(75, 192, 192, 0.6)",
            "rgba(255, 99, 132, 0.6)"
          ],
          borderColor: [
            "rgba(75, 192, 192, 1)",
            "rgba(255, 99, 132, 1)"
          ],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }

  // Event listeners
  reportType.addEventListener("change", (e) => {
    populatePeriodSelector(e.target.value);
  });

  groupSelector.addEventListener("change", (e) => {
    if (e.target.value) {
      populatePeriodSelector(reportType.value);
    }
  });

  // Export buttons (placeholders)
  document.getElementById("exportPdfBtn")?.addEventListener("click", () => {
    alert("PDF export - to be implemented");
  });

  document.getElementById("exportExcelBtn")?.addEventListener("click", () => {
    alert("Excel export - to be implemented");
  });

  document.getElementById("exportCsvBtn")?.addEventListener("click", () => {
    alert("CSV export - to be implemented");
  });

  document.getElementById("printBtn")?.addEventListener("click", () => {
    window.print();
  });

  // Initialize
  populatePeriodSelector("monthly");

  // Authentication
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    await loadAdminGroups(user);
  });
});
