/**
 * manage_members_new_sql.js — SQL port of manage_members_new.js (the LIVE
 * members-management page; the non-_new twin is dead — see BUILD_PLAN Phase 2).
 *
 * Ported to the PHP + MySQL API. Zero Firebase imports. Not wired into a page
 * until the atomic M4 cutover.
 *
 * What maps cleanly to existing endpoints:
 *   - roster + stats + filter/search   -> members.list (GET)
 *   - change a member's ROLE           -> members.role   (senior_admin only)
 *   - change a member's STATUS         -> members.status (admin+)
 *   - the admin group selector         -> groups.mine (filtered to admin roles)
 *
 * What does NOT yet have a SQL endpoint (named, not invented — deferred to a
 * backend cycle, each shows a toast rather than crashing):
 *   1. ADD MEMBER that creates a brand-new user account + profile + seed-money /
 *      contribution payment records + group stats. The Firebase flow spun up a
 *      secondary auth app and called updatePaymentsForNewMember(); the SQL
 *      members.add only attaches an ALREADY-registered user by email and does no
 *      payment init. A real "admin creates a member" needs members.create.
 *   2. FULL PROFILE EDIT: guarantor, ID, next-of-kin, collateral (B20) are now
 *      editable via the collapsed "KYC details" disclosure in the edit modal —
 *      all optional/skippable, sent through members.update. Career, emergency
 *      contact, notes, DOB, address, profile image are still deferred; a real
 *      profile endpoint is needed for those.
 *   3. HARD REMOVE from the group. members.status can set 'inactive'/'suspended'
 *      (offered via Edit), but a true delete needs members.remove.
 *
 * Security: no user-authored or server-sourced string is ever written through
 * innerHTML — every value goes in via textContent / createElement. The role and
 * status writes are re-authorised server-side (require_role); the client gating
 * here is UX only.
 */

import {
  apiGet,
  apiPost,
  logout,
  requireSession,
  listMyGroups,
  ApiError,
  redirectToLogin,
} from "./api.js";

// ── Global state ────────────────────────────────────────────────────────────
let currentUser = null;
let selectedGroupId = null;
let adminGroups = []; // groups where the caller is admin/senior_admin/treasurer
let allMembers = [];
let currentFilter = "all";

/** The caller's role in the currently selected group (drives which writes to offer). */
function selectedGroupRole() {
  const g = adminGroups.find((x) => x.groupId === selectedGroupId || x.id === selectedGroupId);
  return g ? (g.myRole || "member") : "member";
}

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  try {
    currentUser = await requireSession(); // redirects to login on 401
  } catch (error) {
    handleApiError(error, "Could not verify your session.");
    return;
  }
  await loadAdminGroups();
});

// ── Event listeners ─────────────────────────────────────────────────────────
function setupEventListeners() {
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

  document.getElementById("addMemberBtn")?.addEventListener("click", openAddMemberModal);
  document.getElementById("addMemberForm")?.addEventListener("submit", handleAddMember);
  document.getElementById("editMemberForm")?.addEventListener("submit", handleEditMember);

  document.getElementById("closeAddMemberModal")?.addEventListener("click", closeAddMemberModal);
  document.getElementById("cancelAddMember")?.addEventListener("click", closeAddMemberModal);
  document.getElementById("closeEditMemberModal")?.addEventListener("click", closeEditMemberModal);
  document.getElementById("cancelEditMember")?.addEventListener("click", closeEditMemberModal);
  document.getElementById("closeDeleteMemberModal")?.addEventListener("click", closeDeleteMemberModal);
  document.getElementById("cancelDeleteMember")?.addEventListener("click", closeDeleteMemberModal);
  document.getElementById("confirmDeleteMember")?.addEventListener("click", confirmDeleteMember);

  document.getElementById("addMemberModal")?.addEventListener("click", (e) => {
    if (e.target.id === "addMemberModal") closeAddMemberModal();
  });
  document.getElementById("editMemberModal")?.addEventListener("click", (e) => {
    if (e.target.id === "editMemberModal") closeEditMemberModal();
  });
  document.getElementById("deleteMemberModal")?.addEventListener("click", (e) => {
    if (e.target.id === "deleteMemberModal") closeDeleteMemberModal();
  });

  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      filterMembers();
    });
  });

  document.getElementById("searchMembers")?.addEventListener("input", filterMembers);
}

