/**
 * Batch Operations Utilities for Bank Nkhonde
 * Provides atomic batched write operations for data consistency
 */

/**
 * Batched Payment Approval
 * Atomically approves a payment and updates all related data
 * 
 * @param {Firestore} db - Firestore instance
 * @param {string} groupId - Group ID
 * @param {string} paymentId - Payment ID
 * @param {string} userId - User ID
 * @param {object} paymentData - Payment data to approve
 * @returns {Promise<void>}
 */
async function batchApprovePayment(db, groupId, paymentId, userId, paymentData) {
  const batch = writeBatch(db);

  // 1. Update payment approval status
  const paymentRef = doc(db, `groups/${groupId}/payments/${paymentId}`);
  batch.update(paymentRef, {
    approvalStatus: 'approved',
    approvedAt: serverTimestamp(),
    approvedBy: auth.currentUser.uid
  });

  // 2. Update member financial summary
  const memberRef = doc(db, `groups/${groupId}/members/${userId}`);
  batch.update(memberRef, {
    'financialSummary.totalPaid': increment(paymentData.amountPaid),
    'financialSummary.lastUpdated': serverTimestamp()
  });

  // 3. Update group statistics
  const groupRef = doc(db, `groups/${groupId}`);
  batch.update(groupRef, {
    'statistics.totalPaymentsApproved': increment(1),
    'statistics.totalAmountCollected': increment(paymentData.amountPaid),
    'statistics.lastUpdated': serverTimestamp()
  });

  // 4. Create transaction record
  const transactionRef = doc(collection(db, `groups/${groupId}/transactions`));
  batch.set(transactionRef, {
    transactionId: transactionRef.id,
    groupId: groupId,
    userId: userId,
    transactionType: 'contribution',
    amount: paymentData.amountPaid,
    paymentType: paymentData.paymentType,
    description: `${paymentData.paymentType.replace('_', ' ')} payment`,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser.uid
  });

  // 5. Create notification for user
  const notificationRef = doc(collection(db, 'notifications'));
  batch.set(notificationRef, {
    notificationId: notificationRef.id,
    recipientId: userId,
    groupId: groupId,
    type: 'payment_approved',
    title: 'Payment Approved',
    message: `Your ${paymentData.paymentType.replace('_', ' ')} payment of ${formatCurrency(paymentData.amountPaid)} has been approved.`,
    read: false,
    createdAt: serverTimestamp()
  });

  // Commit all operations atomically
  try {
    await batch.commit();
    console.log('Payment approved successfully with all related updates');
    return { success: true, message: 'Payment approved successfully' };
  } catch (error) {
    console.error('Error approving payment:', error);
    throw new Error(`Failed to approve payment: ${error.message}`);
  }
}

/**
 * Batched Loan Disbursement
 * Atomically disburses a loan and updates all related data
 * 
 * @param {Firestore} db - Firestore instance
 * @param {string} groupId - Group ID
 * @param {string} loanId - Loan ID
 * @param {string} borrowerId - Borrower ID
 * @param {object} loanData - Loan data
 * @returns {Promise<void>}
 */
