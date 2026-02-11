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
  addDoc,
  Timestamp,
} from "./firebaseConfig.js";

let currentUser = null;
let userGroups = [];
let currentGroupId = null;
let messageAdminRecipientId = null;

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
        currentGroupId = groupId;
        localStorage.setItem('selectedGroupId', groupId);
        sessionStorage.setItem('selectedGroupId', groupId);
        await loadMembers(groupId);
      } else {
        currentGroupId = null;
        if (contactsList) {
          contactsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><p class="empty-state-text">Select a group to view members</p></div>';
        }
      }
    });
  }

  // Message Admin Form
  const messageAdminForm = document.getElementById('messageAdminForm');
  if (messageAdminForm) {
    messageAdminForm.addEventListener('submit', handleSendMessage);
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

        // Auto-select from localStorage/sessionStorage or first group
        const selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
        if (selectedGroupId && userGroups.find(g => g.id === selectedGroupId)) {
          currentGroupId = selectedGroupId;
          groupSelector.value = selectedGroupId;
          await loadMembers(selectedGroupId);
        } else if (userGroups.length > 0) {
          currentGroupId = userGroups[0].id;
          groupSelector.value = userGroups[0].id;
          localStorage.setItem('selectedGroupId', userGroups[0].id);
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
      currentGroupId = groupId;
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
    div.className = "member-card";
    div.onclick = () => showMemberDetails(member);

    const initials = member.fullName
      ? member.fullName.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2)
      : "??";

    const profilePicture = member.profileImageUrl
      ? `<img src="${member.profileImageUrl}" alt="${member.fullName}">`
      : `<span>${initials}</span>`;

    const roleBadge = member.role === "admin" || member.role === "senior_admin"
      ? '<span class="member-badge" style="background: rgba(201, 162, 39, 0.12); color: #A68B1F;">Admin</span>'
      : '<span class="member-badge" style="background: rgba(5, 150, 105, 0.1); color: #047857;">Member</span>';

    const roleText = member.role === "admin" || member.role === "senior_admin" ? "Administrator" : "Group Member";

    let contactsHTML = '';
    if (member.phone || member.email || member.whatsappNumber) {
      contactsHTML = '<div class="member-contacts">';
      if (member.phone) {
        contactsHTML += `
          <div class="contact-item">
            <div class="contact-icon">📞</div>
            <a href="tel:${member.phone}" onclick="event.stopPropagation();">${member.phone}</a>
          </div>
        `;
      }
      if (member.email) {
        contactsHTML += `
          <div class="contact-item">
            <div class="contact-icon">✉️</div>
            <a href="mailto:${member.email}" onclick="event.stopPropagation();">${member.email}</a>
          </div>
        `;
      }
      if (member.whatsappNumber) {
        const whatsappNumber = member.whatsappNumber.replace(/\D/g, '');
        contactsHTML += `
          <div class="contact-item">
            <div class="contact-icon">💬</div>
            <a href="https://wa.me/${whatsappNumber}" target="_blank" onclick="event.stopPropagation();">${member.whatsappNumber}</a>
          </div>
        `;
      }
      if (member.address) {
        contactsHTML += `
          <div class="contact-item">
            <div class="contact-icon">📍</div>
            <span>${member.address}</span>
          </div>
        `;
      }
      contactsHTML += '</div>';
    }

    let actionsHTML = '<div class="member-actions">';
    
    // Add Message Admin button if member is admin
    if ((member.role === "admin" || member.role === "senior_admin") && member.id !== currentUser.uid) {
      actionsHTML += `<button class="member-action-btn primary" onclick="event.stopPropagation(); openMessageModal('${member.id}', '${member.fullName || 'Admin'}');">💬 Message</button>`;
    }
    
    if (member.phone) {
      actionsHTML += `<a href="tel:${member.phone}" class="member-action-btn" onclick="event.stopPropagation();">📞 Call</a>`;
    }
    if (member.whatsappNumber) {
      const whatsappNumber = member.whatsappNumber.replace(/\D/g, '');
      actionsHTML += `<a href="https://wa.me/${whatsappNumber}" target="_blank" class="member-action-btn" onclick="event.stopPropagation();">💬 WhatsApp</a>`;
    }
    if (member.email) {
      actionsHTML += `<a href="mailto:${member.email}" class="member-action-btn" onclick="event.stopPropagation();">✉️ Email</a>`;
    }
    actionsHTML += '</div>';

    div.innerHTML = `
      <div class="member-card-header">
        <div class="member-avatar">
          ${profilePicture}
        </div>
        <div class="member-info">
          <div class="member-name-row">
            <div class="member-name">${member.fullName || "Unknown"}</div>
            ${roleBadge}
          </div>
          <div class="member-role">${roleText}</div>
          ${(member.career || member.jobTitle) ? `
            <div class="member-career">${member.career || member.jobTitle}</div>
            ${member.workplace ? `<div class="member-workplace">at ${member.workplace}</div>` : ""}
          ` : ""}
        </div>
      </div>
      ${contactsHTML}
      ${member.guarantorName ? `
        <div class="guarantor-info">
          <div class="guarantor-label">Guarantor</div>
          <div class="guarantor-name">${member.guarantorName}${member.guarantorPhone ? ` - ${member.guarantorPhone}` : ""}</div>
          ${member.guarantorRelationship ? `<div style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: 4px;">${member.guarantorRelationship}</div>` : ""}
        </div>
      ` : ""}
      ${actionsHTML}
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
    
    // Show member details in a more user-friendly way
    const detailsModal = {
      title: `Contact: ${member.fullName}`,
      message: details
    };
    
    // For now, use console.log since we don't have a details modal
    console.log(details);
    showToast(`Details for ${member.fullName} - check console`, 'info');
  }

  /**
   * Open message modal
   */
  function openMessageModal(adminId, adminName) {
    messageAdminRecipientId = adminId;
    const messageAdminModal = document.getElementById('messageAdminModal');
    const messageAdminRecipient = document.getElementById('messageAdminRecipient');
    const messageAdminForm = document.getElementById('messageAdminForm');
    
    if (messageAdminRecipient) {
      messageAdminRecipient.textContent = adminName;
    }
    
    if (messageAdminForm) {
      messageAdminForm.reset();
    }
    
    if (messageAdminModal) {
      messageAdminModal.style.display = 'flex';
    }
  }

  /**
   * Close message modal
   */
  function closeMessageModal() {
    const messageAdminModal = document.getElementById('messageAdminModal');
    if (messageAdminModal) {
      messageAdminModal.style.display = 'none';
    }
    messageAdminRecipientId = null;
  }

  /**
   * Handle send message form submission
   */
  async function handleSendMessage(e) {
    e.preventDefault();
    
    if (!currentGroupId || !messageAdminRecipientId || !currentUser) {
      showToast('Error: Group or recipient not selected', 'error');
      return;
    }

    const subjectInput = document.getElementById('messageAdminSubject');
    const messageInput = document.getElementById('messageAdminMessage');
    const submitBtn = messageAdminForm.querySelector('button[type="submit"]');
    
    if (!subjectInput || !messageInput) {
      showToast('Error: Form fields not found', 'error');
      return;
    }

    const subject = subjectInput.value.trim();
    const message = messageInput.value.trim();

    if (!subject || !message) {
      showToast('Please fill in both subject and message', 'error');
      return;
    }

    try {
      // Disable submit button
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
      }

      // Get sender info
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      const userData = userDoc.exists() ? userDoc.data() : {};
      const senderName = userData.fullName || currentUser.email || 'Unknown User';
      const senderEmail = currentUser.email || '';

      // Get group info
      const groupDoc = await getDoc(doc(db, "groups", currentGroupId));
      const groupData = groupDoc.exists() ? groupDoc.data() : {};
      const groupName = groupData.groupName || 'Unknown Group';

      // Create notification in database
      await addDoc(collection(db, `groups/${currentGroupId}/notifications`), {
        userId: messageAdminRecipientId,
        recipientId: messageAdminRecipientId, // For backward compatibility
        senderId: currentUser.uid,
        senderName: senderName,
        senderEmail: senderEmail,
        groupId: currentGroupId,
        groupName: groupName,
        title: subject,
        message: message,
        type: 'user_message',
        read: false,
        readBy: [],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

      showToast('Message sent successfully!', 'success');
      closeMessageModal();
      
    } catch (error) {
      console.error('Error sending message:', error);
      showToast('Error sending message. Please try again.', 'error');
    } finally {
      // Re-enable submit button
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Message';
      }
    }
  }

  /**
   * Show toast notification
   */
  function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) {
      alert(message);
      return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
      padding: var(--bn-space-3) var(--bn-space-4);
      background: ${type === 'success' ? '#059669' : type === 'error' ? '#DC2626' : '#2563EB'};
      color: white;
      border-radius: var(--bn-radius-md);
      margin-bottom: var(--bn-space-2);
      font-size: var(--bn-text-sm);
      box-shadow: var(--bn-shadow-md);
      animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Make functions available globally
  window.showMemberDetails = showMemberDetails;
  window.openMessageModal = openMessageModal;
  window.closeMessageModal = closeMessageModal;
});
