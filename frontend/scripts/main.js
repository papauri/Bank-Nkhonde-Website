// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-analytics.js";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyClJfGFoc1WZ_qYi5ImQJXyurQtqXgOqfA",
  authDomain: "banknkonde.firebaseapp.com",
  databaseURL: "https://banknkonde-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "banknkonde",
  storageBucket: "banknkonde.appspot.com",
  messagingSenderId: "698749180404",
  appId: "1:698749180404:web:7e8483cae4abd7555101a1",
  measurementId: "G-MC7PDS90FR",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Optional: Initialize Analytics
try {
  const analytics = getAnalytics(app);
  console.log("Firebase Analytics initialized.");
} catch (err) {
  console.warn("Firebase Analytics could not be initialized:", err.message);
}

// DOM Elements
document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const showRegister = document.getElementById("showRegister");
  const showLogin = document.getElementById("showLogin");
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");
  const errorMessage = document.getElementById("errorMessage");
  const registerErrorMessage = document.getElementById("registerErrorMessage");

  // Ensure elements exist before adding event listeners
  if (showRegister) {
    showRegister.addEventListener("click", () => {
      loginForm?.classList.add("hidden");
      registerForm?.classList.remove("hidden");
    });
  }

  if (showLogin) {
    showLogin.addEventListener("click", () => {
      registerForm?.classList.add("hidden");
      loginForm?.classList.remove("hidden");
    });
  }

  // Admin Login
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      const email = document.getElementById("email")?.value.trim();
      const password = document.getElementById("password")?.value.trim();

      if (!email || !password) {
        errorMessage.textContent = "Please fill in all fields.";
        return;
      }

      try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        alert("Login successful! Redirecting...");
        console.log("User:", userCredential.user);
        window.location.href = "dashboard/admin_dashboard.html"; // Redirect after login
      } catch (error) {
        console.error("Login Error:", error.message);
        errorMessage.textContent = "Login failed. Please check your credentials.";
      }
    });
  }

  // Admin Registration
  if (registerBtn) {
    registerBtn.addEventListener("click", async () => {
      const email = document.getElementById("regEmail")?.value.trim();
      const password = document.getElementById("regPassword")?.value.trim();

      if (!email || !password) {
        registerErrorMessage.textContent = "Please fill in all fields.";
        return;
      }

      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        alert("Registration successful! You can now log in.");
        console.log("User:", userCredential.user);
        // Redirect to login page or handle additional steps
      } catch (error) {
        console.error("Registration Error:", error.message);
        registerErrorMessage.textContent = "Registration failed. Please try again.";
      }
    });
  }
});
