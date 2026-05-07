'use client';

/**
 * SVG serialization and canvas conversion helpers for PDF export.
 */

/**
 * Clone an SVGElement, inline computed styles on all child elements,
 * set the xmlns attribute, and return a serialized XML string.
 */
export function serializeSVG(element: SVGElement): string {
  const clone = element.cloneNode(true) as SVGElement;

  // Ensure namespace so standalone SVG is valid
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  // Inline computed styles on every element so the rasterizer sees them
  const sourceEls = element.querySelectorAll('*');
  const cloneEls = clone.querySelectorAll('*');
  sourceEls.forEach((src, i) => {
    const dst = cloneEls[i] as SVGElement | null;
    if (!dst) return;
    try {
      const computed = window.getComputedStyle(src);
      // Only inline a targeted subset — SVG presentation attributes are enough
      const props = ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight'];
      props.forEach(p => {
        const val = computed.getPropertyValue(p);
        if (val) dst.style.setProperty(p, val);
      });
    } catch {
      // getComputedStyle may throw inside Workers; skip silently
    }
  });

  return new XMLSerializer().serializeToString(clone);
}

/**
 * Convert a serialized SVG string to a data URL (image/svg+xml base64 or
 * object URL depending on browser support).
 */
export function svgToDataURL(svgString: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      resolve(url);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Draw a data URL (blob URL or base64) onto a new HTMLCanvasElement at the
 * given pixel dimensions and return the canvas.
 *
 * The caller is responsible for revoking blob URLs after use.
 */
export function dataURLToCanvas(
  dataURL: string,
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2D context unavailable')); return; }
      // White background (PDF expects opaque content)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Failed to load SVG as image'));
    img.src = dataURL;
  });
}
