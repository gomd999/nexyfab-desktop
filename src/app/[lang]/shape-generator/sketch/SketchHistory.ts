import type { SketchProfile, SketchConfig } from './types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SketchHistoryEntry {
  id: string;
  profile: SketchProfile;
  config: SketchConfig;
  plane: 'xy' | 'xz' | 'yz';
  timestamp: number;
  thumbnail?: string; // base64 SVG data URL
  label: string;
}

// ─── Thumbnail Generator ─────────────────────────────────────────────────────

/**
 * Generates a small SVG data URL showing the sketch profile outline.
 * Browser-safe: returns empty string when not in a browser context.
 */
export function generateSketchThumbnail(profile: SketchProfile, size = 80): string {
  if (typeof document === 'undefined') return '';
  if (profile.segments.length === 0) return '';

  try {
    // Collect all points to find bounding box
    const allPoints: Array<{ x: number; y: number }> = [];
    for (const seg of profile.segments) {
      for (const pt of seg.points) {
        allPoints.push({ x: pt.x, y: pt.y });
      }
    }

    if (allPoints.length === 0) return '';

    const minX = Math.min(...allPoints.map(p => p.x));
    const maxX = Math.max(...allPoints.map(p => p.x));
    const minY = Math.min(...allPoints.map(p => p.y));
    const maxY = Math.max(...allPoints.map(p => p.y));

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const padding = 6;
    const drawSize = size - padding * 2;

    const scaleX = drawSize / rangeX;
    const scaleY = drawSize / rangeY;
    const scale = Math.min(scaleX, scaleY);

    const toSvgX = (x: number) => (x - minX) * scale + padding + (drawSize - rangeX * scale) / 2;
    const toSvgY = (y: number) => size - ((y - minY) * scale + padding + (drawSize - rangeY * scale) / 2);

    let pathData = '';

    for (const seg of profile.segments) {
      if (seg.points.length === 0) continue;

      if (seg.type === 'line' && seg.points.length >= 2) {
        const [a, b] = seg.points;
        pathData += `M ${toSvgX(a.x).toFixed(1)} ${toSvgY(a.y).toFixed(1)} L ${toSvgX(b.x).toFixed(1)} ${toSvgY(b.y).toFixed(1)} `;
      } else if (seg.type === 'circle' && seg.points.length >= 2) {
        const [center, edge] = seg.points;
        const r = Math.sqrt(
          Math.pow((edge.x - center.x) * scale, 2) +
          Math.pow((edge.y - center.y) * scale, 2),
        );
        const cx = toSvgX(center.x).toFixed(1);
        const cy = toSvgY(center.y).toFixed(1);
        const rs = r.toFixed(1);
        pathData += `M ${(Number(cx) + r).toFixed(1)} ${cy} A ${rs} ${rs} 0 1 0 ${(Number(cx) - r).toFixed(1)} ${cy} A ${rs} ${rs} 0 1 0 ${(Number(cx) + r).toFixed(1)} ${cy} `;
      } else if (seg.type === 'rect' && seg.points.length >= 2) {
        const [c1, c2] = seg.points;
        const x1 = toSvgX(Math.min(c1.x, c2.x));
        const y1 = toSvgY(Math.max(c1.y, c2.y));
        const w = Math.abs(c2.x - c1.x) * scale;
        const h = Math.abs(c2.y - c1.y) * scale;
        pathData += `M ${x1.toFixed(1)} ${y1.toFixed(1)} h ${w.toFixed(1)} v ${h.toFixed(1)} h ${(-w).toFixed(1)} Z `;
      } else if (seg.type === 'arc' && seg.points.length >= 3) {
        const [start, , end] = seg.points;
        pathData += `M ${toSvgX(start.x).toFixed(1)} ${toSvgY(start.y).toFixed(1)} Q ${toSvgX(seg.points[1].x).toFixed(1)} ${toSvgY(seg.points[1].y).toFixed(1)} ${toSvgX(end.x).toFixed(1)} ${toSvgY(end.y).toFixed(1)} `;
      } else {
        // polygon or fallback: connect all points
        const [first, ...rest] = seg.points;
        pathData += `M ${toSvgX(first.x).toFixed(1)} ${toSvgY(first.y).toFixed(1)} `;
        for (const pt of rest) {
          pathData += `L ${toSvgX(pt.x).toFixed(1)} ${toSvgY(pt.y).toFixed(1)} `;
        }
        if (profile.closed) pathData += 'Z ';
      }
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#161b22" rx="4"/>
  <path d="${pathData.trim()}" fill="none" stroke="#388bfd" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

    return `data:image/svg+xml;base64,${btoa(svg)}`;
  } catch {
    return '';
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'nexyfab-sketch-history';

export function saveSketchHistory(entries: SketchHistoryEntry[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage quota exceeded or unavailable — silently ignore
  }
}

export function loadSketchHistory(): SketchHistoryEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SketchHistoryEntry[];
  } catch {
    return [];
  }
}

// ─── Template persistence ────────────────────────────────────────────────────

const TEMPLATE_KEY = 'nexyfab-sketch-templates';

export function saveSketchTemplate(entry: SketchHistoryEntry): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const existing = loadSketchTemplates();
    const updated = [...existing, { ...entry, id: `tpl-${Date.now()}` }];
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(updated));
  } catch {
    // Silently ignore
  }
}

export function loadSketchTemplates(): SketchHistoryEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(TEMPLATE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SketchHistoryEntry[];
  } catch {
    return [];
  }
}

export function deleteSketchTemplate(id: string): SketchHistoryEntry[] {
  const updated = loadSketchTemplates().filter(e => e.id !== id);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(updated));
    }
  } catch {
    // Silently ignore
  }
  return updated;
}
