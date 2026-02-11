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

// Initialize appJ
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
  updateCurrentDate();
  
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
  
  // Initialize search - Enhanced to work even without group selected
  const searchInput = document.querySelector('.topbar-search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const searchTerm = e.target.value.trim();
      
      if (searchTerm.length >= 2) {
        debounceTimer = setTimeout(() => {
          const selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
          performDashboardSearch(searchTerm, selectedGroupId); // Can work without groupId for groups search
        }, 300); // Debounce for better performance
      } else {
        const container = document.getElementById('searchResultsDropdown');
        if (container) container.style.display = 'none';
      }
    });
    
    // Show results on focus if there's a search term
    searchInput.addEventListener('focus', () => {
      const searchTerm = searchInput.value.trim();
      if (searchTerm.length >= 2) {
        const selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
          performDashboardSearch(searchTerm, selectedGroupId);
      }
    });
  }
});

// Expose selectGroup to global scope for onclick
window.selectGroup = function(groupId) {
  // Store in both localStorage and sessionStorage for persistence
  localStorage.setItem('selectedGroupId', groupId);
  sessionStorage.setItem('selectedGroupId', groupId);
  currentGroup = adminGroups.find(g => g.groupId === groupId);
  hideGroupSelectionOverlay();
  loadDashboardAfterGroupSelection();
  // Update URL with groupId
  updateURLWithGroup(groupId);
  // Update topbar with group name
  updateTopbarGroupName();
  // Update mobile nav user view option
  updateMobileNavUserView();
  // Initialize notifications for this group
  initializeDashboardNotifications();
};

// Expose switchGroup to global scope
window.switchGroup = function(groupId) {
  localStorage.setItem('selectedGroupId', groupId);
  sessionStorage.setItem('selectedGroupId', groupId);
  window.location.reload();
};

function setupEventListeners() {
  // Logout button in sidebar (from dropdown menu)
  document.getElementById("logoutBtnSidebar")?.addEventListener("click", handleLogout);
  
  // Legacy logout button if exists
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  
  // Switch to user view button
  document.getElementById("switchViewBtn")?.addEventListener("click", () => {
    localStorage.setItem("viewMode", "user");
    sessionStorage.setItem("viewMode", "user");
    window.location.href = "user_dashboard.html";
  });
  
  // Switch to user view in mobile nav
  const switchToUserViewMobile = document.getElementById("switchToUserViewMobile");
  if (switchToUserViewMobile) {
    switchToUserViewMobile.addEventListener("click", (e) => {
      e.preventDefault();
      localStorage.setItem("viewMode", "user");
      sessionStorage.setItem("viewMode", "user");
      window.location.href = "user_dashboard.html";
    });
  }
  
  // Sidebar user click (for dropdown menu)
  const sidebarUser = document.getElementById("sidebarUser");
  if (sidebarUser) {
    sidebarUser.addEventListener("click", (e) => {
      // Don't open menu if clicking on links/buttons inside
      if (e.target.closest('a') || e.target.closest('button')) {
        return;
      }
      e.stopPropagation();
      toggleUserMenu();
    });
  }
  
  // Close user menu when clicking outside
  document.addEventListener("click", (e) => {
    const userMenu = document.getElementById("userMenuDropdown");
    const sidebarUser = document.getElementById("sidebarUser");
    if (userMenu && sidebarUser && !sidebarUser.contains(e.target) && !userMenu.contains(e.target)) {
      userMenu.classList.remove("show");
    }
  });
}

