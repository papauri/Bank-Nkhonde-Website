import {
  db,
  auth,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  onAuthStateChanged,
  Timestamp,
  writeBatch,
} from "./firebaseConfig.js";

// Global state
let currentUser = null;
let selectedGroupId = null;
let userGroups = [];
let groupData = null;
let members = [];
let loans = [];
let currentTab = "pending";

// DOM Elements
  const groupSelector = document.getElementById("groupSelector");
const loansContainer = document.getElementById("loansContainer");
const pendingCountEl = document.getElementById("pendingCount");
const activeCountEl = document.getElementById("activeCount");
const totalDisbursedEl = document.getElementById("totalDisbursed");
const totalOutstandingEl = document.getElementById("totalOutstanding");
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
  // Group selector
  if (groupSelector) {
    groupSelector.addEventListener("change", async (e) => {
      selectedGroupId = e.target.value;
      if (selectedGroupId) {
        localStorage.setItem("selectedGroupId", selectedGroupId);
        sessionStorage.setItem("selectedGroupId", selectedGroupId);
        await loadGroupData();
      }
    });
  }

  // Refresh button
  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    if (selectedGroupId) await loadGroupData();
  });

  // Tab switching
  document.querySelectorAll(".action-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".action-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentTab = tab.dataset.tab;
      
      // Update filter dropdown to match tab
      const filterDropdown = document.getElementById("loanFilterDropdown");
      if (filterDropdown && filterDropdown.value !== "all") {
        filterDropdown.value = currentTab === "pending" ? "pending" : 
                               currentTab === "approved" ? "approved" :
                               currentTab === "disbursed" ? "disbursed" :
                               currentTab === "active" ? "active" :
                               currentTab === "repaid" ? "repaid" :
                               currentTab === "cancelled" ? "cancelled" :
                               currentTab === "overdue" ? "overdue" : "all";
      }
      
      renderLoans();
    });
  });

  // Filter dropdown
  const loanFilterDropdown = document.getElementById("loanFilterDropdown");
  if (loanFilterDropdown) {
    loanFilterDropdown.addEventListener("change", (e) => {
      if (e.target.value !== "all") {
        // Switch to appropriate tab when filter changes
        const tabs = {
          "pending": "pending",
          "approved": "approved",
          "disbursed": "disbursed",
          "active": "active",
          "repaid": "repaid",
          "cancelled": "cancelled",
          "overdue": "overdue"
        };
        if (tabs[e.target.value]) {
          currentTab = tabs[e.target.value];
          document.querySelectorAll(".action-tab").forEach((t) => {
            t.classList.remove("active");
            if (t.dataset.tab === currentTab) t.classList.add("active");
          });
        }
      }
      renderLoans();
    });
  }

  // Borrower filter dropdown
  const borrowerFilterDropdown = document.getElementById("borrowerFilterDropdown");
  if (borrowerFilterDropdown) {
    borrowerFilterDropdown.addEventListener("change", () => {
      renderLoans();
    });
  }

  // Quick action buttons
  document.getElementById("newLoanBtn")?.addEventListener("click", openNewLoanModal);
  document.getElementById("recordPaymentBtn")?.addEventListener("click", openRecordPaymentModal);
  document.getElementById("loanSettingsBtn")?.addEventListener("click", openLoanSettingsModal);
  document.getElementById("communicationsBtn")?.addEventListener("click", openCommunicationsModal);

  // Modal close buttons
  setupModalCloseHandlers("newLoanModal", "closeNewLoanModal", "cancelNewLoan");
  setupModalCloseHandlers("recordPaymentModal", "closeRecordPaymentModal", "cancelRecordPayment");
  setupModalCloseHandlers("loanSettingsModal", "closeLoanSettingsModal", "cancelLoanSettings");
  setupModalCloseHandlers("communicationsModal", "closeCommunicationsModal", "cancelCommunications");
  setupModalCloseHandlers("forcedLoansConfigModal", "closeForcedLoansConfigModal", "cancelForcedLoansConfig");

  // Form submissions
  document.getElementById("newLoanForm")?.addEventListener("submit", handleNewLoan);
  document.getElementById("recordPaymentForm")?.addEventListener("submit", handleRecordPayment);
  document.getElementById("loanSettingsForm")?.addEventListener("submit", handleSaveLoanSettings);
  document.getElementById("communicationsForm")?.addEventListener("submit", handleSendReminder);

  // Loan calculation
  document.getElementById("loanAmount")?.addEventListener("input", calculateLoanTotal);
  document.getElementById("loanPeriod")?.addEventListener("change", calculateLoanTotal);
  document.getElementById("loanInterestRate")?.addEventListener("input", calculateLoanTotal);

  // Communication recipient change
  document.getElementById("reminderRecipient")?.addEventListener("change", (e) => {
    const specificGroup = document.getElementById("specificMemberGroup");
    specificGroup.style.display = e.target.value === "specific" ? "block" : "none";
  });

  // Message type change
  document.getElementById("messageType")?.addEventListener("change", updateMessageTemplate);
  
  // Forced Loans
  document.getElementById("forcedLoansToggle")?.addEventListener("change", handleForcedLoansToggle);
  document.getElementById("configForcedLoansBtn")?.addEventListener("click", openForcedLoansConfigModal);
  document.getElementById("calculateForcedLoansBtn")?.addEventListener("click", calculateForcedLoans);
  document.getElementById("forcedLoansConfigForm")?.addEventListener("submit", handleSaveForcedLoansConfig);
  
  // Show/hide percentage threshold field based on method selection
  document.getElementById("forcedLoansMethod")?.addEventListener("change", (e) => {
    const percentageGroup = document.getElementById("percentageThresholdGroup");
    percentageGroup.style.display = e.target.value === "percentage_of_highest" ? "block" : "none";
  });
}

function setupModalCloseHandlers(modalId, closeBtn1, closeBtn2) {
  const modal = document.getElementById(modalId);
  const closeModal = () => {
    if (window.closeModal) {
      window.closeModal(modalId);
    } else {
      modal?.classList.remove("active");
      modal?.classList.add("hidden");
      modal.style.display = "none";
    }
  };
  
  document.getElementById(closeBtn1)?.addEventListener("click", (e) => {
    e.preventDefault();
    closeModal();
  });
  document.getElementById(closeBtn2)?.addEventListener("click", (e) => {
    e.preventDefault();
    closeModal();
  });
  modal?.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
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
      const data = groupDoc.data();
      const groupId = groupDoc.id;

      const isCreator = data.createdBy === currentUser.uid;
      const isAdmin = data.admins?.some((a) => a.uid === currentUser.uid || a.email === currentUser.email);
      const memberships = userData.groupMemberships || [];
      const isMemberAdmin = memberships.some((m) => m.groupId === groupId && (m.role === "admin" || m.role === "senior_admin"));

      if (isCreator || isAdmin || isMemberAdmin) {
        userGroups.push({ id: groupId, ...data });
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
    const sessionGroupId = localStorage.getItem("selectedGroupId") || sessionStorage.getItem("selectedGroupId");
    if (sessionGroupId && userGroups.find((g) => g.id === sessionGroupId)) {
      groupSelector.value = sessionGroupId;
      selectedGroupId = sessionGroupId;
      await loadGroupData();
      }
    } catch (error) {
      console.error("Error loading groups:", error);
    showToast("Failed to load groups", "error");
  } finally {
    showSpinner(false);
  }
}

// Load group data
async function loadGroupData() {
  if (!selectedGroupId) return;

  showSpinner(true);

  try {
    // Get group document
    const groupDoc = await getDoc(doc(db, "groups", selectedGroupId));
    if (!groupDoc.exists()) {
      showToast("Group not found", "error");
      return;
    }
    groupData = { id: groupDoc.id, ...groupDoc.data() };

    // Load members
    await loadMembers();

    // Load loans
    await loadLoans();

    // Load pending loan payments
    await loadPendingLoanPayments();

    // Initialize forced loans section
    await initializeForcedLoansSection();

    // Update stats
    updateStats();

    // Render loans
    renderLoans();
  } catch (error) {
    console.error("Error loading group data:", error);
    showToast("Failed to load group data", "error");
  } finally {
    showSpinner(false);
  }
}

// Load members
async function loadMembers() {
  try {
    const membersRef = collection(db, `groups/${selectedGroupId}/members`);
    const membersSnapshot = await getDocs(membersRef);

    members = [];
    membersSnapshot.forEach((doc) => {
      members.push({ id: doc.id, ...doc.data() });
    });
    
    // Populate borrower filter dropdown
    populateBorrowerFilter();
  } catch (error) {
    console.error("Error loading members:", error);
  }
}

// Populate borrower filter dropdown
function populateBorrowerFilter() {
  const borrowerFilterDropdown = document.getElementById("borrowerFilterDropdown");
  if (!borrowerFilterDropdown) return;
  
  borrowerFilterDropdown.innerHTML = '<option value="all">All Borrowers</option>';
  members.forEach(member => {
    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = member.fullName || member.name || `${member.firstName || ''} ${member.lastName || ''}`.trim() || 'Unknown';
    borrowerFilterDropdown.appendChild(option);
  });
}

