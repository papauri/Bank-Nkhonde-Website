// Import Firebase using CDN URLs
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import {
    getFirestore,
    collection,
    doc,
    addDoc,
    setDoc,
    getDoc,
    query,
    getDocs
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyClJfGFoc1WZ_qYi5ImQJXyurQtqXgOqfA",
    authDomain: "banknkonde.firebaseapp.com",
    projectId: "banknkonde",
    storageBucket: "banknkonde.appspot.com",
    messagingSenderId: "698749180404",
    appId: "1:698749180404:web:7e8483cae4abd7555101a1",
};

// Initialize Firebase and Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Export the db instance for use in other modules
export { db };

// Initialize loans structure
export async function initializeLoansStructure(groupId, currentYear, months) {
    try {
        for (const month of months) {
            const loansMonthRef = doc(db, `groups/${groupId}/loans/${currentYear}/${month}/initialized`);
            await setDoc(loansMonthRef, { initialized: true });
        }
    } catch (error) {
        console.error("Error initializing loans structure:", { groupId, currentYear, error });
        throw error;
    }
}

// Create a new loan record
export async function createLoanRecord(groupId, currentYear, currentMonth, userFullName, loanAmount, repaymentAmount) {
    try {
        const loansRef = collection(db, `groups/${groupId}/loans/${currentYear}/${currentMonth}/members/${userFullName}`);

        const loanRecord = {
            loanId: `Loan-${Date.now()}`,
            fullName: userFullName,
            loanAmount: formatToTwoDecimals(loanAmount),
            repaymentAmount: formatToTwoDecimals(repaymentAmount),
            loanTakenDate: new Date(),
            repaymentStatus: "ongoing",
            totalLoansTaken: 0, // Track cumulative loans for the user
            loanRank: null, // User's ranking compared to others
        };

        await addDoc(loansRef, loanRecord);
    } catch (error) {
        console.error("Error creating loan record:", { groupId, userFullName, error });
        throw error;
    }
}

// Update loan summary
export async function updateLoanSummary(groupId, currentYear, userFullName, loanAmount) {
    try {
        const loanSummaryDoc = doc(db, `groups/${groupId}/loanSummary/${currentYear}/members/${userFullName}`);
        const existingData = (await getDoc(loanSummaryDoc)).data() || {};

        const updatedSummary = {
            fullName: userFullName,
            totalLoans: formatToTwoDecimals(
                parseFloat(existingData.totalLoans || 0) + parseFloat(loanAmount)
            ),
        };

        await setDoc(loanSummaryDoc, updatedSummary, { merge: true });

        // Optionally calculate rankings
        await calculateLoanRankings(groupId, currentYear);
        console.log(`Loan summary updated for user: ${userFullName}`);
    } catch (error) {
        console.error("Error updating loan summary:", { groupId, userFullName, error });
        throw error;
    }
}

// Calculate loan rankings
async function calculateLoanRankings(groupId, currentYear) {
    try {
        const loanSummaryCollection = collection(db, `groups/${groupId}/loanSummary/${currentYear}/members`);
        const loanDocs = await getDocs(query(loanSummaryCollection));

        const loanData = [];
        loanDocs.forEach((doc) => {
            const data = doc.data();
            if (data.totalLoans) loanData.push(data);
        });

        // Sort by totalLoans in descending order and assign ranks
        loanData.sort((a, b) => b.totalLoans - a.totalLoans);
        for (let i = 0; i < loanData.length; i++) {
            const userDocRef = doc(db, `groups/${groupId}/loanSummary/${currentYear}/members/${loanData[i].fullName}`);
            await setDoc(userDocRef, { loanRank: i + 1 }, { merge: true });
        }

        console.log("Loan rankings updated.");
    } catch (error) {
        console.error("Error calculating loan rankings:", { groupId, currentYear, error });
        throw error;
    }
}

// Utility to format numbers to two decimals
function formatToTwoDecimals(value) {
    if (!value || isNaN(value)) return "0.00";
    return parseFloat(value).toFixed(2);
}
