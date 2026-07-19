// 2x-02: 일반인 경로 전 구간 — 템플릿 생성 → assembly.json 저장 → (CLI package) → easySummary 텍스트 출력
// usage: node scripts/dogfood/2x-02-pipeline.mjs <domain> <templateId> '<paramsJSON>'
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildAssemblyTemplate } from '../drawing-to-3d/domain-assemblies.mjs';
import { buildAssembly } from '../drawing-to-3d/assembly.mjs';

const [domain, templateId, paramsJson] = process.argv.slice(2);
const params = JSON.parse(paramsJson ?? '{}');
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(OUT, { recursive: true });

const asm = buildAssemblyTemplate(domain, templateId, params);
if (!asm) { console.log('NULL assembly'); process.exit(1); }
console.log(`=== assembly: ${asm.name} domain=${asm.domain} parts=${asm.parts.length}`);
for (const p of asm.parts) {
  console.log(`  ${p.id} | ${p.type} | qty=${p.qty ?? 1} | mat=${p.material ?? '-'} | ${JSON.stringify(p.params)} | at=${JSON.stringify(p.at ?? {})}`);
}
const file = `${OUT}${domain}-${templateId}.json`;
writeFileSync(file, JSON.stringify(asm, null, 1));
console.log('saved:', file);

const built = buildAssembly(asm);
console.log(`built.ok=${built.ok} gateErrors=${JSON.stringify(built.gateErrors ?? [])}`);
console.log(`  parts(built)=${(built.parts ?? []).length} welds=${(built.welds ?? []).length} weldTotalMm=${built.weldTotalMm}`);
console.log(`  interferences=${(built.interferences ?? []).length} floating=${JSON.stringify(built.support?.floating ?? [])}`);
console.log(`  structural.totalMassKg=${built.structural?.totalMassKg}`);
if (built.structural?.massBreakdown) {
  for (const r of built.structural.massBreakdown) console.log(`    mass ${r.id}: ${r.massKg} kg  vol=${r.volumeM3 ?? r.volume ?? '-'} mat=${r.material ?? '-'}`);
}
const env = [0, 1, 2].map((k) => Math.max(...built.parts.map((p) => p.aabb.max[k])) - Math.min(...built.parts.map((p) => p.aabb.min[k])));
console.log('  envelope mm =', env.join(' x '));
