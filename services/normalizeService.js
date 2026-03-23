/**
 * services/normalizeService.js
 *
 * Data normalization utilities.
 * Ensures consistent formatting of key fields before comparison.
 *
 * Why normalization matters:
 *   "003627" vs "3627" → same employee, but string equality fails.
 *   "a.petrosyan@UCOM.AM" vs "a.petrosyan@ucom.am" → same email, different case.
 *   Without normalization, valid matches are missed.
 */

/**
 * normalizeTabel(raw)
 * Normalizes an employee Tabel number to exactly 6 digits (zero-padded).
 *
 * Rules:
 *   - Strip all non-digit characters
 *   - If empty or non-numeric → return null
 *   - Zero-pad to 6 digits
 *   - If longer than 6 digits → keep as-is (data anomaly, don't truncate)
 *
 * Examples:
 *   normalizeTabel('3627')   → '003627'
 *   normalizeTabel('003627') → '003627'
 *   normalizeTabel('  3627 ')→ '003627'
 *   normalizeTabel('ABC')    → null
 *   normalizeTabel('')       → null
 *
 * @param {any} raw - Raw value from Excel cell or CSV field
 * @returns {string|null}
 */
function normalizeTabel(raw) {
  if (raw === null || raw === undefined) return null;

  // Convert to string and strip non-digit characters
  const digits = String(raw).trim().replace(/\D/g, '');

  if (!digits) return null;

  // Zero-pad to 6 digits minimum
  return digits.padStart(6, '0');
}

/**
 * normalizeEmail(raw)
 * Normalizes an email address: lowercase, trimmed.
 * Handles the @u.ucom.am → @ucom.am driver account alias.
 *
 * @param {any} raw
 * @returns {string|null}
 */
function normalizeEmail(raw) {
  if (!raw) return null;

  const email = String(raw).toLowerCase().trim();

  if (!email || !email.includes('@')) return null;

  return email;
}

/**
 * normalizeString(raw)
 * General-purpose string normalizer:
 *   - Trim whitespace
 *   - Collapse internal whitespace to single space
 *   - Lowercase
 *
 * Used for name and department comparisons.
 *
 * @param {any} raw
 * @returns {string}
 */
function normalizeString(raw) {
  if (!raw) return '';
  return String(raw).toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * normalizeDisplayName(raw)
 * Normalizes a person's display name for fuzzy matching.
 * Removes punctuation, normalizes Armenian/Latin characters.
 *
 * @param {any} raw
 * @returns {string}
 */
function normalizeDisplayName(raw) {
  if (!raw) return '';
  return String(raw)
    .toLowerCase()
    .trim()
    .replace(/[.,\-_'"]/g, ' ')  // replace punctuation with space
    .replace(/\s+/g, ' ')         // collapse spaces
    .trim();
}

/**
 * cellValue(cell)
 * Safely extracts a string value from an ExcelJS cell.
 * Handles rich text, formula results, hyperlinks, and nulls.
 *
 * @param {object} cell - ExcelJS cell object
 * @returns {string}
 */
function cellValue(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return '';

  const v = cell.value;

  // ExcelJS rich text object: { richText: [{text: '...'}] }
  if (typeof v === 'object' && v.richText) {
    return v.richText.map(rt => rt.text || '').join('').trim();
  }

  // ExcelJS hyperlink: { text: '...', hyperlink: '...' }
  if (typeof v === 'object' && v.text !== undefined) {
    return String(v.text).trim();
  }

  // ExcelJS formula result: { formula: '...', result: ... }
  if (typeof v === 'object' && v.result !== undefined) {
    return String(v.result).trim();
  }

  // Date object
  if (v instanceof Date) {
    return v.toISOString().split('T')[0];
  }

  return String(v).trim();
}

module.exports = {
  normalizeTabel,
  normalizeEmail,
  normalizeString,
  normalizeDisplayName,
  cellValue,
};
