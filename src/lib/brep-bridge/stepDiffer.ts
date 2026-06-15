/**
 * stepDiffer — ISO 10303-21 (STEP Part 21) source diff tool for NexyFab Pro.
 *
 * SCOPE
 * -----
 * Pure-function comparison of two STEP source strings. Produces a structured
 * delta intended for version-control / change-tracking UIs:
 *
 *   - Header field changes (FILE_DESCRIPTION / FILE_NAME / FILE_SCHEMA /
 *     FILE_AUTHOR / …).
 *   - Schema change flag (AP203 ⇄ AP214 ⇄ AP242 transition).
 *   - Entity-level adds / removes / modifications, keyed on the STEP `#N`
 *     identifier.
 *   - PRODUCT-count delta (high-signal: a change in PRODUCT count usually
 *     means a part was added or removed from the assembly).
 *   - Human-readable one-line summary suitable for a commit-log row.
 *
 * ID MAPPING POLICY
 * -----------------
 * - The STEP `#N` identifier is treated as the diff key. Two entities with
 *   the same `#N` in old and new are paired; the diff says "modified" if
 *   their raw text differs.
 * - This is consistent with how STEP exporters typically re-emit a file:
 *   stable graph nodes keep their numbering across an edit. It is NOT
 *   robust against an exporter that renumbers every entity on each write —
 *   for that case a semantic / structural diff (Phase 2 wishlist) is needed.
 * - First-occurrence wins on duplicate `#N` (matches stepValidator).
 *
 * RAW vs SEMANTIC COMPARE
 * -----------------------
 * - `entitiesModified` reports raw-text differences only. A whitespace
 *   reformat, a trailing-zero change (`1.0` → `1.000`), or a re-ordering
 *   of argument lists all show up as a "modified" entity.
 * - This is intentional for Phase 1: a STEP file that round-trips through
 *   a CAD kernel often gets minor numeric reformatting; surfacing every
 *   such delta is correct behaviour for an exact-bytes change tracker.
 * - Phase 2 wishlist: semantic compare that normalises numeric literals
 *   to a canonical form (e.g. `parseFloat` round-trip) and ignores
 *   purely stylistic deltas.
 *
 * HEADER FIELD COVERAGE
 * ---------------------
 * The ISO 10303-21 HEADER section commonly carries:
 *   FILE_DESCRIPTION, FILE_NAME, FILE_SCHEMA, FILE_AUTHOR,
 *   FILE_ORGANIZATION, FILE_PREPROCESSOR_VERSION, FILE_ORIGINATING_SYSTEM,
 *   FILE_AUTHORISATION
 *
 * We compare every header entity that appears in EITHER source. The entity
 * payload (everything between the opening `(` and the terminating `;`) is
 * normalised by whitespace-collapsing before comparison so that pretty-
 * printer differences do not show up as header changes.
 *
 * SUMMARY FORMAT
 * --------------
 * One line, comma-separated change groups followed by the schema verdict:
 *
 *   "5 entities added, 2 removed, 3 modified; schema unchanged"
 *   "0 entities added, 0 removed, 0 modified; schema changed AP214 → AP242"
 *   "no changes" — emitted when every delta is empty AND the schema is
 *     unchanged AND header / productCount are unchanged.
 *
 * DESIGN NOTES
 * ------------
 * - Pure function. No I/O.
 * - Tolerant of malformed input: any side that fails `validateStep` still
 *   gets diffed best-effort — the diff is for human review, not a hard
 *   contract.
 * - We re-use the validator's lexer state-machine philosophy (skip strings
 *   and comments) but use a STEP-aware regex scan for entity extraction
 *   here because we need raw-text capture, not just id collection.
 */

import { validateStep, type StepProtocol } from './stepValidator';

// ─── public types ─────────────────────────────────────────────────────────

export interface StepDiff {
  /** True iff the detected protocol (AP203/AP214/AP242) changed. */
  schemaChanged: boolean;
  /** Entities present in `newSource` but not in `oldSource`. */
  entitiesAdded: Array<{ id: number; name: string }>;
  /** Entities present in `oldSource` but not in `newSource`. */
  entitiesRemoved: Array<{ id: number; name: string }>;
  /** Entities present in both but whose raw text differs. */
  entitiesModified: Array<{
    id: number;
    name: string;
    oldRaw: string;
    newRaw: string;
  }>;
  /** Header fields whose normalised payload differs (or that exist on
   *  only one side). */
  headerChanges: Array<{ field: string; old: string; new: string }>;
  /** `newProductCount - oldProductCount`. Zero ⇒ no change. */
  productCountChange: number;
  /** One-line human-readable summary; see module JSDoc for format. */
  summary: string;
}

