/**
 * Manage Loans - Full Implementation
 * Approve, reject, and track loans
 */

import {
  db,
  auth,
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  onAuthStateChanged,
  query,
  where,
  Timestamp,
  orderBy,
  deleteDoc,
} from "./firebaseConfig.js";

let currentUser = null;
let adminGroups = [];
let currentGroupId = null;
let pendingLoansData = [];
let activeLoansData = [];

document.addEventListener("DOMContentLoaded", () => {
  const groupSelector = document.getElementById("groupSelector");
  const pendingLoansList = document.getElementById("pendingLoansList");
  const activeLoansList = document.getElementById("activeLoansList");
  const refreshBtn = document.getElementById("refreshBtn");

  // Auth state
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    currentUser = user;
    await loadAdminGroups();
  });

  // Group selector
  if (groupSelector) {
    groupSelector.addEventListener("change", async (e) => {
      currentGroupId = e.target.value;
      if (currentGroupId) {
        await loadLoanData(currentGroupId);
      } else {
        pendingLoansList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💰</div><p class="empty-state-text">Select a group to view loans</p></div>';
        activeLoansList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">Select a group to view loans</p></div>';
        updateStats(0, 0, 0, 0);
      }
    });
  }

  // Refresh button
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      if (currentGroupId) {
        await loadLoanData(currentGroupId);
      }
    });
  }

  /**
   * Load admin groups
   */
  async function loadAdminGroups() {
    try {
      adminGroups = [];
      const groupsSnapshot = await getDocs(collection(db, "groups"));
      
      groupsSnapshot.forEach(doc => {
        const groupData = doc.data();
        if (groupData.admins && groupData.admins.some(admin => admin.uid === currentUser.uid)) {
          adminGroups.push({ ...groupData, groupId: doc.id });
        }
      });

      // Populate selector
      if (groupSelector) {
        groupSelector.innerHTML = '<option value="">Select a group...</option>';
        adminGroups.forEach(group => {
          const option = document.createElement("option");
          option.value = group.groupId;
          option.textContent = group.groupName;
          groupSelector.appendChild(option);
        });

        // Auto-select first group
        if (adminGroups.length > 0) {
          groupSelector.value = adminGroups[0].groupId;
          currentGroupId = adminGroups[0].groupId;
          await loadLoanData(currentGroupId);
        }
      }
    } catch (error) {
      console.error("Error loading groups:", error);
    }
  }

  /**
   * Load loan data
   */
  async function loadLoanData(groupId) {
    try {
      const loansRef = collection(db, `groups/${groupId}/loans`);
      const q = query(loansRef, orderBy("requestedAt", "desc"));
      const loansSnapshot = await getDocs(q);
      
      pendingLoansData = [];
      activeLoansData = [];
      let pendingCount = 0;
      let activeCount = 0;
      let disbursedTotal = 0;
      let outstandingTotal = 0;

      for (const loanDoc of loansSnapshot.docs) {
        const loan = { id: loanDoc.id, ...loanDoc.data() };
        
        if (loan.status === "pending") {
          pendingCount++;
          pendingLoansData.push(loan);
        } else if (loan.status === "active" || loan.status === "approved" || loan.status === "disbursed") {
          activeCount++;
          disbursedTotal += parseFloat(loan.loanAmount || 0);
          outstandingTotal += parseFloat(loan.amountRemaining || loan.loanAmount || 0) - parseFloat(loan.amountPaid || 0);
          activeLoansData.push(loan);
        }
      }

      updateStats(pendingCount, activeCount, disbursedTotal, outstandingTotal);
      displayPendingLoans();
      displayActiveLoans();
    } catch (error) {
      console.error("Error loading loans:", error);
      alert("Error loading loans. Please try again.");
    }
  }

  /**
   * Update statistics
   */
  function updateStats(pending, active, disbursed, outstanding) {
    const pendingCountEl = document.getElementById("pendingCount");
    const activeCountEl = document.getElementById("activeCount");
    const totalDisbursedEl = document.getElementById("totalDisbursed");
    const totalOutstandingEl = document.getElementById("totalOutstanding");

    if (pendingCountEl) pendingCountEl.textContent = pending;
    if (activeCountEl) activeCountEl.textContent = active;
    if (totalDisbursedEl) totalDisbursedEl.textContent = `MWK ${disbursed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (totalOutstandingEl) totalOutstandingEl.textContent = `MWK ${Math.max(0, outstanding).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Display pending loans
   */
  function displayPendingLoans() {
    const pendingLoansList = document.getElementById("pendingLoansList");
    if (!pendingLoansList) return;

    if (pendingLoansData.length === 0) {
      pendingLoansList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><p class="empty-state-text">No pending loan requests</p></div>';
      return;
    }

    pendingLoansList.innerHTML = '';
    pendingLoansData.forEach(loan => {
      const loanElement = createPendingLoanElement(loan);
      pendingLoansList.appendChild(loanElement);
    });
  }

  /**
   * Create pending loan element
   */
  function createPendingLoanElement(loan) {
    const div = document.createElement("div");
    div.className = "list-item";
    
    const requestedDate = loan.requestedAt?.toDate ? loan.requestedAt.toDate().toLocaleDateString() : "N/A";
    const amount = parseFloat(loan.loanAmount || 0);

    div.innerHTML = `
      <div style="flex: 1;">
        <div class="list-item-title">${loan.borrowerName || "Unknown Member"}</div>
        <div class="list-item-subtitle">${loan.purpose || "No purpose specified"} • Requested ${requestedDate}</div>
        <div style="margin-top: 8px; font-size: 1.25rem; font-weight: 700; color: var(--bn-primary);">
          MWK ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        ${loan.description ? `<div style="margin-top: 4px; font-size: 0.875rem; color: rgba(255, 255, 255, 0.7);">${loan.description}</div>` : ''}
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button class="btn btn-primary btn-sm" data-action="approve" data-loan-id="${loan.id}">Approve</button>
        <button class="btn btn-secondary btn-sm" data-action="reject" data-loan-id="${loan.id}">Reject</button>
        <button class="btn btn-ghost btn-sm" data-action="view" data-loan-id="${loan.id}">View</button>
      </div>
    `;

    // Add event listeners
    div.querySelector('[data-action="approve"]').addEventListener("click", () => approveLoan(loan));
    div.querySelector('[data-action="reject"]').addEventListener("click", () => rejectLoan(loan));
    div.querySelector('[data-action="view"]').addEventListener("click", () => viewLoanDetails(loan));

    return div;
  }

  /**
   * Display active loans
   */
  async function displayActiveLoans() {
    const activeLoansList = document.getElementById("activeLoansList");
    if (!activeLoansList) return;

    if (activeLoansData.length === 0) {
      activeLoansList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">No active loans</p></div>';
      return;
    }

    activeLoansList.innerHTML = '';
    
    // Load pending payments for each loan
    for (const loan of activeLoansData) {
      const pendingPaymentsRef = collection(db, `groups/${currentGroupId}/loans/${loan.id}/payments`);
      const q = query(pendingPaymentsRef, where("status", "==", "pending"), orderBy("submittedAt", "desc"));
      const paymentsSnapshot = await getDocs(q);
      loan.pendingPayments = [];
      paymentsSnapshot.forEach(doc => {
        loan.pendingPayments.push({ id: doc.id, ...doc.data() });
      });
      
      const loanElement = createActiveLoanElement(loan);
      activeLoansList.appendChild(loanElement);
    }
  }

  /**
   * Create active loan element
   */
  function createActiveLoanElement(loan) {
    const div = document.createElement("div");
    div.className = "list-item";
    
    const loanAmount = parseFloat(loan.loanAmount || 0);
    const amountPaid = parseFloat(loan.amountPaid || 0);
    const totalRepayable = parseFloat(loan.totalRepayable || loanAmount);
    const amountRemaining = totalRepayable - amountPaid;
    const progress = totalRepayable > 0 ? (amountPaid / totalRepayable) * 100 : 0;
    const disbursedDate = loan.disbursedAt?.toDate ? loan.disbursedAt.toDate().toLocaleDateString() : "N/A";
    const pendingPaymentsCount = loan.pendingPayments?.length || 0;

    div.innerHTML = `
      <div style="flex: 1;">
        <div class="list-item-title">${loan.borrowerName || "Unknown Member"}</div>
        <div class="list-item-subtitle">Loan #${loan.id.substring(0, 8)} • Disbursed ${disbursedDate}${pendingPaymentsCount > 0 ? ` • ${pendingPaymentsCount} pending payment(s)` : ''}</div>
        <div style="margin-top: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.875rem;">
            <span>Loan: <strong>MWK ${loanAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
            <span>Paid: <strong>MWK ${amountPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
          </div>
          <div style="background: rgba(255, 255, 255, 0.1); border-radius: 4px; height: 8px; overflow: hidden;">
            <div style="background: var(--bn-primary); height: 100%; width: ${Math.min(100, progress)}%; transition: width 0.3s;"></div>
          </div>
          <div style="margin-top: 4px; font-size: 0.75rem; color: rgba(255, 255, 255, 0.7);">
            ${progress.toFixed(1)}% complete • Remaining: <strong style="color: var(--bn-warning);">MWK ${Math.max(0, amountRemaining).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>
          ${pendingPaymentsCount > 0 ? `
            <div style="margin-top: 8px; padding: 8px; background: rgba(251, 191, 36, 0.1); border-radius: 4px; border-left: 3px solid var(--bn-warning);">
              <strong style="color: var(--bn-warning);">${pendingPaymentsCount} payment(s) awaiting approval</strong>
            </div>
          ` : ''}
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${pendingPaymentsCount > 0 ? `<button class="btn btn-warning btn-sm" data-action="review" data-loan-id="${loan.id}">Review Payments</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-action="view" data-loan-id="${loan.id}">View Details</button>
      </div>
    `;

    if (pendingPaymentsCount > 0) {
      div.querySelector('[data-action="review"]').addEventListener("click", () => reviewLoanPayments(loan));
    }
    div.querySelector('[data-action="view"]').addEventListener("click", () => viewLoanDetails(loan));

    return div;
  }

  /**
   * Approve loan
   */
  async function approveLoan(loan) {
    if (!confirm(`Approve loan of MWK ${parseFloat(loan.loanAmount || 0).toLocaleString()} to ${loan.borrowerName}?`)) {
      return;
    }

    try {
      const loanRef = doc(db, `groups/${currentGroupId}/loans`, loan.id);
      const groupDoc = await getDoc(doc(db, "groups", currentGroupId));
      const groupData = groupDoc.data();
      
      // Calculate loan details
      const loanAmount = parseFloat(loan.loanAmount || 0);
      const interestRates = groupData.rules?.loanInterest || {};
      const interestMonth1 = parseFloat(interestRates.month1 || 0) / 100;
      const interestMonth2 = parseFloat(interestRates.month2 || 0) / 100;
      const interestMonth3 = parseFloat(interestRates.month3 || 0) / 100;

      // Calculate repayment schedule (3 months)
      const monthlyPrincipal = loanAmount / 3;
      const month1Amount = monthlyPrincipal + (loanAmount * interestMonth1);
      const month2Amount = monthlyPrincipal + ((loanAmount - monthlyPrincipal) * interestMonth2);
      const month3Amount = monthlyPrincipal + ((loanAmount - (monthlyPrincipal * 2)) * interestMonth3);
      const totalRepayable = month1Amount + month2Amount + month3Amount;

      await updateDoc(loanRef, {
        status: "approved",
        approvedAt: Timestamp.now(),
        approvedBy: currentUser.uid,
        disbursedAt: Timestamp.now(),
        loanAmount: loanAmount,
        totalRepayable: totalRepayable,
        amountRemaining: totalRepayable,
        amountPaid: 0,
        repaymentSchedule: {
          month1: { dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), amount: month1Amount, paid: false },
          month2: { dueDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), amount: month2Amount, paid: false },
          month3: { dueDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), amount: month3Amount, paid: false }
        },
        updatedAt: Timestamp.now()
      });

      // Update member's financial summary
      const memberRef = doc(db, `groups/${currentGroupId}/members`, loan.borrowerId);
      const memberDoc = await getDoc(memberRef);
      if (memberDoc.exists()) {
        const memberData = memberDoc.data();
        const financialSummary = memberData.financialSummary || {};
        await updateDoc(memberRef, {
          "financialSummary.totalLoans": (financialSummary.totalLoans || 0) + loanAmount,
          updatedAt: Timestamp.now()
        });
      }

      // Send notification to borrower
      await sendLoanNotification(loan.borrowerId, "approved", loan);

      alert("Loan approved successfully!");
      await loadLoanData(currentGroupId);
    } catch (error) {
      console.error("Error approving loan:", error);
      alert("Error approving loan. Please try again.");
    }
  }

  /**
   * Reject loan
   */
  async function rejectLoan(loan) {
    const reason = prompt(`Reject loan request from ${loan.borrowerName}?\n\nEnter rejection reason:`);
    if (!reason || !reason.trim()) return;

    try {
      const loanRef = doc(db, `groups/${currentGroupId}/loans`, loan.id);
      
      await updateDoc(loanRef, {
        status: "rejected",
        rejectedAt: Timestamp.now(),
        rejectedBy: currentUser.uid,
        rejectionReason: reason.trim(),
        updatedAt: Timestamp.now()
      });

      // Send notification to borrower
      await sendLoanNotification(loan.borrowerId, "rejected", loan, reason);

      alert("Loan rejected successfully!");
      await loadLoanData(currentGroupId);
    } catch (error) {
      console.error("Error rejecting loan:", error);
      alert("Error rejecting loan. Please try again.");
    }
  }

  /**
   * Review loan payments
   */
  async function reviewLoanPayments(loan) {
    const loanDoc = await getDoc(doc(db, `groups/${currentGroupId}/loans`, loan.id));
    if (!loanDoc.exists()) return;

    const paymentsRef = collection(db, `groups/${currentGroupId}/loans/${loan.id}/payments`);
    const q = query(paymentsRef, where("status", "==", "pending"), orderBy("submittedAt", "desc"));
    const paymentsSnapshot = await getDocs(q);

    const payments = [];
    paymentsSnapshot.forEach(doc => {
      payments.push({ id: doc.id, ...doc.data() });
    });

    if (payments.length === 0) {
      alert("No pending payments found.");
      return;
    }

    // Show payment review dialog
    const paymentDetails = payments.map((p, idx) => {
      const submittedDate = p.submittedAt?.toDate ? p.submittedAt.toDate().toLocaleDateString() : "N/A";
      const paymentDate = p.paymentDate?.toDate ? p.paymentDate.toDate().toLocaleDateString() : "N/A";
      return `${idx + 1}. Amount: MWK ${parseFloat(p.amount || 0).toLocaleString()} | Date: ${paymentDate} | Submitted: ${submittedDate}${p.notes ? `\n   Notes: ${p.notes}` : ''}`;
    }).join("\n\n");

    const action = confirm(`Pending Payments for ${loan.borrowerName}:\n\n${paymentDetails}\n\nClick OK to approve all, or Cancel to review individually.`);
    
    if (action) {
      // Approve all
      for (const payment of payments) {
        await approveLoanPayment(loan, payment);
      }
    } else {
      // Review individually
      for (const payment of payments) {
        await reviewIndividualPayment(loan, payment);
      }
    }
  }

  /**
   * Review individual payment
   */
  async function reviewIndividualPayment(loan, payment) {
    const paymentDate = payment.paymentDate?.toDate ? payment.paymentDate.toDate().toLocaleDateString() : "N/A";
    const amount = parseFloat(payment.amount || 0);
    
    const action = prompt(
      `Review Payment:\n\n` +
      `Borrower: ${loan.borrowerName}\n` +
      `Amount: MWK ${amount.toLocaleString()}\n` +
      `Payment Date: ${paymentDate}\n` +
      `${payment.notes ? `Notes: ${payment.notes}\n` : ''}\n` +
      `Enter "approve" to approve, "reject" to reject, or anything else to skip:`
    );

    if (action?.toLowerCase() === "approve") {
      const adminNotes = prompt("Add admin notes (optional):") || "";
      await approveLoanPayment(loan, payment, adminNotes);
    } else if (action?.toLowerCase() === "reject") {
      const reason = prompt("Enter rejection reason:") || "";
      await rejectLoanPayment(loan, payment, reason);
    }
  }

  /**
   * Approve loan payment
   */
  async function approveLoanPayment(loan, payment, adminNotes = "") {
    try {
      const loanRef = doc(db, `groups/${currentGroupId}/loans`, loan.id);
      const paymentRef = doc(db, `groups/${currentGroupId}/loans/${loan.id}/payments`, payment.id);
      const loanDoc = await getDoc(loanRef);
      
      if (!loanDoc.exists()) return;

      const loanData = loanDoc.data();
      const paymentAmount = parseFloat(payment.amount || 0);
      
      // Calculate penalties if payment is late
      let penaltyAmount = 0;
      const groupDoc = await getDoc(doc(db, "groups", currentGroupId));
      const groupData = groupDoc.data();
      const loanPenaltyRate = parseFloat(groupData?.rules?.loanPenalty?.percentage || 0) / 100;

      // Check if payment is late (compare with repayment schedule)
      const repaymentSchedule = loanData.repaymentSchedule || {};
      let isLate = false;
      const paymentDate = payment.paymentDate?.toDate ? payment.paymentDate.toDate() : new Date();
      
      // Check against due dates in repayment schedule
      if (repaymentSchedule.month1 && !repaymentSchedule.month1.paid) {
        const dueDate = repaymentSchedule.month1.dueDate?.toDate ? repaymentSchedule.month1.dueDate.toDate() : new Date();
        if (paymentDate > dueDate) {
          isLate = true;
        }
      }

      if (isLate && loanPenaltyRate > 0) {
        // Calculate penalty based on overdue amount and rate
        penaltyAmount = paymentAmount * loanPenaltyRate;
      }

      // Update loan
      const currentPaid = parseFloat(loanData.amountPaid || 0);
      const currentRemaining = parseFloat(loanData.amountRemaining || loanData.totalRepayable || 0);
      const newPaid = currentPaid + paymentAmount + penaltyAmount;
      const newRemaining = Math.max(0, currentRemaining - paymentAmount);

      // Update repayment schedule if applicable
      const updatedSchedule = { ...repaymentSchedule };
      if (updatedSchedule.month1 && !updatedSchedule.month1.paid && paymentAmount >= updatedSchedule.month1.amount) {
        updatedSchedule.month1.paid = true;
        updatedSchedule.month1.paidAt = Timestamp.now();
      } else if (updatedSchedule.month2 && !updatedSchedule.month2.paid && paymentAmount >= updatedSchedule.month2.amount) {
        updatedSchedule.month2.paid = true;
        updatedSchedule.month2.paidAt = Timestamp.now();
      } else if (updatedSchedule.month3 && !updatedSchedule.month3.paid && paymentAmount >= updatedSchedule.month3.amount) {
        updatedSchedule.month3.paid = true;
        updatedSchedule.month3.paidAt = Timestamp.now();
      }

      // Update loan status if fully paid
      let newStatus = loanData.status;
      if (newRemaining <= 0) {
        newStatus = "completed";
      }

      await updateDoc(loanRef, {
        amountPaid: newPaid,
        amountRemaining: newRemaining,
        repaymentSchedule: updatedSchedule,
        status: newStatus,
        updatedAt: Timestamp.now()
      });

      // Update payment
      await updateDoc(paymentRef, {
        status: "approved",
        approvedAt: Timestamp.now(),
        approvedBy: currentUser.uid,
        penaltyAmount: penaltyAmount,
        adminNotes: adminNotes || "",
        updatedAt: Timestamp.now()
      });

      // Update member financial summary
      const memberRef = doc(db, `groups/${currentGroupId}/members`, loan.borrowerId);
      const memberDoc = await getDoc(memberRef);
      if (memberDoc.exists()) {
        const memberData = memberDoc.data();
        const financialSummary = memberData.financialSummary || {};
        await updateDoc(memberRef, {
          "financialSummary.totalPaid": (financialSummary.totalPaid || 0) + paymentAmount + penaltyAmount,
          "financialSummary.totalLoans": (financialSummary.totalLoans || 0) - paymentAmount,
          "financialSummary.totalPenalties": (financialSummary.totalPenalties || 0) + penaltyAmount,
          updatedAt: Timestamp.now()
        });
      }

      // Send notification
      await sendLoanPaymentNotification(loan.borrowerId, "approved", loan, payment, penaltyAmount);

      alert(`Payment approved!${penaltyAmount > 0 ? ` Penalty of MWK ${penaltyAmount.toLocaleString()} applied due to late payment.` : ''}`);
      await loadLoanData(currentGroupId);
    } catch (error) {
      console.error("Error approving payment:", error);
      alert("Error approving payment. Please try again.");
    }
  }

  /**
   * Reject loan payment
   */
  async function rejectLoanPayment(loan, payment, reason) {
    try {
      const paymentRef = doc(db, `groups/${currentGroupId}/loans/${loan.id}/payments`, payment.id);
      
      await updateDoc(paymentRef, {
        status: "rejected",
        rejectedAt: Timestamp.now(),
        rejectedBy: currentUser.uid,
        rejectionReason: reason || "",
        updatedAt: Timestamp.now()
      });

      // Send notification
      await sendLoanPaymentNotification(loan.borrowerId, "rejected", loan, payment, 0, reason);

      alert("Payment rejected.");
      await loadLoanData(currentGroupId);
    } catch (error) {
      console.error("Error rejecting payment:", error);
      alert("Error rejecting payment. Please try again.");
    }
  }

  /**
   * Send loan payment notification
   */
  async function sendLoanPaymentNotification(borrowerId, action, loan, payment, penaltyAmount = 0, reason = null) {
    try {
      const notificationRef = collection(db, `groups/${currentGroupId}/notifications`);
      await addDoc(notificationRef, {
        notificationId: `loan_payment_${action}_${Date.now()}`,
        groupId: currentGroupId,
        groupName: adminGroups.find(g => g.groupId === currentGroupId)?.groupName || "Group",
        recipientId: borrowerId,
        senderId: currentUser.uid,
        senderName: currentUser.displayName || "Admin",
        senderEmail: currentUser.email,
        title: action === "approved" ? "Loan Payment Approved! ✅" : "Loan Payment Rejected",
        message: action === "approved" 
          ? `Your loan payment of MWK ${parseFloat(payment.amount || 0).toLocaleString()} has been approved.${penaltyAmount > 0 ? ` A penalty of MWK ${penaltyAmount.toLocaleString()} was applied due to late payment.` : ''} Your new outstanding balance will be updated shortly.`
          : `Your loan payment of MWK ${parseFloat(payment.amount || 0).toLocaleString()} has been rejected.${reason ? ` Reason: ${reason}` : ''}`,
        type: action === "approved" ? "success" : "warning",
        allowReplies: true,
        read: false,
        isAutomated: false,
        createdAt: Timestamp.now(),
        replies: []
      });
    } catch (error) {
      console.error("Error sending notification:", error);
    }
  }

  /**
   * View loan details
   */
  function viewLoanDetails(loan) {
    const details = `
Loan Details:
- Borrower: ${loan.borrowerName}
- Amount: MWK ${parseFloat(loan.loanAmount || 0).toLocaleString()}
- Purpose: ${loan.purpose || "Not specified"}
- Status: ${loan.status}
- Requested: ${loan.requestedAt?.toDate ? loan.requestedAt.toDate().toLocaleDateString() : "N/A"}
${loan.description ? `- Description: ${loan.description}` : ''}
${loan.rejectionReason ? `- Rejection Reason: ${loan.rejectionReason}` : ''}
    `;
    alert(details);
  }

  /**
   * Send loan notification
   */
  async function sendLoanNotification(borrowerId, action, loan, reason = null) {
    try {
      const notificationRef = collection(db, `groups/${currentGroupId}/notifications`);
      await addDoc(notificationRef, {
        notificationId: `loan_${action}_${Date.now()}`,
        groupId: currentGroupId,
        groupName: adminGroups.find(g => g.groupId === currentGroupId)?.groupName || "Group",
        recipientId: borrowerId,
        senderId: currentUser.uid,
        senderName: currentUser.displayName || "Admin",
        senderEmail: currentUser.email,
        title: action === "approved" ? "Loan Approved! 🎉" : "Loan Request Rejected",
        message: action === "approved" 
          ? `Your loan request of MWK ${parseFloat(loan.loanAmount || 0).toLocaleString()} has been approved. The funds will be disbursed shortly.`
          : `Your loan request of MWK ${parseFloat(loan.loanAmount || 0).toLocaleString()} has been rejected.${reason ? ` Reason: ${reason}` : ''}`,
        type: action === "approved" ? "success" : "warning",
        allowReplies: true,
        read: false,
        isAutomated: false,
        createdAt: Timestamp.now(),
        replies: []
      });
    } catch (error) {
      console.error("Error sending notification:", error);
    }
  }
});
