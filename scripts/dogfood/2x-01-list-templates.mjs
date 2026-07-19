// 2x-01: 실제 CLI/모듈 진입점으로 사용 가능한 템플릿 목록 확인(일반인 경로 1단계)
import { listAssemblyTemplates } from '../drawing-to-3d/domain-assemblies.mjs';
import { listTemplates } from '../drawing-to-3d/preset-registry.mjs';

const doms = ['mech', 'landscape', 'interior', 'building', 'civil', 'rack'];
for (const d of doms) {
  const asm = listAssemblyTemplates(d);
  console.log(`\n=== ASSEMBLY[${d}] (${asm.length}) ===`);
  for (const t of asm) console.log(`  ${t.id}  ${t.labelKo}  params=${(t.params ?? []).map((p) => p.name).join(',')}`);
  const pre = listTemplates(d);
  console.log(`--- PRESET(single)[${d}] (${pre.length}) : ${pre.map((p) => p.id).join(', ')}`);
}
