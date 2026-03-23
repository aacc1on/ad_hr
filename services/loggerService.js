/**
 * services/loggerService.js
 *
 * File-based logging system.
 * Writes timestamped entries to separate log files:
 *   - import.log    → file import events
 *   - duplicate.log → skipped duplicate rows
 *   - compare.log   → reconciliation results summary
 *   - errors.log    → runtime errors
 *   - audit.log     → user actions
 */

const fs   = require('fs');
const path = require('path');

// Base log directory (from env or default)
const LOG_DIR = path.resolve(process.env.LOG_DIR || './logs');

// Ensure log directory exists on module load
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * formatTimestamp()
 * Returns current time as "YYYY-MM-DD HH:MM:SS".
 */
function formatTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * writeToLog(filename, lines)
 * Appends one or more lines to a log file, each prefixed with timestamp.
 *
 * @param {string}          filename - e.g. 'import.log'
 * @param {string|string[]} lines    - text lines to write
 */
function writeToLog(filename, lines) {
  const filePath = path.join(LOG_DIR, filename);
  const ts       = formatTimestamp();

  // Normalize to array
  const entries = Array.isArray(lines) ? lines : [lines];
  const text    = entries.map(l => `[${ts}] ${l}`).join('\n') + '\n';

  try {
    fs.appendFileSync(filePath, text, 'utf-8');
  } catch (err) {
    // Never crash the app because of logging failure
    console.error(`[Logger] Could not write to ${filename}:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────
// Public helpers — one per log file
// ─────────────────────────────────────────────────────────

/**
 * logImport(info)
 * Records metadata about a file import operation.
 *
 * @param {{ file: string, sheet?: string, rowsProcessed: number, duplicatesSkipped: number }} info
 */
function logImport(info) {
  writeToLog('import.log', [
    `FILE: ${info.file}`,
    `  Sheet: ${info.sheet || 'N/A'}`,
    `  Rows processed:       ${info.rowsProcessed}`,
    `  Duplicates skipped:   ${info.duplicatesSkipped}`,
    '  ─────────────────────────────────────',
  ]);
}

/**
 * logDuplicate(info)
 * Records a single skipped duplicate row.
 *
 * @param {{ file: string, sheet: string, tabel: string, rowNum: number, reason: string }} info
 */
function logDuplicate(info) {
  writeToLog('duplicate.log',
    `SKIP row #${info.rowNum} | Tabel: ${info.tabel} | File: ${info.file} | Sheet: ${info.sheet} | Reason: ${info.reason}`
  );
}

/**
 * logCompare(info)
 * Writes a summary of one reconciliation run.
 *
 * @param {{ analysisId: number, name: string, adTotal: number, hrTotal: number, matched: number, ghosts: number, missing: number, emailMismatch: number, deptMismatch: number }} info
 */
function logCompare(info) {
  writeToLog('compare.log', [
    `ANALYSIS #${info.analysisId}: ${info.name}`,
    `  AD total:             ${info.adTotal}`,
    `  HR total:             ${info.hrTotal}`,
    `  Matched:              ${info.matched}`,
    `  Ghost accounts:       ${info.ghosts}`,
    `  Missing accounts:     ${info.missing}`,
    `  Email mismatches:     ${info.emailMismatch}`,
    `  Department mismatches:${info.deptMismatch}`,
    '  ─────────────────────────────────────',
  ]);
}

/**
 * logError(context, err)
 * Records an error with context information.
 *
 * @param {string} context - Where the error occurred (e.g. 'excelService')
 * @param {Error|string} err
 */
function logError(context, err) {
  const message = err instanceof Error ? err.message : String(err);
  const stack   = err instanceof Error ? (err.stack || '') : '';
  writeToLog('errors.log', [
    `CONTEXT: ${context}`,
    `  Error: ${message}`,
    stack ? `  Stack: ${stack.split('\n')[1] || ''}` : '',
  ].filter(Boolean));
}

/**
 * logAudit(info)
 * Records a user action.
 *
 * @param {{ userId: number|string, username: string, action: string, detail: string, ip?: string }} info
 */
function logAudit(info) {
  writeToLog('audit.log',
    `USER:${info.username}(${info.userId}) | ACTION:${info.action} | ${info.detail}${info.ip ? ` | IP:${info.ip}` : ''}`
  );
}

module.exports = {
  logImport,
  logDuplicate,
  logCompare,
  logError,
  logAudit,
};
