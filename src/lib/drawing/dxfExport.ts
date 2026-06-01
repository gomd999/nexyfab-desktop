/**
 * dxfExport — Phase 4.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * Minimal DXF (ASCII) serializer for drawing sheets. DXF R12 group-code
 * format — simplest spec, supported by every CAD viewer.
 *
 * Scope (Phase 4.4 minimal):
 *   - HEADER section: minimal $ACADVER + a couple of standard variables.
 *   - ENTITIES section: LINE entities only (Phase 4.4.2 adds CIRCLE / ARC
 *     / POLYLINE / TEXT / DIMENSION).
 *   - One sheet per export. Multi-sheet documents emit a sequence.
 *   - Sheet's viewports are translated into LINE entities representing
 *     viewport border rectangles + a placeholder label TEXT entity.
 *     (Phase 4.4.3 hooks in the actual 3D projection edges via OCCT
 *     `HLR` / `HLRBRep_Algo`.)
 *
 * Out of scope (Phase 4.x+):
 *   - DWG binary format (use LibreDWG bridge or commercial library)
 *   - PDF export (use pdf-lib + the same per-viewport edge data)
 *   - Layer management beyond the default '0' layer
 *   - Dimension entities (LDIM / RDIM / ADIM)
 *   - Block / xref support
 */

import type { Sheet, Viewport } from './sheet';
import { paperDimensions } from './sheet';

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

function rectangle(x: number, y: number, w: number, h: number, layer = '0'): DxfGroup[] {
  // 4 LINE entities form a closed rect.
  return [
    ...lineEntity(x, y, x + w, y, layer),
    ...lineEntity(x + w, y, x + w, y + h, layer),
    ...lineEntity(x + w, y + h, x, y + h, layer),
    ...lineEntity(x, y + h, x, y, layer),
  ];
}

// ─── sheet → DXF ─────────────────────────────────────────────────────────

export function sheetToDxf(sheet: Sheet): string {
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
export function sheetsToDxf(sheets: ReadonlyArray<Sheet>): string {
  const parts: string[] = [];
  for (const s of sheets) {
    parts.push(`999\nNEXYFAB_SHEET:${s.id}`);
    parts.push(sheetToDxf(s));
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
