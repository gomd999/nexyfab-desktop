import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

/**
 * PoC — TRUE papercraft flat pattern (Flat Pattern / 전개도) for a parametric
 * box-building, WITHOUT a general mesh-unfolding engine. Because NexyFab builds
 * shapes parametrically, a building's faces are KNOWN (walls + roof), so the net
 * can be laid out directly: the 6 faces unfolded around the floor + glue tabs on
 * the free edges. Exports CUT lines (outer net outline incl. tabs) and FOLD
 * lines (face-to-face creases) as separate DXFs/layers — exactly what a paper/
 * laser kit needs. This is the achievable-in-weeks path for buildings/rooms.
 */
function num(v: unknown, d: number) { return typeof v === 'number' && isFinite(v) ? v : d; }

function buildNet(W: number, D: number, H: number, tab: number) {
  // Cross layout: floor centred, 4 walls folded out, roof flap above the back
  // wall. Tabs (trapezoids) on the glue edges of the side walls + roof.
  const cut = `
$fn=24;
module tab(len) { polygon([[0,0],[len,0],[len-${tab},${tab}],[${tab},${tab}]]); }
union() {
  square([${W}, ${D}]);                       // floor
  translate([0, -${H}]) square([${W}, ${H}]); // front wall
  translate([0, ${D}]) square([${W}, ${H}]);  // back wall
  translate([-${H}, 0]) square([${H}, ${D}]); // left wall
  translate([${W}, 0]) square([${H}, ${D}]);  // right wall
  translate([0, ${D + H}]) square([${W}, ${H}]); // roof flap
  // glue tabs on the side-wall outer vertical edges
  translate([-${H}, ${D}]) rotate(90) tab(${D});
  translate([0, 0]) rotate(-90) translate([-${D}, ${H}]) tab(${D});
  translate([${W + H}, 0]) rotate(90) tab(${D});
  translate([${W}, ${D}]) rotate(-90) tab(${D});
  // roof glue tabs (front lip)
  translate([0, ${D + 2 * H}]) tab(${W});
}
`;
  // Fold lines = the creases between adjacent faces (drawn as thin segments so a
  // laser/plotter can score, not cut, them — emitted on their own layer/file).
  const fold = `
union() {
  translate([0, 0]) square([${W}, 0.1]);             // floor / front
  translate([0, ${D}]) square([${W}, 0.1]);          // floor / back
  translate([0, 0]) square([0.1, ${D}]);             // floor / left
  translate([${W}, 0]) square([0.1, ${D}]);          // floor / right
  translate([0, ${D + H}]) square([${W}, 0.1]);      // back / roof
}
`;
  return { cut, fold };
}

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`papercraft-net:${ip}`, 30, 3_600_000).allowed) {
    return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMIT' }, { status: 429 });
  }
  const b = (await req.json().catch(() => ({}))) as { width?: number; depth?: number; height?: number; tab?: number };
  const W = Math.min(Math.max(10, num(b.width, 60)), 1000);
  const D = Math.min(Math.max(10, num(b.depth, 40)), 1000);
  const H = Math.min(Math.max(5, num(b.height, 30)), 1000);
  const tab = Math.min(Math.max(2, num(b.tab, 6)), 20);

  const { cut, fold } = buildNet(W, D, H, tab);
  const id = randomBytes(8).toString('hex');
  const workDir = join(tmpdir(), `nf-net-${id}`);
  await mkdir(workDir, { recursive: true });
  const bin = process.env.OPENSCAD_BIN || '/usr/bin/openscad';
  const out: Record<string, { dxf: string | null; bytes: number }> = {};
  try {
    for (const [name, scad] of [['cut', cut], ['fold', fold]] as const) {
      const sp = join(workDir, `${name}.scad`);
      const op = join(workDir, `${name}.dxf`);
      await writeFile(sp, scad, 'utf8');
      try {
        await execFileAsync(bin, [sp, '-o', op], { cwd: workDir, timeout: 30_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: process.env });
        const dxf = await readFile(op, 'utf8');
        out[name] = { dxf, bytes: Buffer.byteLength(dxf, 'utf8') };
      } catch { out[name] = { dxf: null, bytes: 0 }; }
    }
    return NextResponse.json({ ok: (out.cut?.bytes ?? 0) > 0, dims: { W, D, H, tab }, cut: out.cut, fold: out.fold });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
