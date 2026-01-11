import {
  db,
  auth,
  onAuthStateChanged,
  signOut,
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
} from "./firebaseConfig.js";

// Global state
let currentUser = null;
let currentGroup = null;

// DOM Elements
const loadingOverlay = document.getElementById("loadingOverlay");
const userName = document.getElementById("userName");
const userRole = document.getElementById("userRole");
const userAvatar = document.getElementById("userAvatar");
const logoutBtn = document.getElementById("logoutBtn");
const mobileMenuToggle = document.getElementById("mobileMenuToggle");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

// Stat elements
const totalContributions = document.getElementById("totalContributions");
const availableBalance = document.getElementById("availableBalance");
const activeLoans = document.getElementById("activeLoans");
const loanCount = document.getElementById("loanCount");
const outstanding = document.getElementById("outstanding");

// Initialize app
document.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 Dashboard initializing...");
  
  // Setup event listeners
  setupEventListeners();
  
  // Check authentication
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      console.log("✅ User authenticated:", user.uid);
      currentUser = user;
      await loadUserData();
      await loadDashboardData();
    } else {
      console.log("❌ No user authenticated, redirecting to login");
      window.location.href = "../login.html";
    }
  });
});

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
  // Logout
  logoutBtn?.addEventListener("click", handleLogout);
  
  // Mobile menu toggle
  mobileMenuToggle?.addEventListener("click", () => {
    sidebar?.classList.toggle("open");
  });
  
  sidebarToggle?.addEventListener("click", () => {
    sidebar?.classList.toggle("open");
  });
  
  // Menu navigation
  const menuItems = document.querySelectorAll(".menu-item");
  menuItems.forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      switchSection(section);
      
      // Update active state
      menuItems.forEach(mi => mi.classList.remove("active"));
      item.classList.add("active");
      
      // Close mobile menu
      if (window.innerWidth <= 768) {
        sidebar?.classList.remove("open");
      }
    });
  });
  
  // Quick actions
  document.getElementById("makePaymentBtn")?.addEventListener("click", () => {
    switchSection("payments");
  });
  
  document.getElementById("requestLoanBtn")?.addEventListener("click", () => {
    switchSection("loans");
  });
  
  document.getElementById("viewReportsBtn")?.addEventListener("click", () => {
    switchSection("reports");
  });
  
  document.getElementById("contactAdminBtn")?.addEventListener("click", () => {
    // TODO: Open contact modal or navigate to contact page
    alert("Contact admin feature coming soon!");
  });
}

/**
 * Switch Dashboard Section
 */
function switchSection(sectionName) {
  const sections = document.querySelectorAll(".dashboard-section");
  sections.forEach(section => section.classList.remove("active"));
  
  const targetSection = document.getElementById(`${sectionName}Section`);
  if (targetSection) {
    targetSection.classList.add("active");
    
    // Update page title
    const titles = {
      overview: "Dashboard",
      payments: "Payments",
      loans: "Loans",
      group: "My Group",
      reports: "Reports",
      settings: "Settings"
    };
    document.querySelector(".page-title").textContent = titles[sectionName] || "Dashboard";
  }
}

/**
 * Load User Data
 */
async function loadUserData() {
  try {
    showLoading();
    
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    if (!userDoc.exists()) {
      throw new Error("User profile not found");
    }
    
    const userData = userDoc.data();
    
    // Update UI
    userName.textContent = userData.fullName || "User";
    userRole.textContent = userData.roles?.includes("admin") ? "Admin" : "Member";
    
    // Get user's first group (assuming users belong to at least one group)
    if (userData.groupMemberships && userData.groupMemberships.length > 0) {
      const groupId = userData.groupMemberships[0].groupId;
      await loadGroupData(groupId);
    }
    
    hideLoading();
  } catch (error) {
    console.error("❌ Error loading user data:", error);
    hideLoading();
    showError("Failed to load user data");
  }
}

/**
 * Load Group Data
 */
async function loadGroupData(groupId) {
  try {
    const groupDoc = await getDoc(doc(db, "groups", groupId));
    if (!groupDoc.exists()) {
      throw new Error("Group not found");
    }
    
    currentGroup = { id: groupId, ...groupDoc.data() };
    console.log("✅ Group loaded:", currentGroup.groupName);
  } catch (error) {
    console.error("❌ Error loading group data:", error);
  }
}

/**
 * Load Dashboard Data
 */
async function loadDashboardData() {
  try {
    if (!currentGroup) {
      console.warn("⚠️ No group data available");
      return;
    }
    
    // Load member financial data
    const memberDoc = await getDoc(doc(db, `groups/${currentGroup.id}/members`, currentUser.uid));
    
    if (memberDoc.exists()) {
      const memberData = memberDoc.data();
      const financialSummary = memberData.financialSummary || {};
      
      // Update stats
      totalContributions.textContent = formatCurrency(financialSummary.totalPaid || 0);
      availableBalance.textContent = formatCurrency(
        (financialSummary.totalPaid || 0) - (financialSummary.totalLoans || 0)
      );
      activeLoans.textContent = formatCurrency(financialSummary.totalLoans || 0);
      outstanding.textContent = formatCurrency(financialSummary.totalArrears || 0);
      
      // Update loan count
      const loansQuery = query(
        collection(db, `groups/${currentGroup.id}/loans`),
        where("borrowerId", "==", currentUser.uid),
        where("status", "==", "active")
      );
      const loansSnapshot = await getDocs(loansQuery);
      loanCount.textContent = loansSnapshot.size;
    }
    
    // Load recent activity
    await loadRecentActivity();
    
    // Load upcoming payments
    await loadUpcomingPayments();
    
  } catch (error) {
    console.error("❌ Error loading dashboard data:", error);
    showError("Failed to load dashboard data");
  }
}

/**
 * Load Recent Activity
 */
async function loadRecentActivity() {
  try {
    const activityContainer = document.getElementById("recentActivity");
    activityContainer.innerHTML = '<div class="activity-placeholder">No recent activity</div>';
    
    // TODO: Implement actual activity loading from Firestore
    // This would query transactions or payments related to the user
    
  } catch (error) {
    console.error("❌ Error loading recent activity:", error);
  }
}

/**
 * Load Upcoming Payments
 */
async function loadUpcomingPayments() {
  try {
    const paymentsContainer = document.getElementById("upcomingPayments");
    paymentsContainer.innerHTML = '<div class="payment-placeholder">No upcoming payments</div>';
    
    // TODO: Implement actual upcoming payments loading
    
  } catch (error) {
    console.error("❌ Error loading upcoming payments:", error);
  }
}

/**
 * Handle Logout
 */
async function handleLogout() {
  try {
    await signOut(auth);
    console.log("✅ User logged out successfully");
    window.location.href = "../login.html";
  } catch (error) {
    console.error("❌ Logout error:", error);
    showError("Failed to logout");
  }
}

/**
 * Utility Functions
 */
function showLoading() {
  loadingOverlay?.classList.remove("hidden");
}

function hideLoading() {
  loadingOverlay?.classList.add("hidden");
}

function showError(message) {
  // TODO: Implement proper error display
  console.error("Error:", message);
  alert(message);
}

function formatCurrency(amount) {
  return `MWK ${amount.toLocaleString()}`;
}
