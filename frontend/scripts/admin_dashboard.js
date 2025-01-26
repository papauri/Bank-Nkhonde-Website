import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
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
const auth = getAuth();
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("User is signed in:", user.email);
    if (!user) {
      alert("You must be signed in to access this page.");
      window.location.href = "/login.html"; // Replace with your login page URL
    }
  } else {
    console.log("No user is signed in.");
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
  const settingsButton = document.getElementById("settingsButton");

  let isAdminView = true;
  let sessionTimeout;

  // Set session timeout for 1 hour
  function resetSessionTimer() {
    clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(async () => {
      alert("Your session has expired. You will be logged out.");
      await handleLogout();
    }, 60 * 60 * 1000); // 1 hour
  }

  // Handle logout functionality
  async function handleLogout() {
    try {
      await signOut(auth);
      alert("You have been logged out.");
      window.location.href = "../pages/login.html";
    } catch (error) {
      console.error("Error signing out:", error.message);
      alert("An error occurred while logging out. Please try again.");
    }
  }

  // Load admin groups dynamically
  async function loadGroups(user) {
    groupList.innerHTML = "<li>Loading your groups...</li>";
    try {
      const groupsRef = collection(db, "groups");
      const querySnapshot = await getDocs(groupsRef);

      groupList.innerHTML = "";

      let isAdminOfAnyGroup = false;

      querySnapshot.forEach((docSnapshot) => {
        const groupData = docSnapshot.data();
        const groupId = docSnapshot.id;

        // Check if the current user is an admin in the group
        const isAdmin = groupData.adminDetails.some(
          (admin) => admin.uid === user.uid
        );

        if (isAdmin) {
          isAdminOfAnyGroup = true;

          // Create clickable list item for group
          const groupItem = document.createElement("li");
          groupItem.classList.add("group-item");

          groupItem.innerHTML = `
            <a href="../pages/group_page.html?groupId=${groupId}" class="group-link">
              <div class="group-details">
                <h3>${groupData.groupName}</h3>
                <p>Created: ${groupData.createdAt?.toDate
              ? new Date(groupData.createdAt.toDate()).toLocaleDateString()
              : "N/A"
            }</p>
                <p>Members: Loading...</p>
              </div>
            </a>
          `;

          groupList.appendChild(groupItem);

          // Fetch member count dynamically
          getDocs(collection(db, `groups/${groupId}/members`))
            .then((membersSnapshot) => {
              const memberCount = membersSnapshot.size;
              groupItem.querySelector(
                ".group-details p:nth-child(3)"
              ).textContent = `Members: ${memberCount}`;
            })
            .catch((error) => {
              console.error(
                `Error fetching members for group ${groupId}:`,
                error.message
              );
              groupItem.querySelector(
                ".group-details p:nth-child(3)"
              ).textContent = `Members: Error`;
            });
        }
      });

      if (!isAdminOfAnyGroup) {
        groupList.innerHTML = "<li>You are not an admin of any groups.</li>";
      }
    } catch (error) {
      console.error("Error loading groups:", error.message);
      groupList.innerHTML = "<li>Error loading groups. Please try again later.</li>";
    }
  }

  // Fetch admin's full name
  async function fetchAdminName(user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        return userData.name || "Admin";
      }
      return user.displayName || "Admin";
    } catch (error) {
      console.error("Error fetching admin name:", error.message);
      return "Admin";
    }
  }

  // Switch between Admin and User View
  switchViewButton.addEventListener("click", () => {
    isAdminView = !isAdminView;
    dashboardTitle.textContent = isAdminView ? "Admin Dashboard" : "User Dashboard";
    switchViewButton.textContent = isAdminView ? "Switch to User View" : "Switch to Admin View";

    if (isAdminView) {
      loadGroups(auth.currentUser); // Reload groups for admin view
    } else {
      window.location.href = "../pages/user_dashboard.html"; // Navigate to user dashboard
    }
  });

  // Navigate to Create Group
  createGroupButton.addEventListener("click", () => {
    window.location.href = "../pages/create_group.html";
  });

  // Navigate to Settings
  settingsButton.addEventListener("click", () => {
    window.location.href = "../pages/settings.html";
  });

  // Listen for authentication state
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const adminName = await fetchAdminName(user);
      adminNameSpan.textContent = adminName;
      welcomeMessage.textContent = `Welcome, ${adminName}`;
      await loadGroups(user);
      resetSessionTimer();
    } else {
      alert("No user is currently logged in. Redirecting to login...");
      window.location.href = "../index.html";
    }
  });

  // Reset session timer on user interaction
  ["click", "keypress", "mousemove", "scroll"].forEach((event) =>
    window.addEventListener(event, resetSessionTimer)
  );
});
