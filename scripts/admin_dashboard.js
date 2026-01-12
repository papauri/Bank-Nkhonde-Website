import {
  db,
  auth,
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  onAuthStateChanged,
  signOut,
  Timestamp,
} from "./firebaseConfig.js";

// Global state
let currentUser = null;
let adminGroups = [];
let currentGroup = null;

// DOM Elements
const spinner = document.getElementById("spinner");
const adminName = document.getElementById("adminName");
const totalCollections = document.getElementById("totalCollections");
const activeLoans = document.getElementById("activeLoans");
const pendingApprovals = document.getElementById("pendingApprovals");
const totalArrears = document.getElementById("totalArrears");
const pendingBadge = document.getElementById("pendingBadge");
const pendingApprovalsList = document.getElementById("pendingApprovalsList");
const groupsList = document.getElementById("groupsList");

// Initialize app
onAuthStateChanged(auth, async (user) => {
  if (user) {
    console.log("User is signed in:", user.email);
    currentUser = user;
    showSpinner(true);
    await loadAdminData();
    showSpinner(false);
  } else {
    console.log("No user is signed in.");
    alert("You must be signed in to access this page.");
    window.location.href = "../login.html";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  // Setup event listeners
  setupEventListeners();
});

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
  // Header actions
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "../login.html";
    } catch (error) {
      console.error("Error signing out:", error);
      showToast("Error signing out: " + error.message, "error");
    }
  });
  
  document.getElementById("switchViewBtn")?.addEventListener("click", () => {
    // Store current view preference in sessionStorage
    sessionStorage.setItem("viewMode", "user");
    window.location.href = "user_dashboard.html";
  });
}

/**
 * Load admin data
 */
async function loadAdminData() {
  try {
    // Load user data
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      adminName.textContent = userData.fullName || userData.email.split("@")[0];
      
      // Get groups where user is admin
      const groupsRef = collection(db, "groups");
      const q = query(groupsRef, where("createdBy", "==", currentUser.uid));
      const snapshot = await getDocs(q);
      
      adminGroups = [];
      snapshot.forEach(doc => {
        adminGroups.push({ ...doc.data(), groupId: doc.id });
      });
      
      // Also check if admin in any group's admins array
      const allGroupsSnapshot = await getDocs(collection(db, "groups"));
      allGroupsSnapshot.forEach(doc => {
        const groupData = doc.data();
        if (groupData.admins && groupData.admins.some(admin => admin.uid === currentUser.uid)) {
          // Check if not already added
          if (!adminGroups.find(g => g.groupId === doc.id)) {
            adminGroups.push({ ...groupData, groupId: doc.id });
          }
        }
      });
      
      if (adminGroups.length > 0) {
        currentGroup = adminGroups[0];
        
        // Check if profile is completed
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          if (!userData.profileCompleted) {
            // Redirect to profile completion
            window.location.href = "complete_profile.html";
            return;
          }
        }
        
        await loadDashboardStats();
        await loadGroups();
        await loadPendingApprovals();
      } else {
        groupsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📁</div><p>No groups found. Create your first group!</p></div>';
      }
    }
  } catch (error) {
    console.error("Error loading admin data:", error);
    showToast("Error loading admin data: " + error.message, "error");
  }
}

/**
 * Load dashboard statistics
 */