// Toggle user menu dropdown
function toggleUserMenu() {
  const userMenu = document.getElementById("userMenuDropdown");
  if (userMenu) {
    userMenu.classList.toggle("show");
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    // Clear session data selectively
    sessionStorage.removeItem('selectedGroupId');
    sessionStorage.removeItem('isAdmin');
    sessionStorage.removeItem('viewMode');
    sessionStorage.removeItem('userRole');
    localStorage.removeItem('selectedGroupId');
    localStorage.removeItem('userEmail');
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
    
    // Update mobile nav user view option
    updateMobileNavUserView();
    
    if (adminGroups.length === 0) {
      hideGroupSelectionOverlay();
      renderEmptyState();
      return;
    }
    
    // Get selected group from URL, localStorage, or sessionStorage (in that order)
    const urlParams = new URLSearchParams(window.location.search);
    const urlGroupId = urlParams.get('groupId');
    let selectedGroupId = urlGroupId || localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
    
    // If we have a groupId from URL or localStorage, save it to both storages
    if (urlGroupId || selectedGroupId) {
      const groupToSave = urlGroupId || selectedGroupId;
      localStorage.setItem('selectedGroupId', groupToSave);
      sessionStorage.setItem('selectedGroupId', groupToSave);
    }
    
    // Auto-select first group if none is selected but user has groups
    if (!selectedGroupId && adminGroups.length > 0) {
      selectedGroupId = adminGroups[0].groupId;
      localStorage.setItem('selectedGroupId', selectedGroupId);
      sessionStorage.setItem('selectedGroupId', selectedGroupId);
    }
    
    // Check if we have a valid selected group
    if (selectedGroupId && adminGroups.find(g => g.groupId === selectedGroupId)) {
      // Group already selected or auto-selected, hide overlay and load dashboard
      currentGroup = adminGroups.find(g => g.groupId === selectedGroupId);
      hideGroupSelectionOverlay();
      await loadDashboardAfterGroupSelection();
      // Update URL with groupId
      updateURLWithGroup(selectedGroupId);
      // Update topbar with group name
      updateTopbarGroupName();
      // Update mobile nav user view option
      updateMobileNavUserView();
      // Initialize notifications
      initializeDashboardNotifications();
    } else if (adminGroups.length > 0) {
      // Show group selection overlay only if we have groups but can't auto-select
      showGroupSelectionOverlay();
    } else {
      // No groups available, hide overlay
      hideGroupSelectionOverlay();
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
  updateCurrentDate();
  await Promise.all([
    loadDashboardStats(),
    loadGroups(),
    loadPendingApprovals(),
    loadDuePayments()
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
    // Require a selected group - don't process all groups
    if (!currentGroup || !currentGroup.groupId) {
      console.warn('No group selected, cannot load dashboard stats');
      return;
    }
    
    let totalCollectionsAmount = 0;
    let activeLoansCount = 0;
    let totalArrearsAmount = 0;
    let pendingApprovalsCount = 0;
    const monthlyCollections = {};
    
    // New variables for pie chart analysis
    let seedMoneyAmount = 0;
    let monthlyContributionAmount = 0;
    let approvedAmount = 0;
    let pendingAmount = 0;
    let unpaidAmount = 0;
    let totalMembersCount = 0;
    let membersWithPayments = 0;
    let loanInterestEarned = 0;
    
    // Calculate stats for the selected group only
    const groupsToProcess = [currentGroup];
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
      totalMembersCount += memberIds.length;
      
      // Calculate actual collections from payments
      for (const userId of memberIds) {
        let memberHasPayment = false;
        
        // Seed Money collections
        try {
          const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${userId}/PaymentDetails`);
          const seedMoneyDoc = await getDoc(seedMoneyRef);
          if (seedMoneyDoc.exists()) {
            const data = seedMoneyDoc.data();
            const amountPaid = parseFloat(data.amountPaid || 0);
            const approvalStatus = data.approvalStatus || "unpaid";
            
            seedMoneyAmount += amountPaid;
            totalArrearsAmount += parseFloat(data.arrears || 0);
            
            // Only count approved payments in total collections
            if (approvalStatus === "approved") {
              approvedAmount += amountPaid;
              totalCollectionsAmount += amountPaid;
            } else if (approvalStatus === "pending") {
              pendingAmount += amountPaid;
              pendingApprovalsCount++;
            } else {
              unpaidAmount += amountPaid;
            }
            
            if (amountPaid > 0) memberHasPayment = true;
          }
        } catch (e) {}
        
        // Monthly contributions
        try {
          const monthlyRef = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${userId}`);
          const monthlySnapshot = await getDocs(monthlyRef);
          monthlySnapshot.forEach(monthDoc => {
            const data = monthDoc.data();
            const amountPaid = parseFloat(data.amountPaid || 0);
            const approvalStatus = data.approvalStatus || "unpaid";
            
            monthlyContributionAmount += amountPaid;
            
            // Only count approved payments in total collections
            if (approvalStatus === "approved") {
              approvedAmount += amountPaid;
              totalCollectionsAmount += amountPaid;
            } else if (approvalStatus === "pending") {
              pendingAmount += amountPaid;
              pendingApprovalsCount++;
            } else {
              unpaidAmount += amountPaid;
            }
            
            totalArrearsAmount += parseFloat(data.arrears || 0);
            
            // Track monthly collections for chart - ONLY approved payments
            if (approvalStatus === "approved") {
            const month = data.month;
            if (month && monthlyCollections[month] !== undefined) {
              monthlyCollections[month] += amountPaid;
              }
            }
            
            if (amountPaid > 0) memberHasPayment = true;
          });
        } catch (e) {}
        
        // Service Fee collections
        try {
          const serviceFeeRef = doc(db, `groups/${groupId}/payments/${currentYear}_ServiceFee/${userId}/PaymentDetails`);
          const serviceFeeDoc = await getDoc(serviceFeeRef);
          if (serviceFeeDoc.exists()) {
            const data = serviceFeeDoc.data();
            const amountPaid = parseFloat(data.amountPaid || 0);
            const approvalStatus = data.approvalStatus || "unpaid";
            
            // Only count approved service fees in total collections
            if (approvalStatus === "approved") {
              totalCollectionsAmount += amountPaid;
              approvedAmount += amountPaid;
            } else if (approvalStatus === "pending") {
              pendingAmount += amountPaid;
              pendingApprovalsCount++;
            }
            totalArrearsAmount += parseFloat(data.arrears || 0);
            
            if (amountPaid > 0) memberHasPayment = true;
          }
        } catch (e) {}
        
        if (memberHasPayment) membersWithPayments++;
      }
      
      // Count active loans
      try {
        const loansRef = collection(db, "groups", groupId, "loans");
        const activeLoansQuery = query(loansRef, where("status", "==", "active"));
        const activeLoansSnapshot = await getDocs(activeLoansQuery);
        activeLoansCount += activeLoansSnapshot.size;
        
        // Count loan interest earned from repaid loans only (actually collected)
        const repaidLoansQuery = query(loansRef, where("status", "==", "repaid"));
        const repaidLoansSnapshot = await getDocs(repaidLoansQuery);
        repaidLoansSnapshot.forEach(loanDoc => {
          const loan = loanDoc.data();
          const interest = parseFloat(loan.interestEarned || loan.totalInterest || 0);
          loanInterestEarned += interest;
          totalCollectionsAmount += interest;
        });
        
        // Also count partial interest from active loans (already collected repayments)
        activeLoansSnapshot.forEach(loanDoc => {
          const loan = loanDoc.data();
          const interest = parseFloat(loan.interestEarned || 0);
          if (interest > 0) {
            loanInterestEarned += interest;
            totalCollectionsAmount += interest;
          }
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
    
    // Render collection trends with pie charts
    renderCollectionTrends({
      monthlyCollections,
      seedMoneyAmount,
      monthlyContributionAmount,
      approvedAmount,
      pendingAmount,
      unpaidAmount,
      totalMembersCount,
      membersWithPayments,
      totalCollectionsAmount,
      totalArrearsAmount,
      loanInterestEarned
    });
    
  } catch (error) {
    console.error("Error loading dashboard stats:", error);
  }
}

// Render collection trends with pie charts showing various analyses
function renderCollectionTrends(data) {
  const chartContainer = document.getElementById('chartContainer') || document.querySelector('.chart-container');
  if (!chartContainer || !currentGroup) {
    if (chartContainer) {
      chartContainer.innerHTML = '<div class="empty-state"><p>Select a group to view collection trends</p></div>';
    }
    return;
  }
  
  const {
    monthlyCollections = {},
    seedMoneyAmount = 0,
    monthlyContributionAmount = 0,
    approvedAmount = 0,
    pendingAmount = 0,
    unpaidAmount = 0,
    totalMembersCount = 0,
    membersWithPayments = 0,
    totalCollectionsAmount = 0,
    totalArrearsAmount = 0,
    loanInterestEarned = 0
  } = data;
  
  let chartHTML = '';
  
  // 1. Payment Type Breakdown (Seed Money vs Monthly Contributions)
  const totalPaymentTypes = seedMoneyAmount + monthlyContributionAmount;
  if (totalPaymentTypes > 0) {
    const seedMoneyPercent = (seedMoneyAmount / totalPaymentTypes) * 100;
    const monthlyPercent = (monthlyContributionAmount / totalPaymentTypes) * 100;
    
    chartHTML += createPieChart(
      'Payment Type Breakdown',
      [
        {
          label: 'Seed Money',
          value: seedMoneyAmount,
          percentage: seedMoneyPercent,
          color: '#10B981' // Green
        },
        {
          label: 'Monthly Contributions',
          value: monthlyContributionAmount,
          percentage: monthlyPercent,
          color: '#3B82F6' // Blue
        }
      ],
      totalPaymentTypes,
      'Total Collections'
    );
  }
  
  // 2. Collection Rate (Paid vs Outstanding)
  // Calculate total expected and total collected
  const totalExpected = totalCollectionsAmount + totalArrearsAmount;
  if (totalExpected > 0) {
    const collectedPercent = (totalCollectionsAmount / totalExpected) * 100;
    const outstandingPercent = (totalArrearsAmount / totalExpected) * 100;
    
    chartHTML += createPieChart(
      'Collection Rate',
      [
        {
          label: 'Collected',
          value: totalCollectionsAmount,
          percentage: collectedPercent,
          color: '#10B981' // Green
        },
        {
          label: 'Outstanding',
          value: totalArrearsAmount,
          percentage: outstandingPercent,
          color: '#EF4444' // Red
        }
      ],
      totalExpected,
      'Collection'
    );
  }
  
  // 3. Collections vs Arrears
  const totalFinancial = totalCollectionsAmount + totalArrearsAmount;
  if (totalFinancial > 0) {
    const collectionsPercent = (totalCollectionsAmount / totalFinancial) * 100;
    const arrearsPercent = (totalArrearsAmount / totalFinancial) * 100;
    
    chartHTML += createPieChart(
      'Collections vs Arrears',
      [
        {
          label: 'Collections',
          value: totalCollectionsAmount,
          percentage: collectionsPercent,
          color: '#10B981' // Green
        },
        {
          label: 'Arrears',
          value: totalArrearsAmount,
          percentage: arrearsPercent,
          color: '#EF4444' // Red
        }
      ],
      totalFinancial,
      'Financial Health'
    );
  }
  
  // 4. Member Participation Rate
  if (totalMembersCount > 0) {
    const membersWithPaymentsCount = membersWithPayments;
    const membersWithoutPayments = totalMembersCount - membersWithPaymentsCount;
    const participationPercent = (membersWithPaymentsCount / totalMembersCount) * 100;
    const nonParticipationPercent = (membersWithoutPayments / totalMembersCount) * 100;
    
    chartHTML += createPieChart(
      'Member Participation',
      [
        {
          label: 'Active Members',
          value: membersWithPaymentsCount,
          percentage: participationPercent,
          color: '#10B981' // Green
        },
        {
          label: 'Inactive Members',
          value: membersWithoutPayments,
          percentage: nonParticipationPercent,
          color: '#9CA3AF' // Gray
        }
      ],
      totalMembersCount,
      'Participation',
      true // This is a count chart, not currency
    );
  }
  
  // 5. Income Sources (Contributions vs Loan Interest)
  const totalIncome = (seedMoneyAmount + monthlyContributionAmount) + loanInterestEarned;
  if (totalIncome > 0 && loanInterestEarned > 0) {
    const contributionsPercent = ((seedMoneyAmount + monthlyContributionAmount) / totalIncome) * 100;
    const interestPercent = (loanInterestEarned / totalIncome) * 100;
    
    chartHTML += createPieChart(
      'Income Sources',
      [
        {
          label: 'Contributions',
          value: seedMoneyAmount + monthlyContributionAmount,
          percentage: contributionsPercent,
          color: '#3B82F6' // Blue
        },
        {
          label: 'Loan Interest',
          value: loanInterestEarned,
          percentage: interestPercent,
          color: '#8B5CF6' // Purple
        }
      ],
      totalIncome,
      'Total Income'
    );
  }
  
  if (chartHTML) {
    chartContainer.innerHTML = chartHTML;
    
    // Animate pie charts after render
    setTimeout(() => {
      chartContainer.querySelectorAll('.pie-chart-svg').forEach((svg, index) => {
        setTimeout(() => {
          svg.style.opacity = '1';
          svg.querySelectorAll('.pie-chart-segment').forEach((segment, segIndex) => {
            setTimeout(() => {
              segment.style.opacity = '1';
            }, segIndex * 200);
          });
        }, index * 300);
      });
    }, 100);
  } else {
    chartContainer.innerHTML = `
      <div class="empty-state" style="width: 100%; grid-column: 1 / -1;">
        <div class="empty-state-icon">📊</div>
        <p class="empty-state-text">No collection data for current cycle yet</p>
        <p style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-2);">
          Pie charts will appear once members start making payments
        </p>
      </div>
    `;
  }
}

// Create a pie chart using SVG paths (reused from analytics.js pattern)
function createPieChart(title, segments, total, centerLabel, isCount = false) {
  const radius = 80;
  const centerX = 120;
  const centerY = 120;
  
  let segmentsHTML = '';
  let legendHTML = '';
  let currentAngle = -90; // Start at top (12 o'clock)
  
  // Filter out zero segments and calculate percentages
  const validSegments = segments.filter(s => (s.value || 0) > 0).map(s => ({
    ...s,
    percentage: total > 0 ? ((s.value / total) * 100) : 0
  }));
  
  validSegments.forEach((segment, index) => {
    const percentage = Math.min(segment.percentage || 0, 100);
    if (percentage <= 0) return;
    
    // Calculate angles for this segment
    const angle = (percentage / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle += angle;
    
    // Convert to radians
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    
    // Calculate path coordinates
    const x1 = centerX + radius * Math.cos(startRad);
    const y1 = centerY + radius * Math.sin(startRad);
    const x2 = centerX + radius * Math.cos(endRad);
    const y2 = centerY + radius * Math.sin(endRad);
    
    // Large arc flag (1 if angle > 180, 0 otherwise)
    const largeArcFlag = angle > 180 ? 1 : 0;
    
    // Create path for this segment (pie slice)
    const pathData = [
      `M ${centerX} ${centerY}`, // Move to center
      `L ${x1} ${y1}`, // Line to start point
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`, // Arc to end point
      'Z' // Close path back to center
    ].join(' ');
    
    segmentsHTML += `
      <path
        class="pie-chart-segment"
        d="${pathData}"
        fill="${segment.color}"
        stroke="var(--bn-white)"
        stroke-width="2"
        data-percentage="${percentage.toFixed(1)}"
        style="opacity: 0; transition: opacity 0.8s ease;"
      />
    `;
    
    const displayValue = isCount ? Math.round(segment.value) : formatCurrency(segment.value);
    legendHTML += `
      <div class="legend-item">
        <span class="legend-dot" style="background: ${segment.color};"></span>
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: var(--bn-text-sm); color: var(--bn-gray-700);">${segment.label}:</span>
          <span style="font-weight: 600; color: var(--bn-dark); margin-left: var(--bn-space-2);">${displayValue}</span>
        </div>
      </div>
    `;
  });
  
  // Calculate main percentage for center display
  const mainPercentage = validSegments[0]?.percentage || 0;
  const centerDisplay = isCount ? 
    `${Math.round(validSegments[0]?.value || 0)} / ${Math.round(total)}` :
    `${mainPercentage.toFixed(0)}%`;
  const centerSubDisplay = isCount ? 
    `${Math.round((validSegments[0]?.value || 0) / total * 100)}%` :
    formatCurrencyShort(total);
  
  return `
    <div class="pie-chart-container">
      <div class="pie-chart-title">${title}</div>
      <div class="pie-chart-wrapper">
        <svg class="pie-chart-svg" viewBox="0 0 240 240" style="opacity: 0; transition: opacity 0.5s ease; width: 100%; height: 100%;">
          ${segmentsHTML}
        </svg>
        <div class="pie-chart-center">
          <div class="pie-chart-center-value">${centerDisplay}</div>
          <div class="pie-chart-center-label">${centerLabel}</div>
          <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-1);">${centerSubDisplay}</div>
        </div>
      </div>
      <div class="pie-chart-legend">
        ${legendHTML}
      </div>
    </div>
  `;
}

// Format currency for chart center (shortened)
function formatCurrencyShort(amount) {
  const value = parseFloat(amount) || 0;
  if (value >= 1000000) {
    return `MWK ${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `MWK ${(value / 1000).toFixed(1)}K`;
  }
  return `MWK ${value.toLocaleString('en-US')}`;
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
      <a href="javascript:void(0)" class="group-card ${isSelected ? 'selected' : ''}" ${isSelected ? 'onclick="return false;"' : `onclick="switchGroup('${group.groupId}')"`}>
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
        ${isSelected ? '<div class="group-card-active-badge">Active</div>' : ''}
      </a>
    `;
  }).join('');
}

async function loadPendingApprovals() {
  if (!pendingApprovalsList) return;
  
  // Require a selected group - don't process all groups
  if (!currentGroup || !currentGroup.groupId) {
    pendingApprovalsList.innerHTML = '<div class="empty-state"><p>Select a group to view pending approvals</p></div>';
    return;
  }
  
  const allPending = [];
  const groupsToProcess = [currentGroup];
  
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
  const selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
  
  // If already selected, don't do anything
  if (selectedGroupId === groupId) {
    return;
  }
  
  currentGroup = adminGroups.find(g => g.groupId === groupId);
  if (currentGroup) {
    localStorage.setItem('selectedGroupId', groupId);
    sessionStorage.setItem('selectedGroupId', groupId);
    showSpinner(true);
    updateCurrentDate();
    await Promise.all([
      loadDashboardStats(),
      loadGroups(),
      loadPendingApprovals(),
      loadDuePayments()
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

// Dashboard search functionality - Enhanced to include groups, seed money, payments, etc.
async function performDashboardSearch(searchTerm, groupId) {
  if (!searchTerm || searchTerm.length < 2) return;
  
  const searchLower = searchTerm.toLowerCase();
  const searchResults = [];
  
  try {
    // Search groups (all admin groups)
    if (adminGroups && adminGroups.length > 0) {
      adminGroups.forEach(group => {
        const groupName = (group.groupName || '').toLowerCase();
        if (groupName.includes(searchLower)) {
          searchResults.push({
            id: group.groupId,
            type: 'group',
            name: group.groupName,
            icon: '🏢',
            subtitle: `${group.statistics?.totalMembers || 0} members`
          });
        }
      });
    }
    
    // Search members (current group)
    if (groupId) {
    const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
    membersSnapshot.forEach(doc => {
      const member = doc.data();
      const name = (member.fullName || '').toLowerCase();
      const email = (member.email || '').toLowerCase();
        const phone = (member.phone || '').toLowerCase();
      
        if (name.includes(searchLower) || email.includes(searchLower) || phone.includes(searchLower)) {
        searchResults.push({
          id: doc.id,
          type: 'member',
          name: member.fullName,
            email: member.email,
            phone: member.phone,
            icon: '👤'
        });
      }
    });
    
    // Search loans
    const loansSnapshot = await getDocs(collection(db, `groups/${groupId}/loans`));
    loansSnapshot.forEach(doc => {
      const loan = doc.data();
      const borrowerName = (loan.borrowerName || '').toLowerCase();
        const purpose = (loan.purpose || '').toLowerCase();
        const amount = (loan.amount || loan.loanAmount || 0).toString();
      
        if (borrowerName.includes(searchLower) || purpose.includes(searchLower) || amount.includes(searchLower)) {
        searchResults.push({
          id: doc.id,
          type: 'loan',
          name: loan.borrowerName,
            amount: loan.amount || loan.loanAmount || 0,
            status: loan.status,
            purpose: loan.purpose,
            icon: '💰'
        });
      }
    });
      
      // Search seed money payments
      const currentYear = new Date().getFullYear();
      try {
        const seedMoneyRef = collection(db, `groups/${groupId}/payments/${currentYear}_SeedMoney`);
        const seedMoneySnapshot = await getDocs(seedMoneyRef);
        
        for (const memberDoc of seedMoneySnapshot.docs) {
          try {
            const paymentRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberDoc.id}/PaymentDetails`);
            const paymentDoc = await getDoc(paymentRef);
            
            if (paymentDoc.exists()) {
              const paymentData = paymentDoc.data();
              const amount = (paymentData.totalAmount || 0).toString();
              const amountPaid = (paymentData.amountPaid || 0).toString();
              
              // Get member name
              const memberRef = doc(db, `groups/${groupId}/members`, memberDoc.id);
              const memberDocSnap = await getDoc(memberRef);
              const memberName = memberDocSnap.exists() ? (memberDocSnap.data().fullName || '').toLowerCase() : '';
              
              if (memberName.includes(searchLower) || amount.includes(searchLower) || amountPaid.includes(searchLower) || 'seed money'.includes(searchLower)) {
                if (!searchResults.find(r => r.type === 'seed_money' && r.memberId === memberDoc.id)) {
                  searchResults.push({
                    id: memberDoc.id,
                    memberId: memberDoc.id,
                    type: 'seed_money',
                    name: memberDocSnap.exists() ? memberDocSnap.data().fullName : 'Unknown Member',
                    amount: paymentData.totalAmount || 0,
                    amountPaid: paymentData.amountPaid || 0,
                    status: paymentData.approvalStatus,
                    icon: '🌱'
                  });
                }
              }
            }
          } catch (e) {
            // Skip if subcollection doesn't exist
          }
        }
      } catch (e) {
        console.log('Error searching seed money:', e);
      }
      
      // Search monthly contributions
      try {
        const monthlyContributionsRef = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions`);
        const monthlySnapshot = await getDocs(monthlyContributionsRef);
        
        for (const memberDoc of monthlySnapshot.docs) {
          // Get member info
          const memberRef = doc(db, `groups/${groupId}/members`, memberDoc.id);
          const memberDocSnap = await getDoc(memberRef);
          const memberName = memberDocSnap.exists() ? (memberDocSnap.data().fullName || '').toLowerCase() : '';
          
          if (memberName.includes(searchLower) || 'monthly contribution'.includes(searchLower) || 'monthly'.includes(searchLower)) {
            // Get monthly payments for this member
            const monthlyPaymentsRef = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${memberDoc.id}`);
            const monthlyPaymentsSnapshot = await getDocs(monthlyPaymentsRef);
            
            if (monthlyPaymentsSnapshot.size > 0) {
              if (!searchResults.find(r => r.type === 'monthly' && r.memberId === memberDoc.id)) {
                searchResults.push({
                  id: memberDoc.id,
                  memberId: memberDoc.id,
                  type: 'monthly',
                  name: memberDocSnap.exists() ? memberDocSnap.data().fullName : 'Unknown Member',
                  icon: '📅'
                });
              }
            }
          }
        }
      } catch (e) {
        console.log('Error searching monthly contributions:', e);
      }
      
      // Search payments by amount
      if (searchLower.match(/^\d+$/)) {
        // If search term is a number, search for payments with that amount
        const searchAmount = parseFloat(searchLower);
        
        // Check seed money
        try {
          const seedMoneyRef = collection(db, `groups/${groupId}/payments/${currentYear}_SeedMoney`);
          const seedMoneySnapshot = await getDocs(seedMoneyRef);
          
          for (const memberDoc of seedMoneySnapshot.docs) {
            try {
              const paymentRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberDoc.id}/PaymentDetails`);
              const paymentDoc = await getDoc(paymentRef);
              
              if (paymentDoc.exists()) {
                const paymentData = paymentDoc.data();
                const totalAmount = paymentData.totalAmount || 0;
                const amountPaid = paymentData.amountPaid || 0;
                
                if (totalAmount.toString().includes(searchLower) || amountPaid.toString().includes(searchLower)) {
                  const memberRef = doc(db, `groups/${groupId}/members`, memberDoc.id);
                  const memberDocSnap = await getDoc(memberRef);
                  
                  if (!searchResults.find(r => r.type === 'seed_money' && r.memberId === memberDoc.id)) {
                    searchResults.push({
                      id: memberDoc.id,
                      memberId: memberDoc.id,
                      type: 'seed_money',
                      name: memberDocSnap.exists() ? memberDocSnap.data().fullName : 'Unknown Member',
                      amount: totalAmount,
                      amountPaid: amountPaid,
                      icon: '🌱'
                    });
                  }
                }
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
    }
    
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
      max-height: 500px;
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
    container.style.display = 'block';
    return;
  }
  
  // Group results by type
  const groupedResults = {
    group: results.filter(r => r.type === 'group'),
    member: results.filter(r => r.type === 'member'),
    loan: results.filter(r => r.type === 'loan'),
    seed_money: results.filter(r => r.type === 'seed_money'),
    monthly: results.filter(r => r.type === 'monthly')
  };
  
  let html = '';
  const selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
  
  // Groups section
  if (groupedResults.group.length > 0) {
    html += '<div style="padding: 8px 16px; font-size: 11px; font-weight: 600; color: var(--bn-gray); text-transform: uppercase; background: var(--bn-gray-100); border-top-left-radius: 12px; border-top-right-radius: 12px;">Groups</div>';
    groupedResults.group.slice(0, 5).forEach(result => {
      html += `
        <a href="admin_dashboard.html?groupId=${result.id}" 
           style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; text-decoration: none; color: inherit; border-bottom: 1px solid var(--bn-gray-lighter); cursor: pointer; transition: background 0.2s;"
           onmouseover="this.style.background='var(--bn-gray-100)'" onmouseout="this.style.background=''">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--bn-primary); display: flex; align-items: center; justify-content: center; font-size: 18px;">
            ${result.icon || '🏢'}
        </div>
        <div style="flex: 1;">
          <div style="font-weight: 600; color: var(--bn-dark);">${result.name}</div>
            <div style="font-size: 12px; color: var(--bn-gray);">${result.subtitle || 'Group'}</div>
        </div>
      </a>
      `;
    });
  }
  
  // Members section
  if (groupedResults.member.length > 0) {
    html += '<div style="padding: 8px 16px; font-size: 11px; font-weight: 600; color: var(--bn-gray); text-transform: uppercase; background: var(--bn-gray-100);">Members</div>';
    groupedResults.member.slice(0, 5).forEach(result => {
      html += `
        <a href="manage_members.html?groupId=${selectedGroupId}&search=${encodeURIComponent(result.name)}" 
           style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; text-decoration: none; color: inherit; border-bottom: 1px solid var(--bn-gray-lighter); cursor: pointer; transition: background 0.2s;"
           onmouseover="this.style.background='var(--bn-gray-100)'" onmouseout="this.style.background=''">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--bn-gradient-primary); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 14px;">
            ${result.icon || result.name.charAt(0).toUpperCase()}
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: var(--bn-dark);">${result.name}</div>
            <div style="font-size: 12px; color: var(--bn-gray);">${result.email || result.phone || 'Member'}</div>
          </div>
        </a>
      `;
    });
  }
  
  // Loans section
  if (groupedResults.loan.length > 0) {
    html += '<div style="padding: 8px 16px; font-size: 11px; font-weight: 600; color: var(--bn-gray); text-transform: uppercase; background: var(--bn-gray-100);">Loans</div>';
    groupedResults.loan.slice(0, 5).forEach(result => {
      const statusColor = result.status === 'active' ? 'var(--bn-success)' : result.status === 'pending' ? 'var(--bn-warning)' : result.status === 'overdue' ? 'var(--bn-danger)' : 'var(--bn-gray)';
      html += `
        <a href="manage_loans.html?groupId=${selectedGroupId}&loanId=${result.id}" 
           style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; text-decoration: none; color: inherit; border-bottom: 1px solid var(--bn-gray-lighter); cursor: pointer; transition: background 0.2s;"
           onmouseover="this.style.background='var(--bn-gray-100)'" onmouseout="this.style.background=''">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(249, 115, 22, 0.1); display: flex; align-items: center; justify-content: center; font-size: 18px;">
            ${result.icon || '💰'}
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: var(--bn-dark);">${result.name}</div>
            <div style="font-size: 12px; color: var(--bn-gray);">MWK ${(result.amount || 0).toLocaleString()}${result.purpose ? ` • ${result.purpose}` : ''}</div>
          </div>
          ${result.status ? `<span style="font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 999px; background: ${statusColor}15; color: ${statusColor}; text-transform: capitalize;">${result.status}</span>` : ''}
        </a>
      `;
    });
  }
  
  // Seed Money section
  if (groupedResults.seed_money.length > 0) {
    html += '<div style="padding: 8px 16px; font-size: 11px; font-weight: 600; color: var(--bn-gray); text-transform: uppercase; background: var(--bn-gray-100);">Seed Money</div>';
    groupedResults.seed_money.slice(0, 5).forEach(result => {
      const status = result.amountPaid >= result.amount ? 'Paid' : 'Pending';
      html += `
        <a href="manage_payments.html?groupId=${selectedGroupId}&tab=seed&memberId=${result.memberId}" 
           style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; text-decoration: none; color: inherit; border-bottom: 1px solid var(--bn-gray-lighter); cursor: pointer; transition: background 0.2s;"
           onmouseover="this.style.background='var(--bn-gray-100)'" onmouseout="this.style.background=''">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(201, 162, 39, 0.1); display: flex; align-items: center; justify-content: center; font-size: 18px;">
            ${result.icon || '🌱'}
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: var(--bn-dark);">${result.name}</div>
            <div style="font-size: 12px; color: var(--bn-gray);">MWK ${(result.amountPaid || 0).toLocaleString()} / MWK ${(result.amount || 0).toLocaleString()}</div>
          </div>
          <span style="font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 999px; background: ${status === 'Paid' ? 'var(--bn-success)15' : 'var(--bn-warning)15'}; color: ${status === 'Paid' ? 'var(--bn-success)' : 'var(--bn-warning)'};">${status}</span>
        </a>
      `;
    });
  }
  
  // Monthly Contributions section
  if (groupedResults.monthly.length > 0) {
    html += '<div style="padding: 8px 16px; font-size: 11px; font-weight: 600; color: var(--bn-gray); text-transform: uppercase; background: var(--bn-gray-100);">Monthly Contributions</div>';
    groupedResults.monthly.slice(0, 5).forEach(result => {
      html += `
        <a href="manage_payments.html?groupId=${selectedGroupId}&tab=monthly&memberId=${result.memberId}" 
           style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; text-decoration: none; color: inherit; border-bottom: 1px solid var(--bn-gray-lighter); cursor: pointer; transition: background 0.2s;"
           onmouseover="this.style.background='var(--bn-gray-100)'" onmouseout="this.style.background=''">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(34, 197, 94, 0.1); display: flex; align-items: center; justify-content: center; font-size: 18px;">
            ${result.icon || '📅'}
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: var(--bn-dark);">${result.name}</div>
            <div style="font-size: 12px; color: var(--bn-gray);">Monthly Contributions</div>
          </div>
        </a>
      `;
    });
  }
  
  // Show total count if more results
  const totalShown = Object.values(groupedResults).reduce((sum, arr) => sum + Math.min(arr.length, 5), 0);
  const totalResults = results.length;
  if (totalResults > totalShown) {
    html += `<div style="padding: 12px 16px; text-align: center; font-size: 12px; color: var(--bn-gray); background: var(--bn-gray-100); border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;">
      ${totalResults - totalShown} more result${totalResults - totalShown > 1 ? 's' : ''}
    </div>`;
  }
  
  container.innerHTML = html;
  container.style.display = 'block';
}

// Initialize notifications when dashboard loads
function initializeDashboardNotifications() {
  const selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
  if (currentUser && selectedGroupId) {
    initializeNotifications(currentUser.uid, selectedGroupId);
  }
}

// Update URL with groupId parameter
function updateURLWithGroup(groupId) {
  if (!groupId) return;
  const url = new URL(window.location.href);
  url.searchParams.set('groupId', groupId);
  window.history.replaceState({}, '', url);
}

// Update topbar with group name
function updateTopbarGroupName() {
  const topbarTitle = document.querySelector('.topbar-title');
  if (topbarTitle && currentGroup) {
    topbarTitle.innerHTML = `
      <span style="font-size: 14px; font-weight: 600; color: var(--bn-dark); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${currentGroup.groupName || 'Dashboard'}</span>
      <span style="font-size: 11px; color: var(--bn-gray); font-weight: 400; display: block; margin-top: 1px;">Admin Dashboard</span>
    `;
  }
}

// Show/hide "Switch to User View" in mobile nav based on admin status
function updateMobileNavUserView() {
  const switchToUserViewMobile = document.getElementById("switchToUserViewMobile");
  if (switchToUserViewMobile) {
    // Only show if user has admin groups (is an admin)
    if (adminGroups && adminGroups.length > 0) {
      switchToUserViewMobile.style.display = "flex";
    } else {
      switchToUserViewMobile.style.display = "none";
    }
  }
}

// Open stat modal
window.openStatModal = async function(type) {
  if (!currentGroup || !currentGroup.groupId) {
    showToast("Please select a group first", "warning");
    return;
  }

  const modalOverlay = document.getElementById('statModalOverlay');
  const modalTitle = document.getElementById('statModalTitleText');
  const modalIcon = document.getElementById('statModalIcon');
  const modalBody = document.getElementById('statModalBody');

  if (!modalOverlay || !modalTitle || !modalIcon || !modalBody) return;

  // Set modal title and icon based on type
  const modalConfig = {
    arrears: { title: 'Arrears Details', icon: '⚠️' },
    loans: { title: 'Active Loans', icon: '💰' },
    pending: { title: 'Pending Approvals', icon: '⏳' },
    collections: { title: 'Collections Overview', icon: '💵' }
  };

  const config = modalConfig[type] || { title: 'Details', icon: '📊' };
  modalTitle.textContent = config.title;
  modalIcon.textContent = config.icon;

  // Show loading state
  modalBody.innerHTML = `
    <div class="stat-modal-empty">
      <div class="stat-modal-empty-icon">⏳</div>
      <p class="stat-modal-empty-text">Loading...</p>
    </div>
  `;

  // Open modal
  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Load data based on type
  try {
    let items = [];
    switch(type) {
      case 'arrears':
        items = await loadArrearsData();
        break;
      case 'loans':
        items = await loadActiveLoansData();
        break;
      case 'pending':
        items = await loadPendingApprovalsData();
        break;
      case 'collections':
        items = await loadCollectionsData();
        break;
    }
    renderStatModalItems(items, type);
  } catch (error) {
    console.error('Error loading modal data:', error);
    modalBody.innerHTML = `
      <div class="stat-modal-empty">
        <div class="stat-modal-empty-icon">❌</div>
        <p class="stat-modal-empty-text">Error loading data. Please try again.</p>
      </div>
    `;
  }
};

// Close stat modal
window.closeStatModal = function() {
  const modalOverlay = document.getElementById('statModalOverlay');
  if (modalOverlay) {
    modalOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }
};

// Close modal when clicking overlay
window.closeStatModalOnOverlay = function(event) {
  if (event.target.id === 'statModalOverlay') {
    closeStatModal();
  }
};

// Load arrears data
async function loadArrearsData() {
  if (!currentGroup || !currentGroup.groupId) return [];

  const arrearsList = [];
  const groupId = currentGroup.groupId;
  const currentYear = new Date().getFullYear();

  try {
    // Get all members
    const membersRef = collection(db, "groups", groupId, "members");
    const membersSnapshot = await getDocs(membersRef);

    for (const memberDoc of membersSnapshot.docs) {
      const member = memberDoc.data();
      const memberId = memberDoc.id;
      let totalArrears = 0;
      const arrearsBreakdown = [];

      // Check seed money arrears
      try {
        const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberId}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);
        if (seedMoneyDoc.exists()) {
          const paymentData = seedMoneyDoc.data();
          const arrears = parseFloat(paymentData.arrears || 0);
          if (arrears > 0) {
            totalArrears += arrears;
            arrearsBreakdown.push({
              type: 'Seed Money',
              amount: arrears,
              dueDate: paymentData.dueDate || null
            });
          }
        }
      } catch (e) {}

      // Check monthly contribution arrears
      try {
        const monthlyRef = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${memberId}`);
        const monthlySnapshot = await getDocs(monthlyRef);
        monthlySnapshot.forEach(monthDoc => {
          const paymentData = monthDoc.data();
          const arrears = parseFloat(paymentData.arrears || 0);
          if (arrears > 0) {
            totalArrears += arrears;
            arrearsBreakdown.push({
              type: `Monthly - ${paymentData.month || 'Unknown'}`,
              amount: arrears,
              dueDate: paymentData.dueDate || null
            });
          }
        });
      } catch (e) {}

      if (totalArrears > 0) {
        arrearsList.push({
          id: memberId,
          name: member.fullName || 'Unknown Member',
          email: member.email || '',
          phone: member.phone || '',
          totalArrears: totalArrears,
          breakdown: arrearsBreakdown,
          type: 'arrear'
        });
      }
    }

    // Sort by arrears amount (highest first)
    arrearsList.sort((a, b) => b.totalArrears - a.totalArrears);
  } catch (error) {
    console.error('Error loading arrears:', error);
  }

  return arrearsList;
}

