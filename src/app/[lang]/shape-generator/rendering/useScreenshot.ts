/**
 * High-resolution screenshot utilities for the 3D canvas.
 */

/**
 * Capture a high-resolution screenshot from a WebGL canvas.
 * @param canvas  The HTMLCanvasElement from the R3F renderer
 * @param scale   Resolution multiplier (default 2x)
 * @returns       Base64 data URL of the PNG image
 */
export function captureHighRes(canvas: HTMLCanvasElement, scale: number = 2): string {
  const width = canvas.width;
  const height = canvas.height;

  // Create an off-screen canvas at higher resolution
  const offscreen = document.createElement('canvas');
  offscreen.width = width * scale;
  offscreen.height = height * scale;

  const ctx = offscreen.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/png');

  // Draw the WebGL canvas scaled up
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height);

  return offscreen.toDataURL('image/png');
}

/**
 * Trigger a browser download of a high-res PNG screenshot.
 */
export function downloadScreenshot(
  canvas: HTMLCanvasElement,
  filename: string = 'nexyfab-render.png',
  scale: number = 2,
): void {
  const dataUrl = captureHighRes(canvas, scale);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Copy a screenshot to the system clipboard as a PNG image.
 * Returns true on success, false if the Clipboard API is unavailable.
 */
export async function copyScreenshotToClipboard(
  canvas: HTMLCanvasElement,
  scale: number = 2,
): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write) return false;
    const dataUrl = captureHighRes(canvas, scale);
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);
    return true;
  } catch {
    return false;
  }
}
