/**
 * CAD AI Copilot — Natural Language Feature Parser
 *
 * Converts natural language commands into structured feature operations
 * that can be applied directly to the feature stack.
 *
 * Architecture:
 *  1. Local rule-based parser (fast, no network) for common patterns
 *  2. Optional LLM pass-through via /api/copilot for complex sentences
 *
 * Supported commands (rule-based, ~200ms):
 *  - "add a box 100 × 60 × 40 mm"
 *  - "create a cylinder radius 25 height 80"
 *  - "drill a hole 8mm diameter on top face"
 *  - "fillet all edges 3mm"
 *  - "chamfer edge 2mm at 45°"
 *  - "shell the body thickness 2mm"
 *  - "mirror about XZ plane"
 *  - "set width to 150"
 *  - "extrude sketch 30mm"
 *  - "subtract a cylinder r=5 h=20 from top"
 *
 * Returns a `CopilotCommand` which the caller dispatches to the
 * feature pipeline (addFeature / addSketchFeature / setParam).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CopilotCommandType =
  | 'addShape'
  | 'addHole'
  | 'addFillet'
  | 'addChamfer'
  | 'addShell'
  | 'addMirror'
  | 'setParam'
  | 'extrude'
  | 'subtract'
  | 'unknown';

export type ShapeType = 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus';

export interface CopilotCommand {
  type: CopilotCommandType;
  /** Raw input that generated this command */
  input: string;
  /** Confidence 0–1 */
  confidence: number;
  /** Structured params extracted from the command */
  params: Record<string, number | string | boolean>;
  /** Human-readable description of what will happen */
  description: string;
  /** Whether this came from the local rule engine or LLM */
  source: 'rule' | 'llm';
}

export interface CopilotResponse {
  commands: CopilotCommand[];
  /** Any clarification the user should see */
  clarification?: string;
  /** True if the input was ambiguous */
  ambiguous: boolean;
}

// ─── Unit normalization ───────────────────────────────────────────────────────

function toMm(value: number, unit: string): number {
  switch (unit.toLowerCase().replace('.', '')) {
    case 'cm':   return value * 10;
    case 'm':    return value * 1000;
    case 'in':
    case 'inch':
    case '"':    return value * 25.4;
    default:     return value; // assume mm
  }
}

// ─── Regex helpers ────────────────────────────────────────────────────────────

const NUM = '([\\d.]+)';
const UNIT = '(mm|cm|m|in|inch|")?';
const DIM = `${NUM}\\s*${UNIT}`;
const SEP = '(?:\\s*[x×*by\\s]\\s*)';
const W = '\\s*';

function extractNum(m: RegExpMatchArray | null, idx: number, unit?: string): number | undefined {
  if (!m || !m[idx]) return undefined;
  const val = parseFloat(m[idx]);
  const u = unit ?? m[idx + 1] ?? '';
  return isNaN(val) ? undefined : toMm(val, u);
}

// ─── Rule-based parsers ───────────────────────────────────────────────────────

function parseAddShape(input: string): CopilotCommand | null {
  const lower = input.toLowerCase();

  // Box: "add box 100 x 60 x 40", "create a box 100 × 60 × 40 mm", "box 100 60 40"
  const boxMatch = lower.match(
    new RegExp(`(?:add|create|make|build)?${W}(?:a${W})?box(?:\\s+(?:of|shape))?${W}${DIM}${W}${SEP}${DIM}${W}${SEP}${DIM}`, 'i'),
  );
  if (boxMatch) {
    const w = extractNum(boxMatch, 1, boxMatch[2]);
    const h = extractNum(boxMatch, 3, boxMatch[4]);
    const d = extractNum(boxMatch, 5, boxMatch[6]);
    if (w && h && d) return {
      type: 'addShape', input, confidence: 0.95, source: 'rule',
      params: { shapeId: 'box', width: w, height: h, depth: d },
      description: `Add box ${w} × ${h} × ${d} mm`,
    };
  }

  // Cylinder: "add cylinder radius 25 height 80" or "cylinder r=25 h=80"
  const cylMatch = lower.match(/(?:add|create|make)?[a-z\s]*cylinder[a-z\s]*r(?:adius)?[=:\s]+([0-9.]+)\s*(mm|cm)?\s*h(?:eight|ight)?[=:\s]+([0-9.]+)\s*(mm|cm)?/i);
  if (cylMatch) {
    const r = toMm(parseFloat(cylMatch[1]), cylMatch[2] ?? 'mm');
    const h = toMm(parseFloat(cylMatch[3]), cylMatch[4] ?? 'mm');
    return {
      type: 'addShape', input, confidence: 0.92, source: 'rule',
      params: { shapeId: 'cylinder', radius: r, height: h },
      description: `Add cylinder r=${r} h=${h} mm`,
    };
  }

  // Sphere: "add sphere radius 30"
  const sphMatch = lower.match(/(?:add|create|make)?[a-z\s]*sphere[a-z\s]*r(?:adius)?[=:\s]+([0-9.]+)\s*(mm|cm)?/i);
  if (sphMatch) {
    const r = toMm(parseFloat(sphMatch[1]), sphMatch[2] ?? 'mm');
    return {
      type: 'addShape', input, confidence: 0.92, source: 'rule',
      params: { shapeId: 'sphere', radius: r },
      description: `Add sphere r=${r} mm`,
    };
  }

  return null;
}

