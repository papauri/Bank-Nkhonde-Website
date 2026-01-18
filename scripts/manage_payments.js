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
import { loadPaymentDetailsTable } from "./payment_details_table.js";

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

// Auth state listener with error handling
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    try {
      await loadUserGroups();
    } catch (error) {
      console.error("Error in auth state listener:", error);
      // Check if it's a network error
      if (error.message?.includes("network") || error.code === "unavailable" || error.message?.includes("ERR_NAME_NOT_RESOLVED")) {
        showToast("Network connection issue. Please check your internet connection.", "warning");
      }
    }
  } else {
    window.location.href = "../login.html";
  }
}, (error) => {
  // Handle auth errors
  console.error("Auth state change error:", error);
  if (error.code === "auth/network-request-failed" || error.message?.includes("ERR_NAME_NOT_RESOLVED")) {
    // Network error - don't redirect, just show warning
    if (document.getElementById("toastContainer")) {
      showToast("Network connection issue. Some features may not work until connection is restored.", "warning");
    }
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
  document.getElementById("viewAllPaymentDetailsBtn")?.addEventListener("click", openAllPaymentDetailsModal);
  
  // Payment Details Modal handlers
  setupModalCloseHandlers("allPaymentDetailsModal", "closeAllPaymentDetailsModal", "closeAllPaymentDetailsModal");

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
    
    // Hide Advanced Payment checkbox for Seed Money and Service Fee (only show for Monthly Contribution)
    const advancedPaymentGroup = document.getElementById("isAdvancedPayment")?.parentElement?.parentElement;
    if (advancedPaymentGroup) {
      const paymentType = e.target.value;
      if (paymentType === "seed_money" || paymentType === "service_fee") {
        advancedPaymentGroup.style.display = "none";
        // Uncheck the checkbox when hidden
        const checkbox = document.getElementById("isAdvancedPayment");
        if (checkbox) checkbox.checked = false;
      } else {
        advancedPaymentGroup.style.display = "block";
      }
    }
  });
  
  // Member or month change - reset amount and interest
  document.getElementById("memberSelect")?.addEventListener("change", async () => {
    document.getElementById("paymentAmount").value = "";
    const interestCheckbox = document.getElementById("applyInterestCheckbox");
    if (interestCheckbox) {
      interestCheckbox.checked = false;
      updateInterestDisplay();
    }
    
    // Update payment type options based on selected member's payment status
    await updatePaymentTypeOptions();
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
  
  // POP file upload preview
  document.getElementById("recordPaymentPOP")?.addEventListener("change", (e) => {
    const fileInput = e.target;
    const preview = document.getElementById("recordPaymentPOPPreview");
    const fileName = document.getElementById("recordPaymentPOPFileName");
    
    if (fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const fileSize = (file.size / 1024 / 1024).toFixed(2); // MB
      
      if (fileSize > 10) {
        showToast("File size must be less than 10MB", "warning");
        fileInput.value = "";
        if (preview) preview.style.display = "none";
        return;
      }
      
      if (fileName) fileName.textContent = `${file.name} (${fileSize} MB)`;
      if (preview) preview.style.display = "block";
    } else {
      if (preview) preview.style.display = "none";
    }
  });

  // Tab switching function
  function switchToTab(tabName) {
    const tabs = document.querySelectorAll(".payment-tab");
    tabs.forEach((t) => {
      if (t.dataset.tab === tabName) {
        t.classList.add("active");
      } else {
        t.classList.remove("active");
      }
    });
    renderPaymentsByTab(tabName);
  }
  
  // Make switchToTab available globally
  window.switchToTab = switchToTab;
  
  // Tab switching event listeners
  document.querySelectorAll(".payment-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      switchToTab(tab.dataset.tab);
    });
  });
  
  // Filter dropdowns event listeners
  const filterByMember = document.getElementById("filterByMember");
  const filterByPaymentType = document.getElementById("filterByPaymentType");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");
  
  // Filter change handlers
  filterByMember?.addEventListener("change", () => {
    applyFilters();
  });
  
  filterByPaymentType?.addEventListener("change", () => {
    applyFilters();
  });
  
  clearFiltersBtn?.addEventListener("click", () => {
    if (filterByMember) filterByMember.value = "";
    if (filterByPaymentType) filterByPaymentType.value = "";
    const filterByMonth = document.getElementById("filterByMonth");
    if (filterByMonth) filterByMonth.value = "";
    applyFilters();
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
  setupModalCloseHandlers("allPaymentDetailsModal", "closeAllPaymentDetailsModal", "closeAllPaymentDetailsModal");
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
  // Removed click-outside-to-close - modals can only be closed via X or Cancel buttons
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
    
    // Update filter dropdown options
    updateFilterOptions();
    
    // Show/hide service fee tab based on group settings
    updateServiceFeeTabVisibility();

    // Reset payments
    payments = { pending: [], approved: [], seedMoney: [], monthly: [], serviceFee: [] };

    const currentYear = new Date().getFullYear();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    // Load seed money payments - check current year and adjacent years to catch all payments
    const seedMoneyYearsToCheck = [currentYear - 1, currentYear, currentYear + 1];
    
    for (const member of members) {
      for (const year of seedMoneyYearsToCheck) {
        try {
          const seedMoneyRef = doc(db, `groups/${selectedGroupId}/payments/${year}_SeedMoney/${member.id}/PaymentDetails`);
          const seedMoneyDoc = await getDoc(seedMoneyRef);
          if (seedMoneyDoc.exists()) {
            const data = seedMoneyDoc.data();
            const paymentRecord = {
              id: `seed_${member.id}_${year}`,
              memberId: member.id,
              memberName: member.fullName || "Unknown",
              type: "Seed Money",
              year: year,
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
              isAdvancedPayment: data.isAdvancedPayment || false,
            };
            // Only add if not already added (avoid duplicates)
            if (!payments.seedMoney.find(p => p.id === paymentRecord.id)) {
              payments.seedMoney.push(paymentRecord);
              if (data.approvalStatus === "pending") {
                payments.pending.push(paymentRecord);
              } else if (data.approvalStatus === "approved") {
                payments.approved.push(paymentRecord);
              }
            }
          }
        } catch (e) {
          // Document might not exist for this year, that's okay
        }
      }
    }

    // Load monthly contributions - check current year and previous/next year to catch all payments
    const yearsToCheck = [currentYear - 1, currentYear, currentYear + 1];
    
    for (const member of members) {
      for (const year of yearsToCheck) {
        try {
          const monthlyRef = collection(db, `groups/${selectedGroupId}/payments/${year}_MonthlyContributions/${member.id}`);
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
              year: data.year || year,
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
              isAdvancedPayment: data.isAdvancedPayment || false,
            };
            // Only add if not already added (avoid duplicates across years)
            if (!payments.monthly.find(p => p.id === paymentRecord.id)) {
              payments.monthly.push(paymentRecord);
              if (data.approvalStatus === "pending") {
                payments.pending.push(paymentRecord);
              } else if (data.approvalStatus === "approved") {
                payments.approved.push(paymentRecord);
              }
            }
          });
        } catch (e) {
          // Collection might not exist for this year, that's okay
        }
      }
    }

    // Load service fee payments - check current year and adjacent years
    const serviceFeeYearsToCheck = [currentYear - 1, currentYear, currentYear + 1];
    
    for (const member of members) {
      for (const year of serviceFeeYearsToCheck) {
        try {
          const serviceFeeRef = doc(db, `groups/${selectedGroupId}/payments/${year}_ServiceFee/${member.id}/PaymentDetails`);
          const serviceFeeDoc = await getDoc(serviceFeeRef);
          if (serviceFeeDoc.exists()) {
            const data = serviceFeeDoc.data();
            const paymentRecord = {
              id: `serviceFee_${member.id}_${year}`,
              memberId: member.id,
              memberName: member.fullName || "Unknown",
              type: "Service Fee",
              year: year,
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
              isAdvancedPayment: data.isAdvancedPayment || false,
              perCycle: data.perCycle || true,
              nonRefundable: data.nonRefundable || true,
            };
            // Only add if not already added (avoid duplicates)
            if (!payments.serviceFee.find(p => p.id === paymentRecord.id)) {
              payments.serviceFee.push(paymentRecord);
              if (data.approvalStatus === "pending") {
                payments.pending.push(paymentRecord);
              } else if (data.approvalStatus === "approved") {
                payments.approved.push(paymentRecord);
              }
            }
          }
        } catch (e) {
          // Document might not exist for this year, that's okay
        }
      }
    }

    // Update stats
    updateStats();

    // Check for tab query parameter and switch to that tab
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    
    // Render payments by active tab (use query parameter if available, otherwise use active tab)
    if (tabParam && window.switchToTab) {
      // Switch to the tab specified in query parameter
      window.switchToTab(tabParam);
    } else {
      const activeTab = document.querySelector(".payment-tab.active")?.dataset.tab || "pending";
      renderPaymentsByTab(activeTab);
    }
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

  [...payments.seedMoney, ...payments.monthly, ...payments.serviceFee].forEach((payment) => {
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

  const allPayments = [...payments.seedMoney, ...payments.monthly, ...payments.serviceFee]
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

// Open Approve Payment Modal
async function openApprovePaymentModal(payment) {
  if (!payment) return;
  
  const modal = document.getElementById("approvePaymentModal");
  const memberNameInput = document.getElementById("approvePaymentMemberName");
  const paymentTypeInput = document.getElementById("approvePaymentType");
  const paymentAmountDiv = document.getElementById("approvePaymentAmount");
  const paymentTotalAmountDiv = document.getElementById("approvePaymentTotalAmount");
  const paymentArrearsDiv = document.getElementById("approvePaymentArrears");
  const paymentStatusDiv = document.getElementById("approvePaymentStatus");
  const paymentIdInput = document.getElementById("approvePaymentId");
  
  if (!modal || !paymentIdInput) return;
  
  // Populate form fields with better visibility
  if (paymentIdInput) paymentIdInput.value = payment.id;
  if (memberNameInput) memberNameInput.value = payment.memberName || "Unknown Member";
  if (paymentTypeInput) paymentTypeInput.value = payment.type + (payment.month ? ` - ${payment.month} ${payment.year}` : "");
  
  // Display amounts with better visibility
  const totalAmount = parseFloat(payment.totalAmount || 0);
  const amountPaid = parseFloat(payment.amountPaid || 0);
  const arrears = parseFloat(payment.arrears || 0);
  
  if (paymentTotalAmountDiv) {
    paymentTotalAmountDiv.textContent = formatCurrency(totalAmount);
    paymentTotalAmountDiv.style.fontSize = "var(--bn-text-xl)";
    paymentTotalAmountDiv.style.fontWeight = "700";
    paymentTotalAmountDiv.style.color = "var(--bn-dark)";
  }
  
  if (paymentAmountDiv) {
    paymentAmountDiv.textContent = formatCurrency(amountPaid);
    paymentAmountDiv.style.fontSize = "var(--bn-text-xl)";
    paymentAmountDiv.style.fontWeight = "700";
    paymentAmountDiv.style.color = "var(--bn-success)";
  }
  
  if (paymentArrearsDiv) {
    paymentArrearsDiv.textContent = formatCurrency(arrears);
    paymentArrearsDiv.style.fontSize = "var(--bn-text-xl)";
    paymentArrearsDiv.style.fontWeight = "700";
    paymentArrearsDiv.style.color = arrears > 0 ? "var(--bn-danger)" : "var(--bn-success)";
  }
  
  if (paymentStatusDiv) {
    const status = payment.status || "pending";
    paymentStatusDiv.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    paymentStatusDiv.style.color = status === "approved" ? "var(--bn-success)" : 
                                   status === "pending" ? "var(--bn-warning)" : "var(--bn-danger)";
  }
  
  // Reset form
  const form = document.getElementById("approvePaymentForm");
  if (form) {
    const notesInput = document.getElementById("approvePaymentNotes");
    const popInput = document.getElementById("approvePaymentPOP");
    if (notesInput) notesInput.value = "";
    if (popInput) popInput.value = "";
  }
  
  // Open modal
  if (window.openModal) {
    window.openModal("approvePaymentModal");
  } else {
    modal.classList.remove("hidden");
    modal.style.display = "flex";
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
  
  let html = '<div style="display: flex; flex-direction: column; gap: var(--bn-space-4);">';
  
  payments.pending.forEach((payment) => {
    const timestamp = formatTimestamp(payment.updatedAt || payment.createdAt);
    const totalAmount = parseFloat(payment.totalAmount || 0);
    const amountPaid = parseFloat(payment.amountPaid || 0);
    const arrears = parseFloat(payment.arrears || 0);
    
    html += `
      <div style="padding: var(--bn-space-5); background: var(--bn-white); border: 1px solid var(--bn-gray-lighter); border-radius: var(--bn-radius-xl); border-left: 4px solid var(--bn-warning);">
        <div style="display: flex; align-items: flex-start; gap: var(--bn-space-4); margin-bottom: var(--bn-space-4);">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: var(--bn-space-3); margin-bottom: var(--bn-space-3); flex-wrap: wrap;">
              <strong style="font-size: var(--bn-text-lg); color: var(--bn-dark);">${payment.memberName}</strong>
              <span class="badge badge-warning">Pending</span>
            </div>
            <div style="font-size: var(--bn-text-sm); color: var(--bn-gray); margin-bottom: var(--bn-space-3); display: flex; align-items: center; gap: var(--bn-space-2); flex-wrap: wrap;">
              <span>${payment.type}${payment.month ? ` - ${payment.month} ${payment.year}` : ""}</span>
              ${payment.isAdvancedPayment ? '<span style="font-size: var(--bn-text-xs); padding: 2px 8px; background: var(--bn-info-light); color: var(--bn-info); border-radius: var(--bn-radius-sm); font-weight: 600;">Advanced Payment</span>' : ''}
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--bn-space-3); margin-bottom: var(--bn-space-3);">
              <div style="padding: var(--bn-space-3); background: var(--bn-gray-50); border-radius: var(--bn-radius-md);">
                <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-1);">Total Due</div>
                <div style="font-size: var(--bn-text-xl); font-weight: 700; color: var(--bn-dark);">${formatCurrency(totalAmount)}</div>
              </div>
              <div style="padding: var(--bn-space-3); background: var(--bn-success-light); border-radius: var(--bn-radius-md);">
                <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-1);">Amount Paid</div>
                <div style="font-size: var(--bn-text-xl); font-weight: 700; color: var(--bn-success);">${formatCurrency(amountPaid)}</div>
              </div>
              <div style="padding: var(--bn-space-3); background: var(--bn-danger-light); border-radius: var(--bn-radius-md);">
                <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-1);">Remaining</div>
                <div style="font-size: var(--bn-text-xl); font-weight: 700; color: var(--bn-danger);">${formatCurrency(arrears)}</div>
              </div>
            </div>
            
            <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); padding-top: var(--bn-space-2); border-top: 1px solid var(--bn-gray-lighter);">
              Submitted: ${timestamp}
            </div>
          </div>
        </div>
        <div style="display: flex; gap: var(--bn-space-2); flex-wrap: wrap; padding-top: var(--bn-space-3); border-top: 1px solid var(--bn-gray-lighter);">
          <button class="btn btn-accent btn-sm" data-action="approve" data-payment-id="${payment.id}">✓ Approve</button>
          <button class="btn btn-ghost btn-sm" data-action="approve-with-pop" data-payment-id="${payment.id}">📤 Approve & Upload POP</button>
          <button class="btn btn-danger btn-sm" data-action="reject" data-payment-id="${payment.id}">✕ Reject</button>
          <button class="btn btn-ghost btn-sm" data-action="delete" data-payment-id="${payment.id}" data-payment-type="${payment.type}" data-member-id="${payment.memberId}" data-doc-id="${payment.docId || ''}" title="Delete">🗑️ Delete</button>
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
  
  let html = '<div style="display: flex; flex-direction: column; gap: var(--bn-space-4);">';
  
  payments.approved
    .sort((a, b) => {
      const dateA = a.approvedAt?.toDate ? a.approvedAt.toDate() : new Date(0);
      const dateB = b.approvedAt?.toDate ? b.approvedAt.toDate() : new Date(0);
      return dateB - dateA;
    })
    .forEach((payment) => {
      const approvedTimestamp = formatTimestamp(payment.approvedAt || payment.updatedAt);
      const paidTimestamp = formatTimestamp(payment.paidAt || payment.updatedAt);
      const totalAmount = parseFloat(payment.totalAmount || 0);
      const amountPaid = parseFloat(payment.amountPaid || 0);
      const arrears = parseFloat(payment.arrears || 0);
      
      html += `
        <div style="padding: var(--bn-space-5); background: var(--bn-white); border: 1px solid var(--bn-gray-lighter); border-radius: var(--bn-radius-xl); border-left: 4px solid var(--bn-success);">
          <div style="display: flex; align-items: flex-start; gap: var(--bn-space-4); margin-bottom: var(--bn-space-4);">
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: var(--bn-space-3); margin-bottom: var(--bn-space-3); flex-wrap: wrap;">
                <strong style="font-size: var(--bn-text-lg); color: var(--bn-dark);">${payment.memberName}</strong>
                <span class="badge badge-success">Approved</span>
              </div>
              <div style="font-size: var(--bn-text-sm); color: var(--bn-gray); margin-bottom: var(--bn-space-3);">
                ${payment.type}${payment.month ? ` - ${payment.month} ${payment.year}` : ""}
              </div>
              
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--bn-space-3); margin-bottom: var(--bn-space-3);">
                <div style="padding: var(--bn-space-3); background: var(--bn-gray-50); border-radius: var(--bn-radius-md);">
                  <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-1);">Total Due</div>
                  <div style="font-size: var(--bn-text-xl); font-weight: 700; color: var(--bn-dark);">${formatCurrency(totalAmount)}</div>
                </div>
                <div style="padding: var(--bn-space-3); background: var(--bn-success-light); border-radius: var(--bn-radius-md);">
                  <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-1);">Amount Paid</div>
                  <div style="font-size: var(--bn-text-xl); font-weight: 700; color: var(--bn-success);">${formatCurrency(amountPaid)}</div>
                </div>
                ${arrears > 0 ? `
                <div style="padding: var(--bn-space-3); background: var(--bn-danger-light); border-radius: var(--bn-radius-md);">
                  <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-1);">Remaining</div>
                  <div style="font-size: var(--bn-text-xl); font-weight: 700; color: var(--bn-danger);">${formatCurrency(arrears)}</div>
                </div>
                ` : ''}
              </div>
              
              <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); padding-top: var(--bn-space-2); border-top: 1px solid var(--bn-gray-lighter);">
                Paid: ${paidTimestamp} | Approved: ${approvedTimestamp}
              </div>
            </div>
          </div>
          <div style="display: flex; gap: var(--bn-space-2); flex-wrap: wrap; padding-top: var(--bn-space-3); border-top: 1px solid var(--bn-gray-lighter);">
            ${payment.proofOfPayment?.imageUrl ? `
              <a href="${payment.proofOfPayment.imageUrl}" target="_blank" class="btn btn-ghost btn-sm">📄 View Proof</a>
            ` : ''}
            <button class="btn btn-danger btn-sm" data-action="delete" data-payment-id="${payment.id}" data-payment-type="${payment.type}" data-member-id="${payment.memberId}" data-doc-id="${payment.docId || ''}" title="Delete">🗑️ Delete</button>
          </div>
        </div>
      `;
    });
  
  html += '</div>';
  return html;
}

// Render collected payments details
async function renderCollectedDetails() {
  const collectedPayments = [...payments.seedMoney, ...payments.monthly, ...payments.serviceFee]
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
  const arrearsMembers = [...payments.seedMoney, ...payments.monthly, ...payments.serviceFee]
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
          totalAmount: payment.totalAmount,
          amountPaid: payment.amountPaid,
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
            totalAmount: payment.totalAmount,
            amountPaid: payment.amountPaid,
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
      <div style="padding: var(--bn-space-5); background: var(--bn-white); border: 1px solid var(--bn-gray-lighter); border-radius: var(--bn-radius-xl); border-left: 4px solid var(--bn-danger);">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: var(--bn-space-4); flex-wrap: wrap; gap: var(--bn-space-3);">
          <div style="flex: 1;">
            <strong style="font-size: var(--bn-text-lg); color: var(--bn-dark); display: block; margin-bottom: var(--bn-space-2);">${member.memberName}</strong>
            <div style="padding: var(--bn-space-3); background: var(--bn-danger-light); border-radius: var(--bn-radius-md); display: inline-block;">
              <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-1);">Total Arrears</div>
              <div style="font-size: var(--bn-text-2xl); font-weight: 700; color: var(--bn-danger);">${formatCurrency(member.totalArrears)}</div>
            </div>
          </div>
          <button class="btn btn-accent btn-sm" data-action="record-payment" data-member-id="${member.memberId}">💰 Record Payment</button>
        </div>
        <div style="margin-top: var(--bn-space-4); padding-top: var(--bn-space-4); border-top: 1px solid var(--bn-gray-lighter);">
          <div style="font-size: var(--bn-text-xs); font-weight: 600; color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-3);">Payment Breakdown:</div>
          <div style="display: flex; flex-direction: column; gap: var(--bn-space-3);">
    `;
    
    member.breakdown.forEach((item) => {
      const totalAmount = parseFloat(item.totalAmount || 0);
      const amountPaid = parseFloat(item.amountPaid || 0);
      const arrears = parseFloat(item.arrears || 0);
      
      html += `
        <div style="padding: var(--bn-space-4); background: var(--bn-gray-50); border-radius: var(--bn-radius-lg); border: 1px solid var(--bn-gray-lighter);">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: var(--bn-space-3); margin-bottom: var(--bn-space-3);">
            <div style="flex: 1;">
              <div style="font-weight: 600; color: var(--bn-dark); margin-bottom: var(--bn-space-2); font-size: var(--bn-text-base);">
                ${item.type}${item.month ? ` - ${item.month} ${item.year}` : ""}
              </div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--bn-space-2);">
                <div>
                  <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-bottom: 2px;">Total Due</div>
                  <div style="font-size: var(--bn-text-base); font-weight: 700; color: var(--bn-dark);">${formatCurrency(totalAmount)}</div>
                </div>
                <div>
                  <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-bottom: 2px;">Amount Paid</div>
                  <div style="font-size: var(--bn-text-base); font-weight: 700; color: var(--bn-success);">${formatCurrency(amountPaid)}</div>
                </div>
                <div>
                  <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-bottom: 2px;">Arrears</div>
                  <div style="font-size: var(--bn-text-base); font-weight: 700; color: var(--bn-danger);">${formatCurrency(arrears)}</div>
                </div>
              </div>
            </div>
          </div>
          <div style="display: flex; gap: var(--bn-space-2); flex-wrap: wrap; padding-top: var(--bn-space-3); border-top: 1px solid var(--bn-gray-lighter);">
            <button class="btn btn-accent btn-sm" data-action="record-payment-item" data-payment-id="${item.paymentId}" data-member-id="${member.memberId}">Pay Now</button>
            <button class="btn btn-ghost btn-sm" data-action="delete-payment" data-payment-id="${item.paymentId}" data-payment-type="${item.type}" data-member-id="${member.memberId}" data-doc-id="${item.docId || ''}" title="Delete Payment">🗑️ Delete</button>
          </div>
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
  modalContent.querySelectorAll("[data-action='record-payment'], [data-action='record-payment-item']").forEach((btn) => {
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
      
      // First, try to get from already loaded payments (more accurate)
      const existingPayment = payments.monthly.find(p => 
        p.memberId === memberId && 
        p.month === monthName && 
        parseInt(p.year) === parseInt(year)
      );
      
      if (existingPayment) {
        // Recalculate arrears from loaded payment data for accuracy
        const totalAmount = parseFloat(existingPayment.totalAmount || 0);
        const amountPaid = parseFloat(existingPayment.amountPaid || 0);
        const storedArrears = parseFloat(existingPayment.arrears || 0);
        
        // Calculate what should be due: total - paid
        const calculatedArrears = Math.max(0, totalAmount - amountPaid);
        
        // Use the larger of stored arrears or calculated arrears to ensure we don't miss any
        // This handles cases where arrears might not have been updated correctly
        amountDue = Math.max(storedArrears, calculatedArrears);
        
        // If both are 0 but total > 0 and paid < total, use calculated
        if (amountDue <= 0 && totalAmount > 0 && amountPaid < totalAmount) {
          amountDue = totalAmount - amountPaid;
        }
      } else {
        // Fallback to database if not in loaded payments
        try {
          // Try different possible document ID formats
          const possibleDocIds = [
            monthName,  // Just the month name
            `${year}_${monthName}`,  // Year_Month format
            `${year}-${monthName}`   // Year-Month format
          ];
          
          let monthlyData = null;
          for (const docId of possibleDocIds) {
            try {
              const monthlyRef = doc(db, `groups/${selectedGroupId}/payments/${year}_MonthlyContributions/${memberId}/${docId}`);
              const monthlyDoc = await getDoc(monthlyRef);
              
              if (monthlyDoc.exists()) {
                monthlyData = monthlyDoc.data();
                break;
              }
            } catch (e) {
              // Try next format
              continue;
            }
          }
          
          if (monthlyData) {
            const totalAmount = parseFloat(monthlyData.totalAmount || 0);
            
            // For arrears calculation, only count approved payments
            // Check if there's a 'paid' array (from user uploads) or use amountPaid
            let approvedAmountPaid = 0;
            
            if (monthlyData.paid && Array.isArray(monthlyData.paid)) {
              // Calculate from approved payments only
              approvedAmountPaid = monthlyData.paid
                .filter(p => p.approvalStatus === "approved")
                .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
            } else {
              // Use amountPaid if approvalStatus is approved, otherwise calculate from approved payments
              if (monthlyData.approvalStatus === "approved") {
                approvedAmountPaid = parseFloat(monthlyData.amountPaid || 0);
              } else {
                approvedAmountPaid = 0;
              }
            }
            
            // Calculate arrears as total - approved payments
            amountDue = Math.max(0, totalAmount - approvedAmountPaid);
          } else {
            // No record exists, use group default
            amountDue = parseFloat(groupData?.rules?.monthlyContribution?.amount || groupData?.monthlyContribution || 0);
          }
        } catch (error) {
          console.error("Error fetching monthly contribution:", error);
          // Fallback to group default
          amountDue = parseFloat(groupData?.rules?.monthlyContribution?.amount || groupData?.monthlyContribution || 0);
        }
      }
    } else if (paymentType === "service_fee") {
      // Get service fee arrears
      const serviceFeeRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_ServiceFee/${memberId}/PaymentDetails`);
      const serviceFeeDoc = await getDoc(serviceFeeRef);
      
      if (serviceFeeDoc.exists()) {
        const serviceFeeData = serviceFeeDoc.data();
        amountDue = parseFloat(serviceFeeData.arrears || 0);
      } else {
        // No record exists, use group default
        amountDue = parseFloat(groupData?.rules?.serviceFee?.amount || 0);
      }
    } else {
      showToast("Please select payment type" + (paymentType === "monthly_contribution" ? " and month" : ""), "warning");
      return;
    }
    
    if (amountDue <= 0) {
      showToast("No amount due for this payment type", "info");
      return;
    }
    
    // Store base amount for interest calculation
    amountInput.dataset.baseAmount = amountDue.toString();
    
    // Set the value and ensure it's valid (round to 2 decimal places to match step)
    const roundedAmount = Math.round(amountDue * 100) / 100;
    amountInput.value = roundedAmount.toFixed(2);
    
    // Trigger input event to update validation
    amountInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Remove any validation error styling
    amountInput.setCustomValidity('');
    amountInput.reportValidity();
    
    // If interest checkbox is checked, recalculate
    const interestCheckbox = document.getElementById("applyInterestCheckbox");
    if (interestCheckbox?.checked) {
      calculateInterest();
    }
    
    showToast(`Amount auto-filled: ${formatCurrency(roundedAmount)}`, "success");
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
    } else if (paymentType === "service_fee") {
      const serviceFeeDueDate = groupData?.rules?.serviceFee?.dueDate || groupData?.seedMoneyDueDate;
      if (serviceFeeDueDate) {
        dueDate = serviceFeeDueDate?.toDate ? serviceFeeDueDate.toDate() : new Date(serviceFeeDueDate);
      }
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
      const roundedTotal = Math.round(totalAmount * 100) / 100;
      amountInput.value = roundedTotal.toFixed(2);
      amountInput.dataset.interestAmount = interestAmount.toString();
      
      // Clear any validation errors
      amountInput.setCustomValidity('');
      amountInput.reportValidity();
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
    const roundedAmount = Math.round(baseAmount * 100) / 100;
    amountInput.value = roundedAmount.toFixed(2);
    
    // Clear any validation errors
    amountInput.setCustomValidity('');
    amountInput.reportValidity();
  }
}