async function loadDashboardStats() {
  try {
    let totalFundsAmount = 0;
    let totalMembersCount = 0;
    let totalCollectionsAmount = 0;
    let activeLoansCount = 0;
    let totalArrearsAmount = 0;
    let pendingApprovalsCount = 0;
    
    for (const group of adminGroups) {
      // Get group statistics
      const groupDoc = await getDoc(doc(db, "groups", group.groupId));
      if (groupDoc.exists()) {
        const groupData = groupDoc.data();
        const stats = groupData.statistics || {};
        
        totalFundsAmount += stats.totalFunds || 0;
        totalMembersCount += stats.totalMembers || 0;
        totalCollectionsAmount += stats.totalCollections || 0;
        activeLoansCount += stats.totalLoansActive || 0;
        totalArrearsAmount += stats.totalArrears || 0;
      }
      
      // Count pending approvals (payments, loans, registrations)
      const currentYear = new Date().getFullYear();
      
      // Pending payments - Query through members since payment structure uses subcollections
      const membersRef = collection(db, "groups", group.groupId, "members");
      const membersSnapshot = await getDocs(membersRef);
      
      for (const memberDoc of membersSnapshot.docs) {
        const userId = memberDoc.id;
        
        // Check Seed Money payments
        const seedMoneyRef = doc(db, `groups/${group.groupId}/payments/${currentYear}_SeedMoney/${userId}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);
        if (seedMoneyDoc.exists() && seedMoneyDoc.data().approvalStatus === "pending") {
          pendingApprovalsCount++;
        }
        
        // Check Monthly Contributions - need to check each month
        const monthlyContributionsRef = collection(db, `groups/${group.groupId}/payments/${currentYear}_MonthlyContributions/${userId}`);
        const monthlySnapshot = await getDocs(monthlyContributionsRef);
        monthlySnapshot.forEach(monthDoc => {
          if (monthDoc.data().approvalStatus === "pending") {
            pendingApprovalsCount++;
          }
        });
      }
      
      // Pending loans
      const loansRef = collection(db, "groups", group.groupId, "loans");
      const pendingLoansQuery = query(loansRef, where("status", "==", "pending"));
      const pendingLoansSnapshot = await getDocs(pendingLoansQuery);
      pendingApprovalsCount += pendingLoansSnapshot.size;
    }
    
    // Update UI (remove totalFunds, totalMembers, totalGroups as they're not in new design)
    totalCollections.textContent = formatCurrency(totalCollectionsAmount);
    activeLoans.textContent = activeLoansCount;
    pendingApprovals.textContent = pendingApprovalsCount;
    totalArrears.textContent = formatCurrency(totalArrearsAmount);
    
  } catch (error) {
    console.error("Error loading dashboard stats:", error);
  }
}

/**
 * Load groups list
 */
async function loadGroups() {
  try {
    if (adminGroups.length === 0) {
      groupsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📁</div><p>No groups found</p></div>';
      return;
    }
    
    groupsList.innerHTML = "";
    
    adminGroups.forEach(group => {
      const groupCard = document.createElement("a");
      groupCard.className = "group-card";
      groupCard.href = `group_details.html?groupId=${group.groupId}`;
      
      const stats = group.statistics || {};
      
      groupCard.innerHTML = `
        <h4>${group.groupName}</h4>
        <div class="group-info">
          <span>👥 ${stats.totalMembers || 0} members</span>
          <span>💰 ${formatCurrency(stats.totalFunds || 0)}</span>
        </div>
      `;
      
      groupsList.appendChild(groupCard);
    });
  } catch (error) {
    console.error("Error loading groups:", error);
  }
}

/**
 * Load pending approvals
 */
async function loadPendingApprovals() {
  try {
    const allPending = [];
    
    for (const group of adminGroups) {
      // Get pending loan requests
      const loansRef = collection(db, "groups", group.groupId, "loans");
      const pendingLoansQuery = query(loansRef, where("status", "==", "pending"), limit(5));
      const loansSnapshot = await getDocs(pendingLoansQuery);
      
      loansSnapshot.forEach(doc => {
        allPending.push({
          ...doc.data(),
          id: doc.id,
          type: "loan",
          groupId: group.groupId,
          groupName: group.groupName
        });
      });
      
      // Get pending payment approvals - Query through members
      const currentYear = new Date().getFullYear();
      const membersRef = collection(db, "groups", group.groupId, "members");
      const membersSnapshot = await getDocs(membersRef);
      
      for (const memberDoc of membersSnapshot.docs) {
        const userId = memberDoc.id;
        const memberData = memberDoc.data();
        
        // Check Seed Money payments
        try {
          const seedMoneyRef = doc(db, `groups/${group.groupId}/payments/${currentYear}_SeedMoney/${userId}/PaymentDetails`);
          const seedMoneyDoc = await getDoc(seedMoneyRef);
          if (seedMoneyDoc.exists()) {
            const paymentData = seedMoneyDoc.data();
            if (paymentData.approvalStatus === "pending") {
              allPending.push({
                ...paymentData,
                id: seedMoneyRef.id,
                type: "payment",
                paymentType: "Seed Money",
                memberName: memberData.fullName,
                memberId: userId,
                groupId: group.groupId,
                groupName: group.groupName
              });
            }
          }
        } catch (error) {
          // Payment document doesn't exist yet
        }
        
        // Check Monthly Contributions
        try {
          const monthlyContributionsRef = collection(db, `groups/${group.groupId}/payments/${currentYear}_MonthlyContributions/${userId}`);
          const monthlySnapshot = await getDocs(monthlyContributionsRef);
          monthlySnapshot.forEach(monthDoc => {
            const paymentData = monthDoc.data();
            if (paymentData.approvalStatus === "pending") {
              allPending.push({
                ...paymentData,
                id: monthDoc.id,
                type: "payment",
                paymentType: "Monthly Contribution",
                memberName: memberData.fullName,
                memberId: userId,
                groupId: group.groupId,
                groupName: group.groupName
              });
            }
          });
        } catch (error) {
          // Payment collection doesn't exist yet
        }
      }
    }
    
    if (allPending.length > 0) {
      pendingBadge.textContent = allPending.length;
      pendingBadge.classList.remove("hidden");
      pendingApprovalsList.innerHTML = "";
      
      // Show first 5
      allPending.slice(0, 5).forEach(item => {
        const approvalElement = createApprovalElement(item);
        pendingApprovalsList.appendChild(approvalElement);
      });
    } else {
      pendingBadge.classList.add("hidden");
    }
  } catch (error) {
    console.error("Error loading pending approvals:", error);
  }
}

/**
 * Create approval element
 */
function createApprovalElement(item) {
  const div = document.createElement("div");
  div.className = "approval-item";
  
  let title, subtitle;
  if (item.type === "loan") {
    title = `Loan Request - ${item.borrowerName}`;
    subtitle = `${formatCurrency(item.loanAmount)} • ${item.groupName}`;
  } else {
    title = `Payment Approval - ${item.fullName}`;
    subtitle = `${item.paymentType} • ${formatCurrency(item.totalAmount)}`;
  }
  
  div.innerHTML = `
    <div class="approval-header">
      <div class="approval-info">
        <h4>${title}</h4>
        <p>${subtitle}</p>
      </div>
    </div>
    <div class="approval-actions">
      <button class="btn btn-sm btn-approve" data-id="${item.id}" data-type="${item.type}" data-group="${item.groupId}">
        Approve
      </button>
      <button class="btn btn-sm btn-reject" data-id="${item.id}" data-type="${item.type}" data-group="${item.groupId}">
        Reject
      </button>
    </div>
  `;
  
  // Add event listeners
  const approveBtn = div.querySelector(".btn-approve");
  const rejectBtn = div.querySelector(".btn-reject");
  
  approveBtn.addEventListener("click", () => handleApproval(item, true));
  rejectBtn.addEventListener("click", () => handleApproval(item, false));
  
  return div;
}

/**
 * Handle approval/rejection
 */
async function handleApproval(item, approve) {
  try {
    showSpinner(true);
    
    if (item.type === "loan") {
      const loanRef = doc(db, "groups", item.groupId, "loans", item.id);
      await updateDoc(loanRef, {
        status: approve ? "approved" : "rejected",
        approvedBy: currentUser.uid,
        approvedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    } else if (item.type === "payment") {
      // Update payment approval status
      const paymentRef = doc(db, "groups", item.groupId, "payments", item.paymentType, item.userId, item.id);
      const updateData = {
        approvalStatus: approve ? "approved" : "rejected",
        approvedBy: currentUser.uid,
        approvedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };
      
      // Automatically set status to completed when approved
      if (approve) {
        updateData.paymentStatus = "completed";
        updateData.status = "completed";
      }
      
      await updateDoc(paymentRef, updateData);
    }
    
    showToast(`Successfully ${approve ? "approved" : "rejected"}`, "success");
    await loadPendingApprovals();
    await loadDashboardStats();
    
  } catch (error) {
    console.error("Error handling approval:", error);
    showToast("Error processing approval: " + error.message, "error");
  } finally {
    showSpinner(false);
  }
}

/**
 * Show/Hide Spinner
 */
function showSpinner(show) {
  if (show) {
    spinner?.classList.remove("hidden");
  } else {
    spinner?.classList.add("hidden");
  }
}

/**
 * Show toast notification
 */
function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer") || document.body;
  
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  container.appendChild(toast);
  
  // Auto remove after 4 seconds
  setTimeout(() => {
    toast.classList.add("toast-exit");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/**
 * Format currency
 */
function formatCurrency(amount) {
  return `MWK ${parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format date
 */
function formatDate(timestamp) {
  if (!timestamp) return "N/A";
  
  let date;
  if (timestamp.toDate) {
    date = timestamp.toDate();
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else {
    date = new Date(timestamp);
  }
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
