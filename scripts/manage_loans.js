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
      renderLoans();
    });
  });

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
}

function setupModalCloseHandlers(modalId, closeBtn1, closeBtn2) {
  const modal = document.getElementById(modalId);
  const closeModal = () => modal?.classList.remove("active");
  
  document.getElementById(closeBtn1)?.addEventListener("click", closeModal);
  document.getElementById(closeBtn2)?.addEventListener("click", closeModal);
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
    const sessionGroupId = sessionStorage.getItem("selectedGroupId");
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
  } catch (error) {
    console.error("Error loading members:", error);
  }
}

// Load loans
async function loadLoans() {
  try {
    const loansRef = collection(db, `groups/${selectedGroupId}/loans`);
    const loansSnapshot = await getDocs(loansRef);

    loans = [];
    loansSnapshot.forEach((doc) => {
      loans.push({ id: doc.id, ...doc.data() });
    });

    // Sort by date
    loans.sort((a, b) => {
      const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
      const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
      return dateB - dateA;
    });
    } catch (error) {
      console.error("Error loading loans:", error);
  }
}

// Update stats
function updateStats() {
  const pending = loans.filter((l) => l.status === "pending").length;
  const active = loans.filter((l) => l.status === "active").length;
  
  let totalDisbursed = 0;
  let totalOutstanding = 0;

  loans.forEach((loan) => {
    const amount = parseFloat(loan.amount || loan.loanAmount || 0);
    const repaid = parseFloat(loan.amountRepaid || 0);
    const interest = parseFloat(loan.totalInterest || 0);

    if (loan.status === "active" || loan.status === "repaid") {
      totalDisbursed += amount;
    }
    if (loan.status === "active") {
      totalOutstanding += (amount + interest - repaid);
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
      filteredLoans = loans.filter((l) => l.status === "pending");
      break;
    case "active":
      filteredLoans = loans.filter((l) => l.status === "active");
      break;
    case "repaid":
      filteredLoans = loans.filter((l) => l.status === "repaid");
      break;
    case "overdue":
      filteredLoans = loans.filter((l) => {
        if (l.status !== "active") return false;
        const dueDate = l.dueDate?.toDate ? l.dueDate.toDate() : new Date(l.dueDate);
        return dueDate < today;
      });
      break;
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
  const initials = borrower.fullName?.split(" ").map((n) => n[0]).join("").toUpperCase().substring(0, 2) || "??";
  
  const amount = parseFloat(loan.amount || loan.loanAmount || 0);
  const interest = parseFloat(loan.totalInterest || 0);
  const repaid = parseFloat(loan.amountRepaid || 0);
  const totalDue = amount + interest;
  const remaining = totalDue - repaid;
  const progressPercent = totalDue > 0 ? Math.min((repaid / totalDue) * 100, 100) : 0;

  const createdDate = loan.createdAt?.toDate ? loan.createdAt.toDate().toLocaleDateString() : "N/A";
  const dueDate = loan.dueDate?.toDate ? loan.dueDate.toDate().toLocaleDateString() : "N/A";

  const statusClass = loan.status === "repaid" ? "success" : loan.status === "active" ? "info" : "warning";

  let actionsHTML = "";
  if (loan.status === "pending") {
    actionsHTML = `
      <button class="btn btn-accent" data-action="approve" data-loan-id="${loan.id}">Approve & Disburse</button>
      <button class="btn btn-danger" data-action="reject" data-loan-id="${loan.id}">Reject</button>
    `;
  } else if (loan.status === "active") {
    actionsHTML = `
      <button class="btn btn-accent" data-action="payment" data-loan-id="${loan.id}">Record Payment</button>
      <button class="btn btn-secondary" data-action="reminder" data-loan-id="${loan.id}">Send Reminder</button>
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
            <div class="loan-borrower-name">${borrower.fullName || "Unknown"}</div>
            <div class="loan-borrower-date">Applied: ${createdDate}</div>
          </div>
          </div>
        <span class="badge badge-${statusClass}">${loan.status}</span>
          </div>
      <div class="loan-card-body">
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
async function approveLoan(loanId) {
  if (!confirm("Approve and disburse this loan?")) return;

  showSpinner(true);

  try {
    const loan = loans.find((l) => l.id === loanId);
    const amount = parseFloat(loan.amount || loan.loanAmount || 0);
    const period = parseInt(loan.repaymentPeriod || 1);
    
    // Calculate interest
    const rules = groupData?.rules?.loanInterest || {};
    const month1Rate = parseFloat(rules.month1 || 10);
    const month2Rate = parseFloat(rules.month2 || rules.month1 || 10);
    const month3Rate = parseFloat(rules.month3AndBeyond || rules.month2 || rules.month1 || 10);

    let totalInterest = 0;
    let remainingBalance = amount;
    const schedule = [];

    for (let i = 1; i <= period; i++) {
      const rate = i === 1 ? month1Rate : i === 2 ? month2Rate : month3Rate;
      const monthlyInterest = remainingBalance * (rate / 100);
      const principal = amount / period;
      
      totalInterest += monthlyInterest;
      remainingBalance -= principal;

      const dueDate = new Date();
      dueDate.setMonth(dueDate.getMonth() + i);

      schedule.push({
        month: i,
        principal,
        interest: monthlyInterest,
        total: principal + monthlyInterest,
        dueDate: Timestamp.fromDate(dueDate),
        paid: false,
        paidAt: null,
      });
    }

    const finalDueDate = new Date();
    finalDueDate.setMonth(finalDueDate.getMonth() + period);

    await updateDoc(doc(db, `groups/${selectedGroupId}/loans`, loanId), {
      status: "active",
        approvedBy: currentUser.uid,
      approvedAt: Timestamp.now(),
        disbursedAt: Timestamp.now(),
      totalInterest,
      totalRepayable: amount + totalInterest,
      amountRepaid: 0,
      dueDate: Timestamp.fromDate(finalDueDate),
      repaymentSchedule: schedule,
      updatedAt: Timestamp.now(),
    });

    // Send notification to borrower
    await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
      userId: loan.borrowerId,
      type: "loan_approved",
      title: "Loan Approved",
      message: `Your loan of ${formatCurrency(amount)} has been approved and disbursed.`,
      createdAt: Timestamp.now(),
      read: false,
    });

    showToast("Loan approved and disbursed successfully", "success");
    await loadGroupData();
    } catch (error) {
      console.error("Error approving loan:", error);
    showToast("Failed to approve loan", "error");
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
        status: "rejected",
        rejectedBy: currentUser.uid,
      rejectedAt: Timestamp.now(),
      rejectionReason: reason,
      updatedAt: Timestamp.now(),
    });

    // Send notification
    await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
      userId: loan.borrowerId,
      type: "loan_rejected",
      title: "Loan Request Rejected",
      message: `Your loan request was rejected. Reason: ${reason}`,
      createdAt: Timestamp.now(),
      read: false,
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

  modal?.classList.add("active");
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
    const schedule = [];

    for (let i = 1; i <= period; i++) {
      const monthRate = i === 1 ? rate : 
                        i === 2 ? parseFloat(rules.month2 || rate) : 
                        parseFloat(rules.month3AndBeyond || rules.month2 || rate);
      const monthlyInterest = remainingBalance * (monthRate / 100);
      const principal = amount / period;
      
      totalInterest += monthlyInterest;
      remainingBalance -= principal;

      const dueDate = new Date(disbursementDate);
      dueDate.setMonth(dueDate.getMonth() + i);

      schedule.push({
        month: i,
        principal,
        interest: monthlyInterest,
        interestRate: monthRate,
        total: principal + monthlyInterest,
        dueDate: Timestamp.fromDate(dueDate),
        paid: false,
        paidAt: null,
      });
    }

    const finalDueDate = new Date(disbursementDate);
    finalDueDate.setMonth(finalDueDate.getMonth() + period);

    const member = members.find((m) => m.id === memberId);

    await addDoc(collection(db, `groups/${selectedGroupId}/loans`), {
      borrowerId: memberId,
      borrowerName: member?.fullName || "Unknown",
      amount,
      loanAmount: amount,
      repaymentPeriod: period,
      interestRate: rate,
      totalInterest,
      totalRepayable: amount + totalInterest,
      amountRepaid: 0,
      purpose,
      status: "active",
      createdAt: Timestamp.now(),
      disbursedAt: Timestamp.fromDate(new Date(disbursementDate)),
      approvedBy: currentUser.uid,
      approvedAt: Timestamp.now(),
      dueDate: Timestamp.fromDate(finalDueDate),
      repaymentSchedule: schedule,
    });

    // Update member financial summary
    const memberRef = doc(db, `groups/${selectedGroupId}/members`, memberId);
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      const financialSummary = memberDoc.data().financialSummary || {};
      await updateDoc(memberRef, {
        "financialSummary.totalLoans": (parseFloat(financialSummary.totalLoans || 0)) + amount,
        "financialSummary.lastUpdated": Timestamp.now(),
      });
    }

    // Send notification
    await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
      userId: memberId,
      type: "loan_disbursed",
      title: "Loan Disbursed",
      message: `A loan of ${formatCurrency(amount)} has been disbursed to you. Total repayable: ${formatCurrency(amount + totalInterest)}.`,
      createdAt: Timestamp.now(),
      read: false,
    });

    document.getElementById("newLoanModal")?.classList.remove("active");
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

  modal?.classList.add("active");
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

  showSpinner(true);

  try {
    const loan = loans.find((l) => l.id === loanId);
    const currentRepaid = parseFloat(loan.amountRepaid || 0);
    const totalRepayable = parseFloat(loan.totalRepayable || 0);
    const newRepaid = currentRepaid + amount;
    
    const newStatus = newRepaid >= totalRepayable ? "repaid" : "active";

    await updateDoc(doc(db, `groups/${selectedGroupId}/loans`, loanId), {
      amountRepaid: newRepaid,
        status: newStatus,
      lastPaymentDate: Timestamp.fromDate(new Date(paymentDate)),
      lastPaymentAmount: amount,
      updatedAt: Timestamp.now(),
      ...(newStatus === "repaid" && { repaidAt: Timestamp.now() }),
    });

    // Record payment history
    await addDoc(collection(db, `groups/${selectedGroupId}/loans/${loanId}/payments`), {
      amount,
      date: Timestamp.fromDate(new Date(paymentDate)),
      method,
      notes,
      recordedBy: currentUser.uid,
      createdAt: Timestamp.now(),
      });

      // Update member financial summary
    const memberRef = doc(db, `groups/${selectedGroupId}/members`, loan.borrowerId);
      const memberDoc = await getDoc(memberRef);
      if (memberDoc.exists()) {
      const financialSummary = memberDoc.data().financialSummary || {};
        await updateDoc(memberRef, {
        "financialSummary.totalLoansPaid": (parseFloat(financialSummary.totalLoansPaid || 0)) + amount,
        "financialSummary.lastUpdated": Timestamp.now(),
        });
      }

      // Send notification
    await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
      userId: loan.borrowerId,
      type: "payment_recorded",
      title: "Loan Payment Recorded",
      message: `A payment of ${formatCurrency(amount)} has been recorded for your loan.${newStatus === "repaid" ? " Your loan is now fully repaid!" : ""}`,
      createdAt: Timestamp.now(),
      read: false,
    });

    document.getElementById("recordPaymentModal")?.classList.remove("active");
    showToast(newStatus === "repaid" ? "Loan fully repaid!" : "Payment recorded successfully", "success");
    await loadGroupData();
    } catch (error) {
    console.error("Error recording payment:", error);
    showToast("Failed to record payment", "error");
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

  document.getElementById("loanSettingsModal")?.classList.add("active");
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

    document.getElementById("loanSettingsModal")?.classList.remove("active");
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
  modal?.classList.add("active");
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

    document.getElementById("communicationsModal")?.classList.remove("active");
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
