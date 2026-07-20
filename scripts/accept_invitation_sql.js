/**
 * accept_invitation_sql.js — SQL port of accept_invitation.js. Traces to C5.
 *
 * MODEL CHANGE (recorded, not hidden): the Firebase page was a TOKEN-in-URL email
 * acceptance — an unauthenticated invitee clicked `?token=…`, saw the group, and
 * created an account + joined in one step. The SQL invitation design (migration
 * 003 + api/handlers/invitations.php) has NO token column and no expiry on an
 * invite; `invitations.respond` requires a SIGNED-IN caller whose session email
 * matches the invite, and there is no `invitations.mine` for an invitee to look up
 * their own pending invite by id. So the SQL-native join is the JOIN CODE, and the
 * caller must already be signed in — there is no endpoint that previews group
 * info from a bare code, so this page cannot show live group details before the
 * visitor accepts. It shows neutral copy instead, then redeems on click:
 *
 *   (must be signed in already)  →  click Accept  →  codes.redeem {code}
 *
 * The `?code=` (or legacy `?token=`) query param supplies the join code. No
 * data-bearing innerHTML — every message via textContent.
 */

import {apiPost, getSession, ApiError} from "./api.js";

let code = "";

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  code = params.get("code") || params.get("token") || "";

  const acceptBtn = document.getElementById("acceptBtn");

  if (!code) {
    showError("This invitation link is missing its join code. Ask your group admin to resend it.");
    if (acceptBtn) acceptBtn.disabled = true;
    return;
  }

  // No endpoint exists to preview group info from a bare code — show honest
  // neutral copy rather than a permanent "Loading..." or fabricated numbers.
  const groupName = document.getElementById("groupName");
  if (groupName) groupName.textContent = "You've been invited to a savings group";
  const groupDetails = document.querySelector(".group-details");
  if (groupDetails) groupDetails.classList.add("hidden");

  const existing = await getSession();
  if (!existing) {
    showError("Please sign in first, then reopen this invitation link to accept it.");
    if (acceptBtn) acceptBtn.disabled = true;
    return;
  }

  acceptBtn?.addEventListener("click", handleAccept);
});

async function handleAccept() {
  const acceptBtn = document.getElementById("acceptBtn");
  const spinner = document.getElementById("spinner");

  showError("");
  if (acceptBtn) acceptBtn.disabled = true;
  spinner?.classList.remove("hidden");

  try {
    const result = await apiPost("codes.redeem", {code});

    if (result && result.groupId) {
      sessionStorage.setItem("selectedGroupId", result.groupId);
    }

    // Populate the display fields if the redeem response happens to carry them.
    if (result) {
      const groupNameEl = document.getElementById("groupName");
      if (groupNameEl && result.groupName) groupNameEl.textContent = result.groupName;

      const memberCountEl = document.getElementById("memberCount");
      const contributionEl = document.getElementById("contribution");
      const hasCounts = result.memberCount != null || result.contribution != null;
      if (hasCounts) {
        if (memberCountEl && result.memberCount != null) memberCountEl.textContent = result.memberCount;
        if (contributionEl && result.contribution != null) contributionEl.textContent = result.contribution;
        document.querySelector(".group-details")?.classList.remove("hidden");
      }
    }

    setTimeout(() => {
      window.location.href = "user_dashboard.html";
    }, 1200);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        showError("Your session has expired. Please log in again, then reopen this link.");
      } else if (error.status === 409) {
        showError(error.message || "You have already used this code.");
      } else if (error.status === 404) {
        showError("This code is invalid or expired. Ask your group admin for a new one.");
      } else {
        showError(error.message || "Could not join the group. Please try again.");
      }
    } else {
      console.error("Join failed", error);
      showError("Could not join the group. Please try again.");
    }
    if (acceptBtn) acceptBtn.disabled = false;
    spinner?.classList.add("hidden");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function showError(message) {
  const err = document.getElementById("errorMessage");
  if (!err) return;
  err.textContent = message;
  if (message) {
    err.classList.remove("hidden");
  } else {
    err.classList.add("hidden");
  }
}
