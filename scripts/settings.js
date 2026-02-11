import {
  db,
  auth,
  storage,
  doc,
  getDoc,
  updateDoc,
  setDoc,
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
  document.getElementById("bankAccountForm")?.addEventListener("submit", handleBankAccountFormSubmit);

  // Buttons
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("resendVerificationBtn")?.addEventListener("click", handleResendVerification);
  
  // Currency selector
  const currencySelector = document.getElementById('currencySelector');
  if (currencySelector) {
    const savedCurrency = localStorage.getItem('selectedCurrency') || 'MWK';
    currencySelector.value = savedCurrency;
    currencySelector.addEventListener('change', (e) => {
      localStorage.setItem('selectedCurrency', e.target.value);
      showToast('Currency preference saved. Page will reload...', 'success');
      // Reload after a short delay to show the toast
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    });
  }

  // Notification settings
  setupNotificationSettings();
  
  // Push notification setup
  setupPushNotifications();
  
}

/**
 * Load notification settings from localStorage
 */
async function loadNotificationSettings() {
  // This is called after form fields are populated to ensure settings are loaded
  await setupNotificationSettings();
}

/**
 * Setup notification sound settings
 */
async function setupNotificationSettings() {
  // Import notification sounds
  const { getSoundSettings, saveSoundSettings, testNotificationSound, SOUND_TYPES } = await import('./notification-sounds.js');
  
  // Load saved settings
  const settings = getSoundSettings();
  
  // Sound enabled toggle
  const soundEnabledToggle = document.getElementById('soundNotificationsEnabled');
  if (soundEnabledToggle) {
    soundEnabledToggle.checked = settings.enabled;
    soundEnabledToggle.addEventListener('change', (e) => {
      const newSettings = { ...settings, enabled: e.target.checked };
      saveSoundSettings(newSettings);
      showToast('Sound notification setting saved', 'success');
      updateSoundControlsVisibility(e.target.checked);
    });
  }
  
  // Sound type selector
  const soundTypeSelector = document.getElementById('soundTypeSelector');
  if (soundTypeSelector) {
    soundTypeSelector.value = settings.type;
    soundTypeSelector.addEventListener('change', (e) => {
      const newSettings = { ...settings, type: e.target.value };
      saveSoundSettings(newSettings);
      showToast('Sound type updated', 'success');
    });
  }
  
  // Volume slider
  const volumeSlider = document.getElementById('soundVolumeSlider');
  const volumeValue = document.getElementById('volumeValue');
  if (volumeSlider && volumeValue) {
    volumeSlider.value = (settings.volume * 100).toFixed(0);
    volumeValue.textContent = (settings.volume * 100).toFixed(0);
    
    volumeSlider.addEventListener('input', (e) => {
      const volume = parseInt(e.target.value) / 100;
      volumeValue.textContent = e.target.value;
      const newSettings = { ...settings, volume };
      saveSoundSettings(newSettings);
    });
  }
  
  // Test sound button
  const testSoundBtn = document.getElementById('testSoundBtn');
  if (testSoundBtn) {
    testSoundBtn.addEventListener('click', async () => {
      const currentSettings = getSoundSettings();
      testNotificationSound(currentSettings.type, currentSettings.volume);
    });
  }
  
  // Update visibility of sound controls
  updateSoundControlsVisibility(settings.enabled);
}

/**
 * Update visibility of sound controls based on enabled state
 */
function updateSoundControlsVisibility(enabled) {
  const soundTypeGroup = document.getElementById('soundTypeGroup');
  const soundVolumeGroup = document.getElementById('soundVolumeGroup');
  
  if (soundTypeGroup) {
    soundTypeGroup.style.display = enabled ? 'block' : 'none';
  }
  if (soundVolumeGroup) {
    soundVolumeGroup.style.display = enabled ? 'block' : 'none';
  }
}

/**
 * Setup push notifications
 */
async function setupPushNotifications() {
  // Check if browser supports notifications
  if (!('Notification' in window)) {
    console.log('This browser does not support notifications');
    const pushToggle = document.getElementById('pushNotificationsEnabled');
    if (pushToggle) {
      pushToggle.disabled = true;
      pushToggle.parentElement.querySelector('p').textContent = 'Push notifications are not supported in this browser';
    }
    return;
  }
  
  // Check current permission
  const permission = Notification.permission;
  
  const pushToggle = document.getElementById('pushNotificationsEnabled');
  if (!pushToggle) return;
  
  // Load saved preference
  const pushEnabled = localStorage.getItem('pushNotificationsEnabled') === 'true';
  pushToggle.checked = pushEnabled && (permission === 'granted');
  
  // Handle toggle change
  pushToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      // Request permission
      const permission = await Notification.requestPermission();
      
      if (permission === 'granted') {
        localStorage.setItem('pushNotificationsEnabled', 'true');
        showToast('Push notifications enabled', 'success');
        
        // Register service worker and get FCM token
        try {
          await registerServiceWorker();
        } catch (error) {
          console.error('Error registering service worker:', error);
          showToast('Failed to enable push notifications', 'error');
          e.target.checked = false;
        }
      } else {
        showToast('Push notifications permission denied', 'warning');
        e.target.checked = false;
      }
    } else {
      localStorage.setItem('pushNotificationsEnabled', 'false');
      showToast('Push notifications disabled', 'success');
    }
  });
  
  // Auto-enable if permission was already granted
  if (permission === 'granted' && pushEnabled) {
    try {
      await registerServiceWorker();
    } catch (error) {
      console.error('Error registering service worker:', error);
    }
  }
}

