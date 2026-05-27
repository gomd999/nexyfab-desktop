/**
 * parametricChassis.ts — Parametric chassis / frame library.
 *
 * For furniture, e-bike frames, AGV chassis, and tube-frame
 * structures generally — generate the centerline of a frame from a
 * style + dimensions. Three families:
 *
 *   - **Ladder frame**: two long rails + N cross-members. Truck-like.
 *   - **Tube frame**: bent tube around a perimeter loop with optional
 *     diagonal bracing. Bicycle / motorcycle / kart style.
 *   - **Monocoque**: closed-form panel chassis where the shell IS the
 *     frame. Output is the bounding polygon for the panel.
 *
 * Each style accepts size parameters (length, width, height) plus
 * style-specific knobs (cross-member count, bracing pattern, tube
 * diameter). Output is a wireframe centerline that downstream sweep
 * features turn into solid tubing.
 */

export type Vec3 = [number, number, number];

export interface FrameNode {
  id: string;
  position: Vec3;
}

export interface FrameMember {
  id: string;
  startNodeId: string;
  endNodeId: string;
  /** Tube outer diameter (mm). */
  diameterMm: number;
  /** Wall thickness (mm). */
  wallThicknessMm: number;
  /** Role label ("main-rail", "cross-member", "diagonal", "joint-tab"). */
  role: string;
}

export interface FrameDefinition {
  nodes: FrameNode[];
  members: FrameMember[];
  bbox: { min: Vec3; max: Vec3 };
}

// ── Ladder frame ───────────────────────────────────────────────

export interface LadderFrameParams {
  kind: 'ladder';
  lengthMm: number;
  widthMm: number;
  crossMemberCount: number;
  railDiameterMm: number;
  crossMemberDiameterMm: number;
  wallThicknessMm: number;
}

export function generateLadderFrame(p: LadderFrameParams): FrameDefinition {
  const nodes: FrameNode[] = [];
  const members: FrameMember[] = [];
  // Two rails at y = ±width/2, x ∈ [0, length].
  for (let i = 0; i <= p.crossMemberCount; i++) {
    const x = (i / p.crossMemberCount) * p.lengthMm;
    nodes.push({ id: `LR${i}`, position: [x, -p.widthMm / 2, 0] });
    nodes.push({ id: `RR${i}`, position: [x, p.widthMm / 2, 0] });
  }
  for (let i = 0; i < p.crossMemberCount; i++) {
    members.push({
      id: `rail-L${i}`, startNodeId: `LR${i}`, endNodeId: `LR${i + 1}`,
      diameterMm: p.railDiameterMm, wallThicknessMm: p.wallThicknessMm, role: 'main-rail',
    });
    members.push({
      id: `rail-R${i}`, startNodeId: `RR${i}`, endNodeId: `RR${i + 1}`,
      diameterMm: p.railDiameterMm, wallThicknessMm: p.wallThicknessMm, role: 'main-rail',
    });
  }
  for (let i = 0; i <= p.crossMemberCount; i++) {
    members.push({
      id: `cross${i}`, startNodeId: `LR${i}`, endNodeId: `RR${i}`,
      diameterMm: p.crossMemberDiameterMm, wallThicknessMm: p.wallThicknessMm, role: 'cross-member',
    });
  }
  return {
    nodes,
    members,
    bbox: { min: [0, -p.widthMm / 2, 0], max: [p.lengthMm, p.widthMm / 2, 0] },
  };
}

// ── Tube frame (loop + optional bracing) ───────────────────────

export interface TubeFrameParams {
  kind: 'tube';
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  /** Bracing pattern. */
  bracing: 'none' | 'x-brace' | 'k-brace';
  tubeDiameterMm: number;
  wallThicknessMm: number;
}

export function generateTubeFrame(p: TubeFrameParams): FrameDefinition {
  // 8 corners of a box.
  const corners: FrameNode[] = [
    { id: 'A', position: [0, 0, 0] },
    { id: 'B', position: [p.lengthMm, 0, 0] },
    { id: 'C', position: [p.lengthMm, p.widthMm, 0] },
    { id: 'D', position: [0, p.widthMm, 0] },
    { id: 'E', position: [0, 0, p.heightMm] },
    { id: 'F', position: [p.lengthMm, 0, p.heightMm] },
    { id: 'G', position: [p.lengthMm, p.widthMm, p.heightMm] },
    { id: 'H', position: [0, p.widthMm, p.heightMm] },
  ];
  const members: FrameMember[] = [];
  const addMember = (id: string, from: string, to: string, role: string): void => {
    members.push({
      id, startNodeId: from, endNodeId: to,
      diameterMm: p.tubeDiameterMm, wallThicknessMm: p.wallThicknessMm, role,
    });
  };
  // 12 box edges.
  const boxEdges: Array<[string, string]> = [
    ['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A'],
    ['E', 'F'], ['F', 'G'], ['G', 'H'], ['H', 'E'],
    ['A', 'E'], ['B', 'F'], ['C', 'G'], ['D', 'H'],
  ];
  for (let i = 0; i < boxEdges.length; i++) {
    addMember(`edge${i}`, boxEdges[i]![0], boxEdges[i]![1], 'main-tube');
  }
  if (p.bracing === 'x-brace') {
    // Diagonal each face.
    addMember('xb-front', 'A', 'F', 'diagonal');
    addMember('xb-back', 'D', 'G', 'diagonal');
    addMember('xb-top', 'E', 'G', 'diagonal');
  } else if (p.bracing === 'k-brace') {
    addMember('kb-1', 'A', 'F', 'diagonal');
    addMember('kb-2', 'B', 'E', 'diagonal');
  }
  return {
    nodes: corners,
    members,
    bbox: { min: [0, 0, 0], max: [p.lengthMm, p.widthMm, p.heightMm] },
  };
}

