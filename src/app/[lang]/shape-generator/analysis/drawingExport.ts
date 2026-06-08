import { downloadBlob } from '@/lib/platform';

// ─── Vector export for Auto Drawing (PDF + DXF R12 + SVG) ───────────────────
// Converts a DrawingResult (produced by autoDrawing.ts) into:
//   - PDF via jsPDF (true vector, mm units, crisp print output)
//   - DXF R12 ASCII (LINE + TEXT entities, openable in AutoCAD/FreeCAD/LibreCAD)
//   - SVG string (headless / CI — layout mirrors AutoDrawingPanel preview)

import type { DrawingResult, DrawingLine, DrawingText, ViewResult } from './autoDrawing';
import type { jsPDF } from 'jspdf';
import { detectCirclesAndArcs, type Seg } from './dxfArcDetect';

/** PDF/DXF/SVG 미리보기 공통 — 표제란 리비전 필드 접두사(CAD 관례, ASCII). */
export const DRAWING_TITLE_REVISION_LABEL = 'Rev';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgLinePresentation(type: DrawingLine['type']): { stroke: string; width: string; dash?: string } {
  switch (type) {
    case 'visible':
      return { stroke: '#000000', width: '0.5' };
    case 'hidden':
      return { stroke: '#000000', width: '0.3', dash: '2 1' };
    case 'center':
      return { stroke: '#0066cc', width: '0.2', dash: '6 2 1 2' };
    case 'dimension':
      return { stroke: '#cc0000', width: '0.2' };
    default:
      return { stroke: '#000000', width: '0.3' };
  }
}

function svgTextAnchor(anchor: DrawingText['anchor']): string {
  if (anchor === 'middle') return 'middle';
  if (anchor === 'end') return 'end';
  return 'start';
}

/**
 * Single SVG document (mm user space) — for tests, archives, and server-side previews.
 * Does not require a DOM (unlike `AutoDrawingPanel` serializer path).
 */
