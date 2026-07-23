/**
 * spa-router.js — SPA content-swap router.
 *
 * Scope: every page named in PAGE_CONFIG below (13 admin + 6 user pages, as
 * of cycle 56 batch B). A click on a same-app <a> is only intercepted when
 * BOTH the current page and the link's target page are in that whitelist
 * AND share the same `variant` (admin pages only swap between admin pages;
 * user pages only swap between user pages — admin and user have
 * structurally different nav shells, built by renderAdminNav/renderUserNav
 * respectively, so crossing that boundary — e.g. "Switch to User View" —
 * must stay a real navigation, never a content-only swap). Every other link
 * (any link on a non-converted page, a cross-variant link, login/logout,
 * exports.*, mailto:/tel:, #-anchors, target="_blank", download links, or
 * any external origin) falls through to a normal browser navigation
 * untouched.
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
    variant: "admin",
    module: "./admin_dashboard_sql.js",
    nav: "dashboard",
    title: "Dashboard",
  },
  "manage_members.html": {
    variant: "admin",
    module: "./manage_members_new_sql.js",
    nav: "members",
    title: "Manage Members",
  },
  "manage_loans.html": {
    variant: "admin",
    module: "./manage_loans_sql.js",
    nav: "loans",
    title: "Manage Loans",
  },
  "analytics.html": {
    variant: "admin",
    module: "./analytics_sql.js",
    nav: "analytics",
    title: "Analytics",
  },
  "approve_registrations.html": {
    variant: "admin",
    module: "./approve_registrations_sql.js",
    nav: "approvals",
    title: "Approve Registrations",
  },
  "broadcast_notifications.html": {
    variant: "admin",
    module: "./broadcast_notifications_sql.js",
    nav: "broadcast",
    title: "Broadcast Notifications",
  },
  "contributions_overview.html": {
    variant: "admin",
    module: "./contributions_overview_sql.js",
    nav: "contributions",
    title: "Contributions Overview",
  },
  "financial_reports.html": {
    variant: "admin",
    module: "./financial_reports_sql.js",
    nav: "reports",
    title: "Financial Reports",
  },
  "manage_payments.html": {
    variant: "admin",
    module: "./manage_payments_sql.js",
    nav: "payments",
    title: "Manage Payments",
  },
  "manage_rules.html": {
    variant: "admin",
    module: "./manage_rules_sql.js",
    nav: "rules",
    title: "Manage Rules",
  },
  "interest_penalties.html": {
    variant: "admin",
    module: "./interest_penalties_sql.js",
    nav: "penalties",
    title: "Interest & Penalties",
  },
  "seed_money_overview.html": {
    variant: "admin",
    module: "./seed_money_overview_sql.js",
    nav: "seed-money",
    title: "Seed Money Overview",
  },
  "settings.html": {
    variant: "admin",
    module: "./settings_sql.js",
    nav: "settings",
    title: "Settings",
  },
  "user_dashboard.html": {
    variant: "user",
    module: "./user_dashboard_sql.js",
    nav: "user_dashboard",
    title: "Dashboard",
  },
  "user_analytics.html": {
    variant: "user",
    module: "./user_analytics_sql.js",
    nav: "user_analytics",
    title: "My Analytics",
  },
  "loan_payments.html": {
    variant: "user",
    module: "./loan_payments_sql.js",
    nav: "loan_payments",
    title: "Loan Payments",
  },
  "contacts.html": {
    variant: "user",
    module: "./contacts_sql.js",
    nav: "contacts",
    title: "Contacts",
  },
  "messages.html": {
    variant: "user",
    module: "./messages_sql.js",
    nav: "messages",
    title: "Messages",
  },
  "view_rules.html": {
    variant: "user",
    module: "./view_rules_sql.js",
    nav: "view_rules",
    title: "Group Rules",
  },
};

let routerStarted = false;
/** {basename, mod} for the page module currently mounted in .dashboard-content. */
let currentModule = null;

