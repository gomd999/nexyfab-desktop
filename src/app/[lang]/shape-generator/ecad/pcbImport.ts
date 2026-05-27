/**
 * pcbImport.ts — Import PCB outline + component placement for
 * enclosure / heat-sink design.
 *
 * SolidWorks PCB tools integrate Altium / Eagle / KiCad via IDF
 * (Intermediate Data Format) and EMN (Mentor) files. NexyFab
 * ships a lightweight parser for the most common case: PCB
 * outline + component bounding boxes (no copper traces).
 *
 * Use case: HW engineer designs the PCB in Altium, exports IDF,
 * imports here, and uses the shell + component envelopes to
 * shape an enclosure that doesn't collide.
 */

export interface PcbComponent {
  refDes: string;
  /** Component centroid in PCB plane (mm). */
  position: [number, number, number];
  /** Bounding box (mm) — width, length, height. */
  size: [number, number, number];
  /** Rotation about Z axis (deg). */
  rotationDeg: number;
  /** Pin 1 side: 'top' = component on top, 'bottom' = SMT bottom. */
  side: 'top' | 'bottom';
}

export interface PcbBoard {
  /** Outline polyline in PCB plane (mm). Closed loop. */
  outline: Array<[number, number]>;
  /** Board thickness (mm). */
  thicknessMm: number;
  /** Mounting hole positions + diameter. */
  mountingHoles: Array<{ position: [number, number]; diameterMm: number }>;
  components: PcbComponent[];
}

/** Parse a simplified IDF 3.0 text file. Real IDF has many
 *  sections; we extract the BOARD_OUTLINE and PLACEMENT only. */
export function parseIdf(text: string): PcbBoard | null {
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const outline: Array<[number, number]> = [];
  const components: PcbComponent[] = [];
  const mountingHoles: PcbBoard['mountingHoles'] = [];
  let thickness = 1.6;

  let section: 'none' | 'outline' | 'placement' | 'holes' = 'none';
  for (const line of lines) {
    if (line.startsWith('.BOARD_OUTLINE')) { section = 'outline'; continue; }
    if (line.startsWith('.END_BOARD_OUTLINE')) { section = 'none'; continue; }
    if (line.startsWith('.PLACEMENT')) { section = 'placement'; continue; }
    if (line.startsWith('.END_PLACEMENT')) { section = 'none'; continue; }
    if (line.startsWith('.DRILLED_HOLES')) { section = 'holes'; continue; }
    if (line.startsWith('.END_DRILLED_HOLES')) { section = 'none'; continue; }
    if (line.startsWith('THICK')) {
      const parts = line.split(/\s+/);
      thickness = parseFloat(parts[1]!) || 1.6;
      continue;
    }
    if (section === 'outline') {
      const parts = line.split(/\s+/).map(Number);
      if (parts.length >= 3 && Number.isFinite(parts[1]!) && Number.isFinite(parts[2]!)) {
        outline.push([parts[1]!, parts[2]!]);
      }
    } else if (section === 'placement') {
      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        // Format: refDes x y z rotation side
        const refDes = parts[0]!;
        const x = parseFloat(parts[1]!);
        const y = parseFloat(parts[2]!);
        const z = parseFloat(parts[3]!);
        const rot = parseFloat(parts[4]!);
        const sideStr = parts[5]!.toUpperCase();
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        components.push({
          refDes,
          position: [x, y, z || 0],
          size: [10, 10, 5], // default — real IDF has per-component bbox
          rotationDeg: rot,
          side: sideStr === 'BOTTOM' ? 'bottom' : 'top',
        });
      }
    } else if (section === 'holes') {
      const parts = line.split(/\s+/).map(Number);
      if (parts.length >= 3) {
        mountingHoles.push({
          position: [parts[1]!, parts[2]!],
          diameterMm: parts[0]!,
        });
      }
    }
  }

  if (outline.length < 3) return null;
  return { outline, thicknessMm: thickness, mountingHoles, components };
}

/** Compute the PCB's bounding box. */
export function pcbBoundingBox(board: PcbBoard): {
  min: [number, number]; max: [number, number];
} {
  const min: [number, number] = [Infinity, Infinity];
  const max: [number, number] = [-Infinity, -Infinity];
  for (const [x, y] of board.outline) {
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
  }
  return { min, max };
}

/** Maximum component height (mm) above / below the PCB. */
export function maxComponentHeight(board: PcbBoard): { top: number; bottom: number } {
  let top = 0, bottom = 0;
  for (const c of board.components) {
    if (c.side === 'top' && c.size[2] > top) top = c.size[2];
    if (c.side === 'bottom' && c.size[2] > bottom) bottom = c.size[2];
  }
  return { top, bottom };
}

/** Build an enclosure-clearance envelope: a box that contains
 *  the PCB + all components plus a clearance margin. */
export function clearanceEnvelope(
  board: PcbBoard,
  clearanceMm: number = 2,
): { min: [number, number, number]; max: [number, number, number] } {
  const bbox = pcbBoundingBox(board);
  const heights = maxComponentHeight(board);
  return {
    min: [bbox.min[0] - clearanceMm, bbox.min[1] - clearanceMm, -heights.bottom - clearanceMm],
    max: [bbox.max[0] + clearanceMm, bbox.max[1] + clearanceMm, board.thicknessMm + heights.top + clearanceMm],
  };
}
