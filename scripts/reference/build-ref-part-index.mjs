/**
 * build-ref-part-index.mjs — OFFLINE one-off distiller.
 *
 * Reads the local IR corpus (참고파일들/result/ir/**\/*.ir.json, ~1071 files) and
 * distills each part into DERIVED structural/numeric metadata only, writing
 * src/lib/ai/reference/refPartIndex.json (committed; ~200-300 KB).
 *
 * LICENSING (do not violate): the input CAD files are local-license only. This
 * script ships DERIVED MEASUREMENT METADATA ONLY — dimensions, feature counts,
 * surface-type histograms, grades. It NEVER copies file bytes, and it DROPS the
 * raw part `name`/`part_names` (which may be a proprietary product identifier),
 * keeping instead a generic geometric descriptor + whitelisted generic
 * engineering nouns extracted from those names. Junk materials (Material1,
 * paint9, …) are filtered to a real-material whitelist.
 *
 * Run:  node scripts/reference/build-ref-part-index.mjs [<ir-root>]
 * Then commit ONLY the output JSON, not this corpus.
 */
import fs from 'node:fs';
import path from 'node:path';

const IR_ROOT =
  process.argv[2] ||
  'C:/Users/gomd9/Downloads/참고파일들/result/ir';
const OUT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '../../src/lib/ai/reference/refPartIndex.json',
);

// Generic engineering nouns we allow to survive from a proprietary part name.
// These are commodity geometric/mechanical descriptors, not brand identifiers.
const GENERIC_NOUNS = new Set([
  'bearing', 'flange', 'gear', 'pinion', 'sprocket', 'bracket', 'plate',
  'shaft', 'bolt', 'nut', 'washer', 'pipe', 'tube', 'valve', 'pump',
  'housing', 'cover', 'lid', 'gasket', 'seal', 'spacer', 'standoff',
  'pulley', 'sheave', 'bushing', 'bush', 'coupling', 'clamp', 'hinge',
  'screw', 'spring', 'piston', 'cylinder', 'cam', 'lever', 'arm', 'rod',
  'ring', 'disc', 'disk', 'wheel', 'hub', 'mount', 'base', 'frame',
  'panel', 'nozzle', 'fan', 'impeller', 'rotor', 'stator', 'connector',
  'clip', 'knob', 'handle', 'cap', 'adapter', 'manifold', 'block',
  'beam', 'column', 'wall', 'slab', 'bar', 'plug', 'socket', 'joint',
  'roller', 'pin', 'key', 'shim', 'stud', 'rivet', 'grommet',
  'boss', 'rib', 'fin', 'blade', 'propeller', 'vane', 'gearbox',
  'enclosure', 'chassis', 'casing', 'yoke', 'fork', 'crank',
  'bellcrank', 'linkage', 'guide', 'rail', 'track', 'slider', 'wedge',
  'cone', 'sphere', 'ball', 'grille', 'grid', 'mesh',
]);

// Real material keywords (root form). Everything else (Material1, paint9,
// Trim, white, …) is dropped as a placeholder / finish label.
const MATERIAL_KEYWORDS = [
  'steel', 'stainless', 'aluminum', 'aluminium', 'brass', 'bronze', 'copper',
  'iron', 'cast iron', 'titanium', 'zinc', 'nickel', 'magnesium', 'lead',
  'abs', 'nylon', 'pla', 'petg', 'polycarbonate', 'polyethylene', 'polypropylene',
  'pvc', 'ptfe', 'delrin', 'acetal', 'acrylic', 'rubber', 'silicone', 'epdm',
  'wood', 'plywood', 'oak', 'pine', 'timber', 'concrete', 'glass', 'ceramic',
  'carbon fiber', 'carbon', 'fiberglass', 'composite', 'plastic', 'alloy',
];

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.endsWith('.ir.json')) out.push(p);
  }
  return out;
}

const round = (n, d = 2) =>
  typeof n === 'number' && Number.isFinite(n)
    ? Math.round(n * 10 ** d) / 10 ** d
    : undefined;

/** Extract whitelisted generic nouns from a raw (possibly proprietary) name. */
function genericNouns(name, partNames) {
  const terms = new Set();
  const texts = [name, ...(Array.isArray(partNames) ? partNames : [])].filter(
    (t) => typeof t === 'string',
  );
  for (const t of texts) {
    for (const tok of t.toLowerCase().split(/[^a-z]+/)) {
      if (GENERIC_NOUNS.has(tok)) terms.add(tok);
    }
  }
  return [...terms];
}

/** Filter junk material labels down to real-material keywords. */
function realMaterials(materials) {
  if (!Array.isArray(materials)) return [];
  const out = new Set();
  for (const m of materials) {
    if (typeof m !== 'string') continue;
    const low = m.toLowerCase();
    for (const kw of MATERIAL_KEYWORDS) {
      if (low.includes(kw)) out.add(kw === 'aluminium' ? 'aluminum' : kw);
    }
  }
  return [...out];
}

/** Surface-type histogram: from topology when present, else derived from mesh
 *  curvature bins (real measurement) mapped to plane/cylinder/bspline weights. */