// Load loans
async function loadLoans() {
  try {
    if (!selectedGroupId) {
      console.warn("No group selected, cannot load loans");
      loans = [];
      return;
    }

    const loansRef = collection(db, `groups/${selectedGroupId}/loans`);
    const loansSnapshot = await getDocs(loansRef);

    loans = [];
    loansSnapshot.forEach((doc) => {
      const loanData = doc.data();
      loans.push({ 
        id: doc.id, 
        ...loanData,
        // Ensure status exists and is valid
        status: loanData.status || "pending",
        // Ensure dates are properly handled
        createdAt: loanData.createdAt || loanData.requestedAt || Timestamp.now(),
        requestedAt: loanData.requestedAt || loanData.createdAt || Timestamp.now()
      });
    });

    console.log(`Loaded ${loans.length} loans from group ${selectedGroupId}`);

    // Sort by date (most recent first)
    loans.sort((a, b) => {
      const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : 
                    a.requestedAt?.toDate ? a.requestedAt.toDate() : 
                    new Date(0);
      const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : 
                    b.requestedAt?.toDate ? b.requestedAt.toDate() : 
                    new Date(0);
      return dateB - dateA;
    });

    // Log loan statuses for debugging
    const statusCounts = {};
    loans.forEach(loan => {
      const status = loan.status || "unknown";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    console.log("Loan status breakdown:", statusCounts);

  } catch (error) {
    console.error("Error loading loans:", error);
    loans = [];
    showToast("Failed to load loans. Please refresh the page.", "error");
  }
}

// Load pending loan payments
let pendingLoanPayments = [];

async function loadPendingLoanPayments() {
  pendingLoanPayments = [];
  
  try {
    if (!selectedGroupId) return;
    
    // Get all active and disbursed loans
    const activeLoans = loans.filter(l => l.status === "active" || l.status === "disbursed");
    
    // Load pending payments for each active loan
    for (const loan of activeLoans) {
      const paymentsRef = collection(db, `groups/${selectedGroupId}/loans/${loan.id}/payments`);
      const q = query(paymentsRef, where("status", "==", "pending"));
      const paymentsSnapshot = await getDocs(q);
      
      paymentsSnapshot.forEach(paymentDoc => {
        pendingLoanPayments.push({
          id: paymentDoc.id,
          ...paymentDoc.data(),
          loanId: loan.id,
          loanReference: `#${loan.id.substring(0, 8).toUpperCase()}`,
          borrowerName: members.find(m => m.id === loan.borrowerId)?.fullName || "Unknown"
        });
      });
    }
    
    // Sort by submission date (most recent first)
    pendingLoanPayments.sort((a, b) => {
      const dateA = a.submittedAt?.toDate ? a.submittedAt.toDate() : new Date(0);
      const dateB = b.submittedAt?.toDate ? b.submittedAt.toDate() : new Date(0);
      return dateB - dateA;
    });
    
    console.log(`Loaded ${pendingLoanPayments.length} pending loan payments`);
    
    // Display pending payments
    displayPendingLoanPayments();
    
  } catch (error) {
    console.error("Error loading pending loan payments:", error);
  }
}

// Display pending loan payments
function displayPendingLoanPayments() {
  const container = document.getElementById("pendingLoanPaymentsList");
  const badge = document.getElementById("pendingPaymentsCountBadge");
  const section = document.getElementById("pendingLoanPaymentsSection");
  
  if (!container) return;
  
  // Update badge
  if (badge) {
    badge.textContent = pendingLoanPayments.length;
  }
  
  // Hide section if no pending payments
  if (section) {
    section.style.display = pendingLoanPayments.length > 0 ? "block" : "none";
  }
  
  if (pendingLoanPayments.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><p class="empty-state-text">No pending payments to review</p></div>';
    return;
  }
  
  container.innerHTML = '';
  
  pendingLoanPayments.forEach(payment => {
    const paymentCard = createPendingPaymentCard(payment);
    container.appendChild(paymentCard);
  });
}

// Create pending payment card
function createPendingPaymentCard(payment) {
  const div = document.createElement("div");
  div.className = "list-item";
  div.style.cssText = "background: var(--bn-white); border: 1px solid var(--bn-gray-lighter); border-radius: var(--bn-radius-lg); padding: var(--bn-space-4); margin-bottom: var(--bn-space-3);";
  
  const amount = parseFloat(payment.amount || 0);
  const submittedDate = payment.submittedAt?.toDate ? payment.submittedAt.toDate().toLocaleDateString() : "N/A";
  const paymentDate = payment.paymentDate?.toDate ? payment.paymentDate.toDate().toLocaleDateString() : "N/A";
  
  div.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--bn-space-4);">
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: var(--bn-space-2); margin-bottom: var(--bn-space-2);">
          <span style="font-size: 1.25rem;">💳</span>
          <div>
            <div style="font-weight: 700; font-size: var(--bn-text-md);">${formatCurrency(amount)}</div>
            <div style="font-size: var(--bn-text-sm); color: var(--bn-gray);">${payment.borrowerName} • Loan ${payment.loanReference}</div>
          </div>
        </div>
        <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-2);">
          <div>Payment Date: ${paymentDate} • Submitted: ${submittedDate}</div>
          ${payment.notes ? `<div style="margin-top: 4px;">📝 ${payment.notes}</div>` : ''}
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: var(--bn-space-2); align-items: flex-end;">
        ${payment.proofUrl ? `<a href="${payment.proofUrl}" target="_blank" class="btn btn-ghost btn-sm" style="white-space: nowrap;">View Proof</a>` : ''}
        <div style="display: flex; gap: var(--bn-space-2);">
          <button class="btn btn-success btn-sm" onclick="approveLoanPayment('${payment.loanId}', '${payment.id}')" style="white-space: nowrap;">✓ Approve</button>
          <button class="btn btn-danger btn-sm" onclick="rejectLoanPayment('${payment.loanId}', '${payment.id}')" style="white-space: nowrap;">✗ Reject</button>
        </div>
      </div>
    </div>
  `;
  
  return div;
}

// Approve loan payment
window.approveLoanPayment = async function(loanId, paymentId) {
  if (!confirm("Approve this loan payment?")) return;
  
  showSpinner(true);
  
  try {
    // Get payment data
    const paymentDoc = await getDoc(doc(db, `groups/${selectedGroupId}/loans/${loanId}/payments`, paymentId));
    if (!paymentDoc.exists()) {
      showToast("Payment not found", "error");
      return;
    }
    
    const payment = paymentDoc.data();
    const amount = parseFloat(payment.amount || 0);
    
    // Get loan data
    const loanDoc = await getDoc(doc(db, `groups/${selectedGroupId}/loans`, loanId));
    if (!loanDoc.exists()) {
      showToast("Loan not found", "error");
      return;
    }
    
    const loan = loanDoc.data();
    const loanAmount = parseFloat(loan.amount || loan.loanAmount || 0);
    const totalRepayable = parseFloat(loan.totalRepayable || loanAmount);
    const currentRepaid = parseFloat(loan.amountRepaid || 0);
    const newRepaid = currentRepaid + amount;
    const remaining = Math.max(0, totalRepayable - newRepaid);
    const newStatus = remaining <= 0 ? "repaid" : "active";
    
    // Update payment status
    await updateDoc(doc(db, `groups/${selectedGroupId}/loans/${loanId}/payments`, paymentId), {
      status: "approved",
      approvedBy: currentUser.uid,
      approvedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    
    // Update loan
    await updateDoc(doc(db, `groups/${selectedGroupId}/loans`, loanId), {
      amountRepaid: newRepaid,
      status: newStatus,
      lastPaymentDate: payment.paymentDate || Timestamp.now(),
      lastPaymentAmount: amount,
      updatedAt: Timestamp.now(),
      ...(newStatus === "repaid" && { 
        repaidAt: Timestamp.now(),
        remainingBalance: 0
      }),
      ...(newStatus === "active" && {
        remainingBalance: remaining
      })
    });
    
    // Update member financial summary
    const memberRef = doc(db, `groups/${selectedGroupId}/members`, loan.borrowerId);
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      const financialSummary = memberDoc.data().financialSummary || {};
      await updateDoc(memberRef, {
        "financialSummary.totalLoansPaid": Math.round(((parseFloat(financialSummary.totalLoansPaid || 0)) + amount) * 100) / 100,
        ...(newStatus === "repaid" && {
          "financialSummary.activeLoans": Math.max(0, (parseInt(financialSummary.activeLoans || 1)) - 1)
        }),
        "financialSummary.lastUpdated": Timestamp.now(),
      });
    }
    
    // Send notification to borrower
    await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
      userId: loan.borrowerId,
      recipientId: loan.borrowerId,
      type: newStatus === "repaid" ? "loan_repaid" : "loan_payment_approved",
      title: newStatus === "repaid" ? "🎉 Loan Fully Repaid!" : "Loan Payment Approved",
      message: newStatus === "repaid" 
        ? `Congratulations! Your loan has been fully repaid. Final payment of ${formatCurrency(amount)} approved.\n\nTotal Repaid: ${formatCurrency(newRepaid)}\nLoan Amount: ${formatCurrency(loanAmount)}\nTotal Interest: ${formatCurrency(parseFloat(loan.totalInterest || 0))}`
        : `Your loan payment of ${formatCurrency(amount)} has been approved.\n\nRemaining balance: ${formatCurrency(remaining)}\nTotal repaid: ${formatCurrency(newRepaid)} of ${formatCurrency(totalRepayable)}`,
      loanId: loanId,
      groupId: selectedGroupId,
      groupName: groupData?.groupName || "Unknown Group",
      senderId: currentUser.uid,
      createdAt: Timestamp.now(),
      read: false,
    });
    
    showToast(newStatus === "repaid" ? "Payment approved - Loan fully repaid!" : "Payment approved successfully", "success");
    await loadGroupData();
    
  } catch (error) {
    console.error("Error approving payment:", error);
    showToast("Failed to approve payment: " + error.message, "error");
  } finally {
    showSpinner(false);
  }
};

// Reject loan payment
window.rejectLoanPayment = async function(loanId, paymentId) {
  const reason = prompt("Please provide a reason for rejecting this payment:");
  if (!reason) return;
  
  showSpinner(true);
  
  try {
    // Get payment and loan data for notification
    const paymentDoc = await getDoc(doc(db, `groups/${selectedGroupId}/loans/${loanId}/payments`, paymentId));
    const loanDoc = await getDoc(doc(db, `groups/${selectedGroupId}/loans`, loanId));
    
    if (!paymentDoc.exists() || !loanDoc.exists()) {
      showToast("Payment or loan not found", "error");
      return;
    }
    
    const payment = paymentDoc.data();
    const loan = loanDoc.data();
    
    // Update payment status
    await updateDoc(doc(db, `groups/${selectedGroupId}/loans/${loanId}/payments`, paymentId), {
      status: "rejected",
      rejectedBy: currentUser.uid,
      rejectedAt: Timestamp.now(),
      adminNotes: reason,
      updatedAt: Timestamp.now()
    });
    
    // Send notification to borrower
    await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
      userId: loan.borrowerId,
      recipientId: loan.borrowerId,
      type: "loan_payment_rejected",
      title: "Loan Payment Rejected",
      message: `Your loan payment of ${formatCurrency(payment.amount)} has been rejected.\n\nReason: ${reason}\n\nPlease resubmit with correct information or contact admin for clarification.`,
      loanId: loanId,
      groupId: selectedGroupId,
      groupName: groupData?.groupName || "Unknown Group",
      senderId: currentUser.uid,
      createdAt: Timestamp.now(),
      read: false,
    });
    
    showToast("Payment rejected", "success");
    await loadGroupData();
    
  } catch (error) {
    console.error("Error rejecting payment:", error);
    showToast("Failed to reject payment: " + error.message, "error");
  } finally {
    showSpinner(false);
  }
};

// Update stats
function updateStats() {
  const pending = loans.filter((l) => l.status === "pending").length;
  const approved = loans.filter((l) => l.status === "approved").length;
  const active = loans.filter((l) => l.status === "active").length;
  
  let totalDisbursed = 0;
  let totalOutstanding = 0;

  loans.forEach((loan) => {
    const amount = parseFloat(loan.amount || loan.loanAmount || 0);
    const repaid = parseFloat(loan.amountRepaid || 0);
    const totalRepayable = parseFloat(loan.totalRepayable || 0);
    const interest = parseFloat(loan.totalInterest || 0);

    // Calculate total repayable if not set
    const calculatedTotalRepayable = totalRepayable > 0 ? totalRepayable : (amount + interest);

    if (loan.status === "active" || loan.status === "repaid") {
      totalDisbursed += amount;
    }
    if (loan.status === "active") {
      const remaining = Math.max(0, calculatedTotalRepayable - repaid);
      totalOutstanding += remaining;
    }
  });

    if (pendingCountEl) pendingCountEl.textContent = pending;
    if (activeCountEl) activeCountEl.textContent = active;
  if (totalDisbursedEl) totalDisbursedEl.textContent = formatCurrency(totalDisbursed);
  if (totalOutstandingEl) totalOutstandingEl.textContent = formatCurrency(totalOutstanding);
}

// Render loans
function renderLoans() {
  if (!loansContainer) return;

  let filteredLoans = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (currentTab) {
    case "pending":
      // Show only pending loans (awaiting approval)
      filteredLoans = loans.filter((l) => l.status === "pending");
      break;
    case "approved":
      // Show only approved loans (awaiting disbursement)
      filteredLoans = loans.filter((l) => l.status === "approved");
      break;
    case "disbursed":
      // Show disbursed loans (status is "active" with disbursedAt field)
      filteredLoans = loans.filter((l) => l.status === "active" && l.disbursedAt);
      break;
    case "active":
      // Show all active loans (same as disbursed - all active loans are disbursed)
      filteredLoans = loans.filter((l) => l.status === "active");
      break;
    case "repaid":
      filteredLoans = loans.filter((l) => l.status === "repaid");
      break;
    case "cancelled":
      filteredLoans = loans.filter((l) => l.status === "cancelled");
      break;
    case "overdue":
      filteredLoans = loans.filter((l) => {
        if (l.status !== "active") return false;
        const dueDate = l.dueDate?.toDate ? l.dueDate.toDate() : new Date(l.dueDate);
        return dueDate < today;
      });
      break;
  }

  // Apply borrower filter if set
  const borrowerFilter = document.getElementById("borrowerFilterDropdown")?.value;
  if (borrowerFilter && borrowerFilter !== "all") {
    filteredLoans = filteredLoans.filter((l) => l.borrowerId === borrowerFilter);
  }

  if (filteredLoans.length === 0) {
    loansContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💰</div>
        <p class="empty-state-text">No ${currentTab} loans found</p>
      </div>
    `;
    return;
  }

  loansContainer.innerHTML = filteredLoans.map((loan) => createLoanCard(loan)).join("");

  // Add event listeners to action buttons
  loansContainer.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = e.target.closest("button").dataset.action;
      const loanId = e.target.closest("button").dataset.loanId;
      handleLoanAction(action, loanId);
    });
  });
}

