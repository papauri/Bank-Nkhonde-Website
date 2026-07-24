/**
 * ui.js — the shared UI kit.
 *
 * Every page had grown its own near-identical `emptyState(icon, text)` and had
 * no loading or status primitives at all, so screens drifted apart and empty
 * states were dead ends. These are the canonical builders.
 *
 * All DOM is built with createElement/textContent — this module never assigns
 * innerHTML, so nothing here can become an injection point.
 * Pairs with the component CSS in styles/design-system.css.
 */

/**
 * An empty state that tells the user what happened AND what to do next.
 *
 * @param {Object} opts
 * @param {string} opts.icon emoji/glyph
 * @param {string} opts.title short statement of the situation
 * @param {string=} opts.description optional supporting line
 * @param {Array<{label: string, onClick: (function()|undefined),
 *                href: (string|undefined), variant: (string|undefined)}>=}
 *        opts.actions what the user can do from here
 * @param {boolean=} opts.good true when "empty" is a GOOD outcome (all caught
 *        up), so it doesn't read like missing data
 * @return {HTMLElement}
 */
export function emptyState(opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "empty-state" + (opts.good ? " is-good" : "");

  if (opts.icon) {
    const icon = document.createElement("div");
    icon.className = "empty-state-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = opts.icon;
    wrap.appendChild(icon);
  }

  if (opts.title) {
    const t = document.createElement("div");
    t.className = "empty-state-title";
    t.textContent = opts.title;
    wrap.appendChild(t);
  }

  if (opts.description) {
    const d = document.createElement("p");
    d.className = "empty-state-text";
    d.textContent = opts.description;
    wrap.appendChild(d);
  }

  const actions = Array.isArray(opts.actions) ? opts.actions.filter(Boolean) : [];
  if (actions.length) {
    const row = document.createElement("div");
    row.className = "empty-state-actions";
    actions.forEach((a) => {
      // A navigation target is a real link (middle-click, open-in-new-tab all
      // work); an in-page action is a real button.
      const el = document.createElement(a.href ? "a" : "button");
      el.className = `btn btn-${a.variant || "secondary"} btn-sm`;
      el.textContent = a.label;
      if (a.href) {
        el.href = a.href;
      } else {
        el.type = "button";
        if (a.onClick) el.addEventListener("click", a.onClick);
      }
      row.appendChild(el);
    });
    wrap.appendChild(row);
  }

  return wrap;
}

/**
 * Skeleton rows shaped like table rows, so the layout holds its place while
 * data loads instead of collapsing and snapping back.
 * @param {number} rows
 * @param {number} cols
 * @return {DocumentFragment}
 */
export function skeletonRows(rows = 5, cols = 4) {
  const frag = document.createDocumentFragment();
  for (let r = 0; r < rows; r++) {
    const tr = document.createElement("tr");
    // Decorative: hidden from assistive tech, which should hear the real
    // content once it arrives, not a run of placeholder cells.
    tr.setAttribute("aria-hidden", "true");
    for (let c = 0; c < cols; c++) {
      const td = document.createElement("td");
      const line = document.createElement("div");
      line.className = "sk sk-line";
      // Vary the widths so it reads as content, not a block of identical bars.
      line.style.width = c === 0 ? "70%" : c === cols - 1 ? "40%" : "55%";
      td.appendChild(line);
      tr.appendChild(td);
    }
    frag.appendChild(tr);
  }
  return frag;
}

/**
 * Skeleton stat tiles, for a card/tile grid that is still loading.
 * @param {number} count
 * @return {DocumentFragment}
 */
export function skeletonTiles(count = 4) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const tile = document.createElement("div");
    tile.className = "sk-tile";
    tile.setAttribute("aria-hidden", "true");
    const label = document.createElement("div");
    label.className = "sk sk-line w-40";
    const figure = document.createElement("div");
    figure.className = "sk sk-figure";
    tile.append(label, figure);
    frag.appendChild(tile);
  }
  return frag;
}

