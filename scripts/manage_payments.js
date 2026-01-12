import {
  db,
  auth,
  collection,
  doc,
  getDocs,
  getDoc,
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
  document.getElementById("applyPenaltyBtn")?.addEventListener("click", openApplyPenaltyModal);
  document.getElementById("paymentSettingsBtn")?.addEventListener("click", openPaymentSettingsModal);
  document.getElementById("sendRemindersBtn")?.addEventListener("click", sendPaymentReminders);

  // Modal close buttons
  setupModalCloseHandlers("recordPaymentModal", "closeRecordPaymentModal", "cancelRecordPayment");
  setupModalCloseHandlers("applyPenaltyModal", "closeApplyPenaltyModal", "cancelApplyPenalty");
  setupModalCloseHandlers("paymentSettingsModal", "closePaymentSettingsModal", "cancelPaymentSettings");

  // Form submissions
  document.getElementById("recordPaymentForm")?.addEventListener("submit", handleRecordPayment);
  document.getElementById("paymentSettingsForm")?.addEventListener("submit", handleSaveSettings);
  document.getElementById("confirmApplyPenalty")?.addEventListener("click", handleApplyPenalties);

  // Payment type change
  document.getElementById("paymentType")?.addEventListener("change", (e) => {
    const monthGroup = document.getElementById("monthSelectGroup");
    monthGroup.style.display = e.target.value === "monthly_contribution" ? "block" : "none";
  });

  // Tab switching
  document.querySelectorAll(".payment-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".payment-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      renderPaymentsByTab(tab.dataset.tab);
    });
  });
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

    // Load members
    const membersRef = collection(db, `groups/${selectedGroupId}/members`);
    const membersSnapshot = await getDocs(membersRef);
    members = [];
    membersSnapshot.forEach((doc) => {
      members.push({ id: doc.id, ...doc.data() });
    });

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
            updatedAt: data.updatedAt,
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
            updatedAt: data.updatedAt,
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

    // Render payments
    renderPendingPayments();
    renderRecentPayments();
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

