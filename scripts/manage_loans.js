import {
  db,
  auth,
  collection,
  getDocs,
  doc,
  getDoc,
  onAuthStateChanged,
  query,
  where,
} from "./firebaseConfig.js";

document.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("backButton");
  const groupSelector = document.getElementById("groupSelector");
  const loanRequestsTable = document.getElementById("loanRequestsTable");
  const activeLoansTable = document.getElementById("activeLoansTable");
  
  // Statistics elements
  const pendingLoans = document.getElementById("pendingLoans");
  const activeLoans = document.getElementById("activeLoans");
  const totalDisbursed = document.getElementById("totalDisbursed");
  const totalOutstanding = document.getElementById("totalOutstanding");

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

  // Load loan data for selected group
  async function loadLoanData(groupId) {
    try {
      const loansSnapshot = await getDocs(collection(db, `groups/${groupId}/loans`));
      
      let pendingCount = 0;
      let activeCount = 0;
      let disbursedTotal = 0;
      let outstandingTotal = 0;

      const pendingLoansData = [];
      const activeLoansData = [];

      loansSnapshot.forEach((doc) => {
        const loan = doc.data();
        
        if (loan.status === "pending") {
          pendingCount++;
          pendingLoansData.push({
            id: doc.id,
            ...loan
          });
        } else if (loan.status === "active" || loan.status === "disbursed") {
          activeCount++;
          disbursedTotal += loan.loanAmount || 0;
          outstandingTotal += loan.amountRemaining || 0;
          activeLoansData.push({
            id: doc.id,
            ...loan
          });
        }
      });

      // Update statistics
      pendingLoans.textContent = pendingCount;
      activeLoans.textContent = activeCount;
      totalDisbursed.textContent = `MWK ${disbursedTotal.toLocaleString()}`;
      totalOutstanding.textContent = `MWK ${outstandingTotal.toLocaleString()}`;

      // Display tables
      displayPendingLoans(pendingLoansData, groupId);
      displayActiveLoans(activeLoansData, groupId);

    } catch (error) {
      console.error("Error loading loan data:", error);
      alert("Error loading loan data. Please try again.");
    }
  }

  // Display pending loans
  function displayPendingLoans(loans, groupId) {
    if (loans.length === 0) {
      loanRequestsTable.innerHTML = "<p>No pending loan requests</p>";
      return;
    }

    let tableHTML = `
      <table class="styled-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Amount</th>
            <th>Purpose</th>
            <th>Requested Date</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    loans.forEach((loan) => {
      const requestedDate = loan.requestedAt ? new Date(loan.requestedAt.toDate()).toLocaleDateString() : "N/A";
      
      tableHTML += `
        <tr>
          <td>${loan.borrowerName || "Unknown"}</td>
          <td>MWK ${(loan.loanAmount || 0).toLocaleString()}</td>
          <td>${loan.purpose || "Not specified"}</td>
          <td>${requestedDate}</td>
          <td>
            <button class="btn-approve" data-loan-id="${loan.id}" data-group-id="${groupId}">Approve</button>
            <button class="btn-reject" data-loan-id="${loan.id}" data-group-id="${groupId}">Reject</button>
            <button class="btn-view" data-loan-id="${loan.id}" data-group-id="${groupId}">View Details</button>
          </td>
        </tr>
      `;
    });

    tableHTML += "</tbody></table>";
    loanRequestsTable.innerHTML = tableHTML;

    // Add event listeners
    addLoanActionListeners();
  }

  // Display active loans
  function displayActiveLoans(loans, groupId) {
    if (loans.length === 0) {
      activeLoansTable.innerHTML = "<p>No active loans</p>";
      return;
    }

    let tableHTML = `
      <table class="styled-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Loan Amount</th>
            <th>Amount Paid</th>
            <th>Remaining</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    loans.forEach((loan) => {
      const progress = ((loan.amountPaid || 0) / (loan.totalRepayable || 1)) * 100;
      
      tableHTML += `
        <tr>
          <td>${loan.borrowerName || "Unknown"}</td>
          <td>MWK ${(loan.loanAmount || 0).toLocaleString()}</td>
          <td>MWK ${(loan.amountPaid || 0).toLocaleString()}</td>
          <td>MWK ${(loan.amountRemaining || 0).toLocaleString()}</td>
          <td>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <small>${progress.toFixed(1)}% paid</small>
          </td>
          <td>
            <button class="btn-view" data-loan-id="${loan.id}" data-group-id="${groupId}">View Details</button>
          </td>
        </tr>
      `;
    });

    tableHTML += "</tbody></table>";
    activeLoansTable.innerHTML = tableHTML;

    // Add event listeners
    addLoanActionListeners();
  }

  // Add action listeners
  function addLoanActionListeners() {
    document.querySelectorAll(".btn-approve").forEach((btn) => {
      btn.addEventListener("click", () => approveLoan(btn.dataset.loanId, btn.dataset.groupId));
    });

    document.querySelectorAll(".btn-reject").forEach((btn) => {
      btn.addEventListener("click", () => rejectLoan(btn.dataset.loanId, btn.dataset.groupId));
    });

    document.querySelectorAll(".btn-view").forEach((btn) => {
      btn.addEventListener("click", () => viewLoanDetails(btn.dataset.loanId, btn.dataset.groupId));
    });
  }

  // Approve loan (placeholder - needs full implementation)
  async function approveLoan(loanId, groupId) {
    alert("Loan approval feature - to be implemented with full workflow");
  }

  // Reject loan (placeholder)
  async function rejectLoan(loanId, groupId) {
    alert("Loan rejection feature - to be implemented");
  }

  // View loan details (placeholder)
  function viewLoanDetails(loanId, groupId) {
    window.location.href = `loan_details.html?groupId=${groupId}&loanId=${loanId}`;
  }

  // Group selector change event
  groupSelector.addEventListener("change", (e) => {
    const groupId = e.target.value;
    if (groupId) {
      loadLoanData(groupId);
    } else {
      loanRequestsTable.innerHTML = "<p>Select a group to view loan requests</p>";
      activeLoansTable.innerHTML = "<p>Select a group to view active loans</p>";
    }
  });

  // Authentication
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    await loadAdminGroups(user);
  });
});
