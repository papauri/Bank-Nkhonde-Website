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
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  onAuthStateChanged,
} from './firebaseConfig.js';

// Notification templates
const notificationTemplates = {
  payment_reminder: {
    title: 'Payment Reminder',
    message: `Dear Members,

This is a reminder that your monthly contribution payment is due soon. Please ensure you submit your payment before the deadline to avoid penalties.

If you have already made your payment, please upload the proof of payment through the app.

Thank you for your cooperation.`,
    type: 'warning'
  },
  meeting_announcement: {
    title: 'Group Meeting Announcement',
    message: `Dear Members,

We would like to inform you about an upcoming group meeting. Please make arrangements to attend as important matters will be discussed.

Meeting details will be shared separately.

Looking forward to seeing you all.`,
    type: 'info'
  },
  loan_available: {
    title: 'Loan Opportunity Available',
    message: `Dear Members,

A loan opportunity is now available for eligible members. If you are interested in applying for a loan, please submit your application through the app.

Loan terms and conditions apply.`,
    type: 'info'
  },
  payment_received: {
    title: 'Payment Confirmed',
    message: `Dear Members,

We are pleased to confirm that payments have been received and processed. Thank you for your timely contributions.

Your payment status has been updated in the system.`,
    type: 'success'
  },
  custom: {
    title: '',
    message: '',
    type: 'info'
  }
};

let currentUser = null;
let adminGroups = [];

