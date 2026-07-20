/**
 * messages_sql.js — SQL port of messages.js (the member/admin "inbox" page).
 *
 * Not wired into any page until the cutover — see BUILD_PLAN.md, deliverable C5.
 *
 * WHAT CHANGED FROM THE FIREBASE ORIGINAL (read this before touching anything):
 *
 * The Firebase version read straight out of `groups/{groupId}/notifications`
 * and, in the same file, called Firestore updateDoc()/addDoc() to approve or
 * reject loans and payments from inside the message modal. In the SQL API
 * those are TWO SEPARATE DOMAINS with their own endpoints and their own pages
 * (manage_loans.php / manage_payments.php via loans.approve, payments.approve,
 * etc.) — this file has no brief to touch them and does not invent a client
 * bypass. See the DEFERRED section below for exactly what that drops and what
 * endpoint would need to be wired to restore it.
 *
 * DATA MODEL (verified against api/handlers/messages.php and
 * api/handlers/notifications.php — do not re-guess these):
 *   - notifications.list  -> GET, optional {groupId}. The caller's OWN inbox,
 *     scoped server-side to `userId = :uid` (never overridable). Without a
 *     groupId it returns the WHOLE inbox across every group the caller is in —
 *     that single call replaces the original's per-group notification loop.
 *     Each row already carries read/dismissed/createdAt/type/groupName, so it
 *     is the only source that has genuine per-item read state. Broadcasts are
 *     already fanned out into this table (type: 'broadcast') by
 *     broadcasts.create server-side — there is no separate broadcast fetch
 *     needed to see them here.
 *   - notifications.read / .readAll / .dismiss -> POST. Ownership-gated in
 *     SQL (`AND userId = :uid`); a 404 on miss whether the row doesn't exist or
 *     isn't the caller's, by design (never distinguish the two).
 *   - messages.list -> GET, {groupId}. The group's SUPPORT TICKETS. A plain
 *     member sees only threads THEY created; an admin/senior_admin/treasurer
 *     sees the whole queue. Every group the caller belongs to is queried in
 *     turn (the endpoint has no cross-group form). These threads have NO per-
 *     item read flag in the schema — this file approximates "unread" as
 *     status === 'open' (a ticket nobody has triaged yet), which is a display
 *     heuristic only, never sent back to the server as a real read state.
 *   - messages.update (status/priority/assignedTo) is ADMIN-LEVEL ONLY,
 *     enforced server-side. This file does not attempt it — no triage UI in
 *     the original messages.js to port, and inventing one is out of brief.
 *
 * NO INNERHTML WITH USER DATA: every title/message/subject/body/sender name is
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
  redirectToLogin,
} from "./api.js";

// ── Global state ────────────────────────────────────────────────────────────
let currentUser = null;
let userGroups = [];
let allMessages = [];
let currentFilter = "all";
let selectedGroupIdForActions = "";

const ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];

// ── DOM elements (IDs/classes kept identical to the Firebase original) ──────
const spinner = () => document.getElementById("spinner");
const groupSelector = () => document.getElementById("groupSelector");
const messagesList = () => document.getElementById("messagesList");
const messageModal = () => document.getElementById("messageModal");
const modalTitle = () => document.getElementById("modalTitle");
const modalMeta = () => document.getElementById("modalMeta");
const modalText = () => document.getElementById("modalText");
const closeModalBtn = () => document.getElementById("closeModal");
const markAllReadBtn = () => document.getElementById("markAllReadBtn");
const toastContainer = () => document.getElementById("toastContainer");
const modalActions = () => document.getElementById("modalActions");
const showReadBtn = () => document.getElementById("showReadBtn");

// ── Init ─────────────────────────────────────────────────────────────────────
export async function init() {
  setupEventListeners();
  try {
    currentUser = await requireSession(); // redirects to login on 401
  } catch (error) {
    handleApiError(error, "Could not verify your session.");
    return;
  }
  await loadUserGroups();
  await loadMessages();
}
if (!window.__bnSpa) {
  document.addEventListener("DOMContentLoaded", () => { init(); });
}

function setupEventListeners() {
  groupSelector()?.addEventListener("change", () => filterMessages());

  document.querySelectorAll(".action-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".action-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter || "all";
      filterMessages();
    });
  });

  closeModalBtn()?.addEventListener("click", () => hideMessageModal());

  messageModal()?.addEventListener("click", (e) => {
    if (e.target === messageModal()) hideMessageModal();
  });

  markAllReadBtn()?.addEventListener("click", markAllAsRead);

  // Present in the original markup but no longer meaningful now that "Read" is
  // its own filter tab; kept hidden rather than removed (see filterMessages()).
  showReadBtn()?.addEventListener("click", () => {});
}

function hideMessageModal() {
  messageModal()?.classList.remove("active");
  const actions = modalActions();
  if (actions) actions.textContent = "";
}

// ── Load groups the caller belongs to ───────────────────────────────────────
async function loadUserGroups() {
  try {
    userGroups = await listMyGroups();

    const selector = groupSelector();
    if (selector) {
      selector.textContent = "";
      const allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = "All Groups";
      selector.appendChild(allOption);

      const sessionGroupId = sessionStorage.getItem("selectedGroupId");
      userGroups.forEach((group) => {
        const groupId = group.groupId || group.id;
        const option = document.createElement("option");
        option.value = groupId;
        option.textContent = group.groupName || group.name || "Unnamed group";
        if (sessionGroupId === groupId) option.selected = true;
        selector.appendChild(option);
      });
    }
  } catch (error) {
    handleApiError(error, "Failed to load your groups");
  }
}

// ── Load messages (notifications inbox + support tickets, merged) ──────────
async function loadMessages() {
  showSpinner(true);
  try {
    const [notifications, threads] = await Promise.all([
      loadNotificationsInbox(),
      loadSupportThreads(),
    ]);

    allMessages = [...notifications, ...threads];
    allMessages.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    filterMessages();
  } catch (error) {
    handleApiError(error, "Error loading messages");
    const list = messagesList();
    if (list) {
      list.textContent = "";
      list.appendChild(emptyState("❌", "Error loading messages"));
    }
  } finally {
    showSpinner(false);
  }
}

/** One call covers every group the caller is in — no per-group loop needed. */
async function loadNotificationsInbox() {
  try {
    const data = await apiGet("notifications.list", {});
    const rows = Array.isArray(data && data.notifications) ? data.notifications : [];
    return rows.map((n) => ({
      kind: "notification",
      id: n.notificationId,
      groupId: n.groupId,
      groupName: n.groupName || "Unknown Group",
      title: n.title || "Notification",
      body: n.message || "",
      type: n.type || "info",
      read: n.read === true,
      senderName: n.senderName || "",
      createdAt: n.createdAt,
      loanId: n.loanId || "",
      paymentId: n.paymentId || "",
      paymentType: n.paymentType || "",
      amount: n.amount,
    }));
  } catch (error) {
    console.error("Error loading notifications:", error);
    return [];
  }
}

