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
  signInWithEmailAndPassword,
} from "./firebaseConfig.js";

import {
  createInvitationCode,
  validateInvitationCode,
  markCodeAsUsedAndDelete,
  pollForApproval,
} from "./invitation_code.js";

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
  
  function initializeIntlTelInput() {
    if (typeof window.intlTelInput !== 'undefined') {
      iti = window.intlTelInput(phoneInput, {
        initialCountry: "mw", // Default to Malawi (dial code 265)
        preferredCountries: ["mw", "us", "gb", "za", "tz", "zm"], 
        separateDialCode: true,
        utilsScript: "https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/js/utils.min.js",
        allowDropdown: true, // Allow changing country
        nationalMode: false, // Show dial code
      });
    } else {
      // Retry if library not loaded yet
      setTimeout(initializeIntlTelInput, 100);
    }
  }
  
  // Try to initialize immediately, then retry if needed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeIntlTelInput);
  } else {
    setTimeout(initializeIntlTelInput, 100);
  }

  // ✅ Loading Overlay Functions
  function toggleLoadingOverlay(show = true, message = "Processing... Please wait.") {
    loadingMessage.innerHTML = message.replace(/\n/g, '<br>'); // Support multi-line messages
    loadingOverlay.classList.toggle("show", show);
    loadingOverlay.classList.toggle("hidden", !show);
    document.body.style.pointerEvents = show ? "none" : "auto";
  }

  // ✅ Enable/Disable Form Fields
  function toggleFormFields(enable = true) {
    formFields.forEach((field) => (field.disabled = !enable));
  }

  // ✅ Dialog Functions
  function showSuccessDialog(title, message, buttonText = "OK", onClose = null) {
    const successDialog = document.getElementById("successDialog");
    const successDialogTitle = document.getElementById("successDialogTitle");
    const successDialogMessage = document.getElementById("successDialogMessage");
    const successDialogButton = document.getElementById("successDialogButton");
    
    if (!successDialog || !successDialogTitle || !successDialogMessage || !successDialogButton) {
      console.error("Dialog elements not found");
      alert(`${title}\n\n${message}`);
      if (onClose && typeof onClose === 'function') {
        onClose();
      }
      return;
    }
    
    successDialogTitle.textContent = title;
    successDialogMessage.textContent = message;
    successDialogButton.textContent = buttonText;
    
    // Remove any existing click handlers
    const newButton = successDialogButton.cloneNode(true);
    successDialogButton.parentNode.replaceChild(newButton, successDialogButton);
    
    // Add click handler
    newButton.addEventListener("click", () => {
      closeSuccessDialog();
      if (onClose && typeof onClose === 'function') {
        onClose();
      }
    });
    
    successDialog.classList.remove("hidden");
  }

  function closeSuccessDialog() {
    const successDialog = document.getElementById("successDialog");
    if (successDialog) {
      successDialog.classList.add("hidden");
    }
  }

  function showErrorDialog(title, message, buttonText = "Close", onClose = null) {
    const errorDialog = document.getElementById("errorDialog");
    const errorDialogTitle = document.getElementById("errorDialogTitle");
    const errorDialogMessage = document.getElementById("errorDialogMessage");
    const errorDialogButton = document.getElementById("errorDialogButton");
    
    if (!errorDialog || !errorDialogTitle || !errorDialogMessage || !errorDialogButton) {
      console.error("Dialog elements not found");
      alert(`${title}\n\n${message}`);
      if (onClose && typeof onClose === 'function') {
        onClose();
      }
      return;
    }
    
    errorDialogTitle.textContent = title;
    errorDialogMessage.textContent = message;
    errorDialogButton.textContent = buttonText;
    
    // Remove any existing click handlers
    const newButton = errorDialogButton.cloneNode(true);
    errorDialogButton.parentNode.replaceChild(newButton, errorDialogButton);
    
    // Add click handler
    newButton.addEventListener("click", () => {
      closeErrorDialog();
      if (onClose && typeof onClose === 'function') {
        onClose();
      }
    });
    
    errorDialog.classList.remove("hidden");
  }

  function closeErrorDialog() {
    const errorDialog = document.getElementById("errorDialog");
    if (errorDialog) {
      errorDialog.classList.add("hidden");
    }
  }

  // ✅ Validate Required Fields
  function validateField(value, fieldName) {
    return value && value.trim() !== "" ? null : `${fieldName} is required.`;
  }

  // ✅ Validate Email
  function validateEmail(email) {
    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailPattern.test(email)) {
      return "Please enter a valid email address.";
    }
    return null;
  }

  // ✅ Validate Name
  function validateName(name) {
    const namePattern = /^[a-zA-Z\s'-]{2,}$/;
    if (name.length < 2) {
      return "Name must be at least 2 characters long.";
    }
    if (!namePattern.test(name)) {
      return "Name can only contain letters, spaces, hyphens, and apostrophes.";
    }
    return null;
  }

  // ✅ Validate Password
  function validatePassword(password) {
    if (password.length < 6) {
      return "Password must be at least 6 characters long.";
    }
    if (password.length > 50) {
      return "Password is too long (max 50 characters).";
    }
    if (!/(?=.*[0-9!@#$%^&*])/.test(password)) {
      return "Password should contain at least one number or special character.";
    }
    return null;
  }

  // ✅ Validate Numeric Fields
  function validateNumericField(value, fieldName, minValue = 0, maxValue = Infinity, isPercentage = false) {
    if (value === undefined || value === null || value === "") {
      return `${fieldName} is required.`;
    }

    // Remove commas for parsing
    const cleanedValue = String(value).replace(/,/g, '');
    let parsedValue = parseFloat(cleanedValue);
    
    if (isNaN(parsedValue)) {
      return `${fieldName} must be a valid ${isPercentage ? "percentage" : "amount"}.`;
    }
    
    if (parsedValue < minValue || parsedValue > maxValue) {
      return `${fieldName} must be between ${minValue} and ${maxValue}${isPercentage ? '%' : ''}.`;
    }

    // For percentages, ensure max is 100
    if (isPercentage && parsedValue > 100) {
      return `${fieldName} cannot exceed 100%.`;
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
  
    // Check if intlTelInput is initialized and validate
    if (iti && typeof iti.isValidNumber === 'function') {
      if (!iti.isValidNumber()) {
        phoneInput.insertAdjacentHTML("afterend", `<p id="${errorElementId}" style="color: red;">Invalid phone number. Please check your input.</p>`);
        return false;
      }
    } else {
      // Fallback validation if intlTelInput not loaded yet
      const phoneValue = phoneInput.value.trim();
      if (!phoneValue.startsWith('+') && !phoneValue.startsWith('265')) {
        phoneInput.insertAdjacentHTML("afterend", `<p id="${errorElementId}" style="color: red;">Please enter a valid phone number with country code.</p>`);
        return false;
      }
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
      const loanInterestMonth1 = parseFloat(groupData.loanInterestMonth1);
      // Month 2 defaults to Month 1 if not provided
      const loanInterestMonth2 = groupData.loanInterestMonth2 ? parseFloat(groupData.loanInterestMonth2) : loanInterestMonth1;
      // Month 3+ defaults to Month 2 (or Month 1 if Month 2 not provided)
      const loanInterestMonth3 = groupData.loanInterestMonth3 ? parseFloat(groupData.loanInterestMonth3) : loanInterestMonth2;
      const monthlyContribution = parseFloat(groupData.monthlyContribution);
      const loanPenalty = parseFloat(groupData.loanPenalty);
      const monthlyPenalty = parseFloat(groupData.monthlyPenalty);

      if (
        isNaN(seedMoney) || isNaN(loanInterestMonth1) || isNaN(monthlyContribution) ||
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
      console.log("🔹 Creating user with email:", email);
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      userId = user.uid;

      console.log("✅ Admin user created successfully:", userId);
      console.log("✅ User email verified:", user.emailVerified);

      // ✅ Use Firestore Batch Write for efficiency
      const batch = writeBatch(db);

      // ✅ Create the group document with improved structure
      toggleLoadingOverlay(true, "Setting up your group...");
      groupId = `${groupData.groupName.replace(/\s+/g, "_")}_${Date.now()}`;
      const groupRef = doc(db, "groups", groupId);

      batch.set(groupRef, {
        groupId,
        groupName: groupData.groupName,
        description: "", // Optional group description
        createdAt: Timestamp.now(),
        createdBy: userId,
        updatedAt: Timestamp.now(),
        lastModifiedBy: userId,
        status: "active",
        
        // Structured rules object for flexibility
        rules: {
          // Seed Money: Same amount for all members, can be paid in full or within maxPaymentMonths
          seedMoney: {
            amount: seedMoney,                    // Same for all members in group (MWK)
            dueDate: seedMoneyDueDate,             // Initial due date
            required: true,                        // Must be fully paid (cannot be skipped)
            allowPartialPayment: true,             // Can pay in installments
            maxPaymentMonths: 2,                   // Default: 2 months to complete payment (admin can change)
            mustBeFullyPaid: true                  // Must be fully paid within maxPaymentMonths
          },
          // Monthly Contribution: Same amount for all members, due same day each month
          monthlyContribution: {
            amount: monthlyContribution,           // Same for all members in group (MWK)
            required: true,
            dayOfMonth: new Date(groupData.cycleStartDate).getDate(), // Same due day for all (e.g., 5th)
            allowPartialPayment: true              // Can pay partial amounts
          },
          // Loan Interest: Different rates per month (tiered system)
          // Month 1: Interest on full loan amount
          // Month 2: Interest on remaining balance (if different rate)
          // Month 3+: Interest on remaining balance (if different rate)
          loanInterest: {
            month1: loanInterestMonth1,           // % interest for 1st month of loan repayment
            month2: loanInterestMonth2,           // % interest for 2nd month (defaults to month1 if not provided)
            month3AndBeyond: loanInterestMonth3,   // % interest for 3rd+ months (defaults to month2 or month1)
            description: "Tiered interest rates - different % per month based on remaining loan balance",
            calculationMethod: "balance_based"     // Interest calculated on remaining balance each month
          },
          // Loan Penalty: % extra on top of monthly loan payment if missed deadline
          loanPenalty: {
            rate: loanPenalty,                     // % penalty (same for all members in group)
            type: "percentage",                    // Applied as percentage of missed payment
            gracePeriodDays: 0,                    // Days before penalty applies
            description: "Percentage penalty added to missed loan payment amount"
          },
          // Monthly Penalty: % extra for missed monthly contributions
          monthlyPenalty: {
            rate: monthlyPenalty,                  // % penalty (same for all members in group)
            type: "percentage",                    // Applied as percentage of missed contribution
            gracePeriodDays: 0,                    // Days before penalty applies
            description: "Percentage penalty added to missed monthly contribution amount"
          },
          cycleDuration: {
            startDate: cycleStartDate,
            endDate: null, // Can be set later
            months: 12,
            autoRenew: false
          },
          loanRules: {
            maxLoanAmount: 0,                      // To be set by admin
            minLoanAmount: 0,
            maxActiveLoansByMember: 1,
            requireCollateral: true,
            minRepaymentMonths: 1,
            maxRepaymentMonths: 3,                 // Max 3 months repayment (based on loan amount)
            // Loan repayment period determined by amount:
            // - Loans < MWK 500,000: Max 2 months
            // - Loans >= MWK 500,000: Max 3 months
            repaymentCalculation: {
              method: "tiered_interest",           // Different interest % per month
              month1Calculation: "loanAmount * (month1Interest / 100)", // Interest on full amount
              month2Calculation: "remainingBalance * (month2Interest / 100)", // Interest on remaining
              month3Calculation: "remainingBalance * (month3Interest / 100)"  // Interest on remaining
            }
          },
          customRules: []
        },
        
        // Cycle dates for reference
        cycleDates: cycleDates.map((date) => date.timestamp),
        displayCycleDates: cycleDates.map((date) => date.friendly),
        
        // Group statistics
        statistics: {
          totalMembers: 1,
          activeMembers: 1,
          totalFunds: 0,
          totalLoansActive: 0,
          totalLoansRepaid: 0,
          totalArrears: seedMoney,
          totalPenalties: 0,
          lastUpdated: Timestamp.now()
        },
        
        // Admin information
        admins: [{ 
          uid: userId, 
          fullName: name, 
          email,
          phone: groupData.phone,
          whatsappNumber: groupData.phone, // Default to phone number
          role: "senior_admin",
          assignedAt: Timestamp.now(),
          assignedBy: "system",
          isContactAdmin: true,
          canPromoteMembers: true,
          permissions: {
            canApprovePayments: true,
            canApproveLoan: true,
            canAddMembers: true,
            canRemoveMembers: true,
            canPromoteToAdmin: true,
            canDemoteAdmin: true,
            canSendBroadcasts: true,
            canManageSettings: true,
            canViewReports: true
          }
        }],
        
        // Contact Information
        contactInfo: {
          primaryAdmin: {
            uid: userId,
            fullName: name,
            email,
            phone: groupData.phone,
            whatsappNumber: groupData.phone,
            profileImageUrl: "",
            role: "senior_admin",
            availableForChat: true,
            preferredContactMethod: "chat"
          },
          secondaryAdmins: [],
          groupEmail: email,
          groupPhone: groupData.phone,
          officeHours: "Monday - Friday, 9:00 AM - 5:00 PM",
          emergencyContact: {
            name: name,
            phone: groupData.phone,
            relationship: "Senior Admin"
          }
        },
        
        // Activity tracking
        activityLog: {
          lastPaymentApproved: null,
          lastLoanApproved: null,
          lastMemberAdded: Timestamp.now(),
          lastMeetingDate: null,
          lastBadgeConfigUpdate: null
        },
        
        // Currency
        currency: "MWK"
      });

      // ✅ Add Admin as a Member with improved structure
      const memberRef = doc(db, `groups/${groupId}/members`, userId);
      batch.set(memberRef, {
        uid: userId,
        fullName: name,
        email,
        phone: groupData.phone,
        role: "senior_admin",
        joinedAt: Timestamp.now(),
        status: "active",
        collateral: null,
        customPaymentRules: {}, // Can override group defaults
        financialSummary: {
          totalPaid: 0,
          totalArrears: seedMoney,
          totalLoans: 0,
          totalLoansPaid: 0
        }
      });

      // ✅ Add User Data with improved structure
      const userRef = doc(db, "users", userId);
      batch.set(userRef, {
        uid: userId,
        fullName: name,
        email,
        phone: groupData.phone,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        profileImageUrl: "",
        groupMemberships: [{
          groupId: groupId,
          role: "senior_admin",
          joinedAt: Timestamp.now()
        }]
      });

      // ✅ Initialize Payments Documents with improved structure
      const currentYear = new Date().getFullYear();

      // ✅ Create Seed Money Payment Year Document
      const seedMoneyDocRef = doc(db, `groups/${groupId}/payments`, `${currentYear}_SeedMoney`);
      batch.set(seedMoneyDocRef, { 
        year: currentYear,
        paymentType: "SeedMoney",
        createdAt: Timestamp.now(),
        totalExpected: seedMoney,
        totalReceived: 0,
        totalPending: 0
      });

      // ✅ Create User Seed Money Document with improved structure
      const userSeedMoneyRef = doc(collection(seedMoneyDocRef, userId), PAYMENT_DETAILS_DOC);
      batch.set(userSeedMoneyRef, {
        userId,
        fullName: name,
        paymentType: "Seed Money",
        totalAmount: seedMoney,
        amountPaid: 0,
        arrears: seedMoney,
        approvalStatus: "unpaid",
        paymentStatus: "unpaid",
        dueDate: seedMoneyDueDate,
        paidAt: null,
        approvedAt: null,
        createdAt: Timestamp.now(),
        updatedAt: null,
        proofOfPayment: {
          imageUrl: "",
          uploadedAt: null,
          verifiedBy: ""
        },
        currency: "MWK"
      });

      // ✅ Create Monthly Contributions Payment Year Document
      const monthlyContributionDocRef = doc(db, `groups/${groupId}/payments`, `${currentYear}_MonthlyContributions`);
      batch.set(monthlyContributionDocRef, { 
        year: currentYear,
        paymentType: "MonthlyContributions",
        createdAt: Timestamp.now(),
        totalExpected: monthlyContribution * 12, // For 12 months
        totalReceived: 0,
        totalPending: 0
      });

      // ✅ Create Monthly Contribution Payments for Each Month with improved structure
      const userMonthlyCollection = collection(monthlyContributionDocRef, userId);
      cycleDates.forEach((date) => {
        const monthlyPaymentDoc = doc(userMonthlyCollection, `${date.year}_${date.month}`);
        batch.set(monthlyPaymentDoc, {
          userId,
          fullName: name,
          paymentType: "Monthly Contribution",
          month: date.month,
          year: date.year,
          totalAmount: monthlyContribution,
          amountPaid: 0,
          arrears: monthlyContribution,
          approvalStatus: "unpaid",
          paymentStatus: "unpaid",
          dueDate: date.timestamp,
          paidAt: null,
          approvedAt: null,
          createdAt: Timestamp.now(),
          updatedAt: null,
          proofOfPayment: {
            imageUrl: "",
            uploadedAt: null,
            verifiedBy: ""
          },
          currency: "MWK"
        });
      });

      // ✅ Commit all changes
      toggleLoadingOverlay(true, "Finalizing your registration...");
      await batch.commit();
      console.log("✅ User, group, and payment records created successfully!");

      toggleLoadingOverlay(false);
      // Don't redirect here - let the calling function handle login and redirect
    } catch (error) {
      console.error("❌ Error during registration:", error.message);
      toggleLoadingOverlay(false);
      toggleFormFields(true);
      
      // Provide user-friendly error messages
      let errorMessage = "Registration failed: ";
      if (error.code === "auth/email-already-in-use") {
        errorMessage += "This email is already registered. Please use a different email or login.";
      } else if (error.code === "auth/invalid-email") {
        errorMessage += "Invalid email address format.";
      } else if (error.code === "auth/weak-password") {
        errorMessage += "Password is too weak. Please use a stronger password (at least 6 characters).";
      } else if (error.code === "auth/network-request-failed") {
        errorMessage += "Network error. Please check your internet connection and try again.";
      } else if (error.message.includes("permission")) {
        errorMessage += "Permission denied. Please contact support.";
      } else {
        errorMessage += error.message;
      }
      
      alert(errorMessage);
      throw error;
    }
  }
  
  // ✅ Helper function to create user and group with registration key deletion
  async function createUserAndGroupWithKey(name, email, password, groupData, registrationKey) {
    try {
      // Create user and group first
      await createUserAndGroup(name, email, password, groupData);
      
      // Delete the registration key after successful registration
      toggleLoadingOverlay(true, "Cleaning up registration key...");
      await markCodeAsUsedAndDelete(registrationKey);
      console.log("✅ Registration key deleted successfully!");
    } catch (error) {
      console.error("❌ Error during registration with key:", error.message);
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
  // Get phone number in international format (e.g., +265991234567)
  const phone = iti && iti.isValidNumber() ? iti.getNumber() : document.getElementById("phone").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const groupName = document.getElementById("groupName").value.trim();
  const seedMoney = parseFloat(document.getElementById("seedMoney").value);
  const seedMoneyDueDate = document.getElementById("seedMoneyDueDate").value;
  const loanInterestMonth1 = parseFloat(document.getElementById("loanInterestMonth1").value);
  const loanInterestMonth2 = parseFloat(document.getElementById("loanInterestMonth2").value) || loanInterestMonth1;
  const loanInterestMonth3 = parseFloat(document.getElementById("loanInterestMonth3").value) || loanInterestMonth2;
  const monthlyContribution = parseFloat(document.getElementById("monthlyContribution").value);
  const loanPenalty = parseFloat(document.getElementById("loanPenalty").value);
  const monthlyPenalty = parseFloat(document.getElementById("monthlyPenalty").value);
  const cycleStartDate = document.getElementById("cycleStartDate").value;

  // ✅ Validate input fields
  const errors = [];
  
  // Validate name
  const nameError = validateName(name);
  if (nameError) errors.push(nameError);
  
  // Validate email
  const emailError = validateEmail(email);
  if (emailError) errors.push(emailError);
  
  // Validate password
  const passwordError = validatePassword(password);
  if (passwordError) errors.push(passwordError);
  
  // Validate other required fields
  [
    validateField(phone, "Phone Number"),
    validateField(groupName, "Group Name"),
    validateField(seedMoneyDueDate, "Seed Money Due Date"),
    validateNumericField(seedMoney, "Seed Money", 0),
    validateNumericField(loanInterestMonth1, "Loan Interest Month 1", 0, 100, true),
    validateNumericField(monthlyContribution, "Monthly Contribution", 0),
    validateNumericField(loanPenalty, "Loan Penalty", 0, 100, true),
    validateNumericField(monthlyPenalty, "Monthly Penalty", 0, 100, true),
    validateField(cycleStartDate, "Cycle Start Date"),
  ].forEach(error => {
    if (error) errors.push(error);
  });

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

    // ✅ Create registration code and store it in database
    toggleLoadingOverlay(true, "Generating registration code...");
    let registrationKey;
    try {
      registrationKey = await createInvitationCode();
      // Store it in the hidden field
      document.getElementById("registrationKey").value = registrationKey;
      console.log("✅ Registration code generated:", registrationKey);
    } catch (error) {
      alert("Failed to generate registration code. Please try again.");
      submitButton.disabled = false;
      toggleFormFields(true);
      toggleLoadingOverlay(false);
      return;
    }

    // ✅ Wait for manual approval from Senior Admin
    toggleLoadingOverlay(true, `⏳ Registration code pending approval by Senior Admin...\n\nYour code: ${registrationKey}\n\nPlease wait while an administrator reviews your request.`);
    
    try {
      await pollForApproval(registrationKey, 600000); // Wait up to 10 minutes
      
      // Show success dialog when approved
      toggleLoadingOverlay(false);
      showSuccessDialog(
        "Registration Approved! 🎉",
        `Your registration code has been approved by the administrator. We're now creating your account and setting up your group. This will only take a moment.`,
        "Creating Account...",
        () => {
          toggleLoadingOverlay(true, "✅ Registration approved! Creating your account...");
        }
      );
      
      // Wait a moment for user to see the success message
      await new Promise(resolve => setTimeout(resolve, 2000));
      toggleLoadingOverlay(true, "✅ Registration approved! Creating your account...");
    } catch (approvalError) {
      toggleLoadingOverlay(false);
      showErrorDialog(
        "Approval Timeout",
        approvalError.message || "Your registration code was not approved within the time limit. Please contact an administrator or try again later.",
        "OK",
        () => {
          submitButton.disabled = false;
          toggleFormFields(true);
        }
      );
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
      loanInterestMonth1: loanInterestMonth1.toFixed(2),
      loanInterestMonth2: loanInterestMonth2.toFixed(2),
      loanInterestMonth3: loanInterestMonth3.toFixed(2),
      monthlyContribution: monthlyContribution.toFixed(2),
      loanPenalty: loanPenalty.toFixed(2),
      monthlyPenalty: monthlyPenalty.toFixed(2),
      cycleStartDate,
    };

    // ✅ Create user and group with registration key deletion
    await createUserAndGroupWithKey(name, email, password, groupData, registrationKey);

    // ✅ Auto-login the user after successful registration
    // Add a small delay to ensure the account is fully created
    toggleLoadingOverlay(true, "Logging you in...");
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    
    try {
      console.log("🔹 Attempting auto-login with email:", email);
      await signInWithEmailAndPassword(auth, email, password);
      console.log("✅ Auto-login successful");
      
      // Send welcome email (non-blocking, optional)
      // Note: Email service may have CORS issues - this is handled gracefully
      try {
        const { sendRegistrationWelcome } = await import('./emailService.js');
        sendRegistrationWelcome(email, name, groupData.groupName).catch(err => {
          console.warn("Email service unavailable (non-critical):", err.message);
        });
      } catch (emailError) {
        console.warn("Email service not available (non-critical)");
      }
      
      toggleLoadingOverlay(false);
      
      // Wait a moment to ensure DOM is ready
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Show success dialog
      showSuccessDialog(
        "Registration Complete! 🎉",
        `Welcome to Bank Nkhonde! Your account and group "${groupData.groupName}" have been successfully created. Please complete your profile to continue.`,
        "Complete Profile",
        () => {
          window.location.href = "complete_profile.html";
        }
      );
    } catch (loginError) {
      console.error("❌ Auto-login failed:", loginError.code, loginError.message);
      toggleLoadingOverlay(false);
      
      // Get user-friendly error message
      let errorMessage = "We couldn't automatically log you in. ";
      if (loginError.code === "auth/invalid-login-credentials" || loginError.code === "auth/invalid-credential") {
        errorMessage += "This might be because your account needs a moment to be fully activated. ";
      } else if (loginError.code === "auth/user-disabled") {
        errorMessage += "Your account has been disabled. Please contact support. ";
      } else if (loginError.code === "auth/network-request-failed") {
        errorMessage += "There was a network error. Please check your internet connection. ";
      } else {
        errorMessage += `Error: ${loginError.message}. `;
      }
      errorMessage += "Please log in manually with your email and password.";
      
      showErrorDialog(
        "Auto-Login Failed",
        errorMessage,
        "Go to Login",
        () => {
          window.location.href = "../login.html";
        }
      );
    }

  } catch (error) {
    console.error("❌ Error during registration:", error.message);
    toggleLoadingOverlay(false);
    
    let errorTitle = "Registration Error";
    let errorMessage = error.message;
    
    // Provide user-friendly error messages
    if (error.code === "auth/email-already-in-use") {
      errorTitle = "Email Already Registered";
      errorMessage = "An account with this email already exists. Please use a different email or log in instead.";
    } else if (error.code === "auth/invalid-email") {
      errorTitle = "Invalid Email";
      errorMessage = "The email address you entered is not valid. Please check and try again.";
    } else if (error.code === "auth/weak-password") {
      errorTitle = "Weak Password";
      errorMessage = "Your password is too weak. Please use a stronger password (at least 6 characters with numbers or special characters).";
    } else if (error.code === "auth/network-request-failed") {
      errorTitle = "Network Error";
      errorMessage = "There was a network error. Please check your internet connection and try again.";
    } else if (error.message.includes("permission")) {
      errorTitle = "Permission Denied";
      errorMessage = "You don't have permission to perform this action. Please contact support.";
    }
    
    showErrorDialog(
      errorTitle,
      errorMessage,
      "OK",
      () => {
        toggleFormFields(true);
        submitButton.disabled = false;
      }
    );
  }
});


});
