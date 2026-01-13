import {
  db,
  auth,
  storage,
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
  onSnapshot,
  arrayUnion,
  ref,
  uploadBytes,
  getDownloadURL,
  writeBatch,
} from "./firebaseConfig.js";
import {
  logError,
  logAuthError,
  logDatabaseError,
  logStorageError,
  logPaymentError,
  logLoanError,
  logFormError,
  getUserFriendlyErrorMessage,
  ErrorCategory,
  ErrorSeverity,
} from "./errorLogger.js";

document.addEventListener("DOMContentLoaded", () => {
  const groupList = document.getElementById("groupList");
  const userNameSpan = document.getElementById("userName");
  const userInitials = document.getElementById("userInitials");
  const userAvatar = document.getElementById("userAvatar");
  const viewToggle = document.getElementById("viewToggle");
  const logoutBtn = document.getElementById("logoutBtn");
  
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
  
  // Quick action buttons
  const requestLoanBtn = document.getElementById("requestLoanBtn");
  const uploadPaymentBtn = document.getElementById("uploadPaymentBtn");

  let currentUser = null;
  let currentGroup = null;
  let userGroups = [];
  let isAdmin = false;
  let sessionTimeout;

  // Format currency
  function formatCurrency(amount) {
    return `MWK ${parseFloat(amount || 0).toLocaleString('en-US', { 
      minimumFractionDigits: 0, 
      maximumFractionDigits: 0 
    })}`;
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
      sessionStorage.clear();
      window.location.href = "../login.html";
    } catch (error) {
      await logAuthError(error, "Logout", { action: "signOut" });
      const friendlyMessage = getUserFriendlyErrorMessage(error);
      alert(friendlyMessage || "An error occurred while logging out. Please try again.");
    }
  }

  // Setup logout handler
  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }

  // Check if user is admin and show toggle
  async function checkAdminStatus(userData) {
    const roles = userData.roles || [];
    const memberships = userData.groupMemberships || [];
    
    isAdmin = roles.includes("admin") || roles.includes("senior_admin") ||
              memberships.some(m => m.role === "admin" || m.role === "senior_admin");
    
    if (isAdmin && viewToggle) {
      viewToggle.classList.remove("hidden");
    }
  }

  // Get selected group from session
  function getSelectedGroupId() {
    return sessionStorage.getItem('selectedGroupId');
  }

  // Fetch user's profile data
  async function fetchUserProfile(user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const displayName = userData.fullName || user.email.split("@")[0];
        
        if (userNameSpan) userNameSpan.textContent = displayName;
        if (userInitials) userInitials.textContent = getInitials(displayName);
        
        // Load profile picture if available
        const profilePic = document.getElementById("userProfilePic");
        if (userData.profileImageUrl && profilePic) {
          profilePic.src = userData.profileImageUrl;
          profilePic.style.display = "block";
          if (userInitials) userInitials.style.display = "none";
        }
        
        await checkAdminStatus(userData);
        
        return userData;
      }
      return null;
    } catch (error) {
      await logDatabaseError(error, "fetchUserProfile", { userId: user?.uid });
      return null;
    }
  }

  // Load user groups and set current group
  async function loadUserGroups(user) {
    try {
      userGroups = [];
      
      // Get groups where user is a member
      const groupsRef = collection(db, "groups");
      const groupsSnapshot = await getDocs(groupsRef);
      
      for (const groupDoc of groupsSnapshot.docs) {
        const groupData = groupDoc.data();
        const groupId = groupDoc.id;
        
        // Check if user is admin
        const isGroupAdmin = groupData.admins?.some(admin => admin.uid === user.uid || admin.email === user.email);
        
        // Check if user is a member
        try {
          const memberDoc = await getDoc(doc(db, "groups", groupId, "members", user.uid));
          if (memberDoc.exists() || isGroupAdmin) {
            userGroups.push({ ...groupData, groupId, role: isGroupAdmin ? 'admin' : 'member' });
          }
        } catch (e) {
          if (isGroupAdmin) {
            userGroups.push({ ...groupData, groupId, role: 'admin' });
          }
        }
      }
      
      // Get selected group from session
      const selectedGroupId = getSelectedGroupId();
      
      if (userGroups.length === 0) {
        // No groups - hide overlay and show empty state
        hideGroupSelectionOverlay();
        renderEmptyState();
        return;
      }
      
      // Check if we have a valid selected group
      if (selectedGroupId && userGroups.find(g => g.groupId === selectedGroupId)) {
        currentGroup = userGroups.find(g => g.groupId === selectedGroupId);
        hideGroupSelectionOverlay();
        await loadDashboardAfterGroupSelection(user);
      } else {
        // Show group selection overlay
        showGroupSelectionOverlay();
      }
    } catch (error) {
      await logDatabaseError(error, "loadUserGroups", { userId: user?.uid });
    }
  }
  
  // Show group selection overlay
  function showGroupSelectionOverlay() {
    const overlay = document.getElementById('groupSelectionOverlay');
    if (overlay) {
      overlay.classList.remove('hidden');
      renderGroupSelectionCards();
    }
  }
  
  // Hide group selection overlay
  function hideGroupSelectionOverlay() {
    const overlay = document.getElementById('groupSelectionOverlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }
  
  // Render group selection cards
  function renderGroupSelectionCards() {
    const container = document.getElementById('groupSelectionList');
    if (!container) return;
    
    if (userGroups.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📁</div>
          <p class="empty-state-text">You're not a member of any groups yet</p>
        </div>
      `;
      return;
    }
    
    let cardsHTML = '';
    
    for (const group of userGroups) {
      const memberCount = group.statistics?.totalMembers || 0;
      const roleLabel = group.role === 'admin' ? 'Admin' : 'Member';
      
      cardsHTML += `
        <div class="group-selection-card" onclick="window.selectUserGroup('${group.groupId}')">
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
            <span class="group-selection-role">${roleLabel}</span>
            <svg class="group-selection-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </div>
      `;
    }
    
    container.innerHTML = cardsHTML;
  }
  
  // Render empty state when no groups
  function renderEmptyState() {
    if (groupList) {
      groupList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📁</div>
          <p class="empty-state-text">You're not a member of any groups yet. Contact your group admin to be added.</p>
        </div>
      `;
    }
  }
  
  // Load dashboard after group selection
  async function loadDashboardAfterGroupSelection(user) {
    if (!currentGroup || !user) return;
    
    await loadDashboardData(currentGroup.groupId, user);
    await loadPaymentCalendar(currentGroup.groupId, user);
    await loadUpcomingPayments(currentGroup.groupId, user);
    await renderUserGroups();
  }
  
  // Render user's groups list
  async function renderUserGroups() {
    if (!groupList) return;
    
    if (userGroups.length === 0) {
      renderEmptyState();
      return;
    }
    
    groupList.innerHTML = userGroups.map(group => {
      const isSelected = currentGroup && currentGroup.groupId === group.groupId;
      const stats = group.statistics || {};
      
      return `
        <div class="group-card ${isSelected ? 'selected' : ''}" onclick="window.selectUserGroup('${group.groupId}')">
          <div class="group-card-header">
            <h4 class="group-name">${group.groupName || 'Unnamed Group'}</h4>
            <span class="badge badge-${group.role === 'admin' ? 'accent' : 'secondary'}">${group.role || 'member'}</span>
          </div>
          <div class="group-card-stats">
            <div class="group-stat">
              <span class="group-stat-value">${stats.totalMembers || 0}</span>
              <span class="group-stat-label">Members</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  // Expose selectUserGroup to window for onclick
  window.selectUserGroup = async function(groupId) {
    sessionStorage.setItem('selectedGroupId', groupId);
    currentGroup = userGroups.find(g => g.groupId === groupId);
    hideGroupSelectionOverlay();
    if (currentUser && currentGroup) {
      await loadDashboardAfterGroupSelection(currentUser);
    }
  };

  // Load dashboard data for a specific group
  async function loadDashboardData(groupId, user) {
    try {
      // Get member data
      const memberDoc = await getDoc(doc(db, "groups", groupId, "members", user.uid));
      
      if (memberDoc.exists()) {
        const memberData = memberDoc.data();
        const financialSummary = memberData.financialSummary || {};
        
        // Update stats
        if (totalContributed) totalContributed.textContent = formatCurrency(financialSummary.totalPaid || 0);
        if (activeLoans) {
          // Count active loans
          const loansRef = collection(db, "groups", groupId, "loans");
          const activeLoansQuery = query(loansRef, where("borrowerId", "==", user.uid), where("status", "==", "active"));
          const activeLoansSnapshot = await getDocs(activeLoansQuery);
          activeLoans.textContent = activeLoansSnapshot.size;
        }
        if (pendingPayments) pendingPayments.textContent = formatCurrency(financialSummary.totalPending || 0);
        if (totalArrears) totalArrears.textContent = formatCurrency((financialSummary.totalArrears || 0) + (financialSummary.totalPenalties || 0));
      } else {
        // User might be admin, set defaults
        if (totalContributed) totalContributed.textContent = "MWK 0";
        if (activeLoans) activeLoans.textContent = "0";
        if (pendingPayments) pendingPayments.textContent = "MWK 0";
        if (totalArrears) totalArrears.textContent = "MWK 0";
      }
    } catch (error) {
      await logDatabaseError(error, "loadDashboardData", { groupId, userId: user?.uid });
    }
  }

  // Load upcoming payments for a specific group
  async function loadUpcomingPayments(groupId, user) {
    try {
      if (!upcomingPaymentsContainer) return;

      const currentYear = new Date().getFullYear();
      const upcomingPayments = [];

      // Get group data to check payment rules
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (!groupDoc.exists()) return;
      
      const groupData = groupDoc.data();
      const monthlyContribution = parseFloat(groupData?.rules?.monthlyContribution?.amount || 0);
      const seedMoneyAmount = parseFloat(groupData?.rules?.seedMoney?.amount || 0);

      // 1. Load Monthly Contributions
      try {
        const monthlyCollection = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${user.uid}`);
        const monthlySnapshot = await getDocs(monthlyCollection);

        monthlySnapshot.forEach(monthDoc => {
          const paymentData = monthDoc.data();
          const dueDate = paymentData.dueDate;
          
          if (dueDate && dueDate.toDate) {
            const dueDateObj = dueDate.toDate();
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            // Only include unpaid or pending payments that are upcoming (within next 60 days) or overdue
            const daysUntilDue = Math.ceil((dueDateObj - today) / (1000 * 60 * 60 * 24));
            const isUnpaid = paymentData.approvalStatus === "unpaid" || paymentData.approvalStatus === "pending";
            const isUpcoming = daysUntilDue <= 60; // Show payments due in next 60 days or overdue
            
            if (isUnpaid && isUpcoming) {
              const amountDue = parseFloat(paymentData.arrears || paymentData.totalAmount || monthlyContribution);
              
              if (amountDue > 0) {
                upcomingPayments.push({
                  type: "Monthly Contribution",
                  month: paymentData.month || "Unknown",
                  year: paymentData.year || currentYear,
                  amount: amountDue,
                  dueDate: dueDateObj,
                  status: paymentData.approvalStatus || "unpaid",
                  daysUntilDue: daysUntilDue,
                  isOverdue: daysUntilDue < 0
                });
              }
            }
          }
        });
      } catch (error) {
        await logDatabaseError(error, "loadUpcomingPayments - Monthly Contributions", { groupId, userId: user?.uid }, { severity: ErrorSeverity.LOW });
      }

      // 2. Load Seed Money Payment
      try {
        const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${user.uid}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);
        
        if (seedMoneyDoc.exists()) {
          const seedMoneyData = seedMoneyDoc.data();
          const dueDate = seedMoneyData.dueDate;
          
          if (dueDate && dueDate.toDate) {
            const dueDateObj = dueDate.toDate();
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const daysUntilDue = Math.ceil((dueDateObj - today) / (1000 * 60 * 60 * 24));
            const isUnpaid = seedMoneyData.approvalStatus === "unpaid" || seedMoneyData.approvalStatus === "pending";
            const isUpcoming = daysUntilDue <= 60;
            
            if (isUnpaid && isUpcoming) {
              const amountDue = parseFloat(seedMoneyData.arrears || (seedMoneyAmount - (parseFloat(seedMoneyData.amountPaid || 0))));
              
              if (amountDue > 0) {
                upcomingPayments.push({
                  type: "Seed Money",
                  month: "Seed Money",
                  year: currentYear,
                  amount: amountDue,
                  dueDate: dueDateObj,
                  status: seedMoneyData.approvalStatus || "unpaid",
                  daysUntilDue: daysUntilDue,
                  isOverdue: daysUntilDue < 0
                });
              }
            }
          }
        }
      } catch (error) {
        await logDatabaseError(error, "loadUpcomingPayments - Seed Money", { groupId, userId: user?.uid }, { severity: ErrorSeverity.LOW });
      }

      // 3. Load Loan Repayments (if any active loans)
      try {
        const loansRef = collection(db, `groups/${groupId}/loans`);
        const activeLoansQuery = query(loansRef, where("borrowerId", "==", user.uid), where("status", "==", "active"));
        const activeLoansSnapshot = await getDocs(activeLoansQuery);

        activeLoansSnapshot.forEach(loanDoc => {
          const loanData = loanDoc.data();
          const repaymentSchedule = loanData.repaymentSchedule || {};

          // Check each month in repayment schedule
          Object.keys(repaymentSchedule).forEach(monthKey => {
            const scheduleItem = repaymentSchedule[monthKey];
            if (scheduleItem && !scheduleItem.paid && scheduleItem.dueDate) {
              const dueDate = scheduleItem.dueDate.toDate ? scheduleItem.dueDate.toDate() : new Date(scheduleItem.dueDate);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              
              const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
              const isUpcoming = daysUntilDue <= 60;

              if (isUpcoming) {
                const amountDue = parseFloat(scheduleItem.amount || 0);
                if (amountDue > 0) {
                  upcomingPayments.push({
                    type: "Loan Repayment",
                    month: monthKey,
                    year: currentYear,
                    amount: amountDue,
                    dueDate: dueDate,
                    status: "unpaid",
                    daysUntilDue: daysUntilDue,
                    isOverdue: daysUntilDue < 0,
                    loanId: loanDoc.id
                  });
                }
              }
            }
          });
        });
      } catch (error) {
        console.log("No loan repayments found or error:", error);
      }

      // Sort by due date (earliest first)
      upcomingPayments.sort((a, b) => a.dueDate - b.dueDate);

      // Display payments
      displayUpcomingPayments(upcomingPayments);
    } catch (error) {
      console.error("Error loading upcoming payments:", error);
      if (upcomingPaymentsContainer) {
        upcomingPaymentsContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p class="empty-state-text">Error loading payments</p></div>';
      }
    }
  }

  // Display upcoming payments
  function displayUpcomingPayments(payments) {
    if (!upcomingPaymentsContainer) return;

    if (payments.length === 0) {
      upcomingPaymentsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📅</div>
          <p class="empty-state-text">No upcoming payments</p>
        </div>
      `;
      return;
    }

    upcomingPaymentsContainer.innerHTML = '';
    payments.slice(0, 10).forEach(payment => {
      const paymentElement = createUpcomingPaymentElement(payment);
      upcomingPaymentsContainer.appendChild(paymentElement);
    });
  }

  // Create upcoming payment element
  function createUpcomingPaymentElement(payment) {
    const div = document.createElement('div');
    div.className = 'list-item';
    
    const dateStr = payment.dueDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    let statusBadge = '';
    if (payment.isOverdue) {
      statusBadge = '<span class="badge badge-danger">Overdue</span>';
    } else if (payment.daysUntilDue <= 7) {
      statusBadge = '<span class="badge badge-warning">Due Soon</span>';
    } else {
      statusBadge = '<span class="badge badge-info">Upcoming</span>';
    }

    const daysText = payment.isOverdue 
      ? `${Math.abs(payment.daysUntilDue)} days overdue`
      : payment.daysUntilDue === 0
      ? 'Due today'
      : payment.daysUntilDue === 1
      ? 'Due tomorrow'
      : `Due in ${payment.daysUntilDue} days`;

    div.innerHTML = `
      <div style="flex: 1;">
        <div class="list-item-title">${escapeHtml(payment.type)} - ${escapeHtml(payment.month)} ${payment.year}</div>
        <div class="list-item-subtitle">${dateStr} • ${daysText}</div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: var(--bn-space-2);">
        <div style="font-weight: 700; font-size: var(--bn-text-base); color: var(--bn-dark);">${formatCurrency(payment.amount)}</div>
        ${statusBadge}
      </div>
    `;

    return div;
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Event Listeners for Quick Actions
  if (requestLoanBtn) {
    requestLoanBtn.addEventListener("click", () => {
      const groupId = getSelectedGroupId();
      if (!groupId) {
        alert("Please select a group first from the group selection page.");
        window.location.href = "select_group.html";
        return;
      }
      if (loanModal) {
        loanModal.classList.remove("hidden");
        // Populate group select in modal if exists
        const loanGroupSelect = document.getElementById("loanGroup");
        if (loanGroupSelect) {
          loanGroupSelect.value = groupId;
        }
      }
    });
  }

  if (uploadPaymentBtn) {
    uploadPaymentBtn.addEventListener("click", async () => {
      const groupId = getSelectedGroupId();
      if (!groupId) {
        alert("Please select a group first from the group selection page.");
        window.location.href = "select_group.html";
        return;
      }
      if (paymentModal) {
        paymentModal.classList.remove("hidden");
        // Populate group select in modal if exists
        const paymentGroupSelect = document.getElementById("paymentGroup");
        if (paymentGroupSelect) {
          paymentGroupSelect.value = groupId;
          await populatePaymentGroupSelector(groupId);
          await populatePaymentTypeOptions(groupId);
        }
        // Set default payment date to today
        const paymentDateInput = document.getElementById("paymentDate");
        if (paymentDateInput) {
          paymentDateInput.value = new Date().toISOString().split("T")[0];
        }
      }
    });
  }

  // Close payment modal
  const closePaymentModal = document.getElementById("closePaymentModal");
  if (closePaymentModal) {
    closePaymentModal.addEventListener("click", () => {
      if (paymentModal) paymentModal.classList.add("hidden");
      const form = document.getElementById("paymentUploadForm");
      if (form) form.reset();
    });
  }

  // Payment upload form submission
  const paymentUploadForm = document.getElementById("paymentUploadForm");
  if (paymentUploadForm) {
    paymentUploadForm.addEventListener("submit", handlePaymentUpload);
  }

  /**
   * Populate payment group selector
   */
  async function populatePaymentGroupSelector(selectedGroupId) {
    const paymentGroupSelect = document.getElementById("paymentGroup");
    if (!paymentGroupSelect) return;

    paymentGroupSelect.innerHTML = '<option value="">Choose a group...</option>';
    
    for (const group of userGroups) {
      const option = document.createElement("option");
      option.value = group.groupId;
      option.textContent = group.groupName;
      if (group.groupId === selectedGroupId) {
        option.selected = true;
      }
      paymentGroupSelect.appendChild(option);
    }
  }

  /**
   * Populate payment type options based on group
   */
  async function populatePaymentTypeOptions(groupId) {
    // This will be handled dynamically when payment type is selected
    // For now, we'll just ensure the select exists
  }

  /**
   * Handle payment upload
   */
  async function handlePaymentUpload(e) {
    e.preventDefault();

    const groupId = document.getElementById("paymentGroup")?.value;
    const paymentType = document.getElementById("paymentType")?.value;
    const amountStr = document.getElementById("paymentAmount")?.value;
    const paymentDate = document.getElementById("paymentDate")?.value;
    const proofFile = document.getElementById("paymentProof")?.files[0];

    // Validate required fields
    if (!groupId) {
      showToast("Please select a group.", "error");
      return;
    }
    if (!paymentType) {
      showToast("Please select a payment type.", "error");
      return;
    }
    if (!amountStr || amountStr.trim() === "") {
      showToast("Please enter a payment amount.", "error");
      return;
    }
    if (!paymentDate) {
      showToast("Please select a payment date.", "error");
      return;
    }
    if (!proofFile) {
      showToast("Please upload proof of payment.", "error");
      return;
    }

    // Validate amount
    const amount = parseFloat(amountStr);
    if (isNaN(amount)) {
      showToast("Payment amount must be a valid number.", "error");
      return;
    }
    if (amount <= 0) {
      showToast("Payment amount must be greater than 0.", "error");
      return;
    }
    if (amount > 100000000) {
      showToast("Payment amount exceeds maximum allowed (100,000,000 MWK).", "error");
      return;
    }
    
    // Validate decimal places (max 2)
    if (amountStr.includes('.') && amountStr.split('.')[1]?.length > 2) {
      showToast("Payment amount can have maximum 2 decimal places.", "error");
      return;
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf'];
    if (!allowedTypes.includes(proofFile.type)) {
      showToast("Please upload an image (JPG, PNG, GIF) or PDF file.", "error");
      return;
    }

    // Validate file size (max 10MB)
    if (proofFile.size > 10 * 1024 * 1024) {
      showToast("File size must be less than 10MB.", "error");
      return;
    }

    // Validate payment date (not in future and not more than 30 days ago)
    const paymentDateObj = new Date(paymentDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    if (paymentDateObj > today) {
      showToast("Payment date cannot be in the future.", "error");
      return;
    }
    if (paymentDateObj < thirtyDaysAgo) {
      showToast("Payment date cannot be more than 30 days ago.", "error");
      return;
    }

    try {
      // Disable submit button
      const submitBtn = paymentUploadForm.querySelector('button[type="submit"]');
      const originalText = submitBtn?.textContent;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Uploading...";
      }

      // Upload proof to Firebase Storage
      const storageRef = ref(storage, `payments/${currentUser.uid}/${groupId}/${Date.now()}_${proofFile.name}`);
      await uploadBytes(storageRef, proofFile);
      const proofUrl = await getDownloadURL(storageRef);

      // Get user data
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      const userData = userDoc.exists() ? userDoc.data() : {};
      const userName = userData.fullName || currentUser.email;

      // Handle different payment types
      if (paymentType === "seed_money") {
        await handleSeedMoneyPayment(groupId, amount, paymentDate, proofUrl, userName);
      } else if (paymentType === "monthly_contribution") {
        await handleMonthlyContributionPayment(groupId, amount, paymentDate, proofUrl, userName);
      } else if (paymentType === "loan_repayment") {
        await handleLoanRepaymentPayment(groupId, amount, paymentDate, proofUrl, userName);
      } else if (paymentType === "penalty") {
        await handlePenaltyPayment(groupId, amount, paymentDate, proofUrl, userName);
      }

      // Send notification to admins
      await sendPaymentNotificationToAdmins(groupId, paymentType, amount, userName);

      alert("Payment uploaded successfully! It will be reviewed by an admin.");
      
      // Close modal and reset form
      if (paymentModal) paymentModal.classList.add("hidden");
      if (paymentUploadForm) paymentUploadForm.reset();

      // Reload dashboard data
      if (currentGroup) {
        await loadDashboardData(currentGroup.groupId, currentUser);
        await loadUpcomingPayments(currentGroup.groupId, currentUser);
      }

    } catch (error) {
      console.error("Error uploading payment:", error);
      alert("Error uploading payment: " + error.message);
    } finally {
      const submitBtn = paymentUploadForm?.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText || "Submit Payment";
      }
    }
  }

  /**
   * Handle seed money payment
   */
  async function handleSeedMoneyPayment(groupId, amount, paymentDate, proofUrl, userName) {
    const currentYear = new Date().getFullYear();
    const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${currentUser.uid}/PaymentDetails`);
    const seedMoneyDoc = await getDoc(seedMoneyRef);

    if (!seedMoneyDoc.exists()) {
      throw new Error("Seed money payment record not found. Please contact an admin.");
    }

    const seedMoneyData = seedMoneyDoc.data();
    const currentPaid = parseFloat(seedMoneyData.amountPaid || 0);
    const totalAmount = parseFloat(seedMoneyData.totalAmount || 0);
    const newAmountPaid = currentPaid + amount;
    const newArrears = Math.max(totalAmount - newAmountPaid, 0);

    await updateDoc(seedMoneyRef, {
      amountPaid: newAmountPaid,
      arrears: newArrears,
      approvalStatus: "pending",
      paymentStatus: newArrears === 0 ? "Completed" : "Pending",
      proofOfPayment: {
        imageUrl: proofUrl,
        uploadedAt: Timestamp.now(),
        verifiedBy: ""
      },
      paidAt: Timestamp.fromDate(new Date(paymentDate)),
      updatedAt: Timestamp.now()
    });
  }

  /**
   * Handle monthly contribution payment
   */
  async function handleMonthlyContributionPayment(groupId, amount, paymentDate, proofUrl, userName) {
    const currentYear = new Date().getFullYear();
    const paymentDateObj = new Date(paymentDate);
    const monthName = paymentDateObj.toLocaleString("default", { month: "long" });
    const monthDocId = `${currentYear}_${monthName}`;

    const monthlyRef = doc(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${currentUser.uid}/${monthDocId}`);
    const monthlyDoc = await getDoc(monthlyRef);

    if (!monthlyDoc.exists()) {
      throw new Error(`Monthly contribution record for ${monthName} ${currentYear} not found. Please contact an admin.`);
    }

    const monthlyData = monthlyDoc.data();
    const paidArray = monthlyData.paid || [];
    
    // Add new payment to paid array
    const newPayment = {
      amount: amount,
      paymentDate: Timestamp.fromDate(new Date(paymentDate)),
      proofURL: proofUrl,
      approvalStatus: "pending",
      approvedAt: null,
      approvedBy: null,
      uploadedAt: Timestamp.now()
    };

    paidArray.push(newPayment);

    // Calculate new totals
    const totalPaid = paidArray.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const totalAmount = parseFloat(monthlyData.totalAmount || 0);
    const newArrears = Math.max(totalAmount - totalPaid, 0);
    const newApprovalStatus = newArrears === 0 ? "approved" : "pending";

    await updateDoc(monthlyRef, {
      paid: paidArray,
      amountPaid: totalPaid,
      arrears: newArrears,
      approvalStatus: newApprovalStatus,
      paymentStatus: newArrears === 0 ? "Completed" : "Pending",
      updatedAt: Timestamp.now()
    });
  }

  /**
   * Handle loan repayment payment
   */
  async function handleLoanRepaymentPayment(groupId, amount, paymentDate, proofUrl, userName) {
    // Get active loans for user
    const loansRef = collection(db, `groups/${groupId}/loans`);
    const activeLoansQuery = query(loansRef, where("borrowerId", "==", currentUser.uid), where("status", "==", "active"));
    const activeLoansSnapshot = await getDocs(activeLoansQuery);

    if (activeLoansSnapshot.empty) {
      throw new Error("No active loans found for this group.");
    }

    // For simplicity, use the first active loan
    // In a real app, you might want to let users select which loan
    const loanDoc = activeLoansSnapshot.docs[0];
    const loanId = loanDoc.id;

    // Create payment document in loans/{loanId}/payments collection
    const paymentsRef = collection(db, `groups/${groupId}/loans/${loanId}/payments`);
    await addDoc(paymentsRef, {
      loanId: loanId,
      borrowerId: currentUser.uid,
      borrowerName: userName,
      amount: amount,
      paymentDate: Timestamp.fromDate(new Date(paymentDate)),
      proofUrl: proofUrl,
      status: "pending",
      submittedAt: Timestamp.now(),
      approvedAt: null,
      approvedBy: null,
      penaltyAmount: 0,
      notes: "",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
  }

  /**
   * Handle penalty payment
   */
  async function handlePenaltyPayment(groupId, amount, paymentDate, proofUrl, userName) {
    // Penalty payments can be handled similarly to seed money
    // For now, we'll store it in a separate collection or as a note
    // This depends on how penalties are tracked in your system
    throw new Error("Penalty payment handling not yet implemented. Please contact an admin.");
  }

  /**
   * Send payment notification to admins
   */
  async function sendPaymentNotificationToAdmins(groupId, paymentType, amount, userName) {
    try {
      // Get group data
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (!groupDoc.exists()) return;

      const groupData = groupDoc.data();
      const adminIds = groupData.admins?.map(a => a.uid) || [];
      if (groupData.createdBy) {
        adminIds.push(groupData.createdBy);
      }
      
      // Remove duplicates
      const uniqueAdminIds = [...new Set(adminIds)];

      if (uniqueAdminIds.length === 0) return;

      const paymentTypeNames = {
        seed_money: "Seed Money",
        monthly_contribution: "Monthly Contribution",
        loan_repayment: "Loan Repayment",
        penalty: "Penalty Payment"
      };

      const paymentTypeName = paymentTypeNames[paymentType] || paymentType;

      // Create notification for each admin
      const batch = writeBatch(db);
      
      for (const adminId of uniqueAdminIds) {
        const notificationRef = doc(collection(db, `groups/${groupId}/notifications`));
        batch.set(notificationRef, {
          notificationId: notificationRef.id,
          groupId: groupId,
          groupName: groupData.groupName || "Unknown Group",
          recipientId: adminId,
          senderId: currentUser.uid,
          senderName: userName,
          senderEmail: currentUser.email,
          title: `New Payment Uploaded: ${paymentTypeName}`,
          message: `${userName} has uploaded a payment proof for ${paymentTypeName} (MWK ${amount.toLocaleString()}). Please review and approve.`,
          type: "info",
          allowReplies: false,
          read: false,
          createdAt: Timestamp.now(),
          replies: []
        });
      }

      await batch.commit();
    } catch (error) {
      await logError(error, {
        category: ErrorCategory.NOTIFICATION,
        severity: ErrorSeverity.MEDIUM,
        context: "sendPaymentNotificationToAdmins",
        metadata: { groupId, paymentType, amount, userName },
        logToFirestore: false, // Don't log notification errors to Firestore
      });
      // Don't throw - notification failure shouldn't prevent payment upload
    }
  }

  /**
   * Load and display payment calendar
   */
  async function loadPaymentCalendar(groupId, user) {
    try {
      const calendarContainer = document.getElementById("paymentCalendar");
      const monthYearDisplay = document.getElementById("calendarMonthYear");
      const prevMonthBtn = document.getElementById("calendarPrevMonth");
      const nextMonthBtn = document.getElementById("calendarNextMonth");

      if (!calendarContainer || !monthYearDisplay) return;

      let currentDate = new Date();
      let currentMonth = currentDate.getMonth();
      let currentYear = currentDate.getFullYear();

      // Load payment dates
      let paymentDates = await loadPaymentDatesForCalendar(groupId, user, currentMonth, currentYear);

      // Render calendar
      function renderCalendar(month, year) {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();

        // Update month/year display
        const monthNames = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"];
        monthYearDisplay.textContent = `${monthNames[month]} ${year}`;

        // Get previous month for days
        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;
        const prevMonthLastDay = new Date(prevYear, prevMonth + 1, 0).getDate();

        // Calendar HTML
        let calendarHTML = '<div class="calendar-header">';
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dayNames.forEach(day => {
          calendarHTML += `<div class="calendar-day-name">${day}</div>`;
        });
        calendarHTML += '</div><div class="calendar">';

        // Previous month days
        for (let i = startingDayOfWeek - 1; i >= 0; i--) {
          const day = prevMonthLastDay - i;
          calendarHTML += `<div class="calendar-day other-month"><span class="calendar-day-number">${day}</span></div>`;
        }

        // Current month days
        const today = new Date();
        for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(year, month, day);
          const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isToday = date.toDateString() === today.toDateString();
          const events = paymentDates[dateKey] || [];
          const hasEvents = events.length > 0;

          let dayClass = 'calendar-day';
          if (isToday) dayClass += ' today';
          if (hasEvents) dayClass += ' has-events';

          calendarHTML += `<div class="${dayClass}" data-date="${dateKey}">`;
          calendarHTML += `<span class="calendar-day-number">${day}</span>`;
          
          if (hasEvents) {
            calendarHTML += '<div class="calendar-day-events">';
            events.forEach(event => {
              let dotClass = 'calendar-event-dot';
              if (event.type === 'Monthly Contribution') dotClass += ' monthly';
              else if (event.type === 'Seed Money') dotClass += ' seed';
              else if (event.type === 'Loan Repayment') dotClass += ' loan';
              if (event.isOverdue) dotClass += ' overdue';
              calendarHTML += `<div class="${dotClass}" title="${event.type}: ${formatCurrency(event.amount)}"></div>`;
            });
            calendarHTML += '</div>';
          }
          
          calendarHTML += '</div>';
        }

        // Next month days (fill remaining slots)
        const totalCells = startingDayOfWeek + daysInMonth;
        const remainingCells = 42 - totalCells; // 6 weeks * 7 days
        for (let day = 1; day <= remainingCells && day <= 14; day++) {
          calendarHTML += `<div class="calendar-day other-month"><span class="calendar-day-number">${day}</span></div>`;
        }

        calendarHTML += '</div>';
        calendarContainer.innerHTML = calendarHTML;

        // Add click handlers
        calendarContainer.querySelectorAll('.calendar-day[data-date]').forEach(dayEl => {
          dayEl.addEventListener('click', () => {
            const date = dayEl.dataset.date;
            const events = paymentDates[date];
            if (events && events.length > 0) {
              showPaymentDetailsModal(events, date);
            }
          });
        });
      }

      // Event listeners for month navigation
      if (prevMonthBtn) {
        prevMonthBtn.addEventListener('click', async () => {
          currentMonth--;
          if (currentMonth < 0) {
            currentMonth = 11;
            currentYear--;
          }
          paymentDates = await loadPaymentDatesForCalendar(groupId, user, currentMonth, currentYear);
          renderCalendar(currentMonth, currentYear);
        });
      }

      if (nextMonthBtn) {
        nextMonthBtn.addEventListener('click', async () => {
          currentMonth++;
          if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
          }
          paymentDates = await loadPaymentDatesForCalendar(groupId, user, currentMonth, currentYear);
          renderCalendar(currentMonth, currentYear);
        });
      }

      // Initial render
      renderCalendar(currentMonth, currentYear);
      } catch (error) {
        await logError(error, {
          category: ErrorCategory.CALENDAR,
          severity: ErrorSeverity.MEDIUM,
          context: "loadPaymentCalendar",
          metadata: { groupId, userId: user?.uid },
        });
      }
    }

  /**
   * Load payment dates for calendar
   */
  async function loadPaymentDatesForCalendar(groupId, user, month, year) {
    const paymentDates = {};
    
    try {
      const currentYear = new Date().getFullYear();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // 1. Monthly Contributions
      try {
        const monthlyCollection = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${user.uid}`);
        const monthlySnapshot = await getDocs(monthlyCollection);

        monthlySnapshot.forEach(monthDoc => {
          const paymentData = monthDoc.data();
          const dueDate = paymentData.dueDate;
          
          if (dueDate && dueDate.toDate) {
            const dueDateObj = dueDate.toDate();
            const isUnpaid = paymentData.approvalStatus === "unpaid" || paymentData.approvalStatus === "pending";
            
            if (isUnpaid && dueDateObj.getMonth() === month && dueDateObj.getFullYear() === year) {
              const dateKey = `${dueDateObj.getFullYear()}-${String(dueDateObj.getMonth() + 1).padStart(2, '0')}-${String(dueDateObj.getDate()).padStart(2, '0')}`;
              const isOverdue = dueDateObj < today;
              
              if (!paymentDates[dateKey]) paymentDates[dateKey] = [];
              paymentDates[dateKey].push({
                type: 'Monthly Contribution',
                amount: parseFloat(paymentData.arrears || paymentData.totalAmount || 0),
                dueDate: dueDateObj,
                isOverdue: isOverdue
              });
            }
          }
        });
      } catch (error) {
        console.log("Error loading monthly contributions for calendar:", error);
      }

      // 2. Seed Money
      try {
        const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${user.uid}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);
        
        if (seedMoneyDoc.exists()) {
          const seedMoneyData = seedMoneyDoc.data();
          const dueDate = seedMoneyData.dueDate;
          
          if (dueDate && dueDate.toDate) {
            const dueDateObj = dueDate.toDate();
            const isUnpaid = seedMoneyData.approvalStatus === "unpaid" || seedMoneyData.approvalStatus === "pending";
            
            if (isUnpaid && dueDateObj.getMonth() === month && dueDateObj.getFullYear() === year) {
              const dateKey = `${dueDateObj.getFullYear()}-${String(dueDateObj.getMonth() + 1).padStart(2, '0')}-${String(dueDateObj.getDate()).padStart(2, '0')}`;
              const isOverdue = dueDateObj < today;
              
              if (!paymentDates[dateKey]) paymentDates[dateKey] = [];
              paymentDates[dateKey].push({
                type: 'Seed Money',
                amount: parseFloat(seedMoneyData.arrears || 0),
                dueDate: dueDateObj,
                isOverdue: isOverdue
              });
            }
          }
        }
      } catch (error) {
        await logDatabaseError(error, "loadPaymentDatesForCalendar - Seed Money", { groupId, userId: user?.uid }, { severity: ErrorSeverity.LOW });
      }

      // 3. Loan Repayments
      try {
        const loansRef = collection(db, `groups/${groupId}/loans`);
        const activeLoansQuery = query(loansRef, where("borrowerId", "==", user.uid), where("status", "==", "active"));
        const activeLoansSnapshot = await getDocs(activeLoansQuery);

        activeLoansSnapshot.forEach(loanDoc => {
          const loanData = loanDoc.data();
          const repaymentSchedule = loanData.repaymentSchedule || {};

          Object.keys(repaymentSchedule).forEach(monthKey => {
            const scheduleItem = repaymentSchedule[monthKey];
            if (scheduleItem && !scheduleItem.paid && scheduleItem.dueDate) {
              const dueDate = scheduleItem.dueDate.toDate ? scheduleItem.dueDate.toDate() : new Date(scheduleItem.dueDate);
              
              if (dueDate.getMonth() === month && dueDate.getFullYear() === year) {
                const dateKey = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;
                const isOverdue = dueDate < today;
                
                if (!paymentDates[dateKey]) paymentDates[dateKey] = [];
                paymentDates[dateKey].push({
                  type: 'Loan Repayment',
                  amount: parseFloat(scheduleItem.amount || 0),
                  dueDate: dueDate,
                  isOverdue: isOverdue,
                  loanId: loanDoc.id
                });
              }
            }
          });
        });
      } catch (error) {
        await logDatabaseError(error, "loadPaymentDatesForCalendar - Loan Repayments", { groupId, userId: user?.uid }, { severity: ErrorSeverity.LOW });
      }

    } catch (error) {
      await logError(error, {
        category: ErrorCategory.CALENDAR,
        severity: ErrorSeverity.MEDIUM,
        context: "loadPaymentDatesForCalendar",
        metadata: { groupId, userId: user?.uid },
      });
    }

    return paymentDates;
  }

  /**
   * Show payment details modal
   */
  function showPaymentDetailsModal(events, date) {
    const dateObj = new Date(date);
    const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    let modalHTML = `
      <div class="modal-overlay" id="paymentDetailsModal" style="display: flex;">
        <div class="modal-content" style="max-width: 500px;">
          <div class="modal-header">
            <h2 class="modal-title">Payments Due: ${dateStr}</h2>
            <button class="modal-close" onclick="document.getElementById('paymentDetailsModal').remove()">&times;</button>
          </div>
          <div class="modal-body">
            <div style="display: flex; flex-direction: column; gap: var(--bn-space-3);">
    `;

    events.forEach(event => {
      const statusBadge = event.isOverdue 
        ? '<span class="badge badge-danger">Overdue</span>'
        : '<span class="badge badge-info">Due</span>';
      
      modalHTML += `
        <div class="list-item">
          <div style="flex: 1;">
            <div class="list-item-title">${event.type}</div>
            <div class="list-item-subtitle">${formatCurrency(event.amount)}</div>
          </div>
          ${statusBadge}
        </div>
      `;
    });

    modalHTML += `
            </div>
            <div style="margin-top: var(--bn-space-4); padding-top: var(--bn-space-4); border-top: 1px solid var(--bn-gray-lighter);">
              <button class="btn btn-accent btn-block" onclick="document.getElementById('paymentDetailsModal').remove(); document.getElementById('uploadPaymentBtn').click();">
                Upload Payment
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('paymentDetailsModal');
    if (existingModal) existingModal.remove();

    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }

  /**
   * Show toast notification
   */
  function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) {
      alert(message);
      return;
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${message}</span>
      <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);

    // Animate in
    setTimeout(() => toast.classList.add("show"), 10);

    // Auto remove after 4 seconds
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Listen for authentication state
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      await fetchUserProfile(user);
      await loadUserGroups(user);
      resetSessionTimer();
    } else {
      window.location.href = "../login.html";
    }
  });

  // Reset session timer on user interaction
  ["click", "keypress", "mousemove", "scroll"].forEach((event) =>
    window.addEventListener(event, resetSessionTimer)
  );
});
