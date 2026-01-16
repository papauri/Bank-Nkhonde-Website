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
  Timestamp,
} from "./firebaseConfig.js";

// Global state
let currentUser = null;
let currentGroup = null;
let userGroups = [];

// DOM Elements
const spinner = document.getElementById("spinner");
const userName = document.getElementById("userName");
const groupName = document.getElementById("groupName");
const totalSavings = document.getElementById("totalSavings");
const lastUpdated = document.getElementById("lastUpdated");
const totalPaid = document.getElementById("totalPaid");
const totalPending = document.getElementById("totalPending");
const totalArrears = document.getElementById("totalArrears");
const activeLoansCount = document.getElementById("activeLoans");
const pendingPaymentsList = document.getElementById("pendingPaymentsList");
const activeLoansList = document.getElementById("activeLoansList");
const recentActivityList = document.getElementById("recentActivityList");
const groupSelector = document.getElementById("groupSelector");
const groupSelect = document.getElementById("groupSelect");
const pendingCount = document.getElementById("pendingCount");

// Initialize app
document.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 User Dashboard initializing...");
  
  // Setup event listeners
  setupEventListeners();
  
  // Check authentication
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      console.log("✅ User authenticated:", user.uid);
      currentUser = user;
      showSpinner(true);
      await loadUserData();
      await loadDashboardData();
      showSpinner(false);
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
  // Header actions
  document.getElementById("settingsBtn")?.addEventListener("click", () => {
    window.location.href = "settings.html";
  });
  
  document.getElementById("notificationBtn")?.addEventListener("click", () => {
    window.location.href = "messages.html";
  });
  
  // Quick actions
  document.getElementById("makePaymentBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "manage_payments.html";
  });
  
  document.getElementById("requestLoanBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    // Check if user is eligible for loan
    if (currentGroup) {
      window.location.href = "manage_loans.html";
    } else {
      showToast("Please select a group first", "warning");
    }
  });
  
  document.getElementById("viewHistoryBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    showToast("Transaction history feature coming soon!", "info");
  });
  
  document.getElementById("viewReportsBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "financial_reports.html";
  });
  
  // View all links
  document.getElementById("viewAllPayments")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "manage_payments.html";
  });
  
  document.getElementById("viewAllLoans")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "manage_loans.html";
  });
  
  // Mobile navigation
  document.getElementById("navPayments")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "manage_payments.html";
  });
  
  document.getElementById("navLoans")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "manage_loans.html";
  });
  
  document.getElementById("navProfile")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "settings.html";
  });
  
  // Group selector
  groupSelect?.addEventListener("change", async (e) => {
    const selectedGroupId = e.target.value;
    if (selectedGroupId) {
      currentGroup = userGroups.find(g => g.groupId === selectedGroupId);
      await loadDashboardData();
    }
  });
}

/**
 * Load user data from Firestore
 */
async function loadUserData() {
  try {
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      userName.textContent = userData.fullName || userData.email.split("@")[0];
      
      // Get user's groups
      if (userData.groupMemberships && userData.groupMemberships.length > 0) {
        userGroups = [];
        for (const membership of userData.groupMemberships) {
          const groupDoc = await getDoc(doc(db, "groups", membership.groupId));
          if (groupDoc.exists()) {
            userGroups.push({ ...groupDoc.data(), groupId: groupDoc.id });
          }
        }
        
        // Set current group (first one by default)
        if (userGroups.length > 0) {
          currentGroup = userGroups[0];
          groupName.textContent = currentGroup.groupName;
          
          // Show group selector if user has multiple groups
          if (userGroups.length > 1) {
            groupSelector.classList.remove("hidden");
            groupSelect.innerHTML = userGroups.map(g => 
              `<option value="${g.groupId}" ${g.groupId === currentGroup.groupId ? 'selected' : ''}>${g.groupName}</option>`
            ).join('');
          }
        } else {
          groupName.textContent = "No group assigned";
          showToast("You haven't joined any group yet. Please contact an admin.", "warning");
        }
      } else {
        groupName.textContent = "No group assigned";
        showToast("You haven't joined any group yet. Please contact an admin.", "warning");
      }
    } else {
      console.error("User document not found");
      showToast("Error loading user data", "error");
    }
  } catch (error) {
    console.error("Error loading user data:", error);
    showToast("Error loading user data: " + error.message, "error");
  }
}

/**
 * Load dashboard data
 */
async function loadDashboardData() {
  if (!currentGroup) {
    console.log("No group selected");
    return;
  }
  
  try {
    // Load member financial summary
    const memberDoc = await getDoc(doc(db, "groups", currentGroup.groupId, "members", currentUser.uid));
    if (memberDoc.exists()) {
      const memberData = memberDoc.data();
      const summary = memberData.financialSummary || {};
      
      // Update stats
      totalSavings.textContent = formatCurrency(summary.totalContributions || 0);
      totalPaid.textContent = formatCurrency(summary.totalPaid || 0);
      totalPending.textContent = formatCurrency(summary.totalPending || 0);
      totalArrears.textContent = formatCurrency(summary.totalArrears || 0);
      
      lastUpdated.textContent = new Date().toLocaleString();
    }
    
    // Load active loans count
    await loadActiveLoans();
    
    // Load pending payments
    await loadPendingPayments();
    
    // Load recent activity
    await loadRecentActivity();
    
  } catch (error) {
    console.error("Error loading dashboard data:", error);
    showToast("Error loading dashboard: " + error.message, "error");
  }
}