// ── Load the caller's admin groups ──────────────────────────────────────────
async function loadAdminGroups() {
  showLoading(true);
  try {
    const groups = await listMyGroups();
    // This page manages members, so only groups where the caller can manage them.
    adminGroups = groups.filter((g) =>
      ["admin", "senior_admin", "treasurer"].includes(g.myRole));

    if (adminGroups.length === 0) {
      showToast("You are not an admin of any groups", "warning");
      renderGroupOptions();
      return;
    }

    renderGroupOptions();

    const sessionGroupId = sessionStorage.getItem("selectedGroupId");
    const match = adminGroups.find((g) => (g.groupId || g.id) === sessionGroupId);
    const chosen = match || adminGroups[0];
    selectedGroupId = chosen.groupId || chosen.id;
    sessionStorage.setItem("selectedGroupId", selectedGroupId);

    const groupSelect = document.getElementById("groupSelect");
    if (groupSelect) groupSelect.value = selectedGroupId;

    await loadMembers();
  } catch (error) {
    handleApiError(error, "Failed to load groups");
  } finally {
    showLoading(false);
  }
}

function renderGroupOptions() {
  const groupSelect = document.getElementById("groupSelect");
  if (!groupSelect) return;
  groupSelect.textContent = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a group...";
  groupSelect.appendChild(placeholder);

  adminGroups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.groupId || group.id;
    option.textContent = group.groupName || group.name || "Unnamed group";
    groupSelect.appendChild(option);
  });
}

// ── Load members ────────────────────────────────────────────────────────────
async function loadMembers() {
  if (!selectedGroupId) return;
  showLoading(true);
  try {
    const data = await apiGet("members.list", {groupId: selectedGroupId});
    allMembers = Array.isArray(data && data.members) ? data.members : [];
    updateStats(allMembers);
    filterMembers();
  } catch (error) {
    handleApiError(error, "Failed to load members");
  } finally {
    showLoading(false);
  }
}

// ── Filter + search ─────────────────────────────────────────────────────────
function filterMembers() {
  const searchTerm = (document.getElementById("searchMembers")?.value || "").toLowerCase();
  let filtered = allMembers;

  if (currentFilter === "admin") {
    filtered = filtered.filter((m) => m.role === "admin" || m.role === "senior_admin" || m.role === "treasurer");
  } else if (currentFilter === "member") {
    filtered = filtered.filter((m) => m.status !== "suspended");
  }

  if (searchTerm) {
    filtered = filtered.filter((m) =>
      (m.fullName || "").toLowerCase().includes(searchTerm) ||
      (m.email || "").toLowerCase().includes(searchTerm) ||
      (m.phone || "").toLowerCase().includes(searchTerm));
  }

  displayMembers(filtered);
}

// ── Stats ───────────────────────────────────────────────────────────────────
function updateStats(members) {
  const total = members.length;
  const active = members.filter((m) => m.status === "active").length;
  const admins = members.filter((m) => m.role === "admin" || m.role === "senior_admin" || m.role === "treasurer").length;
  const pending = members.filter((m) => m.status === "pending").length;

  setText("totalMembers", total);
  setText("activeMembers", active);
  setText("adminCount", admins);
  setText("pendingMembers", pending);
}

// ── Render roster ───────────────────────────────────────────────────────────
function displayMembers(members) {
  const list = document.getElementById("membersList");
  if (!list) return;
  list.textContent = "";

  if (members.length === 0) {
    let title = "No Members Found";
    let text = "Add your first member to get started";
    if (allMembers.length > 0 && currentFilter === "member") {
      title = "No Regular Members";
      text = "All current members have admin roles. Switch to 'All' or 'Admins' tab to see them.";
    } else if (allMembers.length > 0 && currentFilter === "admin") {
      title = "No Admin Members";
      text = "No members with admin role found. Switch to 'All' tab to see all members.";
    } else if (!selectedGroupId) {
      title = "Select a Group";
      text = "Choose a group from the dropdown above to view its members.";
    }

    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.gridColumn = "1 / -1";

    const icon = document.createElement("div");
    icon.className = "empty-state-icon";
    icon.textContent = "👥";
    const h3 = document.createElement("h3");
    h3.textContent = title;
    const p = document.createElement("p");
    p.className = "empty-state-text";
    p.textContent = text;

    empty.append(icon, h3, p);
    list.appendChild(empty);
    return;
  }

  members.forEach((member) => list.appendChild(createMemberCard(member)));
}