/**
 * Support tickets have no per-item read flag in the schema. `status === 'open'`
 * is used as a display-only "unread" heuristic — it is never written back.
 */
async function loadSupportThreads() {
  const results = await Promise.all(
    userGroups.map(async (group) => {
      const groupId = group.groupId || group.id;
      try {
        const data = await apiGet("messages.list", {groupId});
        const rows = Array.isArray(data && data.messages) ? data.messages : [];
        return rows.map((m) => ({
          kind: "thread",
          id: m.messageId,
          groupId: m.groupId,
          groupName: group.groupName || group.name || "Unknown Group",
          title: m.subject || "Support ticket",
          body: m.body || "",
          type: "user_message",
          read: m.status !== "open",
          senderName: m.createdByName || "",
          createdAt: m.updatedAt || m.createdAt,
          status: m.status,
          priority: m.priority,
        }));
      } catch (error) {
        // A 403 here would mean require_role rejected the caller for this
        // group (shouldn't happen for a group they belong to) — skip it
        // rather than blow up the whole inbox load.
        console.error(`Error loading messages for group ${groupId}:`, error);
        return [];
      }
    }),
  );
  return results.flat();
}

// ── Filtering / rendering ────────────────────────────────────────────────────
function filterMessages() {
  const list = messagesList();
  if (!list) return;

  const selectedGroupId = groupSelector()?.value || "";
  selectedGroupIdForActions = selectedGroupId;

  let filtered = allMessages;

  if (selectedGroupId) {
    filtered = filtered.filter((m) => m.groupId === selectedGroupId);
  }

  if (currentFilter === "unread") {
    filtered = filtered.filter((m) => !m.read);
  } else if (currentFilter === "read") {
    filtered = filtered.filter((m) => m.read);
  } else if (currentFilter !== "all") {
    filtered = filtered.filter((m) => matchesTypeFilter(m, currentFilter));
  }

  const unreadCount = allMessages.filter((m) => !m.read).length;
  const markAllBtn = markAllReadBtn();
  if (markAllBtn) markAllBtn.style.display = unreadCount > 0 && currentFilter !== "read" ? "block" : "none";

  const showRead = showReadBtn();
  if (showRead) showRead.style.display = "none";

  list.textContent = "";

  if (filtered.length === 0) {
    let emptyMessage = "No messages found";
    if (currentFilter === "unread") emptyMessage = "No unread messages";
    else if (currentFilter === "read") emptyMessage = "No read messages";
    list.appendChild(emptyState("📬", emptyMessage));
    return;
  }

  filtered.sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  filtered.forEach((message) => list.appendChild(createMessageElement(message)));
}