/**
 * Register service worker for push notifications
 */
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/'
      });
      console.log('Service Worker registered:', registration);
      
      // Get FCM token (requires Firebase Cloud Messaging setup)
      // Note: This requires Firebase Cloud Messaging SDK
      // For now, we'll just register the service worker
      
      return registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      throw error;
    }
  } else {
    throw new Error('Service Workers are not supported in this browser');
  }
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
async function populateFormFields(data) {
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
  
  // Load notification settings
  await loadNotificationSettings();

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

  // Bank Account form
  setValue("bankName", data.bankName);
  setValue("branchName", data.branchName);
  setValue("accountNumber", data.accountNumber);
  setValue("accountHolderName", data.accountHolderName);
  setSelectValue("accountType", data.accountType);
  setValue("swiftCode", data.swiftCode);
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
      dateOfBirth: (() => {
        const dob = document.getElementById("dateOfBirth")?.value;
        if (dob && window.DOBValidation) {
          const validation = window.DOBValidation.validateAge(dob);
          if (!validation.isValid) {
            showToast(validation.error, "error");
            const dobInput = document.getElementById("dateOfBirth");
            if (dobInput) {
              dobInput.focus();
              dobInput.reportValidity();
            }
            throw new Error(validation.error);
          }
        }
        return dob;
      })(),
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

// Handle Bank Account Form Submit
async function handleBankAccountFormSubmit(e) {
  e.preventDefault();
  showSpinner(true);

  try {
    const bankName = document.getElementById("bankName")?.value.trim();
    const accountNumber = document.getElementById("accountNumber")?.value.trim();
    const accountHolderName = document.getElementById("accountHolderName")?.value.trim();

    // Validate required fields
    if (!bankName || !accountNumber || !accountHolderName) {
      showToast("Bank name, account number, and account holder name are required", "error");
      showSpinner(false);
      return;
    }

    // Get current bank account data to detect changes
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    const currentData = userDoc.exists() ? userDoc.data() : {};
    const oldBankData = {
      bankName: currentData.bankName || "",
      accountNumber: currentData.accountNumber || "",
      accountHolderName: currentData.accountHolderName || "",
      branchName: currentData.branchName || "",
      accountType: currentData.accountType || "",
      swiftCode: currentData.swiftCode || "",
    };

    const newFormData = {
      bankName: bankName,
      branchName: document.getElementById("branchName")?.value.trim() || "",
      accountNumber: accountNumber,
      accountHolderName: accountHolderName,
      accountType: document.getElementById("accountType")?.value || "",
      swiftCode: document.getElementById("swiftCode")?.value.trim() || "",
      updatedAt: Timestamp.now(),
    };

    // Detect changes
    const hasChanges = 
      oldBankData.bankName !== newFormData.bankName ||
      oldBankData.accountNumber !== newFormData.accountNumber ||
      oldBankData.accountHolderName !== newFormData.accountHolderName ||
      oldBankData.branchName !== newFormData.branchName ||
      oldBankData.accountType !== newFormData.accountType ||
      oldBankData.swiftCode !== newFormData.swiftCode;

    // Update user document
    await updateDoc(doc(db, "users", currentUser.uid), {
      ...newFormData,
      bankAccountUpdatedAt: Timestamp.now(),
      bankAccountChanged: hasChanges ? true : (currentData.bankAccountChanged || false),
    });

    // Update in all group memberships
    await updateMemberProfileInGroups(newFormData);

    // Show alert if changes detected
    if (hasChanges) {
      const changes = [];
      if (oldBankData.bankName !== newFormData.bankName) {
        changes.push(`Bank: ${oldBankData.bankName || "N/A"} → ${newFormData.bankName}`);
      }
      if (oldBankData.accountNumber !== newFormData.accountNumber) {
        changes.push(`Account Number: ${oldBankData.accountNumber ? "****" + oldBankData.accountNumber.slice(-4) : "N/A"} → ****${newFormData.accountNumber.slice(-4)}`);
      }
      if (oldBankData.accountHolderName !== newFormData.accountHolderName) {
        changes.push(`Account Holder: ${oldBankData.accountHolderName || "N/A"} → ${newFormData.accountHolderName}`);
      }
      if (oldBankData.branchName !== newFormData.branchName) {
        changes.push(`Branch: ${oldBankData.branchName || "N/A"} → ${newFormData.branchName || "N/A"}`);
      }
      if (oldBankData.accountType !== newFormData.accountType) {
        changes.push(`Account Type: ${oldBankData.accountType || "N/A"} → ${newFormData.accountType || "N/A"}`);
      }

      alert(`⚠️ BANK ACCOUNT DETAILS UPDATED\n\nChanges detected:\n${changes.join("\n")}\n\nAdmins have been notified of these changes.`);
      showToast("Bank account details saved successfully. Admins have been notified.", "success");
    } else {
      showToast("Bank account details saved successfully", "success");
    }
  } catch (error) {
    console.error("Error saving bank account info:", error);
    showToast("Failed to save bank account details", "error");
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
    // Clear session data selectively to preserve user preferences
    sessionStorage.removeItem('selectedGroupId');
    sessionStorage.removeItem('isAdmin');
    sessionStorage.removeItem('viewMode');
    sessionStorage.removeItem('userRole');
    localStorage.removeItem('selectedGroupId');
    localStorage.removeItem('userEmail');
    // Preserve selectedCurrency preference
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
