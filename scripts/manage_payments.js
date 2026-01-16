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
  deleteDoc,
  query,
  where,
  onAuthStateChanged,
  Timestamp,
  writeBatch,
  storage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "./firebaseConfig.js";

// Global state
let currentUser = null;
let selectedGroupId = null;
let userGroups = [];
let groupData = null;
let members = [];
let payments = {
  pending: [],
  approved: [],
  seedMoney: [],
  monthly: [],
};

// DOM Elements
const groupSelector = document.getElementById("groupSelector");
const pendingPaymentsList = document.getElementById("pendingPaymentsList");
const recentPaymentsList = document.getElementById("recentPaymentsList");
const pendingCountEl = document.getElementById("pendingCount");
const approvedCountEl = document.getElementById("approvedCount");
const totalCollectedEl = document.getElementById("totalCollected");
const totalArrearsEl = document.getElementById("totalArrears");
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
        localStorage.setItem("selectedGroupId", selectedGroupId);
        sessionStorage.setItem("selectedGroupId", selectedGroupId);
        await loadPayments();
      }
    });
  }

  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    if (selectedGroupId) await loadPayments();
  });

  // Quick action buttons
  document.getElementById("recordPaymentBtn")?.addEventListener("click", openRecordPaymentModal);
  document.getElementById("addPaymentInTabBtn")?.addEventListener("click", openRecordPaymentModal);
  document.getElementById("applyPenaltyBtn")?.addEventListener("click", openApplyPenaltyModal);
  document.getElementById("paymentSettingsBtn")?.addEventListener("click", openPaymentSettingsModal);
  document.getElementById("sendRemindersBtn")?.addEventListener("click", sendPaymentReminders);

  // Modal close buttons
  setupModalCloseHandlers("recordPaymentModal", "closeRecordPaymentModal", "cancelRecordPayment");
  setupModalCloseHandlers("applyPenaltyModal", "closeApplyPenaltyModal", "cancelApplyPenalty");
  setupModalCloseHandlers("paymentSettingsModal", "closePaymentSettingsModal", "cancelPaymentSettings");
  setupModalCloseHandlers("approvePaymentModal", "closeApprovePaymentModal", "cancelApprovePayment");

  // Form submissions
  document.getElementById("recordPaymentForm")?.addEventListener("submit", handleRecordPayment);
  document.getElementById("paymentSettingsForm")?.addEventListener("submit", handleSaveSettings);
  document.getElementById("confirmApplyPenalty")?.addEventListener("click", handleApplyPenalties);
  document.getElementById("approvePaymentForm")?.addEventListener("submit", handleApprovePaymentSubmit);

  // Payment type change
  document.getElementById("paymentType")?.addEventListener("change", (e) => {
    const monthGroup = document.getElementById("monthSelectGroup");
    monthGroup.style.display = e.target.value === "monthly_contribution" ? "block" : "none";
    // Clear amount when type changes
    document.getElementById("paymentAmount").value = "";
    // Reset interest checkbox
    const interestCheckbox = document.getElementById("applyInterestCheckbox");
    if (interestCheckbox) {
      interestCheckbox.checked = false;
      updateInterestDisplay();
    }
  });
  
  // Member or month change - reset amount and interest
  document.getElementById("memberSelect")?.addEventListener("change", () => {
    document.getElementById("paymentAmount").value = "";
    const interestCheckbox = document.getElementById("applyInterestCheckbox");
    if (interestCheckbox) {
      interestCheckbox.checked = false;
      updateInterestDisplay();
    }
  });
  
  document.getElementById("paymentMonth")?.addEventListener("change", () => {
    document.getElementById("paymentAmount").value = "";
    const interestCheckbox = document.getElementById("applyInterestCheckbox");
    if (interestCheckbox) {
      interestCheckbox.checked = false;
      updateInterestDisplay();
    }
  });
  
  // Auto-fill amount due button
  document.getElementById("autoFillAmountBtn")?.addEventListener("click", async () => {
    await autoFillAmountDue();
  });
  
  // Apply interest checkbox
  document.getElementById("applyInterestCheckbox")?.addEventListener("change", (e) => {
    const interestDetails = document.getElementById("interestDetails");
    if (interestDetails) {
      interestDetails.style.display = e.target.checked ? "block" : "none";
      if (e.target.checked) {
        calculateInterest();
      } else {
        // Reset amount to base if interest unchecked
        updatePaymentAmountFromBase();
      }
    }
  });
  
  // Payment date change - recalculate interest if enabled
  document.getElementById("paymentDate")?.addEventListener("change", () => {
    const interestCheckbox = document.getElementById("applyInterestCheckbox");
    if (interestCheckbox?.checked) {
      calculateInterest();
    }
  });

  // Tab switching
  document.querySelectorAll(".payment-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".payment-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      renderPaymentsByTab(tab.dataset.tab);
    });
  });
  
  // Show add payment button in tab when group is selected
  if (selectedGroupId) {
    const addPaymentBtn = document.getElementById("addPaymentInTabBtn");
    if (addPaymentBtn) {
      addPaymentBtn.style.display = "flex";
    }
  }
  
  // Make stats clickable
  document.querySelectorAll(".clickable-stat").forEach((stat) => {
    stat.addEventListener("click", () => {
      const statType = stat.dataset.statType;
      openStatModal(statType);
    });
  });
  
  // Payment details modal close handlers
  setupModalCloseHandlers("paymentDetailsModal", "closePaymentDetailsModal", "cancelPaymentDetails");
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
      await loadPayments();
    }
  } catch (error) {
    console.error("Error loading groups:", error);
    showToast("Failed to load groups", "error");
  } finally {
    showSpinner(false);
  }
}

// Load payments
async function loadPayments() {
  if (!selectedGroupId) return;

  showSpinner(true);

  try {
    // Get group data
    const groupDoc = await getDoc(doc(db, "groups", selectedGroupId));
    if (!groupDoc.exists()) {
      showToast("Group not found", "error");
      return;
    }
    groupData = { id: groupDoc.id, ...groupDoc.data() };

    // Load members (including admin)
    const membersRef = collection(db, `groups/${selectedGroupId}/members`);
    const membersSnapshot = await getDocs(membersRef);
    members = [];
    membersSnapshot.forEach((doc) => {
      members.push({ id: doc.id, ...doc.data() });
    });
    
    // Ensure admin is included in members list
    const adminInMembers = members.find(m => m.id === currentUser.uid);
    if (!adminInMembers) {
      // Get admin user data
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        members.push({
          id: currentUser.uid,
          ...userData,
          role: 'senior_admin'
        });
      }
    }

    // Reset payments
    payments = { pending: [], approved: [], seedMoney: [], monthly: [] };

    const currentYear = new Date().getFullYear();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    // Load seed money payments
    for (const member of members) {
      try {
        const seedMoneyRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_SeedMoney/${member.id}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);
        if (seedMoneyDoc.exists()) {
          const data = seedMoneyDoc.data();
          const paymentRecord = {
            id: `seed_${member.id}`,
            memberId: member.id,
            memberName: member.fullName || "Unknown",
            type: "Seed Money",
            totalAmount: parseFloat(data.totalAmount || 0),
            amountPaid: parseFloat(data.amountPaid || 0),
            arrears: parseFloat(data.arrears || 0),
            status: data.approvalStatus || "unpaid",
            dueDate: data.dueDate,
            proofOfPayment: data.proofOfPayment,
            paidAt: data.paidAt,
            approvedAt: data.approvedAt,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            timestamp: data.approvedAt || data.updatedAt || data.createdAt || data.paidAt,
          };
          payments.seedMoney.push(paymentRecord);
          if (data.approvalStatus === "pending") {
            payments.pending.push(paymentRecord);
          } else if (data.approvalStatus === "approved") {
            payments.approved.push(paymentRecord);
          }
        }
      } catch (e) {}
    }

    // Load monthly contributions
    for (const member of members) {
      try {
        const monthlyRef = collection(db, `groups/${selectedGroupId}/payments/${currentYear}_MonthlyContributions/${member.id}`);
        const monthlySnapshot = await getDocs(monthlyRef);
        monthlySnapshot.forEach((monthDoc) => {
          const data = monthDoc.data();
          const paymentRecord = {
            id: `monthly_${member.id}_${monthDoc.id}`,
            docId: monthDoc.id,
            memberId: member.id,
            memberName: member.fullName || "Unknown",
            type: "Monthly Contribution",
            month: data.month,
            year: data.year,
            totalAmount: parseFloat(data.totalAmount || 0),
            amountPaid: parseFloat(data.amountPaid || 0),
            arrears: parseFloat(data.arrears || 0),
            status: data.approvalStatus || "unpaid",
            dueDate: data.dueDate,
            proofOfPayment: data.proofOfPayment,
            paidAt: data.paidAt,
            approvedAt: data.approvedAt,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            timestamp: data.approvedAt || data.updatedAt || data.createdAt || data.paidAt,
          };
          payments.monthly.push(paymentRecord);
          if (data.approvalStatus === "pending") {
            payments.pending.push(paymentRecord);
          } else if (data.approvalStatus === "approved") {
            payments.approved.push(paymentRecord);
          }
        });
      } catch (e) {}
    }

    // Update stats
    updateStats();

    // Render payments by active tab
    const activeTab = document.querySelector(".payment-tab.active")?.dataset.tab || "pending";
    renderPaymentsByTab(activeTab);
  } catch (error) {
    console.error("Error loading payments:", error);
    showToast("Failed to load payments", "error");
  } finally {
    showSpinner(false);
  }
}

// Update stats
function updateStats() {
  const pendingCount = payments.pending.length;
  const approvedCount = payments.approved.length;
  
  let totalCollected = 0;
  let totalArrears = 0;

  [...payments.seedMoney, ...payments.monthly].forEach((payment) => {
    totalCollected += payment.amountPaid;
    totalArrears += payment.arrears;
  });

  if (pendingCountEl) pendingCountEl.textContent = pendingCount;
  if (approvedCountEl) approvedCountEl.textContent = approvedCount;
  if (totalCollectedEl) totalCollectedEl.textContent = formatCurrency(totalCollected);
  if (totalArrearsEl) totalArrearsEl.textContent = formatCurrency(totalArrears);
}