export function buildDrawingSvgString(
  drawing: DrawingResult,
  datums: readonly DatumFrameOverlay[] = [],
): string {
  const pw = drawing.paperWidth;
  const ph = drawing.paperHeight;
  const chunks: string[] = [];
  chunks.push('<?xml version="1.0" encoding="UTF-8"?>');
  chunks.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pw} ${ph}" width="${pw}mm" height="${ph}mm">`,
  );
  chunks.push(
    `<rect x="5" y="5" width="${pw - 10}" height="${ph - 10}" fill="none" stroke="#000000" stroke-width="0.5"/>`,
  );

  for (const view of drawing.views) {
    const ox = view.position.x;
    const oy = view.position.y;
    const vh = view.height;
    chunks.push(`<g transform="translate(${ox},${oy})">`);
    chunks.push(
      `<text x="${view.width / 2}" y="-3" text-anchor="middle" font-size="3" fill="#555555">${escapeXml(view.projection.toUpperCase())}</text>`,
    );
    for (const line of view.lines) {
      const p = svgLinePresentation(line.type);
      const dashAttr = p.dash ? ` stroke-dasharray="${p.dash}"` : '';
      chunks.push(
        `<line x1="${line.x1}" y1="${vh - line.y1}" x2="${line.x2}" y2="${vh - line.y2}" ` +
          `stroke="${p.stroke}" stroke-width="${p.width}" fill="none"${dashAttr}/>`,
      );
    }
    for (const tx of view.texts ?? []) {
      const fill = tx.style === 'dimension' ? '#cc0000' : tx.style === 'roughness' ? '#6600aa' : '#333333';
      const rot = tx.rotate ? ` rotate(${tx.rotate})` : '';
      const ta = svgTextAnchor(tx.anchor);
      chunks.push(
        `<text transform="translate(${tx.x},${vh - tx.y})${rot}" ` +
          `text-anchor="${ta}" font-size="${tx.fontSize}" fill="${fill}" font-family="monospace,Consolas,monospace">${escapeXml(tx.text)}</text>`,
      );
    }
    chunks.push('</g>');
  }

  if (drawing.tolerance) {
    const ty = ph - 28;
    chunks.push(
      `<text x="5" y="${ty}" font-size="2" fill="#333333" font-family="monospace,Consolas,monospace">` +
        `${escapeXml(`General Tol: Linear ${drawing.tolerance.linear}  Angular ${drawing.tolerance.angular}`)}` +
        '</text>',
    );
  }

  const tbX = pw - 100 - 5;
  const tbY = ph - 25 - 5;
  const tb = drawing.titleBlock;
  chunks.push(
    `<rect x="${tbX}" y="${tbY}" width="100" height="25" fill="none" stroke="#000000" stroke-width="0.4"/>`,
  );
  chunks.push(
    `<line x1="${tbX}" y1="${tbY + 7}" x2="${tbX + 100}" y2="${tbY + 7}" stroke="#000000" stroke-width="0.2"/>`,
  );
  chunks.push(
    `<line x1="${tbX}" y1="${tbY + 18}" x2="${tbX + 100}" y2="${tbY + 18}" stroke="#000000" stroke-width="0.2"/>`,
  );
  chunks.push(
    `<line x1="${tbX + 50}" y1="${tbY}" x2="${tbX + 50}" y2="${tbY + 25}" stroke="#000000" stroke-width="0.2"/>`,
  );
  chunks.push(
    `<text x="${tbX + 2}" y="${tbY + 5}" font-size="3.5" fill="#333333" font-family="monospace,Consolas,monospace">${escapeXml(tb.partName || '')}</text>`,
  );
  chunks.push(
    `<text x="${tbX + 52}" y="${tbY + 5}" font-size="2.5" fill="#555555" font-family="monospace,Consolas,monospace">` +
      `${escapeXml(`${DRAWING_TITLE_REVISION_LABEL}: ${tb.revision || ''}`)}</text>`,
  );
  chunks.push(
    `<text x="${tbX + 2}" y="${tbY + 14}" font-size="2.5" fill="#555555" font-family="monospace,Consolas,monospace">` +
      `${escapeXml(`Material: ${tb.material || ''}`)}</text>`,
  );
  chunks.push(
    `<text x="${tbX + 52}" y="${tbY + 14}" font-size="2.5" fill="#555555" font-family="monospace,Consolas,monospace">` +
      `${escapeXml(`Scale: ${tb.scale || ''}`)}</text>`,
  );
  chunks.push(
    `<text x="${tbX + 2}" y="${tbY + 23}" font-size="2.5" fill="#555555" font-family="monospace,Consolas,monospace">` +
      `${escapeXml(`Drawn: ${tb.drawnBy || ''}`)}</text>`,
  );
  chunks.push(
    `<text x="${tbX + 52}" y="${tbY + 23}" font-size="2.5" fill="#555555" font-family="monospace,Consolas,monospace">` +
      `${escapeXml(`Date: ${tb.date || ''}`)}</text>`,
  );

  // Datum reference frames — small rect + centered label + optional leader stub.
  // Drawn last so they layer on top of view lines / dimensions.
  for (const d of datums) {
    const w = DATUM_FRAME_WIDTH;
    const h = DATUM_FRAME_HEIGHT;
    chunks.push(
      `<rect x="${d.x}" y="${d.y}" width="${w}" height="${h}" fill="none" stroke="#000000" stroke-width="0.3"/>`,
    );
    chunks.push(
      `<text x="${d.x + w / 2}" y="${d.y + h / 2 + 1.4}" text-anchor="middle" font-size="3.5" fill="#000000" font-family="monospace,Consolas,monospace">${escapeXml(d.label)}</text>`,
    );
    if (d.leaderDir) {
      const p = datumLeaderEndpoint(d.x, d.y, d.leaderDir);
      chunks.push(
        `<line x1="${p.sx}" y1="${p.sy}" x2="${p.ex}" y2="${p.ey}" stroke="#000000" stroke-width="0.25" fill="none"/>`,
      );
    }
  }

  chunks.push('</svg>');
  return chunks.join('');
}

