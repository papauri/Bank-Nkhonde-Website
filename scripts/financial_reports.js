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
let reportData = {
  group: null,
  members: [],
  contributions: [],
  loans: [],
  summary: {
    totalIncome: 0,
    totalDisbursements: 0,
    netPosition: 0,
    outstandingLoans: 0,
  },
};

// DOM Elements
const groupSelector = document.getElementById("groupSelector");
const totalIncomeEl = document.getElementById("totalIncome");
const totalDisbursementsEl = document.getElementById("totalDisbursements");
const netPositionEl = document.getElementById("netPosition");
const outstandingLoansEl = document.getElementById("outstandingLoans");
const detailedReportEl = document.getElementById("detailedReport");
const downloadBtn = document.getElementById("downloadBtn");
const exportBtn = document.getElementById("exportBtn");
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
        await loadReportData();
      }
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => exportToPDF());
  }

  if (exportBtn) {
    exportBtn.addEventListener("click", showExportOptions);
  }

  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      if (selectedGroupId) {
        await loadReportData();
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

      if (isCreator || isAdmin || isMemberAdmin) {
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
      await loadReportData();
    }
  } catch (error) {
    console.error("Error loading groups:", error);
    showToast("Failed to load groups", "error");
  } finally {
    showSpinner(false);
  }
}

// Load report data
async function loadReportData() {
  if (!selectedGroupId) return;

  showSpinner(true);

  try {
    const currentYear = new Date().getFullYear();
    const groupDoc = await getDoc(doc(db, "groups", selectedGroupId));

    if (!groupDoc.exists()) {
      showToast("Group not found", "error");
      return;
    }

    reportData.group = { id: groupDoc.id, ...groupDoc.data() };

    // Reset summary
    reportData.summary = {
      totalIncome: 0,
      totalDisbursements: 0,
      netPosition: 0,
      outstandingLoans: 0,
    };

    // Load members
    await loadMembers();

    // Load contributions
    await loadContributions(currentYear);

    // Load loans
    await loadLoans();

    // Calculate net position
    reportData.summary.netPosition = reportData.summary.totalIncome - reportData.summary.totalDisbursements;

    // Update UI
    updateSummaryUI();
    renderDetailedReport();
  } catch (error) {
    console.error("Error loading report data:", error);
    showToast("Failed to load report data", "error");
  } finally {
    showSpinner(false);
  }
}

// Load members
async function loadMembers() {
  try {
    const membersRef = collection(db, `groups/${selectedGroupId}/members`);
    const membersSnapshot = await getDocs(membersRef);

    reportData.members = [];
    membersSnapshot.forEach((doc) => {
      reportData.members.push({ id: doc.id, ...doc.data() });
    });
  } catch (error) {
    console.error("Error loading members:", error);
  }
}

