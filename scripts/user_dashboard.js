import {
  db,
  auth,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  onAuthStateChanged,
  signOut,
  Timestamp,
} from "./firebaseConfig.js";

document.addEventListener("DOMContentLoaded", () => {
  const groupList = document.getElementById("groupList");
  const userNameSpan = document.getElementById("userName");
  const userEmailSpan = document.getElementById("userEmail");
  const profileInitials = document.getElementById("profileInitials");
  const profileAvatar = document.getElementById("profileAvatar");
  const membershipInfo = document.getElementById("membershipInfo");
  const switchViewButton = document.getElementById("switchViewButton");
  const logoutButton = document.getElementById("logoutButton");
  const settingsButton = document.getElementById("settingsButton");
  
  // Financial overview elements
  const totalContributed = document.getElementById("totalContributed");
  const activeLoans = document.getElementById("activeLoans");
  const pendingPayments = document.getElementById("pendingPayments");
  const totalArrears = document.getElementById("totalArrears");
  const alertBadge = document.getElementById("alertBadge");
  const upcomingPaymentsContainer = document.getElementById("upcomingPayments");
  
  // Modal elements
  const loanModal = document.getElementById("loanModal");
  const paymentModal = document.getElementById("paymentModal");
  const profileModal = document.getElementById("profileModal");
  const messageModal = document.getElementById("messageModal");
  
  // Quick action buttons
  const requestLoanBtn = document.getElementById("requestLoanBtn");
  const uploadPaymentBtn = document.getElementById("uploadPaymentBtn");
  const viewMembersBtn = document.getElementById("viewMembersBtn");
  const viewRulesBtn = document.getElementById("viewRulesBtn");
  const messagesBtn = document.getElementById("messagesBtn");
  const editProfileBtn = document.getElementById("editProfileBtn");

  let currentUser = null;
  let userGroups = [];
  let sessionTimeout;

  // Format currency
  function formatCurrency(amount) {
    return "MWK " + Number(amount || 0).toLocaleString();
  }

  // Get initials from name
  function getInitials(name) {
    if (!name) return "U";
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
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

  // Fetch user's profile data
  async function fetchUserProfile(user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userNameSpan) userNameSpan.textContent = userData.fullName || "User";
        if (userEmailSpan) userEmailSpan.textContent = user.email;
        if (profileInitials) profileInitials.textContent = getInitials(userData.fullName);
        
        if (userData.profileImageUrl && profileAvatar) {
          profileAvatar.innerHTML = '<img src="' + userData.profileImageUrl + '" alt="Profile">';
        }
        
        if (userData.createdAt && membershipInfo) {
          const joinDate = userData.createdAt.toDate ? userData.createdAt.toDate() : new Date(userData.createdAt);
          membershipInfo.textContent = "Member since: " + joinDate.toLocaleDateString();
        }
        
        // Populate edit profile form
        const editFullName = document.getElementById("editFullName");
        const editPhone = document.getElementById("editPhone");
        const editWhatsApp = document.getElementById("editWhatsApp");
        const editProfileInitials = document.getElementById("editProfileInitials");
        
        if (editFullName) editFullName.value = userData.fullName || "";
        if (editPhone) editPhone.value = userData.phone || "";
        if (editWhatsApp) editWhatsApp.value = userData.whatsappNumber || "";
        if (editProfileInitials) editProfileInitials.textContent = getInitials(userData.fullName);
        
        return userData;
      }
      return null;
    } catch (error) {
      console.error("Error fetching user profile:", error.message);
      return null;
    }
  }

  // Load user groups
  async function loadUserGroups(user) {
    groupList.innerHTML = "<li>Loading your groups...</li>";
    userGroups = [];
    
    try {
      const groupsQuery = query(collection(db, "groups"));
      const querySnapshot = await getDocs(groupsQuery);

      groupList.innerHTML = "";

      for (const groupDoc of querySnapshot.docs) {
        const group = groupDoc.data();
        const groupId = groupDoc.id;

        const memberDoc = await getDoc(doc(db, "groups/" + groupId + "/members", user.uid));
        const isAdmin = group.admins?.some(
          (admin) => admin.uid === user.uid || admin.email === user.email
        );

        if (memberDoc.exists() || isAdmin) {
          userGroups.push({ id: groupId, ...group, memberData: memberDoc.exists() ? memberDoc.data() : null });
        }
      }

      if (userGroups.length === 0) {
        groupList.innerHTML = "<li>You are not part of any groups yet.</li>";
      } else {
        userGroups.forEach((group) => {
          const groupId = group.id;
          const groupItem = document.createElement("li");
          groupItem.classList.add("group-item");

          groupItem.innerHTML = 
            '<a href="group_page.html?groupId=' + groupId + '" class="group-link">' +
              '<div class="details">' +
                '<h3>' + escapeHtml(group.groupName) + '</h3>' +
                '<p>Created: ' + (group.createdAt?.toDate ? new Date(group.createdAt.toDate()).toLocaleDateString() : "N/A") + '</p>' +
                '<p class="member-count">Members: Loading...</p>' +
              '</div>' +
            '</a>';

          groupList.appendChild(groupItem);

          getDocs(collection(db, "groups", groupId, "members")).then((membersSnapshot) => {
            const memberCount = membersSnapshot.size;
            groupItem.querySelector(".member-count").textContent = "Members: " + memberCount;
          });
        });
        
        // Populate group selects in modals
        populateGroupSelects();
        
        // Load financial summary
        await loadFinancialSummary(user);
      }
    } catch (error) {
      console.error("Error loading user groups:", error.message);
      groupList.innerHTML = "<li>Error loading groups. Please try again later.</li>";
    }
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Populate group selects in modals
  function populateGroupSelects() {
    const selects = [
      document.getElementById("loanGroup"),
      document.getElementById("paymentGroup"),
      document.getElementById("messageGroup")
    ];
    
    selects.forEach(select => {
      if (select) {
        select.innerHTML = '<option value="">Choose a group...</option>';
        userGroups.forEach(group => {
          const option = document.createElement("option");
          option.value = group.id;
          option.textContent = group.groupName;
          select.appendChild(option);
        });
      }
    });
  }

  // Load financial summary
  async function loadFinancialSummary(user) {
    let totalContributedAmount = 0;
    let totalActiveLoans = 0;
    let totalPendingAmount = 0;
    let totalArrearsAmount = 0;
    let upcomingPaymentsList = [];
    let alertCount = 0;

    try {
      for (const group of userGroups) {
        const groupId = group.id;
        
        // Get member financial summary
        const memberDoc = await getDoc(doc(db, "groups/" + groupId + "/members", user.uid));
        if (memberDoc.exists()) {
          const memberData = memberDoc.data();
          const financialSummary = memberData.financialSummary || {};
          
          totalContributedAmount += financialSummary.totalPaid || 0;
          totalActiveLoans += financialSummary.totalLoans || 0;
          totalArrearsAmount += financialSummary.totalArrears || 0;
          totalArrearsAmount += financialSummary.totalPenalties || 0;
        }
      }

      // Update UI
      if (totalContributed) totalContributed.textContent = formatCurrency(totalContributedAmount);
      if (activeLoans) activeLoans.textContent = formatCurrency(totalActiveLoans);
      if (pendingPayments) pendingPayments.textContent = formatCurrency(totalPendingAmount);
      if (totalArrears) totalArrears.textContent = formatCurrency(totalArrearsAmount);
      
      if (alertCount > 0 && alertBadge) {
        alertBadge.textContent = alertCount;
        alertBadge.style.display = "inline";
      }
      
      // Render upcoming payments
      renderUpcomingPayments(upcomingPaymentsList);
      
    } catch (error) {
      console.error("Error loading financial summary:", error.message);
    }
  }

  // Render upcoming payments
  function renderUpcomingPayments(payments) {
    if (!upcomingPaymentsContainer) return;
    
    if (payments.length === 0) {
      upcomingPaymentsContainer.innerHTML = 
        '<div class="empty-state">' +
          '<div class="icon">✅</div>' +
          '<p>No upcoming payments due</p>' +
        '</div>';
      return;
    }
    
    // Sort by due date
    payments.sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate - b.dueDate;
    });
    
    // Show first 5
    const displayPayments = payments.slice(0, 5);
    
    upcomingPaymentsContainer.innerHTML = displayPayments.map(payment => 
      '<div class="payment-item">' +
        '<div class="payment-info">' +
          '<h4>' + escapeHtml(payment.type) + '</h4>' +
          '<p>' + escapeHtml(payment.group) + '</p>' +
        '</div>' +
        '<div class="payment-amount">' +
          '<div class="amount">' + formatCurrency(payment.amount) + '</div>' +
          '<div class="due-date ' + (payment.overdue ? 'overdue' : '') + '">' +
            (payment.dueDate ? (payment.overdue ? 'OVERDUE' : 'Due: ' + payment.dueDate.toLocaleDateString()) : 'No due date') +
          '</div>' +
        '</div>' +
      '</div>'
    ).join("");
  }

  // Check if user is admin of any group
  async function checkIfUserIsAdmin(user) {
    try {
      const groupsRef = collection(db, "groups");
      const querySnapshot = await getDocs(groupsRef);
      
      for (const docSnapshot of querySnapshot.docs) {
        const groupData = docSnapshot.data();
        const isAdmin = groupData.admins?.some(
          (admin) => admin.email === user.email || admin.uid === user.uid
        );
        if (isAdmin) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error("Error checking admin status:", error.message);
      return false;
    }
  }

  // Modal handling functions
  function openModal(modal) {
    if (modal) modal.classList.add("active");
  }
  
  function closeModal(modal) {
    if (modal) modal.classList.remove("active");
  }

  // Event Listeners for Quick Actions
  if (requestLoanBtn) {
    requestLoanBtn.addEventListener("click", () => {
      if (userGroups.length === 0) {
        alert("You need to be part of a group to request a loan.");
        return;
      }
      openModal(loanModal);
    });
  }

  if (uploadPaymentBtn) {
    uploadPaymentBtn.addEventListener("click", () => {
      if (userGroups.length === 0) {
        alert("You need to be part of a group to upload a payment.");
        return;
      }
      const paymentDate = document.getElementById("paymentDate");
      if (paymentDate) paymentDate.value = new Date().toISOString().split("T")[0];
      openModal(paymentModal);
    });
  }

  if (viewMembersBtn) {
    viewMembersBtn.addEventListener("click", () => {
      if (userGroups.length === 1) {
        window.location.href = "group_page.html?groupId=" + userGroups[0].id + "#members";
      } else if (userGroups.length > 1) {
        const groupId = prompt("Enter group name to view members:\n" + userGroups.map(g => g.groupName).join("\n"));
        const selectedGroup = userGroups.find(g => g.groupName.toLowerCase() === groupId?.toLowerCase());
        if (selectedGroup) {
          window.location.href = "group_page.html?groupId=" + selectedGroup.id + "#members";
        }
      } else {
        alert("You are not part of any groups.");
      }
    });
  }

  if (viewRulesBtn) {
    viewRulesBtn.addEventListener("click", () => {
      if (userGroups.length === 1) {
        window.location.href = "group_page.html?groupId=" + userGroups[0].id + "#rules";
      } else if (userGroups.length > 1) {
        alert("Please select a group from your groups list to view rules.");
      } else {
        alert("You are not part of any groups.");
      }
    });
  }

  if (messagesBtn) {
    messagesBtn.addEventListener("click", () => {
      if (userGroups.length === 0) {
        alert("You need to be part of a group to send messages.");
        return;
      }
      openModal(messageModal);
    });
  }

  if (editProfileBtn) {
    editProfileBtn.addEventListener("click", () => {
      openModal(profileModal);
    });
  }

  // Close modal buttons
  const closeLoanModal = document.getElementById("closeLoanModal");
  const closePaymentModal = document.getElementById("closePaymentModal");
  const closeProfileModal = document.getElementById("closeProfileModal");
  const closeMessageModal = document.getElementById("closeMessageModal");
  
  if (closeLoanModal) closeLoanModal.addEventListener("click", () => closeModal(loanModal));
  if (closePaymentModal) closePaymentModal.addEventListener("click", () => closeModal(paymentModal));
  if (closeProfileModal) closeProfileModal.addEventListener("click", () => closeModal(profileModal));
  if (closeMessageModal) closeMessageModal.addEventListener("click", () => closeModal(messageModal));

  // Close modals on overlay click
  [loanModal, paymentModal, profileModal, messageModal].forEach(modal => {
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          closeModal(modal);
        }
      });
    }
  });

  // Loan Request Form
  const loanRequestForm = document.getElementById("loanRequestForm");
  if (loanRequestForm) {
    loanRequestForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const groupId = document.getElementById("loanGroup").value;
      const amount = parseFloat(document.getElementById("loanAmount").value);
      const purpose = document.getElementById("loanPurpose").value;
      const description = document.getElementById("loanDescription").value;
      const repaymentMonths = parseInt(document.getElementById("repaymentMonths").value);
      
      if (!groupId || !amount || !purpose) {
        alert("Please fill in all required fields.");
        return;
      }
      
      try {
        const group = userGroups.find(g => g.id === groupId);
        const interestRate = group?.rules?.interestRate || 15;
        const totalRepayable = amount * (1 + interestRate / 100);
        const editFullName = document.getElementById("editFullName");
        
        const loanData = {
          loanId: "loan_" + Date.now(),
          borrowerId: currentUser.uid,
          borrowerName: editFullName?.value || currentUser.email,
          borrowerEmail: currentUser.email,
          loanAmount: amount,
          interestRate: interestRate,
          totalRepayable: totalRepayable,
          amountPaid: 0,
          amountRemaining: totalRepayable,
          status: "pending",
          requestedAt: Timestamp.now(),
          approvedAt: null,
          approvedBy: null,
          repaymentPeriodMonths: repaymentMonths,
          purpose: description || purpose,
          purposeCategory: purpose,
          repaymentSchedule: [],
          penalties: { totalPenalties: 0, penaltyRate: 5, penaltiesApplied: [] },
          collateral: "",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };
        
        await addDoc(collection(db, "groups/" + groupId + "/loans"), loanData);
        
        alert("Loan request submitted successfully! It will be reviewed by an admin.");
        closeModal(loanModal);
        e.target.reset();
        
      } catch (error) {
        console.error("Error submitting loan request:", error.message);
        alert("Error submitting loan request. Please try again.");
      }
    });
  }

  // Profile Edit Form
  const profileEditForm = document.getElementById("profileEditForm");
  if (profileEditForm) {
    profileEditForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const fullName = document.getElementById("editFullName").value;
      const phone = document.getElementById("editPhone").value;
      const whatsApp = document.getElementById("editWhatsApp").value;
      
      try {
        await updateDoc(doc(db, "users", currentUser.uid), {
          fullName: fullName,
          phone: phone,
          whatsappNumber: whatsApp,
          updatedAt: Timestamp.now()
        });
        
        // Update UI
        if (userNameSpan) userNameSpan.textContent = fullName;
        if (profileInitials) profileInitials.textContent = getInitials(fullName);
        
        alert("Profile updated successfully!");
        closeModal(profileModal);
        
      } catch (error) {
        console.error("Error updating profile:", error.message);
        alert("Error updating profile. Please try again.");
      }
    });
  }

  // Message Form
  const messageForm = document.getElementById("messageForm");
  if (messageForm) {
    messageForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const groupId = document.getElementById("messageGroup").value;
      const category = document.getElementById("messageCategory").value;
      const subject = document.getElementById("messageSubject").value;
      const content = document.getElementById("messageContent").value;
      const editFullName = document.getElementById("editFullName");
      
      if (!groupId || !category || !subject || !content) {
        alert("Please fill in all required fields.");
        return;
      }
      
      try {
        const messageData = {
          messageId: "msg_" + Date.now(),
          ticketNumber: "MSG-" + Date.now().toString().slice(-6),
          type: "support_ticket",
          category: category,
          priority: "medium",
          status: "open",
          createdBy: currentUser.uid,
          createdByName: editFullName?.value || currentUser.email,
          createdByEmail: currentUser.email,
          createdByRole: "member",
          assignedTo: null,
          subject: subject,
          initialMessage: content,
          messageThread: [{
            messageId: "msg_" + Date.now() + "_1",
            sentBy: currentUser.uid,
            sentByName: editFullName?.value || currentUser.email,
            sentByRole: "member",
            message: content,
            sentAt: Timestamp.now(),
            attachments: [],
            readBy: []
          }],
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };
        
        await addDoc(collection(db, "groups/" + groupId + "/messages"), messageData);
        
        alert("Message sent successfully! An admin will respond soon.");
        closeModal(messageModal);
        e.target.reset();
        
      } catch (error) {
        console.error("Error sending message:", error.message);
        alert("Error sending message. Please try again.");
      }
    });
  }

  // Change photo button
  const changePhotoBtn = document.getElementById("changePhotoBtn");
  if (changePhotoBtn) {
    changePhotoBtn.addEventListener("click", () => {
      document.getElementById("profilePicture").click();
    });
  }

  // Switch view button
  if (switchViewButton) {
    switchViewButton.addEventListener("click", () => {
      window.location.href = "admin_dashboard.html";
    });
  }

  // Settings button
  if (settingsButton) {
    settingsButton.addEventListener("click", () => {
      window.location.href = "settings.html";
    });
  }

  // Logout button
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      await handleLogout();
    });
  }

  // Listen for authentication state
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      await fetchUserProfile(user);
      
      const isAdmin = await checkIfUserIsAdmin(user);
      if (isAdmin && switchViewButton) {
        switchViewButton.style.display = "block";
      }
      
      await loadUserGroups(user);
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