/** Browser / Tauri — same bytes as `buildDrawingSvgString`, triggers download. */
export async function exportDrawingSVG(
  drawing: DrawingResult,
  fileName: string,
  opts?: { datums?: readonly DatumFrameOverlay[] },
): Promise<void> {
  const svg = buildDrawingSvgString(drawing, opts?.datums ?? []);
  const safeName = (fileName || 'drawing').replace(/[^\w\-.]+/g, '_');
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  await downloadBlob(`${safeName}.svg`, blob);
}

/* ─── PDF ──────────────────────────────────────────────────────────────────── */

function pdfStrokeFor(type: DrawingLine['type']): { w: number; dash: number[]; rgb: [number, number, number] } {
  switch (type) {
    case 'visible':   return { w: 0.5, dash: [],       rgb: [0, 0, 0] };
    case 'hidden':    return { w: 0.3, dash: [2, 1],   rgb: [0, 0, 0] };
    case 'center':    return { w: 0.2, dash: [6, 2, 1, 2], rgb: [0, 0x66 / 255, 0xcc / 255] };
    case 'dimension': return { w: 0.2, dash: [],       rgb: [0xcc / 255, 0, 0] };
    default:          return { w: 0.3, dash: [],       rgb: [0, 0, 0] };
  }
}

/** Flip Y from our Y-up view space to jsPDF's Y-down page space. */
function flipY(y: number, viewHeight: number): number { return viewHeight - y; }

/** GD&T feature control frame annotation as placed by AutoDrawingPanel —
 *  position is in paper-mm coordinates (top-left origin to match the PDF
 *  page system). */
export interface GdtAnnotationOverlay {
  id: string;
  text: string;
  /** Paper-space mm, top-left origin. */
  x: number;
  y: number;
}

/** GD&T datum reference frame symbol (e.g. ▭A) — placed on the part surface
 *  to anchor the datum reference letter that FCFs cite. Position is in
 *  paper-mm, top-left origin (PDF page system) to match GdtAnnotationOverlay. */
export interface DatumFrameOverlay {
  id: string;
  label: string;
  /** Paper-space mm, top-left origin (PDF page system) */
  x: number;
  y: number;
  /** Direction the leader line points from the symbol — N/E/S/W. */
  leaderDir?: 'N' | 'E' | 'S' | 'W';
}

/** Datum frame is 8 mm wide × 6 mm tall, label centered. Tweaking these here
 *  propagates to all 3 export paths (SVG/PDF/DXF) to keep visuals consistent. */
const DATUM_FRAME_WIDTH = 8;
const DATUM_FRAME_HEIGHT = 6;
/** Leader stub length (mm) — short, just enough to imply attachment direction. */
const DATUM_LEADER_LENGTH = 5;

/** Compute leader stub endpoint relative to the frame's top-left (x, y).
 *  Stub originates from the midpoint of the relevant edge. */
function datumLeaderEndpoint(
  x: number,
  y: number,
  dir: 'N' | 'E' | 'S' | 'W',
): { sx: number; sy: number; ex: number; ey: number } {
  const cx = x + DATUM_FRAME_WIDTH / 2;
  const cy = y + DATUM_FRAME_HEIGHT / 2;
  switch (dir) {
    case 'N': return { sx: cx, sy: y,                       ex: cx,                       ey: y - DATUM_LEADER_LENGTH };
    case 'S': return { sx: cx, sy: y + DATUM_FRAME_HEIGHT,  ex: cx,                       ey: y + DATUM_FRAME_HEIGHT + DATUM_LEADER_LENGTH };
    case 'E': return { sx: x + DATUM_FRAME_WIDTH, sy: cy,   ex: x + DATUM_FRAME_WIDTH + DATUM_LEADER_LENGTH, ey: cy };
    case 'W': return { sx: x,  sy: cy,                      ex: x - DATUM_LEADER_LENGTH,  ey: cy };
  }
}

