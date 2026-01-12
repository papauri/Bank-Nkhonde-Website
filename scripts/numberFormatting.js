/**
 * Number Formatting Utilities
 * Format numbers with commas for display and parsing
 */

/**
 * Format number with commas (e.g., 10000 -> "10,000")
 */
export function formatNumberWithCommas(value) {
  if (value === null || value === undefined || value === '') return '';
  
  // Remove existing commas and parse
  const numValue = typeof value === 'string' ? value.replace(/,/g, '') : value;
  const num = parseFloat(numValue);
  
  if (isNaN(num)) return value;
  
  // Format with commas
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

/**
 * Parse number from formatted string (e.g., "10,000" -> 10000)
 */
export function parseFormattedNumber(value) {
  if (!value) return null;
  
  // Remove commas and parse
  const cleaned = String(value).replace(/,/g, '');
  const parsed = parseFloat(cleaned);
  
  return isNaN(parsed) ? null : parsed;
}

/**
 * Format number input on input event
 */
export function setupNumberInputFormatting(inputElement) {
  if (!inputElement) return;
  
  let isComposing = false;
  
  inputElement.addEventListener('input', (e) => {
    if (isComposing) return;
    
    const cursorPosition = inputElement.selectionStart;
    const originalValue = inputElement.value;
    const cleaned = originalValue.replace(/,/g, '');
    
    // Allow decimal input
    if (cleaned === '' || cleaned === '.') {
      return;
    }
    
    const num = parseFloat(cleaned);
    if (!isNaN(num)) {
      const formatted = formatNumberWithCommas(cleaned);
      inputElement.value = formatted;
      
      // Restore cursor position
      const diff = formatted.length - originalValue.length;
      const newPosition = Math.max(0, Math.min(formatted.length, cursorPosition + diff));
      inputElement.setSelectionRange(newPosition, newPosition);
    }
  });
  
  inputElement.addEventListener('blur', () => {
    const value = parseFormattedNumber(inputElement.value);
    if (value !== null && !isNaN(value)) {
      inputElement.value = formatNumberWithCommas(value);
    }
  });
  
  // Handle composition for better mobile support
  inputElement.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  
  inputElement.addEventListener('compositionend', () => {
    isComposing = false;
  });
}

/**
 * Format percentage input (0-100)
 */
export function setupPercentageInputFormatting(inputElement) {
  if (!inputElement) return;
  
  inputElement.addEventListener('input', (e) => {
    const value = e.target.value.replace(/,/g, '');
    const num = parseFloat(value);
    
    // Allow empty, decimal point, or valid number
    if (value === '' || value === '.' || (!isNaN(num) && num >= 0 && num <= 100)) {
      // Format with up to 2 decimal places
      if (!isNaN(num)) {
        e.target.value = num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      } else {
        e.target.value = value;
      }
    } else {
      // Revert to previous valid value
      e.target.value = e.target.value.slice(0, -1);
    }
  });
  
  inputElement.addEventListener('blur', () => {
    const value = parseFormattedNumber(inputElement.value);
    if (value !== null && !isNaN(value)) {
      const clamped = Math.max(0, Math.min(100, value));
      inputElement.value = clamped.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
  });
}
