/**
 * registration_sql.js — SQL port of scripts/registration.js. Traces to C5.
 *
 * MODEL CHANGE (recorded, not hidden): the Firebase original was a single
 * Firestore batch write that created the auth user, the group document (with a
 * deeply nested `rules` object), the member doc, the user doc, and a full year
 * of per-member payment documents — gated behind a senior-admin "approval code"
 * poll (`createInvitationCode` / `pollForApproval`). None of that exists in the
 * SQL API. The SQL-native flow is four separate calls:
 *
 *   register {email, fullName, password}
 *     -> login {email, password}                 (register() opens no session)
 *     -> profile.update {phone}                    (best-effort, non-fatal)
 *     -> groups.create {groupName, description}    (also inserts senior_admin membership)
 *     -> rules.update {groupId, ...whitelisted money fields}  (only if the form
 *                                                    collected any of them)
 *
 * There is no approval-code wait step — group creation is immediate for the
 * creator, same as accept_invitation_sql.js's join flow. No emails are sent
 * (register() sends nothing) and no per-member payment schedule rows are
 * pre-created (that table/endpoint does not exist yet in the SQL layer).
 *
 * No data-bearing innerHTML — every message via textContent/createElement.
 * scripts/registration.js is left intact as the rollback path.
 */

import {apiPost, login, ApiError} from "./api.js";