function createMemberCard(member) {
  const initials = member.fullName
    ? member.fullName.split(" ").map((n) => n[0]).join("").toUpperCase().substring(0, 2)
    : "??";

  const roleClass = (member.role === "member") ? "member" : "admin";
  const roleName = member.role === "senior_admin" ? "Senior Admin"
    : member.role === "treasurer" ? "Treasurer"
      : member.role === "admin" ? "Admin" : "Member";

  const joinedDate = member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : "N/A";
  const isCurrentUser = member.uid === currentUser?.uid;

  const card = el("div", "member-card");

  // Header
  const header = el("div", "member-card-header");
  const avatar = el("div", "member-avatar");
  if (member.profileImageUrl) {
    const img = document.createElement("img");
    img.src = member.profileImageUrl;
    img.alt = member.fullName || "Member";
    avatar.appendChild(img);
  } else {
    avatar.textContent = initials;
  }
  const info = el("div", "member-info");
  const nameEl = el("div", "member-name");
  nameEl.textContent = member.fullName || "Unknown";
  if (isCurrentUser) {
    const you = document.createElement("span");
    you.textContent = "YOU";
    you.style.cssText = "background: var(--bn-accent); color: var(--bn-dark); padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 700; margin-left: 8px;";
    nameEl.appendChild(you);
  }
  const roleBadge = el("span", `member-role ${roleClass}`);
  roleBadge.textContent = roleName;
  info.append(nameEl, roleBadge);
  header.append(avatar, info);

  // Body
  const body = el("div", "member-card-body");
  const grid = el("div", "member-details-grid");
  grid.append(
    detail("Phone", member.phone || "N/A"),
    detail("Email", member.email || "N/A", "11px"),
    detail("Joined", joinedDate),
    detail("Status", member.status || "N/A"),
  );
  body.appendChild(grid);

  // Actions — only the writes the SQL backend actually supports.
  const actions = el("div", "member-actions");
  const editBtn = el("button", "btn btn-ghost btn-sm");
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openEditMemberModal(member));
  actions.appendChild(editBtn);

  if (isCurrentUser) {
    const disabled = el("button", "btn btn-ghost btn-sm");
    disabled.textContent = "Remove";
    disabled.disabled = true;
    disabled.title = "You cannot remove yourself";
    disabled.style.cssText = "color: var(--bn-gray); cursor: not-allowed; opacity: 0.5;";
    actions.appendChild(disabled);
  } else {
    const removeBtn = el("button", "btn btn-ghost btn-sm");
    removeBtn.textContent = "Remove";
    removeBtn.style.color = "var(--bn-danger)";
    removeBtn.addEventListener("click", () => openDeleteMemberModal(member));
    actions.appendChild(removeBtn);
  }

  body.appendChild(actions);
  card.append(header, body);
  return card;
}

function detail(label, value, valueFontSize) {
  const wrap = el("div", "member-detail");
  const l = el("div", "member-detail-label");
  l.textContent = label;
  const v = el("div", "member-detail-value");
  v.textContent = value;
  if (valueFontSize) v.style.fontSize = valueFontSize;
  wrap.append(l, v);
  return wrap;
}

// ── Add member (members.create — creates the account + membership) ───────────
function openAddMemberModal() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }
  document.getElementById("addMemberForm")?.reset();
  const preview = document.getElementById("memberProfilePreview");
  if (preview) preview.textContent = "👤";
  showModal("addMemberModal");
}

function closeAddMemberModal() {
  hideModal("addMemberModal");
}

async function handleAddMember(e) {
  e.preventDefault();
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }

  const fullName = document.getElementById("memberName")?.value.trim();
  const email = document.getElementById("memberEmail")?.value.trim();
  const phone = document.getElementById("memberPhone")?.value.trim();
  const role = document.getElementById("memberRole")?.value || "member";

  if (!fullName) {
    showToast("Full name is required", "error");
    return;
  }
  if (!email) {
    showToast("Email is required", "error");
    return;
  }

  showLoading(true);
  try {
    // The server creates the user account (with a temporary password it returns
    // once) AND the membership in one transaction. Obligations derive on read.
    const member = await apiPost("members.create", {
      groupId: selectedGroupId,
      fullName,
      email,
      phone: phone || undefined,
      role,
    });
    closeAddMemberModal();

    const temp = member && member.temporaryPassword;
    if (temp) {
      // Surface the one-time temp password in a persistent way, not only a
      // 5-second toast: write it into the members list header if a slot exists.
      showTemporaryPassword(fullName, temp);
    }
    showToast(`Member ${fullName} added successfully`, "success");
    await loadMembers();
  } catch (error) {
    handleApiError(error, "Failed to add member");
  } finally {
    showLoading(false);
  }
}

