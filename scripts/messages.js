import {
  db,
  auth,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  updateDoc,
  onAuthStateChanged,
  Timestamp,
} from './firebaseConfig.js';

let currentUser = null;
let userGroups = [];
let allMessages = [];

// DOM Elements
const spinner = document.getElementById('spinner');
const groupSelector = document.getElementById('groupSelector');
const messagesList = document.getElementById('messagesList');
const messageModal = document.getElementById('messageModal');
const modalTitle = document.getElementById('modalTitle');
const modalMeta = document.getElementById('modalMeta');
const modalText = document.getElementById('modalText');
const closeModal = document.getElementById('closeModal');
const markAllReadBtn = document.getElementById('markAllReadBtn');
const toastContainer = document.getElementById('toastContainer');

// Initialize
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadUserGroups();
    await loadMessages();
  } else {
    window.location.href = '../login.html';
  }
});

document.addEventListener('DOMContentLoaded', () => {
  // Group selector change
  if (groupSelector) {
    groupSelector.addEventListener('change', () => {
      filterMessages();
    });
  }

  // Close modal
  if (closeModal) {
    closeModal.addEventListener('click', () => {
      messageModal.classList.remove('active');
    });
  }

  // Close modal on backdrop click
  if (messageModal) {
    messageModal.addEventListener('click', (e) => {
      if (e.target === messageModal) {
        messageModal.classList.remove('active');
      }
    });
  }

  // Mark all as read
  if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', markAllAsRead);
  }
});

/**
 * Load user groups
 */
