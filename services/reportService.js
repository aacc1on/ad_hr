/**
 * services/reportService.js
 *
 * Report generation service.
 * Produces CSV exports of reconciliation results for download.
 *
 * Available exports:
 *   - Full report (all categories)
 *   - Per-category report
 *   - Summary statistics (JSON)
 */

const db = require('../config/db');

/**
 * escapeCSV(value)
 * Escapes a single value for CSV output.
 * Wraps in quotes if it contains commas, quotes, or newlines.
 *
 * @param {any} value
 * @returns {string}
 */
function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * rowToCSV(fields)
 * Converts an array of values to a CSV row string.
 *
 * @param {any[]} fields
 * @returns {string}
 */
function rowToCSV(fields) {
  return fields.map(escapeCSV).join(',');
}

/**
 * generateFullReport(analysisId)
 * Returns a complete CSV string with all reconciliation results for an analysis.
 * Includes AD data, HR data, category, severity, and match score.
 *
 * @param {number} analysisId
 * @returns {string} - CSV content
 */
function generateFullReport(analysisId) {
  // Header row
  const headers = [
    'Category',
    'Severity',
    'Match Score',
    'AD Sam Account',
    'AD Display Name',
    'AD Email',
    'AD Department',
    'AD Tabel',
    'HR Employee Name',
    'HR Email',
    'HR Department',
    'HR Tabel',
    'Description',
  ];

  const rows = [rowToCSV(headers)];

  // Query: join results with AD and HR records
  const results = db.prepare(`
    SELECT
      rr.category,
      rr.severity,
      rr.match_score,
      rr.description,
      ad.sam_account_name,
      ad.display_name  AS ad_display_name,
      ad.mail          AS ad_mail,
      ad.department    AS ad_department,
      ad.tabel_number  AS ad_tabel,
      hr.employee_name,
      hr.email         AS hr_email,
      hr.department    AS hr_department,
      hr.tabel_number  AS hr_tabel
    FROM reconciliation_results rr
    LEFT JOIN ad_records ad ON rr.ad_record_id = ad.id
    LEFT JOIN hr_records hr ON rr.hr_record_id = hr.id
    WHERE rr.analysis_id = ?
    ORDER BY
      CASE rr.severity
        WHEN 'HIGH'   THEN 1
        WHEN 'MEDIUM' THEN 2
        WHEN 'LOW'    THEN 3
        ELSE               4
      END,
      rr.category
  `).all(analysisId);

  for (const r of results) {
    rows.push(rowToCSV([
      r.category,
      r.severity,
      r.match_score || '',
      r.sam_account_name || '',
      r.ad_display_name  || '',
      r.ad_mail          || '',
      r.ad_department    || '',
      r.ad_tabel         || '',
      r.employee_name    || '',
      r.hr_email         || '',
      r.hr_department    || '',
      r.hr_tabel         || '',
      r.description      || '',
    ]));
  }

  return rows.join('\n');
}

/**
 * generateCategoryReport(analysisId, category)
 * Returns a CSV filtered to a single category.
 *
 * @param {number} analysisId
 * @param {string} category
 * @returns {string}
 */
function generateCategoryReport(analysisId, category) {
  const headers = [
    'AD Sam Account',
    'AD Display Name',
    'AD Email',
    'AD Department',
    'AD Tabel',
    'HR Employee Name',
    'HR Email',
    'HR Department',
    'HR Tabel',
    'Severity',
    'Match Score',
    'Description',
  ];

  const rows = [rowToCSV(headers)];

  const results = db.prepare(`
    SELECT
      rr.severity,
      rr.match_score,
      rr.description,
      ad.sam_account_name,
      ad.display_name  AS ad_name,
      ad.mail          AS ad_mail,
      ad.department    AS ad_dept,
      ad.tabel_number  AS ad_tabel,
      hr.employee_name,
      hr.email         AS hr_email,
      hr.department    AS hr_dept,
      hr.tabel_number  AS hr_tabel
    FROM reconciliation_results rr
    LEFT JOIN ad_records ad ON rr.ad_record_id = ad.id
    LEFT JOIN hr_records hr ON rr.hr_record_id = hr.id
    WHERE rr.analysis_id = ? AND rr.category = ?
  `).all(analysisId, category);

  for (const r of results) {
    rows.push(rowToCSV([
      r.sam_account_name || '',
      r.ad_name          || '',
      r.ad_mail          || '',
      r.ad_dept          || '',
      r.ad_tabel         || '',
      r.employee_name    || '',
      r.hr_email         || '',
      r.hr_dept          || '',
      r.hr_tabel         || '',
      r.severity         || '',
      r.match_score      || '',
      r.description      || '',
    ]));
  }

  return rows.join('\n');
}