// Load active loans data
async function loadActiveLoansData() {
  if (!currentGroup || !currentGroup.groupId) return [];

  const loansList = [];
  const groupId = currentGroup.groupId;

  try {
    const loansRef = collection(db, "groups", groupId, "loans");
    const activeLoansQuery = query(loansRef, where("status", "==", "active"));
    const loansSnapshot = await getDocs(activeLoansQuery);

    loansSnapshot.forEach(loanDoc => {
      const loan = loanDoc.data();
      loansList.push({
        id: loanDoc.id,
        name: loan.borrowerName || 'Unknown Borrower',
        amount: parseFloat(loan.loanAmount || loan.amount || 0),
        purpose: loan.purpose || '',
        dateIssued: loan.dateIssued || loan.createdAt || null,
        repaymentDate: loan.repaymentDate || null,
        status: loan.status,
        type: 'loan'
      });
    });

    // Sort by date (newest first)
    loansList.sort((a, b) => {
      const dateA = a.dateIssued?.toDate ? a.dateIssued.toDate() : new Date(0);
      const dateB = b.dateIssued?.toDate ? b.dateIssued.toDate() : new Date(0);
      return dateB - dateA;
    });
  } catch (error) {
    console.error('Error loading active loans:', error);
  }

  return loansList;
}

