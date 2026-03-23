/**
 * services/excelService.js
 *
 * HR Excel file parser.
 * Handles:
 *   - Multiple sheets per workbook (all sheets are processed)
 *   - Flexible column name detection via mappingService
 *   - Tabel normalization via normalizeService
 *   - Duplicate detection via duplicateService
 *   - Import logging via loggerService
 */

const ExcelJS  = require('exceljs');
const path     = require('path');
const { buildHeaderMap }           = require('./mappingService');
const { normalizeTabel, normalizeEmail, cellValue } = require('./normalizeService');
const { DuplicateFilter }          = require('./duplicateService');
const { logImport, logError }      = require('./loggerService');

/**
 * parseHRFile(filePath)
 *
 * Reads all sheets from one Excel file and returns an array of normalized HR records.
 * Skips duplicate rows (by Tabel or Tabel+Email) and logs them.
 *
 * Returns an object:
 * {
 *   records: [{ employeeName, email, tabelNumber, department, position, sourceFile, sourceSheet }],
 *   duplicatesSkipped: number,
 *   sheetsProcessed: string[],
 * }
 *
 * @param {string} filePath - Absolute path to the uploaded Excel file
 * @returns {Promise<{ records: object[], duplicatesSkipped: number, sheetsProcessed: string[] }>}
 */
async function parseHRFile(filePath) {
  const workbook      = new ExcelJS.Workbook();
  const fileName      = path.basename(filePath);
  const allRecords    = [];
  const sheetsProcessed = [];

  // One DuplicateFilter shared across all sheets in this file.
  // This means: if two different sheets contain the same Tabel, only the first is kept.
  const dupFilter = new DuplicateFilter();

  try {
    // Load the workbook (all sheets)
    await workbook.xlsx.readFile(filePath);
  } catch (err) {
    logError('excelService.parseHRFile', err);
    throw new Error(`Cannot read Excel file "${fileName}": ${err.message}`);
  }

  // ── Iterate over every sheet in the workbook ────────────────────────
  for (const worksheet of workbook.worksheets) {
    const sheetName = worksheet.name;

    // Skip hidden sheets
    if (worksheet.state === 'hidden') continue;

    // Skip sheets with fewer than 2 rows (header + at least one data row)
    if (worksheet.rowCount < 2) continue;

    sheetsProcessed.push(sheetName);

    // ── Read header row (row 1) ──────────────────────────────────────
    const headerRow    = worksheet.getRow(1);
    const rawHeaders   = [];

    headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      rawHeaders[colNum - 1] = cellValue(cell);
    });

    // Build colIndex → canonical field name map
    const headerMap = buildHeaderMap(rawHeaders);

    // Check that at least Tabel column was found
    const hasTabell = [...headerMap.values()].includes('tabelNumber');
    if (!hasTabell) {
      // This sheet doesn't look like an HR sheet — skip it silently
      continue;
    }

    let rowsProcessed    = 0;
    let sheetDuplicates  = 0;

    // ── Read each data row (starting from row 2) ─────────────────────
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // skip header

      // Build a raw record by iterating mapped columns
      const raw = {};
      headerMap.forEach((fieldName, colIndex) => {
        raw[fieldName] = cellValue(row.getCell(colIndex));
      });

      // Skip completely empty rows
      if (!raw.tabelNumber && !raw.employeeName && !raw.email) return;

      // Normalize key fields
      const normalized = {
        employeeName: raw.employeeName || '',
        email:        normalizeEmail(raw.email),
        tabelNumber:  normalizeTabel(raw.tabelNumber),
        department:   (raw.department  || '').trim(),
        position:     (raw.position    || '').trim(),
        sourceFile:   fileName,
        sourceSheet:  sheetName,
      };

      // ── Duplicate check ────────────────────────────────────────────
      const dupResult = dupFilter.check(normalized, {
        file:   fileName,
        sheet:  sheetName,
        rowNum: rowNumber,
      });

      if (dupResult.isDuplicate) {
        sheetDuplicates++;
        return; // skip this row
      }

      allRecords.push(normalized);
      rowsProcessed++;
    });

    // Log this sheet's import summary
    logImport({
      file:             fileName,
      sheet:            sheetName,
      rowsProcessed,
      duplicatesSkipped: sheetDuplicates,
    });
  }

  return {
    records:          allRecords,
    duplicatesSkipped: dupFilter.duplicateCount,
    sheetsProcessed,
  };
}

/**
 * parseMultipleHRFiles(filePaths)
 *
 * Parses an array of HR Excel files and merges all records into one dataset.
 * A single DuplicateFilter is NOT shared across files — each file gets its own.
 * Cross-file duplicates (same Tabel in two files) ARE filtered at a later stage
 * by the mergeService.
 *
 * @param {string[]} filePaths
 * @returns {Promise<{ records: object[], totalDuplicates: number, filesSummary: object[] }>}
 */
async function parseMultipleHRFiles(filePaths) {
  const allRecords    = [];
  let totalDuplicates = 0;
  const filesSummary  = [];

  for (const filePath of filePaths) {
    try {
      const result = await parseHRFile(filePath);

      allRecords.push(...result.records);
      totalDuplicates += result.duplicatesSkipped;

      filesSummary.push({
        file:             path.basename(filePath),
        records:          result.records.length,
        duplicatesSkipped: result.duplicatesSkipped,
        sheetsProcessed:  result.sheetsProcessed,
      });
    } catch (err) {
      logError(`excelService.parseMultipleHRFiles[${path.basename(filePath)}]`, err);
      // Continue processing remaining files even if one fails
      filesSummary.push({
        file:  path.basename(filePath),
        error: err.message,
      });
    }
  }

  return { records: allRecords, totalDuplicates, filesSummary };
}

module.exports = {
  parseHRFile,
  parseMultipleHRFiles,
};