function surfaceTypes(j) {
  const st = j.topology?.surface_types;
  if (st && typeof st === 'object') {
    const keep = {};
    for (const k of ['plane', 'cylinder', 'cone', 'sphere', 'torus', 'bspline']) {
      if (st[k]) keep[k] = st[k];
    }
    return Object.keys(keep).length ? keep : undefined;
  }
  const cb = j.mesh?.curvature_bins;
  if (cb && typeof cb === 'object') {
    const keep = {};
    if (cb.flat) keep.plane = round(cb.flat * 100, 0);
    if (cb.cyl) keep.cylinder = round(cb.cyl * 100, 0);
    if (cb.free) keep.bspline = round(cb.free * 100, 0);
    return Object.keys(keep).length ? keep : undefined;
  }
  return undefined;
}

/** Compact generic geometric descriptor (no proprietary tokens). */
function descriptor(entry) {
  const { aspect, solids, surfaceTypes: st, holeDiameters, patterns } = entry;
  const parts = [];
  // dominant analytic character
  let dominant = '';
  if (st) {
    const ord = Object.entries(st).sort((a, b) => b[1] - a[1]);
    if (ord.length) dominant = ord[0][0];
  }
  const shape =
    aspect === 'rod'
      ? 'cylindrical rod-like part'
      : aspect === 'plate'
      ? 'flat plate-like part'
      : aspect === 'block'
      ? 'rectangular block part'
      : aspect === 'shell'
      ? 'thin-walled shell part'
      : 'complex multi-feature part';
  parts.push(shape);
  if (dominant === 'cylinder') parts.push('cylinder-dominant');
  else if (dominant === 'plane') parts.push('planar-faced');
  else if (dominant === 'torus') parts.push('with toroidal/rounded faces');
  else if (dominant === 'bspline') parts.push('free-form-surfaced');
  if (Array.isArray(holeDiameters) && holeDiameters.length)
    parts.push(`with ${holeDiameters.length} hole(s)`);
  if (Array.isArray(patterns) && patterns.length) {
    const p = patterns[0];
    parts.push(`${p.kind || ''} pattern x${p.count || '?'}`.trim());
  }
  if (solids > 1) parts.push(`assembly of ${solids} solids`);
  return parts.join(', ');
}

const files = walk(IR_ROOT).sort();
const entries = [];
let skipped = 0;

for (const f of files) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    skipped++;
    continue;
  }
  const grade = j.reconstruct?.grade;
  const aspect = j.extent?.aspect;
  if ((!aspect || aspect === '?') && !grade) {
    // no usable geometry classification and no grade — nothing to ground on
    skipped++;
    continue;
  }

  const size = Array.isArray(j.extent?.size)
    ? j.extent.size.map((n) => round(n, 1)).filter((n) => n !== undefined)
    : undefined;

  const holesRaw = j.features?.hole_diameters;
  const holeDiameters = Array.isArray(holesRaw)
    ? [...new Set(holesRaw.map((n) => round(n, 1)).filter((n) => n))].slice(0, 12)
    : [];

  const patternsRaw = j.features?.patterns;
  const patterns = Array.isArray(patternsRaw)
    ? patternsRaw
        .map((p) => ({ kind: p.kind, count: p.count }))
        .filter((p) => p.kind)
        .slice(0, 4)
    : [];

  const st = surfaceTypes(j);
  const primFit = j.features?.primitive_fit?.kind || j.mesh?.primitive_fit?.kind;

  const entry = {
    id: `${j.identity?.format || '?'}-${entries.length}`,
    format: j.identity?.format || undefined,
    genericTerms: genericNouns(j.identity?.name, j.semantics?.part_names),
    materials: realMaterials(j.semantics?.materials),
    size: size && size.length === 3 ? size : undefined,
    aspect: aspect && aspect !== '?' ? aspect : undefined,
    solids: j.topology?.solids ?? j.mesh?.components ?? undefined,
    surfaceTypes: st,
    analyticRatio:
      round(j.topology?.analytic_ratio, 3) ??
      (j.mesh?.curvature_bins
        ? round(1 - (j.mesh.curvature_bins.free || 0), 3)
        : undefined),
    holeDiameters: holeDiameters.length ? holeDiameters : undefined,
    patterns: patterns.length ? patterns : undefined,
    primitiveFit: primFit || undefined,
    grade: grade || undefined,
    strategy: j.reconstruct?.strategy || undefined,
  };
  entry.descriptor = descriptor(entry);

  // drop empty arrays / undefined keys for compactness
  if (Array.isArray(entry.genericTerms) && !entry.genericTerms.length)
    delete entry.genericTerms;
  if (Array.isArray(entry.materials) && !entry.materials.length)
    delete entry.materials;
  for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
  entries.push(entry);
}

const payload = {
  _note:
    'Derived measurement metadata distilled from a local-license IR corpus. ' +
    'NO CAD file bytes; raw proprietary names dropped (generic descriptors only). ' +
    'CITED, NON-AUTHORITATIVE reference examples for AI planners — never authoritative values.',
  builtAt: new Date().toISOString().slice(0, 10),
  count: entries.length,
  parts: entries,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload));
const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(
  `distilled ${entries.length} parts (skipped ${skipped}) → ${OUT} (${kb} KB)`,
);
