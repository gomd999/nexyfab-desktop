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
 * PoC — 2.5D laser-cut "layered diorama" from a 3D OpenSCAD shape, WITHOUT a
 * 3D-unfolding engine. Slices the model into N horizontal layers and projects
 * each slice to a 2D outline, exported as DXF (OpenSCAD infers the format from
 * the .dxf extension). Stack the cut layers on board → a topographic 3D relief.
 * This validates that the existing OpenSCAD pipeline already produces
 * laser-cuttable vector output for the paper/laser market — the only thing it
 * can't do (yet) is true surface unfolding.
 */
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`papercraft-layers:${ip}`, 20, 3_600_000).allowed) {
    return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMIT' }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { scad?: string; layers?: number; height?: number; thickness?: number };
  const scad = (body.scad ?? '').trim();
  if (!scad) return NextResponse.json({ error: 'scad required' }, { status: 400 });
  const H = Math.min(Math.max(1, body.height ?? 50), 1000);
  // Material thickness (e.g. foam board / 우드락) → how many slabs to stack to
  // reach the height. Takes priority over an explicit layer count so the cut
  // sheets physically add up to H when glued.
  const thickness = typeof body.thickness === 'number' && body.thickness > 0
    ? Math.min(Math.max(0.5, body.thickness), 50) : 0;
  const N = thickness > 0
    ? Math.min(Math.max(2, Math.round(H / thickness)), 60)
    : Math.min(Math.max(2, Math.round(body.layers ?? 8)), 30);

  const id = randomBytes(8).toString('hex');
  const workDir = join(tmpdir(), `nf-papercraft-${id}`);
  await mkdir(workDir, { recursive: true });
  const bin = process.env.OPENSCAD_BIN || '/usr/bin/openscad';
  const files: { layer: number; z: number; dxf: string | null; bytes: number }[] = [];
  try {
    for (let i = 0; i < N; i++) {
      const z = ((i + 0.5) * H) / N; // sample the middle of each slab
      // projection(cut=true) takes the cross-section at the XY plane, so shift
      // the model down by z to cut it at height z.
      const layerScad = `$fn=64;\nprojection(cut=true) translate([0, 0, ${-z.toFixed(3)}]) {\n${scad}\n}\n`;
      const sp = join(workDir, `l${i}.scad`);
      const op = join(workDir, `l${i}.dxf`);
      await writeFile(sp, layerScad, 'utf8');
      try {
        await execFileAsync(bin, [sp, '-o', op], { cwd: workDir, timeout: 30_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: process.env });
        const dxf = await readFile(op, 'utf8');
        files.push({ layer: i, z: Math.round(z * 100) / 100, dxf, bytes: Buffer.byteLength(dxf, 'utf8') });
      } catch (e) {
        files.push({ layer: i, z: Math.round(z * 100) / 100, dxf: null, bytes: 0 });
        void e;
      }
    }
    const okCount = files.filter(f => f.dxf && f.bytes > 0).length;
    return NextResponse.json({ ok: okCount > 0, layers: N, rendered: okCount, files });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'layering failed' }, { status: 500 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