async function batchDisburseLoan(db, groupId, loanId, borrowerId, loanData) {
  const batch = writeBatch(db);

  // 1. Update loan status
  const loanRef = doc(db, `groups/${groupId}/loans/${loanId}`);
  batch.update(loanRef, {
    status: 'disbursed',
    disbursedAt: serverTimestamp(),
    disbursedBy: auth.currentUser.uid
  });

  // 2. Update member loan summary
  const memberRef = doc(db, `groups/${groupId}/members/${borrowerId}`);
  batch.update(memberRef, {
    'loanSummary.activeLoans': increment(1),
    'loanSummary.totalLoansTaken': increment(1),
    'loanSummary.totalAmountBorrowed': increment(loanData.amount),
    'loanSummary.lastUpdated': serverTimestamp()
  });

  // 3. Update group statistics
  const groupRef = doc(db, `groups/${groupId}`);
  batch.update(groupRef, {
    'statistics.activeLoans': increment(1),
    'statistics.totalLoansDisbursed': increment(1),
    'statistics.totalAmountLent': increment(loanData.amount),
    'statistics.lastUpdated': serverTimestamp()
  });

  // 4. Create transaction record
  const transactionRef = doc(collection(db, `groups/${groupId}/transactions`));
  batch.set(transactionRef, {
    transactionId: transactionRef.id,
    groupId: groupId,
    userId: borrowerId,
    transactionType: 'loan_disbursement',
    amount: loanData.amount,
    loanId: loanId,
    description: `Loan disbursement: ${loanData.purpose || 'General'}`,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser.uid
  });

  // 5. Create notification for borrower
  const notificationRef = doc(collection(db, 'notifications'));
  batch.set(notificationRef, {
    notificationId: notificationRef.id,
    recipientId: borrowerId,
    groupId: groupId,
    type: 'loan_disbursed',
    title: 'Loan Disbursed',
    message: `Your loan of ${formatCurrency(loanData.amount)} has been disbursed.`,
    read: false,
    createdAt: serverTimestamp()
  });

  // Commit all operations atomically
  try {
    await batch.commit();
    console.log('Loan disbursed successfully with all related updates');
    return { success: true, message: 'Loan disbursed successfully' };
  } catch (error) {
    console.error('Error disbursing loan:', error);
    throw new Error(`Failed to disburse loan: ${error.message}`);
  }
}

/**
 * Batched Loan Repayment
 * Atomically records a loan repayment and updates all related data
 * 
 * @param {Firestore} db - Firestore instance
 * @param {string} groupId - Group ID
 * @param {string} loanId - Loan ID
 * @param {string} borrowerId - Borrower ID
 * @param {number} repaymentAmount - Amount being repaid
 * @returns {Promise<void>}
 */
async function batchRecordLoanRepayment(db, groupId, loanId, borrowerId, repaymentAmount) {
  const batch = writeBatch(db);

  // 1. Get current loan data first
  const loanRef = doc(db, `groups/${groupId}/loans/${loanId}`);
  const loanSnap = await getDoc(loanRef);
  
  if (!loanSnap.exists()) {
    throw new Error('Loan not found');
  }

  const loanData = loanSnap.data();
  const newAmountRepaid = (loanData.amountRepaid || 0) + repaymentAmount;
  const isFullyRepaid = newAmountRepaid >= loanData.amount;

  // 2. Update loan
  batch.update(loanRef, {
    amountRepaid: newAmountRepaid,
    repaidStatus: isFullyRepaid ? 100 : Math.round((newAmountRepaid / loanData.amount) * 100),
    status: isFullyRepaid ? 'repaid' : 'disbursed',
    lastPaymentDate: serverTimestamp()
  });

  // 3. Update member summary
  const memberRef = doc(db, `groups/${groupId}/members/${borrowerId}`);
  batch.update(memberRef, {
    'loanSummary.totalAmountRepaid': increment(repaymentAmount),
    'loanSummary.activeLoans': isFullyRepaid ? increment(-1) : increment(0),
    'loanSummary.lastUpdated': serverTimestamp()
  });

  // 4. Update group statistics
  const groupRef = doc(db, `groups/${groupId}`);
  batch.update(groupRef, {
    'statistics.totalLoanRepaymentsReceived': increment(repaymentAmount),
    'statistics.activeLoans': isFullyRepaid ? increment(-1) : increment(0),
    'statistics.lastUpdated': serverTimestamp()
  });

  // 5. Create transaction record
  const transactionRef = doc(collection(db, `groups/${groupId}/transactions`));
  batch.set(transactionRef, {
    transactionId: transactionRef.id,
    groupId: groupId,
    userId: borrowerId,
    transactionType: 'loan_repayment',
    amount: repaymentAmount,
    loanId: loanId,
    description: `Loan repayment (${isFullyRepaid ? 'Final' : 'Partial'})`,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser.uid
  });

  // 6. Create notification
  const notificationRef = doc(collection(db, 'notifications'));
  batch.set(notificationRef, {
    notificationId: notificationRef.id,
    recipientId: borrowerId,
    groupId: groupId,
    type: isFullyRepaid ? 'loan_fully_repaid' : 'loan_repayment_received',
    title: isFullyRepaid ? 'Loan Fully Repaid' : 'Repayment Received',
    message: isFullyRepaid 
      ? `Congratulations! You have fully repaid your loan of ${formatCurrency(loanData.amount)}.`
      : `Your loan repayment of ${formatCurrency(repaymentAmount)} has been received.`,
    read: false,
    createdAt: serverTimestamp()
  });

  // Commit all operations atomically
  try {
    await batch.commit();
    console.log('Loan repayment recorded successfully');
    return { 
      success: true, 
      message: isFullyRepaid ? 'Loan fully repaid!' : 'Repayment recorded successfully',
      isFullyRepaid 
    };
  } catch (error) {
    console.error('Error recording repayment:', error);
    throw new Error(`Failed to record repayment: ${error.message}`);
  }
}