// Render pending payments
function renderPendingPayments() {
  if (!pendingPaymentsList) return;

  if (payments.pending.length === 0) {
    pendingPaymentsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <p class="empty-state-text">No pending payments to approve</p>
      </div>
    `;
    return;
  }

  pendingPaymentsList.innerHTML = payments.pending.map((payment) => createPaymentCard(payment, true)).join("");

  // Add event listeners
  pendingPaymentsList.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = e.target.closest("button").dataset.action;
      const paymentId = e.target.closest("button").dataset.paymentId;
      handlePaymentAction(action, paymentId);
    });
  });
}

// Render recent payments
function renderRecentPayments() {
  if (!recentPaymentsList) return;

  const allPayments = [...payments.seedMoney, ...payments.monthly]
    .filter((p) => p.amountPaid > 0)
    .sort((a, b) => {
      const dateA = a.updatedAt?.toDate ? a.updatedAt.toDate() : new Date(0);
      const dateB = b.updatedAt?.toDate ? b.updatedAt.toDate() : new Date(0);
      return dateB - dateA;
    })
    .slice(0, 20);

  if (allPayments.length === 0) {
    recentPaymentsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p class="empty-state-text">No payments recorded yet</p>
      </div>
    `;
    return;
  }

  recentPaymentsList.innerHTML = allPayments.map((payment) => createPaymentCard(payment, false)).join("");
}

// Helper function to format timestamp
function formatTimestamp(timestamp) {
  if (!timestamp) return "N/A";
  
  let date;
  if (timestamp?.toDate) {
    date = timestamp.toDate();
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    date = new Date(timestamp);
  } else {
    return "N/A";
  }
  
  if (isNaN(date.getTime())) return "N/A";
  
  // Format: "MMM DD, YYYY at HH:MM"
  const options = { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  };
  return date.toLocaleString('en-US', options);
}

// Create payment card
function createPaymentCard(payment, showActions = true) {
  const statusClass = payment.status === "approved" ? "success" : 
                      payment.status === "pending" ? "warning" : "secondary";
  
  const progress = payment.totalAmount > 0 ? (payment.amountPaid / payment.totalAmount) * 100 : 0;
  
  let proofHTML = "";
  if (payment.proofOfPayment?.imageUrl) {
    proofHTML = `<a href="${payment.proofOfPayment.imageUrl}" target="_blank" class="btn btn-ghost btn-sm">View Proof</a>`;
  }

  // Get timestamps - prioritize approvedAt, then paidAt, then updatedAt, then createdAt
  const timestamp = payment.approvedAt || payment.paidAt || payment.updatedAt || payment.createdAt || payment.timestamp;
  const formattedTimestamp = formatTimestamp(timestamp);
  
  // Payment date timestamp
  let paymentDateDisplay = "";
  if (payment.paidAt) {
    const paidDate = payment.paidAt?.toDate ? payment.paidAt.toDate() : new Date(payment.paidAt);
    if (!isNaN(paidDate.getTime())) {
      paymentDateDisplay = `<div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-1);">
        Payment Date: ${paidDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
      </div>`;
    }
  }

  const actionsHTML = showActions && payment.status === "pending" ? `
    <div style="display: flex; gap: var(--bn-space-2); margin-top: var(--bn-space-4); flex-wrap: wrap; align-items: center;">
      <button class="btn btn-accent" data-action="approve" data-payment-id="${payment.id}" title="Approve payment">✓ Approve</button>
      <button class="btn btn-ghost btn-sm" data-action="approve-with-pop" data-payment-id="${payment.id}" title="Approve with POP upload">📤 Approve & Upload POP</button>
      <button class="btn btn-danger btn-sm" data-action="reject" data-payment-id="${payment.id}" title="Reject payment">✕ Reject</button>
      ${proofHTML}
    </div>
  ` : "";

  return `
    <div style="display: flex; align-items: flex-start; gap: var(--bn-space-4); padding: var(--bn-space-4); background: var(--bn-gray-100); border-radius: var(--bn-radius-lg); margin-bottom: var(--bn-space-3);">
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: var(--bn-space-3); margin-bottom: var(--bn-space-2);">
          <strong>${payment.memberName}</strong>
          <span class="badge badge-${statusClass}">${payment.status}</span>
        </div>
        <div style="font-size: var(--bn-text-sm); color: var(--bn-gray); margin-bottom: var(--bn-space-2);">
          ${payment.type}${payment.month ? ` - ${payment.month} ${payment.year}` : ""}
        </div>
        <div style="display: flex; gap: var(--bn-space-4); font-size: var(--bn-text-sm);">
          <div>
            <span style="color: var(--bn-gray);">Paid:</span>
            <span style="font-weight: 600; color: var(--bn-success);">${formatCurrency(payment.amountPaid)}</span>
          </div>
          <div>
            <span style="color: var(--bn-gray);">Total:</span>
            <span style="font-weight: 600;">${formatCurrency(payment.totalAmount)}</span>
          </div>
          ${payment.arrears > 0 ? `
            <div>
              <span style="color: var(--bn-gray);">Arrears:</span>
              <span style="font-weight: 600; color: var(--bn-danger);">${formatCurrency(payment.arrears)}</span>
            </div>
          ` : ""}
        </div>
        ${paymentDateDisplay}
        <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-2);">
          ${payment.status === "approved" && payment.approvedAt ? 
            `Approved: ${formatTimestamp(payment.approvedAt)}` :
            payment.status === "pending" && payment.updatedAt ?
            `Submitted: ${formatTimestamp(payment.updatedAt)}` :
            `Last Updated: ${formattedTimestamp}`
          }
        </div>
        ${progress > 0 && progress < 100 ? `
          <div style="margin-top: var(--bn-space-2);">
            <div style="height: 4px; background: var(--bn-gray-lighter); border-radius: 2px; overflow: hidden;">
              <div style="height: 100%; width: ${progress}%; background: var(--bn-success); border-radius: 2px;"></div>
            </div>
          </div>
        ` : ""}
        ${actionsHTML}
      </div>
    </div>
  `;
}

// Handle payment action
async function handlePaymentAction(action, paymentId) {
  const payment = payments.pending.find((p) => p.id === paymentId);
  if (!payment) return;

  if (action === "approve") {
    await approvePayment(payment);
  } else if (action === "approve-with-pop") {
    await openApprovePaymentModal(payment);
  } else if (action === "reject") {
    await rejectPayment(payment);
  }
}

// Approve payment
async function approvePayment(payment, popUrl = null, notes = null) {
  showSpinner(true);

  try {
    const currentYear = new Date().getFullYear();
    let paymentRef;

    if (payment.type === "Seed Money") {
      paymentRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_SeedMoney/${payment.memberId}/PaymentDetails`);
    } else {
      paymentRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_MonthlyContributions/${payment.memberId}/${payment.docId}`);
    }

    // IMPORTANT: Only update payment status to approved - do NOT deduct yet
    // The amountPaid should already be set when payment was uploaded
    // We're just approving it, not deducting again
    const paymentDoc = await getDoc(paymentRef);
    const currentPaymentData = paymentDoc.data();
    const currentAmountPaid = parseFloat(currentPaymentData.amountPaid || 0);
    const nowTimestamp = Timestamp.now();
    
    // Get paidAt from existing data or use current time if not set
    // Preserve existing paidAt if it exists, otherwise use the payment date or current time
    const paidAt = currentPaymentData.paidAt || 
                   (currentPaymentData.paidAt ? currentPaymentData.paidAt : 
                    (currentPaymentData.paymentDate || nowTimestamp));
    
    // Build update object
    const updateData = {
      approvalStatus: "approved",
      approvedBy: currentUser.uid,
      approvedAt: nowTimestamp,
      paidAt: paidAt,
      updatedAt: nowTimestamp,
      // Only update arrears calculation - don't change amountPaid
      arrears: Math.max(0, parseFloat(currentPaymentData.totalAmount || 0) - currentAmountPaid),
      paymentStatus: currentAmountPaid >= parseFloat(currentPaymentData.totalAmount || 0) ? "Completed" : "Pending"
    };

    // Add POP if provided
    if (popUrl) {
      updateData.proofOfPayment = {
        imageUrl: popUrl,
        uploadedAt: nowTimestamp,
        verifiedBy: currentUser.uid,
        uploadedBy: currentUser.uid
      };
    }

    // Add notes if provided
    if (notes) {
      updateData.adminNotes = notes;
      updateData.notes = notes;
    }
    
    await updateDoc(paymentRef, updateData);

    // Update member financial summary ONLY after approval
    const memberRef = doc(db, `groups/${selectedGroupId}/members`, payment.memberId);
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      const memberData = memberDoc.data();
      const financialSummary = memberData.financialSummary || {};
      const newTotalPaid = (parseFloat(financialSummary.totalPaid || 0)) + currentAmountPaid;
      const newTotalArrears = Math.max(0, (parseFloat(financialSummary.totalArrears || 0)) - currentAmountPaid);
      
      await updateDoc(memberRef, {
        "financialSummary.totalPaid": newTotalPaid,
        "financialSummary.totalArrears": newTotalArrears,
        "financialSummary.lastUpdated": Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    }

    // Send notification
    await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
      userId: payment.memberId,
      type: "payment_approved",
      title: "Payment Approved",
      message: `Your ${payment.type} payment of ${formatCurrency(payment.amountPaid)} has been approved.`,
      createdAt: Timestamp.now(),
      read: false,
    });

    // Immediately remove from pending array and add to approved array for faster UI update
    const pendingIndex = payments.pending.findIndex(p => p.id === payment.id);
    if (pendingIndex !== -1) {
      payments.pending.splice(pendingIndex, 1);
    }
    
    // Update payment status in local arrays
    payment.status = "approved";
    if (!payments.approved.find(p => p.id === payment.id)) {
      payments.approved.push(payment);
    }
    
    // Update in seedMoney or monthly arrays
    if (payment.type === "Seed Money") {
      const seedIndex = payments.seedMoney.findIndex(p => p.id === payment.id);
      if (seedIndex !== -1) {
        payments.seedMoney[seedIndex].status = "approved";
      }
    } else {
      const monthlyIndex = payments.monthly.findIndex(p => p.id === payment.id);
      if (monthlyIndex !== -1) {
        payments.monthly[monthlyIndex].status = "approved";
      }
    }
    
    // Immediately update stats and re-render UI
    updateStats();
    renderPendingPayments();
    renderRecentPayments();

    showToast("Payment approved successfully", "success");
    
    // Reload payments from database to ensure consistency
    await loadPayments();
  } catch (error) {
    console.error("Error approving payment:", error);
    showToast("Failed to approve payment", "error");
    // Reload payments on error to restore correct state
    await loadPayments();
  } finally {
    showSpinner(false);
  }
}