// ─── public API ───────────────────────────────────────────────────────────

/**
 * Diff two STEP source strings. Returns a `StepDiff` describing header,
 * entity, schema, and product-count deltas. Pure function — both inputs
 * are read-only.
 *
 * @param oldSource STEP Part 21 source (the "before" revision).
 * @param newSource STEP Part 21 source (the "after"  revision).
 */
export function diffSteps(oldSource: string, newSource: string): StepDiff {
  const oldVal = validateStep(typeof oldSource === 'string' ? oldSource : '');
  const newVal = validateStep(typeof newSource === 'string' ? newSource : '');

  const oldEntities = extractEntities(
    typeof oldSource === 'string' ? oldSource : '',
  );
  const newEntities = extractEntities(
    typeof newSource === 'string' ? newSource : '',
  );

  // ── entity-level diff ────────────────────────────────────────────────
  const entitiesAdded: Array<{ id: number; name: string }> = [];
  const entitiesRemoved: Array<{ id: number; name: string }> = [];
  const entitiesModified: Array<{
    id: number;
    name: string;
    oldRaw: string;
    newRaw: string;
  }> = [];

  for (const [id, oldEnt] of oldEntities) {
    const newEnt = newEntities.get(id);
    if (!newEnt) {
      entitiesRemoved.push({ id, name: oldEnt.name });
      continue;
    }
    if (oldEnt.raw !== newEnt.raw) {
      entitiesModified.push({
        id,
        name: newEnt.name || oldEnt.name,
        oldRaw: oldEnt.raw,
        newRaw: newEnt.raw,
      });
    }
  }
  for (const [id, newEnt] of newEntities) {
    if (!oldEntities.has(id)) {
      entitiesAdded.push({ id, name: newEnt.name });
    }
  }

  // Stable ordering by id for deterministic output.
  entitiesAdded.sort((a, b) => a.id - b.id);
  entitiesRemoved.sort((a, b) => a.id - b.id);
  entitiesModified.sort((a, b) => a.id - b.id);

  // ── header-field diff ────────────────────────────────────────────────
  const oldHeader = extractHeader(
    typeof oldSource === 'string' ? oldSource : '',
  );
  const newHeader = extractHeader(
    typeof newSource === 'string' ? newSource : '',
  );
  const headerChanges = diffHeader(oldHeader, newHeader);

  // ── schema / protocol diff ───────────────────────────────────────────
  const oldProto = oldVal.protocol;
  const newProto = newVal.protocol;
  const schemaChanged =
    (oldProto || newProto)
      ? oldProto !== newProto
      : (oldVal.schema || '') !== (newVal.schema || '');

  // ── PRODUCT count diff ───────────────────────────────────────────────
  const oldProducts = countByName(oldEntities, 'PRODUCT');
  const newProducts = countByName(newEntities, 'PRODUCT');
  const productCountChange = newProducts - oldProducts;

  // ── summary ──────────────────────────────────────────────────────────
  const summary = buildSummary({
    added: entitiesAdded.length,
    removed: entitiesRemoved.length,
    modified: entitiesModified.length,
    headerChanged: headerChanges.length,
    productCountChange,
    schemaChanged,
    oldProto,
    newProto,
  });

  return {
    schemaChanged,
    entitiesAdded,
    entitiesRemoved,
    entitiesModified,
    headerChanges,
    productCountChange,
    summary,
  };
}

// ─── internals: entity extraction ─────────────────────────────────────────

interface ExtractedEntity {
  id: number;
  /** Upper-cased entity name (empty string for composite `( SUB() SUB() )`
   *  entities, matching stepValidator's behaviour). */
  name: string;
  /** Raw text of the entity definition, from `#N=` through the terminating
   *  `;` (inclusive), with leading/trailing whitespace trimmed but inner
   *  whitespace preserved. */
  raw: string;
}

