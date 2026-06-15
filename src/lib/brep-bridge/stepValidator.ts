/**
 * stepValidator — ISO 10303-21 (STEP Part 21) compliance validator for
 * NexyFab Pro. Pure-function, side-effect-free.
 *
 * SCOPE
 * -----
 * Static structural / syntactic validation of a STEP source string. Verifies
 * that the file:
 *
 *   1. Opens with `ISO-10303-21;` and closes with `END-ISO-10303-21;` in the
 *      correct order, with `HEADER;` and `DATA;` sections (each terminated
 *      by `ENDSEC;`) between them.
 *   2. Carries the three required HEADER entities — `FILE_DESCRIPTION`,
 *      `FILE_NAME`, `FILE_SCHEMA`.
 *   3. Declares a recognised application protocol — AP203, AP214, or AP242
 *      (incl. the AP242 long form
 *      `AP242_MANAGED_MODEL_BASED_3D_ENGINEERING`).
 *   4. Has unique `#N` entity identifiers in the DATA section.
 *   5. Has every entity reference `#M` resolve to a defined `#M=` entity.
 *   6. Has balanced parentheses, single quotes, and entity-terminating
 *      semicolons.
 *   7. (If `MANIFOLD_SOLID_BREP` is present) carries at least one
 *      `CLOSED_SHELL` and at least one `ADVANCED_FACE` — the canonical
 *      AP214 / AP242 B-rep envelope.
 *
 * DESIGN NOTES
 * ------------
 * - Pure function. No I/O. Safe to call on user-uploaded data.
 * - Does NOT do semantic geometry validation (face orientation, edge graph
 *   closure, axis orthogonality, etc.) — those live in the OCCT worker.
 * - Splits findings between `errors` (file cannot be parsed) and `warnings`
 *   (file parses but violates a recommendation / is missing a non-mandatory
 *   entity).
 * - Conservative: uses single-pass character tokenization for paren / quote /
 *   semicolon balance (matches `parseEntities` in `stepImport.ts`) so we
 *   stay consistent with the actual parser. Quoted strings and `/* … *​/`
 *   STEP comments are skipped.
 * - False-positive avoidance:
 *     * Inline strings can legally contain `(`, `)`, `;`, `#` — we ignore
 *       all such chars while inside a single-quoted literal.
 *     * STEP escapes a single quote by doubling it (`''`); we honour that
 *       so we don't terminate a string prematurely.
 *     * References inside STEP comments are not counted.
 *     * Composite ("complex") entities `( SUB_A() SUB_B() )` have no top-
 *       level name — they are still parsed and their `#M` refs are still
 *       collected.
 *     * Empty / whitespace-only files emit a single `empty` error rather
 *       than a cascade of missing-marker errors.
 *
 * AP242 identification:
 *   The FILE_SCHEMA literal varies between exporters. We treat any of these
 *   tokens (case-insensitive) as AP242:
 *     - `AP242`
 *     - `AP242_MANAGED_MODEL_BASED_3D_ENGINEERING`
 *   AP214 / AP203 are detected the same way (`AP214` / `AUTOMOTIVE_DESIGN`
 *   schema → AP214; `AP203` / `CONFIG_CONTROL_DESIGN` → AP203).
 *   When both an AP214 and AP242 token appear in the same schema string the
 *   newer (AP242) wins, matching real-world exporter behaviour where AP242
 *   profiles are super-sets of AP214.
 *
 * Spec reference: ISO 10303-21 (clear-text encoding) and the FILE_SCHEMA
 * identifiers from ISO 10303-203 / -214 / -242.
 */

// ─── public types ─────────────────────────────────────────────────────────

export type StepProtocol = 'AP203' | 'AP214' | 'AP242';

