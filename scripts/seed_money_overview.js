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

document.addEventListener("DOMContentLoaded" => {
  const backButton = document.getElementById("backButton");
  const groupSelector = document.getElementById("groupSelector");
  const seedMoneyTable = document.getElementById("seedMoneyTable");
  const approveAllBtn = document.getElementById("approveAllBtn");
  const sendReminderBtn = document.getElementById("sendReminderBtn");
  const exportBtn = document.getElementById("exportBtn");
  
  // Statistics elements
  const totalRequired = document.getElementById("totalRequired");
  const totalPaid = document.getElementById("totalPaid");
  const totalPending = document.getElementById("totalPending");
  const totalOutstanding = document.getElementById("totalOutstanding");
  const completionRate = document.getElementById("completionRate");

  let currentGroupId = null;
  let pendingPayments = [];

  // Navigate back
  backButton.addEventListener("click", () => {
    window.location.href = "admin_dashboard.html";
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
      let paidAmount = 0;
      let pendingAmount = 0;
      let outstandingAmount = 0;
      let completedCount = 0;

      const seedMoneyData = [];
      pendingPayments = [];

      for (const memberDoc of membersSnapshot.docs) {
        const member = memberDoc.data();
        const memberUid = memberDoc.id;

        const paymentRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberUid}/PaymentDetails`);
        const paymentDoc = await getDoc(paymentRef);

        if (paymentDoc.exists()) {
          const payment = paymentDoc.data();
          const totalPaidByMember = payment.paid?.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0;
          const arrears = payment.arrears || 0;
          const status = payment.paymentStatus || "Unpaid";

          if (status === "Completed" || totalPaidByMember >= seedMoneyAmount) {
            paidAmount += totalPaidByMember;
            completedCount++;
          } else if (payment.approvalStatus === "pending") {
            pendingAmount += totalPaidByMember;
            pendingPayments.push({
              memberUid: memberUid,
              memberName: member.fullName,
              amount: totalPaidByMember,
              docRef: paymentRef,
            });
          }

          outstandingAmount += arrears;

          seedMoneyData.push({
            memberName: member.fullName,
            required: seedMoneyAmount,
            paid: totalPaidByMember,
            outstanding: arrears,
            status: status,
            dueDate: payment.dueDate ? new Date(payment.dueDate.toDate()).toLocaleDateString() : "N/A",
            paidDate: payment.paid?.[payment.paid.length - 1]?.paymentDate 
              ? new Date(payment.paid[payment.paid.length - 1].paymentDate).toLocaleDateString() 
              : "N/A",
          });
        } else {
          // No payment record
          outstandingAmount += seedMoneyAmount;
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
      const completion = totalMembers > 0 ? (completedCount / totalMembers) * 100 : 0;

      // Update statistics
      totalRequired.textContent = `MWK ${requiredAmount.toLocaleString()}`;
      totalPaid.textContent = `MWK ${paidAmount.toLocaleString()}`;
      totalPending.textContent = `MWK ${pendingAmount.toLocaleString()}`;
      totalOutstanding.textContent = `MWK ${outstandingAmount.toLocaleString()}`;
      completionRate.textContent = `${completion.toFixed(1)}%`;

      // Display table
      displaySeedMoneyTable(seedMoneyData);

      // Enable/disable approve all button
      approveAllBtn.disabled = pendingPayments.length === 0;

    } catch (error) {
      console.error("Error loading seed money data:", error);
      alert("Error loading seed money data. Please try again.");
    }
  }

  // Display seed money table
  function displaySeedMoneyTable(data) {
    if (data.length === 0) {
      seedMoneyTable.innerHTML = "<p>No seed money data available</p>";
      return;
    }

    // Prepare data for Handsontable
    const tableData = data.map(item => ({
      memberName: item.memberName,
      required: item.required.toFixed(2),
      paid: item.paid.toFixed(2),
      outstanding: item.outstanding.toFixed(2),
      status: item.status,
      dueDate: item.dueDate,
      paidDate: item.paidDate,
    }));

    new Handsontable(seedMoneyTable, {
      data: tableData,
      colHeaders: [
        "Member Name",
        "Required (MWK)",
        "Paid (MWK)",
        "Outstanding (MWK)",
        "Status",
        "Due Date",
        "Payment Date"
      ],
      columns: [
        { data: "memberName", type: "text", readOnly: true },
        { data: "required", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "paid", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "outstanding", type: "numeric", format: "0,0.00", readOnly: true },
        { 
          data: "status", 
          type: "dropdown",
          source: ["Unpaid", "Pending", "Completed"],
        },
        { data: "dueDate", type: "text", readOnly: true },
        { data: "paidDate", type: "text", readOnly: true },
      ],
      width: "100%",
      height: 400,
      stretchH: "all",
      licenseKey: "non-commercial-and-evaluation",
      className: "htCenter htMiddle",
      afterChange: async function (changes, source) {
        if (source === 'loadData' || !changes) return;

        for (const [row, prop, oldValue, newValue] of changes) {
          if (prop === 'status' && oldValue !== newValue) {
            const rowData = this.getSourceDataAtRow(row);
            await updateSeedMoneyStatus(rowData.memberName, newValue);
          }
        }
      },
    });
  }

  // Update seed money status
  async function updateSeedMoneyStatus(memberName, newStatus) {
    try {
      if (!currentGroupId) return;

      const currentYear = new Date().getFullYear();
      const membersSnapshot = await getDocs(collection(db, `groups/${currentGroupId}/members`));
      const member = membersSnapshot.docs.find(doc => doc.data().fullName === memberName);

      if (!member) {
        alert(`Could not find member: ${memberName}`);
        return;
      }

      const memberUid = member.id;
      const paymentRef = doc(db, `groups/${currentGroupId}/payments/${currentYear}_SeedMoney/${memberUid}/PaymentDetails`);

      await updateDoc(paymentRef, {
        paymentStatus: newStatus,
        approvalStatus: newStatus === "Completed" ? "approved" : "pending",
        updatedAt: Timestamp.now(),
        approvedAt: newStatus === "Completed" ? Timestamp.now() : null,
        approvedBy: newStatus === "Completed" ? auth.currentUser.uid : null,
      });

      if (newStatus === "Completed") {
        const paymentDoc = await getDoc(paymentRef);
        if (paymentDoc.exists()) {
          const paymentData = paymentDoc.data();
          await updateDoc(paymentRef, {
            arrears: 0,
            amountPaid: paymentData.totalAmount,
          });
        }
      }

      alert(`Status updated to "${newStatus}" successfully!`);
      loadSeedMoneyData(currentGroupId);

    } catch (error) {
      console.error("Error updating status:", error);
      alert(`Error updating status: ${error.message}`);
    }
  }

  // Approve all pending payments
  approveAllBtn.addEventListener("click", async () => {
    if (pendingPayments.length === 0) {
      alert("No pending payments to approve");
      return;
    }

    if (!confirm(`Approve all ${pendingPayments.length} pending seed money payments?`)) {
      return;
    }

    try {
      for (const payment of pendingPayments) {
        await updateDoc(payment.docRef, {
          approvalStatus: "approved",
          paymentStatus: "Completed",
          approvedAt: Timestamp.now(),
          approvedBy: auth.currentUser.uid,
          updatedAt: Timestamp.now(),
          arrears: 0,
        });
      }

      alert("All pending payments approved successfully!");
      loadSeedMoneyData(currentGroupId);

    } catch (error) {
      console.error("Error approving payments:", error);
      alert("Error approving payments. Please try again.");
    }
  });

  // Send reminders (placeholder)
  sendReminderBtn.addEventListener("click", () => {
    alert("Reminder feature - to be implemented with notification system");
  });

  // Export to Excel (placeholder)
  exportBtn.addEventListener("click", () => {
    alert("Export feature - to be implemented");
  });

  // Group selector change event
  groupSelector.addEventListener("change", (e) => {
    const groupId = e.target.value;
    if (groupId) {
      loadSeedMoneyData(groupId);
    } else {
      seedMoneyTable.innerHTML = "<p>Select a group to view seed money status</p>";
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
