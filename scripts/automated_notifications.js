/**
 * Automated Notifications System
 * Sends automated notifications for upcoming payments, etc.
 */

import {
  db,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  addDoc,
  Timestamp,
  writeBatch,
} from './firebaseConfig.js';

/**
 * Get payment reminder preferences for a user
 */
async function getPaymentReminderPreferences(userId) {
  try {
    const userDocRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userDocRef);
    
    if (userDoc.exists() && userDoc.data().paymentReminders) {
      return userDoc.data().paymentReminders;
    }
    
    // Default: all reminders enabled
    return {
      seedMoney: true,
      serviceFee: true,
      monthlyContribution: true
    };
  } catch (error) {
    console.error('Error getting payment reminder preferences:', error);
    return {
      seedMoney: true,
      serviceFee: true,
      monthlyContribution: true
    };
  }
}

/**
 * Check if a payment is approved (should stop reminders)
 */
async function isPaymentApproved(groupId, userId, paymentType, paymentRef) {
  try {
    if (!paymentRef) return false;
    
    const paymentDoc = await getDoc(paymentRef);
    if (!paymentDoc.exists()) return false;
    
    const paymentData = paymentDoc.data();
    const approvalStatus = paymentData.approvalStatus || paymentData.paymentStatus;
    
    // Payment is approved if status is 'approved' or 'paid'
    return approvalStatus === 'approved' || approvalStatus === 'paid';
  } catch (error) {
    console.error(`Error checking payment approval status:`, error);
    return false;
  }
}

/**
 * Send automated payment reminder notifications based on user preferences
 * Only sends reminders for current and upcoming month, stops when payment is approved
 * @param {string} groupId - Group ID
 * @param {string} userId - User ID (optional, if provided only checks for that user)
 */
