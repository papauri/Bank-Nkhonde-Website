/**
 * page-bootstrap.js — standardized nav bootstrap for authenticated pages.
 *
 * Replaces the old, hand-copied inline snippet that used to appear near the
 * end of every authenticated page's <body>:
 *
 *   <script type="module">
 *     import { initNav } from '../scripts/nav_sql.js';
 *     initNav({ variant: 'admin', activePage: 'dashboard', pageTitle: 'Dashboard' });
 *   </script>
 *
 * A page now instead sets its nav config as data-* attributes on <body> and
 * loads this single shared script:
 *
 *   <body data-nav-variant="admin" data-nav-active-page="dashboard" data-nav-page-title="Dashboard">
 *     ...
 *     <script type="module" src="../scripts/page-bootstrap.js?v=20260722"></script>
 *
 * Supported attributes (all read from document.body.dataset):
 *   data-nav-variant        -> initNav({ variant })            required
 *   data-nav-active-page    -> initNav({ activePage })          required
 *   data-nav-page-title     -> initNav({ pageTitle })           optional (admin variant)
 *   data-nav-show-group-display -> initNav({ showGroupDisplay: true }) when "true"
 *   data-nav-show-view-toggle   -> initNav({ showViewToggle: true })   when "true"
 *   data-nav-logo-link          -> initNav({ logoLink })        optional (user variant)
 *
 * Only attributes actually present on <body> are forwarded, so initNav's own
 * defaults (see nav_sql.js) are preserved for pages that don't set them —
 * exactly matching the behaviour of the inline calls this replaces.
 */

import { initNav } from './nav_sql.js';

document.addEventListener('DOMContentLoaded', () => {
  const nav = document.body.dataset;
  const opts = {};

  if (nav.navVariant !== undefined) opts.variant = nav.navVariant;
  if (nav.navActivePage !== undefined) opts.activePage = nav.navActivePage;
  if (nav.navPageTitle !== undefined) opts.pageTitle = nav.navPageTitle;
  if (nav.navShowGroupDisplay !== undefined) opts.showGroupDisplay = nav.navShowGroupDisplay === 'true';
  if (nav.navShowViewToggle !== undefined) opts.showViewToggle = nav.navShowViewToggle === 'true';
  if (nav.navLogoLink !== undefined) opts.logoLink = nav.navLogoLink;

  initNav(opts);
});
