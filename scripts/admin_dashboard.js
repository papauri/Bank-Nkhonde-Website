import {
  db,
  auth,
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  limit,
  onAuthStateChanged,
  signOut,
  Timestamp,
} from "./firebaseConfig.js";

// Global state
let currentUser = null;
let currentGroup = null;
let adminGroups = [];

// DOM Elements - with null checks
const spinner = document.getElementById("spinner");
const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserInitials = document.getElementById("sidebarUserInitials");
const topbarUserInitials = document.getElementById("topbarUserInitials");
const totalCollections = document.getElementById("totalCollections");
const activeLoans = document.getElementById("activeLoans");
const pendingApprovals = document.getElementById("pendingApprovals");
const totalArrears = document.getElementById("totalArrears");
const pendingApprovalsList = document.getElementById("pendingApprovalsList");
const groupsList = document.getElementById("groupsList");
const systemAlerts = document.getElementById("systemAlerts");

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
    window.location.href = "../login.html";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
});

function setupEventListeners() {
  // Logout button in sidebar
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  
  // Switch to user view button
  document.getElementById("switchViewBtn")?.addEventListener("click", () => {
    sessionStorage.setItem("viewMode", "user");
    window.location.href = "user_dashboard.html";
  });
  
  // Sidebar user click (for dropdown menu)
  document.getElementById("sidebarUser")?.addEventListener("click", (e) => {
    // Could open a dropdown menu here
  });
}

async function handleLogout() {
  try {
    await signOut(auth);
    sessionStorage.clear();
    window.location.href = "../login.html";
  } catch (error) {
    console.error("Error signing out:", error);
    showToast("Error signing out: " + error.message, "danger");
  }
}

async function loadAdminData() {
  try {
    // Load user data
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      const displayName = userData.fullName || currentUser.email.split("@")[0];
      
      // Update UI elements safely
      if (sidebarUserName) sidebarUserName.textContent = displayName;
      if (sidebarUserInitials) sidebarUserInitials.textContent = displayName.charAt(0).toUpperCase();
      if (topbarUserInitials) topbarUserInitials.textContent = displayName.charAt(0).toUpperCase();
      
      // Load profile picture if available
      if (userData.profileImageUrl) {
        const sidebarProfilePic = document.getElementById("sidebarProfilePic");
        const topbarProfilePic = document.getElementById("topbarProfilePic");
        
        if (sidebarProfilePic) {
          sidebarProfilePic.src = userData.profileImageUrl;
          sidebarProfilePic.style.display = "block";
          if (sidebarUserInitials) sidebarUserInitials.style.display = "none";
        }
        if (topbarProfilePic) {
          topbarProfilePic.src = userData.profileImageUrl;
          topbarProfilePic.style.display = "block";
          if (topbarUserInitials) topbarUserInitials.style.display = "none";
        }
      }
      
      // Check if profile is completed
      if (!userData.profileCompleted) {
        window.location.href = "complete_profile.html";
        return;
      }
    }
    
    // Get selected group from session or load all groups
    const selectedGroupId = sessionStorage.getItem('selectedGroupId');
    
    // Load admin groups
    await loadAdminGroups();
    
    if (adminGroups.length === 0) {
      renderEmptyState();
      return;
    }
    
    // Set current group
    if (selectedGroupId) {
      currentGroup = adminGroups.find(g => g.groupId === selectedGroupId) || adminGroups[0];
    } else {
      currentGroup = adminGroups[0];
    }
    
    // Store the selected group
    sessionStorage.setItem('selectedGroupId', currentGroup.groupId);
    
    // Load dashboard data
    await Promise.all([
      loadDashboardStats(),
      loadGroups(),
      loadPendingApprovals()
    ]);
    
  } catch (error) {
    console.error("Error loading admin data:", error);
    showToast("Error loading dashboard: " + error.message, "danger");
  }
}

async function loadAdminGroups() {
  adminGroups = [];
  
  // Get groups where user is creator
  const groupsRef = collection(db, "groups");
  const creatorQuery = query(groupsRef, where("createdBy", "==", currentUser.uid));
  const creatorSnapshot = await getDocs(creatorQuery);
  
  creatorSnapshot.forEach(doc => {
    adminGroups.push({ ...doc.data(), groupId: doc.id });
  });
  
  // Also check admins array in all groups
  const allGroupsSnapshot = await getDocs(collection(db, "groups"));
  allGroupsSnapshot.forEach(doc => {
    const groupData = doc.data();
    if (groupData.admins?.some(admin => admin.uid === currentUser.uid)) {
      if (!adminGroups.find(g => g.groupId === doc.id)) {
        adminGroups.push({ ...groupData, groupId: doc.id });
      }
    }
  });
}

