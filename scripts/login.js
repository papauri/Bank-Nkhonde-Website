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
  function displayError(errorInfo) {
    // Clear any existing content
    errorMessage.innerHTML = '';
    
    // Create error container
    const errorContainer = document.createElement('div');
    errorContainer.className = 'error-container';
    
    // Add error icon
    const errorIcon = document.createElement('div');
    errorIcon.className = 'error-icon';
    errorIcon.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
        <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `;
    
    // Add error title
    const errorTitle = document.createElement('div');
    errorTitle.className = 'error-title';
    errorTitle.textContent = errorInfo.title || 'Error';
    
    // Add error message
    const errorText = document.createElement('div');
    errorText.className = 'error-text';
    errorText.textContent = errorInfo.message || errorInfo;
    
    // Add suggestion if available
    if (errorInfo.suggestion) {
      const errorSuggestion = document.createElement('div');
      errorSuggestion.className = 'error-suggestion';
      errorSuggestion.textContent = errorInfo.suggestion;
      errorContainer.appendChild(errorSuggestion);
    }
    
    errorContainer.appendChild(errorIcon);
    errorContainer.appendChild(errorTitle);
    errorContainer.appendChild(errorText);
    errorMessage.appendChild(errorContainer);
    
    errorMessage.classList.remove('hidden');
    successMessage.classList.add('hidden');
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
      errorMessage.innerHTML = '';
      errorMessage.classList.add('hidden');
    }, 10000);
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
      'auth/invalid-email': {
        title: 'Invalid Email Address',
        message: 'The email address you entered is not valid. Please check for typos and try again.',
        suggestion: 'Make sure you\'re using the correct email format (e.g., yourname@example.com)'
      },
      'auth/user-disabled': {
        title: 'Account Disabled',
        message: 'This account has been disabled by an administrator.',
        suggestion: 'Please contact support for assistance.'
      },
      'auth/user-not-found': {
        title: 'Account Not Found',
        message: 'No account found with this email address.',
        suggestion: 'Please check your email or create a new account if you haven\'t registered yet.'
      },
      'auth/wrong-password': {
        title: 'Incorrect Password',
        message: 'The password you entered is incorrect.',
        suggestion: 'Please try again or use the "Forgot password?" link to reset your password.'
      },
      'auth/invalid-credential': {
        title: 'Invalid Credentials',
        message: 'The email or password you entered is incorrect.',
        suggestion: 'Please check both your email and password. If you\'ve forgotten your password, use the "Forgot password?" link.'
      },
      'auth/invalid-login-credentials': {
        title: 'Invalid Login Credentials',
        message: 'The email or password you entered is incorrect.',
        suggestion: 'Please verify your credentials and try again. If you\'ve forgotten your password, click "Forgot password?" to reset it.'
      },
      'auth/network-request-failed': {
        title: 'Network Error',
        message: 'Unable to connect to the server. Please check your internet connection.',
        suggestion: 'Make sure you\'re connected to the internet and try again.'
      },
      'auth/too-many-requests': {
        title: 'Too Many Attempts',
        message: 'Too many failed login attempts. Please wait a moment before trying again.',
        suggestion: 'Wait a few minutes and try again, or use the "Forgot password?" link to reset your password.'
      },
      'auth/operation-not-allowed': {
        title: 'Login Disabled',
        message: 'Login is currently disabled for this account.',
        suggestion: 'Please contact support for assistance.'
      },
    };

    const errorInfo = errorMessages[errorCode];
    if (errorInfo) {
      return {
        title: errorInfo.title,
        message: errorInfo.message,
        suggestion: errorInfo.suggestion
      };
    }

    return {
      title: 'Login Failed',
      message: error.message || 'An unexpected error occurred during login.',
      suggestion: 'Please try again. If the problem persists, contact support.'
    };
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

      // Check if user is admin in any group
      const groupMemberships = userData.groupMemberships || [];
      let isAdmin = false;
      
      if (userRoles.includes("admin") || userRoles.includes("senior_admin")) {
        isAdmin = true;
      } else {
        // Also check group memberships
        for (const membership of groupMemberships) {
          if (membership.role === "admin" || membership.role === "senior_admin") {
            isAdmin = true;
            break;
          }
        }
      }

      // Admins go to admin dashboard first, others to user dashboard
      if (isAdmin) {
        console.log("✅ Redirecting to admin dashboard");
        displaySuccess("Login successful! Redirecting to admin dashboard...");
        setTimeout(() => {
          window.location.href = "pages/admin_dashboard.html";
        }, 500);
      } else {
        console.log("✅ Redirecting to user dashboard");
        displaySuccess("Login successful! Redirecting to your dashboard...");
        setTimeout(() => {
          window.location.href = "pages/user_dashboard.html";
        }, 500);
      }

    } catch (error) {
      console.error("❌ Login failed:", error);
      const errorInfo = getUserFriendlyErrorMessage(error);
      displayError(errorInfo);
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
    
    // Get email from form or prompt
    const emailInput = document.getElementById("email");
    let email = emailInput ? emailInput.value.trim() : "";
    
    if (!email) {
      email = prompt("Please enter your email address:");
    }

    if (email && validateEmail(email)) {
      try {
        showSpinner();
        
        // Generate password reset link using Firebase Auth
        const actionCodeSettings = {
          url: `${window.location.origin}/login.html?mode=resetPassword`,
          handleCodeInApp: false,
        };
        
        // Use Firebase Auth to generate reset link
        await auth.sendPasswordResetEmail(email, actionCodeSettings);
        
        // Also send custom email through our SMTP service
        try {
          const { sendPasswordResetEmail } = await import('./emailService.js');
          const resetLink = `${window.location.origin}/login.html?mode=resetPassword&oobCode=RESET_CODE`;
          await sendPasswordResetEmail(email, resetLink);
        } catch (emailError) {
          console.warn("Custom email service failed, but Firebase email was sent:", emailError);
        }
        
        hideSpinner();
        displaySuccess("Password reset email sent! Please check your inbox and follow the instructions to reset your password.");
      } catch (error) {
        hideSpinner();
        console.error("Error sending password reset email:", error);
        
        const errorInfo = getUserFriendlyErrorMessage(error);
        displayError({
          title: errorInfo.title || "Password Reset Failed",
          message: errorInfo.message || "Failed to send password reset email. Please try again.",
          suggestion: errorInfo.suggestion || "Make sure you're using the email address associated with your account."
        });
      }
    } else if (email) {
      displayError({
        title: "Invalid Email",
        message: "Please enter a valid email address.",
        suggestion: "Make sure the email format is correct (e.g., yourname@example.com)"
      });
    }
  });
});
