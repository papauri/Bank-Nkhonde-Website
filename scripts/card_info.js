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

/**
 * Re-place the open panel against its toggle.
 *
 * The panel is positioned once, for the height it had when it opened. Now that
 * a row can expand a second level, that height changes while the panel is open
 * — without this the newly revealed content can sit below the fold with no way
 * to reach it.
 */
export function repositionInfoPanel() {
  if (!openToggle || !panel || panel.hidden) return;
  place(openToggle);
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
      for (const raw of opts.rows) {
        const row = normaliseRow(raw);
        if (!row) continue;
        appendInfoRow(host, row);
      }
    }

    // `actions` (plural) is the general form; `action` stays supported because
    // most call sites only ever offer one.
    const actions = []
      .concat(Array.isArray(opts.actions) ? opts.actions : [])
      .concat(opts.action ? [opts.action] : [])
      .filter((a) => a && typeof a.onClick === "function");

    for (const action of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bn-info-action";
      btn.textContent = action.label || "View breakdown";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // The panel is a transient overlay — close it before handing over, or
        // it hangs over whatever the action opens.
        closeInfoPanel();
        action.onClick();
      });
      host.appendChild(btn);
    }
  };
}

/**
 * Accept either the original `[label, value]` pair or the richer object form,
 * so no existing call site had to change when expandable rows were added.
 *
 * Object form: `{label, value, detail, onClick, detailLabel}` where
 *   detail   — string | string[] | Array<[label, value]> | () => (any of those)
 *              A FUNCTION is resolved on first expand, which is what lets a row
 *              fetch its second level only when someone actually asks for it.
 *   onClick  — makes the row itself clickable (navigate / open a modal).
 *
 * @param {Array|Object} raw
 * @return {Object|null}
 */
function normaliseRow(raw) {
  if (Array.isArray(raw)) {
    const [label, value] = raw;
    if (value === undefined || value === null) return null;
    return { label, value, detail: null, onClick: null };
  }
  if (!raw || typeof raw !== "object") return null;
  if (raw.value === undefined || raw.value === null) return null;
  return {
    label: raw.label,
    value: raw.value,
    detail: raw.detail !== undefined ? raw.detail : null,
    onClick: typeof raw.onClick === "function" ? raw.onClick : null,
    detailLabel: raw.detailLabel || null,
  };
}

/**
 * Render one row, plus its collapsible second level when it has one.
 * @param {HTMLElement} host
 * @param {Object} row normalised row
 */
function appendInfoRow(host, row) {
  const el = document.createElement("div");
  el.className = "bn-info-row";

  const l = document.createElement("span");
  l.className = "bn-info-row-label";
  l.textContent = row.label;

  const right = document.createElement("span");
  right.style.display = "inline-flex";
  right.style.alignItems = "center";
  right.style.gap = "8px";
  right.style.flexShrink = "0";

  const v = document.createElement("span");
  v.className = "bn-info-row-value";
  v.textContent = String(row.value);
  right.appendChild(v);

  const hasDetail = row.detail !== null && row.detail !== undefined;
  let toggle = null;
  let detailEl = null;

  if (hasDetail) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "bn-info-row-toggle";
    toggle.textContent = "▾";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute(
      "aria-label",
      row.detailLabel || `Show the detail behind ${row.label}`,
    );
    right.appendChild(toggle);
  }

  el.append(l, right);

  if (row.onClick) {
    el.classList.add("is-clickable");
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    const fire = (e) => {
      // The expand toggle lives inside the row; it must never trigger the row's
      // own action.
      if (e.target.closest(".bn-info-row-toggle")) return;
      e.preventDefault();
      e.stopPropagation();
      closeInfoPanel();
      row.onClick();
    };
    el.addEventListener("click", fire);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") fire(e);
    });
  }

  host.appendChild(el);

  if (hasDetail) {
    detailEl = document.createElement("div");
    detailEl.className = "bn-info-row-detail";
    detailEl.hidden = true;
    host.appendChild(detailEl);

    let filled = false;
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = detailEl.hidden;
      if (open && !filled) {
        // Resolved on FIRST expand only: a row whose detail is a function does
        // not pay for it unless someone opens it. This is what makes it safe for
        // a detail to be a SERVER call — the panel never fetches per-member
        // figures until an admin actually asks to see them.
        filled = true;
        let resolved = row.detail;
        if (typeof resolved === "function") {
          try {
            resolved = resolved();
          } catch (err) {
            resolved = null;
          }
        }
        if (resolved && typeof resolved.then === "function") {
          detailEl.textContent = "Loading…";
          resolved
            .then((value) => {
              fillDetail(detailEl, value);
              repositionInfoPanel();
            })
            .catch(() => {
              detailEl.replaceChildren();
              const p = document.createElement("div");
              p.className = "bn-info-row-detail-empty";
              // Never leave a stale "Loading…" — say plainly that it failed.
              p.textContent = "Couldn't load this detail.";
              detailEl.appendChild(p);
              repositionInfoPanel();
            });
        } else {
          fillDetail(detailEl, resolved);
        }
      }
      detailEl.hidden = !open;
      toggle.textContent = open ? "▾" : "▾";
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      // The panel was positioned for its collapsed height; growing it can push
      // the bottom off screen, so ask for a re-place.
      repositionInfoPanel();
    });
  }
}

