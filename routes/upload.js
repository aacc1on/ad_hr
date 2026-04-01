/**
 * routes/upload.js
 * Handles file upload and triggers the reconciliation pipeline.
 *
 * Accepts:
 *   - One AD CSV file   (field: ad_file)
 *   - One or more HR Excel files (field: hr_files, multiple)
 */

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

const { upload, createHandleMulterError } = require('../middleware/upload');
const db            = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');
const { parseADExport }   = require('../services/adService');
const { parseMultipleHRFiles } = require('../services/excelService');
const { reconcileRecords }     = require('../services/compareService');
const { logAudit, logError }   = require('../services/loggerService');

const handleMulterError = createHandleMulterError(db);

// Helper to get recent analyses safely
function getRecentAnalyses(userId) {
  try {
    return db.prepare(`
      SELECT id, analysis_name, created_at, status, total_ad_records, total_hr_records
      FROM analysis_runs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(userId);
  } catch (err) {
    return [];
  }
}

// Helper to sanitize analysis name
function sanitizeAnalysisName(name) {
  if (!name || !name.trim()) {
    return `Analysis_${new Date().toISOString().slice(0, 10)}`;
  }
  let sanitized = name.trim();
  if (sanitized.length > 120) {
    sanitized = sanitized.slice(0, 120);
  }
  const regex = /^[\p{L}\p{N}\s\-\.,:()_]+$/u;
  if (!regex.test(sanitized)) {
    throw new Error('Analysis name contains invalid characters. Only letters, numbers, spaces, and basic punctuation are allowed.');
  }
  return sanitized;
}

// ── GET / — Upload page ───────────────────────────────────────────────────────
router.get('/', isAuthenticated, (req, res) => {
  const recentAnalyses = getRecentAnalyses(req.session.userId);

  res.render('index', {
    username:       req.session.username,
    recentAnalyses,
    error:          null,
    success:        null,
  });
});

// ── POST /process — Run reconciliation ──────────────────────────────────────
router.post(
  '/process',
  isAuthenticated,
  upload.fields([
    { name: 'ad_file',  maxCount: 1  },
    { name: 'hr_files', maxCount: 10 },  // up to 10 HR files
  ]),
  handleMulterError,
  async (req, res) => {

    // Helper to clean up uploaded temp files
    const cleanup = (files) => {
      for (const f of files) {
        fs.unlink(f.path, () => {});
      }
    };

    const allUploadedFiles = [
      ...(req.files?.ad_file  || []),
      ...(req.files?.hr_files || []),
    ];

    try {
      // ── Validate that both file types were uploaded ────────────────────
      if (!req.files?.ad_file || !req.files?.hr_files?.length) {
        cleanup(allUploadedFiles);
        return res.render('index', {
          username:       req.session.username,
          recentAnalyses: getRecentAnalyses(req.session.userId),
          error:          'Please upload one AD file (CSV) and at least one HR file (Excel).',
          success:        null,
        });
      }

      const adFile   = req.files.ad_file[0];
      const hrFiles  = req.files.hr_files;
      const analysisName = sanitizeAnalysisName(req.body.analysis_name);

      // ── Create analysis run record ─────────────────────────────────────
      const runResult = db.prepare(`
        INSERT INTO analysis_runs (user_id, analysis_name, ad_file_name, hr_file_names, status)
        VALUES (?, ?, ?, ?, 'processing')
      `).run(
        req.session.userId,
        analysisName,
        adFile.originalname,
        JSON.stringify(hrFiles.map(f => f.originalname)),
      );

      const analysisId = runResult.lastInsertRowid;

      // ── Parse AD file ──────────────────────────────────────────────────
      let adParsed;
      try {
        adParsed = await parseADExport(adFile.path);
      } catch (err) {
        logError('routes/upload.parseAD', err);
        db.prepare("UPDATE analysis_runs SET status='failed' WHERE id=?").run(analysisId);
        cleanup(allUploadedFiles);
        return res.render('index', {
          username: req.session.username, recentAnalyses: getRecentAnalyses(req.session.userId),
          error: `AD file error: ${err.message}`, success: null,
        });
      }

      // ── Parse HR files (multiple files, multiple sheets each) ──────────
      let hrParsed;
      try {
        hrParsed = await parseMultipleHRFiles(hrFiles.map(f => f.path));
      } catch (err) {
        logError('routes/upload.parseHR', err);
        db.prepare("UPDATE analysis_runs SET status='failed' WHERE id=?").run(analysisId);
        cleanup(allUploadedFiles);
        return res.render('index', {
          username: req.session.username, recentAnalyses: getRecentAnalyses(req.session.userId),
          error: `HR file error: ${err.message}`, success: null,
        });
      }

      // ── Persist AD records to DB ────────────────────────────────────────
      const insertAD = db.prepare(`
        INSERT INTO ad_records
          (analysis_id, sam_account_name, mail, display_name, department, title,
           tabel_number, extensionAttr1, extensionAttr10, account_expiry, last_logon, distinguished_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertADMany = db.transaction((records) => {
        for (const r of records) {
          insertAD.run(
            analysisId,
            r.samAccountName, r.mail, r.displayName, r.department, r.title,
            r.tabelNumber, r.extensionAttr1, r.extensionAttr10,
            r.accountExpiry, r.lastLogon, r.distinguishedName,
          );
        }
      });

      insertADMany(adParsed.records);

      // ── Persist HR records to DB ────────────────────────────────────────
      const insertHR = db.prepare(`
        INSERT INTO hr_records
          (analysis_id, employee_name, email, tabel_number, department, position, source_file, source_sheet)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertHRMany = db.transaction((records) => {
        for (const r of records) {
          insertHR.run(
            analysisId,
            r.employeeName, r.email, r.tabelNumber,
            r.department, r.position, r.sourceFile, r.sourceSheet,
          );
        }
      });

      insertHRMany(hrParsed.records);

      // ── Run reconciliation algorithm ────────────────────────────────────
      const adDBRecords = db.prepare('SELECT * FROM ad_records WHERE analysis_id = ?').all(analysisId);
      const hrDBRecords = db.prepare('SELECT * FROM hr_records WHERE analysis_id = ?').all(analysisId);

      reconcileRecords(adDBRecords, hrDBRecords, analysisId, analysisName);

      // ── Update analysis run with final stats ────────────────────────────
      db.prepare(`
        UPDATE analysis_runs
        SET status = 'completed',
            total_ad_records   = ?,
            total_hr_records   = ?,
            duplicates_skipped = ?
        WHERE id = ?
      `).run(
        adParsed.total,
        hrParsed.records.length,
        hrParsed.totalDuplicates,
        analysisId,
      );

      // ── Clean up temp files ─────────────────────────────────────────────
      cleanup(allUploadedFiles);

      // ── Audit log ───────────────────────────────────────────────────────
      logAudit({
        userId:   req.session.userId,
        username: req.session.username,
        action:   'ANALYSIS_CREATE',
        detail:   `Created analysis "${analysisName}" (AD:${adParsed.total}, HR:${hrParsed.records.length})`,
        ip:       req.ip,
      });

      res.redirect(`/results/${analysisId}`);

    } catch (err) {
      logError('routes/upload.process', err);
      cleanup(allUploadedFiles);

      res.render('index', {
        username: req.session.username, recentAnalyses: getRecentAnalyses(req.session.userId),
        error: `Unexpected error: ${err.message}`, success: null,
      });
    }
  }
);

module.exports = router;