async function loadDashboardStats() {
  try {
    let totalCollectionsAmount = 0;
    let activeLoansCount = 0;
    let totalArrearsAmount = 0;
    let pendingApprovalsCount = 0;
    
    // Calculate stats for current group or all groups
    const groupsToProcess = currentGroup ? [currentGroup] : adminGroups;
    
    for (const group of groupsToProcess) {
      const groupDoc = await getDoc(doc(db, "groups", group.groupId));
      if (groupDoc.exists()) {
        const groupData = groupDoc.data();
        const stats = groupData.statistics || {};
        
        totalCollectionsAmount += stats.totalCollections || 0;
        activeLoansCount += stats.totalLoansActive || 0;
        totalArrearsAmount += stats.totalArrears || 0;
      }
      
      // Count pending approvals
      const currentYear = new Date().getFullYear();
      const membersRef = collection(db, "groups", group.groupId, "members");
      const membersSnapshot = await getDocs(membersRef);
      
      for (const memberDoc of membersSnapshot.docs) {
        const userId = memberDoc.id;
        
        // Check pending payments
        try {
          const seedMoneyRef = doc(db, `groups/${group.groupId}/payments/${currentYear}_SeedMoney/${userId}/PaymentDetails`);
          const seedMoneyDoc = await getDoc(seedMoneyRef);
          if (seedMoneyDoc.exists() && seedMoneyDoc.data().approvalStatus === "pending") {
            pendingApprovalsCount++;
          }
        } catch (e) {}
        
        try {
          const monthlyRef = collection(db, `groups/${group.groupId}/payments/${currentYear}_MonthlyContributions/${userId}`);
          const monthlySnapshot = await getDocs(monthlyRef);
          monthlySnapshot.forEach(monthDoc => {
            if (monthDoc.data().approvalStatus === "pending") {
              pendingApprovalsCount++;
            }
          });
        } catch (e) {}
      }
      
      // Pending loans
      const loansRef = collection(db, "groups", group.groupId, "loans");
      const pendingLoansQuery = query(loansRef, where("status", "==", "pending"));
      const pendingLoansSnapshot = await getDocs(pendingLoansQuery);
      pendingApprovalsCount += pendingLoansSnapshot.size;
    }
    
    // Update UI safely
    if (totalCollections) totalCollections.textContent = formatCurrency(totalCollectionsAmount);
    if (activeLoans) activeLoans.textContent = activeLoansCount;
    if (pendingApprovals) pendingApprovals.textContent = pendingApprovalsCount;
    if (totalArrears) totalArrears.textContent = formatCurrency(totalArrearsAmount);
    
  } catch (error) {
    console.error("Error loading dashboard stats:", error);
  }
}

async function loadGroups() {
  if (!groupsList) return;
  
  if (adminGroups.length === 0) {
    renderEmptyState();
    return;
  }
  
  groupsList.innerHTML = adminGroups.map(group => {
    const stats = group.statistics || {};
    const isSelected = currentGroup && currentGroup.groupId === group.groupId;
    
    return `
      <a href="javascript:void(0)" class="group-card ${isSelected ? 'selected' : ''}" onclick="switchGroup('${group.groupId}')">
        <h4 class="group-name">${group.groupName || 'Unnamed Group'}</h4>
        <div class="group-stats">
          <div class="group-stat-item">
            <div class="group-stat-value">${stats.totalMembers || 0}</div>
            <div class="group-stat-label">Members</div>
          </div>
          <div class="group-stat-item">
            <div class="group-stat-value">${formatCurrencyShort(stats.totalFunds || 0)}</div>
            <div class="group-stat-label">Funds</div>
          </div>
        </div>
      </a>
    `;
  }).join('');
}

