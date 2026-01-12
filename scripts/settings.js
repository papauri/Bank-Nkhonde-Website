import {
  db,
  auth,
  storage,
  doc,
  getDoc,
  updateDoc,
  getDocs,
  collection,
  onAuthStateChanged,
  signOut,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
  Timestamp,
  ref,
  uploadBytes,
  getDownloadURL,
} from "./firebaseConfig.js";

// Global state
let currentUser = null;
let userData = null;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  setupTabNavigation();
  setupEventListeners();
});

// Check Auth State
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadUserData();
  } else {
    window.location.href = "../login.html";
  }
});

// Setup Tab Navigation
function setupTabNavigation() {
  document.querySelectorAll(".settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      // Update active tab
      document.querySelectorAll(".settings-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      // Update active panel
      const panelId = `${tab.dataset.panel}Panel`;
      document.querySelectorAll(".settings-panel").forEach((p) => p.classList.remove("active"));
      document.getElementById(panelId)?.classList.add("active");
    });
  });
}

// Setup Event Listeners
function setupEventListeners() {
  // Profile picture upload
  const profilePictureInput = document.getElementById("profilePictureInput");
  if (profilePictureInput) {
    profilePictureInput.addEventListener("change", handleProfilePictureUpload);
  }

  // Forms
  document.getElementById("personalForm")?.addEventListener("submit", handlePersonalFormSubmit);
  document.getElementById("professionalForm")?.addEventListener("submit", handleProfessionalFormSubmit);
  document.getElementById("securityForm")?.addEventListener("submit", handleSecurityFormSubmit);
  document.getElementById("passwordForm")?.addEventListener("submit", handlePasswordChange);

  // Buttons
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("resendVerificationBtn")?.addEventListener("click", handleResendVerification);
}

// Load User Data
async function loadUserData() {
  try {
    showSpinner(true);
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    
    if (userDoc.exists()) {
      userData = userDoc.data();
      populateFormFields(userData);
    } else {
      showToast("User profile not found", "error");
    }
  } catch (error) {
    console.error("Error loading user data:", error);
    showToast("Error loading user data", "error");
  } finally {
    showSpinner(false);
  }
}

// Populate Form Fields
function populateFormFields(data) {
  // Profile section
  const profileName = document.getElementById("profileName");
  const profileEmail = document.getElementById("profileEmail");
  const profileInitials = document.getElementById("profileInitials");
  const profileImage = document.getElementById("profileImage");

  if (profileName) profileName.textContent = data.fullName || "User";
  if (profileEmail) profileEmail.textContent = currentUser.email || "";
  
  if (data.fullName && profileInitials) {
    const initials = data.fullName.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
    profileInitials.textContent = initials;
  }

  if (data.profileImageUrl && profileImage) {
    profileImage.src = data.profileImageUrl;
    profileImage.style.display = "block";
    if (profileInitials) profileInitials.style.display = "none";
  }

  // Personal form
  setValue("fullName", data.fullName);
  setValue("email", currentUser.email);
  setValue("phone", data.phone);
  setValue("whatsappNumber", data.whatsappNumber);
  setValue("dateOfBirth", data.dateOfBirth);
  setSelectValue("gender", data.gender);
  setValue("address", data.address);
  setValue("emergencyContact", data.emergencyContact);
  setValue("emergencyContactPhone", data.emergencyContactPhone);

  // Professional form
  setValue("career", data.career);
  setValue("jobTitle", data.jobTitle);
  setValue("workplace", data.workplace);
  setValue("workAddress", data.workAddress);
  setValue("guarantorName", data.guarantorName);
  setValue("guarantorPhone", data.guarantorPhone);
  setSelectValue("guarantorRelationship", data.guarantorRelationship);
  setValue("guarantorAddress", data.guarantorAddress);

  // Security form
  setSelectValue("idType", data.idType);
  setValue("idNumber", data.idNumber);
}

// Helper to set input value
function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || "";
}

