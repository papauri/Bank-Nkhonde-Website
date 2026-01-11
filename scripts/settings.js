import {
  db,
  auth,
  doc,
  getDoc,
  updateDoc,
  onAuthStateChanged,
  signOut,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
} from "./firebaseConfig.js";

// Global state
let currentUser = null;
let userData = null;

// DOM Elements
const spinner = document.getElementById("spinner");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const userPhone = document.getElementById("userPhone");
const emailVerificationStatus = document.getElementById("emailVerificationStatus");
const verifyEmailBtn = document.getElementById("verifyEmailBtn");

// Initialize
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadUserData();
  } else {
    window.location.href = "../login.html";
  }
});

/**
 * Load user data
 */
async function loadUserData() {
  try {
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    if (userDoc.exists()) {
      userData = userDoc.data();
      userName.textContent = userData.fullName || "Not set";
      userEmail.textContent = userData.email || currentUser.email;
      userPhone.textContent = userData.phone || "Not set";
      
      // Check email verification
      if (currentUser.emailVerified) {
        emailVerificationStatus.textContent = "Verified ✓";
        emailVerificationStatus.style.color = "var(--bn-success)";
      } else {
        emailVerificationStatus.textContent = "Not verified";
        emailVerificationStatus.style.color = "var(--bn-warning)";
        verifyEmailBtn.classList.remove("hidden");
      }
    }
  } catch (error) {
    console.error("Error loading user data:", error);
    showToast("Error loading user data: " + error.message, "error");
  }
}

/**
 * Edit profile
 */
window.editProfile = async function() {
  const newName = prompt("Enter your new name:", userData.fullName || "");
  if (newName && newName.trim()) {
    try {
      showSpinner(true);
      await updateDoc(doc(db, "users", currentUser.uid), {
        fullName: newName.trim()
      });
      await loadUserData();
      showToast("Profile updated successfully", "success");
    } catch (error) {
      console.error("Error updating profile:", error);
      showToast("Error updating profile: " + error.message, "error");
    } finally {
      showSpinner(false);
    }
  }
};

/**
 * Edit phone
 */
window.editPhone = async function() {
  const newPhone = prompt("Enter your new phone number:", userData.phone || "");
  if (newPhone && newPhone.trim()) {
    try {
      showSpinner(true);
      await updateDoc(doc(db, "users", currentUser.uid), {
        phone: newPhone.trim()
      });
      await loadUserData();
      showToast("Phone number updated successfully", "success");
    } catch (error) {
      console.error("Error updating phone:", error);
      showToast("Error updating phone: " + error.message, "error");
    } finally {
      showSpinner(false);
    }
  }
};

/**
 * Change password
 */
window.changePassword = async function() {
  const currentPassword = prompt("Enter your current password:");
  if (!currentPassword) return;
  
  const newPassword = prompt("Enter your new password (min. 6 characters):");
  if (!newPassword || newPassword.length < 6) {
    showToast("New password must be at least 6 characters", "error");
    return;
  }
  
  const confirmPassword = prompt("Confirm your new password:");
  if (newPassword !== confirmPassword) {
    showToast("Passwords do not match", "error");
    return;
  }
  
  try {
    showSpinner(true);
    
    // Re-authenticate user
    const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    
    // Update password
    await updatePassword(currentUser, newPassword);
    showToast("Password changed successfully", "success");
  } catch (error) {
    console.error("Error changing password:", error);
    if (error.code === "auth/wrong-password") {
      showToast("Current password is incorrect", "error");
    } else {
      showToast("Error changing password: " + error.message, "error");
    }
  } finally {
    showSpinner(false);
  }
};

/**
 * Verify email
 */
window.verifyEmail = async function() {
  try {
    showSpinner(true);
    await sendEmailVerification(currentUser);
    showToast("Verification email sent! Please check your inbox.", "success");
  } catch (error) {
    console.error("Error sending verification email:", error);
    showToast("Error sending verification email: " + error.message, "error");
  } finally {
    showSpinner(false);
  }
};

/**
 * Logout
 */
window.logout = async function() {
  if (confirm("Are you sure you want to logout?")) {
    try {
      await signOut(auth);
      window.location.href = "../login.html";
    } catch (error) {
      console.error("Error signing out:", error);
      showToast("Error signing out: " + error.message, "error");
    }
  }
};

/**
 * Show/Hide Spinner
 */
function showSpinner(show) {
  if (show) {
    spinner?.classList.remove("hidden");
  } else {
    spinner?.classList.add("hidden");
  }
}

/**
 * Show toast notification
 */
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add("show"), 100);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
