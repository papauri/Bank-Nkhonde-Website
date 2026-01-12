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

  // Check auth and load existing data
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = '../login.html';
      return;
    }
    currentUser = user;
    await loadExistingProfile();
  });

  // Profile picture upload
  profilePictureInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB');
        return;
      }

      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }

      profilePictureFile = file;

      // Preview image
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.createElement('img');
        img.src = e.target.result;
        img.className = 'profile-picture-preview';
        profilePicturePreview.innerHTML = '';
        profilePicturePreview.appendChild(img);
      };
      reader.readAsDataURL(file);
    }
  });

  // Form submission
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveProfile();
  });

  /**
   * Load existing profile data
   */
  async function loadExistingProfile() {
    try {
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        
        // Pre-fill form with existing data
        if (userData.fullName) document.getElementById('fullName').value = userData.fullName;
        if (userData.phone) document.getElementById('phone').value = userData.phone;
        if (userData.whatsappNumber) document.getElementById('whatsappNumber').value = userData.whatsappNumber;
        if (userData.address) document.getElementById('address').value = userData.address;
        if (userData.dateOfBirth) document.getElementById('dateOfBirth').value = userData.dateOfBirth;
        if (userData.gender) document.getElementById('gender').value = userData.gender;
        if (userData.career) document.getElementById('career').value = userData.career;
        if (userData.jobTitle) document.getElementById('jobTitle').value = userData.jobTitle;
        if (userData.workplace) document.getElementById('workplace').value = userData.workplace;
        if (userData.workAddress) document.getElementById('workAddress').value = userData.workAddress;
        if (userData.guarantorName) document.getElementById('guarantorName').value = userData.guarantorName;
        if (userData.guarantorPhone) document.getElementById('guarantorPhone').value = userData.guarantorPhone;
        if (userData.guarantorRelationship) document.getElementById('guarantorRelationship').value = userData.guarantorRelationship;
        if (userData.guarantorAddress) document.getElementById('guarantorAddress').value = userData.guarantorAddress;
        if (userData.nationalId) document.getElementById('nationalId').value = userData.nationalId;
        if (userData.idType) document.getElementById('idType').value = userData.idType;
        if (userData.idNumber) document.getElementById('idNumber').value = userData.idNumber;
        if (userData.emergencyContact) document.getElementById('emergencyContact').value = userData.emergencyContact;
        if (userData.emergencyContactPhone) document.getElementById('emergencyContactPhone').value = userData.emergencyContactPhone;
        if (userData.collateral) document.getElementById('collateral').value = userData.collateral;
        if (userData.notes) document.getElementById('notes').value = userData.notes;

        // Load profile picture if exists
        if (userData.profileImageUrl) {
          const img = document.createElement('img');
          img.src = userData.profileImageUrl;
          img.className = 'profile-picture-preview';
          profilePicturePreview.innerHTML = '';
          profilePicturePreview.appendChild(img);
        }
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  }

  /**
   * Save profile
   */
  async function saveProfile() {
    try {
      submitProfileBtn.disabled = true;
      submitProfileBtn.innerHTML = '<span class="btn-text">Saving...</span>';

      // Collect form data
      const profileData = {
        fullName: document.getElementById('fullName').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        whatsappNumber: document.getElementById('whatsappNumber').value.trim() || document.getElementById('phone').value.trim(),
        address: document.getElementById('address').value.trim(),
        dateOfBirth: document.getElementById('dateOfBirth').value || null,
        gender: document.getElementById('gender').value || null,
        career: document.getElementById('career').value.trim(),
        jobTitle: document.getElementById('jobTitle').value.trim() || null,
        workplace: document.getElementById('workplace').value.trim() || null,
        workAddress: document.getElementById('workAddress').value.trim() || null,
        guarantorName: document.getElementById('guarantorName').value.trim(),
        guarantorPhone: document.getElementById('guarantorPhone').value.trim(),
        guarantorRelationship: document.getElementById('guarantorRelationship').value,
        guarantorAddress: document.getElementById('guarantorAddress').value.trim() || null,
        nationalId: document.getElementById('nationalId').value.trim() || null,
        idType: document.getElementById('idType').value || null,
        idNumber: document.getElementById('idNumber').value.trim() || null,
        emergencyContact: document.getElementById('emergencyContact').value.trim() || null,
        emergencyContactPhone: document.getElementById('emergencyContactPhone').value.trim() || null,
        collateral: document.getElementById('collateral').value.trim() || null,
        notes: document.getElementById('notes').value.trim() || null,
        profileCompleted: true,
        profileCompletedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      // Upload profile picture if provided
      if (profilePictureFile) {
        const storageRef = ref(storage, `profile-pictures/${currentUser.uid}/${Date.now()}_${profilePictureFile.name}`);
        await uploadBytes(storageRef, profilePictureFile);
        profileData.profileImageUrl = await getDownloadURL(storageRef);
      }

      // Update user document
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, profileData);

      // Update member document in all groups
      const userDoc = await getDoc(userRef);
      const groupMemberships = userDoc.data()?.groupMemberships || [];

      for (const membership of groupMemberships) {
        const memberRef = doc(db, `groups/${membership.groupId}/members`, currentUser.uid);
        await updateDoc(memberRef, {
          ...profileData,
          updatedAt: Timestamp.now()
        });
      }

      alert('Profile completed successfully!');
      window.location.href = 'admin_dashboard.html';
    } catch (error) {
      console.error('Error saving profile:', error);
      alert('Error saving profile. Please try again.');
      submitProfileBtn.disabled = false;
      submitProfileBtn.innerHTML = '<span class="btn-text">Complete Profile</span><svg class="btn-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
  }
});