// Load contributions
async function loadContributions(year) {
  try {
    reportData.contributions = [];

    for (const member of reportData.members) {
      const memberContributions = {
        memberId: member.id,
        memberName: member.fullName || "Unknown",
        seedMoney: { paid: 0, due: 0 },
        monthlyContributions: { paid: 0, due: 0 },
        totalPaid: 0,
        totalDue: 0,
      };

      // Seed Money
      try {
        const seedMoneyRef = doc(db, `groups/${selectedGroupId}/payments/${year}_SeedMoney/${member.id}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);
        if (seedMoneyDoc.exists()) {
          const data = seedMoneyDoc.data();
          memberContributions.seedMoney.paid = parseFloat(data.amountPaid || 0);
          memberContributions.seedMoney.due = parseFloat(data.totalAmount || 0);
        }
      } catch (e) {}

      // Monthly Contributions
      const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      for (const month of months) {
        try {
          const monthRef = doc(db, `groups/${selectedGroupId}/payments/${year}_MonthlyContributions/${member.id}/${year}_${month}`);
          const monthDoc = await getDoc(monthRef);
          if (monthDoc.exists()) {
            const data = monthDoc.data();
            memberContributions.monthlyContributions.paid += parseFloat(data.amountPaid || 0);
            memberContributions.monthlyContributions.due += parseFloat(data.totalAmount || 0);
          }
        } catch (e) {}
      }

      memberContributions.totalPaid = memberContributions.seedMoney.paid + memberContributions.monthlyContributions.paid;
      memberContributions.totalDue = memberContributions.seedMoney.due + memberContributions.monthlyContributions.due;

      reportData.contributions.push(memberContributions);
      reportData.summary.totalIncome += memberContributions.totalPaid;
    }
  } catch (error) {
    console.error("Error loading contributions:", error);
  }
}

// Load loans
async function loadLoans() {
  try {
    const loansRef = collection(db, `groups/${selectedGroupId}/loans`);
    const loansSnapshot = await getDocs(loansRef);

    reportData.loans = [];
    loansSnapshot.forEach((loanDoc) => {
      const loan = { id: loanDoc.id, ...loanDoc.data() };
      reportData.loans.push(loan);

      const loanAmount = parseFloat(loan.amount || loan.loanAmount || 0);
      const repaidAmount = parseFloat(loan.amountRepaid || 0);

      if (loan.status === "active" || loan.status === "approved") {
        reportData.summary.totalDisbursements += loanAmount;
        reportData.summary.outstandingLoans += (loanAmount - repaidAmount);
      } else if (loan.status === "repaid") {
        reportData.summary.totalDisbursements += loanAmount;
        reportData.summary.totalIncome += parseFloat(loan.totalInterest || loan.interestEarned || 0);
      }
    });
  } catch (error) {
    console.error("Error loading loans:", error);
  }
}

// Update summary UI
function updateSummaryUI() {
  if (totalIncomeEl) totalIncomeEl.textContent = formatCurrency(reportData.summary.totalIncome);
  if (totalDisbursementsEl) totalDisbursementsEl.textContent = formatCurrency(reportData.summary.totalDisbursements);
  if (netPositionEl) netPositionEl.textContent = formatCurrency(reportData.summary.netPosition);
  if (outstandingLoansEl) outstandingLoansEl.textContent = formatCurrency(reportData.summary.outstandingLoans);
}

// Render detailed report
function renderDetailedReport() {
  if (!detailedReportEl) return;

  const reportDate = new Date().toLocaleDateString("en-US", { 
    weekday: "long", year: "numeric", month: "long", day: "numeric" 
  });

  let html = `
    <div class="report-header" style="margin-bottom: var(--bn-space-6); padding-bottom: var(--bn-space-4); border-bottom: 2px solid var(--bn-primary);">
      <h3 style="font-size: var(--bn-text-lg); font-weight: 700; color: var(--bn-dark); margin-bottom: var(--bn-space-2);">
        ${reportData.group?.groupName || "Group"} - Financial Report
      </h3>
      <p style="font-size: var(--bn-text-sm); color: var(--bn-gray);">Generated: ${reportDate}</p>
    </div>

    <!-- Contributions Table -->
    <div style="margin-bottom: var(--bn-space-8);">
      <h4 style="font-size: var(--bn-text-base); font-weight: 700; color: var(--bn-dark); margin-bottom: var(--bn-space-4);">
        Member Contributions
      </h4>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Seed Money</th>
              <th>Monthly</th>
              <th>Total Paid</th>
              <th>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            ${reportData.contributions.map(c => `
              <tr>
                <td><strong>${c.memberName}</strong></td>
                <td>${formatCurrency(c.seedMoney.paid)} / ${formatCurrency(c.seedMoney.due)}</td>
                <td>${formatCurrency(c.monthlyContributions.paid)} / ${formatCurrency(c.monthlyContributions.due)}</td>
                <td style="color: var(--bn-success); font-weight: 600;">${formatCurrency(c.totalPaid)}</td>
                <td style="color: var(--bn-danger);">${formatCurrency(c.totalDue - c.totalPaid)}</td>
              </tr>
            `).join("")}
          </tbody>
          <tfoot>
            <tr style="font-weight: 700; background: var(--bn-gray-100);">
              <td>TOTAL</td>
              <td>${formatCurrency(reportData.contributions.reduce((sum, c) => sum + c.seedMoney.paid, 0))}</td>
              <td>${formatCurrency(reportData.contributions.reduce((sum, c) => sum + c.monthlyContributions.paid, 0))}</td>
              <td style="color: var(--bn-success);">${formatCurrency(reportData.summary.totalIncome)}</td>
              <td style="color: var(--bn-danger);">${formatCurrency(reportData.contributions.reduce((sum, c) => sum + (c.totalDue - c.totalPaid), 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- Loans Table -->
    <div style="margin-bottom: var(--bn-space-8);">
      <h4 style="font-size: var(--bn-text-base); font-weight: 700; color: var(--bn-dark); margin-bottom: var(--bn-space-4);">
        Loan Summary
      </h4>
      ${reportData.loans.length > 0 ? `
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Borrower</th>
                <th>Amount</th>
                <th>Interest</th>
                <th>Repaid</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${reportData.loans.map(loan => {
                const borrower = reportData.members.find(m => m.id === loan.borrowerId)?.fullName || "Unknown";
                const amount = parseFloat(loan.amount || loan.loanAmount || 0);
                const interest = parseFloat(loan.totalInterest || 0);
                const repaid = parseFloat(loan.amountRepaid || 0);
                const statusClass = loan.status === "repaid" ? "success" : loan.status === "active" ? "info" : "warning";
                return `
                  <tr>
                    <td><strong>${borrower}</strong></td>
                    <td>${formatCurrency(amount)}</td>
                    <td>${formatCurrency(interest)}</td>
                    <td>${formatCurrency(repaid)}</td>
                    <td><span class="badge badge-${statusClass}">${loan.status}</span></td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty-state"><p class="empty-state-text">No loans recorded</p></div>'}
    </div>

    <!-- Export Buttons -->
    <div style="display: flex; gap: var(--bn-space-3); flex-wrap: wrap;">
      <button class="btn btn-accent" onclick="window.exportToPDF()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        Export PDF
      </button>
      <button class="btn btn-secondary" onclick="window.exportToExcel()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="3" y1="15" x2="21" y2="15"/>
          <line x1="9" y1="3" x2="9" y2="21"/>
          <line x1="15" y1="3" x2="15" y2="21"/>
        </svg>
        Export Excel
      </button>
    </div>
  `;

  detailedReportEl.innerHTML = html;
}

// Export to PDF
function exportToPDF() {
  if (!reportData.group) {
    showToast("Please select a group first", "error");
    return;
  }

  const reportDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const fileName = `${reportData.group.groupName}_Financial_Report_${new Date().toISOString().split("T")[0]}.pdf`;

  // Create printable HTML content
  let content = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Financial Report - ${reportData.group.groupName}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #333; }
        h1 { color: #0A3D2E; border-bottom: 3px solid #C9A227; padding-bottom: 10px; }
        h2 { color: #0A3D2E; margin-top: 30px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 12px 8px; text-align: left; }
        th { background: #0A3D2E; color: white; }
        tr:nth-child(even) { background: #f9f9f9; }
        .summary-box { display: inline-block; background: #f5f5f5; padding: 15px 25px; margin: 10px; border-radius: 8px; }
        .summary-label { color: #666; font-size: 12px; }
        .summary-value { font-size: 24px; font-weight: bold; color: #0A3D2E; }
        .success { color: #10B981; }
        .danger { color: #EF4444; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
        @media print { body { padding: 20px; } }
      </style>
    </head>
    <body>
      <h1>Bank Nkhonde - Financial Report</h1>
      <p><strong>Group:</strong> ${reportData.group.groupName}</p>
      <p><strong>Generated:</strong> ${reportDate}</p>
      <p><strong>Total Members:</strong> ${reportData.members.length}</p>

      <h2>Summary</h2>
      <div>
        <div class="summary-box">
          <div class="summary-label">Total Income</div>
          <div class="summary-value success">${formatCurrency(reportData.summary.totalIncome)}</div>
        </div>
        <div class="summary-box">
          <div class="summary-label">Total Disbursements</div>
          <div class="summary-value">${formatCurrency(reportData.summary.totalDisbursements)}</div>
        </div>
        <div class="summary-box">
          <div class="summary-label">Net Position</div>
          <div class="summary-value">${formatCurrency(reportData.summary.netPosition)}</div>
        </div>
        <div class="summary-box">
          <div class="summary-label">Outstanding Loans</div>
          <div class="summary-value danger">${formatCurrency(reportData.summary.outstandingLoans)}</div>
        </div>
      </div>

      <h2>Member Contributions</h2>
      <table>
        <thead>
          <tr>
            <th>Member Name</th>
            <th>Seed Money Paid</th>
            <th>Monthly Paid</th>
            <th>Total Paid</th>
            <th>Outstanding</th>
          </tr>
        </thead>
        <tbody>
          ${reportData.contributions.map(c => `
            <tr>
              <td>${c.memberName}</td>
              <td>${formatCurrency(c.seedMoney.paid)}</td>
              <td>${formatCurrency(c.monthlyContributions.paid)}</td>
              <td class="success">${formatCurrency(c.totalPaid)}</td>
              <td class="danger">${formatCurrency(c.totalDue - c.totalPaid)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <h2>Loans</h2>
      ${reportData.loans.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th>Borrower</th>
              <th>Loan Amount</th>
              <th>Interest</th>
              <th>Repaid</th>
              <th>Outstanding</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${reportData.loans.map(loan => {
              const borrower = reportData.members.find(m => m.id === loan.borrowerId)?.fullName || "Unknown";
              const amount = parseFloat(loan.amount || loan.loanAmount || 0);
              const interest = parseFloat(loan.totalInterest || 0);
              const repaid = parseFloat(loan.amountRepaid || 0);
              return `
                <tr>
                  <td>${borrower}</td>
                  <td>${formatCurrency(amount)}</td>
                  <td>${formatCurrency(interest)}</td>
                  <td class="success">${formatCurrency(repaid)}</td>
                  <td class="danger">${formatCurrency(amount + interest - repaid)}</td>
                  <td>${loan.status}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      ` : '<p>No loans recorded.</p>'}

      <div class="footer">
        <p>This report was generated by Bank Nkhonde Financial Management System.</p>
        <p>For questions, contact your group administrator.</p>
      </div>
    </body>
    </html>
  `;

  // Open print window
  const printWindow = window.open("", "_blank");
  printWindow.document.write(content);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);

  showToast("PDF export initiated. Use your browser's print dialog to save as PDF.", "success");
}

// Export to Excel
function exportToExcel() {
  if (!reportData.group) {
    showToast("Please select a group first", "error");
    return;
  }

  // Create CSV content
  let csvContent = "data:text/csv;charset=utf-8,";

  // Header
  csvContent += "BANK NKHONDE FINANCIAL REPORT\n";
  csvContent += `Group: ${reportData.group.groupName}\n`;
  csvContent += `Generated: ${new Date().toLocaleDateString()}\n\n`;

  // Summary
  csvContent += "SUMMARY\n";
  csvContent += `Total Income,${reportData.summary.totalIncome}\n`;
  csvContent += `Total Disbursements,${reportData.summary.totalDisbursements}\n`;
  csvContent += `Net Position,${reportData.summary.netPosition}\n`;
  csvContent += `Outstanding Loans,${reportData.summary.outstandingLoans}\n\n`;

  // Contributions
  csvContent += "MEMBER CONTRIBUTIONS\n";
  csvContent += "Member Name,Seed Money Paid,Seed Money Due,Monthly Paid,Monthly Due,Total Paid,Total Outstanding\n";
  reportData.contributions.forEach(c => {
    csvContent += `"${c.memberName}",${c.seedMoney.paid},${c.seedMoney.due},${c.monthlyContributions.paid},${c.monthlyContributions.due},${c.totalPaid},${c.totalDue - c.totalPaid}\n`;
  });

  csvContent += "\nLOANS\n";
  csvContent += "Borrower,Loan Amount,Interest,Repaid,Outstanding,Status\n";
  reportData.loans.forEach(loan => {
    const borrower = reportData.members.find(m => m.id === loan.borrowerId)?.fullName || "Unknown";
    const amount = parseFloat(loan.amount || loan.loanAmount || 0);
    const interest = parseFloat(loan.totalInterest || 0);
    const repaid = parseFloat(loan.amountRepaid || 0);
    csvContent += `"${borrower}",${amount},${interest},${repaid},${amount + interest - repaid},${loan.status}\n`;
  });

  // Download
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `${reportData.group.groupName}_Financial_Report_${new Date().toISOString().split("T")[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast("Excel (CSV) file downloaded successfully", "success");
}

// Show export options
function showExportOptions() {
  const modal = document.createElement("div");
  modal.className = "modal-overlay active";
  modal.id = "exportModal";
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 360px;">
      <div class="modal-header">
        <h2 class="modal-title">Export Report</h2>
        <button class="modal-close" onclick="document.getElementById('exportModal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom: var(--bn-space-4); color: var(--bn-gray);">Choose export format:</p>
        <div style="display: flex; flex-direction: column; gap: var(--bn-space-3);">
          <button class="btn btn-accent btn-block" onclick="window.exportToPDF(); document.getElementById('exportModal').remove();">
            Export as PDF
          </button>
          <button class="btn btn-secondary btn-block" onclick="window.exportToExcel(); document.getElementById('exportModal').remove();">
            Export as Excel (CSV)
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// Make functions available globally
window.exportToPDF = exportToPDF;
window.exportToExcel = exportToExcel;

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
