import {
  db,
  auth,
  onAuthStateChanged,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  Timestamp,
  createUserWithEmailAndPassword,
  sendEmailVerification
} from "./firebaseConfig.js";

let currentUser = null;
let selectedGroupId = null;
let userGroups = [];

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  checkAuth();
  setupEventListeners();
});

// Check Authentication
function checkAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    
    currentUser = user;
    await loadUserGroups();
  });
}

// Setup Event Listeners
function setupEventListeners() {
  const groupSelect = document.getElementById("groupSelect");
  const addMemberBtn = document.getElementById("addMemberBtn");
  const addMemberForm = document.getElementById("addMemberForm");

  if (groupSelect) {
    groupSelect.addEventListener("change", (e) => {
      selectedGroupId = e.target.value;
      if (selectedGroupId) {
        loadMembers();
      }
    });
  }

  if (addMemberBtn) {
    addMemberBtn.addEventListener("click", openModal);
  }

  if (addMemberForm) {
    addMemberForm.addEventListener("submit", handleAddMember);
  }
}

// Load User's Admin Groups
async function loadUserGroups() {
  showLoading(true);
  
  try {
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    if (!userDoc.exists()) {
      showToast("User profile not found");
      return;
    }

    const userData = userDoc.data();
    const groupMemberships = userData.groupMemberships || [];

    // Filter for admin groups
    const adminGroups = groupMemberships.filter(
      (membership) => membership.role === "admin" || membership.role === "senior_admin"
    );

    if (adminGroups.length === 0) {
      showToast("You are not an admin of any groups");
      return;
    }

    // Load group details
    userGroups = [];
    for (const membership of adminGroups) {
      const groupDoc = await getDoc(doc(db, "groups", membership.groupId));
      if (groupDoc.exists()) {
        userGroups.push({
          id: groupDoc.id,
          ...groupDoc.data()
        });
      }
    }

    // Populate group selector
    const groupSelect = document.getElementById("groupSelect");
    groupSelect.innerHTML = '<option value="">Select a group...</option>';
    
    userGroups.forEach((group) => {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.groupName;
      groupSelect.appendChild(option);
    });

    // Auto-select first group if only one
    if (userGroups.length === 1) {
      groupSelect.value = userGroups[0].id;
      selectedGroupId = userGroups[0].id;
      await loadMembers();
    }
  } catch (error) {
    console.error("Error loading groups:", error);
    showToast("Failed to load groups");
  } finally {
    showLoading(false);
  }
}