document.addEventListener("DOMContentLoaded", () => {
  const registrationForm = document.getElementById("registrationForm");
  const phoneInput = document.getElementById("phone");
  const loadingOverlay = document.getElementById("spinner");
  const loadingMessage = document.getElementById("loadingText");
  const formFields = registrationForm
    ? registrationForm.querySelectorAll("input, button")
    : [];

  // intl-tel-input is a client-only UI widget (no backend dependency) — keep it.
  let iti;
  function initializeIntlTelInput() {
    if (!phoneInput) return;
    if (typeof window.intlTelInput !== "undefined") {
      iti = window.intlTelInput(phoneInput, {
        initialCountry: "mw",
        preferredCountries: ["mw", "us", "gb", "za", "tz", "zm"],
        separateDialCode: true,
        utilsScript: "https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/js/utils.min.js",
        allowDropdown: true,
        nationalMode: false,
      });
    } else {
      setTimeout(initializeIntlTelInput, 100);
    }
  }
  if (phoneInput) setTimeout(initializeIntlTelInput, 100);

  /**
   * Show/hide the loading overlay. Multi-line messages are rendered as
   * separate text nodes/line breaks built via the DOM — never innerHTML.
   * @param {boolean} show Whether to show the overlay.
   * @param {string} message Status text (may contain \n for line breaks).
   */
  function toggleLoadingOverlay(show = true, message = "Processing... Please wait.") {
    if (loadingMessage) {
      loadingMessage.replaceChildren();
      const lines = String(message).split("\n");
      lines.forEach((line, i) => {
        if (i > 0) loadingMessage.appendChild(document.createElement("br"));
        loadingMessage.appendChild(document.createTextNode(line));
      });
    }
    if (loadingOverlay) {
      loadingOverlay.classList.toggle("show", show);
      loadingOverlay.classList.toggle("hidden", !show);
    }
    document.body.style.pointerEvents = show ? "none" : "auto";
  }

  /**
   * @param {boolean} enable Whether to enable (true) or disable (false) inputs.
   */
  function toggleFormFields(enable = true) {
    formFields.forEach((field) => (field.disabled = !enable));
  }

  /**
   * Render text into an element via textContent, never innerHTML.
   * @param {?Element} el Target element.
   * @param {string} text Text to set.
   */
  function setText(el, text) {
    if (el) el.textContent = text;
  }

  /**
   * Success modal, ported 1:1 in behaviour but text-only (no innerHTML).
   * @param {string} title Modal title.
   * @param {string} message Modal body text.
   * @param {string} [buttonText] Button label.
   * @param {?Function} [onClose] Callback run after the modal closes.
   */
  function showSuccessDialog(title, message, buttonText = "OK", onClose = null) {
    const successModal = document.getElementById("successModal");
    const successModalTitle = document.getElementById("successModalTitle");
    const successModalMessage = document.getElementById("successModalMessage");
    const successModalButton = document.getElementById("successModalButton");

    if (!successModal || !successModalTitle || !successModalMessage || !successModalButton) {
      // No alert() fallback — surface via the plain error slot instead.
      setText(document.getElementById("errorMessage"), `${title}: ${message}`);
      document.getElementById("errorMessage")?.classList.remove("hidden");
      if (typeof onClose === "function") onClose();
      return;
    }

    document.body.style.pointerEvents = "auto";
    const titleSpan = successModalTitle.querySelector("span:last-child");
    if (titleSpan) setText(titleSpan, title);
    else setText(successModalTitle, title);

    setText(successModalMessage, message);
    setText(successModalButton, buttonText);
    successModalButton.disabled = false;
    successModalButton.style.pointerEvents = "auto";

    successModalButton.onclick = () => {
      closeSuccessModal();
      if (typeof onClose === "function") onClose();
    };

    successModal.classList.remove("hidden");
    successModal.classList.add("active");
    successModal.style.pointerEvents = "auto";
    document.body.style.overflow = "hidden";
  }

  function closeSuccessModal() {
    const successModal = document.getElementById("successModal");
    if (successModal) {
      successModal.classList.add("hidden");
      successModal.classList.remove("active");
      document.body.style.overflow = "";
    }
  }
  window.closeSuccessModal = closeSuccessModal;

  /**
   * Error modal, text-only (no innerHTML).
   * @param {string} title Modal title.
   * @param {string} message Modal body text.
   * @param {string} [buttonText] Button label.
   * @param {?Function} [onClose] Callback run after the modal closes.
   */
  function showErrorDialog(title, message, buttonText = "Close", onClose = null) {
    const errorModal = document.getElementById("errorModal");
    const errorModalTitle = document.getElementById("errorModalTitle");
    const errorModalMessage = document.getElementById("errorModalMessage");
    const errorModalButton = document.getElementById("errorModalButton");

    if (!errorModal || !errorModalTitle || !errorModalMessage || !errorModalButton) {
      const errEl = document.getElementById("errorMessage");
      setText(errEl, `${title}: ${message}`);
      errEl?.classList.remove("hidden");
      if (typeof onClose === "function") onClose();
      return;
    }

    document.body.style.pointerEvents = "auto";
    const titleSpan = errorModalTitle.querySelector("span:last-child");
    if (titleSpan) setText(titleSpan, title);
    else setText(errorModalTitle, title);

    setText(errorModalMessage, message);
    setText(errorModalButton, buttonText);
    errorModalButton.disabled = false;
    errorModalButton.style.pointerEvents = "auto";

    errorModalButton.onclick = () => {
      closeErrorModal();
      if (typeof onClose === "function") onClose();
    };

    errorModal.classList.remove("hidden");
    errorModal.classList.add("active");
    errorModal.style.pointerEvents = "auto";
    document.body.style.overflow = "hidden";
  }

  function closeErrorModal() {
    const errorModal = document.getElementById("errorModal");
    if (errorModal) {
      errorModal.classList.add("hidden");
      errorModal.classList.remove("active");
      document.body.style.overflow = "";
    }
  }
  window.closeErrorModal = closeErrorModal;

  document.addEventListener("click", (e) => {
    const successModal = document.getElementById("successModal");
    const errorModal = document.getElementById("errorModal");
    if (successModal && e.target === successModal) closeSuccessModal();
    if (errorModal && e.target === errorModal) closeErrorModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const successModal = document.getElementById("successModal");
    const errorModal = document.getElementById("errorModal");
    if (successModal && !successModal.classList.contains("hidden")) closeSuccessModal();
    if (errorModal && !errorModal.classList.contains("hidden")) closeErrorModal();
  });

  // ── Validation (unchanged rules, password minimum raised to 8) ────────────
  function validateField(value, fieldName) {
    return value && value.trim() !== "" ? null : `${fieldName} is required.`;
  }

  function validateEmail(email) {
    const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return pattern.test(email) ? null : "Please enter a valid email address.";
  }

  function validateName(name) {
    const namePattern = /^[a-zA-Z\s'-]{2,}$/;
    if (name.length < 2) return "Name must be at least 2 characters long.";
    if (!namePattern.test(name)) {
      return "Name can only contain letters, spaces, hyphens, and apostrophes.";
    }
    return null;
  }

  /**
   * Password rule. The API enforces an 8-character minimum server-side
   * (register requires 8; the Firebase original allowed 6). Checking 8 here
   * up front avoids a confusing 422 round-trip.
   * @param {string} password Candidate password.
   * @return {?string} Error message, or null when valid.
   */
  function validatePassword(password) {
    if (password.length < 8) return "Password must be at least 8 characters long.";
    if (password.length > 50) return "Password is too long (max 50 characters).";
    if (!/(?=.*[0-9!@#$%^&*])/.test(password)) {
      return "Password should contain at least one number or special character.";
    }
    return null;
  }

  function validateNumericField(value, fieldName, minValue = 0, maxValue = Infinity, isPercentage = false) {
    if (value === undefined || value === null || value === "") {
      return `${fieldName} is required.`;
    }
    const cleaned = String(value).replace(/,/g, "");
    const parsed = parseFloat(cleaned);
    if (isNaN(parsed)) {
      return `${fieldName} must be a valid ${isPercentage ? "percentage" : "amount"}.`;
    }
    if (parsed < minValue || parsed > maxValue) {
      return `${fieldName} must be between ${minValue} and ${maxValue}${isPercentage ? "%" : ""}.`;
    }
    if (isPercentage && parsed > 100) return `${fieldName} cannot exceed 100%.`;
    return null;
  }

  function validatePhoneInput() {
    const errorElementId = "phoneError";
    const existing = document.getElementById(errorElementId);
    if (existing) existing.remove();
    if (!phoneInput || phoneInput.value.trim() === "") return false;

    const insertPhoneError = (text) => {
      const p = document.createElement("p");
      p.id = errorElementId;
      p.style.color = "red";
      p.textContent = text;
      phoneInput.insertAdjacentElement("afterend", p);
    };

    if (iti && typeof iti.isValidNumber === "function") {
      if (!iti.isValidNumber()) {
        insertPhoneError("Invalid phone number. Please check your input.");
        return false;
      }
    } else {
      const phoneValue = phoneInput.value.trim();
      if (!phoneValue.startsWith("+") && !phoneValue.startsWith("265")) {
        insertPhoneError("Please enter a valid phone number with country code.");
        return false;
      }
    }
    return true;
  }

  if (phoneInput) {
    phoneInput.addEventListener("blur", validatePhoneInput);
    phoneInput.addEventListener("input", validatePhoneInput);
  }

  function getCurrencyValue(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    return parseInt(el.value.replace(/[^\d]/g, ""), 10) || 0;
  }

  if (!registrationForm) return;

  registrationForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const submitButton = document.getElementById("submitBtn") ||
      registrationForm.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;

    const name = (document.getElementById("fullName") || document.getElementById("name"))
      ?.value?.trim() || "";
    const phone = (iti && iti.isValidNumber && iti.isValidNumber()) ?
      iti.getNumber() :
      (document.getElementById("phone")?.value?.trim() || "");
    const email = document.getElementById("email")?.value?.trim() || "";
    const password = document.getElementById("password")?.value?.trim() || "";
    const groupName = document.getElementById("groupName")?.value?.trim() || "";
    const groupDescription = document.getElementById("groupDescription")?.value?.trim() || "";

    // Rules-related fields (sent verbatim to rules.update — no client math).
    const seedMoney = getCurrencyValue("seedMoney");
    const monthlyContribution = getCurrencyValue("monthlyContribution");
    const serviceFee = getCurrencyValue("serviceFee");
    const maxLoanAmount = getCurrencyValue("maxLoanAmount");
    const minCycleLoanAmount = getCurrencyValue("minCycleLoanAmount");
    const contributionDueDay = parseInt(document.getElementById("contributionDueDay")?.value, 10) || 15;
    const gracePeriod = parseInt(document.getElementById("gracePeriod")?.value, 10) || 5;
    const loanGracePeriod = parseInt(document.getElementById("loanGracePeriod")?.value, 10) || 3;
    const interestRateMonth1El = document.getElementById("interestRateMonth1");
    const interestRateMonth2El = document.getElementById("interestRateMonth2");
    const interestRateMonth3El = document.getElementById("interestRateMonth3");
    const interestRateMonth1 = interestRateMonth1El ? parseFloat(interestRateMonth1El.value) : NaN;
    const interestRateMonth2 = interestRateMonth2El ? parseFloat(interestRateMonth2El.value) : NaN;
    const interestRateMonth3 = interestRateMonth3El ? parseFloat(interestRateMonth3El.value) : NaN;
    const penaltyType = document.querySelector('input[name="penaltyType"]:checked')?.value || "percentage";
    const dailyPenaltyFixed = penaltyType === "fixed" ? getCurrencyValue("dailyPenaltyFixed") : null;

    // ── Validate ──────────────────────────────────────────────────────────
    const errors = [];
    const nameError = validateName(name);
    if (nameError) errors.push(nameError);
    const emailError = validateEmail(email);
    if (emailError) errors.push(emailError);
    const passwordError = validatePassword(password);
    if (passwordError) errors.push(passwordError);
    [
      validateField(phone, "Phone Number"),
      validateField(groupName, "Group Name"),
      validateNumericField(seedMoney, "Seed Money", 0),
      validateNumericField(monthlyContribution, "Monthly Contribution", 0),
      validateNumericField(serviceFee, "Service Fee", 0),
    ].forEach((err) => {
      if (err) errors.push(err);
    });

    const phoneValid = (iti && typeof iti.isValidNumber === "function") ?
      iti.isValidNumber() :
      (phone && phone.length > 8);
    if (!phoneValid) errors.push("Phone Number is invalid.");

    if (errors.length > 0) {
      const errorEl = document.getElementById("errorMessage");
      if (errorEl) {
        setText(errorEl, errors.join(". "));
        errorEl.classList.remove("hidden");
      } else {
        showErrorDialog("Validation Errors", errors.join("\n"), "OK", () => {
          if (submitButton) submitButton.disabled = false;
        });
      }
      if (submitButton) submitButton.disabled = false;
      return;
    }

    try {
      toggleLoadingOverlay(true, "Creating your account...");
      toggleFormFields(false);

      // 1. Register. Duplicate email is a distinct, explicit 409 branch — the
      // API deliberately tells the caller this one email is taken (that is
      // the whole point of a signup form); it does not leak anything beyond
      // that on the LOGIN endpoint, which stays generic.
      try {
        await apiPost("register", {email, fullName: name, password});
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          toggleLoadingOverlay(false);
          showErrorDialog(
              "Already Registered",
              "An account with that email already exists. Please log in instead.",
              "Go to Login",
              () => {
                window.location.href = "../login.html";
              },
          );
          if (submitButton) submitButton.disabled = false;
          toggleFormFields(true);
          return;
        }
        if (error instanceof ApiError && error.status === 422) {
          toggleLoadingOverlay(false);
          showErrorDialog("Check Your Details", error.message, "OK", () => {
            if (submitButton) submitButton.disabled = false;
            toggleFormFields(true);
          });
          return;
        }
        throw error;
      }

      // 2. register() opens no session — log in explicitly.
      toggleLoadingOverlay(true, "Logging you in...");
      await login(email, password);

      // 3. Best-effort profile phone (register doesn't accept it).
      try {
        await apiPost("profile.update", {phone});
      } catch (profileError) {
        // Non-fatal — the account and login already succeeded.
        console.warn("Profile phone update failed (non-critical):", profileError?.message);
      }

      // 4. Create the group (also inserts the creator as senior_admin).
      toggleLoadingOverlay(true, "Setting up your group...");
      const group = await apiPost("groups.create", {
        groupName,
        description: groupDescription,
      });
      const groupId = group?.groupId;

      // 5. Send whitelisted money rules, only if this form collected any.
      const rulesBody = {groupId};
      let hasRules = false;
      const addRule = (key, value) => {
        if (value !== null && value !== undefined && !Number.isNaN(value)) {
          rulesBody[key] = value;
          hasRules = true;
        }
      };
      addRule("seedMoneyAmount", seedMoney);
      addRule("monthlyContributionAmount", monthlyContribution);
      addRule("monthlyContributionDayOfMonth", contributionDueDay);
      addRule("serviceFeeAmount", serviceFee);
      addRule("loanInterestRateMonth1", interestRateMonth1);
      addRule("loanInterestRateMonth2", interestRateMonth2);
      addRule("loanInterestRateMonth3", interestRateMonth3);
      addRule("contributionPenaltyGracePeriodDays", gracePeriod);
      addRule("loanPenaltyGracePeriodDays", loanGracePeriod);
      addRule("loanRulesMaxLoanAmount", maxLoanAmount || null);
      addRule("loanRulesMinCycleLoanAmount", minCycleLoanAmount || null);
      // Fixed-amount daily penalty maps directly to the SQL column. A
      // percentage-rate penalty (the original's default mode) has no
      // equivalent column — see the deferred list in this file's header.
      if (dailyPenaltyFixed !== null) addRule("contributionPenaltyDailyAmount", dailyPenaltyFixed);

      // The rules save is NOT "best effort". If it fails the group still exists,
      // but with DEFAULT money rules (seed money 0.00, default interest, no
      // penalty) — and the admin would walk away believing the figures they just
      // typed are in force. Members would then be told they owe nothing. A silent
      // failure here is a money bug, so say so plainly and send them to the rules
      // page instead of showing "Registration Complete!".
      let rulesSaved = true;
      let rulesError = null;
      if (hasRules && groupId) {
        toggleLoadingOverlay(true, "Saving your group's rules...");
        try {
          await apiPost("rules.update", rulesBody);
        } catch (err) {
          rulesSaved = false;
          rulesError = err;
          console.error("Rules save failed", err);
        }
      }

      toggleLoadingOverlay(false);

      if (!rulesSaved) {
        showSuccessDialog(
            "Account created — but your group's rules were NOT saved",
            `Your account and group "${groupName}" exist, but the money rules ` +
            `(seed money, contributions, interest, penalties) could NOT be saved` +
            `${rulesError instanceof ApiError && rulesError.message ? `: ${rulesError.message}` : "."} ` +
            `The group is currently on default values. Open the group's rules ` +
            `page and set them before adding members.`,
            "Set the rules now",
            () => {
              window.location.href = "manage_rules.html";
            },
        );
        return;
      }

      showSuccessDialog(
          "Registration Complete!",
          `Welcome to Bank Nkhonde! Your account and group "${groupName}" have been created.`,
          "Continue",
          () => {
            window.location.href = "complete_profile.html";
          },
      );
    } catch (error) {
      toggleLoadingOverlay(false);
      toggleFormFields(true);

      let errorTitle = "Registration Error";
      let errorMessage = "An unexpected error occurred. Please try again.";
      if (error instanceof ApiError) {
        if (error.status === 0) {
          errorTitle = "Network Error";
          errorMessage = "Unable to connect to the server. Check your internet connection.";
        } else if (error.status === 422) {
          errorTitle = "Check Your Details";
          errorMessage = error.message;
        } else {
          errorMessage = error.message || errorMessage;
        }
      }

      showErrorDialog(errorTitle, errorMessage, "OK", () => {
        if (submitButton) submitButton.disabled = false;
      });
    }
  });
});

