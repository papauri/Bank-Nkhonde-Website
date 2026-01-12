import {
  db,
  auth,
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  where,
  onAuthStateChanged,
  signOut,
} from "./firebaseConfig.js";

// Global state
let currentUser = null;
let userGroups = [];

// DOM Elements
const spinner = document.getElementById("spinner");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const userAvatar = document.getElementById("userAvatar");
const groupsGrid = document.getElementById("groupsGrid");
const emptyState = document.getElementById("emptyState");
const pendingPaymentsBadge = document.getElementById("pendingPaymentsBadge");
const loanRequestsBadge = document.getElementById("loanRequestsBadge");
const broadcastsBadge = document.getElementById("broadcastsBadge");
const logoutBtn = document.getElementById("logoutBtn");

// Initialize app
onAuthStateChanged(auth, async (user) => {
  if (user) {
    console.log("User is signed in:", user.email);
    currentUser = user;
    showSpinner(true);
    await loadUserData();
    await loadUserGroups();
    await loadNotificationCounts();
    showSpinner(false);
  } else {
    console.log("No user is signed in.");
    window.location.href = "../login.html";
  }
});

// Setup event listeners
document.addEventListener("DOMContentLoaded", () => {
  logoutBtn?.addEventListener("click", handleLogout);
});

async function handleLogout() {
  try {
    await signOut(auth);
    window.location.href = "../login.html";
  } catch (error) {
    console.error("Error signing out:", error);
    alert("Error signing out: " + error.message);
  }
}

async function loadUserData() {
  try {
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      const displayName = userData.fullName || currentUser.email.split("@")[0];
      
      if (userName) userName.textContent = displayName;
      if (userEmail) userEmail.textContent = currentUser.email;
      if (userAvatar) userAvatar.textContent = displayName.charAt(0).toUpperCase();
    }
  } catch (error) {
    console.error("Error loading user data:", error);
  }
}

async function loadUserGroups() {
  try {
    userGroups = [];
    
    // Get groups where user is creator/admin
    const groupsRef = collection(db, "groups");
    const adminQuery = query(groupsRef, where("createdBy", "==", currentUser.uid));
    const adminSnapshot = await getDocs(adminQuery);
    
    adminSnapshot.forEach(doc => {
      userGroups.push({ 
        ...doc.data(), 
        groupId: doc.id, 
        role: "admin" 
      });
    });
    
    // Get all groups to check membership
    const allGroupsSnapshot = await getDocs(collection(db, "groups"));
    
    for (const groupDoc of allGroupsSnapshot.docs) {
      const groupData = groupDoc.data();
      const groupId = groupDoc.id;
      
      // Skip if already added as admin
      if (userGroups.find(g => g.groupId === groupId)) continue;
      
      // Check if user is in admins array
      if (groupData.admins?.some(admin => admin.uid === currentUser.uid)) {
        userGroups.push({ 
          ...groupData, 
          groupId, 
          role: "admin" 
        });
        continue;
      }
      
      // Check if user is a member
      try {
        const memberDoc = await getDoc(doc(db, "groups", groupId, "members", currentUser.uid));
        if (memberDoc.exists()) {
          userGroups.push({ 
            ...groupData, 
            groupId, 
            role: "member" 
          });
        }
      } catch (e) {
        // Member doc doesn't exist
      }
    }
    
    renderGroups();
  } catch (error) {
    console.error("Error loading groups:", error);
    if (emptyState) {
      emptyState.innerHTML = `
        <div class="empty-state-icon">❌</div>
        <p class="empty-state-text">Error loading groups. Please try again.</p>
      `;
    }
  }
}

