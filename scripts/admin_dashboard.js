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

onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("User is signed in:", user.email);
  } else {
    console.log("No user is signed in.");
    alert("You must be signed in to access this page.");
    window.location.href = "../login.html";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const groupList = document.getElementById("groupList");
  const welcomeMessage = document.getElementById("welcomeMessage");
  const adminNameSpan = document.getElementById("adminName");
  const switchViewButton = document.getElementById("switchViewButton");
  const logoutButton = document.getElementById("logoutButton");
  const createGroupButton = document.getElementById("createGroupButton");
  const analyticsButton = document.getElementById("analyticsButton");
  const settingsButton = document.getElementById("settingsButton");
  
  // Stats elements
  const totalCollections = document.getElementById("totalCollections");
  const activeLoansCount = document.getElementById("activeLoansCount");
  const loansAmount = document.getElementById("loansAmount");
  const pendingApprovalsCount = document.getElementById("pendingApprovalsCount");
  const totalArrearsValue = document.getElementById("totalArrearsValue");
  const arrearsMembers = document.getElementById("arrearsMembers");
  const pendingBadge = document.getElementById("pendingBadge");
  const pendingList = document.getElementById("pendingList");
  const messageBadge = document.getElementById("messageBadge");
  const messagesList = document.getElementById("messagesList");
  
  // Quick action buttons
  const manageLoansButton = document.getElementById("manageLoansButton");
  const managePaymentsButton = document.getElementById("managePaymentsButton");
  const viewContributionsButton = document.getElementById("viewContributionsButton");
  const viewSeedMoneyButton = document.getElementById("viewSeedMoneyButton");
  const manageInterestButton = document.getElementById("manageInterestButton");
  const viewReportsButton = document.getElementById("viewReportsButton");

  let adminGroups = [];
  let currentUser = null;
  let sessionTimeout;

  // Format currency
  function formatCurrency(amount) {
    return "MWK " + Number(amount || 0).toLocaleString();
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Set session timeout for 1 hour
  function resetSessionTimer() {
    clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(async () => {
      alert("Your session has expired. You will be logged out.");
      await handleLogout();
    }, 60 * 60 * 1000);
  }

  // Handle logout functionality
  async function handleLogout() {
    try {
      await signOut(auth);
      alert("You have been logged out.");
      window.location.href = "../login.html";
    } catch (error) {
      console.error("Error signing out:", error.message);
      alert("An error occurred while logging out. Please try again.");
    }
  }

  // Load admin groups and statistics
  async function loadGroups(user) {
    groupList.innerHTML = "<li>Loading your groups...</li>";
    adminGroups = [];
  
    try {
      const groupsRef = collection(db, "groups");
      const querySnapshot = await getDocs(groupsRef);
  
      groupList.innerHTML = "";
      
      let totalCollectionsAmount = 0;
      let totalActiveLoans = 0;
      let totalLoansAmount = 0;
      let totalPending = 0;
      let totalArrears = 0;
      let membersWithArrears = 0;
      let pendingItems = [];
      let messageItems = [];
  
      for (const docSnapshot of querySnapshot.docs) {
        const groupData = docSnapshot.data();
        const groupId = docSnapshot.id;
  
        const isAdmin = groupData.admins?.some(
          (admin) => admin.email === user.email || admin.uid === user.uid
        );
        if (!isAdmin) continue;
        
        adminGroups.push({ id: groupId, ...groupData });
  
        // Fetch members
        const membersRef = collection(db, "groups/" + groupId + "/members");
        const membersSnapshot = await getDocs(membersRef);
        const memberCount = membersSnapshot.size;
        
        // Check for pending payments
        const currentYear = new Date().getFullYear();
        for (const memberDoc of membersSnapshot.docs) {
          const memberData = memberDoc.data();
          const memberId = memberDoc.id;
          
          // Check seed money pending
          try {
            const seedMoneyDocRef = doc(db, "groups/" + groupId + "/payments/" + currentYear + "_SeedMoney/" + memberId + "/PaymentDetails");
            const seedMoneyDoc = await getDoc(seedMoneyDocRef);
            if (seedMoneyDoc.exists()) {
              const paymentData = seedMoneyDoc.data();
              if (paymentData.approvalStatus === "pending") {
                totalPending++;
                pendingItems.push({
                  type: "Seed Money",
                  member: memberData.fullName || "Unknown",
                  group: groupData.groupName,
                  groupId: groupId,
                  memberId: memberId,
                  amount: paymentData.amountPaid || 0,
                  date: paymentData.submittedAt?.toDate ? paymentData.submittedAt.toDate() : new Date()
                });
              }
              if (paymentData.totalPaid) {
                totalCollectionsAmount += paymentData.totalPaid;
              }
              if (paymentData.arrears > 0) {
                totalArrears += paymentData.arrears;
                membersWithArrears++;
              }
            }
          } catch (e) {
            // Silent fail for missing docs
          }
          
          // Get member financial summary
          if (memberData.financialSummary) {
            totalCollectionsAmount += memberData.financialSummary.totalPaid || 0;
            totalArrears += memberData.financialSummary.totalArrears || 0;
            totalArrears += memberData.financialSummary.totalPenalties || 0;
          }
        }
        
        // Check for pending loans
        try {
          const loansRef = collection(db, "groups/" + groupId + "/loans");
          const loansSnapshot = await getDocs(loansRef);
          for (const loanDoc of loansSnapshot.docs) {
            const loanData = loanDoc.data();
            if (loanData.status === "pending") {
              totalPending++;
              pendingItems.push({
                type: "Loan Request",
                member: loanData.borrowerName || "Unknown",
                group: groupData.groupName,
                groupId: groupId,
                loanId: loanDoc.id,
                amount: loanData.loanAmount || 0,
                date: loanData.requestedAt?.toDate ? loanData.requestedAt.toDate() : new Date()
              });
            }
            if (loanData.status === "active" || loanData.status === "approved" || loanData.status === "disbursed") {
              totalActiveLoans++;
              totalLoansAmount += loanData.amountRemaining || loanData.loanAmount || 0;
            }
          }
        } catch (e) {
          // Silent fail
        }
        
        // Check for messages
        try {
          const messagesRef = collection(db, "groups/" + groupId + "/messages");
          const messagesSnapshot = await getDocs(messagesRef);
          for (const msgDoc of messagesSnapshot.docs) {
            const msgData = msgDoc.data();
            if (msgData.status === "open" || msgData.status === "in_progress") {
              messageItems.push({
                id: msgDoc.id,
                groupId: groupId,
                group: groupData.groupName,
                from: msgData.createdByName || "Unknown",
                subject: msgData.subject || "No subject",
                category: msgData.category || "general",
                date: msgData.createdAt?.toDate ? msgData.createdAt.toDate() : new Date(),
                unread: msgData.status === "open"
              });
            }
          }
        } catch (e) {
          // Silent fail
        }
  
        // Create group item
        const groupItem = document.createElement("li");
        groupItem.classList.add("group-item");
  
        groupItem.innerHTML = 
          '<a href="group_page.html?groupId=' + groupId + '" class="group-link">' +
            '<div class="details">' +
              '<h3>' + escapeHtml(groupData.groupName) + '</h3>' +
              '<p>Created: ' + (groupData.createdAt?.toDate ? new Date(groupData.createdAt.toDate()).toLocaleDateString() : "N/A") + '</p>' +
              '<p>Members: ' + memberCount + '</p>' +
            '</div>' +
          '</a>';
  
        groupList.appendChild(groupItem);
      }
  
      if (adminGroups.length === 0) {
        groupList.innerHTML = "<li>You are not an admin of any groups.</li>";
      }
      
      // Update statistics UI
      if (totalCollections) totalCollections.textContent = formatCurrency(totalCollectionsAmount);
      if (activeLoansCount) activeLoansCount.textContent = totalActiveLoans;
      if (loansAmount) loansAmount.textContent = formatCurrency(totalLoansAmount);
      if (pendingApprovalsCount) pendingApprovalsCount.textContent = totalPending;
      if (totalArrearsValue) totalArrearsValue.textContent = formatCurrency(totalArrears);
      if (arrearsMembers) arrearsMembers.textContent = membersWithArrears + " members";
      if (pendingBadge) pendingBadge.textContent = totalPending;
      
      // Render pending items
      renderPendingItems(pendingItems);
      
      // Render messages
      renderMessages(messageItems);
      
      // Populate broadcast group select
      populateBroadcastSelect();
      
    } catch (error) {
      console.error("Error loading groups:", error);
      groupList.innerHTML = "<li>Error loading groups. Please try again later.</li>";
    }
  }
  
  // Render pending approval items
  function renderPendingItems(items) {
    if (!pendingList) return;
    
    if (items.length === 0) {
      pendingList.innerHTML = 
        '<div class="empty-state">' +
          '<div class="icon">✅</div>' +
          '<p>No pending approvals</p>' +
        '</div>';
      return;
    }
    
    // Sort by date descending
    items.sort((a, b) => b.date - a.date);
    
    // Show first 5
    const displayItems = items.slice(0, 5);
    
    pendingList.innerHTML = displayItems.map(item => 
      '<div class="pending-item" data-type="' + item.type + '" data-group="' + item.groupId + '">' +
        '<div class="pending-info">' +
          '<h4>' + escapeHtml(item.type) + ': ' + formatCurrency(item.amount) + '</h4>' +
          '<p>' + escapeHtml(item.member) + ' - ' + escapeHtml(item.group) + '</p>' +
        '</div>' +
        '<div class="pending-actions">' +
          '<button class="btn-approve" onclick="approveItem(\'' + item.type + '\', \'' + item.groupId + '\', \'' + (item.memberId || item.loanId) + '\')">Approve</button>' +
          '<button class="btn-view" onclick="viewItem(\'' + item.type + '\', \'' + item.groupId + '\')">View</button>' +
        '</div>' +
      '</div>'
    ).join("");
  }
  
  // Render messages
  function renderMessages(items) {
    if (!messagesList) return;
    
    if (items.length === 0) {
      messagesList.innerHTML = 
        '<div class="empty-state">' +
          '<div class="icon">💬</div>' +
          '<p>No new messages</p>' +
        '</div>';
      return;
    }
    
    // Update badge
    const unreadCount = items.filter(m => m.unread).length;
    if (messageBadge && unreadCount > 0) {
      messageBadge.textContent = unreadCount;
      messageBadge.style.display = "inline";
    }
    
    // Sort by date descending
    items.sort((a, b) => b.date - a.date);
    
    // Show first 5
    const displayItems = items.slice(0, 5);
    
    messagesList.innerHTML = displayItems.map(item => 
      '<div class="message-item ' + (item.unread ? 'unread' : '') + '">' +
        '<div class="message-content">' +
          '<h4>' + escapeHtml(item.subject) + '</h4>' +
          '<p>From: ' + escapeHtml(item.from) + ' (' + escapeHtml(item.group) + ')</p>' +
        '</div>' +
        '<div class="message-meta">' +
          item.date.toLocaleDateString() +
        '</div>' +
      '</div>'
    ).join("");
  }
  
  // Populate broadcast select
  function populateBroadcastSelect() {
    const broadcastGroup = document.getElementById("broadcastGroup");
    if (!broadcastGroup) return;
    
    broadcastGroup.innerHTML = '<option value="">Select Group</option>';
    adminGroups.forEach(group => {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.groupName;
      broadcastGroup.appendChild(option);
    });
  }

  // Fetch admin's full name
  async function fetchAdminName(user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        return userData.fullName || "Admin";
      }
      return user.displayName || "Admin";
    } catch (error) {
      console.error("Error fetching admin name:", error.message);
      return "Admin";
    }
  }

  // Broadcast form submission
  const broadcastForm = document.getElementById("broadcastForm");
  if (broadcastForm) {
    broadcastForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const groupId = document.getElementById("broadcastGroup").value;
      const title = document.getElementById("broadcastTitle").value;
      const message = document.getElementById("broadcastMessage").value;
      
      if (!groupId || !title || !message) {
        alert("Please fill in all fields.");
        return;
      }
      
      try {
        const broadcastData = {
          broadcastId: "broadcast_" + Date.now(),
          type: "announcement",
          title: title,
          message: message,
          richContent: { type: "plain_text", content: message },
          createdBy: currentUser.uid,
          createdByName: adminNameSpan?.textContent || "Admin",
          createdAt: Timestamp.now(),
          scheduledFor: null,
          sentAt: Timestamp.now(),
          status: "sent",
          priority: "normal",
          targetAudience: { type: "all_members", specificMembers: [] },
          deliveryChannels: ["in_app"],
          deliveryStatus: { totalRecipients: 0, delivered: 0, read: 0, failed: 0 },
          expiresAt: null
        };
        
        await addDoc(collection(db, "groups/" + groupId + "/broadcasts"), broadcastData);
        
        alert("Broadcast sent successfully!");
        e.target.reset();
        
      } catch (error) {
        console.error("Error sending broadcast:", error.message);
        alert("Error sending broadcast. Please try again.");
      }
    });
  }

  // Navigation event listeners
  if (switchViewButton) {
    switchViewButton.addEventListener("click", () => {
      window.location.href = "user_dashboard.html";
    });
  }

  if (createGroupButton) {
    createGroupButton.addEventListener("click", () => {
      window.location.href = "../pages/admin_registration.html";
    });
  }

  const approveRegistrationsButton = document.getElementById("approveRegistrationsButton");
  if (approveRegistrationsButton) {
    approveRegistrationsButton.addEventListener("click", () => {
      window.location.href = "../pages/approve_registrations.html";
    });
  }

  if (analyticsButton) {
    analyticsButton.addEventListener("click", () => {
      window.location.href = "../pages/analytics.html";
    });
  }

  if (settingsButton) {
    settingsButton.addEventListener("click", () => {
      window.location.href = "../pages/settings.html";
    });
  }

  if (manageLoansButton) {
    manageLoansButton.addEventListener("click", () => {
      window.location.href = "../pages/manage_loans.html";
    });
  }

  if (managePaymentsButton) {
    managePaymentsButton.addEventListener("click", () => {
      window.location.href = "../pages/manage_payments.html";
    });
  }

  if (viewContributionsButton) {
    viewContributionsButton.addEventListener("click", () => {
      window.location.href = "../pages/contributions_overview.html";
    });
  }

  if (viewSeedMoneyButton) {
    viewSeedMoneyButton.addEventListener("click", () => {
      window.location.href = "../pages/seed_money_overview.html";
    });
  }

  if (manageInterestButton) {
    manageInterestButton.addEventListener("click", () => {
      window.location.href = "../pages/interest_penalties.html";
    });
  }

  if (viewReportsButton) {
    viewReportsButton.addEventListener("click", () => {
      window.location.href = "../pages/financial_reports.html";
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      await handleLogout();
    });
  }

  // Listen for authentication state changes
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      const adminName = await fetchAdminName(user);
      if (adminNameSpan) adminNameSpan.textContent = adminName;
      if (welcomeMessage) welcomeMessage.innerHTML = "Welcome, <span id='adminName'>" + adminName + "</span>";
      await loadGroups(user);
      resetSessionTimer();
    } else {
      alert("No user is currently logged in. Redirecting to login...");
      window.location.href = "../login.html";
    }
  });

  // Reset session timer on user interaction
  ["click", "keypress", "mousemove", "scroll"].forEach((event) =>
    window.addEventListener(event, resetSessionTimer)
  );
});

// Global functions for pending item actions
window.approveItem = async function(type, groupId, itemId) {
  alert("Approving " + type + " - redirecting to approval page...");
  if (type === "Loan Request") {
    window.location.href = "manage_loans.html?groupId=" + groupId;
  } else {
    window.location.href = "manage_payments.html?groupId=" + groupId;
  }
};

window.viewItem = function(type, groupId) {
  if (type === "Loan Request") {
    window.location.href = "manage_loans.html?groupId=" + groupId;
  } else {
    window.location.href = "manage_payments.html?groupId=" + groupId;
  }
};
