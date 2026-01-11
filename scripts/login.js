import {
  db,
  auth,
  signInWithEmailAndPassword,
  doc,
  getDoc,
} from "./firebaseConfig.js";

document.addEventListener("DOMContentLoaded", () => {
  const loginBtn = document.getElementById("loginBtn");
  const spinner = document.getElementById("spinner");
  const errorMessage = document.getElementById("errorMessage");
  const successMessage = document.getElementById("successMessage");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");

  /**
   * Show/Hide Spinner
   */
  function showSpinner() {
    spinner.classList.remove("hidden");
  }

  function hideSpinner() {
    spinner.classList.add("hidden");
  }

  /**
   * Display Error Message
   */
  function displayError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
    successMessage.classList.add('hidden');
    
    setTimeout(() => {
      errorMessage.textContent = '';
      errorMessage.classList.add('hidden');
    }, 8000);
  }

  /**
   * Display Success Message
   */
  function displaySuccess(message) {
    successMessage.textContent = message;
    successMessage.classList.remove('hidden');
    errorMessage.classList.add('hidden');
    
    setTimeout(() => {
      successMessage.textContent = '';
      successMessage.classList.add('hidden');
    }, 5000);
  }

  /**
   * Clear Messages
   */
  function clearMessages() {
    errorMessage.textContent = '';
    errorMessage.classList.add('hidden');
    successMessage.textContent = '';
    successMessage.classList.add('hidden');
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
   */
  function getUserFriendlyErrorMessage(error) {
    const errorCode = error.code;
    const errorMessages = {
      'auth/invalid-email': 'Invalid email address. Please check and try again.',
      'auth/user-disabled': 'This account has been disabled. Please contact support.',
      'auth/user-not-found': 'No account found with this email. Please check your email or register.',
      'auth/wrong-password': 'Incorrect password. Please try again or reset your password.',
      'auth/invalid-credential': 'Invalid email or password. Please check your credentials.',
      'auth/network-request-failed': 'Network error. Please check your internet connection.',
      'auth/too-many-requests': 'Too many failed login attempts. Please try again later.',
      'auth/operation-not-allowed': 'Login is currently disabled. Please contact support.',
    };

    return errorMessages[errorCode] || error.message || 'Login failed. Please try again.';
  }

  /**
   * Handle Login
   */
  async function handleLogin(email, password) {
    clearMessages();
    showSpinner();
    loginBtn.disabled = true;

    try {
      console.log("🔹 Attempting to sign in with email:", email);
      
      // Sign in with Firebase
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      console.log("✅ User signed in successfully:", user.uid);

      // Fetch user data from Firestore
      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        throw new Error("User profile not found. Please contact support.");
      }

      const userData = userDoc.data();
      const userRoles = userData.roles || [];
      
      console.log("✅ User roles:", userRoles);

      // Determine where to redirect based on roles
      if (userRoles.includes("admin") || userRoles.includes("senior_admin")) {
        console.log("✅ Redirecting to admin dashboard");
        displaySuccess("Login successful! Redirecting to admin dashboard...");
        setTimeout(() => {
          window.location.href = "pages/admin_dashboard.html";
        }, 500);
      } else if (userRoles.includes("user")) {
        console.log("✅ Redirecting to user dashboard");
        displaySuccess("Login successful! Redirecting to user dashboard...");
        setTimeout(() => {
          window.location.href = "pages/user_dashboard_new.html";
        }, 500);
      } else {
        // Default to user dashboard if no specific role found
        console.log("✅ Redirecting to user dashboard (default)");
        displaySuccess("Login successful! Redirecting to your dashboard...");
        setTimeout(() => {
          window.location.href = "pages/user_dashboard_new.html";
        }, 500);
      }

    } catch (error) {
      console.error("❌ Login failed:", error);
      const friendlyMessage = getUserFriendlyErrorMessage(error);
      displayError(friendlyMessage);
    } finally {
      hideSpinner();
      loginBtn.disabled = false;
    }
  }

  /**
   * Handle Form Submit
   */
  const loginForm = document.getElementById("loginForm");
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const email = document.getElementById("email")?.value.trim();
    const password = document.getElementById("password")?.value.trim();

    // Validate inputs
    if (!email || !password) {
      displayError("Please enter both email and password.");
      return;
    }

    if (!validateEmail(email)) {
      displayError("Please enter a valid email address.");
      return;
    }

    if (!validatePassword(password)) {
      displayError("Password must be at least 6 characters long.");
      return;
    }

    await handleLogin(email, password);
  });

  /**
   * Forgot Password Handler
   */
  forgotPasswordLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = prompt("Please enter your email address:");

    if (email && validateEmail(email)) {
      try {
        await auth.sendPasswordResetEmail(email);
        displaySuccess("Password reset email sent. Please check your inbox.");
      } catch (error) {
        console.error("Error sending password reset email:", error);
        displayError("Failed to send password reset email. Please try again.");
      }
    } else if (email) {
      displayError("Please enter a valid email address.");
    }
  });
});
