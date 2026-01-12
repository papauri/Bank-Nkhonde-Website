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
 * Send automated payment reminder notifications
 * @param {string} groupId - Group ID
 * @param {number} daysBeforeDue - Number of days before payment is due
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
