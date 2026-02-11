# Shared Top Navigation Implementation Guide

## Overview
The shared top navigation component (`shared-top-nav.js`) provides a consistent navigation bar across all user pages, eliminating code duplication and simplifying maintenance.

## How to Use

### 1. Remove existing top-nav HTML from your page

Delete the entire `<nav class="top-nav">...</nav>` section and mobile menu HTML:
- Remove `<nav class="top-nav">` through `</nav>`
- Remove `<div class="mobile-menu-overlay">` 
- Remove `<div class="mobile-menu">`

### 2. Add the shared navigation script

Add this script tag **before** your page-specific scripts (right before `</body>`):

```html
<script src="../scripts/shared-top-nav.js"></script>
<script>
  // Initialize navigation
  initTopNav({
    showGroupDisplay: false,  // Set true for user_dashboard.html
    showViewToggle: false,     // Set true if page supports admin view toggle
    logoLink: 'user_dashboard.html'  // Link for the Bank Nkhonde logo
  });
</script>
```

### 3. Keep your page-specific navigation CSS

The navigation uses these CSS classes which should remain in your stylesheets:
- `.top-nav`
- `.top-nav-container`
- `.top-nav-logo`, `.top-nav-logo-icon`, `.top-nav-logo-text`
- `.top-nav-actions`, `.top-nav-btn`, `.top-nav-avatar`
- `.mobile-menu-btn`, `.mobile-menu`, `.mobile-menu-overlay`
- `.current-group-display` (for user_dashboard.html)
- `.view-toggle` (for pages with admin toggle)

## Configuration Options

### `showGroupDisplay` (boolean, default: false)
Shows the current group selector. Only needed for `user_dashboard.html`.

```javascript
initTopNav({
  showGroupDisplay: true  // Shows "Current Group: XYZ" display
});
```

### `showViewToggle` (boolean, default: false)
Shows the Admin/User view toggle button. Use on pages that support switching between user and admin views.

```javascript
initTopNav({
  showViewToggle: true  // Shows Admin/User toggle
});
```

### `logoLink` (string, default: 'user_dashboard.html')
The destination when clicking the Bank Nkhonde logo.

```javascript
initTopNav({
  logoLink: '../index.html'  // Custom logo link
});
```

## Example Conversions

### Standard User Page (e.g., loan_payments.html)

**Before:**
```html
<body class="user-page">
  <!-- Top Navigation -->
  <nav class="top-nav">
    <div class="top-nav-container">
      <!-- ... lots of HTML ... -->
    </div>
  </nav>
  <!-- Mobile Menu Overlay & Sidebar -->
  <div class="mobile-menu-overlay">...</div>
  <div class="mobile-menu">...</div>
  
  <!-- Page Header -->
  <header class="page-header">...</header>
  
  <!-- Scripts -->
  <script src="../scripts/loan_payments.js"></script>
</body>
```

**After:**
```html
<body class="user-page">
  <!-- Page Header -->
  <header class="page-header">...</header>
  
  <!-- Scripts -->
  <script src="../scripts/shared-top-nav.js"></script>
  <script>
    initTopNav({
      logoLink: 'user_dashboard.html'
    });
  </script>
  <script type="module" src="../scripts/loan_payments.js"></script>
</body>
```

### User Dashboard (user_dashboard.html)

```html
<body>
  <!-- Page content here -->
  
  <!-- Scripts -->
  <script src="../scripts/shared-top-nav.js"></script>
  <script>
    initTopNav({
      showGroupDisplay: true,    // Shows current group selector
      showViewToggle: true,       // Shows Admin/User toggle
      logoLink: '../index.html'
    });
  </script>
  <script type="module" src="../scripts/user_dashboard.js"></script>
</body>
```

## Benefits

✅ **Single Source of Truth**: Navigation markup exists in one file  
✅ **Easy Updates**: Change navigation once, applies everywhere  
✅ **Consistency**: All pages have identical navigation  
✅ **Reduced Code**: ~100 lines removed from each page  
✅ **Maintainability**: Easier to add new navigation features

## Notes

- The script automatically initializes mobile menu handlers
- Logout handlers are provided by default
- The script injects navigation at the start of `<body>`
- All existing navigation event handlers should continue to work
- The script is vanilla JavaScript with no dependencies
