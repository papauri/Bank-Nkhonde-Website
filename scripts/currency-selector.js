/**
 * Currency Selector Module
 * Provides currency selection functionality with MWK as default
 */

// Supported currencies
export const CURRENCIES = {
  MWK: { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MWK', locale: 'en-MW' },
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', locale: 'en-US' },
  ZAR: { code: 'ZAR', name: 'South African Rand', symbol: 'R', locale: 'en-ZA' },
  KES: { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', locale: 'en-KE' },
  TZS: { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', locale: 'sw-TZ' },
  ZMW: { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'K', locale: 'en-ZM' },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', locale: 'en-GB' },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', locale: 'de-DE' },
};

// Default currency
const DEFAULT_CURRENCY = 'MWK';

// Get selected currency from storage or default
export function getSelectedCurrency() {
  const stored = localStorage.getItem('selectedCurrency');
  return CURRENCIES[stored] || CURRENCIES[DEFAULT_CURRENCY];
}

// Set selected currency
export function setSelectedCurrency(currencyCode) {
  if (CURRENCIES[currencyCode]) {
    localStorage.setItem('selectedCurrency', currencyCode);
    // Trigger refresh event
    window.dispatchEvent(new CustomEvent('currencyChanged', { detail: currencyCode }));
    return true;
  }
  return false;
}

// Format amount with selected currency
export function formatCurrency(amount, currencyCode = null) {
  const currency = currencyCode ? CURRENCIES[currencyCode] : getSelectedCurrency();
  const value = parseFloat(amount) || 0;
  
  // Format with locale
  try {
    return `${currency.symbol} ${value.toLocaleString(currency.locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    })}`;
  } catch (e) {
    return `${currency.symbol} ${value.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    })}`;
  }
}

// Format with full currency code
export function formatCurrencyFull(amount, currencyCode = null) {
  const currency = currencyCode ? CURRENCIES[currencyCode] : getSelectedCurrency();
  const value = parseFloat(amount) || 0;
  
  return `${currency.code} ${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

// Create currency selector dropdown
export function createCurrencySelector(containerId, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const currentCurrency = getSelectedCurrency();
  
  const selector = document.createElement('select');
  selector.className = 'currency-selector form-select';
  selector.style.cssText = 'width: auto; padding: 8px 12px; font-size: 13px; min-width: 120px;';
  
  Object.values(CURRENCIES).forEach(currency => {
    const option = document.createElement('option');
    option.value = currency.code;
    option.textContent = `${currency.symbol} ${currency.code}`;
    if (currency.code === currentCurrency.code) {
      option.selected = true;
    }
    selector.appendChild(option);
  });

  selector.addEventListener('change', (e) => {
    setSelectedCurrency(e.target.value);
    if (onChange) onChange(e.target.value);
  });

  container.appendChild(selector);
  return selector;
}

// Initialize currency display throughout page
export function initializeCurrencyDisplay() {
  // Find all elements with data-amount attribute and format them
  document.querySelectorAll('[data-amount]').forEach(el => {
    const amount = parseFloat(el.dataset.amount) || 0;
    el.textContent = formatCurrency(amount);
  });
}

// Listen for currency changes and update display
window.addEventListener('currencyChanged', () => {
  initializeCurrencyDisplay();
});