// Clear POP upload
window.clearPOPUpload = function() {
  const fileInput = document.getElementById("recordPaymentPOP");
  const preview = document.getElementById("recordPaymentPOPPreview");
  
  if (fileInput) fileInput.value = "";
  if (preview) preview.style.display = "none";
};

// Open Record Payment Modal
// Update payment type options based on selected member's payment status
async function updatePaymentTypeOptions() {
  const memberSelect = document.getElementById("memberSelect");
  const paymentTypeSelect = document.getElementById("paymentType");
  
  if (!memberSelect || !paymentTypeSelect || !selectedGroupId) return;
  
  const memberId = memberSelect.value;
  if (!memberId) {
    // Reset to default options when no member selected
    paymentTypeSelect.innerHTML = `
      <option value="seed_money">Seed Money</option>
      <option value="monthly_contribution">Monthly Contribution</option>
    `;
    return;
  }
  
  try {
    const currentYear = new Date().getFullYear();
    const seedRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_SeedMoney/${memberId}/PaymentDetails`);
    const seedDoc = await getDoc(seedRef);
    
    let seedMoneyOption = '<option value="seed_money">Seed Money</option>';
    let serviceFeeOption = '';
    
    // Check seed money status
    if (seedDoc.exists()) {
      const seedData = seedDoc.data();
      const amountPaid = parseFloat(seedData.amountPaid || 0);
      const totalAmount = parseFloat(seedData.totalAmount || 0);
      const arrears = parseFloat(seedData.arrears || 0);
      
      // If fully paid or no outstanding balance
      if (arrears <= 0 || amountPaid >= totalAmount) {
        seedMoneyOption = '<option value="seed_money" disabled>Seed Money (Paid in Full ✓)</option>';
      }
    } else {
      // Check if member exists and should have seed money
      const member = members.find(m => m.id === memberId);
      if (member) {
        // New member - they should have seed money payment available
        seedMoneyOption = '<option value="seed_money">Seed Money</option>';
      }
    }
    
    // Check service fee status (if enabled in group)
    const serviceFeeRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_ServiceFee/${memberId}/PaymentDetails`);
    const serviceFeeDoc = await getDoc(serviceFeeRef);
    
    if (serviceFeeDoc.exists()) {
      const serviceFeeData = serviceFeeDoc.data();
      const amountPaid = parseFloat(serviceFeeData.amountPaid || 0);
      const totalAmount = parseFloat(serviceFeeData.totalAmount || 0);
      const arrears = parseFloat(serviceFeeData.arrears || 0);
      
      if (arrears <= 0 || amountPaid >= totalAmount) {
        serviceFeeOption = '<option value="service_fee" disabled>Service Fee (Paid in Full ✓)</option>';
      } else {
        serviceFeeOption = '<option value="service_fee">Service Fee</option>';
      }
    } else {
      // Check if group has service fee enabled
      if (groupData?.rules?.serviceFee?.amount > 0) {
        serviceFeeOption = '<option value="service_fee">Service Fee</option>';
      }
    }
    
    paymentTypeSelect.innerHTML = `
      ${seedMoneyOption}
      <option value="monthly_contribution">Monthly Contribution</option>
      ${serviceFeeOption}
    `;
  } catch (error) {
    console.error("Error updating payment type options:", error);
    // On error, show default options
    paymentTypeSelect.innerHTML = `
      <option value="seed_money">Seed Money</option>
      <option value="monthly_contribution">Monthly Contribution</option>
    `;
  }
}

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
      // Update payment type options for pre-selected member
      await updatePaymentTypeOptions();
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
    
    // Initialize Advanced Payment checkbox visibility based on payment type
    // Hide for Seed Money and Service Fee (only show for Monthly Contribution)
    const advancedPaymentGroup = document.getElementById("isAdvancedPayment")?.parentElement?.parentElement;
    const paymentTypeSelect = document.getElementById("paymentType");
    if (advancedPaymentGroup && paymentTypeSelect) {
      const defaultPaymentType = paymentTypeSelect.value;
      if (defaultPaymentType === "seed_money" || defaultPaymentType === "service_fee") {
        advancedPaymentGroup.style.display = "none";
        const checkbox = document.getElementById("isAdvancedPayment");
        if (checkbox) checkbox.checked = false;
      } else {
        advancedPaymentGroup.style.display = "block";
      }
    }
    
    // Clear POP upload
    clearPOPUpload();
    
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
  const popInput = document.getElementById("recordPaymentPOP");
  // Advanced payments are only allowed for monthly contributions, not for seed money or service fee
  let isAdvancedPayment = false;
  if (paymentType === "monthly_contribution") {
    isAdvancedPayment = document.getElementById("isAdvancedPayment")?.checked || false;
  }
  
  if (!memberId || !paymentType || !amount || !paymentDate) {
    showToast("Please fill in all required fields", "warning");
    return;
  }
  
  showSpinner(true);
  
  // Upload POP file if provided (do this first, before recording payment)
  let popMetadata = null;
  
  if (popInput && popInput.files && popInput.files.length > 0) {
    try {
      const popFile = popInput.files[0];
      const fileSizeMB = popFile.size / 1024 / 1024;
      
      // Validate file size (max 10MB)
      if (fileSizeMB > 10) {
        showToast("File size must be less than 10MB", "warning");
        showSpinner(false);
        return;
      }
      
      // Upload to Firebase Storage
      const fileName = `payment-proofs/${selectedGroupId}/${memberId}/${Date.now()}_${popFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const storageRef = ref(storage, fileName);
      await uploadBytes(storageRef, popFile);
      const popUrl = await getDownloadURL(storageRef);
      const nowTimestamp = Timestamp.now();
      
      // Create POP metadata with all timestamps
      popMetadata = {
        imageUrl: popUrl,
        fileName: popFile.name,
        fileSize: popFile.size,
        fileSizeMB: parseFloat(fileSizeMB.toFixed(2)),
        fileType: popFile.type,
        uploadedBy: currentUser.uid,
        uploadedAt: nowTimestamp,
        verifiedBy: currentUser.uid,
        verifiedAt: nowTimestamp,
        storagePath: fileName,
        linkedToPayment: true,
        paymentType: paymentType,
        paymentAmount: amount,
        paymentDate: Timestamp.fromDate(new Date(paymentDate))
      };
      
    } catch (error) {
      console.error("Error uploading POP:", error);
      showToast("Failed to upload POP file. Payment will be recorded without POP.", "warning");
      // Continue with payment recording even if POP upload fails
    }
  }
  
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
      // If fully paid, set status to "completed"
      const paymentStatus = newArrears <= 0 ? "completed" : "approved";
      
      const paidAtTimestamp = Timestamp.fromDate(new Date(paymentDate));
      const nowTimestamp = Timestamp.now();
      
      const paymentMethod = document.getElementById("paymentMethod")?.value || "cash";
      
      const updateData = {
        amountPaid: newAmountPaid,
        arrears: newArrears,
        approvalStatus: paymentStatus,
        paymentStatus: paymentStatus,
        approvedBy: currentUser.uid,
        approvedAt: nowTimestamp,
        paidAt: paidAtTimestamp,
        notes: notes || null,
        paymentMethod: paymentMethod,
        recordedManually: true,
        isAdvancedPayment: false, // Seed money cannot be advanced payments
        updatedAt: nowTimestamp
      };
      
      // Add POP metadata if uploaded
      if (popMetadata) {
        updateData.proofOfPayment = popMetadata;
      }
      
      if (seedDoc.exists()) {
        await updateDoc(seedRef, updateData);
      } else {
        // Document doesn't exist, create it using setDoc
        await setDoc(seedRef, {
          totalAmount: existingData.totalAmount,
          ...updateData,
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
      
      const paymentMethod = document.getElementById("paymentMethod")?.value || "cash";
      
      if (monthlyDoc.exists()) {
        const existingData = monthlyDoc.data();
        const newAmountPaid = (existingData.amountPaid || 0) + amount;
        const newArrears = Math.max(0, (existingData.totalAmount || 0) - newAmountPaid);
        // If fully paid, set status to "completed"
        const paymentStatus = newArrears <= 0 ? "completed" : "approved";
        
        const updateData = {
          amountPaid: newAmountPaid,
          arrears: newArrears,
          approvalStatus: paymentStatus,
          paymentStatus: paymentStatus,
          approvedBy: currentUser.uid,
          approvedAt: nowTimestamp,
          paidAt: paidAtTimestamp,
          notes: notes || null,
          paymentMethod: paymentMethod,
          recordedManually: true,
          isAdvancedPayment: isAdvancedPayment,
          updatedAt: nowTimestamp
        };
        
        // Add POP metadata if uploaded
        if (popMetadata) {
          updateData.proofOfPayment = popMetadata;
        }
        
        await updateDoc(monthlyRef, updateData);
      } else {
        // Create new record using setDoc
        const totalAmount = groupData?.monthlyContribution || 0;
        
        const initialArrears = Math.max(0, totalAmount - amount);
        const paymentStatus = initialArrears <= 0 ? "completed" : "approved";
        
        const newData = {
          memberId,
          memberName,
          type: "monthly_contribution",
          month: monthName,
          year: parseInt(year),
          totalAmount: totalAmount,
          amountPaid: amount,
          arrears: initialArrears,
          approvalStatus: paymentStatus,
          paymentStatus: paymentStatus,
          approvedBy: currentUser.uid,
          approvedAt: nowTimestamp,
          paidAt: paidAtTimestamp,
          notes: notes || null,
          paymentMethod: paymentMethod,
          recordedManually: true,
          isAdvancedPayment: isAdvancedPayment,
          updatedAt: nowTimestamp,
          createdAt: nowTimestamp
        };
        
        // Add POP metadata if uploaded
        if (popMetadata) {
          newData.proofOfPayment = popMetadata;
        }
        
        await setDoc(monthlyRef, newData);
      }
    } else if (paymentType === "service_fee") {
      // Update service fee record
      const serviceFeeRef = doc(db, `groups/${selectedGroupId}/payments/${currentYear}_ServiceFee/${memberId}/PaymentDetails`);
      const serviceFeeDoc = await getDoc(serviceFeeRef);
      
      const existingData = serviceFeeDoc.exists() ? serviceFeeDoc.data() : {
        totalAmount: groupData?.rules?.serviceFee?.amount || 0,
        amountPaid: 0,
        arrears: groupData?.rules?.serviceFee?.amount || 0
      };
      
      const newAmountPaid = (existingData.amountPaid || 0) + amount;
      const newArrears = Math.max(0, (existingData.totalAmount || 0) - newAmountPaid);
      // If fully paid, set status to "completed"
      const paymentStatus = newArrears <= 0 ? "completed" : "approved";
      
      const paidAtTimestamp = Timestamp.fromDate(new Date(paymentDate));
      const nowTimestamp = Timestamp.now();
      
      const paymentMethod = document.getElementById("paymentMethod")?.value || "cash";
      
      const updateData = {
        amountPaid: newAmountPaid,
        arrears: newArrears,
        approvalStatus: paymentStatus,
        paymentStatus: paymentStatus,
        approvedBy: currentUser.uid,
        approvedAt: nowTimestamp,
        paidAt: paidAtTimestamp,
        notes: notes || null,
        paymentMethod: paymentMethod,
        recordedManually: true,
        isAdvancedPayment: false, // Service fee cannot be advanced payments
        perCycle: true,
        nonRefundable: true,
        updatedAt: nowTimestamp
      };
      
      // Add POP metadata if uploaded
      if (popMetadata) {
        updateData.proofOfPayment = popMetadata;
      }
      
      if (serviceFeeDoc.exists()) {
        await updateDoc(serviceFeeRef, updateData);
      } else {
        // Document doesn't exist, create it using setDoc
        await setDoc(serviceFeeRef, {
          userId: memberId,
          fullName: memberName,
          paymentType: "Service Fee",
          totalAmount: existingData.totalAmount,
          ...updateData,
          createdAt: nowTimestamp,
          currency: "MWK",
          description: "Operational service fee (bank charges, etc.)"
        });
      }
    } else {
      // Other payment types - add to payments collection
      const otherPaymentData = {
        memberId,
        memberName,
        type: paymentType,
        amount,
        paymentDate: Timestamp.fromDate(new Date(paymentDate)),
        status: "approved",
        approvedAt: Timestamp.now(),
        approvedBy: currentUser.uid,
        notes: notes || null,
        paymentMethod: document.getElementById("paymentMethod")?.value || "cash",
        recordedManually: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };
      
      // Add POP metadata if uploaded
      if (popMetadata) {
        otherPaymentData.proofOfPayment = popMetadata;
      }
      
      await addDoc(collection(db, `groups/${selectedGroupId}/payments`), otherPaymentData);
    }
    
    // Get interest amount if applied
    const amountInput = document.getElementById("paymentAmount");
    const interestAmount = parseFloat(amountInput?.dataset.interestAmount || 0);
    const applyInterest = document.getElementById("applyInterestCheckbox")?.checked || false;
    
    // Determine payment reference ID
    let paymentRefId = "";
    if (paymentType === "seed_money") {
      paymentRefId = `seed_${memberId}_${currentYear}`;
    } else if (paymentType === "monthly_contribution" && paymentMonth) {
      const [year, month] = paymentMonth.split('-');
      const monthNames = ["January", "February", "March", "April", "May", "June", 
                          "July", "August", "September", "October", "November", "December"];
      const monthName = monthNames[parseInt(month) - 1];
      paymentRefId = `monthly_${memberId}_${monthName}_${year}`;
    } else if (paymentType === "service_fee") {
      paymentRefId = `serviceFee_${memberId}_${currentYear}`;
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
      } else if (paymentType === "service_fee") {
        notificationMessage = `Your service fee payment of ${formatCurrency(amount)} has been recorded by an admin.`;
      }
      
      if (applyInterest && interestAmount > 0) {
        notificationMessage += `\n\nPayment breakdown:\nBase Amount: ${formatCurrency(amount - interestAmount)}\nInterest/Penalty: ${formatCurrency(interestAmount)}\nTotal: ${formatCurrency(amount)}`;
      }
      
      if (notes) {
        notificationMessage += `\n\nNotes: ${notes}`;
      }
      
      if (popMetadata) {
        notificationMessage += `\n\n✓ Proof of Payment uploaded and linked to this payment.`;
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
    clearPOPUpload(); // Clear POP upload preview
    
    // Instant recalculation: Reload payments and update all affected amounts
    await loadPayments();
    
    // Recalculate and update member financial summary again to ensure accuracy
    // Use utility function to ensure consistency and include all payment types (including service fee)
    const memberDocRecalc = await getDoc(memberRef);
    if (memberDocRecalc.exists()) {
      // Import and use the utility function for recalculating financial summary
      const { recalculateMemberFinancialSummary } = await import("./utils_financial.js");
      const recalculatedSummary = await recalculateMemberFinancialSummary(selectedGroupId, memberId);
      
      // Update member financial summary with recalculated values from actual records
      await updateDoc(memberRef, {
        "financialSummary.totalPaid": recalculatedSummary.totalPaid,
        "financialSummary.totalArrears": recalculatedSummary.totalArrears,
        "financialSummary.totalPending": recalculatedSummary.totalPending,
        "financialSummary.totalLoans": recalculatedSummary.totalLoans,
        "financialSummary.totalLoansPaid": recalculatedSummary.totalLoansPaid,
        "financialSummary.totalPenalties": recalculatedSummary.totalPenalties,
        "financialSummary.lastUpdated": recalculatedSummary.lastUpdated,
        updatedAt: Timestamp.now()
      });
    }
    
    // Refresh current tab view - if on arrears tab, refresh it specifically
    const activeTab = document.querySelector(".payment-tab.active")?.dataset.tab || "recent";
    if (activeTab === "arrears") {
      // Store which member's breakdown was open before refreshing
      let openMemberId = null;
      const allBreakdowns = document.querySelectorAll('[id^="arrears-breakdown-"]');
      for (const breakdown of allBreakdowns) {
        const computedStyle = window.getComputedStyle(breakdown);
        if (computedStyle.display !== 'none') {
          openMemberId = breakdown.id.replace('arrears-breakdown-', '');
          break; // Store first open breakdown
        }
      }
      
      // Force refresh of arrears tab to show updated balances
      await renderArrearsTab();
      
      // Re-open the breakdown if it was open before and member still has arrears
      if (openMemberId && document.getElementById(`arrears-breakdown-${openMemberId}`)) {
        toggleArrearsBreakdown(openMemberId);
      }
    } else {
      renderPaymentsByTab(activeTab);
    }
    
    // Update payment type options if modal is still open
    await updatePaymentTypeOptions();
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


// Update filter options when members are loaded
function updateFilterOptions() {
  const filterByMember = document.getElementById("filterByMember");
  if (!filterByMember) return;
  
  filterByMember.innerHTML = '<option value="">All Members</option>';
  members.forEach(member => {
    const name = member.fullName || member.name || member.email || 'Unknown';
    filterByMember.innerHTML += `<option value="${member.id}">${name}</option>`;
  });
}

// Apply filters to current payment list
function applyFilters() {
  const activeTab = document.querySelector(".payment-tab.active")?.dataset.tab || "pending";
  renderPaymentsByTab(activeTab);
}

// Render payments by tab
function renderPaymentsByTab(tab) {
  if (!pendingPaymentsList) return;
  
  // Update title
  const titleMap = {
    pending: "Pending Approvals",
    seed: "Seed Money Payments",
    monthly: "Monthly Contributions",
    arrears: "Arrears Management",
    recent: "Recent Payments"
  };
  const paymentsListTitle = document.getElementById("paymentsListTitle");
  if (paymentsListTitle) {
    paymentsListTitle.textContent = titleMap[tab] || "Payments";
  }
  
  // Show/hide filters (hide for arrears tab as it has its own structure)
  const filtersContainer = document.getElementById("paymentFiltersContainer");
  const monthFilterContainer = document.getElementById("monthFilterContainer");
  const filterByPaymentTypeEl = document.getElementById("filterByPaymentType");
  
  if (filtersContainer) {
    filtersContainer.style.display = (tab === "arrears" || !selectedGroupId) ? "none" : "block";
  }
  
  // Hide payment type filter for monthly and seed tabs (since they're already specific to that payment type)
  if (filterByPaymentTypeEl) {
    const filterByPaymentTypeContainer = filterByPaymentTypeEl.parentElement;
    if (filterByPaymentTypeContainer) {
      filterByPaymentTypeContainer.style.display = (tab === "monthly" || tab === "seed" || tab === "servicefee") ? "none" : "block";
    }
  }
  
  // Show/hide month filter (for monthly and recent tabs)
  if (monthFilterContainer) {
    monthFilterContainer.style.display = ((tab === "monthly" || tab === "recent") && selectedGroupId) ? "block" : "none";
  }
  
  // Show/hide add payment button (show for all tabs except pending where it's always available)
  const addPaymentBtn = document.getElementById("addPaymentInTabBtn");
  if (addPaymentBtn) {
    addPaymentBtn.style.display = selectedGroupId ? "flex" : "none";
  }
  
  // Special handling for arrears tab
  if (tab === "arrears") {
    renderArrearsTab();
    return;
  }
  
  let filteredPayments = [];
  
  switch (tab) {
    case "pending":
      filteredPayments = payments.pending;
      break;
    case "seed":
      // Use special rendering for seed money with cycle grouping
      renderSeedMoneyContributions();
      return;
    case "monthly":
      // Use special rendering for monthly with month grouping
      renderMonthlyContributions();
      return;
    case "servicefee":
      // Use special rendering for service fees
      renderServiceFeeContributions();
      return;
    case "recent":
      // Use special rendering for recent payments with categorization
      renderRecentPaymentsCategorized();
      return;
    default:
      filteredPayments = payments.pending;
  }
  
  // Apply filters from dropdowns
  const filterByMember = document.getElementById("filterByMember");
  // filterByPaymentTypeEl is already declared above at line 3091
  
  if (filterByMember && filterByMember.value) {
    filteredPayments = filteredPayments.filter(p => p.memberId === filterByMember.value);
  }
  
  if (filterByPaymentTypeEl && filterByPaymentTypeEl.value) {
    filteredPayments = filteredPayments.filter(p => p.type === filterByPaymentTypeEl.value);
  }
  
  if (filteredPayments.length === 0) {
    const iconMap = {
      pending: "💳",
      seed: "🌱",
      monthly: "📅",
      arrears: "⚠️",
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

// Render monthly contributions grouped by month with collapsible sections
async function renderMonthlyContributions() {
  if (!pendingPaymentsList) return;
  
  // Get monthly payments
  const monthlyPayments = payments.monthly.filter(p => p.amountPaid > 0 || p.status === "pending");
  
  // Apply member filter if set
  const filterByMember = document.getElementById("filterByMember");
  let filteredPayments = monthlyPayments;
  if (filterByMember && filterByMember.value) {
    filteredPayments = filteredPayments.filter(p => p.memberId === filterByMember.value);
  }
  
  // Get cycle info from group data
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const cycleLength = groupData?.cycleLength || 12;
  const monthlyContributionAmount = parseFloat(groupData?.rules?.monthlyContribution?.amount || groupData?.monthlyContribution || 0);
  
  // Generate months for current cycle
  const monthNames = ["January", "February", "March", "April", "May", "June", 
                     "July", "August", "September", "October", "November", "December"];
  
  // Get all members to calculate expected totals
  const totalMembersCount = members.length;
  
  // Group payments by month
  const paymentsByMonth = {};
  const membersByMonth = {}; // Track which members have payments for each month
  
  filteredPayments.forEach(payment => {
    const month = payment.month || '';
    const year = parseInt(payment.year) || currentYear;
    const monthKey = `${year}_${month}`;
    
    if (!paymentsByMonth[monthKey]) {
      paymentsByMonth[monthKey] = {
        month,
        year,
        payments: []
      };
      membersByMonth[monthKey] = new Set(); // Track unique members who have payments
    }
    
    paymentsByMonth[monthKey].payments.push(payment);
    membersByMonth[monthKey].add(payment.memberId);
  });
  
  // Update month filter dropdown
  const monthFilterContainer = document.getElementById("monthFilterContainer");
  const filterByMonth = document.getElementById("filterByMonth");
  
  if (monthFilterContainer) {
    monthFilterContainer.style.display = "block";
  }
  
  if (filterByMonth) {
    // Get unique months from payments
    const availableMonths = Object.keys(paymentsByMonth)
      .map(key => {
        const data = paymentsByMonth[key];
        return { month: data.month, year: data.year, key };
      })
      .sort((a, b) => {
        // Sort by year and month
        if (a.year !== b.year) return b.year - a.year; // Newest year first
        const monthA = monthNames.indexOf(a.month);
        const monthB = monthNames.indexOf(b.month);
        return monthB - monthA; // Newest month first
      });
    
    filterByMonth.innerHTML = '<option value="">All Months</option>';
    availableMonths.forEach(({ month, year, key }) => {
      const isCurrent = month === monthNames[currentMonth] && year === currentYear;
      filterByMonth.innerHTML += `<option value="${key}" ${isCurrent ? 'selected' : ''}>${month} ${year}</option>`;
    });
    
    // Apply month filter if selected
    const selectedMonthKey = filterByMonth.value;
    if (selectedMonthKey) {
      Object.keys(paymentsByMonth).forEach(key => {
        if (key !== selectedMonthKey) {
          delete paymentsByMonth[key];
        }
      });
    }
  }
  
  // Sort months: current month first, then newest to oldest
  const sortedMonthKeys = Object.keys(paymentsByMonth).sort((a, b) => {
    const dataA = paymentsByMonth[a];
    const dataB = paymentsByMonth[b];
    
    // Current month first
    const isACurrent = dataA.month === monthNames[currentMonth] && dataA.year === currentYear;
    const isBCurrent = dataB.month === monthNames[currentMonth] && dataB.year === currentYear;
    
    if (isACurrent && !isBCurrent) return -1;
    if (!isACurrent && isBCurrent) return 1;
    
    // Then sort by year and month (newest first)
    if (dataA.year !== dataB.year) return dataB.year - dataA.year;
    const monthA = monthNames.indexOf(dataA.month);
    const monthB = monthNames.indexOf(dataB.month);
    return monthB - monthA;
  });
  
  if (sortedMonthKeys.length === 0) {
    pendingPaymentsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📅</div>
        <p class="empty-state-text">No monthly contributions found</p>
      </div>
    `;
    return;
  }
  
  // Render months with collapsible sections
  let html = '';
  
  sortedMonthKeys.forEach((monthKey, index) => {
    const monthData = paymentsByMonth[monthKey];
    const isCurrentMonth = monthData.month === monthNames[currentMonth] && monthData.year === currentYear;
    const isExpanded = index === 0 && isCurrentMonth; // Expand current month by default
    
    // Sort payments within month (pending first, then by date)
    monthData.payments.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      
      const dateA = a.paidAt?.toDate ? a.paidAt.toDate() : 
                   a.approvedAt?.toDate ? a.approvedAt.toDate() : 
                   a.updatedAt?.toDate ? a.updatedAt.toDate() : new Date(0);
      const dateB = b.paidAt?.toDate ? b.paidAt.toDate() : 
                   b.approvedAt?.toDate ? b.approvedAt.toDate() : 
                   b.updatedAt?.toDate ? b.updatedAt.toDate() : new Date(0);
      return dateB - dateA;
    });
    
    // Calculate totals: Expected vs Collected vs Outstanding
    const totalExpected = totalMembersCount * monthlyContributionAmount; // All members should pay
    const totalCollected = monthData.payments.reduce((sum, p) => {
      // Only count approved/completed payments as collected
      if (p.status === 'approved' || p.status === 'completed') {
        return sum + parseFloat(p.amountPaid || 0);
      }
      return sum;
    }, 0);
    
    // Calculate outstanding: members who haven't paid or haven't paid fully
    const membersWithPayments = membersByMonth[monthKey]?.size || 0;
    const membersWithoutPayments = totalMembersCount - membersWithPayments;
    const totalArrearsFromPayments = monthData.payments.reduce((sum, p) => sum + parseFloat(p.arrears || 0), 0);
    
    // Outstanding = (members who haven't paid * monthly amount) + arrears from partial payments
    const outstandingFromUnpaidMembers = membersWithoutPayments * monthlyContributionAmount;
    const totalOutstanding = outstandingFromUnpaidMembers + totalArrearsFromPayments;
    
    const paymentCount = monthData.payments.length;
    
    html += `
      <div style="margin-bottom: var(--bn-space-4); background: var(--bn-white); border: 1px solid var(--bn-gray-lighter); border-radius: var(--bn-radius-lg); overflow: hidden;">
        <button class="month-toggle-btn" onclick="toggleMonthSection('${monthKey}')" style="width: 100%; padding: var(--bn-space-4) var(--bn-space-5); background: ${isCurrentMonth ? 'var(--bn-gray-100)' : 'var(--bn-white)'}; border: none; border-bottom: 1px solid var(--bn-gray-lighter); cursor: pointer; display: flex; align-items: center; justify-content: space-between; text-align: left; transition: background var(--bn-transition-fast);" data-month-key="${monthKey}">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: var(--bn-space-3); margin-bottom: var(--bn-space-1);">
              <span style="font-size: var(--bn-text-lg); font-weight: 700; color: var(--bn-dark);">${monthData.month} ${monthData.year}</span>
              ${isCurrentMonth ? '<span style="font-size: var(--bn-text-xs); padding: 2px 8px; background: var(--bn-accent); color: var(--bn-dark); border-radius: var(--bn-radius-full); font-weight: 600;">Current</span>' : ''}
              <span style="font-size: var(--bn-text-xs); color: var(--bn-gray);">(${paymentCount} ${paymentCount === 1 ? 'payment' : 'payments'})</span>
            </div>
            <div style="display: flex; gap: var(--bn-space-4); font-size: var(--bn-text-sm); color: var(--bn-gray); flex-wrap: wrap;">
              <span>Expected: <strong style="color: var(--bn-dark);">${formatCurrency(totalExpected)}</strong></span>
              <span>Collected: <strong style="color: var(--bn-success);">${formatCurrency(totalCollected)}</strong></span>
              <span>Outstanding: <strong style="color: var(--bn-danger);">${formatCurrency(totalOutstanding)}</strong></span>
              ${membersWithoutPayments > 0 ? `<span style="font-size: var(--bn-text-xs); color: var(--bn-warning);">(${membersWithoutPayments} ${membersWithoutPayments === 1 ? 'member' : 'members'} unpaid)</span>` : ''}
            </div>
          </div>
          <span id="month-toggle-icon-${monthKey}" style="font-size: var(--bn-text-xl); transition: transform var(--bn-transition-fast);">${isExpanded ? '🔽' : '▶️'}</span>
        </button>
        
        <div id="month-content-${monthKey}" style="display: ${isExpanded ? 'block' : 'none'}; padding: var(--bn-space-4); border-top: 1px solid var(--bn-gray-lighter); background: var(--bn-gray-50);">
          ${monthData.payments.map(payment => createPaymentCard(payment, payment.status === "pending")).join('')}
        </div>
      </div>
    `;
  });
  
  pendingPaymentsList.innerHTML = html;
  
  // Add event listeners for action buttons
  pendingPaymentsList.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = e.target.closest("button").dataset.action;
      const paymentId = e.target.closest("button").dataset.paymentId;
      handlePaymentAction(action, paymentId);
    });
  });
  
  // Add event listener for month filter change
  if (filterByMonth) {
    filterByMonth.onchange = () => {
      renderMonthlyContributions();
    };
  }
}

