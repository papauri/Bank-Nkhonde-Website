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
    loadingMessage.innerHTML = message.replace(/\n/g, '<br>'); // Support multi-line messages
    loadingOverlay.classList.toggle("show", show);
    loadingOverlay.classList.toggle("hidden", !show);
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
          seedMoney: {
            amount: seedMoney,
            dueDate: seedMoneyDueDate,
            required: true,
            allowPartialPayment: false
          },
          monthlyContribution: {
            amount: monthlyContribution,
            required: true,
            dayOfMonth: new Date(groupData.cycleStartDate).getDate(),
            allowPartialPayment: true
          },
          interestRate: interestRate,
          loanPenalty: {
            rate: loanPenalty,
            type: "percentage",
            gracePeriodDays: 0
          },
          monthlyPenalty: {
            rate: monthlyPenalty,
            type: "percentage",
            gracePeriodDays: 0
          },
          cycleDuration: {
            startDate: cycleStartDate,
            endDate: null, // Can be set later
            months: 12,
            autoRenew: false
          },
          loanRules: {
            maxLoanAmount: 0, // To be set by admin
            minLoanAmount: 0,
            maxActiveLoansByMember: 1,
            requireCollateral: true,
            minRepaymentMonths: 1,
            maxRepaymentMonths: 12
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
        }
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
        }
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
          }
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
      alert(`Registration failed: ${error.message}`);
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
    validateNumericField(interestRate, "Interest Rate", 0, 100, true),
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
    toggleLoadingOverlay(true, "⏳ Registration code pending approval by Senior Admin...\n\nYour code: " + registrationKey + "\n\nPlease wait while an administrator reviews your request.");
    
    try {
      await pollForApproval(registrationKey, 600000); // Wait up to 10 minutes
      toggleLoadingOverlay(true, "✅ Registration approved! Creating your account...");
    } catch (approvalError) {
      alert(approvalError.message);
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

    // ✅ Create user and group with registration key deletion
    await createUserAndGroupWithKey(name, email, password, groupData, registrationKey);

    // ✅ Auto-login the user after successful registration
    toggleLoadingOverlay(true, "Logging you in...");
    try {
      await signInWithEmailAndPassword(auth, email, password);
      toggleLoadingOverlay(false);
      alert("Registration complete! Welcome to your admin dashboard.");
      window.location.href = "admin_dashboard.html"; // Redirect to admin dashboard
    } catch (loginError) {
      console.error("❌ Auto-login failed:", loginError.message);
      toggleLoadingOverlay(false);
      alert("Registration complete! Please login with your credentials.");
      window.location.href = "../login.html"; // Redirect to login
    }

  } catch (error) {
    console.error("❌ Error during registration:", error.message);
    alert(`An error occurred: ${error.message}`);
    toggleFormFields(true);
    toggleLoadingOverlay(false);
    submitButton.disabled = false;
  }
});


});