async function loadNotificationCounts() {
  try {
    let pendingPayments = 0;
    let pendingLoans = 0;
    let unreadBroadcasts = 0;
    
    const currentYear = new Date().getFullYear();
    
    for (const group of userGroups) {
      if (group.role !== "admin") continue;
      
      // Count pending payments
      const membersRef = collection(db, "groups", group.groupId, "members");
      const membersSnapshot = await getDocs(membersRef);
      
      for (const memberDoc of membersSnapshot.docs) {
        const userId = memberDoc.id;
        
        // Check Seed Money payments
        try {
          const seedMoneyRef = doc(db, `groups/${group.groupId}/payments/${currentYear}_SeedMoney/${userId}/PaymentDetails`);
          const seedMoneyDoc = await getDoc(seedMoneyRef);
          if (seedMoneyDoc.exists() && seedMoneyDoc.data().approvalStatus === "pending") {
            pendingPayments++;
          }
        } catch (e) {}
        
        // Check Monthly Contributions
        try {
          const monthlyRef = collection(db, `groups/${group.groupId}/payments/${currentYear}_MonthlyContributions/${userId}`);
          const monthlySnapshot = await getDocs(monthlyRef);
          monthlySnapshot.forEach(monthDoc => {
            if (monthDoc.data().approvalStatus === "pending") {
              pendingPayments++;
            }
          });
        } catch (e) {}
      }
      
      // Count pending loans
      const loansRef = collection(db, "groups", group.groupId, "loans");
      const pendingLoansQuery = query(loansRef, where("status", "==", "pending"));
      const loansSnapshot = await getDocs(pendingLoansQuery);
      pendingLoans += loansSnapshot.size;
    }
    
    // Update badges
    if (pendingPaymentsBadge) pendingPaymentsBadge.textContent = pendingPayments;
    if (loanRequestsBadge) loanRequestsBadge.textContent = pendingLoans;
    if (broadcastsBadge) broadcastsBadge.textContent = unreadBroadcasts;
    
  } catch (error) {
    console.error("Error loading notification counts:", error);
  }
}

function renderGroups() {
  if (!groupsGrid) return;
  
  if (userGroups.length === 0) {
    groupsGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">📁</div>
        <p class="empty-state-text">You haven't joined any groups yet.</p>
        <a href="admin_registration.html" class="btn btn-accent">Create Your First Group</a>
      </div>
    `;
    return;
  }
  
  groupsGrid.innerHTML = userGroups.map(group => {
    const stats = group.statistics || {};
    const isAdmin = group.role === "admin";
    
    return `
      <div class="group-card" onclick="selectGroup('${group.groupId}', '${isAdmin ? 'admin' : 'user'}')">
        <div class="group-header">
          <h3 class="group-name">${group.groupName || 'Unnamed Group'}</h3>
          <span class="group-role ${group.role}">${group.role === 'admin' ? 'Admin' : 'Member'}</span>
        </div>
        <div class="group-stats">
          <div class="group-stat">
            <div class="group-stat-value">${stats.totalMembers || 0}</div>
            <div class="group-stat-label">Members</div>
          </div>
          <div class="group-stat">
            <div class="group-stat-value">${formatCurrency(stats.totalFunds || 0)}</div>
            <div class="group-stat-label">Total Funds</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function formatCurrency(amount) {
  const num = parseFloat(amount || 0);
  if (num >= 1000000) {
    return `MWK ${(num / 1000000).toFixed(1)}M`;
  } else if (num >= 1000) {
    return `MWK ${(num / 1000).toFixed(0)}K`;
  }
  return `MWK ${num.toLocaleString()}`;
}

function showSpinner(show) {
  if (show) {
    spinner?.classList.remove("hidden");
  } else {
    spinner?.classList.add("hidden");
  }
}

// Global function for group selection
window.selectGroup = function(groupId, role) {
  // Store selected group in session
  sessionStorage.setItem('selectedGroupId', groupId);
  sessionStorage.setItem('userRole', role);
  
  // Redirect to appropriate dashboard
  if (role === 'admin') {
    window.location.href = 'admin_dashboard.html';
  } else {
    window.location.href = 'user_dashboard.html';
  }
};
