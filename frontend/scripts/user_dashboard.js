import {
  db,
  auth,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  onAuthStateChanged,
  signOut,
} from "./firebaseConfig.js";

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
      window.location.href = "/frontend/pages/login.html";
    } catch (error) {
      console.error("Error signing out:", error.message);
      alert("An error occurred while logging out. Please try again.");
    }
  }

  // Load admin groups dynamically
  async function loadGroups(user) {
    groupList.innerHTML = "<li>Loading your groups...</li>";
    try {
      const q = query(collection(db, "groups"), where("adminId", "==", user.uid));
      const querySnapshot = await getDocs(q);

      groupList.innerHTML = "";

      if (querySnapshot.empty) {
        groupList.innerHTML = "<li>You have no groups yet.</li>";
      } else {
        querySnapshot.forEach((doc) => {
          const group = doc.data();
          const groupId = doc.id;

          // Create clickable list item for group
          const groupItem = document.createElement("li");
          groupItem.classList.add("group-item");

          groupItem.innerHTML = `
            <a href="/frontend/pages/group_page.html?groupId=${groupId}" class="group-link">
              <div class="group-details">
                <h3>${group.groupName}</h3>
                <p>Created: ${new Date(group.createdAt.toDate()).toLocaleDateString()}</p>
                <p>Members: Loading...</p>
              </div>
            </a>
          `;

          groupList.appendChild(groupItem);

          // Fetch member count dynamically
          getDocs(collection(db, "groups", groupId, "members")).then((membersSnapshot) => {
            const memberCount = membersSnapshot.size;
            groupItem.querySelector(".group-details p:nth-child(3)").textContent = `Members: ${memberCount}`;
          });
        });
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
      groupList.innerHTML = "<li>User Dashboard view is currently under development.</li>";
    }
  });

  // Navigate to Create Group
  createGroupButton.addEventListener("click", () => {
    window.location.href = "/frontend/pages/create_group.html";
  });

  // Navigate to Settings
  settingsButton.addEventListener("click", () => {
    window.location.href = "/frontend/pages/settings.html";
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
      window.location.href = "/frontend/pages/login.html";
    }
  });

  // Reset session timer on user interaction
  ["click", "keypress", "mousemove", "scroll"].forEach((event) =>
    window.addEventListener(event, resetSessionTimer)
  );
});
