/**
 * Ω3 — Design pattern library + retrieval (RAG-lite for design seeds).
 *
 * "Have you seen something like this before?" — a real ML embedding
 * search over the user's + community's prior designs would be ideal,
 * but requires vector DB infrastructure. This module ships a curated
 * pattern library with tag-based retrieval as the V1 — the agent uses
 * matched patterns as design seeds (start from a known-good shape +
 * adapt) rather than generating from scratch.
 *
 * V2 swap: replace `findPatterns` with an embedding similarity query.
 * The `DesignPattern` shape stays the same, so the agent's tool
 * surface doesn't change.
 */

export interface DesignPattern {
  id: string;
  /** Short human title. */
  title: string;
  /** One-line description. */
  description: string;
  /** Search tags — matched against the user's free-text query. */
  tags: string[];
  /** Recommended starter prompt the agent can extend. */
  seedPrompt: string;
  /** Estimated complexity 0-5 (0 = primitive, 5 = full assembly). */
  complexity: number;
  /** Citation — book / standard / project where this pattern is documented. */
  source: string;
}

const PATTERNS: DesignPattern[] = [
  // ─── Mounts / brackets ────────────────────────────────────────────────
  {
    id: 'mount_nema17',
    title: 'NEMA17 stepper mount',
    description: 'L-bracket with 4×M3 mounting holes in 31mm square pattern + 22mm center bore.',
    tags: ['mount', 'bracket', 'nema17', 'stepper', 'motor', '3d-printed', 'aluminum'],
    seedPrompt: 'L-bracket NEMA17 mount: 60×60×8mm plate, 4×M3 corner holes in 31mm square pattern, 22mm center bore. Add 6mm corner fillet.',
    complexity: 2,
    source: 'NEMA ICS 16-2001',
  },
  {
    id: 'mount_t_slot',
    title: 'T-slot extrusion bracket',
    description: 'Right-angle bracket for 2020/3030/4040 aluminum extrusion. Includes M5 access slot.',
    tags: ['bracket', 't-slot', 'extrusion', '2020', 'aluminum', 'frame'],
    seedPrompt: 'Right-angle bracket for 20×20mm aluminum extrusion. M5 hole on each face, 30mm leg length, 4mm thick.',
    complexity: 2,
    source: 'Misumi extrusion catalog',
  },

  // ─── Enclosures ────────────────────────────────────────────────────────
  {
    id: 'enclosure_pcb',
    title: 'PCB enclosure (snap-fit lid)',
    description: 'Two-piece box with snap-fit lid + 4 PCB standoffs. Designed for FDM 3D print.',
    tags: ['enclosure', 'box', 'pcb', 'snap-fit', 'electronics', '3d-printed'],
    seedPrompt: 'PCB enclosure: 100×80×30mm box with 2mm walls, 4 internal M3 standoffs at corners, snap-fit lid. Print in PETG.',
    complexity: 3,
    source: '3D Printer\'s Apprentice',
  },
  {
    id: 'enclosure_die_cast',
    title: 'Die-cast aluminum enclosure',
    description: 'Drafted walls (2°) + corner bosses + IP65 sealing groove for an O-ring lid.',
    tags: ['enclosure', 'die-cast', 'aluminum', 'ip65', 'industrial', 'sealed'],
    seedPrompt: 'Die-cast aluminum enclosure: 150×100×50mm internal volume, 4mm walls with 2° draft, sealing groove for AS568-251 O-ring on lid. Add 4 corner M5 bosses.',
    complexity: 4,
    source: 'Hammond Manufacturing 1590 series',
  },

  // ─── Mechanical / motion ───────────────────────────────────────────────
  {
    id: 'gear_reducer_2stage',
    title: '2-stage spur gear reducer',
    description: 'Module 2 gears: 16:48 + 16:48 = 9:1 reduction. Includes shaft + bearing housings.',
    tags: ['gear', 'reducer', 'gearbox', 'spur', 'motion', 'transmission'],
    seedPrompt: '2-stage spur gear reducer with 9:1 ratio. Stage 1: 16T pinion → 48T. Stage 2: same. Module 2, 8mm thick gears, 8mm shafts in DIN 625-608 bearings.',
    complexity: 5,
    source: 'Shigley Ch.13 (gears) + Ch.11 (bearings)',
  },
  {
    id: 'shaft_keyed',
    title: 'Keyed shaft with retainer',
    description: 'Ø20 shaft with DIN 6885 6×6 keyway + DIN 471 external retaining ring groove.',
    tags: ['shaft', 'key', 'keyway', 'retaining-ring', 'motion'],
    seedPrompt: 'Ø20 keyed shaft, 100mm long, with 6×6×30mm DIN 6885 keyway centered, DIN 471 retaining ring groove 20mm from one end.',
    complexity: 3,
    source: 'DIN 6885 + DIN 471',
  },

  // ─── Sheet metal ───────────────────────────────────────────────────────
  {
    id: 'sheet_l_bracket',
    title: 'Sheet metal L-bracket',
    description: '1.5mm steel L-bracket with 4 mounting slots + 1 cable pass-through.',
    tags: ['sheet-metal', 'bracket', 'steel', 'bend', 'l-bracket'],
    seedPrompt: '1.5mm steel L-bracket: 50×50mm legs, 50mm wide, 90° bend. 4×M5 slotted holes, 25mm cable pass-through with rolled edge.',
    complexity: 2,
    source: 'Pro/E Sheetmetal Design (Toogood)',
  },
  {
    id: 'sheet_chassis',
    title: 'Bent sheet chassis',
    description: 'U-channel chassis with 4 mounting tabs, 1.0mm aluminum, all bends 90°.',
    tags: ['sheet-metal', 'chassis', 'aluminum', 'electronics', 'enclosure'],
    seedPrompt: 'U-channel chassis from 1.0mm aluminum: 200×100mm base, 30mm side walls (90° bends), 4 mounting tabs with M3 holes.',
    complexity: 3,
    source: 'sheet-metal first principles',
  },

  // ─── Pipes / fluid ─────────────────────────────────────────────────────
  {
    id: 'pipe_t_joint',
    title: 'T-pipe joint (threaded)',
    description: 'T-junction with G1/2 BSP threads on all 3 ports.',
    tags: ['pipe', 't-joint', 'fluid', 'threaded', 'bsp'],
    seedPrompt: 'T-pipe joint with G1/2 BSP threaded ports on all 3 sides. 25mm OD trunk, 16mm ID through-bore.',
    complexity: 3,
    source: 'ISO 228-1 (G threads)',
  },

  // ─── Heatsink / thermal ────────────────────────────────────────────────
  {
    id: 'heatsink_finned',
    title: 'Finned aluminum heatsink',
    description: 'Standard parallel-fin heatsink for 20W TO-220 device, natural convection.',
    tags: ['heatsink', 'thermal', 'cooling', 'aluminum', 'fins'],
    seedPrompt: 'Aluminum heatsink for TO-220 20W device, natural convection: 50×30mm base, 8 fins 2mm thick × 25mm tall, 4mm pitch. Include M3 mounting holes.',
    complexity: 3,
    source: 'Aavid heatsink design guide',
  },

  // ─── Fasteners / hardware ──────────────────────────────────────────────
  {
    id: 'standoff_threaded',
    title: 'M3 threaded standoff',
    description: 'Hex M3 standoff, 10mm length, both ends female-threaded.',
    tags: ['standoff', 'fastener', 'm3', 'hex', 'pcb'],
    seedPrompt: 'M3 hex threaded standoff, 10mm length, both ends female M3, hex 5mm AF.',
    complexity: 1,
    source: 'common Keystone catalog',
  },

  // ─── A2 — Round 2 patterns (18 more) ──────────────────────────────────

  // ── Bearings / housings ──
  {
    id: 'bearing_pillow_block',
    title: 'Pillow block bearing housing',
    description: 'Cast pillow block for 6204 bearing, 2 mounting holes M10, integral grease nipple.',
    tags: ['bearing', 'pillow-block', 'housing', '6204', 'shaft'],
    seedPrompt: 'Pillow block housing for DIN 625-6204 bearing (Ø47 OD, 14 wide). Base 80×40, 2×M10 slotted holes 60mm apart. Integral M6 grease nipple boss on top.',
    complexity: 4,
    source: 'SKF SY series catalog',
  },
  {
    id: 'bearing_flange',
    title: 'Flanged bearing block (4-bolt)',
    description: '4-bolt flanged housing for 6205, square footprint.',
    tags: ['bearing', 'flange', 'housing', '6205'],
    seedPrompt: 'Flanged bearing block for 6205 (Ø52 OD). Square 90×90mm flange, 4×M8 bolts in 70mm square pattern. Bore steps for OD + retaining shoulder.',
    complexity: 3,
    source: 'NSK FY series',
  },

  // ── Couplings / power transmission ──
  {
    id: 'rigid_coupling',
    title: 'Rigid shaft coupling',
    description: 'Two-piece clamping coupling for 12mm shaft, 4 M3 socket caps.',
    tags: ['coupling', 'shaft', 'rigid', 'clamp'],
    seedPrompt: 'Rigid clamping coupling for two Ø12mm shafts. Length 30mm, OD 25mm. 4×M3 socket cap clamping screws (2 each side). Slot through center for clamp action.',
    complexity: 3,
    source: 'Lovejoy / Ruland general catalog',
  },
  {
    id: 'oldham_coupling',
    title: 'Oldham coupling (3-piece)',
    description: 'Misalignment-tolerant coupling: 2 hubs + plastic disc.',
    tags: ['coupling', 'oldham', 'misalignment', 'plastic'],
    seedPrompt: 'Oldham coupling for 8mm to 10mm shaft. Two aluminum hubs OD 25mm with cross-slots. POM plastic center disc with matching tongues. Clamp screws on each hub.',
    complexity: 4,
    source: 'Boston Gear catalog',
  },
  {
    id: 'belt_pulley_timing',
    title: 'GT2 timing belt pulley',
    description: '20T GT2 pulley for 6mm wide belt + 5mm bore.',
    tags: ['pulley', 'belt', 'gt2', 'timing', 'motion'],
    seedPrompt: 'GT2 timing pulley, 20 teeth, 6mm belt width, 5mm bore with M3 set screw. OD 12.7mm, total height 16mm with flanges.',
    complexity: 3,
    source: 'Gates GT2 spec',
  },
  {
    id: 'sprocket_chain_38',
    title: 'Sprocket for #35 chain',
    description: '#35 ANSI chain sprocket, 16T, with hub.',
    tags: ['sprocket', 'chain', 'ansi', 'transmission'],
    seedPrompt: 'ANSI #35 chain sprocket, 16 teeth, 12mm bore, with 25mm-long hub. Pitch 9.525mm, roller 5.08mm. 1 keyway DIN 6885 4×4.',
    complexity: 4,
    source: 'ANSI B29.1',
  },
  {
    id: 'worm_gear_pair',
    title: 'Worm gear + worm wheel pair',
    description: '20:1 ratio worm + bronze wheel, module 1.5.',
    tags: ['gear', 'worm', 'reduction', 'bronze'],
    seedPrompt: 'Worm gear pair, 20:1 ratio, module 1.5. Steel worm Ø22 single-start. Bronze worm wheel 40T, OD 65mm, hub 30mm wide. Center distance 35mm.',
    complexity: 5,
    source: 'Shigley Ch.13.10',
  },

  // ── Linear motion ──
  {
    id: 'lm_rail_block',
    title: 'LM linear rail mounting block',
    description: 'Block for HGH15 rail, 4-bolt mount + dust seals.',
    tags: ['linear', 'rail', 'lm', 'cnc', 'motion'],
    seedPrompt: 'LM block for Hiwin HGH15 rail (15mm wide). Steel block 45×40×24mm, 4×M4 bolt holes top, integrated rubber dust seals on ends. Recirculating ball pattern.',
    complexity: 5,
    source: 'Hiwin HGH series catalog',
  },
  {
    id: 'ball_screw_nut',
    title: 'Ball screw nut housing',
    description: 'Cylindrical nut for SFU1605 ball screw, 4-bolt flange.',
    tags: ['ball-screw', 'sfu', 'cnc', 'motion'],
    seedPrompt: 'Ball screw nut for SFU1605 (16mm Ø, 5mm lead). Cylindrical body Ø28×42mm + Ø42 flange × 8 thick with 4×Ø6.5 bolt holes in 36mm circle.',
    complexity: 4,
    source: 'TBI Motion SFU catalog',
  },

  // ── Hinges / latches ──
  {
    id: 'butt_hinge',
    title: 'Butt hinge (decorative)',
    description: 'Two-leaf butt hinge with knuckle, brass + steel pin.',
    tags: ['hinge', 'butt', 'door', 'decorative'],
    seedPrompt: 'Butt hinge: two 50×30mm brass leaves with 5-knuckle Ø6mm steel pin. 6 countersunk M4 holes (3 per leaf). Total leaf thickness 2mm.',
    complexity: 3,
    source: 'classic decorative hinge geometry',
  },
  {
    id: 'concealed_cabinet_hinge',
    title: 'Concealed cabinet hinge (110°)',
    description: 'European-style 35mm cup hinge, soft-close ready.',
    tags: ['hinge', 'concealed', 'cabinet', '35mm', 'european'],
    seedPrompt: 'Concealed cabinet hinge: 35mm boring cup + arm + base plate. 110° opening. Cup depth 11.5mm, arm length 95mm. M5 soft-close damper mount on arm.',
    complexity: 5,
    source: 'Blino / Hettich Sensys series',
  },
  {
    id: 'toggle_latch_quick_release',
    title: 'Toggle latch (quick-release)',
    description: 'Over-center toggle latch, 200N hold force.',
    tags: ['latch', 'toggle', 'quick-release', 'enclosure'],
    seedPrompt: 'Over-center toggle latch: hooked draw rod + lever arm + pivot pin. Mounting plate 60×30mm with 2×M4 holes. Hold force 200N min. Stainless steel.',
    complexity: 4,
    source: 'Southco / Sugatsune toggle latch series',
  },

  // ── Cable / wire management ──
  {
    id: 'cable_gland_strain_relief',
    title: 'Cable gland with strain relief',
    description: 'M16 cable gland for Ø6-10mm cable, IP68.',
    tags: ['cable', 'gland', 'strain-relief', 'ip68', 'enclosure'],
    seedPrompt: 'Cable gland: M16×1.5 thread, accepts Ø6-10mm cable. Body 25mm long, hex 22 AF. Internal sealing washer + claw insert for strain relief. IP68.',
    complexity: 3,
    source: 'Hummel / Lapp Skintop catalog',
  },
  {
    id: 'drag_chain_link',
    title: 'Cable drag chain link (single)',
    description: 'Snap-together cable carrier link, 25×25mm inner.',
    tags: ['cable', 'drag-chain', 'carrier', 'motion'],
    seedPrompt: 'Single drag chain link: 25×25mm inner cable channel, 35mm pitch. Snap-fit top cover. Side links with male+female pivot pins (8mm pivot diameter, 90° max bend).',
    complexity: 4,
    source: 'Igus E-Chain series',
  },

  // ── Sealing / fluid ──
  {
    id: 'oring_face_seal_groove',
    title: 'O-ring face seal gland',
    description: 'AS568-251 O-ring face seal, dovetail groove.',
    tags: ['o-ring', 'seal', 'gland', 'dovetail'],
    seedPrompt: 'Face seal flange for AS568-251 O-ring (Ø117.07×3.53). Dovetail groove (8° angle, 4.6mm wide × 2.65mm deep). Outer flange Ø140 with 8×M8 bolts on Ø125 BCD.',
    complexity: 4,
    source: 'Parker O-ring Handbook §4 face seal',
  },
  {
    id: 'fluid_manifold_block',
    title: 'Hydraulic manifold block',
    description: '4-port aluminum manifold with cross-drilled passages.',
    tags: ['manifold', 'hydraulic', 'fluid', 'aluminum'],
    seedPrompt: 'Aluminum 6061 manifold block 80×60×40mm. 4 G1/4 BSP threaded ports (1 inlet, 3 outlets). Cross-drilled internal passages Ø6mm. 4 corner M6 mounting holes.',
    complexity: 5,
    source: 'Parker manifold design guide',
  },

  // ── Misc utility ──
  {
    id: 'magnet_holder_neodymium',
    title: 'Neodymium magnet holder',
    description: 'Pot magnet housing for Ø20×5mm N42 disc, M5 stud.',
    tags: ['magnet', 'neodymium', 'holder', 'utility'],
    seedPrompt: 'Pot magnet housing: steel cup Ø22 OD × 8mm tall holding a Ø20×5mm N42 magnet. Bottom face has integral M5 male stud (15mm protrusion). Hold force ~10kg.',
    complexity: 3,
    source: 'Eclipse / K&J Magnetics pot magnet catalog',
  },
  {
    id: 'spline_shaft_din5480',
    title: 'Splined shaft (DIN 5480)',
    description: 'Involute spline shaft, 6×26×30 (Z=12), torque transmission.',
    tags: ['spline', 'shaft', 'din5480', 'torque'],
    seedPrompt: 'Involute splined shaft per DIN 5480: 6×26×30 (module 2, 12 teeth, 30° pressure angle). Outer Ø30, root Ø22. Length 80mm with 10mm runout to bearing journal at each end.',
    complexity: 5,
    source: 'DIN 5480-1:2006',
  },
];

export function listPatterns(): DesignPattern[] {
  return PATTERNS;
}

/**
 * Tag + keyword retrieval. Returns the top-k patterns ranked by:
 *   tagMatchScore × 2  +  bodyKeywordHits
 * — tags weight more than free-text body matches because they're
 *  curated.
 */
export function findPatterns(query: string, k = 3): DesignPattern[] {
  if (!query.trim()) return PATTERNS.slice(0, k);

  const queryTokens = query
    .toLowerCase()
    .split(/[\s,;.!?\-_/]+/)
    .filter(t => t.length >= 2);

  const scored = PATTERNS.map(p => {
    const tagSet = new Set(p.tags.map(t => t.toLowerCase()));
    const tagHits = queryTokens.reduce((s, tok) => s + (tagSet.has(tok) ? 1 : 0), 0);
    const corpus = (p.title + ' ' + p.description + ' ' + p.seedPrompt).toLowerCase();
    const bodyHits = queryTokens.reduce((s, tok) => s + (corpus.includes(tok) ? 1 : 0), 0);
    return { pattern: p, score: tagHits * 2 + bodyHits };
  });

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(x => x.pattern);
}
