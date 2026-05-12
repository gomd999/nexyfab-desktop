/**
 * Static BOSL2 reference index for the agent's `search_bosl2` tool.
 *
 * Why a static index instead of fetching docs at runtime:
 *   - BOSL2's GitHub docs are stable; a snapshot is safe.
 *   - Network calls inside an agent loop add latency + a failure mode.
 *   - 50 entries is enough for the common cases the model needs.
 *
 * Coverage: the BOSL2 modules used in NexyFab's SCAD catalog
 * (`gear`, `threadedRod`, `roundedBox`, `screw`, plus generic helpers).
 *
 * Update path: when BOSL2 ships new modules NexyFab adopts, append rows
 * here. The model never sees BOSL2 anyway except through this index.
 */

export interface Bosl2Entry {
  name: string;
  /** One-line description. */
  summary: string;
  /** Function/module signature with named params. */
  signature: string;
  /** Search keywords beyond the name. */
  keywords: string[];
}

const ENTRIES: Bosl2Entry[] = [
  // ─── Gears ──────────────────────────────────────────────────────────────
  {
    name: 'spur_gear',
    summary: 'Involute spur gear with configurable teeth, module, pressure angle.',
    signature: 'spur_gear(teeth, mod=2, thickness=8, pressure_angle=20, helical=0, shaft_diam=0)',
    keywords: ['gear', 'spur', 'tooth', 'cog', 'transmission'],
  },
  {
    name: 'bevel_gear',
    summary: 'Bevel gear for right-angle drives.',
    signature: 'bevel_gear(teeth, mod, face_width, pitch_angle, ...)',
    keywords: ['gear', 'bevel', 'angle'],
  },
  {
    name: 'rack',
    summary: 'Linear rack to mate with a spur gear.',
    signature: 'rack(pitch, teeth, height, thickness)',
    keywords: ['gear', 'rack', 'linear'],
  },
  // ─── Threads / fasteners ────────────────────────────────────────────────
  {
    name: 'threaded_rod',
    summary: 'External ISO/UTS threaded rod.',
    signature: 'threaded_rod(d, l, pitch, internal=false)',
    keywords: ['thread', 'screw', 'rod', 'bolt', 'M6', 'M8', 'M10'],
  },
  {
    name: 'threaded_nut',
    summary: 'Hex nut with internal thread to match a threaded_rod.',
    signature: 'threaded_nut(od, id, h, pitch)',
    keywords: ['thread', 'nut', 'hex', 'fastener'],
  },
  {
    name: 'screw',
    summary: 'Standard ISO screw with configurable head + length.',
    signature: 'screw("M6x1,20", head="socket", drive="hex")',
    keywords: ['screw', 'bolt', 'fastener', 'socket', 'phillips', 'cap'],
  },
  {
    name: 'screw_hole',
    summary: 'Clearance / tap hole sized for a given screw spec.',
    signature: 'screw_hole("M6x1", l=20, anchor=BOTTOM)',
    keywords: ['hole', 'screw', 'clearance', 'tap'],
  },
  // ─── Geometry / shapes ─────────────────────────────────────────────────
  {
    name: 'cuboid',
    summary: 'Cube/box with optional rounded edges, chamfers, and anchoring.',
    signature: 'cuboid(size, rounding=0, chamfer=0, anchor=CENTER)',
    keywords: ['box', 'cube', 'rounded', 'chamfer'],
  },
  {
    name: 'rounded_prism',
    summary: 'Box with independent edge fillets per face.',
    signature: 'rounded_prism(size, joint_top, joint_bot, joint_sides)',
    keywords: ['box', 'prism', 'rounded', 'fillet'],
  },
  {
    name: 'sphere',
    summary: 'BOSL2 sphere with anchoring + circumscribe options.',
    signature: 'sphere(r=, d=, circum=false)',
    keywords: ['sphere', 'ball'],
  },
  {
    name: 'cylinder',
    summary: 'BOSL2 cylinder with rounding/chamfer + anchor support.',
    signature: 'cyl(h, r=, d=, rounding=0, chamfer=0, anchor=CENTER)',
    keywords: ['cylinder', 'tube', 'pipe', 'rod'],
  },
  {
    name: 'tube',
    summary: 'Hollow cylinder by inner+outer diameters.',
    signature: 'tube(h, od=, id=, ot=, it=)',
    keywords: ['tube', 'pipe', 'hollow', 'pipe'],
  },
  {
    name: 'cone',
    summary: 'Truncated cone with anchor support.',
    signature: 'cone(h, r1, r2)',
    keywords: ['cone', 'frustum', 'taper'],
  },
  {
    name: 'torus',
    summary: 'Torus with major/minor radii.',
    signature: 'torus(or, ir, anchor=CENTER)',
    keywords: ['torus', 'donut', 'ring'],
  },
  // ─── Sweeps / lofts ────────────────────────────────────────────────────
  {
    name: 'sweep',
    summary: 'Sweep a 2D shape along a 3D path.',
    signature: 'sweep(path, shape)',
    keywords: ['sweep', 'extrude', 'path'],
  },
  {
    name: 'skin',
    summary: 'Loft (skin) between multiple cross-sections.',
    signature: 'skin(profiles, slices=10, refine=1)',
    keywords: ['loft', 'skin', 'profile', 'transition'],
  },
  {
    name: 'helix',
    summary: 'Helical path generator.',
    signature: 'helix(h, r, turns, ...)',
    keywords: ['helix', 'spring', 'spiral', 'coil'],
  },
  // ─── Operations ────────────────────────────────────────────────────────
  {
    name: 'minkowski_difference',
    summary: 'Minkowski difference for offsetting / shrinking shapes.',
    signature: 'minkowski_difference() { ... }',
    keywords: ['offset', 'shrink', 'minkowski', 'erode'],
  },
  {
    name: 'fillet',
    summary: 'Radial fillet on selected edges.',
    signature: 'edge_fillet(r, edges)',
    keywords: ['fillet', 'round', 'edge', 'corner'],
  },
  {
    name: 'chamfer',
    summary: 'Edge chamfer.',
    signature: 'edge_chamfer(c, edges)',
    keywords: ['chamfer', 'bevel', 'edge'],
  },
  {
    name: 'shell',
    summary: 'Hollow a solid by offsetting inward.',
    signature: 'shell(thickness)',
    keywords: ['shell', 'hollow', 'wall', 'cavity'],
  },
  // ─── Patterns ──────────────────────────────────────────────────────────
  {
    name: 'xcopies',
    summary: 'Pattern children along the X axis (linear).',
    signature: 'xcopies(spacing=, n=, sp=)',
    keywords: ['pattern', 'copy', 'array', 'linear', 'distribute'],
  },
  {
    name: 'rot_copies',
    summary: 'Pattern children rotated around an axis (circular).',
    signature: 'rot_copies(rots, n=)',
    keywords: ['pattern', 'circular', 'array', 'rotate', 'polar'],
  },
  {
    name: 'mirror_copy',
    summary: 'Mirror children across a plane and keep both copies.',
    signature: 'mirror_copy(v=[1,0,0])',
    keywords: ['mirror', 'reflect', 'symmetry'],
  },
  // ─── Anchors / attach ──────────────────────────────────────────────────
  {
    name: 'attachable',
    summary: 'Make a custom module support attach() / position().',
    signature: 'attachable(anchor, spin, orient, size=) { ... children() }',
    keywords: ['anchor', 'attach', 'position'],
  },
  {
    name: 'attach',
    summary: 'Attach a child to a named anchor on the parent.',
    signature: 'attach("top", "bottom") { ... }',
    keywords: ['attach', 'anchor', 'position'],
  },
];

function score(entry: Bosl2Entry, query: string): number {
  const q = query.toLowerCase();
  if (entry.name.toLowerCase() === q) return 100;
  if (entry.name.toLowerCase().includes(q)) return 80;
  for (const k of entry.keywords) {
    if (k.toLowerCase() === q) return 70;
    if (k.toLowerCase().includes(q)) return 50;
  }
  if (entry.summary.toLowerCase().includes(q)) return 30;
  return 0;
}

export function searchBosl2(query: string, limit = 5): Bosl2Entry[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const ranked = ENTRIES
    .map(e => {
      let s = 0;
      for (const t of tokens) s += score(e, t);
      return { e, s };
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => x.e);
  return ranked;
}

export function bosl2EntryCount(): number {
  return ENTRIES.length;
}
