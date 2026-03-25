/**
 * routes/results.js
 * Results viewing, category drill-down, history, and CSV export.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { isAuthenticated }    = require('../middleware/auth');
const {
  getAnalysisSummary,
  generateFullReport,
  generateCategoryReport,
  generateCategoryExcel,
  generateExcelReport,
} = require('../services/reportService');

// ── GET /results — History list ──────────────────────────────────────────────
router.get('/', isAuthenticated, (req, res) => {
  const analyses = db.prepare(`
    SELECT id, analysis_name, created_at, status, total_ad_records, total_hr_records, duplicates_skipped
    FROM analysis_runs
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.session.userId);

  res.render('history', { username: req.session.username, analyses });
});

// ── GET /results/:id — Results dashboard ────────────────────────────────────
router.get('/:id', isAuthenticated, (req, res) => {
  const analysisId = parseInt(req.params.id);

  const summary = getAnalysisSummary(analysisId);

  if (!summary || summary.analysis.user_id !== req.session.userId) {
    return res.status(404).render('404', { message: 'Analysis not found' });
  }

  // Full category breakdown with severity info
  const categoryBreakdown = db.prepare(`
    SELECT
      category,
      severity,
      COUNT(*) AS count
    FROM reconciliation_results
    WHERE analysis_id = ?
    GROUP BY category, severity
    ORDER BY
      CASE severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END
  `).all(analysisId);

  res.render('results', {
    username: req.session.username,
    summary,
    categoryBreakdown,
  });
});
// ── GET /results/:id/category/:category/export — category CSV download ──
router.get('/:id/category/:category/export', isAuthenticated, (req, res) => {
  const analysisId = parseInt(req.params.id);
  const category   = req.params.category;

  const analysis = db.prepare(
    'SELECT * FROM analysis_runs WHERE id = ? AND user_id = ?'
  ).get(analysisId, req.session.userId);

  if (!analysis) return res.status(404).send('Not found');

  const csv = generateCategoryReport(analysisId, category);
  const filename = `reconciliation-${analysis.analysis_name.replace(/\s+/g, '_')}-${category}-${analysisId}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv);
});

// ── GET /results/:id/category/:category/export/excel — category Excel download ──
router.get('/:id/category/:category/export/excel', isAuthenticated, async (req, res) => {
  const analysisId = parseInt(req.params.id);
  const category   = req.params.category;

  const analysis = db.prepare(
    'SELECT * FROM analysis_runs WHERE id = ? AND user_id = ?'
  ).get(analysisId, req.session.userId);

  if (!analysis) return res.status(404).send('Not found');

  try {
    const buffer = await generateCategoryExcel(analysisId, category);
    const filename = `reconciliation-${analysis.analysis_name.replace(/\s+/g, '_')}-${category}-${analysisId}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Excel export failed', err);
    res.status(500).send('Failed to generate Excel report');
  }
});
// ── GET /results/:id/category/:cat — Drill-down table ───────────────────────
router.get('/:id/category/:category', isAuthenticated, (req, res) => {
  const analysisId = parseInt(req.params.id);
  const { category } = req.params;
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  const analysis = db.prepare(
    'SELECT * FROM analysis_runs WHERE id = ? AND user_id = ?'
  ).get(analysisId, req.session.userId);

  if (!analysis) {
    return res.status(404).render('404', { message: 'Analysis not found' });
  }

  const records = db.prepare(`
    SELECT
      rr.id, rr.severity, rr.match_score, rr.description,
      ad.sam_account_name, ad.display_name AS ad_name, ad.mail AS ad_mail,
      ad.department AS ad_dept, ad.tabel_number AS ad_tabel,
      hr.employee_name, hr.email AS hr_email,
      hr.department AS hr_dept, hr.tabel_number AS hr_tabel,
      hr.source_file, hr.source_sheet
    FROM reconciliation_results rr
    LEFT JOIN ad_records ad ON rr.ad_record_id = ad.id
    LEFT JOIN hr_records hr ON rr.hr_record_id = hr.id
    WHERE rr.analysis_id = ? AND rr.category = ?
    ORDER BY rr.severity DESC
    LIMIT ? OFFSET ?
  `).all(analysisId, category, limit, offset);

  const total      = db.prepare(
    'SELECT COUNT(*) AS cnt FROM reconciliation_results WHERE analysis_id = ? AND category = ?'
  ).get(analysisId, category).cnt;

  const totalPages = Math.ceil(total / limit);

  res.render('category', {
    username: req.session.username,
    analysis,
    category,
    records,
    page,
    totalPages,
    totalCount: total,
  });
});

// ── GET /results/:id/export — Full CSV download ──────────────────────────────
router.get('/:id/export', isAuthenticated, (req, res) => {
  const analysisId = parseInt(req.params.id);

  const analysis = db.prepare(
    'SELECT * FROM analysis_runs WHERE id = ? AND user_id = ?'
  ).get(analysisId, req.session.userId);

  if (!analysis) return res.status(404).send('Not found');

  const csv      = generateFullReport(analysisId);
  const filename = `reconciliation-${analysis.analysis_name.replace(/\s+/g, '_')}-${analysisId}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv); // BOM for correct Armenian/Unicode display in Excel
});

// ── GET /results/:id/export/excel — Full Excel download ────────────────
router.get('/:id/export/excel', isAuthenticated, async (req, res) => {
  const analysisId = parseInt(req.params.id);

  const analysis = db.prepare(
    'SELECT * FROM analysis_runs WHERE id = ? AND user_id = ?'
  ).get(analysisId, req.session.userId);

  if (!analysis) return res.status(404).send('Not found');

  try {
    const buffer = await generateExcelReport(analysisId);
    const filename = `reconciliation-${analysis.analysis_name.replace(/\s+/g, '_')}-${analysisId}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Excel export failed', err);
    res.status(500).send('Failed to generate Excel report');
  }
});

// ── GET /results/:id/export/:category — Category CSV download ───────────────
router.get('/:id/export/:category', isAuthenticated, (req, res) => {
  const analysisId = parseInt(req.params.id);
  const { category } = req.params;

  const analysis = db.prepare(
    'SELECT * FROM analysis_runs WHERE id = ? AND user_id = ?'
  ).get(analysisId, req.session.userId);

  if (!analysis) return res.status(404).send('Not found');

  const csv      = generateCategoryReport(analysisId, category);
  const filename = `${category.toLowerCase()}-${analysisId}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv);
});

// ── GET /results/:id/profiles.json — Deep Search data ───────────────────────
router.get('/:id/profiles.json', isAuthenticated, (req, res) => {
  const analysisId = parseInt(req.params.id);

  const analysis = db.prepare(
    'SELECT * FROM analysis_runs WHERE id = ? AND user_id = ?'
  ).get(analysisId, req.session.userId);
  if (!analysis) return res.status(404).json([]);

  // Return all result rows with enough fields for client-side deep search
  const rows = db.prepare(`
    SELECT
      rr.category,
      rr.severity,
      rr.description,
      ad.sam_account_name,
      ad.display_name  AS ad_name,
      ad.mail          AS ad_mail,
      ad.tabel_number  AS ad_tabel,
      ad.account_expiry,
      ad.last_logon,
      hr.employee_name AS hr_name,
      hr.email         AS hr_email,
      hr.tabel_number  AS hr_tabel,
      hr.department    AS hr_dept,
      hr.position      AS hr_status
    FROM reconciliation_results rr
    LEFT JOIN ad_records ad ON rr.ad_record_id = ad.id
    LEFT JOIN hr_records hr ON rr.hr_record_id = hr.id
    WHERE rr.analysis_id = ?
  `).all(analysisId);

  res.json(rows);
});

module.exports = router;