function getAnalysisSummary(analysisId) {
  const analysis = db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(analysisId);
  if (!analysis) return null;

  const categoryCounts = db.prepare(`
    SELECT category, COUNT(*) AS count
    FROM reconciliation_results
    WHERE analysis_id = ?
    GROUP BY category
  `).all(analysisId);

  const counts = {};
  for (const row of categoryCounts) counts[row.category] = row.count;

  const matched = counts['MATCHED']        || 0;
  const ghost   = counts['GHOST_ACCOUNT']  || 0;
  const missing = counts['MISSING_ACCOUNT']|| 0;
  const total   = Math.max(analysis.total_ad_records || 1, 1);

  return {
    analysis,
    counts,
    matched,
    ghost,
    missing,
    emailMismatch:    counts['EMAIL_MISMATCH']   || 0,
    tabelMismatch:    counts['TABEL_MISMATCH']   || 0,
    missingAttr1:     counts['MISSING_ATTR1']    || 0,
    driver:           counts['DRIVER']           || 0,
    duplicateTabel:   counts['DUPLICATE_TABEL']  || 0,
    matchPercentage:  Math.round((matched / total) * 100),
    duplicatesSkipped: analysis.duplicates_skipped || 0,
  };
}

async function generateExcelReport(analysisId) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();

  const SHEETS = [
    { key: 'GHOST_ACCOUNT',   name: 'Ghost (AD only)'  },
    { key: 'MISSING_ACCOUNT', name: 'Missing in AD'    },
    { key: 'TABEL_MISMATCH',  name: 'Tabel Mismatch'   },
    { key: 'EMAIL_MISMATCH',  name: 'Email Mismatch'   },
    { key: 'MISSING_ATTR1',   name: 'No extAttr1'      },
    { key: 'DRIVER',          name: 'Drivers'          },
    { key: 'MATCHED',         name: 'Matched OK'       },
    { key: 'DUPLICATE_TABEL', name: 'Duplicate Tabels' },
  ];

  for (const s of SHEETS) {
    const rows = db.prepare(`
      SELECT
        rr.severity, rr.description,
        ad.sam_account_name, ad.display_name AS ad_name,
        ad.mail AS ad_mail, ad.tabel_number AS ad_tabel,
        ad.department AS ad_dept, ad.extensionAttr10 AS ad_type,
        ad.account_expiry, ad.last_logon,
        hr.employee_name AS hr_name, hr.email AS hr_email,
        hr.tabel_number AS hr_tabel, hr.department AS hr_dept,
        hr.position AS hr_position, hr.source_file
      FROM reconciliation_results rr
      LEFT JOIN ad_records ad ON rr.ad_record_id = ad.id
      LEFT JOIN hr_records hr ON rr.hr_record_id = hr.id
      WHERE rr.analysis_id = ? AND rr.category = ?
    `).all(analysisId, s.key);

    const ws = wb.addWorksheet(s.name);

    if (!rows.length) {
      ws.addRow(['No records in this category']);
      continue;
    }

    const cols = Object.keys(rows[0]);
    const hdr  = ws.addRow(cols);
    hdr.font   = { bold: true };
    hdr.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a4d2c' } };
    hdr.font   = { bold: true, color: { argb: 'FFe2e8f0' } };

    for (const row of rows) ws.addRow(cols.map(c => row[c] ?? ''));
    ws.columns.forEach(col => { col.width = 24; });
  }

  return wb.xlsx.writeBuffer();
}

module.exports = {
  generateFullReport,
  generateCategoryReport,
  getAnalysisSummary,
  generateExcelReport,
};
