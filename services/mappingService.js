/**
 * services/mappingService.js
 *
 * Flexible column name mapper.
 * Maps any known alias (Armenian, English, Russian) to a canonical field name.
 *
 * Why this exists:
 *   Different HR departments export Excel files with different header names.
 *   Instead of hardcoding one set of column names, we define all known aliases
 *   here and resolve them at parse time.
 *
 * To add a new alias: just append to the relevant array below.
 */

/**
 * COLUMN_ALIASES
 * Each key is the canonical (internal) field name.
 * Each value is a list of possible header strings (case-insensitive match).
 */
const COLUMN_ALIASES = {
  // ── Tabel / Employee ID ────────────────────────────────────────────
  tabelNumber: [
    'tabel',
    'tabell',
    'tabel number',
    'tabel_number',
    'employee id',
    'employeeid',
    'emp id',
    'empid',
    'staff id',
    'id',
    // Armenian
    'տաբել',
    'տաբ',
    'տաբելային համար',
    'տաբ. համար',
    // Russian
    'табельный номер',
    'табель',
    'таб',
  ],

  // ── Employee full name ─────────────────────────────────────────────
  employeeName: [
    'name',
    'full name',
    'fullname',
    'employee name',
    'display name',
    'displayname',
    'ф.и.о',
    'фио',
    // Armenian
    'անուն',
    'անուն ազգանուն',
    'անուն, ազգանուն',
    'ա/ա',
  ],

  // ── Email ──────────────────────────────────────────────────────────
  email: [
    'email',
    'e-mail',
    'e mail',
    'mail',
    'electronic mail',
    // Armenian
    'էլ. փոստ',
    'էլ.փոստ',
    'էլ փոստ',
    'էլփոստ',
    // Russian
    'эл. почта',
    'эл.почта',
    'почта',
  ],

  // ── Department ────────────────────────────────────────────────────
  department: [
    'department',
    'dept',
    'division',
    'unit',
    // Armenian
    'բաժին',
    'վարչություն',
    'ստորաբաժանում',
    // Russian
    'отдел',
    'подразделение',
    'департамент',
  ],

  // ── Position / Job title ──────────────────────────────────────────
  position: [
    'position',
    'job title',
    'jobtitle',
    'title',
    'role',
    // Armenian
    'պաշտոն',
    'աշխատանք',
    // Russian
    'должность',
    'позиция',
  ],
};

// ─────────────────────────────────────────────────────────────────────
// Build reverse lookup map: lowercase alias → canonical field
// Done once at module load for O(1) lookup at parse time.
// ─────────────────────────────────────────────────────────────────────
const ALIAS_LOOKUP = new Map();

for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_LOOKUP.set(alias.toLowerCase().trim(), canonical);
  }
}

/**
 * resolveColumn(rawHeader)
 * Maps a raw Excel header string to its canonical field name.
 * Returns null if no mapping is found.
 *
 * @param {string} rawHeader - The cell value from the header row
 * @returns {string|null}    - Canonical field name or null
 *
 * Example:
 *   resolveColumn('Տաբել')         → 'tabelNumber'
 *   resolveColumn('E-mail')        → 'email'
 *   resolveColumn('Unknown Column') → null
 */
function resolveColumn(rawHeader) {
  if (!rawHeader) return null;
  return ALIAS_LOOKUP.get(rawHeader.toLowerCase().trim()) || null;
}

/**
 * buildHeaderMap(headerRow)
 * Given an array of raw header strings, builds a map:
 *   columnIndex (1-based) → canonical field name
 *
 * Used by the Excel parser to know which column maps to which field.
 *
 * @param {string[]} headerRow - Array of raw header values
 * @returns {Map<number, string>}
 */
function buildHeaderMap(headerRow) {
  const map = new Map();

  headerRow.forEach((header, idx) => {
    const canonical = resolveColumn(String(header || ''));
    if (canonical) {
      // 1-based index to match ExcelJS row.getCell(colNumber)
      map.set(idx + 1, canonical);
    }
  });

  return map;
}

/**
 * getAliases(canonicalField)
 * Returns all known aliases for a canonical field (for UI display / debugging).
 *
 * @param {string} canonicalField
 * @returns {string[]}
 */
function getAliases(canonicalField) {
  return COLUMN_ALIASES[canonicalField] || [];
}

module.exports = {
  resolveColumn,
  buildHeaderMap,
  getAliases,
  COLUMN_ALIASES,
};