// Create loan card
function createLoanCard(loan) {
  const borrower = members.find((m) => m.id === loan.borrowerId) || {};
  const initials = borrower.fullName?.split(" ").map((n) => n[0]).join("").toUpperCase().substring(0, 2) || 
                   loan.borrowerName?.split(" ").map((n) => n[0]).join("").toUpperCase().substring(0, 2) || "??";
  
  const amount = parseFloat(loan.amount || loan.loanAmount || 0);
  const interest = parseFloat(loan.totalInterest || 0);
  const repaid = parseFloat(loan.amountRepaid || 0);
  const totalRepayable = parseFloat(loan.totalRepayable || 0);
  
  // Use totalRepayable if available, otherwise calculate it
  const totalDue = totalRepayable > 0 ? totalRepayable : (amount + interest);
  const remaining = Math.max(0, totalDue - repaid);
  const progressPercent = totalDue > 0 ? Math.min((repaid / totalDue) * 100, 100) : 0;

  const createdDate = loan.createdAt?.toDate ? loan.createdAt.toDate().toLocaleDateString() : 
                      loan.requestedAt?.toDate ? loan.requestedAt.toDate().toLocaleDateString() : "N/A";
  const dueDate = loan.dueDate?.toDate ? loan.dueDate.toDate().toLocaleDateString() : "N/A";

  const statusClass = loan.status === "repaid" ? "success" : 
                     loan.status === "active" ? "info" : 
                     loan.status === "approved" ? "success" : 
                     loan.status === "cancelled" ? "danger" :
                     "warning";

  // Show booking info for pending loans
  let bookingInfo = "";
  if (loan.status === "pending") {
    const bookingDetails = [];
    if (loan.targetMonthName) {
      bookingDetails.push(`<div style="font-weight: 600; color: var(--bn-accent-dark);">📅 ${loan.targetMonthName} ${loan.targetYear || ''}</div>`);
    }
    if (loan.purpose) {
      bookingDetails.push(`<div style="font-size: var(--bn-text-xs); color: var(--bn-gray);">Purpose: <span style="font-weight: 600;">${loan.purpose}</span></div>`);
    }
    if (loan.repaymentPeriod) {
      bookingDetails.push(`<div style="font-size: var(--bn-text-xs); color: var(--bn-gray);">Repayment Period: <span style="font-weight: 600;">${loan.repaymentPeriod} month(s)</span></div>`);
    }
    if (loan.description) {
      bookingDetails.push(`<div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--bn-gray-lighter);">${loan.description}</div>`);
    }
    
    if (bookingDetails.length > 0) {
      bookingInfo = `
        <div style="background: var(--bn-accent-subtle); padding: var(--bn-space-3); border-radius: var(--bn-radius-md); margin-bottom: var(--bn-space-4);">
          <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Loan Booking Details</div>
          ${bookingDetails.join('')}
        </div>
      `;
    }
  }
  
  // Show cancellation info for cancelled loans
  if (loan.status === "cancelled" && loan.cancelReason) {
    const cancelledDate = loan.cancelledAt?.toDate ? loan.cancelledAt.toDate().toLocaleDateString() : "N/A";
    bookingInfo = `
      <div style="background: #fee; padding: var(--bn-space-3); border-radius: var(--bn-radius-md); margin-bottom: var(--bn-space-4); border-left: 3px solid var(--bn-danger);">
        <div style="font-size: var(--bn-text-xs); color: var(--bn-danger); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">❌ Loan Cancelled</div>
        <div style="font-size: var(--bn-text-sm); color: var(--bn-dark); margin-bottom: 4px;"><strong>Reason:</strong> ${loan.cancelReason}</div>
        <div style="font-size: var(--bn-text-xs); color: var(--bn-gray);">Cancelled on: ${cancelledDate}</div>
      </div>
    `;
  }

  let actionsHTML = "";
  if (loan.status === "pending") {
    actionsHTML = `
      <button class="btn btn-accent" data-action="approve" data-loan-id="${loan.id}">Approve</button>
      <button class="btn btn-danger" data-action="reject" data-loan-id="${loan.id}">Reject</button>
    `;
  } else if (loan.status === "approved") {
    actionsHTML = `
      <button class="btn btn-accent" data-action="disburse" data-loan-id="${loan.id}">Disburse</button>
      <button class="btn btn-ghost" data-action="details" data-loan-id="${loan.id}">View Details</button>
    `;
  } else if (loan.status === "active") {
    actionsHTML = `
      <button class="btn btn-accent" data-action="payment" data-loan-id="${loan.id}">Record Payment</button>
      <button class="btn btn-secondary" data-action="reminder" data-loan-id="${loan.id}">Send Reminder</button>
      <button class="btn btn-ghost" data-action="details" data-loan-id="${loan.id}">View Details</button>
    `;
  } else if (loan.status === "cancelled") {
    actionsHTML = `
      <button class="btn btn-ghost" data-action="details" data-loan-id="${loan.id}">View Details</button>
    `;
  } else {
    actionsHTML = `
      <button class="btn btn-ghost" data-action="details" data-loan-id="${loan.id}">View Details</button>
    `;
  }

  return `
    <div class="loan-card">
      <div class="loan-card-header">
        <div class="loan-borrower">
          <div class="loan-borrower-avatar">${initials}</div>
          <div>
            <div class="loan-borrower-name">${borrower.fullName || loan.borrowerName || "Unknown"}</div>
            <div class="loan-borrower-date">${loan.bookingType === "user_request" ? "Booked" : "Applied"}: ${createdDate}</div>
          </div>
          </div>
        <span class="badge badge-${statusClass}">${loan.status}</span>
          </div>
      <div class="loan-card-body">
        ${bookingInfo}
        <div class="loan-details-grid">
          <div class="loan-detail">
            <div class="loan-detail-value">${formatCurrency(amount)}</div>
            <div class="loan-detail-label">Principal</div>
            </div>
          <div class="loan-detail">
            <div class="loan-detail-value">${formatCurrency(interest)}</div>
            <div class="loan-detail-label">Interest</div>
        </div>
          <div class="loan-detail">
            <div class="loan-detail-value" style="color: var(--bn-success);">${formatCurrency(repaid)}</div>
            <div class="loan-detail-label">Repaid</div>
      </div>
          <div class="loan-detail">
            <div class="loan-detail-value" style="color: var(--bn-danger);">${formatCurrency(remaining)}</div>
            <div class="loan-detail-label">Remaining</div>
          </div>
        </div>
        ${loan.status === "active" ? `
          <div class="loan-progress">
            <div class="loan-progress-bar">
              <div class="loan-progress-fill" style="width: ${progressPercent}%;"></div>
            </div>
            <div class="loan-progress-text">
              <span>${progressPercent.toFixed(0)}% repaid</span>
              <span>Due: ${dueDate}</span>
            </div>
          </div>
        ` : ""}
        <div class="loan-actions">
          ${actionsHTML}
        </div>
      </div>
      </div>
    `;
}