/** Same keyword-matching approach as the Firebase original, applied to the
 * SQL fields (title/body/type) instead of Firestore's title/message/type. */
function matchesTypeFilter(message, filter) {
  const type = (message.type || "").toLowerCase();
  const paymentType = (message.paymentType || "").toLowerCase();
  const title = (message.title || "").toLowerCase();
  const body = (message.body || "").toLowerCase();

  switch (filter) {
    case "loan":
      return type.includes("loan") || title.includes("loan") || body.includes("loan");
    case "payment":
      return type.includes("payment") || Boolean(paymentType) || title.includes("payment") || body.includes("payment");
    case "seed_money":
      return type.includes("seed") || paymentType.includes("seed") || title.includes("seed") || body.includes("seed money");
    case "monthly":
      return type.includes("monthly") || paymentType.includes("monthly") || title.includes("monthly") || body.includes("monthly");
    case "loan_booking":
      return type === "loan_booking" || title.includes("loan booking");
    case "other": {
      const isBroadcast = type === "info" || type === "warning" || type === "error" || type === "success" || type === "broadcast";
      if (isBroadcast) return true;
      if (type === "user_message") return true;
      if (type.includes("loan")) return false;
      if ((type.includes("payment") || paymentType) && !isBroadcast) {
        if (type === "payment_upload" || type === "payment_approved" || type === "payment_rejected") return false;
      }
      if (type.includes("seed") || paymentType.includes("seed")) return false;
      if (type.includes("monthly") || paymentType.includes("monthly")) return false;
      return true;
    }
    default:
      return true;
  }
}

const TYPE_BADGE_CLASS = {
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
  urgent: "danger",
  reminder: "warning",
  broadcast: "info",
  user_message: "info",
};

