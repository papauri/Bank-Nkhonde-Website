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

import {apiGet, apiPost, requireSession, listMyGroups, ApiError, redirectToLogin, apiUrl} from "./api.js";
import {updateActiveNav} from "./nav_sql.js?v=20260722";

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
  document.querySelectorAll(".rules-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".rules-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".rules-tab-content").forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      const panel = document.getElementById(`${tab.dataset.tab}Tab`);
      if (panel) panel.classList.add("active");
    });
  });

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

  // Governance tab
  document.getElementById("saveGovernanceBtn")?.addEventListener("click", saveGovernanceSettings);

  // Penalty period/basis drive which amount or rate input is relevant.
  ["loanPenaltyPeriodInput", "loanPenaltyTypeInput",
    "contributionPenaltyPeriodInput", "contributionPenaltyTypeInput"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", updatePenaltyFieldVisibility);
  });

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

    // pages/manage_rules.html has no #groupName element — the actual group
    // name display is the shared topbar title (.topbar-title), set here via
    // nav_sql.js's updateActiveNav rather than a page-local id that never
    // existed in the markup.
    updateActiveNav("rules", group.groupName || "Group Rules");
    renderTextRules();
    renderPdf();
    renderGovernanceSettings();
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

// ── Governance Settings ─────────────────────────────────────────────────────
function renderGovernanceSettings() {
  // Group-level settings
  const maxMembers = group && group.maxMembers;
  const maxMembersInput = document.getElementById("maxMembersInput");
  if (maxMembersInput) {
    maxMembersInput.value = maxMembers !== null && maxMembers !== undefined ? maxMembers : "";
  }

  // Custom role titles
  const customRoles = group && group.customRoleTitles;
  let roles = {};
  try {
    roles = typeof customRoles === "string" ? JSON.parse(customRoles) : (customRoles || {});
  } catch (e) {
    roles = {};
  }

  const seniorAdminInput = document.getElementById("seniorAdminTitleInput");
  const adminInput = document.getElementById("adminTitleInput");
  const treasurerInput = document.getElementById("treasurerTitleInput");
  if (seniorAdminInput) seniorAdminInput.value = roles.senior_admin || "";
  if (adminInput) adminInput.value = roles.admin || "";
  if (treasurerInput) treasurerInput.value = roles.treasurer || "";

  // Rules-level settings (loan deadlines)
  // These come from group_rules, not groups — load them separately
  loadRulesSettings();
}

async function loadRulesSettings() {
  if (!selectedGroupId) return;
  try {
    const rules = await apiGet("rules.get", {groupId: selectedGroupId});
    if (!rules) return;

    const loanBookingDayInput = document.getElementById("loanBookingDayInput");
    const lastLoanMonthInput = document.getElementById("lastLoanMonthInput");
    const minMembershipMonthsInput = document.getElementById("minMembershipMonthsInput");

    if (loanBookingDayInput) {
      loanBookingDayInput.value = rules.loanBookingDay !== null && rules.loanBookingDay !== undefined ? rules.loanBookingDay : "";
    }
    if (lastLoanMonthInput) {
      lastLoanMonthInput.value = rules.lastLoanMonth !== null && rules.lastLoanMonth !== undefined ? rules.lastLoanMonth : "";
    }
    if (minMembershipMonthsInput) {
      minMembershipMonthsInput.value = rules.minMembershipMonths !== null && rules.minMembershipMonths !== undefined ? rules.minMembershipMonths : "0";
    }

    // Penalty on/off switches. Absent reads as ON, matching the column default,
    // so an older rules row without the field does not appear to have penalties
    // disabled when it does not.
    const loanPenEl = document.getElementById("loanPenaltyEnabledInput");
    if (loanPenEl) loanPenEl.checked = Number(rules.loanPenaltyEnabled ?? 1) === 1;
    const contribPenEl = document.getElementById("contributionPenaltyEnabledInput");
    if (contribPenEl) contribPenEl.checked = Number(rules.contributionPenaltyEnabled ?? 1) === 1;

    // Share-out capital return. Absent reads as OFF, matching the column default.
    const capEl = document.getElementById("shareOutReturnsCapitalInput");
    if (capEl) capEl.checked = Number(rules.shareOutReturnsCapital ?? 0) === 1;

    // Interest sharing method. Falls back to the server's own default rather
    // than leaving the control on whatever option happens to be first, so it
    // never displays a rule the group is not actually on.
    const shareOutInterestMethodInput = document.getElementById("shareOutInterestMethodInput");
    if (shareOutInterestMethodInput) {
      const allowed = ["refund_to_payer", "split_equally", "split_by_contribution"];
      shareOutInterestMethodInput.value = allowed.includes(rules.shareOutInterestMethod)
        ? rules.shareOutInterestMethod
        : "refund_to_payer";
    }

    renderPenaltySettings(rules);
  } catch (error) {
    // Rules may not exist yet — that's fine, leave fields empty
  }
}