/**
 * Batched Member Addition
 * Atomically adds a member to a group with all initializations
 * 
 * @param {Firestore} db - Firestore instance
 * @param {string} groupId - Group ID
 * @param {string} userId - User ID
 * @param {object} memberData - Member data
 * @returns {Promise<void>}
 */
async function batchAddMember(db, groupId, userId, memberData) {
  const batch = writeBatch(db);

  // 1. Create member document
  const memberRef = doc(db, `groups/${groupId}/members/${userId}`);
  batch.set(memberRef, {
    userId: userId,
    groupId: groupId,
    role: memberData.role || 'member',
    status: 'active',
    joinedAt: serverTimestamp(),
    invitedBy: memberData.invitedBy || null,
    financialSummary: {
      totalPaid: 0,
      totalArrears: 0,
      seedMoneyPaid: 0,
      contributionsPaid: 0,
      serviceFeePaid: 0,
      lastUpdated: serverTimestamp()
    },
    loanSummary: {
      activeLoans: 0,
      totalLoansTaken: 0,
      totalAmountBorrowed: 0,
      totalAmountRepaid: 0,
      lastUpdated: serverTimestamp()
    }
  });

  // 2. Update group member count
  const groupRef = doc(db, `groups/${groupId}`);
  batch.update(groupRef, {
    'statistics.memberCount': increment(1),
    'statistics.lastUpdated': serverTimestamp()
  });

  // 3. Create notification for new member
  const notificationRef = doc(collection(db, 'notifications'));
  batch.set(notificationRef, {
    notificationId: notificationRef.id,
    recipientId: userId,
    groupId: groupId,
    type: 'group_joined',
    title: 'Welcome to the Group!',
    message: `You have been added to ${memberData.groupName || 'the group'}.`,
    read: false,
    createdAt: serverTimestamp()
  });

  // Commit all operations atomically
  try {
    await batch.commit();
    console.log('Member added successfully');
    return { success: true, message: 'Member added successfully' };
  } catch (error) {
    console.error('Error adding member:', error);
    throw new Error(`Failed to add member: ${error.message}`);
  }
}

