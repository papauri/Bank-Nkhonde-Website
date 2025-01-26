import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-storage.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";

const auth = getAuth();
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("User is signed in:", user.email);
    if (!user) {
      alert("You must be signed in to access this page.");
      window.location.href = "/login.html"; // Replace with your login page URL
    }
  } else {
    console.log("No user is signed in.");
  }
});
// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyClJfGFoc1WZ_qYi5ImQJXyurQtqXgOqfA",
  authDomain: "banknkonde.firebaseapp.com",
  projectId: "banknkonde",
  storageBucket: "banknkonde.appspot.com",
  messagingSenderId: "698749180404",
  appId: "1:698749180404:web:7e8483cae4abd7555101a1",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app); // Initialize Firebase Storage

// Helper Function: Fetch All Documents from a Collection
async function fetchCollectionData(ref) {
  const snapshot = await getDocs(ref);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

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

// Helper Function: Check if Today is the 1st of January
function isFirstDayOfYear() {
  const today = new Date();
  return today.getDate() === 1 && today.getMonth() === 0;
}

// Delete Payments Data (for yearly reset)
async function deletePaymentsData(groupId) {
  const paymentsRef = collection(db, `groups/${groupId}/payments`);
  const snapshot = await getDocs(paymentsRef);
  const deletePromises = snapshot.docs.map((doc) => deleteDoc(doc.ref));
  await Promise.all(deletePromises);
}

async function displayMonthlyContributions(groupId) {
  try {
    const groupRef = doc(db, "groups", groupId);
    const groupSnapshot = await getDoc(groupRef);

    if (!groupSnapshot.exists()) {
      throw new Error(`Group with ID ${groupId} does not exist.`);
    }

    const groupData = groupSnapshot.data();
    const monthlyPenaltyRate = parseFloat(groupData.monthlyPenalty || 0);

    const membersRef = collection(db, `groups/${groupId}/members`);
    const paymentsRef = collection(db, `groups/${groupId}/payments`);
    const members = await fetchCollectionData(membersRef);
    const payments = await fetchCollectionData(paymentsRef);

    if (!members.length) {
      throw new Error("No members found in this group.");
    }

    const membersListContainer = document.getElementById("membersList");
    membersListContainer.innerHTML = ""; // Clear existing content

    members.forEach((member) => {
      const memberButton = document.createElement("button");
      memberButton.textContent = member.fullName || "Unknown";
      memberButton.classList.add("member-button");
      memberButton.addEventListener("click", () =>
        displayMemberData(member, payments, monthlyPenaltyRate, groupId)
      );
      membersListContainer.appendChild(memberButton);
    });
  } catch (error) {
    console.error(`Error displaying Monthly Contributions: ${error.message}`);
    alert(`Error: ${error.message}`);
  }
}

async function displayMemberData(member, payments, monthlyPenaltyRate, groupId) {
  try {
    const memberDataContainer = document.getElementById("memberDataContainer");
    const memberTableContainer = document.getElementById("memberTableContainer");
    const manualPaymentContainer = document.getElementById("manualPaymentContainer");
    const memberNameElement = document.getElementById("memberName");

    // Clear previous data
    memberTableContainer.innerHTML = "";
    manualPaymentContainer.innerHTML = "";

    memberNameElement.textContent = member.fullName || "Unknown";
    memberDataContainer.style.display = "block";

    // Filter and sort payments for the member
    const memberPayments = payments
      .filter((p) => p.userId === member.uid && p.paymentType === "Monthly Contribution")
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    if (!memberPayments.length) {
      memberTableContainer.innerHTML = "<p>No payment records found for this member.</p>";
      return;
    }

    let totalArrears = 0;
    let totalPenalties = 0;
    let totalDue = 0;
    let totalPaid = 0;

    // Prepare table data
    const tableData = memberPayments.map((payment) => {
      const dueDate = payment.dueDate ? new Date(payment.dueDate) : null;
      const now = new Date();

      const arrears = parseFloat(payment.totalAmount || 0) - (parseFloat(payment.paidAmount || 0) || 0);
      const paid = Array.isArray(payment.paid) ? payment.paid : [];
      const totalPaidRow = paid.reduce((sum, p) => sum + parseFloat(p.amount), 0);

      // Penalty applies only if due date has passed and arrears exist
      const penalty = arrears > 0 && dueDate && now > dueDate ? arrears * (monthlyPenaltyRate / 100) : 0;

      const balance = Math.max(arrears + penalty - totalPaidRow, 0); // Balance ensures it doesn't go negative

      // Accumulate totals
      totalArrears += arrears;
      totalPenalties += penalty;
      totalDue += balance;
      totalPaid += totalPaidRow;

      return {
        month: dueDate ? dueDate.toLocaleString("default", { month: "long", year: "numeric" }) : "Unknown",
        dueDate: dueDate ? dueDate.toLocaleDateString("en-US") : "",
        arrears: formatToTwoDecimals(arrears),
        penalties: formatToTwoDecimals(penalty),
        totalDue: formatToTwoDecimals(balance),
        paid: formatToTwoDecimals(totalPaidRow),
        paymentDetails: formatPaymentDetails(paid),
        paymentMethod: formatPaymentMethods(paid),
        status: balance > 0 ? "Pending" : "Completed",
        paymentId: payment.paymentId,
      };
    });

    // Add Totals Row
    tableData.push({
      month: "Total",
      dueDate: "",
      arrears: formatToTwoDecimals(totalArrears),
      penalties: formatToTwoDecimals(totalPenalties),
      totalDue: formatToTwoDecimals(totalDue),
      paid: formatToTwoDecimals(totalPaid),
      paymentDetails: "",
      paymentMethod: "",
      status: "",
    });

    // Render Handsontable
    new Handsontable(memberTableContainer, {
      data: tableData,
      colHeaders: [
        "Month",
        "Due Date",
        "Arrears (MK)",
        "Penalties (MK)",
        "Total Due (MK)",
        "Total Paid (MK)",
        "Payment Details",
        "Payment Method",
        "Payment Status",
      ],
      columns: [
        { data: "month", type: "text", readOnly: true },
        { data: "dueDate", type: "text", readOnly: true },
        { data: "arrears", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "penalties", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "totalDue", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "paid", type: "numeric", format: "0,0.00", readOnly: true },
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
          data: "paymentMethod",
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
      afterChange: async (changes, source) => {
        if (source === "loadData" || !changes) return;

        for (const [row, prop, oldValue, newValue] of changes) {
          const rowData = tableData[row];
          const paymentRef = doc(db, `groups/${groupId}/payments`, rowData.paymentId);

          if (prop === "status" && newValue === "Completed" && oldValue !== "Completed") {
            try {
              await updateDoc(paymentRef, { status: newValue });
              alert(`Payment status updated successfully.`);
              displayMemberData(member, payments, monthlyPenaltyRate, groupId); // Refresh the table
            } catch (error) {
              alert(`Failed to update payment status: ${error.message}`);
            }
          }
        }
      },
      colWidths: [100, 120, 90, 90, 90, 90, 180, 150, 120],
      height: 'auto',
      width: '100%',
      stretchH: "all",
      licenseKey: "non-commercial-and-evaluation",
    });

    // Display the manual payment form
    createPaymentForm(manualPaymentContainer, member, groupId, tableData, () =>
      displayMemberData(member, payments, monthlyPenaltyRate, groupId)
    );
  } catch (error) {
    console.error(`Error displaying member data: ${error.message}`);
    alert(`Error: ${error.message}`);
  }
}



// Format Payment Methods for Readability
function formatPaymentMethods(payments) {
  return payments
    .map((p, i) => `${getOrdinal(i + 1)}: ${p.method || "Not Specified"}`)
    .join("\n");
}


// Format Payment Details with Payment Date and Method
function formatPaymentDetails(payments) {
  if (!Array.isArray(payments) || payments.length === 0) return "No payments recorded.";

  return payments
    .map((payment, index) => {
      const ordinal = getOrdinal(index + 1);
      const method = payment.method || "Not Specified";
      const paymentDate = payment.paymentDate
        ? formatFriendlyDate(payment.paymentDate)
        : "Not Provided";
      return `${ordinal} Payment: Paid ${formatToTwoDecimals(payment.amount)} on ${paymentDate} (${method})`;
    })
    .join("\n");
}


// Helper Function: Get Ordinal Indicator (1st, 2nd, etc.)
function getOrdinal(n) {
  const suffixes = ["th", "st", "nd", "rd"];
  const value = n % 100;
  return n + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
}


// Create Manual Payment Form
function createPaymentForm(container, member, groupId, tableData, reloadTable) {
  const form = document.createElement("form");
  form.id = "manualPaymentForm";
  form.className = "manual-payment-form";

  // Add explanatory heading
  const heading = document.createElement("h3");
  heading.textContent = `Submit a Manual Payment for ${member.fullName || "Unknown Member"}`;
  heading.className = "manual-payment-heading";

  const instructions = document.createElement("p");
  instructions.textContent =
    "Use this form to record a manual payment. Ensure the payment amount matches the proof of payment.";
  instructions.className = "manual-payment-instructions";

  // Monthly Contribution Selection
  const monthLabel = document.createElement("label");
  monthLabel.textContent = "Select Month for Contribution";
  const monthSelect = document.createElement("select");
  monthSelect.required = true;
  monthSelect.className = "manual-payment-month-select";

  // Populate months dynamically from tableData
  tableData.forEach((row) => {
    if (row.month !== "Total") {
      const option = document.createElement("option");
      option.value = row.month;
      option.textContent = row.month;
      option.dataset.totalDue = row.totalDue || "0.00"; // Attach total due to each option
      monthSelect.appendChild(option);
    }
  });

  // Display Total Due
  const totalDueLabel = document.createElement("label");
  totalDueLabel.textContent = "Total Due (MK)";
  const totalDueDisplay = document.createElement("input");
  totalDueDisplay.type = "text";
  totalDueDisplay.readOnly = true;
  totalDueDisplay.placeholder = "Select a month to see the total due";
  totalDueDisplay.className = "manual-payment-total-due";

  // Payment Amount Input
  const amountLabel = document.createElement("label");
  amountLabel.textContent = "Payment Amount (MK)";
  const paymentAmountInput = document.createElement("input");
  paymentAmountInput.type = "number";
  paymentAmountInput.step = "0.01"; // Allow exact decimals
  paymentAmountInput.placeholder = "Enter amount (default: Total Due)";
  paymentAmountInput.className = "manual-payment-input";

  // Payment Method Dropdown
  const methodLabel = document.createElement("label");
  methodLabel.textContent = "Payment Method";
  const paymentMethodSelect = document.createElement("select");
  paymentMethodSelect.required = true;
  paymentMethodSelect.className = "manual-payment-select";
  ["Select Method", "Cash", "Bank Transfer", "Mobile Money"].forEach((method) => {
    const option = document.createElement("option");
    option.value = method === "Select Method" ? "" : method;
    option.textContent = method;
    paymentMethodSelect.appendChild(option);
  });

  // Proof of Payment File Upload
  const proofLabel = document.createElement("label");
  proofLabel.textContent = "Upload Proof of Payment (e.g., receipt or screenshot)";
  const proofInput = document.createElement("input");
  proofInput.type = "file";
  proofInput.accept = "image/*";
  proofInput.required = true;
  proofInput.className = "manual-payment-file";

  // Submit Button with Spinner
  const submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.textContent = "Submit Payment";
  submitButton.className = "manual-payment-submit";

  const spinner = document.createElement("span");
  spinner.className = "spinner";
  spinner.style.display = "none";
  submitButton.appendChild(spinner);

  // Append All Elements to the Form
  form.appendChild(heading);
  form.appendChild(instructions);
  form.appendChild(monthLabel);
  form.appendChild(monthSelect);
  form.appendChild(totalDueLabel);
  form.appendChild(totalDueDisplay);
  form.appendChild(amountLabel);
  form.appendChild(paymentAmountInput);
  form.appendChild(methodLabel);
  form.appendChild(paymentMethodSelect);
  form.appendChild(proofLabel);
  form.appendChild(proofInput);
  form.appendChild(submitButton);

  // Append Form to the Container
  container.appendChild(form);

  // Auto-populate Total Due and default payment amount on month selection
  monthSelect.addEventListener("change", () => {
    const selectedOption = monthSelect.options[monthSelect.selectedIndex];
    const totalDue = selectedOption.dataset.totalDue || "0.00";
    totalDueDisplay.value = totalDue;
    paymentAmountInput.value = totalDue; // Default the payment amount to Total Due
  });

  // Add submit event listener
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
  
    const selectedMonth = monthSelect.value;
    const amount = parseFloat(paymentAmountInput.value) || parseFloat(totalDueDisplay.value);
    const method = paymentMethodSelect.value;
    const proofFile = proofInput.files[0];
  
    if (!selectedMonth || !amount || !method || !proofFile) {
      alert("Please fill all fields and upload proof of payment.");
      return;
    }
  
    // Show spinner during submission
    spinner.style.display = "inline-block";
    submitButton.disabled = true;
  
    try {
      // Upload proof of payment
      const proofFileName = `${member.uid}-${new Date().getTime()}`;
      const proofStorageRef = ref(storage, `proofs/${proofFileName}`);
      await uploadBytes(proofStorageRef, proofFile);
      const proofURL = await getDownloadURL(proofStorageRef);
  
      // Find the payment entry for the selected month
      const paymentRow = tableData.find((row) => row.month === selectedMonth);
      if (!paymentRow || !paymentRow.paymentId) {
        alert(`No payment entry found for the month: ${selectedMonth}.`);
        return;
      }
  
      const paymentRef = doc(db, `groups/${groupId}/payments`, paymentRow.paymentId);
  
      const arrears = parseFloat(paymentRow.arrears || 0);
      const penalty = parseFloat(paymentRow.penalties || 0);
      const totalDue = arrears + penalty;
  
      const newArrears = Math.max(totalDue - amount, 0); // Remaining unpaid amount
      const newSurplus = Math.max(amount - totalDue, 0); // Payment excess
      const newStatus = newArrears === 0 ? "Completed" : "Pending";
  
      // Update Firestore with new payment details
      await updateDoc(paymentRef, {
        paid: arrayUnion({
          amount,
          paymentDate: new Date().toISOString(),
          approvedBy: "admin@example.com", // Replace with actual admin user info
          method,
          proofURL,
          balance: formatToTwoDecimals(newSurplus),
        }),
        arrears: formatToTwoDecimals(newArrears),
        penalties: formatToTwoDecimals(penalty), // Recalculate penalty if necessary
        balance: formatToTwoDecimals(newSurplus),
        status: newStatus,
      });
  
      alert("Payment submitted successfully!");
  
      // Refresh the table
      reloadTable();
    } catch (error) {
      alert(`Error submitting payment: ${error.message}`);
    } finally {
      // Restore submit button state
      spinner.style.display = "none";
      submitButton.disabled = false;
    }
  });
}


