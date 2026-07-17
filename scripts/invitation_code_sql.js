/**
 * invitation_code_sql.js — SQL port of invitation_code.js. Traces to C5.
 *
 * MODEL CHANGE (recorded, not hidden): the Firebase original wrote a single
 * throwaway `invitationCodes/{doc}` document (generated client-side, marked
 * "approved" by a human elsewhere, then deleted the instant it was used) and
 * polled it with onSnapshot. The SQL backend has a real, group-scoped join-code
 * resource with no manual "approve the code" step and no polling — a code is
 * created active and immediately usable via `codes.redeem` (see
 * accept_invitation_sql.js). This page is therefore reshaped into what an admin
 * actually needs for that resource: pick a group, generate a code (optional
 * expiry + max-uses), see all codes for that group with their live usedCount,
 * copy a code to the clipboard, and revoke one.
 *
 * Not wired into any HTML page yet — no page currently loads invitation_code.js
 * as a standalone manager (the only existing reference is registration.js's
 * import, which is out of scope here and untouched). This file preserves the
 * legacy ids `invitationCode` / `generateCodeBtn` as an optional single-code
 * quick-generate surface if a future page still exposes them, and additionally
 * supports a fuller management UI (group select + list + revoke) via ids
 * documented per-function below, so it binds either way at cutover.
 *
 * No data-bearing innerHTML — every code, group name, date and status is
 * inserted via textContent / createElement.
 */

import {
  apiGet,
  apiPost,
  requireSession,
  listMyGroups,
  ApiError,
  redirectToLogin,
} from "./api.js";

// ── Global state ────────────────────────────────────────────────────────────
let currentUser = null;
let selectedGroupId = null;
let adminGroups = []; // groups where the caller is admin/senior_admin/treasurer
let allCodes = [];

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  try {
    currentUser = await requireSession(); // redirects to login on 401
  } catch (error) {
    handleApiError(error, "Could not verify your session.");
    return;
  }
  await loadAdminGroups();
});

// ── Event listeners ─────────────────────────────────────────────────────────
function setupEventListeners() {
  // Fuller management UI, if present.
  const groupSelect = document.getElementById("groupSelect") || document.getElementById("groupSelector");
  if (groupSelect) {
    groupSelect.addEventListener("change", (e) => {
      selectedGroupId = e.target.value;
      if (selectedGroupId) {
        sessionStorage.setItem("selectedGroupId", selectedGroupId);
        loadCodes();
      }
    });
  }

  document.getElementById("createCodeForm")?.addEventListener("submit", handleCreateCode);

  // Legacy single-button quick-generate surface (matches the original ids).
  document.getElementById("generateCodeBtn")?.addEventListener("click", async () => {
    await handleGenerateSingleCode();
  });
}

// ── Load the caller's admin groups ──────────────────────────────────────────
async function loadAdminGroups() {
  showLoading(true);
  try {
    const groups = await listMyGroups();
    adminGroups = groups.filter((g) =>
      ["admin", "senior_admin", "treasurer"].includes(g.role));

    if (adminGroups.length === 0) {
      showToast("You are not an admin of any groups", "warning");
      renderGroupOptions();
      return;
    }

    renderGroupOptions();

    const sessionGroupId = sessionStorage.getItem("selectedGroupId");
    const match = adminGroups.find((g) => (g.groupId || g.id) === sessionGroupId);
    const chosen = match || adminGroups[0];
    selectedGroupId = chosen.groupId || chosen.id;
    sessionStorage.setItem("selectedGroupId", selectedGroupId);

    const groupSelect = document.getElementById("groupSelect") || document.getElementById("groupSelector");
    if (groupSelect) groupSelect.value = selectedGroupId;

    await loadCodes();
  } catch (error) {
    handleApiError(error, "Failed to load groups");
  } finally {
    showLoading(false);
  }
}

function renderGroupOptions() {
  const groupSelect = document.getElementById("groupSelect") || document.getElementById("groupSelector");
  if (!groupSelect) return;
  groupSelect.textContent = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a group...";
  groupSelect.appendChild(placeholder);

  adminGroups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.groupId || group.id;
    option.textContent = group.groupName || group.name || "Unnamed group";
    groupSelect.appendChild(option);
  });
}

// ── Load codes for the selected group ───────────────────────────────────────
async function loadCodes() {
  if (!selectedGroupId) return;
  showLoading(true);
  try {
    const data = await apiGet("codes.list", {groupId: selectedGroupId});
    allCodes = Array.isArray(data && data.codes) ? data.codes : [];
    displayCodes(allCodes);
  } catch (error) {
    handleApiError(error, "Failed to load codes");
  } finally {
    showLoading(false);
  }
}

function displayCodes(codes) {
  const list = document.getElementById("codesList");
  if (!list) return;
  list.textContent = "";

  if (codes.length === 0) {
    list.appendChild(emptyState(
      "No Codes Yet",
      selectedGroupId ? "Generate a join code to invite members." : "Select a group to see its codes.",
    ));
    return;
  }

  codes.forEach((code) => list.appendChild(createCodeCard(code)));
}