// Render seed money contributions grouped by cycle (year)
async function renderSeedMoneyContributions() {
  if (!pendingPaymentsList) return;
  
  // Get only seed money payments
  const seedMoneyPayments = payments.seedMoney.filter(p => p.amountPaid > 0 || p.status === "pending");
  
  // Apply member filter if set
  const filterByMember = document.getElementById("filterByMember");
  let filteredPayments = seedMoneyPayments;
  if (filterByMember && filterByMember.value) {
    filteredPayments = filteredPayments.filter(p => p.memberId === filterByMember.value);
  }
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const seedMoneyAmount = parseFloat(groupData?.rules?.seedMoney?.amount || groupData?.seedMoneyAmount || 0);
  
  // Group payments by year (cycle)
  const paymentsByCycle = {};
  
  filteredPayments.forEach(payment => {
    const year = parseInt(payment.year) || currentYear;
    const cycleKey = `${year}`;
    
    if (!paymentsByCycle[cycleKey]) {
      paymentsByCycle[cycleKey] = {
        year,
        payments: []
      };
    }
    
    paymentsByCycle[cycleKey].payments.push(payment);
  });
  
  // Sort cycles: current year first, then newest to oldest
  const sortedCycleKeys = Object.keys(paymentsByCycle).sort((a, b) => {
    const yearA = parseInt(a);
    const yearB = parseInt(b);
    const isACurrent = yearA === currentYear;
    const isBCurrent = yearB === currentYear;
    
    if (isACurrent && !isBCurrent) return -1;
    if (!isACurrent && isBCurrent) return 1;
    return yearB - yearA;
  });
  
  if (sortedCycleKeys.length === 0) {
    pendingPaymentsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🌱</div>
        <p class="empty-state-text">No seed money payments found</p>
      </div>
    `;
    return;
  }
  
  // Render cycles with collapsible sections
  let html = '';
  const totalMembersCount = members.length;
  
  sortedCycleKeys.forEach((cycleKey, index) => {
    const cycleData = paymentsByCycle[cycleKey];
    const isCurrentCycle = cycleData.year === currentYear;
    const isExpanded = index === 0 && isCurrentCycle; // Expand current cycle by default
    
    // Sort payments within cycle (pending first, then by date)
    cycleData.payments.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      
      const dateA = a.paidAt?.toDate ? a.paidAt.toDate() : 
                   a.approvedAt?.toDate ? a.approvedAt.toDate() : 
                   a.updatedAt?.toDate ? a.updatedAt.toDate() : new Date(0);
      const dateB = b.paidAt?.toDate ? b.paidAt.toDate() : 
                   b.approvedAt?.toDate ? b.approvedAt.toDate() : 
                   b.updatedAt?.toDate ? b.updatedAt.toDate() : new Date(0);
      return dateB - dateA;
    });
    
    // Calculate totals: Expected vs Collected vs Outstanding
    const totalExpected = totalMembersCount * seedMoneyAmount;
    const totalCollected = cycleData.payments.reduce((sum, p) => {
      if (p.status === 'approved' || p.status === 'completed') {
        return sum + parseFloat(p.amountPaid || 0);
      }
      return sum;
    }, 0);
    
    // Calculate outstanding
    const membersWithPayments = new Set(cycleData.payments.map(p => p.memberId)).size;
    const membersWithoutPayments = totalMembersCount - membersWithPayments;
    const totalArrearsFromPayments = cycleData.payments.reduce((sum, p) => sum + parseFloat(p.arrears || 0), 0);
    const outstandingFromUnpaidMembers = membersWithoutPayments * seedMoneyAmount;
    const totalOutstanding = outstandingFromUnpaidMembers + totalArrearsFromPayments;
    
    const paymentCount = cycleData.payments.length;
    
    html += `
      <div style="margin-bottom: var(--bn-space-4); background: var(--bn-white); border: 1px solid var(--bn-gray-lighter); border-radius: var(--bn-radius-lg); overflow: hidden;">
        <button class="cycle-toggle-btn" onclick="toggleCycleSection('${cycleKey}')" style="width: 100%; padding: var(--bn-space-4) var(--bn-space-5); background: ${isCurrentCycle ? 'var(--bn-gray-100)' : 'var(--bn-white)'}; border: none; border-bottom: 1px solid var(--bn-gray-lighter); cursor: pointer; display: flex; align-items: center; justify-content: space-between; text-align: left; transition: background var(--bn-transition-fast);" data-cycle-key="${cycleKey}">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: var(--bn-space-3); margin-bottom: var(--bn-space-1);">
              <span style="font-size: var(--bn-text-lg); font-weight: 700; color: var(--bn-dark);">Cycle ${cycleData.year}</span>
              ${isCurrentCycle ? '<span style="font-size: var(--bn-text-xs); padding: 2px 8px; background: var(--bn-accent); color: var(--bn-dark); border-radius: var(--bn-radius-full); font-weight: 600;">Current</span>' : ''}
              <span style="font-size: var(--bn-text-xs); color: var(--bn-gray);">(${paymentCount} ${paymentCount === 1 ? 'payment' : 'payments'})</span>
            </div>
            <div style="display: flex; gap: var(--bn-space-4); font-size: var(--bn-text-sm); color: var(--bn-gray); flex-wrap: wrap;">
              <span>Expected: <strong style="color: var(--bn-dark);">${formatCurrency(totalExpected)}</strong></span>
              <span>Collected: <strong style="color: var(--bn-success);">${formatCurrency(totalCollected)}</strong></span>
              <span>Outstanding: <strong style="color: var(--bn-danger);">${formatCurrency(totalOutstanding)}</strong></span>
              ${membersWithoutPayments > 0 ? `<span style="font-size: var(--bn-text-xs); color: var(--bn-warning);">(${membersWithoutPayments} ${membersWithoutPayments === 1 ? 'member' : 'members'} unpaid)</span>` : ''}
            </div>
          </div>
          <span id="cycle-toggle-icon-${cycleKey}" style="font-size: var(--bn-text-xl); transition: transform var(--bn-transition-fast);">${isExpanded ? '🔽' : '▶️'}</span>
        </button>
        
        <div id="cycle-content-${cycleKey}" style="display: ${isExpanded ? 'block' : 'none'}; padding: var(--bn-space-4); border-top: 1px solid var(--bn-gray-lighter); background: var(--bn-gray-50);">
          ${cycleData.payments.map(payment => createPaymentCard(payment, payment.status === "pending")).join('')}
        </div>
      </div>
    `;
  });
  
  pendingPaymentsList.innerHTML = html;
  
  // Add event listeners for action buttons
  pendingPaymentsList.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = e.target.closest("button").dataset.action;
      const paymentId = e.target.closest("button").dataset.paymentId;
      handlePaymentAction(action, paymentId);
    });
  });
}

// Toggle cycle section expand/collapse
window.toggleCycleSection = function(cycleKey) {
  const content = document.getElementById(`cycle-content-${cycleKey}`);
  const icon = document.getElementById(`cycle-toggle-icon-${cycleKey}`);
  
  if (content && icon) {
    const isExpanded = content.style.display !== 'none';
    content.style.display = isExpanded ? 'none' : 'block';
    icon.textContent = isExpanded ? '▶️' : '🔽';
  }
};

// Render recent payments categorized by type and month
async function renderRecentPaymentsCategorized() {
  if (!pendingPaymentsList) return;
  
  // Get all recent payments (approved/completed with amountPaid > 0)
  const allRecentPayments = [...payments.seedMoney, ...payments.monthly, ...payments.serviceFee]
    .filter(p => {
      const amountPaid = parseFloat(p.amountPaid || 0);
      return amountPaid > 0 && (p.status === "approved" || p.status === "completed");
    })
    .sort((a, b) => {
      // Prioritize paidAt, then approvedAt, then updatedAt, then createdAt
      const getDate = (payment) => {
        if (payment.paidAt?.toDate) return payment.paidAt.toDate();
        if (payment.approvedAt?.toDate) return payment.approvedAt.toDate();
        if (payment.updatedAt?.toDate) return payment.updatedAt.toDate();
        if (payment.createdAt?.toDate) return payment.createdAt.toDate();
        if (payment.timestamp?.toDate) return payment.timestamp.toDate();
        return new Date(0);
      };
      const dateA = getDate(a);
      const dateB = getDate(b);
      return dateB - dateA; // Newest first
    });
  
  // Apply member filter if set
  const filterByMember = document.getElementById("filterByMember");
  let filteredPayments = allRecentPayments;
  if (filterByMember && filterByMember.value) {
    filteredPayments = filteredPayments.filter(p => p.memberId === filterByMember.value);
  }
  
  // Apply payment type filter if set
  const filterByPaymentTypeEl = document.getElementById("filterByPaymentType");
  if (filterByPaymentTypeEl && filterByPaymentTypeEl.value) {
    filteredPayments = filteredPayments.filter(p => p.type === filterByPaymentTypeEl.value);
  }
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const monthNames = ["January", "February", "March", "April", "May", "June", 
                     "July", "August", "September", "October", "November", "December"];
  
  // Group payments by type
  const paymentsByType = {
    "Seed Money": [],
    "Monthly Contribution": [],
    "Service Fee": []
  };
  
  filteredPayments.forEach(payment => {
    const type = payment.type || "Monthly Contribution";
    if (paymentsByType[type]) {
      paymentsByType[type].push(payment);
    }
  });
  
  // Update month filter dropdown for recent tab
  const monthFilterContainer = document.getElementById("monthFilterContainer");
  const filterByMonth = document.getElementById("filterByMonth");
  
  if (monthFilterContainer) {
    monthFilterContainer.style.display = "block";
  }
  
  // Get all unique months from payments
  const allMonths = new Set();
  filteredPayments.forEach(payment => {
    if (payment.month) {
      const year = parseInt(payment.year) || currentYear;
      allMonths.add(`${year}_${payment.month}`);
    } else if (payment.type === "Seed Money") {
      const year = parseInt(payment.year) || currentYear;
      allMonths.add(`${year}_SeedMoney`);
    } else if (payment.type === "Service Fee") {
      const year = parseInt(payment.year) || currentYear;
      allMonths.add(`${year}_ServiceFee`);
    }
  });
  
  if (filterByMonth && allMonths.size > 0) {
    const availableMonths = Array.from(allMonths)
      .map(key => {
        if (key.includes("_SeedMoney")) {
          const year = parseInt(key.split("_")[0]);
          return { type: "cycle", year, key, label: `Cycle ${year}` };
        } else if (key.includes("_ServiceFee")) {
          const year = parseInt(key.split("_")[0]);
          return { type: "year", year, key, label: `${year} Service Fee` };
        } else {
          const [year, month] = key.split("_");
          return { type: "month", year: parseInt(year), month, key, label: `${month} ${year}` };
        }
      })
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        if (a.type === "month" && b.type === "month") {
          return monthNames.indexOf(b.month) - monthNames.indexOf(a.month);
        }
        return 0;
      });
    
    filterByMonth.innerHTML = '<option value="">All Months/Cycles</option>';
    availableMonths.forEach(({ key, label }) => {
      filterByMonth.innerHTML += `<option value="${key}">${label}</option>`;
    });
    
    // Apply month filter if selected
    const selectedMonthKey = filterByMonth.value;
    if (selectedMonthKey) {
      Object.keys(paymentsByType).forEach(type => {
        paymentsByType[type] = paymentsByType[type].filter(p => {
          if (selectedMonthKey.includes("_SeedMoney")) {
            const year = parseInt(selectedMonthKey.split("_")[0]);
            return p.type === "Seed Money" && (parseInt(p.year) || currentYear) === year;
          } else if (selectedMonthKey.includes("_ServiceFee")) {
            const year = parseInt(selectedMonthKey.split("_")[0]);
            return p.type === "Service Fee" && (parseInt(p.year) || currentYear) === year;
          } else {
            const [year, month] = selectedMonthKey.split("_");
            return p.month === month && (parseInt(p.year) || currentYear) === parseInt(year);
          }
        });
      });
    }
    
    // Add event listener for month filter change
    filterByMonth.onchange = () => {
      renderRecentPaymentsCategorized();
    };
  }
  
  // Render categorized payments
  let html = '';
  let hasAnyPayments = false;
  
  Object.keys(paymentsByType).forEach(type => {
    const typePayments = paymentsByType[type];
    if (typePayments.length === 0) return;
    
    hasAnyPayments = true;
    
    // Calculate totals for this type
    const totalCollected = typePayments.reduce((sum, p) => sum + parseFloat(p.amountPaid || 0), 0);
    const paymentCount = typePayments.length;
    
    // Get type icon and color
    const typeConfig = {
      "Seed Money": { icon: "🌱", color: "var(--bn-accent)" },
      "Monthly Contribution": { icon: "📅", color: "var(--bn-primary)" },
      "Service Fee": { icon: "💳", color: "var(--bn-success)" }
    };
    const config = typeConfig[type] || { icon: "💵", color: "var(--bn-gray)" };
    
    html += `
      <div style="margin-bottom: var(--bn-space-4); background: var(--bn-white); border: 1px solid var(--bn-gray-lighter); border-radius: var(--bn-radius-lg); overflow: hidden;">
        <button class="recent-type-toggle-btn" onclick="toggleRecentTypeSection('${type.replace(/\s+/g, '_')}')" style="width: 100%; padding: var(--bn-space-4) var(--bn-space-5); background: var(--bn-white); border: none; border-bottom: 1px solid var(--bn-gray-lighter); cursor: pointer; display: flex; align-items: center; justify-content: space-between; text-align: left; transition: background var(--bn-transition-fast);" data-type="${type}">
          <div style="flex: 1; display: flex; align-items: center; gap: var(--bn-space-3);">
            <span style="font-size: var(--bn-text-xl);">${config.icon}</span>
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: var(--bn-space-3); margin-bottom: var(--bn-space-1);">
                <span style="font-size: var(--bn-text-lg); font-weight: 700; color: var(--bn-dark);">${type}</span>
                <span style="font-size: var(--bn-text-xs); color: var(--bn-gray);">(${paymentCount} ${paymentCount === 1 ? 'payment' : 'payments'})</span>
              </div>
              <div style="font-size: var(--bn-text-sm); color: var(--bn-gray);">
                Total Collected: <strong style="color: ${config.color};">${formatCurrency(totalCollected)}</strong>
              </div>
            </div>
          </div>
          <span id="recent-type-toggle-icon-${type.replace(/\s+/g, '_')}" style="font-size: var(--bn-text-xl); transition: transform var(--bn-transition-fast);">▶️</span>
        </button>
        
        <div id="recent-type-content-${type.replace(/\s+/g, '_')}" style="display: none; padding: var(--bn-space-4); border-top: 1px solid var(--bn-gray-lighter); background: var(--bn-gray-50);">
          ${typePayments.map(payment => createPaymentCard(payment, false)).join('')}
        </div>
      </div>
    `;
  });
  
  if (!hasAnyPayments) {
    pendingPaymentsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p class="empty-state-text">No recent payments found</p>
      </div>
    `;
    return;
  }
  
  pendingPaymentsList.innerHTML = html;
  
  // Add event listeners for action buttons
  pendingPaymentsList.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = e.target.closest("button").dataset.action;
      const paymentId = e.target.closest("button").dataset.paymentId;
      handlePaymentAction(action, paymentId);
    });
  });
}

