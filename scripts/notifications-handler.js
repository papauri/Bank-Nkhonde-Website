/**
 * Notifications Handler
 * Handles notification bell, dropdown, and notification fetching
 */

import {
  db,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  doc,
  updateDoc,
  deleteDoc,
  Timestamp,
  onSnapshot,
  arrayUnion,
} from "./firebaseConfig.js";

let notificationUnsubscribe = null;

// Initialize notifications
export function initializeNotifications(userId, groupId) {
  const notificationBtn = document.getElementById('notificationsBtn');
  const notificationBadge = document.getElementById('notificationBadge');
  
  if (!notificationBtn || !userId) return;

  // Create dropdown if it doesn't exist
  let dropdown = document.getElementById('notificationDropdown');
  if (!dropdown) {
    dropdown = createNotificationDropdown();
    notificationBtn.parentElement.style.position = 'relative';
    notificationBtn.parentElement.appendChild(dropdown);
  }

  // Toggle dropdown on click
  notificationBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('show');
    dropdown.classList.toggle('show');
    
    if (!isOpen) {
      loadNotifications(userId, groupId);
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !notificationBtn.contains(e.target)) {
      dropdown.classList.remove('show');
    }
  });

  // Load initial notification count
  loadNotificationCount(userId, groupId, notificationBadge);

  // Set up real-time listener for new notifications
  if (groupId) {
    setupRealtimeNotifications(userId, groupId, notificationBadge);
  }
}

// Create notification dropdown
function createNotificationDropdown() {
  const dropdown = document.createElement('div');
  dropdown.id = 'notificationDropdown';
  dropdown.className = 'notification-dropdown';
  dropdown.innerHTML = `
    <div class="notification-header">
      <span class="notification-title">Notifications</span>
      <button class="notification-mark-read" id="markAllRead">Mark all read</button>
    </div>
    <div class="notification-list" id="notificationList">
      <div class="notification-loading">Loading...</div>
    </div>
    <a href="messages.html" class="notification-footer">View All Messages</a>
  `;
  
  // Add styles
  dropdown.style.cssText = `
    position: absolute;
    top: 100%;
    right: 0;
    width: 360px;
    max-width: 90vw;
    background: white;
    border: 1px solid var(--bn-gray-lighter);
    border-radius: var(--bn-radius-xl);
    box-shadow: var(--bn-shadow-lg);
    z-index: 1000;
    display: none;
    overflow: hidden;
    margin-top: 8px;
  `;

  // Add CSS for dropdown
  if (!document.getElementById('notificationStyles')) {
    const style = document.createElement('style');
    style.id = 'notificationStyles';
    style.textContent = `
      .notification-dropdown.show { display: block !important; }
      .notification-header { 
        display: flex; justify-content: space-between; align-items: center;
        padding: 16px; border-bottom: 1px solid var(--bn-gray-lighter);
        background: var(--bn-gray-100);
      }
      .notification-title { font-weight: 700; color: var(--bn-dark); }
      .notification-mark-read { 
        font-size: 12px; color: var(--bn-primary); background: none; 
        border: none; cursor: pointer; 
      }
      .notification-mark-read:hover { text-decoration: underline; }
      .notification-list { max-height: 400px; overflow-y: auto; }
      .notification-item {
        display: flex; gap: 12px; padding: 16px;
        border-bottom: 1px solid var(--bn-gray-lighter);
        cursor: pointer; transition: background 0.2s;
      }
      .notification-item:hover { background: var(--bn-gray-100); }
      .notification-item.unread { background: rgba(4, 120, 87, 0.05); }
      .notification-icon {
        width: 40px; height: 40px; border-radius: 50%;
        background: var(--bn-primary-light); color: var(--bn-primary);
        display: flex; align-items: center; justify-content: center;
        font-size: 16px; flex-shrink: 0;
      }
      .notification-content { flex: 1; min-width: 0; }
      .notification-text { 
        font-size: 14px; color: var(--bn-dark); 
        margin-bottom: 4px; line-height: 1.4;
      }
      .notification-time { font-size: 12px; color: var(--bn-gray); }
      .notification-loading, .notification-empty {
        padding: 32px; text-align: center; color: var(--bn-gray);
      }
      .notification-footer {
        display: block; text-align: center; padding: 12px;
        font-size: 13px; font-weight: 600; color: var(--bn-primary);
        text-decoration: none; border-top: 1px solid var(--bn-gray-lighter);
      }
      .notification-footer:hover { background: var(--bn-gray-100); }
    `;
    document.head.appendChild(style);
  }

  // Mark all read handler
  dropdown.querySelector('#markAllRead').addEventListener('click', async (e) => {
    e.stopPropagation();
    await markAllNotificationsRead();
    dropdown.querySelectorAll('.notification-item.unread').forEach(item => {
      item.classList.remove('unread');
    });
    const badge = document.getElementById('notificationBadge');
    if (badge) badge.style.display = 'none';
  });

  return dropdown;
}

