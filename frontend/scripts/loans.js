// Import Firebase using CDN URLs
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    getDoc,
    updateDoc,
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyClJfGFoc1WZ_qYi5ImQJXyurQtqXgOqfA",
    authDomain: "banknkonde.firebaseapp.com",
    projectId: "banknkonde",
    storageBucket: "banknkonde.appspot.com",
    messagingSenderId: "698749180404",
    appId: "1:698749180404:web:7e8483cae4abd7555101a1",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Export the db instance for use in other modules
export { db };

/**
 * Initialize loans structure for a group.
 * Ensures the `loans` subcollection is ready to accept loan records.
 * @param {string} groupId - ID of the group.
 */
export async function initializeLoansStructure(groupId) {
    try {
        const groupRef = doc(db, "groups", groupId);
        const groupSnapshot = await getDoc(groupRef);

        if (!groupSnapshot.exists()) {
            throw new Error(`Group with ID ${groupId} does not exist.`);
        }

        console.log(`Loans structure initialized for Group ID: ${groupId}`);
    } catch (error) {
        console.error("Error initializing loans structure:", error);
        throw error;
    }
}

/**
 * Create a new loan record for a user within a group.
 * @param {string} groupId - The ID of the group.
 * @param {string} userId - The ID of the user.
 * @param {string} userFullName - The full name of the user.
 * @param {number} loanAmount - The loan amount (placeholder).
 * @param {string} date - The date when the loan structure is created (month_day_year format).
 */
export async function createLoanRecord(groupId, userId, userFullName, loanAmount = 0, date) {
    try {
        // Fetch group details for dynamic fields like loan penalties
        const groupRef = doc(db, "groups", groupId);
        const groupSnapshot = await getDoc(groupRef);

        if (!groupSnapshot.exists()) {
            throw new Error(`Group with ID ${groupId} does not exist.`);
        }

        const groupData = groupSnapshot.data();
        const latePaymentRate = parseFloat(groupData.loanPenalty || 0); // Loan penalty rate

        // Unique Loan ID based on user and date
        const loanId = `Loan_${userFullName.replace(/\s+/g, "_")}`;

        const loanRecord = {
            loanId, // Unique identifier for the loan
            userId,
            fullName: userFullName,
            loanAmount: formatToTwoDecimals(loanAmount), // Placeholder
            repaymentAmount: "0.00", // Placeholder
            penaltyAmount: "0.00", // Placeholder for late payment penalty
            latePaymentRate, // Penalty rate (percentage)
            loanTakenDate: null, // Placeholder until loan is applied
            dueDate: null, // Placeholder for due date
            repaymentStatus: "not-started", // Default status
            totalOutstanding: "0.00", // Placeholder for balance
            totalPenaltiesIncurred: "0.00", // Placeholder for penalties
            payments: [], // Array to track payment history
            loanReferenceNumber: generateLoanReference(userId), // User-specific loan reference
            createdAt: new Date(),
            updatedAt: null,
        };

        // Save the loan record in the subcollection under the date collection
        const loansCollectionRef = collection(db, `groups/${groupId}/loans/${loanId}/${date}`);
        await setDoc(doc(loansCollectionRef), loanRecord);

        console.log(`Loan record structure created for User: ${userFullName} in Group: ${groupId} on ${date}`);
    } catch (error) {
        console.error("Error creating loan record:", error);
        throw error;
    }
}

/**
 * Update the loan repayment details for a specific loan within a group.
 * @param {string} groupId - The ID of the group.
 * @param {string} loanId - The unique loan ID.
 * @param {string} date - The specific loan date (month_day_year).
 * @param {number} repaymentAmount - The amount repaid by the user.
 */
export async function updateLoanRepayment(groupId, loanId, date, repaymentAmount) {
    try {
        const loanRef = doc(db, `groups/${groupId}/loans/${loanId}/${date}`);
        const loanSnapshot = await getDoc(loanRef);

        if (!loanSnapshot.exists()) {
            throw new Error(`Loan with ID ${loanId} on ${date} does not exist.`);
        }

        const loanData = loanSnapshot.data();
        const newTotalPaid = parseFloat(loanData.repaymentAmount) + repaymentAmount;
        const totalOutstanding = Math.max(parseFloat(loanData.loanAmount) - newTotalPaid, 0);
        const arrears = totalOutstanding > 0 ? totalOutstanding : 0;

        // Create a payment record
        const paymentRecord = {
            amount: formatToTwoDecimals(repaymentAmount),
            date: new Date().toISOString(),
            balance: formatToTwoDecimals(totalOutstanding),
            arrears: formatToTwoDecimals(arrears),
        };

        // Update repayment status
        const repaymentStatus = totalOutstanding === 0 ? "completed" : "ongoing";

        // Update the loan document
        await updateDoc(loanRef, {
            repaymentAmount: formatToTwoDecimals(newTotalPaid),
            totalOutstanding: formatToTwoDecimals(totalOutstanding),
            repaymentStatus,
            updatedAt: new Date(),
            payments: [...(loanData.payments || []), paymentRecord], // Append new payment
        });

        console.log(`Loan repayment updated for Loan ID: ${loanId} on ${date}`);
    } catch (error) {
        console.error("Error updating loan repayment:", error);
        throw error;
    }
}

/**
 * Generate a unique loan reference number.
 * @param {string} userId - The user ID.
 * @returns {string} - A unique loan reference number.
 */
function generateLoanReference(userId) {
    return `REF_${userId}_${Date.now()}`;
}

/**
 * Utility to format numbers to two decimals.
 * @param {number} value - The value to format.
 * @returns {string} - The formatted value as a string.
 */
function formatToTwoDecimals(value) {
    return value ? parseFloat(value).toFixed(2) : "0.00";
}