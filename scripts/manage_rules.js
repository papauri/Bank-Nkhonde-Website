import {
  db,
  auth,
  storage,
  doc,
  getDoc,
  updateDoc,
  onAuthStateChanged,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "./firebaseConfig.js";

// Global state
let currentUser = null;
let selectedGroupId = null;
let groupData = null;
let selectedFile = null;
let isEditMode = false;

// DOM Elements
const groupNameEl = document.getElementById("groupName");
const spinner = document.getElementById("spinner");

// Text Rules Elements
const currentTextRulesView = document.getElementById("currentTextRulesView");
const currentTextRulesContent = document.getElementById("currentTextRulesContent");
const textRulesEditor = document.getElementById("textRulesEditor");
const textRulesInput = document.getElementById("textRulesInput");
const noTextRulesState = document.getElementById("noTextRulesState");
const createTextRulesArea = document.getElementById("createTextRulesArea");
const editTextRulesBtn = document.getElementById("editTextRulesBtn");
const saveTextRulesBtn = document.getElementById("saveTextRulesBtn");
const cancelTextRulesBtn = document.getElementById("cancelTextRulesBtn");

// PDF Document Elements
const currentPdfView = document.getElementById("currentPdfView");
const pdfPreview = document.getElementById("pdfPreview");
const currentPdfFileName = document.getElementById("currentPdfFileName");
const currentPdfFileSize = document.getElementById("currentPdfFileSize");
const downloadCurrentPdfBtn = document.getElementById("downloadCurrentPdfBtn");
const removePdfBtn = document.getElementById("removePdfBtn");
const uploadNewPdfBtn = document.getElementById("uploadNewPdfBtn");
const pdfUploadArea = document.getElementById("pdfUploadArea");
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const browseFilesBtn = document.getElementById("browseFilesBtn");
const selectedFileInfo = document.getElementById("selectedFileInfo");
const selectedFileName = document.getElementById("selectedFileName");
const selectedFileSize = document.getElementById("selectedFileSize");
const removeSelectedFileBtn = document.getElementById("removeSelectedFileBtn");
const uploadPdfBtn = document.getElementById("uploadPdfBtn");

// Tab Elements
const rulesTabs = document.querySelectorAll(".rules-tab");
const rulesTabContents = document.querySelectorAll(".rules-tab-content");

// Show/hide spinner
function showSpinner(show) {
  if (spinner) {
    spinner.classList.toggle('hidden', !show);
  }
}

// Show toast notification
function showToast(message, type = "info") {
  // Create toast element
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    font-size: 14px;
    font-weight: 500;
    max-width: 400px;
    animation: slideIn 0.3s ease-out;
  `;
  toast.textContent = message;
  
  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  if (!document.querySelector('#toast-styles')) {
    style.id = 'toast-styles';
    document.head.appendChild(style);
  }
  
  document.body.appendChild(toast);
  
  // Remove after 3 seconds
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease-out reverse';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  // Check localStorage first, then sessionStorage
  selectedGroupId = localStorage.getItem('selectedGroupId') || sessionStorage.getItem('selectedGroupId');
  
  if (!selectedGroupId) {
    window.location.href = 'admin_dashboard.html';
    return;
  }
});

// Auth state listener
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadGroupRules();
    setupEventListeners();
  } else {
    window.location.href = "../login.html";
  }
});

// Setup event listeners
function setupEventListeners() {
  // Tab switching
  rulesTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      switchTab(targetTab);
    });
  });

  // Text Rules
  if (createTextRulesArea) {
    createTextRulesArea.addEventListener('click', () => {
      showTextRulesEditor();
    });
  }

  if (editTextRulesBtn) {
    editTextRulesBtn.addEventListener('click', () => {
      showTextRulesEditor();
    });
  }

  if (saveTextRulesBtn) {
    saveTextRulesBtn.addEventListener('click', () => {
      saveTextRules();
    });
  }

  if (cancelTextRulesBtn) {
    cancelTextRulesBtn.addEventListener('click', () => {
      cancelTextRulesEdit();
    });
  }

  // PDF Upload
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      handleFileSelect(e.target.files[0]);
    });
  }

  if (browseFilesBtn) {
    browseFilesBtn.addEventListener('click', () => {
      fileInput?.click();
    });
  }

  if (dropZone) {
    dropZone.addEventListener('click', () => {
      if (!selectedFile) {
        fileInput?.click();
      }
    });

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFileSelect(files[0]);
      }
    });
  }

  if (removeSelectedFileBtn) {
    removeSelectedFileBtn.addEventListener('click', () => {
      removeSelectedFile();
    });
  }

  if (uploadPdfBtn) {
    uploadPdfBtn.addEventListener('click', () => {
      uploadPdfDocument();
    });
  }

  if (uploadNewPdfBtn) {
    uploadNewPdfBtn.addEventListener('click', () => {
      showPdfUploadArea();
    });
  }

  if (removePdfBtn) {
    removePdfBtn.addEventListener('click', () => {
      removePdfDocument();
    });
  }
}

// Switch tab
function switchTab(tabName) {
  rulesTabs.forEach(tab => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  rulesTabContents.forEach(content => {
    if (content.id === `${tabName}Tab`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
}

// Load group rules
async function loadGroupRules() {
  if (!selectedGroupId) {
    window.location.href = 'admin_dashboard.html';
    return;
  }

  showSpinner(true);

  try {
    // Get group data
    const groupDoc = await getDoc(doc(db, "groups", selectedGroupId));
    
    if (!groupDoc.exists()) {
      showToast("Group not found", "error");
      window.location.href = 'admin_dashboard.html';
      return;
    }

    groupData = groupDoc.data();
    
    // Update group name
    if (groupNameEl) {
      groupNameEl.textContent = groupData.groupName || "Manage Rules";
    }

    // Load text rules
    await loadTextRules();

    // Load PDF document
    await loadPdfDocument();

  } catch (error) {
    console.error("Error loading group rules:", error);
    showToast("Error loading rules. Please try again.", "error");
  } finally {
    showSpinner(false);
  }
}

// Load text rules
async function loadTextRules() {
  if (!groupData) return;

  // Check for text rules - check all possible field names
  let textRules = groupData.governance?.text || 
                  groupData.governance?.rulesText || 
                  groupData.governanceRules ||
                  groupData.textRules || 
                  "";
  
  // If governance.rules exists and is a string, use it
  if (!textRules && groupData.governance?.rules && typeof groupData.governance.rules === 'string') {
    textRules = groupData.governance.rules;
  }
  
  // Ensure textRules is a string
  if (typeof textRules !== 'string') {
    textRules = "";
  }

  if (textRules && textRules.trim()) {
    // Show current rules view
    if (currentTextRulesView) currentTextRulesView.style.display = 'block';
    if (textRulesEditor) textRulesEditor.style.display = 'none';
    if (noTextRulesState) noTextRulesState.style.display = 'none';
    if (currentTextRulesContent) currentTextRulesContent.textContent = textRules;
  } else {
    // Show create state
    if (currentTextRulesView) currentTextRulesView.style.display = 'none';
    if (textRulesEditor) textRulesEditor.style.display = 'none';
    if (noTextRulesState) noTextRulesState.style.display = 'block';
  }
}

// Show text rules editor
function showTextRulesEditor() {
  if (!groupData) return;

  // Get current text rules
  let textRules = groupData.governance?.text || 
                  groupData.governance?.rulesText || 
                  groupData.governanceRules ||
                  groupData.textRules || 
                  "";
  
  if (!textRules && groupData.governance?.rules && typeof groupData.governance.rules === 'string') {
    textRules = groupData.governance.rules;
  }

  if (textRulesInput) {
    textRulesInput.value = typeof textRules === 'string' ? textRules : '';
  }

  // Show editor, hide other views
  if (currentTextRulesView) currentTextRulesView.style.display = 'none';
  if (textRulesEditor) textRulesEditor.style.display = 'block';
  if (noTextRulesState) noTextRulesState.style.display = 'none';
  
  isEditMode = true;
  
  // Focus on textarea
  setTimeout(() => {
    textRulesInput?.focus();
  }, 100);
}

// Cancel text rules edit
function cancelTextRulesEdit() {
  if (!groupData) return;

  // Check if there are existing rules
  let textRules = groupData.governance?.text || 
                  groupData.governance?.rulesText || 
                  groupData.governanceRules ||
                  groupData.textRules || 
                  "";
  
  if (!textRules && groupData.governance?.rules && typeof groupData.governance.rules === 'string') {
    textRules = groupData.governance.rules;
  }

  if (textRules && typeof textRules === 'string' && textRules.trim()) {
    // Show current rules view
    if (currentTextRulesView) currentTextRulesView.style.display = 'block';
    if (textRulesEditor) textRulesEditor.style.display = 'none';
    if (noTextRulesState) noTextRulesState.style.display = 'none';
  } else {
    // Show create state
    if (currentTextRulesView) currentTextRulesView.style.display = 'none';
    if (textRulesEditor) textRulesEditor.style.display = 'none';
    if (noTextRulesState) noTextRulesState.style.display = 'block';
  }
  
  isEditMode = false;
}

// Save text rules
async function saveTextRules() {
  if (!selectedGroupId || !textRulesInput) return;

  const textRules = textRulesInput.value.trim();

  if (!textRules) {
    showToast("Please enter some rules content", "warning");
    return;
  }

  showSpinner(true);

  try {
    const groupRef = doc(db, "groups", selectedGroupId);
    
    // Update group data with text rules
    // Store in governance.text for consistency with view_rules.js
    await updateDoc(groupRef, {
      'governance.text': textRules,
      updatedAt: new Date(),
    });

    // Update local groupData
    if (!groupData.governance) {
      groupData.governance = {};
    }
    groupData.governance.text = textRules;

    showToast("Rules saved successfully!", "success");

    // Reload display
    await loadTextRules();
    
    isEditMode = false;

  } catch (error) {
    console.error("Error saving text rules:", error);
    showToast("Error saving rules. Please try again.", "error");
  } finally {
    showSpinner(false);
  }
}

// Load PDF document
async function loadPdfDocument() {
  if (!groupData) return;

  // Check for PDF URL - check all possible field names
  const pdfUrl = groupData.governance?.rulesDocumentUrl || 
                 groupData.governance?.documentUrl || 
                 groupData.governance?.pdfUrl || 
                 groupData.rulesDocumentUrl || 
                 groupData.documentUrl || 
                 groupData.pdfUrl || 
                 "";

  if (pdfUrl && pdfUrl.trim()) {
    // Show current PDF view
    if (currentPdfView) currentPdfView.style.display = 'block';
    if (pdfUploadArea) pdfUploadArea.style.display = 'none';
    
    if (pdfPreview) pdfPreview.src = pdfUrl;
    if (downloadCurrentPdfBtn) downloadCurrentPdfBtn.href = pdfUrl;
    
    // Try to extract filename from URL
    const urlParts = pdfUrl.split('/');
    const fileName = urlParts[urlParts.length - 1].split('?')[0] || 'rules-document.pdf';
    if (currentPdfFileName) currentPdfFileName.textContent = fileName;
    if (currentPdfFileSize) currentPdfFileSize.textContent = 'PDF Document';
  } else {
    // Show upload area
    if (currentPdfView) currentPdfView.style.display = 'none';
    if (pdfUploadArea) pdfUploadArea.style.display = 'block';
  }
}

// Show PDF upload area
function showPdfUploadArea() {
  if (currentPdfView) currentPdfView.style.display = 'none';
  if (pdfUploadArea) pdfUploadArea.style.display = 'block';
  removeSelectedFile();
}

// Handle file select
function handleFileSelect(file) {
  if (!file) return;

  // Validate file type
  if (file.type !== 'application/pdf') {
    showToast("Please select a PDF file", "error");
    return;
  }

  // Validate file size (max 10MB)
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    showToast("File size must be less than 10MB", "error");
    return;
  }

  selectedFile = file;

  // Show file info
  if (selectedFileInfo) selectedFileInfo.style.display = 'flex';
  if (selectedFileName) selectedFileName.textContent = file.name;
  if (selectedFileSize) selectedFileSize.textContent = formatFileSize(file.size);
  if (uploadPdfBtn) uploadPdfBtn.style.display = 'block';
}

// Remove selected file
function removeSelectedFile() {
  selectedFile = null;
  if (selectedFileInfo) selectedFileInfo.style.display = 'none';
  if (uploadPdfBtn) uploadPdfBtn.style.display = 'none';
  if (fileInput) fileInput.value = '';
}

// Upload PDF document
async function uploadPdfDocument() {
  if (!selectedFile || !selectedGroupId) return;

  showSpinner(true);

  try {
    // Create storage reference
    const timestamp = Date.now();
    const fileName = `rules-document-${timestamp}.pdf`;
    const storageRef = ref(storage, `groups/${selectedGroupId}/rules/${fileName}`);

    // Upload file
    await uploadBytes(storageRef, selectedFile);
    const downloadURL = await getDownloadURL(storageRef);

    // Update group document
    const groupRef = doc(db, "groups", selectedGroupId);
    
    // Delete old PDF if exists
    const oldPdfUrl = groupData.governance?.rulesDocumentUrl || 
                      groupData.governance?.documentUrl || 
                      groupData.governance?.pdfUrl || 
                      groupData.rulesDocumentUrl || 
                      groupData.documentUrl || 
                      groupData.pdfUrl || 
                      "";

    if (oldPdfUrl && oldPdfUrl.trim()) {
      try {
        const oldRef = ref(storage, oldPdfUrl);
        await deleteObject(oldRef);
      } catch (error) {
        console.warn("Error deleting old PDF:", error);
        // Continue even if deletion fails
      }
    }
    
    // Store in governance.rulesDocumentUrl for consistency with view_rules.js
    await updateDoc(groupRef, {
      'governance.rulesDocumentUrl': downloadURL,
      updatedAt: new Date(),
    });

    // Update local groupData
    if (!groupData.governance) {
      groupData.governance = {};
    }
    groupData.governance.rulesDocumentUrl = downloadURL;

    showToast("Document uploaded successfully!", "success");

    // Reset and reload
    removeSelectedFile();
    await loadPdfDocument();

  } catch (error) {
    console.error("Error uploading PDF:", error);
    showToast("Error uploading document. Please try again.", "error");
  } finally {
    showSpinner(false);
  }
}

// Remove PDF document
async function removePdfDocument() {
  if (!selectedGroupId || !confirm("Are you sure you want to remove the rules document?")) {
    return;
  }

  const pdfUrl = groupData.governance?.rulesDocumentUrl || 
                 groupData.governance?.documentUrl || 
                 groupData.governance?.pdfUrl || 
                 groupData.rulesDocumentUrl || 
                 groupData.documentUrl || 
                 groupData.pdfUrl || 
                 "";

  if (!pdfUrl) return;

  showSpinner(true);

  try {
    // Delete from storage
    try {
      const storageRef = ref(storage, pdfUrl);
      await deleteObject(storageRef);
    } catch (error) {
      console.warn("Error deleting PDF from storage:", error);
      // Continue even if deletion fails
    }

    // Update group document
    const groupRef = doc(db, "groups", selectedGroupId);
    
    // Remove PDF URL field
    await updateDoc(groupRef, {
      'governance.rulesDocumentUrl': '',
      updatedAt: new Date(),
    });

    // Update local groupData
    if (groupData.governance) {
      groupData.governance.rulesDocumentUrl = '';
    }

    showToast("Document removed successfully!", "success");

    // Reload display
    await loadPdfDocument();

  } catch (error) {
    console.error("Error removing PDF:", error);
    showToast("Error removing document. Please try again.", "error");
  } finally {
    showSpinner(false);
  }
}
