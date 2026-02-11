import { db, doc, setDoc, getDoc, collection, Timestamp } from "./firebaseConfig.js";

/**
 * Initialize payment records for a new member
 * Creates seed money, monthly contribution, and service fee records matching the database structure
 * @param {string} groupId - The group ID
 * @param {string} memberId - The member's user ID
 * @param {string} memberName - The member's full name
 * @param {number} seedMoney - Seed money amount
 * @param {number} monthlyContribution - Monthly contribution amount
 * @param {number} loanPenalty - Loan penalty percentage
 * @param {number} monthlyPenalty - Monthly penalty percentage
 * @param {number} serviceFee - Service fee amount (optional, defaults to 0)
 */
export async function updatePaymentsForNewMember(groupId, memberId, memberName, seedMoney, monthlyContribution, loanPenalty, monthlyPenalty, serviceFee = 0) {
  try {
    const currentYear = new Date().getFullYear();
    const PAYMENT_DETAILS_DOC = "PaymentDetails";

    // Get group data for cycle dates and due date
    const groupDoc = await getDoc(doc(db, "groups", groupId));
    if (!groupDoc.exists()) {
      throw new Error("Group not found");
    }
    const groupData = groupDoc.data();
    const cycleDates = groupData.cycleDates || [];
    const seedMoneyDueDate = groupData.rules?.seedMoney?.dueDate || Timestamp.now();
    const serviceFeeAmount = serviceFee || (groupData.rules?.serviceFee?.amount || 0);
    const serviceFeeDueDate = groupData.rules?.serviceFee?.dueDate || seedMoneyDueDate;

    // 1. Create Seed Money Payment Record
    const seedMoneyDocRef = doc(db, `groups/${groupId}/payments`, `${currentYear}_SeedMoney`);
    
    // Ensure parent document exists
    const seedMoneyParent = await getDoc(seedMoneyDocRef);
    if (!seedMoneyParent.exists()) {
      await setDoc(seedMoneyDocRef, {
        year: currentYear,
        paymentType: "SeedMoney",
        createdAt: Timestamp.now(),
        totalExpected: parseFloat(seedMoney) || 0,
        totalReceived: 0,
        totalPending: 0
      });
    }

    // Create user seed money document
    const userSeedMoneyRef = doc(collection(seedMoneyDocRef, memberId), PAYMENT_DETAILS_DOC);
    await setDoc(userSeedMoneyRef, {
      userId: memberId,
      fullName: memberName,
      paymentType: "Seed Money",
      totalAmount: parseFloat(seedMoney) || 0,
      amountPaid: 0,
      arrears: 0,
      approvalStatus: "unpaid",
      paymentStatus: "unpaid",
      dueDate: seedMoneyDueDate,
      paidAt: null,
      approvedAt: null,
      createdAt: Timestamp.now(),
      updatedAt: null,
      proofOfPayment: {
        imageUrl: "",
        uploadedAt: null,
        verifiedBy: ""
      },
      penaltyRate: parseFloat(monthlyPenalty) || 0,
      currency: "MWK"
    });

    // 2. Create Monthly Contributions Payment Records
    const monthlyContributionDocRef = doc(db, `groups/${groupId}/payments`, `${currentYear}_MonthlyContributions`);
    
    // Ensure parent document exists
    const monthlyParent = await getDoc(monthlyContributionDocRef);
    if (!monthlyParent.exists()) {
      await setDoc(monthlyContributionDocRef, {
        year: currentYear,
        paymentType: "MonthlyContributions",
        createdAt: Timestamp.now(),
        totalExpected: (parseFloat(monthlyContribution) || 0) * 12,
        totalReceived: 0,
        totalPending: 0
      });
    }

    // Create monthly contribution records for each cycle date
    const userMonthlyCollection = collection(monthlyContributionDocRef, memberId);
    
    for (const cycleDate of cycleDates) {
      const date = cycleDate.toDate ? cycleDate.toDate() : new Date(cycleDate);
      const year = date.getFullYear();
      const month = date.toLocaleString("default", { month: "long" });
      
      // Only create for current year and future months
      const today = new Date();
      if (date >= new Date(today.getFullYear(), today.getMonth(), 1)) {
        const monthlyPaymentDoc = doc(userMonthlyCollection, `${year}_${month}`);
        await setDoc(monthlyPaymentDoc, {
          userId: memberId,
          fullName: memberName,
          paymentType: "Monthly Contribution",
          month: month,
          year: year,
          totalAmount: parseFloat(monthlyContribution) || 0,
          amountPaid: 0,
          arrears: 0,
          approvalStatus: "unpaid",
          paymentStatus: "unpaid",
          dueDate: Timestamp.fromDate(date),
          paidAt: null,
          approvedAt: null,
          createdAt: Timestamp.now(),
          updatedAt: null,
          proofOfPayment: {
            imageUrl: "",
            uploadedAt: null,
            verifiedBy: ""
          },
          penaltyRate: parseFloat(monthlyPenalty) || 0,
          currency: "MWK"
        });
      }
    }

    // 3. Create Service Fee Payment Record (if service fee is set)
    if (serviceFeeAmount > 0) {
      const serviceFeeDocRef = doc(db, `groups/${groupId}/payments`, `${currentYear}_ServiceFee`);
      
      // Ensure parent document exists
      const serviceFeeParent = await getDoc(serviceFeeDocRef);
      if (!serviceFeeParent.exists()) {
        await setDoc(serviceFeeDocRef, {
          year: currentYear,
          paymentType: "ServiceFee",
          createdAt: Timestamp.now(),
          totalExpected: parseFloat(serviceFeeAmount) || 0,
          totalReceived: 0,
          totalPending: 0,
          perCycle: true,
          nonRefundable: true
        });
      }

      // Create user service fee document
      const userServiceFeeRef = doc(collection(serviceFeeDocRef, memberId), PAYMENT_DETAILS_DOC);
      await setDoc(userServiceFeeRef, {
        userId: memberId,
        fullName: memberName,
        paymentType: "Service Fee",
        totalAmount: parseFloat(serviceFeeAmount) || 0,
        amountPaid: 0,
        arrears: 0,
        approvalStatus: "unpaid",
        paymentStatus: "unpaid",
        dueDate: serviceFeeDueDate.toDate ? serviceFeeDueDate : Timestamp.fromDate(new Date(serviceFeeDueDate)),
        paidAt: null,
        approvedAt: null,
        createdAt: Timestamp.now(),
        updatedAt: null,
        proofOfPayment: {
          imageUrl: "",
          uploadedAt: null,
          verifiedBy: ""
        },
        currency: "MWK",
        perCycle: true,
        nonRefundable: true,
        description: "Operational service fee (bank charges, etc.)"
      });
    }

    // 4. Update member's financial summary
    const memberRef = doc(db, `groups/${groupId}/members`, memberId);
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      await setDoc(memberRef, {
        ...memberDoc.data(),
        financialSummary: {
          totalPaid: 0,
          totalArrears: 0,
          totalPending: parseFloat(seedMoney) || 0,
          totalLoans: 0,
          totalLoansPaid: 0,
          totalPenalties: 0,
          lastUpdated: Timestamp.now()
        }
      }, { merge: true });
    }

    return true;
  } catch (error) {
    console.error("Error initializing payments:", error);
    throw error;
  }
}

