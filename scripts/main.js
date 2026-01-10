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
    showSpinner();
    disableLoginButtons();

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        throw new Error("User data not found in Firestore.");
      }

      const userData = userDoc.data();
      const userRoles = userData.roles || [];

      if (!userRoles.includes(role)) {
        throw new Error(`Access denied. Not authorized as ${role}.`);
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
      if (role === "admin") {
        adminErrorMessage.textContent = error.message || "Login failed. Please try again.";
      } else {
        userErrorMessage.textContent = error.message || "Login failed. Please try again.";
      }
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