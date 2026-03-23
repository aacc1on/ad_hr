/**
 * services/adService.js
 *
 * Active Directory CSV export parser.
 *
 * Handles the standard AD export format (Get-ADUser PowerShell output)
 * with columns like: SamAccountName, UserPrincipalName, mail,
 * DisplayName, extensionAttribute1 (Tabel), extensionAttribute10 (type),
 * Department, Title, AccountExpirationDate, PasswordLastSet, LastLogonDate, DistinguishedName
 *
 * Also handles alternative column name spellings used by different AD export scripts.
 */

const fs    = require('fs');
const path  = require('path');
const { parse } = require('csv-parse/sync');
const { normalizeTabel, normalizeEmail, normalizeString } = require('./normalizeService');
const { logImport, logError } = require('./loggerService');

/**
 * AD_COLUMN_ALIASES
 * Maps canonical internal field names to possible CSV column header spellings.
 * The first matching header found in the CSV is used.
 */
const AD_COLUMN_ALIASES = {
  samAccountName:    ['SamAccountName', 'sAMAccountName', 'Sam Account Name', 'sam_account_name'],
  mail:              ['mail', 'Mail', 'E-mail Address', 'email', 'Email'],
  displayName:       ['DisplayName', 'displayName', 'Display Name', 'display_name'],
  department:        ['Department', 'department'],
  title:             ['Title', 'title'],
  extensionAttr1:    ['extensionAttribute1', 'ExtensionAttribute1', 'Tabel', 'tabel', 'Employee ID'],
  extensionAttr10:   ['extensionAttribute10', 'ExtensionAttribute10', 'EmployeeType', 'Type'],
  accountExpiry:     ['AccountExpirationDate', 'accountExpires', 'Account Expiry'],
  lastLogon:         ['LastLogonDate', 'lastLogon', 'Last Logon'],
  distinguishedName: ['DistinguishedName', 'distinguishedName', 'Distinguished Name'],
};

/**
 * resolveADHeaders(headers)
 * Builds a map: canonical field → column index in the CSV.
 * Uses the first matching alias for each field.
 *
 * @param {string[]} headers - Array of header strings from the CSV
 * @returns {Map<string, number>}
 */
function resolveADHeaders(headers) {
  const map = new Map();

  for (const [canonical, aliases] of Object.entries(AD_COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const idx = headers.findIndex(h =>
        h && h.trim().toLowerCase() === alias.toLowerCase()
      );
      if (idx !== -1) {
        map.set(canonical, idx);
        break; // use first match, stop searching aliases
      }
    }
  }

  return map;
}

/**
 * isDriverAccount(record)
 * Detects "driver" accounts which use @u.ucom.am domain.
 * Drivers are regular employees but their AD account is under a sub-domain.
 *
 * @param {object} record - Raw parsed row
 * @returns {boolean}
 */
function isDriverAccount(record) {
  const mail = (record.mail || '').toLowerCase();
  const ext10 = (record.extensionAttr10 || '').toUpperCase();
  return mail.includes('@u.ucom.am') || ext10 === 'DRV';
}

/**
 * isServiceAccount(record)
 * Detects service accounts (svc.*, monitoring, backup, etc.).
 * Service accounts have no Tabel number and no extensionAttribute10 type.
 *
 * @param {object} record
 * @returns {boolean}
 */
function isServiceAccount(record) {
  const ext10 = (record.extensionAttr10 || '').toUpperCase();
  const sam   = (record.samAccountName  || '').toLowerCase();
  return ext10 === '' && (sam.startsWith('svc.') || sam.startsWith('svc_'));
}

/**
 * parseADExport(filePath)
 *
 * Reads and parses an AD CSV export.
 * Returns all records including drivers and service accounts (caller decides what to filter).
 *
 * @param {string} filePath
 * @returns {Promise<{ records: object[], total: number }>}
 */
async function parseADExport(filePath) {
  const fileName = path.basename(filePath);
  let rawContent;

  try {
    rawContent = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    logError('adService.parseADExport', err);
    throw new Error(`Cannot read AD file "${fileName}": ${err.message}`);
  }

  // Parse CSV with flexible options: handles quoted fields, BOM, trailing commas
  let rows;
  try {
    rows = parse(rawContent, {
      columns:          true,    // first row = headers
      skip_empty_lines: true,
      trim:             true,
      bom:              true,    // handle UTF-8 BOM from Windows exports
      relax_quotes:     true,
      relax_column_count: true,
    });
  } catch (err) {
    logError('adService.parseADExport.parse', err);
    throw new Error(`CSV parse error in "${fileName}": ${err.message}`);
  }

  if (!rows || rows.length === 0) {
    throw new Error(`AD file "${fileName}" contains no data rows`);
  }

  // Get column names from the first parsed row's keys
  const headers   = Object.keys(rows[0]);
  const headerMap = resolveADHeaders(headers);

  /**
   * getField(row, canonical)
   * Safely retrieves a field by its canonical name from a CSV row object.
   * Tries all aliases until one matches a key in the row.
   */
  function getField(row, canonical) {
    const aliases = AD_COLUMN_ALIASES[canonical] || [];
    for (const alias of aliases) {
      if (row[alias] !== undefined) return (row[alias] || '').trim();
    }
    return '';
  }

  // ── Map each row to our internal AD record format ─────────────────
  const records = rows.map(row => {
    const rawTabel = getField(row, 'extensionAttr1');
    const rawMail  = getField(row, 'mail');

    const record = {
      samAccountName:    getField(row, 'samAccountName'),
      mail:              normalizeEmail(rawMail),
      displayName:       getField(row, 'displayName'),
      department:        getField(row, 'department'),
      title:             getField(row, 'title'),
      tabelNumber:       normalizeTabel(rawTabel),
      extensionAttr1:    rawTabel,
      extensionAttr10:   getField(row, 'extensionAttr10'),
      accountExpiry:     getField(row, 'accountExpiry'),
      lastLogon:         getField(row, 'lastLogon'),
      distinguishedName: getField(row, 'distinguishedName'),
    };

    // Tag record type for informational display
    record._isDriver  = isDriverAccount(record);
    record._isService = isServiceAccount(record);

    return record;
  });

  // Log the import
  logImport({
    file:             fileName,
    sheet:            'CSV',
    rowsProcessed:    records.length,
    duplicatesSkipped: 0,
  });

  return { records, total: records.length };
}

module.exports = {
  parseADExport,
  isDriverAccount,
  isServiceAccount,
};
