/**
 * broadcast_notifications_sql.js — SQL port of broadcast_notifications.js
 * (ADMIN "send an announcement to the group" page): compose a broadcast,
 * list past broadcasts. Not wired into any page until cutover — see
 * BUILD_PLAN.md.
 *
 * ENDPOINT CONTRACT (verified by reading api/handlers/messages.php directly):
 *   groups.mine        -> via listMyGroups(); filtered to admin/senior_admin/
 *                         treasurer (BROADCAST_ADMIN_ROLES below) — a plain
 *                         member cannot reach create_broadcast() server-side
 *                         (require_role(groupId, MESSAGE_ADMIN_ROLES)) so the
 *                         selector must not offer a group where the caller
 *                         is a plain member.
 *   broadcasts.create   -> POST, {groupId, title, message}. EXACT body keys
 *                         per create_broadcast() — the server fans the
 *                         broadcast out to every ACTIVE member as a
 *                         notification in the same transaction. There is no
 *                         `type` or `recipients` column on the `broadcasts`
 *                         table and no recipient-subset parameter — every
 *                         broadcast goes to the whole active membership.
 *   broadcasts.list     -> GET, {groupId} -> {broadcasts:[{broadcastId,
 *                         groupId, title, message, createdBy, createdAt,
 *                         updatedAt}]}. Any member role may read (
 *                         MESSAGE_ANY_MEMBER_ROLES) but this page only ever
 *                         calls it for groups the caller administers.
 *
 * DEFERRED (toast + reported, never invented):
 *   - Message type / payment type / template auto-fill and the "recipients:
 *     admins only / members only" radio the Firebase original offered — the
 *     SQL `broadcasts` table has no `type` column and create_broadcast()
 *     takes no recipient-subset parameter; it always fans out to every
 *     ACTIVE member. Narrowing recipients or tagging a message type would
 *     need a schema/endpoint change this port must not invent. The compose
 *     form here is deliberately just title + message.
 *   - Scheduling/automating a broadcast for a future date — no endpoint.
 *   - Editing or deleting a sent broadcast — no endpoint.
 *   - CSV/PDF export of the broadcast history — no endpoint.
 *   - Per-recipient read receipts / recipient count on the list view —
 *     broadcasts.list returns no recipientsCount; the notifications fan-out
 *     is not exposed back to this page as an aggregate.
 *
 * If the target page still needs an admin/member-targeted reminder (rather
 * than a whole-group announcement), `reminders.send` exists
 * (POST, {groupId, recipient:'all'|'specific', uid?, subject, message}) and
 * sends both an in-app notification and an email — but that is a different
 * feature (a reminder) from "announce something to the group", so it is not
 * wired into this page's single compose form. Reported here so a future
 * task can add a second form if the page brief asks for reminders too.
 */

import {apiGet, apiPost, requireSession, listMyGroups, ApiError, redirectToLogin} from "./api.js";

const BROADCAST_ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];

let currentUser = null;
let adminGroups = [];
let currentGroupId = null;

const groupSelectorEl = () => document.getElementById("groupSelector");
const broadcastFormEl = () => document.getElementById("broadcastForm");
const recentBroadcastsEl = () => document.getElementById("recentBroadcasts");
const spinnerEl = () => document.getElementById("spinner");
const messageSubjectEl = () => document.getElementById("messageSubject");
const messageBodyEl = () => document.getElementById("messageBody");

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

function setupEventListeners() {
  document.querySelector(".page-back-btn")?.addEventListener("click", () => {
    window.location.href = "admin_dashboard.html";
  });

  broadcastFormEl()?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await sendBroadcast();
  });

  groupSelectorEl()?.addEventListener("change", async (e) => {
    currentGroupId = e.target.value;
    if (currentGroupId) {
      sessionStorage.setItem("selectedGroupId", currentGroupId);
      await loadRecentBroadcasts();
    }
  });

  // The Firebase original's messageType/paymentType/template controls drove
  // template auto-fill only — there is no server-side equivalent (see file
  // header DEFERRED). If those elements exist on the target page, hide the
  // template-only sections rather than wiring dead behaviour to them.
  const messageType = document.getElementById("messageType");
  const paymentTypeGroup = document.getElementById("paymentTypeGroup");
  const templateGroup = document.getElementById("templateGroup");
  const dueDateGroup = document.getElementById("dueDateGroup");
  if (messageType) {
    [paymentTypeGroup, templateGroup, dueDateGroup].forEach((group) => group?.classList.add("hidden"));
    showToast("Message templates and recipient targeting are not available yet — every broadcast goes to the whole group.", "info");
  }
}

