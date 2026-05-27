/**
 * titleBlockRenderer.ts — Turn a TitleBlockSpec + values into SVG.
 *
 * Output is a self-contained SVG string sized to the sheet (in mm).
 * Callers can:
 *   - embed the SVG directly in a PDF (via pdf-lib's drawSvgPath)
 *   - save the SVG file (.svg)
 *   - rasterise to PNG via canvas
 *
 * Freemium positioning:
 *   - Free tier: PNG with watermark
 *   - Pro tier:  clean SVG / PDF
 *
 * Watermark caller injects via `renderOptions.watermark`.
 */

import {
  SHEET_SIZES_MM,
  fillTitleBlock,
  placeTitleBlock,
  type SheetSize,
  type TitleBlockSpec,
  type TitleBlockValues,
} from './titleBlocks';

export interface RenderOptions {
  /** Margin around the sheet content (mm). */
  marginMm?: number;
  /** Watermark text drawn diagonally across the sheet — useful for free-tier output. */
  watermark?: string;
  /** Draw drawing-frame border. */
  drawBorder?: boolean;
  /** Border line stroke width (mm). */
  borderStrokeMm?: number;
  /** Title-block cell stroke width (mm). */
  cellStrokeMm?: number;
  /** Default label font size (pt) when a cell doesn't specify. */
  defaultLabelPt?: number;
  /** Default value font size (pt) when a cell doesn't specify. */
  defaultValuePt?: number;
}

/** Escape characters that are unsafe inside an SVG text node. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Convert points (typographic) to mm (1 pt ≈ 0.3528 mm). */
function ptToMm(pt: number): number {
  return pt * 0.3527777778;
}

export function renderTitleBlockSvg(
  spec: TitleBlockSpec,
  sheetSize: SheetSize,
  values: TitleBlockValues,
  options: RenderOptions = {},
): string {
  const margin = options.marginMm ?? 10;
  const drawBorder = options.drawBorder ?? true;
  const borderStroke = options.borderStrokeMm ?? 0.5;
  const cellStroke = options.cellStrokeMm ?? 0.25;
  const defaultLabelPt = options.defaultLabelPt ?? 8;
  const defaultValuePt = options.defaultValuePt ?? 10;

  const sheet = SHEET_SIZES_MM[sheetSize];
  const filledCells = fillTitleBlock(spec, values);
  const { absoluteCells } = placeTitleBlock(spec, sheetSize, margin);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" `
    + `viewBox="0 0 ${sheet.width} ${sheet.height}" `
    + `width="${sheet.width}mm" height="${sheet.height}mm">`,
  );

  // White background.
  parts.push(`<rect x="0" y="0" width="${sheet.width}" height="${sheet.height}" fill="white"/>`);

  // Drawing frame border.
  if (drawBorder) {
    parts.push(
      `<rect x="${margin}" y="${margin}" `
      + `width="${sheet.width - margin * 2}" height="${sheet.height - margin * 2}" `
      + `fill="none" stroke="black" stroke-width="${borderStroke}"/>`,
    );
  }

  // Title-block outer box.
  const tbX = sheet.width - margin - spec.widthMm;
  const tbY = sheet.height - margin - spec.heightMm;
  parts.push(
    `<rect x="${tbX}" y="${tbY}" width="${spec.widthMm}" height="${spec.heightMm}" `
    + `fill="none" stroke="black" stroke-width="${borderStroke}"/>`,
  );

  // Each cell — SVG y axis grows downward; spec uses "y up from sheet bottom".
  // absoluteCells gives us absX (from sheet left) and absY (from sheet bottom).
  for (let i = 0; i < absoluteCells.length; i++) {
    const cell = absoluteCells[i]!;
    const filled = filledCells[i]!;
    // Convert absY (from bottom) → svgY (from top).
    const svgY = sheet.height - cell.absY;
    const cellW = cell.widthMm;
    const cellH = cell.heightMm;
    parts.push(
      `<rect x="${cell.absX}" y="${svgY}" width="${cellW}" height="${cellH}" `
      + `fill="none" stroke="black" stroke-width="${cellStroke}"/>`,
    );
    // Label (small, top-left).
    const labelFs = ptToMm(defaultLabelPt);
    parts.push(
      `<text x="${cell.absX + 1}" y="${svgY + labelFs + 0.5}" `
      + `font-family="Helvetica, Arial, sans-serif" font-size="${labelFs}" fill="black">`
      + `${escapeXml(cell.label)}</text>`,
    );
    // Value (larger, centered-ish).
    if (filled.value) {
      const valueFs = ptToMm(cell.fontSizePt ?? defaultValuePt);
      const fontWeight = cell.bold ? 'bold' : 'normal';
      parts.push(
        `<text x="${cell.absX + cellW / 2}" y="${svgY + cellH / 2 + valueFs / 3}" `
        + `font-family="Helvetica, Arial, sans-serif" font-size="${valueFs}" `
        + `font-weight="${fontWeight}" text-anchor="middle" fill="black">`
        + `${escapeXml(filled.value)}</text>`,
      );
    }
  }

  // Watermark (free-tier).
  if (options.watermark) {
    const wmFs = Math.min(sheet.width, sheet.height) / 8;
    const cx = sheet.width / 2;
    const cy = sheet.height / 2;
    parts.push(
      `<text x="${cx}" y="${cy}" `
      + `font-family="Helvetica, Arial, sans-serif" font-size="${wmFs}" `
      + `fill="rgba(0,0,0,0.1)" text-anchor="middle" `
      + `transform="rotate(-30 ${cx} ${cy})">`
      + `${escapeXml(options.watermark)}</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/** Convenience: render then return as base64 data URL (PNG-ready handoff). */
export function renderTitleBlockDataUrl(
  spec: TitleBlockSpec,
  sheetSize: SheetSize,
  values: TitleBlockValues,
  options: RenderOptions = {},
): string {
  const svg = renderTitleBlockSvg(spec, sheetSize, values, options);
  if (typeof globalThis.btoa === 'function') {
    return `data:image/svg+xml;base64,${globalThis.btoa(unescape(encodeURIComponent(svg)))}`;
  }
  // Node fallback.
  const buf = Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${buf}`;
}
