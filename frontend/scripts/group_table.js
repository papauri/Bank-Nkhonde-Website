import {
  db,
  doc,
  getDoc,
  collection,
  getDocs,
  updateDoc,
  arrayUnion,
  ref,
  uploadBytes,
  getDownloadURL,
} from "./firebaseConfig.js";



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

async function displayMonthlyContributions(groupId) {
  try {
    // Fetch group details
    const groupRef = doc(db, "groups", groupId);
    const groupSnapshot = await getDoc(groupRef);

    if (!groupSnapshot.exists()) {
      throw new Error(`Group with ID ${groupId} does not exist.`);
    }

    const groupData = groupSnapshot.data();
    const monthlyPenaltyRate = parseFloat(groupData.monthlyPenalty || 0);

    // Fetch members and payments
    const membersRef = collection(db, `groups/${groupId}/members`);
    const paymentsRef = collection(db, `groups/${groupId}/payments`);
    const members = await fetchCollectionData(membersRef);
    const payments = await fetchCollectionData(paymentsRef);

    if (!members.length) {
      throw new Error("No members found in this group.");
    }

    const membersListContainer = document.getElementById("membersList");
    membersListContainer.innerHTML = ""; // Clear existing content

    // Generate member list buttons
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
    let totalPaid = 0;
    let totalSurplus = 0;

    // Prepare table data
    const tableData = memberPayments.map((payment) => {
      const dueDate = payment.dueDate ? new Date(payment.dueDate) : null;
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
        month: dueDate ? dueDate.toLocaleString("default", { month: "long", year: "numeric" }) : "Unknown",
        dueDate: dueDate ? dueDate.toLocaleDateString("en-US") : "",
        arrears: formatToTwoDecimals(arrears),
        penalties: formatToTwoDecimals(penalty),
        surplus: formatToTwoDecimals(surplus),
        totalPaid: formatToTwoDecimals(totalPaidRow),
        paymentMethods,
        totalDue: formatToTwoDecimals(totalDue),
        paymentDetails: formatPaymentDetails(payment.paid || []),
        status: arrears > 0 ? "Pending" : "Completed",
        paymentId: payment.paymentId,
      };
    });

    // Add Totals Row
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

    // Determine display mode (mobile or desktop)
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      // Render as cards for mobile
      tableData.forEach((row) => {
        if (row.month === "Total") return; // Skip totals for cards

        const card = document.createElement("div");
        card.classList.add("payment-card");

        card.innerHTML = `
          <div class="card-header">
            <h4>${row.month}</h4>
          </div>
          <div class="card-body">
            <p><strong>Due Date:</strong> ${row.dueDate || "N/A"}</p>
            <p><strong>Arrears:</strong> ${row.arrears} MK</p>
            <p><strong>Penalties:</strong> ${row.penalties} MK</p>
            <p><strong>Total Paid:</strong> ${row.totalPaid} MK</p>
            <p><strong>Payment Methods:</strong> ${row.paymentMethods || "None"}</p>
            <p><strong>Status:</strong> ${row.status}</p>
          </div>
        `;
        memberTableContainer.appendChild(card);
      });
    } else {

      new Handsontable(memberTableContainer, {
        data: tableData,
        colHeaders: [
          "Month",
          "Due Date",
          "Arrears (MK)",
          "Penalties (MK)",
          "Surplus (MK)",
          "Total Paid (MK)",
          "Payment Details",
          "Payment Status",
        ],
        nestedHeaders: [
          [{ label: "Payment Summary", colspan: 8 }],
          [
            "Month",
            "Due Date",
            "Arrears (MK)",
            "Penalties (MK)",
            "Surplus (MK)",
            "Total Paid (MK)",
            "Payment Details",
            "Payment Status",
          ],
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
      
        // Appearance and Layout
        colWidths: () => Math.floor(memberTableContainer.offsetWidth / 8),
        stretchH: "all", // Stretch table to fit the container width
        autoWrapRow: true, // Allow text wrapping
        height: 'auto', // Adjust height automatically
        width: '100%', // Ensure table fits the container
        fixedColumnsLeft: 1, // Freeze the first column
        fixedRowsTop: 1, // Freeze the header row
      
        // Interactivity
        manualColumnResize: true, // Allow column resizing
        manualRowResize: true, // Allow row resizing
        manualColumnMove: true, // Enable column reordering
        manualRowMove: true, // Enable row reordering
        filters: true, // Allow filtering
        dropdownMenu: true, // Dropdown menu for column options
        contextMenu: true, // Right-click menu for row/column actions
        search: true, // Enable search functionality
        copyPaste: true, // Copy-paste support with external tools
        multiColumnSorting: true, // Enable sorting by multiple columns
        sortIndicator: true, // Show sort icons in headers
      
        // Advanced Features
        collapsibleColumns: true, // Allow collapsing of grouped columns
        mergeCells: true, // Allow merging cells
        hiddenColumns: { columns: [], indicators: true }, // Option to hide columns
        hiddenRows: { rows: [], indicators: true }, // Option to hide rows
        trimRows: true, // Trim rows programmatically if needed
        rowHeaders: true, // Add row headers (e.g., row numbers)
        columnSummary: [
          // Summarize numeric columns (e.g., totals for "Arrears")
          {
            sourceColumn: 2, // Index of "Arrears"
            type: "sum",
            destinationRow: tableData.length, // Last row
            destinationColumn: 2,
          },
          {
            sourceColumn: 3, // Index of "Penalties"
            type: "sum",
            destinationRow: tableData.length,
            destinationColumn: 3,
          },
          {
            sourceColumn: 4, // Index of "Surplus"
            type: "sum",
            destinationRow: tableData.length,
            destinationColumn: 4,
          },
        ],
      
        // Accessibility
        selectionMode: 'single', // Single-cell selection for clarity
        tabMoves: { row: 0, col: 1 }, // Move right on Tab and down on Enter
        comments: true, // Enable cell comments
      
        // Performance Optimizations
        viewportColumnRenderingOffset: 5, // Render additional columns for smoother scrolling
        viewportRowRenderingOffset: 10, // Render additional rows for smoother scrolling
      
        // License
        licenseKey: "non-commercial-and-evaluation",
      });      
    }

    // Display the manual payment form
    createPaymentForm(manualPaymentContainer, member, groupId, tableData, () =>
      displayMemberData(member, payments, monthlyPenaltyRate, groupId)
    );
  } catch (error) {
    console.error(`Error displaying member data: ${error.message}`);
    alert(`Error: ${error.message}`);
  }
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
    "Use this form to record a manual payment. Ensure the payment amount matches the proof of payment and is approved.";
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
      option.dataset.paymentId = row.paymentId || "";
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
    const paymentId = monthSelect.options[monthSelect.selectedIndex]?.dataset.paymentId;
    const amount = parseFloat(paymentAmountInput.value) || parseFloat(totalDueDisplay.value);
    const method = paymentMethodSelect.value;
    const proofFile = proofInput.files[0];

    // Validate inputs
    if (!selectedMonth || !amount || !method || !proofFile || !paymentId) {
      alert("Please fill all fields, select a valid month, and upload proof of payment.");
      return;
    }

    try {
      // Show spinner during submission
      spinner.style.display = "inline-block";
      submitButton.disabled = true;

      // Upload proof of payment
      const proofFileName = `${member.uid}-${Date.now()}`;
      const proofStorageRef = ref(storage, `proofs/${proofFileName}`);
      await uploadBytes(proofStorageRef, proofFile);
      const proofURL = await getDownloadURL(proofStorageRef);

      // Get Firestore payment reference
      const paymentRef = doc(db, `groups/${groupId}/payments`, paymentId);
      const paymentDoc = await getDoc(paymentRef);

      if (!paymentDoc.exists()) {
        alert("Payment record not found. Please refresh the page and try again.");
        return;
      }

      const paymentData = paymentDoc.data();

      // Fetch current admin name
      const adminDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
      const adminName = adminDoc.exists() ? adminDoc.data().fullName : "Unknown Admin";

      // Update Firestore with new payment details
      await updateDoc(paymentRef, {
        paid: arrayUnion({
          amount: formatToTwoDecimals(amount),
          paymentDate: new Date().toISOString(),
          approvedBy: adminName,
          approvalDate: new Date().toISOString(),
          method,
          proofURL,
          approvalStatus: true, // Automatically approved
        }),
        updatedAt: new Date(),
      });

      alert("Payment submitted successfully!");

      // Refresh the table
      reloadTable();
    } catch (error) {
      console.error("Error submitting payment:", error);
      alert(`Error submitting payment: ${error.message}`);
    } finally {
      // Hide spinner and restore button state
      spinner.style.display = "none";
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

    // Determine display mode (mobile or desktop)
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      // Render cards for mobile view
      seedMoneyContainer.innerHTML = ""; // Clear existing content
      seedMoneyData.forEach((data) => {
        const card = document.createElement("div");
        card.classList.add("seed-money-card");

        card.innerHTML = `
          <div class="card-header">
            <h4>${data.memberName}</h4>
          </div>
          <div class="card-body">
            <p><strong>Paid:</strong> ${data.paid} MK</p>
            <p><strong>Arrears:</strong> ${data.arrears} MK</p>
            <p><strong>Balance:</strong> ${data.balance} MK</p>
            <p><strong>Due Date:</strong> ${data.dueDate || "N/A"}</p>
            <p><strong>Payment Date:</strong> ${data.paymentDate || "N/A"}</p>
          </div>
        `;
        seedMoneyContainer.appendChild(card);
      });
    } else {
      // Render Handsontable for desktop view
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
    }
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

  await displayMonthlyContributions(groupId);
  await displaySeedMoney(groupId);
});



// Show Spinner
function showSpinner() {
  const spinnerOverlay = document.getElementById("spinnerOverlay");
  if (spinnerOverlay) {
    spinnerOverlay.style.display = "flex";
  }
}

// Hide Spinner
function hideSpinner() {
  const spinnerOverlay = document.getElementById("spinnerOverlay");
  if (spinnerOverlay) {
    spinnerOverlay.style.display = "none";
  }
}
