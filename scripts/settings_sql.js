/**
 * settings_sql.js — SQL port of settings.js ("my account": profile, photo,
 * password, sign out).
 *
 * Endpoints (all operate on the SESSION user — there is no uid parameter
 * anywhere, so this page structurally cannot touch another person's account):
 *   profile.get      -> my profile
 *   profile.update   -> edit my profile (whitelisted columns only)
 *   profile.password -> change my password (CURRENT password required)
 *   files.upload     -> profile photo (real-MIME sniffed, random server filename)
 *   logout           -> destroys the server-side session
 *
 * Password change requires the current password — the Firebase original called
 * reauthenticateWithCredential() for the same reason: holding a live session must
 * not be enough to change the credential, or an unlocked phone / stolen cookie
 * could lock the real owner out of their money.
 *
 * Email is NOT editable here: it is the login identity and the password-reset
 * recipient, so changing it needs a verification flow that does not exist yet.
 *
 * No data-bearing innerHTML — every value via textContent.
 */

import {apiGet, apiPost, requireSession, logout, ApiError, redirectToLogin} from "./api.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // matches the server's cap

let profile = null;

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();

  try {
    await requireSession();
  } catch (error) {
    return;
  }

  await loadProfile();
});

function setupEventListeners() {
  document.getElementById("personalInfoForm")?.addEventListener("submit", savePersonalInfo);
  document.getElementById("profileForm")?.addEventListener("submit", savePersonalInfo);
  document.getElementById("passwordForm")?.addEventListener("submit", changePassword);
  document.getElementById("changePasswordForm")?.addEventListener("submit", changePassword);

  document.getElementById("profileImageInput")?.addEventListener("change", (e) => {
    uploadProfileImage(e.target.files?.[0] || null);
  });
  document.getElementById("changePhotoBtn")?.addEventListener("click", () => {
    document.getElementById("profileImageInput")?.click();
  });

  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("signOutBtn")?.addEventListener("click", handleLogout);
}

// ── Load ────────────────────────────────────────────────────────────────────
async function loadProfile() {
  showSpinner(true);
  try {
    profile = await apiGet("profile.get");
    renderProfile();
  } catch (error) {
    handleApiError(error, "Failed to load your profile");
  } finally {
    showSpinner(false);
  }
}

function renderProfile() {
  if (!profile) return;

  setValue("fullName", profile.fullName);
  setValue("settingsFullName", profile.fullName);
  setValue("phone", profile.phone);
  setValue("settingsPhone", profile.phone);
  setValue("whatsappNumber", profile.whatsappNumber);
  setValue("address", profile.address);
  setValue("nationality", profile.nationality);
  setValue("occupation", profile.occupation);
  setValue("dateOfBirth", toDateInput(profile.dateOfBirth));

  // Email is display-only (see the file header).
  setValue("email", profile.email);
  setText("userEmail", profile.email);
  const emailInput = document.getElementById("email");
  if (emailInput) {
    emailInput.disabled = true;
    emailInput.title = "Your email is your sign-in identity and cannot be changed here.";
  }

  setText("displayName", profile.fullName || "");
  setText("profileName", profile.fullName || "");

  renderAvatar();
}

function renderAvatar() {
  const preview = document.getElementById("profileImagePreview") ||
    document.getElementById("profileAvatar");
  if (!preview) return;

  preview.textContent = "";

  if (profile.profileImageUrl) {
    const img = document.createElement("img");
    img.src = profile.profileImageUrl;
    img.alt = profile.fullName || "Profile photo";
    preview.appendChild(img);
    return;
  }

  const name = profile.fullName || "";
  preview.textContent = name
    ? name.split(" ").map((n) => n[0]).join("").toUpperCase().substring(0, 2)
    : "??";
}

