import {
  db,
  auth,
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  onAuthStateChanged,
  Timestamp,
} from "./firebaseConfig.js";

document.addEventListener("DOMContentLoaded", () => {
  const backButton = document.querySelector(".page-back-btn");
  const groupSelector = document.getElementById("groupSelector");
  const monthSelector = document.getElementById("monthSelector");
  const historyYearSelector = document.getElementById("historyYearSelector");
  const contributionsList = document.getElementById("contributionsList");
  const contributionHistory = document.getElementById("contributionHistory");
  const breakdownCards = document.getElementById("breakdownCards");
  const refreshBtn = document.getElementById("refreshBtn");
  
  // Statistics elements
  const totalContributed = document.getElementById("totalContributed");
  const thisMonth = document.getElementById("thisMonth");
  const pendingAmount = document.getElementById("pendingAmount");
  const memberCount = document.getElementById("memberCount");
  const spinner = document.getElementById("spinner");

  let currentGroupId = null;
  let currentGroupData = null;

  // Navigate back
  if (backButton) {
    backButton.addEventListener("click", () => {
      window.location.href = "admin_dashboard.html";
    });
  }

  // Refresh button
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      if (currentGroupId && monthSelector?.value) {
        loadContributionData(currentGroupId, monthSelector.value);
      }
    });
  }

  // Show/hide spinner
  function showSpinner(show) {
    if (spinner) {
      if (show) {
        spinner.classList.remove("hidden");
      } else {
        spinner.classList.add("hidden");
      }
    }
  }

  // Populate month selector
  function populateMonthSelector() {
    if (!monthSelector) return;
    
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    
    monthSelector.innerHTML = '<option value="">Select Month...</option>';
    
    // Add last 12 months
    for (let i = 11; i >= 0; i--) {
      const date = new Date(currentYear, currentMonth - i, 1);
      const year = date.getFullYear();
      const monthIndex = date.getMonth();
      const monthName = months[monthIndex];
      const value = `${year}_${monthName}`;
      
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${monthName} ${year}`;
      
      if (i === 0) {
        option.selected = true;
      }
      
      monthSelector.appendChild(option);
    }
  }

  // Populate year selector for history
  function populateYearSelector() {
    if (!historyYearSelector) return;
    
    const currentYear = new Date().getFullYear();
    historyYearSelector.innerHTML = '<option value="">All Years</option>';
    
    // Add last 5 years
    for (let i = 0; i < 5; i++) {
      const year = currentYear - i;
      const option = document.createElement("option");
      option.value = year;
      option.textContent = year;
      if (i === 0) option.selected = true;
      historyYearSelector.appendChild(option);
    }
  }

  // Load admin groups
  async function loadAdminGroups(user) {
    if (!groupSelector) return;
    
    try {
      const groupsSnapshot = await getDocs(collection(db, "groups"));
      groupSelector.innerHTML = '<option value="">Select a group...</option>';

      const selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');

      groupsSnapshot.forEach((doc) => {
        const groupData = doc.data();
        const groupId = doc.id;
        const isAdmin = groupData.createdBy === user.uid || 
                       groupData.admins?.some(
                         (admin) => admin.uid === user.uid || admin.email === user.email
                       );

        if (isAdmin) {
          const option = document.createElement("option");
          option.value = groupId;
          option.textContent = groupData.groupName;
          if (selectedGroupId === groupId) {
            option.selected = true;
            currentGroupId = groupId;
          }
          groupSelector.appendChild(option);
        }
      });

      // Auto-load if group is selected
      if (currentGroupId && monthSelector?.value) {
        await loadContributionData(currentGroupId, monthSelector.value);
      }
    } catch (error) {
      console.error("Error loading groups:", error);
      showToast("Error loading groups. Please try again.", "error");
    }
  }

  // Load contribution data for a specific month
  async function loadContributionData(groupId, monthId) {
    if (!groupId || !monthId) return;
    
    try {
      showSpinner(true);
      currentGroupId = groupId;
      
      const [year, month] = monthId.split("_");
      
      // Get group data
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (!groupDoc.exists()) {
        showToast("Group not found", "error");
        return;
      }
      
      currentGroupData = groupDoc.data();
      const contributionAmount = currentGroupData.rules?.monthlyContribution?.amount || 0;

      // Get all members
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      const totalMembers = membersSnapshot.size;

      let collectedAmount = 0;
      let pendingAmountValue = 0;
      let unpaidAmount = 0;
      let paidCount = 0;
      let pendingCount = 0;
      let unpaidCount = 0;

      const contributionsData = [];

      // Fetch contributions for each member
      for (const memberDoc of membersSnapshot.docs) {
        const member = memberDoc.data();
        const memberId = memberDoc.id;

        try {
          // Check monthly contributions subcollection
          const monthlyRef = collection(db, `groups/${groupId}/payments/${year}_MonthlyContributions/${memberId}`);
          const monthlySnapshot = await getDocs(monthlyRef);
          
          let memberContribution = null;
          monthlySnapshot.forEach((monthDoc) => {
            const data = monthDoc.data();
            if (data.month === month || monthDoc.id === monthId || monthDoc.id.includes(month)) {
              memberContribution = {
                ...data,
                docId: monthDoc.id
              };
            }
          });

          if (memberContribution) {
            const amountPaid = parseFloat(memberContribution.amountPaid || 0);
            const arrears = parseFloat(memberContribution.arrears || 0);
            const approvalStatus = memberContribution.approvalStatus || "unpaid";
            const paymentStatus = memberContribution.paymentStatus || "unpaid";

            let status = "unpaid";
            if (approvalStatus === "approved" && amountPaid >= contributionAmount) {
              status = "completed";
              collectedAmount += amountPaid;
              paidCount++;
            } else if (approvalStatus === "approved" && amountPaid > 0) {
              // Partially paid but approved — count what's collected
              status = "partial";
              collectedAmount += amountPaid;
              unpaidAmount += Math.max(0, contributionAmount - amountPaid);
              paidCount++;
            } else if (approvalStatus === "pending") {
              status = "pending";
              pendingAmountValue += amountPaid;
              pendingCount++;
            } else {
              status = "unpaid";
              unpaidAmount += contributionAmount - amountPaid;
              unpaidCount++;
            }

            contributionsData.push({
              memberId: memberId,
              memberName: member.fullName || "Unknown",
              expected: contributionAmount,
              paid: amountPaid,
              arrears: arrears !== undefined && arrears !== null ? arrears : (contributionAmount - amountPaid),
              status: status,
              approvalStatus: approvalStatus,
              dueDate: memberContribution.dueDate 
                ? (memberContribution.dueDate.toDate ? memberContribution.dueDate.toDate().toLocaleDateString() : new Date(memberContribution.dueDate).toLocaleDateString())
                : "N/A",
              paidDate: memberContribution.paidAt 
                ? (memberContribution.paidAt.toDate ? memberContribution.paidAt.toDate().toLocaleDateString() : new Date(memberContribution.paidAt).toLocaleDateString())
                : (memberContribution.approvedAt 
                  ? (memberContribution.approvedAt.toDate ? memberContribution.approvedAt.toDate().toLocaleDateString() : new Date(memberContribution.approvedAt).toLocaleDateString())
                  : "N/A"),
              proofOfPayment: memberContribution.proofOfPayment || null,
            });
          } else {
            // No payment record
            unpaidAmount += contributionAmount;
            unpaidCount++;
            contributionsData.push({
              memberId: memberId,
              memberName: member.fullName || "Unknown",
              expected: contributionAmount,
              paid: 0,
              arrears: contributionAmount,
              status: "unpaid",
              approvalStatus: "unpaid",
              dueDate: "N/A",
              paidDate: "N/A",
              proofOfPayment: null,
            });
          }
        } catch (error) {
          console.error(`Error loading contribution for member ${memberId}:`, error);
          // Add as unpaid if error
          unpaidAmount += contributionAmount;
          unpaidCount++;
          contributionsData.push({
            memberId: memberId,
            memberName: member.fullName || "Unknown",
            expected: contributionAmount,
            paid: 0,
            arrears: contributionAmount,
            status: "unpaid",
            approvalStatus: "unpaid",
            dueDate: "N/A",
            paidDate: "N/A",
            proofOfPayment: null,
          });
        }
      }

      // Update statistics
      const expectedTotal = totalMembers * contributionAmount;
      
      if (totalContributed) {
        totalContributed.textContent = `MWK ${collectedAmount.toLocaleString()}`;
      }
      if (thisMonth) {
        thisMonth.textContent = `MWK ${collectedAmount.toLocaleString()}`;
      }
      if (pendingAmount) {
        pendingAmount.textContent = `MWK ${pendingAmountValue.toLocaleString()}`;
      }
      if (memberCount) {
        memberCount.textContent = `${paidCount}/${totalMembers}`;
      }

      // Display breakdown cards
      displayBreakdownCards({
        expected: expectedTotal,
        collected: collectedAmount,
        pending: pendingAmountValue,
        unpaid: unpaidAmount,
        paidCount,
        pendingCount,
        unpaidCount,
        totalMembers
      });

      // Display contributions table
      displayContributionsList(contributionsData);

    } catch (error) {
      console.error("Error loading contribution data:", error);
      showToast("Error loading contribution data. Please try again.", "error");
    } finally {
      showSpinner(false);
    }
  }

  // Display breakdown cards
  function displayBreakdownCards(stats) {
    if (!breakdownCards) return;

    const collectionRate = stats.expected > 0 ? (stats.collected / stats.expected) * 100 : 0;
    const complianceRate = stats.totalMembers > 0 ? (stats.paidCount / stats.totalMembers) * 100 : 0;

    breakdownCards.innerHTML = `
      <div class="breakdown-card">
        <div class="breakdown-card-header">
          <span class="breakdown-card-title">Expected</span>
        </div>
        <div class="breakdown-card-value">MWK ${stats.expected.toLocaleString()}</div>
        <div class="breakdown-card-progress">
          <div class="breakdown-card-progress-bar" style="width: 100%; background: var(--bn-gray-300);"></div>
        </div>
      </div>
      <div class="breakdown-card">
        <div class="breakdown-card-header">
          <span class="breakdown-card-title">Collected</span>
        </div>
        <div class="breakdown-card-value" style="color: #22c55e;">MWK ${stats.collected.toLocaleString()}</div>
        <div class="breakdown-card-progress">
          <div class="breakdown-card-progress-bar" style="width: ${collectionRate}%; background: linear-gradient(90deg, #22c55e, #16a34a);"></div>
        </div>
        <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-2);">
          ${collectionRate.toFixed(1)}% of expected
        </div>
      </div>
      <div class="breakdown-card">
        <div class="breakdown-card-header">
          <span class="breakdown-card-title">Compliance Rate</span>
        </div>
        <div class="breakdown-card-value" style="color: #3b82f6;">${complianceRate.toFixed(1)}%</div>
        <div class="breakdown-card-progress">
          <div class="breakdown-card-progress-bar" style="width: ${complianceRate}%; background: linear-gradient(90deg, #3b82f6, #2563eb);"></div>
        </div>
        <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-2);">
          ${stats.paidCount} of ${stats.totalMembers} members paid
        </div>
      </div>
      <div class="breakdown-card">
        <div class="breakdown-card-header">
          <span class="breakdown-card-title">Outstanding</span>
        </div>
        <div class="breakdown-card-value" style="color: #ef4444;">MWK ${(stats.pending + stats.unpaid).toLocaleString()}</div>
        <div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-2);">
          Pending: MWK ${stats.pending.toLocaleString()}<br>
          Unpaid: MWK ${stats.unpaid.toLocaleString()}
        </div>
      </div>
    `;
  }

  // Display contributions list
  function displayContributionsList(data) {
    if (!contributionsList) return;
    
    if (data.length === 0) {
      contributionsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <p class="empty-state-text">No contribution data available</p>
        </div>
      `;
      return;
    }

    contributionsList.innerHTML = `
      <div class="table-container">
        <table class="table table-responsive">
          <thead>
            <tr>
              <th>Member Name</th>
              <th>Expected (MWK)</th>
              <th>Paid (MWK)</th>
              <th>Arrears (MWK)</th>
              <th>Status</th>
              <th>Due Date</th>
              <th>Payment Date</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(item => {
              const statusClass = item.status === 'completed' ? 'completed' : 
                                 item.status === 'pending' ? 'pending' : 
                                 item.paid > 0 ? 'partial' : 'unpaid';
              const statusText = item.status === 'completed' ? 'Completed' : 
                               item.status === 'pending' ? 'Pending' : 
                               item.paid > 0 ? 'Partial' : 'Unpaid';
              const arrearsClass = item.arrears > 0 ? 'cell-danger' : 'cell-success';
              
              return `
                <tr>
                  <td data-label="Member" class="cell-name">${escapeHtml(item.memberName)}</td>
                  <td data-label="Expected" class="cell-right cell-nowrap">${parseFloat(item.expected).toLocaleString()}</td>
                  <td data-label="Paid" class="cell-right cell-nowrap">${parseFloat(item.paid).toLocaleString()}</td>
                  <td data-label="Arrears" class="cell-right ${arrearsClass} cell-nowrap">${parseFloat(item.arrears).toLocaleString()}</td>
                  <td data-label="Status"><span class="status-badge ${statusClass}">${statusText}</span></td>
                  <td data-label="Due Date" class="cell-muted">${item.dueDate}</td>
                  <td data-label="Paid Date" class="cell-muted">${item.paidDate}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Load contribution history
  async function loadContributionHistory(groupId, year = null) {
    if (!groupId || !contributionHistory) return;
    
    try {
      showSpinner(true);
      
      const currentYear = new Date().getFullYear();
      const yearsToCheck = year ? [parseInt(year)] : [currentYear, currentYear - 1, currentYear - 2];
      
      const historyData = [];
      const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

      for (const checkYear of yearsToCheck) {
        try {
          const monthlyRef = collection(db, `groups/${groupId}/payments/${checkYear}_MonthlyContributions`);
          const monthlySnapshot = await getDocs(monthlyRef);
          
          // Get all member subcollections
          for (const memberDoc of monthlySnapshot.docs) {
            const memberId = memberDoc.id;
            const memberPaymentsRef = collection(db, `groups/${groupId}/payments/${checkYear}_MonthlyContributions/${memberId}`);
            const memberPaymentsSnapshot = await getDocs(memberPaymentsRef);
            
            memberPaymentsSnapshot.forEach((monthDoc) => {
              const data = monthDoc.data();
              const monthName = data.month || monthDoc.id.split('_')[1] || 'Unknown';
              const monthIndex = months.indexOf(monthName);
              
              if (monthIndex >= 0 || !year) {
                const amountPaid = parseFloat(data.amountPaid || 0);
                const approvalStatus = data.approvalStatus || "unpaid";
                
                if (amountPaid > 0 || approvalStatus === "approved") {
                  const existingIndex = historyData.findIndex(h => h.month === monthName && h.year === checkYear);
                  
                  if (existingIndex >= 0) {
                    historyData[existingIndex].collected += amountPaid;
                    historyData[existingIndex].paidCount++;
                  } else {
                    historyData.push({
                      year: checkYear,
                      month: monthName,
                      monthIndex: monthIndex,
                      collected: amountPaid,
                      paidCount: 1,
                      date: new Date(checkYear, monthIndex, 1)
                    });
                  }
                }
              }
            });
          }
        } catch (error) {
          console.error(`Error loading history for year ${checkYear}:`, error);
        }
      }

      // Sort by date (newest first)
      historyData.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.monthIndex - a.monthIndex;
      });

      // Display history
      if (historyData.length === 0) {
        contributionHistory.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <p class="empty-state-text">No contribution history available</p>
          </div>
        `;
      } else {
        contributionHistory.innerHTML = historyData.map(item => {
          // Get group data for expected amount
          const expectedAmount = currentGroupData?.rules?.monthlyContribution?.amount || 0;
          const expectedTotal = item.paidCount * expectedAmount;
          const collectionRate = expectedTotal > 0 ? (item.collected / expectedTotal) * 100 : 0;
          
          return `
            <div class="history-item">
              <div class="history-item-card">
                <div class="history-item-header">
                  <div class="history-item-month">${item.month} ${item.year}</div>
                  <div class="history-item-date">${item.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
                </div>
                <div class="history-item-stats">
                  <div class="history-stat">
                    <div class="history-stat-label">Collected</div>
                    <div class="history-stat-value" style="color: #22c55e;">MWK ${item.collected.toLocaleString()}</div>
                  </div>
                  <div class="history-stat">
                    <div class="history-stat-label">Members Paid</div>
                    <div class="history-stat-value">${item.paidCount}</div>
                  </div>
                  <div class="history-stat">
                    <div class="history-stat-label">Collection Rate</div>
                    <div class="history-stat-value" style="color: #3b82f6;">${collectionRate.toFixed(1)}%</div>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    } catch (error) {
      console.error("Error loading contribution history:", error);
      contributionHistory.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">❌</div>
          <p class="empty-state-text">Error loading history</p>
        </div>
      `;
    } finally {
      showSpinner(false);
    }
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Show toast
  function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) {
      alert(message);
      return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('exiting');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Event listeners
  if (groupSelector) {
    groupSelector.addEventListener("change", async () => {
      const groupId = groupSelector.value;
      const monthId = monthSelector?.value;
      
      if (groupId) {
        localStorage.setItem('selectedGroupId', groupId);
        sessionStorage.setItem('selectedGroupId', groupId);
        
        if (monthId) {
          await loadContributionData(groupId, monthId);
        }
        
        // Load history
        const selectedYear = historyYearSelector?.value || '';
        await loadContributionHistory(groupId, selectedYear || null);
      }
    });
  }

  if (monthSelector) {
    monthSelector.addEventListener("change", async () => {
      const groupId = groupSelector?.value;
      const monthId = monthSelector.value;
      
      if (groupId && monthId) {
        await loadContributionData(groupId, monthId);
      }
    });
  }

  if (historyYearSelector) {
    historyYearSelector.addEventListener("change", async () => {
      const groupId = groupSelector?.value;
      const selectedYear = historyYearSelector.value;
      
      if (groupId) {
        await loadContributionHistory(groupId, selectedYear || null);
      }
    });
  }

  // Initialize
  populateMonthSelector();
  populateYearSelector();

  // Authentication
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    await loadAdminGroups(user);
  });
});