/** Render the GD&T overlay frames onto the PDF page. Pill is 5 mm tall,
 *  width scales with text length; ASCII pill border + monochrome text. */
function drawGdtOverlayPDF(doc: jsPDF, frames: readonly GdtAnnotationOverlay[]): void {
  if (frames.length === 0) return;
  doc.setLineWidth(0.25);
  doc.setDrawColor(0, 0, 0);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(3);
  for (const a of frames) {
    const w = Math.max(28, a.text.length * 1.6);
    doc.rect(a.x, a.y - 3.5, w, 5);
    doc.text(a.text, a.x + 2, a.y + 0.5);
  }
}

/** Render datum reference frames onto the PDF page: an 8×6 mm box, the
 *  label centered, optionally a short leader stub. Coordinates in paper-mm,
 *  top-left origin (matches jsPDF page system, no flip needed). */
function drawDatumOverlayPDF(doc: jsPDF, datums: readonly DatumFrameOverlay[]): void {
  if (datums.length === 0) return;
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(0, 0, 0);
  doc.setTextColor(0, 0, 0);
  for (const d of datums) {
    doc.setLineWidth(0.3);
    doc.rect(d.x, d.y, DATUM_FRAME_WIDTH, DATUM_FRAME_HEIGHT);
    doc.setFontSize(8);
    doc.text(
      d.label,
      d.x + DATUM_FRAME_WIDTH / 2,
      d.y + DATUM_FRAME_HEIGHT / 2 + 1.4,
      { align: 'center' },
    );
    if (d.leaderDir) {
      const p = datumLeaderEndpoint(d.x, d.y, d.leaderDir);
      doc.setLineWidth(0.25);
      doc.line(p.sx, p.sy, p.ex, p.ey);
    }
  }
}

async function createDrawingJsPdf(
  drawing: DrawingResult,
  gdt: readonly GdtAnnotationOverlay[] = [],
  datums: readonly DatumFrameOverlay[] = [],
): Promise<jsPDF> {
  const { default: JsPDF } = await import('jspdf');
  const isLandscape = drawing.paperWidth > drawing.paperHeight;
  const doc = new JsPDF({
    orientation: isLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [drawing.paperWidth, drawing.paperHeight],
    compress: true,
  });

  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.rect(5, 5, drawing.paperWidth - 10, drawing.paperHeight - 10);

  for (const view of drawing.views) {
    drawViewPDF(doc, view);
  }

  if (drawing.tolerance) {
    doc.setTextColor(0x33, 0x33, 0x33);
    doc.setFontSize(5);
    doc.text(
      `General Tol: Linear ${drawing.tolerance.linear}  Angular ${drawing.tolerance.angular}`,
      5, drawing.paperHeight - 28,
    );
  }

  drawTitleBlockPDF(doc, drawing);
  drawGdtOverlayPDF(doc, gdt);
  drawDatumOverlayPDF(doc, datums);
  return doc;
}

/** For tests / headless verification — same bytes as download, without triggering save. */
export async function buildDrawingPdfArrayBuffer(
  drawing: DrawingResult,
  gdt: readonly GdtAnnotationOverlay[] = [],
  datums: readonly DatumFrameOverlay[] = [],
): Promise<ArrayBuffer> {
  const doc = await createDrawingJsPdf(drawing, gdt, datums);
  return doc.output('arraybuffer') as ArrayBuffer;
}

export async function exportDrawingPDF(
  drawing: DrawingResult,
  fileName: string,
  opts?: { gdt?: readonly GdtAnnotationOverlay[]; datums?: readonly DatumFrameOverlay[] },
): Promise<void> {
  const doc = await createDrawingJsPdf(drawing, opts?.gdt ?? [], opts?.datums ?? []);
  const safeName = (fileName || 'drawing').replace(/[^\w\-.]+/g, '_');
  doc.save(`${safeName}.pdf`);
}

