/**
 * Bank Nkhonde Modal Utility
 * Provides global modal open/close functionality
 * 
 * NOTE: This file is loaded as a regular script (not a module)
 * so it can be used across all pages without import statements
 */

// Global modal open function
window.openModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    // Reset any pointer events that might be disabled
    document.body.style.pointerEvents = 'auto';
    
    modal.classList.add('active');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.style.pointerEvents = 'auto';
    document.body.style.overflow = 'hidden';
    
    // Focus the modal for accessibility
    const firstFocusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (firstFocusable) {
      setTimeout(() => firstFocusable.focus(), 100);
    }
  }
};

// Global modal close function
window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    modal.classList.add('hidden');
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
};

// Close all open modals
window.closeAllModals = function() {
  const modals = document.querySelectorAll('.modal-overlay');
  modals.forEach(modal => {
    modal.classList.remove('active');
    modal.classList.add('hidden');
    modal.style.display = 'none';
  });
  document.body.style.overflow = '';
};

// Setup all modals on page load
document.addEventListener('DOMContentLoaded', function() {
  setupModalClosers();
});

// Setup modal close handlers
function setupModalClosers() {
  // Find all modal overlays
  const modals = document.querySelectorAll('.modal-overlay');
  
  modals.forEach(modal => {
    // Ensure modal starts hidden
    if (!modal.classList.contains('active')) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
    
    // Close on overlay click (outside modal content)
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closeModal(modal.id);
      }
    });
    
    // Close on close button click (X button)
    const closeButtons = modal.querySelectorAll('.modal-close');
    closeButtons.forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeModal(modal.id);
      });
    });
    
    // Close on cancel button click
    const cancelButtons = modal.querySelectorAll('[data-close-modal], .btn-ghost');
    cancelButtons.forEach(btn => {
      // Only add listener if button is meant to close modal
      if (btn.id && (btn.id.includes('cancel') || btn.id.includes('Cancel') || btn.id.includes('close') || btn.id.includes('Close'))) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          closeModal(modal.id);
        });
      }
    });
  });
  
  // Close on escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });
}

// Re-run setup when DOM changes (for dynamically added modals)
window.refreshModalSetup = setupModalClosers;