/**
 * Validate payment amount
 * @param {number} amount - Amount to validate
 * @param {string} fieldName - Name of the field for error messages
 * @returns {Object} - { valid: boolean, error: string }
 */
export function validatePaymentAmount(amount, fieldName = "Amount") {
  if (amount === null || amount === undefined || amount === "") {
    return { valid: false, error: `${fieldName} is required` };
  }
  
  const numAmount = parseFloat(amount);
  
  if (isNaN(numAmount)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }
  
  if (numAmount < 0) {
    return { valid: false, error: `${fieldName} cannot be negative` };
  }
  
  if (numAmount > 100000000) {
    return { valid: false, error: `${fieldName} exceeds maximum allowed (100,000,000 MWK)` };
  }
  
  // Check for reasonable decimal places (max 2)
  if (numAmount.toString().includes('.') && numAmount.toString().split('.')[1].length > 2) {
    return { valid: false, error: `${fieldName} can have maximum 2 decimal places` };
  }
  
  return { valid: true, amount: numAmount };
}

/**
 * Validate percentage value
 * @param {number} percentage - Percentage to validate
 * @param {string} fieldName - Name of the field for error messages
 * @returns {Object} - { valid: boolean, error: string }
 */
export function validatePercentage(percentage, fieldName = "Percentage") {
  if (percentage === null || percentage === undefined || percentage === "") {
    return { valid: false, error: `${fieldName} is required` };
  }
  
  const numPercentage = parseFloat(percentage);
  
  if (isNaN(numPercentage)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }
  
  if (numPercentage < 0) {
    return { valid: false, error: `${fieldName} cannot be negative` };
  }
  
  if (numPercentage > 100) {
    return { valid: false, error: `${fieldName} cannot exceed 100%` };
  }
  
  return { valid: true, percentage: numPercentage };
}

