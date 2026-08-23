// 2x-08: generate_package 의 files[] 는 실패 항목({name,error})도 담는다 →
// 쉬운요약 ④ "아래 파일을 함께 보내면 됩니다" 목록에 존재하지 않는 파일이 실릴 수 있는가
import { readdirSync, mkdirSync } from 'node:fs';
import { buildAssemblyTemplate } from '../drawing-to-3d/domain-assemblies.mjs';
import { callTool } from '../drawing-to-3d/mcp-server.mjs';
import { easySummary } from '../drawing-to-3d/easy-summary.mjs';

const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(OUT, { recursive: true });

const cases = [
  ['landscape', 'tree_planting', { rows: 3, cols: 5, spacingX: 4267, spacingY: 3658, trunkDia: 187, trunkHeight: 1731, canopyDia: 3277 }],
  ['mech', 'propeller', { diameter: 1737, blades: 5, pitch: 811, hubDia: 227 }],
];
for (const [d, id, p] of cases) {
  const asm = buildAssemblyTemplate(d, id, p);
  const dir = `${OUT}pkg-${d}-${id}`;
  const r = await callTool('generate_package', { assembly: asm, outDir: dir, title: id, confirmWrite: true });
  console.log(`\n### ${d}/${id} ok=${r.ok}`);
  console.log('files[] reported :', JSON.stringify((r.files ?? []).map((f) => (f.error ? `${f.name}!ERR(${f.error.slice(0, 40)})` : f.name))));
  let onDisk = [];
  try { onDisk = readdirSync(dir); } catch { /* none */ }
  console.log('files on disk    :', JSON.stringify(onDisk));
  const promised = (r.files ?? []).map((f) => f.name);
  const ghost = promised.filter((n) => !onDisk.includes(n));
  console.log('GHOST(약속했지만 없음):', JSON.stringify(ghost));
  const html = easySummary(asm, { title: id, domain: d, fileNames: promised });
  for (const g of ghost) console.log('  쉬운요약이 안내하는가?', g, html.includes(`<code>${g}</code>`));
}
