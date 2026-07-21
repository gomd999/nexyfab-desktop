/**
 * dxfExport — Phase 4.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * Minimal DXF (ASCII) serializer for drawing sheets. DXF R12 group-code
 * format — simplest spec, supported by every CAD viewer.
 *
 * Scope (Phase 4.4 minimal + W4 G2 dimension carry):
 *   - HEADER section: minimal $ACADVER + a couple of standard variables.
 *   - ENTITIES section: LINE / TEXT / SOLID entities.
 *   - One sheet per export. Multi-sheet documents emit a sequence.
 *   - Sheet's viewports are translated into LINE entities representing
 *     viewport border rectangles + a placeholder label TEXT entity.
 *     (Phase 4.4.3 hooks in the actual 3D projection edges via OCCT
 *     `HLR` / `HLRBRep_Algo`.)
 *   - Sheet dimensions (opt-in via `opts.topologies`): each dimension is
 *     REAL-measured through `measureSheetDimension` (W4-A) and emitted as
 *     EXPLODED R12 primitives — dimension line + extension lines (LINE),
 *     filled arrowheads (SOLID), measured-value label (TEXT) — on a
 *     dedicated `DIM_<id>` layer. Unmeasurable dimensions NEVER emit a
 *     number: they carry the `<kind>` placeholder text plus a 999 comment
 *     with the explicit failure reason (값 날조 금지).
 *
 *     WHY exploded primitives instead of a true DIMENSION entity: an R12
 *     DIMENSION entity is only rendered from its anonymous `*D` block —
 *     AutoCAD stores the visual geometry in a BLOCKS-section block the
 *     entity references (group 2), plus a DIMSTYLE table entry. This
 *     exporter intentionally has no TABLES/BLOCKS sections, and a
 *     DIMENSION without its block renders BLANK (or errors) in strict R12
 *     viewers. Exploded LINE+SOLID+TEXT is what AutoCAD itself puts inside
 *     that block, is legible in every viewer, and keeps the measured value
 *     visibly on the sheet. Trade-off (근사 명시): the result is not an
 *     associative dimension object on the DXF side — re-dimensioning in a
 *     downstream CAD requires re-creating the dimension there.
 *
 * Out of scope (Phase 4.x+):
 *   - DWG binary format (use LibreDWG bridge or commercial library)
 *   - PDF export (use pdf-lib + the same per-viewport edge data)
 *   - Layer TABLE management (layers are referenced, not declared — valid
 *     in R12, where undeclared layers default to continuous/white)
 *   - True DIMENSION entities + the BLOCKS/DIMSTYLE machinery they need
 *   - Block / xref support
 */

import type { Sheet, Viewport } from './sheet';
import { paperDimensions } from './sheet';
import type { Dimension } from './dimension';
import { formatTolerance } from './dimension';
import type { NamedTopology } from '@/lib/cad/topoNaming';
import { measureSheetDimension, formatMeasuredValue } from './associativeUpdate';

// ─── DXF group-code primitives ───────────────────────────────────────────

interface DxfGroup { code: number; value: string }

function group(code: number, value: number | string): DxfGroup {
  return { code, value: typeof value === 'number' ? num(value) : value };
}

function num(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`dxfExport: non-finite number ${n}`);
  if (Math.abs(n) < 1e-12) return '0.0';
  // 6 decimal places balances precision with DXF parser quirks across viewers.
  return Number(n.toFixed(6)).toString();
}

function emit(groups: DxfGroup[]): string {
  const lines: string[] = [];
  for (const g of groups) {
    // DXF spec: code is right-justified in a 3-character field followed by
    // newline, then value on the next line. Strict parsers tolerate either
    // form, but staying in spec helps with older AutoCAD versions.
    lines.push(g.code.toString().padStart(3, ' '));
    lines.push(g.value);
  }
  return lines.join('\n');
}

// ─── entity emitters ─────────────────────────────────────────────────────