function drawViewPDF(doc: jsPDF, view: ViewResult): void {
  const ox = view.position.x;
  const oy = view.position.y;

  // View label
  doc.setTextColor(0x55, 0x55, 0x55);
  doc.setFontSize(6);
  doc.text(view.projection.toUpperCase(), ox + view.width / 2, oy - 1, { align: 'center' });

  // Lines
  for (const line of view.lines) {
    const s = pdfStrokeFor(line.type);
    doc.setDrawColor(s.rgb[0] * 255, s.rgb[1] * 255, s.rgb[2] * 255);
    doc.setLineWidth(s.w);
    if (s.dash.length > 0) doc.setLineDashPattern(s.dash, 0);
    else doc.setLineDashPattern([], 0);
    doc.line(
      ox + line.x1, oy + flipY(line.y1, view.height),
      ox + line.x2, oy + flipY(line.y2, view.height),
    );
  }
  doc.setLineDashPattern([], 0);

  // Texts
  for (const tx of view.texts ?? []) {
    const color = tx.style === 'dimension'
      ? [0xcc, 0, 0]
      : tx.style === 'roughness'
        ? [0x66, 0, 0xaa]
        : [0x33, 0x33, 0x33];
    doc.setTextColor(color[0], color[1], color[2]);
    doc.setFontSize(Math.max(tx.fontSize * 2.2, 5));
    const align = tx.anchor === 'middle' ? 'center' : tx.anchor === 'end' ? 'right' : 'left';
    doc.text(tx.text, ox + tx.x, oy + flipY(tx.y, view.height), {
      align, angle: tx.rotate ? -tx.rotate : 0,
    });
  }
}

function drawTitleBlockPDF(doc: jsPDF, drawing: DrawingResult): void {
  const W = 100, H = 25;
  const x = drawing.paperWidth - W - 5;
  const y = drawing.paperHeight - H - 5;

  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  doc.rect(x, y, W, H);
  doc.setLineWidth(0.2);
  // Horizontal dividers
  doc.line(x, y + 7,  x + W, y + 7);
  doc.line(x, y + 14, x + W, y + 14);
  // Vertical divider
  doc.line(x + 50, y, x + 50, y + H);

  const tb = drawing.titleBlock;
  doc.setTextColor(0x33, 0x33, 0x33);
  doc.setFontSize(7);
  doc.text(tb.partName || '', x + 2, y + 5);
  doc.setTextColor(0x55, 0x55, 0x55);
  doc.setFontSize(5);
  doc.text(`Material: ${tb.material || ''}`, x + 2,  y + 11);
  doc.text(`Scale: ${tb.scale || ''}`,       x + 52, y + 11);
  doc.text(`Drawn: ${tb.drawnBy || ''}`,     x + 2,  y + 18);
  doc.text(`Date: ${tb.date || ''}`,         x + 52, y + 18);
  doc.text(`${DRAWING_TITLE_REVISION_LABEL}: ${tb.revision || ''}`, x + 52, y + 5);
}

/* ─── DXF R12 ──────────────────────────────────────────────────────────────── */
// Minimal AutoCAD R12 ASCII: HEADER + TABLES (layers) + ENTITIES (LINE / TEXT).
// Accepted by AutoCAD, FreeCAD, LibreCAD, DraftSight, Inkscape.

const DXF_LAYERS = [
  { name: 'VISIBLE',   color: 7, ltype: 'CONTINUOUS' }, // white (renders black on white paper)
  { name: 'HIDDEN',    color: 8, ltype: 'DASHED' },     // dark gray, dashed per CAD convention
  { name: 'CENTER',    color: 5, ltype: 'CENTERLT' },   // blue, long-dash-dot
  { name: 'DIMENSION', color: 1, ltype: 'CONTINUOUS' }, // red
  { name: 'TEXT',      color: 7, ltype: 'CONTINUOUS' },
  { name: 'TITLE',     color: 7, ltype: 'CONTINUOUS' },
  { name: 'DATUM',     color: 7, ltype: 'CONTINUOUS' }, // GD&T datum reference frames
];

