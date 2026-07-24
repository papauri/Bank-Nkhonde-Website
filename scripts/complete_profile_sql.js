/**
 * complete_profile_sql.js — SQL port of complete_profile.js (fill in your profile
 * after first login). Traces to C5.
 *
 * Loads via profile.get, saves via profile.update, photo via files.upload — all
 * operate on the SESSION user (no uid parameter exists).
 *
 * SCHEMA LIMITATION (recorded, not hidden): the Firebase form captured ~21 fields
 * including guarantor, collateral, ID, emergency/next-of-kin, career. The SQL
 * `users` table + `profile.update` whitelist currently support:
 * fullName, phone, whatsappNumber, address, nationality, occupation, dateOfBirth,
 * profileImageUrl, plus the optional KYC set (B20): guarantorName, guarantorPhone,
 * guarantorRelationship, guarantorAddress, collateralDescription, idType, idNumber,
 * nextOfKinName, nextOfKinPhone, nextOfKinRelationship. All of the KYC fields are
 * non-mandatory — blank is sent as "" and the backend stores it as NULL. Remaining
 * markup fields (jobTitle, workplace, workAddress, nationalId, emergencyContact,
 * emergencyContactPhone, notes) still have no columns and are NOT sent.
 *
 * No data-bearing innerHTML — the photo preview uses createElement.
 */

import {apiGet, apiPost, requireSession, listMyGroups, ApiError, redirectToLogin, apiUrl} from "./api.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// The subset the SQL profile actually persists.
const SUPPORTED_FIELDS = [
  "fullName", "phone", "whatsappNumber", "address",
  "nationality", "occupation", "dateOfBirth",
];

// Optional KYC fields (B20) — never required, always sent (blank = clear/NULL).
const KYC_FIELDS = [
  "guarantorName", "guarantorPhone", "guarantorRelationship", "guarantorAddress",
  "collateralDescription", "idType", "idNumber",
  "nextOfKinName", "nextOfKinPhone", "nextOfKinRelationship",
];

let profile = null;
let pendingPhoto = null;

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("profileForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    hideError();
    saveProfile();
  });

  document.getElementById("profilePictureInput")?.addEventListener("change", onPhotoSelected);

  try {
    await requireSession();
  } catch (error) {
    return;
  }

  await loadExistingProfile();
});

async function loadExistingProfile() {
  showSpinner(true, "Loading profile...");
  try {
    profile = await apiGet("profile.get");

    SUPPORTED_FIELDS.concat(KYC_FIELDS).forEach((field) => {
      const el = document.getElementById(field);
      if (!el) return;
      let value = profile[field];
      if (field === "dateOfBirth" && value) value = String(value).substring(0, 10);
      if (value != null) el.value = value;
    });

    if (profile.profileImageUrl) renderPhoto(profile.profileImageUrl);
  } catch (error) {
    // Loading failure shouldn't block filling the form — just let them proceed,
    // but they still need to know the pre-fill didn't happen.
    console.error("Could not load profile", error);
    showToast("We couldn't load your saved profile — you can still fill this out.", "warning");
  } finally {
    showSpinner(false);
  }
}

function onPhotoSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showError("Please select an image file.");
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showError("Image size must be less than 5MB.");
    return;
  }
  hideError();
  pendingPhoto = file;

  // Local preview via createElement — no innerHTML, no data URI in a string.
  const reader = new FileReader();
  reader.onload = (ev) => renderPhoto(ev.target.result);
  reader.readAsDataURL(file);
}

function renderPhoto(src) {
  const preview = document.getElementById("profilePicturePreview");
  if (!preview) return;
  preview.textContent = "";
  const img = document.createElement("img");
  img.src = src;
  img.alt = "Profile";
  preview.appendChild(img);
}

async function saveProfile() {
  const submitBtn = document.getElementById("submitProfileBtn");

  const getValue = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  };

  const fullName = getValue("fullName");
  const phone = getValue("phone");
  const address = getValue("address");
  if (!fullName) return showError("Please enter your full name.");
  if (!phone) return showError("Please enter your phone number.");
  if (!address) return showError("Please enter your address.");

  if (submitBtn) submitBtn.disabled = true;
  showSpinner(true, "Saving your profile...");

  try {
    // Photo first, so its url is part of the single profile.update.
    let profileImageUrl;
    if (pendingPhoto) {
      showSpinner(true, "Uploading profile picture...");
      try {
        const uploaded = await uploadFile(pendingPhoto);
        profileImageUrl = uploaded.url;
      } catch (uploadError) {
        // A failed photo must not lose the rest of the profile — carry on without it.
        console.error("Photo upload failed", uploadError);
      }
    }

    const payload = {
      fullName,
      phone,
      whatsappNumber: getValue("whatsappNumber") || phone,
      address,
      nationality: getValue("nationality"),
      occupation: getValue("occupation"),
    };
    const dob = getValue("dateOfBirth");
    if (dob) payload.dateOfBirth = dob;
    if (profileImageUrl) payload.profileImageUrl = profileImageUrl;

    // Optional KYC fields (B20) — always included; blank means "leave/clear".
    KYC_FIELDS.forEach((field) => {
      payload[field] = getValue(field);
    });

    profile = await apiPost("profile.update", payload);

    showSpinner(false);
    showToast("Profile completed! Welcome to Bank Nkhonde.", "success");
    setTimeout(() => {
      window.location.href = "user_dashboard.html";
    }, 1200);
  } catch (error) {
    showSpinner(false);
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    showError(`Error saving profile: ${error.message || "please try again."}`);
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  // files.upload gates on group membership; a just-registered user should belong
  // to at least one group. Use the current selection, else their first group.
  let groupId = sessionStorage.getItem("selectedGroupId") ||
    localStorage.getItem("selectedGroupId") || "";
  if (!groupId) {
    try {
      const groups = await listMyGroups();
      if (groups.length > 0) groupId = groups[0].groupId || groups[0].id;
    } catch (e) { /* leave empty — the upload will 422 with a clear message */ }
  }
  form.append("groupId", groupId);

  let response;
  try {
    response = await fetch(apiUrl("files.upload"), {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
  } catch (networkError) {
    throw new ApiError("Unable to reach the server.", 0, null);
  }

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch (parseError) {
    throw new ApiError("Unexpected server response", response.status, null);
  }
  if (!response.ok) {
    throw new ApiError((body && (body.message || body.error)) || "Upload failed.", response.status, body);
  }
  if (!body || !body.url) {
    throw new ApiError("Upload did not return a file URL.", response.status, body);
  }
  return body;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function showSpinner(show, message) {
  const spinner = document.getElementById("spinner");
  if (spinner) spinner.classList.toggle("hidden", !show);
  const loadingText = document.getElementById("loadingText");
  if (loadingText && message) loadingText.textContent = message;
}

function showError(message) {
  const err = document.getElementById("errorMessage");
  if (err) {
    err.textContent = message;
    err.classList.remove("hidden");
    err.scrollIntoView({behavior: "smooth", block: "center"});
  }
  showSpinner(false);
  const submitBtn = document.getElementById("submitProfileBtn");
  if (submitBtn) submitBtn.disabled = false;
}

function hideError() {
  document.getElementById("errorMessage")?.classList.add("hidden");
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
  close.innerHTML = "&times;"; // static entity only
  close.addEventListener("click", () => toast.remove());
  toast.append(span, close);
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
