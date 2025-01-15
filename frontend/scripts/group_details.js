import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

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

document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const groupId = urlParams.get("groupId");

  // DOM Elements
  const groupNameElement = document.getElementById("groupName");
  const groupCreatedElement = document.getElementById("groupCreated");
  const seedMoneyElement = document.getElementById("seedMoney");
  const interestRateElement = document.getElementById("interestRate");
  const monthlyContributionElement = document.getElementById("monthlyContribution");
  const loanPenaltyElement = document.getElementById("loanPenalty");
  const monthlyPenaltyElement = document.getElementById("monthlyPenalty");
  const groupMembersCountElement = document.getElementById("groupMembersCount");
  const loanListElement = document.getElementById("loanList");
  const seedMoneyPaymentsElement = document.getElementById("seedMoneyPayments");
  const monthlyPaymentsElement = document.getElementById("monthlyPayments");
  const backButton = document.getElementById("backButton");

  // Redirect if groupId is missing
  if (!groupId) {
    alert("Group ID is missing. Redirecting to the admin dashboard...");
    window.location.href = "/frontend/pages/admin_dashboard.html";
    return;
  }

  async function displayGroupDetails(groupData, memberCount) {
    document.getElementById("groupName").textContent = groupData.groupName;
    document.getElementById("groupCreated").textContent = new Date(groupData.createdAt.toDate()).toLocaleDateString();
    document.getElementById("seedMoney").textContent = `MWK ${groupData.seedMoney}`;
    document.getElementById("interestRate").textContent = `${groupData.interestRate}%`;
    document.getElementById("monthlyContribution").textContent = `MWK ${groupData.monthlyContribution}`;
    document.getElementById("loanPenalty").textContent = `${groupData.loanPenalty}%`;
    document.getElementById("monthlyPenalty").textContent = `${groupData.monthlyPenalty}%`;
    document.getElementById("groupMembersCount").textContent = memberCount;
  }
  
  async function fetchAndDisplayGroupInfo(groupId) {
    try {
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      const membersSnapshot = await getDocs(collection(db, "groups", groupId, "members"));
      const memberCount = membersSnapshot.size;
  
      if (groupDoc.exists()) {
        const groupData = groupDoc.data();
        displayGroupDetails(groupData, memberCount);
      } else {
        alert("Group not found!");
      }
    } catch (error) {
      console.error("Error fetching group details:", error.message);
      alert("An error occurred while loading the group information.");
    }
  }
  
  fetchAndDisplayGroupInfo(groupId);
  

  // Fetch Group Details
  async function fetchGroupDetails() {
    try {
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (groupDoc.exists()) {
        const groupData = groupDoc.data();
        displayGroupDetails(groupData);
        await fetchAdditionalDetails(groupId);
      } else {
        redirectToDashboard("Group not found.");
      }
    } catch (error) {
      console.error("Error loading group details:", error.message);
      redirectToDashboard("An error occurred while loading the group details.");
    }
  }

  // Display Group Details
  function displayGroupDetails(groupData) {
    groupNameElement.textContent = groupData.groupName;
    groupCreatedElement.textContent = new Date(groupData.createdAt.toDate()).toLocaleDateString();
    seedMoneyElement.textContent = `MWK ${groupData.seedMoney}`;
    interestRateElement.textContent = `${groupData.interestRate}%`;
    monthlyContributionElement.textContent = `MWK ${groupData.monthlyContribution}`;
    loanPenaltyElement.textContent = `${groupData.loanPenalty}%`;
    monthlyPenaltyElement.textContent = `${groupData.monthlyPenalty}%`;
  }

  // Fetch Additional Details (Members, Loans, Payments)
  async function fetchAdditionalDetails(groupId) {
    try {
      const membersSnapshot = await getDocs(collection(db, "groups", groupId, "members"));
      groupMembersCountElement.textContent = membersSnapshot.size;

      const loansSnapshot = await getDocs(collection(db, "groups", groupId, "loans"));
      populateList(loansSnapshot, loanListElement, (loanData) => `Loan: MWK ${loanData.amount} - Borrower: ${loanData.borrower}`);

      const seedPaymentsSnapshot = await getDocs(collection(db, "groups", groupId, "seedMoneyPayments"));
      populateList(seedPaymentsSnapshot, seedMoneyPaymentsElement, (paymentData) => `${paymentData.member}: MWK ${paymentData.amount}`);

      const monthlyPaymentsSnapshot = await getDocs(collection(db, "groups", groupId, "monthlyPayments"));
      populateList(monthlyPaymentsSnapshot, monthlyPaymentsElement, (paymentData) => `${paymentData.member}: MWK ${paymentData.amount}`);
    } catch (error) {
      console.error("Error loading additional group details:", error.message);
      alert("An error occurred while loading additional group details.");
    }
  }

  // Populate List Helper
  function populateList(snapshot, element, formatFunction) {
    element.innerHTML = ""; // Clear existing content
    if (snapshot.empty) {
      element.innerHTML = "<li>No data available</li>";
    } else {
      snapshot.forEach((doc) => {
        const data = doc.data();
        const item = document.createElement("li");
        item.textContent = formatFunction(data);
        element.appendChild(item);
      });
    }
  }

  // Redirect to Dashboard Helper
  function redirectToDashboard(message) {
    alert(`${message} Redirecting to the admin dashboard...`);
    window.location.href = "/frontend/pages/admin_dashboard.html";
  }

  // Event Listeners
  backButton.addEventListener("click", () => {
    window.location.href = "/frontend/pages/admin_dashboard.html";
  });

  // Initialize Fetch
  await fetchGroupDetails();
});