// Load Members
async function loadMembers() {
  if (!selectedGroupId) return;

  showLoading(true);

  try {
    const membersRef = collection(db, `groups/${selectedGroupId}/members`);
    const membersSnapshot = await getDocs(membersRef);

    const members = [];
    membersSnapshot.forEach((doc) => {
      members.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Update stats
    updateStats(members);

    // Display members
    displayMembers(members);
  } catch (error) {
    console.error("Error loading members:", error);
    showToast("Failed to load members");
  } finally {
    showLoading(false);
  }
}

// Update Stats
function updateStats(members) {
  const totalMembers = members.length;
  const activeMembers = members.filter((m) => m.status === "active").length;
  const adminCount = members.filter(
    (m) => m.role === "admin" || m.role === "senior_admin"
  ).length;
  const pendingMembers = members.filter((m) => m.status === "pending").length;

  document.getElementById("totalMembers").textContent = totalMembers;
  document.getElementById("activeMembers").textContent = activeMembers;
  document.getElementById("adminCount").textContent = adminCount;
  document.getElementById("pendingMembers").textContent = pendingMembers;
}

// Display Members
function displayMembers(members) {
  const membersList = document.getElementById("membersList");

  if (members.length === 0) {
    membersList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">👥</div>
        <h3>No Members Yet</h3>
        <p>Add your first member to get started</p>
      </div>
    `;
    return;
  }

  membersList.innerHTML = members
    .map((member) => createMemberCard(member))
    .join("");

  // Add event listeners to action buttons
  membersList.querySelectorAll(".action-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = e.target.dataset.action;
      const memberId = e.target.dataset.memberId;
      handleMemberAction(action, memberId, members.find((m) => m.id === memberId));
    });
  });
}

// Create Member Card
function createMemberCard(member) {
  const initials = member.fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);

  const roleClass = member.role === "admin" || member.role === "senior_admin" ? "role-admin" : "role-member";
  const roleName = member.role === "senior_admin" ? "Senior Admin" : member.role.charAt(0).toUpperCase() + member.role.slice(1);

  const joinedDate = member.joinedAt
    ? new Date(member.joinedAt.toDate()).toLocaleDateString()
    : "N/A";

  const totalPaid = member.financialSummary?.totalPaid || 0;
  const totalArrears = member.financialSummary?.totalArrears || 0;

  return `
    <div class="member-card">
      <div class="member-header">
        <div class="member-avatar">${initials}</div>
        <div class="member-info">
          <div class="member-name">${member.fullName}</div>
          <div class="member-email">${member.email}</div>
        </div>
        <div class="member-role-badge ${roleClass}">${roleName}</div>
      </div>
      
      <div class="member-details">
        <div class="detail-item">
          <div class="detail-label">Phone</div>
          <div class="detail-value">${member.phone || "N/A"}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Joined</div>
          <div class="detail-value">${joinedDate}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Total Paid</div>
          <div class="detail-value">MWK ${formatCurrency(totalPaid)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Arrears</div>
          <div class="detail-value">MWK ${formatCurrency(totalArrears)}</div>
        </div>
      </div>
      
      <div class="member-actions">
        <button class="action-btn" data-action="view" data-member-id="${member.id}">
          View Details
        </button>
        <button class="action-btn" data-action="edit" data-member-id="${member.id}">
          Edit
        </button>
        <button class="action-btn" data-action="remove" data-member-id="${member.id}">
          Remove
        </button>
      </div>
    </div>
  `;
}

// Handle Member Actions
async function handleMemberAction(action, memberId, member) {
  switch (action) {
    case "view":
      showToast("View member details (coming soon)");
      break;
    case "edit":
      showToast("Edit member (coming soon)");
      break;
    case "remove":
      if (confirm(`Are you sure you want to remove ${member.fullName}?`)) {
        await removeMember(memberId);
      }
      break;
  }
}

// Remove Member
async function removeMember(memberId) {
  if (!selectedGroupId) return;

  showLoading(true);

  try {
    // Remove from group members
    await deleteDoc(doc(db, `groups/${selectedGroupId}/members`, memberId));

    // Update user's global profile
    const userDoc = await getDoc(doc(db, "users", memberId));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      const updatedMemberships = (userData.groupMemberships || []).filter(
        (m) => m.groupId !== selectedGroupId
      );
      await updateDoc(doc(db, "users", memberId), {
        groupMemberships: updatedMemberships
      });
    }

    showToast("Member removed successfully");
    await loadMembers();
  } catch (error) {
    console.error("Error removing member:", error);
    showToast("Failed to remove member");
  } finally {
    showLoading(false);
  }
}

// Handle Add Member
async function handleAddMember(e) {
  e.preventDefault();

  if (!selectedGroupId) {
    showToast("Please select a group first");
    return;
  }

  const formData = {
    fullName: document.getElementById("memberName").value.trim(),
    email: document.getElementById("memberEmail").value.trim(),
    phone: document.getElementById("memberPhone").value.trim(),
    role: document.getElementById("memberRole").value,
    collateral: document.getElementById("memberCollateral").value.trim() || null
  };

  showLoading(true);

  try {
    // Create Firebase auth user
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      formData.email,
      "TempPass123!" // Temporary password - user will reset
    );

    const newUser = userCredential.user;

    // Send verification email
    await sendEmailVerification(newUser);

    // Create user document
    await setDoc(doc(db, "users", newUser.uid), {
      uid: newUser.uid,
      email: formData.email,
      fullName: formData.fullName,
      phone: formData.phone,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      groupMemberships: [
        {
          groupId: selectedGroupId,
          role: formData.role,
          joinedAt: Timestamp.now()
        }
      ]
    });

    // Get group details for seed money and monthly contribution amounts
    const groupDoc = await getDoc(doc(db, "groups", selectedGroupId));
    const groupData = groupDoc.data();
    const seedMoneyAmount = groupData?.rules?.seedMoney?.amount || 0;
    const monthlyContributionAmount = groupData?.rules?.monthlyContribution?.amount || 0;

    // Create member document in group
    await setDoc(doc(db, `groups/${selectedGroupId}/members`, newUser.uid), {
      uid: newUser.uid,
      fullName: formData.fullName,
      email: formData.email,
      phone: formData.phone,
      role: formData.role,
      collateral: formData.collateral,
      joinedAt: Timestamp.now(),
      addedBy: currentUser.uid,
      status: "active",
      financialSummary: {
        totalPaid: 0,
        totalArrears: seedMoneyAmount,
        totalLoans: 0,
        totalLoansPaid: 0
      }
    });

    // Update group statistics
    const membersSnapshot = await getDocs(
      collection(db, `groups/${selectedGroupId}/members`)
    );
    await updateDoc(doc(db, "groups", selectedGroupId), {
      "statistics.totalMembers": membersSnapshot.size,
      "statistics.activeMembers": membersSnapshot.size,
      updatedAt: Timestamp.now()
    });

    // Sign out the newly created user and restore current user session
    await auth.signOut();
    // Note: In production, you should use Firebase Admin SDK via Cloud Functions
    // to create users without affecting the current session

    showToast(
      `Member added successfully! Verification email sent to ${formData.email}. You'll need to log in again.`
    );
    
    closeModal();
    
    // Redirect to login after a delay
    setTimeout(() => {
      window.location.href = "../login.html";
    }, 2000);
  } catch (error) {
    console.error("Error adding member:", error);
    
    let errorMessage = "Failed to add member: ";
    if (error.code === "auth/email-already-in-use") {
      errorMessage += "This email is already registered.";
    } else if (error.code === "auth/invalid-email") {
      errorMessage += "Invalid email address.";
    } else if (error.code === "auth/weak-password") {
      errorMessage += "Password is too weak.";
    } else {
      errorMessage += error.message;
    }
    
    showToast(errorMessage);
  } finally {
    showLoading(false);
  }
}

// Modal Functions
function openModal() {
  document.getElementById("addMemberModal").classList.add("active");
}

function closeModal() {
  document.getElementById("addMemberModal").classList.remove("active");
  document.getElementById("addMemberForm").reset();
}

// Utility Functions
function formatCurrency(amount) {
  return new Intl.NumberFormat("en-MW").format(amount);
}

function showLoading(show) {
  const overlay = document.getElementById("loadingOverlay");
  if (show) {
    overlay.classList.add("active");
  } else {
    overlay.classList.remove("active");
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// Make closeModal available globally
window.closeModal = closeModal;