// Load pending approvals data
async function loadPendingApprovalsData() {
  if (!currentGroup || !currentGroup.groupId) return [];

  const pendingList = [];
  const groupId = currentGroup.groupId;
  const currentYear = new Date().getFullYear();

  try {
    // Pending loans
    const loansRef = collection(db, "groups", groupId, "loans");
    const pendingLoansQuery = query(loansRef, where("status", "==", "pending"));
    const loansSnapshot = await getDocs(pendingLoansQuery);

    loansSnapshot.forEach(loanDoc => {
      const loan = loanDoc.data();
      pendingList.push({
        id: loanDoc.id,
        name: loan.borrowerName || 'Unknown Borrower',
        amount: parseFloat(loan.loanAmount || loan.amount || 0),
        purpose: loan.purpose || '',
        requestedDate: loan.createdAt || loan.requestedDate || null,
        type: 'loan_approval'
      });
    });

    // Pending payments
    const membersRef = collection(db, "groups", groupId, "members");
    const membersSnapshot = await getDocs(membersRef);

    for (const memberDoc of membersSnapshot.docs) {
      const member = memberDoc.data();
      const memberId = memberDoc.id;

      try {
        const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberId}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);
        if (seedMoneyDoc.exists()) {
          const paymentData = seedMoneyDoc.data();
          if (paymentData.approvalStatus === "pending") {
            pendingList.push({
              id: `${memberId}_seed`,
              name: member.fullName || 'Unknown Member',
              amount: parseFloat(paymentData.amountPaid || 0),
              paymentType: 'Seed Money',
              submittedDate: paymentData.submittedAt || paymentData.createdAt || null,
              type: 'payment_approval',
              memberId: memberId
            });
          }
        }
      } catch (e) {}
    }

    // Sort by date (newest first)
    pendingList.sort((a, b) => {
      const dateA = (a.requestedDate || a.submittedDate)?.toDate ? (a.requestedDate || a.submittedDate).toDate() : new Date(0);
      const dateB = (b.requestedDate || b.submittedDate)?.toDate ? (b.requestedDate || b.submittedDate).toDate() : new Date(0);
      return dateB - dateA;
    });
  } catch (error) {
    console.error('Error loading pending approvals:', error);
  }

  return pendingList;
}