// Display Seed Money Table
async function displaySeedMoney(groupId) {
  try {
    const seedMoneyContainer = document.getElementById("seedMoneyContainer");

    if (!seedMoneyContainer) {
      throw new Error("Seed Money container not found in the DOM.");
    }

    const membersRef = collection(db, `groups/${groupId}/members`);
    const paymentsRef = collection(db, `groups/${groupId}/payments`);
    const members = await fetchCollectionData(membersRef);
    const payments = await fetchCollectionData(paymentsRef);

    const seedMoneyData = [];

    members.forEach((member) => {
      const seedMoneyPayment = payments.find(
        (p) => p.userId === member.uid && p.paymentType === "Seed Money"
      );

      const arrears = parseFloat(seedMoneyPayment?.arrears || 0);
      const paid = parseFloat(seedMoneyPayment?.paidAmount || 0);
      const totalAmount = parseFloat(seedMoneyPayment?.totalAmount || 0);
      const balance = Math.max(totalAmount - paid, 0);
      const dueDate = formatFriendlyDate(seedMoneyPayment?.dueDate);
      const paymentDate = formatFriendlyDate(seedMoneyPayment?.paymentDate);

      seedMoneyData.push({
        memberName: member.fullName || "Unknown",
        paid: formatToTwoDecimals(paid),
        arrears: formatToTwoDecimals(arrears),
        balance: formatToTwoDecimals(balance),
        dueDate,
        paymentDate,
      });
    });

    new Handsontable(seedMoneyContainer, {
      data: seedMoneyData,
      colHeaders: [
        "Member Name",
        "Paid",
        "Arrears",
        "Balance",
        "Due Date",
        "Payment Date",
      ],
      columns: [
        { data: "memberName", type: "text", readOnly: true },
        { data: "paid", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "arrears", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "balance", type: "numeric", format: "0,0.00", readOnly: true },
        { data: "dueDate", type: "text", readOnly: true },
        { data: "paymentDate", type: "text", readOnly: true },
      ],
      width: "100%",
      height: 300,
      licenseKey: "non-commercial-and-evaluation",
    });
  } catch (error) {
    console.error(`Error displaying Seed Money: ${error.message}`);
    alert(`Error: ${error.message}`);
  }
}

// Page Load Logic
document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const groupId = urlParams.get("groupId");

  if (!groupId) {
    alert("Group ID is missing. Redirecting to the admin dashboard...");
    window.location.href = "/frontend/pages/admin_dashboard.html";
    return;
  }

  if (isFirstDayOfYear()) {
    if (confirm("It's the start of a new year. Do you want to reset the table data?")) {
      await deletePaymentsData(groupId); // Clear existing payments data
    }
  }

  await displayMonthlyContributions(groupId);
  await displaySeedMoney(groupId);
});



