import {
  db,
  auth,
  doc,
  getDoc,
  onAuthStateChanged,
  storage,
  ref,
  getDownloadURL,
} from "./firebaseConfig.js";

let currentUser = null;
let currentGroupId = null;

// DOM Elements
const spinner = document.getElementById("spinner");
const rulesContainer = document.getElementById("rulesContainer");
const groupName = document.getElementById("groupName");

// Initialize
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadRules();
  } else {
    window.location.href = "../login.html";
  }
});

async function loadRules() {
  try {
    showSpinner(true);
    
    // Get selected group from session
    currentGroupId = sessionStorage.getItem('selectedGroupId');
    
    if (!currentGroupId) {
      showNoGroupSelected();
      return;
    }
    
    // Get group data
    const groupDoc = await getDoc(doc(db, "groups", currentGroupId));
    if (!groupDoc.exists()) {
      showError("Group not found");
      return;
    }
    
    const groupData = groupDoc.data();
    if (groupName) groupName.textContent = groupData.groupName || "Group Rules";
    
    // Check if rules PDF exists
    const rulesPdfUrl = groupData.rulesPdfUrl;
    
    if (rulesPdfUrl) {
      // Try to load PDF
      try {
        // If it's a storage reference, get download URL
        let pdfUrl = rulesPdfUrl;
        if (rulesPdfUrl.startsWith('gs://')) {
          pdfUrl = await getDownloadURL(ref(storage, rulesPdfUrl));
        }
        
        displayPdf(pdfUrl);
      } catch (error) {
        console.error("Error loading PDF:", error);
        // Try direct URL
        displayPdf(rulesPdfUrl);
      }
    } else {
      // Check if there's a rules file in storage
      try {
        const storageRef = ref(storage, `groups/${currentGroupId}/rules/rulebook.pdf`);
        const url = await getDownloadURL(storageRef);
        displayPdf(url);
      } catch (error) {
        // No rules PDF found
        showNoRules();
      }
    }
  } catch (error) {
    console.error("Error loading rules:", error);
    showError("Error loading rules. Please try again.");
  } finally {
    showSpinner(false);
  }
}

function displayPdf(url) {
  rulesContainer.innerHTML = `
    <div class="rules-header">
      <h2 class="rules-title">Group Rule Book</h2>
      <a href="${url}" download class="btn btn-accent download-btn" target="_blank">
        Download PDF
      </a>
    </div>
    <iframe class="pdf-viewer" src="${url}#toolbar=1&navpanes=1&scrollbar=1"></iframe>
  `;
}

function showNoRules() {
  rulesContainer.innerHTML = `
    <div class="no-rules">
      <div class="no-rules-icon">📋</div>
      <h2 class="no-rules-title">No Rules Available</h2>
      <p class="no-rules-text">This group doesn't have a rule book uploaded yet. Please contact the group administrator to upload the rules.</p>
      <button class="btn btn-ghost" onclick="history.back()">Go Back</button>
    </div>
  `;
}

function showNoGroupSelected() {
  rulesContainer.innerHTML = `
    <div class="no-rules">
      <div class="no-rules-icon">👥</div>
      <h2 class="no-rules-title">No Group Selected</h2>
      <p class="no-rules-text">Please select a group first to view the rules.</p>
      <a href="select_group.html" class="btn btn-accent">Select Group</a>
    </div>
  `;
}

function showError(message) {
  rulesContainer.innerHTML = `
    <div class="no-rules">
      <div class="no-rules-icon">❌</div>
      <h2 class="no-rules-title">Error</h2>
      <p class="no-rules-text">${message}</p>
      <button class="btn btn-ghost" onclick="history.back()">Go Back</button>
    </div>
  `;
}

function showSpinner(show) {
  if (show) {
    spinner?.classList.remove("hidden");
  } else {
    spinner?.classList.add("hidden");
  }
}
