/**
 * services/duplicateService.js
 *
 * Duplicate detection for HR records.
 *
 * A row is considered a DUPLICATE if any of these conditions is true:
 *   1. The Tabel number already exists in the current dataset, OR
 *   2. The Tabel + Email combination already exists.
 *
 * When a duplicate is detected:
 *   - The row is skipped (not added to the dataset)
 *   - A log entry is written via loggerService
 *   - A counter is incremented for reporting
 */

const { logDuplicate } = require('./loggerService');

/**
 * DuplicateFilter
 * Stateful class that tracks seen Tabel numbers and Tabel+Email combos.
 * Create one instance per import session (per file or per analysis).
 *
 * Usage:
 *   const filter = new DuplicateFilter();
 *   const { isDuplicate, reason } = filter.check(row, context);
 *   if (!isDuplicate) dataset.push(row);
 */
class DuplicateFilter {
  constructor() {
    // Set of normalized Tabel numbers already seen
    this._seenTabels = new Set();

    // Set of "tabel|email" composite keys already seen
    this._seenComposites = new Set();

    // Count of duplicates detected this session
    this.duplicateCount = 0;
  }

  /**
   * check(row, context)
   * Tests whether a parsed row is a duplicate.
   * If it's a duplicate, logs it and returns { isDuplicate: true, reason }.
   * If it's new, registers it and returns { isDuplicate: false }.
   *
   * @param {{ tabelNumber: string|null, email: string|null }} row
   * @param {{ file: string, sheet: string, rowNum: number }} context
   * @returns {{ isDuplicate: boolean, reason: string|null }}
   */
  check(row, context) {
    const tabel = row.tabelNumber;
    const email = (row.email || '').toLowerCase().trim();

    // No Tabel → can't detect duplicate by Tabel, skip check
    if (!tabel) {
      return { isDuplicate: false, reason: null };
    }

    const compositeKey = `${tabel}|${email}`;

    // ── Check 1: exact Tabel match ──────────────────────────────────
    if (this._seenTabels.has(tabel)) {
      this.duplicateCount++;
      logDuplicate({
        file:   context.file,
        sheet:  context.sheet,
        tabel,
        rowNum: context.rowNum,
        reason: 'Tabel number already exists',
      });
      return { isDuplicate: true, reason: 'duplicate_tabel' };
    }

    // ── Check 2: Tabel + Email composite match ──────────────────────
    if (email && this._seenComposites.has(compositeKey)) {
      this.duplicateCount++;
      logDuplicate({
        file:   context.file,
        sheet:  context.sheet,
        tabel,
        rowNum: context.rowNum,
        reason: 'Tabel + Email combination already exists',
      });
      return { isDuplicate: true, reason: 'duplicate_tabel_email' };
    }

    // ── Not a duplicate: register this row ─────────────────────────
    this._seenTabels.add(tabel);
    if (email) this._seenComposites.add(compositeKey);

    return { isDuplicate: false, reason: null };
  }

  /**
   * reset()
   * Clears all tracking state (useful if reusing one filter across multiple sheets).
   * Note: Usually you want per-analysis state, so create a new instance instead.
   */
  reset() {
    this._seenTabels.clear();
    this._seenComposites.clear();
    this.duplicateCount = 0;
  }
}

module.exports = { DuplicateFilter };