function parseAddHole(input: string): CopilotCommand | null {
  const lower = input.toLowerCase();
  // "drill a hole 8mm diameter", "add hole diameter 10 depth 20"
  const m = lower.match(/(?:drill|bore|add|create)?[a-z\s]*hole[a-z\s]*(?:diameter|d|dia|r(?:adius)?)[=:\s]+([0-9.]+)\s*(mm)?(?:[a-z\s]*(?:depth|h(?:eight)?)[=:\s]+([0-9.]+)\s*(mm)?)?/i);
  if (m) {
    const dia = toMm(parseFloat(m[1]), m[2] ?? 'mm');
    const depth = m[3] ? toMm(parseFloat(m[3]), m[4] ?? 'mm') : dia * 2;
    const faceMatch = lower.match(/on\s+(top|bottom|front|back|left|right)/i);
    const face = faceMatch ? faceMatch[1].toLowerCase() : 'top';
    return {
      type: 'addHole', input, confidence: 0.88, source: 'rule',
      params: { diameter: dia, depth, face, radius: dia / 2 },
      description: `Drill Ø${dia}mm hole on ${face} face, depth ${depth}mm`,
    };
  }
  return null;
}

function parseAddFillet(input: string): CopilotCommand | null {
  const lower = input.toLowerCase();
  const m = lower.match(/(?:fillet|round)\s+(?:all\s+)?(?:edges?\s+)?([0-9.]+)\s*(mm)?/i);
  if (m) {
    const r = toMm(parseFloat(m[1]), m[2] ?? 'mm');
    const allEdges = /all/i.test(lower);
    return {
      type: 'addFillet', input, confidence: 0.9, source: 'rule',
      params: { radius: r, allEdges },
      description: `Fillet ${allEdges ? 'all edges' : 'selected edges'} r=${r}mm`,
    };
  }
  return null;
}

function parseAddChamfer(input: string): CopilotCommand | null {
  const lower = input.toLowerCase();
  const m = lower.match(/chamfer\s+(?:edge\s+)?([0-9.]+)\s*(mm)?(?:\s+at\s+([0-9.]+)\s*(?:deg|°)?)?/i);
  if (m) {
    const size = toMm(parseFloat(m[1]), m[2] ?? 'mm');
    const angle = m[3] ? parseFloat(m[3]) : 45;
    return {
      type: 'addChamfer', input, confidence: 0.88, source: 'rule',
      params: { size, angle },
      description: `Chamfer ${size}mm × ${angle}°`,
    };
  }
  return null;
}

function parseSetParam(input: string): CopilotCommand | null {
  const lower = input.toLowerCase();
  // "set width to 150", "width = 200mm", "change radius to 30"
  const m = lower.match(/(?:set|change|update)?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:to|=|:)\s*([0-9.]+)\s*(mm|cm|in)?/i);
  if (m && !['add', 'create', 'drill', 'fillet', 'chamfer'].includes(m[1].toLowerCase())) {
    const key = m[1];
    const val = toMm(parseFloat(m[2]), m[3] ?? 'mm');
    return {
      type: 'setParam', input, confidence: 0.85, source: 'rule',
      params: { key, value: val },
      description: `Set ${key} = ${val} mm`,
    };
  }
  return null;
}

function parseExtrude(input: string): CopilotCommand | null {
  const lower = input.toLowerCase();
  const m = lower.match(/extrude\s+(?:sketch\s+)?([0-9.]+)\s*(mm)?/i);
  if (m) {
    const depth = toMm(parseFloat(m[1]), m[2] ?? 'mm');
    const subtract = /subtract|cut|remove/i.test(lower);
    return {
      type: 'extrude', input, confidence: 0.87, source: 'rule',
      params: { depth, operation: subtract ? 'subtract' : 'add' },
      description: `Extrude sketch ${depth}mm (${subtract ? 'subtract' : 'add'})`,
    };
  }
  return null;
}

