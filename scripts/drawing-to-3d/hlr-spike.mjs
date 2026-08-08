/**
 * hlr-spike.mjs — HLR(은선 제거) 투영 스파이크 (260719b 타임박스 — 판정: **가능**).
 *
 * replicad `drawProjection(shape, view)` = OCCT HLRBRep — {visible, hidden} Drawing → SVG.
 * 경로: 어셈블리 → intentToStep(융합 B-rep) → importSTEP → drawProjection(front/top/left).
 * E1 헐(중간 충실도)의 정식 후속 — GA 뷰 치환은 별도 트랙(치수·밸룬 좌표계 재배선 필요).
 * 비용 실측: 중형 어셈블리 수 초(온디맨드·도면집 옵션 적합, 실시간 아님 명시).
 *
 * usage: node hlr-spike.mjs '<assembly.json|@file>' [--out out/hlr]
 */
import { buildAssembly } from './assembly.mjs';
import { intentToStep, ensureReplicad } from './to-step.mjs';

/**
 * 어셈블리 → 뷰별 HLR SVG(visible 실선 + hidden 파선 합성).
 * @returns { ok, views: { front?, top?, left? }, entities, dropped }
 */
export async function hlrProject(asm, { views = ['front', 'top'] } = {}) {
  const built = buildAssembly(asm);
  if (!built.ok) return { ok: false, gateErrors: built.gateErrors };
  const st = await intentToStep(built.composeIntent);
  const rc = await ensureReplicad();
  const shape = await rc.importSTEP(new Blob([st.step]));
  return { ok: true, views: projectShapeViews(rc, shape, views), entities: st.entities, dropped: st.fuseReport?.dropped ?? [] };
}

/** B-rep 형상 → 뷰별 HLR SVG(visible 실선 + hidden 파선) — 어셈블리/단일 intent
 *  경로가 공유하는 투영 코어(K5 심화 260808 공용화). */
export function projectShapeViews(rc, shape, views) {
  const out = {};
  for (const v of views) {
    const pr = rc.drawProjection(shape, v);
    // visible=외형 실선 · hidden=은선(도면 관례 파선) — 단일 SVG 합성
    const vis = pr.visible.toSVGPaths().map((p) => `<path d="${p}" fill="none" stroke="#0f172a" stroke-width="0.6"/>`);
    const hid = pr.hidden.toSVGPaths().map((p) => `<path d="${p}" fill="none" stroke="#94a3b8" stroke-width="0.4" stroke-dasharray="4 2"/>`);
    const bb = pr.visible.toSVGViewBox ? pr.visible.toSVGViewBox(2) : null;
    out[v] = `<svg xmlns="http://www.w3.org/2000/svg" ${bb ? `viewBox="${bb}"` : ''}>${vis.join('')}${hid.join('')}</svg>`;
  }
  return out;
}

// CLI
if (process.argv[1]?.replaceAll('\\', '/').endsWith('hlr-spike.mjs') && process.argv[2]) {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const arg = process.argv[2];
  const asm = JSON.parse(arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg);
  const outDir = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'scripts/drawing-to-3d/out/hlr';
  mkdirSync(outDir, { recursive: true });
  const t0 = performance.now();
  const r = await hlrProject(asm, { views: ['front', 'top', 'left'] });
  if (!r.ok) { console.error('gate:', r.gateErrors); process.exit(1); }
  for (const [v, svg] of Object.entries(r.views)) writeFileSync(`${outDir}/${v}.svg`, svg);
  console.log(`HLR ${Object.keys(r.views).join('/')} 저장 → ${outDir} · ${(performance.now() - t0).toFixed(0)}ms · entities ${r.entities}${r.dropped.length ? ` · dropped ${r.dropped.length}` : ''}`);
}
