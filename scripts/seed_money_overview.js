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
  const groupSelector = document.getElementById("groupSelector");
  const seedMoneyList = document.getElementById("seedMoneyList");
  
  // Statistics elements
  const totalCollectedEl = document.getElementById("totalCollected");
  const pendingAmountEl = document.getElementById("pendingAmount");
  const paidCountEl = document.getElementById("paidCount");
  const unpaidCountEl = document.getElementById("unpaidCount");

  let currentGroupId = null;
  let pendingPayments = [];
  let allSeedMoneyData = []; // Store all data for filtering

  // Filter tab handlers
  document.querySelectorAll(".tab[data-filter]").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab[data-filter]").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const filter = tab.dataset.filter;
      
      if (filter === "all") {
        displaySeedMoneyTable(allSeedMoneyData);
      } else if (filter === "paid") {
        displaySeedMoneyTable(allSeedMoneyData.filter(m => {
          const statusLower = m.status.toLowerCase();
          return statusLower === "paid" || statusLower === "completed";
        }));
      } else if (filter === "pending") {
        displaySeedMoneyTable(allSeedMoneyData.filter(m => {
          const statusLower = m.status.toLowerCase();
          return statusLower !== "paid" && statusLower !== "completed" && statusLower !== "unpaid";
        }));
      }
    });
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
      
      // Auto-select stored group from localStorage/sessionStorage
      const storedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
      if (storedGroupId && groupSelector.querySelector(`option[value="${storedGroupId}"]`)) {
        groupSelector.value = storedGroupId;
        // Automatically load seed money data for the selected group
        await loadSeedMoneyData(storedGroupId);
      }
    } catch (error) {
      console.error("Error loading groups:", error);
      alert("Error loading groups. Please try again.");
    }
  }

  // Load seed money data
  async function loadSeedMoneyData(groupId) {
    try {
      currentGroupId = groupId;
      const currentYear = new Date().getFullYear();

      // Get group data
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      const groupData = groupDoc.data();
      const seedMoneyAmount = groupData.rules?.seedMoney?.amount || 0;

      // Get members
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      const totalMembers = membersSnapshot.size;

      let requiredAmount = totalMembers * seedMoneyAmount;
      let totalCollected = 0;
      let totalPendingApproval = 0;
      let totalOutstanding = 0;
      let fullyPaidCount = 0;

      const seedMoneyData = [];
      pendingPayments = [];

      for (const memberDoc of membersSnapshot.docs) {
        const member = memberDoc.data();
        const memberUid = memberDoc.id;

        const paymentRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberUid}/PaymentDetails`);
        const paymentDoc = await getDoc(paymentRef);

        if (paymentDoc.exists()) {
          const payment = paymentDoc.data();
          // Support both amountPaid field and paid[] array for backward compatibility
          const totalPaidByMember = parseFloat(payment.amountPaid || 0) || 
            (payment.paid?.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0);
          const arrears = payment.arrears !== undefined && payment.arrears !== null ? parseFloat(payment.arrears) : 0;
          const approvalStatus = payment.approvalStatus || "unpaid";
          const paymentStatus = payment.paymentStatus || "Unpaid";

          // Determine display status
          let displayStatus = paymentStatus;
          if (approvalStatus === "pending") {
            displayStatus = "Pending Approval";
          } else if (approvalStatus === "approved") {
            if (totalPaidByMember >= seedMoneyAmount) {
              displayStatus = "Paid";
            } else if (totalPaidByMember > 0) {
              displayStatus = "Partially Paid";
            }
          }

          // Count payments based on approval status
          if (approvalStatus === "pending" && totalPaidByMember > 0) {
            // Waiting for approval
            totalPendingApproval += totalPaidByMember;
            pendingPayments.push({
              memberUid: memberUid,
              memberName: member.fullName,
              amount: totalPaidByMember,
              docRef: paymentRef,
            });
          } else if (approvalStatus === "approved" && totalPaidByMember > 0) {
            // Approved payment (full or partial)
            totalCollected += totalPaidByMember;
            if (totalPaidByMember >= seedMoneyAmount) {
              fullyPaidCount++;
            }
          }

          totalOutstanding += arrears;

          seedMoneyData.push({
            memberName: member.fullName,
            required: seedMoneyAmount,
            paid: totalPaidByMember,
            outstanding: arrears,
            status: displayStatus,
            dueDate: payment.dueDate ? new Date(payment.dueDate.toDate()).toLocaleDateString() : "N/A",
            paidDate: payment.paidAt 
              ? (payment.paidAt.toDate ? new Date(payment.paidAt.toDate()).toLocaleDateString() : new Date(payment.paidAt).toLocaleDateString())
              : (payment.paid?.[payment.paid.length - 1]?.paymentDate 
                ? new Date(payment.paid[payment.paid.length - 1].paymentDate).toLocaleDateString() 
                : "N/A"),
          });
        } else {
          // No payment record
          totalOutstanding += seedMoneyAmount;
          seedMoneyData.push({
            memberName: member.fullName,
            required: seedMoneyAmount,
            paid: 0,
            outstanding: seedMoneyAmount,
            status: "Unpaid",
            dueDate: groupData.rules?.seedMoney?.dueDate 
              ? new Date(groupData.rules.seedMoney.dueDate.toDate()).toLocaleDateString() 
              : "N/A",
            paidDate: "N/A",
          });
        }
      }

      // Calculate completion rate
      const completion = totalMembers > 0 ? (fullyPaidCount / totalMembers) * 100 : 0;
      const stillPending = requiredAmount - totalCollected - totalPendingApproval;

      // Log summary for debugging
      console.log(`Seed Money Summary for group ${groupId}:`, {
        totalMembers,
        requiredAmount,
        totalCollected,
        totalPendingApproval,
        totalOutstanding,
        fullyPaidCount,
        completion: `${completion.toFixed(1)}%`,
        seedMoneyData
      });

      // Update statistics (with null checks)
      if (totalCollectedEl) totalCollectedEl.textContent = `MWK ${totalCollected.toLocaleString()}`;
      if (pendingAmountEl) pendingAmountEl.textContent = `MWK ${totalPendingApproval.toLocaleString()}`;
      if (paidCountEl) paidCountEl.textContent = fullyPaidCount.toString();
      if (unpaidCountEl) unpaidCountEl.textContent = (totalMembers - fullyPaidCount).toString();

      // Display table
      allSeedMoneyData = seedMoneyData;
      displaySeedMoneyTable(seedMoneyData);

    } catch (error) {
      console.error("Error loading seed money data:", error);
      alert("Error loading seed money data. Please try again.");
    }
  }

  // Display seed money table
  function displaySeedMoneyTable(data) {
    if (!seedMoneyList) return;
    
    if (data.length === 0) {
      seedMoneyList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🌱</div>
          <p class="empty-state-text">No seed money data available</p>
        </div>
      `;
      return;
    }

    // Create card-based layout
    const html = data.map(item => {
      const statusLower = item.status.toLowerCase();
      let statusClass = 'warning';
      
      if (statusLower === 'paid' || statusLower === 'completed') {
        statusClass = 'success';
      } else if (statusLower.includes('pending')) {
        statusClass = 'warning';
      } else if (statusLower === 'unpaid') {
        statusClass = 'danger';
      }
      
      const progressPercent = item.required > 0 ? (item.paid / item.required * 100).toFixed(1) : 0;
      
      return `
        <div class="member-card">
          <div class="member-card-header">
            <div class="member-info">
              <div class="member-name">${item.memberName}</div>
              <span class="badge badge-${statusClass}">${item.status}</span>
            </div>
          </div>
          <div class="member-card-body">
            <div class="member-details-grid">
              <div class="member-detail">
                <div class="member-detail-label">Required</div>
                <div class="member-detail-value">MWK ${item.required.toLocaleString()}</div>
              </div>
              <div class="member-detail">
                <div class="member-detail-label">Paid</div>
                <div class="member-detail-value" style="color: var(--bn-success);">MWK ${item.paid.toLocaleString()}</div>
              </div>
              <div class="member-detail">
                <div class="member-detail-label">Outstanding</div>
                <div class="member-detail-value" style="color: ${item.outstanding > 0 ? 'var(--bn-danger)' : 'var(--bn-success)'};">MWK ${item.outstanding.toLocaleString()}</div>
              </div>
              <div class="member-detail">
                <div class="member-detail-label">Due Date</div>
                <div class="member-detail-value">${item.dueDate}</div>
              </div>
            </div>
            <div class="progress-bar" style="margin-top: var(--bn-space-4);">
              <div class="progress-bar-fill" style="width: ${Math.min(progressPercent, 100)}%; background: ${progressPercent >= 100 ? 'var(--bn-success)' : 'var(--bn-warning)'}"></div>
            </div>
            <div style="text-align: center; font-size: var(--bn-text-sm); color: var(--bn-gray); margin-top: var(--bn-space-2);">
              ${progressPercent}% Complete
            </div>
          </div>
        </div>
      `;
    }).join('');

    seedMoneyList.innerHTML = html;
  }

  // Group selector change event
  if (groupSelector) {
    groupSelector.addEventListener("change", (e) => {
      const groupId = e.target.value;
      if (groupId) {
        // Store selected group for consistency across pages
        localStorage.setItem('selectedGroupId', groupId);
        sessionStorage.setItem('selectedGroupId', groupId);
        loadSeedMoneyData(groupId);
      } else if (seedMoneyList) {
        seedMoneyList.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🌱</div>
            <p class="empty-state-text">Select a group to view seed money status</p>
          </div>
        `;
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
