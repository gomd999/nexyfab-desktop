'use client';

import { serializeSVG, svgToDataURL, dataURLToCanvas } from './svgToPdf';

/* ─── Paper sizes (mm) ───────────────────────────────────────────────────── */

const PAPER_MM: Record<'A4' | 'A3', { w: number; h: number }> = {
  A4: { w: 297, h: 210 },  // landscape default
  A3: { w: 420, h: 297 },
};

/** Points per mm (1 pt = 1/72 in, 1 in = 25.4 mm) */
const MM_TO_PT = 72 / 25.4;

/* ─── Main export function ───────────────────────────────────────────────── */

/**
 * Export the engineering drawing SVG as an A4 or A3 PDF file.
 *
 * Pipeline:
 *   SVGElement → serialise → Blob URL → <img> → <canvas> → jsPDF.addImage → save
 *
 * Falls back to `window.print()` if jsPDF is not available at runtime.
 *
 * @param svgSource  Either an SVGElement in the live DOM or a pre-serialised string.
 * @param filename   Output file name (default 'drawing.pdf').
 * @param paperSize  'A4' | 'A3'  (default 'A3').
 * @param orientation 'portrait' | 'landscape' (default 'landscape').
 */
export async function exportDrawingPDF(
  svgSource: SVGElement | string,
  filename = 'drawing.pdf',
  paperSize: 'A4' | 'A3' = 'A3',
  orientation: 'portrait' | 'landscape' = 'landscape',
): Promise<void> {
  /* 1 ─ Serialise SVG */
  const svgString =
    typeof svgSource === 'string' ? svgSource : serializeSVG(svgSource as SVGElement);

  /* 2 ─ Determine page dimensions in points */
  const { w: mmW, h: mmH } = PAPER_MM[paperSize];
  const pageW_pt = orientation === 'landscape' ? Math.max(mmW, mmH) * MM_TO_PT : Math.min(mmW, mmH) * MM_TO_PT;
  const pageH_pt = orientation === 'landscape' ? Math.min(mmW, mmH) * MM_TO_PT : Math.max(mmW, mmH) * MM_TO_PT;

  /* 3 ─ Rasterise SVG at 2× resolution for crisp output */
  const scale = 2;
  const canvasW = Math.round(pageW_pt * scale);
  const canvasH = Math.round(pageH_pt * scale);

  let blobURL: string | null = null;
  let canvas: HTMLCanvasElement | null = null;

  try {
    blobURL = await svgToDataURL(svgString);
    canvas = await dataURLToCanvas(blobURL, canvasW, canvasH);
  } finally {
    if (blobURL) URL.revokeObjectURL(blobURL);
  }

  /* 4 ─ Try jsPDF (dynamic import — may need `npm install jspdf`) */
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsPDFModule = await import('jspdf' as any);
    // Support both ESM default and CommonJS .default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const JsPDF: any = (jsPDFModule as any).default ?? (jsPDFModule as any).jsPDF ?? jsPDFModule;

    const doc = new JsPDF({
      orientation,
      unit: 'pt',
      format: [pageW_pt, pageH_pt],
    });

    const imgData = canvas!.toDataURL('image/png');
    doc.addImage(imgData, 'PNG', 0, 0, pageW_pt, pageH_pt);

    doc.save(filename);
    return;
  } catch {
    // jsPDF not available — fall back to print dialog
  }

  /* 5 ─ Fallback: open print dialog with the drawing in a new tab */
  printFallback(canvas!, filename, paperSize, orientation);
}

/* ─── Print fallback ─────────────────────────────────────────────────────── */

function printFallback(
  canvas: HTMLCanvasElement,
  _filename: string,
  paperSize: 'A4' | 'A3',
  orientation: 'portrait' | 'landscape',
): void {
  const dataUrl = canvas.toDataURL('image/png');
  const win = window.open('', '_blank');
  if (!win) {
    // Popup blocked — fall back to download of the canvas PNG
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = _filename.replace(/\.pdf$/i, '.png');
    a.click();
    return;
  }

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${_filename}</title>
  <style>
    @page { size: ${paperSize} ${orientation}; margin: 0; }
    body { margin: 0; padding: 0; background: #fff; }
    img { width: 100%; height: auto; display: block; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <img src="${dataUrl}" />
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`);
  win.document.close();
}
