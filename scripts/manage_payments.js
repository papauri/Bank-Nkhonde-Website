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
  const pendingPaymentsTable = document.getElementById("pendingPaymentsTable");
  const recentPaymentsTable = document.getElementById("recentPaymentsTable");
  
  // Statistics elements
  const pendingPayments = document.getElementById("pendingPayments");
  const approvedPayments = document.getElementById("approvedPayments");
  const totalCollected = document.getElementById("totalCollected");
  const totalArrears = document.getElementById("totalArrears");

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

  // Load payment data for selected group
  async function loadPaymentData(groupId) {
    try {
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().toLocaleString("default", { month: "long" });

      let pendingCount = 0;
      let approvedCount = 0;
      let collectedAmount = 0;
      let arrearsAmount = 0;

      const pendingPaymentsData = [];
      const recentPaymentsData = [];

      // Get members
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      
      for (const memberDoc of membersSnapshot.docs) {
        const member = memberDoc.data();
        const memberUid = memberDoc.id;

        // Check Seed Money
        const seedMoneyRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberUid}/PaymentDetails`);
        const seedMoneyDoc = await getDoc(seedMoneyRef);

        if (seedMoneyDoc.exists()) {
          const payment = seedMoneyDoc.data();
          
          if (payment.approvalStatus === "pending") {
            pendingCount++;
            pendingPaymentsData.push({
              memberName: member.fullName,
              memberUid: memberUid,
              paymentType: "Seed Money",
              amount: payment.totalAmount,
              proofUrl: payment.proofOfPayment?.imageUrl,
              submittedAt: payment.paidAt,
              docRef: `${currentYear}_SeedMoney/${memberUid}/PaymentDetails`
            });
          } else if (payment.approvalStatus === "approved") {
            approvedCount++;
            collectedAmount += payment.amountPaid || 0;
            recentPaymentsData.push({
              memberName: member.fullName,
              paymentType: "Seed Money",
              amount: payment.amountPaid,
              approvedAt: payment.approvedAt,
            });
          }

          arrearsAmount += payment.arrears || 0;
        }

        // Check Monthly Contributions
        const sanitizedName = member.fullName.replace(/\s+/g, "_");
        const monthlyRef = doc(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${sanitizedName}/${currentYear}_${currentMonth}`);
        const monthlyDoc = await getDoc(monthlyRef);

        if (monthlyDoc.exists()) {
          const payment = monthlyDoc.data();
          
          if (payment.approvalStatus === "pending") {
            pendingCount++;
            pendingPaymentsData.push({
              memberName: member.fullName,
              memberUid: memberUid,
              paymentType: "Monthly Contribution",
              amount: payment.totalAmount,
              proofUrl: payment.paid?.[payment.paid.length - 1]?.proofURL,
              submittedAt: payment.paid?.[payment.paid.length - 1]?.paymentDate,
              docRef: `${currentYear}_MonthlyContributions/${sanitizedName}/${currentYear}_${currentMonth}`
            });
          } else if (payment.approvalStatus === "approved" || payment.paymentStatus === "Completed") {
            const totalPaid = payment.paid?.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0;
            approvedCount++;
            collectedAmount += totalPaid;
            recentPaymentsData.push({
              memberName: member.fullName,
              paymentType: "Monthly Contribution",
              amount: totalPaid,
              approvedAt: payment.paid?.[payment.paid.length - 1]?.approvalDate,
            });
          }

          const monthlyArrears = payment.arrears || 0;
          if (monthlyArrears > 0) {
            arrearsAmount += monthlyArrears;
          }
        }
      }

      // Update statistics
      pendingPayments.textContent = pendingCount;
      approvedPayments.textContent = approvedCount;
      totalCollected.textContent = `MWK ${collectedAmount.toLocaleString()}`;
      totalArrears.textContent = `MWK ${arrearsAmount.toLocaleString()}`;

      // Display tables
      displayPendingPayments(pendingPaymentsData, groupId);
      displayRecentPayments(recentPaymentsData);

    } catch (error) {
      console.error("Error loading payment data:", error);
      alert("Error loading payment data. Please try again.");
    }
  }

  // Display pending payments
  function displayPendingPayments(payments, groupId) {
    if (payments.length === 0) {
      pendingPaymentsTable.innerHTML = "<p>No pending payments</p>";
      return;
    }

    let tableHTML = `
      <table class="styled-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Payment Type</th>
            <th>Amount</th>
            <th>Submitted</th>
            <th>Proof</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    payments.forEach((payment, index) => {
      const submittedDate = payment.submittedAt 
        ? new Date(payment.submittedAt.toDate ? payment.submittedAt.toDate() : payment.submittedAt).toLocaleDateString() 
        : "N/A";
      
      tableHTML += `
        <tr>
          <td>${payment.memberName}</td>
          <td>${payment.paymentType}</td>
          <td>MWK ${parseFloat(payment.amount || 0).toLocaleString()}</td>
          <td>${submittedDate}</td>
          <td>
            ${payment.proofUrl 
              ? `<a href="${payment.proofUrl}" target="_blank" class="btn-view-proof">View</a>` 
              : "No proof"}
          </td>
          <td>
            <button class="btn-approve-payment" data-index="${index}">Approve</button>
            <button class="btn-reject-payment" data-index="${index}">Reject</button>
          </td>
        </tr>
      `;
    });

    tableHTML += "</tbody></table>";
    pendingPaymentsTable.innerHTML = tableHTML;

    // Add event listeners
    document.querySelectorAll(".btn-approve-payment").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = btn.dataset.index;
        approvePayment(payments[index], groupId);
      });
    });

    document.querySelectorAll(".btn-reject-payment").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = btn.dataset.index;
        rejectPayment(payments[index], groupId);
      });
    });
  }

  // Display recent payments
  function displayRecentPayments(payments) {
    if (payments.length === 0) {
      recentPaymentsTable.innerHTML = "<p>No recent payments</p>";
      return;
    }

    // Sort by approved date (most recent first)
    payments.sort((a, b) => {
      const dateA = a.approvedAt ? new Date(a.approvedAt.toDate ? a.approvedAt.toDate() : a.approvedAt) : new Date(0);
      const dateB = b.approvedAt ? new Date(b.approvedAt.toDate ? b.approvedAt.toDate() : b.approvedAt) : new Date(0);
      return dateB - dateA;
    });

    // Show only last 10
    const recentPayments = payments.slice(0, 10);

    let tableHTML = `
      <table class="styled-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Payment Type</th>
            <th>Amount</th>
            <th>Approved Date</th>
          </tr>
        </thead>
        <tbody>
    `;

    recentPayments.forEach((payment) => {
      const approvedDate = payment.approvedAt 
        ? new Date(payment.approvedAt.toDate ? payment.approvedAt.toDate() : payment.approvedAt).toLocaleDateString() 
        : "N/A";
      
      tableHTML += `
        <tr>
          <td>${payment.memberName}</td>
          <td>${payment.paymentType}</td>
          <td>MWK ${parseFloat(payment.amount || 0).toLocaleString()}</td>
          <td>${approvedDate}</td>
        </tr>
      `;
    });

    tableHTML += "</tbody></table>";
    recentPaymentsTable.innerHTML = tableHTML;
  }

  // Approve payment
  async function approvePayment(payment, groupId) {
    if (!confirm(`Approve ${payment.paymentType} payment of MWK ${payment.amount} from ${payment.memberName}?`)) {
      return;
    }

    try {
      const paymentRef = doc(db, `groups/${groupId}/payments/${payment.docRef}`);
      
      await updateDoc(paymentRef, {
        approvalStatus: "approved",
        paymentStatus: "Completed",
        approvedAt: Timestamp.now(),
        approvedBy: auth.currentUser.uid,
        updatedAt: Timestamp.now(),
        arrears: 0,
      });

      alert("Payment approved successfully!");
      loadPaymentData(groupId);
    } catch (error) {
      console.error("Error approving payment:", error);
      alert("Error approving payment. Please try again.");
    }
  }

  // Reject payment
  async function rejectPayment(payment, groupId) {
    const reason = prompt(`Reject ${payment.paymentType} payment from ${payment.memberName}?\n\nEnter rejection reason:`);
    
    if (!reason) return;

    try {
      const paymentRef = doc(db, `groups/${groupId}/payments/${payment.docRef}`);
      
      await updateDoc(paymentRef, {
        approvalStatus: "rejected",
        rejectedAt: Timestamp.now(),
        rejectedBy: auth.currentUser.uid,
        rejectionReason: reason,
        updatedAt: Timestamp.now(),
      });

      alert("Payment rejected successfully!");
      loadPaymentData(groupId);
    } catch (error) {
      console.error("Error rejecting payment:", error);
      alert("Error rejecting payment. Please try again.");
    }
  }

  // Group selector change event
  groupSelector.addEventListener("change", (e) => {
    const groupId = e.target.value;
    if (groupId) {
      loadPaymentData(groupId);
    } else {
      pendingPaymentsTable.innerHTML = "<p>Select a group to view pending payments</p>";
      recentPaymentsTable.innerHTML = "<p>Select a group to view recent payments</p>";
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
