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
  orderBy,
  onAuthStateChanged,
  Timestamp,
} from "./firebaseConfig.js";

// Use global modal utilities if available, otherwise define fallbacks
const openModal = window.openModal || ((id) => {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
});

const closeModal = window.closeModal || ((id) => {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const backButton = document.querySelector(".page-back-btn");
  const groupSelector = document.getElementById("groupSelector");
  const editModal = document.getElementById("editModal");
  const closeModalBtn = document.getElementById("closeModal");
  const cancelModalBtn = document.getElementById("cancelModalBtn");
  const saveModalBtn = document.getElementById("saveModalBtn");
  const modalForm = document.getElementById("modalForm");
  const modalTitle = document.getElementById("modalTitle");
  const editRatesBtn = document.getElementById("editRatesBtn");
  const pendingPenaltiesList = document.getElementById("pendingPenaltiesList");
  const collectedInterestList = document.getElementById("collectedInterestList");

  let currentGroupId = null;
  let currentEditTarget = null;

  // Navigate back - only if button exists
  if (backButton) {
    backButton.addEventListener("click", () => {
      window.location.href = "admin_dashboard.html";
    });
  }

  // Close modal handlers
  const closeEditModal = () => {
    if (window.closeModal) {
      window.closeModal('editModal');
    } else {
      const modal = document.getElementById('editModal');
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('active');
        document.body.style.overflow = '';
      }
    }
  };

  if (closeModalBtn) {
    closeModalBtn.addEventListener("click", closeEditModal);
  }

  if (cancelModalBtn) {
    cancelModalBtn.addEventListener("click", closeEditModal);
  }

  if (editModal) {
    editModal.addEventListener("click", (event) => {
      if (event.target === editModal) {
        closeEditModal();
      }
    });
  }

  // Edit Rates button
  if (editRatesBtn) {
    editRatesBtn.addEventListener("click", () => {
      if (!currentGroupId) {
        alert("Please select a group first");
        return;
      }
      openEditRatesModal();
    });
  }

  // Save button
  if (saveModalBtn) {
    saveModalBtn.addEventListener("click", async () => {
      await saveRateChanges();
    });
  }

  // Load admin groups
  async function loadAdminGroups(user) {
    if (!groupSelector) return;
    
    try {
      const groupsSnapshot = await getDocs(collection(db, "groups"));
      groupSelector.innerHTML = '<option value="">Select a group...</option>';

      groupsSnapshot.forEach((doc) => {
        const groupData = doc.data();
        const isAdmin = groupData.createdBy === user.uid || 
                       groupData.admins?.some(
                         (admin) => admin.uid === user.uid || admin.email === user.email
                       );

        if (isAdmin) {
          const option = document.createElement("option");
          option.value = doc.id;
          option.textContent = groupData.groupName;
          groupSelector.appendChild(option);
        }
      });

      // Auto-select if groupId in URL or localStorage
      const urlParams = new URLSearchParams(window.location.search);
      const urlGroupId = urlParams.get("groupId");
      const savedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
      const groupIdToSelect = urlGroupId || savedGroupId;
      
      if (groupIdToSelect) {
        groupSelector.value = groupIdToSelect;
        await loadRatesData(groupIdToSelect);
      }
    } catch (error) {
      console.error("Error loading groups:", error);
      alert("Error loading groups. Please try again.");
    }
  }

  // Load rates and penalties for group
  async function loadRatesData(groupId) {
    try {
      currentGroupId = groupId;
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      
      if (!groupDoc.exists()) {
        alert("Group not found!");
        return;
      }

      const groupData = groupDoc.data();
      const rules = groupData.rules || {};

      // Display Loan Interest Rate (show average or first month rate)
      const loanInterestEl = document.getElementById("loanInterestRate");
      if (loanInterestEl) {
        const month1 = rules.loanInterest?.month1 || 0;
        const month2 = rules.loanInterest?.month2 || 0;
        const month3 = rules.loanInterest?.month3AndBeyond || 0;
        if (month1 > 0) {
          loanInterestEl.textContent = `${month1}% (M1), ${month2}% (M2), ${month3}% (M3+)`;
        } else {
          loanInterestEl.textContent = "0%";
        }
      }

      // Display Late Payment Penalty (use monthly penalty rate)
      const latePenaltyEl = document.getElementById("latePenaltyRate");
      if (latePenaltyEl) {
        const penaltyRate = rules.monthlyPenalty?.rate || rules.loanPenalty?.rate || 0;
        latePenaltyEl.textContent = `${penaltyRate}%`;
      }

      // Display Grace Period (use monthly grace period)
      const gracePeriodEl = document.getElementById("gracePeriod");
      if (gracePeriodEl) {
        const graceDays = rules.monthlyPenalty?.gracePeriodDays || rules.loanPenalty?.gracePeriodDays || 0;
        gracePeriodEl.textContent = `${graceDays} days`;
      }

      // Load penalties and interest data
      await loadPenaltiesData(groupId);
      await loadCollectedInterest(groupId);

    } catch (error) {
      console.error("Error loading rates data:", error);
      alert("Error loading rates data. Please try again.");
    }
  }

  // Load pending penalties
  async function loadPenaltiesData(groupId) {
    if (!pendingPenaltiesList) return;
    
    try {
      const currentYear = new Date().getFullYear();
      const membersRef = collection(db, `groups/${groupId}/members`);
      const membersSnapshot = await getDocs(membersRef);
      
      const pendingPenalties = [];
      
      for (const memberDoc of membersSnapshot.docs) {
        const member = memberDoc.data();
        const memberId = memberDoc.id;
        
        // Check monthly contributions for pending penalties
        try {
          const monthlyRef = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${memberId}`);
          const monthlySnapshot = await getDocs(monthlyRef);
          
          monthlySnapshot.forEach(monthDoc => {
            const payment = monthDoc.data();
            const arrears = parseFloat(payment.arrears || 0);
            const approvalStatus = payment.approvalStatus || 'unpaid';
            
            if (arrears > 0 && approvalStatus !== 'approved') {
              pendingPenalties.push({
                memberName: member.fullName || 'Unknown',
                type: 'Monthly Contribution',
                amount: arrears,
                dueDate: payment.dueDate ? (payment.dueDate.toDate ? payment.dueDate.toDate().toLocaleDateString() : new Date(payment.dueDate).toLocaleDateString()) : 'N/A',
                status: approvalStatus
              });
            }
          });
        } catch (e) {
          console.log(`No monthly payments for ${memberId}`);
        }
        
        // Check seed money for pending penalties
        try {
          const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberId}/PaymentDetails`);
          const seedMoneyDoc = await getDoc(seedMoneyRef);
          
          if (seedMoneyDoc.exists()) {
            const payment = seedMoneyDoc.data();
            const arrears = parseFloat(payment.arrears || 0);
            const approvalStatus = payment.approvalStatus || 'unpaid';
            
            if (arrears > 0 && approvalStatus !== 'approved') {
              pendingPenalties.push({
                memberName: member.fullName || 'Unknown',
                type: 'Seed Money',
                amount: arrears,
                dueDate: payment.dueDate ? (payment.dueDate.toDate ? payment.dueDate.toDate().toLocaleDateString() : new Date(payment.dueDate).toLocaleDateString()) : 'N/A',
                status: approvalStatus
              });
            }
          }
        } catch (e) {
          console.log(`No seed money payment for ${memberId}`);
        }
      }
      
      if (pendingPenalties.length === 0) {
        pendingPenaltiesList.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">⚖️</div>
            <p class="empty-state-text">No outstanding arrears</p>
          </div>
        `;
      } else {
        pendingPenaltiesList.innerHTML = `
          <div class="penalties-list">
            ${pendingPenalties.map(penalty => `
              <div class="penalty-item">
                <div class="penalty-info">
                  <div class="penalty-member">${penalty.memberName}</div>
                  <div class="penalty-type">${penalty.type}</div>
                  <div class="penalty-amount">MWK ${penalty.amount.toLocaleString()}</div>
                  <div class="penalty-date">Due: ${penalty.dueDate}</div>
                </div>
                <div class="penalty-status">
                  <span class="badge badge-${penalty.status === 'pending' ? 'warning' : 'danger'}">${penalty.status}</span>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }
    } catch (error) {
      console.error("Error loading penalties data:", error);
      pendingPenaltiesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">❌</div>
          <p class="empty-state-text">Error loading penalties</p>
        </div>
      `;
    }
  }

  // Load collected interest
  async function loadCollectedInterest(groupId) {
    if (!collectedInterestList) return;
    
    try {
      const loansRef = collection(db, `groups/${groupId}/loans`);
      const activeLoansQuery = query(
        loansRef,
        where("status", "in", ["active", "repaid"]),
        orderBy("disbursedAt", "desc")
      );
      const loansSnapshot = await getDocs(activeLoansQuery);
      
      const interestData = [];
      let totalInterest = 0;
      
      loansSnapshot.forEach(loanDoc => {
        const loan = loanDoc.data();
        const interestEarned = parseFloat(loan.interestEarned || loan.totalInterest || 0);
        
        if (interestEarned > 0) {
          totalInterest += interestEarned;
          interestData.push({
            borrowerName: loan.borrowerName || 'Unknown',
            loanAmount: parseFloat(loan.amount || loan.loanAmount || 0),
            interestEarned: interestEarned,
            disbursedDate: loan.disbursedAt ? (loan.disbursedAt.toDate ? loan.disbursedAt.toDate().toLocaleDateString() : new Date(loan.disbursedAt).toLocaleDateString()) : 'N/A',
            status: loan.status
          });
        }
      });
      
      if (interestData.length === 0) {
        collectedInterestList.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">💰</div>
            <p class="empty-state-text">No interest collected yet</p>
          </div>
        `;
      } else {
        collectedInterestList.innerHTML = `
          <div class="interest-summary">
            <div class="summary-card">
              <div class="summary-label">Total Interest Collected</div>
              <div class="summary-value">MWK ${totalInterest.toLocaleString()}</div>
            </div>
          </div>
          <div class="interest-list">
            ${interestData.map(item => `
              <div class="interest-item">
                <div class="interest-info">
                  <div class="interest-borrower">${item.borrowerName}</div>
                  <div class="interest-loan">Loan: MWK ${item.loanAmount.toLocaleString()}</div>
                  <div class="interest-amount">Interest: MWK ${item.interestEarned.toLocaleString()}</div>
                  <div class="interest-date">Disbursed: ${item.disbursedDate}</div>
                </div>
                <div class="interest-status">
                  <span class="badge badge-${item.status === 'repaid' ? 'success' : 'info'}">${item.status}</span>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }
    } catch (error) {
      console.error("Error loading collected interest:", error);
      collectedInterestList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">❌</div>
          <p class="empty-state-text">Error loading interest data</p>
        </div>
      `;
    }
  }

  // Open edit rates modal
  async function openEditRatesModal() {
    if (!editModal || !currentGroupId) {
      alert("Please select a group first");
      return;
    }

    try {
      const groupDoc = await getDoc(doc(db, "groups", currentGroupId));
      const rules = groupDoc.data().rules || {};

      if (modalTitle) {
        modalTitle.textContent = "Edit Interest Rates & Penalties";
      }

      if (modalForm) {
        modalForm.innerHTML = `
          <div class="form-section">
            <h4 class="form-section-title">Loan Interest Rates</h4>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Month 1 Rate (%)</label>
                <input type="number" class="form-input" id="editLoanInterestM1" step="0.1" value="${rules.loanInterest?.month1 || 0}" min="0">
              </div>
              <div class="form-group">
                <label class="form-label">Month 2 Rate (%)</label>
                <input type="number" class="form-input" id="editLoanInterestM2" step="0.1" value="${rules.loanInterest?.month2 || 0}" min="0">
              </div>
              <div class="form-group">
                <label class="form-label">Month 3+ Rate (%)</label>
                <input type="number" class="form-input" id="editLoanInterestM3" step="0.1" value="${rules.loanInterest?.month3AndBeyond || 0}" min="0">
              </div>
            </div>
          </div>

          <div class="form-section">
            <h4 class="form-section-title">Loan Penalty Settings</h4>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Penalty Rate (%)</label>
                <input type="number" class="form-input" id="editLoanPenaltyRate" step="0.1" value="${rules.loanPenalty?.rate || 0}" min="0">
              </div>
              <div class="form-group">
                <label class="form-label">Grace Period (days)</label>
                <input type="number" class="form-input" id="editLoanGracePeriod" value="${rules.loanPenalty?.gracePeriodDays || 0}" min="0">
              </div>
            </div>
          </div>

          <div class="form-section">
            <h4 class="form-section-title">Monthly Contribution Penalty</h4>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Penalty Rate (%)</label>
                <input type="number" class="form-input" id="editMonthlyPenaltyRate" step="0.1" value="${rules.monthlyPenalty?.rate || 0}" min="0">
              </div>
              <div class="form-group">
                <label class="form-label">Grace Period (days)</label>
                <input type="number" class="form-input" id="editMonthlyGracePeriod" value="${rules.monthlyPenalty?.gracePeriodDays || 0}" min="0">
              </div>
            </div>
          </div>

          <div class="form-section">
            <h4 class="form-section-title">Seed Money Settings</h4>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Amount (MWK)</label>
                <input type="number" class="form-input" id="editSeedMoneyAmount" value="${rules.seedMoney?.amount || 0}" min="0">
              </div>
              <div class="form-group">
                <label class="form-label">Required</label>
                <select class="form-select" id="editSeedMoneyRequired">
                  <option value="true" ${rules.seedMoney?.required ? 'selected' : ''}>Yes</option>
                  <option value="false" ${!rules.seedMoney?.required ? 'selected' : ''}>No</option>
                </select>
              </div>
            </div>
          </div>

          <div class="form-section">
            <h4 class="form-section-title">Monthly Contribution Settings</h4>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Amount (MWK)</label>
                <input type="number" class="form-input" id="editMonthlyContributionAmount" value="${rules.monthlyContribution?.amount || 0}" min="0">
              </div>
              <div class="form-group">
                <label class="form-label">Due Day of Month</label>
                <input type="number" class="form-input" id="editMonthlyDueDay" min="1" max="31" value="${rules.monthlyContribution?.dayOfMonth || 15}">
              </div>
              <div class="form-group">
                <label class="form-label">Allow Partial Payments</label>
                <select class="form-select" id="editPartialPayments">
                  <option value="true" ${rules.monthlyContribution?.allowPartialPayment ? 'selected' : ''}>Yes</option>
                  <option value="false" ${!rules.monthlyContribution?.allowPartialPayment ? 'selected' : ''}>No</option>
                </select>
              </div>
            </div>
          </div>
        `;
      }

      if (window.openModal) {
        window.openModal('editModal');
      } else {
        const modal = document.getElementById('editModal');
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('active');
          document.body.style.overflow = 'hidden';
        }
      }
    } catch (error) {
      console.error("Error opening edit modal:", error);
      alert("Error loading group data. Please try again.");
    }
  }

  // Save rate changes
  async function saveRateChanges() {
    try {
      if (!currentGroupId) {
        alert("No group selected");
        return;
      }

      const groupRef = doc(db, "groups", currentGroupId);
      const updateData = {
        "rules.loanInterest.month1": parseFloat(document.getElementById("editLoanInterestM1")?.value || 0),
        "rules.loanInterest.month2": parseFloat(document.getElementById("editLoanInterestM2")?.value || 0),
        "rules.loanInterest.month3AndBeyond": parseFloat(document.getElementById("editLoanInterestM3")?.value || 0),
        "rules.loanPenalty.rate": parseFloat(document.getElementById("editLoanPenaltyRate")?.value || 0),
        "rules.loanPenalty.gracePeriodDays": parseInt(document.getElementById("editLoanGracePeriod")?.value || 0),
        "rules.monthlyPenalty.rate": parseFloat(document.getElementById("editMonthlyPenaltyRate")?.value || 0),
        "rules.monthlyPenalty.gracePeriodDays": parseInt(document.getElementById("editMonthlyGracePeriod")?.value || 0),
        "rules.seedMoney.amount": parseFloat(document.getElementById("editSeedMoneyAmount")?.value || 0),
        "rules.seedMoney.required": document.getElementById("editSeedMoneyRequired")?.value === "true",
        "rules.monthlyContribution.amount": parseFloat(document.getElementById("editMonthlyContributionAmount")?.value || 0),
        "rules.monthlyContribution.dayOfMonth": parseInt(document.getElementById("editMonthlyDueDay")?.value || 15),
        "rules.monthlyContribution.allowPartialPayment": document.getElementById("editPartialPayments")?.value === "true",
        updatedAt: Timestamp.now(),
      };

      await updateDoc(groupRef, updateData);

      alert("Settings updated successfully!");
      if (window.closeModal) {
        window.closeModal('editModal');
      } else {
        const modal = document.getElementById('editModal');
        if (modal) {
          modal.classList.add('hidden');
          modal.classList.remove('active');
          document.body.style.overflow = '';
        }
      }
      await loadRatesData(currentGroupId);

    } catch (error) {
      console.error("Error saving changes:", error);
      alert("Error saving changes. Please try again.");
    }
  }

  // Group selector change event
  if (groupSelector) {
    groupSelector.addEventListener("change", async (e) => {
      const groupId = e.target.value;
      if (groupId) {
        localStorage.setItem('selectedGroupId', groupId);
        sessionStorage.setItem('selectedGroupId', groupId);
        await loadRatesData(groupId);
      }
    });
  }

  // Authentication
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    await loadAdminGroups(user);
  });
});
