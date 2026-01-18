/**
 * Loan Payments - User loan payment management
 * Upload payments, track status, view history
 */

import {
  db,
  auth,
  storage,
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  onAuthStateChanged,
  query,
  where,
  orderBy,
  Timestamp,
  ref,
  uploadBytes,
  getDownloadURL,
} from "./firebaseConfig.js";

let currentUser = null;
let userGroups = [];
let currentGroupId = null;
let allLoans = [];
let activeLoans = [];
let pendingPayments = [];
let paymentHistory = [];
let currentLoanTab = "pending";

document.addEventListener("DOMContentLoaded", () => {
  const groupSelector = document.getElementById("groupSelector");
  const makePaymentBtn = document.getElementById("makePaymentBtn");
  const paymentModal = document.getElementById("paymentModal");
  const closePaymentModal = document.getElementById("closePaymentModal");
  const loanPaymentForm = document.getElementById("loanPaymentForm");

  // Auth state
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    currentUser = user;
    await loadUserProfile();
    await loadUserGroups();
  });

  // Group selector
  if (groupSelector) {
    groupSelector.addEventListener("change", async (e) => {
      currentGroupId = e.target.value;
      if (currentGroupId) {
        // Recheck admin status after group selection
        try {
          const userDoc = await getDoc(doc(db, "users", currentUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            await checkAdminStatus(userData);
          }
        } catch (error) {
          console.error("Error checking admin status:", error);
        }
        await loadLoanData();
      } else {
        clearDisplay();
      }
    });
  }

  // Make payment button
  if (makePaymentBtn) {
    makePaymentBtn.addEventListener("click", () => {
      if (activeLoans.length > 0) {
        openPaymentModal(activeLoans[0]);
      }
    });
  }

  // Close modal
  if (closePaymentModal) {
    closePaymentModal.addEventListener("click", () => closeModal(paymentModal));
  }

  // Payment form
  if (loanPaymentForm) {
    loanPaymentForm.addEventListener("submit", handlePaymentSubmit);
  }

  // Set default payment date
  const paymentDateInput = document.getElementById("paymentDate");
  if (paymentDateInput) {
    paymentDateInput.value = new Date().toISOString().split("T")[0];
  }

  // Loan status tabs
  document.querySelectorAll('.action-tab[data-tab]').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.action-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      currentLoanTab = e.target.dataset.tab;
      displayLoansByTab();
    });
  });

  // Loan status filter dropdown
  const statusFilter = document.getElementById('loanStatusFilter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      displayLoansByTab(e.target.value);
    });
  }

  /**
   * Load user profile and check admin status
   */
  async function loadUserProfile() {
    try {
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        await checkAdminStatus(userData);
      }
    } catch (error) {
      console.error("Error loading user profile:", error);
    }
  }

  /**
   * Check if user is admin and show/hide admin button
   */
  async function checkAdminStatus(userData) {
    const roles = userData.roles || [];
    const memberships = userData.groupMemberships || [];
    
    // Check global admin roles
    let isAdmin = roles.includes("admin") || roles.includes("senior_admin") ||
                  memberships.some(m => m.role === "admin" || m.role === "senior_admin");
    
    // Also check if user is admin of the currently selected group
    if (currentGroupId && currentUser) {
      try {
        const groupDoc = await getDoc(doc(db, "groups", currentGroupId));
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
    
    // Show/hide mobile switch to admin button
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

  /**
   * Handle switch to admin dashboard
   */
  window.handleSwitchToAdmin = function() {
    const selectedGroupId = currentGroupId || localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
    if (selectedGroupId) {
      window.location.href = `admin_dashboard.html?groupId=${selectedGroupId}`;
    } else {
      window.location.href = 'admin_dashboard.html';
    }
  };

  /**
   * Load user groups
   */
  async function loadUserGroups() {
    try {
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      if (!userDoc.exists()) return;

      const userData = userDoc.data();
      const groupMemberships = userData.groupMemberships || [];

      userGroups = [];
      for (const membership of groupMemberships) {
        const groupDoc = await getDoc(doc(db, "groups", membership.groupId));
        if (groupDoc.exists()) {
          userGroups.push({ ...groupDoc.data(), id: membership.groupId });
        }
      }

      // Populate selector
      if (groupSelector) {
        groupSelector.innerHTML = '<option value="">Select a group...</option>';
        userGroups.forEach(group => {
          const option = document.createElement("option");
          option.value = group.id;
          option.textContent = group.groupName;
          groupSelector.appendChild(option);
        });

        // Auto-select first group
        if (userGroups.length > 0) {
          groupSelector.value = userGroups[0].id;
          currentGroupId = userGroups[0].id;
          // Recheck admin status after group selection
          const userDoc = await getDoc(doc(db, "users", currentUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            await checkAdminStatus(userData);
          }
          await loadLoanData();
        }
      }
    } catch (error) {
      console.error("Error loading groups:", error);
    }
  }

  /**
   * Load loan data for current group
   */
  async function loadLoanData() {
    if (!currentGroupId) return;

    try {
      // Load all loans (all statuses)
      const loansRef = collection(db, `groups/${currentGroupId}/loans`);
      
      // Try query with requestedAt first, fallback to without orderBy if field doesn't exist
      let loansSnapshot;
      try {
        const q = query(
          loansRef,
          where("borrowerId", "==", currentUser.uid),
          orderBy("requestedAt", "desc")
        );
        loansSnapshot = await getDocs(q);
      } catch (error) {
        // If requestedAt doesn't exist, try with createdAt
        try {
          const q = query(
            loansRef,
            where("borrowerId", "==", currentUser.uid),
            orderBy("createdAt", "desc")
          );
          loansSnapshot = await getDocs(q);
        } catch (error2) {
          // If neither field exists, just filter by borrowerId
          const q = query(
            loansRef,
            where("borrowerId", "==", currentUser.uid)
          );
          loansSnapshot = await getDocs(q);
        }
      }

      allLoans = [];
      activeLoans = [];

      for (const loanDoc of loansSnapshot.docs) {
        const loanData = loanDoc.data();
        const loan = { 
          id: loanDoc.id, 
          ...loanData,
          // Ensure status exists
          status: loanData.status || "pending",
          // Ensure dates are properly handled
          createdAt: loanData.createdAt || loanData.requestedAt,
          requestedAt: loanData.requestedAt || loanData.createdAt
        };
        allLoans.push(loan);
        
        // Track active loans separately for payments
        // Only include truly active/disbursed loans (not approved)
        if (loan.status === "active" || loan.status === "disbursed") {
          activeLoans.push(loan);
        }
      }
      
      // Sort loans by date (most recent first) - in case orderBy didn't work
      allLoans.sort((a, b) => {
        const dateA = a.requestedAt?.toDate ? a.requestedAt.toDate() : 
                     a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
        const dateB = b.requestedAt?.toDate ? b.requestedAt.toDate() : 
                     b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
        return dateB - dateA;
      });

      // Load pending payments
      await loadPendingPayments();

      // Load payment history
      await loadPaymentHistory();

      updateStats();
      displayLoansByTab();
      displayPendingPayments();
      displayPaymentHistory();
    } catch (error) {
      console.error("Error loading loan data:", error);
    }
  }

  /**
   * Display loans by current tab and filter
   */
  function displayLoansByTab(filterValue = null) {
    const loansList = document.getElementById("loansList");
    const loansSectionTitle = document.getElementById("loansSectionTitle");
    if (!loansList) return;

    // Use filter dropdown value if provided, otherwise use current tab
    const activeFilter = filterValue || currentLoanTab;
    
    let filteredLoans = [];
    
    if (activeFilter === "all") {
      filteredLoans = allLoans;
    } else if (activeFilter === "pending") {
      filteredLoans = allLoans.filter(l => l.status === "pending");
    } else if (activeFilter === "approved") {
      // Only show loans with status "approved" - not disbursed or active
      filteredLoans = allLoans.filter(l => l.status === "approved");
    } else if (activeFilter === "active") {
      // Show loans that are active or disbursed (already disbursed to user)
      filteredLoans = allLoans.filter(l => l.status === "active" || l.status === "disbursed");
    } else if (activeFilter === "repaid") {
      filteredLoans = allLoans.filter(l => l.status === "repaid");
    } else {
      filteredLoans = allLoans.filter(l => l.status === activeFilter);
    }

    // Update title
    if (loansSectionTitle) {
      const titles = {
        "pending": "Pending Loan Requests",
        "approved": "Approved Loans",
        "active": "Active Loans",
        "repaid": "Repaid Loans",
        "all": "All My Loans"
      };
      loansSectionTitle.textContent = titles[activeFilter] || "My Loans";
    }

    if (filteredLoans.length === 0) {
      loansList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">💰</div>
          <p class="empty-state-text">No ${activeFilter === "all" ? "" : activeFilter} loans found</p>
        </div>
      `;
      return;
    }

    loansList.innerHTML = '';
    filteredLoans.forEach(loan => {
      const loanElement = createLoanCardElement(loan);
      loansList.appendChild(loanElement);
    });
  }

  /**
   * Create loan card element with status
   */
  function createLoanCardElement(loan) {
    const div = document.createElement("div");
    div.className = "list-item";
    
    const loanAmount = parseFloat(loan.amount || loan.loanAmount || 0);
    const totalRepayable = parseFloat(loan.totalRepayable || loanAmount);
    const interest = parseFloat(loan.totalInterest || 0);
    const amountPaid = parseFloat(loan.amountRepaid || loan.amountPaid || 0);
    const amountRemaining = Math.max(0, totalRepayable - amountPaid);
    const progress = totalRepayable > 0 ? (amountPaid / totalRepayable) * 100 : 0;
    
    const requestedDate = loan.requestedAt?.toDate ? loan.requestedAt.toDate().toLocaleDateString() : 
                         loan.createdAt?.toDate ? loan.createdAt.toDate().toLocaleDateString() : "N/A";
    const disbursedDate = loan.disbursedAt?.toDate ? loan.disbursedAt.toDate().toLocaleDateString() : null;
    const dueDate = loan.dueDate?.toDate ? loan.dueDate.toDate().toLocaleDateString() : null;

    // Status badge with improved colors
    const statusConfig = {
      "pending": { class: "warning", label: "Pending", color: "#D97706", bgColor: "rgba(217, 119, 6, 0.15)", borderColor: "#F59E0B" },
      "approved": { class: "success", label: "Approved", color: "#059669", bgColor: "rgba(5, 150, 105, 0.15)", borderColor: "#10B981" },
      "active": { class: "info", label: "Active", color: "#2563EB", bgColor: "rgba(37, 99, 235, 0.15)", borderColor: "#3B82F6" },
      "disbursed": { class: "info", label: "Active", color: "#2563EB", bgColor: "rgba(37, 99, 235, 0.15)", borderColor: "#3B82F6" },
      "repaid": { class: "success", label: "Repaid", color: "#059669", bgColor: "rgba(5, 150, 105, 0.15)", borderColor: "#10B981" }
    };
    const statusInfo = statusConfig[loan.status] || { class: "secondary", label: "Unknown", color: "#64748B", bgColor: "rgba(100, 116, 139, 0.15)", borderColor: "#94A3B8" };
    const statusClass = statusInfo.class;
    const statusLabel = statusInfo.label;

    // Show payment button only for active/disbursed loans (funds must be disbursed)
    const canPay = (loan.status === "active" || loan.status === "disbursed") && amountRemaining > 0;
    
    // Status icon indicator
    const statusIcon = loan.status === "pending" ? "⏳" :
                      loan.status === "approved" ? "✓" :
                      (loan.status === "active" || loan.status === "disbursed") ? "💰" :
                      loan.status === "repaid" ? "✅" : "📋";
    
    // Check if approved but not disbursed
    const isApprovedNotDisbursed = loan.status === "approved" && !loan.disbursedAt;
    
    div.innerHTML = `
      <div style="flex: 1;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--bn-space-2);">
          <div style="display: flex; align-items: center; gap: var(--bn-space-2);">
            <span style="font-size: 1.125rem; line-height: 1; display: inline-block; vertical-align: middle;" title="${loan.status === "pending" ? "Pending Review" : loan.status === "approved" && !loan.disbursedAt ? "Approved - Awaiting Disbursement" : loan.status === "active" || loan.status === "disbursed" ? "Active/Disbursed" : ""}">${statusIcon}</span>
            <div class="list-item-title">Loan #${loan.id.substring(0, 8).toUpperCase()}</div>
          </div>
          <span class="badge badge-${statusClass}" style="background: ${statusInfo.color}; color: #FFFFFF; font-weight: 700; font-size: 0.75rem; letter-spacing: 0.025em; padding: 6px 12px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">${statusLabel}</span>
        </div>
        <div class="list-item-subtitle">
          ${loan.purpose ? `Purpose: ${loan.purpose}` : "Loan Request"} • 
          ${loan.status === "pending" ? `Requested ${requestedDate}` : 
            loan.status === "approved" ? `Approved ${loan.approvedAt?.toDate ? loan.approvedAt.toDate().toLocaleDateString() : ""}` :
            disbursedDate ? `Disbursed ${disbursedDate}` : `Requested ${requestedDate}`}
        </div>
        ${loan.status === "active" || loan.status === "disbursed" ? `
          <div style="margin-top: 16px; padding: var(--bn-space-4); background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(37, 99, 235, 0.05) 100%); border-radius: var(--bn-radius-lg); border: 1px solid rgba(59, 130, 246, 0.2);">
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--bn-space-3); margin-bottom: var(--bn-space-4);">
              <div style="background: var(--bn-white); padding: var(--bn-space-3); border-radius: var(--bn-radius-md); box-shadow: var(--bn-shadow-sm);">
                <div style="font-size: 0.75rem; color: var(--bn-gray); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; font-weight: 600;">Loan Amount</div>
                <div style="font-size: 1.125rem; font-weight: 700; color: var(--bn-dark);">${formatCurrency(loanAmount)}</div>
              </div>
              <div style="background: var(--bn-white); padding: var(--bn-space-3); border-radius: var(--bn-radius-md); box-shadow: var(--bn-shadow-sm);">
                <div style="font-size: 0.75rem; color: var(--bn-gray); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; font-weight: 600;">Amount Paid</div>
                <div style="font-size: 1.125rem; font-weight: 700; color: var(--bn-success);">${formatCurrency(amountPaid)}</div>
              </div>
            </div>
            ${interest > 0 ? `
              <div style="display: flex; justify-content: space-between; padding: var(--bn-space-2) var(--bn-space-3); background: rgba(59, 130, 246, 0.05); border-radius: var(--bn-radius-md); margin-bottom: var(--bn-space-3); font-size: 0.875rem;">
                <span style="color: var(--bn-gray-700);">Interest:</span>
                <strong style="color: var(--bn-dark);">${formatCurrency(interest)}</strong>
                <span style="color: var(--bn-gray-700);">Total Repayable:</span>
                <strong style="color: var(--bn-dark);">${formatCurrency(totalRepayable)}</strong>
              </div>
            ` : ''}
            <div style="margin-bottom: var(--bn-space-3);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--bn-space-2);">
                <span style="font-size: 0.875rem; font-weight: 600; color: var(--bn-dark);">Payment Progress</span>
                <span style="font-size: 0.875rem; font-weight: 700; color: var(--bn-primary);">${progress.toFixed(1)}%</span>
              </div>
              <div style="background: var(--bn-gray-200); border-radius: var(--bn-radius-full); height: 10px; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);">
                <div style="background: linear-gradient(90deg, var(--bn-primary) 0%, var(--bn-accent) 100%); height: 100%; width: ${Math.min(100, progress)}%; transition: width 0.5s ease; border-radius: var(--bn-radius-full); box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);"></div>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--bn-space-3); padding-top: var(--bn-space-3); border-top: 1px solid rgba(59, 130, 246, 0.15);">
              <div>
                <div style="font-size: 0.75rem; color: var(--bn-gray); margin-bottom: 4px;">Remaining Balance</div>
                <div style="font-size: 1rem; font-weight: 700; color: var(--bn-warning);">${formatCurrency(amountRemaining)}</div>
              </div>
              ${dueDate ? `
                <div style="text-align: right;">
                  <div style="font-size: 0.75rem; color: var(--bn-gray); margin-bottom: 4px;">Due Date</div>
                  <div style="font-size: 1rem; font-weight: 700; color: var(--bn-dark);">${dueDate}</div>
                </div>
              ` : `
                <div style="text-align: right;">
                  <div style="font-size: 0.75rem; color: var(--bn-gray); margin-bottom: 4px;">Status</div>
                  <div style="font-size: 1rem; font-weight: 700; color: var(--bn-success);">✓ Active</div>
                </div>
              `}
            </div>
          </div>
        ` : loan.status === "approved" ? `
          <div style="margin-top: 14px; padding: var(--bn-space-4); background: linear-gradient(135deg, rgba(5, 150, 105, 0.12) 0%, rgba(16, 185, 129, 0.08) 100%); border-radius: var(--bn-radius-lg); border: 2px solid #10B981; box-shadow: 0 2px 8px rgba(5, 150, 105, 0.15);">
            <div style="display: flex; align-items: center; gap: var(--bn-space-2); margin-bottom: var(--bn-space-2);">
              <span style="font-size: 1.25rem;">✓</span>
              <div style="font-size: 0.9375rem; font-weight: 700; color: #047857; letter-spacing: 0.01em;">
                Approved - Waiting for Disbursement
              </div>
            </div>
            <div style="font-size: 0.8125rem; color: #065F46; line-height: 1.5; margin-bottom: var(--bn-space-3);">
              Your loan has been approved and will be activated soon.
            </div>
            <div style="padding-top: var(--bn-space-3); border-top: 1px solid rgba(16, 185, 129, 0.3); display: flex; gap: var(--bn-space-4); flex-wrap: wrap;">
              <div>
                <div style="font-size: 0.6875rem; color: #059669; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; font-weight: 600;">Loan Amount</div>
                <div style="font-size: 1rem; font-weight: 800; color: #0A1628;">${formatCurrency(loanAmount)}</div>
              </div>
              ${interest > 0 ? `
                <div>
                  <div style="font-size: 0.6875rem; color: #059669; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; font-weight: 600;">Interest</div>
                  <div style="font-size: 1rem; font-weight: 800; color: #0A1628;">${formatCurrency(interest)}</div>
                </div>
              ` : ''}
            </div>
          </div>
        ` : loan.status === "pending" ? `
          <div style="margin-top: 14px; padding: var(--bn-space-4); background: linear-gradient(135deg, rgba(217, 119, 6, 0.12) 0%, rgba(245, 158, 11, 0.08) 100%); border-radius: var(--bn-radius-lg); border: 2px solid #F59E0B; box-shadow: 0 2px 8px rgba(217, 119, 6, 0.15);">
            <div style="display: flex; align-items: center; gap: var(--bn-space-2); margin-bottom: var(--bn-space-2);">
              <span style="font-size: 1.25rem;">⏳</span>
              <div style="font-size: 0.9375rem; font-weight: 700; color: #B45309; letter-spacing: 0.01em;">
                Pending Review
              </div>
            </div>
            <div style="font-size: 0.8125rem; color: #92400E; line-height: 1.5; margin-bottom: var(--bn-space-3);">
              Your loan request is being reviewed by the admin team.
            </div>
            <div style="padding-top: var(--bn-space-3); border-top: 1px solid rgba(245, 158, 11, 0.3);">
              <div>
                <div style="font-size: 0.6875rem; color: #D97706; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; font-weight: 600;">Requested Amount</div>
                <div style="font-size: 1rem; font-weight: 800; color: #0A1628;">${formatCurrency(loanAmount)}</div>
              </div>
              ${loan.purpose ? `
                <div style="margin-top: var(--bn-space-2);">
                  <div style="font-size: 0.6875rem; color: #D97706; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; font-weight: 600;">Purpose</div>
                  <div style="font-size: 0.875rem; font-weight: 600; color: #92400E;">${loan.purpose}</div>
                </div>
              ` : ''}
            </div>
          </div>
        ` : loan.status === "repaid" ? `
          <div style="margin-top: 14px; padding: var(--bn-space-4); background: linear-gradient(135deg, rgba(5, 150, 105, 0.12) 0%, rgba(16, 185, 129, 0.08) 100%); border-radius: var(--bn-radius-lg); border: 2px solid #10B981; box-shadow: 0 2px 8px rgba(5, 150, 105, 0.15);">
            <div style="display: flex; align-items: center; gap: var(--bn-space-2); margin-bottom: var(--bn-space-2);">
              <span style="font-size: 1.25rem;">✅</span>
              <div style="font-size: 0.9375rem; font-weight: 700; color: #047857; letter-spacing: 0.01em;">
                Fully Repaid
              </div>
            </div>
            <div style="font-size: 0.8125rem; color: #065F46; line-height: 1.5; margin-bottom: var(--bn-space-3);">
              This loan has been completely paid off.
            </div>
            <div style="padding-top: var(--bn-space-3); border-top: 1px solid rgba(16, 185, 129, 0.3); display: flex; gap: var(--bn-space-4); flex-wrap: wrap;">
              <div>
                <div style="font-size: 0.6875rem; color: #059669; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; font-weight: 600;">Total Repaid</div>
                <div style="font-size: 1rem; font-weight: 800; color: #0A1628;">${formatCurrency(totalRepayable)}</div>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
      ${canPay ? `
        <div>
          <button class="btn btn-primary btn-sm" data-action="pay" data-loan-id="${loan.id}">Make Payment</button>
        </div>
      ` : ''}
    `;

    if (canPay) {
      const payBtn = div.querySelector('[data-action="pay"]');
      if (payBtn) {
        payBtn.addEventListener("click", () => openPaymentModal(loan));
      }
    }

    return div;
  }

  /**
   * Load pending payments
   */
  async function loadPendingPayments() {
    pendingPayments = [];
    
    for (const loan of activeLoans) {
      const paymentsRef = collection(db, `groups/${currentGroupId}/loans/${loan.id}/payments`);
      const q = query(
        paymentsRef,
        where("status", "==", "pending"),
        orderBy("submittedAt", "desc")
      );
      const paymentsSnapshot = await getDocs(q);

      paymentsSnapshot.forEach(paymentDoc => {
        pendingPayments.push({
          ...paymentDoc.data(),
          id: paymentDoc.id,
          loanId: loan.id,
          loanAmount: loan.loanAmount
        });
      });
    }
  }

  /**
   * Load payment history
   */
  async function loadPaymentHistory() {
    paymentHistory = [];
    
    for (const loan of activeLoans) {
      const paymentsRef = collection(db, `groups/${currentGroupId}/loans/${loan.id}/payments`);
      const q = query(
        paymentsRef,
        where("status", "==", "approved"),
        orderBy("approvedAt", "desc")
      );
      const paymentsSnapshot = await getDocs(q);

      paymentsSnapshot.forEach(paymentDoc => {
        paymentHistory.push({
          ...paymentDoc.data(),
          id: paymentDoc.id,
          loanId: loan.id,
          loanAmount: loan.loanAmount
        });
      });
    }

    // Sort by date (most recent first)
    paymentHistory.sort((a, b) => {
      const dateA = a.approvedAt?.toDate ? a.approvedAt.toDate() : new Date(0);
      const dateB = b.approvedAt?.toDate ? b.approvedAt.toDate() : new Date(0);
      return dateB - dateA;
    });
  }

  /**
   * Update statistics
   */
  function updateStats() {
    const activeLoansCount = document.getElementById("activeLoansCount");
    const totalOutstandingEl = document.getElementById("totalOutstanding");
    const totalPaidEl = document.getElementById("totalPaid");
    const pendingPaymentsCountEl = document.getElementById("pendingPaymentsCount");

    let totalOutstanding = 0;
    let totalPaid = 0;

    activeLoans.forEach(loan => {
      totalOutstanding += parseFloat(loan.amountRemaining || 0);
      totalPaid += parseFloat(loan.amountPaid || 0);
    });

    if (activeLoansCount) activeLoansCount.textContent = activeLoans.length;
    if (totalOutstandingEl) totalOutstandingEl.textContent = formatCurrency(totalOutstanding);
    if (totalPaidEl) totalPaidEl.textContent = formatCurrency(totalPaid);
    if (pendingPaymentsCountEl) pendingPaymentsCountEl.textContent = pendingPayments.length;

    // Show/hide make payment button
    if (makePaymentBtn) {
      makePaymentBtn.style.display = activeLoans.length > 0 ? "block" : "none";
    }
  }


  /**
   * Display pending payments
   */
  function displayPendingPayments() {
    const pendingPaymentsList = document.getElementById("pendingPaymentsList");
    if (!pendingPaymentsList) return;

    if (pendingPayments.length === 0) {
      pendingPaymentsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><p class="empty-state-text">No pending payments</p></div>';
      return;
    }

    pendingPaymentsList.innerHTML = '';
    pendingPayments.forEach(payment => {
      const paymentElement = createPendingPaymentElement(payment);
      pendingPaymentsList.appendChild(paymentElement);
    });
  }

  /**
   * Create pending payment element
   */
  function createPendingPaymentElement(payment) {
    const div = document.createElement("div");
    div.className = "list-item";
    
    const submittedDate = payment.submittedAt?.toDate ? payment.submittedAt.toDate().toLocaleDateString() : "N/A";
    const amount = parseFloat(payment.amount || 0);

    div.innerHTML = `
      <div style="flex: 1;">
        <div class="list-item-title">Payment of ${formatCurrency(amount)}</div>
        <div class="list-item-subtitle">Loan #${payment.loanId.substring(0, 8)} • Submitted ${submittedDate}</div>
        ${payment.notes ? `<div style="margin-top: 4px; font-size: 0.875rem; color: rgba(255, 255, 255, 0.7);">📝 ${payment.notes}</div>` : ''}
      </div>
      <div>
        <span class="badge badge-warning">Pending Approval</span>
        ${payment.proofUrl ? `<a href="${payment.proofUrl}" target="_blank" class="btn btn-ghost btn-sm" style="margin-top: 8px;">View Proof</a>` : ''}
      </div>
    `;

    return div;
  }

  /**
   * Display payment history
   */
  function displayPaymentHistory() {
    const paymentHistoryList = document.getElementById("paymentHistoryList");
    if (!paymentHistoryList) return;

    if (paymentHistory.length === 0) {
      paymentHistoryList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">No payment history</p></div>';
      return;
    }

    // Show only last 10
    const recentHistory = paymentHistory.slice(0, 10);

    paymentHistoryList.innerHTML = '';
    recentHistory.forEach(payment => {
      const paymentElement = createHistoryPaymentElement(payment);
      paymentHistoryList.appendChild(paymentElement);
    });
  }

  /**
   * Create history payment element
   */
  function createHistoryPaymentElement(payment) {
    const div = document.createElement("div");
    div.className = "list-item";
    
    const approvedDate = payment.approvedAt?.toDate ? payment.approvedAt.toDate().toLocaleDateString() : "N/A";
    const paymentDate = payment.paymentDate?.toDate ? payment.paymentDate.toDate().toLocaleDateString() : "N/A";
    const amount = parseFloat(payment.amount || 0);
    const penalty = parseFloat(payment.penaltyAmount || 0);

    div.innerHTML = `
      <div style="flex: 1;">
        <div class="list-item-title">${formatCurrency(amount)}${penalty > 0 ? ` <span style="color: var(--bn-danger);">(+ ${formatCurrency(penalty)} penalty)</span>` : ''}</div>
        <div class="list-item-subtitle">Loan #${payment.loanId.substring(0, 8)} • Paid ${paymentDate} • Approved ${approvedDate}</div>
        ${payment.notes ? `<div style="margin-top: 4px; font-size: 0.875rem; color: rgba(255, 255, 255, 0.7);">📝 ${payment.notes}</div>` : ''}
        ${payment.adminNotes ? `<div style="margin-top: 4px; font-size: 0.875rem; color: rgba(255, 255, 255, 0.6);">💬 Admin: ${payment.adminNotes}</div>` : ''}
      </div>
      <div>
        <span class="badge badge-success">Approved</span>
        ${payment.proofUrl ? `<a href="${payment.proofUrl}" target="_blank" class="btn btn-ghost btn-sm" style="margin-top: 8px;">View Proof</a>` : ''}
      </div>
    `;

    return div;
  }

  /**
   * Open payment modal
   */
  function openPaymentModal(loan) {
    const paymentLoanId = document.getElementById("paymentLoanId");
    const loanReference = document.getElementById("loanReference");
    const outstandingBalance = document.getElementById("outstandingBalance");
    const paymentAmount = document.getElementById("paymentAmount");

    if (paymentLoanId) paymentLoanId.value = loan.id;
    if (loanReference) loanReference.value = `LOAN-${loan.id.substring(0, 8).toUpperCase()}`;
    
    const loanAmount = parseFloat(loan.amount || loan.loanAmount || 0);
    const totalRepayable = parseFloat(loan.totalRepayable || loanAmount);
    const amountPaid = parseFloat(loan.amountRepaid || loan.amountPaid || 0);
    const remaining = Math.max(0, totalRepayable - amountPaid);
    
    if (outstandingBalance) outstandingBalance.value = formatCurrency(remaining);
    if (paymentAmount) {
      paymentAmount.max = remaining;
      paymentAmount.placeholder = `Max: ${formatCurrency(remaining)}`;
    }

    openModal(paymentModal);
  }

  /**
   * Handle payment submit
   */
  async function handlePaymentSubmit(e) {
    e.preventDefault();

    const loanId = document.getElementById("paymentLoanId").value;
    const amount = parseFloat(document.getElementById("paymentAmount").value);
    const paymentDate = document.getElementById("paymentDate").value;
    const proofFile = document.getElementById("paymentProof").files[0];
    const notes = document.getElementById("paymentNotes").value.trim();

    if (!loanId || !amount || !paymentDate || !proofFile) {
      alert("Please fill in all required fields.");
      return;
    }

    // Validate amount - find loan in allLoans
    const loan = allLoans.find(l => l.id === loanId);
    if (!loan) {
      alert("Loan not found.");
      return;
    }
    
    // Check if loan is active or disbursed (funds must be disbursed)
    if (!["active", "disbursed"].includes(loan.status)) {
      alert("Payments can only be made after the loan has been disbursed and is active.");
      return;
    }

    const loanAmount = parseFloat(loan.amount || loan.loanAmount || 0);
    const totalRepayable = parseFloat(loan.totalRepayable || loanAmount);
    const amountPaid = parseFloat(loan.amountRepaid || loan.amountPaid || 0);
    const remaining = Math.max(0, totalRepayable - amountPaid);
    
    if (amount > remaining) {
      alert(`Payment amount cannot exceed outstanding balance of ${formatCurrency(remaining)}.`);
      return;
    }

    try {
      // Upload proof
      const storageRef = ref(storage, `loan-payments/${currentUser.uid}/${loanId}/${Date.now()}_${proofFile.name}`);
      await uploadBytes(storageRef, proofFile);
      const proofUrl = await getDownloadURL(storageRef);

      // Create payment document
      const paymentData = {
        loanId: loanId,
        borrowerId: currentUser.uid,
        amount: amount,
        paymentDate: Timestamp.fromDate(new Date(paymentDate)),
        proofUrl: proofUrl,
        notes: notes || "",
        status: "pending",
        submittedAt: Timestamp.now(),
        approvedAt: null,
        approvedBy: null,
        penaltyAmount: 0,
        adminNotes: "",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      const paymentsRef = collection(db, `groups/${currentGroupId}/loans/${loanId}/payments`);
      await addDoc(paymentsRef, paymentData);

      alert("Payment submitted successfully! It will be reviewed by an admin.");
      closeModal(paymentModal);
      loanPaymentForm.reset();
      document.getElementById("paymentDate").value = new Date().toISOString().split("T")[0];
      
      await loadLoanData();
    } catch (error) {
      console.error("Error submitting payment:", error);
      alert("Error submitting payment. Please try again.");
    }
  }

  /**
   * Clear display
   */
  function clearDisplay() {
    const loansList = document.getElementById("loansList");
    const pendingPaymentsList = document.getElementById("pendingPaymentsList");
    const paymentHistoryList = document.getElementById("paymentHistoryList");

    if (loansList) loansList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💰</div><p class="empty-state-text">Select a group to view loans</p></div>';
    if (pendingPaymentsList) pendingPaymentsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><p class="empty-state-text">Select a group to view payments</p></div>';
    if (paymentHistoryList) paymentHistoryList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">Select a group to view history</p></div>';
    
    updateStats();
  }

  /**
   * Format currency
   */
  function formatCurrency(amount) {
    return `MWK ${parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Modal functions
   */
  function openModal(modal) {
    if (modal) {
      modal.classList.remove("hidden");
      modal.classList.add("active");
    }
  }

  function closeModal(modal) {
    if (modal) {
      modal.classList.remove("active");
      modal.classList.add("hidden");
    }
  }
});
