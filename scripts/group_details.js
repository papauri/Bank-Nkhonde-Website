import {
  db,
  auth,
  doc,
  getDoc,
  collection,
  getDocs,
  onAuthStateChanged,
} from "./firebaseConfig.js";

// ✅ Ensure the user is signed in before accessing the group page
onAuthStateChanged(auth, (user) => {
  if (!user) {
    alert("You must be signed in to access this page.");
    window.location.href = "/login.html";
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const groupId = urlParams.get("groupId");

  if (!groupId) {
    alert("Group ID is missing. Redirecting to the admin dashboard...");
    window.location.href = "../index.html";
    return;
  }

  // ✅ Select DOM elements for group details
  const groupNameField = document.getElementById("groupName");
  const groupCreatedField = document.getElementById("groupCreated");
  const seedMoneyField = document.getElementById("seedMoney");
  const interestRateField = document.getElementById("interestRate");
  const monthlyContributionField = document.getElementById("monthlyContribution");
  const loanPenaltyField = document.getElementById("loanPenalty");
  const monthlyPenaltyField = document.getElementById("monthlyPenalty");
  const groupMembersCountField = document.getElementById("groupMembersCount");

  // ✅ Select DOM elements for payments
  const confirmedPaymentsContainer = document.getElementById("confirmedPaymentsContainer");
  const pendingApprovalContainer = document.getElementById("pendingApprovalContainer");
  const unpaidContributionsContainer = document.getElementById("unpaidContributionsContainer");
  const backButton = document.getElementById("backButton");

  // 🔹 Fetch Group Details
  async function fetchGroupDetails(groupId) {
    try {
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (!groupDoc.exists()) {
        alert("Group not found!");
        return;
      }

      const groupData = groupDoc.data();

      // ✅ Populate Group Information Fields
      groupNameField.textContent = groupData.groupName || "N/A";
      groupCreatedField.textContent = groupData.createdAt
        ? new Date(groupData.createdAt.toDate()).toLocaleDateString()
        : "N/A";
      seedMoneyField.textContent = `MWK ${groupData.seedMoney?.toFixed(2) || "0.00"}`;
      interestRateField.textContent = `${groupData.interestRate?.toFixed(2) || "0.00"}%`;
      monthlyContributionField.textContent = `MWK ${groupData.monthlyContribution?.toFixed(2) || "0.00"}`;
      loanPenaltyField.textContent = `${groupData.loanPenalty?.toFixed(2) || "0.00"}%`;
      monthlyPenaltyField.textContent = `${groupData.monthlyPenalty?.toFixed(2) || "0.00"}%`;

      // ✅ Fetch and Display Number of Members
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      groupMembersCountField.textContent = membersSnapshot.size || "0";
    } catch (error) {
      console.error("❌ Error fetching group details:", error.message);
      alert("An error occurred while fetching group details.");
    }
  }

  // ✅ Helper Function: Format Numbers to Two Decimals
  function formatToTwoDecimals(value) {
    return value ? parseFloat(value).toFixed(2) : "0.00";
  }


// 🔹 Fetch Payments for the Current Month
// 🔹 Fetch Payments for the Current Month
async function fetchPayments(groupId) {
  try {
    const currentMonth = new Date().toLocaleString("default", { month: "long" });
    const currentYear = new Date().getFullYear();

    const groupDoc = await getDoc(doc(db, "groups", groupId));
    if (!groupDoc.exists()) {
      alert("Group not found!");
      return;
    }

    const { monthlyPenalty } = groupDoc.data();

    // ✅ Fetch Members
    const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
    const members = membersSnapshot.docs.map((doc) => ({
      uid: doc.id,
      fullName: doc.data().fullName.replace(/\s+/g, "_"),
    }));

    if (members.length === 0) {
      confirmedPaymentsContainer.innerHTML = `<p>No confirmed payments found for ${currentMonth}.</p>`;
      return;
    }

    // ✅ Fetch and Filter Only the Confirmed Payments for the Current Month
    const confirmedPayments = await fetchConfirmedPayments(groupId, members, currentYear, currentMonth);

    // ✅ Populate the UI
    populateConfirmedPayments(confirmedPayments, confirmedPaymentsContainer, currentMonth);

  } catch (error) {
    console.error("❌ Error fetching payments:", error.message);
    alert("An error occurred while fetching payments.");
  }
}

// 🔹 Fetch Confirmed Payments for the Current Month
async function fetchConfirmedPayments(groupId, members, year, month) {
  const confirmedPayments = [];

  for (const member of members) {
    const { uid, fullName } = member;

    const monthDocRef = doc(
      db,
      `groups/${groupId}/payments/${year}_MonthlyContributions/${fullName}/${year}_${month}`
    );
    const monthDoc = await getDoc(monthDocRef);

    if (monthDoc.exists()) {
      const paymentData = monthDoc.data();

      // ✅ Check if the payment is fully approved
      if (paymentData.paymentStatus === "Completed") {
        confirmedPayments.push({
          fullName,
          totalPaid: formatToTwoDecimals(paymentData.totalAmount),
          paymentDate: paymentData.paid?.length
            ? formatFriendlyDate(paymentData.paid[paymentData.paid.length - 1].paymentDate)
            : "N/A",
          method: paymentData.paid?.length ? paymentData.paid[paymentData.paid.length - 1].method : "Unknown",
        });
      }
    }
  }

  return confirmedPayments;
}

// 🔹 Display Confirmed Payments in a Compact One-Liner Format
function populateConfirmedPayments(payments, container, currentMonth) {
  container.innerHTML = `<h3 class="confirmed-payments-header">Confirmed Payments for ${currentMonth}</h3>`;

  if (!payments.length) {
    container.innerHTML += `<p>No confirmed payments recorded for this month.</p>`;
    return;
  }

  payments.forEach((data) => {
    const paymentRow = document.createElement("div");
    paymentRow.classList.add("payment-card");

    paymentRow.innerHTML = `
      <span class="member-name">${data.fullName.replace(/_/g, " ")}</span> 
      <span class="payment-amount">MWK ${data.totalPaid}</span> 
      <span class="payment-method">(${data.method})</span> 
      <span class="payment-date">on ${data.paymentDate}</span>
    `;

    container.appendChild(paymentRow);
  });
}

// ✅ Helper Function: Format Numbers to Two Decimals
function formatToTwoDecimals(value) {
  return value ? parseFloat(value).toFixed(2) : "0.00";
}

// ✅ Helper Function: Format Dates Dynamically
function formatFriendlyDate(date) {
  if (!date) return "N/A";
  const parsedDate = typeof date.toDate === "function" ? date.toDate() : new Date(date);
  return parsedDate.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ✅ Initialize Fetch
fetchGroupDetails(groupId);
fetchPayments(groupId);


// 🔹 Fetch Confirmed Payments for the Current Month
async function fetchConfirmedPayments(groupId, members, year, month) {
  const confirmedPayments = [];

  for (const member of members) {
    const { uid, fullName } = member;

    const monthDocRef = doc(
      db,
      `groups/${groupId}/payments/${year}_MonthlyContributions/${fullName}/${year}_${month}`
    );
    const monthDoc = await getDoc(monthDocRef);

    if (monthDoc.exists()) {
      const paymentData = monthDoc.data();

      // ✅ Check if the payment is fully approved
      if (paymentData.paymentStatus === "Completed") {
        confirmedPayments.push({
          fullName,
          totalPaid: formatToTwoDecimals(paymentData.totalAmount),
          paymentDate: paymentData.paid?.length
            ? formatFriendlyDate(paymentData.paid[paymentData.paid.length - 1].paymentDate)
            : "N/A",
          method: paymentData.paid?.length ? paymentData.paid[paymentData.paid.length - 1].method : "Unknown",
        });
      }
    }
  }

  return confirmedPayments;
}

// 🔹 Fetch Unpaid Contributions for the Current Month
async function fetchUnpaidContributions(groupId) {
  try {
    const currentMonth = new Date().toLocaleString("default", { month: "long" });
    const currentYear = new Date().getFullYear();

    const groupDoc = await getDoc(doc(db, "groups", groupId));
    if (!groupDoc.exists()) {
      alert("Group not found!");
      return;
    }

    const { monthlyContribution, monthlyPenalty } = groupDoc.data();

    // ✅ Fetch Members
    const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
    const members = membersSnapshot.docs.map((doc) => ({
      uid: doc.id,
      fullName: doc.data().fullName.replace(/\s+/g, "_"),
    }));

    if (members.length === 0) {
      unpaidContributionsContainer.innerHTML = `<p>No unpaid contributions found for ${currentMonth}.</p>`;
      return;
    }

    let unpaidContributions = [];

    for (const member of members) {
      const { fullName } = member;

      const paymentRef = doc(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${fullName}/${currentYear}_${currentMonth}`);
      const paymentDoc = await getDoc(paymentRef);

      if (!paymentDoc.exists() || !paymentDoc.data().paid || paymentDoc.data().paid.length === 0) {
        // ✅ If no payment exists OR no valid payments were recorded, mark as unpaid
        unpaidContributions.push({
          fullName: fullName.replace(/_/g, " "),
          amountDue: formatToTwoDecimals(monthlyContribution),
          penalty: formatToTwoDecimals(monthlyContribution * (monthlyPenalty / 100)),
          totalDue: formatToTwoDecimals(monthlyContribution + (monthlyContribution * (monthlyPenalty / 100))),
          status: "Unpaid",
        });
      }
    }

    // ✅ Populate the UI
    populateUnpaidContributions(unpaidContributions, unpaidContributionsContainer, currentMonth);

  } catch (error) {
    console.error("❌ Error fetching unpaid contributions:", error.message);
    alert("An error occurred while fetching unpaid contributions.");
  }
}

// 🔹 Display Unpaid Contributions in a Compact One-Liner Format
function populateUnpaidContributions(unpaidContributions, container, currentMonth) {
  container.innerHTML = `<h3>Unpaid Contributions for ${currentMonth}</h3>`;

  if (!unpaidContributions.length) {
    container.innerHTML += `<p>All members have contributed for this month!</p>`;
    return;
  }

  unpaidContributions.forEach((data) => {
    const unpaidRow = document.createElement("div");
    unpaidRow.classList.add("payment-row", "unpaid");

    unpaidRow.innerHTML = `
      <span class="member-name">${data.fullName}</span> 
      <span class="amount">MWK ${data.amountDue}</span> 
      <span class="penalty">Penalty: MWK ${data.penalty}</span>
      <span class="total-due">Total Due: MWK ${data.totalDue}</span> 
      <span class="status">${data.status}</span>
    `;

    container.appendChild(unpaidRow);
  });
}

// ✅ Initialize Fetch
fetchUnpaidContributions(groupId);


// 🔹 Display Confirmed Payments in a Compact One-Liner Format
function populateConfirmedPayments(payments, container, currentMonth) {
  container.innerHTML = `<h3>Confirmed Payments for ${currentMonth}</h3>`;

  if (!payments.length) {
    container.innerHTML += `<p>No confirmed payments recorded for this month.</p>`;
    return;
  }

  payments.forEach((data) => {
    const paymentRow = document.createElement("div");
    paymentRow.classList.add("payment-row");

    paymentRow.innerHTML = `
      <span class="member-name">${data.fullName.replace(/_/g, " ")}</span> 
      <span class="amount">MWK ${data.totalPaid}</span> 
      <span class="method">(${data.method})</span> 
      <span class="date">on ${data.paymentDate}</span>
    `;

    container.appendChild(paymentRow);
  });
}

// ✅ Helper Function: Format Dates Dynamically
function formatFriendlyDate(date) {
  if (!date) return "N/A";

  const parsedDate = typeof date.toDate === "function" ? date.toDate() : new Date(date);
  
  return parsedDate.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

  // ✅ Initialize Fetch
  fetchGroupDetails(groupId);
  fetchPayments(groupId);

  // ✅ Back Button Event Listener
  backButton.addEventListener("click", () => {
    window.location.href = "admin_dashboard.html";
  });
});