/**
 * The temp password is shown ONCE and never again, so a disappearing toast is
 * the wrong surface. Render a dismissible banner the admin must close.
 */
function showTemporaryPassword(fullName, tempPassword) {
  const host = document.getElementById("membersList")?.parentElement || document.body;
  const banner = el("div", "temp-password-banner");
  banner.style.cssText = "background: var(--bn-accent-subtle, #fff8e1); border: 1px solid var(--bn-accent, #C8A45A); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px;";

  const text = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = `Temporary password for ${fullName}: `;
  const code = document.createElement("code");
  code.textContent = tempPassword;
  code.style.cssText = "font-size: 1rem; letter-spacing: 0.03em;";
  const hint = document.createElement("div");
  hint.textContent = "Share it securely. They should change it on first login. This is shown only once.";
  hint.style.cssText = "font-size: var(--bn-text-xs, 12px); color: var(--bn-gray, #777); margin-top: 4px;";
  text.append(strong, code, hint);

  const close = el("button", "btn btn-ghost btn-sm");
  close.textContent = "Dismiss";
  close.addEventListener("click", () => banner.remove());

  banner.append(text, close);
  host.insertBefore(banner, host.firstChild);
}

// ── Edit member (role + status only — full profile edit deferred) ───────────
function openEditMemberModal(member) {
  const modal = document.getElementById("editMemberModal");
  if (!modal) {
    showToast("Edit modal not found", "error");
    return;
  }
  if (!member || !member.uid) {
    showToast("Invalid member data", "error");
    return;
  }

  const idInput = document.getElementById("editMemberId");
  if (idInput) idInput.value = member.uid;

  const preview = document.getElementById("editMemberProfilePreview");
  if (preview) {
    preview.textContent = "";
    if (member.profileImageUrl) {
      const img = document.createElement("img");
      img.src = member.profileImageUrl;
      img.alt = member.fullName || "Member";
      preview.appendChild(img);
    } else {
      preview.textContent = member.fullName
        ? member.fullName.split(" ").map((n) => n[0]).join("").toUpperCase().substring(0, 2)
        : "??";
    }
  }

  const isSenior = selectedGroupRole() === "senior_admin";

  const fields = document.getElementById("editFormFields");
  if (fields) {
    fields.textContent = "";
    fields.appendChild(buildEditFields(member, isSenior));
  }

  showModal("editMemberModal");
}

/**
 * Only the fields the SQL backend can persist: role (senior_admin only) and
 * status (admin+). The remaining ~20 profile fields are shown read-only with a
 * note, because members.list doesn't return them and there is no members.update.
 */
function buildEditFields(member, isSenior) {
  const frag = document.createDocumentFragment();

  // Personal info — the only profile columns the members table actually holds,
  // editable via members.update (which whitelists exactly these).
  const personal = el("div", "form-section");
  const personalTitle = el("h4", "form-section-title");
  personalTitle.textContent = "Personal Information";
  personal.appendChild(personalTitle);
  personal.appendChild(textField("editMemberName", "Full Name", member.fullName || ""));
  personal.appendChild(textField("editMemberPhone", "Phone", member.phone || ""));
  personal.appendChild(textField("editMemberWhatsApp", "WhatsApp", member.whatsappNumber || ""));
  frag.appendChild(personal);

  frag.appendChild(buildKycDetails(member));

  const section = el("div", "form-section");
  const title = el("h4", "form-section-title");
  title.textContent = "Role & Status";
  section.appendChild(title);

  const row = el("div", "form-row");

  // Role (senior_admin only)
  const roleGroup = el("div", "form-group");
  const roleLabel = el("label", "form-label");
  roleLabel.textContent = "Role";
  const roleSelect = document.createElement("select");
  roleSelect.className = "form-select";
  roleSelect.id = "editMemberRole";
  [["member", "Member"], ["admin", "Admin"], ["treasurer", "Treasurer"], ["senior_admin", "Senior Admin"]]
    .forEach(([val, text]) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = text;
      if (member.role === val) opt.selected = true;
      roleSelect.appendChild(opt);
    });
  if (!isSenior) {
    roleSelect.disabled = true;
    roleSelect.title = "Only a senior admin can change roles";
  }
  roleGroup.append(roleLabel, roleSelect);

  // Status (admin+)
  const statusGroup = el("div", "form-group");
  const statusLabel = el("label", "form-label");
  statusLabel.textContent = "Status";
  const statusSelect = document.createElement("select");
  statusSelect.className = "form-select";
  statusSelect.id = "editMemberStatus";
  [["active", "Active"], ["inactive", "Inactive"], ["suspended", "Suspended"]]
    .forEach(([val, text]) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = text;
      if (member.status === val) opt.selected = true;
      statusSelect.appendChild(opt);
    });
  statusGroup.append(statusLabel, statusSelect);

  row.append(roleGroup, statusGroup);
  section.appendChild(row);

  if (!isSenior) {
    const note = el("p", "help-text");
    note.textContent = "You can change a member's status. Only a senior admin can change roles.";
    note.style.cssText = "font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-2);";
    section.appendChild(note);
  }

  const deferred = el("p", "help-text");
  deferred.textContent = "Other profile details (career, DOB, address, notes) are not yet editable on the new system.";
  deferred.style.cssText = "font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-3);";
  section.appendChild(deferred);

  frag.appendChild(section);
  return frag;
}

