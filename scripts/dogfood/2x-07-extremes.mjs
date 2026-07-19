// 2x-07: 극단/이상 입력이 쉬운요약 본문에 어떻게 찍히는지 verbatim 확인
import { buildAssemblyTemplate } from '../drawing-to-3d/domain-assemblies.mjs';
import { buildAssembly } from '../drawing-to-3d/assembly.mjs';
import { easySummary } from '../drawing-to-3d/easy-summary.mjs';

const text = (h) => h.replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<\/(p|li|h2|tr|div)>/g, '\n').replace(/<\/td>/g, ' | ').replace(/<[^>]+>/g, '')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();

function show(label, asm, opts = {}) {
  console.log(`\n################ ${label}`);
  if (!asm) { console.log('NULL'); return; }
  const b = buildAssembly(asm);
  console.log(`[build] ok=${b.ok} parts=${(b.parts ?? []).length} mass=${b.structural?.totalMassKg} structuralOk=${b.structural?.ok} warnings=${JSON.stringify(b.structural?.warnings ?? [])}`);
  const t = text(easySummary(asm, opts));
  console.log(t.split('\n').slice(4, 34).join('\n'));
}

// 1) 범위 400배 초과 — 100m 높이 파고라
show('pergola rafterCount=400 height=99999 (params.max 무시)',
  buildAssemblyTemplate('landscape', 'pergola', { rafterCount: 400, height: 99999, width: 3657, depth: 2743 }),
  { title: '괴물 파고라', domain: 'landscape' });

// 2) 게이트 실패 시 일반인에게 보이는 문구
show('tank_silo wallThk=999 (물리적 불가) — 게이트 실패 문구',
  buildAssemblyTemplate('mech', 'tank_silo', { diameter: 900, wallThk: 999, shellH: 1500, legH: 500 }),
  { title: '불가능 사일로', domain: 'mech' });

// 3) massProxy 경로(수목 수관) — 조경 신규 템플릿
show('tree_planting 홀수 배치',
  buildAssemblyTemplate('landscape', 'tree_planting', { rows: 3, cols: 5, spacingX: 4267, spacingY: 3658, trunkDia: 187, trunkHeight: 1731, canopyDia: 3277 }),
  { title: '가로수 식재', domain: 'landscape' });

// 4) 단위 붙은 문자열 입력 — 조용히 기본값
const a = buildAssemblyTemplate('landscape', 'pergola', { width: '3657mm', depth: '2743mm', height: '2438' });
show('pergola width="3657mm" depth="2743mm" height="2438"(숫자문자열)', a, { title: '문자열 입력', domain: 'landscape' });
