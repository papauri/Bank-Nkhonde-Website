import {
  db,
  auth,
  storage,
  collection,
  query,
  where,
  orderBy,
  limit,
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
import { initializeNotifications } from "./notifications-handler.js";
import { loadPaymentDetailsTable } from "./payment_details_table.js";

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
  const upcomingPaymentsBtn = document.getElementById("upcomingPaymentsBtn");
  const viewPaymentDetailsBtn = document.getElementById("viewPaymentDetailsBtn");
  const paymentDetailsModal = document.getElementById("paymentDetailsModal");
  const closePaymentDetailsModal = document.getElementById("closePaymentDetailsModal");
  const paymentDetailsTableContainer = document.getElementById("paymentDetailsTableContainer");
  const upcomingPaymentsModal = document.getElementById("upcomingPaymentsModal");
  
  // Payment Details button handler
  if (viewPaymentDetailsBtn) {
    viewPaymentDetailsBtn.addEventListener("click", async () => {
      const groupId = getSelectedGroupId();
      if (!groupId) {
        alert("Please select a group first from the group selection page.");
        window.location.href = "select_group.html";
        return;
      }
      
      if (paymentDetailsModal && paymentDetailsTableContainer) {
        paymentDetailsModal.classList.remove("hidden");
        await loadPaymentDetailsTable(groupId, currentUser.uid, paymentDetailsTableContainer, false);
      }
    });
  }

  if (closePaymentDetailsModal) {
    closePaymentDetailsModal.addEventListener("click", () => {
      if (paymentDetailsModal) paymentDetailsModal.classList.add("hidden");
    });
  }

  if (paymentDetailsModal) {
    paymentDetailsModal.addEventListener("click", (e) => {
      if (e.target === paymentDetailsModal) {
        paymentDetailsModal.classList.add("hidden");
      }
    });
  }
  const upcomingPaymentsModalList = document.getElementById("upcomingPaymentsModalList");

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

  // Calculate and update active loans details
  async function updateActiveLoansDetails(groupId, userId) {
    const activeLoans = document.getElementById('activeLoans');
    const activeLoansDetails = document.getElementById('activeLoansDetails');
    const activeLoansStat = document.getElementById('activeLoansStat');
    const activeLoansBadge = document.getElementById('activeLoansBadge');
    if (!activeLoans || !activeLoansDetails) return;

    try {
      // Check if badge is dismissed
      const dismissedKey = `activeLoansBadgeDismissed_${groupId}_${userId}`;
      const isDismissed = localStorage.getItem(dismissedKey) === 'true';

      const loansRef = collection(db, "groups", groupId, "loans");
      const activeLoansQuery = query(loansRef, where("borrowerId", "==", userId), where("status", "in", ["approved", "active", "disbursed"]));
      const activeLoansSnapshot = await getDocs(activeLoansQuery);
      const count = activeLoansSnapshot.size;
      
      let totalBalance = 0;
      let totalReceived = 0;
      let nextPaymentDue = null;
      let nextPaymentAmount = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Calculate aggregate loan details
      activeLoansSnapshot.forEach(loanDoc => {
        const loanData = loanDoc.data();
        const amount = parseFloat(loanData.amount || loanData.loanAmount || 0);
        const repaid = parseFloat(loanData.amountRepaid || 0);
        const totalRepayable = parseFloat(loanData.totalRepayable || amount + parseFloat(loanData.totalInterest || 0));
        
        // Only count disbursed/active loans for received amount
        if (loanData.status === "active" || loanData.status === "disbursed") {
          totalReceived += amount;
          const balance = Math.max(0, totalRepayable - repaid);
          totalBalance += balance;
          
          // Find next payment due (including today or past due)
          const repaymentSchedule = loanData.repaymentSchedule || {};
          
          for (const monthKey of Object.keys(repaymentSchedule)) {
            const scheduleItem = repaymentSchedule[monthKey];
            if (scheduleItem && !scheduleItem.paid && scheduleItem.dueDate) {
              const dueDate = scheduleItem.dueDate.toDate ? scheduleItem.dueDate.toDate() : new Date(scheduleItem.dueDate);
              dueDate.setHours(0, 0, 0, 0);
              
              // Check for due dates (today or past, or future)
              if (dueDate >= today || (dueDate <= today && !scheduleItem.paid)) {
                if (!nextPaymentDue || dueDate <= nextPaymentDue) {
                  nextPaymentDue = dueDate;
                  nextPaymentAmount = parseFloat(scheduleItem.amount || 0);
                }
              }
            }
          }
        } else if (loanData.status === "approved") {
          // For approved loans, show amount but no balance yet
          totalReceived += amount;
        }
      });
      
      // Check if payment is due (today or past)
      const isDue = nextPaymentDue && nextPaymentDue <= today;
      
      // Update count display
      activeLoans.innerHTML = `<span>${count}</span><span style="font-size: 14px; line-height: 1;" title="Active Loans">💰</span>`;
      
      // Update details display
      if (count > 0) {
        const details = [];
        
        if (totalReceived > 0) {
          details.push(`Received: ${formatCurrency(totalReceived)}`);
        }
        
        if (totalBalance > 0) {
          details.push(`Balance: ${formatCurrency(totalBalance)}`);
        }
        
        if (nextPaymentDue) {
          const dueDateStr = nextPaymentDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          if (nextPaymentAmount > 0) {
            details.push(`Next: ${dueDateStr} - ${formatCurrency(nextPaymentAmount)}`);
          } else {
            details.push(`Next due: ${dueDateStr}`);
          }
        }
        
        if (details.length > 0) {
          activeLoansDetails.innerHTML = details.join('<br>');
          activeLoansDetails.style.display = 'block';
        } else {
          activeLoansDetails.style.display = 'none';
        }
      } else {
        activeLoansDetails.style.display = 'none';
      }

      // Update badge and flash
      if (activeLoansStat) {
        if (isDue && !isDismissed) {
          activeLoansStat.classList.add('flash');
          if (activeLoansBadge) activeLoansBadge.style.display = 'block';
        } else {
          activeLoansStat.classList.remove('flash');
          if (activeLoansBadge) activeLoansBadge.style.display = 'none';
        }
      }
    } catch (error) {
      console.error("Error updating active loans details:", error);
      activeLoans.innerHTML = '<span>0</span><span style="font-size: 14px; line-height: 1;" title="Active Loans">💰</span>';
      activeLoansDetails.style.display = 'none';
      if (activeLoansStat) activeLoansStat.classList.remove('flash');
      if (activeLoansBadge) activeLoansBadge.style.display = 'none';
    }
  }

  // Show all payments modal when clicking on totalContributed
  async function showAllPaymentsModal() {
    if (!currentGroup || !currentUser) {
      return;
    }

    const modal = document.getElementById('allPaymentsModal');
    const tableBody = document.getElementById('allPaymentsTableBody');
    const totalAmountEl = document.getElementById('allPaymentsTotal');
    
    if (!modal || !tableBody) return;

    try {
      // Show loading
      tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: var(--bn-space-4); color: var(--bn-gray);">Loading payments...</td></tr>';
      modal.classList.remove('hidden');

      const groupId = currentGroup.groupId;
      const userId = currentUser.uid;
      const currentYear = new Date().getFullYear();
      const allPayments = [];

      // 1. Get Monthly Contributions (check current and previous year)
      for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
        const year = currentYear - yearOffset;
        try {
          const monthlyCollection = collection(db, `groups/${groupId}/payments/${year}_MonthlyContributions/${userId}`);
          const monthlySnapshot = await getDocs(monthlyCollection);
          
          monthlySnapshot.forEach(monthDoc => {
            const paymentData = monthDoc.data();
            const isApproved = paymentData.approvalStatus === 'approved' || paymentData.paymentStatus === 'completed';
            const amountPaid = parseFloat(paymentData.amountPaid || paymentData.totalAmount || 0);
            
            if (isApproved && amountPaid > 0) {
              const paidAt = paymentData.paidAt;
              const approvedAt = paymentData.approvedAt;
              const updatedAt = paymentData.updatedAt;
              const createdAt = paymentData.createdAt;
              
              const paymentDate = paidAt?.toDate ? paidAt.toDate() : 
                                 (approvedAt?.toDate ? approvedAt.toDate() : 
                                 (updatedAt?.toDate ? updatedAt.toDate() : 
                                 (createdAt?.toDate ? createdAt.toDate() : new Date())));
              
              allPayments.push({
                type: 'Monthly Contribution',
                amount: amountPaid,
                date: paymentDate
              });
            }
          });
        } catch (error) {
          // Continue silently
        }
      }

      // 2. Get Seed Money
      for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
        const year = currentYear - yearOffset;
        try {
          const seedMoneyRef = doc(db, `groups/${groupId}/payments/${year}_SeedMoney/${userId}/PaymentDetails`);
          const seedMoneyDoc = await getDoc(seedMoneyRef);
          
          if (seedMoneyDoc.exists()) {
            const seedMoneyData = seedMoneyDoc.data();
            const isApproved = seedMoneyData.approvalStatus === 'approved' || seedMoneyData.paymentStatus === 'completed';
            const amountPaid = parseFloat(seedMoneyData.amountPaid || seedMoneyData.totalAmount || 0);
            
            if (isApproved && amountPaid > 0) {
              const paidAt = seedMoneyData.paidAt;
              const approvedAt = seedMoneyData.approvedAt;
              const updatedAt = seedMoneyData.updatedAt;
              const createdAt = seedMoneyData.createdAt;
              
              const paymentDate = paidAt?.toDate ? paidAt.toDate() : 
                                 (approvedAt?.toDate ? approvedAt.toDate() : 
                                 (updatedAt?.toDate ? updatedAt.toDate() : 
                                 (createdAt?.toDate ? createdAt.toDate() : new Date())));
              
              allPayments.push({
                type: 'Seed Money',
                amount: amountPaid,
                date: paymentDate
              });
            }
          }
        } catch (error) {
          // Continue silently
        }
      }

      // 3. Get Service Fee
      for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
        const year = currentYear - yearOffset;
        try {
          const serviceFeeRef = doc(db, `groups/${groupId}/payments/${year}_ServiceFee/${userId}/PaymentDetails`);
          const serviceFeeDoc = await getDoc(serviceFeeRef);
          
          if (serviceFeeDoc.exists()) {
            const serviceFeeData = serviceFeeDoc.data();
            const isApproved = serviceFeeData.approvalStatus === 'approved' || serviceFeeData.paymentStatus === 'completed';
            const amountPaid = parseFloat(serviceFeeData.amountPaid || serviceFeeData.totalAmount || 0);
            
            if (isApproved && amountPaid > 0) {
              const paidAt = serviceFeeData.paidAt;
              const approvedAt = serviceFeeData.approvedAt;
              const updatedAt = serviceFeeData.updatedAt;
              const createdAt = serviceFeeData.createdAt;
              
              const paymentDate = paidAt?.toDate ? paidAt.toDate() : 
                                 (approvedAt?.toDate ? approvedAt.toDate() : 
                                 (updatedAt?.toDate ? updatedAt.toDate() : 
                                 (createdAt?.toDate ? createdAt.toDate() : new Date())));
              
              allPayments.push({
                type: 'Service Fee',
                amount: amountPaid,
                date: paymentDate
              });
            }
          }
        } catch (error) {
          // Continue silently
        }
      }

      // Sort by date (most recent first)
      allPayments.sort((a, b) => b.date - a.date);

      // Calculate total
      const total = allPayments.reduce((sum, payment) => sum + payment.amount, 0);

      // Render table
      if (allPayments.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: var(--bn-space-4); color: var(--bn-gray);">No approved payments found</td></tr>';
      } else {
        tableBody.innerHTML = allPayments.map(payment => {
          const dateStr = payment.date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
          });
          return `
            <tr>
              <td>${payment.type}</td>
              <td>${dateStr}</td>
              <td style="text-align: right; font-weight: 600;">${formatCurrency(payment.amount)}</td>
            </tr>
          `;
        }).join('');
      }

      // Update total
      if (totalAmountEl) {
        totalAmountEl.textContent = formatCurrency(total);
      }

    } catch (error) {
      console.error("Error loading all payments:", error);
      tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: var(--bn-space-4); color: var(--bn-danger);">Error loading payments</td></tr>';
    }
  }

  // Expose to window for onclick
  window.showAllPaymentsModal = showAllPaymentsModal;

  // Update next monthly payment card
  async function updateNextMonthlyPayment(groupId, userId) {
    const nextPaymentDetailsEl = document.getElementById('nextPaymentDetails');
    const nextPaymentBadgeEl = document.getElementById('nextPaymentBadge');
    
    if (!nextPaymentDetailsEl) return;

    try {
      // Check if badge is dismissed
      const dismissedKey = `nextPaymentBadgeDismissed_${groupId}_${userId}`;
      const isDismissed = localStorage.getItem(dismissedKey) === 'true';
      
      const currentYear = new Date().getFullYear();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Get group data for monthly contribution amount
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (!groupDoc.exists()) {
        nextPaymentDetailsEl.textContent = "";
        nextPaymentDetailsEl.style.display = 'none';
        if (nextPaymentBadgeEl) nextPaymentBadgeEl.style.display = 'none';
        return;
      }
      
      const groupData = groupDoc.data();
      const monthlyAmount = parseFloat(groupData?.rules?.monthlyContribution?.amount || 0);
      
      // Find next unpaid/pending monthly payment
      let nextPayment = null;
      
      try {
        const monthlyCollection = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${userId}`);
        const monthlySnapshot = await getDocs(monthlyCollection);
        
        monthlySnapshot.forEach(monthDoc => {
          const paymentData = monthDoc.data();
          const isUnpaidOrPending = paymentData.approvalStatus === 'unpaid' || 
                                   paymentData.approvalStatus === 'pending' ||
                                   (paymentData.paymentStatus !== 'completed' && paymentData.approvalStatus !== 'approved');
          
          if (isUnpaidOrPending) {
            const dueDate = paymentData.dueDate;
            if (dueDate && dueDate.toDate) {
              const dueDateObj = dueDate.toDate();
              dueDateObj.setHours(0, 0, 0, 0);
              
              // If no nextPayment yet, or this one is earlier
              if (!nextPayment || dueDateObj < nextPayment.dueDate) {
                nextPayment = {
                  dueDate: dueDateObj,
                  amount: parseFloat(paymentData.totalAmount || paymentData.arrears || monthlyAmount),
                  month: paymentData.month || monthDoc.id
                };
              }
            }
          }
        });
      } catch (error) {
        // Collection might not exist, continue
      }

      if (nextPayment) {
        // Format amount and date together
        const amountText = formatCurrency(nextPayment.amount);
        const dateStr = nextPayment.dueDate.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          year: 'numeric'
        });
        nextPaymentDetailsEl.textContent = `${amountText} on ${dateStr}`;
        nextPaymentDetailsEl.style.display = 'block';
        
        // Show badge if due date has passed and not dismissed
        const isDue = nextPayment.dueDate <= today;
        if (nextPaymentBadgeEl) {
          if (isDue && !isDismissed) {
            nextPaymentBadgeEl.style.display = 'block';
          } else {
            nextPaymentBadgeEl.style.display = 'none';
          }
        }
      } else {
        nextPaymentDetailsEl.textContent = "No payment due";
        nextPaymentDetailsEl.style.display = 'block';
        if (nextPaymentBadgeEl) nextPaymentBadgeEl.style.display = 'none';
      }
    } catch (error) {
      console.error("Error updating next monthly payment:", error);
      if (nextPaymentDetailsEl) {
        nextPaymentDetailsEl.textContent = "";
        nextPaymentDetailsEl.style.display = 'none';
      }
      if (nextPaymentBadgeEl) nextPaymentBadgeEl.style.display = 'none';
    }
  }

  // Dismiss next payment badge
  function dismissNextPaymentBadge(event) {
    event.stopPropagation();
    const badge = event.target;
    if (badge && badge.id === 'nextPaymentBadge') {
      badge.style.display = 'none';
      
      // Remove flash animation
      const nextPaymentStat = document.getElementById('nextPaymentStat');
      if (nextPaymentStat) nextPaymentStat.classList.remove('flash');
      
      // Store dismissed state
      if (currentGroup && currentUser) {
        const dismissedKey = `nextPaymentBadgeDismissed_${currentGroup.groupId}_${currentUser.uid}`;
        localStorage.setItem(dismissedKey, 'true');
      }
    }
  }

  // Dismiss active loans badge
  function dismissActiveLoansBadge(event) {
    event.stopPropagation();
    const badge = event.target;
    if (badge && badge.id === 'activeLoansBadge') {
      badge.style.display = 'none';
      
      // Remove flash animation
      const activeLoansStat = document.getElementById('activeLoansStat');
      if (activeLoansStat) activeLoansStat.classList.remove('flash');
      
      // Store dismissed state
      if (currentGroup && currentUser) {
        const dismissedKey = `activeLoansBadgeDismissed_${currentGroup.groupId}_${currentUser.uid}`;
        localStorage.setItem(dismissedKey, 'true');
      }
    }
  }

  // Expose to window for onclick
  window.dismissNextPaymentBadge = dismissNextPaymentBadge;
  window.dismissActiveLoansBadge = dismissActiveLoansBadge;

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
  
  // Mobile Menu Functionality
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const mobileMenu = document.getElementById("mobileMenu");
  const mobileMenuOverlay = document.getElementById("mobileMenuOverlay");
  const mobileMenuClose = document.getElementById("mobileMenuClose");
  const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");
  
  function openMobileMenu() {
    if (mobileMenu && mobileMenuBtn && mobileMenuOverlay) {
      mobileMenu.classList.add("active");
      mobileMenuBtn.classList.add("active");
      mobileMenuOverlay.classList.add("active");
      document.body.style.overflow = "hidden";
    }
  }
  
  function closeMobileMenu() {
    if (mobileMenu && mobileMenuBtn && mobileMenuOverlay) {
      mobileMenu.classList.remove("active");
      mobileMenuBtn.classList.remove("active");
      mobileMenuOverlay.classList.remove("active");
      document.body.style.overflow = "";
    }
  }
  
  function handleMobileLogout() {
    closeMobileMenu();
    handleLogout();
  }
  
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", openMobileMenu);
  }
  
  if (mobileMenuClose) {
    mobileMenuClose.addEventListener("click", closeMobileMenu);
  }
  
  if (mobileMenuOverlay) {
    mobileMenuOverlay.addEventListener("click", closeMobileMenu);
  }
  
  if (mobileLogoutBtn) {
    mobileLogoutBtn.addEventListener("click", handleMobileLogout);
  }
  
  // Export to global scope for onclick handlers
  window.closeMobileMenu = closeMobileMenu;
  window.handleMobileLogout = handleMobileLogout;

  // Check if user is admin and show toggle
  async function checkAdminStatus(userData) {
    const roles = userData.roles || [];
    const memberships = userData.groupMemberships || [];
    
    // Check global admin roles
    isAdmin = roles.includes("admin") || roles.includes("senior_admin") ||
              memberships.some(m => m.role === "admin" || m.role === "senior_admin");
    
    // Also check if user is admin of the currently selected group
    if (currentGroup && currentGroup.groupId && currentUser) {
      try {
        const groupDoc = await getDoc(doc(db, "groups", currentGroup.groupId));
        if (groupDoc.exists()) {
          const groupData = groupDoc.data();
          // Check if user is in admins array or is the creator
          const isGroupAdmin = groupData.admins?.some(admin => 
            (typeof admin === 'object' ? admin.uid : admin) === currentUser.uid || 
            (typeof admin === 'object' ? admin.email : admin) === currentUser.email
          ) || groupData.createdBy === currentUser.uid;
          
          if (isGroupAdmin) {
            isAdmin = true;
          }
        }
      } catch (error) {
        console.error("Error checking group admin status:", error);
      }
    }
    
    if (isAdmin && viewToggle) {
      viewToggle.classList.remove("hidden");
    }
    
    // Show mobile switch to admin button for admins
    const mobileSwitchToAdmin = document.getElementById("mobileSwitchToAdmin");
    const mobileNav = document.querySelector(".mobile-nav");
    if (mobileSwitchToAdmin && mobileNav) {
      if (isAdmin) {
        mobileSwitchToAdmin.classList.remove("hidden");
        mobileNav.classList.add("has-admin");
      } else {
        mobileSwitchToAdmin.classList.add("hidden");
        mobileNav.classList.remove("has-admin");
      }
    }
  }

  // Get selected group from localStorage (with fallback to sessionStorage)
  function getSelectedGroupId() {
    return localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
  }
  
  // Save selected group to both storages for persistence
  function saveSelectedGroupId(groupId) {
    if (groupId) {
      localStorage.setItem('selectedGroupId', groupId);
      sessionStorage.setItem('selectedGroupId', groupId);
    }
  }
  
  // Auto-select first group if none is selected and user has groups
  function autoSelectGroupIfNeeded() {
    const selectedGroupId = getSelectedGroupId();
    if (!selectedGroupId && userGroups.length > 0) {
      saveSelectedGroupId(userGroups[0].groupId);
      return userGroups[0].groupId;
    }
    return selectedGroupId;
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
      
      if (userGroups.length === 0) {
        // No groups - hide overlay and show empty state
        hideGroupSelectionOverlay();
        renderEmptyState();
        return;
      }
      
      // Get selected group from localStorage (with fallback to sessionStorage)
      let selectedGroupId = getSelectedGroupId();
      
      // If no group is selected but user has groups, auto-select first group
      if (!selectedGroupId || !userGroups.find(g => g.groupId === selectedGroupId)) {
        selectedGroupId = autoSelectGroupIfNeeded();
      }
      
      // Check if we have a valid selected group
      if (selectedGroupId && userGroups.find(g => g.groupId === selectedGroupId)) {
        currentGroup = userGroups.find(g => g.groupId === selectedGroupId);
        // Always hide overlay - group is auto-selected or already selected
        hideGroupSelectionOverlay();
        await loadDashboardAfterGroupSelection(user);
      } else {
        // Only show overlay if we can't auto-select
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
    
    // Recheck admin status after group selection (user might be admin of this group)
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      await checkAdminStatus(userData);
    }
    
    // Load notifications for dashboard display
    await loadDashboardNotifications(user.uid, currentGroup.groupId);
    
    // Initialize notifications
    if (user && user.uid && currentGroup.groupId) {
      initializeNotifications(user.uid, currentGroup.groupId);
    }
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
        <div class="group-card ${isSelected ? 'selected' : ''}" ${isSelected ? 'onclick="return false;"' : `onclick="window.selectUserGroup('${group.groupId}')"`}>
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
          ${isSelected ? '<div class="group-card-active-badge">Active</div>' : ''}
        </div>
      `;
    }).join('');
  }
  
  // Expose selectUserGroup to window for onclick
  window.selectUserGroup = async function(groupId) {
    const selectedGroupId = getSelectedGroupId();
    
    // If already selected, don't do anything
    if (selectedGroupId === groupId) {
      return;
    }
    
    saveSelectedGroupId(groupId);
    currentGroup = userGroups.find(g => g.groupId === groupId);
    hideGroupSelectionOverlay();
    if (currentUser && currentGroup) {
      await loadDashboardAfterGroupSelection(currentUser);
    }
  };

  // Handle switch to admin dashboard
  window.handleSwitchToAdmin = function() {
    const selectedGroupId = getSelectedGroupId();
    if (selectedGroupId) {
      window.location.href = `admin_dashboard.html?groupId=${selectedGroupId}`;
    } else {
      window.location.href = 'admin_dashboard.html';
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
          // Count active loans and calculate loan details
          await updateActiveLoansDetails(groupId, user.uid);
        }
        if (pendingPayments) pendingPayments.textContent = formatCurrency(financialSummary.totalPending || 0);
        if (totalArrears) totalArrears.textContent = formatCurrency((financialSummary.totalArrears || 0) + (financialSummary.totalPenalties || 0));
        
        // Load next monthly payment
        await updateNextMonthlyPayment(groupId, user.uid);
      } else {
        // User might be admin, set defaults
        if (totalContributed) totalContributed.textContent = "MWK 0";
        if (activeLoans) activeLoans.innerHTML = '<span>0</span><span style="font-size: 14px; line-height: 1;" title="Active Loans">💰</span>';
        const activeLoansDetails = document.getElementById('activeLoansDetails');
        const activeLoansStat = document.getElementById('activeLoansStat');
        const activeLoansBadge = document.getElementById('activeLoansBadge');
        if (activeLoansDetails) activeLoansDetails.style.display = 'none';
        if (activeLoansStat) activeLoansStat.classList.remove('flash');
        if (activeLoansBadge) activeLoansBadge.style.display = 'none';
        if (pendingPayments) pendingPayments.textContent = "MWK 0";
        if (totalArrears) totalArrears.textContent = "MWK 0";
        
        // Reset next payment
        const nextPaymentDetailsEl = document.getElementById('nextPaymentDetails');
        const nextPaymentBadgeEl = document.getElementById('nextPaymentBadge');
        const nextPaymentStat = document.getElementById('nextPaymentStat');
        if (nextPaymentDetailsEl) {
          nextPaymentDetailsEl.textContent = "";
          nextPaymentDetailsEl.style.display = 'none';
        }
        if (nextPaymentBadgeEl) nextPaymentBadgeEl.style.display = 'none';
        if (nextPaymentStat) nextPaymentStat.classList.remove('flash');
      }
      
      // Load member count for the group
      try {
        const membersRef = collection(db, `groups/${groupId}/members`);
        const membersSnapshot = await getDocs(membersRef);
        const memberCount = membersSnapshot.size;
        const totalMembersEl = document.getElementById("totalMembers");
        if (totalMembersEl) {
          totalMembersEl.innerHTML = `<span>${memberCount}</span><span class="badge" style="background: var(--bn-accent); color: var(--bn-dark); font-size: 10px; padding: 2px 6px; border-radius: 10px; font-weight: 700;">Members</span>`;
        }
      } catch (error) {
        console.error("Error loading member count:", error);
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
        const activeLoansQuery = query(loansRef, where("borrowerId", "==", user.uid), where("status", "in", ["active", "disbursed"]));
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

  // Store all upcoming payments for modal filtering
  let allUpcomingPaymentsModal = [];

  /**
   * Load all upcoming payments for next year for modal display
   */
  async function loadUpcomingPaymentsForModal(groupId, user) {
    try {
      if (!upcomingPaymentsModalList) return;
      
      // Check if user is valid
      if (!user || !user.uid) {
        upcomingPaymentsModalList.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">❌</div>
            <p class="empty-state-text">User information not available</p>
          </div>
        `;
        return;
      }

      upcomingPaymentsModalList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⏳</div>
          <p class="empty-state-text">Loading upcoming payments...</p>
        </div>
      `;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const nextYear = new Date(today);
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      const currentYear = today.getFullYear();
      
      const upcomingPayments = [];

      // Get group data
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (!groupDoc.exists()) {
        upcomingPaymentsModalList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p class="empty-state-text">Group not found</p></div>';
        return;
      }
      
      const groupData = groupDoc.data();
      const monthlyContribution = parseFloat(groupData?.rules?.monthlyContribution?.amount || 0);
      const seedMoneyAmount = parseFloat(groupData?.rules?.seedMoney?.amount || 0);

      // 1. Load Monthly Contributions for next year
      try {
        const monthlyCollection = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${user.uid}`);
        const monthlySnapshot = await getDocs(monthlyCollection);

        monthlySnapshot.forEach(monthDoc => {
          const paymentData = monthDoc.data();
          const dueDate = paymentData.dueDate;
          
          if (dueDate && dueDate.toDate) {
            const dueDateObj = dueDate.toDate();
            const isUnpaid = paymentData.approvalStatus === "unpaid" || paymentData.approvalStatus === "pending";
            const amountDue = parseFloat(paymentData.arrears || paymentData.totalAmount || monthlyContribution);
            
            // Include if within next year and unpaid
            if (isUnpaid && dueDateObj <= nextYear && amountDue > 0) {
              const daysUntilDue = Math.ceil((dueDateObj - today) / (1000 * 60 * 60 * 24));
              upcomingPayments.push({
                type: "Monthly Contribution",
                category: "monthly",
                month: paymentData.month || "Unknown",
                year: paymentData.year || currentYear,
                amount: amountDue,
                dueDate: dueDateObj,
                status: paymentData.approvalStatus || "unpaid",
                daysUntilDue: daysUntilDue,
                isOverdue: daysUntilDue < 0,
                paymentId: monthDoc.id
              });
            }
          }
        });

        // Also project future monthly payments for next year
        const months = ["January", "February", "March", "April", "May", "June",
                       "July", "August", "September", "October", "November", "December"];
        
        for (let monthOffset = 0; monthOffset < 12; monthOffset++) {
          const futureDate = new Date(today);
          futureDate.setMonth(futureDate.getMonth() + monthOffset);
          const futureYear = futureDate.getFullYear();
          const futureMonth = months[futureDate.getMonth()];
          
          if (futureDate > nextYear) break;
          
          // Check if this month's payment exists
          const existingPayment = upcomingPayments.find(p => 
            p.type === "Monthly Contribution" && 
            p.month === futureMonth && 
            p.year === futureYear
          );
          
          if (!existingPayment) {
            // Project future monthly payment
            const dueDateObj = new Date(futureYear, futureDate.getMonth(), groupData?.rules?.monthlyContribution?.dayOfMonth || 15);
            if (dueDateObj >= today && dueDateObj <= nextYear) {
              const daysUntilDue = Math.ceil((dueDateObj - today) / (1000 * 60 * 60 * 24));
              upcomingPayments.push({
                type: "Monthly Contribution",
                category: "monthly",
                month: futureMonth,
                year: futureYear,
                amount: monthlyContribution,
                dueDate: dueDateObj,
                status: "projected",
                daysUntilDue: daysUntilDue,
                isOverdue: false,
                isProjected: true
              });
            }
          }
        }
      } catch (error) {
        console.error("Error loading monthly contributions:", error);
      }

      // 2. Load Seed Money Payment
      try {
        if (!user || !user.uid) throw new Error("User not available");
        const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${user.uid}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);
        
        if (seedMoneyDoc.exists()) {
          const seedMoneyData = seedMoneyDoc.data();
          const dueDate = seedMoneyData.dueDate;
          
          if (dueDate && dueDate.toDate) {
            const dueDateObj = dueDate.toDate();
            const isUnpaid = seedMoneyData.approvalStatus === "unpaid" || seedMoneyData.approvalStatus === "pending";
            const amountDue = parseFloat(seedMoneyData.arrears || (seedMoneyAmount - (parseFloat(seedMoneyData.amountPaid || 0))));
            
            if (isUnpaid && dueDateObj <= nextYear && amountDue > 0) {
              const daysUntilDue = Math.ceil((dueDateObj - today) / (1000 * 60 * 60 * 24));
              upcomingPayments.push({
                type: "Seed Money",
                category: "seed",
                month: "Seed Money",
                year: currentYear,
                amount: amountDue,
                dueDate: dueDateObj,
                status: seedMoneyData.approvalStatus || "unpaid",
                daysUntilDue: daysUntilDue,
                isOverdue: daysUntilDue < 0,
                paymentId: seedMoneyDoc.id
              });
            }
          }
        }
      } catch (error) {
        console.error("Error loading seed money:", error);
      }

      // 3. Load Service Fee - Check if group has service fee enabled
      try {
        if (!user || !user.uid) throw new Error("User not available");
        const groupDoc = await getDoc(doc(db, "groups", groupId));
        if (groupDoc.exists()) {
          const groupData = groupDoc.data();
          const serviceFeeAmount = parseFloat(groupData?.rules?.serviceFee?.amount || groupData?.serviceFeeAmount || 0);
          
          if (serviceFeeAmount > 0) {
            const serviceFeeRef = doc(db, `groups/${groupId}/payments/${currentYear}_ServiceFee/${user.uid}/PaymentDetails`);
            const serviceFeeDoc = await getDoc(serviceFeeRef);
            
            if (serviceFeeDoc.exists()) {
              const serviceFeeData = serviceFeeDoc.data();
              const dueDate = serviceFeeData.dueDate;
              
              if (dueDate && dueDate.toDate) {
                const dueDateObj = dueDate.toDate();
                const isUnpaid = serviceFeeData.approvalStatus === "unpaid" || serviceFeeData.approvalStatus === "pending";
                const amountDue = parseFloat(serviceFeeData.arrears || serviceFeeData.totalAmount || serviceFeeAmount);
                
                if (isUnpaid && dueDateObj <= nextYear && amountDue > 0) {
                  const daysUntilDue = Math.ceil((dueDateObj - today) / (1000 * 60 * 60 * 24));
                  upcomingPayments.push({
                    type: "Service Fee",
                    category: "servicefee",
                    month: "Service Fee",
                    year: currentYear,
                    amount: amountDue,
                    dueDate: dueDateObj,
                    status: serviceFeeData.approvalStatus || "unpaid",
                    daysUntilDue: daysUntilDue,
                    isOverdue: daysUntilDue < 0,
                    paymentId: serviceFeeDoc.id
                  });
                }
              }
            } else {
              // Service fee not yet created, but group has it enabled - show as upcoming
              const serviceFeeDueDate = groupData?.rules?.serviceFee?.dueDate || groupData?.seedMoneyDueDate;
              if (serviceFeeDueDate) {
                const dueDateObj = serviceFeeDueDate.toDate ? serviceFeeDueDate.toDate() : new Date(serviceFeeDueDate);
                if (dueDateObj <= nextYear) {
                  const daysUntilDue = Math.ceil((dueDateObj - today) / (1000 * 60 * 60 * 24));
                  upcomingPayments.push({
                    type: "Service Fee",
                    category: "servicefee",
                    month: "Service Fee",
                    year: currentYear,
                    amount: serviceFeeAmount,
                    dueDate: dueDateObj,
                    status: "unpaid",
                    daysUntilDue: daysUntilDue,
                    isOverdue: daysUntilDue < 0
                  });
                }
              }
            }
          }
        }
      } catch (error) {
        console.error("Error loading service fee:", error);
      }

      // 4. Load Loan Repayments - All unpaid installments for next year
      try {
        if (!user || !user.uid) throw new Error("User not available");
        const loansRef = collection(db, `groups/${groupId}/loans`);
        const activeLoansQuery = query(loansRef, where("borrowerId", "==", user.uid), where("status", "in", ["active", "disbursed"]));
        const activeLoansSnapshot = await getDocs(activeLoansQuery);

        activeLoansSnapshot.forEach(loanDoc => {
          const loanData = loanDoc.data();
          const repaymentSchedule = loanData.repaymentSchedule || {};
          const loanAmount = parseFloat(loanData.amount || loanData.loanAmount || 0);

          // Check each month in repayment schedule
          Object.keys(repaymentSchedule).forEach(monthKey => {
            const scheduleItem = repaymentSchedule[monthKey];
            if (scheduleItem && !scheduleItem.paid && scheduleItem.dueDate) {
              const dueDate = scheduleItem.dueDate.toDate ? scheduleItem.dueDate.toDate() : new Date(scheduleItem.dueDate);
              
              // Include if within next year
              if (dueDate >= today && dueDate <= nextYear) {
                const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
                const amountDue = parseFloat(scheduleItem.amount || 0);
                
                if (amountDue > 0) {
                  upcomingPayments.push({
                    type: "Loan Repayment",
                    category: "loan",
                    month: monthKey,
                    year: dueDate.getFullYear(),
                    amount: amountDue,
                    dueDate: dueDate,
                    status: "unpaid",
                    daysUntilDue: daysUntilDue,
                    isOverdue: false,
                    loanId: loanDoc.id,
                    loanAmount: loanAmount,
                    installment: scheduleItem.month || 1,
                    principal: scheduleItem.principal || 0,
                    interest: scheduleItem.interest || 0,
                    interestRate: scheduleItem.interestRate || 0
                  });
                }
              }
            }
          });
        });
      } catch (error) {
        console.error("Error loading loan repayments:", error);
      }

      // 4. Load Penalties (if any exist in the system)
      // Note: Penalties are typically calculated dynamically, but we can check for recorded penalties
      // Penalties are typically stored in member payment records, not a separate collection
      // We'll skip this for now as penalties are usually calculated dynamically from arrears

      // Sort by due date (earliest first)
      upcomingPayments.sort((a, b) => a.dueDate - b.dueDate);

      // Store for filtering
      allUpcomingPaymentsModal = upcomingPayments;

      // Display all by default
      displayUpcomingPaymentsModal(upcomingPayments);
    } catch (error) {
      console.error("Error loading upcoming payments for modal:", error);
      if (upcomingPaymentsModalList) {
        upcomingPaymentsModalList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p class="empty-state-text">Error loading payments</p></div>';
      }
    }
  }

  /**
   * Display upcoming payments in modal
   */
  function displayUpcomingPaymentsModal(payments) {
    if (!upcomingPaymentsModalList) return;

    if (payments.length === 0) {
      upcomingPaymentsModalList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📅</div>
          <p class="empty-state-text">No upcoming payments for the next year</p>
        </div>
      `;
      return;
    }

    // Group by month for better organization
    const groupedByMonth = {};
    payments.forEach(payment => {
      const monthKey = `${payment.year}-${payment.dueDate.getMonth()}`;
      if (!groupedByMonth[monthKey]) {
        groupedByMonth[monthKey] = [];
      }
      groupedByMonth[monthKey].push(payment);
    });

    let html = '';
    Object.keys(groupedByMonth).sort().forEach(monthKey => {
      const monthPayments = groupedByMonth[monthKey];
      const firstPayment = monthPayments[0];
      const monthName = firstPayment.dueDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      
      html += `
        <div style="margin-bottom: var(--bn-space-5);">
          <h4 style="font-size: var(--bn-text-sm); font-weight: 700; color: var(--bn-dark); margin-bottom: var(--bn-space-3); padding-bottom: var(--bn-space-2); border-bottom: 2px solid var(--bn-primary);">
            ${monthName}
          </h4>
          ${monthPayments.map(payment => createUpcomingPaymentModalItem(payment)).join('')}
        </div>
      `;
    });

    upcomingPaymentsModalList.innerHTML = html;
  }

  /**
   * Create upcoming payment item for modal
   */
  function createUpcomingPaymentModalItem(payment) {
    const dateStr = payment.dueDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    let statusBadge = '';
    let statusClass = '';
    if (payment.isOverdue) {
      statusBadge = '<span class="badge badge-danger">Overdue</span>';
      statusClass = 'overdue';
    } else if (payment.daysUntilDue <= 7) {
      statusBadge = '<span class="badge badge-warning">Due Soon</span>';
      statusClass = 'due-soon';
    } else if (payment.status === 'projected' || payment.isProjected) {
      statusBadge = '<span class="badge badge-info">Projected</span>';
      statusClass = 'projected';
    } else {
      statusBadge = '<span class="badge badge-secondary">Upcoming</span>';
      statusClass = 'upcoming';
    }

    const daysText = payment.isOverdue 
      ? `${Math.abs(payment.daysUntilDue)} days overdue`
      : payment.daysUntilDue === 0
      ? 'Due today'
      : payment.daysUntilDue === 1
      ? 'Due tomorrow'
      : `${payment.daysUntilDue} days`;

    const typeIcon = payment.category === 'seed' ? '🌱' :
                     payment.category === 'monthly' ? '📅' :
                     payment.category === 'servicefee' ? '💳' :
                     payment.category === 'loan' ? '💰' :
                     payment.category === 'penalty' ? '⚠️' : '💵';

    let additionalInfo = '';
    if (payment.category === 'loan' && payment.principal && payment.interest) {
      additionalInfo = `<div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: 4px;">
        Principal: ${formatCurrency(payment.principal)} | Interest: ${formatCurrency(payment.interest)} (${payment.interestRate}%)
      </div>`;
    }
    if (payment.penaltyReason) {
      additionalInfo = `<div style="font-size: var(--bn-text-xs); color: var(--bn-warning); margin-top: 4px;">
        Reason: ${escapeHtml(payment.penaltyReason)}
      </div>`;
    }

    return `
      <div class="upcoming-payment-item ${statusClass}" style="margin-bottom: var(--bn-space-3);">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: var(--bn-space-2);">
          <div style="display: flex; align-items: center; gap: var(--bn-space-3); flex: 1;">
            <div style="font-size: 24px;">${typeIcon}</div>
            <div style="flex: 1;">
              <div style="font-weight: 600; color: var(--bn-dark); font-size: var(--bn-text-base);">
                ${payment.type}
              </div>
              <div style="font-size: var(--bn-text-sm); color: var(--bn-gray); margin-top: 2px;">
                ${payment.month} ${payment.year}
              </div>
              ${additionalInfo}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 700; color: var(--bn-dark); font-size: var(--bn-text-lg); margin-bottom: 4px;">
              ${formatCurrency(payment.amount)}
            </div>
            ${statusBadge}
          </div>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; padding-top: var(--bn-space-2); border-top: 1px solid var(--bn-gray-lighter); font-size: var(--bn-text-xs); color: var(--bn-gray);">
          <span>Due: ${dateStr}</span>
          <span style="font-weight: 600;">${daysText}</span>
        </div>
      </div>
    `;
  }

  /**
   * Filter upcoming payments by category
   */
  function filterUpcomingPayments(filter) {
    if (!upcomingPaymentsModalList) return;

    let filtered = allUpcomingPaymentsModal;
    
    if (filter !== 'all') {
      filtered = allUpcomingPaymentsModal.filter(p => {
        return p.category === filter;
      });
    }

    displayUpcomingPaymentsModal(filtered);
  }

  /**
   * Escape HTML helper
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

  // Event Listeners for Quick Actions
  if (requestLoanBtn) {
    requestLoanBtn.addEventListener("click", async () => {
      const groupId = getSelectedGroupId();
      if (!groupId) {
        alert("Please select a group first from the group selection page.");
        window.location.href = "select_group.html";
        return;
      }
      if (loanModal) {
        loanModal.classList.remove("hidden");
        // Populate group select in modal
        await populateLoanGroupSelector(groupId);
        // Populate target month options
        populateLoanTargetMonths();
        // Setup loan calculation handlers
        await setupLoanCalculation(groupId);
      }
    });
  }

  // Close loan modal
  const closeLoanModal = document.getElementById("closeLoanModal");
  if (closeLoanModal) {
    closeLoanModal.addEventListener("click", () => {
      if (loanModal) loanModal.classList.add("hidden");
      const form = document.getElementById("loanRequestForm");
      if (form) form.reset();
    });
  }

  // Loan request form submission
  const loanRequestForm = document.getElementById("loanRequestForm");
  if (loanRequestForm) {
    loanRequestForm.addEventListener("submit", handleLoanBooking);
  }

  /**
   * Populate loan group selector
   */
  async function populateLoanGroupSelector(selectedGroupId) {
    const loanGroupSelect = document.getElementById("loanGroup");
    if (!loanGroupSelect) return;

    loanGroupSelect.innerHTML = '<option value="">Choose a group...</option>';
    
    for (const group of userGroups) {
      const option = document.createElement("option");
      option.value = group.groupId;
      option.textContent = group.groupName;
      if (group.groupId === selectedGroupId) {
        option.selected = true;
      }
      loanGroupSelect.appendChild(option);
    }
  }

  /**
   * Populate loan target months
   */
  function populateLoanTargetMonths() {
    const targetMonthSelect = document.getElementById("loanTargetMonth");
    if (!targetMonthSelect) return;

    const now = new Date();
    targetMonthSelect.innerHTML = '';
    
    // Add current and next 3 months as options
    for (let i = 0; i <= 3; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const option = document.createElement("option");
      option.value = monthKey;
      option.textContent = monthName;
      if (i === 0) option.selected = true;
      targetMonthSelect.appendChild(option);
    }
  }

  /**
   * Setup loan calculation handlers
   */
  async function setupLoanCalculation(groupId) {
    const loanAmountInput = document.getElementById("loanAmount");
    const loanPeriodSelect = document.getElementById("loanRepaymentPeriod");
    const loanAmountHelper = document.getElementById("loanAmountHelper");

    // Get group loan settings
    let interestRates = { month1: 10, month2: 7, month3: 5 };
    let maxLoanAmount = 500000;
    let minLoanAmount = 10000;

    try {
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (groupDoc.exists()) {
        const groupData = groupDoc.data();
        const loanInterest = groupData?.rules?.loanInterest || {};
        const loanRules = groupData?.rules?.loanRules || {};
        
        interestRates = {
          month1: parseFloat(loanInterest.month1 || 10),
          month2: parseFloat(loanInterest.month2 || loanInterest.month1 || 7),
          month3: parseFloat(loanInterest.month3AndBeyond || loanInterest.month2 || 5)
        };
        maxLoanAmount = parseFloat(loanRules.maxLoanAmount || 500000);
        minLoanAmount = parseFloat(loanRules.minLoanAmount || 10000);

        if (loanAmountHelper) {
          loanAmountHelper.textContent = `Min: ${formatCurrency(minLoanAmount)} | Max: ${formatCurrency(maxLoanAmount)}`;
        }
        if (loanAmountInput) {
          loanAmountInput.min = minLoanAmount;
          loanAmountInput.max = maxLoanAmount;
        }
      }
    } catch (e) {
      console.error("Error loading loan settings:", e);
    }

    // Calculate and display function
    function calculateAndDisplay() {
      const amount = parseFloat(loanAmountInput?.value || 0);
      const period = parseInt(loanPeriodSelect?.value || 1);

      if (amount <= 0 || period <= 0) {
        document.getElementById("loanPrincipalDisplay").textContent = formatCurrency(0);
        document.getElementById("loanInterestDisplay").textContent = formatCurrency(0);
        document.getElementById("loanTotalDisplay").textContent = formatCurrency(0);
        const monthlyPaymentsList = document.getElementById("monthlyPaymentsList");
        if (monthlyPaymentsList) {
          monthlyPaymentsList.innerHTML = '<p style="font-size: var(--bn-text-xs); color: var(--bn-gray); text-align: center; padding: var(--bn-space-4);">Enter loan amount and repayment period to see monthly breakdown</p>';
        }
        return;
      }

      let totalInterest = 0;
      let remainingBalance = amount;
      const monthlyPrincipal = Math.round((amount / period) * 100) / 100;
      const monthlyPayments = [];

      // Calculate interest and monthly payments using reduced balance method
      for (let i = 1; i <= period; i++) {
        const rate = i === 1 ? interestRates.month1 : 
                     i === 2 ? interestRates.month2 : 
                     interestRates.month3;
        const monthlyInterest = Math.round(remainingBalance * (rate / 100) * 100) / 100;
        totalInterest += monthlyInterest;
        
        // Calculate principal for this month (last month might be different due to rounding)
        const principalThisMonth = i === period ? remainingBalance : monthlyPrincipal;
        const totalMonthlyPayment = Math.round((principalThisMonth + monthlyInterest) * 100) / 100;
        
        monthlyPayments.push({
          month: i,
          principal: principalThisMonth,
          interest: monthlyInterest,
          total: totalMonthlyPayment,
          remainingBalance: Math.round((remainingBalance - principalThisMonth) * 100) / 100,
          rate: rate
        });
        
        remainingBalance -= principalThisMonth;
        if (remainingBalance < 0) remainingBalance = 0;
      }

      // Round total interest
      totalInterest = Math.round(totalInterest * 100) / 100;
      const totalRepayable = Math.round((amount + totalInterest) * 100) / 100;

      // Update summary displays
      document.getElementById("loanPrincipalDisplay").textContent = formatCurrency(amount);
      document.getElementById("loanInterestDisplay").textContent = formatCurrency(totalInterest);
      document.getElementById("loanTotalDisplay").textContent = formatCurrency(totalRepayable);

      // Display monthly payment breakdown
      const monthlyPaymentsList = document.getElementById("monthlyPaymentsList");
      if (monthlyPaymentsList) {
        let breakdownHTML = '<div style="display: flex; flex-direction: column; gap: var(--bn-space-2);">';
        
        monthlyPayments.forEach((payment, index) => {
          breakdownHTML += `
            <div style="background: var(--bn-white); border-radius: var(--bn-radius-md); padding: var(--bn-space-3); border-left: 3px solid var(--bn-primary);">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--bn-space-2);">
                <div style="display: flex; align-items: center; gap: var(--bn-space-2);">
                  <span style="font-size: var(--bn-text-xs); font-weight: 600; color: var(--bn-gray);">Month ${payment.month}:</span>
                  <span style="font-size: var(--bn-text-xs); color: var(--bn-gray);">(${payment.rate}% interest)</span>
                </div>
                <span style="font-weight: 700; color: var(--bn-primary); font-size: var(--bn-text-base);">${formatCurrency(payment.total)}</span>
              </div>
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--bn-space-2); font-size: var(--bn-text-xs);">
                <div>
                  <span style="color: var(--bn-gray);">Principal:</span>
                  <span style="font-weight: 600; color: var(--bn-dark); display: block;">${formatCurrency(payment.principal)}</span>
                </div>
                <div>
                  <span style="color: var(--bn-gray);">Interest:</span>
                  <span style="font-weight: 600; color: var(--bn-warning); display: block;">${formatCurrency(payment.interest)}</span>
                </div>
                <div>
                  <span style="color: var(--bn-gray);">Remaining:</span>
                  <span style="font-weight: 600; color: var(--bn-gray-700); display: block;">${formatCurrency(payment.remainingBalance)}</span>
                </div>
              </div>
            </div>
          `;
        });
        
        breakdownHTML += '</div>';
        monthlyPaymentsList.innerHTML = breakdownHTML;
      }
    }

    // Add event listeners
    if (loanAmountInput) {
      loanAmountInput.addEventListener("input", calculateAndDisplay);
    }
    if (loanPeriodSelect) {
      loanPeriodSelect.addEventListener("change", calculateAndDisplay);
    }

    // Initial calculation
    calculateAndDisplay();
  }

  /**
   * Handle loan booking submission
   */
  async function handleLoanBooking(e) {
    e.preventDefault();

    const groupId = document.getElementById("loanGroup")?.value;
    const amount = parseFloat(document.getElementById("loanAmount")?.value || 0);
    const repaymentPeriod = parseInt(document.getElementById("loanRepaymentPeriod")?.value || 1);
    const targetMonth = document.getElementById("loanTargetMonth")?.value;
    const purpose = document.getElementById("loanPurpose")?.value;
    const description = document.getElementById("loanDescription")?.value;

    // Validation
    if (!groupId) {
      showToast("Please select a group.", "error");
      return;
    }
    if (!amount || amount < 1000) {
      showToast("Please enter a valid loan amount (minimum MWK 1,000).", "error");
      return;
    }
    if (!purpose) {
      showToast("Please select a loan purpose.", "error");
      return;
    }
    if (!targetMonth) {
      showToast("Please select a target month.", "error");
      return;
    }

    try {
      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting...";
      }

      // Get user data
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      const userData = userDoc.exists() ? userDoc.data() : {};
      const userName = userData.fullName || currentUser.email;

      // Get group data for interest rates
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      const groupData = groupDoc.exists() ? groupDoc.data() : {};
      const loanInterest = groupData?.rules?.loanInterest || {};

      // Calculate interest using reduced balance method
      const rates = {
        month1: parseFloat(loanInterest.month1 || 10),
        month2: parseFloat(loanInterest.month2 || loanInterest.month1 || 7),
        month3: parseFloat(loanInterest.month3AndBeyond || loanInterest.month2 || 5)
      };

      let totalInterest = 0;
      let remainingBalance = amount;

      for (let i = 1; i <= repaymentPeriod; i++) {
        const rate = i === 1 ? rates.month1 : i === 2 ? rates.month2 : rates.month3;
        const monthlyInterest = remainingBalance * (rate / 100);
        totalInterest += monthlyInterest;
        remainingBalance -= amount / repaymentPeriod;
      }

      // Parse target month
      const [targetYear, targetMonthNum] = targetMonth.split('-').map(Number);
      const targetMonthName = new Date(targetYear, targetMonthNum - 1, 1).toLocaleDateString('en-US', { month: 'long' });

      // Create loan booking document
      const loanRef = await addDoc(collection(db, `groups/${groupId}/loans`), {
        borrowerId: currentUser.uid,
        borrowerName: userName,
        borrowerEmail: currentUser.email,
        amount: amount,
        loanAmount: amount,
        repaymentPeriod: repaymentPeriod,
        totalInterest: totalInterest,
        totalRepayable: amount + totalInterest,
        amountRepaid: 0,
        purpose: purpose,
        description: description || "",
        targetMonth: targetMonth,
        targetMonthName: targetMonthName,
        targetYear: targetYear,
        status: "pending", // Loan is booked, waiting for admin approval
        bookingType: "user_request",
        requestedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        approvedAt: null,
        approvedBy: null,
        disbursedAt: null,
        dueDate: null,
        repaymentSchedule: null,
        interestRates: rates
      });

      // Send notification to all admins
      // Get admins from group data
      const adminIds = new Set();
      if (groupData.admins?.length > 0) {
        groupData.admins.forEach(a => adminIds.add(a.uid || a));
      }
      if (groupData.createdBy) {
        adminIds.add(groupData.createdBy);
      }

      // Also get admins from members collection
      try {
        const membersRef = collection(db, `groups/${groupId}/members`);
        const membersSnapshot = await getDocs(membersRef);
        membersSnapshot.forEach((memberDoc) => {
          const memberData = memberDoc.data();
          if (memberData.role === "admin" || memberData.role === "senior_admin") {
            adminIds.add(memberDoc.id);
          }
        });
      } catch (error) {
        console.error("Error loading members for admin notification:", error);
      }

      // Send notifications to all admins
      if (adminIds.size > 0) {
        const batch = writeBatch(db);
        for (const adminId of adminIds) {
          const notificationRef = doc(collection(db, `groups/${groupId}/notifications`));
          batch.set(notificationRef, {
            notificationId: notificationRef.id,
            groupId: groupId,
            groupName: groupData.groupName || "Unknown Group",
            userId: adminId, // Use userId for consistency
            recipientId: adminId, // Keep for backward compatibility
            senderId: currentUser.uid,
            senderName: userName,
            senderEmail: currentUser.email,
            title: `New Loan Booking: ${formatCurrency(amount)}`,
            message: `${userName} has booked a loan of ${formatCurrency(amount)} for ${targetMonthName} ${targetYear}. Purpose: ${purpose}. Repayment period: ${repaymentPeriod} month(s). Please review and approve in Manage Loans.`,
            type: "loan_booking",
            loanId: loanRef.id,
            allowReplies: false,
            read: false,
            createdAt: Timestamp.now(),
            replies: []
          });
        }
        await batch.commit();
      }

      alert(`Loan booking submitted successfully!\n\nAmount: ${formatCurrency(amount)}\nTarget Month: ${targetMonthName} ${targetYear}\nEstimated Total Repayable: ${formatCurrency(amount + totalInterest)}\n\nYour request will be reviewed by the group admin.`);

      // Close modal and reset form
      if (loanModal) loanModal.classList.add("hidden");
      document.getElementById("loanRequestForm")?.reset();

      // Reload dashboard and upcoming payments (including modal if open)
      if (currentGroup) {
        await loadDashboardData(currentGroup.groupId, currentUser);
        await loadUpcomingPayments(currentGroup.groupId, currentUser);
        // If upcoming payments modal is open, reload it too
        if (upcomingPaymentsModal && !upcomingPaymentsModal.classList.contains('hidden')) {
          await loadUpcomingPaymentsForModal(currentGroup.groupId, currentUser);
        }
      }

    } catch (error) {
      console.error("Error submitting loan booking:", error);
      alert("Error submitting loan booking: " + error.message);
    } finally {
      const submitBtn = e.target?.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Loan Booking";
      }
    }
  }

  // Upcoming Payments button - Opens modal with all payments for next year
  if (upcomingPaymentsBtn) {
    upcomingPaymentsBtn.addEventListener("click", async () => {
      const groupId = getSelectedGroupId();
      if (!groupId) {
        alert("Please select a group first from the group selection page.");
        window.location.href = "select_group.html";
        return;
      }
      if (!currentUser || !currentUser.uid) {
        alert("User information not available. Please refresh the page.");
        return;
      }
      if (upcomingPaymentsModal) {
        // Load fresh data every time modal opens
        await loadUpcomingPaymentsForModal(groupId, currentUser);
        
        // Set up real-time listener for loans to auto-update when loans are approved
        setupUpcomingPaymentsListener(groupId, currentUser);
        
        if (window.openModal) {
          window.openModal("upcomingPaymentsModal");
        } else {
          upcomingPaymentsModal.classList.remove("hidden");
          upcomingPaymentsModal.classList.add("active");
        }
      }
    });
  }

  // Real-time listener for upcoming payments (only when modal is open)
  let upcomingPaymentsUnsubscribes = [];

  function setupUpcomingPaymentsListener(groupId, user) {
    // Clean up existing listeners
    upcomingPaymentsUnsubscribes.forEach(unsub => unsub());
    upcomingPaymentsUnsubscribes = [];

    if (!groupId || !user || !user.uid) return;

    // Listen for active loans changes
    try {
      const loansRef = collection(db, `groups/${groupId}/loans`);
      const activeLoansQuery = query(loansRef, where("borrowerId", "==", user.uid), where("status", "in", ["active", "disbursed"]));
      
      const unsubscribe = onSnapshot(activeLoansQuery, async (snapshot) => {
        // Only reload if modal is open
        if (upcomingPaymentsModal && !upcomingPaymentsModal.classList.contains('hidden')) {
          await loadUpcomingPaymentsForModal(groupId, currentUser);
        }
      }, (error) => {
        console.error("Error listening to loans:", error);
      });
      
      upcomingPaymentsUnsubscribes.push(unsubscribe);
    } catch (error) {
      console.error("Error setting up loans listener:", error);
    }

    // Listen for loan status changes (pending to active)
    try {
      const loansRef = collection(db, `groups/${groupId}/loans`);
      const pendingLoansQuery = query(loansRef, where("borrowerId", "==", user.uid), where("status", "==", "pending"));
      
      const unsubscribe = onSnapshot(pendingLoansQuery, async (snapshot) => {
        if (upcomingPaymentsModal && !upcomingPaymentsModal.classList.contains('hidden')) {
          await loadUpcomingPaymentsForModal(groupId, currentUser);
        }
      }, (error) => {
        console.error("Error listening to pending loans:", error);
      });
      
      upcomingPaymentsUnsubscribes.push(unsubscribe);
    } catch (error) {
      console.error("Error setting up pending loans listener:", error);
    }
  }

  // Close upcoming payments modal
  const closeUpcomingPaymentsModal = document.getElementById("closeUpcomingPaymentsModal");
  if (closeUpcomingPaymentsModal) {
    closeUpcomingPaymentsModal.addEventListener("click", () => {
      // Clean up listeners when modal closes
      upcomingPaymentsUnsubscribes.forEach(unsub => unsub());
      upcomingPaymentsUnsubscribes = [];
      
      if (window.closeModal) {
        window.closeModal("upcomingPaymentsModal");
      } else {
        if (upcomingPaymentsModal) upcomingPaymentsModal.classList.add("hidden");
        if (upcomingPaymentsModal) upcomingPaymentsModal.classList.remove("active");
      }
    });
  }

  // Payment filter buttons in modal
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-payment-filter]')) {
      const filter = e.target.dataset.paymentFilter;
      document.querySelectorAll('[data-payment-filter]').forEach(btn => {
        btn.classList.remove('active');
      });
      e.target.classList.add('active');
      filterUpcomingPayments(filter);
    }
  });

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
          await populatePaymentGroupSelector(groupId);
          paymentGroupSelect.value = groupId;
        }
        // Set default payment date to today
        const paymentDateInput = document.getElementById("paymentDate");
        if (paymentDateInput) {
          paymentDateInput.value = new Date().toISOString().split("T")[0];
        }
        // Setup payment type change handler for auto-populate
        await setupPaymentTypeAutoPopulate(groupId);
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
   * Setup payment type auto-populate handler
   */
  async function setupPaymentTypeAutoPopulate(groupId) {
    const paymentTypeSelect = document.getElementById("paymentType");
    const paymentAmountInput = document.getElementById("paymentAmount");
    
    if (!paymentTypeSelect || !paymentAmountInput) return;

    // Store amounts for auto-populate
    let amountsDue = {
      seed_money: 0,
      monthly_contribution: 0,
      loan_repayment: 0
    };

    try {
      // Get group data for contribution amounts
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (groupDoc.exists()) {
        const groupData = groupDoc.data();
        const monthlyAmount = parseFloat(groupData?.rules?.monthlyContribution?.amount || groupData?.monthlyContribution || 0);
        const seedMoneyAmount = parseFloat(groupData?.rules?.seedMoney?.amount || groupData?.seedMoneyAmount || 0);
        
        const currentYear = new Date().getFullYear();

        // Get seed money arrears
        try {
          const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${currentUser.uid}/PaymentDetails`);
          const seedMoneyDoc = await getDoc(seedMoneyRef);
          if (seedMoneyDoc.exists()) {
            const data = seedMoneyDoc.data();
            // Use Math.max to prevent negative values
            amountsDue.seed_money = Math.max(0, parseFloat(data.arrears || (seedMoneyAmount - (parseFloat(data.amountPaid || 0)))));
          } else {
            amountsDue.seed_money = seedMoneyAmount;
          }
        } catch (e) {
          amountsDue.seed_money = seedMoneyAmount;
        }

        // Get current month's contribution arrears
        try {
          const now = new Date();
          const monthName = now.toLocaleString("default", { month: "long" });
          const monthDocId = `${currentYear}_${monthName}`;
          const monthlyRef = doc(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${currentUser.uid}/${monthDocId}`);
          const monthlyDoc = await getDoc(monthlyRef);
          if (monthlyDoc.exists()) {
            const data = monthlyDoc.data();
            // Use Math.max to prevent negative values
            amountsDue.monthly_contribution = Math.max(0, parseFloat(data.arrears || (parseFloat(data.totalAmount || monthlyAmount) - parseFloat(data.amountPaid || 0))));
          } else {
            amountsDue.monthly_contribution = monthlyAmount;
          }
        } catch (e) {
          amountsDue.monthly_contribution = monthlyAmount;
        }

        // Get active loan repayment amount
        try {
          const loansRef = collection(db, `groups/${groupId}/loans`);
          const activeLoansQuery = query(loansRef, where("borrowerId", "==", currentUser.uid), where("status", "in", ["active", "disbursed"]));
          const activeLoansSnapshot = await getDocs(activeLoansQuery);
          
          if (!activeLoansSnapshot.empty) {
            const loanDoc = activeLoansSnapshot.docs[0];
            const loanData = loanDoc.data();
            
            // Find next unpaid repayment
            const repaymentSchedule = loanData.repaymentSchedule || {};
            if (repaymentSchedule && typeof repaymentSchedule === 'object') {
              for (const monthKey of Object.keys(repaymentSchedule)) {
                const scheduleItem = repaymentSchedule[monthKey];
                if (scheduleItem && !scheduleItem.paid) {
                  amountsDue.loan_repayment = parseFloat(scheduleItem.amount || 0);
                  break;
                }
              }
            }
          }
        } catch (e) {
          console.log("No active loans found");
        }
      }
    } catch (e) {
      console.error("Error loading amounts for auto-populate:", e);
    }

    // Add helper text element if it doesn't exist
    let helperText = document.getElementById("paymentAmountHelper");
    if (!helperText) {
      helperText = document.createElement("p");
      helperText.id = "paymentAmountHelper";
      helperText.style.cssText = "font-size: 12px; color: var(--bn-gray); margin-top: 4px;";
      paymentAmountInput.parentElement.appendChild(helperText);
    }

    // Handler function for payment type change
    function handlePaymentTypeChange(e) {
      const selectedType = e.target.value;
      const amountDue = amountsDue[selectedType] || 0;
      
      if (amountDue > 0) {
        paymentAmountInput.value = amountDue;
        helperText.innerHTML = `<span style="color: var(--bn-success);">✓ Auto-filled: ${formatCurrency(amountDue)} due</span>`;
      } else {
        paymentAmountInput.value = "";
        if (selectedType === "seed_money") {
          helperText.textContent = "No seed money arrears found";
        } else if (selectedType === "monthly_contribution") {
          helperText.textContent = "Enter your monthly contribution amount";
        } else if (selectedType === "loan_repayment") {
          helperText.textContent = "No active loan repayments found";
        } else {
          helperText.textContent = "";
        }
      }
    }

    // Store handler reference for cleanup
    if (paymentTypeSelect._autoPopulateHandler) {
      paymentTypeSelect.removeEventListener("change", paymentTypeSelect._autoPopulateHandler);
    }
    paymentTypeSelect._autoPopulateHandler = handlePaymentTypeChange;
    paymentTypeSelect.addEventListener("change", handlePaymentTypeChange);

    // Trigger change event if a type is already selected
    if (paymentTypeSelect.value) {
      paymentTypeSelect.dispatchEvent(new Event("change"));
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
    const isAdvancedPayment = document.getElementById("isAdvancedPayment")?.checked || false;

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

    // Disable submit button
    const submitBtn = paymentUploadForm.querySelector('button[type="submit"]');
    const originalText = submitBtn?.textContent || "Submit Payment";
    
    try {
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

      // Handle different payment types (pass isAdvancedPayment flag)
      if (paymentType === "seed_money") {
        await handleSeedMoneyPayment(groupId, amount, paymentDate, proofUrl, userName, isAdvancedPayment);
      } else if (paymentType === "monthly_contribution") {
        await handleMonthlyContributionPayment(groupId, amount, paymentDate, proofUrl, userName, isAdvancedPayment);
      } else if (paymentType === "loan_repayment") {
        await handleLoanRepaymentPayment(groupId, amount, paymentDate, proofUrl, userName, isAdvancedPayment);
      } else if (paymentType === "penalty") {
        await handlePenaltyPayment(groupId, amount, paymentDate, proofUrl, userName, isAdvancedPayment);
      }

      // Get member ID based on payment type
      let memberIdForNotification = currentUser.uid;
      
      // Send notification to admins with payment details for approval
      await sendPaymentNotificationToAdmins(groupId, paymentType, amount, userName, memberIdForNotification, null, isAdvancedPayment);

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
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }
  }

  /**
   * Handle seed money payment
   */
  async function handleSeedMoneyPayment(groupId, amount, paymentDate, proofUrl, userName, isAdvancedPayment = false) {
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

    // For advanced payments, keep status as pending until admin approval
    // For regular payments, also pending until admin approval
    const approvalStatus = "pending";

    await updateDoc(seedMoneyRef, {
      amountPaid: newAmountPaid,
      arrears: newArrears,
      approvalStatus: approvalStatus,
      paymentStatus: newArrears === 0 ? "Completed" : "Pending",
      proofOfPayment: {
        imageUrl: proofUrl,
        uploadedAt: Timestamp.now(),
        verifiedBy: ""
      },
      paidAt: Timestamp.fromDate(new Date(paymentDate)),
      isAdvancedPayment: isAdvancedPayment,
      updatedAt: Timestamp.now()
    });
  }

  /**
   * Handle monthly contribution payment
   */
  async function handleMonthlyContributionPayment(groupId, amount, paymentDate, proofUrl, userName, isAdvancedPayment = false) {
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
      approvalStatus: "pending", // Always pending until admin approval
      approvedAt: null,
      approvedBy: null,
      uploadedAt: Timestamp.now(),
      isAdvancedPayment: isAdvancedPayment
    };

    paidArray.push(newPayment);

    // Calculate new totals - but don't update approval status automatically
    // Only count approved payments for totals when not advanced
    const approvedPayments = isAdvancedPayment ? [] : paidArray.filter(p => p.approvalStatus === "approved");
    const totalPaidApproved = approvedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const totalPaidAll = paidArray.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const totalAmount = parseFloat(monthlyData.totalAmount || 0);
    
    // For advanced payments, don't update arrears until approved
    // For regular payments, still pending approval
    const newArrears = isAdvancedPayment ? 
      Math.max(totalAmount - totalPaidApproved, 0) : 
      Math.max(totalAmount - totalPaidApproved, 0);
    
    const newApprovalStatus = "pending"; // Always pending until admin approves

    await updateDoc(monthlyRef, {
      paid: paidArray,
      amountPaid: isAdvancedPayment ? totalPaidApproved : totalPaidAll, // Only count approved for advanced
      arrears: newArrears,
      approvalStatus: newApprovalStatus,
      paymentStatus: newArrears === 0 ? "Completed" : "Pending",
      isAdvancedPayment: isAdvancedPayment || monthlyData.isAdvancedPayment || false,
      updatedAt: Timestamp.now()
    });
  }

  /**
   * Handle loan repayment payment
   */
  async function handleLoanRepaymentPayment(groupId, amount, paymentDate, proofUrl, userName, isAdvancedPayment = false) {
    // Get active loans for user (including disbursed)
    const loansRef = collection(db, `groups/${groupId}/loans`);
    const activeLoansQuery = query(loansRef, where("borrowerId", "==", currentUser.uid), where("status", "in", ["active", "disbursed"]));
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
      isAdvancedPayment: isAdvancedPayment,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
  }

  /**
   * Handle penalty payment
   */
  async function handlePenaltyPayment(groupId, amount, paymentDate, proofUrl, userName, isAdvancedPayment = false) {
    // Penalty payments can be handled similarly to seed money
    // For now, we'll store it in a separate collection or as a note
    // This depends on how penalties are tracked in your system
    throw new Error("Penalty payment handling not yet implemented. Please contact an admin.");
  }

  /**
   * Send payment notification to admins
   */
  async function sendPaymentNotificationToAdmins(groupId, paymentType, amount, userName, memberId = null, paymentId = null, isAdvancedPayment = false) {
    try {
      // Get group data
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (!groupDoc.exists()) return;

      const groupData = groupDoc.data();
      
      // Get all admin IDs (from admins array and createdBy)
      const adminIds = new Set();
      if (groupData.admins?.length > 0) {
        groupData.admins.forEach(a => adminIds.add(a.uid || a));
      }
      if (groupData.createdBy) {
        adminIds.add(groupData.createdBy);
      }
      
      // Also get admins from members collection
      try {
        const membersRef = collection(db, `groups/${groupId}/members`);
        const membersSnapshot = await getDocs(membersRef);
        membersSnapshot.forEach((memberDoc) => {
          const memberData = memberDoc.data();
          if (memberData.role === "admin" || memberData.role === "senior_admin") {
            adminIds.add(memberDoc.id);
          }
        });
      } catch (error) {
        console.error("Error loading members for admin notification:", error);
      }

      if (adminIds.size === 0) return;

      const paymentTypeNames = {
        seed_money: "Seed Money",
        monthly_contribution: "Monthly Contribution",
        loan_repayment: "Loan Repayment",
        penalty: "Penalty Payment"
      };

      const paymentTypeName = paymentTypeNames[paymentType] || paymentType;
      const memberIdToUse = memberId || currentUser.uid;
      const advancedPaymentLabel = isAdvancedPayment ? " (Advanced Payment)" : "";

      // Create notification for each admin with all details needed for approval
      const batch = writeBatch(db);
      
      for (const adminId of adminIds) {
        const notificationRef = doc(collection(db, `groups/${groupId}/notifications`));
        batch.set(notificationRef, {
          notificationId: notificationRef.id,
          groupId: groupId,
          groupName: groupData.groupName || "Unknown Group",
          userId: adminId, // Use userId for consistency
          recipientId: adminId, // Keep for backward compatibility
          senderId: currentUser.uid,
          senderName: userName,
          senderEmail: currentUser.email,
          title: `New Payment Uploaded: ${paymentTypeName}${advancedPaymentLabel}`,
          message: `${userName} has uploaded a payment proof for ${paymentTypeName}${advancedPaymentLabel} (${formatCurrency(amount)}).${isAdvancedPayment ? ' This is an advanced payment and requires approval before updating calculations.' : ''} Please review and approve from Messages.`,
          type: "payment_upload", // Specific type for filtering
          paymentType: paymentType,
          paymentId: paymentId || notificationRef.id,
          memberId: memberIdToUse,
          amount: amount,
          isAdvancedPayment: isAdvancedPayment,
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
        metadata: { groupId, paymentType, amount, userName, memberId, paymentId },
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

          calendarHTML += `<div class="${dayClass}" data-date="${dateKey}" title="${hasEvents ? events.map(e => `${e.type}: ${formatCurrency(e.amount)}`).join(', ') : ''}">`;
          calendarHTML += `<span class="calendar-day-number">${day}</span>`;
          
          if (hasEvents) {
            calendarHTML += '<div class="calendar-day-events">';
            events.forEach(event => {
              let noteClass = 'calendar-event-note';
              
              // Add approved class if payment is approved
              if (event.isApproved) {
                noteClass += ' approved';
              }
              
              // Add type class
              if (event.type === 'Monthly Contribution') {
                noteClass += ' monthly';
              } else if (event.type === 'Seed Money') {
                noteClass += ' seed';
              } else if (event.type === 'Service Fee') {
                noteClass += ' servicefee';
              } else if (event.type === 'Loan Repayment') {
                noteClass += ' loan';
              } else if (event.type === 'Loan Disbursed') {
                noteClass += ' loan';
              }
              
              if (event.isOverdue) {
                noteClass += ' overdue';
              }
              
              // Show only colored dot indicator (no text)
              calendarHTML += `<div class="${noteClass}" style="width: 8px; height: 8px; padding: 0; margin: 1px; border-radius: 50%; min-height: 8px; font-size: 0;" title="${event.type}: ${formatCurrency(event.amount)}${event.isApproved ? ' (Paid)' : ''}"></div>`;
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

        // Build payment legend with all approved payments
        const paymentLegendContainer = document.getElementById("paymentLegend");
        if (paymentLegendContainer) {
          const allApprovedPayments = [];
          Object.keys(paymentDates).forEach(dateKey => {
            const events = paymentDates[dateKey];
            events.forEach(event => {
              // Include approved payments and loan disbursed dates
              if (event.isApproved || event.type === 'Loan Disbursed') {
                const paidDate = event.disbursedAt?.toDate ? event.disbursedAt.toDate() :
                               (event.paidAt?.toDate ? event.paidAt.toDate() : 
                               (event.approvedAt?.toDate ? event.approvedAt.toDate() : 
                               new Date(dateKey)));
                const displayType = event.type === 'Loan Disbursed' ? 'Loan Disbursed' : event.type;
                allApprovedPayments.push({
                  type: displayType,
                  amount: event.amount,
                  date: paidDate,
                  dateKey: dateKey
                });
              }
            });
          });

          // Sort by date (most recent first)
          allApprovedPayments.sort((a, b) => b.date - a.date);

          if (allApprovedPayments.length > 0) {
            let legendHTML = '<div style="margin-top: var(--bn-space-4); padding: var(--bn-space-3); background: var(--bn-gray-50); border-radius: var(--bn-radius-md);">';
            legendHTML += '<div style="font-size: var(--bn-text-xs); font-weight: 700; color: var(--bn-dark); margin-bottom: var(--bn-space-2); text-transform: uppercase; letter-spacing: 0.05em;">Payment History</div>';
            legendHTML += '<div style="display: flex; flex-direction: column; gap: var(--bn-space-1); font-size: var(--bn-text-xs); line-height: 1.5;">';
            
            allApprovedPayments.forEach(payment => {
              const dateStr = payment.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              const amountStr = formatCurrency(payment.amount);
              const prefix = payment.type === 'Loan Disbursed' ? 'Disbursed' : 'Paid';
              legendHTML += `<div style="color: var(--bn-gray-700);">${prefix} <strong style="color: var(--bn-dark);">${amountStr}</strong> on <strong style="color: var(--bn-dark);">${dateStr}</strong> - ${payment.type}</div>`;
            });
            
            legendHTML += '</div></div>';
            paymentLegendContainer.innerHTML = legendHTML;
          } else {
            paymentLegendContainer.innerHTML = '';
          }
        }

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
      console.error("Error loading payment calendar:", error);
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

      // 3. Service Fee
      try {
        const serviceFeeRef = doc(db, `groups/${groupId}/payments/${currentYear}_ServiceFee/${user.uid}/PaymentDetails`);
        const serviceFeeDoc = await getDoc(serviceFeeRef);
        
        if (serviceFeeDoc.exists()) {
          const serviceFeeData = serviceFeeDoc.data();
          const dueDate = serviceFeeData.dueDate;
          
          if (dueDate && dueDate.toDate) {
            const dueDateObj = dueDate.toDate();
            const isUnpaid = serviceFeeData.approvalStatus === "unpaid" || serviceFeeData.approvalStatus === "pending";
            const isApproved = serviceFeeData.approvalStatus === "approved" || serviceFeeData.paymentStatus === "completed";
            
            if ((isUnpaid || isApproved) && dueDateObj.getMonth() === month && dueDateObj.getFullYear() === year) {
              const dateKey = `${dueDateObj.getFullYear()}-${String(dueDateObj.getMonth() + 1).padStart(2, '0')}-${String(dueDateObj.getDate()).padStart(2, '0')}`;
              const isOverdue = isUnpaid && dueDateObj < today;
              
              if (!paymentDates[dateKey]) paymentDates[dateKey] = [];
              paymentDates[dateKey].push({
                type: 'Service Fee',
                amount: isApproved ? parseFloat(serviceFeeData.amountPaid || 0) : parseFloat(serviceFeeData.arrears || serviceFeeData.totalAmount || 0),
                dueDate: dueDateObj,
                isOverdue: isOverdue,
                isApproved: isApproved,
                paidAt: serviceFeeData.paidAt,
                approvedAt: serviceFeeData.approvedAt
              });
            }
          }
        }
      } catch (error) {
        await logDatabaseError(error, "loadPaymentDatesForCalendar - Service Fee", { groupId, userId: user?.uid }, { severity: ErrorSeverity.LOW });
      }

      // 4. Loan Disbursed Dates & Loan Repayments
      try {
        const loansRef = collection(db, `groups/${groupId}/loans`);
        const activeLoansQuery = query(loansRef, where("borrowerId", "==", user.uid), where("status", "in", ["active", "disbursed"]));
        const activeLoansSnapshot = await getDocs(activeLoansQuery);

        activeLoansSnapshot.forEach(loanDoc => {
          const loanData = loanDoc.data();
          
          // Track loan disbursed date
          const disbursedAt = loanData.disbursedAt;
          if (disbursedAt && disbursedAt.toDate) {
            const disbursedDate = disbursedAt.toDate();
            if (disbursedDate.getMonth() === month && disbursedDate.getFullYear() === year) {
              const dateKey = `${disbursedDate.getFullYear()}-${String(disbursedDate.getMonth() + 1).padStart(2, '0')}-${String(disbursedDate.getDate()).padStart(2, '0')}`;
              
              if (!paymentDates[dateKey]) paymentDates[dateKey] = [];
              paymentDates[dateKey].push({
                type: 'Loan Disbursed',
                amount: parseFloat(loanData.amount || loanData.loanAmount || 0),
                dueDate: disbursedDate,
                isOverdue: false,
                isApproved: true,
                loanId: loanDoc.id,
                disbursedAt: disbursedAt
              });
            }
          }
          
          // Track loan repayment dates
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
      
      // 5. Also show approved/completed payments (not just unpaid)
      // Monthly Contributions - Approved
      try {
        const monthlyCollection = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${user.uid}`);
        const monthlySnapshot = await getDocs(monthlyCollection);

        monthlySnapshot.forEach(monthDoc => {
          const paymentData = monthDoc.data();
          const paidAt = paymentData.paidAt;
          const approvedAt = paymentData.approvedAt;
          const isApproved = paymentData.approvalStatus === "approved" || paymentData.paymentStatus === "completed";
          
          if (isApproved && (paidAt || approvedAt)) {
            const paymentDate = paidAt?.toDate ? paidAt.toDate() : (approvedAt?.toDate ? approvedAt.toDate() : null);
            
            if (paymentDate && paymentDate.getMonth() === month && paymentDate.getFullYear() === year) {
              const dateKey = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}-${String(paymentDate.getDate()).padStart(2, '0')}`;
              
              if (!paymentDates[dateKey]) paymentDates[dateKey] = [];
              paymentDates[dateKey].push({
                type: 'Monthly Contribution',
                amount: parseFloat(paymentData.amountPaid || 0),
                dueDate: paymentDate,
                isOverdue: false,
                isApproved: true,
                paidAt: paidAt,
                approvedAt: approvedAt,
                month: paymentData.month || monthDoc.id.split('_')[1]
              });
            }
          }
        });
      } catch (error) {
        console.log("Error loading approved monthly contributions for calendar:", error);
      }
      
      // Seed Money - Approved
      try {
        const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${user.uid}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);
        
        if (seedMoneyDoc.exists()) {
          const seedMoneyData = seedMoneyDoc.data();
          const isApproved = seedMoneyData.approvalStatus === "approved" || seedMoneyData.paymentStatus === "completed";
          const paidAt = seedMoneyData.paidAt;
          const approvedAt = seedMoneyData.approvedAt;
          
          if (isApproved && (paidAt || approvedAt)) {
            const paymentDate = paidAt?.toDate ? paidAt.toDate() : (approvedAt?.toDate ? approvedAt.toDate() : null);
            
            if (paymentDate && paymentDate.getMonth() === month && paymentDate.getFullYear() === year) {
              const dateKey = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}-${String(paymentDate.getDate()).padStart(2, '0')}`;
              
              if (!paymentDates[dateKey]) paymentDates[dateKey] = [];
              paymentDates[dateKey].push({
                type: 'Seed Money',
                amount: parseFloat(seedMoneyData.amountPaid || 0),
                dueDate: paymentDate,
                isOverdue: false,
                isApproved: true,
                paidAt: paidAt,
                approvedAt: approvedAt
              });
            }
          }
        }
      } catch (error) {
        console.log("Error loading approved seed money for calendar:", error);
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
   * Load notifications for dashboard display (up to 4 unread)
   */
  async function loadDashboardNotifications(userId, groupId) {
    try {
      const notificationsList = document.getElementById("notificationsList");
      const unreadBadge = document.getElementById("unreadBadge");
      if (!notificationsList) return;

      let unreadCount = 0;
      const notifications = [];

      // Load group notifications
      if (groupId) {
        const groupNotifRef = collection(db, `groups/${groupId}/notifications`);
        let groupNotifSnapshot;
        try {
          groupNotifSnapshot = await getDocs(query(
            groupNotifRef,
            orderBy('createdAt', 'desc'),
            limit(50)
          ));
        } catch (error) {
          // Query might fail if index not available, get all and filter
          groupNotifSnapshot = await getDocs(groupNotifRef);
        }

        groupNotifSnapshot.forEach(doc => {
          const data = doc.data();
          const isForUser = (data.userId === userId) || (data.recipientId === userId);
          if (isForUser) {
            const isRead = data.read || data.readBy?.includes(userId) || false;
            notifications.push({
              id: doc.id,
              ...data,
              isRead,
              source: 'group'
            });
            if (!isRead) {
              unreadCount++;
            }
          }
        });
      }

      // Sort by date (newest first) and unread first
      notifications.sort((a, b) => {
        // Unread first
        if (!a.isRead && b.isRead) return -1;
        if (a.isRead && !b.isRead) return 1;
        // Then by date
        const dateA = a.createdAt?.toDate?.() || new Date(0);
        const dateB = b.createdAt?.toDate?.() || new Date(0);
        return dateB - dateA;
      });

      // Update unread badge
      if (unreadBadge) {
        if (unreadCount > 0) {
          unreadBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
          unreadBadge.classList.remove('hidden');
        } else {
          unreadBadge.classList.add('hidden');
        }
      }

      // Display only unread notifications (up to 4)
      const displayNotifications = notifications.filter(n => !n.isRead).slice(0, 4);

      if (displayNotifications.length === 0) {
        notificationsList.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📬</div>
            <p class="empty-state-text">No notifications</p>
          </div>
        `;
        return;
      }

      let html = '';
      displayNotifications.forEach(notif => {
        const icon = getNotificationIconForDashboard(notif.type);
        const timeAgo = getTimeAgo(notif.createdAt?.toDate?.() || new Date());
        const message = (notif.title || notif.message || 'Notification').substring(0, 80);
        const isUnread = !notif.isRead;
        
        html += `
          <div class="notification-item ${isUnread ? 'unread' : ''}" 
               onclick="window.location.href='messages.html'"
               style="cursor: pointer;">
            <div class="notification-icon">${icon}</div>
            <div class="notification-content">
              <div class="notification-text" title="${escapeHtml(message)}">${escapeHtml(message)}</div>
              <div class="notification-time">${timeAgo}</div>
            </div>
          </div>
        `;
      });

      notificationsList.innerHTML = html;
    } catch (error) {
      console.error("Error loading dashboard notifications:", error);
      const notificationsList = document.getElementById("notificationsList");
      if (notificationsList) {
        notificationsList.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📬</div>
            <p class="empty-state-text">No notifications</p>
          </div>
        `;
      }
    }
  }
  
  // Export to window for access from other scripts
  window.loadDashboardNotifications = loadDashboardNotifications;

  /**
   * Get notification icon for dashboard
   */
  function getNotificationIconForDashboard(type) {
    const icons = {
      'loan_booking': '💰',
      'loan_approved': '✅',
      'loan_approved_disbursed': '💵',
      'loan_rejected': '❌',
      'loan_cancelled': '🚫',
      'payment_upload': '📤',
      'payment_approved': '✅',
      'payment_rejected': '❌',
      'seed_money': '🌱',
      'monthly_contribution': '💵',
      'penalty': '⚠️',
      'notification': '🔔',
      'message': '💬',
      'reminder': '⏰'
    };
    return icons[type] || '🔔';
  }

  /**
   * Get time ago format
   */
  function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /**
   * Escape HTML helper
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

  // Close modal on overlay click
  const allPaymentsModal = document.getElementById('allPaymentsModal');
  if (allPaymentsModal) {
    allPaymentsModal.addEventListener('click', (e) => {
      if (e.target === allPaymentsModal) {
        allPaymentsModal.classList.add('hidden');
      }
    });
  }
});