// ── Profile ─────────────────────────────────────────────────────────────────
async function savePersonalInfo(e) {
  e.preventDefault();

  const fullName = firstValue("fullName", "settingsFullName");
  if (!fullName || !fullName.trim()) {
    showToast("Full name is required", "error");
    return;
  }

  // Only fields profile.update whitelists. Email is deliberately absent.
  const payload = {
    fullName: fullName.trim(),
    phone: firstValue("phone", "settingsPhone") ?? "",
    whatsappNumber: valueOf("whatsappNumber") ?? "",
    address: valueOf("address") ?? "",
    nationality: valueOf("nationality") ?? "",
    occupation: valueOf("occupation") ?? "",
  };

  const dob = valueOf("dateOfBirth");
  if (dob) payload.dateOfBirth = dob;

  showSpinner(true);
  try {
    profile = await apiPost("profile.update", payload);
    renderProfile();
    showToast("Profile updated", "success");
  } catch (error) {
    handleApiError(error, "Failed to update your profile");
  } finally {
    showSpinner(false);
  }
}

async function uploadProfileImage(file) {
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("Choose an image file (JPG, PNG or WebP).", "error");
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showToast("That image is too large. Maximum size is 5 MB.", "error");
    return;
  }

  showSpinner(true);
  try {
    // The server sniffs the real MIME and stores it under a random name; the
    // client filename never touches the disk path.
    const uploaded = await uploadFile(file);
    profile = await apiPost("profile.update", {profileImageUrl: uploaded.url});
    renderProfile();
    showToast("Profile photo updated", "success");
  } catch (error) {
    handleApiError(error, "Failed to upload your photo");
  } finally {
    showSpinner(false);
    const input = document.getElementById("profileImageInput");
    if (input) input.value = "";
  }
}

// ── Password ────────────────────────────────────────────────────────────────
async function changePassword(e) {
  e.preventDefault();

  const currentPassword = firstValue("currentPassword", "oldPassword") || "";
  const newPassword = firstValue("newPassword", "password") || "";
  const confirmPassword = firstValue("confirmPassword", "confirmNewPassword") || "";

  if (!currentPassword) {
    showToast("Enter your current password", "error");
    return;
  }
  if (newPassword.length < 8) {
    showToast("Your new password must be at least 8 characters", "error");
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast("The new passwords do not match", "error");
    return;
  }

  showSpinner(true);
  try {
    await apiPost("profile.password", {currentPassword, newPassword});

    document.getElementById("passwordForm")?.reset();
    document.getElementById("changePasswordForm")?.reset();
    showToast("Password changed", "success");
  } catch (error) {
    // 403 = the current password was wrong. Say exactly that; it is the caller's
    // own account, so there is nothing to leak.
    if (error instanceof ApiError && error.status === 403) {
      showToast("Your current password is incorrect.", "error");
    } else {
      handleApiError(error, "Failed to change your password");
    }
  } finally {
    showSpinner(false);
  }
}

// ── Sign out ────────────────────────────────────────────────────────────────
async function handleLogout() {
  try {
    await logout(); // destroys the SERVER-side session; the cookie alone is not the session
  } catch (error) {
    // Even if the call fails, clear local state and leave — a user who clicked
    // "sign out" must never be left looking at a signed-in page.
    console.error("Logout failed", error);
  } finally {
    sessionStorage.clear();
    localStorage.removeItem("selectedGroupId");
    redirectToLogin();
  }
}

// ── Upload helper ───────────────────────────────────────────────────────────
async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  // files.upload requires a groupId (it gates on group membership). Use the
  // group the user is currently working in.
  const groupId = sessionStorage.getItem("selectedGroupId") ||
    localStorage.getItem("selectedGroupId") || "";
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
function valueOf(id) {
  const node = document.getElementById(id);
  return node ? node.value : null;
}

/** The markup uses different ids across the two settings layouts. */
function firstValue(...ids) {
  for (const id of ids) {
    const node = document.getElementById(id);
    if (node && typeof node.value === "string") return node.value;
  }
  return null;
}

function setValue(id, value) {
  const node = document.getElementById(id);
  if (node) node.value = value == null ? "" : String(value);
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value == null ? "" : String(value);
}

/** 'YYYY-MM-DD HH:MM:SS' -> 'YYYY-MM-DD' for an <input type="date">. */
function toDateInput(value) {
  if (!value) return "";
  const str = String(value);
  return str.length >= 10 ? str.substring(0, 10) : "";
}

function showSpinner(visible) {
  const spinner = document.getElementById("spinner") ||
    document.getElementById("loadingOverlay");
  if (spinner) spinner.classList.toggle("hidden", !visible);
}

function handleApiError(error, fallback) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      redirectToLogin();
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
