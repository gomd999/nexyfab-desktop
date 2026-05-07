// ─── DXF ASCII Parser ──────────────────────────────────────────────────────
// Parses the ENTITIES section of DXF ASCII format.
// Supports: LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE, SPLINE (partial).

export interface DXFEntity {
  type: 'LINE' | 'ARC' | 'CIRCLE' | 'POLYLINE' | 'LWPOLYLINE' | 'SPLINE' | 'TEXT';
  points: [number, number][];
  /** Center point for ARC / CIRCLE */
  center?: [number, number];
  /** Radius for ARC / CIRCLE */
  radius?: number;
  /** Start angle in degrees for ARC */
  startAngle?: number;
  /** End angle in degrees for ARC */
  endAngle?: number;
  /** Target layer name (defaults to "0" at write time when unset). */
  layer?: string;
  /** TEXT entity content */
  text?: string;
  /** TEXT entity height in drawing units */
  textHeight?: number;
}

export interface DXFBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DXFParseResult {
  entities: DXFEntity[];
  bounds: DXFBounds;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

interface GroupCode {
  code: number;
  value: string;
}

function tokenize(text: string): GroupCode[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const pairs: GroupCode[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1].trim();
    if (!isNaN(code)) {
      pairs.push({ code, value });
    }
  }
  return pairs;
}

function findSection(pairs: GroupCode[], sectionName: string): { start: number; end: number } | null {
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i].code === 0 && pairs[i].value === 'SECTION' &&
        pairs[i + 1].code === 2 && pairs[i + 1].value === sectionName) {
      const start = i + 2;
      for (let j = start; j < pairs.length; j++) {
        if (pairs[j].code === 0 && pairs[j].value === 'ENDSEC') {
          return { start, end: j };
        }
      }
    }
  }
  return null;
}

// ─── Entity parsers ───────────────────────────────────────────────────────

function parseLINE(pairs: GroupCode[], start: number, end: number): DXFEntity {
  let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  for (let i = start; i < end; i++) {
    const { code, value } = pairs[i];
    switch (code) {
      case 10: x1 = parseFloat(value); break;
      case 20: y1 = parseFloat(value); break;
      case 11: x2 = parseFloat(value); break;
      case 21: y2 = parseFloat(value); break;
    }
  }
  return { type: 'LINE', points: [[x1, y1], [x2, y2]] };
}

function parseARC(pairs: GroupCode[], start: number, end: number): DXFEntity {
  let cx = 0, cy = 0, r = 0, sa = 0, ea = 360;
  for (let i = start; i < end; i++) {
    const { code, value } = pairs[i];
    switch (code) {
      case 10: cx = parseFloat(value); break;
      case 20: cy = parseFloat(value); break;
      case 40: r = parseFloat(value); break;
      case 50: sa = parseFloat(value); break;
      case 51: ea = parseFloat(value); break;
    }
  }
  // Generate polyline approximation of arc for points[]
  const pts = sampleArc(cx, cy, r, sa, ea, 32);
  return { type: 'ARC', points: pts, center: [cx, cy], radius: r, startAngle: sa, endAngle: ea };
}

function parseCIRCLE(pairs: GroupCode[], start: number, end: number): DXFEntity {
  let cx = 0, cy = 0, r = 0;
  for (let i = start; i < end; i++) {
    const { code, value } = pairs[i];
    switch (code) {
      case 10: cx = parseFloat(value); break;
      case 20: cy = parseFloat(value); break;
      case 40: r = parseFloat(value); break;
    }
  }
  const pts = sampleArc(cx, cy, r, 0, 360, 64);
  return { type: 'CIRCLE', points: pts, center: [cx, cy], radius: r };
}

function parseLWPOLYLINE(pairs: GroupCode[], start: number, end: number): DXFEntity {
  const vertices: { x: number; y: number; bulge: number }[] = [];
  let closed = false;
  let curX = 0, curY = 0, curBulge = 0;
  let hasVertex = false;

  for (let i = start; i < end; i++) {
    const { code, value } = pairs[i];
    switch (code) {
      case 70: {
        const flags = parseInt(value, 10);
        if (flags & 1) closed = true;
        break;
      }
      case 10:
        // Flush previous vertex when a new X coordinate arrives
        if (hasVertex) {
          vertices.push({ x: curX, y: curY, bulge: curBulge });
          curBulge = 0;
        }
        curX = parseFloat(value);
        hasVertex = true;
        break;
      case 20:
        curY = parseFloat(value);
        break;
      case 42:
        curBulge = parseFloat(value);
        break;
    }
  }
  // Push last vertex
  if (hasVertex) {
    vertices.push({ x: curX, y: curY, bulge: curBulge });
  }

  // Convert vertices + bulge to points
  const pts: [number, number][] = [];
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    pts.push([v.x, v.y]);

    // If there's a bulge to the next vertex, interpolate an arc segment
    if (Math.abs(v.bulge) > 1e-10) {
      const nextIdx = (i + 1) % vertices.length;
      if (nextIdx === 0 && !closed) continue;
      const next = vertices[nextIdx];
      const arcPts = bulgeToArcPoints(v.x, v.y, next.x, next.y, v.bulge, 16);
      // Skip first and last (they are the endpoints)
      for (let j = 1; j < arcPts.length - 1; j++) {
        pts.push(arcPts[j]);
      }
    }
  }

  // Close the polyline
  if (closed && pts.length > 0) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first[0] - last[0]) > 1e-8 || Math.abs(first[1] - last[1]) > 1e-8) {
      pts.push([first[0], first[1]]);
    }
  }

  return { type: 'LWPOLYLINE', points: pts };
}