// ── Penalty Settings ────────────────────────────────────────────────────────
// The two bases are DELIBERATELY DIFFERENT and must never be merged: loan
// penalties price off the OVERDUE amount, contribution penalties off the FULL
// obligation regardless of part-payment. That is the group owner's money rule
// (BL-6) and the server enforces it — this form only chooses period/basis/rate.

/** Field id → group_rules column. Selects first, then money, then rates. */
const PENALTY_SELECTS = {
  loanPenaltyPeriodInput: "loanPenaltyPeriod",
  loanPenaltyTypeInput: "loanPenaltyType",
  contributionPenaltyPeriodInput: "contributionPenaltyPeriod",
  contributionPenaltyTypeInput: "contributionPenaltyType",
};

/** Numeric penalty fields. `nullable` ones send null when cleared; the rest send "0". */
const PENALTY_NUMBERS = {
  loanPenaltyDailyAmountInput: {column: "loanPenaltyDailyAmount", nullable: false},
  loanPenaltyMonthlyAmountInput: {column: "loanPenaltyMonthlyAmount", nullable: true},
  loanPenaltyRateInput: {column: "loanPenaltyRate", nullable: false},
  loanPenaltyGraceInput: {column: "loanPenaltyGracePeriodDays", nullable: false},
  contributionPenaltyDailyAmountInput: {column: "contributionPenaltyDailyAmount", nullable: false},
  contributionPenaltyMonthlyAmountInput: {column: "contributionPenaltyMonthlyAmount", nullable: true},
  contributionPenaltyDailyRateInput: {column: "contributionPenaltyDailyRate", nullable: false},
  contributionPenaltyMonthlyRateInput: {column: "contributionPenaltyMonthlyRate", nullable: false},
  contributionPenaltyGraceInput: {column: "contributionPenaltyGracePeriodDays", nullable: false},
};

function renderPenaltySettings(rules) {
  Object.keys(PENALTY_SELECTS).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const value = rules[PENALTY_SELECTS[id]];
    // Fall back to the schema default rather than leaving the select on
    // whichever option happens to be first if the server sent nothing.
    if (value === null || value === undefined || value === "") {
      el.value = id.endsWith("PeriodInput") ? "day" : "fixed";
    } else {
      el.value = String(value);
    }
  });

  Object.keys(PENALTY_NUMBERS).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const value = rules[PENALTY_NUMBERS[id].column];
    el.value = value === null || value === undefined ? "" : String(value);
  });

  updatePenaltyFieldVisibility();
}

/**
 * Show only the inputs the chosen period + basis actually use, so an admin
 * cannot be misled into typing a monthly amount that a per-day rule ignores.
 * Hidden inputs keep their values and are still submitted — clearing them on
 * toggle would silently wipe a configured rate the admin never meant to touch.
 */
function updatePenaltyFieldVisibility() {
  const loanPeriod = document.getElementById("loanPenaltyPeriodInput")?.value || "day";
  const loanType = document.getElementById("loanPenaltyTypeInput")?.value || "fixed";
  const contribPeriod = document.getElementById("contributionPenaltyPeriodInput")?.value || "day";
  const contribType = document.getElementById("contributionPenaltyTypeInput")?.value || "fixed";

  // Loan has a SINGLE rate column covering both periods, so the rate input
  // shows for percentage regardless of period.
  show("loanPenaltyDailyAmountGroup", loanType === "fixed" && loanPeriod === "day");
  show("loanPenaltyMonthlyAmountGroup", loanType === "fixed" && loanPeriod === "month");
  show("loanPenaltyRateGroup", loanType === "percentage");

  // Contribution has separate daily and monthly rate columns, so period picks
  // which rate input is relevant.
  show("contributionPenaltyDailyAmountGroup", contribType === "fixed" && contribPeriod === "day");
  show("contributionPenaltyMonthlyAmountGroup", contribType === "fixed" && contribPeriod === "month");
  show("contributionPenaltyDailyRateGroup", contribType === "percentage" && contribPeriod === "day");
  show("contributionPenaltyMonthlyRateGroup", contribType === "percentage" && contribPeriod === "month");
}