/**
 * Delay, in ms, before the in-content loading overlay is actually inserted
 * into the DOM after showLoader() is called. A navigation that completes
 * (fetch + stylesheet wait) faster than this never shows anything at all —
 * only a slow navigation earns a visible loader, so fast swaps stay flicker-
 * free. See showLoader()/hideLoader().
 * @const {number}
 */
const LOADER_SHOW_DELAY_MS = 180;

/** Pending setTimeout id for a not-yet-shown loader, or null. */
let loaderShowTimer = null;

/** The currently-inserted loader overlay element, or null if none is shown. */
let loaderEl = null;

/**
 * Inject the loader's CSS once per document load. Scoped entirely to the
 * `.bn-spa-loader-*` classes below — reuses existing --bn-* design tokens
 * (falling back to literal values only if a token is somehow unset) rather
 * than inventing new colors.
 */
function ensureLoaderStyles() {
  if (document.getElementById("bn-spa-loader-style")) return;
  const style = document.createElement("style");
  style.id = "bn-spa-loader-style";
  style.textContent =
      ".bn-spa-loader-overlay{position:absolute;inset:0;display:flex;" +
      "align-items:center;justify-content:center;" +
      "background:var(--glass-bg, rgba(255, 255, 255, 0.72));z-index:20;" +
      "animation:bn-spa-loader-fade-in .15s ease forwards;}" +
      "@keyframes bn-spa-loader-fade-in{from{opacity:0;}to{opacity:1;}}" +
      ".bn-spa-loader-spinner{width:36px;height:36px;border-radius:50%;" +
      "border:3px solid var(--bn-gray-lighter, #E2E8F0);" +
      "border-top-color:var(--bn-accent, #C9A227);" +
      "animation:bn-spa-loader-spin .8s linear infinite;}" +
      "@keyframes bn-spa-loader-spin{to{transform:rotate(360deg);}}";
  document.head.appendChild(style);
}

/**
 * Arm the in-content loading overlay against `container` (expected to be
 * `#mainContent .dashboard-content`, i.e. the region navigateTo() is about
 * to replace). Nothing is actually inserted until LOADER_SHOW_DELAY_MS
 * elapses, so a fast navigation that calls hideLoader() before the timer
 * fires never shows anything — no flash. Never touches the sidebar,
 * topbar, or mobile nav; only ever appends inside `container` itself.
 * @param {?Element} container The current .dashboard-content element.
 */
function showLoader(container) {
  if (!container) return;
  ensureLoaderStyles();
  clearTimeout(loaderShowTimer);
  loaderShowTimer = setTimeout(() => {
    loaderShowTimer = null;
    if (!container.isConnected) return;
    if (window.getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    const overlay = document.createElement("div");
    overlay.className = "bn-spa-loader-overlay";
    const spinner = document.createElement("div");
    spinner.className = "bn-spa-loader-spinner";
    overlay.appendChild(spinner);
    container.appendChild(overlay);
    loaderEl = overlay;
  }, LOADER_SHOW_DELAY_MS);
}

/**
 * Cancel any pending loader timer and remove the overlay if it was actually
 * inserted. Safe to call unconditionally (e.g. even when the loader never
 * fired because the navigation was fast).
 */
function hideLoader() {
  clearTimeout(loaderShowTimer);
  loaderShowTimer = null;
  if (loaderEl && loaderEl.parentElement) {
    loaderEl.parentElement.removeChild(loaderEl);
  }
  loaderEl = null;
}

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

  // Admin and user pages have structurally different nav shells (separate
  // sidebar/topbar markup built by renderAdminNav/renderUserNav). Crossing
  // that boundary (e.g. the "Switch to User View" link) must stay a real
  // navigation — a content-only swap would leave the wrong sidebar mounted.
  if (PAGE_CONFIG[currentBasename].variant !== PAGE_CONFIG[targetBasename].variant) {
    return false;
  }

  return true;
}

