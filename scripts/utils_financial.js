// utils_financial.js
//
// Single canonical DISPLAY-ONLY money formatter for Bank Nkhonde.
// All aggregation, rounding of raw sums, and arithmetic happen server-side
// (see money_from_minor() and friends in the PHP/MySQL API layer). This
// module never sums, multiplies, divides, or subtracts amounts — it only
// formats already-computed values for presentation.
//
// Two input shapes are supported so every caller can migrate independently:
//   - formatCurrency(value): number or numeric string in whole MWK (2dp)
//   - formatCurrencyFromMinor(minorUnits): integer count of minor units
//     (1/100 MWK), divided by 100 purely for display.
//
// Values always round (never truncate) to exactly 2 decimal places, with
// comma thousands grouping and an "MWK " prefix. Invalid/non-finite input
// renders as "MWK 0.00".

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a whole-MWK numeric value (number or numeric string) as
 * "MWK 1,234.00". Rounds to 2dp; never truncates.
 * @param {number|string} value
 * @returns {string}
 */
export function formatCurrency(value) {
  const numeric = typeof value === "string" ? value.trim() : value;
  const parsed = Number(numeric);

  if (numeric === "" || numeric === null || numeric === undefined || !Number.isFinite(parsed)) {
    return "MWK 0.00";
  }

  return `MWK ${CURRENCY_FORMATTER.format(parsed)}`;
}

/**
 * Format an integer count of minor units (1/100 MWK) as "MWK 1,234.00".
 * Division by 100 is for display purposes only — no aggregation happens
 * here.
 * @param {number|string} minorUnits
 * @returns {string}
 */
export function formatCurrencyFromMinor(minorUnits) {
  const numeric = typeof minorUnits === "string" ? minorUnits.trim() : minorUnits;
  const parsed = Number(numeric);

  if (numeric === "" || numeric === null || numeric === undefined || !Number.isFinite(parsed)) {
    return "MWK 0.00";
  }

  return `MWK ${CURRENCY_FORMATTER.format(parsed / 100)}`;
}