/**
 * KYC fields (B20) — guarantor, collateral, ID, next-of-kin. All optional: an
 * admin can leave this whole disclosure untouched (skip) or fill in only some
 * fields (override just those). Collapsed by default so it doesn't clutter the
 * primary role/status edit flow.
 */
const KYC_FIELD_DEFS = [
  ["editMemberGuarantorName", "guarantorName", "Guarantor Name"],
  ["editMemberGuarantorPhone", "guarantorPhone", "Guarantor Phone"],
  ["editMemberGuarantorRelationship", "guarantorRelationship", "Guarantor Relationship"],
  ["editMemberGuarantorAddress", "guarantorAddress", "Guarantor Address"],
  ["editMemberCollateralDescription", "collateralDescription", "Collateral Description"],
  ["editMemberIdType", "idType", "ID Type"],
  ["editMemberIdNumber", "idNumber", "ID Number"],
  ["editMemberNextOfKinName", "nextOfKinName", "Next of Kin Name"],
  ["editMemberNextOfKinPhone", "nextOfKinPhone", "Next of Kin Phone"],
  ["editMemberNextOfKinRelationship", "nextOfKinRelationship", "Next of Kin Relationship"],
];

function buildKycDetails(member) {
  const details = document.createElement("details");
  details.className = "form-section";
  details.id = "editMemberKycDetails";

  const summary = document.createElement("summary");
  summary.className = "form-section-title";
  summary.textContent = "KYC details (optional — can be added later)";
  details.appendChild(summary);

  const note = el("p", "help-text");
  note.textContent = "Leave any of these blank to skip. Only the fields you change are saved.";
  note.style.cssText = "font-size: var(--bn-text-xs); color: var(--bn-gray); margin: var(--bn-space-2) 0;";
  details.appendChild(note);

  KYC_FIELD_DEFS.forEach(([id, memberKey, label]) => {
    details.appendChild(textField(id, label, member[memberKey] || ""));
  });

  return details;
}

async function handleEditMember(e) {
  e.preventDefault();
  const uid = document.getElementById("editMemberId")?.value;
  if (!uid || !selectedGroupId) return;

  const roleSelect = document.getElementById("editMemberRole");
  const statusSelect = document.getElementById("editMemberStatus");
  const newRole = roleSelect?.value;
  const newStatus = statusSelect?.value;

  const original = allMembers.find((m) => m.uid === uid);
  if (!original) {
    showToast("Member not found", "error");
    return;
  }

  const roleChanged = !roleSelect?.disabled && newRole && newRole !== original.role;
  const statusChanged = newStatus && newStatus !== original.status;

  // Profile fields (members.update whitelist = exactly these three + profileImageUrl).
  const newName = document.getElementById("editMemberName")?.value.trim();
  const newPhone = document.getElementById("editMemberPhone")?.value.trim();
  const newWhatsApp = document.getElementById("editMemberWhatsApp")?.value.trim();

  if (newName !== undefined && newName === "") {
    showToast("Full name cannot be empty", "error");
    return;
  }

  const profileChanges = {};
  if (newName !== undefined && newName !== (original.fullName || "")) profileChanges.fullName = newName;
  if (newPhone !== undefined && newPhone !== (original.phone || "")) profileChanges.phone = newPhone;
  if (newWhatsApp !== undefined && newWhatsApp !== (original.whatsappNumber || "")) profileChanges.whatsappNumber = newWhatsApp;

  // KYC fields (B20) — all optional; only send the ones the admin actually
  // changed from what was loaded, so skipping the whole disclosure sends nothing.
  KYC_FIELD_DEFS.forEach(([id, memberKey]) => {
    const input = document.getElementById(id);
    if (!input) return;
    const newValue = input.value.trim();
    if (newValue !== (original[memberKey] || "")) profileChanges[memberKey] = newValue;
  });

  const profileChanged = Object.keys(profileChanges).length > 0;

  if (!roleChanged && !statusChanged && !profileChanged) {
    closeEditMemberModal();
    showToast("No changes to save.", "info");
    return;
  }

  showLoading(true);
  try {
    // Profile → status → role. Each is a separate, independently authorised call
    // (profile+status are admin+, role is senior_admin-only, all re-checked server-side).
    if (profileChanged) {
      await apiPost("members.update", {groupId: selectedGroupId, uid, ...profileChanges});
    }
    if (statusChanged) {
      await apiPost("members.status", {groupId: selectedGroupId, uid, status: newStatus});
    }
    if (roleChanged) {
      await apiPost("members.role", {groupId: selectedGroupId, uid, role: newRole});
    }
    closeEditMemberModal();
    showToast("Member updated successfully", "success");
    await loadMembers();
  } catch (error) {
    handleApiError(error, "Failed to update member");
  } finally {
    showLoading(false);
  }
}

