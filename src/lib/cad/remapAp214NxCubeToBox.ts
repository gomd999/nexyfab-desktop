import { AP214_NX_CUBE_STEP_TEMPLATE } from './ap214NxCubeTemplate';

/** Template solid extents in mm (NX sample cube). */
const T = {
  xmin: -160,
  xmax: 140,
  ymin: -140,
  ymax: 160,
  zmin: 0,
  zmax: 300,
} as const;

const xr = T.xmax - T.xmin;
const yr = T.ymax - T.ymin;
const zr = T.zmax - T.zmin;

function fmt(n: number): string {
  return n.toFixed(6);
}

function stepSafeLabel(name: string): string {
  return name.replace(/'/g, "''").replace(/[^\w.-]/g, '_').slice(0, 64) || 'Part';
}

const cartRe = /^#(\d+)=CARTESIAN_POINT\('',\(([-0-9.Ee+]+),([-0-9.Ee+]+),([-0-9.Ee+]+)\)\);$/;

/**
 * Remap the bundled AP214 MANIFOLD_SOLID_BREP template to an axis-aligned box
 * centered at the origin with half-extents (dx/2, dy/2, dz/2) — same convention as `THREE.BoxGeometry`.
 */
export function remapAp214NxCubeToBox(dx: number, dy: number, dz: number, partName: string): string {
  const safe = stepSafeLabel(partName);

  const lines = AP214_NX_CUBE_STEP_TEMPLATE.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    let l = line;
    if (l.includes("'cube.stp'")) l = l.replace(/'cube\.stp'/, `'${safe}.step'`);
    if (l.includes("PRODUCT('cube','cube'")) {
      l = l.replace("PRODUCT('cube','cube'", `PRODUCT('${safe}','${safe}'`);
    }
    l = l.replaceAll('cube-None', `${safe}-None`);
    l = l.replaceAll("REPRESENTATION_CONTEXT('cube',", `REPRESENTATION_CONTEXT('${safe}',`);

    const m = l.match(cartRe);
    if (m) {
      const x = Number(m[2]);
      const y = Number(m[3]);
      const z = Number(m[4]);
      const nx = ((x - T.xmin) / xr) * dx - dx / 2;
      const ny = ((y - T.ymin) / yr) * dy - dy / 2;
      const nz = ((z - T.zmin) / zr) * dz - dz / 2;
      l = `#${m[1]}=CARTESIAN_POINT('',(${fmt(nx)},${fmt(ny)},${fmt(nz)}));`;
    }
    out.push(l);
  }
  return out.join('\n');
}
