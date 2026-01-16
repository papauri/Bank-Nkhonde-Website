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
  deleteDoc,
  addDoc,
  writeBatch,
  onAuthStateChanged,
  Timestamp,
  arrayUnion,
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
const modalActions = document.getElementById('modalActions');
const showReadBtn = document.getElementById('showReadBtn');

let currentFilter = 'all';
let showReadMessages = false;
let isAdmin = false;

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

  // Message type filter tabs
  document.querySelectorAll('.action-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.action-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      filterMessages();
    });
  });

  // Show read messages toggle - removed, now using Read tab instead

  // Close modal
  if (closeModal) {
    closeModal.addEventListener('click', () => {
      messageModal.classList.remove('active');
      if (modalActions) modalActions.innerHTML = '';
    });
  }

  // Close modal on backdrop click
  if (messageModal) {
    messageModal.addEventListener('click', (e) => {
      if (e.target === messageModal) {
        messageModal.classList.remove('active');
        if (modalActions) modalActions.innerHTML = '';
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

    // Check if user is admin
    isAdmin = false;
    for (const group of userGroups) {
      if (group.isAdmin) {
        isAdmin = true;
        break;
      }
    }

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
        // Try querying with userId first (new format), fallback to recipientId (old format)
        let q = query(
          notificationsRef,
          where('userId', '==', currentUser.uid),
          orderBy('createdAt', 'desc')
        );
        let snapshot;
        try {
          snapshot = await getDocs(q);
        } catch (error) {
          // If userId query fails, try recipientId (old format)
          try {
            q = query(
              notificationsRef,
              where('recipientId', '==', currentUser.uid),
              orderBy('createdAt', 'desc')
            );
            snapshot = await getDocs(q);
          } catch (err) {
            // If both fail, get all and filter
            snapshot = await getDocs(query(notificationsRef, orderBy('createdAt', 'desc')));
          }
        }

        snapshot.forEach(doc => {
          const data = doc.data();
          // Filter by userId or recipientId
          const isForUser = (data.userId === currentUser.uid) || (data.recipientId === currentUser.uid);
          if (isForUser) {
            allMessages.push({
              ...data,
              id: doc.id,
              groupId: group.groupId,
              groupName: group.groupName
            });
          }
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
 * Filter messages by selected group, type, and read status
 */
function filterMessages() {
  if (!messagesList) return;

  const selectedGroupId = groupSelector?.value || '';

  let filteredMessages = allMessages;
  
  // Filter by group
  if (selectedGroupId) {
    filteredMessages = filteredMessages.filter(msg => msg.groupId === selectedGroupId);
  }
  
  // Filter by read/unread status first
  if (currentFilter === 'unread') {
    filteredMessages = filteredMessages.filter(msg => !msg.read);
  } else if (currentFilter === 'read') {
    filteredMessages = filteredMessages.filter(msg => msg.read);
  }
  
  // Filter by type (if not filtering by read status)
  if (currentFilter !== 'all' && currentFilter !== 'unread' && currentFilter !== 'read') {
    filteredMessages = filteredMessages.filter(msg => {
      const msgType = (msg.type || '').toLowerCase();
      const paymentType = (msg.paymentType || '').toLowerCase();
      const title = (msg.title || '').toLowerCase();
      const message = (msg.message || '').toLowerCase();
      
      switch (currentFilter) {
        case 'loan':
          return msgType.includes('loan') || title.includes('loan') || message.includes('loan');
        case 'payment':
          return msgType.includes('payment') || paymentType || title.includes('payment') || message.includes('payment');
        case 'seed_money':
          return msgType.includes('seed') || paymentType.includes('seed') || title.includes('seed') || message.includes('seed money');
        case 'monthly':
          return msgType.includes('monthly') || paymentType.includes('monthly') || title.includes('monthly') || message.includes('monthly');
        case 'loan_booking':
          return msgType === 'loan_booking' || title.includes('loan booking');
        case 'other':
          // Broadcast message types (info, warning, error, success) should go in "other"
          const isBroadcastType = msgType === 'info' || msgType === 'warning' || msgType === 'error' || msgType === 'success';
          if (isBroadcastType) {
            return true;
          }
          
          // User messages should go in "other"
          if (msgType === 'user_message') {
            return true;
          }
          
          // Exclude loan-specific message types and loan-related content
          if (msgType.includes('loan') || msgType === 'loan_booking' || 
              (title.includes('loan') && !isBroadcastType) || 
              (message.includes('loan') && !isBroadcastType)) {
            return false;
          }
          
          // Exclude payment-specific message types (but broadcasts about payments stay in "other")
          if ((msgType.includes('payment') || paymentType) && !isBroadcastType) {
            // Check if it's specifically a payment action (upload, approve, reject)
            if (msgType === 'payment_upload' || msgType === 'payment_approved' || msgType === 'payment_rejected') {
              return false;
            }
          }
          
          // Exclude seed money-specific messages (but broadcasts stay in "other")
          if ((msgType.includes('seed') || paymentType.includes('seed') || 
               (title.includes('seed') && !isBroadcastType) || 
               (message.includes('seed money') && !isBroadcastType)) && !isBroadcastType) {
            return false;
          }
          
          // Exclude monthly contribution-specific messages (but broadcasts stay in "other")
          if ((msgType.includes('monthly') || paymentType.includes('monthly') || 
               (title.includes('monthly') && !isBroadcastType) || 
               (message.includes('monthly') && !isBroadcastType)) && !isBroadcastType) {
            return false;
          }
          
          // Include all other messages (system notifications, general info, etc.)
          return true;
        default:
          return true;
      }
    });
  }
  
  // Update mark all read button visibility (only show for unread messages)
  const unreadCount = allMessages.filter(msg => !msg.read).length;
  if (markAllReadBtn) {
    markAllReadBtn.style.display = unreadCount > 0 && currentFilter !== 'read' ? 'block' : 'none';
  }
  
  // Hide show read button since we now have a Read tab
  if (showReadBtn) {
    showReadBtn.style.display = 'none';
  }

  if (filteredMessages.length === 0) {
    let emptyMessage = 'No messages found';
    if (currentFilter === 'unread') {
      emptyMessage = 'No unread messages';
    } else if (currentFilter === 'read') {
      emptyMessage = 'No read messages';
    }
    messagesList.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📬</div><p class="empty-state-text">${emptyMessage}</p></div>`;
    return;
  }

  // Sort: unread first, then by date
  filteredMessages.sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    const aTime = a.createdAt?.toMillis() || 0;
    const bTime = b.createdAt?.toMillis() || 0;
    return bTime - aTime;
  });

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
  div.className = `message-item ${message.read ? 'read' : 'unread'}`;
  div.onclick = () => openMessage(message);
  
  // Determine message category for grouping
  const msgType = message.type || '';
  const category = msgType.includes('loan') ? 'loan' : 
                   msgType.includes('payment') || message.paymentType ? 'payment' :
                   msgType.includes('seed') ? 'seed_money' :
                   msgType.includes('monthly') ? 'monthly' : 'other';

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
      <div style="display: flex; align-items: center; gap: var(--bn-space-2);">
        <span class="message-type-badge ${messageType}">${message.type || 'info'}</span>
        <button class="btn btn-ghost btn-sm" style="padding: 4px 8px; min-width: auto;" data-delete-id="${message.id}" data-group-id="${message.groupId}" onclick="event.stopPropagation(); handleDeleteMessage('${message.id}', '${message.groupId}');" title="Delete message">
          🗑️
        </button>
      </div>
    </div>
    <div class="message-body">${escapeHtml((message.message || '').substring(0, 150))}${(message.message || '').length > 150 ? '...' : ''}</div>
  `;

  return div;
}

/**
 * Open message in modal with approve/reject actions for admin
 */
async function openMessage(message) {
  try {
    // Mark as read if unread - update both read flag and readBy array
    if (!message.read && !message.readBy?.includes(currentUser.uid)) {
      try {
        const notificationRef = doc(db, `groups/${message.groupId}/notifications`, message.id);
        await updateDoc(notificationRef, {
          read: true,
          readAt: Timestamp.now(),
          readBy: arrayUnion(currentUser.uid)
        });
        message.read = true;
        if (!message.readBy) message.readBy = [];
        message.readBy.push(currentUser.uid);
        
        // Reload messages to update badge count in notification handler
        const selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
        if (selectedGroupId) {
          // Trigger badge update via notification handler if available
          const badgeElement = document.getElementById('notificationBadge');
          if (badgeElement && window.loadNotificationCount) {
            window.loadNotificationCount(currentUser.uid, selectedGroupId, badgeElement);
          }
        }
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
      messageItem.classList.add('read');
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
        ${message.loanId ? `<div><strong>Loan ID:</strong> ${escapeHtml(message.loanId)}</div>` : ''}
        ${message.paymentId ? `<div><strong>Payment ID:</strong> ${escapeHtml(message.paymentId)}</div>` : ''}
        ${message.memberId ? `<div><strong>Member ID:</strong> ${escapeHtml(message.memberId)}</div>` : ''}
      `;
    }

    // Show approve/reject actions for admin
    if (modalActions) {
      modalActions.innerHTML = '';
      
      // Check if message needs approval
      const msgType = (message.type || '').toLowerCase();
      const title = (message.title || '').toLowerCase();
      const messageText = (message.message || '').toLowerCase();
      
      const isLoan = msgType.includes('loan') || msgType === 'loan_booking' || title.includes('loan booking');
      const isPayment = msgType.includes('payment') || msgType === 'payment_upload' || title.includes('payment') || message.paymentType;
      
      // Show actions based on user role and message type
      let actionsHTML = '<div class="message-approve-actions">';
      
      if (isLoan && message.loanId) {
        // For loans: Admins can approve/reject, Users can cancel
        if (isAdmin && !message.approved && !message.rejected) {
          // Admin actions: Approve or Reject
          actionsHTML += `
            <button class="btn btn-accent" onclick="handleApproveLoan('${escapeHtml(message.loanId)}', '${escapeHtml(message.groupId)}', '${escapeHtml(message.id)}')">Approve Loan</button>
            <button class="btn btn-danger" onclick="handleRejectLoan('${escapeHtml(message.loanId)}', '${escapeHtml(message.groupId)}', '${escapeHtml(message.id)}')">Reject Loan</button>
          `;
        } else if (!isAdmin && (message.type === 'loan_approved' || message.type === 'loan_booking')) {
          // User actions: Cancel loan (only if approved or pending)
          actionsHTML += `
            <button class="btn btn-danger" onclick="handleCancelLoan('${escapeHtml(message.loanId)}', '${escapeHtml(message.groupId)}', '${escapeHtml(message.id)}')">Cancel Loan</button>
          `;
        }
      } else if (isPayment && (message.memberId || message.paymentId) && isAdmin && !message.approved && !message.rejected) {
        // Payment actions: Only admins can approve/reject
        const memberId = message.memberId || message.senderId || '';
        const paymentType = message.paymentType || 'monthly_contribution';
        actionsHTML += `
          <button class="btn btn-accent" onclick="handleApprovePayment('${escapeHtml(message.groupId)}', '${escapeHtml(message.paymentId || '')}', '${escapeHtml(memberId)}', '${escapeHtml(paymentType)}', '${escapeHtml(message.id)}')">Approve Payment</button>
          <button class="btn btn-danger" onclick="handleRejectPayment('${escapeHtml(message.groupId)}', '${escapeHtml(message.paymentId || '')}', '${escapeHtml(memberId)}', '${escapeHtml(paymentType)}', '${escapeHtml(message.id)}')">Reject Payment</button>
        `;
      }
      
      actionsHTML += '</div>';
      
      // Only show actions if there are any
      if (actionsHTML !== '<div class="message-approve-actions"></div>') {
        modalActions.innerHTML = actionsHTML;
      }
    }

    messageModal.classList.add('active');
    filterMessages(); // Refresh to update read status
  } catch (error) {
    console.error('Error opening message:', error);
    showToast('Error opening message', 'error');
  }
}

/**
 * Delete message/notification
 */
async function handleDeleteMessage(messageId, groupId) {
  if (!confirm('Are you sure you want to delete this message?')) {
    return;
  }

  try {
    showSpinner(true);
    
    // Delete from notifications collection
    const notificationRef = doc(db, `groups/${groupId}/notifications`, messageId);
    await deleteDoc(notificationRef);
    
    // Remove from local array
    allMessages = allMessages.filter(msg => msg.id !== messageId);
    
    // Refresh display
    filterMessages();
    
    showToast('Message deleted successfully', 'success');
  } catch (error) {
    console.error('Error deleting message:', error);
    showToast('Error deleting message: ' + error.message, 'error');
  } finally {
    showSpinner(false);
  }
}

// Make functions available globally
window.handleDeleteMessage = handleDeleteMessage;
window.handleApproveLoan = handleApproveLoan;
window.handleRejectLoan = handleRejectLoan;
window.handleCancelLoan = handleCancelLoan;
window.handleApprovePayment = handleApprovePayment;
window.handleRejectPayment = handleRejectPayment;

/**
 * Format currency helper
 */
function formatCurrency(amount) {
  return `MWK ${parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Handle approve loan from message
 */
async function handleApproveLoan(loanId, groupId, messageId) {
  if (!confirm('Approve and disburse this loan?')) return;
  
  try {
    showSpinner(true);
    
    // Get loan document
    const loanRef = doc(db, `groups/${groupId}/loans`, loanId);
    const loanDoc = await getDoc(loanRef);
    
    if (!loanDoc.exists()) {
      throw new Error('Loan not found');
    }
    
    const loan = loanDoc.data();
    const amount = parseFloat(loan.amount || loan.loanAmount || 0);
    const period = parseInt(loan.repaymentPeriod || 1);
    
    // Get group data for interest rates
    const groupDoc = await getDoc(doc(db, 'groups', groupId));
    const groupData = groupDoc.exists() ? groupDoc.data() : {};
    const rules = groupData?.rules?.loanInterest || {};
    
    const month1Rate = parseFloat(rules.month1 || 10);
    const month2Rate = parseFloat(rules.month2 || rules.month1 || 7);
    const month3Rate = parseFloat(rules.month3AndBeyond || rules.month2 || 5);
    
    // Calculate interest using reduced balance method
    let totalInterest = 0;
    let remainingBalance = amount;
    const schedule = {};
    const monthlyPrincipal = amount / period;
    const disbursementDate = new Date();
    
    for (let i = 1; i <= period; i++) {
      const rate = i === 1 ? month1Rate : i === 2 ? month2Rate : month3Rate;
      const monthlyInterest = Math.round(remainingBalance * (rate / 100) * 100) / 100;
      totalInterest += monthlyInterest;
      
      const dueDate = new Date(disbursementDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      const monthKey = dueDate.toLocaleString('default', { month: 'long' });
      
      schedule[monthKey] = {
        month: i,
        monthName: monthKey,
        principal: Math.round(monthlyPrincipal * 100) / 100,
        interest: monthlyInterest,
        interestRate: rate,
        amount: Math.round((monthlyPrincipal + monthlyInterest) * 100) / 100,
        dueDate: Timestamp.fromDate(dueDate),
        paid: false,
        paidAt: null,
        paidAmount: 0,
        penaltyAmount: 0
      };
      
      remainingBalance -= monthlyPrincipal;
    }
    
    totalInterest = Math.round(totalInterest * 100) / 100;
    const totalRepayable = Math.round((amount + totalInterest) * 100) / 100;
    const finalDueDate = new Date(disbursementDate);
    finalDueDate.setMonth(finalDueDate.getMonth() + period);
    
    // Update loan
    await updateDoc(loanRef, {
      status: 'active',
      approvedBy: currentUser.uid,
      approvedAt: Timestamp.now(),
      disbursedAt: Timestamp.now(),
      totalInterest: totalInterest,
      totalRepayable: totalRepayable,
      amountRepaid: 0,
      dueDate: Timestamp.fromDate(finalDueDate),
      repaymentSchedule: schedule,
      monthlyPrincipal: Math.round(monthlyPrincipal * 100) / 100,
      interestRates: { month1: month1Rate, month2: month2Rate, month3: month3Rate },
      updatedAt: Timestamp.now(),
    });
    
    // Update member financial summary
    const memberRef = doc(db, `groups/${groupId}/members`, loan.borrowerId);
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      const financialSummary = memberDoc.data().financialSummary || {};
      await updateDoc(memberRef, {
        'financialSummary.totalLoans': (parseFloat(financialSummary.totalLoans || 0)) + amount,
        'financialSummary.activeLoans': (parseInt(financialSummary.activeLoans || 0)) + 1,
        'financialSummary.lastUpdated': Timestamp.now(),
      });
    }
    
    // Send notification to borrower
    await addDoc(collection(db, `groups/${groupId}/notifications`), {
      userId: loan.borrowerId,
      recipientId: loan.borrowerId,
      type: 'loan_approved',
      title: 'Loan Approved & Disbursed',
      message: `Your loan booking of ${formatCurrency(amount)} has been approved and disbursed.\n\nTotal Interest: ${formatCurrency(totalInterest)}\nTotal Repayable: ${formatCurrency(totalRepayable)}\nRepayment Period: ${period} month(s)\nFinal Due Date: ${finalDueDate.toLocaleDateString()}`,
      loanId: loanId,
      groupId: groupId,
      groupName: groupData?.groupName || 'Unknown Group',
      senderId: currentUser.uid,
      createdAt: Timestamp.now(),
      read: false,
    });
    
    // Update message status
    const notificationRef = doc(db, `groups/${groupId}/notifications`, messageId);
    await updateDoc(notificationRef, {
      approved: true,
      approvedAt: Timestamp.now(),
      approvedBy: currentUser.uid
    });
    
    // Reload messages
    await loadMessages();
    messageModal.classList.remove('active');
    showToast('Loan approved successfully', 'success');
  } catch (error) {
    console.error('Error approving loan:', error);
    showToast('Error approving loan: ' + error.message, 'error');
  } finally {
    showSpinner(false);
  }
}

/**
 * Handle reject loan from message
 */
async function handleRejectLoan(loanId, groupId, messageId) {
  const reason = prompt('Reason for rejection:');
  if (!reason) return;
  
  try {
    showSpinner(true);
    
    // Get loan document
    const loanRef = doc(db, `groups/${groupId}/loans`, loanId);
    const loanDoc = await getDoc(loanRef);
    
    if (!loanDoc.exists()) {
      throw new Error('Loan not found');
    }
    
    const loan = loanDoc.data();
    
    // Update loan status
    await updateDoc(loanRef, {
      status: 'rejected',
      rejectedBy: currentUser.uid,
      rejectedAt: Timestamp.now(),
      rejectionReason: reason,
      updatedAt: Timestamp.now(),
    });
    
    // Get group data
    const groupDoc = await getDoc(doc(db, 'groups', groupId));
    const groupData = groupDoc.exists() ? groupDoc.data() : {};
    
    // Send notification to borrower
    await addDoc(collection(db, `groups/${groupId}/notifications`), {
      userId: loan.borrowerId,
      recipientId: loan.borrowerId,
      type: 'loan_rejected',
      title: 'Loan Request Rejected',
      message: `Your loan booking of ${formatCurrency(loan.amount || loan.loanAmount || 0)} was rejected.\n\nReason: ${reason}\n\nYou can submit a new loan booking request from your dashboard.`,
      loanId: loanId,
      groupId: groupId,
      groupName: groupData?.groupName || 'Unknown Group',
      senderId: currentUser.uid,
      createdAt: Timestamp.now(),
      read: false,
    });
    
    // Update message status
    const notificationRef = doc(db, `groups/${groupId}/notifications`, messageId);
    await updateDoc(notificationRef, {
      rejected: true,
      rejectedAt: Timestamp.now(),
      rejectedBy: currentUser.uid,
      rejectionReason: reason
    });
    
    // Reload messages
    await loadMessages();
    messageModal.classList.remove('active');
    showToast('Loan rejected', 'success');
  } catch (error) {
    console.error('Error rejecting loan:', error);
    showToast('Error rejecting loan: ' + error.message, 'error');
  } finally {
    showSpinner(false);
  }
}

/**
 * Handle cancel loan from message (User only)
 */
async function handleCancelLoan(loanId, groupId, messageId) {
  const reason = prompt('Reason for cancelling this loan:');
  if (!reason) {
    return;
  }
  
  if (!confirm('Are you sure you want to cancel this loan? This action cannot be undone.')) {
    return;
  }
  
  try {
    showSpinner(true);
    
    // Get loan document
    const loanRef = doc(db, `groups/${groupId}/loans`, loanId);
    const loanDoc = await getDoc(loanRef);
    
    if (!loanDoc.exists()) {
      throw new Error('Loan not found');
    }
    
    const loan = loanDoc.data();
    
    // Verify this is the borrower's loan
    if (loan.borrowerId !== currentUser.uid) {
      showToast('You can only cancel your own loans', 'error');
      return;
    }
    
    // Only allow cancellation if loan is pending or approved (not active or already cancelled/rejected)
    if (loan.status !== 'pending' && loan.status !== 'approved') {
      showToast('This loan cannot be cancelled. Only pending or approved loans can be cancelled.', 'error');
      return;
    }
    
    // Update loan status to cancelled
    await updateDoc(loanRef, {
      status: 'cancelled',
      cancelledBy: currentUser.uid,
      cancelledAt: Timestamp.now(),
      cancelReason: reason,
      updatedAt: Timestamp.now(),
    });
    
    // Get group data and admin information
    const groupDoc = await getDoc(doc(db, 'groups', groupId));
    const groupData = groupDoc.exists() ? groupDoc.data() : {};
    
    // Get all admin IDs
    const adminIds = new Set();
    if (groupData.admins?.length > 0) {
      groupData.admins.forEach(a => adminIds.add(a.uid || a));
    }
    if (groupData.createdBy) {
      adminIds.add(groupData.createdBy);
    }
    
    // Get user name
    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    const userName = userDoc.exists() ? (userDoc.data().fullName || currentUser.email) : currentUser.email;
    
    // Send notification to all admins
    const batch = writeBatch(db);
    for (const adminId of adminIds) {
      const notificationRef = doc(collection(db, `groups/${groupId}/notifications`));
      batch.set(notificationRef, {
        userId: adminId,
        recipientId: adminId,
        type: 'loan_cancelled',
        title: 'Loan Cancelled by Borrower',
        message: `${userName} has cancelled their loan booking of ${formatCurrency(loan.amount || loan.loanAmount || 0)}.\n\nReason: ${reason}\n\nLoan ID: ${loanId}`,
        loanId: loanId,
        groupId: groupId,
        groupName: groupData?.groupName || 'Unknown Group',
        senderId: currentUser.uid,
        senderName: userName,
        cancelReason: reason,
        createdAt: Timestamp.now(),
        read: false,
      });
    }
    await batch.commit();
    
    // Send notification to borrower confirming cancellation
    await addDoc(collection(db, `groups/${groupId}/notifications`), {
      userId: currentUser.uid,
      recipientId: currentUser.uid,
      type: 'loan_cancelled',
      title: 'Loan Cancelled',
      message: `Your loan booking of ${formatCurrency(loan.amount || loan.loanAmount || 0)} has been cancelled.\n\nReason: ${reason}\n\nYou can submit a new loan booking request from your dashboard if needed.`,
      loanId: loanId,
      groupId: groupId,
      groupName: groupData?.groupName || 'Unknown Group',
      senderId: currentUser.uid,
      cancelReason: reason,
      createdAt: Timestamp.now(),
      read: false,
    });
    
    // Update message status
    const notificationRef = doc(db, `groups/${groupId}/notifications`, messageId);
    await updateDoc(notificationRef, {
      cancelled: true,
      cancelledAt: Timestamp.now(),
      cancelledBy: currentUser.uid,
      cancelReason: reason
    });
    
    // Reload messages
    await loadMessages();
    messageModal.classList.remove('active');
    showToast('Loan cancelled successfully. Admins have been notified.', 'success');
  } catch (error) {
    console.error('Error cancelling loan:', error);
    showToast('Error cancelling loan: ' + error.message, 'error');
  } finally {
    showSpinner(false);
  }
}

/**
 * Handle approve payment from message
 */
async function handleApprovePayment(groupId, paymentId, memberId, paymentType, messageId) {
  if (!confirm('Approve this payment?')) return;
  
  try {
    showSpinner(true);
    
    const currentYear = new Date().getFullYear();
    let paymentRef;
    
    // Determine payment reference based on type
    if (paymentType === 'seed_money' || paymentType === 'Seed Money') {
      paymentRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberId}/PaymentDetails`);
    } else if (paymentType === 'monthly_contribution' || paymentType === 'Monthly Contribution') {
      // For monthly, we need to find the specific month document
      // This is simplified - in practice you'd need the month/year from the message
      const monthlyRef = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${memberId}`);
      const monthlySnapshot = await getDocs(monthlyRef);
      if (monthlySnapshot.empty) {
        throw new Error('Monthly payment record not found');
      }
      paymentRef = monthlySnapshot.docs[0].ref; // Use first found for now
    } else {
      throw new Error('Unknown payment type');
    }
    
    const paymentDoc = await getDoc(paymentRef);
    if (!paymentDoc.exists()) {
      throw new Error('Payment record not found');
    }
    
    const paymentData = paymentDoc.data();
    const amountPaid = parseFloat(paymentData.amountPaid || 0);
    
    // Update payment status
    await updateDoc(paymentRef, {
      approvalStatus: 'approved',
      approvedBy: currentUser.uid,
      approvedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    
    // Update member financial summary
    const memberRef = doc(db, `groups/${groupId}/members`, memberId);
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      const memberData = memberDoc.data();
      const financialSummary = memberData.financialSummary || {};
      const newTotalPaid = (parseFloat(financialSummary.totalPaid || 0)) + amountPaid;
      const newTotalArrears = Math.max(0, (parseFloat(financialSummary.totalArrears || 0)) - amountPaid);
      
      await updateDoc(memberRef, {
        'financialSummary.totalPaid': newTotalPaid,
        'financialSummary.totalArrears': newTotalArrears,
        'financialSummary.lastUpdated': Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    }
    
    // Get group and member data for notification
    const groupDoc = await getDoc(doc(db, 'groups', groupId));
    const groupData = groupDoc.exists() ? groupDoc.data() : {};
    const memberDocData = memberDoc.exists() ? memberDoc.data() : {};
    
    // Send notification to member
    await addDoc(collection(db, `groups/${groupId}/notifications`), {
      userId: memberId,
      recipientId: memberId,
      type: 'payment_approved',
      title: 'Payment Approved',
      message: `Your ${paymentType} payment of ${formatCurrency(amountPaid)} has been approved.`,
      paymentId: paymentId,
      paymentType: paymentType,
      groupId: groupId,
      groupName: groupData?.groupName || 'Unknown Group',
      senderId: currentUser.uid,
      createdAt: Timestamp.now(),
      read: false,
    });
    
    // Update message status
    const notificationRef = doc(db, `groups/${groupId}/notifications`, messageId);
    await updateDoc(notificationRef, {
      approved: true,
      approvedAt: Timestamp.now(),
      approvedBy: currentUser.uid
    });
    
    // Reload messages
    await loadMessages();
    messageModal.classList.remove('active');
    showToast('Payment approved successfully', 'success');
  } catch (error) {
    console.error('Error approving payment:', error);
    showToast('Error approving payment: ' + error.message, 'error');
  } finally {
    showSpinner(false);
  }
}

/**
 * Handle reject payment from message
 */
async function handleRejectPayment(groupId, paymentId, memberId, paymentType, messageId) {
  const reason = prompt('Reason for rejection:');
  if (!reason) return;
  
  try {
    showSpinner(true);
    
    const currentYear = new Date().getFullYear();
    let paymentRef;
    
    // Determine payment reference based on type
    if (paymentType === 'seed_money' || paymentType === 'Seed Money') {
      paymentRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${memberId}/PaymentDetails`);
    } else if (paymentType === 'monthly_contribution' || paymentType === 'Monthly Contribution') {
      // For monthly, we need to find the specific month document
      const monthlyRef = collection(db, `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${memberId}`);
      const monthlySnapshot = await getDocs(monthlyRef);
      if (monthlySnapshot.empty) {
        throw new Error('Monthly payment record not found');
      }
      paymentRef = monthlySnapshot.docs[0].ref;
    } else {
      throw new Error('Unknown payment type');
    }
    
    const paymentDoc = await getDoc(paymentRef);
    if (!paymentDoc.exists()) {
      throw new Error('Payment record not found');
    }
    
    const paymentData = paymentDoc.data();
    const totalAmount = parseFloat(paymentData.totalAmount || 0);
    
    // Update payment status
    await updateDoc(paymentRef, {
      approvalStatus: 'rejected',
      rejectedBy: currentUser.uid,
      rejectedAt: Timestamp.now(),
      rejectionReason: reason,
      amountPaid: 0,
      arrears: totalAmount,
      updatedAt: Timestamp.now(),
      proofOfPayment: {
        imageUrl: '',
        uploadedAt: null,
        verifiedBy: '',
      },
    });
    
    // Get group data for notification
    const groupDoc = await getDoc(doc(db, 'groups', groupId));
    const groupData = groupDoc.exists() ? groupDoc.data() : {};
    
    // Send notification to member
    await addDoc(collection(db, `groups/${groupId}/notifications`), {
      userId: memberId,
      recipientId: memberId,
      type: 'payment_rejected',
      title: 'Payment Rejected',
      message: `Your ${paymentType} payment was rejected.\n\nReason: ${reason}\n\nPlease review and resubmit your payment.`,
      paymentId: paymentId,
      paymentType: paymentType,
      groupId: groupId,
      groupName: groupData?.groupName || 'Unknown Group',
      senderId: currentUser.uid,
      createdAt: Timestamp.now(),
      read: false,
    });
    
    // Update message status
    const notificationRef = doc(db, `groups/${groupId}/notifications`, messageId);
    await updateDoc(notificationRef, {
      rejected: true,
      rejectedAt: Timestamp.now(),
      rejectedBy: currentUser.uid,
      rejectionReason: reason
    });
    
    // Reload messages
    await loadMessages();
    messageModal.classList.remove('active');
    showToast('Payment rejected', 'success');
  } catch (error) {
    console.error('Error rejecting payment:', error);
    showToast('Error rejecting payment: ' + error.message, 'error');
  } finally {
    showSpinner(false);
  }
}

/**
 * Mark all messages as read
 */
async function markAllAsRead() {
  try {
    showSpinner(true);
    
    const selectedGroupId = groupSelector?.value || '';
    let messagesToMark = allMessages.filter(msg => !msg.read && !msg.readBy?.includes(currentUser.uid));
    
    if (selectedGroupId) {
      messagesToMark = messagesToMark.filter(msg => msg.groupId === selectedGroupId);
    }

    for (const message of messagesToMark) {
      try {
        const notificationRef = doc(db, `groups/${message.groupId}/notifications`, message.id);
        await updateDoc(notificationRef, {
          read: true,
          readAt: Timestamp.now(),
          readBy: arrayUnion(currentUser.uid)
        });
        message.read = true;
        if (!message.readBy) message.readBy = [];
        message.readBy.push(currentUser.uid);
      } catch (error) {
        console.error(`Error marking message ${message.id} as read:`, error);
      }
    }

    // Update badge count
    if (selectedGroupId) {
      const badgeElement = document.getElementById('notificationBadge');
      if (badgeElement && window.loadNotificationCount) {
        await window.loadNotificationCount(currentUser.uid, selectedGroupId, badgeElement);
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
