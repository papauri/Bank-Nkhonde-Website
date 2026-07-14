/**
 * notifications-handler_sql.js — SQL port of notifications-handler.js.
 *
 * The shared notification bell + dropdown used across pages. Same public API as
 * the Firebase original, so callers change only their import path:
 *     initializeNotifications(userId, groupId)   (userId is accepted for
 *                                                 signature compatibility but is
 *                                                 NOT trusted — the server scopes
 *                                                 every query to the session user)
 *     cleanupNotifications()
 *
 * REALTIME → POLLING. Firestore's onSnapshot pushed new notifications live; MySQL
 * has no push channel, so the badge is refreshed by polling on an interval and on
 * tab-focus. Polling is paused while the tab is hidden (no point burning requests
 * on a backgrounded tab) and resumes on visibility. This is the one behavioural
 * difference from the original and it is deliberate — the alternative (SSE/websockets)
 * is not available on the shared PHP host.
 *
 * Endpoints: notifications.list / .read / .readAll / .dismiss
 * Security: the server scopes every notification query to the session user
 * (WHERE userId = :sessionUid) — an admin cannot read another member's inbox.
 * No data-bearing innerHTML: every notification's title/message is user- or
 * admin-authored, so it goes in via textContent only.
 */

import {apiGet, apiPost, ApiError} from "./api.js";

/** How often to refresh the unread badge while the tab is visible. */
const POLL_INTERVAL_MS = 60000;

let pollTimer = null;
let currentGroupId = null;
let visibilityHandler = null;
let notifications = [];

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Wire up the bell, dropdown, badge, and the polling refresh.
 * @param {string} _userId Ignored for scoping (the session decides); kept so the
 *     call sites from the Firebase original work unchanged.
 * @param {string} groupId The group whose notifications to show.
 */
export function initializeNotifications(_userId, groupId) {
  const notificationBtn = document.getElementById("notificationsBtn");
  if (!notificationBtn) return;

  currentGroupId = groupId;

  let dropdown = document.getElementById("notificationDropdown");
  if (!dropdown) {
    dropdown = createNotificationDropdown();
    if (notificationBtn.parentElement) {
      notificationBtn.parentElement.style.position = "relative";
      notificationBtn.parentElement.appendChild(dropdown);
    }
  }

  notificationBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains("show")) {
      closeDropdown(dropdown);
    } else {
      openDropdown(dropdown);
      loadNotifications();
    }
  });

  dropdown.querySelector("#notificationCloseBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeDropdown(dropdown);
  });

  dropdown.querySelector("#markAllReadBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    markAllRead();
  });

  document.addEventListener("click", (e) => {
    if (window.innerWidth > 768 &&
        !dropdown.contains(e.target) &&
        !notificationBtn.contains(e.target)) {
      closeDropdown(dropdown);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dropdown.classList.contains("show")) {
      closeDropdown(dropdown);
    }
  });

  refreshBadge();
  startPolling();
}

/** Stop polling and detach listeners. Call on page teardown. */
export function cleanupNotifications() {
  stopPolling();
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  notifications = [];
  currentGroupId = null;
}

