/**
 * Data Validation Utilities for Bank Nkhonde
 * Validates data before writing to Firestore to ensure data integrity
 */

// Validation error class
class ValidationError extends Error {
  constructor(errors) {
    super(`Validation failed: ${errors.join(', ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

// Valid payment types
const VALID_PAYMENT_TYPES = ['seed_money', 'monthly_contribution', 'service_fee'];

// Valid approval statuses
const VALID_APPROVAL_STATUSES = ['unpaid', 'pending', 'approved', 'rejected'];

// Valid payment statuses
const VALID_PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'];

// Valid loan statuses
const VALID_LOAN_STATUSES = ['pending', 'approved', 'rejected', 'disbursed', 'repaid', 'defaulted'];

// Valid member roles
const VALID_MEMBER_ROLES = ['admin', 'treasurer', 'member'];

// Valid member statuses
const VALID_MEMBER_STATUSES = ['active', 'inactive', 'suspended', 'pending'];

/**
 * Validate payment data before creating/updating
 */
function validatePaymentData(paymentData) {
  const errors = [];

  // Required fields
  if (!paymentData.userId) errors.push('userId is required');
  if (!paymentData.groupId) errors.push('groupId is required');
  if (!paymentData.paymentType) errors.push('paymentType is required');

  // Validate payment type
  if (paymentData.paymentType && !VALID_PAYMENT_TYPES.includes(paymentData.paymentType)) {
    errors.push(`Invalid paymentType. Must be one of: ${VALID_PAYMENT_TYPES.join(', ')}`);
  }

  // Validate amounts
  if (paymentData.totalAmount === undefined || paymentData.totalAmount === null) {
    errors.push('totalAmount is required');
  } else if (paymentData.totalAmount < 0) {
    errors.push('totalAmount must be greater than or equal to 0');
  }

  if (paymentData.amountPaid === undefined || paymentData.amountPaid === null) {
    errors.push('amountPaid is required');
  } else if (paymentData.amountPaid < 0) {
    errors.push('amountPaid must be greater than or equal to 0');
  }

  // Validate amountPaid doesn't exceed totalAmount
  if (paymentData.totalAmount !== undefined && paymentData.amountPaid !== undefined) {
    if (paymentData.amountPaid > paymentData.totalAmount) {
      errors.push('amountPaid cannot exceed totalAmount');
    }
  }

  // Calculate and validate arrears
  if (paymentData.totalAmount !== undefined && paymentData.amountPaid !== undefined) {
    const calculatedArrears = paymentData.totalAmount - paymentData.amountPaid;
    if (paymentData.arrears !== undefined && paymentData.arrears !== calculatedArrears) {
      errors.push(`arrears must equal totalAmount - amountPaid (${calculatedArrears})`);
    }
  }

  // Validate monthly contribution has month
  if (paymentData.paymentType === 'monthly_contribution') {
    if (!paymentData.month) errors.push('monthly_contribution must have a month');
    if (!paymentData.year) errors.push('monthly_contribution must have a year');
    if (paymentData.month !== null && (paymentData.month < 1 || paymentData.month > 12)) {
      errors.push('month must be between 1 and 12');
    }
  }

  // Validate approval status
  if (paymentData.approvalStatus && !VALID_APPROVAL_STATUSES.includes(paymentData.approvalStatus)) {
    errors.push(`Invalid approvalStatus. Must be one of: ${VALID_APPROVAL_STATUSES.join(', ')}`);
  }

  // Validate payment status
  if (paymentData.paymentStatus && !VALID_PAYMENT_STATUSES.includes(paymentData.paymentStatus)) {
    errors.push(`Invalid paymentStatus. Must be one of: ${VALID_PAYMENT_STATUSES.join(', ')}`);
  }

  // Validate due date
  if (paymentData.dueDate) {
    const dueDate = new Date(paymentData.dueDate);
    if (isNaN(dueDate.getTime())) {
      errors.push('dueDate must be a valid date');
    }
  }

  return errors;
}

/**
 * Validate loan data before creating/updating
 */
function validateLoanData(loanData) {
  const errors = [];

  // Required fields
  if (!loanData.borrowerId) errors.push('borrowerId is required');
  if (!loanData.groupId) errors.push('groupId is required');
  if (!loanData.amount) errors.push('amount is required');

  // Validate amount
  if (loanData.amount !== undefined && loanData.amount <= 0) {
    errors.push('amount must be greater than 0');
  }

  // Validate interest rate
  if (loanData.interestRate !== undefined && (loanData.interestRate < 0 || loanData.interestRate > 100)) {
    errors.push('interestRate must be between 0 and 100');
  }

  // Validate repayment period
  if (loanData.repaymentPeriodMonths !== undefined && loanData.repaymentPeriodMonths <= 0) {
    errors.push('repaymentPeriodMonths must be greater than 0');
  }

  // Validate loan status
  if (loanData.status && !VALID_LOAN_STATUSES.includes(loanData.status)) {
    errors.push(`Invalid status. Must be one of: ${VALID_LOAN_STATUSES.join(', ')}`);
  }

  // Validate purpose
  if (loanData.purpose && loanData.purpose.length > 500) {
    errors.push('purpose must be less than 500 characters');
  }

  // Validate dates
  if (loanData.dueDate) {
    const dueDate = new Date(loanData.dueDate);
    if (isNaN(dueDate.getTime())) {
      errors.push('dueDate must be a valid date');
    }
  }

  return errors;
}

/**
 * Validate member data before creating/updating
 */
function validateMemberData(memberData) {
  const errors = [];

  // Required fields
  if (!memberData.userId) errors.push('userId is required');
  if (!memberData.groupId) errors.push('groupId is required');
  if (!memberData.role) errors.push('role is required');

  // Validate role
  if (memberData.role && !VALID_MEMBER_ROLES.includes(memberData.role)) {
    errors.push(`Invalid role. Must be one of: ${VALID_MEMBER_ROLES.join(', ')}`);
  }

  // Validate status
  if (memberData.status && !VALID_MEMBER_STATUSES.includes(memberData.status)) {
    errors.push(`Invalid status. Must be one of: ${VALID_MEMBER_STATUSES.join(', ')}`);
  }

  // Validate financial summary
  if (memberData.financialSummary) {
    const summary = memberData.financialSummary;
    
    if (summary.totalPaid !== undefined && summary.totalPaid < 0) {
      errors.push('financialSummary.totalPaid must be greater than or equal to 0');
    }
    
    if (summary.totalArrears !== undefined && summary.totalArrears < 0) {
      errors.push('financialSummary.totalArrears must be greater than or equal to 0');
    }
    
    if (summary.seedMoneyPaid !== undefined && summary.seedMoneyPaid < 0) {
      errors.push('financialSummary.seedMoneyPaid must be greater than or equal to 0');
    }
    
    if (summary.contributionsPaid !== undefined && summary.contributionsPaid < 0) {
      errors.push('financialSummary.contributionsPaid must be greater than or equal to 0');
    }
  }

  return errors;
}

/**
 * Validate group data before creating/updating
 */
function validateGroupData(groupData) {
  const errors = [];

  // Required fields
  if (!groupData.name) errors.push('name is required');
  if (!groupData.createdBy) errors.push('createdBy is required');

  // Validate name length
  if (groupData.name && groupData.name.length > 100) {
    errors.push('name must be less than 100 characters');
  }

  // Validate description
  if (groupData.description && groupData.description.length > 500) {
    errors.push('description must be less than 500 characters');
  }

  // Validate contribution amount
  if (groupData.monthlyContributionAmount !== undefined && groupData.monthlyContributionAmount <= 0) {
    errors.push('monthlyContributionAmount must be greater than 0');
  }

  // Validate seed money amount
  if (groupData.seedMoneyAmount !== undefined && groupData.seedMoneyAmount <= 0) {
    errors.push('seedMoneyAmount must be greater than 0');
  }

  // Validate interest rate
  if (groupData.loanInterestRate !== undefined && (groupData.loanInterestRate < 0 || groupData.loanInterestRate > 100)) {
    errors.push('loanInterestRate must be between 0 and 100');
  }

  return errors;
}

/**
 * Validate transaction data before creating
 */
function validateTransactionData(transactionData) {
  const errors = [];

  // Required fields
  if (!transactionData.groupId) errors.push('groupId is required');
  if (!transactionData.transactionType) errors.push('transactionType is required');
  if (!transactionData.amount) errors.push('amount is required');

  // Validate amount
  if (transactionData.amount !== undefined && transactionData.amount <= 0) {
    errors.push('amount must be greater than 0');
  }

  // Validate transaction type
  const validTypes = ['contribution', 'loan_disbursement', 'loan_repayment', 'penalty', 'fee', 'refund'];
  if (transactionData.transactionType && !validTypes.includes(transactionData.transactionType)) {
    errors.push(`Invalid transactionType. Must be one of: ${validTypes.join(', ')}`);
  }

  // Validate description
  if (transactionData.description && transactionData.description.length > 500) {
    errors.push('description must be less than 500 characters');
  }

  return errors;
}

/**
 * Validate notification data before creating
 */
function validateNotificationData(notificationData) {
  const errors = [];

  // Required fields
  if (!notificationData.recipientId) errors.push('recipientId is required');
  if (!notificationData.type) errors.push('type is required');
  if (!notificationData.title) errors.push('title is required');

  // Validate title length
  if (notificationData.title && notificationData.title.length > 200) {
    errors.push('title must be less than 200 characters');
  }

  // Validate message length
  if (notificationData.message && notificationData.message.length > 1000) {
    errors.push('message must be less than 1000 characters');
  }

  return errors;
}

/**
 * Main validation function that throws ValidationError if validation fails
 */
function validate(data, type) {
  let errors;

  switch (type) {
    case 'payment':
      errors = validatePaymentData(data);
      break;
    case 'loan':
      errors = validateLoanData(data);
      break;
    case 'member':
      errors = validateMemberData(data);
      break;
    case 'group':
      errors = validateGroupData(data);
      break;
    case 'transaction':
      errors = validateTransactionData(data);
      break;
    case 'notification':
      errors = validateNotificationData(data);
      break;
    default:
      throw new Error(`Unknown validation type: ${type}`);
  }

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  return true;
}

/**
 * Calculate arrears automatically - only for overdue payments
 * Arrears = money that SHOULD have been paid (past due date) but hasn't been
 * @param {number} totalAmount - Total amount that should be paid
 * @param {number} amountPaid - Amount that has been paid
 * @param {Timestamp|Date} dueDate - When the payment was/is due
 * @returns {number} - Arrears amount (0 if not overdue)
 */
function calculateArrears(totalAmount, amountPaid, dueDate = null) {
  const outstanding = Math.max(0, totalAmount - amountPaid);
  
  // If no due date provided, or payment is fully paid, no arrears
  if (!dueDate || outstanding === 0) {
    return 0;
  }
  
  // Convert Firestore Timestamp to Date if needed
  const dueDateObj = dueDate.toDate ? dueDate.toDate() : new Date(dueDate);
  const now = new Date();
  
  // Only count as arrears if due date has passed
  if (now > dueDateObj) {
    return outstanding;
  }
  
  // Payment is not yet due, so no arrears
  return 0;
}

/**
 * Calculate payment status automatically
 */
function calculatePaymentStatus(totalAmount, amountPaid) {
  if (amountPaid <= 0) return 'unpaid';
  if (amountPaid >= totalAmount) return 'paid';
  return 'partial';
}

/**
 * Calculate loan repayment status
 */
function calculateLoanRepaidStatus(principalAmount, amountRepaid) {
  if (amountRepaid <= 0) return 0;
  if (amountRepaid >= principalAmount) return 100;
  return Math.round((amountRepaid / principalAmount) * 100);
}

/**
 * Sanitize string input to prevent XSS
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitize object recursively
 */
function sanitizeObject(obj) {
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  
  if (obj !== null && typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }
  
  return obj;
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ValidationError,
    validate,
    validatePaymentData,
    validateLoanData,
    validateMemberData,
    validateGroupData,
    validateTransactionData,
    validateNotificationData,
    calculateArrears,
    calculatePaymentStatus,
    calculateLoanRepaidStatus,
    sanitizeString,
    sanitizeObject,
    VALID_PAYMENT_TYPES,
    VALID_APPROVAL_STATUSES,
    VALID_PAYMENT_STATUSES,
    VALID_LOAN_STATUSES,
    VALID_MEMBER_ROLES,
    VALID_MEMBER_STATUSES
  };
}