// Handle approve payment form submit
async function handleApprovePaymentSubmit(e) {
  e.preventDefault();
  
  const paymentId = document.getElementById("approvePaymentId")?.value;
  const popInput = document.getElementById("approvePaymentPOP");
  const notesInput = document.getElementById("approvePaymentNotes");
  
  if (!paymentId) {
    showToast("Payment ID not found", "error");
    return;
  }
  
  const payment = payments.pending.find((p) => p.id === paymentId);
  if (!payment) {
    showToast("Payment not found", "error");
    return;
  }
  
  try {
    showSpinner(true);
    
    let popUrl = null;
    
    // Upload POP if provided
    if (popInput && popInput.files && popInput.files.length > 0) {
      const popFile = popInput.files[0];
      const fileName = `payment-proofs/${selectedGroupId}/${payment.memberId}/${Date.now()}_${popFile.name}`;
      const storageRef = ref(storage, fileName);
      await uploadBytes(storageRef, popFile);
      popUrl = await getDownloadURL(storageRef);
    }
    
    const notes = notesInput?.value?.trim() || null;
    
    // Approve payment with POP and notes
    await approvePayment(payment, popUrl, notes);
    
    // Close modal
    const modal = document.getElementById("approvePaymentModal");
    if (window.closeModal) {
      window.closeModal("approvePaymentModal");
    } else {
      if (modal) modal.classList.add("hidden");
      if (modal) modal.style.display = "none";
    }
    
    // Reset form
    e.target.reset();
    
  } catch (error) {
    console.error("Error approving payment with POP:", error);
    showToast("Error approving payment: " + error.message, "error");
  } finally {
    showSpinner(false);
  }
}

// Reject payment
async function rejectPayment(payment) {
  const reason = prompt("Reason for rejection:");
  if (!reason) return;

  showSpinner(true);

  try {
    const currentYear = new Date().getFullYear();
    let paymentRef;

    if (payment.type === "Seed Money") {
      paymentRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_SeedMoney/${payment.memberId}/PaymentDetails`);
    } else {
      paymentRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_MonthlyContributions/${payment.memberId}/${payment.docId}`);
    }

    await updateDoc(paymentRef, {
      approvalStatus: "rejected",
      rejectedBy: currentUser.uid,
      rejectedAt: Timestamp.now(),
      rejectionReason: reason,
      amountPaid: 0,
      arrears: payment.totalAmount,
      updatedAt: Timestamp.now(),
      proofOfPayment: {
        imageUrl: "",
        uploadedAt: null,
        verifiedBy: "",
      },
    });

    // Immediately remove from pending array for faster UI update
    const pendingIndex = payments.pending.findIndex(p => p.id === payment.id);
    if (pendingIndex !== -1) {
      payments.pending.splice(pendingIndex, 1);
    }
    
    // Update payment status in local arrays
    payment.status = "rejected";
    payment.amountPaid = 0;
    payment.arrears = payment.totalAmount;
    
    // Update in seedMoney or monthly arrays
    if (payment.type === "Seed Money") {
      const seedIndex = payments.seedMoney.findIndex(p => p.id === payment.id);
      if (seedIndex !== -1) {
        payments.seedMoney[seedIndex].status = "rejected";
        payments.seedMoney[seedIndex].amountPaid = 0;
        payments.seedMoney[seedIndex].arrears = payment.totalAmount;
      }
    } else {
      const monthlyIndex = payments.monthly.findIndex(p => p.id === payment.id);
      if (monthlyIndex !== -1) {
        payments.monthly[monthlyIndex].status = "rejected";
        payments.monthly[monthlyIndex].amountPaid = 0;
        payments.monthly[monthlyIndex].arrears = payment.totalAmount;
      }
    }
    
    // Immediately update stats and re-render UI
    updateStats();
    renderPendingPayments();
    renderRecentPayments();

    // Send notification
    await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
      userId: payment.memberId,
      type: "payment_rejected",
      title: "Payment Rejected",
      message: `Your ${payment.type} payment was rejected. Reason: ${reason}. Please upload valid proof of payment.`,
      createdAt: Timestamp.now(),
      read: false,
    });

    showToast("Payment rejected", "success");
    
    // Reload payments from database to ensure consistency
    await loadPayments();
  } catch (error) {
    console.error("Error rejecting payment:", error);
    showToast("Failed to reject payment", "error");
    // Reload payments on error to restore correct state
    await loadPayments();
  } finally {
    showSpinner(false);
  }
}

// Open stat modal with details
async function openStatModal(statType) {
  if (!selectedGroupId) {
    showToast("Please select a group first", "warning");
    return;
  }
  
  const modal = document.getElementById("paymentDetailsModal");
  const modalTitle = document.getElementById("paymentDetailsModalTitle");
  const modalContent = document.getElementById("paymentDetailsContent");
  
  if (!modal || !modalTitle || !modalContent) return;
  
  showSpinner(true);
  
  try {
    let title = "";
    let content = "";
    
    switch (statType) {
      case "pending":
        title = "Pending Payments";
        content = await renderPendingDetails();
        break;
      case "approved":
        title = "Approved Payments";
        content = await renderApprovedDetails();
        break;
      case "collected":
        title = "Collected Payments";
        content = await renderCollectedDetails();
        break;
      case "arrears":
        title = "Members with Arrears";
        content = await renderArrearsDetails();
        break;
      default:
        return;
    }
    
    modalTitle.textContent = title;
    modalContent.innerHTML = content;
    
    // Setup action handlers after rendering
    setupPaymentDetailActions(statType);
    
    if (window.openModal) {
      window.openModal("paymentDetailsModal");
    } else {
      modal.classList.remove("hidden");
      modal.style.display = "flex";
    }
  } catch (error) {
    console.error("Error loading payment details:", error);
    showToast("Failed to load payment details", "error");
  } finally {
    showSpinner(false);
  }
}

