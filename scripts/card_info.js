/**
 * card_info.js — the ONE card-info ("i") popover used across every page.
 *
 * WHY THIS EXISTS / WHY IT RENDERS ON <body>
 * Earlier versions rendered the popover as a CHILD of the card it describes.
 * That can never be made reliable, because a descendant is clipped and
 * contained by its ancestors:
 *   - any ancestor with `overflow` other than `visible` clips it (stat rows
 *     and chart grids scroll horizontally, so they do);
 *   - `position: fixed` does NOT escape that when an ancestor has a
 *     `transform`/`filter`/`backdrop-filter` — those create a containing block,
 *     and several card styles use a hover `transform` lift;
 *   - a card's own `z-index`/stacking context can put the panel behind a later
 *     sibling card.
 * So the panel is appended to <body> and positioned with fixed coordinates
 * derived from the toggle button. Nothing in the page can clip, contain, or
 * stack over it.
 *
 * Only ONE panel is ever open, and it is reused — so there is no leak and no
 * possibility of two panels disagreeing.
 *
 * Content is set with textContent / appendChild of caller-built nodes; this
 * module never assigns innerHTML.
 */

/** The single reused panel, created on first use. */
let panel = null;
/** The toggle whose content is currently shown, or null when closed. */
let openToggle = null;


/** localStorage key for the "show info buttons" display preference. */
const PREF_KEY = "bn.showCardInfo";

/**
 * Whether card info toggles should be shown. Defaults to ON — the explainers
 * are the point of the feature, so a user opts OUT via Settings > Display.
 * Read fresh on each attach so a change takes effect on the next render
 * without a reload. Wrapped because localStorage throws in some privacy modes.
 * @return {boolean}
 */
export function cardInfoEnabled() {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch (e) {
    return true;
  }
}

/**
 * Persist the preference and apply it immediately across the page.
 * @param {boolean} on
 */
export function setCardInfoEnabled(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch (e) {
    // A device refusing storage still gets the live effect below.
  }
  document.documentElement.classList.toggle("bn-no-card-info", !on);
  if (!on) {
    closeInfoPanel();
    document.querySelectorAll(".bn-info-toggle").forEach((t) => t.remove());
  }
}

// Apply the stored preference as early as possible, so a user who turned the
// toggles off never sees them flash in before being removed.
if (!cardInfoEnabled()) {
  document.documentElement.classList.add("bn-no-card-info");
}

const GAP = 8;
const MARGIN = 8;

function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement("div");
  panel.className = "bn-info-panel";
  panel.setAttribute("role", "status");
  panel.hidden = true;
  document.body.appendChild(panel);
  return panel;
}

/** Position the panel under (or above) the toggle, clamped to the viewport. */
function place(toggle) {
  const p = ensurePanel();
  const r = toggle.getBoundingClientRect();

  // Measure with the panel laid out but not yet painted at its final spot.
  p.style.left = "0px";
  p.style.top = "0px";
  const pr = p.getBoundingClientRect();

  // Prefer below the toggle; flip above when there isn't room.
  let top = r.bottom + GAP;
  if (top + pr.height > window.innerHeight - MARGIN) {
    const above = r.top - GAP - pr.height;
    top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - pr.height - MARGIN);
  }

  // Right-align to the toggle, then clamp into the viewport.
  let left = r.right - pr.width;
  left = Math.min(left, window.innerWidth - pr.width - MARGIN);
  left = Math.max(MARGIN, left);

  p.style.left = `${Math.round(left)}px`;
  p.style.top = `${Math.round(top)}px`;
}

/** Close the open panel, if any. */
export function closeInfoPanel() {
  if (!openToggle) return;
  openToggle.setAttribute("aria-expanded", "false");
  openToggle = null;
  if (panel) {
    panel.hidden = true;
    panel.classList.remove("is-open");
  }
}

/**
 * Open the panel for a toggle, filling it from `build`.
 * @param {HTMLElement} toggle the "i" button
 * @param {function(HTMLElement):void} build fills the (already-emptied) panel
 */
function openFor(toggle, build) {
  const p = ensurePanel();
  p.textContent = "";
  build(p);
  if (!p.childNodes.length) return; // nothing to say — don't flash an empty box
  p.hidden = false;
  p.classList.add("is-open");
  place(toggle);
  toggle.setAttribute("aria-expanded", "true");
  openToggle = toggle;
}

/**
 * Attach an "i" info toggle to a card.
 *
 * @param {HTMLElement} card the element the button is placed in
 * @param {Object} opts
 * @param {string} opts.label accessible name for the button
 * @param {(string|function(HTMLElement):void)} opts.content plain text, or a
 *     builder that fills the panel with caller-created nodes
 * @return {?HTMLElement} the toggle button, or null when nothing was attached
 */
export function attachCardInfo(card, opts) {
  if (!card || !opts || !opts.content) return null;
  // Honour the Display preference — no toggle is created when it is off.
  if (!cardInfoEnabled()) return null;

  // Idempotent: re-running a render must not stack duplicate toggles.
  const existing = card.querySelector(":scope > .bn-info-toggle");
  if (existing) existing.remove();

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "bn-info-toggle";
  toggle.textContent = "i";
  toggle.setAttribute("aria-label", opts.label || "More information");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-haspopup", "dialog");

  const build = typeof opts.content === "function"
    ? opts.content
    : (host) => { host.textContent = String(opts.content); };

  toggle.addEventListener("click", (e) => {
    // The card itself is often clickable (navigates/filters) — the info button
    // must never trigger that.
    e.preventDefault();
    e.stopPropagation();
    if (openToggle === toggle) {
      closeInfoPanel();
      return;
    }
    closeInfoPanel();
    openFor(toggle, build);
  });

  toggle.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeInfoPanel();
      toggle.focus();
    }
  });

  card.appendChild(toggle);
  return toggle;
}

// ── Global dismissal ────────────────────────────────────────────────────────
// One set of listeners for the whole app, registered once at module load.
document.addEventListener("click", (e) => {
  if (!openToggle) return;
  if (e.target.closest(".bn-info-panel") || e.target.closest(".bn-info-toggle")) return;
  closeInfoPanel();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeInfoPanel();
});

// The panel is fixed-positioned from a live rect, so it must follow or close
// when the page moves beneath it. Capture-phase catches scrolls in any
// scrollable ancestor, not just the window.
window.addEventListener("scroll", () => { if (openToggle) place(openToggle); }, true);
window.addEventListener("resize", () => { if (openToggle) place(openToggle); });