// Handle loan actions
async function handleLoanAction(action, loanId) {
  const loan = loans.find((l) => l.id === loanId);
  if (!loan) return;

  switch (action) {
    case "approve":
      await approveLoan(loanId);
      break;
    case "disburse":
      await disburseLoan(loanId);
      break;
    case "reject":
      await rejectLoan(loanId);
      break;
    case "payment":
      openRecordPaymentModal(loanId);
      break;
    case "reminder":
      openCommunicationsModal(loan.borrowerId);
      break;
    case "details":
      showLoanDetails(loan);
      break;
  }
}

// Approve loan
// Approve loan (without disbursing)
async function approveLoan(loanId) {
  if (!confirm("Approve this loan request?")) return;

  showSpinner(true);

  try {
    const loan = loans.find((l) => l.id === loanId);
    if (!loan) {
      showToast("Loan not found", "error");
      return;
    }

    const amount = parseFloat(loan.amount || loan.loanAmount || 0);
    const period = parseInt(loan.repaymentPeriod || 1);
    
    // Calculate accounting (interest and total repayable) when approving
    // Get interest rates - use loan's saved rates or group settings
    const savedRates = loan.interestRates || {};
    const rules = groupData?.rules?.loanInterest || {};
    
    const month1Rate = savedRates.month1 || parseFloat(rules.month1 || 10);
    const month2Rate = savedRates.month2 || parseFloat(rules.month2 || rules.month1 || 7);
    const month3Rate = savedRates.month3 || parseFloat(rules.month3AndBeyond || rules.month2 || 5);
    
    // Calculate total interest based on repayment period
    let totalInterest = 0;
    let remainingBalance = amount;
    const monthlyPrincipal = amount / period;
    
    for (let i = 1; i <= period; i++) {
      const rate = i === 1 ? month1Rate : i === 2 ? month2Rate : month3Rate;
      const monthlyInterest = Math.round(remainingBalance * (rate / 100) * 100) / 100;
      totalInterest += monthlyInterest;
      remainingBalance -= monthlyPrincipal;
    }
    
    totalInterest = Math.round(totalInterest * 100) / 100;
    const totalRepayable = Math.round((amount + totalInterest) * 100) / 100;
    
    // Calculate tentative due date (based on requested disbursement date or current date)
    const requestedDate = loan.targetDate ? (loan.targetDate.toDate ? loan.targetDate.toDate() : new Date(loan.targetDate)) : new Date();
    const finalDueDate = new Date(requestedDate);
    finalDueDate.setMonth(finalDueDate.getMonth() + period);
    
    // Just approve with calculated accounting, don't disburse yet
    await updateDoc(doc(db, `groups/${selectedGroupId}/loans`, loanId), {
      status: "approved",
      approvedBy: currentUser.uid,
      approvedAt: Timestamp.now(),
      totalInterest: totalInterest,
      totalRepayable: totalRepayable,
      amountRepaid: 0,
      dueDate: Timestamp.fromDate(finalDueDate),
      interestRates: {
        month1: month1Rate,
        month2: month2Rate,
        month3: month3Rate
      },
      updatedAt: Timestamp.now(),
    });

    // Send notification to borrower
    await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
      userId: loan.borrowerId,
      recipientId: loan.borrowerId,
      type: "loan_approved",
      title: "Loan Approved",
      message: `Your loan booking of ${formatCurrency(amount)} has been approved. The loan will be disbursed soon.\n\nLoan Details:\n- Principal: ${formatCurrency(amount)}\n- Total Interest: ${formatCurrency(totalInterest)}\n- Total Repayable: ${formatCurrency(totalRepayable)}\n- Repayment Period: ${period} month(s)\n- Status: Approved (Pending Disbursement)\n\nYou can start making payments even before disbursement.`,
      loanId: loanId,
      groupId: selectedGroupId,
      groupName: groupData?.groupName || "Unknown Group",
      senderId: currentUser.uid,
      senderName: currentUser.displayName || currentUser.email,
      createdAt: Timestamp.now(),
      read: false,
      readBy: [],
    });

    showToast("Loan approved successfully", "success");
    await loadGroupData();
  } catch (error) {
    console.error("Error approving loan:", error);
    showToast("Failed to approve loan: " + error.message, "error");
  } finally {
    showSpinner(false);
  }
}

// Disburse approved loan
async function disburseLoan(loanId) {
  if (!confirm("Disburse this approved loan?")) return;

  showSpinner(true);

  try {
    const loan = loans.find((l) => l.id === loanId);
    if (!loan) {
      showToast("Loan not found", "error");
      return;
    }

    if (loan.status !== "approved") {
      showToast("Only approved loans can be disbursed", "error");
      return;
    }

    const amount = parseFloat(loan.amount || loan.loanAmount || 0);
    const period = parseInt(loan.repaymentPeriod || 1);
    
    // Get interest rates - use loan's saved rates or group settings
    const savedRates = loan.interestRates || {};
    const rules = groupData?.rules?.loanInterest || {};
    
    const month1Rate = parseFloat(savedRates.month1 || rules.month1 || 10);
    const month2Rate = parseFloat(savedRates.month2 || rules.month2 || rules.month1 || 7);
    const month3Rate = parseFloat(savedRates.month3 || rules.month3AndBeyond || rules.month2 || 5);

    // Calculate interest using reduced balance method
    let totalInterest = 0;
    let remainingBalance = amount;
    const schedule = {};
    const monthlyPrincipal = amount / period;

    const disbursementDate = new Date();
    
    for (let i = 1; i <= period; i++) {
      const rate = i === 1 ? month1Rate : i === 2 ? month2Rate : month3Rate;
      const monthlyInterest = Math.round(remainingBalance * (rate / 100) * 100) / 100;
      
      totalInterest += monthlyInterest;
      
      const dueDate = new Date(disbursementDate);
      dueDate.setMonth(dueDate.getMonth() + i);

      const monthKey = dueDate.toLocaleString('default', { month: 'long' });

      schedule[monthKey] = {
        month: i,
        monthName: monthKey,
        principal: Math.round(monthlyPrincipal * 100) / 100,
        interest: monthlyInterest,
        interestRate: rate,
        amount: Math.round((monthlyPrincipal + monthlyInterest) * 100) / 100,
        dueDate: Timestamp.fromDate(dueDate),
        paid: false,
        paidAt: null,
        paidAmount: 0,
        penaltyAmount: 0
      };

      remainingBalance -= monthlyPrincipal;
    }

    totalInterest = Math.round(totalInterest * 100) / 100;
    const totalRepayable = Math.round((amount + totalInterest) * 100) / 100;

    const finalDueDate = new Date(disbursementDate);
    finalDueDate.setMonth(finalDueDate.getMonth() + period);

    await updateDoc(doc(db, `groups/${selectedGroupId}/loans`, loanId), {
      status: "active",
      disbursedBy: currentUser.uid,
      disbursedAt: Timestamp.now(),
      totalInterest: totalInterest,
      totalRepayable: totalRepayable,
      amountRepaid: 0,
      dueDate: Timestamp.fromDate(finalDueDate),
      repaymentSchedule: schedule,
      monthlyPrincipal: Math.round(monthlyPrincipal * 100) / 100,
      interestRates: {
        month1: month1Rate,
        month2: month2Rate,
        month3: month3Rate
      },
      updatedAt: Timestamp.now(),
    });

    // Update member financial summary
    const memberRef = doc(db, `groups/${selectedGroupId}/members`, loan.borrowerId);
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      const financialSummary = memberDoc.data().financialSummary || {};
      await updateDoc(memberRef, {
        "financialSummary.totalLoans": (parseFloat(financialSummary.totalLoans || 0)) + amount,
        "financialSummary.activeLoans": (parseInt(financialSummary.activeLoans || 0)) + 1,
        "financialSummary.lastUpdated": Timestamp.now(),
      });
    }

    // Get member account information for notification
    const memberRefForNotif = doc(db, `groups/${selectedGroupId}/members`, loan.borrowerId);
    const memberDocForNotif = await getDoc(memberRefForNotif);
    const memberData = memberDocForNotif.exists() ? memberDocForNotif.data() : {};
    const accountNumber = memberData.accountNumber ? `****${memberData.accountNumber.slice(-4)}` : 'Not provided';
    const bankName = memberData.bankName || 'Not provided';
    const accountInfo = (memberData.accountNumber || memberData.bankName) 
      ? `\n- Disbursed to Account: ${accountNumber} (${bankName})`
      : '\n- Disbursed to: Account details not available';

    // Send notification to borrower
    await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
      userId: loan.borrowerId,
      recipientId: loan.borrowerId,
      type: "loan_disbursed",
      title: "Loan Disbursed",
      message: `Your approved loan of ${formatCurrency(amount)} has been disbursed.${accountInfo}\n\nLoan Details:\n- Principal: ${formatCurrency(amount)}\n- Total Interest: ${formatCurrency(totalInterest)}\n- Total Repayable: ${formatCurrency(totalRepayable)}\n- Repayment Period: ${period} month(s)\n- Final Due Date: ${finalDueDate.toLocaleDateString()}\n\nYou can view repayment schedule and make payments from your dashboard.`,
      loanId: loanId,
      groupId: selectedGroupId,
      groupName: groupData?.groupName || "Unknown Group",
      senderId: currentUser.uid,
      senderName: currentUser.displayName || currentUser.email,
      createdAt: Timestamp.now(),
      read: false,
      readBy: [],
    });

    showToast("Loan disbursed successfully", "success");
    await loadGroupData();
  } catch (error) {
    console.error("Error disbursing loan:", error);
    showToast("Failed to disburse loan: " + error.message, "error");
  } finally {
    showSpinner(false);
  }
}

