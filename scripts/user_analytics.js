/**
 * User Analytics - Contributions, loans, and booking system
 */

import {
  db,
  auth,
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
} from "./firebaseConfig.js";

let currentUser = null;
let userGroups = [];
let currentGroupId = null;

document.addEventListener("DOMContentLoaded", () => {
  const groupSelector = document.getElementById("groupSelector");
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");
  const bookLoanBtn = document.getElementById("bookLoanBtn");
  const bookLoanModal = document.getElementById("bookLoanModal");
  const closeBookLoanModal = document.getElementById("closeBookLoanModal");
  const bookLoanForm = document.getElementById("bookLoanForm");

  // Auth state
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    currentUser = user;
    await loadUserGroups();
  });

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      
      // Update buttons
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      // Update content
      tabContents.forEach(content => {
        content.classList.remove("active");
        content.style.display = "none";
      });
      
      const activeTab = document.getElementById(`${tab}Tab`);
      if (activeTab) {
        activeTab.classList.add("active");
        activeTab.style.display = "block";
      }

      // Load data for active tab
      if (currentGroupId) {
        if (tab === "contributions") {
          loadContributions();
        } else if (tab === "loans") {
          loadLoans();
        } else if (tab === "bookings") {
          loadBookings();
        }
      }
    });
  });

  // Group selector
  if (groupSelector) {
    groupSelector.addEventListener("change", async (e) => {
      currentGroupId = e.target.value;
      if (currentGroupId) {
        const activeTab = document.querySelector(".tab-btn.active");
        if (activeTab) {
          const tab = activeTab.dataset.tab;
          if (tab === "contributions") {
            await loadContributions();
          } else if (tab === "loans") {
            await loadLoans();
          } else if (tab === "bookings") {
            await loadBookings();
          }
        }
      }
    });
  }

  // Book loan button
  if (bookLoanBtn) {
    bookLoanBtn.addEventListener("click", () => {
      if (!currentGroupId) {
        alert("Please select a group first.");
        return;
      }
      openModal(bookLoanModal);
    });
  }

  // Close modal
  if (closeBookLoanModal) {
    closeBookLoanModal.addEventListener("click", () => closeModal(bookLoanModal));
  }

  // Book loan form
  if (bookLoanForm) {
    bookLoanForm.addEventListener("submit", handleBookLoan);
  }

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
          await loadContributions();
        }
      }
    } catch (error) {
      console.error("Error loading groups:", error);
    }
  }

  /**
   * Load contributions data
   */
  async function loadContributions() {
    if (!currentGroupId) return;

    try {
      const currentYear = new Date().getFullYear();
      const groupDoc = await getDoc(doc(db, "groups", currentGroupId));
      const groupData = groupDoc.data();
      
      const monthlyAmount = parseFloat(groupData?.rules?.monthlyContribution?.amount || 0);
      const seedMoneyAmount = parseFloat(groupData?.rules?.seedMoney?.amount || 0);

      // Get user's payments
      let userMonthlyTotal = 0;
      let userYearlyTotal = 0;
      let groupMonthlyTotal = 0;
      let groupYearlyTotal = 0;
      const monthlyBreakdown = [];
      const contributionHistory = [];

      // Get all members to calculate group totals
      const membersSnapshot = await getDocs(collection(db, `groups/${currentGroupId}/members`));
      
      // Calculate monthly contributions
      for (let month = 1; month <= 12; month++) {
        const monthName = new Date(currentYear, month - 1).toLocaleString("default", { month: "long" });
        let userMonthPaid = 0;
        let groupMonthPaid = 0;

        // User's monthly contribution
        const userMonthlyRef = doc(db, `groups/${currentGroupId}/payments/${currentYear}_MonthlyContributions/${currentUser.uid}/${currentYear}_${monthName}`);
        const userMonthlyDoc = await getDoc(userMonthlyRef);
        if (userMonthlyDoc.exists()) {
          const monthlyData = userMonthlyDoc.data();
          const totalPaid = monthlyData.paid?.reduce((sum, p) => {
            if (p.approvalStatus === "approved") {
              return sum + parseFloat(p.amount || 0);
            }
            return sum;
          }, 0) || 0;
          userMonthPaid = totalPaid;
          groupMonthPaid += totalPaid;
        }

        // Group totals
        membersSnapshot.forEach(memberDoc => {
          const memberId = memberDoc.id;
          if (memberId !== currentUser.uid) {
            // This would need async iteration, but for now we'll calculate it differently
          }
        });

        monthlyBreakdown.push({
          month: monthName,
          expected: monthlyAmount,
          userPaid: userMonthPaid,
          groupPaid: groupMonthPaid
        });

        userYearlyTotal += userMonthPaid;
        groupYearlyTotal += groupMonthPaid;
      }

      // Get seed money
      const userSeedMoneyRef = doc(db, `groups/${currentGroupId}/payments/${currentYear}_SeedMoney/${currentUser.uid}/PaymentDetails`);
      const userSeedMoneyDoc = await getDoc(userSeedMoneyRef);
      if (userSeedMoneyDoc.exists()) {
        const seedMoneyData = userSeedMoneyDoc.data();
        const seedPaid = parseFloat(seedMoneyData.amountPaid || 0);
        userYearlyTotal += seedPaid;
      }

      // Update UI
      document.getElementById("monthlyContribution").textContent = formatCurrency(monthlyAmount);
      document.getElementById("yearlyTotal").textContent = formatCurrency(userYearlyTotal);
      document.getElementById("yourContributions").textContent = formatCurrency(userYearlyTotal);
      document.getElementById("groupTotal").textContent = formatCurrency(groupYearlyTotal);

      displayMonthlyBreakdown(monthlyBreakdown);
      displayContributionHistory(contributionHistory);
    } catch (error) {
      console.error("Error loading contributions:", error);
    }
  }

  /**
   * Display monthly breakdown
   */
  function displayMonthlyBreakdown(breakdown) {
    const container = document.getElementById("monthlyBreakdown");
    if (!container) return;

    if (breakdown.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><p class="empty-state-text">No breakdown available</p></div>';
      return;
    }

    container.innerHTML = '';
    breakdown.forEach(month => {
      const div = document.createElement("div");
      div.className = "list-item";
      const paidPercent = month.expected > 0 ? (month.userPaid / month.expected) * 100 : 0;
      
      div.innerHTML = `
        <div style="flex: 1;">
          <div class="list-item-title">${month.month}</div>
          <div style="margin-top: 8px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.875rem;">
              <span>Expected: <strong>${formatCurrency(month.expected)}</strong></span>
              <span>Paid: <strong>${formatCurrency(month.userPaid)}</strong></span>
            </div>
            <div style="background: rgba(255, 255, 255, 0.1); border-radius: 4px; height: 8px; overflow: hidden;">
              <div style="background: ${paidPercent >= 100 ? 'var(--bn-success)' : 'var(--bn-primary)'}; height: 100%; width: ${Math.min(100, paidPercent)}%; transition: width 0.3s;"></div>
            </div>
            <div style="margin-top: 4px; font-size: 0.75rem; color: rgba(255, 255, 255, 0.7);">
              ${paidPercent.toFixed(1)}% complete
            </div>
          </div>
        </div>
      `;
      container.appendChild(div);
    });
  }

  /**
   * Display contribution history
   */
  function displayContributionHistory(history) {
    const container = document.getElementById("contributionHistory");
    if (!container) return;

    // This would be populated with actual payment history
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">No contribution history</p></div>';
  }

  /**
   * Load loans data
   */
  async function loadLoans() {
    if (!currentGroupId) return;

    try {
      // Get user's loans
      const loansRef = collection(db, `groups/${currentGroupId}/loans`);
      const q = query(
        loansRef,
        where("borrowerId", "==", currentUser.uid),
        orderBy("requestedAt", "desc")
      );
      const loansSnapshot = await getDocs(q);

      const userLoans = [];
      let totalOutstanding = 0;
      let totalPaid = 0;

      loansSnapshot.forEach(loanDoc => {
        const loan = { id: loanDoc.id, ...loanDoc.data() };
        userLoans.push(loan);
        totalOutstanding += parseFloat(loan.amountRemaining || 0);
        totalPaid += parseFloat(loan.amountPaid || 0);
      });

      // Get all disbursed loans
      const allLoansQ = query(
        loansRef,
        where("status", "in", ["approved", "disbursed", "active"]),
        orderBy("disbursedAt", "desc")
      );
      const allLoansSnapshot = await getDocs(allLoansQ);
      const disbursedLoans = [];
      let nextDisbursement = 0;

      allLoansSnapshot.forEach(loanDoc => {
        const loan = { id: loanDoc.id, ...loanDoc.data() };
        disbursedLoans.push(loan);
        nextDisbursement += parseFloat(loan.loanAmount || 0);
      });

      // Update stats
      document.getElementById("activeLoansCount").textContent = userLoans.filter(l => l.status === "active" || l.status === "approved").length;
      document.getElementById("outstandingLoans").textContent = formatCurrency(totalOutstanding);
      document.getElementById("totalLoansPaid").textContent = formatCurrency(totalPaid);
      document.getElementById("nextDisbursement").textContent = formatCurrency(nextDisbursement);

      displayDisbursedLoans(disbursedLoans);
      displayYourLoans(userLoans);
    } catch (error) {
      console.error("Error loading loans:", error);
    }
  }

  /**
   * Display disbursed loans
   */
  function displayDisbursedLoans(loans) {
    const container = document.getElementById("disbursedLoans");
    if (!container) return;

    if (loans.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💰</div><p class="empty-state-text">No loans being disbursed</p></div>';
      return;
    }

    container.innerHTML = '';
    loans.slice(0, 10).forEach(loan => {
      const div = document.createElement("div");
      div.className = "list-item";
      const disbursedDate = loan.disbursedAt?.toDate ? loan.disbursedAt.toDate().toLocaleDateString() : "N/A";
      
      div.innerHTML = `
        <div style="flex: 1;">
          <div class="list-item-title">${loan.borrowerName || "Unknown"}</div>
          <div class="list-item-subtitle">Disbursed ${disbursedDate}</div>
          <div style="margin-top: 8px; font-size: 1.125rem; font-weight: 700; color: var(--bn-primary);">
            ${formatCurrency(loan.loanAmount || 0)}
          </div>
        </div>
      `;
      container.appendChild(div);
    });
  }

  /**
   * Display user's loans
   */
  function displayYourLoans(loans) {
    const container = document.getElementById("yourLoans");
    if (!container) return;

    if (loans.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">No loans found</p></div>';
      return;
    }

    container.innerHTML = '';
    loans.forEach(loan => {
      const div = document.createElement("div");
      div.className = "list-item";
      const requestedDate = loan.requestedAt?.toDate ? loan.requestedAt.toDate().toLocaleDateString() : "N/A";
      const progress = loan.totalRepayable > 0 ? (loan.amountPaid / loan.totalRepayable) * 100 : 0;
      
      div.innerHTML = `
        <div style="flex: 1;">
          <div class="list-item-title">Loan #${loan.id.substring(0, 8)}</div>
          <div class="list-item-subtitle">${loan.purpose || "Not specified"} • Requested ${requestedDate}</div>
          <div style="margin-top: 12px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.875rem;">
              <span>Amount: <strong>${formatCurrency(loan.loanAmount || 0)}</strong></span>
              <span>Paid: <strong>${formatCurrency(loan.amountPaid || 0)}</strong></span>
            </div>
            <div style="background: rgba(255, 255, 255, 0.1); border-radius: 4px; height: 8px; overflow: hidden;">
              <div style="background: var(--bn-primary); height: 100%; width: ${Math.min(100, progress)}%;"></div>
            </div>
            <div style="margin-top: 4px; font-size: 0.75rem; color: rgba(255, 255, 255, 0.7);">
              ${progress.toFixed(1)}% complete • Remaining: ${formatCurrency(loan.amountRemaining || 0)}
            </div>
          </div>
        </div>
        <div>
          <span class="badge badge-${loan.status === "active" ? "success" : "warning"}">${loan.status}</span>
        </div>
      `;
      container.appendChild(div);
    });
  }

  /**
   * Load bookings
   */
  async function loadBookings() {
    if (!currentGroupId) return;

    try {
      // Get user's bookings
      const bookingsRef = collection(db, `groups/${currentGroupId}/loanBookings`);
      const userBookingsQ = query(
        bookingsRef,
        where("memberId", "==", currentUser.uid),
        orderBy("createdAt", "desc")
      );
      const userBookingsSnapshot = await getDocs(userBookingsQ);

      const userBookings = [];
      userBookingsSnapshot.forEach(bookingDoc => {
        userBookings.push({ id: bookingDoc.id, ...bookingDoc.data() });
      });

      // Get all bookings (queue)
      const allBookingsQ = query(
        bookingsRef,
        orderBy("createdAt", "asc")
      );
      const allBookingsSnapshot = await getDocs(allBookingsQ);
      const allBookings = [];

      for (const bookingDoc of allBookingsSnapshot.docs) {
        const booking = { id: bookingDoc.id, ...bookingDoc.data() };
        // Get member name
        const memberDoc = await getDoc(doc(db, `groups/${currentGroupId}/members`, booking.memberId));
        if (memberDoc.exists()) {
          booking.memberName = memberDoc.data().fullName || "Unknown";
        }
        allBookings.push(booking);
      }

      displayYourBookings(userBookings);
      displayBookingQueue(allBookings);
    } catch (error) {
      console.error("Error loading bookings:", error);
    }
  }

  /**
   * Display user's bookings
   */
  function displayYourBookings(bookings) {
    const container = document.getElementById("yourBookings");
    if (!container) return;

    if (bookings.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div><p class="empty-state-text">No bookings found</p></div>';
      return;
    }

    container.innerHTML = '';
    bookings.forEach(booking => {
      const div = document.createElement("div");
      div.className = "list-item";
      const createdDate = booking.createdAt?.toDate ? booking.createdAt.toDate().toLocaleDateString() : "N/A";
      
      div.innerHTML = `
        <div style="flex: 1;">
          <div class="list-item-title">${booking.preferredAmount ? formatCurrency(booking.preferredAmount) : "Any Amount"}</div>
          <div class="list-item-subtitle">${booking.purpose || "Not specified"} • Booked ${createdDate}</div>
          ${booking.description ? `<div style="margin-top: 4px; font-size: 0.875rem; color: rgba(255, 255, 255, 0.7);">${booking.description}</div>` : ''}
        </div>
        <div>
          <span class="badge badge-${booking.status === "pending" ? "warning" : booking.status === "approved" ? "success" : "secondary"}">${booking.status || "pending"}</span>
        </div>
      `;
      container.appendChild(div);
    });
  }

  /**
   * Display booking queue
   */
  function displayBookingQueue(bookings) {
    const container = document.getElementById("bookingQueue");
    if (!container) return;

    if (bookings.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><p class="empty-state-text">No bookings in queue</p></div>';
      return;
    }

    container.innerHTML = '';
    bookings.forEach((booking, index) => {
      const div = document.createElement("div");
      div.className = "list-item";
      const createdDate = booking.createdAt?.toDate ? booking.createdAt.toDate().toLocaleDateString() : "N/A";
      const isCurrentUser = booking.memberId === currentUser.uid;
      
      div.innerHTML = `
        <div style="flex: 1;">
          <div class="list-item-title">
            ${index + 1}. ${booking.memberName || "Unknown"}${isCurrentUser ? " (You)" : ""}
          </div>
          <div class="list-item-subtitle">${booking.preferredAmount ? formatCurrency(booking.preferredAmount) : "Any Amount"} • ${booking.purpose || "Not specified"} • Booked ${createdDate}</div>
        </div>
        <div>
          <span class="badge badge-${booking.status === "pending" ? "warning" : booking.status === "approved" ? "success" : "secondary"}">${booking.status || "pending"}</span>
        </div>
      `;
      container.appendChild(div);
    });
  }

  /**
   * Handle book loan
   */
  async function handleBookLoan(e) {
    e.preventDefault();

    const preferredAmount = parseFloat(document.getElementById("preferredAmount").value);
    const purpose = document.getElementById("loanPurpose").value;
    const description = document.getElementById("loanDescription").value.trim();
    const preferredCycle = document.getElementById("preferredCycle").value;

    if (!purpose) {
      alert("Please select a loan purpose.");
      return;
    }

    try {
      const bookingData = {
        memberId: currentUser.uid,
        memberEmail: currentUser.email,
        preferredAmount: preferredAmount || null,
        purpose: purpose,
        description: description || "",
        preferredCycle: preferredCycle || null,
        status: "pending",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      const bookingsRef = collection(db, `groups/${currentGroupId}/loanBookings`);
      await addDoc(bookingsRef, bookingData);

      alert("Loan booking submitted successfully! You'll be notified when loans are available.");
      closeModal(bookLoanModal);
      bookLoanForm.reset();
      
      await loadBookings();
    } catch (error) {
      console.error("Error booking loan:", error);
      alert("Error submitting booking. Please try again.");
    }
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
