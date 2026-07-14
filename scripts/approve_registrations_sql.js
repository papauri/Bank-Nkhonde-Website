/**
 * approve_registrations_sql.js — SQL port of approve_registrations.js.
 * Traces to C5.
 *
 * MODEL CHANGE (recorded, not hidden): the Firebase original approved/rejected
 * self-service `invitationCodes` documents that anyone could create client-side
 * and that a human then had to manually mark `approved: true` before the code
 * would validate — a "pending registration" gate with no server-side identity
 * behind it at all. The SQL backend has NO equivalent state: `register`
 * (api/handlers/auth.php, out of scope here) creates an ACTIVE user account
 * immediately, and joining a group happens only via `invitations.*` (an admin
 * invites a known email) or `codes.*` (an admin-generated join code, active the
 * moment it's created — see invitation_code_sql.js). There is no table row
 * anywhere that represents "someone signed up and is awaiting an admin's
 * approval to exist or to join."
 *
 * DEFERRED, NOT INVENTED: a real self-registration-approval flow needs a new
 * pending-registrations resource (e.g. a `status` column on `users`, defaulting
 * to `pending_review` for self-signups, plus `registrations.list` /
 * `registrations.approve` / `registrations.reject` endpoints and a role check
 * on each). No such endpoint exists today, so it is not called here — the
 * "Approve" / "Reject" self-registration actions from the original page are
 * toast-deferred (see approveSelfRegistration/rejectSelfRegistration below).
 *
 * WHAT THIS PAGE DOES INSTEAD, using only endpoints that exist:
 *   - Group selector filtered to admin/senior_admin/treasurer (groups.mine).
 *   - Lists the group's INVITATIONS (invitations.list) — who was invited by
 *     email, and whether they accepted, rejected, or are still pending. This is
 *     the closest existing analogue to "who is awaiting a decision."
 *   - An "Invite by email" form (invitations.create) so an admin can actually
 *     originate an invitation from this page, since the original page had no
 *     input for creating the request it approved — self-registration created
 *     it. That path is gone, so inviting is the SQL-native replacement.
 *
 * No data-bearing innerHTML — every email, group name, status and date is
 * inserted via textContent / createElement.
 */

import {
  apiGet,
  apiPost,
  requireSession,
  listMyGroups,
  ApiError,
} from "./api.js";

// ── Global state ────────────────────────────────────────────────────────────
let currentUser = null;
let selectedGroupId = null;
let adminGroups = [];
let allInvitations = [];
let currentFilter = "all";

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  try {
    currentUser = await requireSession(); // redirects to login on 401
  } catch (error) {
    handleApiError(error, "Could not verify your session.");
    return;
  }
  buildInviteForm();
  setupEventListeners();
  await loadAdminGroups();
});

// ── Event listeners ─────────────────────────────────────────────────────────
function setupEventListeners() {
  const groupSelect = document.getElementById("groupSelector") || document.getElementById("groupSelect");
  if (groupSelect) {
    groupSelect.addEventListener("change", (e) => {
      selectedGroupId = e.target.value;
      if (selectedGroupId) {
        sessionStorage.setItem("selectedGroupId", selectedGroupId);
        loadInvitations();
      }
    });
  }

  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      filterAndDisplay();
    });
  });
}

/**
 * The original page's HTML has no input for originating a request — self
 * registration created it. That flow doesn't exist in SQL, so the SQL-native
 * replacement (invite by email) is built here and inserted above the list,
 * rather than left unreachable.
 */
function buildInviteForm() {
  const host = document.getElementById("pendingList")?.parentElement || document.getElementById("mainContent");
  if (!host || document.getElementById("inviteByEmailForm")) return;

  const section = el("section", "content-section");
  const header = el("div", "content-section-header");
  const title = el("h2", "content-section-title");
  title.textContent = "Invite by Email";
  header.appendChild(title);

  const form = document.createElement("form");
  form.id = "inviteByEmailForm";
  form.className = "invite-form";

  const input = document.createElement("input");
  input.type = "email";
  input.id = "inviteEmailInput";
  input.className = "form-input";
  input.placeholder = "member@example.com";
  input.required = true;

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn btn-primary btn-sm";
  submit.textContent = "Send Invite";

  form.append(input, submit);
  form.addEventListener("submit", handleInviteByEmail);

  section.append(header, form);

  const pendingSection = document.getElementById("pendingList")?.closest(".content-section");
  if (pendingSection) {
    host.insertBefore(section, pendingSection);
  } else {
    host.appendChild(section);
  }
}

