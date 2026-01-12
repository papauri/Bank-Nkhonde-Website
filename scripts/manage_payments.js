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
  Timestamp,
  query,
  where,
  orderBy,
} from "./firebaseConfig.js";

let currentUser = null;
let adminGroups = [];
let currentGroupId = null;
let pendingPaymentsData = [];
let recentPaymentsData = [];

document.addEventListener("DOMContentLoaded", () => {
  const groupSelector = document.getElementById("groupSelector");
  const pendingPaymentsList = document.getElementById("pendingPaymentsList");
  const recentPaymentsList = document.getElementById("recentPaymentsList");
  const refreshBtn = document.getElementById("refreshBtn");
  
  // Statistics elements
  const pendingPayments = document.getElementById("pendingPayments");
  const approvedPayments = document.getElementById("approvedPayments");
  const totalCollected = document.getElementById("totalCollected");
  const totalArrears = document.getElementById("totalArrears");

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
        await loadPaymentData(currentGroupId);
      } else {
        pendingPaymentsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💵</div><p class="empty-state-text">Select a group to view payments</p></div>';
        recentPaymentsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">Select a group to view payments</p></div>';
        updateStats(0, 0, 0, 0);
      }
    });
  }

  // Refresh button
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      if (currentGroupId) {
        await loadPaymentData(currentGroupId);
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
          await loadPaymentData(currentGroupId);
        }
      }
    } catch (error) {
      console.error("Error loading groups:", error);
    }
  }

  /**
   * Update statistics
   */
  function updateStats(pending, approved, collected, arrears) {
    const pendingCountEl = document.getElementById("pendingCount");
    const approvedCountEl = document.getElementById("approvedCount");
    const totalCollectedEl = document.getElementById("totalCollected");
    const totalArrearsEl = document.getElementById("totalArrears");

    if (pendingCountEl) pendingCountEl.textContent = pending;
    if (approvedCountEl) approvedCountEl.textContent = approved;
    if (totalCollectedEl) totalCollectedEl.textContent = `MWK ${collected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (totalArrearsEl) totalArrearsEl.textContent = `MWK ${arrears.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Load payment data for selected group
   */
  async function loadPaymentData(groupId) {
    try {
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().toLocaleString("default", { month: "long" });

      let pendingCount = 0;
      let approvedCount = 0;
      let collectedAmount = 0;
      let arrearsAmount = 0;

      pendingPaymentsData = [];
      recentPaymentsData = [];

      // Get members
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      
      for (const memberDoc of membersSnapshot.docs) {
        const member = memberDoc.data();
        const memberUid = memberDoc.id;

        // Check Seed Money
        const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberUid}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);

        if (seedMoneyDoc.exists()) {
          const payment = seedMoneyDoc.data();
          
          if (payment.approvalStatus === "pending") {
            pendingCount++;
            pendingPaymentsData.push({
              memberName: member.fullName,
              memberUid: memberUid,
              paymentType: "Seed Money",
              amount: payment.totalAmount || payment.amountPaid || 0,
              proofUrl: payment.proofOfPayment?.imageUrl,
              submittedAt: payment.paidAt || payment.createdAt,
              docRef: `${currentYear}_SeedMoney/${memberUid}/PaymentDetails`,
              yearType: `${currentYear}_SeedMoney`
            });
          } else if (payment.approvalStatus === "approved") {
            approvedCount++;
            collectedAmount += parseFloat(payment.amountPaid || 0);
            recentPaymentsData.push({
              memberName: member.fullName,
              paymentType: "Seed Money",
              amount: payment.amountPaid || 0,
              approvedAt: payment.approvedAt,
            });
          }

          arrearsAmount += parseFloat(payment.arrears || 0);
        }

        // Check Monthly Contributions - use userId instead of sanitizedName
        const monthlyRef = doc(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${memberUid}/${currentYear}_${currentMonth}`);
        const monthlyDoc = await getDoc(monthlyRef);

        if (monthlyDoc.exists()) {
          const payment = monthlyDoc.data();
          
          if (payment.approvalStatus === "pending") {
            pendingCount++;
            const lastPayment = payment.paid && payment.paid.length > 0 ? payment.paid[payment.paid.length - 1] : null;
            pendingPaymentsData.push({
              memberName: member.fullName,
              memberUid: memberUid,
              paymentType: "Monthly Contribution",
              amount: lastPayment?.amount || payment.totalAmount || 0,
              proofUrl: lastPayment?.proofURL,
              submittedAt: lastPayment?.paymentDate || payment.createdAt,
              docRef: `${currentYear}_MonthlyContributions/${memberUid}/${currentYear}_${currentMonth}`,
              yearType: `${currentYear}_MonthlyContributions`,
              month: currentMonth
            });
          } else if (payment.approvalStatus === "approved" || payment.paymentStatus === "Completed") {
            const totalPaid = payment.paid?.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0;
            approvedCount++;
            collectedAmount += totalPaid;
            const lastPayment = payment.paid && payment.paid.length > 0 ? payment.paid[payment.paid.length - 1] : null;
            recentPaymentsData.push({
              memberName: member.fullName,
              paymentType: "Monthly Contribution",
              amount: totalPaid,
              approvedAt: lastPayment?.approvalDate || payment.updatedAt,
            });
          }

          const monthlyArrears = parseFloat(payment.arrears || 0);
          if (monthlyArrears > 0) {
            arrearsAmount += monthlyArrears;
          }
        }
      }

      updateStats(pendingCount, approvedCount, collectedAmount, arrearsAmount);
      displayPendingPayments();
      displayRecentPayments();

    } catch (error) {
      console.error("Error loading payment data:", error);
      alert("Error loading payment data. Please try again.");
    }
  }

  /**
   * Display pending payments
   */
  function displayPendingPayments() {
    const pendingPaymentsList = document.getElementById("pendingPaymentsList");
    if (!pendingPaymentsList) return;

    if (pendingPaymentsData.length === 0) {
      pendingPaymentsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💵</div><p class="empty-state-text">No pending payments</p></div>';
      return;
    }

    pendingPaymentsList.innerHTML = '';
    pendingPaymentsData.forEach((payment, index) => {
      const paymentElement = createPendingPaymentElement(payment, index);
      pendingPaymentsList.appendChild(paymentElement);
    });
  }

  /**
   * Create pending payment element
   */
  function createPendingPaymentElement(payment, index) {
    const div = document.createElement("div");
    div.className = "list-item";
    
    const submittedDate = payment.submittedAt?.toDate 
      ? payment.submittedAt.toDate().toLocaleDateString() 
      : payment.submittedAt 
        ? new Date(payment.submittedAt).toLocaleDateString() 
        : "N/A";
    const amount = parseFloat(payment.amount || 0);

    div.innerHTML = `
      <div style="flex: 1;">
        <div class="list-item-title">${payment.memberName}</div>
        <div class="list-item-subtitle">${payment.paymentType} • Submitted ${submittedDate}</div>
        <div style="margin-top: 8px; font-size: 1.25rem; font-weight: 700; color: var(--bn-primary);">
          MWK ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        ${payment.proofUrl ? `<div style="margin-top: 8px;"><a href="${payment.proofUrl}" target="_blank" class="btn btn-ghost btn-sm">View Proof</a></div>` : ''}
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button class="btn btn-primary btn-sm" data-action="approve" data-index="${index}">Approve</button>
        <button class="btn btn-secondary btn-sm" data-action="reject" data-index="${index}">Reject</button>
      </div>
    `;

    div.querySelector('[data-action="approve"]').addEventListener("click", () => approvePayment(payment));
    div.querySelector('[data-action="reject"]').addEventListener("click", () => rejectPayment(payment));

    return div;
  }

  /**
   * Display recent payments
   */
  function displayRecentPayments() {
    const recentPaymentsList = document.getElementById("recentPaymentsList");
    if (!recentPaymentsList) return;

    if (recentPaymentsData.length === 0) {
      recentPaymentsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">No recent payments</p></div>';
      return;
    }

    // Sort by approved date (most recent first)
    recentPaymentsData.sort((a, b) => {
      const dateA = a.approvedAt?.toDate 
        ? a.approvedAt.toDate().getTime() 
        : a.approvedAt 
          ? new Date(a.approvedAt).getTime() 
          : 0;
      const dateB = b.approvedAt?.toDate 
        ? b.approvedAt.toDate().getTime() 
        : b.approvedAt 
          ? new Date(b.approvedAt).getTime() 
          : 0;
      return dateB - dateA;
    });

    // Show only last 10
    const recentPayments = recentPaymentsData.slice(0, 10);

    recentPaymentsList.innerHTML = '';
    recentPayments.forEach(payment => {
      const paymentElement = createRecentPaymentElement(payment);
      recentPaymentsList.appendChild(paymentElement);
    });
  }

  /**
   * Create recent payment element
   */
  function createRecentPaymentElement(payment) {
    const div = document.createElement("div");
    div.className = "list-item";
    
    const approvedDate = payment.approvedAt?.toDate 
      ? payment.approvedAt.toDate().toLocaleDateString() 
      : payment.approvedAt 
        ? new Date(payment.approvedAt).toLocaleDateString() 
        : "N/A";
    const amount = parseFloat(payment.amount || 0);

    div.innerHTML = `
      <div style="flex: 1;">
        <div class="list-item-title">${payment.memberName}</div>
        <div class="list-item-subtitle">${payment.paymentType} • Approved ${approvedDate}</div>
        <div style="margin-top: 8px; font-size: 1.125rem; font-weight: 700; color: var(--bn-success);">
          MWK ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
      <div class="badge badge-success">Approved</div>
    `;

    return div;
  }

  /**
   * Approve payment
   */
  async function approvePayment(payment) {
    if (!confirm(`Approve ${payment.paymentType} payment of MWK ${parseFloat(payment.amount || 0).toLocaleString()} from ${payment.memberName}?`)) {
      return;
    }

    try {
      const paymentRef = doc(db, `groups/${currentGroupId}/payments/${payment.docRef}`);
      const paymentDoc = await getDoc(paymentRef);
      
      if (!paymentDoc.exists()) {
        alert("Payment document not found.");
        return;
      }

      const paymentData = paymentDoc.data();
      const amountPaid = parseFloat(payment.amount || paymentData.totalAmount || 0);

      // Update payment document
      const updateData = {
        approvalStatus: "approved",
        paymentStatus: "Completed",
        approvedAt: Timestamp.now(),
        approvedBy: currentUser.uid,
        updatedAt: Timestamp.now(),
        amountPaid: amountPaid,
        arrears: 0,
      };

      // For monthly contributions, update the last payment entry
      if (payment.paymentType === "Monthly Contribution" && paymentData.paid && paymentData.paid.length > 0) {
        const lastPayment = paymentData.paid[paymentData.paid.length - 1];
        lastPayment.approvalStatus = "approved";
        lastPayment.approvedAt = Timestamp.now();
        lastPayment.approvedBy = currentUser.uid;
        updateData.paid = paymentData.paid;
      }

      await updateDoc(paymentRef, updateData);

      // Update member's financial summary
      const memberRef = doc(db, `groups/${currentGroupId}/members`, payment.memberUid);
      const memberDoc = await getDoc(memberRef);
      if (memberDoc.exists()) {
        const memberData = memberDoc.data();
        const financialSummary = memberData.financialSummary || {};
        await updateDoc(memberRef, {
          "financialSummary.totalPaid": (financialSummary.totalPaid || 0) + amountPaid,
          "financialSummary.totalArrears": Math.max(0, (financialSummary.totalArrears || 0) - amountPaid),
          updatedAt: Timestamp.now()
        });
      }

      // Send notification
      await sendPaymentNotification(payment.memberUid, "approved", payment);

      alert("Payment approved successfully!");
      await loadPaymentData(currentGroupId);
    } catch (error) {
      console.error("Error approving payment:", error);
      alert("Error approving payment. Please try again.");
    }
  }

  /**
   * Reject payment
   */
  async function rejectPayment(payment) {
    const reason = prompt(`Reject ${payment.paymentType} payment from ${payment.memberName}?\n\nEnter rejection reason:`);
    if (!reason || !reason.trim()) return;

    try {
      const paymentRef = doc(db, `groups/${currentGroupId}/payments/${payment.docRef}`);
      
      await updateDoc(paymentRef, {
        approvalStatus: "rejected",
        rejectedAt: Timestamp.now(),
        rejectedBy: currentUser.uid,
        rejectionReason: reason.trim(),
        updatedAt: Timestamp.now(),
      });

      // Send notification
      await sendPaymentNotification(payment.memberUid, "rejected", payment, reason);

      alert("Payment rejected successfully!");
      await loadPaymentData(currentGroupId);
    } catch (error) {
      console.error("Error rejecting payment:", error);
      alert("Error rejecting payment. Please try again.");
    }
  }

  /**
   * Send payment notification
   */
  async function sendPaymentNotification(memberUid, action, payment, penaltyAmount = 0, adminNotes = "", reason = null) {
    try {
      const notificationRef = collection(db, `groups/${currentGroupId}/notifications`);
      await addDoc(notificationRef, {
        notificationId: `payment_${action}_${Date.now()}`,
        groupId: currentGroupId,
        groupName: adminGroups.find(g => g.groupId === currentGroupId)?.groupName || "Group",
        recipientId: memberUid,
        senderId: currentUser.uid,
        senderName: currentUser.displayName || "Admin",
        senderEmail: currentUser.email,
        title: action === "approved" ? "Payment Approved! ✅" : "Payment Rejected",
        message: action === "approved" 
          ? `Your ${payment.paymentType} payment of MWK ${parseFloat(payment.amount || 0).toLocaleString()} has been approved.${penaltyAmount > 0 ? ` A penalty of MWK ${penaltyAmount.toLocaleString()} was applied due to late payment.` : ''}${adminNotes ? `\n\nAdmin Notes: ${adminNotes}` : ''}`
          : `Your ${payment.paymentType} payment of MWK ${parseFloat(payment.amount || 0).toLocaleString()} has been rejected.${reason ? ` Reason: ${reason}` : ''}`,
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