/**
 * Format currency for display
 * @param {number} amount - Amount to format
 * @returns {string} - Formatted currency string
 */
export function formatCurrency(amount) {
  const numAmount = parseFloat(amount) || 0;
  return `MWK ${numAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Calculate penalty amount
 * @param {number} originalAmount - Original amount due
 * @param {number} penaltyRate - Penalty rate as percentage
 * @returns {number} - Penalty amount
 */
export function calculatePenalty(originalAmount, penaltyRate) {
  const amount = parseFloat(originalAmount) || 0;
  const rate = parseFloat(penaltyRate) || 0;
  return parseFloat((amount * (rate / 100)).toFixed(2));
}

/**
 * Calculate loan repayment with tiered interest
 * @param {number} loanAmount - Original loan amount
 * @param {Object} interestRates - { month1: %, month2: %, month3AndBeyond: % }
 * @param {number} repaymentMonths - Number of months for repayment
 * @returns {Object} - Repayment schedule
 */
export function calculateLoanRepayment(loanAmount, interestRates, repaymentMonths = 1) {
  const amount = parseFloat(loanAmount) || 0;
  const schedule = [];
  let remainingBalance = amount;
  
  for (let month = 1; month <= repaymentMonths; month++) {
    let interestRate;
    if (month === 1) {
      interestRate = parseFloat(interestRates.month1) || 0;
    } else if (month === 2) {
      interestRate = parseFloat(interestRates.month2) || parseFloat(interestRates.month1) || 0;
    } else {
      interestRate = parseFloat(interestRates.month3AndBeyond) || parseFloat(interestRates.month2) || parseFloat(interestRates.month1) || 0;
    }
    
    const interestAmount = parseFloat((remainingBalance * (interestRate / 100)).toFixed(2));
    const principalPayment = parseFloat((amount / repaymentMonths).toFixed(2));
    const monthlyPayment = principalPayment + interestAmount;
    
    remainingBalance = parseFloat((remainingBalance - principalPayment).toFixed(2));
    
    schedule.push({
      month: month,
      principal: principalPayment,
      interest: interestAmount,
      interestRate: interestRate,
      totalPayment: monthlyPayment,
      remainingBalance: Math.max(0, remainingBalance)
    });
  }
  
  const totalInterest = schedule.reduce((sum, m) => sum + m.interest, 0);
  const totalRepayable = amount + totalInterest;
  
  return {
    loanAmount: amount,
    totalInterest: parseFloat(totalInterest.toFixed(2)),
    totalRepayable: parseFloat(totalRepayable.toFixed(2)),
    schedule: schedule
  };
}
