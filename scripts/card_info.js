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
 * THE standard shape of an info panel, so every "i" button on every page
 * answers the same three questions in the same order:
 *
 *   1. WHAT is this figure          -> title
 *   2. WHAT does it mean            -> description (one plain sentence)
 *   3. WHERE did the number come from -> rows (the derivation), and
 *      optionally an action that opens the underlying detail.
 *
 * Before this, each page hand-built its own panel body: some were a bare
 * sentence, some were label/value rows, some had a heading and some did not,
 * and none offered a route to the detail behind the number. Pass whichever
 * parts apply — every part is optional, and the order is fixed here rather
 * than at each call site, which is what keeps them uniform.
 *
 * @param {Object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.description]
 * @param {Array<Array<string>>} [opts.rows] [label, value] pairs
 * @param {{label: string, onClick: function()}} [opts.action]
 * @return {function(HTMLElement):void} a builder for attachCardInfo's `content`
 */
export function infoContent(opts) {
  return (host) => {
    if (opts.title) {
      const t = document.createElement("p");
      t.className = "bn-info-title";
      t.textContent = opts.title;
      host.appendChild(t);
    }

    if (opts.description) {
      const d = document.createElement("p");
      d.className = "bn-info-desc";
      d.textContent = opts.description;
      host.appendChild(d);
    }

    if (Array.isArray(opts.rows)) {
      for (const [label, value] of opts.rows) {
        if (value === undefined || value === null) continue;
        const row = document.createElement("div");
        row.className = "bn-info-row";
        const l = document.createElement("span");
        l.className = "bn-info-row-label";
        l.textContent = label;
        const v = document.createElement("span");
        v.className = "bn-info-row-value";
        v.textContent = String(value);
        row.append(l, v);
        host.appendChild(row);
      }
    }

    if (opts.action && typeof opts.action.onClick === "function") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bn-info-action";
      btn.textContent = opts.action.label || "View breakdown";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // The panel is a transient overlay — close it before handing over, or
        // it hangs over whatever the action opens.
        closeInfoPanel();
        opts.action.onClick();
      });
      host.appendChild(btn);
    }
  };
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

/**
 * Attach a standardized info toggle to a `.page-stat` card.
 *
 * Every page-stat card across the app now answers the same three questions:
 * what the figure is, what it means, and where the number came from.
 *
 * @param {HTMLElement} card — the `.page-stat` element
 * @param {Object} opts
 * @param {string} opts.title — what the figure is (e.g. "Active Loans")
 * @param {string} opts.description — what it means (one plain sentence)
 * @param {Array<Array<string>>} [opts.rows] — [label, value] derivation pairs
 * @param {{label: string, onClick: function()}} [opts.action] — optional action button
 */
export function pageStatInfo(card, opts) {
  if (!card || !opts) return;
  const label = card.querySelector(".page-stat-label")?.textContent?.trim() || opts.title;
  attachCardInfo(card, {
    label: `About ${label}`,
    content: infoContent({
      title: opts.title,
      description: opts.description,
      rows: opts.rows,
      action: opts.action,
    }),
  });
}
