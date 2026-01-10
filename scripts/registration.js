import {
  db,
  auth,
  createUserWithEmailAndPassword,
  doc,
  collection,
  Timestamp,
  writeBatch,
  query,
  where,
  getDocs,
  setDoc,
} from "./firebaseConfig.js";

document.addEventListener("DOMContentLoaded", () => {
  // Constants
  const PAYMENT_DETAILS_DOC = "PaymentDetails";
  
  const registrationForm = document.getElementById("registrationForm");
  const phoneInput = document.getElementById("phone");
  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingMessage = document.getElementById("loadingMessage");
  const formFields = document.querySelectorAll("#registrationForm input, button");

  // ✅ Ensure Intl-Tel-Input loads correctly
  let iti;
  setTimeout(() => {
    iti = window.intlTelInput(phoneInput, {
      initialCountry: "mw", // Default to Malawi
      preferredCountries: ["mw", "us", "gb"], 
      separateDialCode: true,
      utilsScript: "https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/js/utils.min.js",
    });
  }, 100); // Delay to avoid initialization issues

  // ✅ Loading Overlay Functions
  function toggleLoadingOverlay(show = true, message = "Processing... Please wait.") {
    loadingMessage.textContent = message;
    loadingOverlay.classList.toggle("show", show);
    document.body.style.pointerEvents = show ? "none" : "auto";
  }

  // ✅ Enable/Disable Form Fields
  function toggleFormFields(enable = true) {
    formFields.forEach((field) => (field.disabled = !enable));
  }

  // ✅ Validate Required Fields
  function validateField(value, fieldName) {
    return value && value.trim() !== "" ? null : `${fieldName} is required.`;
  }

  // ✅ Validate Numeric Fields
  function validateNumericField(value, fieldName, minValue = 0, maxValue = Infinity, isPercentage = false) {
    if (value === undefined || value === null || value === "") {
      return `${fieldName} is required.`;
    }

    let parsedValue = parseFloat(value);
    if (isNaN(parsedValue) || parsedValue < minValue || parsedValue > maxValue) {
      return `${fieldName} must be a valid ${isPercentage ? "percentage" : "amount"} between ${minValue} and ${maxValue}.`;
    }

    // Ensure up to two decimal places
    if (!Number.isFinite(parsedValue) || !/^\d+(\.\d{1,2})?$/.test(parsedValue.toFixed(2))) {
      return `${fieldName} can only have up to two decimal places.`;
    }

    return null; // No error
  }

  // ✅ Validate Phone Number
  function validatePhoneInput() {
    const errorElementId = "phoneError";
    let errorElement = document.getElementById(errorElementId);
  
    if (errorElement) errorElement.remove(); // Remove previous error message
  
    if (phoneInput.value.trim() === "") return false; // Ensure input is not empty
  
    if (!iti.isValidNumber()) {
      phoneInput.insertAdjacentHTML("afterend", `<p id="${errorElementId}" style="color: red;">Invalid phone number. Please check your input.</p>`);
      return false;
    }
  
    return true;
  }

  // ✅ Check if email already exists in Firebase Auth
  async function checkEmailExists(email) {
    try {
      // Query Firestore to check if email exists in users collection
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", email));
      const querySnapshot = await getDocs(q);
      return !querySnapshot.empty;
    } catch (error) {
      console.error("Error checking email:", error);
      // If Firebase is unavailable, prevent registration to avoid duplicates
      throw new Error("Unable to verify email. Please try again later.");
    }
  }

  // ✅ Create User and Group (Direct registration without approval)
  async function createUserAndGroup(name, email, password, groupData) {
    let userId = null;
    let groupId = null;

    try {
      toggleLoadingOverlay(true, "Creating your account...");

      // ✅ Convert and validate numeric fields
      const seedMoney = parseFloat(groupData.seedMoney);
      const interestRate = parseFloat(groupData.interestRate);
      const monthlyContribution = parseFloat(groupData.monthlyContribution);
      const loanPenalty = parseFloat(groupData.loanPenalty);
      const monthlyPenalty = parseFloat(groupData.monthlyPenalty);

      if (
        isNaN(seedMoney) || isNaN(interestRate) || isNaN(monthlyContribution) ||
        isNaN(loanPenalty) || isNaN(monthlyPenalty)
      ) {
        throw new Error("Invalid numeric input detected. Ensure all numeric fields have valid values.");
      }

      // ✅ Convert dates to Firestore Timestamps
      const cycleStartDate = Timestamp.fromDate(new Date(groupData.cycleStartDate));
      const seedMoneyDueDate = Timestamp.fromDate(new Date(groupData.seedMoneyDueDate));

      // ✅ Generate cycle dates
      const cycleDates = Array.from({ length: 12 }, (_, i) => {
        const date = new Date(groupData.cycleStartDate);
        date.setMonth(date.getMonth() + i);
        return {
          iso: date.toISOString(),
          friendly: date.toLocaleDateString("default", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          year: date.getFullYear(),
          month: date.toLocaleString("default", { month: "long" }),
          timestamp: Timestamp.fromDate(date),
        };
      });

      // ✅ Create the Firebase Auth user first
      toggleLoadingOverlay(true, "Creating your user account...");
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      userId = user.uid;

      console.log("✅ Admin user created successfully:", userId);

      // ✅ Use Firestore Batch Write for efficiency
      const batch = writeBatch(db);

      // ✅ Create the group document
      toggleLoadingOverlay(true, "Setting up your group...");
      groupId = `${groupData.groupName.replace(/\s+/g, "_")}_${Date.now()}`;
      const groupRef = doc(db, "groups", groupId);

      batch.set(groupRef, {
        groupId,
        groupName: groupData.groupName,
        seedMoney,
        seedMoneyDueDate,
        interestRate,
        monthlyContribution,
        loanPenalty,
        monthlyPenalty,
        cycleStartDate,
        cycleDates: cycleDates.map((date) => date.timestamp),
        displayCycleDates: cycleDates.map((date) => date.friendly),
        createdAt: Timestamp.now(),
        status: "active",
        adminDetails: [{ fullName: name, email, uid: userId }],
        paymentSummary: {
          totalDue: seedMoney,
          totalPaid: 0,
          totalArrears: seedMoney,
        },
        approvedPayments: [],
        pendingPayments: [],
      });

      // ✅ Add Admin as a Member (Admins are also users in the group)
      const memberRef = doc(db, `groups/${groupId}/members`, userId);
      batch.set(memberRef, {
        uid: userId,
        fullName: name,
        email,
        phone: groupData.phone,
        role: "admin",
        joinedAt: Timestamp.now(),
        collateral: null,
        balances: [],
      });

      // ✅ Add User Data (supporting multiple group memberships)
      const userRef = doc(db, "users", userId);
      batch.set(userRef, {
        uid: userId,
        fullName: name,
        email,
        phone: groupData.phone,
        roles: ["admin", "user"], // User can have multiple roles across different groups
        createdAt: Timestamp.now(),
        groupMemberships: [groupId], // Array to support multiple groups
      });

      // ✅ Initialize Payments Documents
      const currentYear = new Date().getFullYear();

      // ✅ Create Seed Money Document
      const seedMoneyDocRef = doc(db, `groups/${groupId}/payments`, `${currentYear}_SeedMoney`);
      batch.set(seedMoneyDocRef, { createdAt: Timestamp.now() });

      // ✅ Create User Seed Money Document using UID
      const userSeedMoneyRef = doc(collection(seedMoneyDocRef, userId), PAYMENT_DETAILS_DOC);
      batch.set(userSeedMoneyRef, {
        userId,
        fullName: name,
        paymentType: "Seed Money",
        totalAmount: seedMoney,
        arrears: seedMoney,
        approvalStatus: "unpaid",
        paymentStatus: "unpaid",
        dueDate: seedMoneyDueDate,
        createdAt: Timestamp.now(),
        updatedAt: null,
      });

      // ✅ Create Monthly Contributions Document
      const monthlyContributionDocRef = doc(db, `groups/${groupId}/payments`, `${currentYear}_MonthlyContributions`);
      batch.set(monthlyContributionDocRef, { createdAt: Timestamp.now() });

      // ✅ Create Monthly Contribution Payments for Each Month using UID
      const userMonthlyCollection = collection(monthlyContributionDocRef, userId);
      cycleDates.forEach((date) => {
        const monthlyPaymentDoc = doc(userMonthlyCollection, `${date.year}_${date.month}`);
        batch.set(monthlyPaymentDoc, {
          userId,
          fullName: name,
          paymentType: "Monthly Contribution",
          totalAmount: monthlyContribution,
          arrears: monthlyContribution,
          approvalStatus: "unpaid",
          paymentStatus: "unpaid",
          dueDate: date.timestamp,
          createdAt: Timestamp.now(),
          updatedAt: null,
        });
      });

      // ✅ Commit all changes
      toggleLoadingOverlay(true, "Finalizing your registration...");
      await batch.commit();
      console.log("✅ User, group, and payment records created successfully!");

      toggleLoadingOverlay(false);
      alert("Registration complete! You can now login to your admin dashboard.");
      window.location.href = "../index.html"; // Redirect to login
    } catch (error) {
      console.error("❌ Error during registration:", error.message);
      toggleLoadingOverlay(false);
      toggleFormFields(true);
      alert(`Registration failed: ${error.message}`);
      throw error;
    }
  }
  

  // Attach Phone Validation
  phoneInput.addEventListener("blur", validatePhoneInput);
  phoneInput.addEventListener("input", validatePhoneInput);

// Handle registration form submission
registrationForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  // ✅ Prevent duplicate submissions
  const submitButton = registrationForm.querySelector("button");
  submitButton.disabled = true;

  // ✅ Collect data from form fields
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const groupName = document.getElementById("groupName").value.trim();
  const seedMoney = parseFloat(document.getElementById("seedMoney").value);
  const seedMoneyDueDate = document.getElementById("seedMoneyDueDate").value;
  const interestRate = parseFloat(document.getElementById("interestRate").value);
  const monthlyContribution = parseFloat(document.getElementById("monthlyContribution").value);
  const loanPenalty = parseFloat(document.getElementById("loanPenalty").value);
  const monthlyPenalty = parseFloat(document.getElementById("monthlyPenalty").value);
  const cycleStartDate = document.getElementById("cycleStartDate").value;

  // ✅ Validate input fields
  const errors = [
    validateField(name, "Full Name"),
    validateField(phone, "Phone Number"),
    validateField(email, "Email Address"),
    validateField(password, "Password"),
    validateField(groupName, "Group Name"),
    validateField(seedMoneyDueDate, "Seed Money Due Date"),
    validateNumericField(seedMoney, "Seed Money", 0),
    validateNumericField(interestRate, "Interest Rate", 0, 100, true),
    validateNumericField(monthlyContribution, "Monthly Contribution", 0),
    validateNumericField(loanPenalty, "Loan Penalty", 0, 100, true),
    validateNumericField(monthlyPenalty, "Monthly Penalty", 0, 100, true),
    validateField(cycleStartDate, "Cycle Start Date"),
  ].filter((error) => error !== null);

  // ✅ Validate password strength
  if (password.length < 6) {
    errors.push("Password must be at least 6 characters long.");
  }

  // ✅ Validate phone input separately
  if (!validatePhoneInput() || !phone) {
    errors.push("Phone Number is invalid.");
  }

  // ✅ Stop submission if errors exist
  if (errors.length > 0) {
    alert("Please fix the following errors:\n" + errors.join("\n"));
    submitButton.disabled = false; // Re-enable button
    return;
  }

  try {
    toggleLoadingOverlay(true, "Validating your information...");
    toggleFormFields(false);

    // ✅ Check if email already exists
    const emailExists = await checkEmailExists(email);
    if (emailExists) {
      alert("An account with this email already exists. Please use a different email or login.");
      submitButton.disabled = false;
      toggleFormFields(true);
      toggleLoadingOverlay(false);
      return;
    }

    // ✅ All validation passed - now create user and group directly
    toggleLoadingOverlay(true, "Creating your account and group...");

    // ✅ Format group data properly
    const groupData = {
      groupName,
      phone,
      seedMoney: seedMoney.toFixed(2),
      seedMoneyDueDate,
      interestRate: interestRate.toFixed(2),
      monthlyContribution: monthlyContribution.toFixed(2),
      loanPenalty: loanPenalty.toFixed(2),
      monthlyPenalty: monthlyPenalty.toFixed(2),
      cycleStartDate,
    };

    // ✅ Create user and group immediately (no approval needed for admin self-registration)
    await createUserAndGroup(name, email, password, groupData);

  } catch (error) {
    console.error("❌ Error during registration:", error.message);
    alert(`An error occurred: ${error.message}`);
    toggleFormFields(true);
    toggleLoadingOverlay(false);
    submitButton.disabled = false;
  }
});


});