// ── Polling (the onSnapshot replacement) ────────────────────────────────────
function startPolling() {
  stopPolling();

  // Don't poll a backgrounded tab; catch up immediately when it comes back.
  visibilityHandler = () => {
    if (document.hidden) {
      stopPolling();
    } else {
      refreshBadge();
      startPolling();
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);

  if (!document.hidden) {
    pollTimer = setInterval(refreshBadge, POLL_INTERVAL_MS);
  }
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ── Data ────────────────────────────────────────────────────────────────────
/** The server's authoritative unread count (scoped to the session user). */
let unreadCount = 0;

async function fetchNotifications() {
  if (!currentGroupId) return [];
  const data = await apiGet("notifications.list", {groupId: currentGroupId});
  // Trust the SERVER's unreadCount, not a client-side filter of the returned
  // page: the API counts the whole inbox (read=0, not dismissed, not expired),
  // so a filtered or paginated list would otherwise under-count the badge.
  unreadCount = Number(data && data.unreadCount) || 0;
  return Array.isArray(data && data.notifications) ? data.notifications : [];
}

async function refreshBadge() {
  try {
    notifications = await fetchNotifications();
    updateBadge();
  } catch (error) {
    // A background poll must never surface an error toast or spam the console
    // on every tick; a 401 means the session ended and the page gate handles it.
    if (!(error instanceof ApiError)) {
      console.error("Notification refresh failed", error);
    }
  }
}

function updateBadge() {
  const badge = document.getElementById("notificationBadge");
  if (!badge) return;

  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    badge.style.display = "";
    badge.classList.remove("hidden");
  } else {
    badge.textContent = "";
    badge.style.display = "none";
    badge.classList.add("hidden");
  }
}

/** Adjust the badge locally after a read/dismiss, without a full refetch. */
function decrementUnread(by = 1) {
  unreadCount = Math.max(0, unreadCount - by);
}

/** The API returns `read` as 0/1 (MySQL TINYINT) or a boolean. */
function isRead(n) {
  return n.read === true || Number(n.read) === 1;
}

async function loadNotifications() {
  const list = document.getElementById("notificationList");
  if (!list) return;

  list.textContent = "";
  list.appendChild(messageRow("Loading…"));

  try {
    notifications = await fetchNotifications();
    updateBadge();
    renderNotifications();
  } catch (error) {
    list.textContent = "";
    list.appendChild(messageRow(
      error instanceof ApiError && error.status === 401
        ? "Your session has expired."
        : "Could not load notifications.",
    ));
  }
}

function renderNotifications() {
  const list = document.getElementById("notificationList");
  if (!list) return;

  list.textContent = "";

  if (notifications.length === 0) {
    list.appendChild(messageRow("No notifications"));
    return;
  }

  notifications.forEach((n) => list.appendChild(createNotificationItem(n)));
}

// ── DOM (createElement + textContent throughout) ────────────────────────────
function createNotificationDropdown() {
  const dropdown = document.createElement("div");
  dropdown.id = "notificationDropdown";
  dropdown.className = "notification-dropdown";
  dropdown.style.display = "none";

  const header = document.createElement("div");
  header.className = "notification-header";

  const title = document.createElement("span");
  title.className = "notification-header-title";
  title.textContent = "Notifications";

  const actions = document.createElement("div");
  actions.className = "notification-header-actions";

  const markAll = document.createElement("button");
  markAll.id = "markAllReadBtn";
  markAll.className = "btn btn-ghost btn-sm";
  markAll.textContent = "Mark all read";

  const close = document.createElement("button");
  close.id = "notificationCloseBtn";
  close.className = "notification-close";
  close.setAttribute("aria-label", "Close notifications");
  close.innerHTML = "&times;"; // static entity, never user data

  actions.append(markAll, close);
  header.append(title, actions);

  const list = document.createElement("div");
  list.id = "notificationList";
  list.className = "notification-list";

  dropdown.append(header, list);
  return dropdown;
}

function createNotificationItem(n) {
  const item = document.createElement("div");
  item.className = `notification-item${isRead(n) ? "" : " unread"}`;

  const icon = document.createElement("div");
  icon.className = "notification-icon";
  icon.textContent = getNotificationIcon(n.type);

  const content = document.createElement("div");
  content.className = "notification-content";

  // Title and message are authored by admins/members — textContent, never innerHTML.
  const title = document.createElement("div");
  title.className = "notification-title";
  title.textContent = n.title || "Notification";

  const message = document.createElement("div");
  message.className = "notification-message";
  message.textContent = n.message || "";

  const time = document.createElement("div");
  time.className = "notification-time";
  time.textContent = n.createdAt ? getTimeAgo(new Date(n.createdAt)) : "";

  content.append(title, message, time);

  const dismiss = document.createElement("button");
  dismiss.className = "notification-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss notification");
  dismiss.innerHTML = "&times;"; // static entity
  dismiss.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissNotification(n.notificationId);
  });

  item.append(icon, content, dismiss);

  item.addEventListener("click", () => openNotification(n));

  return item;
}

function messageRow(text) {
  const row = document.createElement("div");
  row.className = "notification-empty";
  row.textContent = text;
  return row;
}

// ── Actions ─────────────────────────────────────────────────────────────────
async function openNotification(n) {
  if (!isRead(n)) {
    try {
      await apiPost("notifications.read", {notificationId: n.notificationId});
      n.read = 1;
      decrementUnread(1);
      updateBadge();
      renderNotifications();
    } catch (error) {
      console.error("Could not mark notification read", error);
    }
  }

  if (n.link) {
    window.location.href = n.link;
  }
}

async function markAllRead() {
  if (!currentGroupId) return;
  try {
    await apiPost("notifications.readAll", {groupId: currentGroupId});
    notifications.forEach((n) => {
      n.read = 1;
    });
    unreadCount = 0;
    updateBadge();
    renderNotifications();
  } catch (error) {
    console.error("Could not mark all read", error);
  }
}

async function dismissNotification(notificationId) {
  try {
    await apiPost("notifications.dismiss", {notificationId});
    // The server excludes dismissed rows from the unread count, so dismissing an
    // UNREAD one must drop the badge too — otherwise it would show a count for a
    // notification no longer in the list.
    const target = notifications.find((n) => n.notificationId === notificationId);
    if (target && !isRead(target)) decrementUnread(1);

    notifications = notifications.filter((n) => n.notificationId !== notificationId);
    updateBadge();
    renderNotifications();
  } catch (error) {
    console.error("Could not dismiss notification", error);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function openDropdown(dropdown) {
  dropdown.classList.add("show");
  dropdown.style.display = "block";
  dropdown.style.opacity = "1";
  dropdown.style.visibility = "visible";
}

function closeDropdown(dropdown) {
  dropdown.classList.remove("show");
  dropdown.style.display = "none";
  dropdown.style.opacity = "0";
  dropdown.style.visibility = "hidden";
  document.body.style.overflow = "";
}

function getNotificationIcon(type) {
  const icons = {
    loan_approved: "✅",
    loan_rejected: "❌",
    loan_disbursed: "💰",
    loan_repaid: "🎉",
    payment_approved: "✅",
    payment_rejected: "❌",
    payment_reminder: "⏰",
    reminder: "⏰",
    broadcast: "📢",
    message: "💬",
  };
  return icons[type] || "🔔";
}

function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}