export async function sendUserPaymentReminders(groupId, userId = null) {
  try {
    // Get group data
    const groupDoc = await getDoc(doc(db, 'groups', groupId));
    if (!groupDoc.exists()) {
      throw new Error('Group not found');
    }

    const groupData = groupDoc.data();
    const groupName = groupData.groupName;
    const monthlyContribution = groupData.rules?.monthlyContribution?.amount || 0;
    const seedMoney = groupData.rules?.seedMoney?.amount || 0;
    const serviceFee = groupData.rules?.serviceFee?.amount || 0;
    const hasServiceFee = serviceFee > 0;

    // Get current and next month info
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-11
    const currentMonthName = today.toLocaleString('default', { month: 'long' });
    
    // Next month
    const nextMonth = new Date(currentYear, currentMonth + 1, 1);
    const nextMonthYear = nextMonth.getFullYear();
    const nextMonthName = nextMonth.toLocaleString('default', { month: 'long' });

    // Get members to check
    let members = [];
    if (userId) {
      // Check specific user
      const memberDoc = await getDoc(doc(db, `groups/${groupId}/members`, userId));
      if (memberDoc.exists()) {
        const memberData = memberDoc.data();
        if (memberData.status === 'active') {
          members.push({ ...memberData, memberId: userId });
        }
      }
    } else {
      // Get all active members
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      membersSnapshot.forEach(doc => {
        const memberData = doc.data();
        if (memberData.status === 'active') {
          members.push({ ...memberData, memberId: doc.id });
        }
      });
    }

    if (members.length === 0) {
      return { success: true, count: 0 };
    }

    // Create notifications for each member
    const batch = writeBatch(db);
    const notifications = [];

    for (const member of members) {
      try {
        // Get user's reminder preferences
        const preferences = await getPaymentReminderPreferences(member.memberId);
        
        // Check each payment type if enabled and find the NEXT upcoming payment only
        const upcomingPayments = [];
        
        // 1. Seed Money Reminders
        if (preferences.seedMoney && seedMoney > 0) {
          const seedMoneyRef = doc(
            db,
            `groups/${groupId}/payments/${currentYear}_SeedMoney/${member.memberId}/PaymentDetails`
          );
          
          const isApproved = await isPaymentApproved(groupId, member.memberId, 'Seed Money', seedMoneyRef);
          if (!isApproved) {
            const seedMoneyDoc = await getDoc(seedMoneyRef);
            if (seedMoneyDoc.exists()) {
              const seedData = seedMoneyDoc.data();
              const approvalStatus = seedData.approvalStatus || seedData.paymentStatus;
              const amountDue = parseFloat(seedData.arrears || 0);
              
              if ((approvalStatus === 'unpaid' || approvalStatus === 'pending') && amountDue > 0) {
                const dueDate = seedData.dueDate?.toDate ? seedData.dueDate.toDate() : today;
                upcomingPayments.push({
                  type: 'Seed Money',
                  amount: amountDue,
                  dueDate: dueDate,
                  priority: dueDate.getTime()
                });
              }
            }
          }
        }
        
        // 2. Service Fee Reminders
        if (preferences.serviceFee && hasServiceFee) {
          const serviceFeeRef = doc(
            db,
            `groups/${groupId}/payments/${currentYear}_ServiceFee/${member.memberId}/PaymentDetails`
          );
          
          const isApproved = await isPaymentApproved(groupId, member.memberId, 'Service Fee', serviceFeeRef);
          if (!isApproved) {
            try {
              const serviceFeeDoc = await getDoc(serviceFeeRef);
              if (serviceFeeDoc.exists()) {
                const feeData = serviceFeeDoc.data();
                const approvalStatus = feeData.approvalStatus || feeData.paymentStatus;
                const amountDue = parseFloat(feeData.arrears || serviceFee - (parseFloat(feeData.amountPaid || 0)));
                
                if ((approvalStatus === 'unpaid' || approvalStatus === 'pending') && amountDue > 0) {
                  const dueDate = feeData.dueDate?.toDate ? feeData.dueDate.toDate() : today;
                  upcomingPayments.push({
                    type: 'Service Fee',
                    amount: amountDue,
                    dueDate: dueDate,
                    priority: dueDate.getTime()
                  });
                }
              }
            } catch (e) {
              // Service fee document might not exist yet, that's okay
            }
          }
        }
        
        // 3. Monthly Contribution Reminders (current and upcoming month only)
        if (preferences.monthlyContribution && monthlyContribution > 0) {
          // Check current month
          const currentMonthRef = doc(
            db,
            `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${member.memberId}/${currentYear}_${currentMonthName}`
          );
          
          const currentMonthApproved = await isPaymentApproved(groupId, member.memberId, 'Monthly Contribution', currentMonthRef);
          if (!currentMonthApproved) {
            try {
              const currentMonthDoc = await getDoc(currentMonthRef);
              const dueDate = new Date(currentYear, currentMonth, 1);
              if (currentMonthDoc.exists()) {
                const monthData = currentMonthDoc.data();
                const approvalStatus = monthData.approvalStatus || monthData.paymentStatus;
                const amountDue = parseFloat(monthData.arrears || 0);
                
                if ((approvalStatus === 'unpaid' || approvalStatus === 'pending') && amountDue > 0) {
                  const paymentDueDate = monthData.dueDate?.toDate ? monthData.dueDate.toDate() : dueDate;
                  upcomingPayments.push({
                    type: `Monthly Contribution (${currentMonthName})`,
                    amount: amountDue,
                    dueDate: paymentDueDate,
                    priority: paymentDueDate.getTime()
                  });
                }
              } else {
                // No payment record yet, but it's due
                upcomingPayments.push({
                  type: `Monthly Contribution (${currentMonthName})`,
                  amount: monthlyContribution,
                  dueDate: dueDate,
                  priority: dueDate.getTime()
                });
              }
            } catch (e) {
              console.error(`Error checking current month payment:`, e);
            }
          }
          
          // Check next month
          const nextMonthRef = doc(
            db,
            `groups/${groupId}/payments/${nextMonthYear}_MonthlyContributions/${member.memberId}/${nextMonthYear}_${nextMonthName}`
          );
          
          const nextMonthApproved = await isPaymentApproved(groupId, member.memberId, 'Monthly Contribution', nextMonthRef);
          if (!nextMonthApproved) {
            try {
              const nextMonthDoc = await getDoc(nextMonthRef);
              const dueDate = new Date(nextMonthYear, nextMonth.getMonth(), 1);
              if (nextMonthDoc.exists()) {
                const monthData = nextMonthDoc.data();
                const approvalStatus = monthData.approvalStatus || monthData.paymentStatus;
                const amountDue = parseFloat(monthData.arrears || 0);
                
                if ((approvalStatus === 'unpaid' || approvalStatus === 'pending') && amountDue > 0) {
                  const paymentDueDate = monthData.dueDate?.toDate ? monthData.dueDate.toDate() : dueDate;
                  upcomingPayments.push({
                    type: `Monthly Contribution (${nextMonthName})`,
                    amount: amountDue,
                    dueDate: paymentDueDate,
                    priority: paymentDueDate.getTime()
                  });
                }
              } else {
                // No payment record yet, but it's upcoming
                upcomingPayments.push({
                  type: `Monthly Contribution (${nextMonthName})`,
                  amount: monthlyContribution,
                  dueDate: dueDate,
                  priority: dueDate.getTime()
                });
              }
            } catch (e) {
              console.error(`Error checking next month payment:`, e);
            }
          }
        }
        
        // Find the NEXT upcoming payment (earliest due date that's in the future or due today)
        if (upcomingPayments.length > 0) {
          // Sort by priority (earliest due date first)
          upcomingPayments.sort((a, b) => a.priority - b.priority);
          
          // Find the next upcoming payment (not overdue, or if all are overdue, the least overdue)
          const now = today.getTime();
          const nextPayment = upcomingPayments.find(p => p.dueDate.getTime() >= now) || upcomingPayments[0];
          
          // Only send ONE reminder for the next upcoming payment
          if (nextPayment) {
            const dueDateText = nextPayment.dueDate 
              ? nextPayment.dueDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
              : 'soon';
            
            const notificationRef = doc(collection(db, `groups/${groupId}/notifications`));
            const notificationData = {
              notificationId: notificationRef.id,
              groupId,
              groupName,
              recipientId: member.memberId,
              senderId: 'system',
              senderName: 'System',
              senderEmail: 'system@banknkhonde.com',
              title: `Payment Reminder: ${nextPayment.type}`,
              message: `Dear ${member.fullName},\n\nThis is a reminder that your ${nextPayment.type} payment of MWK ${nextPayment.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} is due ${dueDateText}.\n\nPlease ensure you submit your payment before the deadline to avoid penalties.\n\nThank you for your cooperation.`,
              type: 'warning',
              allowReplies: false,
              read: false,
              isAutomated: true,
              paymentType: nextPayment.type,
              createdAt: Timestamp.now(),
              replies: []
            };

            batch.set(notificationRef, notificationData);
            notifications.push(notificationData);
          }
        }
      } catch (error) {
        console.error(`Error processing reminders for member ${member.memberId}:`, error);
      }
    }

    // Commit all notifications
    if (notifications.length > 0) {
      await batch.commit();
      console.log(`✅ Sent ${notifications.length} payment reminder notifications`);
    }

    return { success: true, count: notifications.length };
  } catch (error) {
    console.error('Error sending payment reminders:', error);
    throw error;
  }
}