// Reject loan
async function rejectLoan(loanId) {
  const reason = prompt("Reason for rejection:");
  if (!reason) return;

  showSpinner(true);

  try {
    const loan = loans.find((l) => l.id === loanId);

    await updateDoc(doc(db, `groups/${selectedGroupId}/loans`, loanId), {
        status: "cancelled",
        cancelledBy: currentUser.uid,
      cancelledAt: Timestamp.now(),
      cancelReason: reason,
      updatedAt: Timestamp.now(),
    });

    // Send notification to borrower
    await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
      userId: loan.borrowerId,
      recipientId: loan.borrowerId,
      type: "loan_rejected",
      title: "Loan Request Rejected",
      message: `Your loan booking of ${formatCurrency(loan.amount || loan.loanAmount || 0)} was rejected.\n\nReason: ${reason}\n\nYou can submit a new loan booking request from your dashboard.`,
      loanId: loanId,
      groupId: selectedGroupId,
      groupName: groupData?.groupName || "Unknown Group",
      senderId: currentUser.uid,
      senderName: currentUser.displayName || currentUser.email,
      createdAt: Timestamp.now(),
      read: false,
      readBy: [],
    });

    showToast("Loan rejected", "success");
    await loadGroupData();
    } catch (error) {
      console.error("Error rejecting loan:", error);
    showToast("Failed to reject loan", "error");
  } finally {
    showSpinner(false);
  }
}

// Open new loan modal
function openNewLoanModal() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }

  const modal = document.getElementById("newLoanModal");
  const memberSelect = document.getElementById("loanMember");
  const disbursementDate = document.getElementById("loanDisbursementDate");

  // Populate members
  memberSelect.innerHTML = '<option value="">Choose a member...</option>';
  members.forEach((m) => {
    memberSelect.innerHTML += `<option value="${m.id}">${m.fullName}</option>`;
  });

  // Set default date
  disbursementDate.value = new Date().toISOString().split("T")[0];

  // Set default interest rate
  const rules = groupData?.rules?.loanInterest || {};
  document.getElementById("loanInterestRate").value = rules.month1 || 10;

  document.getElementById("newLoanForm")?.reset();
  disbursementDate.value = new Date().toISOString().split("T")[0];
  calculateLoanTotal();

  if (window.openModal) {
    window.openModal("newLoanModal");
  } else {
    modal?.classList.add("active");
    modal?.classList.remove("hidden");
    modal.style.display = "flex";
  }
}

// Calculate loan total
function calculateLoanTotal() {
  const amount = parseFloat(document.getElementById("loanAmount")?.value || 0);
  const period = parseInt(document.getElementById("loanPeriod")?.value || 1);
  const customRate = parseFloat(document.getElementById("loanInterestRate")?.value || 0);

  const rules = groupData?.rules?.loanInterest || {};
  const rate = customRate || parseFloat(rules.month1 || 10);

  let totalInterest = 0;
  let remainingBalance = amount;

  for (let i = 1; i <= period; i++) {
    const monthRate = i === 1 ? rate : 
                      i === 2 ? parseFloat(rules.month2 || rate) : 
                      parseFloat(rules.month3AndBeyond || rules.month2 || rate);
    totalInterest += remainingBalance * (monthRate / 100);
    remainingBalance -= amount / period;
  }

  document.getElementById("calculatedInterest").textContent = formatCurrency(totalInterest);
  document.getElementById("calculatedTotal").textContent = formatCurrency(amount + totalInterest);
}

// Handle new loan
async function handleNewLoan(e) {
  e.preventDefault();

  const memberId = document.getElementById("loanMember")?.value;
  const amount = parseFloat(document.getElementById("loanAmount")?.value || 0);
  const period = parseInt(document.getElementById("loanPeriod")?.value || 1);
  const interestRate = parseFloat(document.getElementById("loanInterestRate")?.value || 0);
  const disbursementDate = document.getElementById("loanDisbursementDate")?.value;
  const purpose = document.getElementById("loanPurpose")?.value;

  if (!memberId || !amount || !disbursementDate) {
    showToast("Please fill in all required fields", "error");
    return;
  }

  if (amount < 1000) {
    showToast("Minimum loan amount is MWK 1,000", "error");
    return;
  }

  showSpinner(true);

  try {
    const rules = groupData?.rules?.loanInterest || {};
    const rate = interestRate || parseFloat(rules.month1 || 10);

    // Calculate interest and schedule
    let totalInterest = 0;
    let remainingBalance = amount;
    const schedule = {};
    const monthlyPrincipal = Math.round((amount / period) * 100) / 100;

    for (let i = 1; i <= period; i++) {
      const monthRate = i === 1 ? rate : 
                        i === 2 ? parseFloat(rules.month2 || rate) : 
                        parseFloat(rules.month3AndBeyond || rules.month2 || rate);
      const monthlyInterest = Math.round(remainingBalance * (monthRate / 100) * 100) / 100;
      
      totalInterest += monthlyInterest;
      remainingBalance -= monthlyPrincipal;

      const dueDate = new Date(disbursementDate);
      dueDate.setMonth(dueDate.getMonth() + i);

      const monthKey = dueDate.toLocaleString('default', { month: 'long' });
      schedule[monthKey] = {
        month: i,
        monthName: monthKey,
        principal: monthlyPrincipal,
        interest: monthlyInterest,
        interestRate: monthRate,
        amount: Math.round((monthlyPrincipal + monthlyInterest) * 100) / 100,
        dueDate: Timestamp.fromDate(dueDate),
        paid: false,
        paidAt: null,
        paidAmount: 0,
        penaltyAmount: 0
      };
    }
    
    totalInterest = Math.round(totalInterest * 100) / 100;

    const finalDueDate = new Date(disbursementDate);
    finalDueDate.setMonth(finalDueDate.getMonth() + period);
    const totalRepayable = Math.round((amount + totalInterest) * 100) / 100;

    const month1Rate = rate || parseFloat(rules.month1 || 10);
    const month2Rate = parseFloat(rules.month2 || rules.month1 || 7);
    const month3Rate = parseFloat(rules.month3AndBeyond || rules.month2 || 5);

    const member = members.find((m) => m.id === memberId);

    const loanDocRef = await addDoc(collection(db, `groups/${selectedGroupId}/loans`), {
      borrowerId: memberId,
      borrowerName: member?.fullName || "Unknown",
      amount,
      loanAmount: amount,
      repaymentPeriod: period,
      interestRate: month1Rate,
      totalInterest,
      totalRepayable,
      amountRepaid: 0,
      purpose,
      status: "active",
      createdAt: Timestamp.now(),
      disbursedAt: Timestamp.fromDate(new Date(disbursementDate)),
      approvedBy: currentUser.uid,
      approvedAt: Timestamp.now(),
      dueDate: Timestamp.fromDate(finalDueDate),
      repaymentSchedule: schedule,
      monthlyPrincipal: monthlyPrincipal,
      interestRates: {
        month1: month1Rate,
        month2: month2Rate,
        month3: month3Rate
      },
      updatedAt: Timestamp.now(),
    });

    // Update member financial summary
    const memberRef = doc(db, `groups/${selectedGroupId}/members`, memberId);
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      const financialSummary = memberDoc.data().financialSummary || {};
      await updateDoc(memberRef, {
        "financialSummary.totalLoans": (parseFloat(financialSummary.totalLoans || 0)) + amount,
        "financialSummary.activeLoans": (parseInt(financialSummary.activeLoans || 0)) + 1,
        "financialSummary.lastUpdated": Timestamp.now(),
      });
    }

    // Send notification to borrower
    await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
      userId: memberId,
      recipientId: memberId,
      type: "loan_disbursed",
      title: "Loan Disbursed",
      message: `A loan of ${formatCurrency(amount)} has been disbursed to you.\n\nLoan Details:\n- Principal: ${formatCurrency(amount)}\n- Total Interest: ${formatCurrency(totalInterest)}\n- Total Repayable: ${formatCurrency(totalRepayable)}\n- Repayment Period: ${period} month(s)\n- Final Due Date: ${finalDueDate.toLocaleDateString()}`,
      loanId: loanDocRef.id,
      groupId: selectedGroupId,
      groupName: groupData?.groupName || "Unknown Group",
      senderId: currentUser.uid,
      senderName: currentUser.displayName || currentUser.email,
      createdAt: Timestamp.now(),
      read: false,
    });

    if (window.closeModal) {
      window.closeModal("newLoanModal");
    } else {
      const modal = document.getElementById("newLoanModal");
      modal?.classList.remove("active");
      modal?.classList.add("hidden");
      modal.style.display = "none";
    }
    showToast("Loan disbursed successfully", "success");
    await loadGroupData();
  } catch (error) {
    console.error("Error disbursing loan:", error);
    showToast("Failed to disburse loan", "error");
  } finally {
    showSpinner(false);
  }
}

// Open record payment modal
function openRecordPaymentModal(loanId = null) {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }

  const modal = document.getElementById("recordPaymentModal");
  const loanSelect = document.getElementById("paymentLoanSelect");
  const paymentDate = document.getElementById("paymentDate");

  // Populate active loans
  const activeLoans = loans.filter((l) => l.status === "active");
  loanSelect.innerHTML = '<option value="">Choose an active loan...</option>';
  activeLoans.forEach((loan) => {
    const borrower = members.find((m) => m.id === loan.borrowerId)?.fullName || "Unknown";
    const remaining = (parseFloat(loan.totalRepayable || 0)) - (parseFloat(loan.amountRepaid || 0));
    loanSelect.innerHTML += `<option value="${loan.id}">${borrower} - ${formatCurrency(remaining)} remaining</option>`;
  });

  if (loanId) {
    loanSelect.value = loanId;
  }

  paymentDate.value = new Date().toISOString().split("T")[0];
  document.getElementById("recordPaymentForm")?.reset();
  paymentDate.value = new Date().toISOString().split("T")[0];

  if (window.openModal) {
    window.openModal("recordPaymentModal");
  } else {
    modal?.classList.add("active");
    modal?.classList.remove("hidden");
    modal.style.display = "flex";
  }
}