/** R12 LTYPE definitions referenced by the layers above. */
const DXF_LTYPES = [
  { name: 'CONTINUOUS', desc: 'Solid line', pattern: [] as number[] },
  { name: 'DASHED', desc: 'Dashed __ __ __', pattern: [1.25, -0.75] },
  { name: 'CENTERLT', desc: 'Center ____ _ ____ _', pattern: [3.0, -0.5, 0.5, -0.5] },
];

/** Emit the TABLES section (LTYPE before LAYER — AutoCAD requires the order). */
function dxfTablesSection(): string {
  let s = '0\nSECTION\n2\nTABLES\n';
  // LTYPE table.
  s += '0\nTABLE\n2\nLTYPE\n70\n' + DXF_LTYPES.length + '\n';
  for (const lt of DXF_LTYPES) {
    const total = lt.pattern.reduce((a, d) => a + Math.abs(d), 0);
    s += '0\nLTYPE\n2\n' + lt.name + '\n70\n0\n3\n' + lt.desc +
      '\n72\n65\n73\n' + lt.pattern.length + '\n40\n' + total.toFixed(3) + '\n';
    for (const d of lt.pattern) s += '49\n' + d.toFixed(3) + '\n';
  }
  s += '0\nENDTAB\n';
  // LAYER table (references the linetypes above via code 6).
  s += '0\nTABLE\n2\nLAYER\n70\n' + DXF_LAYERS.length + '\n';
  for (const L of DXF_LAYERS) {
    s += '0\nLAYER\n2\n' + L.name + '\n70\n0\n62\n' + L.color + '\n6\n' + L.ltype + '\n';
  }
  s += '0\nENDTAB\n0\nENDSEC\n';
  return s;
}

function layerFor(type: DrawingLine['type']): string {
  switch (type) {
    case 'visible':   return 'VISIBLE';
    case 'hidden':    return 'HIDDEN';
    case 'center':    return 'CENTER';
    case 'dimension': return 'DIMENSION';
    default:          return 'VISIBLE';
  }
}

function dxfLine(layer: string, x1: number, y1: number, x2: number, y2: number): string {
  return [
    '0', 'LINE',
    '8', layer,
    '10', x1.toFixed(3), '20', y1.toFixed(3), '30', '0.0',
    '11', x2.toFixed(3), '21', y2.toFixed(3), '31', '0.0',
  ].join('\n') + '\n';
}

function dxfText(layer: string, x: number, y: number, height: number, text: string, rotateDeg = 0): string {
  return [
    '0', 'TEXT',
    '8', layer,
    '10', x.toFixed(3), '20', y.toFixed(3), '30', '0.0',
    '40', height.toFixed(3),
    '1', text.replace(/\n/g, ' '),
    '50', rotateDeg.toFixed(1),
  ].join('\n') + '\n';
}

function dxfCircle(layer: string, cx: number, cy: number, r: number): string {
  return [
    '0', 'CIRCLE',
    '8', layer,
    '10', cx.toFixed(3), '20', cy.toFixed(3), '30', '0.0',
    '40', r.toFixed(3),
  ].join('\n') + '\n';
}

function dxfArc(layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  // DXF ARC is always drawn CCW from start angle to end angle.
  return [
    '0', 'ARC',
    '8', layer,
    '10', cx.toFixed(3), '20', cy.toFixed(3), '30', '0.0',
    '40', r.toFixed(3),
    '50', startDeg.toFixed(3),
    '51', endDeg.toFixed(3),
  ].join('\n') + '\n';
}