function lineEntity(x1: number, y1: number, x2: number, y2: number, layer = '0'): DxfGroup[] {
  return [
    group(0, 'LINE'),
    group(8, layer),
    group(10, x1),
    group(20, y1),
    group(30, 0),
    group(11, x2),
    group(21, y2),
    group(31, 0),
  ];
}

function textEntity(x: number, y: number, height: number, text: string, layer = '0'): DxfGroup[] {
  return [
    group(0, 'TEXT'),
    group(8, layer),
    group(10, x),
    group(20, y),
    group(30, 0),
    group(40, height),
    group(1, text),
  ];
}

/**
 * Centre-aligned TEXT (R12 group 72=1 + second alignment point). The first
 * alignment point (10/20) is set to the same point so parsers that ignore
 * group 72 degrade to left-aligned text AT the centre — mild, not wrong.
 */
function centeredTextEntity(x: number, y: number, height: number, text: string, layer = '0'): DxfGroup[] {
  return [
    group(0, 'TEXT'),
    group(8, layer),
    group(10, x),
    group(20, y),
    group(30, 0),
    group(40, height),
    group(1, text),
    group(72, 1),
    group(11, x),
    group(21, y),
    group(31, 0),
  ];
}

/**
 * Filled triangle via the R12 SOLID entity (arrowheads). SOLID takes four
 * corners (13/23 duplicates the third for a triangle — the standard form,
 * which also sidesteps SOLID's 3rd/4th-vertex z-order quirk).
 */
function solidTriangle(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number, layer = '0',
): DxfGroup[] {
  return [
    group(0, 'SOLID'),
    group(8, layer),
    group(10, ax), group(20, ay), group(30, 0),
    group(11, bx), group(21, by), group(31, 0),
    group(12, cx), group(22, cy), group(32, 0),
    group(13, cx), group(23, cy), group(33, 0),
  ];
}

function rectangle(x: number, y: number, w: number, h: number, layer = '0'): DxfGroup[] {
  // 4 LINE entities form a closed rect.
  return [
    ...lineEntity(x, y, x + w, y, layer),
    ...lineEntity(x + w, y, x + w, y + h, layer),
    ...lineEntity(x + w, y + h, x, y + h, layer),
    ...lineEntity(x, y + h, x, y, layer),
  ];
}

// ─── dimensions → exploded R12 primitives ────────────────────────────────

/**
 * R12 TEXT is ASCII: drafting glyphs travel as AutoCAD control codes, the
 * R12-era convention every viewer understands (%%c = ⌀, %%d = °, %%p = ±).
 * Other non-ASCII characters pass through unchanged (근사 — R12 viewers may
 * mangle them; the standard drafting glyphs are the ones that matter here).
 */
function dxfText(s: string): string {
  return s.replace(/⌀/g, '%%c').replace(/°/g, '%%d').replace(/±/g, '%%p');
}

/** 999-comment values must stay on one line — DXF values are line-delimited. */
function oneLine(s: string): string {
  return s.replace(/\s*\r?\n\s*/g, ' ');
}

/**
 * Emit one sheet dimension as exploded primitives on layer `DIM_<id>`.
 *
 * Value resolution mirrors SheetRenderer's DimensionLayer exactly (W4-A):
 *   1. `valueOverride` (authored IR) wins;
 *   2. a successful `measureSheetDimension` value — real, never fabricated —
 *      formatted with `formatMeasuredValue` + the same ⌀/R/° conventions;
 *   3. otherwise the `<kind>` placeholder text, PLUS a 999 comment carrying
 *      the explicit failure reason. No number is ever emitted in this case.
 *
 * Placement mirrors DimensionLayer's rule — horizontal call stacked inside
 * the target viewport (rows of `index % 3`, one stride above centre, then
 * stepping toward the sheet bottom). 근사 명시: DimensionLayer stacks within
 * the RESOLVED projection bbox in SVG y-down coordinates; here we stack
 * within the nominal `viewportSheetBox` in DXF y-up coordinates (mirrored),
 * so absolute positions differ slightly from the SVG/PDF render while the
 * stacking rule and the viewport containment are the same.
 */
