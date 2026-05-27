/**
 * gcodeEmitter.ts — Basic G-code emitter (ISO 6983).
 *
 * Converts a list of `ToolpathSegment`s into G-code text. Subset:
 *   - G0  rapid move
 *   - G1  feed move
 *   - G17 / G20|G21 / G90 / G94 header (XY plane, mm/inch, abs, feed/min)
 *   - M3 / M5 spindle on/off, S-word for spindle speed
 *   - T# / M6 tool change
 *
 * Per `nexyfab-gtm`: this is preview-grade — partners use real
 * post-processors for production. The emitter's output is human-
 * readable G-code suitable for verification in a sim (NC viewer /
 * CAMotics) but not vendor-specific (no Mazak / Fanuc / Heidenhain
 * quirks).
 */

import type { ToolpathSegment } from './pocketToolpath';

export interface GcodeEmitOptions {
  units?: 'mm' | 'inch';
  /** Spindle speed (RPM) — emits S word at job start. */
  spindleRpm?: number;
  /** Cut feed rate (mm/min). Emits F word on first feed move. */
  cutFeedMmPerMin?: number;
  /** Plunge feed rate (mm/min). Falls back to cutFeed when omitted. */
  plungeFeedMmPerMin?: number;
  /** Tool number for the T-word. */
  toolNumber?: number;
  /** Coordinate precision (decimal places). Default 3. */
  precision?: number;
}

function n(v: number, p: number): string {
  if (!Number.isFinite(v)) return '0';
  return v.toFixed(p);
}

/** Emit a G-code program from a list of segments. */
export function emitGcode(segments: ToolpathSegment[], opts: GcodeEmitOptions = {}): string {
  const units = opts.units ?? 'mm';
  const p = opts.precision ?? 3;
  const cutFeed = opts.cutFeedMmPerMin ?? 1000;
  const plungeFeed = opts.plungeFeedMmPerMin ?? cutFeed * 0.5;
  const rpm = opts.spindleRpm ?? 8000;
  const tool = opts.toolNumber ?? 1;

  const lines: string[] = [];
  lines.push('(NexyFab CAM preview)');
  lines.push('(Preview-grade — re-post via partner machine before running.)');
  lines.push('G17');                              // XY plane
  lines.push(units === 'mm' ? 'G21' : 'G20');     // units
  lines.push('G90');                              // absolute coords
  lines.push('G94');                              // feed per minute
  lines.push(`T${tool} M6`);                      // tool change
  lines.push(`S${Math.round(rpm)} M3`);           // spindle on

  let lastKind: ToolpathSegment['kind'] | null = null;
  let feedEmitted = false;

  for (const s of segments) {
    if (s.kind === 'rapid') {
      if (lastKind !== 'rapid') {
        // Comment so the partner inspector can see what the line is for.
        lines.push('(rapid)');
      }
      lines.push(`G0 X${n(s.end[0], p)} Y${n(s.end[1], p)} Z${n(s.end[2], p)}`);
    } else if (s.kind === 'feed') {
      if (!feedEmitted) {
        lines.push(`F${Math.round(cutFeed)}`);
        feedEmitted = true;
      }
      lines.push(`G1 X${n(s.end[0], p)} Y${n(s.end[1], p)} Z${n(s.end[2], p)}`);
    } else if (s.kind === 'plunge') {
      lines.push(`F${Math.round(plungeFeed)}`);
      lines.push(`G1 X${n(s.end[0], p)} Y${n(s.end[1], p)} Z${n(s.end[2], p)}`);
      feedEmitted = true;
    }
    lastKind = s.kind;
  }

  lines.push('M5');                               // spindle off
  lines.push('M30');                              // program end + rewind
  return lines.join('\n');
}