async function loadPendingApprovals() {
  if (!pendingApprovalsList) return;
  
  const allPending = [];
  const groupsToProcess = currentGroup ? [currentGroup] : adminGroups;
  
  for (const group of groupsToProcess) {
    // Pending loans
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
    
    // Pending payments
    const currentYear = new Date().getFullYear();
    const membersRef = collection(db, "groups", group.groupId, "members");
    const membersSnapshot = await getDocs(membersRef);
    
    for (const memberDoc of membersSnapshot.docs) {
      const userId = memberDoc.id;
      const memberData = memberDoc.data();
      
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
      } catch (e) {}
    }
  }
  
  if (allPending.length === 0) {
    pendingApprovalsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <p class="empty-state-text">No pending approvals</p>
      </div>
    `;
    return;
  }
  
  pendingApprovalsList.innerHTML = allPending.slice(0, 5).map(item => {
    const title = item.type === "loan" 
      ? `Loan - ${item.borrowerName || 'Member'}` 
      : `Payment - ${item.memberName || 'Member'}`;
    const amount = item.type === "loan" ? item.loanAmount : item.totalAmount;
    
    return `
      <div class="approval-item">
        <div class="approval-avatar">${(item.borrowerName || item.memberName || 'M').charAt(0)}</div>
        <div class="approval-info">
          <div class="approval-name">${title}</div>
          <div class="approval-detail">${item.groupName}</div>
        </div>
        <div>
          <div class="approval-amount">${formatCurrencyShort(amount || 0)}</div>
          <div class="approval-type">${item.type}</div>
        </div>
        <div class="approval-actions">
          <button class="approval-btn approval-btn-approve" onclick="handleApproval('${item.id}', '${item.type}', '${item.groupId}', true)" title="Approve">✓</button>
          <button class="approval-btn approval-btn-reject" onclick="handleApproval('${item.id}', '${item.type}', '${item.groupId}', false)" title="Reject">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderEmptyState() {
  if (groupsList) {
    groupsList.innerHTML = `
      <div class="empty-state" style="grid-column: span 3;">
        <div class="empty-state-icon">📁</div>
        <p class="empty-state-text">No groups found. Create your first group!</p>
        <a href="admin_registration.html" class="btn btn-accent btn-sm" style="margin-top: var(--bn-space-4);">Create Group</a>
      </div>
    `;
  }
}

// Global functions for onclick handlers
window.switchGroup = async function(groupId) {
  currentGroup = adminGroups.find(g => g.groupId === groupId);
  if (currentGroup) {
    sessionStorage.setItem('selectedGroupId', groupId);
    showSpinner(true);
    await Promise.all([
      loadDashboardStats(),
      loadGroups(),
      loadPendingApprovals()
    ]);
    showSpinner(false);
    showToast(`Switched to ${currentGroup.groupName}`, "success");
  }
};

window.handleApproval = async function(itemId, type, groupId, approve) {
  try {
    showSpinner(true);
    
    if (type === "loan") {
      const loanRef = doc(db, "groups", groupId, "loans", itemId);
      await updateDoc(loanRef, {
        status: approve ? "approved" : "rejected",
        approvedBy: currentUser.uid,
        approvedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    }
    
    showToast(`Successfully ${approve ? "approved" : "rejected"}`, "success");
    
    // Add system alert
    addSystemAlert(`${type === 'loan' ? 'Loan' : 'Payment'} ${approve ? 'approved' : 'rejected'}`, approve ? 'success' : 'warning');
    
    await Promise.all([
      loadDashboardStats(),
      loadPendingApprovals()
    ]);
    
  } catch (error) {
    console.error("Error handling approval:", error);
    showToast("Error: " + error.message, "danger");
  } finally {
    showSpinner(false);
  }
};

function addSystemAlert(message, type = 'success') {
  if (!systemAlerts) return;
  
  const icons = { success: '✓', warning: '⚠', danger: '✕', info: 'ℹ' };
  const alert = document.createElement('div');
  alert.className = `alert-item ${type}`;
  alert.innerHTML = `
    <div class="alert-icon">${icons[type] || icons.info}</div>
    <div class="alert-content">
      <div class="alert-title">${message}</div>
      <div class="alert-time">Just now</div>
    </div>
    <button class="alert-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  systemAlerts.insertBefore(alert, systemAlerts.firstChild);
  
  setTimeout(() => {
    if (alert.parentElement) {
      alert.style.opacity = '0';
      alert.style.transform = 'translateX(100%)';
      setTimeout(() => alert.remove(), 300);
    }
  }, 10000);
}

function showSpinner(show) {
  if (show) {
    spinner?.classList.remove("hidden");
  } else {
    spinner?.classList.add("hidden");
  }
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  
  const icons = { success: '✓', warning: '⚠', danger: '✕', info: 'ℹ' };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.style.cssText = `
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.15);
    border-left: 4px solid ${type === 'success' ? '#10b981' : type === 'danger' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
    animation: slideInRight 0.3s ease-out;
  `;
  
  toast.innerHTML = `
    <span style="font-size: 1.25rem;">${icons[type] || icons.info}</span>
    <span style="flex: 1; font-size: 0.875rem; color: #1e293b;">${message}</span>
    <button onclick="this.parentElement.remove()" style="background: none; border: none; cursor: pointer; color: #94a3b8; font-size: 1.25rem;">×</button>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function formatCurrency(amount) {
  return `MWK ${parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatCurrencyShort(amount) {
  const num = parseFloat(amount || 0);
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
  return num.toLocaleString();
}
