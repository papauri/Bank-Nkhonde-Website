import {
  db,
  auth,
  doc,
  getDoc,
  collection,
  getDocs,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  onAuthStateChanged,
  signOut,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  Timestamp,
  onSnapshot,
} from "./firebaseConfig.js";

import { createInvitationCode } from "./invitation_code.js";

// NOTE: In production, email sending should be handled by a Cloud Function
// with proper server-side SMTP configuration. Client-side SMTP is not secure.
// For now, invitations are stored in the database and need backend processing.

document.addEventListener("DOMContentLoaded", () => {
  let currentUser = null;
  let isAdmin = false;

  // Get DOM elements
  const backButton = document.getElementById("backButton");
  const fullNameInput = document.getElementById("fullName");
  const emailInput = document.getElementById("email");
  const phoneInput = document.getElementById("phone");
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  const changePasswordBtn = document.getElementById("changePasswordBtn");
  const currentPasswordInput = document.getElementById("currentPassword");
  const newPasswordInput = document.getElementById("newPassword");
  const confirmPasswordInput = document.getElementById("confirmPassword");
  const logoutBtn = document.getElementById("logoutBtn");
  const deleteAccountBtn = document.getElementById("deleteAccountBtn");
  const adminSection = document.querySelector(".admin-only");
  const sendInviteBtn = document.getElementById("sendInviteBtn");
  const inviteEmailInput = document.getElementById("inviteEmail");
  const inviteGroupSelect = document.getElementById("inviteGroup");
  const inviteMessageInput = document.getElementById("inviteMessage");
  const createRegistrationKeyBtn = document.getElementById("createRegistrationKeyBtn");
  const registrationKeysList = document.getElementById("registrationKeysList");
  const editGroupSelect = document.getElementById("editGroup");
  const groupEditForm = document.getElementById("groupEditForm");
  const saveGroupSettingsBtn = document.getElementById("saveGroupSettingsBtn");
  const manageMembersGroupSelect = document.getElementById("manageMembersGroup");
  const membersList = document.getElementById("membersList");
  const saveNotificationsBtn = document.getElementById("saveNotificationsBtn");
  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingMessage = document.getElementById("loadingMessage");

  // Show/hide loading overlay
  function toggleLoading(show, message = "Processing...") {
    loadingMessage.textContent = message;
    loadingOverlay.style.display = show ? "flex" : "none";
  }

  // Check if user is admin of any group
  async function checkIfUserIsAdmin(user) {
    try {
      const groupsRef = collection(db, "groups");
      const querySnapshot = await getDocs(groupsRef);
      
      for (const docSnapshot of querySnapshot.docs) {
        const groupData = docSnapshot.data();
        const isAdmin = groupData.adminDetails?.some(
          (admin) => admin.email === user.email || admin.uid === user.uid
        );
        if (isAdmin) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error("Error checking admin status:", error);
      return false;
    }
  }

  // Load user profile
  async function loadUserProfile(user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        fullNameInput.value = userData.fullName || "";
        emailInput.value = userData.email || user.email;
        phoneInput.value = userData.phone || "";
      } else {
        emailInput.value = user.email;
      }
    } catch (error) {
      console.error("Error loading user profile:", error);
      alert("Error loading profile. Please refresh the page.");
    }
  }

  // Save profile changes
  saveProfileBtn.addEventListener("click", async () => {
    try {
      toggleLoading(true, "Saving profile...");
      const userRef = doc(db, "users", currentUser.uid);
      await updateDoc(userRef, {
        fullName: fullNameInput.value.trim(),
        phone: phoneInput.value.trim(),
      });
      alert("Profile updated successfully!");
    } catch (error) {
      console.error("Error saving profile:", error);
      alert("Error saving profile. Please try again.");
    } finally {
      toggleLoading(false);
    }
  });

  // Change password
  changePasswordBtn.addEventListener("click", async () => {
    const currentPassword = currentPasswordInput.value;
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!currentPassword || !newPassword || !confirmPassword) {
      alert("Please fill all password fields.");
      return;
    }

    if (newPassword.length < 6) {
      alert("New password must be at least 6 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      alert("New passwords do not match.");
      return;
    }

    try {
      toggleLoading(true, "Changing password...");
      
      // Reauthenticate user
      const credential = EmailAuthProvider.credential(
        currentUser.email,
        currentPassword
      );
      await reauthenticateWithCredential(currentUser, credential);
      
      // Update password
      await updatePassword(currentUser, newPassword);
      
      alert("Password changed successfully!");
      currentPasswordInput.value = "";
      newPasswordInput.value = "";
      confirmPasswordInput.value = "";
    } catch (error) {
      console.error("Error changing password:", error);
      if (error.code === "auth/wrong-password") {
        alert("Current password is incorrect.");
      } else {
        alert("Error changing password. Please try again.");
      }
    } finally {
      toggleLoading(false);
    }
  });

  // Load admin groups for various dropdowns
  async function loadAdminGroups() {
    try {
      const groupsRef = collection(db, "groups");
      const querySnapshot = await getDocs(groupsRef);
      
      const adminGroups = [];
      querySnapshot.forEach((docSnapshot) => {
        const groupData = docSnapshot.data();
        const isGroupAdmin = groupData.adminDetails?.some(
          (admin) => admin.email === currentUser.email || admin.uid === currentUser.uid
        );
        if (isGroupAdmin) {
          adminGroups.push({
            id: docSnapshot.id,
            name: groupData.groupName,
            data: groupData
          });
        }
      });

      // Populate invite group select
      inviteGroupSelect.innerHTML = '<option value="">Select a group...</option>';
      editGroupSelect.innerHTML = '<option value="">Select a group...</option>';
      manageMembersGroupSelect.innerHTML = '<option value="">Select a group...</option>';
      
      adminGroups.forEach(group => {
        const option1 = document.createElement("option");
        option1.value = group.id;
        option1.textContent = group.name;
        inviteGroupSelect.appendChild(option1);

        const option2 = document.createElement("option");
        option2.value = group.id;
        option2.textContent = group.name;
        editGroupSelect.appendChild(option2);

        const option3 = document.createElement("option");
        option3.value = group.id;
        option3.textContent = group.name;
        manageMembersGroupSelect.appendChild(option3);
      });

      return adminGroups;
    } catch (error) {
      console.error("Error loading admin groups:", error);
      return [];
    }
  }

  // Send email invitation (using Cloud Function or third-party service)
  sendInviteBtn.addEventListener("click", async () => {
    const email = inviteEmailInput.value.trim();
    const groupId = inviteGroupSelect.value;
    const message = inviteMessageInput.value.trim();

    if (!email || !groupId) {
      alert("Please enter an email address and select a group.");
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      alert("Please enter a valid email address.");
      return;
    }

    try {
      toggleLoading(true, "Sending invitation...");
      
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      const groupName = groupDoc.exists() ? groupDoc.data().groupName : "Unknown Group";

      // Store invitation in database for backend processing
      await addDoc(collection(db, "invitations"), {
        email,
        groupId,
        groupName,
        invitedBy: currentUser.uid,
        invitedByEmail: currentUser.email,
        customMessage: message,
        status: "pending",
        createdAt: Timestamp.now(),
        // SMTP credentials should be stored securely on the backend
        emailConfig: {
          host: "mail.promanaged-it.com",
          port: 465,
          from: "_mainaccount@promanaged-it.com",
          // Password should be in environment variables on the backend
        }
      });

      // NOTE: In production, a Cloud Function should be triggered here to send the actual email
      // The Cloud Function would:
      // 1. Listen for new documents in the "invitations" collection
      // 2. Use server-side SMTP configuration from environment variables
      // 3. Send the email using nodemailer or similar
      // 4. Update the invitation status to "sent"

      alert(`Invitation saved for ${email}! Backend processing will send the email to join ${groupName}.`);
      inviteEmailInput.value = "";
      inviteMessageInput.value = "";
    } catch (error) {
      console.error("Error sending invitation:", error);
      alert("Error sending invitation. Please try again.");
    } finally {
      toggleLoading(false);
    }
  });

  // Create registration key
  createRegistrationKeyBtn.addEventListener("click", async () => {
    try {
      toggleLoading(true, "Creating registration key...");
      await createInvitationCode();
      await loadRegistrationKeys();
      alert("Registration key created! It needs to be manually approved in the database.");
    } catch (error) {
      console.error("Error creating registration key:", error);
      alert("Error creating registration key. Please try again.");
    } finally {
      toggleLoading(false);
    }
  });

  // Load registration keys
  async function loadRegistrationKeys() {
    try {
      const keysQuery = query(collection(db, "invitationCodes"));
      const querySnapshot = await getDocs(keysQuery);
      
      registrationKeysList.innerHTML = "";
      
      if (querySnapshot.empty) {
        registrationKeysList.innerHTML = "<p>No registration keys found.</p>";
        return;
      }

      querySnapshot.forEach((docSnapshot) => {
        const keyData = docSnapshot.data();
        const keyItem = document.createElement("div");
        keyItem.className = "key-item";
        
        const statusBadge = keyData.approved ? 
          (keyData.used ? '<span class="badge used">Used</span>' : '<span class="badge approved">Approved</span>') :
          '<span class="badge pending">Pending Approval</span>';
        
        keyItem.innerHTML = `
          <div class="key-info">
            <strong>${keyData.code}</strong>
            ${statusBadge}
            <small>Created: ${keyData.createdAt?.toDate().toLocaleDateString()}</small>
          </div>
        `;
        
        // Add delete button if not used
        if (!keyData.used) {
          const deleteBtn = document.createElement("button");
          deleteBtn.className = "button small danger";
          deleteBtn.textContent = "Delete";
          deleteBtn.addEventListener("click", () => deleteKey(docSnapshot.id));
          keyItem.appendChild(deleteBtn);
        }
        
        registrationKeysList.appendChild(keyItem);
      });
    } catch (error) {
      console.error("Error loading registration keys:", error);
    }
  }

  // Delete registration key
  async function deleteKey(keyId) {
  async function deleteKey(keyId) {
    if (!confirm("Are you sure you want to delete this registration key?")) {
      return;
    }
    try {
      toggleLoading(true, "Deleting key...");
      await deleteDoc(doc(db, "invitationCodes", keyId));
      await loadRegistrationKeys();
      alert("Registration key deleted.");
    } catch (error) {
      console.error("Error deleting key:", error);
      alert("Error deleting key. Please try again.");
    } finally {
      toggleLoading(false);
    }
  }

  // Load group settings when group is selected
  editGroupSelect.addEventListener("change", async () => {
    const groupId = editGroupSelect.value;
    if (!groupId) {
      groupEditForm.style.display = "none";
      return;
    }

    try {
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (groupDoc.exists()) {
        const groupData = groupDoc.data();
        document.getElementById("editSeedMoney").value = groupData.seedMoney || 0;
        document.getElementById("editMonthlyContribution").value = groupData.monthlyContribution || 0;
        document.getElementById("editInterestRate").value = groupData.interestRate || 0;
        document.getElementById("editLoanPenalty").value = groupData.loanPenalty || 0;
        document.getElementById("editMonthlyPenalty").value = groupData.monthlyPenalty || 0;
        groupEditForm.style.display = "block";
      }
    } catch (error) {
      console.error("Error loading group settings:", error);
      alert("Error loading group settings.");
    }
  });

  // Save group settings
  saveGroupSettingsBtn.addEventListener("click", async () => {
    const groupId = editGroupSelect.value;
    if (!groupId) return;

    try {
      toggleLoading(true, "Saving group settings...");
      const groupRef = doc(db, "groups", groupId);
      await updateDoc(groupRef, {
        seedMoney: parseFloat(document.getElementById("editSeedMoney").value),
        monthlyContribution: parseFloat(document.getElementById("editMonthlyContribution").value),
        interestRate: parseFloat(document.getElementById("editInterestRate").value),
        loanPenalty: parseFloat(document.getElementById("editLoanPenalty").value),
        monthlyPenalty: parseFloat(document.getElementById("editMonthlyPenalty").value),
        updatedAt: Timestamp.now(),
      });
      alert("Group settings updated successfully!");
    } catch (error) {
      console.error("Error saving group settings:", error);
      alert("Error saving group settings. Please try again.");
    } finally {
      toggleLoading(false);
    }
  });

  // Load members when group is selected
  manageMembersGroupSelect.addEventListener("change", async () => {
    const groupId = manageMembersGroupSelect.value;
    if (!groupId) {
      membersList.innerHTML = "";
      return;
    }

    try {
      toggleLoading(true, "Loading members...");
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      
      membersList.innerHTML = "";
      
      if (membersSnapshot.empty) {
        membersList.innerHTML = "<p>No members found.</p>";
        return;
      }

      membersSnapshot.forEach((doc) => {
        const memberData = doc.data();
        const memberItem = document.createElement("div");
        memberItem.className = "member-item";
        memberItem.innerHTML = `
          <div class="member-info">
            <strong>${memberData.fullName || "Unknown"}</strong>
            <small>${memberData.email || ""}</small>
            <span class="badge">${memberData.role || "member"}</span>
          </div>
        `;
        membersList.appendChild(memberItem);
      });
    } catch (error) {
      console.error("Error loading members:", error);
      alert("Error loading members.");
    } finally {
      toggleLoading(false);
    }
  });

  // Save notification preferences
  saveNotificationsBtn.addEventListener("click", async () => {
    try {
      toggleLoading(true, "Saving preferences...");
      const userRef = doc(db, "users", currentUser.uid);
      await updateDoc(userRef, {
        notifications: {
          email: document.getElementById("emailNotifications").checked,
          paymentReminders: document.getElementById("paymentReminders").checked,
          loanAlerts: document.getElementById("loanAlerts").checked,
        },
        updatedAt: Timestamp.now(),
      });
      alert("Notification preferences saved!");
    } catch (error) {
      console.error("Error saving preferences:", error);
      alert("Error saving preferences. Please try again.");
    } finally {
      toggleLoading(false);
    }
  });

  // Logout
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "../index.html";
    } catch (error) {
      console.error("Error logging out:", error);
      alert("Error logging out. Please try again.");
    }
  });

  // Delete account
  deleteAccountBtn.addEventListener("click", async () => {
    const confirmation = prompt("Type 'DELETE' to confirm account deletion:");
    if (confirmation !== "DELETE") {
      alert("Account deletion cancelled.");
      return;
    }

    try {
      toggleLoading(true, "Deleting account...");
      
      // Clean up user data from all groups
      const groupsRef = collection(db, "groups");
      const groupsSnapshot = await getDocs(groupsRef);
      
      for (const groupDoc of groupsSnapshot.docs) {
        const groupId = groupDoc.id;
        
        // Remove user from group members
        const memberRef = doc(db, `groups/${groupId}/members`, currentUser.uid);
        const memberDoc = await getDoc(memberRef);
        if (memberDoc.exists()) {
          await deleteDoc(memberRef);
        }
        
        // Update adminDetails if user is an admin
        const groupData = groupDoc.data();
        if (groupData.adminDetails?.some(admin => admin.uid === currentUser.uid)) {
          const updatedAdminDetails = groupData.adminDetails.filter(
            admin => admin.uid !== currentUser.uid
          );
          await updateDoc(doc(db, "groups", groupId), {
            adminDetails: updatedAdminDetails
          });
        }
      }
      
      // Delete invitations sent by user
      const invitationsQuery = query(
        collection(db, "invitations"),
        where("invitedBy", "==", currentUser.uid)
      );
      const invitationsSnapshot = await getDocs(invitationsQuery);
      for (const inviteDoc of invitationsSnapshot.docs) {
        await deleteDoc(inviteDoc.ref);
      }
      
      // Delete user document
      await deleteDoc(doc(db, "users", currentUser.uid));
      
      // Delete Firebase Auth user
      await currentUser.delete();
      
      alert("Account deleted successfully.");
      window.location.href = "../index.html";
    } catch (error) {
      console.error("Error deleting account:", error);
      if (error.code === "auth/requires-recent-login") {
        alert("For security reasons, please log out and log back in before deleting your account.");
      } else {
        alert("Error deleting account. Please try again.");
      }
    } finally {
      toggleLoading(false);
    }
  });

  // Back button
  backButton.addEventListener("click", () => {
    // Check if user came from admin or user dashboard
    if (isAdmin) {
      window.location.href = "admin_dashboard.html";
    } else {
      window.location.href = "user_dashboard.html";
    }
  });

  // Initialize on auth state change
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      await loadUserProfile(user);
      
      // Check if user is admin and show admin settings
      isAdmin = await checkIfUserIsAdmin(user);
      if (isAdmin) {
        adminSection.style.display = "block";
        await loadAdminGroups();
        await loadRegistrationKeys();
      } else {
        adminSection.style.display = "none";
      }
    } else {
      alert("You must be logged in to access settings.");
      window.location.href = "../index.html";
    }
  });
});
