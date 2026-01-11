import {
  db,
  auth,  // ✅ Add this line
  doc,
  getDoc,
  collection,
  getDocs,
  updateDoc,
  arrayUnion,
  ref,
  uploadBytes,
  getDownloadURL,
  storage,
} from "./firebaseConfig.js";



// Helper Function: Format Numbers to Two Decimals
function formatToTwoDecimals(value) {
  return value ? parseFloat(value).toFixed(2) : "0.00";
}

// Helper Function: Format Dates Dynamically
function formatFriendlyDate(date) {
  if (!date) return "N/A";
  const parsedDate = typeof date.toDate === "function" ? date.toDate() : new Date(date);
  return parsedDate.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ✅ Display Monthly Contributions with Correct Data Structure
async function displayMonthlyContributions(groupId) {
  try {
    const membersListContainer = document.getElementById("membersList");
    membersListContainer.innerHTML = ""; // Clear existing content

    // ✅ Fetch Group Details
    const groupRef = doc(db, "groups", groupId);
    const groupSnapshot = await getDoc(groupRef);

    if (!groupSnapshot.exists()) {
      throw new Error(`Group with ID ${groupId} does not exist.`);
    }

    const groupData = groupSnapshot.data();
    const monthlyPenaltyRate = parseFloat(groupData.monthlyPenalty || 0);

    // ✅ Fetch Members First
    const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
    const members = membersSnapshot.docs.map((doc) => ({
      uid: doc.id,
      fullName: doc.data().fullName,
    }));

    if (!members.length) {
      throw new Error("No members found in this group.");
    }

    // ✅ Fetch All Payments (Loop through each member)
    const currentYear = new Date().getFullYear();
    let allPayments = [];

    for (const member of members) {
      const sanitizedFullName = member.fullName.replace(/\s+/g, "_");

      const monthlyPaymentsRef = collection(
        db,
        `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${sanitizedFullName}`
      );
      const monthlyPaymentsSnapshot = await getDocs(monthlyPaymentsRef);

      if (!monthlyPaymentsSnapshot.empty) {
        monthlyPaymentsSnapshot.forEach((doc) => {
          allPayments.push({
            userId: member.uid,
            fullName: member.fullName,
            month: doc.id,
            ...doc.data(),
          });
        });
      }
    }

    // ✅ Update UI: Generate Member List with Click Event
    members.forEach((member) => {
      const memberButton = document.createElement("button");
      memberButton.textContent = member.fullName || "Unknown";
      memberButton.classList.add("member-button");
      memberButton.addEventListener("click", () =>
        displayMemberData(member, allPayments, monthlyPenaltyRate, groupId)
      );
      membersListContainer.appendChild(memberButton);
    });

  } catch (error) {
    console.error(`❌ Error displaying Monthly Contributions: ${error.message}`);
    alert(`Error: ${error.message}`);
  }
}

// ✅ Display Individual Member Contributions
async function displayMemberData(member, allPayments, monthlyPenaltyRate, groupId) {
  try {
    const memberDataContainer = document.getElementById("memberDataContainer");
    const memberTableContainer = document.getElementById("memberTableContainer");
    const manualPaymentContainer = document.getElementById("manualPaymentContainer");
    const memberNameElement = document.getElementById("memberName");

    // Toggle visibility: If already visible and same member clicked, close the container
    if (memberDataContainer.dataset.activeMember === member.uid) {
      memberDataContainer.style.display = memberDataContainer.style.display === "block" ? "none" : "block";
      return;
    }

    // Store the active member's UID
    memberDataContainer.dataset.activeMember = member.uid;

    // Clear previous data
    memberTableContainer.innerHTML = "";
    manualPaymentContainer.innerHTML = "";
    memberNameElement.textContent = member.fullName || "Unknown";
    memberDataContainer.style.display = "block";

    // ✅ Filter & Sort Payments for Selected Member
    const memberPayments = allPayments
      .filter((p) => p.userId === member.uid)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    if (!memberPayments.length) {
      memberTableContainer.innerHTML = "<p>No payment records found for this member.</p>";
      return;
    }

    let totalArrears = 0;
    let totalPenalties = 0;
    let totalPaid = 0;
    let totalSurplus = 0;

    // ✅ Prepare Table Data
    const tableData = memberPayments.map((payment) => {
      const dueDate = payment.dueDate ? new Date(payment.dueDate.toDate()) : null;
      const now = new Date();

      const totalPaidRow = Array.isArray(payment.paid)
        ? payment.paid.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0)
        : 0;

      const arrears = Math.max(payment.totalAmount - totalPaidRow, 0);
      const penalty = arrears > 0 && dueDate && now > dueDate ? arrears * (monthlyPenaltyRate / 100) : 0;
      const totalDue = arrears + penalty;
      const surplus = Math.max(totalPaidRow - payment.totalAmount - penalty, 0);

      const paymentMethods = Array.isArray(payment.paid)
        ? [...new Set(payment.paid.map((p) => p.method || "Unknown"))].join(", ")
        : "No Payments";

      // Accumulate totals
      totalArrears += arrears;
      totalPenalties += penalty;
      totalPaid += totalPaidRow;
      totalSurplus += surplus;

      return {
        month: payment.month,
        dueDate: dueDate ? dueDate.toLocaleDateString("en-US") : "N/A",
        arrears: formatToTwoDecimals(arrears),
        penalties: formatToTwoDecimals(penalty),
        surplus: formatToTwoDecimals(surplus),
        totalPaid: formatToTwoDecimals(totalPaidRow),
        paymentMethods,
        totalDue: formatToTwoDecimals(totalDue),
        paymentDetails: formatPaymentDetails(payment.paid || []),
        status: arrears > 0 ? "Pending" : "Completed",
      };
    });

    // ✅ Add Totals Row
    tableData.push({
      month: "Total",
      dueDate: "",
      arrears: formatToTwoDecimals(totalArrears),
      penalties: formatToTwoDecimals(totalPenalties),
      surplus: formatToTwoDecimals(totalSurplus),
      totalPaid: formatToTwoDecimals(totalPaid),
      paymentMethods: "",
      totalDue: "",
      paymentDetails: "",
      status: "",
    });

    // ✅ Render Table
    new Handsontable(memberTableContainer, {
      data: tableData,
      colHeaders: [
        "Month",
        "Due Date",
        "Arrears (MWK)",
        "Penalties (MWK)",
        "Surplus (MWK)",
        "Total Paid (MWK)",
        "Payment Details",
        "Payment Status",
      ],
      columns: [
        { data: "month", type: "text", readOnly: true },
        { data: "dueDate", type: "text", readOnly: true },
        { data: "arrears", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "penalties", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "surplus", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "totalPaid", type: "numeric", format: "0,0.00", readOnly: true },
        {
          data: "paymentDetails",
          type: "text",
          readOnly: true,
          renderer: (instance, td, row, col, prop, value) => {
            td.innerHTML = value.replace(/\n/g, "<br>");
            td.style.whiteSpace = "pre-wrap";
          },
        },
        {
          data: "status",
          type: "dropdown",
          source: ["Pending", "Completed"],
        },
      ],
      width: "100%",
      height: "auto",
      stretchH: "all",
      licenseKey: "non-commercial-and-evaluation",
    });

    // ✅ Display Manual Payment Form
    createPaymentForm(manualPaymentContainer, member, groupId, tableData, () =>
      displayMemberData(member, allPayments, monthlyPenaltyRate, groupId)
    );

  } catch (error) {
    console.error(`❌ Error displaying member data: ${error.message}`);
    alert(`Error: ${error.message}`);
  }
}

