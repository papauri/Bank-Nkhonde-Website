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
  orderBy,
  onAuthStateChanged,
  signOut,
  Timestamp,
} from "./firebaseConfig.js";

// Import search and notification handlers
import { initializeSearch } from "./dashboard-search.js";
import { initializeNotifications } from "./notifications-handler.js";

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
const groupSelectionOverlay = document.getElementById("groupSelectionOverlay");
const groupSelectionList = document.getElementById("groupSelectionList");

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
  
  // Initialize currency selector
  const currencySelector = document.getElementById('currencySelector');
  if (currencySelector) {
    const savedCurrency = localStorage.getItem('selectedCurrency') || 'MWK';
    currencySelector.value = savedCurrency;
    currencySelector.addEventListener('change', (e) => {
      localStorage.setItem('selectedCurrency', e.target.value);
      // Reload to apply currency
      window.location.reload();
    });
  }
  
  // Initialize search
  const searchInput = document.querySelector('.topbar-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.trim();
      if (searchTerm.length >= 2) {
        const selectedGroupId = sessionStorage.getItem('selectedGroupId');
        if (selectedGroupId) {
          performDashboardSearch(searchTerm, selectedGroupId);
        }
      }
    });
  }
});

// Expose selectGroup to global scope for onclick
window.selectGroup = function(groupId) {
  sessionStorage.setItem('selectedGroupId', groupId);
  currentGroup = adminGroups.find(g => g.groupId === groupId);
  hideGroupSelectionOverlay();
  loadDashboardAfterGroupSelection();
  // Initialize notifications for this group
  initializeDashboardNotifications();
};

// Expose switchGroup to global scope
window.switchGroup = function(groupId) {
  sessionStorage.setItem('selectedGroupId', groupId);
  window.location.reload();
};

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
    
    // Load admin groups first
    await loadAdminGroups();
    
    if (adminGroups.length === 0) {
      hideGroupSelectionOverlay();
      renderEmptyState();
      return;
    }
    
    // Get selected group from session
    const selectedGroupId = sessionStorage.getItem('selectedGroupId');
    
    // Check if we have a valid selected group
    if (selectedGroupId && adminGroups.find(g => g.groupId === selectedGroupId)) {
      // Group already selected, hide overlay and load dashboard
      currentGroup = adminGroups.find(g => g.groupId === selectedGroupId);
      hideGroupSelectionOverlay();
      await loadDashboardAfterGroupSelection();
      // Initialize notifications
      initializeDashboardNotifications();
    } else {
      // Show group selection overlay
      showGroupSelectionOverlay();
    }
    
  } catch (error) {
    console.error("Error loading admin data:", error);
    showToast("Error loading dashboard: " + error.message, "danger");
  }
}

// Show group selection overlay
function showGroupSelectionOverlay() {
  if (!groupSelectionOverlay) return;
  
  groupSelectionOverlay.classList.remove("hidden");
  renderGroupSelectionCards();
}

// Hide group selection overlay
function hideGroupSelectionOverlay() {
  if (!groupSelectionOverlay) return;
  
  groupSelectionOverlay.classList.add("hidden");
}