// Render pending payments details
async function renderPendingDetails() {
  if (payments.pending.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <p class="empty-state-text">No pending payments</p>
      </div>
    `;
  }
  
  let html = '<div style="display: flex; flex-direction: column; gap: var(--bn-space-3);">';
  
  payments.pending.forEach((payment) => {
    const timestamp = formatTimestamp(payment.updatedAt || payment.createdAt);
    html += `
      <div style="display: flex; align-items: flex-start; gap: var(--bn-space-4); padding: var(--bn-space-4); background: var(--bn-gray-100); border-radius: var(--bn-radius-lg);">
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: var(--bn-space-3); margin-bottom: var(--bn-space-2);">
            <strong style="font-size: var(--bn-text-base);">${payment.memberName}</strong>
            <span class="badge badge-warning">Pending</span>
          </div>
          <div style="font-size: var(--bn-text-sm); color: var(--bn-gray); margin-bottom: var(--bn-space-2);">
            ${payment.type}${payment.month ? ` - ${payment.month} ${payment.year}` : ""}
          </div>
          <div style="display: flex; gap: var(--bn-space-4); font-size: var(--bn-text-sm); margin-bottom: var(--bn-space-2);">
            <div>
              <span style="color: var(--bn-gray);">Amount Paid:</span>
              <span style="font-weight: 600; color: var(--bn-success); margin-left: var(--bn-space-1);">${formatCurrency(payment.amountPaid)}</span>
            </div>
            <div>
              <span style="color: var(--bn-gray);">Total Due:</span>
              <span style="font-weight: 600; margin-left: var(--bn-space-1);">${formatCurrency(payment.totalAmount)}</span>
            </div>
          </div>
          <div style="font-size: var(--bn-text-xs); color: var(--bn-gray);">
            Submitted: ${timestamp}
          </div>
        </div>
        <div style="display: flex; gap: var(--bn-space-2); flex-shrink: 0;">
          <button class="btn btn-accent btn-sm" data-action="approve" data-payment-id="${payment.id}">Approve</button>
          <button class="btn btn-danger btn-sm" data-action="reject" data-payment-id="${payment.id}">Reject</button>
          <button class="btn btn-ghost btn-sm" data-action="delete" data-payment-id="${payment.id}" data-payment-type="${payment.type}" data-member-id="${payment.memberId}" data-doc-id="${payment.docId || ''}" title="Delete">🗑️</button>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  return html;
}

// Render approved payments details
async function renderApprovedDetails() {
  if (payments.approved.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <p class="empty-state-text">No approved payments yet</p>
      </div>
    `;
  }
  
  let html = '<div style="display: flex; flex-direction: column; gap: var(--bn-space-3);">';
  
  payments.approved
    .sort((a, b) => {
      const dateA = a.approvedAt?.toDate ? a.approvedAt.toDate() : new Date(0);
      const dateB = b.approvedAt?.toDate ? b.approvedAt.toDate() : new Date(0);
      return dateB - dateA;
    })
    .forEach((payment) => {
      const approvedTimestamp = formatTimestamp(payment.approvedAt || payment.updatedAt);
      const paidTimestamp = formatTimestamp(payment.paidAt || payment.updatedAt);
      
      html += `
        <div style="display: flex; align-items: flex-start; gap: var(--bn-space-4); padding: var(--bn-space-4); background: var(--bn-gray-100); border-radius: var(--bn-radius-lg);">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: var(--bn-space-3); margin-bottom: var(--bn-space-2);">
              <strong style="font-size: var(--bn-text-base);">${payment.memberName}</strong>
              <span class="badge badge-success">Approved</span>
            </div>
            <div style="font-size: var(--bn-text-sm); color: var(--bn-gray); margin-bottom: var(--bn-space-2);">
              ${payment.type}${payment.month ? ` - ${payment.month} ${payment.year}` : ""}
            </div>
            <div style="display: flex; gap: var(--bn-space-4); font-size: var(--bn-text-sm); margin-bottom: var(--bn-space-2);">
              <div>
                <span style="color: var(--bn-gray);">Amount Paid:</span>
                <span style="font-weight: 600; color: var(--bn-success); margin-left: var(--bn-space-1);">${formatCurrency(payment.amountPaid)}</span>
              </div>
              <div>
                <span style="color: var(--bn-gray);">Total Due:</span>
                <span style="font-weight: 600; margin-left: var(--bn-space-1);">${formatCurrency(payment.totalAmount)}</span>
              </div>
            </div>
            <div style="font-size: var(--bn-text-xs); color: var(--bn-gray);">
              Paid: ${paidTimestamp} | Approved: ${approvedTimestamp}
            </div>
          </div>
          <div style="display: flex; gap: var(--bn-space-2); flex-shrink: 0;">
            ${payment.proofOfPayment?.imageUrl ? `
              <a href="${payment.proofOfPayment.imageUrl}" target="_blank" class="btn btn-ghost btn-sm">View Proof</a>
            ` : ''}
            <button class="btn btn-danger btn-sm" data-action="delete" data-payment-id="${payment.id}" data-payment-type="${payment.type}" data-member-id="${payment.memberId}" data-doc-id="${payment.docId || ''}" title="Delete">🗑️</button>
          </div>
        </div>
      `;
    });
  
  html += '</div>';
  return html;
}

// Render collected payments details
async function renderCollectedDetails() {
  const collectedPayments = [...payments.seedMoney, ...payments.monthly]
    .filter(p => p.amountPaid > 0 && p.status === "approved")
    .sort((a, b) => {
      const dateA = a.approvedAt?.toDate ? a.approvedAt.toDate() : 
                   a.paidAt?.toDate ? a.paidAt.toDate() : new Date(0);
      const dateB = b.approvedAt?.toDate ? b.approvedAt.toDate() : 
                   b.paidAt?.toDate ? b.paidAt.toDate() : new Date(0);
      return dateB - dateA;
    });
  
  if (collectedPayments.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">💰</div>
        <p class="empty-state-text">No collected payments yet</p>
      </div>
    `;
  }
  
  let html = '<div style="display: flex; flex-direction: column; gap: var(--bn-space-3);">';
  
  collectedPayments.forEach((payment) => {
    const paidTimestamp = formatTimestamp(payment.paidAt || payment.approvedAt || payment.updatedAt);
    
    html += `
      <div style="display: flex; align-items: flex-start; gap: var(--bn-space-4); padding: var(--bn-space-4); background: var(--bn-gray-100); border-radius: var(--bn-radius-lg);">
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: var(--bn-space-3); margin-bottom: var(--bn-space-2);">
            <strong style="font-size: var(--bn-text-base);">${payment.memberName}</strong>
            <span class="badge badge-success">Collected</span>
          </div>
          <div style="font-size: var(--bn-text-sm); color: var(--bn-gray); margin-bottom: var(--bn-space-2);">
            Payment Type: <strong>${payment.type}</strong>${payment.month ? ` - ${payment.month} ${payment.year}` : ""}
          </div>
          <div style="display: flex; gap: var(--bn-space-4); font-size: var(--bn-text-sm); margin-bottom: var(--bn-space-2);">
            <div>
              <span style="color: var(--bn-gray);">Amount Collected:</span>
              <span style="font-weight: 600; color: var(--bn-success); margin-left: var(--bn-space-1);">${formatCurrency(payment.amountPaid)}</span>
            </div>
            <div>
              <span style="color: var(--bn-gray);">Total Due:</span>
              <span style="font-weight: 600; margin-left: var(--bn-space-1);">${formatCurrency(payment.totalAmount)}</span>
            </div>
          </div>
          <div style="font-size: var(--bn-text-xs); color: var(--bn-gray);">
            Collected: ${paidTimestamp}
          </div>
        </div>
        <div style="display: flex; gap: var(--bn-space-2); flex-shrink: 0;">
          ${payment.proofOfPayment?.imageUrl ? `
            <a href="${payment.proofOfPayment.imageUrl}" target="_blank" class="btn btn-ghost btn-sm">View Proof</a>
          ` : ''}
          <button class="btn btn-danger btn-sm" data-action="delete" data-payment-id="${payment.id}" data-payment-type="${payment.type}" data-member-id="${payment.memberId}" data-doc-id="${payment.docId || ''}" title="Delete">🗑️</button>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  return html;
}

// Render arrears details
async function renderArrearsDetails() {
  const arrearsMembers = [...payments.seedMoney, ...payments.monthly]
    .filter(p => p.arrears > 0)
    .reduce((acc, payment) => {
      const existing = acc.find(m => m.memberId === payment.memberId);
      if (existing) {
        existing.totalArrears += payment.arrears;
        existing.breakdown.push({
          type: payment.type,
          month: payment.month,
          year: payment.year,
          arrears: payment.arrears,
          paymentId: payment.id,
          docId: payment.docId
        });
      } else {
        acc.push({
          memberId: payment.memberId,
          memberName: payment.memberName,
          totalArrears: payment.arrears,
          breakdown: [{
            type: payment.type,
            month: payment.month,
            year: payment.year,
            arrears: payment.arrears,
            paymentId: payment.id,
            docId: payment.docId
          }]
        });
      }
      return acc;
    }, [])
    .sort((a, b) => b.totalArrears - a.totalArrears);
  
  if (arrearsMembers.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <p class="empty-state-text">No arrears found</p>
      </div>
    `;
  }
  
  let html = '<div style="display: flex; flex-direction: column; gap: var(--bn-space-4);">';
  
  arrearsMembers.forEach((member) => {
    html += `
      <div style="padding: var(--bn-space-4); background: var(--bn-gray-100); border-radius: var(--bn-radius-lg); border-left: 4px solid var(--bn-danger);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--bn-space-3);">
          <div>
            <strong style="font-size: var(--bn-text-base);">${member.memberName}</strong>
            <div style="font-size: var(--bn-text-lg); font-weight: 700; color: var(--bn-danger); margin-top: var(--bn-space-1);">
              Total Arrears: ${formatCurrency(member.totalArrears)}
            </div>
          </div>
          <button class="btn btn-accent btn-sm" data-action="record-payment" data-member-id="${member.memberId}">Record Payment</button>
        </div>
        <div style="margin-top: var(--bn-space-3); padding-top: var(--bn-space-3); border-top: 1px solid var(--bn-gray-lighter);">
          <div style="font-size: var(--bn-text-xs); font-weight: 600; color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-2);">Breakdown:</div>
          <div style="display: flex; flex-direction: column; gap: var(--bn-space-2);">
    `;
    
    member.breakdown.forEach((item) => {
      html += `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: var(--bn-space-2); background: var(--bn-white); border-radius: var(--bn-radius-md);">
          <div>
            <span style="font-size: var(--bn-text-sm);">${item.type}${item.month ? ` - ${item.month} ${item.year}` : ""}</span>
            <span style="font-weight: 600; color: var(--bn-danger); margin-left: var(--bn-space-2);">${formatCurrency(item.arrears)}</span>
          </div>
          <button class="btn btn-ghost btn-sm" data-action="delete-payment" data-payment-id="${item.paymentId}" data-payment-type="${item.type}" data-member-id="${member.memberId}" data-doc-id="${item.docId || ''}" title="Delete Payment">🗑️</button>
        </div>
      `;
    });
    
    html += `
          </div>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  return html;
}

// Setup action handlers for payment detail modals
function setupPaymentDetailActions(statType) {
  const modalContent = document.getElementById("paymentDetailsContent");
  if (!modalContent) return;
  
  // Approve/Reject/Delete buttons
  modalContent.querySelectorAll("[data-action='approve'], [data-action='reject']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const paymentId = e.target.closest("button").dataset.paymentId;
      const action = e.target.closest("button").dataset.action;
      const payment = payments.pending.find(p => p.id === paymentId);
      
      if (payment) {
        if (action === "approve") {
          await approvePayment(payment);
        } else if (action === "reject") {
          await rejectPayment(payment);
        }
        
        // Refresh modal content
        await openStatModal(statType);
      }
    });
  });
  
  // Delete buttons
  modalContent.querySelectorAll("[data-action='delete'], [data-action='delete-payment']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const button = e.target.closest("button");
      const paymentId = button.dataset.paymentId;
      const paymentType = button.dataset.paymentType;
      const memberId = button.dataset.memberId;
      const docId = button.dataset.docId;
      
      if (confirm(`Are you sure you want to delete this ${paymentType} payment? This action cannot be undone.`)) {
        await deletePaymentRecord(paymentType, memberId, docId);
        // Refresh modal content
        await openStatModal(statType);
        // Reload payments
        await loadPayments();
      }
    });
  });
  
  // Record payment button for arrears
  modalContent.querySelectorAll("[data-action='record-payment']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const memberId = e.target.closest("button").dataset.memberId;
      // Close modal and open record payment modal with member pre-selected
      if (window.closeModal) {
        window.closeModal("paymentDetailsModal");
      } else {
        document.getElementById("paymentDetailsModal").classList.add("hidden");
      }
      openRecordPaymentModal(memberId);
    });
  });
}

// Delete payment record
async function deletePaymentRecord(paymentType, memberId, docId) {
  showSpinner(true);
  
  try {
    const currentYear = new Date().getFullYear();
    
    if (paymentType === "Seed Money") {
      const paymentRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_SeedMoney/${memberId}/PaymentDetails`);
      const paymentDoc = await getDoc(paymentRef);
      
      if (paymentDoc.exists()) {
        const data = paymentDoc.data();
        // Reset payment to unpaid status instead of deleting
        await updateDoc(paymentRef, {
          amountPaid: 0,
          arrears: parseFloat(data.totalAmount || 0),
          approvalStatus: "unpaid",
          approvedBy: null,
          approvedAt: null,
          paidAt: null,
          proofOfPayment: {
            imageUrl: "",
            uploadedAt: null,
            verifiedBy: "",
          },
          updatedAt: Timestamp.now()
        });
      }
    } else if (paymentType === "Monthly Contribution" && docId) {
      const paymentRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_MonthlyContributions/${memberId}/${docId}`);
      const paymentDoc = await getDoc(paymentRef);
      
      if (paymentDoc.exists()) {
        const data = paymentDoc.data();
        // Reset payment to unpaid status
        await updateDoc(paymentRef, {
          amountPaid: 0,
          arrears: parseFloat(data.totalAmount || 0),
          approvalStatus: "unpaid",
          approvedBy: null,
          approvedAt: null,
          paidAt: null,
          proofOfPayment: {
            imageUrl: "",
            uploadedAt: null,
            verifiedBy: "",
          },
          updatedAt: Timestamp.now()
        });
        
        // Or delete the document entirely if preferred
        // await deleteDoc(paymentRef);
      }
    }
    
    // Update member financial summary
    const memberRef = doc(db, `groups/${selectedGroupId}/members`, memberId);
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      const financialSummary = memberDoc.data().financialSummary || {};
      await updateDoc(memberRef, {
        "financialSummary.totalPaid": 0, // Reset for this payment type
        "financialSummary.totalArrears": parseFloat(financialSummary.totalArrears || 0),
        "financialSummary.lastUpdated": Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    }
    
    showToast("Payment record deleted successfully", "success");
  } catch (error) {
    console.error("Error deleting payment record:", error);
    showToast("Failed to delete payment record", "error");
  } finally {
    showSpinner(false);
  }
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

// Auto-fill amount due based on selected member and payment type/month
async function autoFillAmountDue() {
  const memberId = document.getElementById("memberSelect").value;
  const paymentType = document.getElementById("paymentType").value;
  const paymentMonth = document.getElementById("paymentMonth")?.value;
  const amountInput = document.getElementById("paymentAmount");
  
  if (!memberId || !amountInput) {
    showToast("Please select a member first", "warning");
    return;
  }
  
  try {
    let amountDue = 0;
    const currentYear = new Date().getFullYear();
    
    if (paymentType === "seed_money") {
      // Get seed money arrears
      const seedRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_SeedMoney/${memberId}/PaymentDetails`);
      const seedDoc = await getDoc(seedRef);
      
      if (seedDoc.exists()) {
        const seedData = seedDoc.data();
        amountDue = parseFloat(seedData.arrears || 0);
      } else {
        // No record exists, use group default
        amountDue = parseFloat(groupData?.rules?.seedMoney?.amount || groupData?.seedMoneyAmount || 0);
      }
    } else if (paymentType === "monthly_contribution" && paymentMonth) {
      // Get monthly contribution arrears for selected month
      const [year, month] = paymentMonth.split('-');
      const monthNames = ["January", "February", "March", "April", "May", "June", 
                          "July", "August", "September", "October", "November", "December"];
      const monthName = monthNames[parseInt(month) - 1];
      
      const monthlyRef = doc(db, `groups/${selectedGroupId}/payments/${year}_MonthlyContributions/${memberId}/${monthName}`);
      const monthlyDoc = await getDoc(monthlyRef);
      
      if (monthlyDoc.exists()) {
        const monthlyData = monthlyDoc.data();
        amountDue = parseFloat(monthlyData.arrears || 0);
      } else {
        // No record exists, use group default
        amountDue = parseFloat(groupData?.rules?.monthlyContribution?.amount || groupData?.monthlyContribution || 0);
      }
    } else {
      showToast("Please select payment type and month (for monthly contributions)", "warning");
      return;
    }
    
    if (amountDue <= 0) {
      showToast("No amount due for this payment type", "info");
      return;
    }
    
    // Store base amount for interest calculation
    amountInput.dataset.baseAmount = amountDue.toString();
    amountInput.value = amountDue;
    
    // If interest checkbox is checked, recalculate
    const interestCheckbox = document.getElementById("applyInterestCheckbox");
    if (interestCheckbox?.checked) {
      calculateInterest();
    }
    
    showToast(`Amount auto-filled: ${formatCurrency(amountDue)}`, "success");
  } catch (error) {
    console.error("Error auto-filling amount:", error);
    showToast("Failed to auto-fill amount", "error");
  }
}

