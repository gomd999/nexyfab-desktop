/**
 * stepRead — Phase 5.1 PURE-TS STEP (ISO 10303-21) pre-processor for NexyFab Pro.
 *
 * SCOPE
 * -----
 * Runs BEFORE the OCCT worker call in `processBrepStep.ts` to:
 *   1. Detect length units declared in the file (mm / inch / m) so callers
 *      can normalize geometry on import without round-tripping through OCCT.
 *   2. Catalog common file-level structural issues (missing markers, no DATA
 *      section, unknown FILE_SCHEMA) so the API can surface actionable error
 *      messages instead of the generic "worker rejected file" hand-off.
 *   3. Apply safe textual auto-fixes (CRLF→LF, trailing whitespace,
 *      forgotten entity-line semicolons) that recover hand-edited or
 *      transport-mangled STEP files without touching geometry.
 *   4. Provide a fast regex-level syntax check that callers can use as a
 *      lightweight gate (the canonical validation still lives in the
 *      OCCT worker — this is purely a pre-flight).
 *
 * DESIGN
 * ------
 * - Pure functions, no I/O, no native deps, no worker calls.
 * - Regex/string ops only — does NOT attempt to parse the entity graph.
 * - Conservative: when in doubt return 'unknown' / 'low' confidence rather
 *   than guessing. Auto-fixes are limited to whitespace and the trailing
 *   semicolon on entity lines; anything that could change semantics is
 *   reported as `fix: 'manual'` and left for the caller.
 *
 * Spec reference: ISO 10303-21 (Industrial automation systems — Product
 * data representation and exchange — Part 21: Implementation methods:
 * Clear text encoding of the exchange structure).
 */

// ─── unit detection ───────────────────────────────────────────────────────

export type StepUnit = 'mm' | 'inch' | 'm' | 'unknown';
export type StepConfidence = 'high' | 'medium' | 'low';

export interface StepUnitDetection {
  /** Resolved length unit. Defaults to 'mm' (with low confidence) when
   *  nothing matches — STEP exporters overwhelmingly default to mm and the
   *  downstream renderer is already mm-native. */
  unit: StepUnit;
  /** `high` = explicit SI_UNIT or CONVERSION_BASED_UNIT match.
   *  `medium` = only the FILE_SCHEMA / FILE_DESCRIPTION hints the unit.
   *  `low` = no signal found; falling back to default. */
  confidence: StepConfidence;
  /** The raw text fragment that drove the decision (empty for default). */
  raw: string;
}

/**
 * Detect the length unit declared by a STEP source string.
 *
 * Priority (highest → lowest):
 *   1. Explicit SI_UNIT(.MILLI.,.METRE.) / SI_UNIT($,.METRE.) — `high`.
 *   2. CONVERSION_BASED_UNIT('INCH', …) and friends — `high`.
 *   3. LENGTH_UNIT with metric/imperial hints in a free-form comment or
 *      FILE_DESCRIPTION — `medium`.
 *   4. Nothing matched → default to 'mm' with `low` confidence.
 */
