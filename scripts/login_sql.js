/**
 * login_sql.js — SQL-backed twin of scripts/login.js.
 *
 * Same DOM contract as the Firebase original (same element IDs, same spinner
 * show/hide, same error/success rendering). Only the auth backend changes:
 * Firebase Auth + the Firestore user lookup are replaced by one call to the
 * PHP API via ./api.js.
 *
 * scripts/login.js is left intact as the rollback path — reverting is a one-line
 * change to login.html.
 */

import {login, ApiError, listMyGroups} from "./api.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Admin-equivalent roles decide the target dashboard, mirroring select_group_sql.js.
const ADMIN_ROLES = ["admin", "senior_admin", "treasurer"];

document.addEventListener("DOMContentLoaded", () => {
  const loginBtn = document.getElementById("loginBtn");
  const spinner = document.getElementById("spinner");
  const errorMessage = document.getElementById("errorMessage");
  const successMessage = document.getElementById("successMessage");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const loginForm = document.getElementById("loginForm");

  /** Show the loading overlay. */
  function showSpinner() {
    spinner.classList.remove("hidden");
  }

  /** Hide the loading overlay. */
  function hideSpinner() {
    spinner.classList.add("hidden");
  }

  /**
   * Build the error icon without innerHTML.
   * @return {!Element} The icon wrapper.
   */
  function buildErrorIcon() {
    const wrapper = document.createElement("div");
    wrapper.className = "error-icon";

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "10");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", "2");

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M12 8v4M12 16h.01");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");

    svg.appendChild(circle);
    svg.appendChild(path);
    wrapper.appendChild(svg);
    return wrapper;
  }

  /**
   * Render an error. Accepts a plain string or {title, message, suggestion}.
   * Every text node goes through textContent — never innerHTML.
   * @param {string|{title?: string, message?: string, suggestion?: string}} errorInfo
   */
  function displayError(errorInfo) {
    const info = typeof errorInfo === "string" ? {message: errorInfo} : (errorInfo || {});

    errorMessage.replaceChildren();

    const errorContainer = document.createElement("div");
    errorContainer.className = "error-container";

    const errorTitle = document.createElement("div");
    errorTitle.className = "error-title";
    errorTitle.textContent = info.title || "Error";

    const errorText = document.createElement("div");
    errorText.className = "error-text";
    errorText.textContent = info.message || "An unexpected error occurred.";

    if (info.suggestion) {
      const errorSuggestion = document.createElement("div");
      errorSuggestion.className = "error-suggestion";
      errorSuggestion.textContent = info.suggestion;
      errorContainer.appendChild(errorSuggestion);
    }

    errorContainer.appendChild(buildErrorIcon());
    errorContainer.appendChild(errorTitle);
    errorContainer.appendChild(errorText);
    errorMessage.appendChild(errorContainer);

    errorMessage.classList.remove("hidden");
    successMessage.classList.add("hidden");

    setTimeout(() => {
      errorMessage.replaceChildren();
      errorMessage.classList.add("hidden");
    }, 10000);
  }

  /**
   * Render a success message.
   * @param {string} message Text to show.
   */
  function displaySuccess(message) {
    successMessage.textContent = message;
    successMessage.classList.remove("hidden");
    errorMessage.classList.add("hidden");

    setTimeout(() => {
      successMessage.textContent = "";
      successMessage.classList.add("hidden");
    }, 5000);
  }

  /** Clear both message slots. */
  function clearMessages() {
    errorMessage.replaceChildren();
    errorMessage.classList.add("hidden");
    successMessage.textContent = "";
    successMessage.classList.add("hidden");
  }

  /**
   * @param {string} email Candidate email.
   * @return {boolean} True when it looks like an email address.
   */
  function validateEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  }

  /**
   * @param {string} password Candidate password.
   * @return {boolean} True when it meets the minimum length.
   */
  function validatePassword(password) {
    return password.length >= 6;
  }

  /**
   * Sign in against the PHP API.
   *
   * The API answers a GENERIC 401 for both a wrong password and an unknown
   * email, on purpose — so we show ONE generic message. The Firebase original
   * distinguished "Account Not Found" from "Incorrect Password", which leaked
   * which emails are registered. Those two branches are deliberately collapsed.
   *
   * @param {string} email User email.
   * @param {string} password User password.
   */
  async function handleLogin(email, password) {
    clearMessages();
    showSpinner();
    loginBtn.disabled = true;

    try {
      // The session cookie is set by this call. Nothing is stored client-side.
      await login(email, password);

      // Group-aware routing: resolve the caller's groups and land directly on
      // the right dashboard instead of an intermediate group-selection page.
      const groups = await listMyGroups();

      if (groups.length === 0) {
        displaySuccess("Login successful! Redirecting...");
        window.location.href = "pages/admin_registration.html";
        return;
      }

      const lastGroupId = localStorage.getItem("selectedGroupId");
      const target =
        groups.find((g) => g.groupId === lastGroupId) || groups[0];
      const role = ADMIN_ROLES.includes(target.myRole) ? "admin" : "user";

      localStorage.setItem("selectedGroupId", target.groupId);
      localStorage.setItem("userRole", role);
      sessionStorage.setItem("selectedGroupId", target.groupId);
      sessionStorage.setItem("userRole", role);

      displaySuccess("Login successful! Redirecting...");
      window.location.href =
        role === "admin" ?
          "pages/admin_dashboard.html" :
          "pages/user_dashboard.html";
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        displayError({
          title: "Login Failed",
          message: "Invalid email or password.",
          suggestion: "Please check your details and try again.",
        });
      } else if (error instanceof ApiError && error.status === 422) {
        displayError({
          title: "Check Your Details",
          message: error.message,
          suggestion: "Correct the highlighted details and try again.",
        });
      } else if (error instanceof ApiError && error.status === 0) {
        displayError({
          title: "Network Error",
          message: "Unable to connect to the server.",
          suggestion: "Check your internet connection and try again.",
        });
      } else {
        displayError({
          title: "Login Failed",
          message: "An unexpected error occurred during login.",
          suggestion: "Please try again. If the problem persists, contact support.",
        });
      }
      hideSpinner();
      loginBtn.disabled = false;
    }
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email")?.value.trim();
    const password = document.getElementById("password")?.value.trim();

    if (!email || !password) {
      displayError("Please enter both email and password.");
      return;
    }

    if (!validateEmail(email)) {
      displayError("Please enter a valid email address.");
      return;
    }

    if (!validatePassword(password)) {
      displayError("Password must be at least 6 characters long.");
      return;
    }

    await handleLogin(email, password);
  });

  /**
   * Forgot password.
   *
   * GAP: the SQL API exposes no password-reset endpoint yet. The link is kept in
   * place (the DOM contract is unchanged) but it cannot send a reset email. No
   * endpoint is invented here. Until one exists, tell the user how to proceed.
   */
  forgotPasswordLink.addEventListener("click", (e) => {
    e.preventDefault();
    displayError({
      title: "Password Reset Unavailable",
      message: "Password reset is not available yet on this sign-in method.",
      suggestion: "Please contact your group administrator to have your password reset.",
    });
  });
});