// Load notifications
async function loadNotifications(userId, groupId) {
  const list = document.getElementById('notificationList');
  if (!list) return;

  list.innerHTML = '<div class="notification-loading">Loading...</div>';

  try {
    const notifications = [];

    // Load group notifications
    if (groupId) {
      const groupNotifRef = collection(db, `groups/${groupId}/notifications`);
      let groupNotifSnapshot;
      try {
        // Try querying with userId first
        groupNotifSnapshot = await getDocs(query(
          groupNotifRef, 
          where('userId', '==', userId),
          orderBy('createdAt', 'desc'), 
          limit(20)
        ));
      } catch (error) {
        // If userId query fails, try recipientId or get all and filter
        try {
          groupNotifSnapshot = await getDocs(query(
            groupNotifRef, 
            where('recipientId', '==', userId),
            orderBy('createdAt', 'desc'), 
            limit(20)
          ));
        } catch (err) {
          // Get all and filter
          groupNotifSnapshot = await getDocs(query(groupNotifRef, orderBy('createdAt', 'desc'), limit(20)));
        }
      }
      
      groupNotifSnapshot.forEach(doc => {
        const data = doc.data();
        // Check if notification is for this user
        const isForUser = (data.userId === userId) || (data.recipientId === userId);
        if (isForUser) {
          const isRead = data.read || data.readBy?.includes(userId) || false;
          notifications.push({
            id: doc.id,
            ...data,
            groupId: groupId,
            isRead,
            source: 'group'
          });
        }
      });
    }

    // Load user-specific notifications
    const userNotifRef = collection(db, `users/${userId}/notifications`);
    try {
      const userNotifSnapshot = await getDocs(query(userNotifRef, orderBy('createdAt', 'desc'), limit(10)));
      
      userNotifSnapshot.forEach(doc => {
        const data = doc.data();
        notifications.push({
          id: doc.id,
          ...data,
          isRead: data.read || false,
          source: 'user'
        });
      });
    } catch (e) {
      // User notifications collection might not exist
    }

    // Sort by date
    notifications.sort((a, b) => {
      const dateA = a.createdAt?.toDate?.() || new Date(0);
      const dateB = b.createdAt?.toDate?.() || new Date(0);
      return dateB - dateA;
    });

    // Render
    if (notifications.length === 0) {
      list.innerHTML = '<div class="notification-empty">No notifications</div>';
      return;
    }

    list.innerHTML = notifications.slice(0, 15).map(notif => {
      const icon = getNotificationIcon(notif.type);
      const timeAgo = getTimeAgo(notif.createdAt?.toDate?.() || new Date());
      const notifGroupId = notif.groupId || (notif.source === 'group' ? groupId : null);
      const notifUserId = notif.userId || notif.recipientId;
      
      return `
        <div class="notification-item ${notif.isRead ? '' : 'unread'}" 
             data-id="${notif.id}" 
             data-source="${notif.source}"
             data-group-id="${notifGroupId || ''}"
             data-user-id="${notifUserId || ''}"
             onclick="openNotification('${notif.id}', '${notifGroupId || ''}', '${notif.source}', '${escapeHtml(notif.title || 'Notification')}', '${escapeHtml(notif.message || '')}')">
          <div class="notification-icon">${icon}</div>
          <div class="notification-content">
            <div class="notification-text">${escapeHtml(notif.title || notif.message || 'Notification')}</div>
            <div class="notification-time">${timeAgo}</div>
          </div>
          <button class="notification-delete" 
                  onclick="event.stopPropagation(); deleteNotification('${notif.id}', '${notifGroupId || ''}', '${notif.source}');" 
                  title="Delete notification">
            ×
          </button>
        </div>
      `;
    }).join('');

    // Add delete button styles
    if (!document.getElementById('notificationDeleteStyles')) {
      const style = document.createElement('style');
      style.id = 'notificationDeleteStyles';
      style.textContent = `
        .notification-item { position: relative; }
        .notification-delete {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 24px;
          height: 24px;
          border: none;
          background: transparent;
          color: var(--bn-gray);
          font-size: 20px;
          cursor: pointer;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: all 0.2s;
        }
        .notification-item:hover .notification-delete {
          opacity: 1;
        }
        .notification-delete:hover {
          background: var(--bn-danger-light);
          color: var(--bn-danger);
        }
      `;
      document.head.appendChild(style);
    }

  } catch (error) {
    console.error('Error loading notifications:', error);
    list.innerHTML = '<div class="notification-empty">Error loading notifications</div>';
  }
}

