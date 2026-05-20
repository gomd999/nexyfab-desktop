/**
 * gcodeReader.ts — Parse G-code text and extract motion + feed +
 * spindle statistics.
 *
 * Mirror of the writer module `gcodeEmitter.ts`: this reads a
 * `.nc` / `.gcode` file and produces:
 *
 *   - Per-block parsed records (line number, command, args).
 *   - Cumulative XYZ travel distance.
 *   - Feed-rate histogram (how much time at each F value).
 *   - Spindle on/off + RPM events.
 *   - Tool change list.
 *   - Bounding box of the motion.
 *
 * Used by the CAM simulator + post-process verifier. Caller may
 * pre-strip comments; this reader handles `(...)` and `;...` style.
 */

export type GCommand =
  | 'G0' | 'G1' | 'G2' | 'G3'
  | 'G17' | 'G18' | 'G19'
  | 'G20' | 'G21'
  | 'G28' | 'G90' | 'G91'
  | 'M0' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M30'
  | 'COMMENT' | 'OTHER';

export interface GCodeBlock {
  lineNumber: number;
  command: GCommand;
  /** Parameter map (X, Y, Z, F, S, T, etc.). */
  params: Record<string, number>;
  /** Raw text. */
  raw: string;
}

export interface MotionStats {
  /** Total linear motion distance (XYZ), mm. */
  totalDistanceMm: number;
  /** Rapid distance (G0). */
  rapidDistanceMm: number;
  /** Feed distance (G1). */
  feedDistanceMm: number;
  /** Arc distance (G2/G3 estimate from start-end). */
  arcDistanceMm: number;
  /** Bounding box of the motion. */
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

export interface FeedHistogram {
  /** Feed rate (mm/min). */
  feedRate: number;
  /** Cumulative time at that rate (sec). */
  timeSec: number;
}

export interface SpindleEvent {
  blockIndex: number;
  /** Spindle on/off. */
  state: 'on' | 'off';
  /** Direction: M3 = CW, M4 = CCW. */
  direction?: 'CW' | 'CCW';
  /** RPM if specified. */
  rpm?: number;
}

export interface ToolChange {
  blockIndex: number;
  toolNumber: number;
}

export interface ParseResult {
  blocks: GCodeBlock[];
  motion: MotionStats;
  feedHistogram: FeedHistogram[];
  spindleEvents: SpindleEvent[];
  toolChanges: ToolChange[];
  /** Lines that failed to parse. */
  errors: Array<{ lineNumber: number; reason: string }>;
}

// ── Top-level entry ────────────────────────────────────────────

export function parseGCode(source: string): ParseResult {
  const blocks: GCodeBlock[] = [];
  const errors: Array<{ lineNumber: number; reason: string }> = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    try {
      const block = parseLine(raw, i + 1);
      if (block) blocks.push(block);
    } catch (e) {
      errors.push({ lineNumber: i + 1, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  const motion = computeMotionStats(blocks);
  const feedHistogram = buildFeedHistogram(blocks);
  const spindleEvents = extractSpindleEvents(blocks);
  const toolChanges = extractToolChanges(blocks);
  return { blocks, motion, feedHistogram, spindleEvents, toolChanges, errors };
}

// ── Line parser ────────────────────────────────────────────────

function parseLine(raw: string, lineNumber: number): GCodeBlock | null {
  const stripped = raw.replace(/\(.*?\)/g, '').replace(/;.*/g, '').trim();
  if (stripped === '') return null;
  // Optional N{number} line label at start.
  let body = stripped.replace(/^N\d+\s*/i, '').trim();
  if (body === '') return null;
  // Split into tokens.
  const tokens = body.match(/[A-Za-z][-+]?[\d.]+/g) ?? [];
  if (tokens.length === 0) {
    return { lineNumber, command: 'COMMENT', params: {}, raw };
  }
  const firstToken = tokens[0]!.toUpperCase();
  const params: Record<string, number> = {};
  let command: GCommand = 'OTHER';
  if (firstToken.startsWith('G') || firstToken.startsWith('M')) {
    command = normalizeCommand(firstToken);
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i]!;
      const letter = t[0]!.toUpperCase();
      const num = Number(t.slice(1));
      if (!Number.isFinite(num)) continue;
      params[letter] = num;
    }
  } else {
    // No command letter; treat as continuation (rare).
    for (const t of tokens) {
      const letter = t[0]!.toUpperCase();
      const num = Number(t.slice(1));
      if (!Number.isFinite(num)) continue;
      params[letter] = num;
    }
  }
  return { lineNumber, command, params, raw };
}

function normalizeCommand(token: string): GCommand {
  const known: GCommand[] = [
    'G0', 'G1', 'G2', 'G3',
    'G17', 'G18', 'G19',
    'G20', 'G21',
    'G28', 'G90', 'G91',
    'M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M30',
  ];
  const upper = token.replace(/^G0+(\d)/, 'G$1').replace(/^M0+(\d)/, 'M$1');
  if ((known as string[]).includes(upper)) return upper as GCommand;
  return 'OTHER';
}

// ── Motion stats ───────────────────────────────────────────────

function computeMotionStats(blocks: GCodeBlock[]): MotionStats {
  let x = 0, y = 0, z = 0;
  let xMin = Infinity, yMin = Infinity, zMin = Infinity;
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
  let rapid = 0;
  let feed = 0;
  let arc = 0;
  for (const b of blocks) {
    const nx = b.params.X !== undefined ? b.params.X : x;
    const ny = b.params.Y !== undefined ? b.params.Y : y;
    const nz = b.params.Z !== undefined ? b.params.Z : z;
    const dist = Math.hypot(nx - x, ny - y, nz - z);
    if (b.command === 'G0') rapid += dist;
    else if (b.command === 'G1') feed += dist;
    else if (b.command === 'G2' || b.command === 'G3') arc += dist;
    x = nx; y = ny; z = nz;
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }
  if (!Number.isFinite(xMin)) { xMin = 0; xMax = 0; yMin = 0; yMax = 0; zMin = 0; zMax = 0; }
  return {
    totalDistanceMm: rapid + feed + arc,
    rapidDistanceMm: rapid,
    feedDistanceMm: feed,
    arcDistanceMm: arc,
    bbox: { min: [xMin, yMin, zMin], max: [xMax, yMax, zMax] },
  };
}

// ── Feed histogram ─────────────────────────────────────────────

function buildFeedHistogram(blocks: GCodeBlock[]): FeedHistogram[] {
  let currentFeed = 0;
  const map = new Map<number, number>();
  let x = 0, y = 0, z = 0;
  for (const b of blocks) {
    if (b.params.F !== undefined) currentFeed = b.params.F;
    if (b.command === 'G1' || b.command === 'G2' || b.command === 'G3') {
      const nx = b.params.X ?? x;
      const ny = b.params.Y ?? y;
      const nz = b.params.Z ?? z;
      const dist = Math.hypot(nx - x, ny - y, nz - z);
      const time = currentFeed > 0 ? (dist / currentFeed) * 60 : 0;
      map.set(currentFeed, (map.get(currentFeed) ?? 0) + time);
      x = nx; y = ny; z = nz;
    } else if (b.command === 'G0') {
      x = b.params.X ?? x; y = b.params.Y ?? y; z = b.params.Z ?? z;
    }
  }
  return [...map.entries()].map(([feedRate, timeSec]) => ({ feedRate, timeSec }))
    .sort((a, b) => a.feedRate - b.feedRate);
}

// ── Spindle + tool ─────────────────────────────────────────────

function extractSpindleEvents(blocks: GCodeBlock[]): SpindleEvent[] {
  const events: SpindleEvent[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.command === 'M3' || b.command === 'M4') {
      events.push({
        blockIndex: i,
        state: 'on',
        direction: b.command === 'M3' ? 'CW' : 'CCW',
        ...(b.params.S !== undefined ? { rpm: b.params.S } : {}),
      });
    } else if (b.command === 'M5' || b.command === 'M30') {
      events.push({ blockIndex: i, state: 'off' });
    }
  }
  return events;
}

function extractToolChanges(blocks: GCodeBlock[]): ToolChange[] {
  const out: ToolChange[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.command === 'M6' && b.params.T !== undefined) {
      out.push({ blockIndex: i, toolNumber: b.params.T });
    }
  }
  return out;
}

// ── Summary ────────────────────────────────────────────────────

export interface GCodeSummary {
  blockCount: number;
  totalDistanceMm: number;
  totalRunMinutes: number;
  toolChangeCount: number;
  uniqueToolCount: number;
  hasArcs: boolean;
  errorCount: number;
}

export function summarize(result: ParseResult): GCodeSummary {
  const totalTime = result.feedHistogram.reduce((s, h) => s + h.timeSec, 0);
  return {
    blockCount: result.blocks.length,
    totalDistanceMm: result.motion.totalDistanceMm,
    totalRunMinutes: totalTime / 60,
    toolChangeCount: result.toolChanges.length,
    uniqueToolCount: new Set(result.toolChanges.map(t => t.toolNumber)).size,
    hasArcs: result.motion.arcDistanceMm > 0,
    errorCount: result.errors.length,
  };
}