// Render group selection cards
async function renderGroupSelectionCards() {
  if (!groupSelectionList) return;
  
  if (adminGroups.length === 0) {
    groupSelectionList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📁</div>
        <p class="empty-state-text">You don't manage any groups yet</p>
      </div>
    `;
    return;
  }
  
  let cardsHTML = '';
  
  for (const group of adminGroups) {
    // Get pending counts for this group
    let pendingCount = 0;
    
    try {
      // Count pending loans
      const loansRef = collection(db, "groups", group.groupId, "loans");
      const pendingLoansQuery = query(loansRef, where("status", "==", "pending"));
      const pendingLoansSnapshot = await getDocs(pendingLoansQuery);
      pendingCount += pendingLoansSnapshot.size;
      
      // Count pending payments
      const membersRef = collection(db, "groups", group.groupId, "members");
      const membersSnapshot = await getDocs(membersRef);
      const memberCount = membersSnapshot.size;
      
      // TODO: Add payment pending count if needed
    } catch (e) {
      console.error("Error getting pending count:", e);
    }
    
    const stats = group.statistics || {};
    const memberCount = stats.totalMembers || 0;
    
    cardsHTML += `
      <div class="group-selection-card" onclick="selectGroup('${group.groupId}')">
        <div class="group-selection-icon">
          ${group.groupName ? group.groupName.charAt(0).toUpperCase() : 'G'}
        </div>
        <div class="group-selection-info">
          <div class="group-selection-name">${group.groupName || 'Unnamed Group'}</div>
          <div class="group-selection-meta">
            <span>${memberCount} members</span>
            <span>${group.cycleLength || 11} month cycle</span>
          </div>
        </div>
        <div class="group-selection-badge">
          ${pendingCount > 0 ? `<span class="group-selection-pending">${pendingCount} pending</span>` : ''}
          <svg class="group-selection-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>
    `;
  }
  
  groupSelectionList.innerHTML = cardsHTML;
}

// Load dashboard after group selection
async function loadDashboardAfterGroupSelection() {
  await Promise.all([
    loadDashboardStats(),
    loadGroups(),
    loadPendingApprovals()
  ]);
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
    const monthlyCollections = {};
    
    // Calculate stats for current group or all groups
    const groupsToProcess = currentGroup ? [currentGroup] : adminGroups;
    const currentYear = new Date().getFullYear();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    // Initialize monthly collections
    months.forEach(month => { monthlyCollections[month] = 0; });
    
    for (const group of groupsToProcess) {
      const groupId = group.groupId;
      
      // Get members
      const membersRef = collection(db, "groups", groupId, "members");
      const membersSnapshot = await getDocs(membersRef);
      const memberIds = membersSnapshot.docs.map(d => d.id);
      
      // Calculate actual collections from payments
      for (const userId of memberIds) {
        // Seed Money collections
        try {
          const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${userId}/PaymentDetails`);
          const seedMoneyDoc = await getDoc(seedMoneyRef);
          if (seedMoneyDoc.exists()) {
            const data = seedMoneyDoc.data();
            totalCollectionsAmount += parseFloat(data.amountPaid || 0);
            totalArrearsAmount += parseFloat(data.arrears || 0);
            if (data.approvalStatus === "pending") pendingApprovalsCount++;
          }
        } catch (e) {}
        
        // Monthly contributions
        try {
          const monthlyRef = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${userId}`);
          const monthlySnapshot = await getDocs(monthlyRef);
          monthlySnapshot.forEach(monthDoc => {
            const data = monthDoc.data();
            const amountPaid = parseFloat(data.amountPaid || 0);
            totalCollectionsAmount += amountPaid;
            totalArrearsAmount += parseFloat(data.arrears || 0);
            
            // Track monthly collections for chart
            const month = data.month;
            if (month && monthlyCollections[month] !== undefined) {
              monthlyCollections[month] += amountPaid;
            }
            
            if (data.approvalStatus === "pending") pendingApprovalsCount++;
          });
        } catch (e) {}
      }
      
      // Count active loans
      try {
        const loansRef = collection(db, "groups", groupId, "loans");
        const activeLoansQuery = query(loansRef, where("status", "==", "active"));
        const activeLoansSnapshot = await getDocs(activeLoansQuery);
        activeLoansCount += activeLoansSnapshot.size;
        
        // Add loan interest to collections
        activeLoansSnapshot.forEach(loanDoc => {
          const loan = loanDoc.data();
          totalCollectionsAmount += parseFloat(loan.interestEarned || 0);
        });
        
        // Pending loans
        const pendingLoansQuery = query(loansRef, where("status", "==", "pending"));
        const pendingLoansSnapshot = await getDocs(pendingLoansQuery);
        pendingApprovalsCount += pendingLoansSnapshot.size;
      } catch (e) {}
    }
    
    // Update UI safely
    if (totalCollections) totalCollections.textContent = formatCurrency(totalCollectionsAmount);
    if (activeLoans) activeLoans.textContent = activeLoansCount;
    if (pendingApprovals) pendingApprovals.textContent = pendingApprovalsCount;
    if (totalArrears) totalArrears.textContent = formatCurrency(totalArrearsAmount);
    
    // Render collection trends chart
    renderCollectionTrends(monthlyCollections);
    
  } catch (error) {
    console.error("Error loading dashboard stats:", error);
  }
}

// Render collection trends chart - starting from group's first month
function renderCollectionTrends(monthlyData) {
  const chartContainer = document.querySelector('.chart-container');
  if (!chartContainer) return;
  
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const currentMonth = new Date().getMonth();
  
  // Get group start date if available
  let startMonth = 0;
  if (currentGroup) {
    const cycleStartDate = currentGroup.rules?.cycleDuration?.startDate || 
                           currentGroup.cycleStartDate ||
                           currentGroup.createdAt?.toDate?.();
    if (cycleStartDate) {
      const startDate = new Date(cycleStartDate);
      if (!isNaN(startDate.getTime())) {
        startMonth = startDate.getMonth();
      }
    }
  }
  
  // Calculate months since group started (up to current month)
  const monthsSinceStart = [];
  let monthIndex = startMonth;
  const today = new Date();
  const currentMonthIndex = today.getMonth();
  
  // Get months from start to current (max 6 for display)
  let count = 0;
  while (count < 6) {
    const displayMonth = (currentMonth - 5 + count + 12) % 12;
    // Only show months from start date onwards
    const monthName = months[displayMonth];
    const amount = monthlyData[monthName] || 0;
    
    monthsSinceStart.push({
      name: monthName.substring(0, 3),
      fullName: monthName,
      amount: amount,
      hasData: amount > 0
    });
    count++;
  }
  
  const last6Months = monthsSinceStart;
  
  // Find max for scaling
  const maxAmount = Math.max(...last6Months.map(m => m.amount), 1);
  
  let chartHTML = '';
  last6Months.forEach(month => {
    const heightPercent = Math.max((month.amount / maxAmount) * 100, 5);
    chartHTML += `
      <div class="chart-bar-wrapper">
        <div class="chart-bar" style="height: 200px; --bar-height: ${heightPercent}%;" title="${formatCurrency(month.amount)}"></div>
        <span class="chart-label">${month.name}</span>
      </div>
    `;
  });
  
  chartContainer.innerHTML = chartHTML;
  
  // Animate bars
  setTimeout(() => {
    chartContainer.querySelectorAll('.chart-bar').forEach(bar => {
      bar.classList.add('animated');
    });
  }, 100);
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

// Dashboard search functionality
async function performDashboardSearch(searchTerm, groupId) {
  if (!groupId || searchTerm.length < 2) return;
  
  const searchLower = searchTerm.toLowerCase();
  const searchResults = [];
  
  try {
    // Search members
    const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
    membersSnapshot.forEach(doc => {
      const member = doc.data();
      const name = (member.fullName || '').toLowerCase();
      const email = (member.email || '').toLowerCase();
      
      if (name.includes(searchLower) || email.includes(searchLower)) {
        searchResults.push({
          id: doc.id,
          type: 'member',
          name: member.fullName,
          email: member.email
        });
      }
    });
    
    // Search loans
    const loansSnapshot = await getDocs(collection(db, `groups/${groupId}/loans`));
    loansSnapshot.forEach(doc => {
      const loan = doc.data();
      const borrowerName = (loan.borrowerName || '').toLowerCase();
      
      if (borrowerName.includes(searchLower)) {
        searchResults.push({
          id: doc.id,
          type: 'loan',
          name: loan.borrowerName,
          amount: loan.loanAmount
        });
      }
    });
    
    displaySearchResults(searchResults);
  } catch (error) {
    console.error('Search error:', error);
  }
}

function displaySearchResults(results) {
  // Create or get search results container
  let container = document.getElementById('searchResultsDropdown');
  const searchInput = document.querySelector('.topbar-search-input');
  
  if (!container && searchInput) {
    container = document.createElement('div');
    container.id = 'searchResultsDropdown';
    container.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: white;
      border: 1px solid var(--bn-gray-lighter);
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.15);
      max-height: 400px;
      overflow-y: auto;
      z-index: 1000;
      margin-top: 4px;
    `;
    searchInput.parentElement.style.position = 'relative';
    searchInput.parentElement.appendChild(container);
    
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !container.contains(e.target)) {
        container.style.display = 'none';
      }
    });
  }
  
  if (!container) return;
  
  if (results.length === 0) {
    container.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--bn-gray);">No results found</div>';
  } else {
    container.innerHTML = results.slice(0, 10).map(result => `
      <a href="${result.type === 'member' ? 'manage_members.html' : 'manage_loans.html'}?search=${encodeURIComponent(result.name)}" 
         style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; text-decoration: none; color: inherit; border-bottom: 1px solid var(--bn-gray-lighter);">
        <div style="width: 32px; height: 32px; border-radius: 50%; background: ${result.type === 'member' ? 'var(--bn-primary)' : 'var(--bn-accent)'}; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 12px;">
          ${result.type === 'member' ? result.name.charAt(0) : '💰'}
        </div>
        <div style="flex: 1;">
          <div style="font-weight: 600; color: var(--bn-dark);">${result.name}</div>
          <div style="font-size: 12px; color: var(--bn-gray);">${result.type === 'member' ? (result.email || 'Member') : 'Loan: MWK ' + (result.amount || 0).toLocaleString()}</div>
        </div>
      </a>
    `).join('');
  }
  
  container.style.display = 'block';
}

// Initialize notifications when dashboard loads
function initializeDashboardNotifications() {
  const selectedGroupId = sessionStorage.getItem('selectedGroupId');
  if (currentUser && selectedGroupId) {
    initializeNotifications(currentUser.uid, selectedGroupId);
  }
}
