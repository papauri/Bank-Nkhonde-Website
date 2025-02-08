import {
  db,
  auth,
  createUserWithEmailAndPassword,
  doc,
  setDoc,
  collection,
  addDoc,
  onSnapshot, // Import onSnapshot
} from "./firebaseConfig.js";



document.addEventListener("DOMContentLoaded", () => {
  const invitationCodeField = document.getElementById("invitationCode");
  const registrationForm = document.getElementById("registrationForm");
  const phoneInput = document.getElementById("phone");
  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingMessage = document.getElementById("loadingMessage");
  const formFields = document.querySelectorAll("#registrationForm input, button");
  let invitationDocRef = null;

  // Initialize Intl-Tel-Input for phone validation
  const iti = window.intlTelInput(phoneInput, {
    initialCountry: "mw", // Set Malawi as the default country
    preferredCountries: ["mw", "us", "gb"], // Priority countries
    separateDialCode: true, // Display the dial code separately
    utilsScript: "https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/js/utils.min.js", // Utility script for validation
  });

  // Show the loading overlay
  function showLoadingOverlay(message = "Processing... Please wait.") {
    loadingMessage.textContent = message;
    loadingOverlay.classList.add("show");
    document.body.style.pointerEvents = "none"; // Disable user interaction
  }


  // Hide the loading overlay
  function hideLoadingOverlay() {
    loadingOverlay.classList.remove("show");
    document.body.style.pointerEvents = "auto"; // Re-enable user interaction
  }

  // Disable all form fields
  function disableFormFields() {
    formFields.forEach((field) => (field.disabled = true));
  }

  // Enable all form fields
  function enableFormFields() {
    formFields.forEach((field) => (field.disabled = false));
  }

  // Validate required fields
  function validateField(value, fieldName) {
    if (!value || value.trim() === "") {
      return `${fieldName} is required.`;
    }
    return null;
  }

  // Validate numeric fields with auto-formatting
  function validateNumericField(value, fieldName, minValue = 0, maxValue = Infinity, isPercentage = false) {
    if (!value || typeof value === "undefined") {
      return `${fieldName} is required.`;
    }

    let formattedValue = value.toString().trim(); // Ensure value is a string
    let parsedValue = parseFloat(formattedValue);

    // Auto-correct values missing percentage symbol or decimals
    if (isPercentage && !formattedValue.includes("%")) {
      formattedValue = `${parsedValue.toFixed(2)}%`; // Add % sign if missing
    } else if (!formattedValue.includes(".")) {
      formattedValue = parsedValue.toFixed(2); // Format to two decimals
    }

    parsedValue = parseFloat(formattedValue.replace("%", "")); // Parse the numeric value again after formatting

    if (isNaN(parsedValue) || parsedValue < minValue || parsedValue > maxValue) {
      return `${fieldName} must be a valid ${isPercentage ? "percentage" : "amount"} between ${minValue} and ${maxValue}.`;
    }

    if (!/^\d+(\.\d{1,2})?$/.test(parsedValue)) {
      return `${fieldName} can only have up to two decimal places.`;
    }

    return null; // No error
  }


  // Format numeric values to two decimal places
  function formatToTwoDecimals(value) {
    if (!value || isNaN(value)) return "0.00";
    return parseFloat(value).toFixed(2);
  }

  // Validate phone input and display error messages dynamically
  function validatePhoneInput() {
    const errorElementId = "phoneError";
    let errorElement = document.getElementById(errorElementId);

    // Remove existing error message
    if (errorElement) {
      errorElement.remove();
    }

    // Check validity of phone number
    if (!iti.isValidNumber()) {
      errorElement = document.createElement("p");
      errorElement.id = errorElementId;
      errorElement.style.color = "red";
      errorElement.textContent = "Invalid phone number. Please check your input.";
      phoneInput.parentElement.appendChild(errorElement);
      return false;
    }

    return true;
  }

  // Attach validation listeners to the phone input
  phoneInput.addEventListener("blur", validatePhoneInput);
  phoneInput.addEventListener("input", validatePhoneInput);

// Tracking approval status for registration
async function trackApprovalStatus(invitationDocId, name, email, password, groupData) {
  let userCreated = false;
  let groupId = null;
  let userId = null;

  showLoadingOverlay("Waiting for admin approval...");

  const docRef = doc(db, "invitationCodes", invitationDocId);

  onSnapshot(docRef, async (snapshot) => {
    if (!snapshot.exists()) {
      alert("The invitation code no longer exists. Please contact support for assistance.");
      enableFormFields();
      hideLoadingOverlay();
      return;
    }

    const data = snapshot.data();
    if (data.approved) {
      try {
        showLoadingOverlay("Finalizing registration...");

        // Validate input data
        if (!name || !email || !password) {
          throw new Error("Missing user information. Ensure all required fields are filled correctly.");
        }

        if (
          !groupData.groupName?.trim() ||
          !groupData.seedMoney ||
          !groupData.seedMoneyDueDate ||
          !groupData.monthlyContribution ||
          !groupData.loanPenalty ||
          !groupData.monthlyPenalty ||
          !groupData.cycleStartDate
        ) {
          throw new Error("Missing group information. Verify that all fields in the group creation form are complete.");
        }

        // Validate and format dates
        const cycleStartDate = new Date(groupData.cycleStartDate);
        const seedMoneyDueDate = new Date(groupData.seedMoneyDueDate);
        if (isNaN(cycleStartDate) || isNaN(seedMoneyDueDate)) {
          throw new Error("Invalid date format. Ensure all dates are valid.");
        }

        const currentYear = cycleStartDate.getFullYear();

        // Generate cycle dates
        const cycleDates = Array.from({ length: 12 }, (_, i) => {
          const date = new Date(cycleStartDate);
          date.setMonth(cycleStartDate.getMonth() + i);

          return {
            iso: date.toISOString(),
            friendly: date.toLocaleDateString("default", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
            month: date.toLocaleString("default", { month: "long" }),
            year: date.getFullYear(),
          };
        });

        // Create the user in Firebase Authentication
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        userCreated = true;
        userId = user.uid;

        // Create the group document
        groupId = `${groupData.groupName}_${Date.now()}`;
        const groupRef = doc(db, "groups", groupId);

        await setDoc(groupRef, {
          groupId,
          groupName: groupData.groupName,
          seedMoney: formatToTwoDecimals(groupData.seedMoney),
          seedMoneyDueDate: seedMoneyDueDate.toLocaleDateString("default", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          interestRate: formatToTwoDecimals(groupData.interestRate),
          monthlyContribution: formatToTwoDecimals(groupData.monthlyContribution),
          loanPenalty: formatToTwoDecimals(groupData.loanPenalty),
          monthlyPenalty: formatToTwoDecimals(groupData.monthlyPenalty),
          cycleStartDate: cycleStartDate.toLocaleDateString("default", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          cycleDates: cycleDates.map((date) => date.iso),
          displayCycleDates: cycleDates.map((date) => date.friendly),
          createdAt: new Date(),
          adminDetails: [{ uid: userId, fullName: name, email }],
          members: [
            {
              uid: userId,
              fullName: name,
              email,
              phone: groupData.phone,
              role: "admin",
              joinedAt: new Date(),
              collateral: null,
              balances: [],
            },
          ],
          paymentSummary: {
            totalDue: formatToTwoDecimals(groupData.seedMoney),
            totalPaid: 0,
            totalArrears: formatToTwoDecimals(groupData.seedMoney),
          },
        });

        // Add the user to the `members` subcollection
        const memberDocId = `${name.replace(/\s+/g, "_")}_admin_${userId}`;
        const memberRef = doc(db, `groups/${groupId}/members`, memberDocId);

        await initializeGroupData(groupId, userId, name, groupData);

        await setDoc(memberRef, {
          uid: userId,
          fullName: name,
          email,
          phone: groupData.phone,
          role: "admin",
          joinedAt: new Date(),
          collateral: null,
          balances: [],
        });

        // Save the user document in Firestore
        const userRef = doc(db, "users", userId);
        await setDoc(userRef, {
          uid: userId,
          fullName: name,
          email,
          phone: groupData.phone,
          roles: ["admin", "user"],
          createdAt: new Date(),
          groupMemberships: [groupId],
        });

        // Initialize payments for the admin
        await createPayment(
          name,
          "Seed Money",
          groupData.seedMoney,
          0,
          groupId,
          userId,
          currentYear,
          null,
          seedMoneyDueDate.toLocaleDateString("default", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        );

        for (const date of cycleDates) {
          await createPayment(
            name,
            "Monthly Contribution",
            groupData.monthlyContribution,
            0,
            groupId,
            userId,
            date.year,
            date.month,
            date.friendly
          );
        }

        hideLoadingOverlay();
        alert("Your registration and group creation are complete.");
        window.location.href = "../pages/admin_dashboard.html";
      } catch (error) {
        console.error("Error during registration:", error.message);
        hideLoadingOverlay();
        enableFormFields();
        alert(`Registration failed: ${error.message}`);
      }
    }
  });
}

// Helper Function: Create a payment record
async function createPayment(userFullName, paymentType, totalAmount, paidAmount, groupId, userId, year, month, dueDate) {
  const arrears = Math.max(totalAmount - paidAmount, 0);
  const surplus = Math.max(paidAmount - totalAmount, 0);
  const status = arrears > 0 ? "pending" : "completed";

  const paymentId = `${year}_${month}_${paymentType.replace(/\s+/g, "_")}_${userId}`;

  const paymentRef = doc(db, `groups/${groupId}/payments`, paymentId);

  await setDoc(paymentRef, {
    paymentId,
    userId,
    groupId,
    fullName: userFullName,
    paymentType,
    paymentCategory: paymentType.includes("Loan") ? "loan" : "contribution",
    totalAmount: formatToTwoDecimals(totalAmount),
    paid: [],
    arrears: formatToTwoDecimals(arrears),
    surplus: formatToTwoDecimals(surplus),
    status,
    dueDate: dueDate,
    month,
    year,
    approvalStatus: "pending",
    notes: null,
    auditLogs: [],
    createdAt: new Date(),
    updatedAt: null,
  });

  console.log("Payment record created with ID:", paymentRef.id);
  return paymentRef.id;
}

// Helper Function to Initialize Subcollections and Payments
async function initializeGroupData(groupId, adminUserId, adminName, groupData) {
  try {
    const paymentsRef = collection(db, `groups/${groupId}/payments`);
    const pendingPaymentsRef = collection(db, `groups/${groupId}/payments/pendingPayments`);
    const confirmedPaymentsRef = collection(db, `groups/${groupId}/payments/confirmedPayments`);

    // Ensure these collections exist and initialize default entries if needed
    const cycleDates = Array.from({ length: 12 }, (_, i) => {
      const date = new Date(groupData.cycleStartDate);
      date.setMonth(date.getMonth() + i);
      return {
        month: date.toLocaleString("default", { month: "long" }),
        year: date.getFullYear(),
        friendlyDate: date.toLocaleDateString("default", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
      };
    });

    // Create Seed Money Payment for Admin
    const seedPaymentId = `${groupData.cycleStartDate.split("-")[0]}_SeedMoney_${adminUserId}`;
    await setDoc(doc(paymentsRef, seedPaymentId), {
      paymentId: seedPaymentId,
      userId: adminUserId,
      fullName: adminName,
      paymentType: "Seed Money",
      paymentCategory: "contribution",
      totalAmount: parseFloat(groupData.seedMoney),
      arrears: parseFloat(groupData.seedMoney),
      penalties: 0,
      paid: [],
      approvalStatus: "pending",
      createdAt: new Date(),
      updatedAt: null,
    });

    // Create Monthly Contribution Payments
    for (const date of cycleDates) {
      const monthlyPaymentId = `${date.year}_${date.month}_MonthlyContribution_${adminUserId}`;
      await setDoc(doc(paymentsRef, monthlyPaymentId), {
        paymentId: monthlyPaymentId,
        userId: adminUserId,
        fullName: adminName,
        paymentType: "Monthly Contribution",
        paymentCategory: "contribution",
        totalAmount: parseFloat(groupData.monthlyContribution),
        arrears: parseFloat(groupData.monthlyContribution),
        penalties: 0,
        paid: [],
        approvalStatus: "pending",
        dueDate: date.friendlyDate,
        createdAt: new Date(),
        updatedAt: null,
      });
    }

    console.log("Subcollections and payments initialized for group:", groupId);
  } catch (error) {
    console.error("Error initializing group data:", error.message);
    throw new Error("Failed to initialize group subcollections and payments.");
  }
}


  // Utility Functions
  function showLoadingOverlay(message = "Processing... Please wait.") {
    loadingMessage.textContent = message;
    loadingOverlay.classList.add("show");
    document.body.style.pointerEvents = "none"; // Disable interaction
  }

  function hideLoadingOverlay() {
    loadingOverlay.classList.remove("show");
    document.body.style.pointerEvents = "auto"; // Re-enable interaction
  }

  function enableFormFields() {
    formFields.forEach((field) => {
      field.disabled = false;
    });
  }

  function formatToTwoDecimals(value) {
    return value ? parseFloat(value).toFixed(2) : "0.00";
  }

  // Handle registration form submission
  registrationForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Collect data from form fields
    const name = document.getElementById("name").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const groupName = document.getElementById("groupName").value.trim();
    const seedMoney = parseFloat(document.getElementById("seedMoney").value);
    const seedMoneyDueDate = document.getElementById("seedMoneyDueDate").value; // Added new field
    const interestRate = parseFloat(document.getElementById("interestRate").value);
    const monthlyContribution = parseFloat(document.getElementById("monthlyContribution").value);
    const loanPenalty = parseFloat(document.getElementById("loanPenalty").value);
    const monthlyPenalty = parseFloat(document.getElementById("monthlyPenalty").value);
    const cycleStartDate = document.getElementById("cycleStartDate").value;

    // Validate fields
    const errors = [
      validateField(name, "Full Name"),
      validateField(phone, "Phone Number"),
      validateField(email, "Email Address"),
      validateField(password, "Password"),
      validateField(groupName, "Group Name"),
      validateField(seedMoneyDueDate, "Seed Money Due Date"), // Validate new field
      validateNumericField(seedMoney, "Seed Money", 0),
      validateNumericField(interestRate, "Interest Rate", 0, 100, true),
      validateNumericField(monthlyContribution, "Monthly Contribution", 0),
      validateNumericField(loanPenalty, "Loan Penalty", 0, 100, true),
      validateNumericField(monthlyPenalty, "Monthly Penalty", 0, 100, true),
      validateField(cycleStartDate, "Cycle Start Date"),
    ].filter((error) => error !== null);


    // Validate phone input separately
    if (!validatePhoneInput() || !phone) {
      errors.push("Phone Number is invalid.");
    }

    // If validation errors exist, display them and stop submission
    if (errors.length > 0) {
      alert("Please fix the following errors:\n" + errors.join("\n"));
      return;
    }

    try {
      showLoadingOverlay("Submitting your registration...");
      disableFormFields();

      // Prepare group data for submission
      const groupData = {
        groupName,
        phone,
        seedMoney: seedMoney.toFixed(2),
        seedMoneyDueDate, // Include the seed money due date
        interestRate: interestRate.toFixed(2),
        monthlyContribution: monthlyContribution.toFixed(2),
        loanPenalty: loanPenalty.toFixed(2),
        monthlyPenalty: monthlyPenalty.toFixed(2),
        cycleStartDate,
      };

      // Generate and save an invitation code
      const generatedCode = await generateAndSaveInvitationCode(name, phone, email);

      // Track approval status for the invitation code
      if (invitationDocRef) {
        await trackApprovalStatus(invitationDocRef.id, name, email, password, groupData);
      }
    } catch (error) {
      console.error("Error during registration:", error.message);
      alert("An error occurred. Please try again.");
      enableFormFields();
      hideLoadingOverlay();
    }
  });



  // Generate and save an invitation code
  async function generateAndSaveInvitationCode(name, phone, email) {
    const generatedCode = generateInvitationCode();
    invitationCodeField.value = generatedCode;

    invitationDocRef = await addDoc(collection(db, "invitationCodes"), {
      code: generatedCode,
      name,
      phone,
      email,
      approved: false,
      used: false,
      createdAt: new Date(),
    });

    console.log("Invitation code generated and saved:", generatedCode);
    return generatedCode;
  }
  // Generate a random invitation code
  function generateInvitationCode(length = 8) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
});