function parsePOLYLINE(pairs: GroupCode[], start: number, end: number): DXFEntity {
  // Collect VERTEX sub-entities within the POLYLINE..SEQEND block
  const pts: [number, number][] = [];
  for (let i = start; i < end; i++) {
    if (pairs[i].code === 0 && pairs[i].value === 'VERTEX') {
      let vx = 0, vy = 0;
      for (let j = i + 1; j < end; j++) {
        if (pairs[j].code === 0) break;
        if (pairs[j].code === 10) vx = parseFloat(pairs[j].value);
        if (pairs[j].code === 20) vy = parseFloat(pairs[j].value);
      }
      pts.push([vx, vy]);
    }
  }
  return { type: 'POLYLINE', points: pts };
}

function parseSPLINE(pairs: GroupCode[], start: number, end: number): DXFEntity {
  // Simplified: just collect control points
  const pts: [number, number][] = [];
  let inFitPts = false;
  for (let i = start; i < end; i++) {
    const { code, value } = pairs[i];
    if (code === 11) {
      // Fit point X
      inFitPts = true;
      const x = parseFloat(value);
      // Look ahead for Y
      if (i + 1 < end && pairs[i + 1].code === 21) {
        pts.push([x, parseFloat(pairs[i + 1].value)]);
      }
    } else if (code === 10 && !inFitPts) {
      // Control point X (used if no fit points)
      const x = parseFloat(value);
      if (i + 1 < end && pairs[i + 1].code === 20) {
        pts.push([x, parseFloat(pairs[i + 1].value)]);
      }
    }
  }
  return { type: 'SPLINE', points: pts };
}

// ─── Arc sampling helpers ─────────────────────────────────────────────────

function sampleArc(
  cx: number, cy: number, r: number,
  startDeg: number, endDeg: number, segments: number,
): [number, number][] {
  const sa = (startDeg * Math.PI) / 180;
  let ea = (endDeg * Math.PI) / 180;
  if (ea <= sa) ea += 2 * Math.PI;
  const pts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = sa + (ea - sa) * t;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function bulgeToArcPoints(
  x1: number, y1: number, x2: number, y2: number,
  bulge: number, segments: number,
): [number, number][] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const chord = Math.sqrt(dx * dx + dy * dy);
  if (chord < 1e-12) return [[x1, y1], [x2, y2]];

  const sagitta = Math.abs(bulge) * chord / 2;
  const radius = (chord * chord / 4 + sagitta * sagitta) / (2 * sagitta);

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const nx = -dy / chord;
  const ny = dx / chord;

  const d = radius - sagitta;
  const sign = bulge > 0 ? 1 : -1;
  const cx = mx + sign * d * nx;
  const cy = my + sign * d * ny;

  const startAngle = Math.atan2(y1 - cy, x1 - cx);
  let endAngle = Math.atan2(y2 - cy, x2 - cx);

  if (bulge > 0) {
    if (endAngle <= startAngle) endAngle += 2 * Math.PI;
  } else {
    if (endAngle >= startAngle) endAngle -= 2 * Math.PI;
  }

  const pts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = startAngle + (endAngle - startAngle) * t;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}

// ─── Main parser ──────────────────────────────────────────────────────────

export function parseDXF(text: string): DXFParseResult {
  const pairs = tokenize(text);

  // Find ENTITIES section
  const section = findSection(pairs, 'ENTITIES');
  if (!section) {
    return { entities: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }

  const entities: DXFEntity[] = [];
  const { start, end } = section;

  // Split into entity blocks
  let i = start;
  while (i < end) {
    if (pairs[i].code === 0) {
      const entityType = pairs[i].value;
      // Find the end of this entity (next code 0 or end of section)
      let entityEnd = i + 1;
      while (entityEnd < end && pairs[entityEnd].code !== 0) {
        entityEnd++;
      }

      // For POLYLINE, extend to SEQEND
      if (entityType === 'POLYLINE') {
        while (entityEnd < end) {
          if (pairs[entityEnd].code === 0 && pairs[entityEnd].value === 'SEQEND') {
            entityEnd++;
            break;
          }
          entityEnd++;
        }
      }

      switch (entityType) {
        case 'LINE':
          entities.push(parseLINE(pairs, i + 1, entityEnd));
          break;
        case 'ARC':
          entities.push(parseARC(pairs, i + 1, entityEnd));
          break;
        case 'CIRCLE':
          entities.push(parseCIRCLE(pairs, i + 1, entityEnd));
          break;
        case 'LWPOLYLINE':
          entities.push(parseLWPOLYLINE(pairs, i + 1, entityEnd));
          break;
        case 'POLYLINE':
          entities.push(parsePOLYLINE(pairs, i + 1, entityEnd));
          break;
        case 'SPLINE':
          entities.push(parseSPLINE(pairs, i + 1, entityEnd));
          break;
        // Skip unsupported entity types gracefully
      }
      i = entityEnd;
    } else {
      i++;
    }
  }

  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ent of entities) {
    for (const [x, y] of ent.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (ent.center && ent.radius) {
      const [cx, cy] = ent.center;
      const r = ent.radius;
      if (cx - r < minX) minX = cx - r;
      if (cy - r < minY) minY = cy - r;
      if (cx + r > maxX) maxX = cx + r;
      if (cy + r > maxY) maxY = cy + r;
    }
  }

  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

  return { entities, bounds: { minX, minY, maxX, maxY } };
}
