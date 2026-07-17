/**
 * spa-router.js — pilot SPA content-swap router.
 *
 * Scope: exactly the 3 whitelisted admin pages named in PAGE_CONFIG below
 * (admin_dashboard.html, manage_members.html, manage_loans.html). A click on
 * a same-app <a> is only intercepted when BOTH the current page and the
 * link's target page are in that whitelist; every other link (including any
 * link on a non-piloted page, or a link from a piloted page to a
 * non-piloted one — e.g. "Switch to User View", analytics.html,
 * settings.html, login/logout, exports.*, mailto:/tel:, #-anchors,
 * target="_blank", download links, or any external origin) falls through to
 * a normal browser navigation untouched.
 *
 * Only .dashboard-content inside #mainContent is ever replaced. #mainContent
 * itself, <head>, the sidebar, topbar chrome, and mobile nav are never
 * touched or rebuilt — see nav_sql.js's updateActiveNav() for the small bit
 * of chrome (active link + topbar title) that does need to change per page.
 *
 * window.__bnSpa is set to true synchronously as soon as this module is
 * evaluated (this module is statically imported by nav_sql.js, which itself
 * is imported before DOMContentLoaded fires), so a converted page's guarded
 * `if (!window.__bnSpa) { document.addEventListener("DOMContentLoaded", ...) }`
 * bootstrap skips and the router becomes the sole caller of that page's
 * exported init().
 */

// Must run synchronously at module-evaluation time, before DOMContentLoaded.
window.__bnSpa = true;

/** Whitelisted pages: filename -> {module specifier, nav id, topbar title}. */
const PAGE_CONFIG = {
  "admin_dashboard.html": {
    module: "./admin_dashboard_sql.js",
    nav: "dashboard",
    title: "Dashboard",
  },
  "manage_members.html": {
    module: "./manage_members_new_sql.js",
    nav: "members",
    title: "Manage Members",
  },
  "manage_loans.html": {
    module: "./manage_loans_sql.js",
    nav: "loans",
    title: "Manage Loans",
  },
};

let routerStarted = false;
/** {basename, mod} for the page module currently mounted in .dashboard-content. */
let currentModule = null;

/**
 * @param {string} pathname A location.pathname value.
 * @return {string} The final path segment (e.g. "manage_loans.html").
 */
function basenameOf(pathname) {
  const parts = String(pathname || "").split("/");
  return parts[parts.length - 1] || "";
}

/**
 * @param {string} basename Filename to test.
 * @return {boolean} Whether it is one of the 3 piloted pages.
 */
function isWhitelisted(basename) {
  return Object.prototype.hasOwnProperty.call(PAGE_CONFIG, basename);
}

/**
 * Resolve an anchor's href to a same-origin basename, or null if the link is
 * cross-origin / unparseable.
 * @param {string} href Absolute or relative href.
 * @return {string|null} The basename, or null if not same-origin.
 */
function resolveSameOriginBasename(href) {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    return basenameOf(url.pathname);
  } catch (error) {
    return null;
  }
}

/**
 * Decide whether a click on this anchor should be handled by the router.
 * @param {HTMLAnchorElement} anchor Clicked anchor element.
 * @return {boolean}
 */
function shouldIntercept(anchor) {
  if (!anchor || !anchor.getAttribute) return false;

  const rawHref = anchor.getAttribute("href") || "";
  if (!rawHref || rawHref.startsWith("#")) return false;
  if (rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) return false;
  if (anchor.hasAttribute("download")) return false;

  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return false;

  const currentBasename = basenameOf(window.location.pathname);
  if (!isWhitelisted(currentBasename)) return false;

  const targetBasename = resolveSameOriginBasename(anchor.href);
  if (!targetBasename || !isWhitelisted(targetBasename)) return false;

  return true;
}

/**
 * Fetch a whitelisted page, swap its .dashboard-content into the live DOM,
 * update chrome + history, and mount the target page's module.
 * @param {string} href Destination URL (relative or absolute).
 * @param {Object} [opts]
 * @param {boolean} [opts.push] Whether to push a new history entry.
 * @return {Promise<boolean>} Whether the router handled the navigation.
 */