export function detectStepUnits(stepSource: string): StepUnitDetection {
  if (typeof stepSource !== 'string' || stepSource.length === 0) {
    return { unit: 'mm', confidence: 'low', raw: '' };
  }

  // CONVERSION_BASED_UNIT('INCH', …) wins over a co-located SI_UNIT entry,
  // because by STEP convention the SI_UNIT in that case is just the
  // *reference* metric base for the conversion factor — the unit-of-record
  // the file actually uses is the named conversion unit.
  const cbuRe = /CONVERSION_BASED_UNIT\(\s*'([^']+)'/gi;
  for (const m of stepSource.matchAll(cbuRe)) {
    const name = (m[1] ?? '').toLowerCase();
    if (name === 'inch' || name === 'in' || name === 'inches') {
      return { unit: 'inch', confidence: 'high', raw: m[0] };
    }
    if (name === 'foot' || name === 'feet' || name === 'ft') {
      // No 'foot' bucket — surface as unknown so the caller can decide.
      return { unit: 'unknown', confidence: 'high', raw: m[0] };
    }
    if (name === 'millimetre' || name === 'millimeter' || name === 'mm') {
      return { unit: 'mm', confidence: 'high', raw: m[0] };
    }
    if (name === 'metre' || name === 'meter' || name === 'm') {
      return { unit: 'm', confidence: 'high', raw: m[0] };
    }
  }

  // SI_UNIT can appear inside a complex composite type or standalone. The
  // body can be `SI_UNIT(.MILLI.,.METRE.)` or `SI_UNIT($,.METRE.)`. We scan
  // every occurrence and rank by specificity (prefix > bare metre).
  const siUnitRe = /SI_UNIT\(\s*([^)]*?)\s*\)/gi;
  let bestSiMatch: { unit: StepUnit; raw: string } | null = null;
  for (const m of stepSource.matchAll(siUnitRe)) {
    const body = (m[1] ?? '').toUpperCase();
    // Only consider matches that reference .METRE. — angular SI_UNIT entries
    // reference .RADIAN. / .STERADIAN. and must not influence length.
    if (!body.includes('.METRE.')) continue;
    let unit: StepUnit;
    if (body.includes('.MILLI.')) unit = 'mm';
    else if (body.includes('.CENTI.')) unit = 'mm'; // promote to mm for safety; downstream pipeline is mm
    else if (body.includes('.KILO.')) unit = 'm';
    else if (body.includes('$')) unit = 'm'; // explicit "no prefix" → metre
    else unit = 'm';
    // Prefer a metric-prefixed match (e.g. .MILLI.) over a bare metre fallback.
    if (!bestSiMatch || (unit === 'mm' && bestSiMatch.unit !== 'mm')) {
      bestSiMatch = { unit, raw: m[0] };
    }
  }
  if (bestSiMatch) {
    return { unit: bestSiMatch.unit, confidence: 'high', raw: bestSiMatch.raw };
  }

  // Medium-confidence hints: FILE_DESCRIPTION strings or schema name often
  // include 'mm' / 'inch' / 'metric' tokens when the explicit unit row is
  // missing or corrupted.
  const hintRe = /FILE_DESCRIPTION\(\s*\(\s*'([^']*)'/i;
  const fdMatch = stepSource.match(hintRe);
  if (fdMatch) {
    const desc = (fdMatch[1] ?? '').toLowerCase();
    if (/\binch(es)?\b/.test(desc)) {
      return { unit: 'inch', confidence: 'medium', raw: fdMatch[0] };
    }
    if (/\bmillimet(er|re)s?\b|\bmm\b/.test(desc)) {
      return { unit: 'mm', confidence: 'medium', raw: fdMatch[0] };
    }
    if (/\bmet(er|re)s?\b/.test(desc)) {
      return { unit: 'm', confidence: 'medium', raw: fdMatch[0] };
    }
  }

  // Default: mm with low confidence. CAD industry convention.
  return { unit: 'mm', confidence: 'low', raw: '' };
}

// ─── structural issue detection ───────────────────────────────────────────

export type StepIssueCode =
  | 'missing_iso_header'
  | 'missing_end_iso'
  | 'no_data_section'
  | 'no_header_section'
  | 'unknown_schema'
  | 'mismatched_endsec'
  | 'crlf_line_endings'
  | 'missing_trailing_semicolon';

export interface StepIssue {
  code: StepIssueCode;
  message: string;
  /** `auto` = `healStepSource` will fix it. `manual` = needs operator action. */
  fix?: 'auto' | 'manual';
}

export type StepSeverity = 'ok' | 'warn' | 'error';

export interface StepIssueReport {
  issues: StepIssue[];
  /** `error` = file is unparseable as-is. `warn` = parseable but suspect.
   *  `ok` = no concerns surfaced. */
  severity: StepSeverity;
}

const KNOWN_SCHEMAS: readonly RegExp[] = [
  /AUTOMOTIVE_DESIGN/i,
  /CONFIG_CONTROL_DESIGN/i,
  /AP203/i,
  /AP214/i,
  /AP242/i,
  /AP203_CONFIGURATION_CONTROLLED_3D_DESIGN/i,
  /STRUCTURAL_FRAME_SCHEMA/i,
];

/**
 * Inspect a STEP source for common structural defects. Returns an
 * { issues, severity } report. `severity` is derived from the worst issue:
 *   - any `missing_iso_header` / `missing_end_iso` / `no_data_section` →
 *     `error` (file will not load).
 *   - `unknown_schema` / `missing_trailing_semicolon` / `crlf_line_endings`
 *     → `warn`.
 *   - empty issues list → `ok`.
 */