document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('backBtn');
  const groupSelect = document.getElementById('groupSelect');
  const broadcastForm = document.getElementById('broadcastForm');
  const templateCards = document.querySelectorAll('.template-card');
  const sendBroadcastBtn = document.getElementById('sendBroadcastBtn');

  // Back button
  backBtn.addEventListener('click', () => {
    window.location.href = 'admin_dashboard.html';
  });

  // Template cards
  templateCards.forEach(card => {
    card.addEventListener('click', () => {
      const template = card.dataset.template;
      loadTemplate(template);
    });
  });

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
  broadcastForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await sendBroadcast();
  });

  /**
   * Load template into form
   */
  function loadTemplate(templateKey) {
    const template = notificationTemplates[templateKey];
    if (template) {
      document.getElementById('notificationTitle').value = template.title;
      document.getElementById('notificationMessage').value = template.message;
      document.getElementById('notificationType').value = template.type;
      
      // Scroll to form
      document.getElementById('broadcastForm').scrollIntoView({ behavior: 'smooth' });
    }
  }

  /**
   * Load admin groups
   */
  async function loadAdminGroups() {
    try {
      adminGroups = [];
      const groupsSnapshot = await getDocs(collection(db, 'groups'));
      
      groupsSnapshot.forEach(doc => {
        const groupData = doc.data();
        if (groupData.admins && groupData.admins.some(admin => admin.uid === currentUser.uid)) {
          adminGroups.push({ ...groupData, groupId: doc.id });
        }
      });

      // Populate group select
      groupSelect.innerHTML = '<option value="">Choose a group...</option>';
      adminGroups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.groupId;
        option.textContent = group.groupName;
        groupSelect.appendChild(option);
      });
    } catch (error) {
      console.error('Error loading groups:', error);
      alert('Error loading groups. Please try again.');
    }
  }

  /**
   * Send broadcast notification
   */
  async function sendBroadcast() {
    try {
      const groupId = groupSelect.value;
      const title = document.getElementById('notificationTitle').value.trim();
      const message = document.getElementById('notificationMessage').value.trim();
      const type = document.getElementById('notificationType').value;
      const allowReplies = document.getElementById('allowReplies').checked;

      if (!groupId || !title || !message) {
        alert('Please fill in all required fields.');
        return;
      }

      sendBroadcastBtn.disabled = true;
      sendBroadcastBtn.textContent = 'Sending...';

      // Get all members of the group
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      const memberIds = membersSnapshot.docs.map(doc => doc.id);

      if (memberIds.length === 0) {
        alert('No members found in this group.');
        sendBroadcastBtn.disabled = false;
        sendBroadcastBtn.textContent = 'Send Broadcast';
        return;
      }

      // Get group data
      const groupDoc = await getDocs(query(collection(db, 'groups'), where('__name__', '==', groupId)));
      const groupData = groupDoc.docs[0]?.data();

      // Create notification for each member using batch write
      const batch = writeBatch(db);
      const notificationIds = [];

      for (const memberId of memberIds) {
        const notificationRef = doc(collection(db, `groups/${groupId}/notifications`));
        notificationIds.push(notificationRef.id);
        
        batch.set(notificationRef, {
          notificationId: notificationRef.id,
          groupId,
          groupName: groupData?.groupName || 'Unknown Group',
          recipientId: memberId,
          senderId: currentUser.uid,
          senderName: currentUser.displayName || 'Admin',
          senderEmail: currentUser.email,
          title,
          message,
          type,
          allowReplies,
          read: false,
          createdAt: Timestamp.now(),
          replies: []
        });
      }

      // Commit all notifications at once
      await batch.commit();

      // Also create a broadcast record for tracking
      await addDoc(collection(db, `groups/${groupId}/broadcasts`), {
        broadcastId: `broadcast_${Date.now()}`,
        groupId,
        groupName: groupData?.groupName || 'Unknown Group',
        senderId: currentUser.uid,
        senderName: currentUser.displayName || 'Admin',
        title,
        message,
        type,
        allowReplies,
        recipientsCount: memberIds.length,
        createdAt: Timestamp.now()
      });

      alert(`Broadcast sent successfully to ${memberIds.length} member(s)!`);
      
      // Reset form
      broadcastForm.reset();
      document.getElementById('allowReplies').checked = true;
      
      // Reload recent broadcasts
      await loadRecentBroadcasts();

      sendBroadcastBtn.disabled = false;
      sendBroadcastBtn.textContent = 'Send Broadcast';
    } catch (error) {
      console.error('Error sending broadcast:', error);
      alert('Error sending broadcast. Please try again.');
      sendBroadcastBtn.disabled = false;
      sendBroadcastBtn.textContent = 'Send Broadcast';
    }
  }

  /**
   * Load recent broadcasts
   */
  async function loadRecentBroadcasts() {
    try {
      const recentBroadcastsList = document.getElementById('recentBroadcastsList');
      recentBroadcastsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><p class="empty-state-text">Loading...</p></div>';

      if (adminGroups.length === 0) {
        recentBroadcastsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📢</div><p class="empty-state-text">No broadcasts yet</p></div>';
        return;
      }

      // Get broadcasts from all admin groups
      const allBroadcasts = [];
      for (const group of adminGroups) {
        try {
          const broadcastsRef = collection(db, `groups/${group.groupId}/broadcasts`);
          const q = query(broadcastsRef, orderBy('createdAt', 'desc'), limit(5));
          const snapshot = await getDocs(q);
          
          snapshot.forEach(doc => {
            allBroadcasts.push({ ...doc.data(), id: doc.id, groupId: group.groupId });
          });
        } catch (error) {
          console.error(`Error loading broadcasts for group ${group.groupId}:`, error);
        }
      }

      // Sort by date
      allBroadcasts.sort((a, b) => {
        const aTime = a.createdAt?.toMillis() || 0;
        const bTime = b.createdAt?.toMillis() || 0;
        return bTime - aTime;
      });

      if (allBroadcasts.length === 0) {
        recentBroadcastsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📢</div><p class="empty-state-text">No broadcasts yet</p></div>';
        return;
      }

      recentBroadcastsList.innerHTML = '';
      allBroadcasts.slice(0, 10).forEach(broadcast => {
        const broadcastElement = createBroadcastElement(broadcast);
        recentBroadcastsList.appendChild(broadcastElement);
      });
    } catch (error) {
      console.error('Error loading recent broadcasts:', error);
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
        <div class="list-item-title">${broadcast.title}</div>
        <div class="list-item-subtitle">${broadcast.groupName} • ${broadcast.recipientsCount} recipients • ${dateStr}</div>
      </div>
      <div class="badge badge-${broadcast.type || 'info'}">${broadcast.type || 'info'}</div>
    `;

    return div;
  }
});
