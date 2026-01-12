/**
 * Loan Payments - User loan payment management
 * Upload payments, track status, view history
 */

import {
  db,
  auth,
  storage,
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
  ref,
  uploadBytes,
  getDownloadURL,
} from "./firebaseConfig.js";

let currentUser = null;
let userGroups = [];
let currentGroupId = null;
let activeLoans = [];
let pendingPayments = [];
let paymentHistory = [];

document.addEventListener("DOMContentLoaded", () => {
  const groupSelector = document.getElementById("groupSelector");
  const makePaymentBtn = document.getElementById("makePaymentBtn");
  const paymentModal = document.getElementById("paymentModal");
  const closePaymentModal = document.getElementById("closePaymentModal");
  const loanPaymentForm = document.getElementById("loanPaymentForm");

  // Auth state
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    currentUser = user;
    await loadUserGroups();
  });

  // Group selector
  if (groupSelector) {
    groupSelector.addEventListener("change", async (e) => {
      currentGroupId = e.target.value;
      if (currentGroupId) {
        await loadLoanData();
      } else {
        clearDisplay();
      }
    });
  }

  // Make payment button
  if (makePaymentBtn) {
    makePaymentBtn.addEventListener("click", () => {
      if (activeLoans.length > 0) {
        openPaymentModal(activeLoans[0]);
      }
    });
  }

  // Close modal
  if (closePaymentModal) {
    closePaymentModal.addEventListener("click", () => closeModal(paymentModal));
  }

  // Payment form
  if (loanPaymentForm) {
    loanPaymentForm.addEventListener("submit", handlePaymentSubmit);
  }

  // Set default payment date
  const paymentDateInput = document.getElementById("paymentDate");
  if (paymentDateInput) {
    paymentDateInput.value = new Date().toISOString().split("T")[0];
  }

  /**
   * Load user groups
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

        // Auto-select first group
        if (userGroups.length > 0) {
          groupSelector.value = userGroups[0].id;
          currentGroupId = userGroups[0].id;
          await loadLoanData();
        }
      }
    } catch (error) {
      console.error("Error loading groups:", error);
    }
  }

  /**
   * Load loan data for current group
   */
  async function loadLoanData() {
    if (!currentGroupId) return;

    try {
      // Load active loans
      const loansRef = collection(db, `groups/${currentGroupId}/loans`);
      const q = query(
        loansRef,
        where("borrowerId", "==", currentUser.uid),
        where("status", "in", ["active", "approved", "disbursed"]),
        orderBy("requestedAt", "desc")
      );
      const loansSnapshot = await getDocs(q);

      activeLoans = [];
      let totalOutstanding = 0;
      let totalPaid = 0;

      for (const loanDoc of loansSnapshot.docs) {
        const loan = { id: loanDoc.id, ...loanDoc.data() };
        activeLoans.push(loan);
        totalOutstanding += parseFloat(loan.amountRemaining || 0);
        totalPaid += parseFloat(loan.amountPaid || 0);
      }

      // Load pending payments
      await loadPendingPayments();

      // Load payment history
      await loadPaymentHistory();

      updateStats();
      displayActiveLoans();
      displayPendingPayments();
      displayPaymentHistory();
    } catch (error) {
      console.error("Error loading loan data:", error);
    }
  }

  /**
   * Load pending payments
   */
  async function loadPendingPayments() {
    pendingPayments = [];
    
    for (const loan of activeLoans) {
      const paymentsRef = collection(db, `groups/${currentGroupId}/loans/${loan.id}/payments`);
      const q = query(
        paymentsRef,
        where("status", "==", "pending"),
        orderBy("submittedAt", "desc")
      );
      const paymentsSnapshot = await getDocs(q);

      paymentsSnapshot.forEach(paymentDoc => {
        pendingPayments.push({
          ...paymentDoc.data(),
          id: paymentDoc.id,
          loanId: loan.id,
          loanAmount: loan.loanAmount
        });
      });
    }
  }

  /**
   * Load payment history
   */
  async function loadPaymentHistory() {
    paymentHistory = [];
    
    for (const loan of activeLoans) {
      const paymentsRef = collection(db, `groups/${currentGroupId}/loans/${loan.id}/payments`);
      const q = query(
        paymentsRef,
        where("status", "==", "approved"),
        orderBy("approvedAt", "desc")
      );
      const paymentsSnapshot = await getDocs(q);

      paymentsSnapshot.forEach(paymentDoc => {
        paymentHistory.push({
          ...paymentDoc.data(),
          id: paymentDoc.id,
          loanId: loan.id,
          loanAmount: loan.loanAmount
        });
      });
    }

    // Sort by date (most recent first)
    paymentHistory.sort((a, b) => {
      const dateA = a.approvedAt?.toDate ? a.approvedAt.toDate() : new Date(0);
      const dateB = b.approvedAt?.toDate ? b.approvedAt.toDate() : new Date(0);
      return dateB - dateA;
    });
  }

  /**
   * Update statistics
   */
  function updateStats() {
    const activeLoansCount = document.getElementById("activeLoansCount");
    const totalOutstandingEl = document.getElementById("totalOutstanding");
    const totalPaidEl = document.getElementById("totalPaid");
    const pendingPaymentsCountEl = document.getElementById("pendingPaymentsCount");

    let totalOutstanding = 0;
    let totalPaid = 0;

    activeLoans.forEach(loan => {
      totalOutstanding += parseFloat(loan.amountRemaining || 0);
      totalPaid += parseFloat(loan.amountPaid || 0);
    });

    if (activeLoansCount) activeLoansCount.textContent = activeLoans.length;
    if (totalOutstandingEl) totalOutstandingEl.textContent = formatCurrency(totalOutstanding);
    if (totalPaidEl) totalPaidEl.textContent = formatCurrency(totalPaid);
    if (pendingPaymentsCountEl) pendingPaymentsCountEl.textContent = pendingPayments.length;

    // Show/hide make payment button
    if (makePaymentBtn) {
      makePaymentBtn.style.display = activeLoans.length > 0 ? "block" : "none";
    }
  }

  /**
   * Display active loans
   */
  function displayActiveLoans() {
    const activeLoansList = document.getElementById("activeLoansList");
    if (!activeLoansList) return;

    if (activeLoans.length === 0) {
      activeLoansList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💰</div><p class="empty-state-text">No active loans</p></div>';
      return;
    }

    activeLoansList.innerHTML = '';
    activeLoans.forEach(loan => {
      const loanElement = createLoanElement(loan);
      activeLoansList.appendChild(loanElement);
    });
  }

  /**
   * Create loan element
   */
  function createLoanElement(loan) {
    const div = document.createElement("div");
    div.className = "list-item";
    
    const loanAmount = parseFloat(loan.loanAmount || 0);
    const amountPaid = parseFloat(loan.amountPaid || 0);
    const amountRemaining = parseFloat(loan.amountRemaining || loanAmount) - amountPaid;
    const progress = loanAmount > 0 ? (amountPaid / loanAmount) * 100 : 0;
    const disbursedDate = loan.disbursedAt?.toDate ? loan.disbursedAt.toDate().toLocaleDateString() : "N/A";

    div.innerHTML = `
      <div style="flex: 1;">
        <div class="list-item-title">Loan #${loan.id.substring(0, 8)}</div>
        <div class="list-item-subtitle">Purpose: ${loan.purpose || "Not specified"} • Disbursed ${disbursedDate}</div>
        <div style="margin-top: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.875rem;">
            <span>Loan Amount: <strong>${formatCurrency(loanAmount)}</strong></span>
            <span>Paid: <strong>${formatCurrency(amountPaid)}</strong></span>
          </div>
          <div style="background: rgba(255, 255, 255, 0.1); border-radius: 4px; height: 8px; overflow: hidden;">
            <div style="background: var(--bn-primary); height: 100%; width: ${Math.min(100, progress)}%; transition: width 0.3s;"></div>
          </div>
          <div style="margin-top: 4px; font-size: 0.75rem; color: rgba(255, 255, 255, 0.7);">
            ${progress.toFixed(1)}% complete • Remaining: <strong style="color: var(--bn-warning);">${formatCurrency(Math.max(0, amountRemaining))}</strong>
          </div>
        </div>
      </div>
      <div>
        <button class="btn btn-primary btn-sm" data-action="pay" data-loan-id="${loan.id}">Make Payment</button>
      </div>
    `;

    div.querySelector('[data-action="pay"]').addEventListener("click", () => openPaymentModal(loan));

    return div;
  }

  /**
   * Display pending payments
   */
  function displayPendingPayments() {
    const pendingPaymentsList = document.getElementById("pendingPaymentsList");
    if (!pendingPaymentsList) return;

    if (pendingPayments.length === 0) {
      pendingPaymentsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><p class="empty-state-text">No pending payments</p></div>';
      return;
    }

    pendingPaymentsList.innerHTML = '';
    pendingPayments.forEach(payment => {
      const paymentElement = createPendingPaymentElement(payment);
      pendingPaymentsList.appendChild(paymentElement);
    });
  }

  /**
   * Create pending payment element
   */
  function createPendingPaymentElement(payment) {
    const div = document.createElement("div");
    div.className = "list-item";
    
    const submittedDate = payment.submittedAt?.toDate ? payment.submittedAt.toDate().toLocaleDateString() : "N/A";
    const amount = parseFloat(payment.amount || 0);

    div.innerHTML = `
      <div style="flex: 1;">
        <div class="list-item-title">Payment of ${formatCurrency(amount)}</div>
        <div class="list-item-subtitle">Loan #${payment.loanId.substring(0, 8)} • Submitted ${submittedDate}</div>
        ${payment.notes ? `<div style="margin-top: 4px; font-size: 0.875rem; color: rgba(255, 255, 255, 0.7);">📝 ${payment.notes}</div>` : ''}
      </div>
      <div>
        <span class="badge badge-warning">Pending Approval</span>
        ${payment.proofUrl ? `<a href="${payment.proofUrl}" target="_blank" class="btn btn-ghost btn-sm" style="margin-top: 8px;">View Proof</a>` : ''}
      </div>
    `;

    return div;
  }

  /**
   * Display payment history
   */
  function displayPaymentHistory() {
    const paymentHistoryList = document.getElementById("paymentHistoryList");
    if (!paymentHistoryList) return;

    if (paymentHistory.length === 0) {
      paymentHistoryList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">No payment history</p></div>';
      return;
    }

    // Show only last 10
    const recentHistory = paymentHistory.slice(0, 10);

    paymentHistoryList.innerHTML = '';
    recentHistory.forEach(payment => {
      const paymentElement = createHistoryPaymentElement(payment);
      paymentHistoryList.appendChild(paymentElement);
    });
  }

  /**
   * Create history payment element
   */
  function createHistoryPaymentElement(payment) {
    const div = document.createElement("div");
    div.className = "list-item";
    
    const approvedDate = payment.approvedAt?.toDate ? payment.approvedAt.toDate().toLocaleDateString() : "N/A";
    const paymentDate = payment.paymentDate?.toDate ? payment.paymentDate.toDate().toLocaleDateString() : "N/A";
    const amount = parseFloat(payment.amount || 0);
    const penalty = parseFloat(payment.penaltyAmount || 0);

    div.innerHTML = `
      <div style="flex: 1;">
        <div class="list-item-title">${formatCurrency(amount)}${penalty > 0 ? ` <span style="color: var(--bn-danger);">(+ ${formatCurrency(penalty)} penalty)</span>` : ''}</div>
        <div class="list-item-subtitle">Loan #${payment.loanId.substring(0, 8)} • Paid ${paymentDate} • Approved ${approvedDate}</div>
        ${payment.notes ? `<div style="margin-top: 4px; font-size: 0.875rem; color: rgba(255, 255, 255, 0.7);">📝 ${payment.notes}</div>` : ''}
        ${payment.adminNotes ? `<div style="margin-top: 4px; font-size: 0.875rem; color: rgba(255, 255, 255, 0.6);">💬 Admin: ${payment.adminNotes}</div>` : ''}
      </div>
      <div>
        <span class="badge badge-success">Approved</span>
        ${payment.proofUrl ? `<a href="${payment.proofUrl}" target="_blank" class="btn btn-ghost btn-sm" style="margin-top: 8px;">View Proof</a>` : ''}
      </div>
    `;

    return div;
  }

  /**
   * Open payment modal
   */
  function openPaymentModal(loan) {
    const paymentLoanId = document.getElementById("paymentLoanId");
    const loanReference = document.getElementById("loanReference");
    const outstandingBalance = document.getElementById("outstandingBalance");
    const paymentAmount = document.getElementById("paymentAmount");

    if (paymentLoanId) paymentLoanId.value = loan.id;
    if (loanReference) loanReference.value = `LOAN-${loan.id.substring(0, 8).toUpperCase()}`;
    
    const remaining = parseFloat(loan.amountRemaining || loan.loanAmount || 0) - parseFloat(loan.amountPaid || 0);
    if (outstandingBalance) outstandingBalance.value = formatCurrency(remaining);
    if (paymentAmount) {
      paymentAmount.max = remaining;
      paymentAmount.placeholder = `Max: ${formatCurrency(remaining)}`;
    }

    openModal(paymentModal);
  }

  /**
   * Handle payment submit
   */
  async function handlePaymentSubmit(e) {
    e.preventDefault();

    const loanId = document.getElementById("paymentLoanId").value;
    const amount = parseFloat(document.getElementById("paymentAmount").value);
    const paymentDate = document.getElementById("paymentDate").value;
    const proofFile = document.getElementById("paymentProof").files[0];
    const notes = document.getElementById("paymentNotes").value.trim();

    if (!loanId || !amount || !paymentDate || !proofFile) {
      alert("Please fill in all required fields.");
      return;
    }

    // Validate amount
    const loan = activeLoans.find(l => l.id === loanId);
    if (!loan) {
      alert("Loan not found.");
      return;
    }

    const remaining = parseFloat(loan.amountRemaining || loan.loanAmount || 0) - parseFloat(loan.amountPaid || 0);
    if (amount > remaining) {
      alert(`Payment amount cannot exceed outstanding balance of ${formatCurrency(remaining)}.`);
      return;
    }

    try {
      // Upload proof
      const storageRef = ref(storage, `loan-payments/${currentUser.uid}/${loanId}/${Date.now()}_${proofFile.name}`);
      await uploadBytes(storageRef, proofFile);
      const proofUrl = await getDownloadURL(storageRef);

      // Create payment document
      const paymentData = {
        loanId: loanId,
        borrowerId: currentUser.uid,
        amount: amount,
        paymentDate: Timestamp.fromDate(new Date(paymentDate)),
        proofUrl: proofUrl,
        notes: notes || "",
        status: "pending",
        submittedAt: Timestamp.now(),
        approvedAt: null,
        approvedBy: null,
        penaltyAmount: 0,
        adminNotes: "",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      const paymentsRef = collection(db, `groups/${currentGroupId}/loans/${loanId}/payments`);
      await addDoc(paymentsRef, paymentData);

      alert("Payment submitted successfully! It will be reviewed by an admin.");
      closeModal(paymentModal);
      loanPaymentForm.reset();
      document.getElementById("paymentDate").value = new Date().toISOString().split("T")[0];
      
      await loadLoanData();
    } catch (error) {
      console.error("Error submitting payment:", error);
      alert("Error submitting payment. Please try again.");
    }
  }

  /**
   * Clear display
   */
  function clearDisplay() {
    const activeLoansList = document.getElementById("activeLoansList");
    const pendingPaymentsList = document.getElementById("pendingPaymentsList");
    const paymentHistoryList = document.getElementById("paymentHistoryList");

    if (activeLoansList) activeLoansList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💰</div><p class="empty-state-text">Select a group to view loans</p></div>';
    if (pendingPaymentsList) pendingPaymentsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><p class="empty-state-text">Select a group to view payments</p></div>';
    if (paymentHistoryList) paymentHistoryList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">Select a group to view history</p></div>';
    
    updateStats();
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
