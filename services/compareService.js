/**
 * services/compareService.js
 *
 * Reconciliation algorithm — ported from AD_recon_v6.html client-side logic.
 *
 * Match pipeline (exact replica of the HTML tool):
 *   1. Build lookup maps: HR by Tabel (integer key), HR by email, AD by UPN/mail, AD by Tabel
 *   2. Build duplicate maps: Tabel numbers that appear more than once in AD or HR
 *   3. For each AD record:
 *      a. No valid extensionAttribute1 → MISSING_ATTR1 category
 *      b. Match HR by Tabel integer first
 *      c. Fallback: match by UPN email, then by mail, with @u.ucom.am → @ucom.am alias
 *      d. No match → GHOST_ACCOUNT
 *      e. Match found → check Tabel mismatch, then email mismatch, then MATCHED
 *      f. Driver accounts (@u.ucom.am / extAttr10=DRV) tagged in DRIVER category too
 *   4. HR records not matched by any AD record → MISSING_ACCOUNT
 *   5. Duplicate Tabel numbers (AD + HR) → DUPLICATE_TABEL category
 *
 * Categories produced (8 total — mirrors HTML tool tabs):
 *   GHOST_ACCOUNT    AD has account, HR has no record          HIGH
 *   MISSING_ACCOUNT  HR has employee, no AD account found       MEDIUM
 *   TABEL_MISMATCH   Matched pair: extAttr1 ≠ HR Tabel number  MEDIUM
 *   EMAIL_MISMATCH   Matched pair: AD UPN ≠ HR email            MEDIUM
 *   MISSING_ATTR1    AD account with empty/invalid extAttr1     HIGH
 *   DRIVER           @u.ucom.am / DRV accounts (consolidated)   INFO
 *   MATCHED          Fully matched and consistent               INFO
 *   DUPLICATE_TABEL  Same Tabel on multiple AD or HR records    HIGH
 */