function emptyState(title, text) {
  const empty = el("div", "empty-state");
  const h3 = el("h3");
  h3.textContent = title;
  const p = el("p", "empty-state-text");
  p.textContent = text;
  empty.append(h3, p);
  return empty;
}

function createCodeCard(code) {
  const card = el("div", "code-card");

  const header = el("div", "code-card-header");
  const codeText = el("span", "code-value");
  codeText.textContent = code.code || "";
  const statusBadge = el("span", `code-status status-${code.status || "unknown"}`);
  statusBadge.textContent = code.status || "unknown";
  header.append(codeText, statusBadge);

  const body = el("div", "code-card-body");
  body.append(
    detail("Group", code.groupName || "N/A"),
    detail("Used", `${code.usedCount ?? 0}${code.maxUses ? ` / ${code.maxUses}` : ""}`),
    detail("Expires", code.expiresAt ? new Date(code.expiresAt).toLocaleString() : "Never"),
    detail("Created", code.createdAt ? new Date(code.createdAt).toLocaleString() : "N/A"),
  );

  const actions = el("div", "code-card-actions");

  const copyBtn = el("button", "btn btn-ghost btn-sm");
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => copyCode(code.code));
  actions.appendChild(copyBtn);

  if (code.status === "active") {
    const revokeBtn = el("button", "btn btn-ghost btn-sm");
    revokeBtn.textContent = "Revoke";
    revokeBtn.style.color = "var(--bn-danger)";
    revokeBtn.addEventListener("click", () => handleRevokeCode(code.codeId));
    actions.appendChild(revokeBtn);
  }

  card.append(header, body, actions);
  return card;
}

function detail(label, value) {
  const wrap = el("div", "code-detail");
  const l = el("div", "code-detail-label");
  l.textContent = label;
  const v = el("div", "code-detail-value");
  v.textContent = value;
  wrap.append(l, v);
  return wrap;
}

// ── Copy to clipboard ───────────────────────────────────────────────────────
async function copyCode(code) {
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast("Code copied to clipboard", "success");
  } catch (error) {
    showToast("Could not copy the code — copy it manually.", "warning");
  }
}

// ── Create a code (full form: groupId is implicit from selectedGroupId) ─────
async function handleCreateCode(e) {
  e.preventDefault();
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }

  const expiresAtInput = document.getElementById("codeExpiresAt");
  const maxUsesInput = document.getElementById("codeMaxUses");

  const body = {groupId: selectedGroupId};
  const expiresAt = expiresAtInput?.value;
  if (expiresAt) body.expiresAt = expiresAt;
  const maxUses = maxUsesInput?.value;
  if (maxUses) {
    const parsed = Number(maxUses);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      showToast("Max uses must be a positive number", "error");
      return;
    }
    body.maxUses = parsed;
  }

  showLoading(true);
  try {
    const created = await apiPost("codes.create", body);
    if (expiresAtInput) expiresAtInput.value = "";
    if (maxUsesInput) maxUsesInput.value = "";
    showToast(`Code ${created && created.code ? created.code : ""} created`, "success");
    await loadCodes();
  } catch (error) {
    handleApiError(error, "Failed to create code");
  } finally {
    showLoading(false);
  }
}

// ── Legacy single-generate surface (ids: invitationCode / generateCodeBtn) ──
async function handleGenerateSingleCode() {
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }
  showLoading(true);
  try {
    const created = await apiPost("codes.create", {groupId: selectedGroupId});
    const codeInput = document.getElementById("invitationCode");
    if (codeInput) codeInput.value = created && created.code ? created.code : "";
    showToast("Code generated", "success");
    await loadCodes();
  } catch (error) {
    handleApiError(error, "Failed to generate code");
  } finally {
    showLoading(false);
  }
}

// ── Revoke ──────────────────────────────────────────────────────────────────
async function handleRevokeCode(codeId) {
  if (!codeId) return;
  showLoading(true);
  try {
    await apiPost("codes.revoke", {codeId});
    showToast("Code revoked", "success");
    await loadCodes();
  } catch (error) {
    handleApiError(error, "Failed to revoke code");
  } finally {
    showLoading(false);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function showLoading(show) {
  const overlay = document.getElementById("loadingOverlay") || document.getElementById("spinner");
  if (!overlay) return;
  overlay.classList.toggle("hidden", !show);
}

/** Centralised ApiError handling: 401 -> login (already handled by requireSession). */
function handleApiError(error, fallback) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      redirectToLogin();
      return;
    }
    if (error.status === 403) {
      showToast("You do not have permission to do that.", "error");
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
    // No alert() — keep to the app's toast contract; degrade silently to console.
    console.log(`[${type}] ${message}`);
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const span = document.createElement("span");
  span.textContent = message;
  const close = document.createElement("button");
  close.className = "toast-close";
  close.innerHTML = "&times;"; // static entity only, no user data
  close.addEventListener("click", () => toast.remove());

  toast.append(span, close);
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
