/**
 * Broadcast Notifications - Admin Interface
 * Allows admins to send notifications to group members
 */

import {
  db,
  auth,
  collection,
  doc,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  onAuthStateChanged,
  writeBatch,
} from './firebaseConfig.js';

let currentUser = null;
let adminGroups = [];
let currentGroupId = null;

document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('backBtn');
  const groupSelector = document.getElementById('groupSelector');
  const broadcastForm = document.getElementById('broadcastForm');
  const recentBroadcasts = document.getElementById('recentBroadcasts');
  const spinner = document.getElementById('spinner');

  // Back button
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = 'admin_dashboard.html';
    });
  }

  // Auth state listener
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      await loadAdminGroups();
      await loadRecentBroadcasts();
    } else {
      window.location.href = '../login.html';
    }
  });

  // Form submission
  if (broadcastForm) {
    broadcastForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await sendBroadcast();
    });
  }

  // Group selector change
  if (groupSelector) {
    groupSelector.addEventListener('change', (e) => {
      currentGroupId = e.target.value;
      sessionStorage.setItem('selectedGroupId', currentGroupId);
    });
  }

  /**
   * Load admin groups
   */
  async function loadAdminGroups() {
    try {
      showSpinner(true);
      adminGroups = [];
      
      // Get selected group from session
      const selectedGroupId = sessionStorage.getItem('selectedGroupId');
      
      // Get groups where user is creator
      const groupsRef = collection(db, 'groups');
      const groupsSnapshot = await getDocs(groupsRef);
      
      groupsSnapshot.forEach(doc => {
        const groupData = doc.data();
        const groupId = doc.id;
        const isAdmin = groupData.createdBy === currentUser.uid || 
                       (groupData.admins && groupData.admins.some(admin => admin.uid === currentUser.uid));
        
        if (isAdmin) {
          adminGroups.push({ ...groupData, groupId });
        }
      });

      // Populate group selector
      if (groupSelector) {
        groupSelector.innerHTML = '<option value="">Select a group...</option>';
        adminGroups.forEach(group => {
          const option = document.createElement('option');
          option.value = group.groupId;
          option.textContent = group.groupName;
          if (selectedGroupId === group.groupId) {
            option.selected = true;
            currentGroupId = group.groupId;
          }
          groupSelector.appendChild(option);
        });
      }
    } catch (error) {
      console.error('Error loading groups:', error);
      showToast('Error loading groups. Please try again.', 'error');
    } finally {
      showSpinner(false);
    }
  }

  /**
   * Send broadcast notification
   */
  async function sendBroadcast() {
    try {
      const messageType = document.getElementById('messageType')?.value;
      const title = document.getElementById('messageSubject')?.value.trim();
      const message = document.getElementById('messageBody')?.value.trim();
      const recipientsType = document.querySelector('input[name="recipients"]:checked')?.value || 'all';

      // Use selected group from session or selector
      const groupId = currentGroupId || groupSelector?.value || sessionStorage.getItem('selectedGroupId');
      
      if (!groupId) {
        showToast('Please select a group first', 'error');
        return;
      }

      if (!title || !message) {
        showToast('Please fill in all required fields', 'error');
        return;
      }

      showSpinner(true);

      // Get group data
      const groupDoc = await getDoc(doc(db, 'groups', groupId));
      if (!groupDoc.exists()) {
        showToast('Group not found', 'error');
        return;
      }

      const groupData = groupDoc.data();

      // Get all members of the group
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      let memberDocs = membersSnapshot.docs;

      // Filter recipients based on selection
      if (recipientsType === 'admins') {
        const adminIds = groupData.admins?.map(a => a.uid) || [];
        memberDocs = memberDocs.filter(doc => adminIds.includes(doc.id));
      } else if (recipientsType === 'members') {
        const adminIds = groupData.admins?.map(a => a.uid) || [];
        memberDocs = memberDocs.filter(doc => !adminIds.includes(doc.id));
      }

      if (memberDocs.length === 0) {
        showToast('No recipients found for this selection', 'error');
        showSpinner(false);
        return;
      }

      // Get sender name
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      const senderName = userDoc.exists() ? userDoc.data().fullName : currentUser.email;

      // Create notification for each member using batch write
      const batch = writeBatch(db);

      for (const memberDoc of memberDocs) {
        const memberId = memberDoc.id;
        const notificationRef = doc(collection(db, `groups/${groupId}/notifications`));
        
        batch.set(notificationRef, {
          notificationId: notificationRef.id,
          groupId,
          groupName: groupData.groupName || 'Unknown Group',
          recipientId: memberId,
          senderId: currentUser.uid,
          senderName: senderName,
          senderEmail: currentUser.email,
          title,
          message,
          type: messageType || 'info',
          allowReplies: true,
          read: false,
          createdAt: Timestamp.now(),
          replies: []
        });
      }

      // Commit all notifications
      await batch.commit();

      // Also create a broadcast record for tracking
      await addDoc(collection(db, `groups/${groupId}/broadcasts`), {
        broadcastId: `broadcast_${Date.now()}`,
        groupId,
        groupName: groupData.groupName || 'Unknown Group',
        senderId: currentUser.uid,
        senderName: senderName,
        title,
        message,
        type: messageType || 'info',
        recipientsCount: memberDocs.length,
        createdAt: Timestamp.now()
      });

      showToast(`Broadcast sent successfully to ${memberDocs.length} member(s)!`, 'success');
      
      // Reset form
      if (broadcastForm) {
        broadcastForm.reset();
        // Keep group selected
        if (groupSelector) groupSelector.value = groupId;
      }
      
      // Reload recent broadcasts
      await loadRecentBroadcasts();

    } catch (error) {
      console.error('Error sending broadcast:', error);
      showToast('Error sending broadcast: ' + error.message, 'error');
    } finally {
      showSpinner(false);
    }
  }

  /**
   * Load recent broadcasts
   */
  async function loadRecentBroadcasts() {
    try {
      if (!recentBroadcasts) return;

      recentBroadcasts.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><p class="empty-state-text">Loading...</p></div>';

      if (adminGroups.length === 0) {
        recentBroadcasts.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📢</div><p class="empty-state-text">No broadcasts yet</p></div>';
        return;
      }

      // Get broadcasts from all admin groups
      const allBroadcasts = [];
      for (const group of adminGroups) {
        try {
          const broadcastsRef = collection(db, `groups/${group.groupId}/broadcasts`);
          const q = query(broadcastsRef, orderBy('createdAt', 'desc'), limit(10));
          const snapshot = await getDocs(q);
          
          snapshot.forEach(doc => {
            allBroadcasts.push({ ...doc.data(), id: doc.id, groupId: group.groupId });
          });
        } catch (error) {
          // Collection might not exist yet
          console.log(`No broadcasts found for group ${group.groupId}`);
        }
      }

      // Sort by date
      allBroadcasts.sort((a, b) => {
        const aTime = a.createdAt?.toMillis() || 0;
        const bTime = b.createdAt?.toMillis() || 0;
        return bTime - aTime;
      });

      if (allBroadcasts.length === 0) {
        recentBroadcasts.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📢</div><p class="empty-state-text">No broadcasts yet</p></div>';
        return;
      }

      recentBroadcasts.innerHTML = '';
      allBroadcasts.slice(0, 10).forEach(broadcast => {
        const broadcastElement = createBroadcastElement(broadcast);
        recentBroadcasts.appendChild(broadcastElement);
      });
    } catch (error) {
      console.error('Error loading recent broadcasts:', error);
      if (recentBroadcasts) {
        recentBroadcasts.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p class="empty-state-text">Error loading broadcasts</p></div>';
      }
    }
  }

  /**
   * Create broadcast element
   */
  function createBroadcastElement(broadcast) {
    const div = document.createElement('div');
    div.className = 'list-item';
    
    const date = broadcast.createdAt?.toDate() || new Date();
    const dateStr = date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    div.innerHTML = `
      <div style="flex: 1;">
        <div class="list-item-title">${escapeHtml(broadcast.title || 'No title')}</div>
        <div class="list-item-subtitle">${escapeHtml(broadcast.groupName || 'Unknown')} • ${broadcast.recipientsCount || 0} recipients • ${dateStr}</div>
      </div>
      <span class="badge badge-${broadcast.type || 'info'}">${broadcast.type || 'info'}</span>
    `;

    return div;
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
    const toastContainer = document.getElementById('toastContainer');
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
});