// Load notification count
async function loadNotificationCount(userId, groupId, badgeElement) {
  if (!badgeElement) return;

  try {
    let unreadCount = 0;

    if (groupId) {
      const groupNotifRef = collection(db, `groups/${groupId}/notifications`);
      let groupNotifSnapshot;
      try {
        groupNotifSnapshot = await getDocs(query(groupNotifRef, orderBy('createdAt', 'desc'), limit(50)));
      } catch (error) {
        groupNotifSnapshot = { forEach: () => {} }; // Empty snapshot if query fails
      }
      
      groupNotifSnapshot.forEach(doc => {
        const data = doc.data();
        const isForUser = (data.userId === userId) || (data.recipientId === userId);
        if (isForUser && !data.read && !data.readBy?.includes(userId)) {
          unreadCount++;
        }
      });
    }

    if (unreadCount > 0) {
      badgeElement.style.display = 'block';
      badgeElement.textContent = unreadCount > 9 ? '9+' : unreadCount;
    } else {
      badgeElement.style.display = 'none';
    }
  } catch (error) {
    console.error('Error loading notification count:', error);
  }
}

// Setup realtime notifications
function setupRealtimeNotifications(userId, groupId, badgeElement) {
  if (notificationUnsubscribe) {
    notificationUnsubscribe();
  }

  try {
    const groupNotifRef = collection(db, `groups/${groupId}/notifications`);
    notificationUnsubscribe = onSnapshot(
      query(groupNotifRef, orderBy('createdAt', 'desc'), limit(50)),
      (snapshot) => {
        let unreadCount = 0;
        snapshot.forEach(doc => {
          const data = doc.data();
          const isForUser = (data.userId === userId) || (data.recipientId === userId);
          if (isForUser && !data.read && !data.readBy?.includes(userId)) {
            unreadCount++;
          }
        });

        if (badgeElement) {
          if (unreadCount > 0) {
            badgeElement.style.display = 'block';
            badgeElement.textContent = unreadCount > 9 ? '9+' : unreadCount;
          } else {
            badgeElement.style.display = 'none';
          }
        }
      },
      (error) => {
        console.error('Realtime notification error:', error);
      }
    );
  } catch (error) {
    console.error('Error setting up realtime notifications:', error);
  }
}

// Mark all notifications as read
async function markAllNotificationsRead() {
  // This would update the readBy array for all group notifications
  // Implementation depends on your exact requirements
  console.log('Mark all read triggered');
}

