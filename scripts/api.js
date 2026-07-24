/**
 * api.js — shared browser client for the PHP + MySQL API.
 *
 * This is the SQL-era replacement for the Firebase barrel (firebaseConfig.js).
 * Every ported page script imports from here and from nowhere else.
 *
 * Session model: the server issues an HttpOnly, SameSite=Lax, Secure PHP session
 * cookie. There is NO token to store and nothing auth-related belongs in
 * localStorage/sessionStorage — the cookie IS the session. Because of that, every
 * request in this file sends `credentials: "same-origin"`. Omit it and the cookie
 * is never attached and every authenticated call silently 401s.
 */

/**
 * Auto-detect the base path for API and page links.
 * Uses import.meta.url (standard for ES modules) to find where this script lives,
 * then navigates up from /scripts/ to the project root.
 * Works whether deployed at domain root or in a subdirectory.
 */
const _moduleUrl = new URL(import.meta.url);
const _scriptsDir = _moduleUrl.pathname.substring(0, _moduleUrl.pathname.lastIndexOf('/scripts/'));
const BASE_PATH = _scriptsDir + '/';

/** API endpoint - auto-detected based on deployment location. */
const API_BASE = BASE_PATH + "api/index.php";

/**
 * The resolved API endpoint, for callers that must bypass apiGet/apiPost —
 * multipart uploads, which need their own fetch so the browser can set the
 * form-data boundary.
 *
 * EXPORTED DELIBERATELY: those callers used to hardcode "/api/index.php",
 * which is the DOMAIN ROOT. That works only when the app is deployed at the
 * root; in a subdirectory deployment every normal call resolved correctly via
 * BASE_PATH while the uploads alone shot at the wrong host path and 404'd.
 * Always build upload URLs from this.
 * @param {string} action the ?action= value
 * @return {string}
 */
export function apiUrl(action) {
  return `${API_BASE}?action=${encodeURIComponent(action)}`;
}

/** Where an unauthenticated caller gets sent. */
const LOGIN_URL = BASE_PATH + "login.html";

/** Deployment-agnostic 401 fallback: redirect to the login page. */
export function redirectToLogin() { window.location.replace(LOGIN_URL); }

/**
 * An error carrying the HTTP status and the parsed JSON body, so callers can
 * branch on `err.status` (401 -> login, 422 -> field error, 409 -> conflict, ...).
 */
export class ApiError extends Error {
  /**
   * @param {string} message Human-readable message.
   * @param {number} status HTTP status code (0 if the request never completed).
   * @param {*} [body] Parsed response body, when the server sent JSON.
   */
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Pull a human-readable message out of a parsed error body, with fallbacks.
 * @param {*} body Parsed response body (may be anything, or null).
 * @param {number} status HTTP status.
 * @return {string} Message to surface.
 */
function messageFrom(body, status) {
  if (body && typeof body === "object") {
    if (typeof body.message === "string" && body.message) return body.message;
    if (typeof body.error === "string" && body.error) return body.error;
  }
  return `Request failed with status ${status}`;
}

/**
 * Perform the fetch, parse JSON defensively, and throw ApiError on non-2xx.
 * @param {string} url Fully-built request URL.
 * @param {RequestInit} options Fetch options (credentials added here).
 * @return {Promise<*>} Parsed JSON body on success.
 */
async function request(url, options) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      // The single most important line in this file.
      credentials: "same-origin",
    });
  } catch (networkError) {
    throw new ApiError(
      "Unable to reach the server. Check your internet connection and try again.",
      0,
      null,
    );
  }

  // A 204 has no body at all; treat it as an empty success.
  const raw = response.status === 204 ? "" : await response.text();

  let body = null;
  let parsed = false;
  if (raw !== "") {
    try {
      body = JSON.parse(raw);
      parsed = true;
    } catch (parseError) {
      parsed = false;
    }
  } else {
    parsed = true;
  }

  if (!response.ok) {
    if (!parsed) {
      // e.g. an HTML 500 page from PHP. Do not leak it, do not throw SyntaxError.
      throw new ApiError("Unexpected server response", response.status, null);
    }
    throw new ApiError(messageFrom(body, response.status), response.status, body);
  }

  if (!parsed) {
    throw new ApiError("Unexpected server response", response.status, null);
  }

  // Every success envelope is {ok:true, data:{...}} (api/lib/http.php's
  // json_response). Callers read fields straight off the result (data.groups,
  // data.email, ...), so this unwraps to the payload, not the envelope.
  return body && typeof body === "object" && "data" in body ? body.data : body;
}

/**
 * GET /api/index.php?action=<action>&<params>
 * @param {string} action API action name.
 * @param {Object<string,*>} [params] Extra query-string parameters.
 * @return {Promise<*>} Parsed JSON body.
 */
export async function apiGet(action, params = {}) {
  const query = new URLSearchParams({action});
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      query.append(key, String(value));
    }
  }
  return request(`${API_BASE}?${query.toString()}`, {
    method: "GET",
    headers: {"Accept": "application/json"},
  });
}

/**
 * POST /api/index.php?action=<action> with a JSON body.
 * @param {string} action API action name.
 * @param {Object<string,*>} [body] Request payload.
 * @return {Promise<*>} Parsed JSON body.
 */
export async function apiPost(action, body = {}) {
  const query = new URLSearchParams({action});
  return request(`${API_BASE}?${query.toString()}`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * Trigger a same-origin file download (CSV export) via GET, so the browser
 * handles the `Content-Disposition: attachment` response itself. This does
 * NOT use fetch/request — those unwrap JSON and would corrupt a CSV body.
 * The session cookie flows automatically because the URL is same-origin.
 * @param {string} action Export action name, e.g. "exports.payments".
 * @param {Object<string,*>} [params] Extra query-string parameters.
 * @return {void}
 */
export function downloadExport(action, params = {}) {
  const query = new URLSearchParams({action});
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      query.append(key, String(value));
    }
  }
  const url = `${API_BASE}?${query.toString()}`;
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Sign in. The server returns a generic 401 for both a wrong password and an
 * unknown email — deliberately, so callers cannot enumerate registered emails.
 * Surface ONE generic message on 401; never two.
 * @param {string} email User email.
 * @param {string} password User password.
 * @return {Promise<Object>} The signed-in user {uid, email, fullName, emailVerified}.
 */
export async function login(email, password) {
  return apiPost("login", {email, password});
}

/**
 * Destroy the server-side session.
 * @return {Promise<Object>} {loggedOut: true}
 */
export async function logout() {
  return apiPost("logout", {});
}

/**
 * Read the current session.
 * @return {Promise<?Object>} The user, or null when there is no session (401).
 */
export async function getSession() {
  try {
    return await apiGet("session");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

/**
 * The replacement for Firebase's onAuthStateChanged gate. Ported page scripts
 * call this first, before touching any data.
 * @return {Promise<Object>} The user. Redirects to the login page and never
 *     resolves when there is no session.
 */
export async function requireSession() {
  const user = await getSession();
  if (!user) {
    window.location.replace(LOGIN_URL);
    // Never resolve — stop the caller from running against a dead session.
    return new Promise(() => {});
  }
  return user;
}

/**
 * Groups the signed-in user belongs to. Each group carries the caller's role.
 * @return {Promise<Array<Object>>} The caller's groups (empty array if none).
 */
export async function listMyGroups() {
  const data = await apiGet("groups.mine");
  return Array.isArray(data && data.groups) ? data.groups : [];
}