// Calculate interest/penalty based on due date and payment date
function calculateInterest() {
  const memberId = document.getElementById("memberSelect").value;
  const paymentType = document.getElementById("paymentType").value;
  const paymentMonth = document.getElementById("paymentMonth")?.value;
  const paymentDate = document.getElementById("paymentDate").value;
  const amountInput = document.getElementById("paymentAmount");
  const baseAmount = parseFloat(amountInput?.dataset.baseAmount || amountInput?.value || 0);
  
  if (!baseAmount || !paymentDate) {
    return;
  }
  
  try {
    // Get due date for this payment
    let dueDate = null;
    const currentYear = new Date().getFullYear();
    
    if (paymentType === "seed_money") {
      const seedMoneyDueDate = groupData?.rules?.seedMoney?.dueDate || groupData?.seedMoneyDueDate;
      if (seedMoneyDueDate) {
        dueDate = seedMoneyDueDate?.toDate ? seedMoneyDueDate.toDate() : new Date(seedMoneyDueDate);
      }
    } else if (paymentType === "monthly_contribution" && paymentMonth) {
      const [year, month] = paymentMonth.split('-');
      const monthlyDueDay = groupData?.rules?.monthlyContribution?.dayOfMonth || groupData?.monthlyDueDay || 15;
      dueDate = new Date(parseInt(year), parseInt(month) - 1, monthlyDueDay);
    }
    
    if (!dueDate) {
      // Can't calculate interest without due date
      const baseAmountEl = document.getElementById("interestBaseAmount");
      const interestAmountEl = document.getElementById("interestAmount");
      const totalAmountEl = document.getElementById("interestTotalAmount");
      if (baseAmountEl) baseAmountEl.textContent = formatCurrency(baseAmount);
      if (interestAmountEl) {
        interestAmountEl.textContent = formatCurrency(0);
        interestAmountEl.style.color = "var(--bn-gray)";
      }
      if (totalAmountEl) totalAmountEl.textContent = formatCurrency(baseAmount);
      if (amountInput) amountInput.value = baseAmount.toFixed(2);
      return;
    }
    
    const payDate = new Date(paymentDate);
    const daysLate = Math.max(0, Math.ceil((payDate - dueDate) / (1000 * 60 * 60 * 24)));
    
    // Get penalty rate
    const monthlyPenaltyRate = parseFloat(groupData?.rules?.monthlyPenalty?.rate || groupData?.monthlyPenalty || 5);
    const gracePeriod = parseInt(groupData?.rules?.monthlyPenalty?.gracePeriod || groupData?.monthlyGracePeriod || 5);
    
    let interestAmount = 0;
    if (daysLate > gracePeriod) {
      // Calculate penalty based on days late
      const daysToCharge = daysLate - gracePeriod;
      const dailyRate = monthlyPenaltyRate / 30; // Convert monthly rate to daily
      interestAmount = (baseAmount * dailyRate / 100) * daysToCharge;
      interestAmount = Math.round(interestAmount * 100) / 100;
    }
    
    const totalAmount = baseAmount + interestAmount;
    
    // Update display
    const baseAmountEl = document.getElementById("interestBaseAmount");
    const interestAmountEl = document.getElementById("interestAmount");
    const totalAmountEl = document.getElementById("interestTotalAmount");
    
    if (baseAmountEl) baseAmountEl.textContent = formatCurrency(baseAmount);
    if (interestAmountEl) {
      interestAmountEl.textContent = formatCurrency(interestAmount);
      interestAmountEl.style.color = interestAmount > 0 ? "var(--bn-danger)" : "var(--bn-gray)";
    }
    if (totalAmountEl) totalAmountEl.textContent = formatCurrency(totalAmount);
    
    // Update amount input
    if (amountInput) {
      amountInput.value = totalAmount.toFixed(2);
      amountInput.dataset.interestAmount = interestAmount.toString();
    }
  } catch (error) {
    console.error("Error calculating interest:", error);
  }
}

// Update interest display
function updateInterestDisplay() {
  const interestCheckbox = document.getElementById("applyInterestCheckbox");
  const interestDetails = document.getElementById("interestDetails");
  
  if (interestDetails) {
    interestDetails.style.display = interestCheckbox?.checked ? "block" : "none";
    if (interestCheckbox?.checked) {
      calculateInterest();
    }
  }
}

// Update payment amount from base (remove interest)
function updatePaymentAmountFromBase() {
  const amountInput = document.getElementById("paymentAmount");
  const baseAmount = parseFloat(amountInput?.dataset.baseAmount || 0);
  
  if (amountInput && baseAmount > 0) {
    amountInput.value = baseAmount.toFixed(2);
  }
}

// Open Record Payment Modal
async function openRecordPaymentModal(preSelectMemberId = null) {
  if (!selectedGroupId) {
    showToast("Please select a group first", "warning");
    return;
  }
  
  const modal = document.getElementById("recordPaymentModal");
  const memberSelect = document.getElementById("memberSelect");
  
  try {
    // Load members
    memberSelect.innerHTML = '<option value="">Select a member...</option>';
    
    for (const member of members) {
      let name = member.fullName || member.name;
      
      if (!name && member.userId) {
        const userDoc = await getDoc(doc(db, "users", member.userId));
        if (userDoc.exists()) {
          name = userDoc.data().fullName || userDoc.data().name || member.email;
        }
      }
      
      memberSelect.innerHTML += `<option value="${member.id}">${name || member.email || 'Unknown'}</option>`;
    }
    
    // Set up month options
    const monthSelect = document.getElementById("paymentMonth");
    if (monthSelect) {
      const now = new Date();
      monthSelect.innerHTML = '';
      for (let i = 0; i < 12; i++) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        monthSelect.innerHTML += `<option value="${monthKey}">${monthName}</option>`;
      }
    }
    
    // Pre-select member if provided
    if (preSelectMemberId && memberSelect) {
      memberSelect.value = preSelectMemberId;
    }
    
    // Set default payment date
    const paymentDateInput = document.getElementById("paymentDate");
    if (paymentDateInput) {
      paymentDateInput.value = new Date().toISOString().split("T")[0];
    }
    
    // Reset amount and interest
    const amountInput = document.getElementById("paymentAmount");
    if (amountInput) {
      amountInput.value = "";
      amountInput.dataset.baseAmount = "";
      amountInput.dataset.interestAmount = "";
    }
    
    const interestCheckbox = document.getElementById("applyInterestCheckbox");
    if (interestCheckbox) {
      interestCheckbox.checked = false;
      updateInterestDisplay();
    }
    
    if (window.openModal) {
      window.openModal("recordPaymentModal");
    } else {
      modal?.classList.add("active");
      modal?.classList.remove("hidden");
      modal.style.display = "flex";
    }
  } catch (error) {
    console.error("Error loading members:", error);
    showToast("Failed to load members", "error");
  }
}