/** Add every penalty field to the rules.update body. */
function collectPenaltySettings(rulesUpdate) {
  Object.keys(PENALTY_SELECTS).forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.value !== "") rulesUpdate[PENALTY_SELECTS[id]] = el.value;
  });

  Object.keys(PENALTY_NUMBERS).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const {column, nullable} = PENALTY_NUMBERS[id];
    const raw = el.value.trim();
    if (raw === "") {
      // A cleared nullable column means "unset"; a cleared NOT NULL column
      // means "no penalty", which is 0 — never an empty string, which the
      // server rejects as a non-numeric amount.
      rulesUpdate[column] = nullable ? null : "0";
    } else {
      rulesUpdate[column] = raw;
    }
  });
}

async function saveGovernanceSettings() {
  if (!selectedGroupId) return;

  showSpinner(true);
  try {
    // Save group-level settings
    const maxMembersValue = document.getElementById("maxMembersInput")?.value;
    const maxMembers = maxMembersValue !== "" ? parseInt(maxMembersValue, 10) : null;

    const customRoleTitles = {
      senior_admin: document.getElementById("seniorAdminTitleInput")?.value || null,
      admin: document.getElementById("adminTitleInput")?.value || null,
      treasurer: document.getElementById("treasurerTitleInput")?.value || null,
    };
    // Remove null entries
    Object.keys(customRoleTitles).forEach((key) => {
      if (customRoleTitles[key] === null) delete customRoleTitles[key];
    });

    await apiPost("groups.update", {
      groupId: selectedGroupId,
      maxMembers: maxMembers,
      customRoleTitles: Object.keys(customRoleTitles).length > 0 ? customRoleTitles : null,
    });

    // Save rules-level settings
    const loanBookingDayValue = document.getElementById("loanBookingDayInput")?.value;
    const lastLoanMonthValue = document.getElementById("lastLoanMonthInput")?.value;
    const minMembershipMonthsValue = document.getElementById("minMembershipMonthsInput")?.value;

    const rulesUpdate = {groupId: selectedGroupId};
    if (loanBookingDayValue !== "") {
      rulesUpdate.loanBookingDay = parseInt(loanBookingDayValue, 10);
    } else {
      rulesUpdate.loanBookingDay = null;
    }
    if (lastLoanMonthValue !== "") {
      rulesUpdate.lastLoanMonth = parseInt(lastLoanMonthValue, 10);
    } else {
      rulesUpdate.lastLoanMonth = null;
    }
    if (minMembershipMonthsValue !== "") {
      rulesUpdate.minMembershipMonths = parseInt(minMembershipMonthsValue, 10);
    }

    const loanPenInput = document.getElementById("loanPenaltyEnabledInput");
    if (loanPenInput) rulesUpdate.loanPenaltyEnabled = loanPenInput.checked;
    const contribPenInput = document.getElementById("contributionPenaltyEnabledInput");
    if (contribPenInput) rulesUpdate.contributionPenaltyEnabled = contribPenInput.checked;
    const capInput = document.getElementById("shareOutReturnsCapitalInput");
    if (capInput) rulesUpdate.shareOutReturnsCapital = capInput.checked;

    // Only ever send one of the three values the server accepts; anything else
    // is rejected 422 by update_rules() rather than silently stored.
    const shareOutInterestMethodValue = document.getElementById("shareOutInterestMethodInput")?.value;
    if (["refund_to_payer", "split_equally", "split_by_contribution"].includes(shareOutInterestMethodValue)) {
      rulesUpdate.shareOutInterestMethod = shareOutInterestMethodValue;
    }

    collectPenaltySettings(rulesUpdate);

    await apiPost("rules.update", rulesUpdate);

    // Reload group data
    const resp = await apiGet("groups.get", {groupId: selectedGroupId});
    group = (resp && (resp.group || resp)) || {};

    showToast("Governance settings saved", "success");
  } catch (error) {
    handleApiError(error, "Failed to save governance settings");
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
    response = await fetch(apiUrl("files.upload"), {
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