export function analyzeStepIssues(stepSource: string): StepIssueReport {
  const issues: StepIssue[] = [];
  if (typeof stepSource !== 'string' || stepSource.length === 0) {
    issues.push({
      code: 'missing_iso_header',
      message: 'Source is empty — expected ISO-10303-21; start marker.',
      fix: 'manual',
    });
    return { issues, severity: 'error' };
  }

  const trimmed = stepSource.trimStart();
  if (!/^ISO-10303-21\s*;/.test(trimmed)) {
    issues.push({
      code: 'missing_iso_header',
      message: 'File does not start with the required `ISO-10303-21;` marker.',
      fix: 'manual',
    });
  }

  // `END-ISO-10303-21;` must appear, ideally as the final non-empty line.
  if (!/END-ISO-10303-21\s*;/.test(stepSource)) {
    issues.push({
      code: 'missing_end_iso',
      message: 'File is missing the trailing `END-ISO-10303-21;` marker.',
      fix: 'manual',
    });
  }

  // HEADER / DATA sections.
  const hasHeader = /\bHEADER\s*;/i.test(stepSource);
  const hasData = /\bDATA\s*;/i.test(stepSource);
  if (!hasHeader) {
    issues.push({
      code: 'no_header_section',
      message: 'No `HEADER;` section found — required by ISO 10303-21.',
      fix: 'manual',
    });
  }
  if (!hasData) {
    issues.push({
      code: 'no_data_section',
      message: 'No `DATA;` section found — file contains no entity data.',
      fix: 'manual',
    });
  }

  // Each opened section must be terminated by ENDSEC;. With HEADER+DATA
  // present we expect at least 2 ENDSEC; markers.
  if (hasHeader && hasData) {
    const endsecCount = (stepSource.match(/\bENDSEC\s*;/gi) ?? []).length;
    if (endsecCount < 2) {
      issues.push({
        code: 'mismatched_endsec',
        message: `Found ${endsecCount} ENDSEC; marker(s); expected at least 2 (HEADER + DATA).`,
        fix: 'manual',
      });
    }
  }

  // FILE_SCHEMA — present and recognised.
  const schemaMatch = stepSource.match(/FILE_SCHEMA\(\s*\(\s*'([^']*)'/i);
  if (!schemaMatch) {
    issues.push({
      code: 'unknown_schema',
      message: 'FILE_SCHEMA record missing — schema cannot be identified.',
      fix: 'manual',
    });
  } else {
    const schemaText = schemaMatch[1] ?? '';
    const recognised = KNOWN_SCHEMAS.some((re) => re.test(schemaText));
    if (!recognised) {
      issues.push({
        code: 'unknown_schema',
        message: `Unrecognised FILE_SCHEMA '${schemaText.slice(0, 80)}'. Worker may reject it.`,
        fix: 'manual',
      });
    }
  }

  // Line-ending hygiene — Windows CRLF is tolerated by most parsers but
  // some embedded readers stumble. Always surface as auto-fixable.
  if (stepSource.includes('\r')) {
    issues.push({
      code: 'crlf_line_endings',
      message: 'File contains CR / CRLF line endings; LF is recommended.',
      fix: 'auto',
    });
  }

  // Detect at least one entity line that's missing its terminating
  // semicolon. We scan inside the DATA section only to avoid flagging
  // header lines whose semicolons are checked above.
  if (hasData) {
    const dataIdx = stepSource.search(/\bDATA\s*;/i);
    const endIdx = stepSource.indexOf('END-ISO-10303-21');
    const dataBlock =
      dataIdx >= 0
        ? stepSource.slice(dataIdx, endIdx >= 0 ? endIdx : undefined)
        : '';
    // Entity definition lines look like `#N=ENTITY(...);`. Match a `#N=...`
    // run that does NOT end with `;` before its line break.
    const entityLineRe = /^#\d+\s*=[^\n]*$/gm;
    let missingSemi = false;
    for (const m of dataBlock.matchAll(entityLineRe)) {
      const line = (m[0] ?? '').trimEnd();
      if (!line.endsWith(';')) {
        missingSemi = true;
        break;
      }
    }
    if (missingSemi) {
      issues.push({
        code: 'missing_trailing_semicolon',
        message:
          'At least one entity line in DATA is missing the terminating `;`.',
        fix: 'auto',
      });
    }
  }

  const severity: StepSeverity = pickSeverity(issues);
  return { issues, severity };
}

function pickSeverity(issues: readonly StepIssue[]): StepSeverity {
  if (issues.length === 0) return 'ok';
  const errorCodes: ReadonlySet<StepIssueCode> = new Set<StepIssueCode>([
    'missing_iso_header',
    'missing_end_iso',
    'no_data_section',
    'no_header_section',
    'mismatched_endsec',
  ]);
  for (const i of issues) {
    if (errorCodes.has(i.code)) return 'error';
  }
  return 'warn';
}

// ─── auto-healing ─────────────────────────────────────────────────────────

export interface StepHealResult {
  /** Possibly-modified source. Always returned even when no fix applied. */
  healed: string;
  /** Human-readable identifiers of fixes that were applied. Empty list ⇒
   *  source was already clean. Stable for snapshot tests / telemetry. */
  appliedFixes: string[];
}

/**
 * Apply safe, semantics-preserving auto-fixes to a STEP source:
 *
 *   - `normalize_line_endings_lf`: rewrite CRLF and lone CR to LF.
 *   - `strip_trailing_whitespace`: remove run-on spaces/tabs at end of line.
 *   - `add_missing_entity_semicolons`: append `;` to entity lines that look
 *     like `#N=ENTITY(...)` but are missing the terminator.
 *   - `add_missing_end_iso`: append `END-ISO-10303-21;` if absent.
 *
 * Anything that could change semantics (renumber refs, fix schema names,
 * insert a HEADER section, etc.) is intentionally OUT of scope — those are
 * reported by `analyzeStepIssues` with `fix: 'manual'` and left for the
 * caller to surface in the UI.
 */
export function healStepSource(stepSource: string): StepHealResult {
  const appliedFixes: string[] = [];
  if (typeof stepSource !== 'string' || stepSource.length === 0) {
    return { healed: '', appliedFixes };
  }

  let healed = stepSource;

  // 1. Normalize line endings to LF.
  if (healed.includes('\r')) {
    healed = healed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    appliedFixes.push('normalize_line_endings_lf');
  }

  // 2. Strip trailing whitespace on each line. (Run before semicolon fix so
  //    we don't confuse `#1=FOO()    ` with a line that lacks `;`.)
  const trimmedLines = healed.split('\n').map((ln) => ln.replace(/[ \t]+$/g, ''));
  const afterTrim = trimmedLines.join('\n');
  if (afterTrim !== healed) {
    healed = afterTrim;
    appliedFixes.push('strip_trailing_whitespace');
  }

  // 3. Append `;` to entity-definition lines that are missing one.
  //    Match scope: only `#N=...` lines (HEADER metadata lines like
  //    `FILE_SCHEMA(...)` are already validated by `analyzeStepIssues`).
  //    We're cautious: only append when the line has balanced parens, to
  //    avoid mangling a line that's actually a wrapped continuation.
  const lines = healed.split('\n');
  let semiFixed = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (!/^#\d+\s*=/.test(ln)) continue;
    if (ln.endsWith(';')) continue;
    // Balanced paren check: equal `(` and `)` counts AND non-empty trailing
    // content. STEP composite types nest parens, so just compare counts.
    let open = 0;
    let close = 0;
    let inString = false;
    for (let j = 0; j < ln.length; j++) {
      const ch = ln[j];
      if (ch === "'") {
        // Doubled quote = escaped — skip both.
        if (ln[j + 1] === "'") {
          j++;
          continue;
        }
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '(') open++;
      else if (ch === ')') close++;
    }
    if (open === close && open > 0) {
      lines[i] = ln + ';';
      semiFixed = true;
    }
  }
  if (semiFixed) {
    healed = lines.join('\n');
    appliedFixes.push('add_missing_entity_semicolons');
  }

  // 4. Append END-ISO-10303-21; if missing. Place it on its own final line.
  if (!/END-ISO-10303-21\s*;/.test(healed)) {
    if (!healed.endsWith('\n')) healed += '\n';
    healed += 'END-ISO-10303-21;\n';
    appliedFixes.push('add_missing_end_iso');
  }

  return { healed, appliedFixes };
}

// ─── syntax validation ───────────────────────────────────────────────────

export interface StepSyntaxResult {
  valid: boolean;
  errors: string[];
}

/**
 * Fast regex-level syntax check. Confirms:
 *   - source begins with `ISO-10303-21;` (allowing leading whitespace)
 *   - contains `HEADER;` … `ENDSEC;` and `DATA;` … `ENDSEC;` sections
 *   - ends (after trimming) with `END-ISO-10303-21;`
 *
 * Does NOT walk the entity graph; that's the worker's job. Use this for
 * pre-flight gating and friendlier client-side error messages.
 */
export function validateStepSyntax(stepSource: string): StepSyntaxResult {
  const errors: string[] = [];
  if (typeof stepSource !== 'string' || stepSource.length === 0) {
    return { valid: false, errors: ['empty_source'] };
  }

  const trimmed = stepSource.trimStart();
  if (!/^ISO-10303-21\s*;/.test(trimmed)) {
    errors.push('missing_iso_start_marker');
  }
  if (!stepSource.trimEnd().endsWith('END-ISO-10303-21;')) {
    errors.push('missing_iso_end_marker');
  }
  if (!/\bHEADER\s*;/i.test(stepSource)) {
    errors.push('missing_header_section');
  }
  if (!/\bDATA\s*;/i.test(stepSource)) {
    errors.push('missing_data_section');
  }
  const endsecCount = (stepSource.match(/\bENDSEC\s*;/gi) ?? []).length;
  if (endsecCount < 2) {
    errors.push(`endsec_count_${endsecCount}_lt_2`);
  }

  return { valid: errors.length === 0, errors };
}