const { normalizeEmail, normalizeString } = require('./normalizeService');
const { logCompare }                       = require('./loggerService');
const db                                   = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers (mirrors the HTML tool's utility functions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * normTabelInt(v)
 * Converts a raw Tabel value to an integer key for lookup maps.
 * Returns null if the value is empty or non-numeric.
 * Mirrors: parseInt(normTabel(attr1), 10) from HTML tool.
 *
 * Why integer: "003627" and "3627" must match — string equality would fail.
 *
 * @param {any} v
 * @returns {number|null}
 */
function normTabelInt(v) {
  if (!v && v !== 0) return null;
  const s = String(v).trim().replace(/\s/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n > 0 ? n : null;
}

/**
 * isValidTabel(v)
 * Returns true if v is a non-zero digit-only string (1–9 digits).
 * Matches: isValidTabel() from HTML tool.
 *
 * @param {any} v
 * @returns {boolean}
 */
function isValidTabel(v) {
  if (!v) return false;
  const s = String(v).trim().replace(/\s/g, '');
  return /^\d{1,9}$/.test(s) && parseInt(s, 10) > 0;
}

/**
 * isDriverAccount(mail, upn, extAttr10)
 * Returns true for driver/field-tech accounts: @u.ucom.am email OR extAttr10 = 'DRV'.
 * Matches: isDriverEmail() + attr10 check from HTML tool.
 *
 * @param {string} mail
 * @param {string} upn
 * @param {string} extAttr10
 * @returns {boolean}
 */
function isDriverAccount(mail, upn, extAttr10) {
  const m   = (mail  || '').toLowerCase();
  const u   = (upn   || '').toLowerCase();
  const a10 = (extAttr10 || '').toUpperCase();
  return m.endsWith('@u.ucom.am') || u.endsWith('@u.ucom.am') || a10 === 'DRV';
}

/**
 * isTerminated(status)
 * Returns true if the HR status string indicates a terminated employee.
 * Matches: isTerminated() from HTML tool.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isTerminated(status) {
  if (!status) return false;
  const s = status.toLowerCase();
  return s.includes('ազատ') || s.includes('արձակ') ||
         s.includes('terminated') || s.includes('fired') || s.includes('dismiss');
}

/**
 * ucomAlias(email)
 * Converts @u.ucom.am to @ucom.am for cross-domain email matching.
 * Matches: email.replace('@u.ucom.am','@ucom.am') from HTML tool.
 *
 * @param {string} email
 * @returns {string}
 */
function ucomAlias(email) {
  return (email || '').replace('@u.ucom.am', '@ucom.am');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main reconciliation function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * reconcileRecords(adRecords, hrRecords, analysisId)
 *
 * Full port of the HTML tool's analyze() function.
 * Reads AD and HR records from the DB, classifies each account,
 * and inserts categorized results back into reconciliation_results.
 *
 * @param {object[]} adRecords  - Rows from ad_records table
 * @param {object[]} hrRecords  - Rows from hr_records table
 * @param {number}   analysisId
 */
function reconcileRecords(adRecords, hrRecords, analysisId) {

  // ── BUILD LOOKUP MAPS ───────────────────────────────────────────────────
  // hrByTabel: integer Tabel → HR record (first seen wins)
  // hrByEmail: normalized email → HR record
  // hrTabelCount: integer Tabel → count (duplicate detection)
  const hrByTabel     = new Map();
  const hrByEmail     = new Map();
  const hrTabelCount  = new Map();

  for (const hr of hrRecords) {
    const tInt  = normTabelInt(hr.tabel_number);
    const email = normalizeEmail(hr.email);

    if (tInt !== null) {
      if (!hrByTabel.has(tInt)) hrByTabel.set(tInt, hr);
      hrTabelCount.set(tInt, (hrTabelCount.get(tInt) || 0) + 1);
    }
    if (email) {
      if (!hrByEmail.has(email))            hrByEmail.set(email, hr);
      // also index the @u.ucom.am alias variant
      const alias = ucomAlias(email);
      if (alias !== email && !hrByEmail.has(alias)) hrByEmail.set(alias, hr);
    }
  }

  // adByUpn: normalized UPN/mail → AD record (for HR→AD lookup)
  // adByTabel: integer Tabel → AD record
  // adTabelCount: integer Tabel → count (duplicate detection)
  const adByUpn      = new Map();
  const adByTabel    = new Map();
  const adTabelCount = new Map();

  for (const ad of adRecords) {
    const upn   = normalizeEmail(ad.sam_account_name ? ad.sam_account_name + '@' : ad.mail);
    const mail  = normalizeEmail(ad.mail);
    const tInt  = normTabelInt(ad.tabel_number || ad.extensionAttr1);

    // Index by UPN and mail for HR→AD reverse lookup
    if (mail)  { if (!adByUpn.has(mail))  adByUpn.set(mail,  ad); }
    if (mail)  { const a = ucomAlias(mail);  if (!adByUpn.has(a)) adByUpn.set(a, ad); }

    if (tInt !== null) {
      if (!adByTabel.has(tInt)) adByTabel.set(tInt, ad);
      adTabelCount.set(tInt, (adTabelCount.get(tInt) || 0) + 1);
    }
  }

  // ── PREPARED INSERT STATEMENT ───────────────────────────────────────────
  const insert = db.prepare(`
    INSERT INTO reconciliation_results
      (analysis_id, category, severity, ad_record_id, hr_record_id, match_score, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Counters for the log summary
  const cnt = {
    matched: 0, ghost: 0, missing: 0,
    tabelMismatch: 0, emailMismatch: 0,
    missingAttr1: 0, driver: 0, duplicate: 0,
  };

  // Track which HR records were matched (to find MISSING_ACCOUNT later)
  const matchedHRIds = new Set();

  // ── PHASE 1: Process every AD record ────────────────────────────────────
  for (const ad of adRecords) {
    const rawAttr1  = ad.tabel_number || ad.extensionAttr1 || '';
    const mail      = normalizeEmail(ad.mail);
    const sam       = ad.sam_account_name || '';
    const displayNm = ad.display_name || '';
    const extAttr10 = ad.extensionAttr10 || '';
    const isDriver  = isDriverAccount(mail, mail, extAttr10);

    // ── PRIORITY 0: Missing or invalid extensionAttribute1 ──────────────
    // An AD account without a valid Tabel cannot be matched to HR.
    if (!isValidTabel(rawAttr1)) {
      insert.run(
        analysisId,
        'MISSING_ATTR1',
        'HIGH',
        ad.id, null, 0,
        `AD account "${displayNm}" (${sam}) has no valid extensionAttribute1: "${rawAttr1 || 'empty'}"`
      );
      cnt.missingAttr1++;

      // Drivers with missing attr1 also appear in DRIVER tab
      if (isDriver) {
        insert.run(
          analysisId,
          'DRIVER',
          'INFO',
          ad.id, null, 0,
          `Driver "${displayNm}" — ⚠ Missing extAttr1`
        );
        cnt.driver++;
      }
      continue; // cannot attempt matching without a Tabel
    }

    const attr1Int = normTabelInt(rawAttr1);
    const isDupAD  = (adTabelCount.get(attr1Int) || 0) > 1;

    // ── MATCH ATTEMPT: Tabel first, then email fallback ─────────────────
    // This is the exact priority from HTML tool: hrByTabel → hrByEmail(upn) → hrByEmail(mail)
    let hrMatch     = hrByTabel.get(attr1Int) || null;
    let matchMethod = hrMatch ? 'tabel' : null;

    if (!hrMatch && mail) {
      hrMatch     = hrByEmail.get(mail) || hrByEmail.get(ucomAlias(mail)) || null;
      matchMethod = hrMatch ? 'email' : null;
    }

    // ── GHOST ACCOUNT: AD record has no HR counterpart ──────────────────
    if (!hrMatch) {
      const dupNote = isDupAD ? ' [⚠ DUPLICATE TABEL IN AD]' : '';
      insert.run(
        analysisId,
        'GHOST_ACCOUNT',
        'HIGH',
        ad.id, null, 0,
        `Ghost: "${displayNm}" (${sam}) Tabel=${rawAttr1}${dupNote} — not found in HR`
      );
      cnt.ghost++;

      if (isDriver) {
        insert.run(
          analysisId, 'DRIVER', 'INFO', ad.id, null, 0,
          `Driver "${displayNm}" — 🔴 Ghost (not in HR)${isDupAD ? ' ⚠ DUP' : ''}`
        );
        cnt.driver++;
      }
      continue;
    }

    // ── HR MATCH FOUND ───────────────────────────────────────────────────
    matchedHRIds.add(hrMatch.id);

    const hrTabelInt = normTabelInt(hrMatch.tabel_number);
    const hrEmail    = normalizeEmail(hrMatch.email);
    const isDupHR    = hrTabelInt !== null && (hrTabelCount.get(hrTabelInt) || 0) > 1;
    const dupNote    = (isDupAD ? '⚠DUP-AD ' : '') + (isDupHR ? '⚠DUP-HR' : '');

    // ── CHECK: Tabel mismatch (matched via email but Tabels differ) ──────
    // realTabelMismatch = we matched via email fallback but the Tabel numbers differ
    const realTabelMismatch = hrTabelInt !== null && attr1Int !== hrTabelInt;

    // ── CHECK: Email mismatch ────────────────────────────────────────────
    // Compare AD mail vs HR email, normalizing @u.ucom.am → @ucom.am
    const adEmailComp = ucomAlias(mail || '');
    const hrEmailComp = ucomAlias(hrEmail || '');
    const emailMismatch = adEmailComp && hrEmailComp && adEmailComp !== hrEmailComp;

    const baseDesc = `"${displayNm}" (${sam}) ↔ "${hrMatch.employee_name}" via ${matchMethod}` +
                     (dupNote ? ` [${dupNote.trim()}]` : '');

    if (realTabelMismatch) {
      // Tabel mismatch takes priority over email mismatch
      insert.run(
        analysisId, 'TABEL_MISMATCH', 'MEDIUM',
        ad.id, hrMatch.id, 80,
        `Tabel mismatch: AD extAttr1="${rawAttr1}" HR tabel="${hrMatch.tabel_number}" — ${baseDesc}`
      );
      cnt.tabelMismatch++;

      if (isDriver) {
        insert.run(analysisId, 'DRIVER', 'INFO', ad.id, hrMatch.id, 80,
          `Driver "${displayNm}" — 🟡 Tabel Mismatch`);
        cnt.driver++;
      }

    } else if (emailMismatch) {
      insert.run(
        analysisId, 'EMAIL_MISMATCH', 'MEDIUM',
        ad.id, hrMatch.id, 90,
        `Email mismatch: AD="${mail}" HR="${hrMatch.email}" — ${baseDesc}`
      );
      cnt.emailMismatch++;

      if (isDriver) {
        insert.run(analysisId, 'DRIVER', 'INFO', ad.id, hrMatch.id, 90,
          `Driver "${displayNm}" — 🔵 Email Mismatch`);
        cnt.driver++;
      }

    } else {
      // Fully matched and consistent
      insert.run(
        analysisId, 'MATCHED', 'INFO',
        ad.id, hrMatch.id, 100,
        `Matched: ${baseDesc}`
      );
      cnt.matched++;

      if (isDriver) {
        insert.run(analysisId, 'DRIVER', 'INFO', ad.id, hrMatch.id, 100,
          `Driver "${displayNm}" — 🟢 Matched`);
        cnt.driver++;
      }
    }
  }

  // ── PHASE 2: HR records with no AD match → MISSING_ACCOUNT ─────────────
  for (const hr of hrRecords) {
    if (matchedHRIds.has(hr.id)) continue;

    // Skip HR rows with neither Tabel nor email (cannot match, not a false positive)
    const tInt  = normTabelInt(hr.tabel_number);
    const email = normalizeEmail(hr.email);
    if (!tInt && !email) continue;

    // Check if this HR record can be found via AD maps (reverse lookup)
    const inADbyTabel = tInt !== null && adByTabel.has(tInt);
    const inADbyEmail = email && (adByUpn.has(email) || adByUpn.has(ucomAlias(email)));

    if (!inADbyTabel && !inADbyEmail) {
      const isDupHR = tInt && (hrTabelCount.get(tInt) || 0) > 1;
      const termNote = isTerminated(hr.position) ? ' [TERMINATED]' : '';
      insert.run(
        analysisId, 'MISSING_ACCOUNT', 'MEDIUM',
        null, hr.id, 0,
        `No AD account: "${hr.employee_name}" Tabel=${hr.tabel_number || '—'}${termNote}${isDupHR ? ' [⚠ DUP HR]' : ''}`
      );
      cnt.missing++;
    }
  }

  // ── PHASE 3: Duplicate Tabels (AD + HR) ─────────────────────────────────
  // Insert one DUPLICATE_TABEL row per account involved in a Tabel collision.
  // AD duplicates
  for (const ad of adRecords) {
    const tInt = normTabelInt(ad.tabel_number || ad.extensionAttr1);
    if (tInt === null) continue;
    if ((adTabelCount.get(tInt) || 0) <= 1) continue;

    insert.run(
      analysisId, 'DUPLICATE_TABEL', 'HIGH',
      ad.id, null, 0,
      `[AD] Tabel ${tInt} appears on multiple AD accounts — "${ad.display_name}" (${ad.sam_account_name})`
    );
    cnt.duplicate++;
  }

  // HR duplicates
  for (const hr of hrRecords) {
    const tInt = normTabelInt(hr.tabel_number);
    if (tInt === null) continue;
    if ((hrTabelCount.get(tInt) || 0) <= 1) continue;

    insert.run(
      analysisId, 'DUPLICATE_TABEL', 'HIGH',
      null, hr.id, 0,
      `[HR] Tabel ${tInt} appears on multiple HR rows — "${hr.employee_name}"`
    );
    cnt.duplicate++;
  }

  // ── LOG SUMMARY ──────────────────────────────────────────────────────────
  const analysis = db.prepare('SELECT analysis_name FROM analysis_runs WHERE id = ?').get(analysisId);

  logCompare({
    analysisId,
    name:          analysis ? analysis.analysis_name : `#${analysisId}`,
    adTotal:       adRecords.length,
    hrTotal:       hrRecords.length,
    matched:       cnt.matched,
    ghosts:        cnt.ghost,
    missing:       cnt.missing,
    emailMismatch: cnt.emailMismatch,
    deptMismatch:  cnt.tabelMismatch,
  });
}

module.exports = {
  reconcileRecords,
  normTabelInt,
  isValidTabel,
  isDriverAccount,
  isTerminated,
};