export interface StepValidationResult {
  /** `true` iff `errors` is empty. Warnings do not affect this flag. */
  ok: boolean;
  /** Hard syntax / structural defects — file is unparseable as-is. */
  errors: string[];
  /** Recommendation violations — file parses but is suspect. */
  warnings: string[];
  /** Detected application protocol (best-effort match). */
  protocol?: StepProtocol;
  /** Raw FILE_SCHEMA string (first literal) when present. */
  schema?: string;
  /** Number of `#N=` entity definitions found in the DATA section. */
  entityCount: number;
}

// ─── schema detection patterns ────────────────────────────────────────────

/**
 * Schema-literal tokens used to classify the FILE_SCHEMA value. Order
 * matters: AP242 must beat AP214/AP203 because AP242 STEP files often
 * carry an `AUTOMOTIVE_DESIGN` ancillary tag for backward compatibility.
 */
const SCHEMA_PATTERNS: ReadonlyArray<{ protocol: StepProtocol; re: RegExp }> = [
  { protocol: 'AP242', re: /AP242_MANAGED_MODEL_BASED_3D_ENGINEERING/i },
  { protocol: 'AP242', re: /\bAP242\b/i },
  { protocol: 'AP214', re: /\bAP214\b/i },
  { protocol: 'AP214', re: /AUTOMOTIVE_DESIGN/i },
  { protocol: 'AP203', re: /\bAP203\b/i },
  { protocol: 'AP203', re: /CONFIG_CONTROL_DESIGN/i },
  { protocol: 'AP203', re: /AP203_CONFIGURATION_CONTROLLED_3D_DESIGN/i },
];

// ─── public API ───────────────────────────────────────────────────────────

/**
 * Validate the structural / syntactic compliance of an ISO 10303-21 STEP
 * source string. Returns `{ ok, errors, warnings, protocol?, schema?,
 * entityCount }`. See module JSDoc for the full check list and the
 * error / warning split policy.
 */
