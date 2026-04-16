// ECAD PCB Import — KiCad .kicad_pcb + CSV parser
// Extracts component heat sources → ThermalBoundary[] for thermalFEA

import type { ThermalBoundary } from './thermalFEA';

export interface PCBComponent {
  ref: string;        // e.g. "U1", "R3"
  value: string;      // e.g. "ATmega328", "10k"
  x: number;          // mm from PCB origin
  y: number;          // mm from PCB origin
  rotation: number;   // degrees
  layer: 'F.Cu' | 'B.Cu';
  powerWatts: number; // estimated power dissipation
  footprint: string;
}

export interface PCBBoard {
  components: PCBComponent[];
  width: number;    // mm
  height: number;   // mm
  thickness: number; // mm (default 1.6)
}

// Power estimates by component reference prefix (heuristic)
const POWER_BY_TYPE: Record<string, number> = {
  // ICs
  'U': 0.5, 'IC': 0.5,
  // Resistors
  'R': 0.125,
  // Capacitors (negligible)
  'C': 0.01,
  // LEDs
  'D': 0.05, 'LED': 0.3,
  // Transistors / MOSFETs
  'Q': 0.25, 'T': 0.25,
  // Voltage regulators / power ICs
  'VR': 2.0, 'LDO': 1.5,
  // Inductors
  'L': 0.1,
  // Connectors
  'J': 0.05, 'P': 0.05,
  // Motors / drivers
  'M': 3.0, 'DRV': 2.0,
};

function estimatePower(ref: string, value: string): number {
  const prefix = ref.replace(/[0-9]/g, '').toUpperCase();
  for (const [key, watts] of Object.entries(POWER_BY_TYPE)) {
    if (prefix.startsWith(key)) return watts;
  }
  // Check value string for explicit wattage annotation
  const v = value.toLowerCase();
  if (/[\d.]+w/.test(v)) {
    const match = v.match(/([\d.]+)w/);
    if (match) return parseFloat(match[1]);
  }
  if (v.includes('regulator') || v.includes('ldo')) return 1.5;
  if (v.includes('amp') || v.includes('driver')) return 1.0;
  return 0.1; // default fallback
}

/**
 * Parse KiCad .kicad_pcb text format (S-expression).
 * Extracts footprint positions and estimates power dissipation.
 */
export function parseKicadPCB(text: string): PCBBoard {
  const components: PCBComponent[] = [];

  // Extract board size from page/setup section
  let width = 100, height = 80;
  const paperMatch = text.match(/\(paper\s+"([^"]+)"\s+([\d.]+)\s+([\d.]+)/);
  if (paperMatch) {
    width = parseFloat(paperMatch[2]);
    height = parseFloat(paperMatch[3]);
  }

  // Fallback regex for when block splitting misses components
  const footprintRegex = /\(footprint\s+"([^"]*)"[^(]*\(layer\s+"([^"]*)"[^)]*\)\s*\(at\s+([\d.-]+)\s+([\d.-]+)(?:\s+([\d.-]+))?\)/g;

  // Split by footprint blocks (S-expression)
  const blocks = text.split(/(?=\(footprint\s+")/);

  for (const block of blocks) {
    if (!block.startsWith('(footprint')) continue;

    // Position
    const atMatch = block.match(/\(at\s+([\d.-]+)\s+([\d.-]+)(?:\s+([\d.-]+))?\)/);
    if (!atMatch) continue;

    const x = parseFloat(atMatch[1]);
    const y = parseFloat(atMatch[2]);
    const rotation = atMatch[3] ? parseFloat(atMatch[3]) : 0;

    // Layer
    const layerMatch = block.match(/\(layer\s+"([^"]*)"\)/);
    const layer: 'F.Cu' | 'B.Cu' = layerMatch?.[1]?.includes('B.') ? 'B.Cu' : 'F.Cu';

    // Footprint name
    const fpMatch = block.match(/\(footprint\s+"([^"]*)"/);
    const footprint = fpMatch?.[1] ?? '';

    // Reference designator
    const refMatch = block.match(/\(property\s+"Reference"\s+"([^"]*)"/);
    const ref = refMatch?.[1] ?? `U${components.length + 1}`;

    // Value
    const valMatch = block.match(/\(property\s+"Value"\s+"([^"]*)"/);
    const value = valMatch?.[1] ?? '';

    const powerWatts = estimatePower(ref, value);
    components.push({ ref, value, x, y, rotation, layer, powerWatts, footprint });
  }

  // Fallback: simple regex if S-expression block split yields nothing
  if (components.length === 0) {
    let m: RegExpExecArray | null;
    while ((m = footprintRegex.exec(text)) !== null) {
      const ref = `U${components.length + 1}`;
      components.push({
        ref,
        value: m[1],
        x: parseFloat(m[3]),
        y: parseFloat(m[4]),
        rotation: m[5] ? parseFloat(m[5]) : 0,
        layer: m[2]?.includes('B.') ? 'B.Cu' : 'F.Cu',
        powerWatts: estimatePower(ref, m[1]),
        footprint: m[1],
      });
    }
  }

  return { components, width, height, thickness: 1.6 };
}

/**
 * Parse simple CSV format: ref,value,x_mm,y_mm,power_w
 * Allows manual component entry without KiCad.
 */
export function parseComponentCSV(csv: string): PCBBoard {
  const lines = csv.trim().split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const components: PCBComponent[] = [];
  let maxX = 0, maxY = 0;

  for (const line of lines.slice(1)) { // skip header row
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 4) continue;
    const [ref, value, xs, ys, ps] = parts;
    const x = parseFloat(xs) || 0;
    const y = parseFloat(ys) || 0;
    const powerWatts = ps ? parseFloat(ps) : estimatePower(ref, value);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    components.push({ ref, value, x, y, rotation: 0, layer: 'F.Cu', powerWatts, footprint: '' });
  }

  return { components, width: maxX + 20, height: maxY + 20, thickness: 1.6 };
}

/**
 * Convert PCB component positions to ThermalBoundary array for thermalFEA.
 * Maps PCB (x,y) coordinates to geometry bounding-box face positions.
 */
export function pcbToThermalBoundaries(
  board: PCBBoard,
  geometryBB: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
): ThermalBoundary[] {
  const boundaries: ThermalBoundary[] = [];

  // Map PCB XY → geometry XZ (PCB lies flat, Y=up in 3D)
  const _scaleX = (geometryBB.max.x - geometryBB.min.x) / board.width;
  const _scaleZ = (geometryBB.max.z - geometryBB.min.z) / board.height;

  void _scaleX; void _scaleZ; // used for future per-face mapping

  for (const comp of board.components) {
    if (comp.powerWatts < 0.05) continue; // skip negligible heat sources

    // Bottom face (faceIndex 0) = main PCB heat source plane
    boundaries.push({
      type: 'heat_source',
      faceIndex: 0,
      value: comp.powerWatts * 1000, // W → mW for solver scale
    });
  }

  // Ambient convection on top face
  boundaries.push({
    type: 'convection',
    faceIndex: 1,
    value: 10,       // h*A ≈ 10 W/K (natural convection)
    ambientTemp: 25,
  });

  return boundaries;
}