// Get notification icon based on type
function getNotificationIcon(type) {
  const icons = {
    'payment_approved': '✓',
    'payment_rejected': '✕',
    'payment_reminder': '💳',
    'loan_approved': '💰',
    'loan_rejected': '❌',
    'loan_reminder': '📢',
    'broadcast': '📣',
    'system': 'ℹ️',
    'welcome': '👋'
  };
  return icons[type] || '🔔';
}

// Get time ago string
function getTimeAgo(date) {
  if (!date) return '';
  
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString();
}

// Open notification (click handler)
async function openNotification(notifId, groupId, source, title, message) {
  try {
    // Mark as read - update both read flag and readBy array
    if (source === 'group' && groupId) {
      const userId = window.currentUser?.uid;
      if (userId) {
        const notificationRef = doc(db, `groups/${groupId}/notifications`, notifId);
        await updateDoc(notificationRef, {
          read: true,
          readAt: Timestamp.now(),
          readBy: arrayUnion(userId)
        });
        
        // Update badge count immediately
        const badgeElement = document.getElementById('notificationBadge');
        if (badgeElement) {
          await loadNotificationCount(userId, groupId, badgeElement);
        }
      }
    }
    
    // Open in modal or navigate to messages page
    // Create a simple modal to show notification
    const modal = document.createElement('div');
    modal.className = 'notification-modal';
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    `;
    
    modal.innerHTML = `
      <div style="background: white; border-radius: 12px; max-width: 500px; width: 100%; max-height: 90vh; overflow-y: auto;">
        <div style="padding: 20px; border-bottom: 1px solid var(--bn-gray-lighter); display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0; font-size: 18px; font-weight: 700;">${escapeHtml(title)}</h3>
          <button onclick="this.closest('.notification-modal').remove()" 
                  style="width: 32px; height: 32px; border: none; background: var(--bn-gray-100); border-radius: 50%; cursor: pointer; font-size: 20px;">×</button>
        </div>
        <div style="padding: 20px;">
          <p style="margin: 0; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(message)}</p>
        </div>
        <div style="padding: 16px; border-top: 1px solid var(--bn-gray-lighter); text-align: center;">
          <a href="messages.html" style="color: var(--bn-primary); text-decoration: none; font-weight: 600;">View All Messages</a>
        </div>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
    
    document.body.appendChild(modal);
    
    // Reload notifications to update read status and badge
    const currentUserId = window.currentUser?.uid;
    if (groupId && currentUserId) {
      const badgeElement = document.getElementById('notificationBadge');
      if (badgeElement) {
        await loadNotificationCount(currentUserId, groupId, badgeElement);
      }
      loadNotifications(currentUserId, groupId);
    }
  } catch (error) {
    console.error('Error opening notification:', error);
    // Fallback: navigate to messages page
    window.location.href = 'messages.html';
  }
}

// Delete notification
async function deleteNotification(notifId, groupId, source) {
  if (!confirm('Are you sure you want to delete this notification?')) {
    return;
  }

  try {
    if (source === 'group' && groupId) {
      const notificationRef = doc(db, `groups/${groupId}/notifications`, notifId);
      await deleteDoc(notificationRef);
    } else if (source === 'user') {
      const userId = document.querySelector(`[data-id="${notifId}"]`)?.dataset?.userId || null;
      if (userId) {
        const notificationRef = doc(db, `users/${userId}/notifications`, notifId);
        await deleteDoc(notificationRef);
      }
    }
    
    // Remove from DOM
    const item = document.querySelector(`[data-id="${notifId}"]`);
    if (item) {
      item.remove();
    }
    
    // Reload notifications
    const userId = window.currentUser?.uid;
    if (groupId && userId) {
      loadNotifications(userId, groupId);
      loadNotificationCount(userId, groupId, document.getElementById('notificationBadge'));
    }
  } catch (error) {
    console.error('Error deleting notification:', error);
    alert('Error deleting notification');
  }
}

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make functions available globally
window.openNotification = openNotification;
window.deleteNotification = deleteNotification;

// Cleanup
export function cleanupNotifications() {
  if (notificationUnsubscribe) {
    notificationUnsubscribe();
    notificationUnsubscribe = null;
  }
}