/**
 * Send automated payment reminder notifications
 * @param {string} groupId - Group ID
 * @param {number} daysBeforeDue - Number of days before payment is due
 * @deprecated Use sendUserPaymentReminders instead for user-controlled reminders
 */
export async function sendPaymentReminders(groupId, daysBeforeDue = 3) {
  try {
    // Get group data
    const groupDoc = await getDoc(doc(db, 'groups', groupId));
    if (!groupDoc.exists()) {
      throw new Error('Group not found');
    }

    const groupData = groupDoc.data();
    const groupName = groupData.groupName;
    const monthlyContribution = groupData.rules?.monthlyContribution?.amount || 0;
    const seedMoney = groupData.rules?.seedMoney?.amount || 0;

    // Calculate due date
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + daysBeforeDue);

    // Get all active members
    const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
    const members = [];
    membersSnapshot.forEach(doc => {
      const memberData = doc.data();
      if (memberData.status === 'active') {
        members.push({ ...memberData, memberId: doc.id });
      }
    });

    if (members.length === 0) {
      console.log('No active members found');
      return;
    }

    // Get current year and month for payment tracking
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().toLocaleString('default', { month: 'long' });

    // Create notifications for each member
    const batch = writeBatch(db);
    const notifications = [];

    for (const member of members) {
      // Check if member has unpaid payments
      let hasUnpaidPayment = false;
      let paymentAmount = 0;
      let paymentType = '';

      try {
        // Check monthly contribution
        const monthlyPaymentRef = doc(
          db,
          `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${member.memberId}/${currentYear}_${currentMonth}`
        );
        const monthlyPaymentDoc = await getDoc(monthlyPaymentRef);
        
        if (monthlyPaymentDoc.exists()) {
          const paymentData = monthlyPaymentDoc.data();
          if (paymentData.paymentStatus !== 'paid' && paymentData.arrears > 0) {
            hasUnpaidPayment = true;
            paymentAmount = paymentData.arrears;
            paymentType = 'Monthly Contribution';
          }
        }

        // Check seed money if not already checked
        if (!hasUnpaidPayment) {
          const seedMoneyRef = doc(
            db,
            `groups/${groupId}/payments/${currentYear}_SeedMoney/${member.memberId}/PaymentDetails`
          );
          const seedMoneyDoc = await getDoc(seedMoneyRef);
          
          if (seedMoneyDoc.exists()) {
            const seedMoneyData = seedMoneyDoc.data();
            if (seedMoneyData.paymentStatus !== 'paid' && seedMoneyData.arrears > 0) {
              hasUnpaidPayment = true;
              paymentAmount = seedMoneyData.arrears;
              paymentType = 'Seed Money';
            }
          }
        }
      } catch (error) {
        console.error(`Error checking payment status for member ${member.memberId}:`, error);
      }

      // Only send notification if member has unpaid payment
      if (hasUnpaidPayment) {
        const notificationRef = doc(collection(db, `groups/${groupId}/notifications`));
        const notificationData = {
          notificationId: notificationRef.id,
          groupId,
          groupName,
          recipientId: member.memberId,
          senderId: 'system',
          senderName: 'System',
          senderEmail: 'system@banknkhonde.com',
          title: `Payment Reminder: ${paymentType} Due Soon`,
          message: `Dear ${member.fullName},\n\nThis is a reminder that your ${paymentType} payment of MWK ${paymentAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} is due on ${dueDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.\n\nPlease ensure you submit your payment before the deadline to avoid penalties.\n\nThank you for your cooperation.`,
          type: 'warning',
          allowReplies: false,
          read: false,
          isAutomated: true,
          createdAt: Timestamp.now(),
          replies: []
        };

        batch.set(notificationRef, notificationData);
        notifications.push(notificationData);
      }
    }

    // Commit all notifications
    if (notifications.length > 0) {
      await batch.commit();
      console.log(`✅ Sent ${notifications.length} payment reminder notifications`);
      
      // Create broadcast record
      await addDoc(collection(db, `groups/${groupId}/broadcasts`), {
        broadcastId: `auto_payment_reminder_${Date.now()}`,
        groupId,
        groupName,
        senderId: 'system',
        senderName: 'Automated System',
        title: 'Payment Reminders Sent',
        message: `Automated payment reminders sent to ${notifications.length} member(s)`,
        type: 'info',
        allowReplies: false,
        recipientsCount: notifications.length,
        isAutomated: true,
        createdAt: Timestamp.now()
      });
    } else {
      console.log('No members with unpaid payments found');
    }

    return { success: true, count: notifications.length };
  } catch (error) {
    console.error('Error sending payment reminders:', error);
    throw error;
  }
}

