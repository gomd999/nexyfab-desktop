// 2x-06: 이음매(seam) 검사 — 단품 프리셋 intent → 도면집/쉬운요약 경로가 실제로 이어지는가
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildPreset } from '../drawing-to-3d/preset-registry.mjs';
import { easySummary } from '../drawing-to-3d/easy-summary.mjs';
import { callTool } from '../drawing-to-3d/mcp-server.mjs';

const text = (h) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n').trim();
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(OUT, { recursive: true });

for (const [dom, id, p] of [
  ['landscape', 'u_channel', { innerWidth: 317, depth: 283, wall: 47, length: 2743 }],
  ['landscape', 'deck_joist', { width: 89, height: 187, length: 2743 }],
  ['interior', 'cafe_layout', { width: 7317, depth: 5183, tableRows: 2, tableCols: 3, seatsPerTable: 4 }],
]) {
  const intent = buildPreset(dom, id, p);
  console.log(`\n########## ${dom}/${id}`);
  console.log('intent:', JSON.stringify(intent).slice(0, 300));
  console.log('--- easySummary(intent) 본문:');
  console.log(text(easySummary(intent, { title: id, domain: dom })).split('\n').slice(0, 14).join('\n'));
  const f = `${OUT}intent-${dom}-${id}.json`;
  writeFileSync(f, JSON.stringify(intent, null, 1));
  console.log('--- generate_package(assembly=intent):');
  const r = await callTool('generate_package', { assembly: intent, outDir: `${OUT}pkg-intent-${dom}-${id}`, title: id });
  console.log(JSON.stringify({ ok: r.ok, gateErrors: r.gateErrors, files: (r.files ?? []).map((x) => x.name) }));
}