/**
 * Batched Member Removal
 * Atomically removes a member and updates group data
 * 
 * @param {Firestore} db - Firestore instance
 * @param {string} groupId - Group ID
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
async function batchRemoveMember(db, groupId, userId) {
  const batch = writeBatch(db);

  // 1. Get member data first for statistics
  const memberRef = doc(db, `groups/${groupId}/members/${userId}`);
  const memberSnap = await getDoc(memberRef);
  
  if (!memberSnap.exists()) {
    throw new Error('Member not found');
  }

  const memberData = memberSnap.data();

  // 2. Delete member document
  batch.delete(memberRef);

  // 3. Update group member count
  const groupRef = doc(db, `groups/${groupId}`);
  batch.update(groupRef, {
    'statistics.memberCount': increment(-1),
    'statistics.lastUpdated': serverTimestamp()
  });

  // 4. Create notification
  const notificationRef = doc(collection(db, 'notifications'));
  batch.set(notificationRef, {
    notificationId: notificationRef.id,
    recipientId: userId,
    groupId: groupId,
    type: 'group_left',
    title: 'Removed from Group',
    message: 'You have been removed from the group.',
    read: false,
    createdAt: serverTimestamp()
  });

  // Commit all operations atomically
  try {
    await batch.commit();
    console.log('Member removed successfully');
    return { success: true, message: 'Member removed successfully' };
  } catch (error) {
    console.error('Error removing member:', error);
    throw new Error(`Failed to remove member: ${error.message}`);
  }
}

/**
 * Batched Group Creation
 * Atomically creates a group with all initial data
 * 
 * @param {Firestore} db - Firestore instance
 * @param {string} groupId - Group ID
 * @param {object} groupData - Group data
 * @param {string} creatorId - Creator user ID
 * @returns {Promise<void>}
 */
async function batchCreateGroup(db, groupId, groupData, creatorId) {
  const batch = writeBatch(db);

  // 1. Create group document
  const groupRef = doc(db, `groups/${groupId}`);
  batch.set(groupRef, {
    groupId: groupId,
    name: groupData.name,
    description: groupData.description || '',
    createdBy: creatorId,
    createdAt: serverTimestamp(),
    settings: {
      monthlyContributionAmount: groupData.monthlyContributionAmount || 0,
      seedMoneyAmount: groupData.seedMoneyAmount || 0,
      loanInterestRate: groupData.loanInterestRate || 10,
      maxLoanAmount: groupData.maxLoanAmount || 100000,
      currency: groupData.currency || 'MWK'
    },
    statistics: {
      memberCount: 1,
      totalPaymentsApproved: 0,
      totalAmountCollected: 0,
      activeLoans: 0,
      totalLoansDisbursed: 0,
      totalAmountLent: 0,
      totalLoanRepaymentsReceived: 0,
      lastUpdated: serverTimestamp()
    }
  });

  // 2. Add creator as admin member
  const memberRef = doc(db, `groups/${groupId}/members/${creatorId}`);
  batch.set(memberRef, {
    userId: creatorId,
    groupId: groupId,
    role: 'admin',
    status: 'active',
    joinedAt: serverTimestamp(),
    invitedBy: null,
    financialSummary: {
      totalPaid: 0,
      totalArrears: 0,
      seedMoneyPaid: 0,
      contributionsPaid: 0,
      serviceFeePaid: 0,
      lastUpdated: serverTimestamp()
    },
    loanSummary: {
      activeLoans: 0,
      totalLoansTaken: 0,
      totalAmountBorrowed: 0,
      totalAmountRepaid: 0,
      lastUpdated: serverTimestamp()
    }
  });

  // 3. Create welcome notification
  const notificationRef = doc(collection(db, 'notifications'));
  batch.set(notificationRef, {
    notificationId: notificationRef.id,
    recipientId: creatorId,
    groupId: groupId,
    type: 'group_created',
    title: 'Group Created Successfully!',
    message: `Your group "${groupData.name}" has been created successfully.`,
    read: false,
    createdAt: serverTimestamp()
  });

  // Commit all operations atomically
  try {
    await batch.commit();
    console.log('Group created successfully');
    return { success: true, message: 'Group created successfully', groupId };
  } catch (error) {
    console.error('Error creating group:', error);
    throw new Error(`Failed to create group: ${error.message}`);
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    batchApprovePayment,
    batchDisburseLoan,
    batchRecordLoanRepayment,
    batchAddMember,
    batchRemoveMember,
    batchCreateGroup
  };
}