function closeEditMemberModal() {
  hideModal("editMemberModal");
}

// ── Remove (deferred — needs members.remove; status change offered via Edit) ─
function openDeleteMemberModal(member) {
  const modal = document.getElementById("deleteMemberModal");
  if (!modal) {
    showToast("Removing a member isn't available yet — set their status to Inactive via Edit instead.", "warning");
    return;
  }
  if (member.uid === currentUser?.uid) {
    showToast("You cannot remove yourself from the group. Ask another admin to remove you.", "warning");
    return;
  }
  setText("deleteMemberName", member.fullName || "this member");
  const idInput = document.getElementById("deleteMemberId");
  if (idInput) idInput.value = member.uid;
  showModal("deleteMemberModal");
}

function closeDeleteMemberModal() {
  hideModal("deleteMemberModal");
}

async function confirmDeleteMember() {
  const uid = document.getElementById("deleteMemberId")?.value;
  if (!uid || !selectedGroupId) return;

  if (uid === currentUser?.uid) {
    showToast("You cannot remove yourself from the group.", "error");
    closeDeleteMemberModal();
    return;
  }

  showLoading(true);
  closeDeleteMemberModal();
  try {
    await apiPost("members.remove", {groupId: selectedGroupId, uid});
    showToast("Member removed successfully", "success");
    await loadMembers();
  } catch (error) {
    // The server refuses to DELETE a member who has any loan/payment/repayment
    // history (409) — the honest fix is deactivation, not deletion.
    if (error instanceof ApiError && error.status === 409) {
      showToast(
        error.message || "This member has financial history — set their status to Inactive via Edit instead.",
        "warning",
      );
    } else {
      handleApiError(error, "Failed to remove member");
    }
  } finally {
    showLoading(false);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

/** A labelled text input inside a .form-group, built with no innerHTML. */
function textField(id, label, value) {
  const group = el("div", "form-group");
  const lab = el("label", "form-label");
  lab.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-input";
  input.id = id;
  input.value = value || "";
  group.append(lab, input);
  return group;
}

function showModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add("active");
  modal.classList.remove("hidden");
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function hideModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("active");
  modal.classList.add("hidden");
  modal.style.display = "none";
  document.body.style.overflow = "";
}

function showLoading(show) {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
  overlay.classList.toggle("hidden", !show);
}

/** Centralised ApiError handling: 401 -> login (already handled by requireSession). */
function handleApiError(error, fallback) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      redirectToLogin();
      return;
    }
    if (error.status === 403) {
      showToast("You do not have permission to do that.", "error");
      return;
    }
    showToast(error.message || fallback, "error");
    return;
  }
  console.error(fallback, error);
  showToast(fallback, "error");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) {
    // No alert() — keep to the app's toast contract; degrade silently to console.
    console.log(`[${type}] ${message}`);
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const span = document.createElement("span");
  span.textContent = message;
  const close = document.createElement("button");
  close.className = "toast-close";
  close.innerHTML = "&times;"; // static entity only, no user data
  close.addEventListener("click", () => toast.remove());

  toast.append(span, close);
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