/**
 * Marker attribute used to identify <style> elements that are page-local
 * (i.e. belong to whichever whitelisted page is currently mounted) so they
 * can be swapped out wholesale on the next navigation, rather than
 * accumulating alongside every page's rules.
 * @const {string}
 */
const LOCAL_STYLE_ATTR = "data-spa-page-style";

/**
 * Hard cap, in ms, on how long a navigation waits for newly-appended
 * stylesheet <link>s to load before revealing the swapped-in content
 * regardless. Keeps a 404 or a slow CDN from hanging navigation.
 */
const STYLESHEET_LOAD_TIMEOUT_MS = 1800;

/**
 * Selector for page-local <style> elements outside the swapped
 * .dashboard-content region: <head>'s own <style> blocks, plus any <style>
 * that is a *direct* child of <body> (e.g. a modal/overlay block placed
 * after </main> in markup like admin_dashboard.html's and
 * user_dashboard.html's "Select a Group" overlay). Deliberately scoped to
 * direct children only — a <style> nested inside .dashboard-content (itself
 * nested well below <body>) never matches this selector and stays solely
 * the content swap's responsibility, never double-handled here.
 * @const {string}
 */
const LOCAL_STYLE_SELECTOR = "head > style, body > style";

/**
 * Tag any local <style> element (see LOCAL_STYLE_SELECTOR) already sitting
 * in the live document that isn't tagged yet. Runs before the first swap so
 * a page's own inline <style> block(s) — whether in <head> or a body-level
 * block like a modal overlay's styles — present on the very first, non-SPA
 * load are known to be page-local and can be replaced on the next
 * navigateTo() call, instead of surviving forever alongside the incoming
 * page's <style> blocks. Idempotent — a second call is a no-op for
 * already-tagged elements.
 */
function tagExistingLocalStyles() {
  const styles = document.querySelectorAll(
      LOCAL_STYLE_SELECTOR.split(", ")
          .map((sel) => sel + ":not([" + LOCAL_STYLE_ATTR + "])")
          .join(", "),
  );
  styles.forEach((styleEl) => {
    styleEl.setAttribute(LOCAL_STYLE_ATTR, "true");
  });
}

/**
 * Additively sync <link rel="stylesheet"> tags from the freshly-fetched
 * target document's <head> into the live <head>. Never removes a <link> —
 * a sheet the live page no longer references but a previous page still
 * needs (in case of a swap back) is harmless to leave in place.
 * @param {Document} targetDoc Parsed document for the destination page.
 * @param {string} baseHref Absolute URL the target document was fetched
 *     from, used to resolve any relative href on its <link> tags.
 * @return {!Array<!HTMLLinkElement>} The <link> elements newly appended by
 *     this call (empty when the target page's stylesheets were all already
 *     present in the live <head>).
 */
function syncStylesheetLinks(targetDoc, baseHref) {
  const existingHrefs = new Set(
      Array.from(document.head.querySelectorAll("link[rel~=\"stylesheet\"]"))
          .map((link) => link.href),
  );

  const newlyAppended = [];
  const targetLinks = targetDoc.head.querySelectorAll("link[rel~=\"stylesheet\"]");
  targetLinks.forEach((link) => {
    const rawHref = link.getAttribute("href");
    if (!rawHref) return;
    let absoluteHref;
    try {
      absoluteHref = new URL(rawHref, baseHref).href;
    } catch (error) {
      return;
    }
    if (existingHrefs.has(absoluteHref)) return;

    const newLink = document.createElement("link");
    newLink.setAttribute("rel", "stylesheet");
    newLink.setAttribute("href", rawHref);
    document.head.appendChild(newLink);
    existingHrefs.add(absoluteHref);
    newlyAppended.push(newLink);
  });
  return newlyAppended;
}

/**
 * Resolve once every given <link> has either fired 'load' or 'error', or a
 * bounded timeout elapses — whichever comes first. A stylesheet that 404s
 * or a slow CDN must never hang navigation, so the timeout always wins over
 * a stalled listener.
 * @param {!Array<!HTMLLinkElement>} links Newly-appended <link> elements to
 *     wait on. An empty array resolves immediately with no delay.
 * @param {number} timeoutMs Hard cap, in ms, after which the reveal
 *     proceeds regardless of any link still pending.
 * @return {!Promise<void>}
 */