// Toggle recent payment type section expand/collapse
window.toggleRecentTypeSection = function(typeKey) {
  const content = document.getElementById(`recent-type-content-${typeKey}`);
  const icon = document.getElementById(`recent-type-toggle-icon-${typeKey}`);
  
  if (content && icon) {
    const isExpanded = content.style.display !== 'none';
    content.style.display = isExpanded ? 'none' : 'block';
    icon.textContent = isExpanded ? '▶️' : '🔽';
  }
};

// Render service fee contributions
async function renderServiceFeeContributions() {
  if (!pendingPaymentsList) return;
  
  // Get only service fee payments
  const serviceFeePayments = payments.serviceFee.filter(p => p.amountPaid > 0 || p.status === "pending");
  
  // Apply member filter if set
  const filterByMember = document.getElementById("filterByMember");
  let filteredPayments = serviceFeePayments;
  if (filterByMember && filterByMember.value) {
    filteredPayments = filteredPayments.filter(p => p.memberId === filterByMember.value);
  }
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const serviceFeeAmount = parseFloat(groupData?.rules?.serviceFee?.amount || groupData?.serviceFeeAmount || 0);
  
  // Sort payments (pending first, then by date)
  filteredPayments.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    
    const dateA = a.paidAt?.toDate ? a.paidAt.toDate() : 
                 a.approvedAt?.toDate ? a.approvedAt.toDate() : 
                 a.updatedAt?.toDate ? a.updatedAt.toDate() : new Date(0);
    const dateB = b.paidAt?.toDate ? b.paidAt.toDate() : 
                 b.approvedAt?.toDate ? b.approvedAt.toDate() : 
                 b.updatedAt?.toDate ? b.updatedAt.toDate() : new Date(0);
    return dateB - dateA;
  });
  
  if (filteredPayments.length === 0) {
    pendingPaymentsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💳</div>
        <p class="empty-state-text">No service fee payments found</p>
      </div>
    `;
    return;
  }
  
  // Calculate totals
  const totalMembersCount = members.length;
  const totalExpected = totalMembersCount * serviceFeeAmount;
  const totalCollected = filteredPayments.reduce((sum, p) => {
    if (p.status === 'approved' || p.status === 'completed') {
      return sum + parseFloat(p.amountPaid || 0);
    }
    return sum;
  }, 0);
  
  const membersWithPayments = new Set(filteredPayments.map(p => p.memberId)).size;
  const membersWithoutPayments = totalMembersCount - membersWithPayments;
  const totalArrearsFromPayments = filteredPayments.reduce((sum, p) => sum + parseFloat(p.arrears || 0), 0);
  const outstandingFromUnpaidMembers = membersWithoutPayments * serviceFeeAmount;
  const totalOutstanding = outstandingFromUnpaidMembers + totalArrearsFromPayments;
  
  // Render summary and payments
  let html = `
    <div style="margin-bottom: var(--bn-space-4); background: var(--bn-white); border: 1px solid var(--bn-gray-lighter); border-radius: var(--bn-radius-lg); padding: var(--bn-space-4);">
      <h3 style="font-size: var(--bn-text-lg); font-weight: 700; color: var(--bn-dark); margin-bottom: var(--bn-space-3);">Service Fee Summary</h3>
      <div style="display: flex; gap: var(--bn-space-4); font-size: var(--bn-text-sm); color: var(--bn-gray); flex-wrap: wrap;">
        <span>Expected: <strong style="color: var(--bn-dark);">${formatCurrency(totalExpected)}</strong></span>
        <span>Collected: <strong style="color: var(--bn-success);">${formatCurrency(totalCollected)}</strong></span>
        <span>Outstanding: <strong style="color: var(--bn-danger);">${formatCurrency(totalOutstanding)}</strong></span>
        ${membersWithoutPayments > 0 ? `<span style="font-size: var(--bn-text-xs); color: var(--bn-warning);">(${membersWithoutPayments} ${membersWithoutPayments === 1 ? 'member' : 'members'} unpaid)</span>` : ''}
      </div>
    </div>
  `;
  
  html += filteredPayments.map(payment => createPaymentCard(payment, payment.status === "pending")).join('');
  
  pendingPaymentsList.innerHTML = html;
  
  // Add event listeners for action buttons
  pendingPaymentsList.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = e.target.closest("button").dataset.action;
      const paymentId = e.target.closest("button").dataset.paymentId;
      handlePaymentAction(action, paymentId);
    });
  });
}

// Update service fee tab visibility based on group settings
function updateServiceFeeTabVisibility() {
  const serviceFeeTab = document.querySelector('.payment-tab[data-tab="servicefee"]');
  const hasServiceFee = parseFloat(groupData?.rules?.serviceFee?.amount || groupData?.serviceFeeAmount || 0) > 0;
  
  if (serviceFeeTab) {
    serviceFeeTab.style.display = hasServiceFee ? 'inline-block' : 'none';
  }
}

// Toggle month section expand/collapse
window.toggleMonthSection = function(monthKey) {
  const content = document.getElementById(`month-content-${monthKey}`);
  const icon = document.getElementById(`month-toggle-icon-${monthKey}`);
  
  if (content && icon) {
    const isExpanded = content.style.display !== 'none';
    content.style.display = isExpanded ? 'none' : 'block';
    icon.textContent = isExpanded ? '▶️' : '🔽';
  }
};

// Helper function to get arrears notes (e.g., "Seed money due", "Monthly due")
function getArrearsNotes(items) {
  if (!items || items.length === 0) return '';
  
  const notes = [];
  const hasSeedMoney = items.some(item => item.type === 'Seed Money');
  const hasMonthly = items.some(item => item.type === 'Monthly Contribution');
  const hasServiceFee = items.some(item => item.type === 'Service Fee');
  
  if (hasSeedMoney) notes.push('Seed money due');
  if (hasMonthly) notes.push('Monthly due');
  if (hasServiceFee) notes.push('Service fee due');
  
  if (notes.length === 0) return '';
  
  return `<span style="display: inline-flex; align-items: center; gap: 4px; font-size: var(--bn-text-xs); color: var(--bn-warning); font-weight: 500; margin-left: var(--bn-space-1);">
    <span style="font-size: 12px;">⚠️</span>
    <span>${notes.join(', ')}</span>
  </span>`;
}

// Render comprehensive arrears tab
async function renderArrearsTab() {
  if (!pendingPaymentsList) return;
  
  // Group arrears by member
  const arrearsByMember = {};
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Process seed money arrears - only include payments with outstanding arrears
  payments.seedMoney.forEach(payment => {
    const arrears = parseFloat(payment.arrears || 0);
    if (arrears > 0) {
      const memberId = payment.memberId;
      if (!arrearsByMember[memberId]) {
        arrearsByMember[memberId] = {
          memberId,
          memberName: payment.memberName,
          totalArrears: 0,
          items: [],
          email: null,
          phone: null
        };
      }
      
      // Calculate days overdue
      let daysOverdue = 0;
      if (payment.dueDate) {
        const dueDate = payment.dueDate?.toDate ? payment.dueDate.toDate() : new Date(payment.dueDate);
        if (!isNaN(dueDate.getTime())) {
          daysOverdue = Math.max(0, Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24)));
        }
      }
      
      // Calculate penalty if applicable
      const monthlyPenaltyRate = parseFloat(groupData?.rules?.monthlyPenalty?.rate || groupData?.monthlyPenalty || 5);
      const gracePeriod = parseInt(groupData?.rules?.monthlyPenalty?.gracePeriod || groupData?.monthlyGracePeriod || 5);
      const penaltyDays = Math.max(0, daysOverdue - gracePeriod);
      const penaltyAmount = penaltyDays > 0 ? (payment.arrears * monthlyPenaltyRate / 100) * (penaltyDays / 30) : 0;
      
      arrearsByMember[memberId].totalArrears += payment.arrears;
      arrearsByMember[memberId].items.push({
        type: 'Seed Money',
        paymentId: payment.id,
        docId: null,
        amount: payment.totalAmount,
        amountPaid: payment.amountPaid,
        arrears: payment.arrears,
        dueDate: payment.dueDate,
        daysOverdue,
        penaltyAmount,
        status: payment.status
      });
    }
  });
  
  // Process monthly contribution arrears - only include payments with outstanding arrears
  payments.monthly.forEach(payment => {
    const arrears = parseFloat(payment.arrears || 0);
    // Only include payments with outstanding arrears (completed payments are excluded)
    if (arrears > 0) {
      const memberId = payment.memberId;
      if (!arrearsByMember[memberId]) {
        arrearsByMember[memberId] = {
          memberId,
          memberName: payment.memberName,
          totalArrears: 0,
          items: [],
          email: null,
          phone: null
        };
      }
      
      // Calculate due date for monthly contributions
      // If not stored in payment, calculate from month/year and monthlyDueDay
      let dueDate = null;
      let daysOverdue = 0;
      
      if (payment.dueDate) {
        // Use stored dueDate if available
        dueDate = payment.dueDate?.toDate ? payment.dueDate.toDate() : new Date(payment.dueDate);
        if (isNaN(dueDate.getTime())) dueDate = null;
      }
      
      // If no dueDate stored, calculate from month/year + monthlyDueDay
      if (!dueDate && payment.month && payment.year) {
        const monthlyDueDay = groupData?.rules?.monthlyContribution?.dayOfMonth || groupData?.monthlyDueDay || 15;
        const monthNames = ["January", "February", "March", "April", "May", "June", 
                           "July", "August", "September", "October", "November", "December"];
        const monthIndex = monthNames.indexOf(payment.month);
        if (monthIndex !== -1) {
          dueDate = new Date(parseInt(payment.year), monthIndex, monthlyDueDay);
        }
      }
      
      // Calculate days overdue
      if (dueDate && !isNaN(dueDate.getTime())) {
        daysOverdue = Math.max(0, Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24)));
      }
      
      // Calculate penalty if applicable
      const monthlyPenaltyRate = parseFloat(groupData?.rules?.monthlyPenalty?.rate || groupData?.monthlyPenalty || 5);
      const gracePeriod = parseInt(groupData?.rules?.monthlyPenalty?.gracePeriod || groupData?.monthlyGracePeriod || 5);
      const penaltyDays = Math.max(0, daysOverdue - gracePeriod);
      const penaltyAmount = penaltyDays > 0 ? (arrears * monthlyPenaltyRate / 100) * (penaltyDays / 30) : 0;
      
      arrearsByMember[memberId].totalArrears += arrears;
      arrearsByMember[memberId].items.push({
        type: 'Monthly Contribution',
        paymentId: payment.id,
        docId: payment.docId,
        month: payment.month,
        year: payment.year,
        amount: payment.totalAmount,
        amountPaid: payment.amountPaid,
        arrears: arrears,
        dueDate: dueDate || payment.dueDate, // Use calculated or stored dueDate
        daysOverdue,
        penaltyAmount,
        status: payment.status
      });
    }
  });
  
  // Process service fee arrears - only include payments with outstanding arrears
  payments.serviceFee.forEach(payment => {
    const arrears = parseFloat(payment.arrears || 0);
    if (arrears > 0) {
      const memberId = payment.memberId;
      if (!arrearsByMember[memberId]) {
        arrearsByMember[memberId] = {
          memberId,
          memberName: payment.memberName,
          totalArrears: 0,
          items: [],
          email: null,
          phone: null
        };
      }
      
      // Calculate days overdue
      let daysOverdue = 0;
      if (payment.dueDate) {
        const dueDate = payment.dueDate?.toDate ? payment.dueDate.toDate() : new Date(payment.dueDate);
        if (!isNaN(dueDate.getTime())) {
          daysOverdue = Math.max(0, Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24)));
        }
      }
      
      // Calculate penalty if applicable (service fees may have penalties too)
      const monthlyPenaltyRate = parseFloat(groupData?.rules?.monthlyPenalty?.rate || groupData?.monthlyPenalty || 5);
      const gracePeriod = parseInt(groupData?.rules?.monthlyPenalty?.gracePeriod || groupData?.monthlyGracePeriod || 5);
      const penaltyDays = Math.max(0, daysOverdue - gracePeriod);
      const penaltyAmount = penaltyDays > 0 ? (payment.arrears * monthlyPenaltyRate / 100) * (penaltyDays / 30) : 0;
      
      arrearsByMember[memberId].totalArrears += payment.arrears;
      arrearsByMember[memberId].items.push({
        type: 'Service Fee',
        paymentId: payment.id,
        docId: null,
        amount: payment.totalAmount,
        amountPaid: payment.amountPaid,
        arrears: payment.arrears,
        dueDate: payment.dueDate,
        daysOverdue,
        penaltyAmount,
        status: payment.status,
        year: payment.year
      });
    }
  });
  
  // Sort items by date (due date) for each member - oldest first
  for (const memberId in arrearsByMember) {
    arrearsByMember[memberId].items.sort((a, b) => {
      let dateA = null;
      let dateB = null;
      
      // Get date A
      if (a.dueDate) {
        if (a.dueDate?.toDate) {
          dateA = a.dueDate.toDate();
        } else if (a.dueDate instanceof Date) {
          dateA = a.dueDate;
        } else {
          dateA = new Date(a.dueDate);
        }
      }
      
      // Get date B
      if (b.dueDate) {
        if (b.dueDate?.toDate) {
          dateB = b.dueDate.toDate();
        } else if (b.dueDate instanceof Date) {
          dateB = b.dueDate;
        } else {
          dateB = new Date(b.dueDate);
        }
      }
      
      // If dates are valid, sort by date (oldest first)
      if (dateA && !isNaN(dateA.getTime()) && dateB && !isNaN(dateB.getTime())) {
        return dateA.getTime() - dateB.getTime();
      }
      
      // Fallback: sort by type (Seed Money, then Service Fee, then Monthly)
      const typeOrder = { 'Seed Money': 1, 'Service Fee': 2, 'Monthly Contribution': 3 };
      return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
    });
  }
  
  // Get member contact info
  for (const memberId in arrearsByMember) {
    const member = members.find(m => m.id === memberId);
    if (member) {
      arrearsByMember[memberId].email = member.email || '';
      arrearsByMember[memberId].phone = member.phone || '';
    }
  }
  
  // Convert to array and sort by total arrears (highest first)
  const arrearsList = Object.values(arrearsByMember)
    .sort((a, b) => b.totalArrears - a.totalArrears);
  
  if (arrearsList.length === 0) {
    pendingPaymentsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <p class="empty-state-text">No arrears found. All payments are up to date!</p>
      </div>
    `;
    return;
  }
  
  // Calculate totals
  const totalArrears = arrearsList.reduce((sum, m) => sum + m.totalArrears, 0);
  const totalPenalties = arrearsList.reduce((sum, m) => 
    sum + m.items.reduce((itemSum, item) => itemSum + item.penaltyAmount, 0), 0);
  
  let html = `
    <div style="margin-bottom: var(--bn-space-6); padding: var(--bn-space-5); background: var(--bn-white); border: 1px solid var(--bn-gray-lighter); border-radius: var(--bn-radius-xl); border-left: 4px solid var(--bn-danger);">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--bn-space-4);">
        <div>
          <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-1);">Total Arrears</div>
          <div style="font-size: var(--bn-text-2xl); font-weight: 700; color: var(--bn-danger);">${formatCurrency(totalArrears)}</div>
        </div>
        <div>
          <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-1);">Members with Arrears</div>
          <div style="font-size: var(--bn-text-2xl); font-weight: 700; color: var(--bn-dark);">${arrearsList.length}</div>
        </div>
        <div>
          <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-1);">Total Penalties</div>
          <div style="font-size: var(--bn-text-2xl); font-weight: 700; color: var(--bn-warning);">${formatCurrency(totalPenalties)}</div>
        </div>
      </div>
    </div>
  `;
  
  // Render each member's arrears - compact design for many members
  arrearsList.forEach(memberArrears => {
    const initials = memberArrears.memberName ? memberArrears.memberName.charAt(0).toUpperCase() : '?';
    const totalPenalty = memberArrears.items.reduce((sum, item) => sum + item.penaltyAmount, 0);
    
    html += `
      <div style="margin-bottom: var(--bn-space-3); padding: var(--bn-space-4); background: var(--bn-white); border: 1px solid var(--bn-gray-lighter); border-radius: var(--bn-radius-lg); border-left: 3px solid var(--bn-danger); transition: all 0.2s ease;">
        <div style="display: flex; align-items: center; gap: var(--bn-space-3);">
          <div style="width: 40px; height: 40px; border-radius: var(--bn-radius-full); background: var(--bn-gradient-primary); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: var(--bn-text-sm); color: var(--bn-white); flex-shrink: 0;">
            ${initials}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: var(--bn-space-3); flex-wrap: wrap;">
              <div style="flex: 1; min-width: 150px;">
                <div style="font-size: var(--bn-text-base); font-weight: 600; color: var(--bn-dark); margin-bottom: 2px; display: flex; align-items: center; gap: var(--bn-space-2);">
                  <span>${memberArrears.memberName}</span>
                  ${totalPenalty > 0 ? `<span style="font-size: var(--bn-text-xs); padding: 2px 6px; background: var(--bn-warning-light); color: var(--bn-warning); border-radius: var(--bn-radius-sm); font-weight: 600;">Penalty: ${formatCurrency(totalPenalty)}</span>` : ''}
                </div>
                <div style="display: flex; gap: var(--bn-space-3); flex-wrap: wrap; font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: 2px;">
                  ${memberArrears.email ? `<span>📧 ${memberArrears.email}</span>` : ''}
                  ${memberArrears.phone ? `<span>📞 ${memberArrears.phone}</span>` : ''}
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: var(--bn-space-3); flex-wrap: wrap;">
                <div style="text-align: right;">
                  <div style="font-size: var(--bn-text-xl); font-weight: 700; color: var(--bn-danger); line-height: 1.2;">
                    ${formatCurrency(memberArrears.totalArrears)}
                  </div>
                  <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: 2px;">Total Arrears</div>
                </div>
                <div style="display: flex; gap: var(--bn-space-1); flex-wrap: wrap; align-items: center;">
                  <button class="btn btn-accent btn-sm" onclick="openRecordPaymentModal('${memberArrears.memberId}')" style="padding: 6px 12px; font-size: var(--bn-text-xs); display: inline-flex; align-items: center; gap: 4px;">
                    <span>💰</span>
                    <span>Pay</span>
                  </button>
                  ${memberArrears.phone ? `
                    <a href="tel:${memberArrears.phone}" class="btn btn-ghost btn-sm" style="padding: 6px 12px; font-size: var(--bn-text-xs); display: inline-flex; align-items: center; gap: 4px; text-decoration: none;" title="Call ${memberArrears.phone}">
                      <span>📞</span>
                    </a>
                  ` : ''}
                  ${memberArrears.email ? `
                    <a href="mailto:${memberArrears.email}" class="btn btn-ghost btn-sm" style="padding: 6px 12px; font-size: var(--bn-text-xs); display: inline-flex; align-items: center; gap: 4px; text-decoration: none;" title="Email ${memberArrears.email}">
                      <span>📧</span>
                    </a>
                  ` : ''}
                  <button class="btn btn-ghost btn-sm arrears-toggle-btn" onclick="toggleArrearsBreakdown('${memberArrears.memberId}')" style="padding: 6px 12px; font-size: var(--bn-text-xs); display: inline-flex; align-items: center; gap: 4px;" data-member-id="${memberArrears.memberId}">
                    <span>📋</span>
                    <span>Details</span>
                  </button>
                  ${getArrearsNotes(memberArrears.items)}
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div id="arrears-breakdown-${memberArrears.memberId}" style="display: none; margin-top: var(--bn-space-3); padding-top: var(--bn-space-3); border-top: 1px solid var(--bn-gray-lighter);">
          <div style="font-size: var(--bn-text-xs); font-weight: 600; color: var(--bn-gray); text-transform: uppercase; margin-bottom: var(--bn-space-2); letter-spacing: 0.5px;">Payment Breakdown (${memberArrears.items.length} ${memberArrears.items.length === 1 ? 'item' : 'items'})</div>
          <div style="display: flex; flex-direction: column; gap: var(--bn-space-2);">
    `;
    
    memberArrears.items.forEach((item, index) => {
      let dueDateStr = 'Not set';
      if (item.dueDate) {
        try {
          // Handle Firestore Timestamp
          if (item.dueDate?.toDate) {
            dueDateStr = item.dueDate.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
          } 
          // Handle Date object
          else if (item.dueDate instanceof Date) {
            dueDateStr = item.dueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
          }
          // Handle string or other format
          else {
            const date = new Date(item.dueDate);
            if (!isNaN(date.getTime())) {
              dueDateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            }
          }
        } catch (e) {
          console.error("Error formatting due date:", e);
          dueDateStr = 'Not set';
        }
      } else if (item.month && item.year) {
        // Calculate due date from month/year if dueDate not available
        const monthlyDueDay = groupData?.rules?.monthlyContribution?.dayOfMonth || groupData?.monthlyDueDay || 15;
        const monthNames = ["January", "February", "March", "April", "May", "June", 
                           "July", "August", "September", "October", "November", "December"];
        const monthIndex = monthNames.indexOf(item.month);
        if (monthIndex !== -1) {
          const calculatedDate = new Date(parseInt(item.year), monthIndex, monthlyDueDay);
          dueDateStr = calculatedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        }
      }
      
      html += `
        <div style="display: grid; grid-template-columns: 1fr auto; gap: var(--bn-space-3); padding: var(--bn-space-3); background: var(--bn-gray-50); border-radius: var(--bn-radius-md); border: 1px solid var(--bn-gray-lighter); align-items: start;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--bn-space-2);">
            <div>
              <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.3px;">Type</div>
              <div style="font-weight: 600; color: var(--bn-dark); font-size: var(--bn-text-sm);">
                ${item.type}${item.month ? ` - ${item.month} ${item.year}` : item.year ? ` (${item.year})` : ''}
              </div>
            </div>
            <div>
              <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.3px;">Due Date</div>
              <div style="font-size: var(--bn-text-sm); color: var(--bn-dark);">
                ${dueDateStr}
                ${item.daysOverdue > 0 ? `<span style="color: var(--bn-danger); font-weight: 600; display: block; margin-top: 2px;">${item.daysOverdue} days overdue</span>` : ''}
              </div>
            </div>
            <div>
              <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.3px;">Total Due</div>
              <div style="font-size: var(--bn-text-sm); font-weight: 600; color: var(--bn-dark);">${formatCurrency(parseFloat(item.amount || 0))}</div>
            </div>
            <div>
              <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.3px;">Amount Paid</div>
              <div style="font-size: var(--bn-text-sm); font-weight: 600; color: var(--bn-success);">${formatCurrency(parseFloat(item.amountPaid || 0))}</div>
            </div>
            <div>
              <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.3px;">Arrears</div>
              <div style="font-size: var(--bn-text-sm); font-weight: 700; color: var(--bn-danger);">${formatCurrency(parseFloat(item.arrears || 0))}</div>
              ${item.penaltyAmount > 0 ? `
                <div style="font-size: var(--bn-text-xs); color: var(--bn-warning); font-weight: 600; margin-top: 2px;">
                  Penalty: ${formatCurrency(item.penaltyAmount)}
                </div>
              ` : ''}
            </div>
          </div>
          <div style="display: flex; gap: var(--bn-space-1); flex-shrink: 0; flex-direction: column;">
            <button class="btn btn-accent btn-sm" onclick="recordPaymentForArrear('${memberArrears.memberId}', '${item.type}', '${item.docId || ''}')" style="padding: 6px 12px; font-size: var(--bn-text-xs); white-space: nowrap;" title="Record payment for this item">
              Pay Now
            </button>
            <button class="btn btn-ghost btn-sm" onclick="viewPaymentHistory('${memberArrears.memberId}', '${item.type}', '${item.docId || ''}')" style="padding: 6px 12px; font-size: var(--bn-text-xs); white-space: nowrap;" title="View payment history">
              History
            </button>
          </div>
        </div>
      `;
    });
    
    html += `
          </div>
        </div>
      </div>
    `;
  });
  
  pendingPaymentsList.innerHTML = html;
}

