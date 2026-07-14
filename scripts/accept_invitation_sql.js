/**
 * accept_invitation_sql.js — SQL port of accept_invitation.js. Traces to C5.
 *
 * MODEL CHANGE (recorded, not hidden): the Firebase page was a TOKEN-in-URL email
 * acceptance — an unauthenticated invitee clicked `?token=…`, saw the group, and
 * created an account + joined in one step. The SQL invitation design (migration
 * 003 + api/handlers/invitations.php) has NO token column and no expiry on an
 * invite; `invitations.respond` requires a SIGNED-IN caller whose session email
 * matches the invite, and there is no `invitations.mine` for an invitee to look up
 * their own pending invite by id. So the SQL-native join is the JOIN CODE:
 *
 *   register {email, fullName, password}  →  login  →  codes.redeem {code}
 *
 * This page implements exactly that. A `?code=` query param pre-fills the code.
 * (An email-token acceptance path would need an `invitations.mine` endpoint — see
 * BUILD_PLAN B22. Not built here.)
 *
 * register() does NOT open a session, so login() is called after it. No
 * data-bearing innerHTML — every message via textContent.
 */

import {apiPost, login, apiGet, getSession, ApiError} from "./api.js";

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const codeFromUrl = params.get("code") || params.get("token") || "";

  const loadingMessage = document.getElementById("loadingMessage");
  const invitationForm = document.getElementById("invitationForm");
  const form = document.getElementById("acceptInvitationForm");
  const submitBtn = document.getElementById("submitBtn");

  // Prefill the join code if present, and hide the loading state.
  const codeInput = document.getElementById("joinCode") || document.getElementById("invitationCode");
  if (codeInput && codeFromUrl) codeInput.value = codeFromUrl;

  if (loadingMessage) loadingMessage.style.display = "none";
  if (invitationForm) invitationForm.style.display = "block";

  // If already signed in, they only need the code — hide the account fields.
  const existing = await getSession();
  const alreadySignedIn = !!existing;
  if (alreadySignedIn) {
    ["fullName", "email", "password", "confirmPassword"].forEach((id) => {
      const el = document.getElementById(id);
      const group = el?.closest(".form-group") || el?.parentElement;
      if (group) group.style.display = "none";
    });
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    handleJoin(alreadySignedIn, submitBtn);
  });
});

async function handleJoin(alreadySignedIn, submitBtn) {
  const codeInput = document.getElementById("joinCode") || document.getElementById("invitationCode");
  const code = (codeInput?.value || "").trim();
  if (!code) {
    showError("Enter the join code you were given.");
    return;
  }

  const setBusy = (busy, label) => {
    if (!submitBtn) return;
    submitBtn.disabled = busy;
    if (label) submitBtn.textContent = label;
  };

  try {
    setBusy(true, "Joining…");

    if (!alreadySignedIn) {
      const fullName = valueOf("fullName");
      const email = valueOf("email");
      const password = valueOf("password");
      const confirmPassword = valueOf("confirmPassword");

      if (!fullName || !email || !password) {
        showError("Please fill in your name, email and password.");
        setBusy(false, "Create Account & Join Group");
        return;
      }
      if (password.length < 8) {
        showError("Password must be at least 8 characters long.");
        setBusy(false, "Create Account & Join Group");
        return;
      }
      if (password !== confirmPassword) {
        showError("Passwords do not match.");
        setBusy(false, "Create Account & Join Group");
        return;
      }

      // Register (no session yet), then log in to open one.
      try {
        await apiPost("register", {email, fullName, password});
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // Account already exists — try to log them in with what they typed, so
          // an existing user can still redeem the code from this page.
          showError("");
        } else {
          throw error;
        }
      }
      await login(email, password);

      // Best-effort: attach the phone if the form collected one (register doesn't).
      const phone = valueOf("phone");
      if (phone) {
        try {
          await apiPost("profile.update", {phone});
        } catch (e) { /* non-fatal — joining is what matters */ }
      }
    }

    // Redeem the code — this is the actual group join.
    const result = await apiPost("codes.redeem", {code});
    const groupName = (result && result.groupName) || "your group";

    if (result && (result.groupId)) {
      sessionStorage.setItem("selectedGroupId", result.groupId);
    }

    showSuccess(`Joined ${groupName}! Redirecting to your dashboard…`);
    setTimeout(() => {
      window.location.href = "user_dashboard.html";
    }, 1500);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        showError("That email is registered but the password didn't match. Log in first, then redeem the code.");
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
    setBusy(false, alreadySignedIn ? "Join Group" : "Create Account & Join Group");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function valueOf(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

function showError(message) {
  const err = document.getElementById("errorMessage");
  const ok = document.getElementById("successMessage");
  if (ok) ok.style.display = "none";
  if (err) {
    err.textContent = message;
    err.style.display = message ? "block" : "none";
  }
}

function showSuccess(message) {
  const err = document.getElementById("errorMessage");
  const ok = document.getElementById("successMessage");
  if (err) err.style.display = "none";
  if (ok) {
    ok.textContent = message;
    ok.style.display = "block";
  }
}