// Helper to set select value
function setSelectValue(id, value) {
  const el = document.getElementById(id);
  if (el && value) {
    for (let option of el.options) {
      if (option.value === value) {
        option.selected = true;
        break;
      }
    }
  }
}

// Handle Profile Picture Upload
async function handleProfilePictureUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Validate file type
  if (!file.type.startsWith("image/")) {
    showToast("Please select an image file", "error");
    return;
  }

  // Validate file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    showToast("Image size must be less than 5MB", "error");
    return;
  }

  showSpinner(true);

  try {
    // Upload to Firebase Storage
    const storageRef = ref(storage, `profiles/${currentUser.uid}/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);

    // Update user document
    await updateDoc(doc(db, "users", currentUser.uid), {
      profileImageUrl: downloadURL,
      updatedAt: Timestamp.now(),
    });

    // Update in all group memberships
    await updateMemberProfileInGroups({ profileImageUrl: downloadURL });

    // Update UI
    const profileImage = document.getElementById("profileImage");
    const profileInitials = document.getElementById("profileInitials");
    
    if (profileImage) {
      profileImage.src = downloadURL;
      profileImage.style.display = "block";
    }
    if (profileInitials) {
      profileInitials.style.display = "none";
    }

    showToast("Profile picture updated successfully", "success");
  } catch (error) {
    console.error("Error uploading profile picture:", error);
    showToast("Failed to upload profile picture", "error");
  } finally {
    showSpinner(false);
  }
}

// Handle Personal Form Submit
async function handlePersonalFormSubmit(e) {
  e.preventDefault();
  showSpinner(true);

  try {
    const formData = {
      fullName: document.getElementById("fullName")?.value.trim(),
      phone: document.getElementById("phone")?.value.trim(),
      whatsappNumber: document.getElementById("whatsappNumber")?.value.trim(),
      dateOfBirth: document.getElementById("dateOfBirth")?.value,
      gender: document.getElementById("gender")?.value,
      address: document.getElementById("address")?.value.trim(),
      emergencyContact: document.getElementById("emergencyContact")?.value.trim(),
      emergencyContactPhone: document.getElementById("emergencyContactPhone")?.value.trim(),
      updatedAt: Timestamp.now(),
    };

    // Validate required fields
    if (!formData.fullName) {
      showToast("Full name is required", "error");
      showSpinner(false);
      return;
    }
    if (!formData.phone) {
      showToast("Phone number is required", "error");
      showSpinner(false);
      return;
    }

    // Update user document
    await updateDoc(doc(db, "users", currentUser.uid), formData);

    // Update in all group memberships
    await updateMemberProfileInGroups({
      fullName: formData.fullName,
      phone: formData.phone,
      whatsappNumber: formData.whatsappNumber,
      address: formData.address,
    });

    // Update profile name display
    const profileName = document.getElementById("profileName");
    if (profileName) profileName.textContent = formData.fullName;

    showToast("Personal information saved successfully", "success");
  } catch (error) {
    console.error("Error saving personal info:", error);
    showToast("Failed to save personal information", "error");
  } finally {
    showSpinner(false);
  }
}

// Handle Professional Form Submit
async function handleProfessionalFormSubmit(e) {
  e.preventDefault();
  showSpinner(true);

  try {
    const formData = {
      career: document.getElementById("career")?.value.trim(),
      jobTitle: document.getElementById("jobTitle")?.value.trim(),
      workplace: document.getElementById("workplace")?.value.trim(),
      workAddress: document.getElementById("workAddress")?.value.trim(),
      guarantorName: document.getElementById("guarantorName")?.value.trim(),
      guarantorPhone: document.getElementById("guarantorPhone")?.value.trim(),
      guarantorRelationship: document.getElementById("guarantorRelationship")?.value,
      guarantorAddress: document.getElementById("guarantorAddress")?.value.trim(),
      updatedAt: Timestamp.now(),
    };

    // Update user document
    await updateDoc(doc(db, "users", currentUser.uid), formData);

    // Update in all group memberships
    await updateMemberProfileInGroups(formData);

    showToast("Professional information saved successfully", "success");
  } catch (error) {
    console.error("Error saving professional info:", error);
    showToast("Failed to save professional information", "error");
  } finally {
    showSpinner(false);
  }
}

// Handle Security Form Submit
async function handleSecurityFormSubmit(e) {
  e.preventDefault();
  showSpinner(true);

  try {
    const formData = {
      idType: document.getElementById("idType")?.value,
      idNumber: document.getElementById("idNumber")?.value.trim(),
      updatedAt: Timestamp.now(),
    };

    // Update user document
    await updateDoc(doc(db, "users", currentUser.uid), formData);

    // Update in all group memberships
    await updateMemberProfileInGroups(formData);

    showToast("Security information saved successfully", "success");
  } catch (error) {
    console.error("Error saving security info:", error);
    showToast("Failed to save security information", "error");
  } finally {
    showSpinner(false);
  }
}

// Update member profile in all groups
async function updateMemberProfileInGroups(updates) {
  try {
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    if (!userDoc.exists()) return;

    const memberships = userDoc.data().groupMemberships || [];
    
    for (const membership of memberships) {
      const groupId = membership.groupId || membership;
      try {
        const memberRef = doc(db, `groups/${groupId}/members`, currentUser.uid);
        const memberDoc = await getDoc(memberRef);
        
        if (memberDoc.exists()) {
          await updateDoc(memberRef, {
            ...updates,
            updatedAt: Timestamp.now(),
          });
        }
      } catch (err) {
        console.log(`Could not update member in group ${groupId}:`, err);
      }
    }
  } catch (error) {
    console.error("Error updating member profiles in groups:", error);
  }
}

// Handle Password Change
async function handlePasswordChange(e) {
  e.preventDefault();

  const currentPassword = document.getElementById("currentPassword")?.value;
  const newPassword = document.getElementById("newPassword")?.value;
  const confirmPassword = document.getElementById("confirmPassword")?.value;

  // Validate
  if (!currentPassword) {
    showToast("Current password is required", "error");
    return;
  }
  if (!newPassword || newPassword.length < 6) {
    showToast("New password must be at least 6 characters", "error");
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast("Passwords do not match", "error");
    return;
  }

  showSpinner(true);

  try {
    // Re-authenticate user
    const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, credential);

    // Update password
    await updatePassword(currentUser, newPassword);

    // Clear form
    document.getElementById("passwordForm")?.reset();

    showToast("Password changed successfully", "success");
  } catch (error) {
    console.error("Error changing password:", error);
    
    let errorMessage = "Failed to change password";
    if (error.code === "auth/wrong-password") {
      errorMessage = "Current password is incorrect";
    } else if (error.code === "auth/requires-recent-login") {
      errorMessage = "Please log out and log in again before changing password";
    } else if (error.code === "auth/weak-password") {
      errorMessage = "New password is too weak";
    }
    
    showToast(errorMessage, "error");
  } finally {
    showSpinner(false);
  }
}

// Handle Logout
async function handleLogout() {
  try {
    await signOut(auth);
    sessionStorage.clear();
    window.location.href = "../login.html";
  } catch (error) {
    console.error("Error logging out:", error);
    showToast("Failed to logout", "error");
  }
}

// Handle Resend Email Verification
async function handleResendVerification() {
  try {
    showSpinner(true);
    await sendEmailVerification(currentUser);
    showToast("Verification email sent successfully", "success");
  } catch (error) {
    console.error("Error sending verification:", error);
    showToast("Failed to send verification email", "error");
  } finally {
    showSpinner(false);
  }
}

// Show/Hide Spinner
function showSpinner(show) {
  const spinner = document.getElementById("spinner");
  if (spinner) {
    if (show) {
      spinner.classList.remove("hidden");
    } else {
      spinner.classList.add("hidden");
    }
  }
}

// Show Toast Notification
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) {
    alert(message);
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);

  // Animate in
  setTimeout(() => toast.classList.add("show"), 10);

  // Auto remove after 4 seconds
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