// Handle record payment
async function handleRecordPayment(e) {
  e.preventDefault();

  const loanId = document.getElementById("paymentLoanSelect")?.value;
  const amount = parseFloat(document.getElementById("paymentAmount")?.value || 0);
  const paymentDate = document.getElementById("paymentDate")?.value;
  const method = document.getElementById("paymentMethod")?.value;
  const notes = document.getElementById("paymentNotes")?.value;

  if (!loanId || !amount || !paymentDate) {
    showToast("Please fill in all required fields", "error");
    return;
  }

  if (amount <= 0) {
    showToast("Payment amount must be greater than 0", "error");
    return;
  }

  showSpinner(true);

  try {
    const loan = loans.find((l) => l.id === loanId);
    if (!loan) {
      showToast("Loan not found", "error");
      return;
    }

    const currentRepaid = parseFloat(loan.amountRepaid || 0);
    const totalRepayable = parseFloat(loan.totalRepayable || 0);
    const newRepaid = Math.round((currentRepaid + amount) * 100) / 100;
    
    // Determine new status
    const newStatus = newRepaid >= totalRepayable ? "repaid" : "active";
    const remaining = Math.max(0, Math.round((totalRepayable - newRepaid) * 100) / 100);

    // Update repayment schedule if exists
    let updatedSchedule = loan.repaymentSchedule || {};
    let amountToAllocate = amount;

    // Allocate payment to unpaid months in order (handle both object and array formats)
    if (updatedSchedule && typeof updatedSchedule === 'object') {
      // Convert array to object format if needed
      if (Array.isArray(updatedSchedule)) {
        const scheduleObj = {};
        updatedSchedule.forEach((item, index) => {
          const monthKey = item.monthName || `Month${index + 1}`;
          scheduleObj[monthKey] = item;
        });
        updatedSchedule = scheduleObj;
      }
      
      const sortedMonths = Object.keys(updatedSchedule).sort((a, b) => {
        const dateA = updatedSchedule[a].dueDate?.toDate ? updatedSchedule[a].dueDate.toDate() : new Date(0);
        const dateB = updatedSchedule[b].dueDate?.toDate ? updatedSchedule[b].dueDate.toDate() : new Date(0);
        return dateA - dateB;
      });

      for (const monthKey of sortedMonths) {
        if (amountToAllocate <= 0) break;
        
        const monthData = updatedSchedule[monthKey];
        if (!monthData.paid) {
          const monthAmount = parseFloat(monthData.amount || 0);
          const alreadyPaid = parseFloat(monthData.paidAmount || 0);
          const monthRemaining = monthAmount - alreadyPaid;
          
          if (monthRemaining > 0) {
            const paymentForMonth = Math.min(amountToAllocate, monthRemaining);
            const newPaidAmount = Math.round((alreadyPaid + paymentForMonth) * 100) / 100;
            
            updatedSchedule[monthKey] = {
              ...monthData,
              paidAmount: newPaidAmount,
              paid: newPaidAmount >= monthAmount,
              paidAt: newPaidAmount >= monthAmount ? Timestamp.fromDate(new Date(paymentDate)) : null
            };
            
            amountToAllocate -= paymentForMonth;
          }
        }
      }
    }

    await updateDoc(doc(db, `groups/${selectedGroupId}/loans`, loanId), {
      amountRepaid: newRepaid,
      status: newStatus,
      lastPaymentDate: Timestamp.fromDate(new Date(paymentDate)),
      lastPaymentAmount: amount,
      repaymentSchedule: updatedSchedule,
      updatedAt: Timestamp.now(),
      ...(newStatus === "repaid" && { 
        repaidAt: Timestamp.now(),
        remainingBalance: 0
      }),
      ...(newStatus === "active" && {
        remainingBalance: remaining
      })
    });

    // Record payment history
    await addDoc(collection(db, `groups/${selectedGroupId}/loans/${loanId}/payments`), {
      amount: amount,
      date: Timestamp.fromDate(new Date(paymentDate)),
      method: method,
      notes: notes,
      recordedBy: currentUser.uid,
      recordedByName: currentUser.email,
      previousBalance: totalRepayable - currentRepaid,
      newBalance: remaining,
      status: "approved",
      createdAt: Timestamp.now(),
      });

      // Update member financial summary
    const memberRef = doc(db, `groups/${selectedGroupId}/members`, loan.borrowerId);
      const memberDoc = await getDoc(memberRef);
      if (memberDoc.exists()) {
      const financialSummary = memberDoc.data().financialSummary || {};
        await updateDoc(memberRef, {
        "financialSummary.totalLoansPaid": Math.round(((parseFloat(financialSummary.totalLoansPaid || 0)) + amount) * 100) / 100,
        ...(newStatus === "repaid" && {
          "financialSummary.activeLoans": Math.max(0, (parseInt(financialSummary.activeLoans || 1)) - 1)
        }),
        "financialSummary.lastUpdated": Timestamp.now(),
        });
      }

      // Send notification to borrower
      await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
        userId: loan.borrowerId,
        recipientId: loan.borrowerId,
        type: newStatus === "repaid" ? "loan_repaid" : "loan_payment_recorded",
        title: newStatus === "repaid" ? "🎉 Loan Fully Repaid!" : "Loan Payment Recorded",
        message: newStatus === "repaid" 
          ? `Congratulations! Your loan has been fully repaid. Final payment of ${formatCurrency(amount)} recorded.\n\nTotal Repaid: ${formatCurrency(newRepaid)}\nLoan Amount: ${formatCurrency(amount)}\nTotal Interest: ${formatCurrency(parseFloat(loan.totalInterest || 0))}`
          : `A payment of ${formatCurrency(amount)} has been recorded for your loan.\n\nRemaining balance: ${formatCurrency(remaining)}\nTotal repaid: ${formatCurrency(newRepaid)} of ${formatCurrency(totalRepayable)}`,
        loanId: loanId,
        groupId: selectedGroupId,
        groupName: groupData?.groupName || "Unknown Group",
        senderId: currentUser.uid,
        createdAt: Timestamp.now(),
        read: false,
      });

    if (window.closeModal) {
      window.closeModal("recordPaymentModal");
    } else {
      const modal = document.getElementById("recordPaymentModal");
      modal?.classList.remove("active");
      modal?.classList.add("hidden");
      modal.style.display = "none";
    }
    showToast(newStatus === "repaid" ? "Loan fully repaid!" : "Payment recorded successfully", "success");
    await loadGroupData();
    } catch (error) {
    console.error("Error recording payment:", error);
    showToast("Failed to record payment: " + error.message, "error");
  } finally {
    showSpinner(false);
  }
}

// Open loan settings modal
function openLoanSettingsModal() {
  if (!selectedGroupId || !groupData) {
    showToast("Please select a group first", "error");
    return;
  }

  const rules = groupData.rules || {};
  const loanInterest = rules.loanInterest || {};
  const loanPenalty = rules.loanPenalty || {};
  const loanRules = rules.loanRules || {};

  document.getElementById("interestMonth1").value = loanInterest.month1 || 10;
  document.getElementById("interestMonth2").value = loanInterest.month2 || loanInterest.month1 || 10;
  document.getElementById("interestMonth3").value = loanInterest.month3AndBeyond || loanInterest.month2 || 10;
  document.getElementById("loanPenaltyRate").value = loanPenalty.rate || 5;
  document.getElementById("gracePeriod").value = loanPenalty.gracePeriodDays || 0;
  document.getElementById("minLoanAmount").value = loanRules.minLoanAmount || 10000;
  document.getElementById("maxLoanAmount").value = loanRules.maxLoanAmount || 500000;

  const modal = document.getElementById("loanSettingsModal");
  if (window.openModal) {
    window.openModal("loanSettingsModal");
  } else {
    modal?.classList.add("active");
    modal?.classList.remove("hidden");
    modal.style.display = "flex";
  }
}

// Handle save loan settings
async function handleSaveLoanSettings(e) {
  e.preventDefault();

  showSpinner(true);

  try {
    await updateDoc(doc(db, "groups", selectedGroupId), {
      "rules.loanInterest.month1": parseFloat(document.getElementById("interestMonth1").value || 10),
      "rules.loanInterest.month2": parseFloat(document.getElementById("interestMonth2").value || 10),
      "rules.loanInterest.month3AndBeyond": parseFloat(document.getElementById("interestMonth3").value || 10),
      "rules.loanPenalty.rate": parseFloat(document.getElementById("loanPenaltyRate").value || 5),
      "rules.loanPenalty.gracePeriodDays": parseInt(document.getElementById("gracePeriod").value || 0),
      "rules.loanRules.minLoanAmount": parseFloat(document.getElementById("minLoanAmount").value || 0),
      "rules.loanRules.maxLoanAmount": parseFloat(document.getElementById("maxLoanAmount").value || 0),
      updatedAt: Timestamp.now(),
    });

    if (window.closeModal) {
      window.closeModal("loanSettingsModal");
    } else {
      const modal = document.getElementById("loanSettingsModal");
      modal?.classList.remove("active");
      modal?.classList.add("hidden");
      modal.style.display = "none";
    }
    showToast("Loan settings saved successfully", "success");
    
    // Reload group data
    const groupDoc = await getDoc(doc(db, "groups", selectedGroupId));
    groupData = { id: groupDoc.id, ...groupDoc.data() };
    } catch (error) {
    console.error("Error saving loan settings:", error);
    showToast("Failed to save loan settings", "error");
  } finally {
    showSpinner(false);
  }
}

// Open communications modal
function openCommunicationsModal(specificMemberId = null) {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }

  const modal = document.getElementById("communicationsModal");
  const specificMemberSelect = document.getElementById("specificMember");

  // Populate members with active loans
  const borrowers = [...new Set(loans.filter((l) => l.status === "active").map((l) => l.borrowerId))];
  specificMemberSelect.innerHTML = '<option value="">Choose member...</option>';
  borrowers.forEach((borrowerId) => {
    const member = members.find((m) => m.id === borrowerId);
    if (member) {
      specificMemberSelect.innerHTML += `<option value="${member.id}">${member.fullName}</option>`;
    }
  });

  if (specificMemberId) {
    document.getElementById("reminderRecipient").value = "specific";
    document.getElementById("specificMemberGroup").style.display = "block";
    specificMemberSelect.value = specificMemberId;
  }

  updateMessageTemplate();
  if (window.openModal) {
    window.openModal("communicationsModal");
  } else {
    modal?.classList.add("active");
    modal?.classList.remove("hidden");
    modal.style.display = "flex";
  }
}

// Update message template
function updateMessageTemplate() {
  const messageType = document.getElementById("messageType")?.value;
  const messageEl = document.getElementById("reminderMessage");
  
  const templates = {
    payment_reminder: `Dear Member,\n\nThis is a friendly reminder that your loan payment is due soon. Please ensure timely payment to avoid penalties.\n\nThank you for your cooperation.\n\nBank Nkhonde Team`,
    overdue_notice: `Dear Member,\n\nYour loan payment is overdue. Please make the payment immediately to avoid additional penalties.\n\nContact your group administrator if you have any questions.\n\nBank Nkhonde Team`,
    penalty_warning: `Dear Member,\n\nThis is to notify you that penalty charges will be applied to your overdue loan if payment is not received within 3 days.\n\nPlease take immediate action.\n\nBank Nkhonde Team`,
    custom: "",
  };

  if (messageEl) {
    messageEl.value = templates[messageType] || "";
  }
}

