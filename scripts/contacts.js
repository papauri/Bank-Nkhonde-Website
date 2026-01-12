/**
 * Contacts - View group members and contact information
 */

import {
  db,
  auth,
  collection,
  getDocs,
  doc,
  getDoc,
  onAuthStateChanged,
  query,
  where,
} from "./firebaseConfig.js";

let currentUser = null;
let userGroups = [];

document.addEventListener("DOMContentLoaded", () => {
  const groupSelector = document.getElementById("groupSelector");
  const contactsList = document.getElementById("contactsList");

  // Auth state
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    currentUser = user;
    await loadUserGroups();
  });

  // Group selector
  if (groupSelector) {
    groupSelector.addEventListener("change", async (e) => {
      const groupId = e.target.value;
      if (groupId) {
        sessionStorage.setItem('selectedGroupId', groupId);
        await loadMembers(groupId);
      } else {
        if (contactsList) {
          contactsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><p class="empty-state-text">Select a group to view members</p></div>';
        }
      }
    });
  }

  /**
   * Load user groups
   */
  async function loadUserGroups() {
    try {
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      if (!userDoc.exists()) return;

      const userData = userDoc.data();
      
      // Get selected group from session
      const selectedGroupId = sessionStorage.getItem('selectedGroupId');
      
      // Also check groupMemberships
      const groupMemberships = userData.groupMemberships || [];
      
      userGroups = [];
      for (const membership of groupMemberships) {
        const groupDoc = await getDoc(doc(db, "groups", membership.groupId));
        if (groupDoc.exists()) {
          userGroups.push({ ...groupDoc.data(), id: membership.groupId });
        }
      }
      
      // Also check if user is admin in any group
      const groupsRef = collection(db, "groups");
      const groupsSnapshot = await getDocs(groupsRef);
      groupsSnapshot.forEach(groupDoc => {
        const groupData = groupDoc.data();
        const groupId = groupDoc.id;
        const isAdmin = groupData.admins?.some(admin => admin.uid === currentUser.uid || admin.email === currentUser.email);
        if (isAdmin && !userGroups.find(g => g.id === groupId)) {
          userGroups.push({ ...groupData, id: groupId });
        }
      });

      // Populate selector
      if (groupSelector) {
        groupSelector.innerHTML = '<option value="">Select a group...</option>';
        userGroups.forEach(group => {
          const option = document.createElement("option");
          option.value = group.id;
          option.textContent = group.groupName;
          groupSelector.appendChild(option);
        });

        // Auto-select from session or first group
        const selectedGroupId = sessionStorage.getItem('selectedGroupId');
        if (selectedGroupId && userGroups.find(g => g.id === selectedGroupId)) {
          groupSelector.value = selectedGroupId;
          await loadMembers(selectedGroupId);
        } else if (userGroups.length > 0) {
          groupSelector.value = userGroups[0].id;
          sessionStorage.setItem('selectedGroupId', userGroups[0].id);
          await loadMembers(userGroups[0].id);
        }
      }
    } catch (error) {
      console.error("Error loading groups:", error);
    }
  }

  /**
   * Load members for a group
   */
  async function loadMembers(groupId) {
    try {
      const contactsList = document.getElementById("contactsList");
      if (!contactsList) return;

      const membersRef = collection(db, `groups/${groupId}/members`);
      const membersSnapshot = await getDocs(membersRef);

      if (membersSnapshot.empty) {
        contactsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><p class="empty-state-text">No members found</p></div>';
        return;
      }

      contactsList.innerHTML = '';
      const members = [];

      membersSnapshot.forEach(doc => {
        members.push({ id: doc.id, ...doc.data() });
      });

      // Sort: admins first, then by name
      members.sort((a, b) => {
        if (a.role === "admin" || a.role === "senior_admin") return -1;
        if (b.role === "admin" || b.role === "senior_admin") return 1;
        return (a.fullName || "").localeCompare(b.fullName || "");
      });

      members.forEach(member => {
        const memberElement = createMemberElement(member);
        contactsList.appendChild(memberElement);
      });
    } catch (error) {
      console.error("Error loading members:", error);
      const contactsList = document.getElementById("contactsList");
      if (contactsList) {
        contactsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p class="empty-state-text">Error loading members</p></div>';
      }
    }
  }

  /**
   * Create member element
   */
  function createMemberElement(member) {
    const div = document.createElement("div");
    div.className = "list-item";
    div.style.cursor = "pointer";
    div.onclick = () => showMemberDetails(member);

    const initials = member.fullName
      ? member.fullName.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2)
      : "??";

    const profilePicture = member.profileImageUrl
      ? `<img src="${member.profileImageUrl}" alt="${member.fullName}" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover; border: 3px solid var(--bn-primary);">`
      : `<div style="width: 60px; height: 60px; border-radius: 50%; background: var(--bn-primary); color: white; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 20px; border: 3px solid var(--bn-primary);">${initials}</div>`;

    const roleBadge = member.role === "admin" || member.role === "senior_admin"
      ? '<span class="badge badge-info" style="font-size: 0.75rem;">Admin</span>'
      : '<span class="badge badge-success" style="font-size: 0.75rem;">Member</span>';

    div.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: var(--bn-space-md); flex: 1;">
        ${profilePicture}
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <div class="list-item-title" style="flex: 1;">${member.fullName || "Unknown"}</div>
            ${roleBadge}
          </div>
          ${member.career || member.jobTitle ? `
            <div class="list-item-subtitle" style="margin-bottom: 4px;">
              ${member.career ? `<strong>${member.career}</strong>` : ""}${member.jobTitle ? ` - ${member.jobTitle}` : ""}
              ${member.workplace ? `<br><span style="font-size: 0.875rem; color: rgba(255, 255, 255, 0.6);">at ${member.workplace}</span>` : ""}
            </div>
          ` : ""}
          <div style="margin-top: 8px; font-size: 0.875rem; color: rgba(255, 255, 255, 0.8); display: flex; flex-direction: column; gap: 4px;">
            ${member.phone ? `<div>📞 <a href="tel:${member.phone}" style="color: inherit; text-decoration: none;">${member.phone}</a></div>` : ""}
            ${member.email ? `<div>✉️ <a href="mailto:${member.email}" style="color: inherit; text-decoration: none;">${member.email}</a></div>` : ""}
            ${member.whatsappNumber ? `<div>💬 WhatsApp: <a href="https://wa.me/${member.whatsappNumber.replace(/\D/g, '')}" target="_blank" style="color: inherit; text-decoration: none;">${member.whatsappNumber}</a></div>` : ""}
            ${member.address ? `<div style="margin-top: 4px;">📍 ${member.address}</div>` : ""}
          </div>
          ${member.guarantorName ? `
            <div style="margin-top: 8px; padding: 8px; background: rgba(255, 255, 255, 0.05); border-radius: 4px; border-left: 3px solid var(--bn-primary);">
              <div style="font-size: 0.75rem; color: rgba(255, 255, 255, 0.6);">Guarantor:</div>
              <div style="font-size: 0.875rem; font-weight: 600;">${member.guarantorName}${member.guarantorPhone ? ` - ${member.guarantorPhone}` : ""}</div>
            </div>
          ` : ""}
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-end; flex-shrink: 0;">
        ${member.phone ? `<a href="tel:${member.phone}" class="btn btn-primary btn-sm" onclick="event.stopPropagation();">📞 Call</a>` : ""}
        ${member.whatsappNumber ? `<a href="https://wa.me/${member.whatsappNumber.replace(/\D/g, '')}" target="_blank" class="btn btn-success btn-sm" onclick="event.stopPropagation();">💬 WhatsApp</a>` : ""}
        ${member.email ? `<a href="mailto:${member.email}" class="btn btn-ghost btn-sm" onclick="event.stopPropagation();">✉️ Email</a>` : ""}
      </div>
    `;

    return div;
  }

  /**
   * Show member details
   */
  function showMemberDetails(member) {
    const details = `
Member Details:

Name: ${member.fullName || "N/A"}
Email: ${member.email || "N/A"}
Phone: ${member.phone || "N/A"}
WhatsApp: ${member.whatsappNumber || "N/A"}

Career: ${member.career || "N/A"}
Job Title: ${member.jobTitle || "N/A"}
Workplace: ${member.workplace || "N/A"}
Work Address: ${member.workAddress || "N/A"}

Address: ${member.address || "N/A"}
Date of Birth: ${member.dateOfBirth || "N/A"}
Gender: ${member.gender || "N/A"}

Guarantor: ${member.guarantorName || "N/A"}
Guarantor Phone: ${member.guarantorPhone || "N/A"}
Relationship: ${member.guarantorRelationship || "N/A"}
Guarantor Address: ${member.guarantorAddress || "N/A"}

Emergency Contact: ${member.emergencyContact || "N/A"}
Emergency Phone: ${member.emergencyContactPhone || "N/A"}

ID Type: ${member.idType || "N/A"}
ID Number: ${member.idNumber || "N/A"}

Role: ${member.role || "Member"}
Status: ${member.status || "Active"}
    `;
    alert(details);
  }

  // Make showMemberDetails available globally
  window.showMemberDetails = showMemberDetails;
});
