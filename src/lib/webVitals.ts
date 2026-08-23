export const WEB_VITAL_NAMES = ['LCP', 'INP', 'CLS'] as const;
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];
export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';
export type WebVitalDevice = 'mobile' | 'tablet' | 'desktop';

export interface WebVitalPayload {
  name: WebVitalName;
  value: number;
  delta: number;
  rating: WebVitalRating;
  route: string;
  device: WebVitalDevice;
  navigationType?: string;
}

// Keep a finite abuse boundary without rejecting legitimate very-slow page
// loads. A cold CAD workspace compile/load can exceed two minutes on a
// development or low-power machine, and rejecting that sample hides exactly
// the performance failure RUM is meant to surface.
const MAX_DURATION_VITAL_MS = 10 * 60 * 1_000;

const RATINGS = new Set<WebVitalRating>(['good', 'needs-improvement', 'poor']);
const DEVICES = new Set<WebVitalDevice>(['mobile', 'tablet', 'desktop']);
const DYNAMIC_PARENT_SEGMENTS = new Set([
  'invite', 'job', 'manufacturers', 'orders', 'projects', 'quotes', 'rfq', 'share', 'teams', 'view',
]);

function isDynamicSegment(segment: string, previous: string | undefined): boolean {
  if (previous && DYNAMIC_PARENT_SEGMENTS.has(previous)) return true;
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return true;
  if (segment.includes('@') || segment.length > 24) return true;
  return !/^[a-z0-9._~-]+$/i.test(segment);
}

export function normalizeWebVitalRoute(input: unknown): string {
  if (typeof input !== 'string') return '/unknown';
  const pathname = input.split(/[?#]/, 1)[0].slice(0, 512);
  const rawSegments = pathname.split('/').filter(Boolean);
  const normalized: string[] = [];
  for (const segment of rawSegments) {
    const decoded = (() => {
      try { return decodeURIComponent(segment); } catch { return segment; }
    })();
    const previous = normalized.at(-1);
    normalized.push(isDynamicSegment(decoded, previous) ? ':id' : decoded.toLowerCase());
  }
  return `/${normalized.join('/')}`.slice(0, 160) || '/';
}

function finiteNumber(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

export function parseWebVitalPayload(input: unknown): WebVitalPayload | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (!WEB_VITAL_NAMES.includes(body.name as WebVitalName)) return null;
  const name = body.name as WebVitalName;
  const maximum = name === 'CLS' ? 10 : MAX_DURATION_VITAL_MS;
  const value = finiteNumber(body.value, 0, maximum);
  const delta = finiteNumber(body.delta, 0, maximum);
  if (value === null || delta === null || !RATINGS.has(body.rating as WebVitalRating) || !DEVICES.has(body.device as WebVitalDevice)) {
    return null;
  }
  const route = normalizeWebVitalRoute(body.route);
  const navigationType = typeof body.navigationType === 'string'
    ? body.navigationType.replace(/[^a-z-]/gi, '').slice(0, 32)
    : undefined;
  return {
    name,
    value,
    delta,
    rating: body.rating as WebVitalRating,
    route,
    device: body.device as WebVitalDevice,
    ...(navigationType ? { navigationType } : {}),
  };
}