/**
 * Send meeting announcement notification
 * @param {string} groupId - Group ID
 * @param {string} meetingDate - Meeting date string
 * @param {string} meetingTime - Meeting time string
 * @param {string} location - Meeting location
 * @param {string} agenda - Meeting agenda (optional)
 */
export async function sendMeetingAnnouncement(groupId, meetingDate, meetingTime, location, agenda = '') {
  try {
    const groupDoc = await getDoc(doc(db, 'groups', groupId));
    if (!groupDoc.exists()) {
      throw new Error('Group not found');
    }

    const groupData = groupDoc.data();
    const groupName = groupData.groupName;

    // Get all active members
    const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
    const members = [];
    membersSnapshot.forEach(doc => {
      const memberData = doc.data();
      if (memberData.status === 'active') {
        members.push({ ...memberData, memberId: doc.id });
      }
    });

    if (members.length === 0) {
      throw new Error('No active members found');
    }

    // Create notifications
    const batch = writeBatch(db);
    const notifications = [];

    for (const member of members) {
      const notificationRef = doc(collection(db, `groups/${groupId}/notifications`));
      const notificationData = {
        notificationId: notificationRef.id,
        groupId,
        groupName,
        recipientId: member.memberId,
        senderId: 'system',
        senderName: 'System',
        senderEmail: 'system@banknkhonde.com',
        title: 'Group Meeting Announcement',
        message: `Dear ${member.fullName},\n\nWe would like to inform you about an upcoming group meeting.\n\nDate: ${meetingDate}\nTime: ${meetingTime}\nLocation: ${location}${agenda ? `\n\nAgenda: ${agenda}` : ''}\n\nPlease make arrangements to attend as important matters will be discussed.\n\nLooking forward to seeing you.`,
        type: 'info',
        allowReplies: true,
        read: false,
        isAutomated: false,
        createdAt: Timestamp.now(),
        replies: []
      };

      batch.set(notificationRef, notificationData);
      notifications.push(notificationData);
    }

    await batch.commit();

    // Create broadcast record
    await addDoc(collection(db, `groups/${groupId}/broadcasts`), {
      broadcastId: `meeting_announcement_${Date.now()}`,
      groupId,
      groupName,
      senderId: 'system',
      senderName: 'System',
      title: 'Group Meeting Announcement',
      message: `Meeting announcement sent to ${notifications.length} member(s)`,
      type: 'info',
      allowReplies: true,
      recipientsCount: notifications.length,
      isAutomated: false,
      createdAt: Timestamp.now()
    });

    console.log(`✅ Sent meeting announcement to ${notifications.length} members`);
    return { success: true, count: notifications.length };
  } catch (error) {
    console.error('Error sending meeting announcement:', error);
    throw error;
  }
}