/**
 * Fill an expanded detail block. Accepts a sentence, a list of lines, or
 * label/value pairs — whichever the figure actually calls for.
 * @param {HTMLElement} host
 * @param {*} detail
 */
function fillDetail(host, detail) {
  host.replaceChildren();

  const empty = () => {
    const p = document.createElement("div");
    p.className = "bn-info-row-detail-empty";
    p.textContent = "Nothing further to show.";
    host.appendChild(p);
  };

  if (detail === null || detail === undefined || detail === "") return empty();

  if (typeof detail === "string") {
    host.textContent = detail;
    return;
  }

  if (Array.isArray(detail)) {
    if (!detail.length) return empty();
    for (const item of detail) {
      if (Array.isArray(item)) {
        const line = document.createElement("div");
        line.className = "bn-info-row-detail-line";
        const a = document.createElement("span");
        a.textContent = String(item[0]);
        const b = document.createElement("span");
        b.textContent = String(item[1]);
        line.append(a, b);
        host.appendChild(line);
      } else {
        const line = document.createElement("div");
        line.textContent = String(item);
        host.appendChild(line);
      }
    }
    return;
  }

  host.textContent = String(detail);
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

  /* The toggle is position:absolute, so it needs its host to be a containing
     block — otherwise it anchors to the nearest positioned ancestor and flies
     off across the page. `.page-stat` is position:static, and all four of its
     toggles on manage_payments ended up stacked in the top-right corner of
     .dashboard-content, ~1300px from the cards they belong to. The owner's
     report was "I cannot see it"; they were visible, just nowhere near their
     card and piled on top of one another.

     Guaranteeing it HERE, where the toggle is created, fixes every host at once
     — including any card added later — instead of chasing each card class
     through the stylesheets. Only promoted when it is actually static, so a host
     that already positions itself is left alone. */
  if (getComputedStyle(card).position === "static") {
    card.style.position = "relative";
  }

  /* RESERVE THE CORNER. The toggle is absolutely positioned, so it is out of
     flow and the card's own content runs straight underneath it. Measured on
     the admin dashboard at 390px: "MWK 395,400.00" ran 19px under the button,
     the Collections label 13px, and a stat value 18px — the figure the card
     exists to show, sitting behind a button.

     Marking the host here (rather than per card class in CSS) covers every
     card that ever gets a toggle, including ones added later — the same reason
     the position promotion above lives here. The width is claimed in CSS via
     .bn-info-host so a card can still override it if it genuinely needs to. */
  /* WHICH SIDE to reserve depends on how the card lays its content out, and
     getting this wrong makes things worse rather than better:
       - Left-aligned card -> reserve on the RIGHT. Content simply wraps earlier
         and nothing moves visually.
       - CENTRE-aligned card -> reserving on the right would shove a centred
         value off-centre and squeeze it (the stat tiles on manage_payments are
         only 120px wide; 42px of right padding leaves 62px for "MWK 505,100.00").
         Reserve ABOVE instead, so the toggle's row is empty and the value keeps
         the full width it needs.
     Decided from the host's own computed alignment rather than a hard-coded
     list of card classes, so a card added later is handled without touching
     this file. */
  /* THE TOGGLE SITS HALF OUTSIDE THE CARD, straddling the top-right corner, so
     it never covers the card's own content.
     That was the original intent, and it failed for one reason: a host with
     `overflow: hidden` CLIPS anything overhanging its box, so the button simply
     vanished (the owner's "I cannot see it"). Moving it inside fixed the
     clipping but then it obstructed the figures instead — trading one fault for
     the other.
     The actual fix is to stop the host clipping it. Done here, inline, for the
     same reason as the position promotion above: it beats any stylesheet rule
     and covers every card at once, including ones added later. */
  if (getComputedStyle(card).overflow !== "visible") {
    card.style.overflow = "visible";
  }

  /* RESERVE THE OVERHANG IN THE CONTAINER — the other half of not clipping it.
     Unclipping the host lets the button paint outside the card, but on the
     card nearest a container's right edge that overhang lands outside the
     CONTAINER too, and so outside the page: measured on admin_dashboard at
     400px, the toggle's right edge sat at 408 and the document scrolled
     sideways to 415. Hiding the toggles alone took the page back to exactly
     400, which is what identified this as the cause rather than the wide
     charts everyone suspected.
     `.page-stats` already reserves 16px statically for exactly this reason.
     Doing it here instead covers EVERY container on every page, including ones
     added later, which is the same argument as the two fixes above.
     Only grown, never shrunk, and marked so a container with several cards is
     only measured once. */
  const parent = card.parentElement;
  if (parent && !parent.dataset.bnInfoGutter) {
    parent.dataset.bnInfoGutter = "1";
    const OVERHANG = 14; // 13px inset + the button's 1px border
    const ps = getComputedStyle(parent);
    if ((parseFloat(ps.paddingRight) || 0) < OVERHANG) {
      parent.style.paddingRight = `${OVERHANG}px`;
    }
    if ((parseFloat(ps.paddingTop) || 0) < OVERHANG) {
      parent.style.paddingTop = `${OVERHANG}px`;
    }
  }

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