/**
 * Walk the DATA section and extract every `#N=...;` definition as a raw
 * text slice keyed by id. Mirrors the lexer rules used in stepValidator
 * (skip strings, comments, doubled-quote escape) so we agree with the
 * validator on what counts as an entity boundary.
 *
 * Duplicate ids: first occurrence wins (consistent with stepValidator).
 */
function extractEntities(source: string): Map<number, ExtractedEntity> {
  const out = new Map<number, ExtractedEntity>();
  if (!source) return out;

  const dataStart = source.search(/\bDATA\s*;/i);
  if (dataStart < 0) return out;

  // Bound the scan to the DATA section so HEADER strings don't leak in.
  const endMarkerPos = source.search(/\bEND-ISO-10303-21\s*;/);
  const dataEnd = endMarkerPos > dataStart ? endMarkerPos : source.length;
  const block = source.slice(dataStart, dataEnd);

  const startMatch = block.match(/\bDATA\s*;/i);
  let i =
    startMatch && typeof startMatch.index === 'number'
      ? startMatch.index + startMatch[0].length
      : 0;

  const n = block.length;
  let inString = false;
  let inComment = false;

  while (i < n) {
    const ch = block[i]!;

    if (inComment) {
      if (ch === '*' && block[i + 1] === '/') {
        inComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === "'") {
        if (block[i + 1] === "'") {
          i += 2;
          continue;
        }
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === '/' && block[i + 1] === '*') {
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

    // Possible '#N=' definition start. Confirm by reading digits then '='.
    const defStart = i;
    const idStart = i + 1;
    let idEnd = idStart;
    while (idEnd < n) {
      const c = block[idEnd]!;
      if (c >= '0' && c <= '9') idEnd++;
      else break;
    }
    if (idEnd === idStart) {
      i++;
      continue;
    }

    // Skip whitespace between id and '='.
    let j = idEnd;
    while (j < n) {
      const c = block[j]!;
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') j++;
      else break;
    }
    if (block[j] !== '=') {
      // It's a reference, not a definition.
      i = idEnd;
      continue;
    }

    const id = Number.parseInt(block.slice(idStart, idEnd), 10);

    // Read entity name (or '(' for composite types).
    let k = j + 1;
    while (k < n) {
      const c = block[k]!;
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') k++;
      else break;
    }
    let name = '';
    if (block[k] !== '(') {
      const nameStart = k;
      while (k < n) {
        const c = block[k]!;
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
      name = block.slice(nameStart, k).toUpperCase();
    }

    // Walk to the terminating ';' that closes this entity, honouring
    // paren depth, strings, and comments.
    let depth = 0;
    let m = k;
    let s = false;
    let c2 = false;
    let endPos = -1;
    while (m < n) {
      const cc = block[m]!;
      if (c2) {
        if (cc === '*' && block[m + 1] === '/') {
          c2 = false;
          m += 2;
          continue;
        }
        m++;
        continue;
      }
      if (s) {
        if (cc === "'") {
          if (block[m + 1] === "'") {
            m += 2;
            continue;
          }
          s = false;
        }
        m++;
        continue;
      }
      if (cc === '/' && block[m + 1] === '*') {
        c2 = true;
        m += 2;
        continue;
      }
      if (cc === "'") {
        s = true;
        m++;
        continue;
      }
      if (cc === '(') depth++;
      else if (cc === ')') depth--;
      else if (cc === ';' && depth === 0) {
        endPos = m;
        break;
      }
      m++;
    }

    if (endPos < 0) {
      // Unterminated entity — stop scanning to avoid garbage.
      break;
    }

    const raw = block.slice(defStart, endPos + 1).trim();
    if (!out.has(id)) {
      out.set(id, { id, name, raw });
    }
    i = endPos + 1;
  }

  return out;
}

// ─── internals: header extraction ─────────────────────────────────────────

/** Map of `HEADER_ENTITY_NAME → normalised payload`. The payload is the
 *  full entity text (including the name and trailing `;`) with runs of
 *  whitespace collapsed to a single space so pretty-printer reformatting
 *  does not register as a header change. */
type HeaderMap = Map<string, string>;

function extractHeader(source: string): HeaderMap {
  const out: HeaderMap = new Map();
  if (!source) return out;

  const headerStart = source.search(/\bHEADER\s*;/i);
  if (headerStart < 0) return out;

  const slice = source.slice(headerStart);
  const endsec = slice.search(/\bENDSEC\s*;/i);
  const headerEnd =
    endsec >= 0 ? headerStart + endsec : source.length;
  const block = source.slice(headerStart, headerEnd);

  // Walk the header block honouring strings + paren depth, splitting on
  // top-level `;`. Each top-level statement is "NAME(args)" form.
  const n = block.length;
  let i = 0;
  let inString = false;
  let depth = 0;
  let stmtStart = 0;

  while (i < n) {
    const ch = block[i]!;
    if (inString) {
      if (ch === "'") {
        if (block[i + 1] === "'") {
          i += 2;
          continue;
        }
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === "'") {
      inString = true;
      i++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) {
      const stmt = block.slice(stmtStart, i + 1).trim();
      stmtStart = i + 1;
      // Skip the HEADER; opener itself.
      const m = stmt.match(/^([A-Za-z_][A-Za-z_0-9]*)\s*\(/);
      if (m) {
        const name = m[1]!.toUpperCase();
        if (name !== 'HEADER' && name !== 'ENDSEC') {
          const normalised = normaliseHeaderStmt(stmt);
          if (!out.has(name)) out.set(name, normalised);
        }
      }
    }
    i++;
  }

  return out;
}

/**
 * Normalise a header statement for diff stability:
 *   - Collapse all whitespace runs OUTSIDE string literals to a single space.
 *   - Strip whitespace immediately adjacent to STEP punctuation (`(`, `)`,
 *     `,`, `;`) when OUTSIDE strings. This makes pretty-printed (multi-line,
 *     indented) header entries compare equal to their single-line form.
 *   - Whitespace INSIDE single-quoted literals is preserved bit-for-bit so
 *     a deliberate filename change like `'a.step'` → `'a .step'` still
 *     registers.
 */
function normaliseHeaderStmt(stmt: string): string {
  let out = '';
  const n = stmt.length;
  let i = 0;
  let inString = false;
  while (i < n) {
    const ch = stmt[i]!;
    if (inString) {
      out += ch;
      if (ch === "'") {
        if (stmt[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === "'") {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      // Skip whitespace; if the previous emitted char is punctuation OR the
      // next non-WS char is punctuation, drop entirely. Otherwise collapse
      // to a single space.
      let j = i;
      while (
        j < n &&
        (stmt[j] === ' ' || stmt[j] === '\t' || stmt[j] === '\n' || stmt[j] === '\r')
      ) {
        j++;
      }
      const prev = out.length > 0 ? out[out.length - 1] : '';
      const next = j < n ? stmt[j]! : '';
      const isPunct = (c: string): boolean =>
        c === '(' || c === ')' || c === ',' || c === ';' || c === '';
      if (!isPunct(prev) && !isPunct(next)) {
        out += ' ';
      }
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out.trim();
}

function diffHeader(
  oldH: HeaderMap,
  newH: HeaderMap,
): Array<{ field: string; old: string; new: string }> {
  const out: Array<{ field: string; old: string; new: string }> = [];
  const fields = new Set<string>([...oldH.keys(), ...newH.keys()]);
  const ordered = Array.from(fields).sort();
  for (const f of ordered) {
    const oldV = oldH.get(f) || '';
    const newV = newH.get(f) || '';
    if (oldV !== newV) {
      out.push({ field: f, old: oldV, new: newV });
    }
  }
  return out;
}

// ─── internals: misc ──────────────────────────────────────────────────────

function countByName(
  entities: Map<number, ExtractedEntity>,
  name: string,
): number {
  let count = 0;
  for (const e of entities.values()) {
    if (e.name === name) count++;
  }
  return count;
}

interface SummaryInput {
  added: number;
  removed: number;
  modified: number;
  headerChanged: number;
  productCountChange: number;
  schemaChanged: boolean;
  oldProto: StepProtocol | undefined;
  newProto: StepProtocol | undefined;
}

function buildSummary(s: SummaryInput): string {
  const noChange =
    s.added === 0 &&
    s.removed === 0 &&
    s.modified === 0 &&
    s.headerChanged === 0 &&
    s.productCountChange === 0 &&
    !s.schemaChanged;
  if (noChange) return 'no changes';

  const schemaPart = s.schemaChanged
    ? `schema changed ${s.oldProto || 'unknown'} → ${s.newProto || 'unknown'}`
    : 'schema unchanged';

  return `${s.added} entities added, ${s.removed} removed, ${s.modified} modified; ${schemaPart}`;
}
