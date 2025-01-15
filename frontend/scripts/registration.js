// Firebase Setup
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  collection,
  addDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { initializeLoansStructure, createLoanRecord, updateLoanSummary } from "./loans.js";


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
const auth = getAuth(app);
const db = getFirestore(app);

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
    preferredCountries: ["mw", "us", "gb"],
    separateDialCode: true,
    utilsScript: "https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/js/utils.min.js",
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
    formFields.forEach((field) => {
      field.disabled = true;
    });
  }

  // Enable all form fields
  function enableFormFields() {
    formFields.forEach((field) => {
      field.disabled = false;
    });
  }

  // Validate required fields
  function validateField(value, fieldName) {
    if (!value || value.trim() === "") {
      return `${fieldName} is required.`;
    }
    return null;
  }

  // Validate numeric fields
  function validateNumericField(value, fieldName, minValue = 0, maxValue = Infinity, isPercentage = false) {
    const parsedValue = parseFloat(value);
    if (isNaN(parsedValue) || parsedValue < minValue || parsedValue > maxValue) {
      return `${fieldName} must be a valid ${isPercentage ? "percentage" : "amount"} between ${minValue} and ${maxValue}.`;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
      return `${fieldName} can only have up to two decimal places.`;
    }
    return null;
  }

  // Format numeric values to two decimal places
  function formatToTwoDecimals(value) {
    if (!value || isNaN(value)) return "0.00";
    return parseFloat(value).toFixed(2);
  }

  // Normalize and validate phone number
  function normalizePhoneNumber() {
    if (iti.isValidNumber()) {
      return iti.getNumber(); // Get the complete international number
    }
    return null; // Invalid phone number
  }

  // Validate phone input and display errors
  function validatePhoneInput() {
    const errorElementId = "phoneError";
    let errorElement = document.getElementById(errorElementId);

    if (errorElement) {
      errorElement.remove();
    }

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

  // Add phone validation event listeners
  phoneInput.addEventListener("blur", validatePhoneInput);
  phoneInput.addEventListener("input", validatePhoneInput);

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

  async function trackApprovalStatus(invitationDocId, name, email, password, groupData) {
    const docRef = doc(db, "invitationCodes", invitationDocId);

    showLoadingOverlay("Waiting for admin approval...");
    onSnapshot(docRef, async (snapshot) => {
        if (!snapshot.exists()) {
            alert("The invitation code no longer exists. Please try again.");
            enableFormFields();
            hideLoadingOverlay();
            return;
        }

        const data = snapshot.data();
        if (data.approved) {
            try {
                showLoadingOverlay("Finalizing registration...");

                // Validate inputs
                if (!name || !email || !password) {
                    throw new Error("Missing user information. Please ensure all fields are filled correctly.");
                }

                if (
                    !groupData.groupName ||
                    !groupData.seedMoney ||
                    !groupData.monthlyContribution ||
                    !groupData.loanPenalty ||
                    !groupData.monthlyPenalty
                ) {
                    throw new Error("Missing group information. Please check the group creation form.");
                }

                const currentYear = new Date().getFullYear().toString();
                const currentMonth = new Date().toLocaleString("en-us", { month: "long" });

                const months = [
                    "January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December"
                ];

                // Placeholder variables for rollback
                let userCreated = false;
                let groupId = null;

                // Step 1: Create the user in Firebase Authentication
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                userCreated = true;

                // Step 2: Save user details in Firestore
                await setDoc(doc(db, "users", user.uid), {
                    name,
                    email,
                    phone: groupData.phone,
                    role: "admin",
                    createdAt: new Date(),
                });

                // Step 3: Save group details in Firestore and assign `groupId`
                const groupDoc = await addDoc(collection(db, "groups"), {
                    groupName: groupData.groupName,
                    seedMoney: formatToTwoDecimals(groupData.seedMoney),
                    interestRate: formatToTwoDecimals(groupData.interestRate),
                    monthlyContribution: formatToTwoDecimals(groupData.monthlyContribution),
                    loanPenalty: formatToTwoDecimals(groupData.loanPenalty),
                    monthlyPenalty: formatToTwoDecimals(groupData.monthlyPenalty),
                    createdAt: new Date(),
                });
                groupId = groupDoc.id;

                // Step 4: Add admin as a member of the group
                const membersRef = collection(db, `groups/${groupId}/members`);
                const memberDocRef = doc(membersRef, name); // Use full name as document ID
                await setDoc(memberDocRef, {
                    fullName: name,
                    email,
                    phone: groupData.phone,
                    role: "admin",
                    status: "active",
                    joinedAt: new Date(),
                });

                // Step 5: Initialize loans structure
                await initializeLoansStructure(groupId, currentYear, months);

                // Step 6: Create a default loan record for admin
                await createLoanRecord(groupId, currentYear, currentMonth, name, 0, 0);

                // Step 7: Update loan summary
                await updateLoanSummary(groupId, currentYear, name, 0);

                // Step 8: Initialize payments structure
                for (const month of months) {
                    const monthRef = collection(db, `groups/${groupId}/payments/${currentYear}/${month}`);
                    await setDoc(doc(monthRef, "initialized"), { initialized: true });
                }

                // Step 9: Create initial payments for the admin
                async function createPayment(userFullName, paymentType, totalAmount, paidAmount, options = {}) {
                    const arrears = totalAmount - paidAmount;
                    const balance = Math.max(paidAmount - totalAmount, 0);
                    const status = arrears > 0 ? "pending" : "completed";

                    const paymentRef = collection(
                        db,
                        `groups/${groupId}/payments/${currentYear}/${currentMonth}/${userFullName}/${paymentType}`
                    );

                    const paymentRecord = {
                        paymentId: `${paymentType}-${Date.now()}`,
                        fullName: userFullName,
                        groupId: groupId,
                        paymentType,
                        totalAmount: formatToTwoDecimals(totalAmount),
                        paidAmount: formatToTwoDecimals(paidAmount),
                        arrears: formatToTwoDecimals(arrears),
                        balance: formatToTwoDecimals(balance),
                        paymentDate: new Date(),
                        status,
                        approvedBy: null,
                        approvalStatus: "pending",
                        paymentRecords: [],
                    };

                    // Apply late penalty for monthly contribution and seed money
                    if (paymentType === "Seed Money" || paymentType === "Monthly Contribution") {
                        paymentRecord.latePenalty = formatToTwoDecimals(
                            totalAmount * (groupData.monthlyPenalty / 100)
                        );
                    }

                    // Apply loan penalty and interest for loan repayment
                    if (paymentType === "Loan Repayment") {
                        paymentRecord.loanInterest = formatToTwoDecimals(
                            totalAmount * (groupData.interestRate / 100)
                        );
                        paymentRecord.loanPenalty = formatToTwoDecimals(
                            totalAmount * (groupData.loanPenalty / 100)
                        );
                        paymentRecord.loanTakenDate = new Date();
                    }

                    await addDoc(paymentRef, paymentRecord);
                }

                await createPayment(name, "Seed Money", groupData.seedMoney, 0);
                await createPayment(name, "Monthly Contribution", groupData.monthlyContribution, 0);

                hideLoadingOverlay();
                alert("Your registration and group creation are complete.");
                window.location.href = "../pages/admin_dashboard.html";
            } catch (error) {
                console.error("Error during registration:", error.message);
                hideLoadingOverlay();
                enableFormFields();

                if (auth.currentUser) {
                    await auth.currentUser.delete();
                    console.log("Rolled back created user from Firebase Auth.");
                }

                if (groupId) {
                    await deleteDoc(doc(db, `groups/${groupId}`));
                    console.log("Rolled back created group from Firestore.");
                }

                alert(error.message || "An unexpected error occurred. Please try again.");
            }
        }
    });
}


// Helper function to format numbers to two decimals
function formatToTwoDecimals(value) {
    if (!value || isNaN(value)) return "0.00";
    return parseFloat(value).toFixed(2);
}



// Helper function to format numbers to two decimals
function formatToTwoDecimals(value) {
    if (!value || isNaN(value)) return "0.00";
    return parseFloat(value).toFixed(2);
}


  

  // Handle registration form submission
  registrationForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("name").value.trim();
    const phone = normalizePhoneNumber();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const groupName = document.getElementById("groupName").value.trim();
    const seedMoney = formatToTwoDecimals(document.getElementById("seedMoney").value);
    const interestRate = document.getElementById("interestRate").value.trim();
    const monthlyContribution = formatToTwoDecimals(document.getElementById("monthlyContribution").value);
    const loanPenalty = document.getElementById("loanPenalty").value.trim();
    const monthlyPenalty = document.getElementById("monthlyPenalty").value.trim();

    const errors = [
      validateField(name, "Full Name"),
      validateField(email, "Email Address"),
      validateField(password, "Password"),
      validateField(groupName, "Group Name"),
      validateNumericField(seedMoney, "Seed Money", 0),
      validateNumericField(interestRate, "Interest Rate", 0, 100, true),
      validateNumericField(monthlyContribution, "Monthly Contribution", 0),
      validateNumericField(loanPenalty, "Loan Penalty", 0, 100, true),
      validateNumericField(monthlyPenalty, "Monthly Penalty", 0, 100, true),
    ].filter((error) => error !== null);

    if (!validatePhoneInput() || !phone) {
      errors.push("Phone Number is invalid.");
    }

    if (errors.length > 0) {
      alert("Please fix the following errors:\n" + errors.join("\n"));
      return;
    }

    try {
      showLoadingOverlay("Submitting your registration...");
      disableFormFields();

      const groupData = {
        groupName,
        phone,
        seedMoney,
        interestRate,
        monthlyContribution,
        loanPenalty,
        monthlyPenalty,
      };

      const generatedCode = await generateAndSaveInvitationCode(name, phone, email);
      if (invitationDocRef) {
        trackApprovalStatus(invitationDocRef.id, name, email, password, groupData);
      }
    } catch (error) {
      console.error("Error during registration:", error.message);
      alert("An error occurred. Please try again.");
      enableFormFields();
      hideLoadingOverlay();
    }
  });

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
