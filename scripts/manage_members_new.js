import {
  db,
  auth,
  storage,
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
  sendEmailVerification,
  ref,
  uploadBytes,
  getDownloadURL,
  writeBatch,
} from "./firebaseConfig.js";

import { updatePaymentsForNewMember, validatePaymentAmount } from "./updatePayments.js";

// Global state
let currentUser = null;
let selectedGroupId = null;
let userGroups = [];
let allMembers = [];
let currentFilter = "all";

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
  // Group selector
  const groupSelect = document.getElementById("groupSelect");
  if (groupSelect) {
    groupSelect.addEventListener("change", (e) => {
      selectedGroupId = e.target.value;
      if (selectedGroupId) {
        sessionStorage.setItem("selectedGroupId", selectedGroupId);
        loadMembers();
      }
    });
  }

  // Add member button
  const addMemberBtn = document.getElementById("addMemberBtn");
  if (addMemberBtn) {
    addMemberBtn.addEventListener("click", openAddMemberModal);
  }

  // Add member form
  const addMemberForm = document.getElementById("addMemberForm");
  if (addMemberForm) {
    addMemberForm.addEventListener("submit", handleAddMember);
  }

  // Edit member form
  const editMemberForm = document.getElementById("editMemberForm");
  if (editMemberForm) {
    editMemberForm.addEventListener("submit", handleEditMember);
  }

  // Close modal buttons
  document.getElementById("closeAddMemberModal")?.addEventListener("click", closeAddMemberModal);
  document.getElementById("cancelAddMember")?.addEventListener("click", closeAddMemberModal);
  document.getElementById("closeEditMemberModal")?.addEventListener("click", closeEditMemberModal);
  document.getElementById("cancelEditMember")?.addEventListener("click", closeEditMemberModal);
  document.getElementById("closeDeleteMemberModal")?.addEventListener("click", closeDeleteMemberModal);
  document.getElementById("cancelDeleteMember")?.addEventListener("click", closeDeleteMemberModal);
  document.getElementById("confirmDeleteMember")?.addEventListener("click", confirmDeleteMember);

  // Close modals on overlay click
  document.getElementById("addMemberModal")?.addEventListener("click", (e) => {
    if (e.target.id === "addMemberModal") closeAddMemberModal();
  });
  document.getElementById("editMemberModal")?.addEventListener("click", (e) => {
    if (e.target.id === "editMemberModal") closeEditMemberModal();
  });
  document.getElementById("deleteMemberModal")?.addEventListener("click", (e) => {
    if (e.target.id === "deleteMemberModal") closeDeleteMemberModal();
  });

  // Filter tabs
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      filterMembers();
    });
  });

  // Search
  const searchInput = document.getElementById("searchMembers");
  if (searchInput) {
    searchInput.addEventListener("input", filterMembers);
  }

  // Profile picture preview for add member
  const memberProfilePicture = document.getElementById("memberProfilePicture");
  if (memberProfilePicture) {
    memberProfilePicture.addEventListener("change", (e) => {
      previewProfilePicture(e, "memberProfilePreview");
    });
  }

  // Profile picture preview for edit member
  const editMemberProfilePicture = document.getElementById("editMemberProfilePicture");
  if (editMemberProfilePicture) {
    editMemberProfilePicture.addEventListener("change", (e) => {
      previewProfilePicture(e, "editMemberProfilePreview");
    });
  }
}

// Preview profile picture
function previewProfilePicture(event, previewElementId) {
  const file = event.target.files[0];
  const previewEl = document.getElementById(previewElementId);
  
  if (file && previewEl) {
    const reader = new FileReader();
    reader.onload = (e) => {
      previewEl.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
    };
    reader.readAsDataURL(file);
  }
}

// Modal functions
function openAddMemberModal() {
  const modal = document.getElementById("addMemberModal");
  if (modal) {
    modal.classList.add("active");
    document.getElementById("addMemberForm")?.reset();
    document.getElementById("memberProfilePreview").innerHTML = "👤";
  }
}

function closeAddMemberModal() {
  const modal = document.getElementById("addMemberModal");
  if (modal) modal.classList.remove("active");
}