function createMessageElement(message) {
  const div = document.createElement("div");
  div.className = `message-item ${message.read ? "read" : "unread"}`;
  div.addEventListener("click", () => openMessage(message));

  const header = document.createElement("div");
  header.className = "message-header";

  const infoWrap = document.createElement("div");
  infoWrap.style.flex = "1";

  const titleEl = document.createElement("h3");
  titleEl.className = "message-title";
  titleEl.textContent = message.title || "No title";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  appendMetaSpan(meta, message.groupName || "Unknown Group");
  appendMetaSpan(meta, "•");
  appendMetaSpan(meta, formatDateTime(message.createdAt));
  if (message.senderName) {
    appendMetaSpan(meta, "•");
    appendMetaSpan(meta, `From: ${message.senderName}`);
  }

  infoWrap.append(titleEl, meta);
  header.appendChild(infoWrap);

  const actionsWrap = document.createElement("div");
  actionsWrap.style.display = "flex";
  actionsWrap.style.alignItems = "center";
  actionsWrap.style.gap = "var(--bn-space-2)";

  const badge = document.createElement("span");
  badge.className = `message-type-badge ${TYPE_BADGE_CLASS[message.type] || "info"}`;
  badge.textContent = message.type || "info";
  actionsWrap.appendChild(badge);

  // Dismiss (soft-hide) is only backed by an endpoint for notifications; a
  // support ticket has no delete/dismiss endpoint at all — see DEFERRED note.
  if (message.kind === "notification") {
    const dismissBtn = document.createElement("button");
    dismissBtn.className = "btn btn-ghost btn-sm";
    dismissBtn.style.padding = "4px 8px";
    dismissBtn.style.minWidth = "auto";
    dismissBtn.title = "Dismiss message";
    dismissBtn.textContent = "🗑️";
    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleDismissMessage(message);
    });
    actionsWrap.appendChild(dismissBtn);
  }

  header.appendChild(actionsWrap);
  div.appendChild(header);

  const bodyEl = document.createElement("div");
  bodyEl.className = "message-body";
  const bodyText = message.body || "";
  bodyEl.textContent = bodyText.length > 150 ? `${bodyText.substring(0, 150)}...` : bodyText;
  div.appendChild(bodyEl);

  return div;
}

function appendMetaSpan(container, text) {
  const span = document.createElement("span");
  span.textContent = text;
  container.appendChild(span);
}

// ── Open / read ──────────────────────────────────────────────────────────────
async function openMessage(message) {
  if (message.kind === "notification" && !message.read) {
    try {
      await apiPost("notifications.read", {notificationId: message.id});
      message.read = true;
    } catch (error) {
      console.error("Error marking message as read:", error);
    }
  }

  const titleEl = modalTitle();
  if (titleEl) titleEl.textContent = message.title || "Message";

  const textEl = modalText();
  if (textEl) textEl.textContent = message.body || "No message content";

  const meta = modalMeta();
  if (meta) {
    meta.textContent = "";
    meta.appendChild(metaRow("Group", message.groupName || "Unknown"));
    if (message.senderName) meta.appendChild(metaRow("From", message.senderName));
    meta.appendChild(metaRow("Date", formatDateTime(message.createdAt, true)));
    meta.appendChild(metaRow("Type", message.type || "info"));
    if (message.loanId) meta.appendChild(metaRow("Loan ID", message.loanId));
    if (message.paymentId) meta.appendChild(metaRow("Payment ID", message.paymentId));
    if (message.kind === "thread" && message.status) meta.appendChild(metaRow("Status", message.status));
    if (message.kind === "thread" && message.priority) meta.appendChild(metaRow("Priority", message.priority));
  }

  const actions = modalActions();
  if (actions) {
    actions.textContent = "";
    buildModalActions(message, actions);
  }

  messageModal()?.classList.add("active");
  filterMessages();
}

function metaRow(label, value) {
  const row = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  row.appendChild(strong);
  row.appendChild(document.createTextNode(String(value)));
  return row;
}

/**
 * Approve/reject/cancel actions on loans and payments are DEFERRED — see the
 * file header. Rather than a dead-end toast, this points the admin at the
 * page that actually owns the action.
 */
