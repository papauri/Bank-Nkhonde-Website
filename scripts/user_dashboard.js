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
  const userNameSpan = document.getElementById("adminName"); // Reused for users
  const dashboardTitle = document.getElementById("dashboardTitle");
  const switchViewButton = document.getElementById("switchViewButton");
  const logoutButton = document.getElementById("logoutButton");
  const settingsButton = document.getElementById("settingsButton");

  let isAdminView = false; // Default to User View
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
      window.location.href = "../index.html";
    } catch (error) {
      console.error("Error signing out:", error.message);
      alert("An error occurred while logging out. Please try again.");
    }
  }

  // Load groups where user is either an admin or a member
  async function loadUserGroups(user) {
    groupList.innerHTML = "<li>Loading your groups...</li>";
    try {
      const q = query(collection(db, "groups"));
      const querySnapshot = await getDocs(q);

      groupList.innerHTML = "";

      let userGroups = [];

      querySnapshot.forEach((doc) => {
        const group = doc.data();
        const groupId = doc.id;

        // ✅ Ensure the user is recognized as either:
        // - A member in the `members` array
        // - The admin (`adminId` matches `user.uid`)
        if (
          (Array.isArray(group.members) && group.members.includes(user.uid)) || 
          group.adminId === user.uid
        ) {
          userGroups.push({ id: groupId, ...group });
        }
      });

      if (userGroups.length === 0) {
        groupList.innerHTML = "<li>You are not part of any groups yet.</li>";
      } else {
        userGroups.forEach((group) => {
          const groupId = group.id;

          // Create clickable list item for group
          const groupItem = document.createElement("li");
          groupItem.classList.add("group-item");

          groupItem.innerHTML = `
            <a href="group_page.html?groupId=${groupId}" class="group-link">
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
      console.error("Error loading user groups:", error.message);
      groupList.innerHTML = "<li>Error loading groups. Please try again later.</li>";
    }
  }

  // Load groups where user is an admin
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

        // Check if user is an admin of the group
        const isAdmin = groupData.adminDetails?.some(
          (admin) => admin.email === user.email || admin.uid === user.uid
        );
        
        if (!isAdmin) return;
        isAdminOfAnyGroup = true;

        // Create clickable list item for group
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

      if (!isAdminOfAnyGroup) {
        groupList.innerHTML = "<li>You are not an admin of any groups.</li>";
      }
    } catch (error) {
      console.error("Error loading admin groups:", error.message);
      groupList.innerHTML = "<li>Error loading groups. Please try again later.</li>";
    }
  }



  // Check if user is admin of any group
  async function checkIfUserIsAdmin(user) {
    try {
      const groupsRef = collection(db, "groups");
      const querySnapshot = await getDocs(groupsRef);
      
      for (const docSnapshot of querySnapshot.docs) {
        const groupData = docSnapshot.data();
        const isAdmin = groupData.adminDetails?.some(
          (admin) => admin.email === user.email || admin.uid === user.uid
        );
        if (isAdmin) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error("Error checking admin status:", error.message);
      return false;
    }
  }

  // Fetch user’s name
  async function fetchUserName(user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        return userData.fullName || "User";
      }
      return user.displayName || "User";
    } catch (error) {
      console.error("Error fetching user name:", error.message);
      return "User";
    }
  }

  // Switch between User and Admin View
  switchViewButton.addEventListener("click", async () => {
    isAdminView = !isAdminView;
    dashboardTitle.textContent = isAdminView ? "Admin Dashboard" : "User Dashboard";
    switchViewButton.textContent = isAdminView ? "Switch to User View" : "Switch to Admin View";

    if (isAdminView) {
      loadGroups(auth.currentUser); // Load admin groups
    } else {
      await loadUserGroups(auth.currentUser); // Load user groups
    }
  });

  // Navigate to Settings
  settingsButton.addEventListener("click", () => {
    window.location.href = "settings.html";
  });

  // Listen for authentication state
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const userName = await fetchUserName(user);
      userNameSpan.textContent = userName;
      welcomeMessage.textContent = `Welcome, ${userName}`;
      
      // Check if user is an admin of any group
      const isAdmin = await checkIfUserIsAdmin(user);
      
      // Show/hide switch view button based on admin status
      if (isAdmin) {
        switchViewButton.style.display = "block";
      } else {
        switchViewButton.style.display = "none";
      }
      
      await loadUserGroups(user);
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