function openEditMemberModal(member) {
  const modal = document.getElementById("editMemberModal");
  if (!modal) return;

  document.getElementById("editMemberId").value = member.id;
  
  // Set profile preview
  const previewEl = document.getElementById("editMemberProfilePreview");
  if (member.profileImageUrl) {
    previewEl.innerHTML = `<img src="${member.profileImageUrl}" alt="${member.fullName}">`;
  } else {
    const initials = member.fullName.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
    previewEl.innerHTML = initials;
  }

  // Populate edit form fields
  const formFields = document.getElementById("editFormFields");
  formFields.innerHTML = `
    <div class="form-section">
      <h4 class="form-section-title">Personal Information</h4>
      <div class="form-group">
        <label class="form-label">Full Name *</label>
        <input type="text" class="form-input" id="editMemberName" value="${member.fullName || ""}" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Phone Number *</label>
          <input type="tel" class="form-input" id="editMemberPhone" value="${member.phone || ""}" required>
        </div>
        <div class="form-group">
          <label class="form-label">WhatsApp</label>
          <input type="tel" class="form-input" id="editMemberWhatsApp" value="${member.whatsappNumber || ""}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Date of Birth</label>
          <input type="date" class="form-input" id="editMemberDOB" value="${member.dateOfBirth || ""}">
        </div>
        <div class="form-group">
          <label class="form-label">Gender</label>
          <select class="form-select" id="editMemberGender">
            <option value="">Select...</option>
            <option value="male" ${member.gender === "male" ? "selected" : ""}>Male</option>
            <option value="female" ${member.gender === "female" ? "selected" : ""}>Female</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Address</label>
        <textarea class="form-textarea" id="editMemberAddress" rows="2">${member.address || ""}</textarea>
      </div>
    </div>

    <div class="form-section">
      <h4 class="form-section-title">Professional Information</h4>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Career/Profession</label>
          <input type="text" class="form-input" id="editMemberCareer" value="${member.career || ""}">
        </div>
        <div class="form-group">
          <label class="form-label">Job Title</label>
          <input type="text" class="form-input" id="editMemberJobTitle" value="${member.jobTitle || ""}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Workplace</label>
          <input type="text" class="form-input" id="editMemberWorkplace" value="${member.workplace || ""}">
        </div>
        <div class="form-group">
          <label class="form-label">Work Address</label>
          <input type="text" class="form-input" id="editMemberWorkAddress" value="${member.workAddress || ""}">
        </div>
      </div>
    </div>

    <div class="form-section">
      <h4 class="form-section-title">Guarantor Information</h4>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Guarantor Name</label>
          <input type="text" class="form-input" id="editMemberGuarantorName" value="${member.guarantorName || ""}">
        </div>
        <div class="form-group">
          <label class="form-label">Guarantor Phone</label>
          <input type="tel" class="form-input" id="editMemberGuarantorPhone" value="${member.guarantorPhone || ""}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Relationship</label>
          <select class="form-select" id="editMemberGuarantorRelationship">
            <option value="">Select...</option>
            <option value="spouse" ${member.guarantorRelationship === "spouse" ? "selected" : ""}>Spouse</option>
            <option value="parent" ${member.guarantorRelationship === "parent" ? "selected" : ""}>Parent</option>
            <option value="sibling" ${member.guarantorRelationship === "sibling" ? "selected" : ""}>Sibling</option>
            <option value="relative" ${member.guarantorRelationship === "relative" ? "selected" : ""}>Relative</option>
            <option value="friend" ${member.guarantorRelationship === "friend" ? "selected" : ""}>Friend</option>
            <option value="colleague" ${member.guarantorRelationship === "colleague" ? "selected" : ""}>Colleague</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Guarantor Address</label>
          <input type="text" class="form-input" id="editMemberGuarantorAddress" value="${member.guarantorAddress || ""}">
        </div>
      </div>
    </div>

    <div class="form-section">
      <h4 class="form-section-title">Account & Security</h4>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Role</label>
          <select class="form-select" id="editMemberRole">
            <option value="member" ${member.role === "member" ? "selected" : ""}>Member</option>
            <option value="admin" ${member.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-select" id="editMemberStatus">
            <option value="active" ${member.status === "active" ? "selected" : ""}>Active</option>
            <option value="pending" ${member.status === "pending" ? "selected" : ""}>Pending</option>
            <option value="inactive" ${member.status === "inactive" ? "selected" : ""}>Inactive</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">ID Type</label>
          <select class="form-select" id="editMemberIdType">
            <option value="">Select...</option>
            <option value="national_id" ${member.idType === "national_id" ? "selected" : ""}>National ID</option>
            <option value="passport" ${member.idType === "passport" ? "selected" : ""}>Passport</option>
            <option value="drivers_license" ${member.idType === "drivers_license" ? "selected" : ""}>Driver's License</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">ID Number</label>
          <input type="text" class="form-input" id="editMemberIdNumber" value="${member.idNumber || ""}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Collateral Description</label>
        <textarea class="form-textarea" id="editMemberCollateral" rows="2">${member.collateral || ""}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-textarea" id="editMemberNotes" rows="2">${member.notes || ""}</textarea>
      </div>
    </div>
  `;

  modal.classList.add("active");
}

