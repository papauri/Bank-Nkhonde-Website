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
  const loadingOverlay = document.getElementById("spinner");
  const loadingMessage = document.getElementById("loadingText");
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
    if (loadingMessage) {
      loadingMessage.innerHTML = message.replace(/\n/g, '<br>'); // Support multi-line messages
    }
    if (loadingOverlay) {
      loadingOverlay.classList.toggle("show", show);
      loadingOverlay.classList.toggle("hidden", !show);
    }
    document.body.style.pointerEvents = show ? "none" : "auto";
  }

  // ✅ Enable/Disable Form Fields
  function toggleFormFields(enable = true) {
    formFields.forEach((field) => (field.disabled = !enable));
  }

  // ✅ Dialog Functions
  function showSuccessDialog(title, message, buttonText = "OK", onClose = null) {
    const successModal = document.getElementById("successModal");
    const successModalTitle = document.getElementById("successModalTitle");
    const successModalMessage = document.getElementById("successModalMessage");
    const successModalButton = document.getElementById("successModalButton");
    
    if (!successModal || !successModalTitle || !successModalMessage || !successModalButton) {
      console.error("Modal elements not found, falling back to alert");
      alert(`${title}\n\n${message}`);
      if (onClose && typeof onClose === 'function') {
        onClose();
      }
      return;
    }
    
    // IMPORTANT: Reset pointer events to ensure modal is clickable
    document.body.style.pointerEvents = "auto";
    
    // Update title (keep icon, update text)
    const titleSpan = successModalTitle.querySelector('span:last-child');
    if (titleSpan) titleSpan.textContent = title;
    
    successModalMessage.textContent = message;
    successModalButton.textContent = buttonText;
    successModalButton.disabled = false; // Ensure button is enabled
    successModalButton.style.pointerEvents = "auto"; // Ensure button is clickable
    
    // Update button click handler
    successModalButton.onclick = () => {
      closeSuccessModal();
      if (onClose && typeof onClose === 'function') {
        onClose();
      }
    };
    
    successModal.classList.remove("hidden");
    successModal.classList.add("active");
    successModal.style.pointerEvents = "auto"; // Ensure modal overlay is clickable
    document.body.style.overflow = 'hidden';
  }

  window.closeSuccessModal = function() {
    const successModal = document.getElementById("successModal");
    if (successModal) {
      successModal.classList.add("hidden");
      successModal.classList.remove("active");
      document.body.style.overflow = '';
    }
  };

  function showErrorDialog(title, message, buttonText = "Close", onClose = null) {
    const errorModal = document.getElementById("errorModal");
    const errorModalTitle = document.getElementById("errorModalTitle");
    const errorModalMessage = document.getElementById("errorModalMessage");
    const errorModalButton = document.getElementById("errorModalButton");
    
    if (!errorModal || !errorModalTitle || !errorModalMessage || !errorModalButton) {
      console.error("Modal elements not found, falling back to alert");
      alert(`${title}\n\n${message}`);
      if (onClose && typeof onClose === 'function') {
        onClose();
      }
      return;
    }
    
    // IMPORTANT: Reset pointer events to ensure modal is clickable
    document.body.style.pointerEvents = "auto";
    
    // Update title (keep icon, update text)
    const titleSpan = errorModalTitle.querySelector('span:last-child');
    if (titleSpan) titleSpan.textContent = title;
    
    errorModalMessage.textContent = message;
    errorModalButton.textContent = buttonText;
    errorModalButton.disabled = false; // Ensure button is enabled
    errorModalButton.style.pointerEvents = "auto"; // Ensure button is clickable
    
    // Update button click handler
    errorModalButton.onclick = () => {
      closeErrorModal();
      if (onClose && typeof onClose === 'function') {
        onClose();
      }
    };
    
    errorModal.classList.remove("hidden");
    errorModal.classList.add("active");
    errorModal.style.pointerEvents = "auto"; // Ensure modal overlay is clickable
    document.body.style.overflow = 'hidden';
  }

  window.closeErrorModal = function() {
    const errorModal = document.getElementById("errorModal");
    if (errorModal) {
      errorModal.classList.add("hidden");
      errorModal.classList.remove("active");
      document.body.style.overflow = '';
    }
  };
  
  // Close modals on overlay click
  document.addEventListener('DOMContentLoaded', () => {
    const successModal = document.getElementById("successModal");
    const errorModal = document.getElementById("errorModal");
    
    if (successModal) {
      successModal.addEventListener('click', (e) => {
        if (e.target === successModal) {
          window.closeSuccessModal();
        }
      });
    }
    
    if (errorModal) {
      errorModal.addEventListener('click', (e) => {
        if (e.target === errorModal) {
          window.closeErrorModal();
        }
      });
    }
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (successModal && !successModal.classList.contains('hidden')) {
          window.closeSuccessModal();
        }
        if (errorModal && !errorModal.classList.contains('hidden')) {
          window.closeErrorModal();
        }
      }
    });
  });

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
      const serviceFee = parseFloat(groupData.serviceFee || 0); // Optional service fee

      if (
        isNaN(seedMoney) || isNaN(loanInterestMonth1) || isNaN(monthlyContribution) ||
        isNaN(loanPenalty) || isNaN(monthlyPenalty) || isNaN(serviceFee)
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
            amount: seedMoney,
            dueDate: groupData.seedMoneyDueDate,
            required: true,
            allowPartialPayment: true,
            maxPaymentMonths: 2,
            mustBeFullyPaid: true
          },
          // Monthly Contribution: Same amount for all members, due same day each month
          monthlyContribution: {
            amount: monthlyContribution,
            required: true,
            dayOfMonth: groupData.contributionDueDay || 15,
            allowPartialPayment: true
          },
          // Service Fee: Optional one-time fee per cycle for operational costs (bank charges, etc.)
          serviceFee: {
            amount: serviceFee,
            required: serviceFee > 0,
            dueDate: groupData.serviceFeeDueDate || null,
            perCycle: true, // Paid once per cycle, not monthly
            nonRefundable: true, // Service fee is not refundable
            description: "Operational service fee (bank charges, etc.)"
          },
          // Loan Interest: Dynamic rates per month based on max repayment period
          loanInterest: {
            // Dynamic rates object - supports any number of months
            rates: groupData.interestRates || {
              month1: loanInterestMonth1,
              month2: loanInterestMonth2,
              month3: loanInterestMonth3
            },
            // Legacy fields for backward compatibility
            month1: groupData.interestRateMonth1 || loanInterestMonth1,
            month2: groupData.interestRateMonth2 || loanInterestMonth2,
            month3AndBeyond: groupData.interestRateMonth3 || loanInterestMonth3,
            calculationMethod: groupData.interestMethod || "reduced_balance",
            maxRepaymentMonths: groupData.maxRepaymentMonths || 3,
            description: groupData.interestMethod === "reduced_balance" 
              ? "Interest calculated on remaining principal (reduced balance)"
              : "Flat rate interest on original loan amount"
          },
          // Loan Penalty: % extra on top of monthly loan payment if missed deadline
          loanPenalty: {
            rate: groupData.loanPenaltyRate || loanPenalty,
            type: "percentage",
            gracePeriodDays: groupData.gracePeriod || 5,
            description: "Percentage penalty added to missed loan payment amount"
          },
          // Daily/Monthly Penalty: for missed contributions
          contributionPenalty: {
            dailyRate: groupData.dailyPenaltyRate || 1,
            monthlyRate: monthlyPenalty,
            type: "percentage",
            gracePeriodDays: groupData.gracePeriod || 5,
            calculationMethod: "daily",
            description: "Daily percentage penalty for late contributions"
          },
          cycleDuration: {
            startDate: groupData.cycleStartDate,
            endDate: null,
            months: groupData.cycleLength || 11,
            autoRenew: false
          },
          loanRules: {
            maxLoanAmount: groupData.maxLoanAmount || 0,
            // Minimum loan amount each member must take during the cycle (for fair interest distribution)
            minCycleLoanAmount: groupData.minCycleLoanAmount || 0,
            maxActiveLoansByMember: 1,
            requireCollateral: groupData.requireCollateral || false,
            minRepaymentMonths: 1,
            maxRepaymentMonths: groupData.maxRepaymentMonths || 3,
            loanPeriodCalculation: groupData.loanPeriodCalculation || "auto",
            // Auto-calculation: Loan period based on amount
            autoCalculationTiers: [
              { maxAmount: 100000, maxMonths: 1 },
              { maxAmount: 300000, maxMonths: 2 },
              { maxAmount: 500000, maxMonths: 3 },
              { maxAmount: Infinity, maxMonths: groupData.maxRepaymentMonths || 3 }
            ],
            repaymentCalculation: {
              method: groupData.interestMethod === "reduced_balance" ? "reduced_balance" : "flat_rate"
            },
            // Force loan tracking - to ensure fair interest distribution
            forceLoanTracking: {
              enabled: groupData.minCycleLoanAmount > 0,
              minAmount: groupData.minCycleLoanAmount || 0,
              description: "Track members who haven't met minimum loan requirement for fair interest distribution"
            }
          },
          customRules: []
        },
        
        // Phase 2: Advanced Settings
        advancedSettings: {
          surplusDistribution: groupData.surplusDistribution || "equal",
          enableLoanBooking: groupData.enableLoanBooking !== false,
          autoMonthlyReports: groupData.autoMonthlyReports !== false,
          allowPartialPayments: groupData.allowPartialPayments !== false,
          requiredDocuments: groupData.requiredDocuments || {
            nationalId: true,
            proofOfAddress: false,
            guarantor: true,
            employmentLetter: false,
            photo: false,
            bankDetails: false
          },
          // Loan Booking Queue - for tracking booked loans
          loanBookingQueue: [],
          // Repayment History Tracking - enabled by default
          enableRepaymentHistory: true
        },
        
        // Governance Rules and Regulations
        governance: {
          rules: groupData.governanceRules || "",
          rulesDocumentUrl: "", // Will be updated after file upload
          lastUpdated: Timestamp.now(),
          updatedBy: userId
        },
        
        // Group Description
        description: groupData.groupDescription || "",
        
        // Expected membership
        expectedMembers: groupData.expectedMembers || 0,
        
        // Penalty settings
        penaltySettings: {
          type: groupData.penaltyType || 'percentage', // 'percentage' or 'fixed'
          // Percentage-based penalties
          dailyRate: groupData.dailyPenaltyRate || 0,
          maxCap: groupData.maxPenaltyCap || 0,
          // Fixed amount penalties
          dailyFixed: groupData.dailyPenaltyFixed || 0,
          maxCapFixed: groupData.maxPenaltyCapFixed || 0,
          // Grace periods
          gracePeriodDays: groupData.gracePeriod || 5,
          loanGracePeriodDays: groupData.loanGracePeriod || 3
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
        
        // Admin information - includes primary and additional admins
        admins: [
          { 
            uid: userId, 
            fullName: name, 
            email,
            phone: groupData.phone,
            whatsappNumber: groupData.phone,
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
          }
        ],
        
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

      // ✅ Create Service Fee Payment Document (if service fee is set)
      if (serviceFee > 0) {
        const serviceFeeDueDate = groupData.serviceFeeDueDate 
          ? Timestamp.fromDate(new Date(groupData.serviceFeeDueDate))
          : seedMoneyDueDate; // Default to seed money due date if not specified
        
        const serviceFeeDocRef = doc(db, `groups/${groupId}/payments`, `${currentYear}_ServiceFee`);
        batch.set(serviceFeeDocRef, {
          year: currentYear,
          paymentType: "ServiceFee",
          createdAt: Timestamp.now(),
          totalExpected: serviceFee,
          totalReceived: 0,
          totalPending: 0,
          perCycle: true,
          nonRefundable: true
        });

        // ✅ Create User Service Fee Document
        const userServiceFeeRef = doc(collection(serviceFeeDocRef, userId), PAYMENT_DETAILS_DOC);
        batch.set(userServiceFeeRef, {
          userId,
          fullName: name,
          paymentType: "Service Fee",
          totalAmount: serviceFee,
          amountPaid: 0,
          arrears: serviceFee,
          approvalStatus: "unpaid",
          paymentStatus: "unpaid",
          dueDate: serviceFeeDueDate,
          paidAt: null,
          approvedAt: null,
          createdAt: Timestamp.now(),
          updatedAt: null,
          proofOfPayment: {
            imageUrl: "",
            uploadedAt: null,
            verifiedBy: ""
          },
          currency: "MWK",
          perCycle: true,
          nonRefundable: true,
          description: "Operational service fee (bank charges, etc.)"
        });
      }

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

// Helper function to get numeric value from formatted currency
function getCurrencyValue(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  return parseInt(el.value.replace(/[^\d]/g, '')) || 0;
}

// Handle registration form submission
registrationForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  // ✅ Prevent duplicate submissions
  const submitButton = document.getElementById("submitBtn") || registrationForm.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;

  // ✅ Collect data from form fields (support both old and new form structure)
  const name = (document.getElementById("fullName") || document.getElementById("name"))?.value?.trim() || '';
  // Get phone number in international format (e.g., +265991234567)
  const phone = iti && iti.isValidNumber() ? iti.getNumber() : document.getElementById("phone")?.value?.trim() || '';
  const email = document.getElementById("email")?.value?.trim() || '';
  const password = document.getElementById("password")?.value?.trim() || '';
  const groupName = document.getElementById("groupName")?.value?.trim() || '';
  const groupDescription = document.getElementById("groupDescription")?.value?.trim() || '';
  
  // WhatsApp number (optional - defaults to phone if empty)
  const whatsappNumberInput = document.getElementById("whatsappNumber")?.value?.trim() || '';
  const whatsappNumber = whatsappNumberInput || phone;
  
  // Get currency values (handles comma-formatted inputs)
  const seedMoney = getCurrencyValue("seedMoney");
  const monthlyContribution = getCurrencyValue("monthlyContribution");
  const serviceFee = getCurrencyValue("serviceFee"); // Optional service fee
  const maxLoanAmountVal = getCurrencyValue("maxLoanAmount");
  const minCycleLoanAmount = getCurrencyValue("minCycleLoanAmount"); // Min loan each member must take during cycle
  
  // Cycle and timing
  const cycleLength = parseInt(document.getElementById("cycleLength")?.value) || 11;
  const cycleStartDateVal = document.getElementById("cycleStartDate")?.value || '';
  const contributionDueDay = parseInt(document.getElementById("contributionDueDay")?.value) || 15;
  const expectedMembers = parseInt(document.getElementById("expectedMembers")?.value) || 0;
  const seedMoneyDueDateVal = document.getElementById("seedMoneyDueDate")?.value || '';
  const serviceFeeDueDateVal = document.getElementById("serviceFeeDueDate")?.value || '';
  
  // Penalty settings
  const gracePeriod = parseInt(document.getElementById("gracePeriod")?.value) || 5;
  const penaltyType = document.querySelector('input[name="penaltyType"]:checked')?.value || 'percentage';
  
  let dailyPenaltyRate, maxPenaltyCap, dailyPenaltyFixed, maxPenaltyCapFixed;
  
  if (penaltyType === 'percentage') {
    dailyPenaltyRate = parseFloat(document.getElementById("dailyPenaltyRate")?.value) || 1;
    maxPenaltyCap = parseFloat(document.getElementById("maxPenaltyCap")?.value) || 30;
    dailyPenaltyFixed = 0;
    maxPenaltyCapFixed = 0;
  } else {
    dailyPenaltyFixed = getCurrencyValue("dailyPenaltyFixed");
    maxPenaltyCapFixed = getCurrencyValue("maxPenaltyCapFixed");
    dailyPenaltyRate = 0;
    maxPenaltyCap = 0;
  }
  
  // Interest settings
  const interestMethod = document.getElementById("interestMethod")?.value || "reduced_balance";
  
  // Loan settings (get max repayment months first to determine interest rates)
  const maxRepaymentMonths = parseInt(document.getElementById("maxRepaymentMonths")?.value) || 3;
  const loanPenaltyRate = parseFloat(document.getElementById("loanPenaltyRate")?.value) || 2;
  const loanGracePeriod = parseInt(document.getElementById("loanGracePeriod")?.value) || 3;
  const loanPeriodCalculation = document.getElementById("loanPeriodCalculation")?.value || "auto";
  
  // Collect dynamic interest rates based on max repayment months
  const interestRates = {};
  const defaultRates = [10, 7, 5, 4, 3, 2];
  for (let i = 1; i <= maxRepaymentMonths; i++) {
    // Check window.interestRates first (set by inline JS), then try DOM element
    if (window.interestRates && window.interestRates[`month${i}`] !== undefined) {
      interestRates[`month${i}`] = parseFloat(window.interestRates[`month${i}`]) || defaultRates[i-1] || 3;
    } else {
      const el = document.getElementById(`interestRateMonth${i}`);
      interestRates[`month${i}`] = el ? parseFloat(el.value) || defaultRates[i-1] || 3 : defaultRates[i-1] || 3;
    }
  }
  
  // For backward compatibility, set individual variables
  const interestRateMonth1 = interestRates.month1 || 10;
  const interestRateMonth2 = interestRates.month2 || interestRateMonth1;
  const interestRateMonth3 = interestRates.month3 || interestRateMonth2;
  
  // Governance and rules
  const governanceRules = document.getElementById("governanceRules")?.value?.trim() || '';
  const surplusDistribution = document.getElementById("surplusDistribution")?.value || "equal";
  
  // Feature toggles
  const requireCollateral = document.getElementById("requireCollateral")?.checked || false;
  const enableLoanBooking = document.getElementById("enableLoanBooking")?.checked ?? true;
  const autoMonthlyReports = document.getElementById("autoMonthlyReports")?.checked ?? true;
  const allowPartialPayments = document.getElementById("allowPartialPayments")?.checked ?? true;
  
  // Required documents
  const requireNationalId = document.getElementById("requireNationalId")?.checked ?? true;
  const requireProofOfAddress = document.getElementById("requireProofOfAddress")?.checked || false;
  const requireGuarantor = document.getElementById("requireGuarantor")?.checked ?? true;
  const requireEmploymentLetter = document.getElementById("requireEmploymentLetter")?.checked || false;
  const requirePhoto = document.getElementById("requirePhoto")?.checked || false;
  const requireBankDetails = document.getElementById("requireBankDetails")?.checked || false;
  
  // Co-admin feature removed - keeping for backward compatibility
  const additionalAdmins = [];
  
  // Get rules file if uploaded
  const rulesFile = window.rulesFile || null;
  
  // Legacy compatibility
  const loanInterestMonth1 = interestRateMonth1;
  const loanInterestMonth2 = interestRateMonth2;
  const loanInterestMonth3 = interestRateMonth3;
  const loanPenalty = loanPenaltyRate;
  const monthlyPenalty = dailyPenaltyRate * 30;
  const maxLoanAmount = maxLoanAmountVal;
  const minLoanAmountVal = 0; // Not used - using minCycleLoanAmount instead
  
  // Calculate dates with fallbacks
  let seedMoneyDueDateStr = seedMoneyDueDateVal;
  if (!seedMoneyDueDateStr) {
    const seedMoneyDueDate = new Date();
    seedMoneyDueDate.setDate(seedMoneyDueDate.getDate() + 30);
    seedMoneyDueDateStr = seedMoneyDueDate.toISOString().split('T')[0];
  }
  
  let cycleStartDateStr = cycleStartDateVal;
  if (!cycleStartDateStr) {
    const cycleStartDate = new Date();
    cycleStartDate.setMonth(cycleStartDate.getMonth() + 1);
    cycleStartDate.setDate(1);
    cycleStartDateStr = cycleStartDate.toISOString().split('T')[0];
  }

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
    validateNumericField(seedMoney, "Seed Money", 0),
    validateNumericField(monthlyContribution, "Monthly Contribution", 0), // Allow 0 for groups that only use seed money
    validateNumericField(serviceFee, "Service Fee", 0), // Service fee is optional, min 0
  ].forEach(error => {
    if (error) errors.push(error);
  });

  // ✅ Validate phone input separately
  const phoneValid = (iti && typeof iti.isValidNumber === 'function') ? iti.isValidNumber() : (phone && phone.length > 8);
  if (!phoneValid) {
    errors.push("Phone Number is invalid.");
  }

  // ✅ Stop submission if errors exist
  if (errors.length > 0) {
    const errorEl = document.getElementById("errorMessage");
    if (errorEl) {
      errorEl.textContent = errors.join(". ");
      errorEl.classList.remove("hidden");
    } else {
      showErrorDialog(
        "Validation Errors",
        "Please fix the following errors:\n\n" + errors.join("\n"),
        "OK",
        () => {
          if (submitButton) submitButton.disabled = false;
        }
      );
    }
    if (submitButton) submitButton.disabled = false;
    return;
  }

  try {
    toggleLoadingOverlay(true, "Validating your information...");
    toggleFormFields(false);

    // ✅ Check if email already exists
    const emailExists = await checkEmailExists(email);
    if (emailExists) {
      toggleLoadingOverlay(false);
      showErrorDialog(
        "Email Already Exists",
        "An account with this email already exists. Please use a different email or log in to your existing account.",
        "OK",
        () => {
          if (submitButton) submitButton.disabled = false;
          toggleFormFields(true);
        }
      );
      return;
    }

    // ✅ Create registration code and store it in database
    toggleLoadingOverlay(true, "Generating registration code...");
    let registrationKey;
    try {
      registrationKey = await createInvitationCode();
      // Store it in the hidden field if it exists
      const registrationKeyField = document.getElementById("registrationKey");
      if (registrationKeyField) {
        registrationKeyField.value = registrationKey;
      }
      console.log("✅ Registration code generated:", registrationKey);
    } catch (error) {
      console.error("❌ Error generating registration code:", error);
      toggleLoadingOverlay(false);
      const errorMessage = error.message || "Failed to generate registration code. Please check your internet connection and try again.";
      showErrorDialog(
        "Registration Code Error",
        errorMessage,
        "Try Again",
        () => {
          submitButton.disabled = false;
          toggleFormFields(true);
        }
      );
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
      groupDescription,
      phone,
      whatsappNumber, // WhatsApp number for easier communication
      seedMoney: seedMoney,
      seedMoneyDueDate: seedMoneyDueDateStr,
      serviceFee: serviceFee || 0,
      serviceFeeDueDate: serviceFeeDueDateVal || '',
      loanInterestMonth1: loanInterestMonth1,
      loanInterestMonth2: loanInterestMonth2,
      loanInterestMonth3: loanInterestMonth3,
      monthlyContribution: monthlyContribution,
      loanPenalty: loanPenalty,
      monthlyPenalty: monthlyPenalty,
      cycleStartDate: cycleStartDateStr,
      
      // Dynamic interest rates for all months
      interestRates: interestRates,
      
      // Minimum cycle loan amount (for tracking fair loan distribution)
      minCycleLoanAmount: minCycleLoanAmount || 0,
      
      // Cycle Settings
      contributionDueDay,
      cycleLength,
      expectedMembers,
      
      // Penalty Settings
      penaltyType, // 'percentage' or 'fixed'
      dailyPenaltyRate,
      dailyPenaltyFixed,
      gracePeriod,
      maxPenaltyCap,
      maxPenaltyCapFixed,
      
      // Interest Settings
      interestMethod,
      interestRateMonth1,
      interestRateMonth2,
      interestRateMonth3,
      
      // Loan Settings
      loanPenaltyRate,
      loanGracePeriod,
      maxLoanAmount: maxLoanAmount || null,
      minLoanAmount: minLoanAmountVal || 0,
      maxRepaymentMonths,
      loanPeriodCalculation,
      requireCollateral,
      
      // Governance
      governanceRules,
      surplusDistribution,
      
      // Feature Toggles
      enableLoanBooking,
      autoMonthlyReports,
      allowPartialPayments,
      
      
      // Required Documents
      requiredDocuments: {
        nationalId: requireNationalId,
        proofOfAddress: requireProofOfAddress,
        guarantor: requireGuarantor,
        employmentLetter: requireEmploymentLetter,
        photo: requirePhoto,
        bankDetails: requireBankDetails,
      },
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
      // Email failures won't prevent successful registration
      try {
        const { sendRegistrationWelcome } = await import('./emailService.js');
        sendRegistrationWelcome(email, name, groupData.groupName)
          .then(result => {
            if (result && !result.success) {
              console.warn("⚠️ Email service unavailable (non-critical):", result.message || result.details);
            }
          })
          .catch(err => {
            // Email errors are non-critical - registration still succeeds
            console.warn("⚠️ Email service error (non-critical):", err.message || err);
          });
      } catch (emailError) {
        // Import or service error - non-critical
        console.warn("⚠️ Email service not available (non-critical):", emailError.message || emailError);
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
