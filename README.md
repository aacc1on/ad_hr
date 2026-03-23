# HR–Active Directory Identity Reconciliation and Audit System

**Stack:** Node.js 18+ · Express.js · EJS · SQLite · Docker  
**Version:** 2.0.0 — Full implementation per technical specification

---

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure (optional — defaults work for dev)
cp .env.example .env

# 3. Run
npm run dev
# → http://localhost:3000
# → Login: admin / admin123
```

### Docker

```bash
docker-compose up -d
```

---

## Features

| Requirement | Status |
|---|---|
| Multiple HR Excel files upload | ✅ |
| Multiple sheets per Excel file | ✅ All sheets processed |
| Flexible column name aliases (Armenian / English / Russian) | ✅ |
| Tabel normalization to 6 digits | ✅ |
| Duplicate row detection & logging | ✅ |
| `import.log` / `duplicate.log` / `compare.log` / `errors.log` / `audit.log` | ✅ |
| Ghost account detection (AD not in HR) | ✅ HIGH severity |
| Missing account detection (HR not in AD) | ✅ MEDIUM severity |
| Email mismatch detection | ✅ MEDIUM severity |
| Department mismatch detection | ✅ LOW severity |
| CSV export — full report + per category | ✅ UTF-8 BOM (opens correctly in Excel) |
| Modular service-based architecture | ✅ 8 services |
| Extensive code comments | ✅ JSDoc on every function |
| Session-based authentication | ✅ bcrypt |
| Analysis history | ✅ |
| Docker deployment | ✅ |

---

## Supported Column Name Aliases

The system automatically detects column headers in any of these languages:

| Field | Armenian | English | Russian |
|---|---|---|---|
| Tabel | Տաբել, Տաբելային համար | Tabel, Employee ID, EmpID | Табельный номер, Табель |
| Email | Էլ. փոստ, Էլ.փոստ | Email, E-mail, Mail | Эл. почта, Почта |
| Department | Բաժին, Վարչություն | Department, Dept, Division | Отдел, Подразделение |
| Name | Անուն ազգանուն | Name, Full Name, Display Name | Ф.И.О, ФИО |
| Position | Պաշտոն | Position, Job Title, Title | Должность |

To add new aliases: edit `services/mappingService.js` → `COLUMN_ALIASES`.

---

## Log Files

All logs written to `./logs/`:

| File | Contents |
|---|---|
| `import.log` | File + sheet import summary (rows processed, duplicates skipped) |
| `duplicate.log` | Every skipped duplicate row (Tabel, file, sheet, row number, reason) |
| `compare.log` | Reconciliation summary per analysis run |
| `errors.log` | Runtime errors with context and stack trace |
| `audit.log` | User logins, logouts, analysis creation |

---

## Architecture

```
services/
  loggerService.js     → File-based logging (5 log files)
  mappingService.js    → Column alias resolution
  normalizeService.js  → Tabel (6-digit), email, string normalization
  duplicateService.js  → Duplicate detection (per Tabel / Tabel+Email)
  excelService.js      → Multi-file, multi-sheet Excel parsing
  adService.js         → AD CSV parsing with flexible column detection
  compareService.js    → Reconciliation algorithm (Levenshtein scoring)
  reportService.js     → CSV export generation
```

### Match Scoring

| Signal | Points |
|---|---|
| Tabel number match | +60 |
| Email match | +35 |
| Name similarity > 70% (Levenshtein) | +0–30 |

Minimum score to count as a match: **60** (Tabel alone is sufficient).

---

## Project Structure

```
ad-hr-platform/
├── server.js
├── .env / .env.example
├── Dockerfile / docker-compose.yml
├── SAMPLE_AD_EXPORT.csv
├── config/db.js
├── middleware/ (auth.js, upload.js)
├── routes/     (auth.js, upload.js, results.js)
├── services/   (8 service modules)
├── views/      (EJS templates + partials)
├── public/css/style.css
├── logs/       (auto-created)
├── uploads/    (auto-created, temp files)
└── data/       (SQLite database)
```

---

## Environment Variables

```env
NODE_ENV=development
PORT=3000
SESSION_SECRET=change-this-in-production
DATABASE_PATH=./data/app.db
LOG_DIR=./logs
UPLOAD_DIR=./uploads
PASSWORD_MIN_LENGTH=8
SESSION_MAX_AGE=86400000
```

---

## Production Checklist

- [ ] Change `SESSION_SECRET` → `openssl rand -hex 32`
- [ ] Change default `admin` password
- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS (Nginx reverse proxy)
- [ ] Set up database backups (`./data/app.db`)
- [ ] Monitor `./logs/errors.log`
# ad_hr