function parseShell(input: string): CopilotCommand | null {
  const lower = input.toLowerCase();
  const m = lower.match(/(?:shell|hollow(?:out)?)\s+(?:thickness\s+)?([0-9.]+)\s*(mm)?/i);
  if (m) {
    const thickness = toMm(parseFloat(m[1]), m[2] ?? 'mm');
    return {
      type: 'addShell', input, confidence: 0.85, source: 'rule',
      params: { thickness },
      description: `Shell body thickness=${thickness}mm`,
    };
  }
  return null;
}

function parseMirror(input: string): CopilotCommand | null {
  const lower = input.toLowerCase();
  const m = lower.match(/mirror\s+(?:about\s+)?([xyz]{2})\s*(?:plane)?/i);
  if (m) {
    const plane = m[1].toUpperCase() as 'XY' | 'XZ' | 'YZ';
    return {
      type: 'addMirror', input, confidence: 0.88, source: 'rule',
      params: { plane },
      description: `Mirror about ${plane} plane`,
    };
  }
  return null;
}

// ─── Main Rule Engine ─────────────────────────────────────────────────────────

const PARSERS = [
  parseAddShape,
  parseAddHole,
  parseAddFillet,
  parseAddChamfer,
  parseExtrude,
  parseShell,
  parseMirror,
  parseSetParam,
];

/**
 * Parse a natural language CAD command using the local rule engine.
 * Returns immediately (no network call).
 */
export function parseLocalCommand(input: string): CopilotResponse {
  const trimmed = input.trim();

  for (const parser of PARSERS) {
    const cmd = parser(trimmed);
    if (cmd) {
      return { commands: [cmd], ambiguous: false };
    }
  }

  // No match
  return {
    commands: [{
      type: 'unknown',
      input: trimmed,
      confidence: 0,
      params: {},
      description: 'Command not recognized by local parser',
      source: 'rule',
    }],
    ambiguous: true,
    clarification: 'Try: "add box 100×60×40", "drill hole 8mm on top", "fillet all edges 3mm", "set width to 200"',
  };
}

/**
 * Parse via the server-side LLM (OpenAI / local model).
 * Falls back to local parser if the API is unavailable.
 */
export async function parseCommand(
  input: string,
  useLlm = false,
): Promise<CopilotResponse> {
  // Always try local first
  const local = parseLocalCommand(input);
  if (local.commands[0].type !== 'unknown' || !useLlm) return local;

  // LLM pass-through
  try {
    const res = await fetch('/api/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json() as CopilotResponse;
    return { ...data, commands: data.commands.map(c => ({ ...c, source: 'llm' as const })) };
  } catch {
    return local; // graceful fallback
  }
}

// ─── Command → Feature dispatch helper ──────────────────────────────────────

export interface FeatureDispatcher {
  addFeature: (type: string, params?: Record<string, unknown>) => void;
  addSketchFeature: (profile: any, config: any, plane: 'xy' | 'xz' | 'yz', op: 'add' | 'subtract') => void;
  setParam: (key: string, value: number) => void;
}

/**
 * Dispatch a CopilotCommand to the feature pipeline.
 * Returns true if the command was handled.
 */
export function dispatchCopilotCommand(
  cmd: CopilotCommand,
  dispatcher: FeatureDispatcher,
): boolean {
  switch (cmd.type) {
    case 'addShape': {
      const { shapeId, ...params } = cmd.params as { shapeId: string } & Record<string, number>;
      dispatcher.addFeature(shapeId, params);
      return true;
    }
    case 'addHole': {
      // A hole = a cylinder subtracted from top
      const { radius, depth } = cmd.params as { radius: number; depth: number; face: string };
      const r = radius ?? 4;
      const d = depth ?? r * 2;
      dispatcher.addSketchFeature(
        {
          segments: Array.from({ length: 32 }, (_, i) => {
            const a1 = (2 * Math.PI * i) / 32;
            const a2 = (2 * Math.PI * (i + 1)) / 32;
            return {
              type: 'line',
              from: { x: r * Math.cos(a1), y: r * Math.sin(a1) },
              to: { x: r * Math.cos(a2), y: r * Math.sin(a2) },
            };
          }),
          closed: true,
        },
        { depth: d },
        'xy',
        'subtract',
      );
      return true;
    }
    case 'addFillet':
      dispatcher.addFeature('fillet', cmd.params as Record<string, unknown>);
      return true;
    case 'addChamfer':
      dispatcher.addFeature('chamfer', cmd.params as Record<string, unknown>);
      return true;
    case 'addShell':
      dispatcher.addFeature('shell', cmd.params as Record<string, unknown>);
      return true;
    case 'addMirror':
      dispatcher.addFeature('mirror', cmd.params as Record<string, unknown>);
      return true;
    case 'setParam': {
      const { key, value } = cmd.params as { key: string; value: number };
      dispatcher.setParam(key, value);
      return true;
    }
    default:
      return false;
  }
}