async function handleInviteByEmail(e) {
  e.preventDefault();
  if (!selectedGroupId) {
    showToast("Please select a group first", "error");
    return;
  }
  const input = document.getElementById("inviteEmailInput");
  const invitedEmail = (input?.value || "").trim();
  if (!invitedEmail) {
    showToast("Enter an email address to invite", "error");
    return;
  }

  showLoading(true);
  try {
    await apiPost("invitations.create", {groupId: selectedGroupId, invitedEmail});
    if (input) input.value = "";
    showToast(`Invitation sent to ${invitedEmail}`, "success");
    await loadInvitations();
  } catch (error) {
    handleApiError(error, "Failed to send invitation");
  } finally {
    showLoading(false);
  }
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

    const groupSelect = document.getElementById("groupSelector") || document.getElementById("groupSelect");
    if (groupSelect) groupSelect.value = selectedGroupId;

    await loadInvitations();
  } catch (error) {
    handleApiError(error, "Failed to load groups");
  } finally {
    showLoading(false);
  }
}

function renderGroupOptions() {
  const groupSelect = document.getElementById("groupSelector") || document.getElementById("groupSelect");
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

// ── Load invitations for the selected group ─────────────────────────────────
async function loadInvitations() {
  if (!selectedGroupId) return;
  showLoading(true);
  try {
    const data = await apiGet("invitations.list", {groupId: selectedGroupId});
    allInvitations = Array.isArray(data && data.invitations) ? data.invitations : [];
    updateStats(allInvitations);
    filterAndDisplay();
  } catch (error) {
    handleApiError(error, "Failed to load invitations");
  } finally {
    showLoading(false);
  }
}

function updateStats(invitations) {
  const pending = invitations.filter((i) => i.status === "pending").length;
  const approved = invitations.filter((i) => i.status === "accepted").length;
  const rejected = invitations.filter((i) => i.status === "rejected").length;

  setText("pendingCount", pending);
  setText("approvedCount", approved);
  setText("rejectedCount", rejected);
}

function filterAndDisplay() {
  let filtered = allInvitations;
  if (currentFilter === "pending") {
    filtered = filtered.filter((i) => i.status === "pending");
  } else if (currentFilter === "approved") {
    filtered = filtered.filter((i) => i.status === "accepted");
  } else if (currentFilter === "rejected") {
    filtered = filtered.filter((i) => i.status === "rejected");
  }
  displayInvitations(filtered);
}

// ── Render ──────────────────────────────────────────────────────────────────
function displayInvitations(invitations) {
  const list = document.getElementById("pendingList");
  if (!list) return;
  list.textContent = "";

  if (invitations.length === 0) {
    const empty = el("div", "empty-state");
    const icon = el("div", "empty-state-icon");
    icon.textContent = "✅";
    const p = el("p", "empty-state-text");
    p.textContent = selectedGroupId
      ? `No ${currentFilter === "all" ? "" : currentFilter} invitations found.`
      : "Select a group to see its invitations.";
    empty.append(icon, p);
    list.appendChild(empty);
    return;
  }

  invitations.forEach((invitation) => list.appendChild(createInvitationCard(invitation)));
}

function createInvitationCard(invitation) {
  const statusClass = invitation.status === "accepted" ? "approved"
    : invitation.status === "rejected" ? "rejected" : "pending";
  const statusText = invitation.status === "accepted" ? "Accepted"
    : invitation.status === "rejected" ? "Rejected" : "Pending";

  const card = el("div", `registration-card ${statusClass}`);

  const header = el("div", "registration-header");
  const emailEl = el("div", "registration-code");
  emailEl.textContent = invitation.invitedEmail || "Unknown";
  const statusEl = el("div", `registration-status status-${statusClass}`);
  statusEl.textContent = statusText;
  header.append(emailEl, statusEl);

  const info = el("div", "registration-info");
  info.appendChild(infoRow("Invited", invitation.createdAt ? new Date(invitation.createdAt).toLocaleString() : "Unknown"));
  if (invitation.respondedAt) {
    info.appendChild(infoRow("Responded", new Date(invitation.respondedAt).toLocaleString()));
  }

  card.append(header, info);

  if (invitation.status === "pending") {
    const actions = el("div", "action-buttons");
    const note = el("p", "help-text");
    note.textContent = "Awaiting the invitee's own response — an admin cannot approve or reject on their behalf.";
    actions.appendChild(note);
    card.appendChild(actions);
  }

  return card;
}

function infoRow(label, value) {
  const row = el("div", "info-row");
  const l = el("span", "info-label");
  l.textContent = `${label}:`;
  const v = el("span", "info-value");
  v.textContent = value;
  row.append(l, v);
  return row;
}

// ── Self-registration approval — deferred, no endpoint exists (see header) ──
function approveSelfRegistration() {
  showToast(
    "Approving a self-registered signup isn't available yet — it needs a pending-registrations endpoint and a status column on users. Use Invite by Email or a join code instead.",
    "warning",
  );
}

function rejectSelfRegistration() {
  showToast(
    "Rejecting a self-registered signup isn't available yet — it needs a pending-registrations endpoint and a status column on users.",
    "warning",
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function showLoading(show) {
  const overlay = document.getElementById("spinner") || document.getElementById("loadingOverlay");
  if (!overlay) return;
  overlay.classList.toggle("hidden", !show);
}

/** Centralised ApiError handling: 401 -> login (already handled by requireSession). */
function handleApiError(error, fallback) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      window.location.replace("/login.html");
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