/** R12 ASCII DXF (mm). Exposed for CI; `exportDrawingDXF` wraps this + download. */
export function buildDrawingDxfString(
  drawing: DrawingResult,
  gdt: readonly GdtAnnotationOverlay[] = [],
  datums: readonly DatumFrameOverlay[] = [],
): string {
  let dxf = '';

  dxf += '0\nSECTION\n2\nHEADER\n';
  dxf += '9\n$ACADVER\n1\nAC1009\n';
  dxf += '9\n$INSUNITS\n70\n4\n'; // millimeters
  dxf += '0\nENDSEC\n';

  dxf += dxfTablesSection();

  dxf += '0\nSECTION\n2\nENTITIES\n';

  const pw = drawing.paperWidth, ph = drawing.paperHeight;
  dxf += dxfLine('TITLE', 5,       5,      pw - 5,  5);
  dxf += dxfLine('TITLE', pw - 5,  5,      pw - 5,  ph - 5);
  dxf += dxfLine('TITLE', pw - 5,  ph - 5, 5,       ph - 5);
  dxf += dxfLine('TITLE', 5,       ph - 5, 5,       5);

  for (const view of drawing.views) {
    const ox = view.position.x;
    const oy = ph - view.position.y - view.height;

    dxf += dxfText('TEXT', ox + view.width / 2, oy + view.height + 2, 3, view.projection.toUpperCase());

    // Collapse faceted visible/hidden segment fans into true CIRCLE/ARC entities
    // per layer (machinist/CAM fidelity); centerlines & dimensions stay as LINEs.
    // Detection is offset into sheet coords so the emitted center/radius match.
    const byLayer = new Map<string, Seg[]>();
    const passthrough: DrawingLine[] = [];
    for (const line of view.lines) {
      if (line.type === 'visible' || line.type === 'hidden') {
        const arr = byLayer.get(line.type) ?? [];
        arr.push({ x1: ox + line.x1, y1: oy + line.y1, x2: ox + line.x2, y2: oy + line.y2 });
        byLayer.set(line.type, arr);
      } else {
        passthrough.push(line);
      }
    }
    for (const [type, segs] of byLayer) {
      const layer = layerFor(type as DrawingLine['type']);
      const { circles, arcs, remaining } = detectCirclesAndArcs(segs);
      for (const c of circles) dxf += dxfCircle(layer, c.cx, c.cy, c.r);
      for (const a of arcs) dxf += dxfArc(layer, a.cx, a.cy, a.r, a.startDeg, a.endDeg);
      for (const s of remaining) dxf += dxfLine(layer, s.x1, s.y1, s.x2, s.y2);
    }
    for (const line of passthrough) {
      dxf += dxfLine(layerFor(line.type), ox + line.x1, oy + line.y1, ox + line.x2, oy + line.y2);
    }
    for (const tx of view.texts ?? []) {
      const layer = tx.style === 'dimension' ? 'DIMENSION' : 'TEXT';
      dxf += dxfText(layer, ox + tx.x, oy + tx.y, tx.fontSize, tx.text, tx.rotate ?? 0);
    }
  }

  const tbW = 100, tbH = 25;
  const tbX = pw - tbW - 5;
  const tbY = 5;
  dxf += dxfLine('TITLE', tbX,       tbY,       tbX + tbW, tbY);
  dxf += dxfLine('TITLE', tbX + tbW, tbY,       tbX + tbW, tbY + tbH);
  dxf += dxfLine('TITLE', tbX + tbW, tbY + tbH, tbX,       tbY + tbH);
  dxf += dxfLine('TITLE', tbX,       tbY + tbH, tbX,       tbY);
  dxf += dxfLine('TITLE', tbX,       tbY + 7,   tbX + tbW, tbY + 7);
  dxf += dxfLine('TITLE', tbX,       tbY + 18,  tbX + tbW, tbY + 18);
  dxf += dxfLine('TITLE', tbX + 50,  tbY,       tbX + 50,  tbY + tbH);

  const tb = drawing.titleBlock;
  dxf += dxfText('TITLE', tbX + 2,  tbY + 20, 3.5, tb.partName || '');
  dxf += dxfText('TITLE', tbX + 52, tbY + 20, 2.5, `${DRAWING_TITLE_REVISION_LABEL}: ${tb.revision || ''}`);
  dxf += dxfText('TITLE', tbX + 2,  tbY + 11, 2.5, `Material: ${tb.material || ''}`);
  dxf += dxfText('TITLE', tbX + 52, tbY + 11, 2.5, `Scale: ${tb.scale || ''}`);
  dxf += dxfText('TITLE', tbX + 2,  tbY + 3,  2.5, `Drawn: ${tb.drawnBy || ''}`);
  dxf += dxfText('TITLE', tbX + 52, tbY + 3,  2.5, `Date: ${tb.date || ''}`);

  if (drawing.tolerance) {
    dxf += dxfText('TEXT', 5, 1, 2,
      `General Tol: Linear ${drawing.tolerance.linear}  Angular ${drawing.tolerance.angular}`);
  }

  // Phase ⑤-3 — GD&T overlay: emit one TEXT + 4 LINEs per feature
  // control frame so downstream DXF readers see both the pill border
  // and the symbol/tolerance/datum text exactly as on the screen.
  // Coordinates flip to DXF's Y-up convention.
  for (const a of gdt) {
    const yUp = drawing.paperHeight - a.y;
    const w = Math.max(28, a.text.length * 1.6);
    // Pill border — 4 lines (top, right, bottom, left).
    dxf += dxfLine('GDT', a.x,     yUp - 2.5, a.x + w, yUp - 2.5);
    dxf += dxfLine('GDT', a.x + w, yUp - 2.5, a.x + w, yUp + 2.5);
    dxf += dxfLine('GDT', a.x + w, yUp + 2.5, a.x,     yUp + 2.5);
    dxf += dxfLine('GDT', a.x,     yUp + 2.5, a.x,     yUp - 2.5);
    dxf += dxfText('GDT', a.x + 2, yUp - 1,  3, a.text);
  }

  // Datum reference frames — 4-line box + centered TEXT (+ optional leader
  // line if leaderDir is given). DXF uses Y-up, so we flip from paper-mm
  // (top-left origin) the same way the GD&T overlay above does.
  for (const d of datums) {
    const x = d.x;
    const yUpTop    = drawing.paperHeight - d.y;                     // top edge (paper y → DXF y-up)
    const yUpBottom = drawing.paperHeight - (d.y + DATUM_FRAME_HEIGHT);
    const xRight    = x + DATUM_FRAME_WIDTH;
    // Frame box — 4 LINEs.
    dxf += dxfLine('DATUM', x,      yUpTop,    xRight, yUpTop);
    dxf += dxfLine('DATUM', xRight, yUpTop,    xRight, yUpBottom);
    dxf += dxfLine('DATUM', xRight, yUpBottom, x,      yUpBottom);
    dxf += dxfLine('DATUM', x,      yUpBottom, x,      yUpTop);
    // Label — centered horizontally inside the frame, baseline ~mid.
    dxf += dxfText(
      'DATUM',
      x + DATUM_FRAME_WIDTH / 2 - 1,
      yUpTop - DATUM_FRAME_HEIGHT / 2 - 1,
      3,
      d.label,
    );
    // Optional leader stub.
    if (d.leaderDir) {
      const p = datumLeaderEndpoint(d.x, d.y, d.leaderDir);
      const sy = drawing.paperHeight - p.sy;
      const ey = drawing.paperHeight - p.ey;
      dxf += dxfLine('DATUM', p.sx, sy, p.ex, ey);
    }
  }

  dxf += '0\nENDSEC\n0\nEOF\n';
  return dxf;
}

export async function exportDrawingDXF(
  drawing: DrawingResult,
  fileName: string,
  opts?: { gdt?: readonly GdtAnnotationOverlay[]; datums?: readonly DatumFrameOverlay[] },
): Promise<void> {
  const dxf = buildDrawingDxfString(drawing, opts?.gdt ?? [], opts?.datums ?? []);
  const safeName = (fileName || 'drawing').replace(/[^\w\-.]+/g, '_');
  const blob = new Blob([dxf], { type: 'application/dxf' });
  await downloadBlob(`${safeName}.dxf`, blob);
}