// ── Monocoque (closed-form panel) ──────────────────────────────

export interface MonocoqueParams {
  kind: 'monocoque';
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  /** Panel thickness (mm) — informational; geometry is the outline. */
  panelThicknessMm: number;
  /** Optional internal stiffener count. */
  stiffenerCount: number;
}

export function generateMonocoqueFrame(p: MonocoqueParams): FrameDefinition {
  // Output the outline as a frame of edges.
  const nodes: FrameNode[] = [
    { id: 'A', position: [0, 0, 0] },
    { id: 'B', position: [p.lengthMm, 0, 0] },
    { id: 'C', position: [p.lengthMm, p.widthMm, 0] },
    { id: 'D', position: [0, p.widthMm, 0] },
  ];
  const members: FrameMember[] = [
    { id: 'AB', startNodeId: 'A', endNodeId: 'B', diameterMm: 0, wallThicknessMm: p.panelThicknessMm, role: 'panel-edge' },
    { id: 'BC', startNodeId: 'B', endNodeId: 'C', diameterMm: 0, wallThicknessMm: p.panelThicknessMm, role: 'panel-edge' },
    { id: 'CD', startNodeId: 'C', endNodeId: 'D', diameterMm: 0, wallThicknessMm: p.panelThicknessMm, role: 'panel-edge' },
    { id: 'DA', startNodeId: 'D', endNodeId: 'A', diameterMm: 0, wallThicknessMm: p.panelThicknessMm, role: 'panel-edge' },
  ];
  // Internal stiffeners.
  for (let i = 1; i <= p.stiffenerCount; i++) {
    const x = (i / (p.stiffenerCount + 1)) * p.lengthMm;
    nodes.push({ id: `S${i}A`, position: [x, 0, 0] });
    nodes.push({ id: `S${i}B`, position: [x, p.widthMm, 0] });
    members.push({
      id: `stiffener${i}`, startNodeId: `S${i}A`, endNodeId: `S${i}B`,
      diameterMm: 20, wallThicknessMm: p.panelThicknessMm, role: 'stiffener',
    });
  }
  return {
    nodes,
    members,
    bbox: { min: [0, 0, 0], max: [p.lengthMm, p.widthMm, p.heightMm] },
  };
}

// ── Top-level dispatcher ──────────────────────────────────────

export type FrameParams = LadderFrameParams | TubeFrameParams | MonocoqueParams;

export function generateFrame(params: FrameParams): FrameDefinition {
  switch (params.kind) {
    case 'ladder': return generateLadderFrame(params);
    case 'tube': return generateTubeFrame(params);
    case 'monocoque': return generateMonocoqueFrame(params);
  }
}

// ── Statistics ─────────────────────────────────────────────────

export interface FrameStats {
  nodeCount: number;
  memberCount: number;
  totalLengthMm: number;
  /** Tube material mass at given density (kg). */
  estimatedMassKg: number;
  /** Members grouped by role. */
  membersByRole: Record<string, number>;
}

export function computeFrameStats(frame: FrameDefinition, materialDensityKgPerM3: number = 7850): FrameStats {
  let totalLength = 0;
  let totalVolume = 0;
  const byRole: Record<string, number> = {};
  const nodeMap = new Map(frame.nodes.map(n => [n.id, n]));
  for (const m of frame.members) {
    const a = nodeMap.get(m.startNodeId);
    const b = nodeMap.get(m.endNodeId);
    if (!a || !b) continue;
    const len = Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1], b.position[2] - a.position[2]);
    totalLength += len;
    // Cross-section area = π × (D² − (D − 2t)²)/4.
    const outer = m.diameterMm;
    const inner = Math.max(0, outer - 2 * m.wallThicknessMm);
    const csArea = Math.PI * (outer * outer - inner * inner) / 4;
    totalVolume += csArea * len;
    byRole[m.role] = (byRole[m.role] ?? 0) + 1;
  }
  // mm³ → m³.
  const volumeM3 = totalVolume * 1e-9;
  return {
    nodeCount: frame.nodes.length,
    memberCount: frame.members.length,
    totalLengthMm: totalLength,
    estimatedMassKg: volumeM3 * materialDensityKgPerM3,
    membersByRole: byRole,
  };
}

// ── Presets ───────────────────────────────────────────────────

export const CHASSIS_PRESETS: Record<string, FrameParams> = {
  small_table_ladder: {
    kind: 'ladder', lengthMm: 1200, widthMm: 800, crossMemberCount: 3,
    railDiameterMm: 25, crossMemberDiameterMm: 20, wallThicknessMm: 2,
  },
  e_bike_tube: {
    kind: 'tube', lengthMm: 1100, widthMm: 60, heightMm: 600,
    bracing: 'x-brace', tubeDiameterMm: 30, wallThicknessMm: 2,
  },
  drone_monocoque: {
    kind: 'monocoque', lengthMm: 400, widthMm: 400, heightMm: 80,
    panelThicknessMm: 3, stiffenerCount: 2,
  },
};