async function loadAdminGroups() {
  showSpinner(true);
  try {
    const groups = await listMyGroups();
    adminGroups = groups.filter((g) => BROADCAST_ADMIN_ROLES.includes(g.myRole));

    const selector = groupSelectorEl();
    if (selector) {
      selector.textContent = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a group...";
      selector.appendChild(placeholder);

      adminGroups.forEach((group) => {
        const option = document.createElement("option");
        option.value = group.groupId || group.id;
        option.textContent = group.groupName || group.name || "Unnamed group";
        selector.appendChild(option);
      });
    }

    if (adminGroups.length === 0) {
      showToast("You are not an admin of any groups.", "warning");
      return;
    }

    const stored = sessionStorage.getItem("selectedGroupId") || localStorage.getItem("selectedGroupId");
    const match = adminGroups.find((g) => (g.groupId || g.id) === stored);
    const chosen = match || adminGroups[0];
    currentGroupId = chosen.groupId || chosen.id;
    if (selector) selector.value = currentGroupId;
    sessionStorage.setItem("selectedGroupId", currentGroupId);

    await loadRecentBroadcasts();
  } catch (error) {
    handleApiError(error, "Failed to load groups");
  } finally {
    showSpinner(false);
  }
}

async function sendBroadcast() {
  const title = messageSubjectEl()?.value.trim() || "";
  const message = messageBodyEl()?.value.trim() || "";
  const groupId = currentGroupId || groupSelectorEl()?.value || "";

  if (!groupId) {
    showToast("Please select a group first.", "error");
    return;
  }
  if (!title || !message) {
    showToast("Please fill in the title and message.", "error");
    return;
  }

  showSpinner(true);
  try {
    const data = await apiPost("broadcasts.create", {groupId, title, message});
    const count = data && typeof data.recipientsCount === "number" ?
        ` to ${data.recipientsCount} member(s)` : "";
    showToast(`Broadcast sent successfully${count}!`, "success");

    const form = broadcastFormEl();
    if (form) {
      form.reset();
      const selector = groupSelectorEl();
      if (selector) selector.value = groupId;
    }

    await loadRecentBroadcasts();
  } catch (error) {
    handleApiError(error, "Error sending broadcast");
  } finally {
    showSpinner(false);
  }
}

async function loadRecentBroadcasts() {
  const container = recentBroadcastsEl();
  if (!container) return;

  container.textContent = "";
  container.appendChild(emptyState("⏳", "Loading..."));

  if (!currentGroupId) {
    container.textContent = "";
    container.appendChild(emptyState("📢", "Select a group to view broadcasts."));
    return;
  }

  try {
    const data = await apiGet("broadcasts.list", {groupId: currentGroupId});
    const broadcasts = Array.isArray(data && data.broadcasts) ? data.broadcasts : [];

    container.textContent = "";

    if (broadcasts.length === 0) {
      container.appendChild(emptyState("📢", "No broadcasts yet"));
      return;
    }

    broadcasts.slice(0, 10).forEach((broadcast) => {
      container.appendChild(createBroadcastElement(broadcast));
    });
  } catch (error) {
    container.textContent = "";
    container.appendChild(emptyState("❌", "Error loading broadcasts"));
    handleApiError(error, "Error loading recent broadcasts");
  }
}

function createBroadcastElement(broadcast) {
  const div = el("div", "list-item");

  const info = el("div");
  info.style.flex = "1";

  const title = el("div", "list-item-title");
  title.textContent = broadcast.title || "No title";
  info.appendChild(title);

  const when = broadcast.createdAt ? new Date(broadcast.createdAt) : null;
  const dateStr = when && !Number.isNaN(when.getTime()) ?
      when.toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      }) :
      "N/A";

  const subtitle = el("div", "list-item-subtitle");
  subtitle.textContent = dateStr;
  info.appendChild(subtitle);

  const messagePreview = el("div", "list-item-message");
  messagePreview.textContent = broadcast.message || "";
  info.appendChild(messagePreview);

  div.appendChild(info);
  return div;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function emptyState(icon, text) {
  const wrap = el("div", "empty-state");
  const i = el("div", "empty-state-icon");
  i.textContent = icon;
  const p = el("p", "empty-state-text");
  p.textContent = text;
  wrap.append(i, p);
  return wrap;
}

function showSpinner(show) {
  const node = spinnerEl();
  if (node) node.classList.toggle("hidden", !show);
}

function handleApiError(error, fallback) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      redirectToLogin();
      return;
    }
    if (error.status === 403) {
      showToast("You do not have permission to do this.", "error");
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
  const toast = el("div", `toast toast-${type}`);
  const span = document.createElement("span");
  span.textContent = message;
  const close = el("button", "toast-close");
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
