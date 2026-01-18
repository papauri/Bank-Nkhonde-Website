/**
 * Notifications Handler
 * Handles notification bell, dropdown, and notification fetching
 */

import {
  db,
  auth,
  collection,
  getDocs,
  getDoc,
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
  writeBatch,
} from "./firebaseConfig.js";
import { playNotificationSound } from "./notification-sounds.js";

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
    const isMobile = window.innerWidth <= 768;
    const overlay = dropdown._overlay;
    
    if (isOpen) {
      // Close dropdown
      dropdown.classList.remove('show');
      dropdown.style.display = 'none';
      dropdown.style.opacity = '0';
      dropdown.style.visibility = 'hidden';
      if (overlay) {
        overlay.style.display = 'none';
        overlay.style.opacity = '0';
        overlay.style.visibility = 'hidden';
      }
      document.body.style.overflow = '';
    } else {
      // Open dropdown
      dropdown.classList.add('show');
      dropdown.style.display = 'block';
      dropdown.style.opacity = '1';
      dropdown.style.visibility = 'visible';
      if (isMobile && overlay) {
        overlay.style.display = 'block';
        overlay.style.opacity = '1';
        overlay.style.visibility = 'visible';
        overlay.style.pointerEvents = 'all';
        document.body.style.overflow = 'hidden';
      }
      loadNotifications(userId, groupId);
    }
  });

  // Close button handler
  const closeBtn = dropdown.querySelector('#notificationCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.remove('show');
      dropdown.style.display = 'none';
      dropdown.style.opacity = '0';
      dropdown.style.visibility = 'hidden';
      const overlay = dropdown._overlay;
      if (overlay) {
        overlay.style.display = 'none';
        overlay.style.opacity = '0';
        overlay.style.visibility = 'hidden';
      }
      document.body.style.overflow = '';
    });
  }

  // Close on outside click (desktop only - mobile uses overlay)
  document.addEventListener('click', (e) => {
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) {
      if (!dropdown.contains(e.target) && !notificationBtn.contains(e.target)) {
        dropdown.classList.remove('show');
        dropdown.style.display = 'none';
        dropdown.style.opacity = '0';
        dropdown.style.visibility = 'hidden';
      }
    }
  });
  
  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dropdown.classList.contains('show')) {
      dropdown.classList.remove('show');
      dropdown.style.display = 'none';
      dropdown.style.opacity = '0';
      dropdown.style.visibility = 'hidden';
      const overlay = dropdown._overlay;
        if (overlay) {
          overlay.style.display = 'none';
          overlay.style.opacity = '0';
          overlay.style.visibility = 'hidden';
          overlay.style.pointerEvents = 'none';
        }
        document.body.style.overflow = '';
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
  // Declare overlay variable at the top to ensure it's in scope
  let overlay = null;
  
  // Check if dropdown already exists and remove it
  const existingDropdown = document.getElementById('notificationDropdown');
  if (existingDropdown) {
    existingDropdown.remove();
  }
  
  // Check if overlay exists and remove it
  const existingOverlay = document.querySelector('.notification-dropdown-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }
  
  const dropdown = document.createElement('div');
  dropdown.id = 'notificationDropdown';
  dropdown.className = 'notification-dropdown';
  dropdown.innerHTML = `
    <div class="notification-header">
      <span class="notification-title">Notifications</span>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="notification-mark-read" id="markAllRead">Mark all read</button>
        <button class="notification-close" id="notificationCloseBtn" aria-label="Close">×</button>
      </div>
    </div>
    <div class="notification-list" id="notificationList">
      <div class="notification-loading">Loading...</div>
    </div>
    <a href="messages.html" class="notification-footer">View All Messages</a>
  `;
  
  // Add styles - responsive positioning
  const isMobile = window.innerWidth <= 768;
  dropdown.style.cssText = isMobile ? `
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    width: 90vw !important;
    max-width: 420px !important;
    max-height: 85vh !important;
    background: white !important;
    border: 1px solid var(--bn-gray-lighter) !important;
    border-radius: var(--bn-radius-xl) !important;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
    z-index: 10001 !important;
    display: none !important;
    overflow: hidden !important;
    opacity: 1 !important;
    visibility: visible !important;
  ` : `
    position: absolute !important;
    top: 100% !important;
    right: 0 !important;
    width: 360px !important;
    max-width: 90vw !important;
    background: white !important;
    border: 1px solid var(--bn-gray-lighter) !important;
    border-radius: var(--bn-radius-xl) !important;
    box-shadow: var(--bn-shadow-lg) !important;
    z-index: 1000 !important;
    display: none !important;
    overflow: hidden !important;
    margin-top: 8px !important;
  `;

  // Create overlay for mobile
  if (isMobile) {
    overlay = document.createElement('div');
    overlay.className = 'notification-dropdown-overlay';
    overlay.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      background: rgba(10, 22, 40, 0.75) !important;
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
      z-index: 10000 !important;
      display: none !important;
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: all !important;
    `;
    overlay.addEventListener('click', () => {
      dropdown.classList.remove('show');
      dropdown.style.display = 'none';
      dropdown.style.opacity = '0';
      dropdown.style.visibility = 'hidden';
      if (overlay) {
        overlay.style.display = 'none';
        overlay.style.opacity = '0';
        overlay.style.visibility = 'hidden';
        overlay.style.pointerEvents = 'none';
      }
      document.body.style.overflow = '';
    });
    document.body.appendChild(overlay);
  }
  
  // Store overlay reference on dropdown for access in event handlers
  dropdown._overlay = overlay;

  // Add CSS for dropdown
  if (!document.getElementById('notificationStyles')) {
    const style = document.createElement('style');
    style.id = 'notificationStyles';
    style.textContent = `
      .notification-dropdown.show { 
        display: block !important; 
        opacity: 1 !important;
        visibility: visible !important;
      }
      .notification-dropdown-overlay.show { 
        display: block !important; 
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: all !important;
      }
      
      .notification-header { 
        display: flex; justify-content: space-between; align-items: center;
        padding: 16px; border-bottom: 1px solid var(--bn-gray-lighter);
        background: var(--bn-gray-100);
        position: relative;
      }
      
      .notification-header .notification-close {
        display: none;
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
      
      /* Mobile styles */
      @media (max-width: 768px) {
        .notification-dropdown {
          position: fixed !important;
          top: 50% !important;
          left: 50% !important;
          transform: translate(-50%, -50%) !important;
          width: 90vw !important;
          max-width: 420px !important;
          max-height: 85vh !important;
          z-index: 10001 !important;
          background: white !important;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
        }
        
        .notification-dropdown.show {
          display: block !important;
          opacity: 1 !important;
          visibility: visible !important;
        }
        
        .notification-dropdown-overlay {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          background: rgba(10, 22, 40, 0.75) !important;
          backdrop-filter: blur(8px) !important;
          -webkit-backdrop-filter: blur(8px) !important;
          z-index: 10000 !important;
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
        
        .notification-dropdown-overlay.show {
          display: block !important;
          opacity: 1 !important;
          visibility: visible !important;
          pointer-events: all !important;
        }
        
        .notification-header .notification-close {
          display: flex !important;
        }
        
        .notification-list {
          max-height: calc(85vh - 140px) !important;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch !important;
        }
        
        .notification-header {
          padding: 12px 16px;
        }
        
        .notification-header .notification-close {
          display: flex !important;
          width: 32px;
          height: 32px;
          align-items: center;
          justify-content: center;
          border: none;
          background: transparent;
          border-radius: 50%;
          cursor: pointer;
          color: var(--bn-gray);
          font-size: 20px;
          padding: 0;
        }
        
        .notification-header .notification-close:hover {
          background: var(--bn-gray-200);
          color: var(--bn-dark);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Mark all read handler
  const markAllReadBtn = dropdown.querySelector('#markAllRead');
  if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      // Disable button during operation
      const originalText = markAllReadBtn.textContent;
      markAllReadBtn.disabled = true;
      markAllReadBtn.textContent = 'Marking...';
      
      try {
        const count = await markAllNotificationsRead();
        
        // Reload notifications after marking as read
        const currentUserId = auth.currentUser?.uid || window.currentUser?.uid;
        const selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
        
        if (count > 0) {
          // Update UI immediately
          dropdown.querySelectorAll('.notification-item.unread').forEach(item => {
            item.classList.remove('unread');
          });
          
          // Remove unread items from list on mobile
          const isMobile = window.innerWidth <= 768;
          if (isMobile) {
            dropdown.querySelectorAll('.notification-item.unread').forEach(item => {
              item.remove();
            });
          }
          
          const badge = document.getElementById('notificationBadge');
          if (badge) badge.style.display = 'none';
          
          // Hide "Mark all as read" button if no unread notifications
          markAllReadBtn.style.display = 'none';
          
          // Reload notifications to update the list
          if (currentUserId && selectedGroupId) {
            await loadNotifications(currentUserId, selectedGroupId);
          }
        } else {
          // No notifications to mark
          markAllReadBtn.style.display = 'none';
        }
      } catch (error) {
        console.error('Error marking all as read:', error);
        alert('Error marking notifications as read. Please try again.');
      } finally {
        // Re-enable button
        markAllReadBtn.disabled = false;
        markAllReadBtn.textContent = originalText;
      }
    });
  }

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
          // Check if notification is read (using both read flag and readBy array)
          const isRead = data.read === true || data.readBy?.includes(userId);
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
        // Check if notification is read (using both read flag and readBy array)
        const isRead = data.read === true || data.readBy?.includes(userId);
        notifications.push({
          id: doc.id,
          ...data,
          isRead,
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

    // Filter unread notifications for mobile
    const isMobile = window.innerWidth <= 768;
    const unreadNotifications = notifications.filter(notif => !notif.isRead);
    const notificationsToShow = isMobile ? unreadNotifications : notifications;

    // Update "Mark all as read" button visibility
    const markAllReadBtn = document.getElementById('markAllRead');
    if (markAllReadBtn) {
      if (unreadNotifications.length === 0) {
        markAllReadBtn.style.display = 'none';
      } else {
        markAllReadBtn.style.display = 'block';
      }
    }

    // Render
    if (notificationsToShow.length === 0) {
      if (isMobile && unreadNotifications.length === 0 && notifications.length > 0) {
        list.innerHTML = '<div class="notification-empty">No unread notifications</div>';
      } else {
        list.innerHTML = '<div class="notification-empty">No notifications</div>';
      }
      return;
    }

    list.innerHTML = notificationsToShow.slice(0, 15).map(notif => {
      const icon = getNotificationIcon(notif.type);
      const timeAgo = getTimeAgo(notif.createdAt?.toDate?.() || new Date());
      const notifGroupId = notif.groupId || (notif.source === 'group' ? groupId : null);
      const notifUserId = notif.userId || notif.recipientId;
      
      // Escape JavaScript string values properly for onclick attributes
      const safeId = (notif.id || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
      const safeGroupId = (notifGroupId || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
      const safeSource = (notif.source || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
      const safeTitle = (notif.title || 'Notification').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, '');
      const safeMessage = (notif.message || '').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, '');
      
      return `
        <div class="notification-item ${notif.isRead ? '' : 'unread'}" 
             data-id="${notif.id}" 
             data-source="${notif.source}"
             data-group-id="${notifGroupId || ''}"
             data-user-id="${notifUserId || ''}"
             onclick="openNotification('${safeId}', '${safeGroupId}', '${safeSource}', '${safeTitle}', '${safeMessage}')">
          <div class="notification-icon">${icon}</div>
          <div class="notification-content">
            <div class="notification-text">${escapeHtml(notif.title || notif.message || 'Notification')}</div>
            <div class="notification-time">${timeAgo}</div>
          </div>
          <button class="notification-delete" 
                  onclick="event.stopPropagation(); deleteNotification('${safeId}', '${safeGroupId}', '${safeSource}');" 
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
        groupNotifSnapshot = await getDocs(query(groupNotifRef, orderBy('createdAt', 'desc'), limit(100)));
      } catch (error) {
        // If ordering fails, get all without order
        try {
          groupNotifSnapshot = await getDocs(groupNotifRef);
        } catch (err) {
          groupNotifSnapshot = { forEach: () => {} }; // Empty snapshot if query fails
        }
      }
      
      groupNotifSnapshot.forEach(doc => {
        const data = doc.data();
        const isForUser = (data.userId === userId) || (data.recipientId === userId);
        if (isForUser) {
          // Check if notification is unread
          const isRead = data.read === true || data.readBy?.includes(userId);
          if (!isRead) {
            unreadCount++;
          }
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
    let notificationQuery;
    try {
      notificationQuery = query(groupNotifRef, orderBy('createdAt', 'desc'), limit(100));
    } catch (error) {
      // If ordering fails, get all without order
      notificationQuery = groupNotifRef;
    }
    
    notificationUnsubscribe = onSnapshot(
      notificationQuery,
      (snapshot) => {
        let unreadCount = 0;
        snapshot.forEach(doc => {
          const data = doc.data();
          const isForUser = (data.userId === userId) || (data.recipientId === userId);
          if (isForUser) {
            // Check if notification is unread (using both read flag and readBy array)
            const isRead = data.read === true || data.readBy?.includes(userId);
            if (!isRead) {
              unreadCount++;
            }
          }
        });

        if (badgeElement) {
          const previousCount = parseInt(badgeElement.textContent) || 0;
          if (unreadCount > 0) {
            badgeElement.style.display = 'block';
            badgeElement.textContent = unreadCount > 9 ? '9+' : unreadCount;
            
            // Play sound if new notification arrived
            if (unreadCount > previousCount) {
              playNotificationSound();
              
              // Show browser notification if permission granted
              if (Notification.permission === 'granted' && localStorage.getItem('pushNotificationsEnabled') === 'true') {
                showBrowserNotification('New Notification', 'You have a new notification');
              }
            }
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

/**
 * Show browser notification
 */
function showBrowserNotification(title, body, data = {}) {
  if (!('Notification' in window)) {
    return;
  }
  
  if (Notification.permission === 'granted') {
    const notification = new Notification(title, {
      body,
      icon: '/assets/favicon.png',
      badge: '/assets/favicon.png',
      tag: 'bank-nkhonde-notification',
      requireInteraction: false,
      silent: false,
      vibrate: [200, 100, 200],
      data
    });
    
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    
    // Auto-close after 5 seconds
    setTimeout(() => {
      notification.close();
    }, 5000);
  }
}

// Mark all notifications as read
async function markAllNotificationsRead() {
  try {
    // Get userId from auth.currentUser first, then fallback to window.currentUser
    const userId = auth.currentUser?.uid || window.currentUser?.uid;
    if (!userId) {
      console.error('No user ID available for marking notifications as read');
      return 0;
    }
    
    const selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
    if (!selectedGroupId) return 0;
    
    // Get all notifications for this user in this group and filter unread ones
    const groupNotifRef = collection(db, `groups/${selectedGroupId}/notifications`);
    let allSnapshot;
    try {
      // Try to get all notifications ordered by date
      allSnapshot = await getDocs(query(groupNotifRef, orderBy('createdAt', 'desc'), limit(100)));
    } catch (error) {
      // If ordering fails, get all without order
      allSnapshot = await getDocs(groupNotifRef);
    }
    
    // Filter for unread notifications for this user
    const unreadDocs = allSnapshot.docs.filter(docSnap => {
      const data = docSnap.data();
      const isForUser = (data.userId === userId) || (data.recipientId === userId);
      if (!isForUser) return false;
      
      // Check if notification is unread
      const isRead = data.read === true || data.readBy?.includes(userId);
      return !isRead;
    });
    
    if (unreadDocs.length === 0) {
      return 0;
    }
    
    // Mark all as read using batch
    const batch = writeBatch(db);
    let updateCount = 0;
    
    unreadDocs.forEach((docSnap) => {
      const notificationRef = doc(db, `groups/${selectedGroupId}/notifications`, docSnap.id);
      const currentData = docSnap.data();
      const currentReadBy = currentData.readBy || [];
      
      // Only update if not already read by this user
      if (!currentReadBy.includes(userId)) {
        batch.update(notificationRef, {
          read: true,
          readAt: Timestamp.now(),
          readBy: arrayUnion(userId)
        });
        updateCount++;
      }
    });
    
    if (updateCount > 0) {
      await batch.commit();
      
      // Wait a bit for Firestore to propagate changes
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Reload notifications immediately
    const badgeElement = document.getElementById('notificationBadge');
    if (badgeElement) {
      await loadNotificationCount(userId, selectedGroupId, badgeElement);
    }
    
    await loadNotifications(userId, selectedGroupId);
    
    // Reload dashboard notifications if on user dashboard
    if (window.loadDashboardNotifications) {
      await window.loadDashboardNotifications(userId, selectedGroupId);
    }
    
    return updateCount;
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
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
    // Play notification sound if enabled
    try {
      const { playNotificationSound } = await import('./notification-sounds.js');
      playNotificationSound();
    } catch (error) {
      console.log('Could not play notification sound:', error);
    }
    
    // Mark as read - update both read flag and readBy array
    if (source === 'group' && groupId) {
      // Get userId from auth.currentUser first, then fallback to window.currentUser
      const userId = auth.currentUser?.uid || window.currentUser?.uid;
      if (userId) {
        const notificationRef = doc(db, `groups/${groupId}/notifications`, notifId);
        
        // First check if it's already read to avoid unnecessary updates
        const notifDoc = await getDoc(notificationRef);
        if (notifDoc.exists()) {
          const currentData = notifDoc.data();
          const isAlreadyRead = currentData.read === true || currentData.readBy?.includes(userId);
          
          if (!isAlreadyRead) {
            await updateDoc(notificationRef, {
              read: true,
              readAt: Timestamp.now(),
              readBy: arrayUnion(userId)
            });
            
            // Wait a bit for Firestore to propagate changes
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        
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
    const currentUserId = auth.currentUser?.uid || window.currentUser?.uid;
    if (groupId && currentUserId) {
      const badgeElement = document.getElementById('notificationBadge');
      if (badgeElement) {
        await loadNotificationCount(currentUserId, groupId, badgeElement);
      }
      
      // Remove notification from list on mobile if it becomes read
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        const notificationItem = document.querySelector(`[data-id="${notifId}"]`);
        if (notificationItem) {
          notificationItem.remove();
        }
      }
      
      await loadNotifications(currentUserId, groupId);
      
      // Reload dashboard notifications if on user dashboard
      if (window.loadDashboardNotifications) {
        await window.loadDashboardNotifications(currentUserId, groupId);
      }
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
    const userId = auth.currentUser?.uid || window.currentUser?.uid;
    if (groupId && userId) {
      await loadNotifications(userId, groupId);
      await loadNotificationCount(userId, groupId, document.getElementById('notificationBadge'));
      
      // Check if "Mark all as read" should be hidden
      const markAllReadBtn = document.getElementById('markAllRead');
      if (markAllReadBtn) {
        const unreadItems = document.querySelectorAll('.notification-item.unread');
        if (unreadItems.length === 0) {
          markAllReadBtn.style.display = 'none';
        } else {
          markAllReadBtn.style.display = 'block';
        }
      }
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
window.loadNotifications = loadNotifications;
window.loadNotificationCount = loadNotificationCount;
window.markAllNotificationsRead = markAllNotificationsRead;

// Cleanup
export function cleanupNotifications() {
  if (notificationUnsubscribe) {
    notificationUnsubscribe();
    notificationUnsubscribe = null;
  }
}