function dimensionGroups(
  dim: Dimension,
  index: number,
  viewports: ReadonlyArray<Viewport>,
  topologies: ReadonlyMap<string, NamedTopology>,
): DxfGroup[] {
  const layer = `DIM_${dim.id}`;
  const vp = viewports.find((v) => v.id === dim.viewportId);
  if (!vp) {
    // No viewport → no placement box; a comment is the only honest output.
    return [group(999, oneLine(
      `NEXYFAB_DIM_UNMEASURED:${dim.id} reason=viewport-not-found detail=no viewport '${dim.viewportId}' on sheet`,
    ))];
  }

  const measured = measureSheetDimension(dim, viewports, topologies);
  const measuredOk = measured && measured.ok ? measured : null;

  const groups: DxfGroup[] = [];
  if (!measuredOk && dim.valueOverride === undefined) {
    const failure = measured && !measured.ok ? measured : null;
    const reason = failure ? failure.reason : 'no-measurement-context';
    const detail = failure
      ? failure.detail
      : vp.projection.kind !== 'standard'
        ? `viewport '${vp.id}' is not a standard view`
        : `no topology supplied for source '${vp.sourceId}'`;
    groups.push(group(999, oneLine(`NEXYFAB_DIM_UNMEASURED:${dim.id} reason=${reason} detail=${detail}`)));
  }

  // Label — same composition order as DimensionLayer.
  const nominal =
    dim.valueOverride !== undefined
      ? dim.valueOverride.toString()
      : measuredOk
        ? formatMeasuredValue(measuredOk.value)
        : `<${dim.kind}>`;
  const autoPrefix =
    measuredOk && dim.valueOverride === undefined && dim.prefix === undefined
      ? dim.kind === 'diametric' ? '⌀' : dim.kind === 'radial' ? 'R' : ''
      : '';
  const autoSuffix =
    measuredOk && dim.valueOverride === undefined && dim.suffix === undefined
      ? measuredOk.unit === 'deg' ? '°' : ''
      : '';
  const tolerance = dim.tolerance ? formatTolerance(dim.tolerance) : '';
  const label = dxfText(
    `${dim.prefix ?? autoPrefix}${nominal}${autoSuffix}${tolerance}${dim.suffix ?? ''}`,
  );

  // Geometry — DimensionLayer's stacking rule, mirrored into DXF y-up.
  const box = viewportSheetBox(vp);
  const arrowSize = Math.max(1.5, box.h * 0.02);
  const fontSize = Math.max(2.5, box.h * 0.04);
  const rowStride = fontSize * 2.4;
  const rowOffset = (index % 3) * rowStride;
  // SVG (y-down): centre + rowOffset − rowStride. Mirrored (y-up):
  const midY = box.y + box.h / 2 + rowStride - rowOffset;
  const inset = Math.min(box.w * 0.1, 4);
  const x1 = box.x + inset;
  const x2 = box.x + box.w - inset;

  // Dimension line.
  groups.push(...lineEntity(x1, midY, x2, midY, layer));
  // Arrowheads (filled SOLID triangles, apex at the extension lines).
  groups.push(...solidTriangle(x1, midY, x1 + arrowSize, midY - arrowSize / 2, x1 + arrowSize, midY + arrowSize / 2, layer));
  groups.push(...solidTriangle(x2, midY, x2 - arrowSize, midY - arrowSize / 2, x2 - arrowSize, midY + arrowSize / 2, layer));
  // Extension (witness) lines.
  groups.push(...lineEntity(x1, midY - arrowSize * 1.5, x1, midY + arrowSize * 1.5, layer));
  groups.push(...lineEntity(x2, midY - arrowSize * 1.5, x2, midY + arrowSize * 1.5, layer));
  // Value label above the dimension line (y-up: above = +y).
  groups.push(...centeredTextEntity((x1 + x2) / 2, midY + arrowSize + 0.5, fontSize, label, layer));
  return groups;
}

