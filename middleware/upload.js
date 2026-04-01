/**
 * middleware/upload.js
 * Multer configuration for file uploads.
 * Accepts CSV (AD export) and Excel (HR files).
 */

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Store files with unique names to avoid collisions
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});

// Only allow CSV and Excel MIME types
const fileFilter = (req, file, cb) => {
  const allowed = [
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream', // fallback for some OS/browser combos
  ];

  const allowedExt = ['.csv', '.xls', '.xlsx'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.originalname}. Only CSV and Excel are accepted.`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
});

function handleMulterError(err, req, res, next) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.render('index', {
      username: req.session.username,
      recentAnalyses: [],
      error: 'File too large. Maximum size is 20 MB.',
      success: null,
    });
  }
  next(err);
}

function createHandleMulterError(db) {
  return (err, req, res, next) => {
    if (err) {
      let recentAnalyses = [];
      try {
        recentAnalyses = db.prepare(`
          SELECT id, analysis_name, created_at, status, total_ad_records, total_hr_records
          FROM analysis_runs
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 5
        `).all(req.session.userId);
      } catch (dbErr) {
        // fallback to []
      }
      return res.render('index', {
        username: req.session.username,
        recentAnalyses,
        error: err.message || 'File upload error',
        success: null,
      });
    }
    next(err);
  };
}

module.exports = { upload, handleMulterError, createHandleMulterError };