function waitForStylesheets(links, timeoutMs) {
  if (!links.length) return Promise.resolve();

  return new Promise((resolve) => {
    let remaining = links.length;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const onSettle = () => {
      remaining -= 1;
      if (remaining <= 0) finish();
    };

    links.forEach((link) => {
      link.addEventListener("load", onSettle, {once: true});
      link.addEventListener("error", onSettle, {once: true});
    });

    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * Replace the current page's local <style> block(s) (see
 * LOCAL_STYLE_SELECTOR — <head>'s own blocks plus any body-level, direct-
 * child-of-<body> block such as a modal overlay's styles) with the target
 * page's equivalent block(s). Tagged (not appended alongside) so
 * conflicting rules from the outgoing page never linger in the cascade
 * after a swap, and so a body-level block like .group-selection-overlay's
 * styles is actually removed when navigating away rather than remaining a
 * permanent, stale DOM resident.
 * @param {Document} targetDoc Parsed document for the destination page.
 */
function swapLocalStyles(targetDoc) {
  tagExistingLocalStyles();

  const staleStyles = document.querySelectorAll(
      LOCAL_STYLE_SELECTOR.split(", ")
          .map((sel) => sel + "[" + LOCAL_STYLE_ATTR + "]")
          .join(", "),
  );
  staleStyles.forEach((styleEl) => styleEl.remove());

  const targetStyles = targetDoc.querySelectorAll(LOCAL_STYLE_SELECTOR);
  targetStyles.forEach((styleEl) => {
    const clone = document.createElement("style");
    clone.setAttribute(LOCAL_STYLE_ATTR, "true");
    clone.textContent = styleEl.textContent;
    // Preserve the original document's placement (head-level vs a
    // body-level block like a modal overlay's styles) so a body-level
    // block ends up back at the body level rather than being funnelled
    // into <head>.
    const belongsToBody = styleEl.parentElement && styleEl.parentElement.tagName === "BODY";
    (belongsToBody ? document.body : document.head).appendChild(clone);
  });
}

/**
 * Marker attribute used to identify body-level elements that are page-local
 * (e.g. a modal overlay like #newLoanModal, or a page's #spinner loading
 * overlay) so they can be swapped out wholesale on the next navigation. Every
 * whitelisted admin page places some of this markup as a direct child of
 * <body>, after </main> — it exists on a real/hard page load but is never
 * part of .dashboard-content, so the content-only swap above never inserts
 * it unless this pass handles it separately.
 * @const {string}
 */
const LOCAL_BODY_ATTR = "data-spa-page-body-el";

/**
 * Selector for the shared, persistent chrome that lives as a direct child of
 * <body> and must never be tagged, removed, or duplicated by the body-level
 * sync below — it is rendered once by nav_sql.js's renderAdminNav()/
 * renderUserNav() and updated in place (see updateActiveNav()), never
 * rebuilt per navigation. Everything else that is a direct child of <body>
 * and isn't a <script> is page-local content (modals, #spinner, etc.) that
 * belongs to whichever whitelisted page is currently mounted.
 * @const {string}
 */
const SHARED_BODY_CHROME_SELECTOR =
    "#mainContent, #sidebar, #sidebarOverlay, .mobile-nav, #toastContainer, " +
    ".top-nav, #mobileMenuOverlay, #mobileMenu";

/**
 * @param {Element} el A direct child of <body> (in either the live document
 *     or a freshly-parsed target document).
 * @return {boolean} Whether this element is page-local content that the
 *     body-level sync owns, as opposed to shared chrome or a <script> tag.
 */
function isSyncablePageBodyElement(el) {
  if (el.tagName === "SCRIPT") return false;
  return !el.matches(SHARED_BODY_CHROME_SELECTOR);
}

/**
 * Tag any page-local, direct-child-of-<body> element already sitting in the
 * live document that isn't tagged yet (e.g. a modal overlay present on the
 * very first, non-SPA load). Idempotent — a second call is a no-op for
 * already-tagged elements. Mirrors tagExistingLocalStyles() above.
 */
function tagExistingLocalBodyElements() {
  Array.from(document.body.children).forEach((el) => {
    if (el.hasAttribute(LOCAL_BODY_ATTR)) return;
    if (!isSyncablePageBodyElement(el)) return;
    el.setAttribute(LOCAL_BODY_ATTR, "true");
  });
}

/**
 * Replace the current page's local body-level element(s) — modal overlays,
 * #spinner, etc. — with the target page's equivalent element(s). Tagged
 * (not appended alongside) so an outgoing page's modal never lingers in the
 * DOM after a swap. Shared chrome (sidebar, topbar's container #mainContent,
 * mobile nav, toast container, user top-nav/mobile menu) is left completely
 * untouched — this only ever adds/removes elements matched by
 * isSyncablePageBodyElement(). Mirrors swapLocalStyles() above.
 * @param {Document} targetDoc Parsed document for the destination page.
 */
function swapLocalBodyElements(targetDoc) {
  tagExistingLocalBodyElements();

  const staleEls = document.body.querySelectorAll(":scope > [" + LOCAL_BODY_ATTR + "]");
  staleEls.forEach((el) => el.remove());

  // The shared, persistent #mainContent is the anchor. A page-local body
  // element that sits BEFORE #mainContent in the target document (e.g.
  // user_dashboard's <section class="hero-section"> holding the stats + Quick
  // Actions, or view_rules' <header class="page-header">) must be re-inserted
  // before the live #mainContent, not appended blindly — a plain
  // appendChild() drops it at the end of <body>, below #mainContent, which is
  // exactly what made the hero (and its action buttons) "pop out" beneath the
  // content on a swap-back. Elements after #mainContent (modals, #spinner
  // overlays) still append to the end.
  const liveMain = document.getElementById("mainContent");
  const targetChildren = Array.from(targetDoc.body.children);
  const mainIndex = targetChildren.findIndex((el) => el.id === "mainContent");

  targetChildren.forEach((el, index) => {
    if (!isSyncablePageBodyElement(el)) return;
    const clone = el.cloneNode(true);
    clone.setAttribute(LOCAL_BODY_ATTR, "true");
    if (liveMain && mainIndex !== -1 && index < mainIndex) {
      document.body.insertBefore(clone, liveMain);
    } else {
      document.body.appendChild(clone);
    }
  });
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

  // Show the in-content loading overlay immediately (before the fetch even
  // starts) so a slow navigation gets visual feedback right away. Delayed
  // internally by showLoader() so a fast navigation never flickers one in.
  showLoader(document.querySelector("#mainContent .dashboard-content"));

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

  // Head CSS sync: additively bring in any stylesheet <link> the target
  // page needs but the live document hasn't loaded yet, then replace the
  // outgoing page's local <style> block(s) with the target's. The content
  // reveal is held until the newly-appended stylesheets have loaded (or a
  // bounded timeout elapses) so the swapped-in page never flashes
  // unstyled — repeat navigations that add zero new links resolve with no
  // delay.
  const newlyAppendedLinks = syncStylesheetLinks(doc, url.href);
  swapLocalStyles(doc);
  swapLocalBodyElements(doc);
  await waitForStylesheets(newlyAppendedLinks, STYLESHEET_LOAD_TIMEOUT_MS);

  // The new content is about to become visible in the same spot the loader
  // (if it ever actually showed) occupies — remove it right at the swap.
  hideLoader();
  currentContent.replaceWith(newContent);
  if (doc.title) document.title = doc.title;

  if (push) {
    window.history.pushState({bnSpa: true}, "", url.href);
  }

  const {updateActiveNav} = await import("./nav_sql.js?v=20260722");
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