function closeEditMemberModal() {
  const modal = document.getElementById("editMemberModal");
  if (modal) modal.classList.remove("active");
}

function openDeleteMemberModal(member) {
  const modal = document.getElementById("deleteMemberModal");
  if (!modal) return;

  document.getElementById("deleteMemberName").textContent = member.fullName;
  document.getElementById("deleteMemberId").value = member.id;
  modal.classList.add("active");
}

function closeDeleteMemberModal() {
  const modal = document.getElementById("deleteMemberModal");
  if (modal) modal.classList.remove("active");
}

// Load User's Admin Groups
async function loadUserGroups() {
  showLoading(true);

  try {
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    if (!userDoc.exists()) {
      showToast("User profile not found", "error");
      return;
    }

    const userData = userDoc.data();
    const groupsRef = collection(db, "groups");
    const groupsSnapshot = await getDocs(groupsRef);

    userGroups = [];
    groupsSnapshot.forEach((groupDoc) => {
      const groupData = groupDoc.data();
      const groupId = groupDoc.id;

      const isCreator = groupData.createdBy === currentUser.uid;
      const isAdmin = groupData.admins?.some((admin) => admin.uid === currentUser.uid || admin.email === currentUser.email);
      const groupMemberships = userData.groupMemberships || [];
      const isMemberAdmin = groupMemberships.some((m) => m.groupId === groupId && (m.role === "admin" || m.role === "senior_admin"));

      if (isCreator || isAdmin || isMemberAdmin) {
        userGroups.push({
          id: groupId,
          ...groupData,
        });
      }
    });

    if (userGroups.length === 0) {
      showToast("You are not an admin of any groups", "warning");
      return;
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

    // Auto-select from session or first group
    const sessionGroupId = sessionStorage.getItem("selectedGroupId");
    if (sessionGroupId && userGroups.find((g) => g.id === sessionGroupId)) {
      groupSelect.value = sessionGroupId;
      selectedGroupId = sessionGroupId;
      await loadMembers();
    } else if (userGroups.length > 0) {
      groupSelect.value = userGroups[0].id;
      selectedGroupId = userGroups[0].id;
      sessionStorage.setItem("selectedGroupId", selectedGroupId);
      await loadMembers();
    }
  } catch (error) {
    console.error("Error loading groups:", error);
    showToast("Failed to load groups", "error");
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

    allMembers = [];
    membersSnapshot.forEach((doc) => {
      allMembers.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    updateStats(allMembers);
    filterMembers();
  } catch (error) {
    console.error("Error loading members:", error);
    showToast("Failed to load members", "error");
  } finally {
    showLoading(false);
  }
}

// Filter Members
function filterMembers() {
  const searchInput = document.getElementById("searchMembers");
  const searchTerm = searchInput?.value.toLowerCase() || "";

  let filteredMembers = allMembers;

  // Apply role filter
  if (currentFilter === "admin") {
    filteredMembers = filteredMembers.filter((m) => m.role === "admin" || m.role === "senior_admin");
  } else if (currentFilter === "member") {
    filteredMembers = filteredMembers.filter((m) => m.role === "member" || m.role === "user");
  }

  // Apply search filter
  if (searchTerm) {
    filteredMembers = filteredMembers.filter(
      (m) =>
        m.fullName?.toLowerCase().includes(searchTerm) ||
        m.email?.toLowerCase().includes(searchTerm) ||
        m.phone?.toLowerCase().includes(searchTerm)
    );
  }

  displayMembers(filteredMembers);
}

// Update Stats
function updateStats(members) {
  const totalMembers = members.length;
  const activeMembers = members.filter((m) => m.status === "active").length;
  const adminCount = members.filter((m) => m.role === "admin" || m.role === "senior_admin").length;
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
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">👥</div>
        <h3>No Members Found</h3>
        <p class="empty-state-text">Add your first member to get started</p>
      </div>
    `;
    return;
  }

  membersList.innerHTML = members.map((member) => createMemberCard(member)).join("");

  // Add event listeners to action buttons
  membersList.querySelectorAll(".btn[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = e.target.closest("button").dataset.action;
      const memberId = e.target.closest("button").dataset.memberId;
      const member = allMembers.find((m) => m.id === memberId);
      handleMemberAction(action, memberId, member);
    });
  });
}

// Create Member Card
function createMemberCard(member) {
  const initials = member.fullName
    ? member.fullName.split(" ").map((n) => n[0]).join("").toUpperCase().substring(0, 2)
    : "??";

  const roleClass = member.role === "admin" || member.role === "senior_admin" ? "admin" : "member";
  const roleName = member.role === "senior_admin" ? "Senior Admin" : member.role === "admin" ? "Admin" : "Member";

  const joinedDate = member.joinedAt
    ? new Date(member.joinedAt.toDate ? member.joinedAt.toDate() : member.joinedAt).toLocaleDateString()
    : "N/A";

  const totalPaid = member.financialSummary?.totalPaid || 0;
  const totalArrears = member.financialSummary?.totalArrears || 0;

  const profilePicture = member.profileImageUrl
    ? `<img src="${member.profileImageUrl}" alt="${member.fullName}">`
    : initials;

  return `
    <div class="member-card">
      <div class="member-card-header">
        <div class="member-avatar">${profilePicture}</div>
        <div class="member-info">
          <div class="member-name">${member.fullName || "Unknown"}</div>
          <span class="member-role ${roleClass}">${roleName}</span>
        </div>
      </div>
      
      <div class="member-card-body">
        <div class="member-details-grid">
          <div class="member-detail">
            <div class="member-detail-label">Phone</div>
            <div class="member-detail-value">${member.phone || "N/A"}</div>
          </div>
          <div class="member-detail">
            <div class="member-detail-label">Email</div>
            <div class="member-detail-value" style="font-size: 11px;">${member.email || "N/A"}</div>
          </div>
          <div class="member-detail">
            <div class="member-detail-label">Joined</div>
            <div class="member-detail-value">${joinedDate}</div>
          </div>
          <div class="member-detail">
            <div class="member-detail-label">Career</div>
            <div class="member-detail-value">${member.career || "N/A"}</div>
          </div>
        </div>

        <div class="member-financial">
          <div class="financial-item">
            <div class="financial-value" style="color: var(--bn-success);">MWK ${formatNumber(totalPaid)}</div>
            <div class="financial-label">Total Paid</div>
          </div>
          <div class="financial-item">
            <div class="financial-value" style="color: var(--bn-danger);">MWK ${formatNumber(totalArrears)}</div>
            <div class="financial-label">Arrears</div>
          </div>
        </div>

        <div class="member-actions">
          <button class="btn btn-ghost btn-sm" data-action="edit" data-member-id="${member.id}">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color: var(--bn-danger);" data-action="remove" data-member-id="${member.id}">Remove</button>
        </div>
      </div>
    </div>
  `;
}

// Handle Member Actions
async function handleMemberAction(action, memberId, member) {
  switch (action) {
    case "edit":
      openEditMemberModal(member);
      break;
    case "remove":
      openDeleteMemberModal(member);
      break;
  }
}

// Confirm Delete Member
async function confirmDeleteMember() {
  const memberId = document.getElementById("deleteMemberId").value;
  if (!memberId || !selectedGroupId) return;

  showLoading(true);
  closeDeleteMemberModal();

  try {
    // Remove from group members
    await deleteDoc(doc(db, `groups/${selectedGroupId}/members`, memberId));

    // Update user's global profile
    const userDoc = await getDoc(doc(db, "users", memberId));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      const updatedMemberships = (userData.groupMemberships || []).filter((m) => m.groupId !== selectedGroupId);
      await updateDoc(doc(db, "users", memberId), {
        groupMemberships: updatedMemberships,
      });
    }

    showToast("Member removed successfully", "success");
    await loadMembers();
  } catch (error) {
    console.error("Error removing member:", error);
    showToast("Failed to remove member", "error");
  } finally {
    showLoading(false);
  }
}

// Handle Edit Member
async function handleEditMember(e) {
  e.preventDefault();

  const memberId = document.getElementById("editMemberId").value;
  if (!memberId || !selectedGroupId) return;

  showLoading(true);

  try {
    // Collect form data
    const formData = {
      fullName: document.getElementById("editMemberName")?.value.trim(),
      phone: document.getElementById("editMemberPhone")?.value.trim(),
      whatsappNumber: document.getElementById("editMemberWhatsApp")?.value.trim(),
      dateOfBirth: document.getElementById("editMemberDOB")?.value,
      gender: document.getElementById("editMemberGender")?.value,
      address: document.getElementById("editMemberAddress")?.value.trim(),
      career: document.getElementById("editMemberCareer")?.value.trim(),
      jobTitle: document.getElementById("editMemberJobTitle")?.value.trim(),
      workplace: document.getElementById("editMemberWorkplace")?.value.trim(),
      workAddress: document.getElementById("editMemberWorkAddress")?.value.trim(),
      guarantorName: document.getElementById("editMemberGuarantorName")?.value.trim(),
      guarantorPhone: document.getElementById("editMemberGuarantorPhone")?.value.trim(),
      guarantorRelationship: document.getElementById("editMemberGuarantorRelationship")?.value,
      guarantorAddress: document.getElementById("editMemberGuarantorAddress")?.value.trim(),
      role: document.getElementById("editMemberRole")?.value,
      status: document.getElementById("editMemberStatus")?.value,
      idType: document.getElementById("editMemberIdType")?.value,
      idNumber: document.getElementById("editMemberIdNumber")?.value.trim(),
      collateral: document.getElementById("editMemberCollateral")?.value.trim(),
      notes: document.getElementById("editMemberNotes")?.value.trim(),
      updatedAt: Timestamp.now(),
    };

    // Validate required fields
    if (!formData.fullName || !formData.phone) {
      showToast("Full name and phone are required", "error");
      showLoading(false);
      return;
    }

    // Handle profile picture upload
    const profilePictureInput = document.getElementById("editMemberProfilePicture");
    if (profilePictureInput?.files[0]) {
      const file = profilePictureInput.files[0];
      const storageRef = ref(storage, `profiles/${memberId}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      formData.profileImageUrl = await getDownloadURL(storageRef);
    }

    // Update member in group
    await updateDoc(doc(db, `groups/${selectedGroupId}/members`, memberId), formData);

    // Update user's global profile (sync key fields)
    await updateDoc(doc(db, "users", memberId), {
      fullName: formData.fullName,
      phone: formData.phone,
      updatedAt: Timestamp.now(),
      ...(formData.profileImageUrl && { profileImageUrl: formData.profileImageUrl }),
    });

    closeEditMemberModal();
    showToast("Member updated successfully", "success");
    await loadMembers();
  } catch (error) {
    console.error("Error updating member:", error);
    showToast("Failed to update member: " + error.message, "error");
  } finally {
    showLoading(false);
  }
}

// Handle Add Member
async function handleAddMember(e) {
  e.preventDefault();

  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }

  showLoading(true);

  try {
    // Collect form data
    const formData = {
      fullName: document.getElementById("memberName")?.value.trim(),
      phone: document.getElementById("memberPhone")?.value.trim(),
      whatsappNumber: document.getElementById("memberWhatsApp")?.value.trim() || document.getElementById("memberPhone")?.value.trim(),
      dateOfBirth: document.getElementById("memberDOB")?.value,
      gender: document.getElementById("memberGender")?.value,
      address: document.getElementById("memberAddress")?.value.trim(),
      career: document.getElementById("memberCareer")?.value.trim(),
      jobTitle: document.getElementById("memberJobTitle")?.value.trim(),
      workplace: document.getElementById("memberWorkplace")?.value.trim(),
      workAddress: document.getElementById("memberWorkAddress")?.value.trim(),
      guarantorName: document.getElementById("memberGuarantorName")?.value.trim(),
      guarantorPhone: document.getElementById("memberGuarantorPhone")?.value.trim(),
      guarantorRelationship: document.getElementById("memberGuarantorRelationship")?.value,
      guarantorAddress: document.getElementById("memberGuarantorAddress")?.value.trim(),
      email: document.getElementById("memberEmail")?.value.trim(),
      role: document.getElementById("memberRole")?.value || "member",
      status: document.getElementById("memberStatus")?.value || "active",
      idType: document.getElementById("memberIdType")?.value,
      idNumber: document.getElementById("memberIdNumber")?.value.trim(),
      emergencyContact: document.getElementById("memberEmergencyContact")?.value.trim(),
      emergencyContactPhone: document.getElementById("memberEmergencyPhone")?.value.trim(),
      collateral: document.getElementById("memberCollateral")?.value.trim(),
      notes: document.getElementById("memberNotes")?.value.trim(),
    };

    // Validate required fields
    if (!formData.fullName) {
      showToast("Full name is required", "error");
      showLoading(false);
      return;
    }
    if (!formData.email) {
      showToast("Email is required", "error");
      showLoading(false);
      return;
    }
    if (!formData.phone) {
      showToast("Phone number is required", "error");
      showLoading(false);
      return;
    }
    if (!formData.address) {
      showToast("Address is required", "error");
      showLoading(false);
      return;
    }
    if (!formData.career) {
      showToast("Career/Profession is required", "error");
      showLoading(false);
      return;
    }
    if (!formData.guarantorName || !formData.guarantorPhone || !formData.guarantorRelationship) {
      showToast("Guarantor information is required", "error");
      showLoading(false);
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      showToast("Please enter a valid email address", "error");
      showLoading(false);
      return;
    }

    // Validate phone format (basic)
    if (formData.phone.length < 9) {
      showToast("Please enter a valid phone number", "error");
      showLoading(false);
      return;
    }

    // Upload profile picture if provided
    let profileImageUrl = "";
    const profilePictureInput = document.getElementById("memberProfilePicture");
    if (profilePictureInput?.files[0]) {
      const file = profilePictureInput.files[0];
      const storageRef = ref(storage, `profiles/temp_${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      profileImageUrl = await getDownloadURL(storageRef);
    }

    // Create Firebase Auth user with default password
    const defaultPassword = "BankNkhonde@2024";
    const userCredential = await createUserWithEmailAndPassword(auth, formData.email, defaultPassword);
    const newUser = userCredential.user;

    // Send email verification
    await sendEmailVerification(newUser);

    // Get group details for payment initialization
    const groupDoc = await getDoc(doc(db, "groups", selectedGroupId));
    const groupData = groupDoc.data();
    const seedMoneyAmount = groupData?.rules?.seedMoney?.amount || 0;
    const monthlyContributionAmount = groupData?.rules?.monthlyContribution?.amount || 0;
    const loanPenalty = groupData?.rules?.loanPenalty?.rate || 0;
    const monthlyPenalty = groupData?.rules?.monthlyPenalty?.rate || 0;

    // Create user document
    await setDoc(doc(db, "users", newUser.uid), {
      uid: newUser.uid,
      fullName: formData.fullName,
      email: formData.email,
      phone: formData.phone,
      whatsappNumber: formData.whatsappNumber,
      address: formData.address,
      dateOfBirth: formData.dateOfBirth,
      gender: formData.gender,
      career: formData.career,
      jobTitle: formData.jobTitle,
      workplace: formData.workplace,
      workAddress: formData.workAddress,
      guarantorName: formData.guarantorName,
      guarantorPhone: formData.guarantorPhone,
      guarantorRelationship: formData.guarantorRelationship,
      guarantorAddress: formData.guarantorAddress,
      idType: formData.idType,
      idNumber: formData.idNumber,
      emergencyContact: formData.emergencyContact,
      emergencyContactPhone: formData.emergencyContactPhone,
      profileImageUrl: profileImageUrl,
      profileCompleted: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      roles: [formData.role === "admin" ? "admin" : "user"],
      groupMemberships: [
        {
          groupId: selectedGroupId,
          role: formData.role,
          joinedAt: Timestamp.now(),
        },
      ],
    });

    // Create member document in group
    await setDoc(doc(db, `groups/${selectedGroupId}/members`, newUser.uid), {
      uid: newUser.uid,
      fullName: formData.fullName,
      email: formData.email,
      phone: formData.phone,
      whatsappNumber: formData.whatsappNumber,
      address: formData.address,
      dateOfBirth: formData.dateOfBirth,
      gender: formData.gender,
      career: formData.career,
      jobTitle: formData.jobTitle,
      workplace: formData.workplace,
      workAddress: formData.workAddress,
      guarantorName: formData.guarantorName,
      guarantorPhone: formData.guarantorPhone,
      guarantorRelationship: formData.guarantorRelationship,
      guarantorAddress: formData.guarantorAddress,
      idType: formData.idType,
      idNumber: formData.idNumber,
      emergencyContact: formData.emergencyContact,
      emergencyContactPhone: formData.emergencyContactPhone,
      profileImageUrl: profileImageUrl,
      role: formData.role,
      collateral: formData.collateral,
      notes: formData.notes,
      status: formData.status,
      joinedAt: Timestamp.now(),
      addedBy: currentUser.uid,
      profileCompleted: false,
      financialSummary: {
        totalPaid: 0,
        totalArrears: seedMoneyAmount,
        totalPending: seedMoneyAmount,
        totalLoans: 0,
        totalLoansPaid: 0,
        totalPenalties: 0,
        lastUpdated: Timestamp.now(),
      },
    });

    // Initialize payment records
    await updatePaymentsForNewMember(
      selectedGroupId,
      newUser.uid,
      formData.fullName,
      seedMoneyAmount,
      monthlyContributionAmount,
      loanPenalty,
      monthlyPenalty
    );

    // Update group statistics
    const currentStats = groupData.statistics || {};
    await updateDoc(doc(db, "groups", selectedGroupId), {
      "statistics.totalMembers": (currentStats.totalMembers || 0) + 1,
      "statistics.activeMembers": (currentStats.activeMembers || 0) + 1,
      "statistics.lastUpdated": Timestamp.now(),
      "activityLog.lastMemberAdded": Timestamp.now(),
    });

    closeAddMemberModal();
    showToast(`Member ${formData.fullName} added successfully! Default password: ${defaultPassword}`, "success");
    await loadMembers();
  } catch (error) {
    console.error("Error adding member:", error);
    
    let errorMessage = "Failed to add member";
    if (error.code === "auth/email-already-in-use") {
      errorMessage = "This email is already registered. Please use a different email.";
    } else if (error.code === "auth/invalid-email") {
      errorMessage = "Invalid email address format.";
    } else if (error.code === "auth/weak-password") {
      errorMessage = "Password is too weak.";
    } else {
      errorMessage = error.message || errorMessage;
    }
    
    showToast(errorMessage, "error");
  } finally {
    showLoading(false);
  }
}

// Utility Functions
function formatNumber(num) {
  return (parseFloat(num) || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatCurrency(amount) {
  return `MWK ${formatNumber(amount)}`;
}

function showLoading(show) {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) {
    if (show) {
      overlay.classList.remove("hidden");
    } else {
      overlay.classList.add("hidden");
    }
  }
}

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

  // Auto remove after 5 seconds
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
