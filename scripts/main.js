import {
  db,
  auth,
  signInWithEmailAndPassword,
  collection,
  addDoc,
  doc,
  getDoc,
} from "./firebaseConfig.js";

document.addEventListener("DOMContentLoaded", () => {
  const userLoginForm = document.getElementById("userLoginForm");
  const adminLoginForm = document.getElementById("adminLoginForm");
  const userLoginBtn = document.getElementById("userLoginBtn");
  const adminLoginBtn = document.getElementById("adminLoginBtn");
  const spinner = document.getElementById("spinner");
  const userErrorMessage = document.getElementById("userErrorMessage");
  const adminErrorMessage = document.getElementById("adminErrorMessage");
  const userLoginToggle = document.getElementById("userLoginToggle");
  const adminLoginToggle = document.getElementById("adminLoginToggle");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");

  /**
   * Show Spinner
   */
  function showSpinner() {
    spinner.classList.remove("hidden");
  }

  /**
   * Hide Spinner
   */
  function hideSpinner() {
    spinner.classList.add("hidden");
  }

  /**
   * Disable Login Buttons
   */
  function disableLoginButtons() {
    userLoginBtn.disabled = true;
    adminLoginBtn.disabled = true;
  }

  /**
   * Enable Login Buttons
   */
  function enableLoginButtons() {
    userLoginBtn.disabled = false;
    adminLoginBtn.disabled = false;
  }

  /**
   * Validate Email
   */
  function validateEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  }

  /**
   * Validate Password
   */
  function validatePassword(password) {
    return password.length >= 6;
  }

  /**
   * Get User-Friendly Error Message
   * Translates Firebase error codes to user-friendly messages
   */
  function getUserFriendlyErrorMessage(error) {
    const errorCode = error.code;
    const errorMessage = error.message;

    // Firebase Authentication error codes
    const errorMessages = {
      'auth/invalid-email': 'The email address is not valid. Please check and try again.',
      'auth/user-disabled': 'This account has been disabled. Please contact support.',
      'auth/user-not-found': 'No account found with this email. Please check your email or register.',
      'auth/wrong-password': 'Incorrect password. Please try again or reset your password.',
      'auth/email-already-in-use': 'An account with this email already exists. Please login or use a different email.',
      'auth/weak-password': 'Password is too weak. Please use at least 6 characters.',
      'auth/network-request-failed': 'Network error. Please check your internet connection and try again.',
      'auth/too-many-requests': 'Too many failed attempts. Please try again later or reset your password.',
      'auth/operation-not-allowed': 'This operation is not allowed. Please contact support.',
      'auth/invalid-credential': 'Invalid login credentials. Please check your email and password.',
      'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.',
    };

    // Return user-friendly message or default message
    return errorMessages[errorCode] || errorMessage || 'An unexpected error occurred. Please try again.';
  }

  /**
   * Display Error Message
   */
  function displayError(element, message) {
    element.textContent = message;
    element.style.display = 'block';
    
    // Auto-hide after 8 seconds
    setTimeout(() => {
      element.textContent = '';
      element.style.display = 'none';
    }, 8000);
  }

  /**
   * Clear Error Message
   */
  function clearError(element) {
    element.textContent = '';
    element.style.display = 'none';
  }

  /**
   * Log User Activity
   */
  async function logUserActivity(activityType, title, details, groupId = "global") {
    try {
      const activityLogsRef = collection(db, `groups/${groupId}/activityLogs`);
      const user = auth.currentUser;

      await addDoc(activityLogsRef, {
        type: activityType,
        title,
        timestamp: new Date(),
        details,
        userId: user?.uid || "unknown",
        userEmail: user?.email || "unknown",
      });

      console.log(`Activity logged in group ${groupId}: ${title}`);
    } catch (error) {
      console.error("Error logging activity:", error.message);
    }
  }

  /**
   * Handle Login
   */
  async function handleLogin(email, password, role) {
    const errorElement = role === "admin" ? adminErrorMessage : userErrorMessage;
    clearError(errorElement);
    showSpinner();
    disableLoginButtons();

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        throw new Error("User profile not found. Please contact support.");
      }

      const userData = userDoc.data();
      const userRoles = userData.roles || [];

      if (!userRoles.includes(role)) {
        await auth.signOut(); // Sign out if wrong role
        throw new Error(`Access denied. You don't have ${role} privileges. Please use the correct login form.`);
      }

      await logUserActivity("login", `${role} login`, `${user.email} logged in as ${role}`);

      if (role === "admin") {
        window.location.href = "pages/admin_dashboard.html";
      } else if (role === "user") {
        window.location.href = "pages/user_dashboard.html";
      } else {
        throw new Error("Unknown role specified.");
      }
    } catch (error) {
      console.error("Login failed:", error.message);
      const friendlyMessage = getUserFriendlyErrorMessage(error);
      displayError(errorElement, friendlyMessage);
    } finally {
      hideSpinner();
      enableLoginButtons();
    }
  }

  /**
   * Switch Login Form
   */
  function switchLoginForm(target) {
    if (target === "admin") {
      userLoginForm.classList.add("hidden");
      adminLoginForm.classList.remove("hidden");
      adminLoginToggle.classList.add("active");
      userLoginToggle.classList.remove("active");
    } else {
      adminLoginForm.classList.add("hidden");
      userLoginForm.classList.remove("hidden");
      userLoginToggle.classList.add("active");
      adminLoginToggle.classList.remove("active");
    }
  }

  // Event Listeners
  userLoginToggle.addEventListener("click", () => switchLoginForm("user"));
  adminLoginToggle.addEventListener("click", () => switchLoginForm("admin"));

  userLoginBtn.addEventListener("click", async () => {
    const email = document.getElementById("userEmail")?.value.trim();
    const password = document.getElementById("userPassword")?.value.trim();

    if (!email || !password) {
      userErrorMessage.textContent = "Please fill in all fields.";
      return;
    }

    if (!validateEmail(email)) {
      userErrorMessage.textContent = "Please enter a valid email address.";
      return;
    }

    if (!validatePassword(password)) {
      userErrorMessage.textContent = "Password must be at least 6 characters.";
      return;
    }

    await handleLogin(email, password, "user");
  });

  adminLoginBtn.addEventListener("click", async () => {
    const email = document.getElementById("adminEmail")?.value.trim();
    const password = document.getElementById("adminPassword")?.value.trim();

    if (!email || !password) {
      adminErrorMessage.textContent = "Please fill in all fields.";
      return;
    }

    if (!validateEmail(email)) {
      adminErrorMessage.textContent = "Please enter a valid email address.";
      return;
    }

    if (!validatePassword(password)) {
      adminErrorMessage.textContent = "Password must be at least 6 characters.";
      return;
    }

    await handleLogin(email, password, "admin");
  });

  forgotPasswordLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = prompt("Please enter your email address:");

    if (email && validateEmail(email)) {
      try {
        await auth.sendPasswordResetEmail(email);
        alert("Password reset email sent. Please check your inbox.");
      } catch (error) {
        console.error("Error sending password reset email:", error.message);
        alert("Failed to send password reset email. Please try again.");
      }
    } else {
      alert("Please enter a valid email address.");
    }
  });
});