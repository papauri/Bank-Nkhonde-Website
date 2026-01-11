import {
  db,
  auth,
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  onAuthStateChanged,
  Timestamp,
} from "./firebaseConfig.js";

document.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("backButton");
  const groupSelector = document.getElementById("groupSelector");
  const editModal = document.getElementById("editModal");
  const closeModal = document.querySelector(".close");
  const modalForm = document.getElementById("modalForm");
  const modalTitle = document.getElementById("modalTitle");
  const penaltiesTable = document.getElementById("penaltiesTable");

  let currentGroupId = null;
  let currentEditTarget = null;

  // Navigate back
  backButton.addEventListener("click", () => {
    window.location.href = "admin_dashboard.html";
  });

  // Close modal
  closeModal.addEventListener("click", () => {
    editModal.style.display = "none";
  });

  window.addEventListener("click", (event) => {
    if (event.target === editModal) {
      editModal.style.display = "none";
    }
  });

  // Load admin groups
  async function loadAdminGroups(user) {
    try {
      const groupsSnapshot = await getDocs(collection(db, "groups"));
      groupSelector.innerHTML = '<option value="">Select a group...</option>';

      groupsSnapshot.forEach((doc) => {
        const groupData = doc.data();
        const isAdmin = groupData.admins?.some(
          (admin) => admin.uid === user.uid || admin.email === user.email
        );

        if (isAdmin) {
          const option = document.createElement("option");
          option.value = doc.id;
          option.textContent = groupData.groupName;
          groupSelector.appendChild(option);
        }
      });
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

      // Display Loan Interest Rates
      document.getElementById("loanInterestM1").textContent = `${rules.loanInterest?.month1 || 0}%`;
      document.getElementById("loanInterestM2").textContent = `${rules.loanInterest?.month2 || 0}%`;
      document.getElementById("loanInterestM3").textContent = `${rules.loanInterest?.month3AndBeyond || 0}%`;

      // Display Loan Penalty
      document.getElementById("loanPenaltyRate").textContent = `${rules.loanPenalty?.rate || 0}%`;
      document.getElementById("loanPenaltyType").textContent = rules.loanPenalty?.type || "Percentage";
      document.getElementById("loanGracePeriod").textContent = `${rules.loanPenalty?.gracePeriodDays || 0} days`;

      // Display Monthly Penalty
      document.getElementById("monthlyPenaltyRate").textContent = `${rules.monthlyPenalty?.rate || 0}%`;
      document.getElementById("monthlyPenaltyType").textContent = rules.monthlyPenalty?.type || "Percentage";
      document.getElementById("monthlyGracePeriod").textContent = `${rules.monthlyPenalty?.gracePeriodDays || 0} days`;

      // Display Seed Money
      document.getElementById("seedMoneyAmount").textContent = `MWK ${(rules.seedMoney?.amount || 0).toLocaleString()}`;
      document.getElementById("seedMoneyRequired").textContent = rules.seedMoney?.required ? "Yes" : "No";
      document.getElementById("seedMoneyDueDate").textContent = rules.seedMoney?.dueDate 
        ? new Date(rules.seedMoney.dueDate.toDate()).toLocaleDateString() 
        : "N/A";

      // Display Monthly Contribution
      document.getElementById("monthlyContribution").textContent = `MWK ${(rules.monthlyContribution?.amount || 0).toLocaleString()}`;
      document.getElementById("monthlyDueDay").textContent = `${rules.monthlyContribution?.dayOfMonth || 15}th`;
      document.getElementById("partialAllowed").textContent = rules.monthlyContribution?.allowPartialPayment ? "Allowed" : "Not Allowed";

      // Load penalties table
      loadPenaltiesData(groupId);

    } catch (error) {
      console.error("Error loading rates data:", error);
      alert("Error loading rates data. Please try again.");
    }
  }

  // Load penalties data
  async function loadPenaltiesData(groupId) {
    try {
      // This would load actual penalty records from the database
      // For now, showing a placeholder
      penaltiesTable.innerHTML = `
        <p>Penalties table - to be implemented with actual penalty tracking</p>
      `;
    } catch (error) {
      console.error("Error loading penalties data:", error);
    }
  }

  // Edit button click handlers
  document.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      openEditModal(target);
    });
  });

  // Open edit modal
  async function openEditModal(target) {
    currentEditTarget = target;
    
    if (!currentGroupId) {
      alert("Please select a group first");
      return;
    }

    const groupDoc = await getDoc(doc(db, "groups", currentGroupId));
    const rules = groupDoc.data().rules || {};

    let formHTML = "";
    let title = "";

    switch (target) {
      case "loanInterest":
        title = "Edit Loan Interest Rates";
        formHTML = `
          <div class="form-group">
            <label>Month 1 Rate (%):</label>
            <input type="number" id="editLoanInterestM1" step="0.1" value="${rules.loanInterest?.month1 || 0}">
          </div>
          <div class="form-group">
            <label>Month 2 Rate (%):</label>
            <input type="number" id="editLoanInterestM2" step="0.1" value="${rules.loanInterest?.month2 || 0}">
          </div>
          <div class="form-group">
            <label>Month 3+ Rate (%):</label>
            <input type="number" id="editLoanInterestM3" step="0.1" value="${rules.loanInterest?.month3AndBeyond || 0}">
          </div>
          <button onclick="saveRateChanges()" class="button primary">Save Changes</button>
        `;
        break;

      case "loanPenalty":
        title = "Edit Loan Penalty Settings";
        formHTML = `
          <div class="form-group">
            <label>Penalty Rate (%):</label>
            <input type="number" id="editLoanPenaltyRate" step="0.1" value="${rules.loanPenalty?.rate || 0}">
          </div>
          <div class="form-group">
            <label>Grace Period (days):</label>
            <input type="number" id="editLoanGracePeriod" value="${rules.loanPenalty?.gracePeriodDays || 0}">
          </div>
          <button onclick="saveRateChanges()" class="button primary">Save Changes</button>
        `;
        break;

      case "monthlyPenalty":
        title = "Edit Monthly Contribution Penalty";
        formHTML = `
          <div class="form-group">
            <label>Penalty Rate (%):</label>
            <input type="number" id="editMonthlyPenaltyRate" step="0.1" value="${rules.monthlyPenalty?.rate || 0}">
          </div>
          <div class="form-group">
            <label>Grace Period (days):</label>
            <input type="number" id="editMonthlyGracePeriod" value="${rules.monthlyPenalty?.gracePeriodDays || 0}">
          </div>
          <button onclick="saveRateChanges()" class="button primary">Save Changes</button>
        `;
        break;

      case "seedMoney":
        title = "Edit Seed Money Settings";
        formHTML = `
          <div class="form-group">
            <label>Amount (MWK):</label>
            <input type="number" id="editSeedMoneyAmount" value="${rules.seedMoney?.amount || 0}">
          </div>
          <div class="form-group">
            <label>Required:</label>
            <select id="editSeedMoneyRequired">
              <option value="true" ${rules.seedMoney?.required ? 'selected' : ''}>Yes</option>
              <option value="false" ${!rules.seedMoney?.required ? 'selected' : ''}>No</option>
            </select>
          </div>
          <button onclick="saveRateChanges()" class="button primary">Save Changes</button>
        `;
        break;

      case "monthlyContribution":
        title = "Edit Monthly Contribution Settings";
        formHTML = `
          <div class="form-group">
            <label>Amount (MWK):</label>
            <input type="number" id="editMonthlyContributionAmount" value="${rules.monthlyContribution?.amount || 0}">
          </div>
          <div class="form-group">
            <label>Due Day of Month:</label>
            <input type="number" id="editMonthlyDueDay" min="1" max="31" value="${rules.monthlyContribution?.dayOfMonth || 15}">
          </div>
          <div class="form-group">
            <label>Allow Partial Payments:</label>
            <select id="editPartialPayments">
              <option value="true" ${rules.monthlyContribution?.allowPartialPayment ? 'selected' : ''}>Yes</option>
              <option value="false" ${!rules.monthlyContribution?.allowPartialPayment ? 'selected' : ''}>No</option>
            </select>
          </div>
          <button onclick="saveRateChanges()" class="button primary">Save Changes</button>
        `;
        break;
    }

    modalTitle.textContent = title;
    modalForm.innerHTML = formHTML;
    editModal.style.display = "block";
  }

  // Make saveRateChanges globally accessible
  window.saveRateChanges = async function() {
    try {
      if (!currentGroupId || !currentEditTarget) return;

      const groupRef = doc(db, "groups", currentGroupId);
      let updateData = {};

      switch (currentEditTarget) {
        case "loanInterest":
          updateData = {
            "rules.loanInterest.month1": parseFloat(document.getElementById("editLoanInterestM1").value),
            "rules.loanInterest.month2": parseFloat(document.getElementById("editLoanInterestM2").value),
            "rules.loanInterest.month3AndBeyond": parseFloat(document.getElementById("editLoanInterestM3").value),
          };
          break;

        case "loanPenalty":
          updateData = {
            "rules.loanPenalty.rate": parseFloat(document.getElementById("editLoanPenaltyRate").value),
            "rules.loanPenalty.gracePeriodDays": parseInt(document.getElementById("editLoanGracePeriod").value),
          };
          break;

        case "monthlyPenalty":
          updateData = {
            "rules.monthlyPenalty.rate": parseFloat(document.getElementById("editMonthlyPenaltyRate").value),
            "rules.monthlyPenalty.gracePeriodDays": parseInt(document.getElementById("editMonthlyGracePeriod").value),
          };
          break;

        case "seedMoney":
          updateData = {
            "rules.seedMoney.amount": parseFloat(document.getElementById("editSeedMoneyAmount").value),
            "rules.seedMoney.required": document.getElementById("editSeedMoneyRequired").value === "true",
          };
          break;

        case "monthlyContribution":
          updateData = {
            "rules.monthlyContribution.amount": parseFloat(document.getElementById("editMonthlyContributionAmount").value),
            "rules.monthlyContribution.dayOfMonth": parseInt(document.getElementById("editMonthlyDueDay").value),
            "rules.monthlyContribution.allowPartialPayment": document.getElementById("editPartialPayments").value === "true",
          };
          break;
      }

      await updateDoc(groupRef, {
        ...updateData,
        updatedAt: Timestamp.now(),
        lastModifiedBy: auth.currentUser.uid,
      });

      alert("Settings updated successfully!");
      editModal.style.display = "none";
      loadRatesData(currentGroupId);

    } catch (error) {
      console.error("Error saving changes:", error);
      alert("Error saving changes. Please try again.");
    }
  };

  // Group selector change event
  groupSelector.addEventListener("change", (e) => {
    const groupId = e.target.value;
    if (groupId) {
      loadRatesData(groupId);
    }
  });

  // Authentication
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    await loadAdminGroups(user);
  });
});