// ✅ Create & Display Manual Payment Form
function createPaymentForm(container, member, groupId, tableData, reloadTable) {
  container.innerHTML = ""; // Clear previous form

  const form = document.createElement("form");
  form.className = "manual-payment-form";

  // ✅ Heading & Instructions
  form.innerHTML = `
    <h3 class="manual-payment-heading">Submit a Manual Payment for ${member.fullName || "Unknown Member"}</h3>
    <p class="manual-payment-instructions">
      Use this form to record a manual payment. Ensure the amount matches proof of payment.
    </p>
  `;

  // ✅ Select Month
  const monthSelect = document.createElement("select");
  monthSelect.className = "manual-payment-month-select";
  monthSelect.required = true;

  let firstMonth = "";
  let firstTotalDue = "0.00";

  tableData.forEach((row, index) => {
    if (row.month !== "Total") {
      const option = document.createElement("option");
      option.value = row.month;
      option.textContent = row.month;
      option.dataset.totalDue = row.totalDue || "0.00";

      if (index === 0) {
        // ✅ Store first month for auto-selection
        firstMonth = row.month;
        firstTotalDue = row.totalDue || "0.00";
        option.selected = true;
      }

      monthSelect.appendChild(option);
    }
  });

  // ✅ Total Due Display
  const totalDueDisplay = document.createElement("input");
  totalDueDisplay.type = "text";
  totalDueDisplay.readOnly = true;
  totalDueDisplay.className = "manual-payment-total-due";
  totalDueDisplay.value = firstTotalDue;

  // ✅ Payment Amount Input
  const paymentAmountInput = document.createElement("input");
  paymentAmountInput.type = "number";
  paymentAmountInput.step = "0.01";
  paymentAmountInput.className = "manual-payment-input";
  paymentAmountInput.value = firstTotalDue;

  // ✅ Payment Method Dropdown
  const paymentMethods = ["Cash", "Bank Transfer", "Mobile Money", "PayPal", "Crypto"];
  const paymentMethodSelect = document.createElement("select");
  paymentMethodSelect.className = "manual-payment-select";
  paymentMethodSelect.required = true;

  paymentMethods.forEach((method) => {
    const option = document.createElement("option");
    option.value = method;
    option.textContent = method;
    paymentMethodSelect.appendChild(option);
  });

  // ✅ Proof of Payment Upload
  const proofInput = document.createElement("input");
  proofInput.type = "file";
  proofInput.accept = "image/*";
  proofInput.required = true;
  proofInput.className = "manual-payment-file";

  const proofLabel = document.createElement("label");
  proofLabel.textContent = "Upload Proof of Payment:";
  proofLabel.className = "manual-payment-proof-label";

  // ✅ Submit Button
  const submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.textContent = "Submit Payment";
  submitButton.className = "manual-payment-submit";

  // ✅ Append Elements to Form
  form.appendChild(document.createElement("label").appendChild(document.createTextNode("Select Month:")));
  form.appendChild(monthSelect);
  form.appendChild(document.createElement("label").appendChild(document.createTextNode("Total Due (MWK):")));
  form.appendChild(totalDueDisplay);
  form.appendChild(document.createElement("label").appendChild(document.createTextNode("Payment Amount (MWK):")));
  form.appendChild(paymentAmountInput);
  form.appendChild(document.createElement("label").appendChild(document.createTextNode("Payment Method:")));
  form.appendChild(paymentMethodSelect);
  form.appendChild(proofLabel);
  form.appendChild(proofInput);
  form.appendChild(submitButton);
  container.appendChild(form);

  // ✅ Auto-populate Total Due when selecting a month
  monthSelect.addEventListener("change", () => {
    const selectedOption = monthSelect.options[monthSelect.selectedIndex];
    totalDueDisplay.value = selectedOption.dataset.totalDue || "0.00";
    paymentAmountInput.value = totalDueDisplay.value;
  });

  // ✅ Show file name when proof is uploaded
  proofInput.addEventListener("change", (event) => {
    if (event.target.files.length) {
      proofLabel.textContent = `Proof Uploaded: ${event.target.files[0].name}`;
    }
  });

  // ✅ Handle Form Submission
  // ✅ Handle Form Submission
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
  
    const selectedMonth = monthSelect.value;
    const amount = parseFloat(paymentAmountInput.value) || parseFloat(totalDueDisplay.value);
    const method = paymentMethodSelect.value;
    const proofFile = proofInput.files[0];
  
    console.log("🔹 DEBUG: Selected Month:", selectedMonth);
    console.log("🔹 DEBUG: Amount:", amount);
    console.log("🔹 DEBUG: Method:", method);
    console.log("🔹 DEBUG: Proof File:", proofFile ? proofFile.name : "No File Selected");
  
    // ✅ Ensure all fields are filled
    if (!selectedMonth || !amount || !method || !proofFile) {
      alert("⚠️ Please fill all fields, select a valid month, and upload proof of payment.");
      console.error("❌ ERROR: Missing required fields.");
      return;
    }
  
    try {
      submitButton.textContent = "Submitting...";
      submitButton.disabled = true;
  
      // ✅ Upload Proof of Payment
      const proofFileName = `${member.uid}-${Date.now()}`;
      const proofStorageRef = ref(storage, `proofs/${proofFileName}`);
      await uploadBytes(proofStorageRef, proofFile);
      const proofURL = await getDownloadURL(proofStorageRef);
  
      // ✅ Fetch Payment Record
      const currentYear = new Date().getFullYear();
      const sanitizedFullName = member.fullName.replace(/\s+/g, "_");
  
      const paymentRef = doc(
        db,
        `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${sanitizedFullName}/${selectedMonth}`
      );
  
      const paymentDoc = await getDoc(paymentRef);
  
      if (!paymentDoc.exists()) {
        alert("⚠️ Payment record not found. Please refresh and try again.");
        return;
      }
  
      const paymentData = paymentDoc.data();
      const totalPaidSoFar = paymentData.paid?.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0;
      const totalAmountDue = paymentData.totalAmount || 0;
      const newTotalPaid = totalPaidSoFar + amount;
      const newArrears = Math.max(totalAmountDue - newTotalPaid, 0);
      const newPaymentStatus = newArrears === 0 ? "Completed" : "Pending";
  
      // ✅ Fetch Admin Name
      const adminDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
      const adminName = adminDoc.exists() ? adminDoc.data().fullName : "Unknown Admin";
  
      // ✅ Update Firestore with New Payment Data
      await updateDoc(paymentRef, {
        paid: arrayUnion({
          month: selectedMonth, // ✅ Store the selected month in Firestore
          amount: formatToTwoDecimals(amount),
          paymentDate: new Date().toISOString(),
          approvedBy: adminName,
          approvalDate: new Date().toISOString(),
          method,
          proofURL,
          approvalStatus: true, // Auto-approved since it's an admin payment
        }),
        arrears: formatToTwoDecimals(newArrears), // ✅ Update arrears
        paymentStatus: newPaymentStatus, // ✅ Update status
        approvalStatus: true, // ✅ Mark as approved
        updatedAt: new Date(),
      });
  
      alert(`✅ Payment for ${selectedMonth} submitted successfully!`);
      reloadTable();
    } catch (error) {
      console.error("❌ Error submitting payment:", error);
      alert(`⚠️ Error submitting payment: ${error.message}`);
    } finally {
      submitButton.textContent = "Submit Payment";
      submitButton.disabled = false;
    }
  });
  
}