// Handle send reminder
async function handleSendReminder(e) {
  e.preventDefault();

  const recipient = document.getElementById("reminderRecipient")?.value;
  const specificMember = document.getElementById("specificMember")?.value;
  const messageType = document.getElementById("messageType")?.value;
  const message = document.getElementById("reminderMessage")?.value;

  if (!message) {
    showToast("Please enter a message", "error");
    return;
  }

  showSpinner(true);

  try {
    let recipientIds = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (recipient === "all_overdue") {
      recipientIds = loans
        .filter((l) => {
          if (l.status !== "active") return false;
          const dueDate = l.dueDate?.toDate ? l.dueDate.toDate() : new Date(l.dueDate);
          return dueDate < today;
        })
        .map((l) => l.borrowerId);
    } else if (recipient === "all_active") {
      recipientIds = loans.filter((l) => l.status === "active").map((l) => l.borrowerId);
    } else if (recipient === "specific" && specificMember) {
      recipientIds = [specificMember];
    }

    const uniqueRecipients = [...new Set(recipientIds)];

    if (uniqueRecipients.length === 0) {
      showToast("No recipients found", "warning");
      showSpinner(false);
      return;
    }

    const batch = writeBatch(db);

    for (const userId of uniqueRecipients) {
      const notificationRef = doc(collection(db, `groups/${selectedGroupId}/notifications`));
      batch.set(notificationRef, {
        userId,
        type: messageType,
        title: messageType === "overdue_notice" ? "Overdue Notice" : 
               messageType === "penalty_warning" ? "Penalty Warning" : "Payment Reminder",
        message,
        createdAt: Timestamp.now(),
        read: false,
        sentBy: currentUser.uid,
      });
    }

    await batch.commit();

    if (window.closeModal) {
      window.closeModal("communicationsModal");
    } else {
      const modal = document.getElementById("communicationsModal");
      modal?.classList.remove("active");
      modal?.classList.add("hidden");
      modal.style.display = "none";
    }
    showToast(`Reminder sent to ${uniqueRecipients.length} member(s)`, "success");
    } catch (error) {
    console.error("Error sending reminder:", error);
    showToast("Failed to send reminder", "error");
  } finally {
    showSpinner(false);
  }
}

// Show loan details
function showLoanDetails(loan) {
  const borrower = members.find((m) => m.id === loan.borrowerId) || {};
  const amount = parseFloat(loan.amount || loan.loanAmount || 0);
  const interest = parseFloat(loan.totalInterest || 0);
  const repaid = parseFloat(loan.amountRepaid || 0);

  const modal = document.createElement("div");
  modal.className = "modal-overlay active";
  modal.id = "loanDetailsModal";
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 520px;">
      <div class="modal-header">
        <h2 class="modal-title">Loan Details</h2>
        <button class="modal-close" onclick="document.getElementById('loanDetailsModal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="display: flex; align-items: center; gap: var(--bn-space-4); margin-bottom: var(--bn-space-6); padding-bottom: var(--bn-space-4); border-bottom: 1px solid var(--bn-gray-lighter);">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: var(--bn-gradient-primary); color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.25rem;">
            ${borrower.fullName?.split(" ").map((n) => n[0]).join("").toUpperCase().substring(0, 2) || "??"}
          </div>
          <div>
            <div style="font-weight: 700; font-size: var(--bn-text-lg);">${borrower.fullName || "Unknown"}</div>
            <div style="font-size: var(--bn-text-sm); color: var(--bn-gray);">${borrower.phone || ""}</div>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--bn-space-4);">
          <div><span style="color: var(--bn-gray); font-size: var(--bn-text-sm);">Principal</span><div style="font-weight: 700;">${formatCurrency(amount)}</div></div>
          <div><span style="color: var(--bn-gray); font-size: var(--bn-text-sm);">Interest</span><div style="font-weight: 700;">${formatCurrency(interest)}</div></div>
          <div><span style="color: var(--bn-gray); font-size: var(--bn-text-sm);">Total Repayable</span><div style="font-weight: 700;">${formatCurrency(amount + interest)}</div></div>
          <div><span style="color: var(--bn-gray); font-size: var(--bn-text-sm);">Repaid</span><div style="font-weight: 700; color: var(--bn-success);">${formatCurrency(repaid)}</div></div>
          <div><span style="color: var(--bn-gray); font-size: var(--bn-text-sm);">Status</span><div><span class="badge badge-${loan.status === "repaid" ? "success" : loan.status === "active" ? "info" : "warning"}">${loan.status}</span></div></div>
          <div><span style="color: var(--bn-gray); font-size: var(--bn-text-sm);">Due Date</span><div style="font-weight: 600;">${loan.dueDate?.toDate ? loan.dueDate.toDate().toLocaleDateString() : "N/A"}</div></div>
        </div>
        ${loan.purpose ? `<div style="margin-top: var(--bn-space-4); padding: var(--bn-space-3); background: var(--bn-gray-100); border-radius: var(--bn-radius-md);"><span style="color: var(--bn-gray); font-size: var(--bn-text-xs); text-transform: uppercase;">Purpose</span><div style="font-size: var(--bn-text-sm);">${loan.purpose}</div></div>` : ""}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
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
// ============================================
// FORCED LOANS MANAGEMENT
// ============================================

async function handleForcedLoansToggle(e) {
  const isEnabled = e.target.checked;
  const statusEl = document.getElementById("forcedLoansStatus");
  const configBtn = document.getElementById("configForcedLoansBtn");
  const calculateBtn = document.getElementById("calculateForcedLoansBtn");
  const configDiv = document.getElementById("forcedLoansConfig");
  const emptyState = document.getElementById("forcedLoansEmptyState");
  
  if (!selectedGroupId) {
    showToast("Please select a group first", "warning");
    e.target.checked = false;
    return;
  }
  
  try {
    // Update group settings
    const groupRef = doc(db, "groups", selectedGroupId);
    await updateDoc(groupRef, {
      'settings.forcedLoans.enabled': isEnabled,
      updatedAt: new Date()
    });
    
    // Update UI
    statusEl.textContent = isEnabled ? "Enabled" : "Disabled";
    configBtn.style.display = isEnabled ? "block" : "none";
    calculateBtn.style.display = isEnabled ? "block" : "none";
    
    if (isEnabled) {
      // Load config if exists, otherwise show default
      await loadForcedLoansConfig();
      configDiv.style.display = "block";
      emptyState.style.display = "none";
    } else {
      configDiv.style.display = "none";
      emptyState.style.display = "block";
      document.getElementById("forcedLoansResults").style.display = "none";
    }
    
    showToast(`Forced loans ${isEnabled ? 'enabled' : 'disabled'}`, "success");
  } catch (error) {
    console.error("Error toggling forced loans:", error);
    showToast("Error updating settings", "error");
    e.target.checked = !isEnabled;
  }
}

async function loadForcedLoansConfig() {
  if (!groupData) return;
  
  const config = groupData.settings?.forcedLoans || {
    enabled: false,
    method: 'match_highest',
    period: 'monthly',
    minDeficit: 1000,
    percentageThreshold: 80,
    autoGenerate: false,
    notifyMembers: true
  };
  
  // Update UI with config
  document.getElementById("configMethod").textContent = 
    config.method === 'match_highest' ? 'Match Highest Interest Payer' :
    config.method === 'match_average' ? 'Match Average Interest' :
    `${config.percentageThreshold || 80}% of Highest`;
    
  document.getElementById("configPeriod").textContent = 
    config.period.charAt(0).toUpperCase() + config.period.slice(1);
    
  document.getElementById("configMinDeficit").textContent = formatCurrency(config.minDeficit || 1000);
}

function openForcedLoansConfigModal() {
  const config = groupData.settings?.forcedLoans || {};
  
  // Populate form with existing config
  document.getElementById("forcedLoansMethod").value = config.method || 'match_highest';
  document.getElementById("forcedLoansPeriod").value = config.period || 'monthly';
  document.getElementById("minDeficitAmount").value = config.minDeficit || 1000;
  document.getElementById("percentageThreshold").value = config.percentageThreshold || 80;
  document.getElementById("autoGenerateLoans").checked = config.autoGenerate || false;
  document.getElementById("notifyMembers").checked = config.notifyMembers !== false;
  
  // Show/hide percentage field
  const percentageGroup = document.getElementById("percentageThresholdGroup");
  percentageGroup.style.display = config.method === "percentage_of_highest" ? "block" : "none";
  
  const modal = document.getElementById("forcedLoansConfigModal");
  if (window.openModal) {
    window.openModal("forcedLoansConfigModal");
  } else {
    modal?.classList.add("active");
    modal?.classList.remove("hidden");
    if (modal) modal.style.display = "flex";
  }
}

async function handleSaveForcedLoansConfig(e) {
  e.preventDefault();
  
  if (!selectedGroupId) {
    showToast("Please select a group first", "warning");
    return;
  }
  
  const config = {
    enabled: true,
    method: document.getElementById("forcedLoansMethod").value,
    period: document.getElementById("forcedLoansPeriod").value,
    minDeficit: parseFloat(document.getElementById("minDeficitAmount").value),
    percentageThreshold: parseFloat(document.getElementById("percentageThreshold").value),
    autoGenerate: document.getElementById("autoGenerateLoans").checked,
    notifyMembers: document.getElementById("notifyMembers").checked,
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser.uid
  };
  
  try {
    showSpinner(true);
    const groupRef = doc(db, "groups", selectedGroupId);
    await updateDoc(groupRef, {
      'settings.forcedLoans': config,
      updatedAt: new Date()
    });
    
    groupData.settings = groupData.settings || {};
    groupData.settings.forcedLoans = config;
    
    await loadForcedLoansConfig();
    
    // Close modal
    const modal = document.getElementById("forcedLoansConfigModal");
    if (window.closeModal) {
      window.closeModal("forcedLoansConfigModal");
    } else {
      modal?.classList.remove("active");
      modal?.classList.add("hidden");
      if (modal) modal.style.display = "none";
    }
    
    showToast("Configuration saved successfully!", "success");
  } catch (error) {
    console.error("Error saving forced loans config:", error);
    showToast("Error saving configuration", "error");
  } finally {
    showSpinner(false);
  }
}