// Open Apply Penalty Modal
async function openApplyPenaltyModal() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "warning");
    return;
  }
  
  const modal = document.getElementById("applyPenaltyModal");
  const container = document.getElementById("overdueContributionsList");
  
  try {
    const penaltyRate = groupData?.monthlyPenalty || 5;
    
    // Find overdue contributions - separate by type
    const seedMoneyPenalties = [];
    const monthlyPenalties = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    
    for (const member of members) {
      // Check seed money arrears
      const seedRecord = payments.seedMoney.find(p => p.memberId === member.id);
      if (seedRecord && seedRecord.arrears > 0) {
        seedMoneyPenalties.push({
          memberId: member.id,
          name: member.fullName || member.name || member.email || "Unknown",
          type: "seed_money",
          amountOwed: seedRecord.arrears,
          penalty: Math.round(seedRecord.arrears * (penaltyRate / 100))
        });
      }
      
      // Check monthly contribution arrears
      const monthlyRecords = payments.monthly.filter(p => p.memberId === member.id && p.arrears > 0);
      monthlyRecords.forEach(record => {
        monthlyPenalties.push({
          memberId: member.id,
          name: member.fullName || member.name || member.email || "Unknown",
          type: "monthly_contribution",
          month: `${record.month} ${record.year}`,
          amountOwed: record.arrears,
          penalty: Math.round(record.arrears * (penaltyRate / 100))
        });
      });
    }
    
    const totalPenalties = [...seedMoneyPenalties, ...monthlyPenalties];
    
    if (totalPenalties.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><p class="empty-state-text">No overdue payments found</p></div>';
      document.getElementById("totalPenalties").textContent = formatCurrency(0);
    } else {
      let html = '';
      
      // Seed Money Penalties Section
      if (seedMoneyPenalties.length > 0) {
        const seedTotal = seedMoneyPenalties.reduce((sum, p) => sum + p.penalty, 0);
        html += `
          <div style="margin-bottom: var(--bn-space-5);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--bn-space-3); padding-bottom: var(--bn-space-2); border-bottom: 2px solid var(--bn-primary);">
              <h4 style="font-size: var(--bn-text-sm); font-weight: 700; color: var(--bn-dark); text-transform: uppercase;">Seed Money Penalties</h4>
              <span style="font-size: var(--bn-text-xs); color: var(--bn-gray);">${seedMoneyPenalties.length} item(s) - ${formatCurrency(seedTotal)}</span>
            </div>
            ${seedMoneyPenalties.map(m => `
              <label style="display: flex; align-items: flex-start; gap: var(--bn-space-3); padding: var(--bn-space-3); background: var(--bn-gray-100); border-radius: var(--bn-radius-lg); margin-bottom: var(--bn-space-2); cursor: pointer;">
                <input type="checkbox" class="penalty-checkbox" data-member-id="${m.memberId}" 
                       data-type="${m.type}" data-month="" data-penalty="${m.penalty}"
                       style="margin-top: 4px;">
                <div style="flex: 1;">
                  <div style="font-weight: 600; color: var(--bn-dark);">${m.name}</div>
                  <div style="font-size: var(--bn-text-sm); color: var(--bn-gray);">
                    Seed Money - Owed: ${formatCurrency(m.amountOwed)} | Penalty: ${formatCurrency(m.penalty)}
                  </div>
                </div>
              </label>
            `).join("")}
          </div>
        `;
      }
      
      // Monthly Contribution Penalties Section
      if (monthlyPenalties.length > 0) {
        const monthlyTotal = monthlyPenalties.reduce((sum, p) => sum + p.penalty, 0);
        html += `
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--bn-space-3); padding-bottom: var(--bn-space-2); border-bottom: 2px solid var(--bn-accent);">
              <h4 style="font-size: var(--bn-text-sm); font-weight: 700; color: var(--bn-dark); text-transform: uppercase;">Monthly Contribution Penalties</h4>
              <span style="font-size: var(--bn-text-xs); color: var(--bn-gray);">${monthlyPenalties.length} item(s) - ${formatCurrency(monthlyTotal)}</span>
            </div>
            ${monthlyPenalties.map(m => `
              <label style="display: flex; align-items: flex-start; gap: var(--bn-space-3); padding: var(--bn-space-3); background: var(--bn-gray-100); border-radius: var(--bn-radius-lg); margin-bottom: var(--bn-space-2); cursor: pointer;">
                <input type="checkbox" class="penalty-checkbox" data-member-id="${m.memberId}" 
                       data-type="${m.type}" data-month="${m.month || ''}" data-penalty="${m.penalty}"
                       style="margin-top: 4px;">
                <div style="flex: 1;">
                  <div style="font-weight: 600; color: var(--bn-dark);">${m.name}</div>
                  <div style="font-size: var(--bn-text-sm); color: var(--bn-gray);">
                    Monthly (${m.month}) - Owed: ${formatCurrency(m.amountOwed)} | Penalty: ${formatCurrency(m.penalty)}
                  </div>
                </div>
              </label>
            `).join("")}
          </div>
        `;
      }
      
      container.innerHTML = html;
      
      // Update total penalties display
      const grandTotal = totalPenalties.reduce((sum, p) => sum + p.penalty, 0);
      document.getElementById("totalPenalties").textContent = formatCurrency(grandTotal);
      
      // Update penalty rate display
      document.getElementById("penaltyRate").textContent = `${penaltyRate}%`;
      
      // Add event listeners for checkbox changes to update total
      container.querySelectorAll(".penalty-checkbox").forEach(checkbox => {
        checkbox.addEventListener("change", () => {
          updatePenaltyTotal();
        });
      });
    }
    
    if (window.openModal) {
      window.openModal("applyPenaltyModal");
    } else {
      modal?.classList.add("active");
      modal?.classList.remove("hidden");
      modal.style.display = "flex";
    }
  } catch (error) {
    console.error("Error loading overdue payments:", error);
    showToast("Failed to load overdue payments", "error");
  }
}

// Open Payment Settings Modal
async function openPaymentSettingsModal() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "warning");
    return;
  }
  
  const modal = document.getElementById("paymentSettingsModal");
  
  try {
    // Get values from groupData - check both direct properties and rules structure
    const seedMoneyAmount = groupData?.rules?.seedMoney?.amount || groupData?.seedMoneyAmount || "";
    const monthlyContribution = groupData?.rules?.monthlyContribution?.amount || groupData?.monthlyContribution || "";
    const monthlyDueDay = groupData?.rules?.monthlyContribution?.dayOfMonth || groupData?.monthlyDueDay || 15;
    const monthlyPenalty = groupData?.rules?.monthlyPenalty?.rate || groupData?.monthlyPenalty || 5;
    const monthlyGracePeriod = groupData?.rules?.monthlyPenalty?.gracePeriod || groupData?.monthlyGracePeriod || 5;
    
    // Get seed money due date - check for Timestamp or date string
    let seedMoneyDueDateValue = "";
    if (groupData?.rules?.seedMoney?.dueDate) {
      const dueDate = groupData.rules.seedMoney.dueDate;
      if (dueDate.toDate) {
        seedMoneyDueDateValue = dueDate.toDate().toISOString().split("T")[0];
      } else if (typeof dueDate === "string") {
        seedMoneyDueDateValue = dueDate.split("T")[0];
      }
    } else if (groupData?.seedMoneyDueDate) {
      const dueDate = groupData.seedMoneyDueDate;
      if (dueDate?.toDate) {
        seedMoneyDueDateValue = dueDate.toDate().toISOString().split("T")[0];
      } else if (typeof dueDate === "string") {
        seedMoneyDueDateValue = dueDate.split("T")[0];
      }
    }
    
    // Get cycle information
    const cycleStartDate = groupData?.cycleStartDate;
    const cycleLength = groupData?.cycleLength || groupData?.rules?.cycleLength || 12;
    
    // Populate form fields
    document.getElementById("settingsMonthlyContribution").value = monthlyContribution;
    document.getElementById("settingsMonthlyDueDay").value = monthlyDueDay;
    document.getElementById("settingsMonthlyPenalty").value = monthlyPenalty;
    document.getElementById("settingsMonthlyGracePeriod").value = monthlyGracePeriod;
    document.getElementById("settingsSeedMoney").value = seedMoneyAmount;
    document.getElementById("settingsSeedMoneyDueDate").value = seedMoneyDueDateValue;
    document.getElementById("settingsCycleLength").value = cycleLength;
    
    // Display cycle information
    const cycleInfoEl = document.getElementById("cycleInfoDisplay");
    if (cycleInfoEl) {
      if (cycleStartDate) {
        const startDate = cycleStartDate?.toDate ? cycleStartDate.toDate() : new Date(cycleStartDate);
        const cycleEndDate = new Date(startDate);
        cycleEndDate.setMonth(cycleEndDate.getMonth() + cycleLength);
        
        cycleInfoEl.innerHTML = `
          <div style="padding: var(--bn-space-3); background: var(--bn-info-light); border-radius: var(--bn-radius-md); margin-bottom: var(--bn-space-4);">
            <div style="font-size: var(--bn-text-sm); font-weight: 600; color: var(--bn-info); margin-bottom: var(--bn-space-2);">Cycle Information</div>
            <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); line-height: 1.6;">
              <div><strong>Cycle Start:</strong> ${startDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
              <div><strong>Cycle Length:</strong> ${cycleLength} month(s)</div>
              <div><strong>Cycle End:</strong> ${cycleEndDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
              <div style="margin-top: var(--bn-space-2); padding-top: var(--bn-space-2); border-top: 1px solid rgba(59, 130, 246, 0.2);">
                <strong>Monthly Due:</strong> Day ${monthlyDueDay} of each month during the cycle
              </div>
            </div>
          </div>
        `;
      } else {
        cycleInfoEl.innerHTML = `
          <div style="padding: var(--bn-space-3); background: var(--bn-warning-light); border-radius: var(--bn-radius-md); margin-bottom: var(--bn-space-4);">
            <div style="font-size: var(--bn-text-sm); font-weight: 600; color: var(--bn-warning);">Cycle Information Not Set</div>
            <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-1);">
              Please set cycle start date and length in group settings.
            </div>
          </div>
        `;
      }
    }
    
    // Store original values for comparison
    modal.dataset.originalSeedMoney = seedMoneyAmount;
    modal.dataset.originalMonthlyContribution = monthlyContribution;
    modal.dataset.originalSeedMoneyDueDate = seedMoneyDueDateValue;
    modal.dataset.originalMonthlyDueDay = monthlyDueDay.toString();
    
    if (window.openModal) {
      window.openModal("paymentSettingsModal");
    } else {
      modal?.classList.add("active");
      modal?.classList.remove("hidden");
      modal.style.display = "flex";
    }
  } catch (error) {
    console.error("Error loading settings:", error);
    showToast("Failed to load settings", "error");
  }
}