// Create payment card
function createPaymentCard(payment, showActions = true) {
  const statusClass = payment.status === "approved" ? "success" : 
                      payment.status === "pending" ? "warning" : "secondary";
  
  const progress = payment.totalAmount > 0 ? (payment.amountPaid / payment.totalAmount) * 100 : 0;
  
  let proofHTML = "";
  if (payment.proofOfPayment?.imageUrl) {
    proofHTML = `<a href="${payment.proofOfPayment.imageUrl}" target="_blank" class="btn btn-ghost btn-sm">View Proof</a>`;
  }

  const actionsHTML = showActions && payment.status === "pending" ? `
    <div style="display: flex; gap: var(--bn-space-2); margin-top: var(--bn-space-4);">
      <button class="btn btn-accent btn-sm" data-action="approve" data-payment-id="${payment.id}">Approve</button>
      <button class="btn btn-danger btn-sm" data-action="reject" data-payment-id="${payment.id}">Reject</button>
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
  } else if (action === "reject") {
    await rejectPayment(payment);
  }
}

// Approve payment
async function approvePayment(payment) {
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
      approvalStatus: "approved",
      approvedBy: currentUser.uid,
      approvedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    // Update member financial summary
    const memberRef = doc(db, `groups/${selectedGroupId}/members`, payment.memberId);
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      const financialSummary = memberDoc.data().financialSummary || {};
      await updateDoc(memberRef, {
        "financialSummary.totalPaid": (parseFloat(financialSummary.totalPaid || 0)) + payment.amountPaid,
        "financialSummary.totalArrears": Math.max(0, (parseFloat(financialSummary.totalArrears || 0)) - payment.amountPaid),
        "financialSummary.lastUpdated": Timestamp.now(),
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

    showToast("Payment approved successfully", "success");
    await loadPayments();
  } catch (error) {
    console.error("Error approving payment:", error);
    showToast("Failed to approve payment", "error");
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
    await loadPayments();
  } catch (error) {
    console.error("Error rejecting payment:", error);
    showToast("Failed to reject payment", "error");
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

// Open Record Payment Modal
async function openRecordPaymentModal() {
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
    
    modal?.classList.add("active");
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
    
    // Find overdue contributions
    const overdueMembers = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    
    for (const member of members) {
      // Check seed money arrears
      const seedRecord = payments.seedMoney.find(p => p.memberId === member.id);
      if (seedRecord && seedRecord.arrears > 0) {
        overdueMembers.push({
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
        overdueMembers.push({
          memberId: member.id,
          name: member.fullName || member.name || member.email || "Unknown",
          type: "monthly_contribution",
          month: `${record.month} ${record.year}`,
          amountOwed: record.arrears,
          penalty: Math.round(record.arrears * (penaltyRate / 100))
        });
      });
    }
    
    if (overdueMembers.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><p class="empty-state-text">No overdue payments found</p></div>';
    } else {
      container.innerHTML = overdueMembers.map(m => `
        <label style="display: flex; align-items: flex-start; gap: var(--bn-space-3); padding: var(--bn-space-3); background: var(--bn-gray-100); border-radius: var(--bn-radius-lg); margin-bottom: var(--bn-space-2); cursor: pointer;">
          <input type="checkbox" class="penalty-checkbox" data-member-id="${m.memberId}" 
                 data-type="${m.type}" data-month="${m.month || ''}" data-penalty="${m.penalty}"
                 style="margin-top: 4px;">
          <div style="flex: 1;">
            <div style="font-weight: 600; color: var(--bn-dark);">${m.name}</div>
            <div style="font-size: var(--bn-text-sm); color: var(--bn-gray);">
              ${m.type === "monthly_contribution" ? `Monthly (${m.month})` : "Seed Money"} - 
              Owed: ${formatCurrency(m.amountOwed)} | Penalty: ${formatCurrency(m.penalty)}
            </div>
          </div>
        </label>
      `).join("");
    }
    
    modal?.classList.add("active");
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
    document.getElementById("settingsMonthlyContribution").value = groupData?.monthlyContribution || "";
    document.getElementById("settingsMonthlyDueDay").value = groupData?.monthlyDueDay || 15;
    document.getElementById("settingsMonthlyPenalty").value = groupData?.monthlyPenalty || 5;
    document.getElementById("settingsMonthlyGracePeriod").value = groupData?.monthlyGracePeriod || 5;
    document.getElementById("settingsSeedMoney").value = groupData?.seedMoneyAmount || "";
    document.getElementById("settingsSeedMoneyDueDate").value = groupData?.seedMoneyDueDate || "";
    
    modal?.classList.add("active");
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
      
      await updateDoc(seedRef, {
        amountPaid: newAmountPaid,
        arrears: newArrears,
        approvalStatus: "approved",
        approvedBy: currentUser.uid,
        approvedAt: Timestamp.now(),
        notes: notes,
        updatedAt: Timestamp.now()
      }).catch(() => {
        // Document might not exist, create it
        return addDoc(collection(db, `groups/${selectedGroupId}/payments`), {
          memberId,
          memberName,
          type: "seed_money",
          amount,
          status: "approved",
          approvedAt: Timestamp.now(),
          approvedBy: currentUser.uid,
          notes,
          recordedManually: true,
          createdAt: Timestamp.now()
        });
      });
    } else if (paymentType === "monthly_contribution" && paymentMonth) {
      // Update monthly contribution record
      const [year, month] = paymentMonth.split('-');
      const monthNames = ["January", "February", "March", "April", "May", "June", 
                          "July", "August", "September", "October", "November", "December"];
      const monthName = monthNames[parseInt(month) - 1];
      
      const monthlyRef = doc(db, `groups/${selectedGroupId}/payments/${year}_MonthlyContributions/${memberId}/${monthName}`);
      const monthlyDoc = await getDoc(monthlyRef);
      
      if (monthlyDoc.exists()) {
        const existingData = monthlyDoc.data();
        const newAmountPaid = (existingData.amountPaid || 0) + amount;
        const newArrears = Math.max(0, (existingData.totalAmount || 0) - newAmountPaid);
        
        await updateDoc(monthlyRef, {
          amountPaid: newAmountPaid,
          arrears: newArrears,
          approvalStatus: "approved",
          approvedBy: currentUser.uid,
          approvedAt: Timestamp.now(),
          notes: notes,
          updatedAt: Timestamp.now()
        });
      } else {
        // Create new record
        await addDoc(collection(db, `groups/${selectedGroupId}/payments`), {
          memberId,
          memberName,
          type: "monthly_contribution",
          paymentMonth,
          amount,
          status: "approved",
          approvedAt: Timestamp.now(),
          approvedBy: currentUser.uid,
          notes,
          recordedManually: true,
          createdAt: Timestamp.now()
        });
      }
    } else {
      // Other payment types - add to payments collection
      await addDoc(collection(db, `groups/${selectedGroupId}/payments`), {
        memberId,
        memberName,
        type: paymentType,
        amount,
        date: paymentDate,
        status: "approved",
        approvedAt: Timestamp.now(),
        approvedBy: currentUser.uid,
        notes,
        recordedManually: true,
        createdAt: Timestamp.now()
      });
    }
    
    // Send notification to member
    if (member?.userId) {
      await addDoc(collection(db, "notifications"), {
        userId: member.userId,
        groupId: selectedGroupId,
        type: "payment_recorded",
        title: "Payment Recorded",
        message: `Your ${paymentType.replace(/_/g, " ")} payment of ${formatCurrency(amount)} has been recorded.`,
        createdAt: Timestamp.now(),
        read: false
      });
    }
    
    showToast("Payment recorded successfully", "success");
    document.getElementById("recordPaymentModal")?.classList.remove("active");
    document.getElementById("recordPaymentForm")?.reset();
    await loadPayments();
  } catch (error) {
    console.error("Error recording payment:", error);
    showToast("Failed to record payment", "error");
  } finally {
    showSpinner(false);
  }
}

// Handle Save Settings
async function handleSaveSettings(e) {
  e.preventDefault();
  
  const monthlyContribution = parseFloat(document.getElementById("settingsMonthlyContribution").value) || 0;
  const monthlyDueDay = parseInt(document.getElementById("settingsMonthlyDueDay").value) || 15;
  const monthlyPenalty = parseFloat(document.getElementById("settingsMonthlyPenalty").value) || 5;
  const monthlyGracePeriod = parseInt(document.getElementById("settingsMonthlyGracePeriod").value) || 5;
  const seedMoneyAmount = parseFloat(document.getElementById("settingsSeedMoney").value) || 0;
  const seedMoneyDueDate = document.getElementById("settingsSeedMoneyDueDate").value;
  
  showSpinner(true);
  
  try {
    await updateDoc(doc(db, "groups", selectedGroupId), {
      monthlyContribution,
      monthlyDueDay,
      monthlyPenalty,
      monthlyGracePeriod,
      seedMoneyAmount,
      seedMoneyDueDate,
      updatedAt: Timestamp.now()
    });
    
    // Update local groupData
    groupData = {
      ...groupData,
      monthlyContribution,
      monthlyDueDay,
      monthlyPenalty,
      monthlyGracePeriod,
      seedMoneyAmount,
      seedMoneyDueDate
    };
    
    showToast("Settings saved successfully", "success");
    document.getElementById("paymentSettingsModal")?.classList.remove("active");
  } catch (error) {
    console.error("Error saving settings:", error);
    showToast("Failed to save settings", "error");
  } finally {
    showSpinner(false);
  }
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
      
      if (member?.userId) {
        const notifRef = doc(collection(db, "notifications"));
        batch.set(notifRef, {
          userId: member.userId,
          groupId: selectedGroupId,
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
    document.getElementById("applyPenaltyModal")?.classList.remove("active");
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
      if (member.userId) {
        const notifRef = doc(collection(db, "notifications"));
        batch.set(notifRef, {
          userId: member.userId,
          groupId: selectedGroupId,
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
  // This would filter the current payments list based on the tab
  if (selectedGroupId) {
    loadPayments();
  }
}
