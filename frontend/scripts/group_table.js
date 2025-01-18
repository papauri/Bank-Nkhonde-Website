import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
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

// Helper function to fetch all documents from a collection
async function fetchCollectionData(ref) {
  const snapshot = await getDocs(ref);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

// Helper function to format numbers
function formatToTwoDecimals(value) {
  return value ? parseFloat(value).toFixed(2) : "0.00";
}

/**
 * Create or update the `memberSummaries` collection with fields: monthlyContribution, interestRate, and monthlyPenalty.
 * @param {string} groupId - The ID of the group.
 */
async function createOrUpdateMemberSummaries(groupId) {
  try {
    const groupRef = doc(db, "groups", groupId);
    const groupSnapshot = await getDoc(groupRef);

    if (!groupSnapshot.exists()) {
      throw new Error(`Group with ID ${groupId} does not exist.`);
    }

    const groupData = groupSnapshot.data();
    const monthlyContributionSet = parseFloat(groupData.monthlyContribution || 0);
    const interestRate = formatToTwoDecimals(groupData.interestRate || 0);
    const monthlyPenalty = formatToTwoDecimals(groupData.monthlyPenalty || 0);

    // Fetch members
    const membersRef = collection(db, `groups/${groupId}/members`);
    const members = await fetchCollectionData(membersRef);

    // Prepare summaries
    const summaries = members.map((member) => {
      const monthlyContribution = formatToTwoDecimals(
        parseFloat(member.monthlyContribution || monthlyContributionSet)
      );

      return {
        fullName: member.fullName || "Unknown",
        monthlyContribution,
        interestRate,
        monthlyPenalty,
      };
    });

    // Save the summaries to Firestore
    const summaryRef = doc(db, `groups/${groupId}/memberSummaries`, "summary");
    await setDoc(
      summaryRef,
      { summaries, updatedAt: new Date() },
      { merge: true }
    );

    console.log("Member summaries created/updated successfully.");
  } catch (error) {
    console.error("Error creating/updating member summaries:", error.message);
  }
}

/**
 * Display the `memberSummaries` in a Handsontable instance.
 * Includes fields fetched directly from the database.
 * @param {string} groupId - The ID of the group.
 */
async function displayGroupTable(groupId) {
  try {
    const summaryRef = doc(db, `groups/${groupId}/memberSummaries`, "summary");
    const summarySnapshot = await getDoc(summaryRef);

    if (!summarySnapshot.exists()) {
      console.log("Creating member summaries...");
      await createOrUpdateMemberSummaries(groupId);
      return displayGroupTable(groupId); // Retry after creating summaries
    }

    const groupRef = doc(db, `groups/${groupId}`);
    const groupSnapshot = await getDoc(groupRef);

    if (!groupSnapshot.exists()) {
      throw new Error(`Group with ID ${groupId} does not exist.`);
    }

    const groupData = groupSnapshot.data();
    const interestRate = groupData.interestRate || "0.00";
    const monthlyPenalty = groupData.monthlyPenalty || "0.00";

    const summaryData = summarySnapshot.data().summaries || [];
    if (summaryData.length === 0) {
      document.getElementById("spreadsheetContainer").textContent =
        "No data available for this group.";
      return;
    }

    const tableData = summaryData.map((member) => ({
      fullName: member.fullName,
      monthlyContribution: member.monthlyContribution || "0.00",
      interestRate: interestRate, // Use group-level interestRate
      monthlyPenalty: monthlyPenalty, // Use group-level monthlyPenalty
    }));

    const spreadsheetContainer = document.getElementById("spreadsheetContainer");
    new Handsontable(spreadsheetContainer, {
      data: tableData,
      colHeaders: [
        "Member Name",
        "Monthly Contribution",
        "Interest Rate",
        "Monthly Penalty",
      ],
      columns: [
        { data: "fullName", type: "text" },
        { data: "monthlyContribution", type: "numeric", format: "0,0.00" },
        { data: "interestRate", type: "numeric", format: "0,0.00" },
        { data: "monthlyPenalty", type: "numeric", format: "0,0.00" },
      ],
      width: "100%",
      height: 500,
      licenseKey: "non-commercial-and-evaluation",
    });

    console.log("Group table displayed successfully.");
  } catch (error) {
    console.error("Error displaying group table:", error.message);
  }
}


// Page Load Logic
document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const groupId = urlParams.get("groupId");

  if (!groupId) {
    alert("Group ID is missing. Redirecting to the admin dashboard...");
    window.location.href = "/frontend/pages/admin_dashboard.html";
    return;
  }

  await displayGroupTable(groupId);
});