// Load collections data
async function loadCollectionsData() {
  if (!currentGroup || !currentGroup.groupId) return [];

  const collectionsList = [];
  const groupId = currentGroup.groupId;
  const currentYear = new Date().getFullYear();

  try {
    const membersRef = collection(db, "groups", groupId, "members");
    const membersSnapshot = await getDocs(membersRef);

    for (const memberDoc of membersSnapshot.docs) {
      const member = memberDoc.data();
      const memberId = memberDoc.id;
      let totalCollections = 0;

      // Seed money collections
      try {
        const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberId}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);
        if (seedMoneyDoc.exists()) {
          const paymentData = seedMoneyDoc.data();
          if (paymentData.approvalStatus === "approved") {
            totalCollections += parseFloat(paymentData.amountPaid || 0);
          }
        }
      } catch (e) {}

      // Monthly contributions
      try {
        const monthlyRef = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${memberId}`);
        const monthlySnapshot = await getDocs(monthlyRef);
        monthlySnapshot.forEach(monthDoc => {
          const paymentData = monthDoc.data();
          if (paymentData.approvalStatus === "approved") {
            totalCollections += parseFloat(paymentData.amountPaid || 0);
          }
        });
      } catch (e) {}

      if (totalCollections > 0) {
        collectionsList.push({
          id: memberId,
          name: member.fullName || 'Unknown Member',
          email: member.email || '',
          phone: member.phone || '',
          totalCollections: totalCollections,
          type: 'collection'
        });
      }
    }

    // Sort by collections amount (highest first)
    collectionsList.sort((a, b) => b.totalCollections - a.totalCollections);
  } catch (error) {
    console.error('Error loading collections:', error);
  }

  return collectionsList;
}

// Render stat modal items
function renderStatModalItems(items, type) {
  const modalBody = document.getElementById('statModalBody');
  if (!modalBody) return;

  if (items.length === 0) {
    modalBody.innerHTML = `
      <div class="stat-modal-empty">
        <div class="stat-modal-empty-icon">✅</div>
        <p class="stat-modal-empty-text">No items found</p>
      </div>
    `;
    return;
  }

  let html = '<div class="stat-modal-list">';

  items.forEach(item => {
    const initials = item.name ? item.name.charAt(0).toUpperCase() : '?';
    const amount = item.totalArrears || item.amount || item.totalCollections || 0;
    const detail = item.purpose || item.paymentType || item.email || item.phone || '';
    const breakdown = item.breakdown || [];

    html += `
      <div class="stat-modal-item">
        <div class="stat-modal-item-avatar">${initials}</div>
        <div class="stat-modal-item-info">
          <div class="stat-modal-item-name">${item.name}</div>
          <div class="stat-modal-item-detail">
            ${detail}
            ${breakdown.length > 0 ? `<br><small style="color: var(--bn-gray); font-size: 0.75rem;">${breakdown.map(b => `${b.type}: ${formatCurrency(b.amount)}`).join(', ')}</small>` : ''}
          </div>
        </div>
        <div class="stat-modal-item-amount">${formatCurrency(amount)}</div>
        <div class="stat-modal-item-actions">
          ${getActionButtons(item, type)}
        </div>
      </div>
    `;
  });

  html += '</div>';
  modalBody.innerHTML = html;
}

// Get action buttons based on item type and modal type
function getActionButtons(item, modalType) {
  if (modalType === 'arrears') {
    return `
      <button class="stat-modal-action-btn stat-modal-action-btn-primary" onclick="handleArrearsAction('view', '${item.id}')">
        <span>View</span>
      </button>
      <button class="stat-modal-action-btn stat-modal-action-btn-secondary" onclick="handleArrearsAction('contact', '${item.id}')">
        <span>Contact</span>
      </button>
    `;
  } else if (modalType === 'loans') {
    return `
      <button class="stat-modal-action-btn stat-modal-action-btn-primary" onclick="handleLoanAction('view', '${item.id}')">
        <span>View</span>
      </button>
      <button class="stat-modal-action-btn stat-modal-action-btn-secondary" onclick="handleLoanAction('manage', '${item.id}')">
        <span>Manage</span>
      </button>
    `;
  } else if (modalType === 'pending') {
    if (item.type === 'loan_approval') {
      return `
        <button class="stat-modal-action-btn stat-modal-action-btn-primary" onclick="handleApproval('${item.id}', 'loan', '${currentGroup.groupId}', true)">
          <span>Approve</span>
        </button>
        <button class="stat-modal-action-btn stat-modal-action-btn-secondary" onclick="handleApproval('${item.id}', 'loan', '${currentGroup.groupId}', false)">
          <span>Reject</span>
        </button>
      `;
    } else {
      return `
        <button class="stat-modal-action-btn stat-modal-action-btn-primary" onclick="handlePaymentApproval('${item.memberId}', 'seed', '${currentGroup.groupId}', true)">
          <span>Approve</span>
        </button>
        <button class="stat-modal-action-btn stat-modal-action-btn-secondary" onclick="handlePaymentApproval('${item.memberId}', 'seed', '${currentGroup.groupId}', false)">
          <span>Reject</span>
        </button>
      `;
    }
  } else if (modalType === 'collections') {
    return `
      <button class="stat-modal-action-btn stat-modal-action-btn-primary" onclick="handleCollectionAction('view', '${item.id}')">
        <span>View</span>
      </button>
      <button class="stat-modal-action-btn stat-modal-action-btn-secondary" onclick="handleCollectionAction('history', '${item.id}')">
        <span>History</span>
      </button>
    `;
  }
  return '';
}

// Navigate to stat page instead of modal
window.navigateToStatPage = function(type) {
  if (!currentGroup || !currentGroup.groupId) {
    showToast("Please select a group first", "warning");
    return;
  }
  
  const groupId = currentGroup.groupId;
  const pageMap = {
    'arrears': `manage_payments.html?groupId=${groupId}&tab=arrears`,
    'collections': `manage_payments.html?groupId=${groupId}&tab=collected`,
    'pending': `manage_payments.html?groupId=${groupId}&tab=pending`,
    'loans': `manage_loans.html?groupId=${groupId}`
  };
  
  const url = pageMap[type];
  if (url) {
    window.location.href = url;
  } else {
    // Fallback to modal if no page mapping
    openStatModal(type);
  }
};

// Handle arrears actions (for modal View button - now redirects)
window.handleArrearsAction = async function(action, memberId) {
  if (action === 'view') {
    window.location.href = `manage_payments.html?groupId=${currentGroup.groupId}&memberId=${memberId}&tab=arrears`;
  } else if (action === 'contact') {
    // Get member details and open contact options
    try {
      const memberRef = doc(db, "groups", currentGroup.groupId, "members", memberId);
      const memberDoc = await getDoc(memberRef);
      if (memberDoc.exists()) {
        const member = memberDoc.data();
        const phone = member.phone || '';
        const email = member.email || '';
        
        if (phone) {
          window.location.href = `tel:${phone}`;
        } else if (email) {
          window.location.href = `mailto:${email}`;
        } else {
          showToast("No contact information available", "warning");
        }
      }
    } catch (error) {
      console.error('Error getting member details:', error);
      showToast("Error loading member details", "danger");
    }
  }
};

// Handle loan actions (for modal View button - now redirects)
window.handleLoanAction = function(action, loanId) {
  if (action === 'view' || action === 'manage') {
    window.location.href = `manage_loans.html?groupId=${currentGroup.groupId}${loanId ? `&loanId=${loanId}` : ''}`;
  }
};

// Handle collection actions (for modal View button - now redirects)
window.handleCollectionAction = function(action, memberId) {
  if (action === 'view' || action === 'history') {
    window.location.href = `manage_payments.html?groupId=${currentGroup.groupId}&memberId=${memberId}&tab=collected`;
  }
};

// Handle collection actions
window.handleCollectionAction = function(action, memberId) {
  if (action === 'view' || action === 'history') {
    window.location.href = `manage_payments.html?groupId=${currentGroup.groupId}&memberId=${memberId}&tab=history`;
  }
};

// Handle payment approval
window.handlePaymentApproval = async function(memberId, paymentType, groupId, approve) {
  try {
    showSpinner(true);
    const currentYear = new Date().getFullYear();
    
    const paymentRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberId}/PaymentDetails`);
    await updateDoc(paymentRef, {
      approvalStatus: approve ? "approved" : "rejected",
      approvedBy: currentUser.uid,
      approvedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    
    showToast(`Payment ${approve ? "approved" : "rejected"} successfully`, "success");
    addSystemAlert(`Payment ${approve ? "approved" : "rejected"}`, approve ? 'success' : 'warning');
    
    // Reload modal data and dashboard stats
    await loadDashboardStats();
    
    // Reload pending modal if it's open
    const modalOverlay = document.getElementById('statModalOverlay');
    if (modalOverlay && modalOverlay.classList.contains('open')) {
      const items = await loadPendingApprovalsData();
      renderStatModalItems(items, 'pending');
    }
    
  } catch (error) {
    console.error("Error handling payment approval:", error);
    showToast("Error: " + error.message, "danger");
  } finally {
    showSpinner(false);
  }
};

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modalOverlay = document.getElementById('statModalOverlay');
    if (modalOverlay && modalOverlay.classList.contains('open')) {
      closeStatModal();
    }
  }
});

