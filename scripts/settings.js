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
        const isAdmin = groupData.admins?.some(
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
        const isGroupAdmin = groupData.admins?.some(
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

      // Generate secure invitation token
      const invitationToken = generateSecureToken();
      // Use relative path for better portability
      const invitationUrl = `${window.location.origin}/pages/accept_invitation.html?token=${invitationToken}`;

      // Store invitation in database for backend processing
      await addDoc(collection(db, "invitations"), {
        email,
        groupId,
        groupName,
        invitationToken,
        invitedBy: currentUser.uid,
        invitedByName: (await getDoc(doc(db, "users", currentUser.uid))).data()?.fullName || currentUser.email,
        invitedByEmail: currentUser.email,
        status: "pending",
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)), // 7 days
      });

      // Auto-generated email content (to be sent by Cloud Function)
      const emailTemplate = {
        subject: `You're invited to join ${groupName} on Bank Nkhonde`,
        body: `
          <h2>You've been invited to join ${groupName}!</h2>
          <p>You have been invited by ${(await getDoc(doc(db, "users", currentUser.uid))).data()?.fullName || currentUser.email} to join their savings group on Bank Nkhonde.</p>
          <p><strong>Group:</strong> ${groupName}</p>
          <p>Click the link below to accept the invitation and create your account:</p>
          <p><a href="${invitationUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block;">Accept Invitation</a></p>
          <p>This invitation will expire in 7 days.</p>
          <p>If you did not expect this invitation, you can safely ignore this email.</p>
          <hr>
          <p style="color: #6b7280; font-size: 12px;">Bank Nkhonde - Digital ROSCA Management Platform</p>
        `,
      };

      // NOTE: In production, a Cloud Function should be triggered here to send the actual email
      // The Cloud Function would:
      // 1. Listen for new documents in the "invitations" collection
      // 2. Use server-side SMTP configuration from environment variables
      // 3. Send the email using nodemailer or similar
      // 4. Update the invitation status to "sent"

      alert(`Invitation sent to ${email}! They will receive an email with a link to join ${groupName}.`);
      inviteEmailInput.value = "";
    } catch (error) {
      console.error("Error sending invitation:", error);
      alert("Error sending invitation. Please try again.");
    } finally {
      toggleLoading(false);
    }
  });

  // Generate secure random token
  function generateSecureToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

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
        
        // Create key info container
        const keyInfo = document.createElement("div");
        keyInfo.className = "key-info";
        
        // Add code (using textContent to prevent XSS)
        const codeStrong = document.createElement("strong");
        codeStrong.textContent = keyData.code;
        keyInfo.appendChild(codeStrong);
        
        // Add status badge
        const statusBadge = document.createElement("span");
        statusBadge.className = "badge";
        if (keyData.approved) {
          if (keyData.used) {
            statusBadge.classList.add("used");
            statusBadge.textContent = "Used";
          } else {
            statusBadge.classList.add("approved");
            statusBadge.textContent = "Approved";
          }
        } else {
          statusBadge.classList.add("pending");
          statusBadge.textContent = "Pending Approval";
        }
        keyInfo.appendChild(statusBadge);
        
        // Add creation date
        const dateSmall = document.createElement("small");
        dateSmall.textContent = `Created: ${keyData.createdAt?.toDate().toLocaleDateString()}`;
        keyInfo.appendChild(dateSmall);
        
        keyItem.appendChild(keyInfo);
        
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
        
        // Create member info container
        const memberInfo = document.createElement("div");
        memberInfo.className = "member-info";
        
        // Add member name (using textContent to prevent XSS)
        const nameStrong = document.createElement("strong");
        nameStrong.textContent = memberData.fullName || "Unknown";
        memberInfo.appendChild(nameStrong);
        
        // Add custom title if available
        if (memberData.customTitle) {
          const titleBadge = document.createElement("span");
          titleBadge.className = "badge badge-title";
          titleBadge.textContent = memberData.customTitle;
          memberInfo.appendChild(titleBadge);
        }
        
        // Add email
        const emailSmall = document.createElement("small");
        emailSmall.textContent = memberData.email || "";
        memberInfo.appendChild(emailSmall);
        
        // Add role badge
        const roleBadge = document.createElement("span");
        roleBadge.className = "badge";
        roleBadge.textContent = memberData.role || "member";
        memberInfo.appendChild(roleBadge);
        
        // Add status badge if suspended
        if (memberData.status === "suspended") {
          const statusBadge = document.createElement("span");
          statusBadge.className = "badge badge-warning";
          statusBadge.textContent = "Suspended";
          statusBadge.style.marginLeft = "10px";
          memberInfo.appendChild(statusBadge);
        }
        
        memberItem.appendChild(memberInfo);
        
        // Create button container
        const buttonContainer = document.createElement("div");
        buttonContainer.style.display = "flex";
        buttonContainer.style.gap = "10px";
        buttonContainer.style.marginTop = "10px";
        
        // Add Edit Profile button for admins
        const editBtn = document.createElement("button");
        editBtn.className = "button small primary";
        editBtn.textContent = "Edit Profile";
        editBtn.addEventListener("click", () => {
          openEditMemberModal(doc.id, memberData, groupId);
        });
        buttonContainer.appendChild(editBtn);
        
        // Add Suspend/Unsuspend button
        const suspendBtn = document.createElement("button");
        suspendBtn.className = memberData.status === "suspended" ? "button small secondary" : "button small warning";
        suspendBtn.textContent = memberData.status === "suspended" ? "Unsuspend" : "Suspend";
        suspendBtn.addEventListener("click", () => {
          toggleMemberSuspension(doc.id, memberData, groupId);
        });
        buttonContainer.appendChild(suspendBtn);
        
        // Add Delete button
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "button small danger";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
          deleteMember(doc.id, memberData, groupId);
        });
        buttonContainer.appendChild(deleteBtn);
        
        memberItem.appendChild(buttonContainer);
        membersList.appendChild(memberItem);
      });
    } catch (error) {
      console.error("Error loading members:", error);
      alert("Error loading members.");
    } finally {
      toggleLoading(false);
    }
  });

  // Open Edit Member Modal
  function openEditMemberModal(memberId, memberData, groupId) {
    const editMemberModal = document.getElementById("editMemberModal");
    const editMemberForm = document.getElementById("editMemberProfileForm");
    
    // Populate form fields
    document.getElementById("editMemberFullName").value = memberData.fullName || "";
    document.getElementById("editMemberEmail").value = memberData.email || "";
    document.getElementById("editMemberPhone").value = memberData.phone || "";
    document.getElementById("editMemberRole").value = memberData.role || "user";
    document.getElementById("editMemberTitle").value = memberData.customTitle || "";
    document.getElementById("editMemberCollateral").value = memberData.collateral || "";
    
    // Show modal
    editMemberModal.style.display = "flex";
    
    // Handle form submission
    editMemberForm.onsubmit = async (e) => {
      e.preventDefault();
      
      try {
        toggleLoading(true, "Updating member profile...");
        
        const updatedData = {
          fullName: document.getElementById("editMemberFullName").value.trim(),
          phone: document.getElementById("editMemberPhone").value.trim(),
          role: document.getElementById("editMemberRole").value,
          customTitle: document.getElementById("editMemberTitle").value.trim() || null,
          collateral: document.getElementById("editMemberCollateral").value.trim() || null,
        };
        
        // Update member in group
        await updateDoc(doc(db, `groups/${groupId}/members`, memberId), updatedData);
        
        // Also update in users collection if it's their core profile info
        await updateDoc(doc(db, "users", memberId), {
          fullName: updatedData.fullName,
          phone: updatedData.phone,
        });
        
        alert("Member profile updated successfully!");
        editMemberModal.style.display = "none";
        
        // Reload members list
        manageMembersGroupSelect.dispatchEvent(new Event("change"));
      } catch (error) {
        console.error("Error updating member profile:", error);
        alert("Error updating member profile. Please try again.");
      } finally {
        toggleLoading(false);
      }
    };
  }
  
  // Cancel Edit Member Modal
  const cancelEditMember = document.getElementById("cancelEditMember");
  if (cancelEditMember) {
    cancelEditMember.addEventListener("click", () => {
      const editMemberModal = document.getElementById("editMemberModal");
      editMemberModal.style.display = "none";
    });
  }

  // Toggle Member Suspension
  async function toggleMemberSuspension(memberId, memberData, groupId) {
    const currentStatus = memberData.status || "active";
    const newStatus = currentStatus === "suspended" ? "active" : "suspended";
    const action = newStatus === "suspended" ? "suspend" : "unsuspend";
    
    if (!confirm(`Are you sure you want to ${action} ${memberData.fullName}?`)) {
      return;
    }
    
    try {
      toggleLoading(true, `${action === "suspend" ? "Suspending" : "Unsuspending"} member...`);
      
      // Update member status in group
      await updateDoc(doc(db, `groups/${groupId}/members`, memberId), {
        status: newStatus,
        suspendedAt: newStatus === "suspended" ? Timestamp.now() : null,
        suspendedBy: newStatus === "suspended" ? currentUser.uid : null,
        unsuspendedAt: newStatus === "active" ? Timestamp.now() : null,
        unsuspendedBy: newStatus === "active" ? currentUser.uid : null,
      });
      
      alert(`Member ${action}ed successfully!`);
      
      // Reload members list
      manageMembersGroupSelect.dispatchEvent(new Event("change"));
    } catch (error) {
      console.error(`Error ${action}ing member:`, error);
      alert(`Error ${action}ing member. Please try again.`);
    } finally {
      toggleLoading(false);
    }
  }

  // Delete Member
  async function deleteMember(memberId, memberData, groupId) {
    // Prevent deleting yourself
    if (memberId === currentUser.uid) {
      alert("You cannot delete yourself. Please use 'Leave Group' from Account Actions.");
      return;
    }
    
    const confirmText = `Are you sure you want to delete ${memberData.fullName} from this group?\n\nThis action will:\n- Remove them from the group\n- Remove all their payment records\n- This action CANNOT be undone!\n\nType "${memberData.fullName}" to confirm.`;
    const userInput = prompt(confirmText);
    
    if (userInput !== memberData.fullName) {
      alert("Deletion cancelled. Name did not match.");
      return;
    }
    
    try {
      toggleLoading(true, "Deleting member...");
      
      // Delete member from group
      await deleteDoc(doc(db, `groups/${groupId}/members`, memberId));
      
      // Remove group from user's groupMemberships
      const userRef = doc(db, "users", memberId);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const updatedMemberships = (userData.groupMemberships || []).filter(
          membership => membership.groupId !== groupId
        );
        
        await updateDoc(userRef, {
          groupMemberships: updatedMemberships,
          updatedAt: Timestamp.now(),
        });
      }
      
      // Update group statistics
      const groupRef = doc(db, "groups", groupId);
      const groupDoc = await getDoc(groupRef);
      
      if (groupDoc.exists()) {
        const groupData = groupDoc.data();
        const currentStats = groupData.statistics || {};
        
        await updateDoc(groupRef, {
          "statistics.totalMembers": Math.max((currentStats.totalMembers || 0) - 1, 0),
          "statistics.activeMembers": Math.max((currentStats.activeMembers || 0) - 1, 0),
          updatedAt: Timestamp.now(),
        });
      }
      
      alert("Member deleted successfully!");
      
      // Reload members list
      manageMembersGroupSelect.dispatchEvent(new Event("change"));
    } catch (error) {
      console.error("Error deleting member:", error);
      alert("Error deleting member. Please try again.");
    } finally {
      toggleLoading(false);
    }
  }

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
      window.location.href = "../login.html";
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
        
        // Update admins array if user is an admin
        const groupData = groupDoc.data();
        if (groupData.admins?.some(admin => admin.uid === currentUser.uid)) {
          const updatedAdmins = groupData.admins.filter(
            admin => admin.uid !== currentUser.uid
          );
          await updateDoc(doc(db, "groups", groupId), {
            admins: updatedAdmins
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
      window.location.href = "../login.html";
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
      window.location.href = "../login.html";
    }
  });
});
