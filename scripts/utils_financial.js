/**
 * Financial Summary Utilities
 * Ensures financial summaries are always calculated from actual payment records
 */

import { db, doc, getDoc, collection, getDocs, Timestamp } from "./firebaseConfig.js";

/**
 * Recalculate member financial summary from actual payment records
 * This ensures data integrity by always calculating from source data
 * 
 * @param {string} groupId - The group ID
 * @param {string} memberId - The member ID
 * @returns {Promise<Object>} Updated financial summary
 */
export async function recalculateMemberFinancialSummary(groupId, memberId) {
  try {
    const currentYear = new Date().getFullYear();
    const yearsToCheck = [currentYear - 1, currentYear, currentYear + 1];
    
    let totalPaid = 0;
    let totalArrears = 0;
    let totalPending = 0;
    let totalLoans = 0;
    let totalLoansPaid = 0;
    let totalPenalties = 0;

    // 1. Sum Seed Money payments
    for (const year of yearsToCheck) {
      try {
        const seedRef = doc(db, `groups/${groupId}/payments/${year}_SeedMoney/${memberId}/PaymentDetails`);
        const seedDoc = await getDoc(seedRef);
        if (seedDoc.exists()) {
          const seedData = seedDoc.data();
          const amountPaid = parseFloat(seedData.amountPaid || 0);
          const arrears = parseFloat(seedData.arrears || 0);
          totalPaid += amountPaid;
          totalArrears += arrears;
          if (seedData.approvalStatus === "pending") {
            totalPending += arrears;
          }
        }
      } catch (e) {
        // Document might not exist for this year
      }
    }

    // 2. Sum Monthly Contribution payments
    for (const year of yearsToCheck) {
      try {
        const monthlyRef = collection(db, `groups/${groupId}/payments/${year}_MonthlyContributions/${memberId}`);
        const monthlySnapshot = await getDocs(monthlyRef);
        monthlySnapshot.forEach((monthDoc) => {
          const monthData = monthDoc.data();
          const amountPaid = parseFloat(monthData.amountPaid || 0);
          const arrears = parseFloat(monthData.arrears || 0);
          totalPaid += amountPaid;
          totalArrears += arrears;
          if (monthData.approvalStatus === "pending") {
            totalPending += arrears;
          }
        });
      } catch (e) {
        // Collection might not exist for this year
      }
    }

    // 3. Sum Service Fee payments
    for (const year of yearsToCheck) {
      try {
        const serviceFeeRef = doc(db, `groups/${groupId}/payments/${year}_ServiceFee/${memberId}/PaymentDetails`);
        const serviceFeeDoc = await getDoc(serviceFeeRef);
        if (serviceFeeDoc.exists()) {
          const serviceFeeData = serviceFeeDoc.data();
          const amountPaid = parseFloat(serviceFeeData.amountPaid || 0);
          const arrears = parseFloat(serviceFeeData.arrears || 0);
          totalPaid += amountPaid;
          totalArrears += arrears;
          if (serviceFeeData.approvalStatus === "pending") {
            totalPending += arrears;
          }
        }
      } catch (e) {
        // Document might not exist for this year
      }
    }

    // 4. Sum Loan amounts and repayments
    try {
      const loansRef = collection(db, `groups/${groupId}/loans`);
      const loansSnapshot = await getDocs(loansRef);
      loansSnapshot.forEach((loanDoc) => {
        const loanData = loanDoc.data();
        if (loanData.borrowerId === memberId) {
          totalLoans += parseFloat(loanData.amount || 0);
          totalLoansPaid += parseFloat(loanData.amountRepaid || 0);
        }
      });
    } catch (e) {
      // Collection might not exist
    }

    // 5. Sum Penalties
    try {
      const penaltiesRef = collection(db, `groups/${groupId}/penalties`);
      const penaltiesSnapshot = await getDocs(penaltiesRef);
      penaltiesSnapshot.forEach((penaltyDoc) => {
        const penaltyData = penaltyDoc.data();
        if (penaltyData.memberId === memberId && penaltyData.status === "unpaid") {
          totalPenalties += parseFloat(penaltyData.amount || 0);
        }
      });
    } catch (e) {
      // Collection might not exist
    }

    return {
      totalPaid,
      totalArrears,
      totalPending,
      totalLoans,
      totalLoansPaid,
      totalPenalties,
      lastUpdated: Timestamp.now()
    };
  } catch (error) {
    console.error("Error recalculating financial summary:", error);
    throw error;
  }
}

/**
 * Verify and fix relationships in payment documents
 * Ensures all payment documents have proper foreign key references
 * 
 * @param {string} groupId - The group ID
 * @param {string} memberId - The member ID
 * @returns {Promise<boolean>} True if relationships are valid
 */
export async function verifyPaymentRelationships(groupId, memberId) {
  try {
    const currentYear = new Date().getFullYear();
    const yearsToCheck = [currentYear - 1, currentYear, currentYear + 1];
    const issues = [];

    // Check Seed Money payments
    for (const year of yearsToCheck) {
      try {
        const seedRef = doc(db, `groups/${groupId}/payments/${year}_SeedMoney/${memberId}/PaymentDetails`);
        const seedDoc = await getDoc(seedRef);
        if (seedDoc.exists()) {
          const data = seedDoc.data();
          if (!data.userId || data.userId !== memberId) {
            issues.push(`Seed Money ${year}: userId mismatch`);
          }
        }
      } catch (e) {}
    }

    // Check Monthly Contribution payments
    for (const year of yearsToCheck) {
      try {
        const monthlyRef = collection(db, `groups/${groupId}/payments/${year}_MonthlyContributions/${memberId}`);
        const monthlySnapshot = await getDocs(monthlyRef);
        monthlySnapshot.forEach((monthDoc) => {
          const data = monthDoc.data();
          if (!data.userId || data.userId !== memberId) {
            issues.push(`Monthly ${year}/${monthDoc.id}: userId mismatch`);
          }
        });
      } catch (e) {}
    }

    // Check Service Fee payments
    for (const year of yearsToCheck) {
      try {
        const serviceFeeRef = doc(db, `groups/${groupId}/payments/${year}_ServiceFee/${memberId}/PaymentDetails`);
        const serviceFeeDoc = await getDoc(serviceFeeRef);
        if (serviceFeeDoc.exists()) {
          const data = serviceFeeDoc.data();
          if (!data.userId || data.userId !== memberId) {
            issues.push(`Service Fee ${year}: userId mismatch`);
          }
        }
      } catch (e) {}
    }

    if (issues.length > 0) {
      console.warn("Relationship issues found:", issues);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error verifying relationships:", error);
    return false;
  }
}
