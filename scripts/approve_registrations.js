import {
  db,
  auth,
  collection,
  getDocs,
  query,
  where,
  updateDoc,
  deleteDoc,
  onSnapshot,
  onAuthStateChanged,
  Timestamp,
} from "./firebaseConfig.js";

let currentFilter = "all";

// Check authentication
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "../login.html";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const registrationsList = document.getElementById("pendingList");
  const filterTabs = document.querySelectorAll(".filter-tab");

  // Set up filter tabs
  filterTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      filterTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      loadRegistrations();
    });
  });

  // Load registrations with real-time updates
  function loadRegistrations() {
    const invitationCodesRef = collection(db, "invitationCodes");
    
    // Use real-time listener for automatic updates
    onSnapshot(invitationCodesRef, (snapshot) => {
      const registrations = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        registrations.push({
          id: doc.id,
          code: data.code,
          approved: data.approved,
          used: data.used,
          createdAt: data.createdAt,
          approvedAt: data.approvedAt || null,
        });
      });

      // Filter registrations
      let filteredRegistrations = registrations;
      if (currentFilter === "pending") {
        filteredRegistrations = registrations.filter((r) => !r.approved && !r.used);
      } else if (currentFilter === "approved") {
        filteredRegistrations = registrations.filter((r) => r.approved);
      }

      // Sort by creation date (newest first)
      filteredRegistrations.sort((a, b) => {
        const aTime = a.createdAt?.toMillis() || 0;
        const bTime = b.createdAt?.toMillis() || 0;
        return bTime - aTime;
      });

      displayRegistrations(filteredRegistrations);
    }, (error) => {
      console.error("Error loading registrations:", error);
      registrationsList.innerHTML = `
        <div class="empty-state">
          <h2>Error loading registrations</h2>
          <p>${error.message}</p>
        </div>
      `;
    });
  }

  // Display registrations
  function displayRegistrations(registrations) {
    if (registrations.length === 0) {
      registrationsList.innerHTML = `
        <div class="empty-state">
          <h2>No registrations found</h2>
          <p>There are currently no ${currentFilter === "all" ? "" : currentFilter} registration requests.</p>
        </div>
      `;
      return;
    }

    registrationsList.innerHTML = registrations
      .map((reg) => {
        const statusClass = reg.approved ? "approved" : "pending";
        const statusText = reg.approved ? "Approved" : reg.used ? "Used" : "Pending";
        const createdDate = reg.createdAt
          ? new Date(reg.createdAt.toMillis()).toLocaleString()
          : "Unknown";
        const approvedDate = reg.approvedAt
          ? new Date(reg.approvedAt.toMillis()).toLocaleString()
          : "N/A";

        return `
          <div class="registration-card ${statusClass}">
            <div class="registration-header">
              <div class="registration-code">${reg.code}</div>
              <div class="registration-status status-${statusClass}">${statusText}</div>
            </div>
            <div class="registration-info">
              <div class="info-row">
                <span class="info-label">Created:</span>
                <span class="info-value">${createdDate}</span>
              </div>
              ${
                reg.approved
                  ? `
                <div class="info-row">
                  <span class="info-label">Approved:</span>
                  <span class="info-value">${approvedDate}</span>
                </div>
              `
                  : ""
              }
              <div class="info-row">
                <span class="info-label">Status:</span>
                <span class="info-value">${reg.used ? "Used" : reg.approved ? "Approved - Awaiting Use" : "Pending Approval"}</span>
              </div>
            </div>
            ${
              !reg.approved && !reg.used
                ? `
              <div class="action-buttons">
                <button class="btn btn-approve" onclick="approveRegistration('${reg.id}', '${reg.code}')">
                  ✓ Approve
                </button>
                <button class="btn btn-reject" onclick="rejectRegistration('${reg.id}', '${reg.code}')">
                  ✗ Reject
                </button>
              </div>
            `
                : ""
            }
          </div>
        `;
      })
      .join("");
  }

  // Make functions globally available
  window.approveRegistration = async (docId, code) => {
    if (!confirm(`Are you sure you want to approve registration code: ${code}?`)) {
      return;
    }

    try {
      const invitationCodesRef = collection(db, "invitationCodes");
      const q = query(invitationCodesRef, where("code", "==", code));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const docRef = querySnapshot.docs[0].ref;
        await updateDoc(docRef, {
          approved: true,
          approvedAt: Timestamp.now(),
        });
        console.log(`✅ Registration code ${code} approved`);
        // Real-time listener will update the UI automatically
      } else {
        console.error("Registration code not found.");
      }
    } catch (error) {
      console.error("Error approving registration:", error);
    }
  };

  window.rejectRegistration = async (docId, code) => {
    if (!confirm(`Are you sure you want to reject and delete registration code: ${code}?`)) {
      return;
    }

    try {
      const invitationCodesRef = collection(db, "invitationCodes");
      const q = query(invitationCodesRef, where("code", "==", code));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const docRef = querySnapshot.docs[0].ref;
        await deleteDoc(docRef);
        console.log(`✅ Registration code ${code} rejected and deleted`);
        // Real-time listener will update the UI automatically
      } else {
        console.error("Registration code not found.");
      }
    } catch (error) {
      console.error("Error rejecting registration:", error);
    }
  };

  // Initial load
  loadRegistrations();
});