// Format Payment Details with Payment Date and Method
function formatPaymentDetails(payments) {
  if (!Array.isArray(payments) || payments.length === 0) {
    return "No payments recorded.";
  }

  return payments
    .map((payment, index) => {
      const ordinal = getOrdinal(index + 1); // 1st, 2nd, etc.
      const amount = formatToTwoDecimals(payment.amount || 0);
      const paymentDate = payment.paymentDate
        ? formatFriendlyDate(payment.paymentDate)
        : "Not Provided";
      const method = payment.method || "Not Specified";
      return `${ordinal}: Paid ${amount} on ${paymentDate} via ${method}`;
    })
    .join("\n");
}

// Helper Function: Get Ordinal Indicator (1st, 2nd, etc.)
function getOrdinal(n) {
  const suffixes = ["th", "st", "nd", "rd"];
  const value = n % 100;
  return n + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
}

// ✅ Display Seed Money Table
async function displaySeedMoney(groupId) {
  try {
    const seedMoneyContainer = document.getElementById("seedMoneyContainer");

    if (!seedMoneyContainer) {
      throw new Error("Seed Money container not found in the DOM.");
    }

    // ✅ Fetch Members
    const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
    const members = membersSnapshot.docs.map((doc) => ({
      uid: doc.id,
      fullName: doc.data().fullName || "Unknown",
    }));

    if (members.length === 0) {
      seedMoneyContainer.innerHTML = `<p>No members found.</p>`;
      return;
    }

    // ✅ Fetch Seed Money Payments for Each Member
    const currentYear = new Date().getFullYear();
    const seedMoneyData = [];

    for (const member of members) {
      const paymentRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${member.uid}/PaymentDetails`);
      const paymentDoc = await getDoc(paymentRef);

      if (paymentDoc.exists()) {
        const payment = paymentDoc.data();
        const totalPaid = payment.paid?.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0;
        const arrears = Math.max(payment.totalAmount - totalPaid, 0);

        seedMoneyData.push({
          memberName: member.fullName,
          totalAmount: formatToTwoDecimals(payment.totalAmount),
          paid: formatToTwoDecimals(totalPaid),
          arrears: formatToTwoDecimals(arrears),
          dueDate: payment.dueDate ? formatFriendlyDate(payment.dueDate) : "N/A",
          paymentDate: payment.paid?.length ? formatFriendlyDate(payment.paid[payment.paid.length - 1].paymentDate) : "N/A",
          status: arrears > 0 ? "Pending" : "Completed",
        });
      }
    }

    if (seedMoneyData.length === 0) {
      seedMoneyContainer.innerHTML = `<p>No seed money records found.</p>`;
      return;
    }

    // ✅ Determine Display Mode (Mobile or Desktop)
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      seedMoneyContainer.innerHTML = ""; // Clear existing content

      seedMoneyData.forEach((data) => {
        const card = document.createElement("div");
        card.classList.add("seed-money-card");

        card.innerHTML = `
          <div class="card-header">
            <h4>${data.memberName}</h4>
          </div>
          <div class="card-body">
            <p><strong>Total Amount:</strong> ${data.totalAmount} MK</p>
            <p><strong>Paid:</strong> ${data.paid} MK</p>
            <p><strong>Arrears:</strong> ${data.arrears} MK</p>
            <p><strong>Due Date:</strong> ${data.dueDate}</p>
            <p><strong>Payment Date:</strong> ${data.paymentDate}</p>
            <p><strong>Status:</strong> ${data.status}</p>
          </div>
        `;
        seedMoneyContainer.appendChild(card);
      });
    } else {
      // ✅ Render Handsontable for Desktop View
      new Handsontable(seedMoneyContainer, {
        data: seedMoneyData,
        colHeaders: [
          "Member Name",
          "Total Amount (MWK)",
          "Paid (MWK)",
          "Arrears (MWK)",
          "Due Date",
          "Payment Date",
          "Status",
        ],
        columns: [
          { data: "memberName", type: "text", readOnly: true },
          { data: "totalAmount", type: "numeric", format: "0,0.00", readOnly: true },
          { data: "paid", type: "numeric", format: "0,0.00", readOnly: true },
          { data: "arrears", type: "numeric", format: "0,0.00", readOnly: true },
          { data: "dueDate", type: "text", readOnly: true },
          { data: "paymentDate", type: "text", readOnly: true },
          {
            data: "status",
            type: "dropdown",
            source: ["Pending", "Completed"],
          },
        ],
        width: "100%",
        height: 300,
        stretchH: "all",
        licenseKey: "non-commercial-and-evaluation",
      });
    }
  } catch (error) {
    console.error(`❌ Error displaying Seed Money: ${error.message}`);
    alert(`Error: ${error.message}`);
  }
}


// Page Load Logic
document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const groupId = urlParams.get("groupId");

  if (!groupId) {
    alert("Group ID is missing. Redirecting to the admin dashboard...");
    window.location.href = "../login.html";
    return;
  }

  await displayMonthlyContributions(groupId);
  await displaySeedMoney(groupId);
});