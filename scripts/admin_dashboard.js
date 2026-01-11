import {
  db,
  auth,
  collection,
  getDocs,
  doc,
  getDoc,
  onAuthStateChanged,
  signOut,
} from "./firebaseConfig.js";

onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("User is signed in:", user.email);
  } else {
    console.log("No user is signed in.");
    alert("You must be signed in to access this page.");
    window.location.href = "../login.html"; // Redirect to login page
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const groupList = document.getElementById("groupList");
  const welcomeMessage = document.getElementById("welcomeMessage");
  const adminNameSpan = document.getElementById("adminName");
  const dashboardTitle = document.getElementById("dashboardTitle");
  const switchViewButton = document.getElementById("switchViewButton");
  const logoutButton = document.getElementById("logoutButton");
  const createGroupButton = document.getElementById("createGroupButton");
  const analyticsButton = document.getElementById("analyticsButton");
  const settingsButton = document.getElementById("settingsButton");
  
  // Quick action buttons
  const manageLoansButton = document.getElementById("manageLoansButton");
  const managePaymentsButton = document.getElementById("managePaymentsButton");
  const viewContributionsButton = document.getElementById("viewContributionsButton");
  const viewSeedMoneyButton = document.getElementById("viewSeedMoneyButton");
  const manageInterestButton = document.getElementById("manageInterestButton");
  const viewReportsButton = document.getElementById("viewReportsButton");

  let isAdminView = true;
  let sessionTimeout;

  // ✅ Set session timeout for 1 hour
  function resetSessionTimer() {
    clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(async () => {
      alert("Your session has expired. You will be logged out.");
      await handleLogout();
    }, 60 * 60 * 1000); // 1 hour
  }

  // ✅ Handle logout functionality
  async function handleLogout() {
    try {
      await signOut(auth);
      alert("You have been logged out.");
      window.location.href = "../login.html";
    } catch (error) {
      console.error("❌ Error signing out:", error.message);
      alert("An error occurred while logging out. Please try again.");
    }
  }

  // Load groups for the admin 
  async function loadGroups(user) {
    const groupList = document.getElementById("groupList");
    groupList.innerHTML = "<li>Loading your groups...</li>";
  
    try {
      const groupsRef = collection(db, "groups");
      const querySnapshot = await getDocs(groupsRef);
  
      groupList.innerHTML = "";
  
      let isAdminOfAnyGroup = false;
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().toLocaleString("default", { month: "long" });
  
      for (const docSnapshot of querySnapshot.docs) {
        const groupData = docSnapshot.data();
        const groupId = docSnapshot.id;
  
        // ✅ Ensure user is an admin of the group
        const isAdmin = groupData.admins?.some(
          (admin) => admin.email === user.email || admin.uid === user.uid
        );
        if (!isAdmin) continue;
        isAdminOfAnyGroup = true;
  
        let hasPendingApprovals = false;
  
        // ✅ Fetch all members
        const membersRef = collection(db, `groups/${groupId}/members`);
        const membersSnapshot = await getDocs(membersRef);
        const members = membersSnapshot.docs.map((doc) => ({
          uid: doc.id,
          fullName: doc.data().fullName,
        }));
  
        // ✅ Check pending approvals for each member
        for (const member of members) {
          // 🔹 Check Seed Money
          const seedMoneyDocRef = doc(db, `groups/${groupId}/payments/${currentYear}_SeedMoney/${member.uid}/PaymentDetails`);
          const seedMoneyDoc = await getDoc(seedMoneyDocRef);
          if (seedMoneyDoc.exists() && seedMoneyDoc.data().approvalStatus === "pending") {
            hasPendingApprovals = true;
            break; // No need to check further if already found
          }
  
          // 🔹 Check Monthly Contributions
          const contributionDocRef = doc(db,
            `groups/${groupId}/payments/${currentYear}_MonthlyContributions/${member.fullName.replace(/\s+/g, "_")}/${currentYear}_${currentMonth}`
          );
          const contributionDoc = await getDoc(contributionDocRef);
          if (contributionDoc.exists() && contributionDoc.data().approvalStatus === "pending") {
            hasPendingApprovals = true;
            break;
          }
  
          // 🔹 Check Loan Repayments
          const loansCollectionRef = collection(db, `groups/${groupId}/loans/${member.uid}/repayments`);
          const loansSnapshot = await getDocs(loansCollectionRef);
          for (const loanDoc of loansSnapshot.docs) {
            if (loanDoc.data().approvalStatus === "pending") {
              hasPendingApprovals = true;
              break;
            }
          }
  
          // Stop checking if we already found a pending approval
          if (hasPendingApprovals) break;
        }
  
        // ✅ Create Clickable Group Item
        const groupItem = document.createElement("li");
        groupItem.classList.add("group-item");
  
        groupItem.innerHTML = `
          <a href="group_page.html?groupId=${groupId}" class="group-link">
            <div class="group-details">
              <h3>${groupData.groupName}</h3>
              <p>Created: ${groupData.createdAt?.toDate
                ? new Date(groupData.createdAt.toDate()).toLocaleDateString()
                : "N/A"
              }</p>
              <p>Members: Loading...</p>
              ${hasPendingApprovals
                ? `<span class="pending-badge">Pending Approvals</span>`
                : ""
              }
            </div>
          </a>
        `;
  
        groupList.appendChild(groupItem);
  
        // ✅ Fetch and Update Member Count
        getDocs(collection(db, `groups/${groupId}/members`))
          .then((membersSnapshot) => {
            const memberCount = membersSnapshot.size;
            groupItem.querySelector(
              ".group-details p:nth-child(3)"
            ).textContent = `Members: ${memberCount}`;
          })
          .catch(() => {
            groupItem.querySelector(
              ".group-details p:nth-child(3)"
            ).textContent = `Members: Error`;
          });
      }
  
      if (!isAdminOfAnyGroup) {
        groupList.innerHTML = "<li>You are not an admin of any groups.</li>";
      }
    } catch (error) {
      groupList.innerHTML = "<li>Error loading groups. Please try again later.</li>";
    }
  }
  

  // ✅ Fetch admin's full name
  async function fetchAdminName(user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        return userData.fullName || "Admin";
      }
      return user.displayName || "Admin";
    } catch (error) {
      console.error("❌ Error fetching admin name:", error.message);
      return "Admin";
    }
  }

  // ✅ Switch between Admin and User View
  switchViewButton.addEventListener("click", () => {
    // Navigate to user dashboard instead of switching in place
    window.location.href = "user_dashboard.html";
  });

  // ✅ Navigate to Create Group
  createGroupButton.addEventListener("click", () => {
    window.location.href = "../pages/create_group.html";
  });

  // ✅ Navigate to Approve Registrations
  const approveRegistrationsButton = document.getElementById("approveRegistrationsButton");
  if (approveRegistrationsButton) {
    approveRegistrationsButton.addEventListener("click", () => {
      window.location.href = "../pages/approve_registrations.html";
    });
  }

  // ✅ Navigate to Analytics
  if (analyticsButton) {
    analyticsButton.addEventListener("click", () => {
      window.location.href = "../pages/analytics.html";
    });
  }

  // ✅ Navigate to Settings
  settingsButton.addEventListener("click", () => {
    window.location.href = "../pages/settings.html";
  });

  // ✅ Quick Action: Manage Loans
  manageLoansButton.addEventListener("click", () => {
    window.location.href = "../pages/manage_loans.html";
  });

  // ✅ Quick Action: Manage Payments
  managePaymentsButton.addEventListener("click", () => {
    window.location.href = "../pages/manage_payments.html";
  });

  // ✅ Quick Action: View Contributions
  viewContributionsButton.addEventListener("click", () => {
    window.location.href = "../pages/contributions_overview.html";
  });

  // ✅ Quick Action: View Seed Money
  viewSeedMoneyButton.addEventListener("click", () => {
    window.location.href = "../pages/seed_money_overview.html";
  });

  // ✅ Quick Action: Manage Interest & Penalties
  manageInterestButton.addEventListener("click", () => {
    window.location.href = "../pages/interest_penalties.html";
  });

  // ✅ Quick Action: View Reports
  viewReportsButton.addEventListener("click", () => {
    window.location.href = "../pages/financial_reports.html";
  });

  // ✅ Logout Button
  logoutButton.addEventListener("click", async () => {
    await handleLogout();
  });

  // ✅ Listen for authentication state changes
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const adminName = await fetchAdminName(user);
      adminNameSpan.textContent = adminName;
      welcomeMessage.textContent = `Welcome, ${adminName}`;
      await loadGroups(user);
      resetSessionTimer();
    } else {
      alert("No user is currently logged in. Redirecting to login...");
      window.location.href = "../login.html";
    }
  });

  // ✅ Reset session timer on user interaction
  ["click", "keypress", "mousemove", "scroll"].forEach((event) =>
    window.addEventListener(event, resetSessionTimer)
  );
});
