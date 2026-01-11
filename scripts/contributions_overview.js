import {
  db,
  auth,
  collection,
  getDocs,
  doc,
  getDoc,
  onAuthStateChanged,
} from "./firebaseConfig.js";

document.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("backButton");
  const groupSelector = document.getElementById("groupSelector");
  const monthSelector = document.getElementById("monthSelector");
  const contributionsTable = document.getElementById("contributionsTable");
  
  // Statistics elements
  const totalExpected = document.getElementById("totalExpected");
  const totalCollected = document.getElementById("totalCollected");
  const totalPending = document.getElementById("totalPending");
  const totalArrears = document.getElementById("totalArrears");
  const complianceRate = document.getElementById("complianceRate");

  // Navigate back
  backButton.addEventListener("click", () => {
    window.location.href = "admin_dashboard.html";
  });

  // Populate month selector
  function populateMonthSelector() {
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const currentYear = new Date().getFullYear();
    
    monthSelector.innerHTML = '<option value="">Select Month...</option>';
    
    months.forEach((month, index) => {
      const option = document.createElement("option");
      option.value = `${currentYear}_${month}`;
      option.textContent = `${month} ${currentYear}`;
      
      // Select current month by default
      if (index === new Date().getMonth()) {
        option.selected = true;
      }
      
      monthSelector.appendChild(option);
    });
  }

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

  // Load contribution data
  async function loadContributionData(groupId, monthId) {
    try {
      const [year, month] = monthId.split("_");
      
      // Get group data for contribution amount
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      const groupData = groupDoc.data();
      const contributionAmount = groupData.rules?.monthlyContribution?.amount || 0;

      // Get members
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      const totalMembers = membersSnapshot.size;

      let expectedAmount = totalMembers * contributionAmount;
      let collectedAmount = 0;
      let pendingAmount = 0;
      let arrearsAmount = 0;
      let paidCount = 0;

      const contributionsData = [];

      for (const memberDoc of membersSnapshot.docs) {
        const member = memberDoc.data();
        const sanitizedName = member.fullName.replace(/\s+/g, "_");

        const paymentRef = doc(db, `groups/${groupId}/payments/${year}_MonthlyContributions/${sanitizedName}/${monthId}`);
        const paymentDoc = await getDoc(paymentRef);

        if (paymentDoc.exists()) {
          const payment = paymentDoc.data();
          const totalPaid = payment.paid?.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0;
          const arrears = payment.arrears || 0;
          const status = payment.paymentStatus || "Unpaid";

          if (status === "Completed" || totalPaid >= contributionAmount) {
            collectedAmount += totalPaid;
            paidCount++;
          } else if (payment.approvalStatus === "pending") {
            pendingAmount += totalPaid;
          }

          arrearsAmount += arrears;

          contributionsData.push({
            memberName: member.fullName,
            expected: contributionAmount,
            paid: totalPaid,
            arrears: arrears,
            status: status,
            dueDate: payment.dueDate ? new Date(payment.dueDate.toDate()).toLocaleDateString() : "N/A",
            paidDate: payment.paid?.[payment.paid.length - 1]?.paymentDate 
              ? new Date(payment.paid[payment.paid.length - 1].paymentDate).toLocaleDateString() 
              : "N/A",
          });
        } else {
          // No payment record - member hasn't paid
          arrearsAmount += contributionAmount;
          contributionsData.push({
            memberName: member.fullName,
            expected: contributionAmount,
            paid: 0,
            arrears: contributionAmount,
            status: "Unpaid",
            dueDate: "N/A",
            paidDate: "N/A",
          });
        }
      }

      // Calculate compliance rate
      const compliance = totalMembers > 0 ? (paidCount / totalMembers) * 100 : 0;

      // Update statistics
      totalExpected.textContent = `MWK ${expectedAmount.toLocaleString()}`;
      totalCollected.textContent = `MWK ${collectedAmount.toLocaleString()}`;
      totalPending.textContent = `MWK ${pendingAmount.toLocaleString()}`;
      totalArrears.textContent = `MWK ${arrearsAmount.toLocaleString()}`;
      complianceRate.textContent = `${compliance.toFixed(1)}%`;

      // Display table
      displayContributionsTable(contributionsData);

    } catch (error) {
      console.error("Error loading contribution data:", error);
      alert("Error loading contribution data. Please try again.");
    }
  }

  // Display contributions table
  function displayContributionsTable(data) {
    if (data.length === 0) {
      contributionsTable.innerHTML = "<p>No contribution data available</p>";
      return;
    }

    // Prepare data for Handsontable
    const tableData = data.map(item => ({
      memberName: item.memberName,
      expected: item.expected.toFixed(2),
      paid: item.paid.toFixed(2),
      arrears: item.arrears.toFixed(2),
      status: item.status,
      dueDate: item.dueDate,
      paidDate: item.paidDate,
    }));

    new Handsontable(contributionsTable, {
      data: tableData,
      colHeaders: [
        "Member Name",
        "Expected (MWK)",
        "Paid (MWK)",
        "Arrears (MWK)",
        "Status",
        "Due Date",
        "Payment Date"
      ],
      columns: [
        { data: "memberName", type: "text", readOnly: true },
        { data: "expected", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "paid", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "arrears", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "status", type: "text", readOnly: true },
        { data: "dueDate", type: "text", readOnly: true },
        { data: "paidDate", type: "text", readOnly: true },
      ],
      width: "100%",
      height: 400,
      stretchH: "all",
      licenseKey: "non-commercial-and-evaluation",
      className: "htCenter htMiddle",
    });
  }

  // Event listeners
  groupSelector.addEventListener("change", () => {
    const groupId = groupSelector.value;
    const monthId = monthSelector.value;
    
    if (groupId && monthId) {
      loadContributionData(groupId, monthId);
    }
  });

  monthSelector.addEventListener("change", () => {
    const groupId = groupSelector.value;
    const monthId = monthSelector.value;
    
    if (groupId && monthId) {
      loadContributionData(groupId, monthId);
    }
  });

  // Initialize
  populateMonthSelector();

  // Authentication
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    await loadAdminGroups(user);
    
    // Auto-load if group is pre-selected
    if (groupSelector.value && monthSelector.value) {
      loadContributionData(groupSelector.value, monthSelector.value);
    }
  });
});
