/**
 * Complete Profile - For new admins after registration
 */

import {
  db,
  auth,
  storage,
  doc,
  getDoc,
  updateDoc,
  ref,
  uploadBytes,
  getDownloadURL,
  onAuthStateChanged,
  Timestamp,
} from './firebaseConfig.js';

let currentUser = null;
let profilePictureFile = null;

document.addEventListener('DOMContentLoaded', () => {
  const profileForm = document.getElementById('profileForm');
  const profilePictureInput = document.getElementById('profilePictureInput');
  const profilePicturePreview = document.getElementById('profilePicturePreview');
  const submitProfileBtn = document.getElementById('submitProfileBtn');
  const errorMessage = document.getElementById('errorMessage');
  const spinner = document.getElementById('spinner');
  const loadingText = document.getElementById('loadingText');

  // Helper function to show/hide spinner
  function showSpinner(show, message = 'Saving profile...') {
    if (spinner) {
      if (show) {
        spinner.classList.remove('hidden');
        spinner.classList.add('show');
      } else {
        spinner.classList.add('hidden');
        spinner.classList.remove('show');
      }
    }
    if (loadingText) {
      loadingText.textContent = message;
    }
  }

  // Helper function to show error
  function showError(message) {
    if (errorMessage) {
      errorMessage.textContent = message;
      errorMessage.classList.remove('hidden');
      errorMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Helper function to hide error
  function hideError() {
    if (errorMessage) {
      errorMessage.classList.add('hidden');
    }
  }

  // Check auth and load existing data
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      console.log('No user found, redirecting to login');
      window.location.href = '../login.html';
      return;
    }
    currentUser = user;
    console.log('User authenticated:', user.email);
    await loadExistingProfile();
  });

  // Profile picture upload
  if (profilePictureInput) {
    profilePictureInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        // Validate file
        if (file.size > 5 * 1024 * 1024) {
          showError('Image size must be less than 5MB');
          return;
        }

        if (!file.type.startsWith('image/')) {
          showError('Please select an image file');
          return;
        }

        hideError();
        profilePictureFile = file;

        // Preview image
        const reader = new FileReader();
        reader.onload = (e) => {
          if (profilePicturePreview) {
            profilePicturePreview.innerHTML = `<img src="${e.target.result}" alt="Profile">`;
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Form submission
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();
      await saveProfile();
    });
  }

  /**
   * Load existing profile data
   */
  async function loadExistingProfile() {
    try {
      showSpinner(true, 'Loading profile...');
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        console.log('Loaded user data:', userData.fullName);
        
        // Pre-fill form with existing data - safely check each element
        const fields = [
          'fullName', 'phone', 'whatsappNumber', 'address', 'dateOfBirth',
          'gender', 'career', 'jobTitle', 'workplace', 'workAddress',
          'guarantorName', 'guarantorPhone', 'guarantorRelationship', 'guarantorAddress',
          'nationalId', 'idType', 'idNumber', 'emergencyContact', 'emergencyContactPhone',
          'collateral', 'notes'
        ];

        fields.forEach(field => {
          const element = document.getElementById(field);
          if (element && userData[field]) {
            element.value = userData[field];
          }
        });

        // Load profile picture if exists
        if (userData.profileImageUrl && profilePicturePreview) {
          profilePicturePreview.innerHTML = `<img src="${userData.profileImageUrl}" alt="Profile">`;
        }
      }
      showSpinner(false);
    } catch (error) {
      console.error('Error loading profile:', error);
      showSpinner(false);
      // Don't show error for loading - just let them fill form
    }
  }

  /**
   * Save profile
   */
  async function saveProfile() {
    try {
      if (submitProfileBtn) {
        submitProfileBtn.disabled = true;
      }
      showSpinner(true, 'Saving your profile...');

      // Helper to safely get value
      const getValue = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
      };

      // Validate required fields
      const fullName = getValue('fullName');
      const phone = getValue('phone');
      const address = getValue('address');
      const career = getValue('career');
      const guarantorName = getValue('guarantorName');
      const guarantorPhone = getValue('guarantorPhone');
      const guarantorRelationship = getValue('guarantorRelationship');

      if (!fullName) {
        showSpinner(false);
        showError('Please enter your full name');
        if (submitProfileBtn) submitProfileBtn.disabled = false;
        return;
      }

      if (!phone) {
        showSpinner(false);
        showError('Please enter your phone number');
        if (submitProfileBtn) submitProfileBtn.disabled = false;
        return;
      }

      if (!address) {
        showSpinner(false);
        showError('Please enter your address');
        if (submitProfileBtn) submitProfileBtn.disabled = false;
        return;
      }

      if (!career) {
        showSpinner(false);
        showError('Please enter your career/profession');
        if (submitProfileBtn) submitProfileBtn.disabled = false;
        return;
      }

      if (!guarantorName || !guarantorPhone || !guarantorRelationship) {
        showSpinner(false);
        showError('Please fill in all required guarantor information');
        if (submitProfileBtn) submitProfileBtn.disabled = false;
        return;
      }

      // Collect form data
      const profileData = {
        fullName: fullName,
        phone: phone,
        whatsappNumber: getValue('whatsappNumber') || phone,
        address: address,
        dateOfBirth: getValue('dateOfBirth') || null,
        gender: getValue('gender') || null,
        career: career,
        jobTitle: getValue('jobTitle') || null,
        workplace: getValue('workplace') || null,
        workAddress: getValue('workAddress') || null,
        guarantorName: guarantorName,
        guarantorPhone: guarantorPhone,
        guarantorRelationship: guarantorRelationship,
        guarantorAddress: getValue('guarantorAddress') || null,
        nationalId: getValue('nationalId') || null,
        idType: getValue('idType') || null,
        idNumber: getValue('idNumber') || null,
        emergencyContact: getValue('emergencyContact') || null,
        emergencyContactPhone: getValue('emergencyContactPhone') || null,
        collateral: getValue('collateral') || null,
        notes: getValue('notes') || null,
        profileCompleted: true,
        profileCompletedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      // Upload profile picture if provided
      if (profilePictureFile) {
        showSpinner(true, 'Uploading profile picture...');
        try {
          const storageRef = ref(storage, `profile-pictures/${currentUser.uid}/${Date.now()}_${profilePictureFile.name}`);
          await uploadBytes(storageRef, profilePictureFile);
          profileData.profileImageUrl = await getDownloadURL(storageRef);
          console.log('Profile picture uploaded');
        } catch (uploadError) {
          console.error('Error uploading profile picture:', uploadError);
          // Continue without profile picture
        }
      }

      showSpinner(true, 'Saving profile...');

      // Update user document
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, profileData);
      console.log('User document updated');

      // Update member document in all groups
      try {
        const userDoc = await getDoc(userRef);
        const groupMemberships = userDoc.data()?.groupMemberships || [];
        console.log(`Updating ${groupMemberships.length} group memberships`);

        for (const membership of groupMemberships) {
          try {
            const memberRef = doc(db, `groups/${membership.groupId}/members`, currentUser.uid);
            await updateDoc(memberRef, {
              fullName: profileData.fullName,
              phone: profileData.phone,
              whatsappNumber: profileData.whatsappNumber,
              profileImageUrl: profileData.profileImageUrl || null,
              updatedAt: Timestamp.now()
            });
          } catch (memberError) {
            console.warn(`Could not update member in group ${membership.groupId}:`, memberError);
            // Continue with other groups
          }
        }
      } catch (groupError) {
        console.warn('Error updating group memberships:', groupError);
        // Profile is saved, just couldn't update groups
      }

      showSpinner(false);
      
      // Show success and redirect
      alert('Profile completed successfully! Welcome to Bank Nkhonde.');
      
      // Check if user is admin or member and redirect accordingly
      const userDoc = await getDoc(userRef);
      const memberships = userDoc.data()?.groupMemberships || [];
      const isAdmin = memberships.some(m => m.role === 'senior_admin' || m.role === 'admin');
      
      if (isAdmin) {
        window.location.href = 'admin_dashboard.html';
      } else {
        window.location.href = 'user_dashboard.html';
      }

    } catch (error) {
      console.error('Error saving profile:', error);
      showSpinner(false);
      showError(`Error saving profile: ${error.message}. Please try again.`);
      if (submitProfileBtn) {
        submitProfileBtn.disabled = false;
      }
    }
  }
});
