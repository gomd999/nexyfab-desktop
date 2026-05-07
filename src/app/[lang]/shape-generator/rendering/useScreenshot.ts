/**
 * High-resolution screenshot utilities for the 3D canvas.
 */

import type * as THREE from 'three';

export interface PinOverlayData {
  /** Screen-space position (0–1 normalized) of each pin */
  pins: Array<{
    id: string;
    screenX: number; // 0..1
    screenY: number; // 0..1
    color: string;
    type: 'comment' | 'issue' | 'approval';
    text: string;
    resolved: boolean;
  }>;
}

/**
 * Capture a high-resolution screenshot from a WebGL canvas.
 * Optionally composites 2D pin comment overlays on top.
 * @param canvas  The HTMLCanvasElement from the R3F renderer
 * @param scale   Resolution multiplier (default 2x)
 * @param pins    Optional pin overlay data
 */
export function captureHighRes(
  canvas: HTMLCanvasElement,
  scale: number = 2,
  pins?: PinOverlayData,
): string {
  const width = canvas.width;
  const height = canvas.height;

  const offscreen = document.createElement('canvas');
  offscreen.width = width * scale;
  offscreen.height = height * scale;

  const ctx = offscreen.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/png');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height);

  // Draw pin overlays
  if (pins && pins.pins.length > 0) {
    const PIN_COLORS = { comment: '#388bfd', issue: '#e3b341', approval: '#3fb950' };
    const r = 10 * scale;
    ctx.font = `${10 * scale}px system-ui, sans-serif`;

    pins.pins.forEach((pin, idx) => {
      const x = pin.screenX * offscreen.width;
      const y = pin.screenY * offscreen.height;
      const color = pin.resolved ? '#8b949e' : PIN_COLORS[pin.type];

      // Circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color + (pin.resolved ? '88' : 'cc');
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * scale;
      ctx.stroke();

      // Index number
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(idx + 1), x, y);

      // Stem
      ctx.beginPath();
      ctx.moveTo(x, y + r);
      ctx.lineTo(x, y + r * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * scale;
      ctx.stroke();
    });

    // Legend at bottom-left
    if (pins.pins.length > 0) {
      const pad = 8 * scale;
      const lineH = 14 * scale;
      const legendY = offscreen.height - pad - pins.pins.length * lineH;
      ctx.fillStyle = 'rgba(13,17,23,0.8)';
      ctx.roundRect?.(pad, legendY - pad, 220 * scale, pins.pins.length * lineH + pad * 2, 4 * scale);
      ctx.fill();
      ctx.font = `${9 * scale}px system-ui, sans-serif`;
      pins.pins.forEach((pin, idx) => {
        const color = pin.resolved ? '#8b949e' : PIN_COLORS[pin.type];
        const ty = legendY + idx * lineH + lineH / 2;
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const truncated = pin.text.length > 28 ? pin.text.slice(0, 28) + '…' : pin.text;
        ctx.fillText(`${idx + 1}. ${truncated}`, pad + 4 * scale, ty);
      });
    }
  }

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
