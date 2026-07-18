/**
 * mine-calibration.mts — 코퍼스 도너 실측 파이프라인 (Phase4b, 260718).
 *
 * 도너 폴더의 열 수 있는 파일(STEP/IGES/STL)을 임포트해 AABB·원통Ø·부품수 통계를
 * 보고한다. **detail-calibration.json 자동 기입은 하지 않는다** — 사람이 수치를
 * 확인해 basis(corpus/catalog/assumed)와 함께 반영(휴먼 인 더 루프 = 날조 방지).
 * ⚠GrabCAD 코퍼스=로컬 전용: 이 스크립트는 수치 통계만 출력(기하 복사 없음).
 *
 * usage: npx tsx scripts/drawing-to-3d/mine-calibration.mts <도너폴더> [...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function main() {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const bb = path.join(here, '..', '..', 'src', 'lib', 'brep-bridge');
  const { stepToNexyfabAssembly } = await import(pathToFileURL(path.join(bb, 'stepToNexyfabAssembly.ts')).href);
  const { igesToNexyfabAssembly, stlToNexyfabAssembly } = await import(pathToFileURL(path.join(bb, 'meshIgesImport.ts')).href);

  for (const dir of process.argv.slice(2)) {
    console.log('==', path.basename(dir));
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.(step|stp|igs|iges|stl)$/i.test(f.name)) files.push(p);
      }
    };
    walk(dir);
    for (const p of files) {
      try {
        const r = /\.stl$/i.test(p)
          ? stlToNexyfabAssembly(fs.readFileSync(p), { name: 'm' })
          : /\.(igs|iges)$/i.test(p)
            ? igesToNexyfabAssembly(fs.readFileSync(p, 'latin1'), { name: 'm' })
            : stepToNexyfabAssembly(fs.readFileSync(p, 'latin1'), { name: 'm' });
        if (!r.ok || !r.assembly) { console.log('  ✗', path.basename(p).slice(0, 42), (r.error ?? '').slice(0, 70)); continue; }
        const parts = r.assembly.parts as Array<{ type: string; params: Record<string, number>; at: Record<string, number> }>;
        let mn = [Infinity, Infinity, Infinity];
        let mx = [-Infinity, -Infinity, -Infinity];
        const cyls: number[] = [];
        for (const q of parts) {
          const dims = q.type === 'cylinder' ? [q.params.diameter, q.params.diameter, q.params.length] : [q.params.width, q.params.depth, q.params.height];
          if (q.type === 'cylinder') cyls.push(+q.params.diameter.toFixed(1));
          mn = mn.map((v, i) => Math.min(v, [q.at.tx, q.at.ty, q.at.tz][i]));
          mx = mx.map((v, i) => Math.max(v, [q.at.tx, q.at.ty, q.at.tz][i] + dims[i]));
        }
        console.log('  ✓', path.basename(p).slice(0, 42), '| parts', parts.length,
          '| AABB', mx.map((v, i) => (v - mn[i]).toFixed(1)).join('×'),
          '| cylØ', [...new Set(cyls)].sort((a, b) => a - b).slice(0, 10).join(','));
      } catch (e) {
        console.log('  ERR', path.basename(p).slice(0, 42), String(e).slice(0, 60));
      }
    }
  }
}
main();