// Handle Record Payment
async function handleRecordPayment(e) {
  e.preventDefault();
  
  const memberId = document.getElementById("memberSelect").value;
  const paymentType = document.getElementById("paymentType").value;
  const amount = parseFloat(document.getElementById("paymentAmount").value);
  const paymentDate = document.getElementById("paymentDate").value;
  const paymentMonth = document.getElementById("paymentMonth")?.value;
  const notes = document.getElementById("paymentNotes").value;
  
  if (!memberId || !paymentType || !amount || !paymentDate) {
    showToast("Please fill in all required fields", "warning");
    return;
  }
  
  showSpinner(true);
  
  try {
    const member = members.find(m => m.id === memberId);
    const memberName = member?.fullName || member?.name || member?.email || "Unknown";
    const currentYear = new Date().getFullYear();
    
    if (paymentType === "seed_money") {
      // Update seed money record
      const seedRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_SeedMoney/${memberId}/PaymentDetails`);
      const seedDoc = await getDoc(seedRef);
      
      const existingData = seedDoc.exists() ? seedDoc.data() : {
        totalAmount: groupData?.seedMoneyAmount || 0,
        amountPaid: 0,
        arrears: groupData?.seedMoneyAmount || 0
      };
      
      const newAmountPaid = (existingData.amountPaid || 0) + amount;
      const newArrears = Math.max(0, (existingData.totalAmount || 0) - newAmountPaid);
      
      const paidAtTimestamp = Timestamp.fromDate(new Date(paymentDate));
      const nowTimestamp = Timestamp.now();
      
      if (seedDoc.exists()) {
        await updateDoc(seedRef, {
          amountPaid: newAmountPaid,
          arrears: newArrears,
          approvalStatus: "approved",
          approvedBy: currentUser.uid,
          approvedAt: nowTimestamp,
          paidAt: paidAtTimestamp,
          notes: notes,
          recordedManually: true,
          updatedAt: nowTimestamp
        });
      } else {
        // Document doesn't exist, create it using setDoc
        await setDoc(seedRef, {
          totalAmount: existingData.totalAmount,
          amountPaid: newAmountPaid,
          arrears: newArrears,
          approvalStatus: "approved",
          approvedBy: currentUser.uid,
          approvedAt: nowTimestamp,
          paidAt: paidAtTimestamp,
          notes: notes,
          recordedManually: true,
          updatedAt: nowTimestamp,
          createdAt: nowTimestamp
        });
      }
    } else if (paymentType === "monthly_contribution" && paymentMonth) {
      // Update monthly contribution record
      const [year, month] = paymentMonth.split('-');
      const monthNames = ["January", "February", "March", "April", "May", "June", 
                          "July", "August", "September", "October", "November", "December"];
      const monthName = monthNames[parseInt(month) - 1];
      
      const monthlyRef = doc(db, `groups/${selectedGroupId}/payments/${year}_MonthlyContributions/${memberId}/${monthName}`);
      const monthlyDoc = await getDoc(monthlyRef);
      
      const paidAtTimestamp = Timestamp.fromDate(new Date(paymentDate));
      const nowTimestamp = Timestamp.now();
      
      if (monthlyDoc.exists()) {
        const existingData = monthlyDoc.data();
        const newAmountPaid = (existingData.amountPaid || 0) + amount;
        const newArrears = Math.max(0, (existingData.totalAmount || 0) - newAmountPaid);
        
        await updateDoc(monthlyRef, {
          amountPaid: newAmountPaid,
          arrears: newArrears,
          approvalStatus: "approved",
          approvedBy: currentUser.uid,
          approvedAt: nowTimestamp,
          paidAt: paidAtTimestamp,
          notes: notes,
          recordedManually: true,
          updatedAt: nowTimestamp
        });
      } else {
        // Create new record using setDoc
        const totalAmount = groupData?.monthlyContribution || 0;
        await setDoc(monthlyRef, {
          memberId,
          memberName,
          type: "monthly_contribution",
          month: monthName,
          year: parseInt(year),
          totalAmount: totalAmount,
          amountPaid: amount,
          arrears: Math.max(0, totalAmount - amount),
          approvalStatus: "approved",
          approvedBy: currentUser.uid,
          approvedAt: nowTimestamp,
          paidAt: paidAtTimestamp,
          notes,
          recordedManually: true,
          updatedAt: nowTimestamp,
          createdAt: nowTimestamp
        });
      }
    } else {
      // Other payment types - add to payments collection
      await addDoc(collection(db, `groups/${selectedGroupId}/payments`), {
        memberId,
        memberName,
        type: paymentType,
        amount,
        paymentDate: Timestamp.fromDate(new Date(paymentDate)),
        status: "approved",
        approvedAt: Timestamp.now(),
        approvedBy: currentUser.uid,
        notes,
        recordedManually: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    }
    
    // Get interest amount if applied
    const amountInput = document.getElementById("paymentAmount");
    const interestAmount = parseFloat(amountInput?.dataset.interestAmount || 0);
    const applyInterest = document.getElementById("applyInterestCheckbox")?.checked || false;
    
    // Determine payment reference ID
    let paymentRefId = "";
    if (paymentType === "seed_money") {
      paymentRefId = `seed_${memberId}`;
    } else if (paymentType === "monthly_contribution" && paymentMonth) {
      const [year, month] = paymentMonth.split('-');
      const monthNames = ["January", "February", "March", "April", "May", "June", 
                          "July", "August", "September", "October", "November", "December"];
      const monthName = monthNames[parseInt(month) - 1];
      paymentRefId = `monthly_${memberId}_${monthName}_${year}`;
    }
    
    // Send notification to member with payment details
    const memberUserId = member?.userId || memberId;
    if (memberUserId) {
      let notificationMessage = `Your ${paymentType.replace(/_/g, " ")} payment of ${formatCurrency(amount)} has been recorded by an admin.`;
      
      if (paymentType === "monthly_contribution" && paymentMonth) {
        const [year, month] = paymentMonth.split('-');
        const monthNames = ["January", "February", "March", "April", "May", "June", 
                            "July", "August", "September", "October", "November", "December"];
        const monthName = monthNames[parseInt(month) - 1];
        notificationMessage = `Your monthly contribution payment for ${monthName} ${year} of ${formatCurrency(amount)} has been recorded by an admin.`;
      }
      
      if (applyInterest && interestAmount > 0) {
        notificationMessage += `\n\nPayment breakdown:\nBase Amount: ${formatCurrency(amount - interestAmount)}\nInterest/Penalty: ${formatCurrency(interestAmount)}\nTotal: ${formatCurrency(amount)}`;
      }
      
      if (notes) {
        notificationMessage += `\n\nNotes: ${notes}`;
      }
      
      await addDoc(collection(db, `groups/${selectedGroupId}/notifications`), {
        userId: memberUserId,
        recipientId: memberUserId, // Keep for backward compatibility
        type: "payment_recorded",
        title: "Payment Recorded",
        message: notificationMessage,
        paymentType: paymentType,
        paymentId: paymentRefId,
        memberId: memberId,
        amount: amount,
        interestAmount: interestAmount,
        baseAmount: amount - interestAmount,
        groupId: selectedGroupId,
        groupName: groupData?.groupName || "Unknown Group",
        senderId: currentUser.uid,
        createdAt: Timestamp.now(),
        read: false
      });
    }
    
    // Update member financial summary
    const memberRef = doc(db, `groups/${selectedGroupId}/members`, memberId);
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      const financialSummary = memberDoc.data().financialSummary || {};
      const currentTotalPaid = parseFloat(financialSummary.totalPaid || 0);
      const currentArrears = parseFloat(financialSummary.totalArrears || 0);
      
      await updateDoc(memberRef, {
        "financialSummary.totalPaid": currentTotalPaid + amount,
        "financialSummary.totalArrears": Math.max(0, currentArrears - amount),
        "financialSummary.lastUpdated": Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    }
    
    showToast("Payment recorded successfully", "success");
    if (window.closeModal) {
      window.closeModal("recordPaymentModal");
    } else {
      const modal = document.getElementById("recordPaymentModal");
      modal?.classList.remove("active");
      modal?.classList.add("hidden");
      modal.style.display = "none";
    }
    document.getElementById("recordPaymentForm")?.reset();
    document.getElementById("paymentDate").value = new Date().toISOString().split("T")[0];
    await loadPayments();
  } catch (error) {
    console.error("Error recording payment:", error);
    showToast("Failed to record payment", "error");
  } finally {
    showSpinner(false);
  }
}

// Handle Save Settings with warnings for crucial changes
async function handleSaveSettings(e) {
  e.preventDefault();
  
  const modal = document.getElementById("paymentSettingsModal");
  const monthlyContribution = parseFloat(document.getElementById("settingsMonthlyContribution").value) || 0;
  const monthlyDueDay = parseInt(document.getElementById("settingsMonthlyDueDay").value) || 15;
  const monthlyPenalty = parseFloat(document.getElementById("settingsMonthlyPenalty").value) || 5;
  const monthlyGracePeriod = parseInt(document.getElementById("settingsMonthlyGracePeriod").value) || 5;
  const seedMoneyAmount = parseFloat(document.getElementById("settingsSeedMoney").value) || 0;
  const seedMoneyDueDate = document.getElementById("settingsSeedMoneyDueDate").value;
  const cycleLength = parseInt(document.getElementById("settingsCycleLength").value) || 12;
  
  // Check for crucial changes and warn user
  const originalSeedMoney = parseFloat(modal?.dataset.originalSeedMoney || 0);
  const originalMonthlyContribution = parseFloat(modal?.dataset.originalMonthlyContribution || 0);
  const originalSeedMoneyDueDate = modal?.dataset.originalSeedMoneyDueDate || "";
  const originalMonthlyDueDay = parseInt(modal?.dataset.originalMonthlyDueDay || 15);
  
  let hasCrucialChanges = false;
  let warningMessage = "⚠️ WARNING: You are about to make crucial changes to payment settings:\n\n";
  
  if (seedMoneyAmount !== originalSeedMoney) {
    hasCrucialChanges = true;
    warningMessage += `• Seed Money: ${formatCurrency(originalSeedMoney)} → ${formatCurrency(seedMoneyAmount)}\n`;
  }
  
  if (monthlyContribution !== originalMonthlyContribution) {
    hasCrucialChanges = true;
    warningMessage += `• Monthly Contribution: ${formatCurrency(originalMonthlyContribution)} → ${formatCurrency(monthlyContribution)}\n`;
  }
  
  if (seedMoneyDueDate !== originalSeedMoneyDueDate) {
    hasCrucialChanges = true;
    const oldDate = originalSeedMoneyDueDate ? new Date(originalSeedMoneyDueDate).toLocaleDateString() : "Not set";
    const newDate = seedMoneyDueDate ? new Date(seedMoneyDueDate).toLocaleDateString() : "Not set";
    warningMessage += `• Seed Money Due Date: ${oldDate} → ${newDate}\n`;
  }
  
  if (monthlyDueDay !== originalMonthlyDueDay) {
    hasCrucialChanges = true;
    warningMessage += `• Monthly Due Day: Day ${originalMonthlyDueDay} → Day ${monthlyDueDay}\n`;
  }
  
  warningMessage += "\nThese changes will affect all members and future payment calculations. Are you sure you want to continue?";
  
  if (hasCrucialChanges && !confirm(warningMessage)) {
    return; // User cancelled
  }
  
  // Additional confirmation for major changes
  if (hasCrucialChanges) {
    const secondConfirm = confirm("🛑 FINAL CONFIRMATION\n\nChanging these settings will impact:\n• All existing payment records\n• Member financial summaries\n• Upcoming payment calculations\n• Arrears calculations\n\nDo you want to proceed?");
    if (!secondConfirm) {
      return;
    }
  }
  
  showSpinner(true);
  
  try {
    // Convert seedMoneyDueDate to Timestamp if provided
    let seedMoneyDueDateTimestamp = null;
    if (seedMoneyDueDate) {
      seedMoneyDueDateTimestamp = Timestamp.fromDate(new Date(seedMoneyDueDate));
    }
    
    // Update using rules structure for consistency
    const updateData = {
      "rules.seedMoney.amount": seedMoneyAmount,
      "rules.seedMoney.dueDate": seedMoneyDueDateTimestamp || null,
      "rules.monthlyContribution.amount": monthlyContribution,
      "rules.monthlyContribution.dayOfMonth": monthlyDueDay,
      "rules.monthlyPenalty.rate": monthlyPenalty,
      "rules.monthlyPenalty.gracePeriod": monthlyGracePeriod,
      "rules.cycleLength": cycleLength,
      // Also keep legacy fields for backward compatibility
      monthlyContribution,
      monthlyDueDay,
      monthlyPenalty,
      monthlyGracePeriod,
      seedMoneyAmount,
      seedMoneyDueDate: seedMoneyDueDate || null,
      cycleLength,
      updatedAt: Timestamp.now()
    };
    
    await updateDoc(doc(db, "groups", selectedGroupId), updateData);
    
    // Update local groupData
    if (!groupData.rules) groupData.rules = {};
    if (!groupData.rules.seedMoney) groupData.rules.seedMoney = {};
    if (!groupData.rules.monthlyContribution) groupData.rules.monthlyContribution = {};
    if (!groupData.rules.monthlyPenalty) groupData.rules.monthlyPenalty = {};
    
    groupData.rules.seedMoney.amount = seedMoneyAmount;
    groupData.rules.seedMoney.dueDate = seedMoneyDueDateTimestamp;
    groupData.rules.monthlyContribution.amount = monthlyContribution;
    groupData.rules.monthlyContribution.dayOfMonth = monthlyDueDay;
    groupData.rules.monthlyPenalty.rate = monthlyPenalty;
    groupData.rules.monthlyPenalty.gracePeriod = monthlyGracePeriod;
    groupData.rules.cycleLength = cycleLength;
    
    // Legacy fields
    groupData.monthlyContribution = monthlyContribution;
    groupData.monthlyDueDay = monthlyDueDay;
    groupData.monthlyPenalty = monthlyPenalty;
    groupData.monthlyGracePeriod = monthlyGracePeriod;
    groupData.seedMoneyAmount = seedMoneyAmount;
    groupData.seedMoneyDueDate = seedMoneyDueDateTimestamp || seedMoneyDueDate;
    groupData.cycleLength = cycleLength;
    
    showToast("Settings saved successfully" + (hasCrucialChanges ? " - Changes applied" : ""), "success");
    if (window.closeModal) {
      window.closeModal("paymentSettingsModal");
    } else {
      modal?.classList.remove("active");
      modal?.classList.add("hidden");
      modal.style.display = "none";
    }
    
    // Reload payments to reflect changes
    await loadPayments();
  } catch (error) {
    console.error("Error saving settings:", error);
    showToast("Failed to save settings", "error");
  } finally {
    showSpinner(false);
  }
}

// Update penalty total based on selected checkboxes
function updatePenaltyTotal() {
  const checkedItems = document.querySelectorAll(".penalty-checkbox:checked");
  const totalPenaltiesEl = document.getElementById("totalPenalties");
  if (!totalPenaltiesEl) return;
  
  let total = 0;
  checkedItems.forEach(checkbox => {
    total += parseFloat(checkbox.dataset.penalty || 0);
  });
  
  totalPenaltiesEl.textContent = formatCurrency(total);
}

// Handle Apply Penalties
async function handleApplyPenalties() {
  const checkedItems = document.querySelectorAll(".penalty-checkbox:checked");
  
  if (checkedItems.length === 0) {
    showToast("Please select at least one overdue payment", "warning");
    return;
  }
  
  showSpinner(true);
  
  try {
    const batch = writeBatch(db);
    
    for (const checkbox of checkedItems) {
      const memberId = checkbox.dataset.memberId;
      const type = checkbox.dataset.type;
      const month = checkbox.dataset.month;
      const penalty = parseFloat(checkbox.dataset.penalty);
      
      const penaltyRef = doc(collection(db, `groups/${selectedGroupId}/penalties`));
      batch.set(penaltyRef, {
        memberId,
        type: type + "_penalty",
        relatedMonth: month || null,
        amount: penalty,
        status: "unpaid",
        appliedAt: Timestamp.now(),
        appliedBy: currentUser.uid
      });
      
      // Get member to send notification
      const member = members.find(m => m.id === memberId);
      const memberUserId = member?.userId || memberId;
      
      if (memberUserId) {
        const notifRef = doc(collection(db, `groups/${selectedGroupId}/notifications`));
        batch.set(notifRef, {
          userId: memberUserId,
          type: "penalty_applied",
          title: "Penalty Applied",
          message: `A penalty of ${formatCurrency(penalty)} has been applied for overdue ${type.replace(/_/g, " ")}.`,
          createdAt: Timestamp.now(),
          read: false
        });
      }
    }
    
    await batch.commit();
    
    showToast(`${checkedItems.length} penalties applied`, "success");
    if (window.closeModal) {
      window.closeModal("applyPenaltyModal");
    } else {
      const modal = document.getElementById("applyPenaltyModal");
      modal?.classList.remove("active");
      modal?.classList.add("hidden");
      modal.style.display = "none";
    }
    await loadPayments();
  } catch (error) {
    console.error("Error applying penalties:", error);
    showToast("Failed to apply penalties", "error");
  } finally {
    showSpinner(false);
  }
}

// Send Payment Reminders
async function sendPaymentReminders() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "warning");
    return;
  }
  
  showSpinner(true);
  
  try {
    const batch = writeBatch(db);
    let reminderCount = 0;
    
    for (const member of members) {
      const memberUserId = member.userId || member.id;
      if (memberUserId) {
        const notifRef = doc(collection(db, `groups/${selectedGroupId}/notifications`));
        batch.set(notifRef, {
          userId: memberUserId,
          type: "payment_reminder",
          title: "Payment Reminder",
          message: `Reminder: Your monthly contribution of ${formatCurrency(groupData?.monthlyContribution || 0)} is due on day ${groupData?.monthlyDueDay || 15} of each month.`,
          createdAt: Timestamp.now(),
          read: false
        });
        reminderCount++;
      }
    }
    
    await batch.commit();
    
    showToast(`Sent reminders to ${reminderCount} members`, "success");
  } catch (error) {
    console.error("Error sending reminders:", error);
    showToast("Failed to send reminders", "error");
  } finally {
    showSpinner(false);
  }
}

// Render payments by tab
function renderPaymentsByTab(tab) {
  if (!pendingPaymentsList) return;
  
  // Update title
  const titleMap = {
    pending: "Pending Approvals",
    seed: "Seed Money Payments",
    monthly: "Monthly Contributions",
    overdue: "Overdue Payments",
    recent: "Recent Payments"
  };
  const paymentsListTitle = document.getElementById("paymentsListTitle");
  if (paymentsListTitle) {
    paymentsListTitle.textContent = titleMap[tab] || "Payments";
  }
  
  // Show/hide add payment button (show for all tabs except pending where it's always available)
  const addPaymentBtn = document.getElementById("addPaymentInTabBtn");
  if (addPaymentBtn) {
    addPaymentBtn.style.display = selectedGroupId ? "flex" : "none";
  }
  
  let filteredPayments = [];
  
  switch (tab) {
    case "pending":
      filteredPayments = payments.pending;
      break;
    case "seed":
      filteredPayments = payments.seedMoney.filter(p => p.amountPaid > 0 || p.status === "pending");
      break;
    case "monthly":
      filteredPayments = payments.monthly.filter(p => p.amountPaid > 0 || p.status === "pending");
      break;
    case "overdue":
      filteredPayments = [...payments.seedMoney, ...payments.monthly].filter(p => p.arrears > 0);
      break;
    case "recent":
      // Recent payments: all payments with amountPaid > 0, sorted by date
      filteredPayments = [...payments.seedMoney, ...payments.monthly]
        .filter(p => p.amountPaid > 0)
        .sort((a, b) => {
          const dateA = a.updatedAt?.toDate ? a.updatedAt.toDate() : 
                       a.approvedAt?.toDate ? a.approvedAt.toDate() :
                       a.paidAt?.toDate ? a.paidAt.toDate() : new Date(0);
          const dateB = b.updatedAt?.toDate ? b.updatedAt.toDate() : 
                       b.approvedAt?.toDate ? b.approvedAt.toDate() :
                       b.paidAt?.toDate ? b.paidAt.toDate() : new Date(0);
          return dateB - dateA;
        })
        .slice(0, 50); // Show last 50 recent payments
      break;
    default:
      filteredPayments = payments.pending;
  }
  
  if (filteredPayments.length === 0) {
    const iconMap = {
      pending: "💳",
      seed: "🌱",
      monthly: "📅",
      overdue: "⚠️",
      recent: "📋"
    };
    pendingPaymentsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${iconMap[tab] || "💳"}</div>
        <p class="empty-state-text">No ${titleMap[tab]?.toLowerCase() || tab} found</p>
      </div>
    `;
    return;
  }
  
  pendingPaymentsList.innerHTML = filteredPayments.map((payment) => {
    const showActions = tab === "pending" && payment.status === "pending";
    return createPaymentCard(payment, showActions);
  }).join("");
  
  // Add event listeners for action buttons
  pendingPaymentsList.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = e.target.closest("button").dataset.action;
      const paymentId = e.target.closest("button").dataset.paymentId;
      handlePaymentAction(action, paymentId);
    });
  });
}