/**
 * A status pill. The dot means status is never carried by colour alone.
 * @param {string} text
 * @param {string=} tone "success" | "warning" | "danger" | "info" | ""
 * @return {HTMLElement}
 */
export function statusPill(text, tone) {
  const el = document.createElement("span");
  el.className = "status-pill" + (tone ? ` is-${tone}` : "");
  el.textContent = text;
  return el;
}

/**
 * Map a payment/loan status string onto a pill tone, so the same status always
 * looks the same everywhere in the app.
 * @param {string} status
 * @return {string}
 */
export function toneForStatus(status) {
  const s = String(status || "").toLowerCase();
  if (["approved", "completed", "paid", "active", "disbursed"].includes(s)) return "success";
  if (["pending", "submitted", "awaiting"].includes(s)) return "warning";
  if (["rejected", "cancelled", "defaulted", "overdue"].includes(s)) return "danger";
  return "info";
}

/**
 * A consistent section header: title, optional explanatory line, optional
 * actions on the right.
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string=} opts.description
 * @param {Array<HTMLElement>=} opts.actions
 * @return {HTMLElement}
 */
export function sectionHead(opts = {}) {
  const head = document.createElement("div");
  head.className = "section-head";

  const text = document.createElement("div");
  text.className = "section-head-text";
  const title = document.createElement("h2");
  title.className = "section-head-title";
  title.textContent = opts.title || "";
  text.appendChild(title);

  if (opts.description) {
    const d = document.createElement("p");
    d.className = "section-head-desc";
    d.textContent = opts.description;
    text.appendChild(d);
  }
  head.appendChild(text);

  if (Array.isArray(opts.actions) && opts.actions.length) {
    const acts = document.createElement("div");
    acts.className = "section-head-actions";
    opts.actions.forEach((a) => a && acts.appendChild(a));
    head.appendChild(acts);
  }

  return head;
}

/**
 * Make a `.page-stat` summary tile interactive.
 *
 * These tiles show the headline figures at the top of most admin pages and
 * were entirely dead — a user naturally taps "Pending: 4" expecting to be
 * shown those four things. This wires that expectation up.
 *
 * The tile becomes a real button (keyboard-operable, announced as
 * interactive) rather than a div with a click handler, and is idempotent so a
 * re-render never double-wires it.
 *
 * @param {string} valueElId id of the `.page-stat-value` inside the tile
 * @param {Object} opts
 * @param {function()=} opts.onClick in-page action (filter, switch tab…)
 * @param {string=} opts.href navigate instead
 * @param {string=} opts.label accessible description of what happens
 * @param {string=} opts.info optional "i" explainer text
 * @return {?HTMLElement} the tile, or null when not on this page
 */
export function makeStatClickable(valueElId, opts = {}) {
  const value = document.getElementById(valueElId);
  const tile = value ? value.closest(".page-stat") : null;
  if (!tile) return null;

  if (!opts.onClick && !opts.href) return tile;

  // Idempotent — a second call must not stack another listener.
  if (tile.dataset.bnClickable === "1") return tile;
  tile.dataset.bnClickable = "1";

  tile.classList.add("is-clickable");
  tile.setAttribute("role", "button");
  tile.setAttribute("tabindex", "0");
  if (opts.label) tile.setAttribute("aria-label", opts.label);

  const activate = () => {
    if (opts.href) {
      window.location.href = opts.href;
    } else if (opts.onClick) {
      opts.onClick();
    }
  };

  tile.addEventListener("click", (e) => {
    // Never swallow a click meant for the info toggle sitting in the corner.
    if (e.target.closest(".bn-info-toggle")) return;
    activate();
  });
  tile.addEventListener("keydown", (e) => {
    if (e.target !== tile) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  });

  return tile;
}

/**
 * Scroll an element into view — the honest destination for a summary figure
 * whose detail is already further down the same page.
 * @param {string} id
 * @return {function()}
 */
export function scrollToId(id) {
  return () => {
    document.getElementById(id)?.scrollIntoView({behavior: "smooth", block: "start"});
  };
}
