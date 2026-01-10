import {
  db,
  auth,
  doc,
  getDoc,
  collection,
  getDocs,
  onAuthStateChanged,
} from "./firebaseConfig.js";

// Ensure user is signed in
onAuthStateChanged(auth, (user) => {
  if (!user) {
    alert("You must be signed in to access this page.");
    window.location.href = "../index.html";
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const groupSelect = document.getElementById("groupSelect");
  const backButton = document.getElementById("backButton");
  
  // Back button navigation
  backButton.addEventListener("click", () => {
    window.location.href = "admin_dashboard.html";
  });

  // Load admin's groups
  async function loadGroups() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const groupsRef = collection(db, "groups");
      const querySnapshot = await getDocs(groupsRef);
      
      groupSelect.innerHTML = '<option value="">Select a group...</option>';
      
      querySnapshot.forEach((docSnapshot) => {
        const groupData = docSnapshot.data();
        const isAdmin = groupData.adminDetails?.some(
          (admin) => admin.email === user.email || admin.uid === user.uid
        );
        
        if (isAdmin) {
          const option = document.createElement("option");
          option.value = docSnapshot.id;
          option.textContent = groupData.groupName;
          groupSelect.appendChild(option);
        }
      });
    } catch (error) {
      console.error("Error loading groups:", error);
      alert("Error loading groups.");
    }
  }

  // Load financial analytics for selected group
  async function loadAnalytics(groupId) {
    if (!groupId) {
      resetAnalytics();
      return;
    }

    try {
      // Fetch group details
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (!groupDoc.exists()) {
        alert("Group not found!");
        return;
      }

      const groupData = groupDoc.data();
      
      // Fetch all members
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      const totalMembers = membersSnapshot.size;
      
      // Calculate financial metrics
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().toLocaleString("default", { month: "long" });
      
      let totalCollected = 0;
      let totalExpected = 0;
      let totalArrears = 0;
      let fullyPaidCount = 0;
      let partiallyPaidCount = 0;
      let unpaidCount = 0;
      
      const memberPerformance = [];

      // Process each member's payments
      for (const memberDoc of membersSnapshot.docs) {
        const memberData = memberDoc.data();
        const memberId = memberDoc.id;
        
        let memberPaid = 0;
        let memberExpected = 0;
        let memberArrears = 0;

        // Check payments for current month
        const paymentPath = `groups/${groupId}/payments/${currentYear}/${currentMonth}/${memberId}`;
        const paymentDoc = await getDoc(doc(db, paymentPath));
        
        if (paymentDoc.exists()) {
          const paymentData = paymentDoc.data();
          
          // Process all payment types
          if (paymentData.payments) {
            Object.values(paymentData.payments).forEach((payment) => {
              const totalAmount = parseFloat(payment.totalAmount) || 0;
              const paidAmount = parseFloat(payment.paidAmount) || 0;
              const arrears = parseFloat(payment.arrears) || 0;
              
              memberExpected += totalAmount;
              memberPaid += paidAmount;
              memberArrears += arrears;
            });
          }
        } else {
          // If no payment record, use group defaults
          memberExpected = (groupData.seedMoney || 0) + (groupData.monthlyContribution || 0);
          memberArrears = memberExpected;
        }

        totalExpected += memberExpected;
        totalCollected += memberPaid;
        totalArrears += memberArrears;

        // Categorize member payment status
        if (memberPaid >= memberExpected && memberExpected > 0) {
          fullyPaidCount++;
        } else if (memberPaid > 0) {
          partiallyPaidCount++;
        } else {
          unpaidCount++;
        }

        memberPerformance.push({
          name: memberData.fullName,
          expected: memberExpected,
          paid: memberPaid,
          arrears: memberArrears,
          percentage: memberExpected > 0 ? ((memberPaid / memberExpected) * 100).toFixed(1) : 0,
        });
      }

      // Calculate collection rate
      const collectionRate = totalExpected > 0 ? ((totalCollected / totalExpected) * 100).toFixed(1) : 0;

      // Update UI
      document.getElementById("totalCollected").textContent = `MWK ${totalCollected.toFixed(2)}`;
      document.getElementById("totalExpected").textContent = `MWK ${totalExpected.toFixed(2)}`;
      document.getElementById("totalArrears").textContent = `MWK ${totalArrears.toFixed(2)}`;
      document.getElementById("collectionRate").textContent = `${collectionRate}%`;
      
      document.getElementById("fullyPaidCount").textContent = fullyPaidCount;
      document.getElementById("partiallyPaidCount").textContent = partiallyPaidCount;
      document.getElementById("unpaidCount").textContent = unpaidCount;

      // Load member performance table
      loadMemberPerformanceTable(memberPerformance);

      // Load loan analytics
      await loadLoanAnalytics(groupId);

    } catch (error) {
      console.error("Error loading analytics:", error);
      alert("Error loading analytics.");
    }
  }

  // Load member performance table
  function loadMemberPerformanceTable(memberPerformance) {
    const container = document.getElementById("memberPerformanceTable");
    
    if (memberPerformance.length === 0) {
      container.innerHTML = "<p>No member data available</p>";
      return;
    }

    let tableHTML = `
      <table class="performance-table">
        <thead>
          <tr>
            <th>Member Name</th>
            <th>Expected (MWK)</th>
            <th>Paid (MWK)</th>
            <th>Arrears (MWK)</th>
            <th>Payment %</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    memberPerformance.forEach((member) => {
      let status = "unpaid";
      let statusText = "Unpaid";
      
      if (member.percentage >= 100) {
        status = "paid";
        statusText = "Fully Paid";
      } else if (member.percentage > 0) {
        status = "partial";
        statusText = "Partial";
      }

      tableHTML += `
        <tr>
          <td><strong>${member.name}</strong></td>
          <td>MWK ${member.expected.toFixed(2)}</td>
          <td>MWK ${member.paid.toFixed(2)}</td>
          <td>MWK ${member.arrears.toFixed(2)}</td>
          <td>${member.percentage}%</td>
          <td><span class="status-badge ${status}">${statusText}</span></td>
        </tr>
      `;
    });

    tableHTML += `
        </tbody>
      </table>
    `;

    container.innerHTML = tableHTML;
  }

  // Load loan analytics
  async function loadLoanAnalytics(groupId) {
    try {
      const loansRef = collection(db, `groups/${groupId}/loans`);
      const loansSnapshot = await getDocs(loansRef);
      
      let totalLoansIssued = 0;
      let loansRepaid = 0;
      let outstandingLoans = 0;
      const activeBorrowers = new Set();

      for (const loanDoc of loansSnapshot.docs) {
        const loanData = loanDoc.data();
        
        if (loanData.status === "active" || loanData.status === "approved") {
          const loanAmount = parseFloat(loanData.loanAmount) || 0;
          const amountRepaid = parseFloat(loanData.amountRepaid) || 0;
          
          totalLoansIssued += loanAmount;
          loansRepaid += amountRepaid;
          outstandingLoans += (loanAmount - amountRepaid);
          
          if (loanAmount - amountRepaid > 0) {
            activeBorrowers.add(loanData.userId);
          }
        }
      }

      document.getElementById("totalLoansIssued").textContent = `MWK ${totalLoansIssued.toFixed(2)}`;
      document.getElementById("loansRepaid").textContent = `MWK ${loansRepaid.toFixed(2)}`;
      document.getElementById("outstandingLoans").textContent = `MWK ${outstandingLoans.toFixed(2)}`;
      document.getElementById("activeBorrowers").textContent = activeBorrowers.size;

    } catch (error) {
      console.error("Error loading loan analytics:", error);
    }
  }

  // Reset analytics display
  function resetAnalytics() {
    const updates = {
      totalCollected: "MWK 0.00",
      totalExpected: "MWK 0.00",
      totalArrears: "MWK 0.00",
      collectionRate: "0%",
      fullyPaidCount: "0",
      partiallyPaidCount: "0",
      unpaidCount: "0",
      totalLoansIssued: "MWK 0.00",
      loansRepaid: "MWK 0.00",
      outstandingLoans: "MWK 0.00",
      activeBorrowers: "0"
    };
    
    Object.keys(updates).forEach(id => {
      const element = document.getElementById(id);
      if (element) element.textContent = updates[id];
    });
    
    document.getElementById("memberPerformanceTable").innerHTML = "<p>Select a group to view member performance</p>";
  }

  // Group selection change handler
  groupSelect.addEventListener("change", (e) => {
    loadAnalytics(e.target.value);
  });

  // Initialize
  await loadGroups();
});
