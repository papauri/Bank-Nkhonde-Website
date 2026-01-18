/**
 * Date of Birth Validation Utility
 * Ensures all DOB inputs only allow dates that make the user at least 18 years old
 */

(function() {
  'use strict';

  /**
   * Calculate the maximum date for DOB (18 years ago from today)
   * @returns {string} Date string in YYYY-MM-DD format
   */
  function getMaxDateOfBirth() {
    const today = new Date();
    const maxDate = new Date(today);
    maxDate.setFullYear(today.getFullYear() - 18);
    
    // Format as YYYY-MM-DD
    const year = maxDate.getFullYear();
    const month = String(maxDate.getMonth() + 1).padStart(2, '0');
    const day = String(maxDate.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }

  /**
   * Calculate minimum date for DOB (optional - e.g., 120 years ago for reasonable upper limit)
   * @returns {string} Date string in YYYY-MM-DD format
   */
  function getMinDateOfBirth() {
    const today = new Date();
    const minDate = new Date(today);
    minDate.setFullYear(today.getFullYear() - 120);
    
    const year = minDate.getFullYear();
    const month = String(minDate.getMonth() + 1).padStart(2, '0');
    const day = String(minDate.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }

  /**
   * Validate if a date of birth makes the user at least 18 years old
   * @param {string} dateOfBirth - Date string in YYYY-MM-DD format
   * @returns {Object} { isValid: boolean, age: number, error: string }
   */
  function validateAge(dateOfBirth) {
    if (!dateOfBirth) {
      return { isValid: false, age: 0, error: 'Date of birth is required' };
    }

    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    
    if (isNaN(birthDate.getTime())) {
      return { isValid: false, age: 0, error: 'Invalid date format' };
    }

    // Calculate age
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    if (age < 18) {
      return { 
        isValid: false, 
        age: age, 
        error: `You must be at least 18 years old. You are currently ${age} years old.` 
      };
    }

    if (age > 120) {
      return { 
        isValid: false, 
        age: age, 
        error: 'Please enter a valid date of birth' 
      };
    }

    return { isValid: true, age: age, error: null };
  }

  /**
   * Setup DOB validation for all date of birth input fields
   */
  function setupDOBValidation() {
    const dobInputs = document.querySelectorAll('input[type="date"][id*="DOB"], input[type="date"][id*="dateOfBirth"], input[type="date"][id*="dob"]');
    
    const maxDate = getMaxDateOfBirth();
    const minDate = getMinDateOfBirth();

    dobInputs.forEach(input => {
      // Set max and min attributes
      input.setAttribute('max', maxDate);
      input.setAttribute('min', minDate);
      
      // Add validation on change
      input.addEventListener('change', function() {
        const validation = validateAge(this.value);
        
        if (!validation.isValid) {
          this.setCustomValidity(validation.error);
          this.reportValidity();
        } else {
          this.setCustomValidity('');
        }
      });

      // Add validation on blur
      input.addEventListener('blur', function() {
        if (this.value) {
          const validation = validateAge(this.value);
          
          if (!validation.isValid) {
            this.setCustomValidity(validation.error);
            this.reportValidity();
          } else {
            this.setCustomValidity('');
          }
        }
      });

      // Clear custom validity on input (to allow typing)
      input.addEventListener('input', function() {
        if (this.value) {
          const validation = validateAge(this.value);
          if (validation.isValid) {
            this.setCustomValidity('');
          }
        }
      });
    });
  }

  /**
   * Validate DOB before form submission
   * @param {HTMLInputElement} dobInput - Date of birth input element
   * @returns {boolean} True if valid, false otherwise
   */
  function validateDOBOnSubmit(dobInput) {
    if (!dobInput || !dobInput.value) {
      return true; // Allow empty DOB if not required
    }

    const validation = validateAge(dobInput.value);
    
    if (!validation.isValid) {
      dobInput.setCustomValidity(validation.error);
      dobInput.reportValidity();
      return false;
    }

    dobInput.setCustomValidity('');
    return true;
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDOBValidation);
  } else {
    setupDOBValidation();
  }

  // Export functions for use in other scripts
  window.DOBValidation = {
    validateAge: validateAge,
    getMaxDateOfBirth: getMaxDateOfBirth,
    getMinDateOfBirth: getMinDateOfBirth,
    setupDOBValidation: setupDOBValidation,
    validateDOBOnSubmit: validateDOBOnSubmit
  };
})();