// Update current date display
function updateCurrentDate() {
  const dateElement = document.getElementById('currentDate');
  if (dateElement) {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateElement.textContent = now.toLocaleDateString('en-US', options);
  }
}

// Load due payments for current month
async function loadDuePayments() {
  const duePaymentsContainer = document.getElementById('duePaymentsCards');
  if (!duePaymentsContainer) return;
  
  if (!currentGroup || !currentGroup.groupId) {
    duePaymentsContainer.innerHTML = '<div class="empty-state"><p>Select a group to view due payments</p></div>';
    return;
  }
  
  try {
    const groupId = currentGroup.groupId;
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthNames = ["January", "February", "March", "April", "May", "June", 
                       "July", "August", "September", "October", "November", "December"];
    const currentMonthName = monthNames[currentMonth];
    
    const duePayments = [];
    
    // Get members
    const membersRef = collection(db, "groups", groupId, "members");
    const membersSnapshot = await getDocs(membersRef);
    
    // Get group data for due date settings
    const groupDoc = await getDoc(doc(db, "groups", groupId));
    const groupData = groupDoc.exists() ? groupDoc.data() : {};
    const monthlyDueDay = groupData?.rules?.monthlyContribution?.dayOfMonth || groupData?.monthlyDueDay || 15;
    
    for (const memberDoc of membersSnapshot.docs) {
      const member = memberDoc.data();
      const memberId = memberDoc.id;
      
      // Check monthly contribution for current month
      try {
        const monthlyRef = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${memberId}`);
        const monthlySnapshot = await getDocs(monthlyRef);
        
        monthlySnapshot.forEach(monthDoc => {
          const paymentData = monthDoc.data();
          if (paymentData.month === currentMonthName && parseInt(paymentData.year) === currentYear) {
            const arrears = parseFloat(paymentData.arrears || 0);
            const totalAmount = parseFloat(paymentData.totalAmount || 0);
            const amountPaid = parseFloat(paymentData.amountPaid || 0);
            
            // Calculate due date
            const dueDate = new Date(currentYear, currentMonth, monthlyDueDay);
            const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
            const isOverdue = now > dueDate && arrears > 0;
            
            // Only show if there's an amount due or overdue
            if (totalAmount > 0 && (arrears > 0 || amountPaid < totalAmount)) {
              duePayments.push({
                memberId,
                memberName: member.fullName || 'Unknown Member',
                type: 'Monthly Contribution',
                amount: arrears > 0 ? arrears : (totalAmount - amountPaid),
                dueDate: dueDate,
                daysUntilDue,
                isOverdue
              });
            }
          }
        });
      } catch (e) {
        console.warn('Error loading monthly payment:', e);
      }
    }
    
    // Sort by overdue first, then by days until due
    duePayments.sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return a.daysUntilDue - b.daysUntilDue;
    });
    
    // Render cards (limit to 6 for sleek display)
    if (duePayments.length === 0) {
      duePaymentsContainer.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: var(--bn-space-4);">
          <div class="empty-state-icon">✅</div>
          <p class="empty-state-text">No payments due this month</p>
        </div>
      `;
    } else {
      const displayPayments = duePayments.slice(0, 6);
      let html = '';
      
      displayPayments.forEach(payment => {
        const initials = payment.memberName.charAt(0).toUpperCase();
        const dueDateStr = payment.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        html += `
          <div class="due-payment-card ${payment.isOverdue ? 'overdue' : ''}" onclick="window.location.href='manage_payments.html?groupId=${groupId}&memberId=${payment.memberId}&tab=arrears'" title="View ${payment.memberName}'s payments">
            <div class="due-payment-card-header">
              <div class="due-payment-avatar">${initials}</div>
              <div class="due-payment-name">${payment.memberName}</div>
            </div>
            <div class="due-payment-amount">${formatCurrency(payment.amount)}</div>
            <div class="due-payment-type">${payment.type}</div>
            <div class="due-payment-date">
              ${payment.isOverdue ? `⚠️ Overdue (${Math.abs(payment.daysUntilDue)} days)` : `Due: ${dueDateStr}`}
            </div>
          </div>
        `;
      });
      
      if (duePayments.length > 6) {
        html += `
          <div class="due-payment-card" style="border-left-color: var(--bn-gray-lighter); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-direction: column;" onclick="window.location.href='manage_payments.html?groupId=${groupId}&tab=arrears'">
            <div style="font-size: var(--bn-text-2xl); margin-bottom: var(--bn-space-2);">+${duePayments.length - 6}</div>
            <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); text-align: center;">More payments</div>
          </div>
        `;
      }
      
      duePaymentsContainer.innerHTML = html;
    }
  } catch (error) {
    console.error('Error loading due payments:', error);
    duePaymentsContainer.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">⚠️</div>
        <p class="empty-state-text">Error loading due payments</p>
      </div>
    `;
  }
}