// ─── sheet → DXF ─────────────────────────────────────────────────────────

export interface SheetToDxfOptions {
  /**
   * Per-source NamedTopology map — the same map SheetRenderer consumes.
   * When supplied, `sheet.dimensions` are real-measured and emitted (see
   * `dimensionGroups`). When omitted, output is byte-identical to the
   * pre-W4 exporter (backward compatible; pinned by test).
   */
  topologies?: ReadonlyMap<string, NamedTopology>;
}

export function sheetToDxf(sheet: Sheet, opts?: SheetToDxfOptions): string {
  const dim = paperDimensions(sheet.paperSize, sheet.customPaper);
  const groups: DxfGroup[] = [
    // HEADER section.
    group(0, 'SECTION'),
    group(2, 'HEADER'),
    group(9, '$ACADVER'),
    group(1, 'AC1009'), // R12 — broad compat
    group(9, '$INSBASE'),
    group(10, 0), group(20, 0), group(30, 0),
    group(9, '$EXTMIN'),
    group(10, 0), group(20, 0), group(30, 0),
    group(9, '$EXTMAX'),
    group(10, dim.width), group(20, dim.height), group(30, 0),
    group(0, 'ENDSEC'),

    // ENTITIES section.
    group(0, 'SECTION'),
    group(2, 'ENTITIES'),
  ];

  // Sheet border rectangle (full paper).
  for (const g of rectangle(0, 0, dim.width, dim.height, 'SHEET_BORDER')) {
    groups.push(g);
  }

  // Per-viewport border + label.
  for (const vp of sheet.viewports) {
    const halfW = vp.widthOnSheet / 2;
    // Default 4:3-ish aspect for placeholder rect; renderer will replace
    // with the projected geometry's actual bbox.
    const halfH = halfW * 0.75;
    const x = vp.centerOnSheet.x - halfW;
    const y = vp.centerOnSheet.y - halfH;
    for (const g of rectangle(x, y, halfW * 2, halfH * 2, `VP_${vp.id}`)) {
      groups.push(g);
    }
    if (vp.label) {
      const textHeight = Math.max(3, halfH * 0.08);
      const labelY = y - textHeight - 2;
      for (const g of textEntity(x + halfW - textHeight * 2, labelY, textHeight, vp.label, `VP_${vp.id}_LABEL`)) {
        groups.push(g);
      }
    }
  }

  // Dimensions — only when a topology map was supplied (opt-in keeps the
  // no-topologies output byte-identical to the pre-W4 exporter).
  const topologies = opts?.topologies;
  if (topologies) {
    (sheet.dimensions ?? []).forEach((d, i) => {
      for (const g of dimensionGroups(d, i, sheet.viewports, topologies)) {
        groups.push(g);
      }
    });
  }

  groups.push(group(0, 'ENDSEC'));
  groups.push(group(0, 'EOF'));
  return emit(groups);
}

/**
 * Multi-sheet variant — produces a single DXF stream with all sheets
 * concatenated. DXF doesn't natively support multi-sheet layouts; this
 * is a convention NexyFab uses (each sheet starts with a comment marker
 * the importer can split on).
 */
export function sheetsToDxf(sheets: ReadonlyArray<Sheet>, opts?: SheetToDxfOptions): string {
  const parts: string[] = [];
  for (const s of sheets) {
    parts.push(`999\nNEXYFAB_SHEET:${s.id}`);
    parts.push(sheetToDxf(s, opts));
  }
  return parts.join('\n');
}

// ─── viewport scaling helper (Phase 4.4.3 will use) ──────────────────────

export function viewportSheetBox(vp: Viewport): { x: number; y: number; w: number; h: number } {
  const halfW = vp.widthOnSheet / 2;
  const halfH = halfW * 0.75;
  return {
    x: vp.centerOnSheet.x - halfW,
    y: vp.centerOnSheet.y - halfH,
    w: halfW * 2,
    h: halfH * 2,
  };
}