async function calculateForcedLoans() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "warning");
    return;
  }
  
  const config = groupData.settings?.forcedLoans;
  if (!config || !config.enabled) {
    showToast("Please enable and configure forced loans first", "warning");
    return;
  }
  
  if (!confirm("This will calculate and potentially create forced loans for members with interest deficits. Continue?")) {
    return;
  }
  
  try {
    showSpinner(true);
    
    // Calculate interest paid by each member
    const memberInterest = await calculateMemberInterest(config.period);
    
    if (memberInterest.length === 0) {
      showToast("No interest payments found for the selected period", "info");
      return;
    }
    
    // Find highest interest payer
    const highestInterest = Math.max(...memberInterest.map(m => m.totalInterest));
    const avgInterest = memberInterest.reduce((sum, m) => sum + m.totalInterest, 0) / memberInterest.length;
    
    // Calculate target based on method
    let targetInterest = 0;
    if (config.method === 'match_highest') {
      targetInterest = highestInterest;
    } else if (config.method === 'match_average') {
      targetInterest = avgInterest;
    } else if (config.method === 'percentage_of_highest') {
      targetInterest = highestInterest * (config.percentageThreshold / 100);
    }
    
    // Identify members with deficits
    const forcedLoansToCreate = [];
    for (const member of memberInterest) {
      const deficit = targetInterest - member.totalInterest;
      if (deficit > config.minDeficit) {
        forcedLoansToCreate.push({
          userId: member.userId,
          userName: member.userName,
          interestPaid: member.totalInterest,
          targetInterest: targetInterest,
          deficit: deficit
        });
      }
    }
    
    // Display results
    displayForcedLoansResults(forcedLoansToCreate, highestInterest, targetInterest);
    
    if (forcedLoansToCreate.length > 0 && 
        confirm(`Found ${forcedLoansToCreate.length} member(s) with deficits. Create forced loans now?`)) {
      await createForcedLoansInBatch(forcedLoansToCreate, config);
    }
    
  } catch (error) {
    console.error("Error calculating forced loans:", error);
    showToast("Error calculating forced loans", "error");
  } finally {
    showSpinner(false);
  }
}

async function calculateMemberInterest(period) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const membersRef = collection(db, "groups", selectedGroupId, "members");
  const membersSnapshot = await getDocs(membersRef);
  
  const results = [];
  
  for (const memberDoc of membersSnapshot.docs) {
    const userId = memberDoc.id;
    const memberData = memberDoc.data();
    let totalInterest = 0;
    
    // Get all active loans for this member
    const loansRef = collection(db, "groups", selectedGroupId, "loans");
    const loansQuery = query(loansRef, where("borrowerId", "==", userId));
    const loansSnapshot = await getDocs(loansQuery);
    
    for (const loanDoc of loansSnapshot.docs) {
      const loan = loanDoc.data();
      
      // Get payments for this loan
      const paymentsRef = collection(db, `groups/${selectedGroupId}/loans/${loanDoc.id}/payments`);
      const paymentsSnapshot = await getDocs(paymentsRef);
      
      paymentsSnapshot.forEach(paymentDoc => {
        const payment = paymentDoc.data();
        if (payment.status === "approved") {
          const paymentDate = payment.paidAt?.toDate() || payment.createdAt?.toDate();
          
          // Filter by period
          let includePayment = false;
          if (period === 'monthly') {
            includePayment = paymentDate && paymentDate.getFullYear() === currentYear && 
                            paymentDate.getMonth() + 1 === currentMonth;
          } else if (period === 'quarterly') {
            const quarter = Math.floor((currentMonth - 1) / 3);
            const paymentQuarter = paymentDate ? Math.floor((paymentDate.getMonth()) / 3) : -1;
            includePayment = paymentDate && paymentDate.getFullYear() === currentYear && 
                            paymentQuarter === quarter;
          } else if (period === 'annual' || period === 'ytd') {
            includePayment = paymentDate && paymentDate.getFullYear() === currentYear;
          }
          
          if (includePayment) {
            totalInterest += parseFloat(payment.interestAmount || 0);
          }
        }
      });
    }
    
    results.push({
      userId: userId,
      userName: memberData.fullName || memberData.email || "Unknown",
      totalInterest: totalInterest
    });
  }
  
  return results;
}

function displayForcedLoansResults(forcedLoans, highestInterest, targetInterest) {
  document.getElementById("forcedLoansEmptyState").style.display = "none";
  document.getElementById("forcedLoansResults").style.display = "block";
  
  // Update statistics
  document.getElementById("totalForcedLoans").textContent = forcedLoans.length;
  const totalDeficit = forcedLoans.reduce((sum, fl) => sum + fl.deficit, 0);
  document.getElementById("totalDeficitAmount").textContent = formatCurrency(totalDeficit);
  document.getElementById("highestInterestPaid").textContent = formatCurrency(highestInterest);
  document.getElementById("membersAffected").textContent = forcedLoans.length;
  
  // Display list
  const listEl = document.getElementById("forcedLoansList");
  if (forcedLoans.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <p class="empty-state-text">No members have interest deficits</p>
      </div>
    `;
    return;
  }
  
  listEl.innerHTML = forcedLoans.map(fl => `
    <div style="padding: var(--bn-space-4); background: rgba(255, 255, 255, 0.6); border-radius: var(--bn-radius-lg); border: 1px solid rgba(239, 68, 68, 0.2);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="flex: 1;">
          <div style="font-weight: 600; color: var(--bn-dark); margin-bottom: 4px;">${fl.userName}</div>
          <div style="font-size: var(--bn-text-sm); color: var(--bn-gray);">
            Interest Paid: ${formatCurrency(fl.interestPaid)} | 
            Target: ${formatCurrency(fl.targetInterest)} | 
            <strong style="color: var(--bn-danger);">Deficit: ${formatCurrency(fl.deficit)}</strong>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: var(--bn-text-lg); font-weight: 700; color: var(--bn-danger);">${formatCurrency(fl.deficit)}</div>
          <div style="font-size: var(--bn-text-xs); color: var(--bn-gray);">Forced Loan</div>
        </div>
      </div>
    </div>
  `).join('');
}

async function createForcedLoansInBatch(forcedLoans, config) {
  try {
    showSpinner(true);
    let created = 0;
    
    for (const fl of forcedLoans) {
      await createForcedLoan(fl, config);
      created++;
    }
    
    showToast(`Successfully created ${created} forced loan(s)`, "success");
    await loadGroupData(); // Refresh data
  } catch (error) {
    console.error("Error creating forced loans:", error);
    showToast("Error creating some forced loans", "error");
  } finally {
    showSpinner(false);
  }
}

async function createForcedLoan(memberDeficit, config) {
  const loanData = {
    borrowerId: memberDeficit.userId,
    borrowerName: memberDeficit.userName,
    loanAmount: Math.round(memberDeficit.deficit),
    purpose: `Forced loan - Interest deficit of ${formatCurrency(memberDeficit.deficit)}`,
    status: "active",
    type: "forced",
    repaymentPeriod: 1,
    requestedAt: new Date(),
    approvedAt: new Date(),
    disbursedAt: new Date(),
    approvedBy: currentUser.uid,
    disbursedBy: currentUser.uid,
    totalInterest: 0,
    totalRepayable: Math.round(memberDeficit.deficit),
    amountRepaid: 0,
    balanceRemaining: Math.round(memberDeficit.deficit),
    interestRates: groupData.rules?.loanInterest || {},
    metadata: {
      forcedLoan: true,
      targetInterest: memberDeficit.targetInterest,
      actualInterest: memberDeficit.interestPaid,
      deficit: memberDeficit.deficit,
      calculationPeriod: config.period,
      calculationMethod: config.method,
      createdAt: new Date().toISOString()
    }
  };
  
  // Create loan
  await addDoc(collection(db, "groups", selectedGroupId, "loans"), loanData);
  
  // Notify member if enabled
  if (config.notifyMembers) {
    await sendForcedLoanNotification(memberDeficit, loanData);
  }
}

async function sendForcedLoanNotification(memberDeficit, loanData) {
  try {
    const notificationData = {
      userId: memberDeficit.userId,
      type: "forced_loan_created",
      title: "Forced Loan Created",
      message: `A forced loan of ${formatCurrency(loanData.loanAmount)} has been created due to an interest payment deficit. Target was ${formatCurrency(memberDeficit.targetInterest)}, you paid ${formatCurrency(memberDeficit.interestPaid)}.`,
      read: false,
      createdAt: new Date(),
      data: {
        loanAmount: loanData.loanAmount,
        deficit: memberDeficit.deficit,
        groupId: selectedGroupId
      }
    };
    
    await addDoc(collection(db, "notifications"), notificationData);
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}

async function initializeForcedLoansSection() {
  if (!groupData) return;
  
  const config = groupData.settings?.forcedLoans;
  const isEnabled = config?.enabled || false;
  
  // Set toggle state
  const toggle = document.getElementById("forcedLoansToggle");
  const statusEl = document.getElementById("forcedLoansStatus");
  const configBtn = document.getElementById("configForcedLoansBtn");
  const calculateBtn = document.getElementById("calculateForcedLoansBtn");
  const configDiv = document.getElementById("forcedLoansConfig");
  const emptyState = document.getElementById("forcedLoansEmptyState");
  const resultsDiv = document.getElementById("forcedLoansResults");
  
  if (toggle) toggle.checked = isEnabled;
  if (statusEl) statusEl.textContent = isEnabled ? "Enabled" : "Disabled";
  
  if (configBtn) configBtn.style.display = isEnabled ? "block" : "none";
  if (calculateBtn) calculateBtn.style.display = isEnabled ? "block" : "none";
  
  if (isEnabled && config) {
    if (configDiv) configDiv.style.display = "block";
    if (emptyState) emptyState.style.display = "none";
    await loadForcedLoansConfig();
  } else {
    if (configDiv) configDiv.style.display = "none";
    if (emptyState) emptyState.style.display = "block";
    if (resultsDiv) resultsDiv.style.display = "none";
  }
}