// Toggle arrears breakdown visibility
window.toggleArrearsBreakdown = function(memberId) {
  const breakdownElement = document.getElementById(`arrears-breakdown-${memberId}`);
  const toggleBtn = document.querySelector(`.arrears-toggle-btn[data-member-id="${memberId}"]`);
  
  if (breakdownElement && toggleBtn) {
    // Check current visibility - prefer inline style, fallback to computed
    const currentDisplay = breakdownElement.style.display;
    const computedDisplay = window.getComputedStyle(breakdownElement).display;
    const isCurrentlyVisible = (currentDisplay && currentDisplay !== 'none') || (!currentDisplay && computedDisplay !== 'none');
    
    // Toggle visibility
    if (isCurrentlyVisible) {
      breakdownElement.style.display = 'none';
    } else {
      breakdownElement.style.display = 'block';
    }
    
    // Update button text/icon
    const spans = toggleBtn.querySelectorAll('span');
    if (spans.length >= 2) {
      const textSpan = spans[spans.length - 1]; // Last span is the text
      textSpan.textContent = isCurrentlyVisible ? 'View Details' : 'Hide Details';
      
      // Update icon (first span)
      const iconSpan = spans[0];
      iconSpan.textContent = isCurrentlyVisible ? '📋' : '🔽';
    }
  }
};