/**
 * Load active loans
 */
async function loadActiveLoans() {
  try {
    const loansRef = collection(db, "groups", currentGroup.groupId, "loans");
    const q = query(
      loansRef,
      where("borrowerId", "==", currentUser.uid),
      where("status", "in", ["approved", "active", "pending"])
    );
    const snapshot = await getDocs(q);
    
    activeLoansCount.textContent = snapshot.size;
    
    if (!snapshot.empty) {
      activeLoansList.innerHTML = "";
      snapshot.forEach(doc => {
        const loan = doc.data();
        const loanElement = createLoanElement(loan);
        activeLoansList.appendChild(loanElement);
      });
    }
  } catch (error) {
    console.error("Error loading active loans:", error);
  }
}

/**
 * Load pending payments
 */
async function loadPendingPayments() {
  try {
    // Get current year for payment queries
    const currentYear = new Date().getFullYear();
    
    // Query seed money payments
    const seedMoneyRef = collection(db, "groups", currentGroup.groupId, "payments", `${currentYear}_SeedMoney`, currentUser.uid);
    const seedMoneySnapshot = await getDocs(query(seedMoneyRef, where("paymentStatus", "==", "pending")));
    
    // Query monthly contributions
    const contributionsRef = collection(db, "groups", currentGroup.groupId, "payments", `${currentYear}_MonthlyContribution`, currentUser.uid);
    const contributionsSnapshot = await getDocs(query(contributionsRef, where("paymentStatus", "==", "pending")));
    
    const allPending = [];
    seedMoneySnapshot.forEach(doc => allPending.push({ ...doc.data(), id: doc.id }));
    contributionsSnapshot.forEach(doc => allPending.push({ ...doc.data(), id: doc.id }));
    
    if (allPending.length > 0) {
      pendingCount.textContent = allPending.length;
      pendingCount.classList.remove("hidden");
      pendingPaymentsList.innerHTML = "";
      
      allPending.forEach(payment => {
        const paymentElement = createPaymentElement(payment);
        pendingPaymentsList.appendChild(paymentElement);
      });
    } else {
      pendingCount.classList.add("hidden");
    }
  } catch (error) {
    console.error("Error loading pending payments:", error);
  }
}

/**
 * Load recent activity
 */
async function loadRecentActivity() {
  try {
    const transactionsRef = collection(db, "groups", currentGroup.groupId, "transactions");
    const q = query(
      transactionsRef,
      where("userId", "==", currentUser.uid),
      orderBy("createdAt", "desc"),
      limit(5)
    );
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      recentActivityList.innerHTML = "";
      snapshot.forEach(doc => {
        const transaction = doc.data();
        const activityElement = createActivityElement(transaction);
        recentActivityList.appendChild(activityElement);
      });
    }
  } catch (error) {
    console.error("Error loading recent activity:", error);
  }
}

/**
 * Create loan list element
 */
function createLoanElement(loan) {
  const div = document.createElement("div");
  div.className = "list-item";
  
  const status = loan.status === "approved" ? "approved" : loan.status === "pending" ? "pending" : "overdue";
  
  div.innerHTML = `
    <div class="list-item-content">
      <h4>Loan #${loan.loanId?.substring(0, 8) || 'Unknown'}</h4>
      <p>${formatDate(loan.requestedAt)} • ${loan.status}</p>
    </div>
    <div class="list-item-meta">
      <div class="list-item-amount">${formatCurrency(loan.amountRemaining || loan.loanAmount)}</div>
      <span class="list-item-status status-${status}">${loan.status}</span>
    </div>
  `;
  
  return div;
}

/**
 * Create payment list element
 */
function createPaymentElement(payment) {
  const div = document.createElement("div");
  div.className = "list-item";
  
  const status = payment.approvalStatus === "approved" ? "approved" : "pending";
  
  div.innerHTML = `
    <div class="list-item-content">
      <h4>${payment.paymentType}</h4>
      <p>Due: ${formatDate(payment.dueDate)}</p>
    </div>
    <div class="list-item-meta">
      <div class="list-item-amount">${formatCurrency(payment.totalAmount)}</div>
      <span class="list-item-status status-${status}">${payment.approvalStatus}</span>
    </div>
  `;
  
  return div;
}

/**
 * Create activity list element
 */
function createActivityElement(transaction) {
  const div = document.createElement("div");
  div.className = "list-item";
  
  div.innerHTML = `
    <div class="list-item-content">
      <h4>${transaction.transactionType}</h4>
      <p>${formatDate(transaction.createdAt)}</p>
    </div>
    <div class="list-item-meta">
      <div class="list-item-amount">${formatCurrency(transaction.amount)}</div>
    </div>
  `;
  
  return div;
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
function showToast(message, type = "info") {
  // Create toast element
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // Show toast
  setTimeout(() => toast.classList.add("show"), 100);
  
  // Hide and remove toast after 3 seconds
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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

/**
 * Handle logout
 */
async function handleLogout() {
  try {
    await signOut(auth);
    window.location.href = "../login.html";
  } catch (error) {
    console.error("Error signing out:", error);
    showToast("Error signing out: " + error.message, "error");
  }
}