function buildModalActions(message, actions) {
  const type = (message.type || "").toLowerCase();
  const title = (message.title || "").toLowerCase();
  const isLoanRelated = message.loanId || type.includes("loan") || title.includes("loan booking");
  const isPaymentRelated = message.paymentId || type.includes("payment") || Boolean(message.paymentType);

  if (message.kind === "thread") {
    const note = document.createElement("p");
    note.style.fontSize = "var(--bn-text-sm)";
    note.style.color = "var(--bn-gray)";
    note.textContent = "Replying to a support ticket isn't available from this inbox yet.";
    actions.appendChild(note);
    return;
  }

  if (isLoanRelated) {
    const btn = document.createElement("button");
    btn.className = "btn btn-secondary";
    btn.textContent = "Go to Manage Loans";
    btn.addEventListener("click", () => {
      window.location.href = "../pages/manage_loans.html";
    });
    actions.appendChild(btn);
  } else if (isPaymentRelated) {
    const btn = document.createElement("button");
    btn.className = "btn btn-secondary";
    btn.textContent = "Go to Manage Payments";
    btn.addEventListener("click", () => {
      window.location.href = "../pages/manage_payments.html";
    });
    actions.appendChild(btn);
  }
}

// ── Dismiss (the delete replacement for notifications) ─────────────────────
async function handleDismissMessage(message) {
  if (message.kind !== "notification") {
    showToast("Support tickets cannot be deleted or dismissed — there is no endpoint for that yet.", "info");
    return;
  }

  showSpinner(true);
  try {
    await apiPost("notifications.dismiss", {notificationId: message.id});
    allMessages = allMessages.filter((m) => !(m.kind === "notification" && m.id === message.id));
    filterMessages();
    showToast("Message dismissed", "success");
  } catch (error) {
    handleApiError(error, "Error dismissing message");
  } finally {
    showSpinner(false);
  }
}

// ── Mark all as read ─────────────────────────────────────────────────────────
async function markAllAsRead() {
  showSpinner(true);
  try {
    const groupId = groupSelector()?.value || undefined;
    const data = await apiPost("notifications.readAll", groupId ? {groupId} : {});
    allMessages.forEach((m) => {
      if (m.kind === "notification" && (!groupId || m.groupId === groupId)) {
        m.read = true;
      }
    });
    filterMessages();
    const updated = Number(data && data.updated) || 0;
    showToast(`Marked ${updated} message(s) as read`, "success");
  } catch (error) {
    handleApiError(error, "Error marking messages as read");
  } finally {
    showSpinner(false);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function emptyState(icon, text) {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  const iconEl = document.createElement("div");
  iconEl.className = "empty-state-icon";
  iconEl.textContent = icon;
  const textEl = document.createElement("p");
  textEl.className = "empty-state-text";
  textEl.textContent = text;
  wrap.append(iconEl, textEl);
  return wrap;
}

function formatDateTime(value, long = false) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: long ? "long" : "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showSpinner(show) {
  const node = spinner();
  if (node) node.classList.toggle("hidden", !show);
}

/** Centralised ApiError handling: 401 -> login (requireSession also covers the initial gate). */
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
  const container = toastContainer();
  if (!container) {
    console.log(`[${type}] ${message}`);
    return;
  }

  const typeMap = {success: "success", error: "danger", warning: "warning", info: "info"};
  const icons = {success: "✓", error: "✕", warning: "⚠", info: "ℹ"};
  const cssType = typeMap[type] || "info";

  const toast = document.createElement("div");
  toast.className = `toast ${cssType}`;

  const iconEl = document.createElement("div");
  iconEl.className = "toast-icon";
  iconEl.textContent = icons[type] || icons.info;

  const content = document.createElement("div");
  content.className = "toast-content";
  const messageEl = document.createElement("div");
  messageEl.className = "toast-message";
  messageEl.textContent = message;
  content.appendChild(messageEl);

  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.innerHTML = "&times;"; // static entity, never user data
  closeBtn.addEventListener("click", () => toast.remove());

  toast.append(iconEl, content, closeBtn);
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("exiting");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
