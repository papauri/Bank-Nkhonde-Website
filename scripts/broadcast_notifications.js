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
  const backBtn = document.querySelector('.page-back-btn');
  const groupSelector = document.getElementById('groupSelector');
  const broadcastForm = document.getElementById('broadcastForm');
  const recentBroadcasts = document.getElementById('recentBroadcasts');
  const spinner = document.getElementById('spinner');
  const messageType = document.getElementById('messageType');
  const paymentType = document.getElementById('paymentType');
  const paymentTypeGroup = document.getElementById('paymentTypeGroup');
  const templateGroup = document.getElementById('templateGroup');
  const messageTemplate = document.getElementById('messageTemplate');
  const dueDateGroup = document.getElementById('dueDateGroup');
  const dueDate = document.getElementById('dueDate');
  const messageSubject = document.getElementById('messageSubject');
  const messageBody = document.getElementById('messageBody');

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
    groupSelector.addEventListener('change', async (e) => {
      currentGroupId = e.target.value;
      localStorage.setItem('selectedGroupId', currentGroupId);
      sessionStorage.setItem('selectedGroupId', currentGroupId);
      await loadGroupDataForTemplates();
    });
  }

  // Message type change - show/hide payment type and templates
  if (messageType) {
    messageType.addEventListener('change', (e) => {
      const type = e.target.value;
      if (type === 'payment' || type === 'reminder') {
        if (paymentTypeGroup) paymentTypeGroup.classList.remove('hidden');
        if (templateGroup) templateGroup.classList.remove('hidden');
        if (dueDateGroup) dueDateGroup.classList.remove('hidden');
      } else {
        if (paymentTypeGroup) paymentTypeGroup.classList.add('hidden');
        if (templateGroup) templateGroup.classList.add('hidden');
        if (dueDateGroup) dueDateGroup.classList.add('hidden');
      }
      
      // Load templates based on type
      if (type === 'payment' || type === 'reminder') {
        loadPaymentTemplates();
      } else {
        loadGeneralTemplates();
      }
    });
  }

  // Payment type change - update templates
  if (paymentType) {
    paymentType.addEventListener('change', () => {
      loadPaymentTemplates();
      autoPopulateFromTemplate();
    });
  }

  // Template selection change - auto-populate
  if (messageTemplate) {
    messageTemplate.addEventListener('change', () => {
      autoPopulateFromTemplate();
    });
  }

  // Due date change - update message
  if (dueDate) {
    dueDate.addEventListener('change', () => {
      autoPopulateFromTemplate();
    });
  }

  let groupData = null;

  /**
   * Load admin groups
   */
  async function loadAdminGroups() {
    try {
      showSpinner(true);
      adminGroups = [];
      
      // Get selected group from localStorage or session
      const selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
      
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

      // Load group data if group is selected
      if (currentGroupId) {
        await loadGroupDataForTemplates();
      }
    } catch (error) {
      console.error('Error loading groups:', error);
      showToast('Error loading groups. Please try again.', 'error');
    } finally {
      showSpinner(false);
    }
  }

  /**
   * Load group data for templates
   */
  async function loadGroupDataForTemplates() {
    if (!currentGroupId) return;
    
    try {
      const groupDoc = await getDoc(doc(db, 'groups', currentGroupId));
      if (groupDoc.exists()) {
        groupData = groupDoc.data();
        
        // Set default due date to tomorrow if not set
        if (dueDate && !dueDate.value) {
          const today = new Date();
          today.setDate(today.getDate() + 1);
          dueDate.value = today.toISOString().split('T')[0];
        }
      }
    } catch (error) {
      console.error('Error loading group data:', error);
    }
  }

  /**
   * Load payment templates
   */
  function loadPaymentTemplates() {
    if (!messageTemplate) return;
    
    const paymentTypeValue = paymentType?.value || '';
    const templates = {
      'seed': [
        { value: 'due_reminder', text: 'Seed Money Due Reminder' },
        { value: 'overdue_warning', text: 'Seed Money Overdue Warning' },
        { value: 'payment_confirmation', text: 'Seed Money Payment Confirmation' },
        { value: 'grace_period', text: 'Seed Money Grace Period Notice' },
        { value: 'custom', text: 'Custom Message' }
      ],
      'monthly': [
        { value: 'due_reminder', text: 'Monthly Contribution Due Reminder' },
        { value: 'overdue_warning', text: 'Monthly Contribution Overdue Warning' },
        { value: 'payment_confirmation', text: 'Monthly Contribution Payment Confirmation' },
        { value: 'grace_period', text: 'Monthly Contribution Grace Period Notice' },
        { value: 'custom', text: 'Custom Message' }
      ],
      '': [
        { value: 'due_reminder', text: 'Payment Due Reminder' },
        { value: 'overdue_warning', text: 'Overdue Payment Warning' },
        { value: 'payment_confirmation', text: 'Payment Confirmation' },
        { value: 'grace_period', text: 'Grace Period Notice' },
        { value: 'custom', text: 'Custom Message' }
      ]
    };

    const templateList = templates[paymentTypeValue] || templates[''];
    messageTemplate.innerHTML = '<option value="">Select a template...</option>';
    templateList.forEach(template => {
      const option = document.createElement('option');
      option.value = template.value;
      option.textContent = template.text;
      messageTemplate.appendChild(option);
    });
  }

  /**
   * Load general templates
   */
  function loadGeneralTemplates() {
    if (!messageTemplate) return;
    
    const messageTypeValue = messageType?.value || '';
    const templates = {
      'announcement': [
        { value: 'general', text: 'General Announcement' },
        { value: 'meeting', text: 'Meeting Notice' },
        { value: 'update', text: 'Group Update' },
        { value: 'custom', text: 'Custom Message' }
      ],
      'meeting': [
        { value: 'meeting_scheduled', text: 'Meeting Scheduled' },
        { value: 'meeting_reminder', text: 'Meeting Reminder' },
        { value: 'meeting_cancelled', text: 'Meeting Cancelled' },
        { value: 'custom', text: 'Custom Message' }
      ],
      'urgent': [
        { value: 'urgent_notice', text: 'Urgent Notice' },
        { value: 'action_required', text: 'Action Required' },
        { value: 'custom', text: 'Custom Message' }
      ],
      '': [
        { value: 'custom', text: 'Custom Message' }
      ]
    };

    const templateList = templates[messageTypeValue] || templates[''];
    messageTemplate.innerHTML = '<option value="">Select a template...</option>';
    templateList.forEach(template => {
      const option = document.createElement('option');
      option.value = template.value;
      option.textContent = template.text;
      messageTemplate.appendChild(option);
    });
  }

  /**
   * Auto-populate message from template
   */
  async function autoPopulateFromTemplate() {
    if (!messageTemplate || !messageBody || !messageSubject) return;
    
    const template = messageTemplate.value;
    const paymentTypeValue = paymentType?.value || '';
    const dueDateValue = dueDate?.value || '';
    
    if (!template || template === 'custom') {
      return; // Don't auto-populate for custom
    }

    if (!groupData && currentGroupId) {
      await loadGroupDataForTemplates();
    }

    const rules = groupData?.rules || {};
    let subject = '';
    let message = '';

    // Format due date
    let dueDateFormatted = '';
    if (dueDateValue) {
      const date = new Date(dueDateValue);
      dueDateFormatted = date.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }

    // Payment templates
    if (template === 'due_reminder') {
      if (paymentTypeValue === 'seed') {
        const amount = rules.seedMoney?.amount || 0;
        subject = `Seed Money Payment Due - ${dueDateFormatted || 'Soon'}`;
        message = `Dear Member,\n\nThis is a reminder that your Seed Money payment of MWK ${amount.toLocaleString()} is due on ${dueDateFormatted || 'the specified date'}.\n\nPlease ensure your payment is submitted on time to avoid penalties.\n\nThank you for your prompt attention to this matter.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
      } else if (paymentTypeValue === 'monthly') {
        const amount = rules.monthlyContribution?.amount || 0;
        const dueDay = rules.monthlyContribution?.dayOfMonth || 15;
        subject = `Monthly Contribution Due - ${dueDateFormatted || `${dueDay}th of the month`}`;
        message = `Dear Member,\n\nThis is a reminder that your Monthly Contribution of MWK ${amount.toLocaleString()} is due on ${dueDateFormatted || `the ${dueDay}th of this month`}.\n\nPlease ensure your payment is submitted on time to avoid penalties.\n\nThank you for your cooperation.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
      } else {
        subject = `Payment Due Reminder - ${dueDateFormatted || 'Soon'}`;
        message = `Dear Member,\n\nThis is a reminder that your payment is due on ${dueDateFormatted || 'the specified date'}.\n\nPlease ensure your payment is submitted on time.\n\nThank you.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
      }
    } else if (template === 'overdue_warning') {
      if (paymentTypeValue === 'seed') {
        const amount = rules.seedMoney?.amount || 0;
        const penaltyRate = rules.monthlyPenalty?.rate || 0;
        subject = `⚠️ URGENT: Seed Money Payment Overdue`;
        message = `Dear Member,\n\nYour Seed Money payment of MWK ${amount.toLocaleString()} is now OVERDUE.\n\nPlease submit your payment immediately to avoid additional penalties (${penaltyRate}% per day).\n\nIf you have already made the payment, please contact us to update your records.\n\nThank you for your immediate attention.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
      } else if (paymentTypeValue === 'monthly') {
        const amount = rules.monthlyContribution?.amount || 0;
        const penaltyRate = rules.monthlyPenalty?.rate || 0;
        subject = `⚠️ URGENT: Monthly Contribution Overdue`;
        message = `Dear Member,\n\nYour Monthly Contribution of MWK ${amount.toLocaleString()} is now OVERDUE.\n\nPlease submit your payment immediately to avoid additional penalties (${penaltyRate}% per day).\n\nIf you have already made the payment, please contact us to update your records.\n\nThank you for your immediate attention.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
      } else {
        subject = `⚠️ URGENT: Payment Overdue`;
        message = `Dear Member,\n\nYour payment is now OVERDUE.\n\nPlease submit your payment immediately to avoid additional penalties.\n\nThank you for your immediate attention.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
      }
    } else if (template === 'payment_confirmation') {
      if (paymentTypeValue === 'seed') {
        subject = `✓ Seed Money Payment Received`;
        message = `Dear Member,\n\nWe have successfully received your Seed Money payment.\n\nThank you for your timely payment. Your account has been updated accordingly.\n\nIf you have any questions, please don't hesitate to contact us.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
      } else if (paymentTypeValue === 'monthly') {
        subject = `✓ Monthly Contribution Received`;
        message = `Dear Member,\n\nWe have successfully received your Monthly Contribution payment.\n\nThank you for your timely payment. Your account has been updated accordingly.\n\nIf you have any questions, please don't hesitate to contact us.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
      } else {
        subject = `✓ Payment Received`;
        message = `Dear Member,\n\nWe have successfully received your payment.\n\nThank you for your timely payment.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
      }
    } else if (template === 'grace_period') {
      const graceDays = paymentTypeValue === 'seed' 
        ? (rules.seedMoney?.gracePeriodDays || rules.monthlyPenalty?.gracePeriodDays || 0)
        : (rules.monthlyPenalty?.gracePeriodDays || 0);
      if (paymentTypeValue === 'seed') {
        const amount = rules.seedMoney?.amount || 0;
        subject = `Seed Money Payment - Grace Period Notice`;
        message = `Dear Member,\n\nThis is a friendly reminder that your Seed Money payment of MWK ${amount.toLocaleString()} is due.\n\nYou are currently within the ${graceDays}-day grace period. Please submit your payment before the grace period ends to avoid penalties.\n\nThank you for your attention.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
      } else if (paymentTypeValue === 'monthly') {
        const amount = rules.monthlyContribution?.amount || 0;
        subject = `Monthly Contribution - Grace Period Notice`;
        message = `Dear Member,\n\nThis is a friendly reminder that your Monthly Contribution of MWK ${amount.toLocaleString()} is due.\n\nYou are currently within the ${graceDays}-day grace period. Please submit your payment before the grace period ends to avoid penalties.\n\nThank you for your attention.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
      } else {
        subject = `Payment - Grace Period Notice`;
        message = `Dear Member,\n\nThis is a friendly reminder that your payment is due.\n\nYou are currently within the ${graceDays}-day grace period. Please submit your payment before the grace period ends to avoid penalties.\n\nThank you.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
      }
    }

    // General templates
    if (template === 'general') {
      subject = `Group Announcement`;
      message = `Dear Members,\n\nWe have an important announcement to share with you.\n\n[Your message here]\n\nThank you for your attention.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
    } else if (template === 'meeting_scheduled') {
      subject = `Meeting Scheduled`;
      message = `Dear Members,\n\nA group meeting has been scheduled.\n\nDate: ${dueDateFormatted || '[Select date]'}\nTime: [Time]\nLocation: [Location]\n\nPlease confirm your attendance.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
    } else if (template === 'meeting_reminder') {
      subject = `Meeting Reminder`;
      message = `Dear Members,\n\nThis is a reminder about our upcoming meeting.\n\nDate: ${dueDateFormatted || '[Select date]'}\nTime: [Time]\nLocation: [Location]\n\nWe look forward to seeing you there.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
    } else if (template === 'urgent_notice') {
      subject = `⚠️ URGENT NOTICE`;
      message = `Dear Members,\n\nThis is an urgent notice that requires your immediate attention.\n\n[Your urgent message here]\n\nPlease respond as soon as possible.\n\nBest regards,\n${groupData?.groupName || 'Group Admin'}`;
    }

    // Populate fields
    if (subject && messageSubject) {
      messageSubject.value = subject;
    }
    if (message && messageBody) {
      messageBody.value = message;
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

      // Use selected group from localStorage, session, or selector
      const groupId = currentGroupId || groupSelector?.value || localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
      
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
          userId: memberId, // Use userId for consistency with other notifications
          recipientId: memberId, // Keep for backward compatibility
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