async function loadUserGroups() {
  try {
    userGroups = [];
    
    // Get selected group from session
    const selectedGroupId = sessionStorage.getItem('selectedGroupId');
    
    // Get groups where user is a member
    const groupsRef = collection(db, 'groups');
    const groupsSnapshot = await getDocs(groupsRef);
    
    groupsSnapshot.forEach(groupDoc => {
      const groupData = groupDoc.data();
      const groupId = groupDoc.id;
      
      // Check if user is admin
      const isAdmin = groupData.createdBy === currentUser.uid || 
                     (groupData.admins && groupData.admins.some(admin => admin.uid === currentUser.uid));
      
      // Check if user is a member
      // We'll check this when loading messages
      userGroups.push({ ...groupData, groupId, isAdmin });
    });

    // Populate group selector
    if (groupSelector) {
      groupSelector.innerHTML = '<option value="">All Groups</option>';
      userGroups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.groupId;
        option.textContent = group.groupName;
        if (selectedGroupId === group.groupId) {
          option.selected = true;
        }
        groupSelector.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Error loading groups:', error);
  }
}

/**
 * Load messages/notifications
 */
async function loadMessages() {
  try {
    showSpinner(true);
    allMessages = [];

    // Get notifications from all groups where user is a member
    for (const group of userGroups) {
      try {
        // Check if user is a member
        const memberDoc = await getDoc(doc(db, 'groups', group.groupId, 'members', currentUser.uid));
        if (!memberDoc.exists() && !group.isAdmin) {
          continue;
        }

        // Get notifications for this user in this group
        const notificationsRef = collection(db, `groups/${group.groupId}/notifications`);
        const q = query(
          notificationsRef,
          where('recipientId', '==', currentUser.uid),
          orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);

        snapshot.forEach(doc => {
          allMessages.push({
            ...doc.data(),
            id: doc.id,
            groupId: group.groupId,
            groupName: group.groupName
          });
        });
      } catch (error) {
        // Collection might not exist or query failed
        console.log(`No notifications found for group ${group.groupId}`);
      }
    }

    // Sort by date (newest first)
    allMessages.sort((a, b) => {
      const aTime = a.createdAt?.toMillis() || 0;
      const bTime = b.createdAt?.toMillis() || 0;
      return bTime - aTime;
    });

    filterMessages();
  } catch (error) {
    console.error('Error loading messages:', error);
    showToast('Error loading messages: ' + error.message, 'error');
    if (messagesList) {
      messagesList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p class="empty-state-text">Error loading messages</p></div>';
    }
  } finally {
    showSpinner(false);
  }
}

/**
 * Filter messages by selected group
 */
function filterMessages() {
  if (!messagesList) return;

  const selectedGroupId = groupSelector?.value || '';

  let filteredMessages = allMessages;
  if (selectedGroupId) {
    filteredMessages = allMessages.filter(msg => msg.groupId === selectedGroupId);
  }

  // Update mark all read button visibility
  const unreadCount = filteredMessages.filter(msg => !msg.read).length;
  if (markAllReadBtn) {
    markAllReadBtn.style.display = unreadCount > 0 ? 'block' : 'none';
  }

  if (filteredMessages.length === 0) {
    messagesList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📬</div><p class="empty-state-text">No messages found</p></div>';
    return;
  }

  messagesList.innerHTML = '';
  filteredMessages.forEach(message => {
    const messageElement = createMessageElement(message);
    messagesList.appendChild(messageElement);
  });
}

/**
 * Create message element
 */
function createMessageElement(message) {
  const div = document.createElement('div');
  div.className = `message-item ${message.read ? '' : 'unread'}`;
  div.onclick = () => openMessage(message);

  const date = message.createdAt?.toDate() || new Date();
  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const typeMap = {
    info: 'info',
    success: 'success',
    warning: 'warning',
    danger: 'danger',
    urgent: 'danger',
    reminder: 'warning',
    announcement: 'info',
    meeting: 'info'
  };

  const messageType = typeMap[message.type] || 'info';

  div.innerHTML = `
    <div class="message-header">
      <div style="flex: 1;">
        <h3 class="message-title">${escapeHtml(message.title || 'No title')}</h3>
        <div class="message-meta">
          <span>${escapeHtml(message.groupName || 'Unknown Group')}</span>
          <span>•</span>
          <span>${dateStr}</span>
          ${message.senderName ? `<span>•</span><span>From: ${escapeHtml(message.senderName)}</span>` : ''}
        </div>
      </div>
      <span class="message-type-badge ${messageType}">${message.type || 'info'}</span>
    </div>
    <div class="message-body">${escapeHtml((message.message || '').substring(0, 150))}${(message.message || '').length > 150 ? '...' : ''}</div>
  `;

  return div;
}

/**
 * Open message in modal
 */
async function openMessage(message) {
  try {
    // Mark as read if unread
    if (!message.read) {
      try {
        const notificationRef = doc(db, `groups/${message.groupId}/notifications`, message.id);
        await updateDoc(notificationRef, {
          read: true,
          readAt: Timestamp.now()
        });
        message.read = true;
      } catch (error) {
        console.error('Error marking message as read:', error);
      }
    }

    // Update UI
    const messageItem = Array.from(messagesList.children).find(item => {
      return item.textContent.includes(message.title);
    });
    if (messageItem) {
      messageItem.classList.remove('unread');
    }

    // Show modal
    if (modalTitle) modalTitle.textContent = message.title || 'Message';
    if (modalText) modalText.textContent = message.message || 'No message content';

    const date = message.createdAt?.toDate() || new Date();
    const dateStr = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    if (modalMeta) {
      modalMeta.innerHTML = `
        <div><strong>Group:</strong> ${escapeHtml(message.groupName || 'Unknown')}</div>
        ${message.senderName ? `<div><strong>From:</strong> ${escapeHtml(message.senderName)}</div>` : ''}
        <div><strong>Date:</strong> ${dateStr}</div>
        <div><strong>Type:</strong> ${escapeHtml(message.type || 'info')}</div>
      `;
    }

    messageModal.classList.add('active');
  } catch (error) {
    console.error('Error opening message:', error);
    showToast('Error opening message', 'error');
  }
}

/**
 * Mark all messages as read
 */
async function markAllAsRead() {
  try {
    showSpinner(true);
    
    const selectedGroupId = groupSelector?.value || '';
    let messagesToMark = allMessages.filter(msg => !msg.read);
    
    if (selectedGroupId) {
      messagesToMark = messagesToMark.filter(msg => msg.groupId === selectedGroupId);
    }

    for (const message of messagesToMark) {
      try {
        const notificationRef = doc(db, `groups/${message.groupId}/notifications`, message.id);
        await updateDoc(notificationRef, {
          read: true,
          readAt: Timestamp.now()
        });
        message.read = true;
      } catch (error) {
        console.error(`Error marking message ${message.id} as read:`, error);
      }
    }

    filterMessages();
    showToast(`Marked ${messagesToMark.length} message(s) as read`, 'success');
  } catch (error) {
    console.error('Error marking all as read:', error);
    showToast('Error marking messages as read', 'error');
  } finally {
    showSpinner(false);
  }
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show spinner
 */
function showSpinner(show) {
  if (spinner) {
    if (show) {
      spinner.classList.remove('hidden');
    } else {
      spinner.classList.add('hidden');
    }
  }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  if (!toastContainer) {
    alert(message);
    return;
  }

  const typeMap = {
    success: 'success',
    error: 'danger',
    warning: 'warning',
    info: 'info'
  };

  const cssType = typeMap[type] || 'info';
  const toast = document.createElement('div');
  toast.className = `toast ${cssType}`;

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()" aria-label="Close">×</button>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('exiting');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
