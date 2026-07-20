/**
 * manage_rules_sql.js — SQL port of manage_rules.js (the admin GOVERNANCE page:
 * write the group's rules as text, and/or upload a rules PDF).
 *
 * Note this is the *prose* rules page. The numeric money policy (interest rates,
 * penalties, contribution amounts) lives in group_rules and is edited from the
 * loan-settings modal via rules.get / rules.update — not here.
 *
 * Storage (migration 010): `groups.governanceRulesText`, `groups.rulesDocumentUrl`,
 * `groups.rulesDocumentName`. Read with groups.get (any member — a member must be
 * able to read the rules they are bound by), written with groups.update (admin).
 * The PDF goes through files.upload, which sniffs the real MIME and stores it under
 * a server-generated random filename; the server refuses a rulesDocumentUrl that is
 * not a path it minted itself.
 *
 * No data-bearing innerHTML: the rules text is admin-authored, so it renders via
 * textContent only.
 */

import {apiGet, apiPost, requireSession, listMyGroups, ApiError, redirectToLogin} from "./api.js";

const MAX_PDF_BYTES = 5 * 1024 * 1024; // matches the server's UPLOAD_MAX_BYTES

let selectedGroupId = null;
let group = null;
let selectedFile = null;

export async function init() {
  setupEventListeners();

  try {
    await requireSession();
  } catch (error) {
    return;
  }

  await loadGroup();
}
if (!window.__bnSpa) {
  document.addEventListener("DOMContentLoaded", () => { init(); });
}

function setupEventListeners() {
  document.getElementById("editTextRulesBtn")?.addEventListener("click", openTextEditor);
  document.getElementById("cancelTextRulesBtn")?.addEventListener("click", closeTextEditor);
  document.getElementById("saveTextRulesBtn")?.addEventListener("click", saveTextRules);

  document.getElementById("uploadNewPdfBtn")?.addEventListener("click", showUploadArea);
  document.getElementById("browseFilesBtn")?.addEventListener("click", () => {
    document.getElementById("fileInput")?.click();
  });
  document.getElementById("fileInput")?.addEventListener("change", (e) => {
    handleFileSelected(e.target.files?.[0] || null);
  });
  document.getElementById("removeSelectedFileBtn")?.addEventListener("click", () => {
    handleFileSelected(null);
  });
  document.getElementById("uploadPdfBtn")?.addEventListener("click", uploadPdf);
  document.getElementById("removePdfBtn")?.addEventListener("click", removePdf);

  // Drag & drop
  const dropZone = document.getElementById("dropZone");
  if (dropZone) {
    ["dragenter", "dragover"].forEach((evt) => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((evt) => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
      });
    });
    dropZone.addEventListener("drop", (e) => {
      handleFileSelected(e.dataTransfer?.files?.[0] || null);
    });
  }
}

// ── Load ────────────────────────────────────────────────────────────────────
async function loadGroup() {
  showSpinner(true);
  try {
    selectedGroupId = localStorage.getItem("selectedGroupId") ||
      sessionStorage.getItem("selectedGroupId");

    // Fall back to the caller's first admin group if nothing is selected.
    if (!selectedGroupId) {
      const groups = await listMyGroups();
      const admin = groups.filter((g) =>
        ["admin", "senior_admin", "treasurer"].includes(g.myRole));
      if (admin.length === 0) {
        showToast("You are not an admin of any groups", "warning");
        return;
      }
      selectedGroupId = admin[0].groupId || admin[0].id;
      sessionStorage.setItem("selectedGroupId", selectedGroupId);
    }

    const resp = await apiGet("groups.get", {groupId: selectedGroupId});
    group = (resp && (resp.group || resp)) || {};

    setText("groupName", group.groupName || "Group Rules");
    renderTextRules();
    renderPdf();
  } catch (error) {
    handleApiError(error, "Failed to load group rules");
  } finally {
    showSpinner(false);
  }
}

// ── Text rules ──────────────────────────────────────────────────────────────
function renderTextRules() {
  const text = (group && group.governanceRulesText) || "";
  const hasText = text.trim() !== "";

  show("currentTextRulesView", hasText);
  show("noTextRulesState", !hasText);
  show("textRulesEditor", false);
  show("createTextRulesArea", !hasText);

  // Admin-authored prose — textContent, never innerHTML.
  setText("currentTextRulesContent", text);
}

function openTextEditor() {
  const input = document.getElementById("textRulesInput");
  if (input) input.value = (group && group.governanceRulesText) || "";

  show("textRulesEditor", true);
  show("currentTextRulesView", false);
  show("noTextRulesState", false);
  show("createTextRulesArea", false);
}

function closeTextEditor() {
  renderTextRules();
}

async function saveTextRules() {
  if (!selectedGroupId) return;

  const text = document.getElementById("textRulesInput")?.value ?? "";

  showSpinner(true);
  try {
    // An empty string clears the rules (the server stores NULL) — that is a real
    // state, not a no-op.
    const updated = await apiPost("groups.update", {
      groupId: selectedGroupId,
      governanceRulesText: text,
    });
    group = (updated && (updated.group || updated)) || group;

    renderTextRules();
    showToast("Rules saved", "success");
  } catch (error) {
    handleApiError(error, "Failed to save rules");
  } finally {
    showSpinner(false);
  }
}

