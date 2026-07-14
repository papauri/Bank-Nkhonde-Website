/**
 * contacts_sql.js — SQL port of contacts.js (the group member directory / "call
 * or message an admin" page).
 *
 * Not wired into any page until the atomic cutover — see BUILD_PLAN.md,
 * deliverable C5.
 *
 * DATA MODEL (verified against api/handlers/members.php and
 * api/handlers/messages.php — do not re-guess these):
 *   - groups.mine        -> the caller's OWN groups (drives the group selector).
 *   - members.list       -> GET {groupId}. Returns groupId, uid, fullName,
 *     email, phone, whatsappNumber, profileImageUrl, role, status, joinedAt,
 *     invitedBy, seedMoneyPaid, monthlyContributionsCurrent, eligibleForLoan,
 *     createdAt, updatedAt. It does NOT return career, jobTitle, workplace,
 *     workAddress, address, dateOfBirth, gender, guarantor*, emergencyContact*,
 *     idType, idNumber — the Firebase original's "member details" view showed
 *     all of those; there is no members.update-adjacent read endpoint for them
 *     yet, so the details view here shows only the columns members.list
 *     actually returns and says so rather than printing "N/A" for 15 fields.
 *   - messages.create    -> POST {groupId, subject, body, priority}. ANY
 *     member of the group may open a ticket (require_role admits every group
 *     role). status is always 'open' and createdBy is always the session uid
 *     — never client-supplied. This is a GROUP support thread that every
 *     admin/senior_admin/treasurer of the group can see (via messages.list on
 *     the messages/inbox page) — there is no per-admin "to" address in the
 *     row, so "Message an admin" here really means "open a ticket the group's
 *     admins will see," same effective outcome as the Firebase version's
 *     admin-targeted notification, just not addressed to one specific uid.
 *
 * DEFERRED (toast only, no invented endpoint — see each function below):
 *   1. True peer-to-peer member -> ARBITRARY member messaging. The Firebase
 *      original let a member message ANY other member via a notification
 *      addressed at that member's uid. messages.create only opens a ticket
 *      visible to the group's admin roles (support-desk model); there is no
 *      member -> member direct channel. Restoring this needs a new endpoint,
 *      e.g. messages.direct (POST {groupId, toUid, subject, body}) writing to
 *      a table the recipient's inbox actually queries.
 *   2. Export / download the contact list. No endpoint returns a file, and
 *      inventing a client-side CSV of PII without a documented data-export
 *      policy is out of brief. Needs a members.export (or similar) endpoint.
 *
 * NO INNERHTML WITH USER OR DB DATA: every name/phone/email/address is
 * user- or admin-authored and goes through createElement + textContent. The
 * one innerHTML in this file is the static "&times;" entity on toast close
 * buttons.
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
let userGroups = [];
let currentGroupId = null;
let allMembers = [];
let messageTargetName = "";

// ── DOM element getters (IDs kept identical to the Firebase original so the
// existing markup binds at cutover) ─────────────────────────────────────────
const groupSelectorEl = () => document.getElementById("groupSelector");
const contactsListEl = () => document.getElementById("contactsList");
const searchBoxEl = () => document.getElementById("searchContacts");
const messageAdminModalEl = () => document.getElementById("messageAdminModal");
const messageAdminFormEl = () => document.getElementById("messageAdminForm");
const messageAdminRecipientEl = () => document.getElementById("messageAdminRecipient");
const messageAdminSubjectEl = () => document.getElementById("messageAdminSubject");
const messageAdminMessageEl = () => document.getElementById("messageAdminMessage");
const toastContainerEl = () => document.getElementById("toastContainer");

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  try {
    currentUser = await requireSession(); // redirects to login on 401
  } catch (error) {
    handleApiError(error, "Could not verify your session.");
    return;
  }
  await loadUserGroups();
});

function setupEventListeners() {
  groupSelectorEl()?.addEventListener("change", async (e) => {
    const groupId = e.target.value;
    if (groupId) {
      currentGroupId = groupId;
      sessionStorage.setItem("selectedGroupId", groupId);
      await loadMembers(groupId);
    } else {
      currentGroupId = null;
      allMembers = [];
      renderMembers([]);
    }
  });

  searchBoxEl()?.addEventListener("input", filterAndRender);

  messageAdminFormEl()?.addEventListener("submit", handleSendMessage);

  messageAdminModalEl()?.addEventListener("click", (e) => {
    if (e.target === messageAdminModalEl()) closeMessageModal();
  });
}

// ── Load the caller's groups ─────────────────────────────────────────────────
async function loadUserGroups() {
  try {
    userGroups = await listMyGroups();

    const selector = groupSelectorEl();
    if (selector) {
      selector.textContent = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a group...";
      selector.appendChild(placeholder);

      userGroups.forEach((group) => {
        const option = document.createElement("option");
        option.value = group.groupId || group.id;
        option.textContent = group.groupName || group.name || "Unnamed group";
        selector.appendChild(option);
      });

      const stored = sessionStorage.getItem("selectedGroupId");
      const match = userGroups.find((g) => (g.groupId || g.id) === stored);
      const chosen = match || userGroups[0];

      if (chosen) {
        currentGroupId = chosen.groupId || chosen.id;
        selector.value = currentGroupId;
        sessionStorage.setItem("selectedGroupId", currentGroupId);
        await loadMembers(currentGroupId);
      } else {
        renderEmptyContactsList("👥", "Select a group to view members");
      }
    }
  } catch (error) {
    handleApiError(error, "Failed to load your groups");
  }
}

// ── Load members for a group ─────────────────────────────────────────────────
async function loadMembers(groupId) {
  const list = contactsListEl();
  if (!list) return;

  try {
    const data = await apiGet("members.list", {groupId});
    allMembers = Array.isArray(data && data.members) ? data.members : [];

    // Sort: admins first, then by name — same ordering as the original.
    allMembers.sort((a, b) => {
      const aAdmin = a.role === "admin" || a.role === "senior_admin" || a.role === "treasurer";
      const bAdmin = b.role === "admin" || b.role === "senior_admin" || b.role === "treasurer";
      if (aAdmin && !bAdmin) return -1;
      if (bAdmin && !aAdmin) return 1;
      return (a.fullName || "").localeCompare(b.fullName || "");
    });

    filterAndRender();
  } catch (error) {
    handleApiError(error, "Error loading members");
    renderEmptyContactsList("❌", "Error loading members");
  }
}

// ── Filter (client-side search on name/phone/email) + render ───────────────
function filterAndRender() {
  const term = (searchBoxEl()?.value || "").toLowerCase().trim();
  let filtered = allMembers;

  if (term) {
    filtered = allMembers.filter((m) =>
      (m.fullName || "").toLowerCase().includes(term) ||
      (m.phone || "").toLowerCase().includes(term) ||
      (m.email || "").toLowerCase().includes(term) ||
      (m.whatsappNumber || "").toLowerCase().includes(term));
  }

  renderMembers(filtered);
}

function renderMembers(members) {
  const list = contactsListEl();
  if (!list) return;
  list.textContent = "";

  if (members.length === 0) {
    const message = allMembers.length > 0 ? "No members match your search" : "No members found";
    renderEmptyContactsList("👥", message);
    return;
  }

  members.forEach((member) => list.appendChild(createMemberCard(member)));
}

function renderEmptyContactsList(icon, text) {
  const list = contactsListEl();
  if (!list) return;
  list.textContent = "";
  list.appendChild(emptyState(icon, text));
}

function emptyState(icon, text) {
  const wrap = el("div", "empty-state");
  const iconEl = el("div", "empty-state-icon");
  iconEl.textContent = icon;
  const textEl = el("p", "empty-state-text");
  textEl.textContent = text;
  wrap.append(iconEl, textEl);
  return wrap;
}

// ── Member card ──────────────────────────────────────────────────────────────
function createMemberCard(member) {
  const card = el("div", "member-card");
  card.addEventListener("click", () => showMemberDetails(member));

  const isAdminRole = member.role === "admin" || member.role === "senior_admin" || member.role === "treasurer";
  const initials = member.fullName
    ? member.fullName.split(" ").map((n) => n[0]).join("").toUpperCase().substring(0, 2)
    : "??";

  // Header
  const header = el("div", "member-card-header");
  const avatar = el("div", "member-avatar");
  if (member.profileImageUrl) {
    const img = document.createElement("img");
    img.src = member.profileImageUrl;
    img.alt = member.fullName || "Member";
    avatar.appendChild(img);
  } else {
    const span = document.createElement("span");
    span.textContent = initials;
    avatar.appendChild(span);
  }

  const info = el("div", "member-info");
  const nameRow = el("div", "member-name-row");
  const nameEl = el("div", "member-name");
  nameEl.textContent = member.fullName || "Unknown";
  const badge = el("span", "member-badge");
  badge.style.cssText = isAdminRole
    ? "background: rgba(201, 162, 39, 0.12); color: #A68B1F;"
    : "background: rgba(5, 150, 105, 0.1); color: #047857;";
  badge.textContent = isAdminRole ? "Admin" : "Member";
  nameRow.append(nameEl, badge);

  const roleEl = el("div", "member-role");
  roleEl.textContent = isAdminRole ? "Administrator" : "Group Member";

  info.append(nameRow, roleEl);
  header.append(avatar, info);
  card.appendChild(header);

  // Contact details
  if (member.phone || member.email || member.whatsappNumber) {
    const contacts = el("div", "member-contacts");

    if (member.phone) {
      contacts.appendChild(contactRow("📞", () => {
        const a = document.createElement("a");
        a.href = `tel:${member.phone}`;
        a.textContent = member.phone;
        a.addEventListener("click", (e) => e.stopPropagation());
        return a;
      }));
    }
    if (member.email) {
      contacts.appendChild(contactRow("✉️", () => {
        const a = document.createElement("a");
        a.href = `mailto:${member.email}`;
        a.textContent = member.email;
        a.addEventListener("click", (e) => e.stopPropagation());
        return a;
      }));
    }
    if (member.whatsappNumber) {
      contacts.appendChild(contactRow("💬", () => {
        const digits = member.whatsappNumber.replace(/\D/g, "");
        const a = document.createElement("a");
        a.href = `https://wa.me/${digits}`;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = member.whatsappNumber;
        a.addEventListener("click", (e) => e.stopPropagation());
        return a;
      }));
    }
    card.appendChild(contacts);
  }

  // Actions
  const actions = el("div", "member-actions");

  if (isAdminRole && member.uid !== currentUser?.uid) {
    const msgBtn = el("button", "member-action-btn primary");
    msgBtn.textContent = "💬 Message";
    msgBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openMessageModal(member.fullName || "Admin");
    });
    actions.appendChild(msgBtn);
  } else if (!isAdminRole && member.uid !== currentUser?.uid) {
    // A plain member cannot message another plain member — messages.create
    // only opens a thread the group's admins see, not the target member. See
    // the DEFERRED note at the top of this file.
    const msgBtn = el("button", "member-action-btn");
    msgBtn.textContent = "💬 Message";
    msgBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showToast(
        "Direct member-to-member messaging isn't available yet — this needs a new messages.direct endpoint. You can message the group's admins instead.",
        "info",
      );
    });
    actions.appendChild(msgBtn);
  }

  if (member.phone) {
    const call = document.createElement("a");
    call.href = `tel:${member.phone}`;
    call.className = "member-action-btn";
    call.textContent = "📞 Call";
    call.addEventListener("click", (e) => e.stopPropagation());
    actions.appendChild(call);
  }
  if (member.whatsappNumber) {
    const digits = member.whatsappNumber.replace(/\D/g, "");
    const wa = document.createElement("a");
    wa.href = `https://wa.me/${digits}`;
    wa.target = "_blank";
    wa.rel = "noopener noreferrer";
    wa.className = "member-action-btn";
    wa.textContent = "💬 WhatsApp";
    wa.addEventListener("click", (e) => e.stopPropagation());
    actions.appendChild(wa);
  }
  if (member.email) {
    const mail = document.createElement("a");
    mail.href = `mailto:${member.email}`;
    mail.className = "member-action-btn";
    mail.textContent = "✉️ Email";
    mail.addEventListener("click", (e) => e.stopPropagation());
    actions.appendChild(mail);
  }

  card.appendChild(actions);
  return card;
}

function contactRow(icon, buildLink) {
  const row = el("div", "contact-item");
  const iconEl = el("div", "contact-icon");
  iconEl.textContent = icon;
  row.append(iconEl, buildLink());
  return row;
}

// ── Member details (only the columns members.list actually returns) ────────
function showMemberDetails(member) {
  const lines = [
    ["Name", member.fullName || "N/A"],
    ["Email", member.email || "N/A"],
    ["Phone", member.phone || "N/A"],
    ["WhatsApp", member.whatsappNumber || "N/A"],
    ["Role", member.role || "Member"],
    ["Status", member.status || "Active"],
    ["Joined", member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : "N/A"],
  ];
  const summary = lines.map(([label, value]) => `${label}: ${value}`).join(" | ");
  showToast(
    `${summary}. Career/guarantor/ID/emergency-contact fields aren't returned by this system yet.`,
    "info",
  );
}

// ── Message modal (member -> group's admins via messages.create) ──────────
function openMessageModal(recipientName) {
  if (!currentGroupId) {
    showToast("Select a group first", "error");
    return;
  }
  messageTargetName = recipientName;

  const recipientEl = messageAdminRecipientEl();
  if (recipientEl) recipientEl.textContent = recipientName;

  messageAdminFormEl()?.reset();

  const modal = messageAdminModalEl();
  if (modal) modal.style.display = "flex";
}

function closeMessageModal() {
  const modal = messageAdminModalEl();
  if (modal) modal.style.display = "none";
  messageTargetName = "";
}

async function handleSendMessage(e) {
  e.preventDefault();

  if (!currentGroupId) {
    showToast("Error: Group not selected", "error");
    return;
  }

  const subjectInput = messageAdminSubjectEl();
  const messageInput = messageAdminMessageEl();
  const submitBtn = messageAdminFormEl()?.querySelector('button[type="submit"]');

  if (!subjectInput || !messageInput) {
    showToast("Error: Form fields not found", "error");
    return;
  }

  const subject = subjectInput.value.trim();
  const body = messageInput.value.trim();

  if (!subject || !body) {
    showToast("Please fill in both subject and message", "error");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";
  }

  try {
    // No per-admin "to" address exists server-side — this opens a group
    // support ticket every admin/senior_admin/treasurer of the group can see.
    await apiPost("messages.create", {
      groupId: currentGroupId,
      subject,
      body,
      priority: "medium",
    });

    showToast("Message sent successfully!", "success");
    closeMessageModal();
  } catch (error) {
    handleApiError(error, "Error sending message. Please try again.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send Message";
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Centralised ApiError handling: 401 -> login (requireSession also covers the initial gate). */
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
  const container = toastContainerEl();
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
  close.setAttribute("aria-label", "Close");
  close.innerHTML = "&times;"; // static entity only, never user data
  close.addEventListener("click", () => toast.remove());

  toast.append(span, close);
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}