/*
 * DEFERRED — toast-and-report only, no invented endpoints:
 *
 * - Welcome/verification email: `register` sends nothing server-side (no
 *   endpoint exists for it). Needs an email hook if this is required.
 * - Senior-admin approval of a new registration (`createInvitationCode` +
 *   `pollForApproval` in the Firebase original): there is no pending-
 *   registration state in the SQL schema. Group creation is immediate.
 * - KYC/guarantor/collateral/required-documents toggles (nationalId,
 *   proofOfAddress, guarantor, employmentLetter, photo, bankDetails) and any
 *   rules-document upload: the `users` and `group_rules` tables have no
 *   columns for these — see BUILD_PLAN B20.
 * - Percentage-based penalty rate (`dailyPenaltyRate` / `loanPenaltyRate` /
 *   `maxPenaltyCap`): `group_rules` only has flat currency-amount penalty
 *   columns (loanPenaltyDailyAmount, contributionPenaltyDailyAmount), not a
 *   percentage rate. Only the fixed-amount penalty mode is wired here.
 * - Cycle settings (cycleStartDate, cycleLength, per-month cycleDates) and
 *   advanced settings (surplusDistribution, enableLoanBooking,
 *   autoMonthlyReports, allowPartialPayments, interestMethod,
 *   loanPeriodCalculation, requireCollateral, expectedMembers, governance
 *   free-text rules, WhatsApp number, co-admins): none of these map to a
 *   whitelisted rules.update or groups.create field. Not sent.
 * - Per-member payment-schedule pre-creation (seed money + 12 months of
 *   contribution rows) that the Firebase batch wrote up front: no endpoint
 *   creates payment rows ahead of an actual contribution being recorded.
 */
