'use client';

/**
 * Capture a thumbnail from an HTML canvas element.
 * Returns a base64 data URL (image/png), scaled down to `maxSize` pixels on the longest side.
 */
export function captureCanvasSnapshot(
  canvasElement: HTMLCanvasElement,
  maxSize = 200,
): string {
  const { width, height } = canvasElement;
  if (width === 0 || height === 0) return '';

  // Determine scale factor
  const longest = Math.max(width, height);
  const scale = longest > maxSize ? maxSize / longest : 1;
  const dw = Math.round(width * scale);
  const dh = Math.round(height * scale);

  // Draw scaled-down version onto an off-screen canvas
  const offscreen = document.createElement('canvas');
  offscreen.width = dw;
  offscreen.height = dh;
  const ctx = offscreen.getContext('2d');
  if (!ctx) return '';

  ctx.drawImage(canvasElement, 0, 0, width, height, 0, 0, dw, dh);
  return offscreen.toDataURL('image/png', 0.7);
}
