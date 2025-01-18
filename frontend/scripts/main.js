// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyClJfGFoc1WZ_qYi5ImQJXyurQtqXgOqfA",
  authDomain: "banknkonde.firebaseapp.com",
  databaseURL: "https://banknkonde-default-rtdb.europe-west1.firebasedatabase.app",
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
  const userLoginForm = document.getElementById("userLoginForm");
  const adminLoginForm = document.getElementById("adminLoginForm");
  const userLoginBtn = document.getElementById("userLoginBtn");
  const adminLoginBtn = document.getElementById("adminLoginBtn");
  const spinner = document.getElementById("spinner");
  const userErrorMessage = document.getElementById("userErrorMessage");
  const adminErrorMessage = document.getElementById("adminErrorMessage");
  const userLoginToggle = document.getElementById("userLoginToggle");
  const adminLoginToggle = document.getElementById("adminLoginToggle");

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
   * Log User Activity
   * @param {string} activityType - Type of activity
   * @param {string} title - Activity title
   * @param {string} details - Description of the activity
   * @param {string} [groupId="global"] - Optional group ID
   */
  async function logUserActivity(activityType, title, details, groupId) {
    if (!groupId) {
      console.error("Group ID is required to log activity.");
      return;
    }
  
    try {
      // Reference the group's activityLogs collection
      const activityLogsRef = collection(db, `groups/${groupId}/activityLogs`);
  
      // Add activity log document
      await addDoc(activityLogsRef, {
        type: activityType,
        title,
        timestamp: new Date(),
        details,
      });
  
      console.log(`Activity logged in group ${groupId}: ${title}`);
    } catch (error) {
      console.error("Error logging activity:", error.message);
    }
  }
  

  /**
   * Handle Login
   * @param {string} email - User email
   * @param {string} password - User password
   * @param {string} role - Either 'admin' or 'user'
   */
  async function handleLogin(email, password, role) {
    showSpinner();

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Fetch user data from Firestore
      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        throw new Error("User data not found in Firestore.");
      }

      const userData = userDoc.data();
      console.log("Fetched user data:", userData);

      // Validate roles field
      const userRoles = userData.roles || [];
      if (!Array.isArray(userRoles)) {
        throw new Error("Roles field is not an array or is missing.");
      }

      if (!userRoles.includes(role)) {
        throw new Error(`Access denied. Not authorized as ${role}.`);
      }

      // Log user login activity
      await logUserActivity("login", `${role} login`, `${user.email} logged in as ${role}`, "global");

      // Redirect to appropriate dashboard
      if (role === "admin") {
        window.location.href = "/pages/admin_dashboard.html";
      } else if (role === "user") {
        window.location.href = "/pages/user_dashboard.html";
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
    }
  }

  /**
   * Switch Login Form
   * @param {string} target - Target form ('admin' or 'user')
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

  // Add Event Listeners for Toggle Buttons
  userLoginToggle.addEventListener("click", () => switchLoginForm("user"));
  adminLoginToggle.addEventListener("click", () => switchLoginForm("admin"));

  // User Login
  userLoginBtn.addEventListener("click", async () => {
    const email = document.getElementById("userEmail")?.value.trim();
    const password = document.getElementById("userPassword")?.value.trim();
    if (!email || !password) {
      userErrorMessage.textContent = "Please fill in all fields.";
      return;
    }
    await handleLogin(email, password, "user");
  });

  // Admin Login
  adminLoginBtn.addEventListener("click", async () => {
    const email = document.getElementById("adminEmail")?.value.trim();
    const password = document.getElementById("adminPassword")?.value.trim();
    if (!email || !password) {
      adminErrorMessage.textContent = "Please fill in all fields.";
      return;
    }
    await handleLogin(email, password, "admin");
  });
});