// ── PDF ─────────────────────────────────────────────────────────────────────
function renderPdf() {
  const url = (group && group.rulesDocumentUrl) || "";
  const hasPdf = url !== "";

  show("currentPdfView", hasPdf);
  show("pdfUploadArea", !hasPdf);

  if (hasPdf) {
    setText("currentPdfFileName", group.rulesDocumentName || "Rules document");
    setText("currentPdfFileSize", "");

    const preview = document.getElementById("pdfPreview");
    if (preview) preview.src = url;

    const download = document.getElementById("downloadCurrentPdfBtn");
    if (download) {
      download.href = url;
      download.setAttribute("target", "_blank");
      download.setAttribute("rel", "noopener noreferrer");
    }
  }

  handleFileSelected(null);
}

function showUploadArea() {
  show("pdfUploadArea", true);
  show("currentPdfView", false);
}

function handleFileSelected(file) {
  selectedFile = null;

  if (!file) {
    show("selectedFileInfo", false);
    const input = document.getElementById("fileInput");
    if (input) input.value = "";
    return;
  }

  // Validate before upload so the user gets a clear message rather than a 422.
  const isPdf = file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    showToast("The rules document must be a PDF.", "error");
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    showToast("That file is too large. Maximum size is 5 MB.", "error");
    return;
  }

  selectedFile = file;
  setText("selectedFileName", file.name);
  setText("selectedFileSize", formatFileSize(file.size));
  show("selectedFileInfo", true);
}

async function uploadPdf() {
  if (!selectedGroupId) return;
  if (!selectedFile) {
    showToast("Choose a PDF to upload first.", "error");
    return;
  }

  showSpinner(true);
  try {
    // 1) Store the file. The server sniffs the real MIME (a renamed executable is
    //    rejected) and gives it a random name — the client name never hits disk.
    const uploaded = await uploadFile(selectedFile, selectedGroupId);

    // 2) Point the group at it. The server refuses any url it did not mint.
    const updated = await apiPost("groups.update", {
      groupId: selectedGroupId,
      rulesDocumentUrl: uploaded.url,
      rulesDocumentName: uploaded.fileName || selectedFile.name,
    });
    group = (updated && (updated.group || updated)) || group;

    renderPdf();
    showToast("Rules document uploaded", "success");
  } catch (error) {
    handleApiError(error, "Failed to upload the rules document");
  } finally {
    showSpinner(false);
  }
}

async function removePdf() {
  if (!selectedGroupId) return;

  showSpinner(true);
  try {
    // Clearing the reference. The stored file itself is not deleted here — file
    // deletion is a destructive op and there is no endpoint for it; an orphaned
    // upload is harmless (unguessable name, no listing) whereas a wrong delete is not.
    const updated = await apiPost("groups.update", {
      groupId: selectedGroupId,
      rulesDocumentUrl: "",
      rulesDocumentName: "",
    });
    group = (updated && (updated.group || updated)) || group;

    renderPdf();
    showToast("Rules document removed", "success");
  } catch (error) {
    handleApiError(error, "Failed to remove the rules document");
  } finally {
    showSpinner(false);
  }
}

/**
 * Multipart upload to files.upload. api.js sends JSON only, so this is a direct
 * fetch — mirroring its same-origin credentials and defensive parsing.
 */
async function uploadFile(file, groupId) {
  const form = new FormData();
  form.append("file", file);
  form.append("groupId", groupId);

  let response;
  try {
    response = await fetch("/api/index.php?action=files.upload", {
      method: "POST",
      credentials: "same-origin",
      body: form, // no Content-Type — the browser sets the multipart boundary
    });
  } catch (networkError) {
    throw new ApiError("Unable to reach the server. Check your connection.", 0, null);
  }

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch (parseError) {
    throw new ApiError("Unexpected server response", response.status, null);
  }

  if (!response.ok) {
    throw new ApiError(
      (body && (body.message || body.error)) || "Upload failed.",
      response.status,
      body,
    );
  }
  if (!body || !body.url) {
    throw new ApiError("Upload did not return a file URL.", response.status, body);
  }
  return body;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function show(id, visible) {
  const node = document.getElementById(id);
  if (node) node.style.display = visible ? "" : "none";
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value == null ? "" : String(value);
}

function showSpinner(visible) {
  const spinner = document.getElementById("spinner");
  if (spinner) spinner.classList.toggle("hidden", !visible);
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function handleApiError(error, fallback) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      redirectToLogin();
      return;
    }
    if (error.status === 403) {
      showToast("Only an admin can change the group's rules.", "error");
      return;
    }
    showToast(error.message || fallback, "error");
    return;
  }
  console.error(fallback, error);
  showToast(fallback, "error");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) {
    console.log(`[${type}] ${message}`);
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const span = document.createElement("span");
  span.textContent = message;

  const close = document.createElement("button");
  close.className = "toast-close";
  close.innerHTML = "&times;"; // static entity, never user data
  close.addEventListener("click", () => toast.remove());

  toast.append(span, close);
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
