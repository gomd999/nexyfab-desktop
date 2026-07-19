// 2x-05: 이상값/잘못된 입력에 대한 반응 — 클램프? 거부? 조용한 쓰레기?
import { buildAssemblyTemplate } from '../drawing-to-3d/domain-assemblies.mjs';
import { buildPreset } from '../drawing-to-3d/preset-registry.mjs';
import { easySummary } from '../drawing-to-3d/easy-summary.mjs';
import { buildAssembly } from '../drawing-to-3d/assembly.mjs';

const line = (s) => console.log('\n----- ' + s);
const env = (a) => {
  const b = buildAssembly(a);
  if (!b.ok) return `GATE FAIL ${JSON.stringify(b.gateErrors)}`;
  const e = [0, 1, 2].map((k) => Math.max(...b.parts.map((p) => p.aabb.max[k])) - Math.min(...b.parts.map((p) => p.aabb.min[k])));
  return `parts=${b.parts.length} env=${e.join('x')} mass=${b.structural?.totalMassKg}`;
};
const grab = (html, re) => (html.match(re) ?? []).join(' || ');

// A. 범위 초과(min/max 무시되는가)
line('A1 pergola rafterCount=400 (max 15), height=99999 (max 3600)');
try {
  const a = buildAssemblyTemplate('landscape', 'pergola', { rafterCount: 400, height: 99999, width: 3657, depth: 2743 });
  console.log('parts=', a.parts.length, env(a));
} catch (e) { console.log('THROW:', e.message); }

line('A2 counter_bar length=8000000 (max 8000)');
try { const a = buildAssemblyTemplate('interior', 'counter_bar', { length: 8000000 }); console.log(a.name, env(a)); } catch (e) { console.log('THROW:', e.message); }

line('A3 tank_silo wallThk=999 > diameter (물리적 불가)');
try { const a = buildAssemblyTemplate('mech', 'tank_silo', { diameter: 900, wallThk: 999, shellH: 1500, legH: 500 }); console.log(a.name, env(a)); } catch (e) { console.log('THROW:', e.message); }

// B. 타입 오류(단위 붙은 문자열 — 일반인이 자주 하는 입력)
line('B1 pergola width="3657mm" (문자열)');
try { const a = buildAssemblyTemplate('landscape', 'pergola', { width: '3657mm' }); console.log(a.name, env(a)); } catch (e) { console.log('THROW:', e.message); }
line('B2 counter_bar height=NaN / null / 음수');
for (const v of [NaN, null, -1043]) {
  try { const a = buildAssemblyTemplate('interior', 'counter_bar', { height: v }); console.log(`  height=${v} →`, a.name, env(a)); } catch (e) { console.log(`  height=${v} → THROW:`, e.message); }
}
line('B3 소수 층수: commercial_massing floors=1.5');
try { const a = buildAssemblyTemplate('building', 'commercial_massing', { floors: 1.5, width: 8231, depth: 5417 }); console.log(a.name, env(a)); } catch (e) { console.log('THROW:', e.message); }

// C. 존재하지 않는 템플릿/도메인 — 오류 메시지 품질
line('C1 unknown template id');
console.log('buildAssemblyTemplate("landscape","pergolaa") →', buildAssemblyTemplate('landscape', 'pergolaa'));
line('C2 unknown domain');
console.log('buildAssemblyTemplate("조경","pergola") →', buildAssemblyTemplate('조경', 'pergola'));
console.log('buildPreset("조경","deck_joist") →', JSON.stringify(buildPreset('조경', 'deck_joist')));

// D. 이음매: 단품 프리셋(intent, features[])을 easySummary 에 넣으면?
line('D1 easySummary(buildPreset("landscape","u_channel")) — intent(features[])는 assembly 아님');
const intent = buildPreset('landscape', 'u_channel', { innerWidth: 317, depth: 283, wall: 47, length: 2743 });
console.log('intent keys:', Object.keys(intent));
const h = easySummary(intent, { title: 'U형 측구 2743', domain: 'landscape' });
console.log('길이:', h.length, '| ①본문:', grab(h, /<p>이 도면집[^<]*<\/p>/g));
console.log('KPI:', grab(h, /<b>[^<]*<\/b><span>[^<]*<\/span>/g));

line('D2 easySummary({}) / (null)');
for (const v of [{}, null, undefined, { parts: [] }]) {
  const x = easySummary(v);
  console.log(' ', JSON.stringify(v), '→', grab(x, /<p class="warn">[^<]*/g) || grab(x, /<b>[^<]*<\/b><span>[^<]*/g).slice(0, 160));
}