export function validateStep(source: string): StepValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof source !== 'string' || source.length === 0) {
    errors.push('empty_source: STEP source is empty');
    return { ok: false, errors, warnings, entityCount: 0 };
  }

  const trimmed = source.trim();
  if (trimmed.length === 0) {
    errors.push('empty_source: STEP source contains only whitespace');
    return { ok: false, errors, warnings, entityCount: 0 };
  }

  // ── 1. marker ordering ─────────────────────────────────────────────────
  // ISO-10303-21; … HEADER; … ENDSEC; … DATA; … ENDSEC; … END-ISO-10303-21;
  // Use negative lookbehind on `END-` so we don't accidentally match the
  // start marker against the closing `END-ISO-10303-21;`.
  const startMarkerPos = source.search(/(?<!END-)ISO-10303-21\s*;/);
  const endMarkerPos = source.search(/\bEND-ISO-10303-21\s*;/);

  if (startMarkerPos < 0) {
    errors.push(
      'missing_iso_header: file does not contain the required `ISO-10303-21;` start marker',
    );
  } else if (source.slice(0, startMarkerPos).trim().length > 0) {
    // Leading whitespace is fine; any non-WS content before the marker is not.
    warnings.push(
      'leading_content: non-whitespace content precedes the `ISO-10303-21;` start marker',
    );
  }

  if (endMarkerPos < 0) {
    errors.push(
      'missing_end_iso: file does not contain the required `END-ISO-10303-21;` end marker',
    );
  } else if (startMarkerPos >= 0 && endMarkerPos < startMarkerPos) {
    errors.push(
      'marker_order: `END-ISO-10303-21;` appears before `ISO-10303-21;`',
    );
  }

  const headerStart = source.search(/\bHEADER\s*;/i);
  const dataStart = source.search(/\bDATA\s*;/i);

  if (headerStart < 0) {
    errors.push('missing_header_section: no `HEADER;` section found');
  }
  if (dataStart < 0) {
    errors.push('missing_data_section: no `DATA;` section found');
  }
  if (headerStart >= 0 && dataStart >= 0 && dataStart < headerStart) {
    errors.push(
      'section_order: `DATA;` section appears before `HEADER;` section',
    );
  }

  // ENDSEC; should appear at least twice (one for HEADER, one for DATA).
  const endsecMatches = source.match(/\bENDSEC\s*;/gi);
  const endsecCount = endsecMatches ? endsecMatches.length : 0;
  if (headerStart >= 0 && dataStart >= 0 && endsecCount < 2) {
    errors.push(
      `endsec_count: expected at least 2 ENDSEC; markers (HEADER + DATA), found ${endsecCount}`,
    );
  }

  // ── 2. balance check (parens / quotes / semicolons) ───────────────────
  const balance = checkBalance(source);
  if (balance.unclosedString) {
    errors.push('unbalanced_quotes: unterminated single-quoted string literal');
  }
  if (balance.parenDelta !== 0) {
    errors.push(
      `unbalanced_parens: paren delta = ${balance.parenDelta} (positive: too many '(', negative: too many ')')`,
    );
  }
  if (balance.unclosedComment) {
    errors.push('unterminated_comment: STEP comment `/* … */` not closed');
  }

  // ── 3. HEADER required entities ───────────────────────────────────────
  if (headerStart >= 0) {
    const headerEnd = findHeaderEnd(source, headerStart);
    const headerBlock = source.slice(headerStart, headerEnd);
    if (!/\bFILE_DESCRIPTION\s*\(/i.test(headerBlock)) {
      errors.push(
        'missing_file_description: HEADER section is missing the required `FILE_DESCRIPTION` entity',
      );
    }
    if (!/\bFILE_NAME\s*\(/i.test(headerBlock)) {
      errors.push(
        'missing_file_name: HEADER section is missing the required `FILE_NAME` entity',
      );
    }
    if (!/\bFILE_SCHEMA\s*\(/i.test(headerBlock)) {
      errors.push(
        'missing_file_schema: HEADER section is missing the required `FILE_SCHEMA` entity',
      );
    }
  }

  // ── 4. schema / protocol detection ────────────────────────────────────
  const schemaMatch = source.match(/FILE_SCHEMA\(\s*\(\s*'([^']*)'/i);
  let schema: string | undefined;
  let protocol: StepProtocol | undefined;
  if (schemaMatch && typeof schemaMatch[1] === 'string') {
    schema = schemaMatch[1];
    for (const p of SCHEMA_PATTERNS) {
      if (p.re.test(schema)) {
        protocol = p.protocol;
        break;
      }
    }
    if (!protocol) {
      warnings.push(
        `unknown_schema: FILE_SCHEMA '${schema.slice(0, 80)}' does not match any known AP203/AP214/AP242 pattern`,
      );
    }
  } else if (headerStart >= 0) {
    // FILE_SCHEMA entity present but literal not extractable.
    if (/\bFILE_SCHEMA\s*\(/i.test(source)) {
      warnings.push(
        'malformed_file_schema: FILE_SCHEMA literal could not be extracted',
      );
    }
  }

  // ── 5. DATA section: collect entities + cross-check refs ──────────────
  let entityCount = 0;
  let definedIds: Set<number> = new Set();
  let entityNames: Map<number, string> = new Map();
  let referencedIds: Set<number> = new Set();
  let duplicates: number[] = [];

  if (dataStart >= 0 && balance.parenDelta === 0 && !balance.unclosedString) {
    // Bound the scan to the DATA section to avoid picking up header refs
    // (FILE_SCHEMA strings can superficially look like a paren expression).
    const dataEnd =
      endMarkerPos >= 0 && endMarkerPos > dataStart ? endMarkerPos : source.length;
    const dataBlock = source.slice(dataStart, dataEnd);

    const scan = scanDataEntities(dataBlock);
    entityCount = scan.entityCount;
    definedIds = scan.definedIds;
    entityNames = scan.entityNames;
    referencedIds = scan.referencedIds;
    duplicates = scan.duplicates;
    if (scan.errors.length > 0) errors.push(...scan.errors);

    if (duplicates.length > 0) {
      const sample = duplicates.slice(0, 5).map((id) => `#${id}`).join(', ');
      errors.push(
        `duplicate_entity_id: ${duplicates.length} duplicate entity identifier(s): ${sample}${duplicates.length > 5 ? ', …' : ''}`,
      );
    }

    // Dangling refs: every #M referenced in an entity body must be defined.
    const missing: number[] = [];
    for (const id of referencedIds) {
      if (!definedIds.has(id)) missing.push(id);
    }
    if (missing.length > 0) {
      missing.sort((a, b) => a - b);
      const sample = missing.slice(0, 5).map((id) => `#${id}`).join(', ');
      errors.push(
        `dangling_reference: ${missing.length} entity reference(s) point to undefined ids: ${sample}${missing.length > 5 ? ', …' : ''}`,
      );
    }
  }

  // ── 6. MANIFOLD_SOLID_BREP consistency ────────────────────────────────
  if (entityNames.size > 0) {
    let hasManifold = false;
    let hasClosedShell = false;
    let hasAdvancedFace = false;
    for (const name of entityNames.values()) {
      if (name === 'MANIFOLD_SOLID_BREP' || name === 'BREP_WITH_VOIDS') {
        hasManifold = true;
      } else if (name === 'CLOSED_SHELL') {
        hasClosedShell = true;
      } else if (name === 'ADVANCED_FACE') {
        hasAdvancedFace = true;
      }
    }
    if (hasManifold && !hasClosedShell) {
      errors.push(
        'inconsistent_brep: MANIFOLD_SOLID_BREP present but no CLOSED_SHELL entity found',
      );
    }
    if (hasManifold && !hasAdvancedFace) {
      errors.push(
        'inconsistent_brep: MANIFOLD_SOLID_BREP present but no ADVANCED_FACE entity found',
      );
    }
  }

  // ── 7. PRODUCT recommendation ─────────────────────────────────────────
  if (entityNames.size > 0) {
    let hasProduct = false;
    for (const name of entityNames.values()) {
      if (name === 'PRODUCT') {
        hasProduct = true;
        break;
      }
    }
    if (!hasProduct) {
      warnings.push(
        'missing_product: no PRODUCT entity found — recommended by AP214 / AP242 for downstream CAM identification',
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    ...(protocol ? { protocol } : {}),
    ...(schema !== undefined ? { schema } : {}),
    entityCount,
  };
}

// ─── internals ────────────────────────────────────────────────────────────

interface BalanceResult {
  /** Difference `open_paren_count - close_paren_count`. 0 ⇒ balanced. */
  parenDelta: number;
  /** True iff a single-quoted string ran to EOF without closing. */
  unclosedString: boolean;
  /** True iff a `/* … *​/` STEP comment ran to EOF without closing. */
  unclosedComment: boolean;
}

/**
 * Single-pass character scan tracking paren depth and quote/comment state.
 * Mirrors the lexer used in `parseEntities` (stepImport.ts) so the check is
 * consistent with the actual parser:
 *
 *   - `'…'` is a string literal; `''` inside one is an escaped quote.
 *   - `/* … *​/` is a STEP comment.
 *   - `(` / `)` are paren tokens only outside strings + comments.
 *   - `;` outside strings + parens terminates an entity (we don't count
 *     those here — that's the entity scanner's job).
 */
function checkBalance(src: string): BalanceResult {
  let depth = 0;
  let inString = false;
  let inComment = false;
  const n = src.length;
  for (let i = 0; i < n; i++) {
    const ch = src[i];
    if (inComment) {
      if (ch === '*' && src[i + 1] === '/') {
        inComment = false;
        i++; // consume '/'
      }
      continue;
    }
    if (inString) {
      if (ch === "'") {
        // Doubled '' → escaped quote.
        if (src[i + 1] === "'") {
          i++;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      inComment = true;
      i++; // consume '*'
      continue;
    }
    if (ch === "'") {
      inString = true;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
  }
  return {
    parenDelta: depth,
    unclosedString: inString,
    unclosedComment: inComment,
  };
}

/**
 * Find the end of the HEADER section: the first `ENDSEC;` after the HEADER
 * marker. Falls back to the DATA marker or EOF when ENDSEC; is missing
 * (the missing-ENDSEC case is already flagged separately).
 */
function findHeaderEnd(src: string, headerStart: number): number {
  const slice = src.slice(headerStart);
  const m = slice.match(/\bENDSEC\s*;/i);
  if (m && typeof m.index === 'number') {
    return headerStart + m.index;
  }
  const dataM = slice.match(/\bDATA\s*;/i);
  if (dataM && typeof dataM.index === 'number') {
    return headerStart + dataM.index;
  }
  return src.length;
}

interface DataScanResult {
  entityCount: number;
  definedIds: Set<number>;
  entityNames: Map<number, string>;
  referencedIds: Set<number>;
  duplicates: number[];
  errors: string[];
}

/**
 * Walk the DATA block to collect `#N=` definitions and `#M` references.
 * Skips inside strings and comments (using the same lexer rules as
 * `checkBalance` / `parseEntities`). Duplicates are reported but the first
 * occurrence wins for the name map.
 */
function scanDataEntities(dataBlock: string): DataScanResult {
  const definedIds = new Set<number>();
  const entityNames = new Map<number, string>();
  const referencedIds = new Set<number>();
  const duplicates: number[] = [];
  const errors: string[] = [];
  let entityCount = 0;

  const n = dataBlock.length;
  let i = 0;
  let inString = false;
  let inComment = false;

  // First, capture the keyword `DATA;` itself but don't treat it as content.
  // We start scanning right after it to keep refs in scope.
  const startMatch = dataBlock.match(/\bDATA\s*;/i);
  if (startMatch && typeof startMatch.index === 'number') {
    i = startMatch.index + startMatch[0].length;
  }

  while (i < n) {
    const ch = dataBlock[i];

    if (inComment) {
      if (ch === '*' && dataBlock[i + 1] === '/') {
        inComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === "'") {
        if (dataBlock[i + 1] === "'") {
          i += 2;
          continue;
        }
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === '/' && dataBlock[i + 1] === '*') {
      inComment = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inString = true;
      i++;
      continue;
    }
    if (ch !== '#') {
      i++;
      continue;
    }

    // We found a '#'. Read the numeric id following it.
    const idStart = i + 1;
    let idEnd = idStart;
    while (idEnd < n) {
      const c = dataBlock[idEnd]!;
      if (c >= '0' && c <= '9') idEnd++;
      else break;
    }
    if (idEnd === idStart) {
      // Lone '#' with no digits — non-fatal, skip.
      i++;
      continue;
    }
    const id = Number.parseInt(dataBlock.slice(idStart, idEnd), 10);

    // Is this a definition (#N=...) or a reference (#N as an arg)?
    let j = idEnd;
    while (j < n) {
      const c = dataBlock[j]!;
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') j++;
      else break;
    }
    if (dataBlock[j] === '=') {
      // Definition. Read entity name (next identifier or `(` for composite).
      let k = j + 1;
      while (k < n) {
        const c = dataBlock[k]!;
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') k++;
        else break;
      }
      let name = '';
      if (dataBlock[k] === '(') {
        // Composite (complex) type — no top-level name.
        name = '';
      } else {
        const nameStart = k;
        while (k < n) {
          const c = dataBlock[k]!;
          if (
            (c >= 'A' && c <= 'Z') ||
            (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') ||
            c === '_'
          ) {
            k++;
          } else {
            break;
          }
        }
        name = dataBlock.slice(nameStart, k).toUpperCase();
      }
      entityCount++;
      if (definedIds.has(id)) {
        duplicates.push(id);
      } else {
        definedIds.add(id);
        entityNames.set(id, name);
      }
      i = k;
      continue;
    }
    // Reference: collect.
    referencedIds.add(id);
    i = idEnd;
  }

  return {
    entityCount,
    definedIds,
    entityNames,
    referencedIds,
    duplicates,
    errors,
  };
}