// Helper functions for arrears management
// Expose functions to global scope for onclick handlers
window.openRecordPaymentModal = openRecordPaymentModal;

window.recordPaymentForArrear = function(memberId, paymentType, docId) {
  openRecordPaymentModal(memberId);
};

window.viewMemberArrearsDetails = function(memberId) {
  openStatModal('arrears');
  // Scroll to specific member if possible
  setTimeout(() => {
    const memberSection = document.querySelector(`[data-member-id="${memberId}"]`);
    if (memberSection) {
      memberSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 500);
};

window.viewPaymentHistory = function(memberId, paymentType, docId) {
  // Navigate to payment history or show in modal
  window.location.href = `manage_payments.html?groupId=${selectedGroupId}&memberId=${memberId}&tab=recent`;
};

// Open all payment details modal (admin view)
async function openAllPaymentDetailsModal() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "warning");
    return;
  }
  
  const modal = document.getElementById("allPaymentDetailsModal");
  const container = document.getElementById("allPaymentDetailsTableContainer");
  const memberFilter = document.getElementById("paymentDetailsMemberFilter");
  const clearFilterBtn = document.getElementById("paymentDetailsClearFilterBtn");
  
  if (!modal || !container) return;
  
  // Populate member filter
  if (memberFilter) {
    memberFilter.innerHTML = '<option value="">All Members</option>';
    members.forEach(member => {
      const name = member.fullName || member.name || member.email || 'Unknown';
      memberFilter.innerHTML += `<option value="${member.id}">${name}</option>`;
    });
  }
  
  // Load all payments initially
  await loadPaymentDetailsTable(selectedGroupId, null, container, true);
  
  // Set up filter handlers (remove old listeners first)
  const filterHandler = async function() {
    const selectedMemberId = this.value || null;
    await loadPaymentDetailsTable(selectedGroupId, selectedMemberId, container, true);
  };
  
  // Clone to remove old listeners
  const newFilter = memberFilter.cloneNode(true);
  memberFilter.parentNode.replaceChild(newFilter, memberFilter);
  document.getElementById("paymentDetailsMemberFilter").addEventListener("change", filterHandler);
  
  if (clearFilterBtn) {
    const newClearBtn = clearFilterBtn.cloneNode(true);
    clearFilterBtn.parentNode.replaceChild(newClearBtn, clearFilterBtn);
    document.getElementById("paymentDetailsClearFilterBtn").addEventListener("click", () => {
      const filterEl = document.getElementById("paymentDetailsMemberFilter");
      if (filterEl) filterEl.value = "";
      loadPaymentDetailsTable(selectedGroupId, null, container, true);
    });
  }
  
  if (window.openModal) {
    window.openModal("allPaymentDetailsModal");
  } else {
    modal.classList.add("active");
    modal.classList.remove("hidden");
    modal.style.display = "flex";
  }
}