async function navigateTo(href, opts = {}) {
  const push = opts.push !== false;
  const url = new URL(href, window.location.href);
  const basename = basenameOf(url.pathname);
  const config = PAGE_CONFIG[basename];
  if (!config) return false;

  let html;
  try {
    const res = await fetch(url.href, {credentials: "same-origin"});
    if (!res.ok) throw new Error("spa-router: fetch failed with status " + res.status);
    html = await res.text();
  } catch (error) {
    window.location.href = url.href;
    return true;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const newContent = doc.querySelector(".dashboard-content");
  const currentContent = document.querySelector("#mainContent .dashboard-content");
  if (!newContent || !currentContent) {
    // Markup contract broken — fall back to a real navigation rather than
    // leaving the page in a half-swapped state.
    window.location.href = url.href;
    return true;
  }

  // Give the outgoing page a chance to release anything that would outlive
  // the swap (only relevant if it exported an optional teardown()).
  if (currentModule && currentModule.mod && typeof currentModule.mod.teardown === "function") {
    try {
      currentModule.mod.teardown();
    } catch (error) {
      // Non-fatal — proceed with the swap regardless.
    }
  }

  currentContent.replaceWith(newContent);
  if (doc.title) document.title = doc.title;

  if (push) {
    window.history.pushState({bnSpa: true}, "", url.href);
  }

  const {updateActiveNav} = await import("./nav_sql.js");
  updateActiveNav(config.nav, config.title);

  let mod;
  try {
    mod = await import(config.module);
  } catch (error) {
    window.location.href = url.href;
    return true;
  }
  currentModule = {basename, mod};

  if (mod && typeof mod.init === "function") {
    try {
      await mod.init();
    } catch (error) {
      // The page's own init() owns its error handling (including
      // requireSession()'s redirect-on-401); nothing further to do here.
    }
  }

  return true;
}

/**
 * Document-level click delegate. Only preventDefault()s clicks the router
 * actually handles; everything else is left to fall through to a normal
 * browser navigation.
 * @param {MouseEvent} e
 */
function onDocumentClick(e) {
  if (e.defaultPrevented) return;
  if (e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  const anchor = e.target && e.target.closest ? e.target.closest("a[href]") : null;
  if (!anchor || !shouldIntercept(anchor)) return;

  e.preventDefault();
  navigateTo(anchor.href, {push: true});
}

/** Browser back/forward handler. */
function onPopState() {
  const basename = basenameOf(window.location.pathname);
  if (!isWhitelisted(basename)) {
    // We navigated (via back/forward) onto a page the router doesn't own —
    // let the browser's own load of that page take over.
    window.location.reload();
    return;
  }
  navigateTo(window.location.href, {push: false});
}

/**
 * Start the router. Idempotent — safe to call once per page load from
 * nav_sql.js's initNav(). Intercepts clicks only when the CURRENT page is
 * one of the 3 whitelisted pages; on any other page it stays inert.
 *
 * IMPORTANT: because this module sets window.__bnSpa = true as soon as it is
 * evaluated — which happens (via nav_sql.js's static import) BEFORE a
 * whitelisted page's own module script runs — that page's guarded
 * `if (!window.__bnSpa) { ...DOMContentLoaded... }` bootstrap is already
 * skipped on the very first load, not just on later swaps. So the router
 * must call the current page's exported init() itself here, once, in
 * addition to on every later swap.
 */
export function initSpaRouter() {
  if (routerStarted) return;
  routerStarted = true;

  const basename = basenameOf(window.location.pathname);
  if (isWhitelisted(basename)) {
    // Dynamic import of the already-evaluated page module returns the
    // cached module (no re-execution of its top-level code) — but init()
    // itself has not been called yet for this first load, since the page's
    // own guarded bootstrap saw __bnSpa already true and skipped itself.
    import(PAGE_CONFIG[basename].module)
        .then(async (mod) => {
          currentModule = {basename, mod};
          if (mod && typeof mod.init === "function") {
            try {
              await mod.init();
            } catch (error) {
              // The page's own init() owns its error handling.
            }
          }
        })
        .catch(() => {});
  }

  document.addEventListener("click", onDocumentClick);
  window.addEventListener("popstate", onPopState);
}
