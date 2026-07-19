/**
 * execution-gate.mjs — T2 실시 검도 게이트 M1~M6 (260719).
 *
 * "이 도면만으로 제작 착수 가능한가"를 결정론 대조로 판정 — 미충족=보완 대상 목록(면책 아님).
 *   M1 치수 충분성: 부품 파라미터 자유도(PARAMS 레지스트리) ↔ 도면(GA+부품도) 기입 숫자 대조
 *   M2 구멍표: 구멍 보유 부품 → 구멍표 존재 + 전 구멍 규격 표기(holeFeature 라벨)
 *   M3 용접기호 실배치: 용접 조인트 → GA 지시선(nf-weldarrow, KS B 0052 사상)
 *   M4 나사 표기: 탭홀 → M호칭(×깊이) 표기
 *   M5 재질·일반공차: BOM 재질열 + 표제란 일반공차 주기(nf-gentol)
 *   M6 실윤곽 투영: 비90° 회전 부품 → E1 헐 폴리곤
 * 정직 한계(명시): 배열 특례 어휘(revolve 프로파일·mesh·sheet_profile 세그먼트열 등)는
 * 치수 충분성 대상 외 — 부품도+STEP 참조가 제작 기준. 해당 없음 항목=N/A(감점 아님).
 */
import { PARAMS, holeFeature } from './reconstruct.mjs';

export function checkExecutionReadiness(assembly, { gaHtml = '', sheetsHtml = '', welds = [] } = {}) {
  const combined = gaHtml + '\n' + sheetsHtml;
  // 도면 기입 숫자 집합(태그 제거 후) — fmtLen 'm' 단위 환산 포함
  const nums = new Set();
  for (const m of combined.replace(/<[^>]+>/g, ' ').matchAll(/(\d+(?:\.\d+)?)(m\b)?/g)) {
    nums.add(Math.round(Number(m[1]) * (m[2] ? 1000 : 1) * 100) / 100);
  }
  const hasNum = (v) => {
    if (!Number.isFinite(v)) return false;
    if (nums.has(Math.round(v * 100) / 100)) return true;
    for (const n of nums) if (Math.abs(n - v) <= Math.max(0.5, v * 0.005)) return true; // 축척 라운딩 여유(명시)
    return false;
  };

  // M1 — 그룹 대표(동일 type+파라미터)만 검사(BOM 그룹 관례와 동일)
  const seen = new Set();
  const missing = [];
  for (const p of assembly.parts ?? []) {
    const req = PARAMS[p.type];
    if (!req) continue; // 배열 특례/미등록 어휘 — 대상 외(모듈 주석 명시)
    const key = p.type + '|' + req.map((k) => p.params?.[k]).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const miss = req.filter((k) => typeof p.params?.[k] === 'number' && !hasNum(p.params[k]));
    if (miss.length) missing.push(`${p.id ?? p.type}: ${miss.join('·')} 치수 누락`);
  }
  const M1 = { id: 'M1', name: '치수 충분성(파라미터↔기입 치수)', pass: missing.length === 0, detail: missing.slice(0, 12) };

  // M2 — 구멍표
  const holed = (assembly.parts ?? []).filter((p) => p.type === 'plate_with_holes' && (p.params?.holes ?? []).length);
  let m2pass = true;
  const m2detail = [];
  if (holed.length) {
    if (!combined.includes('구멍 규격')) { m2pass = false; m2detail.push('구멍표 없음 — 부품도 시트 생성 필요'); }
    else {
      for (const p of holed) {
        for (const h of p.params.holes) {
          const f = holeFeature(h, p.params.thickness);
          if (!combined.includes(f.label)) { m2pass = false; m2detail.push(`${p.id ?? p.type}: ${f.label} 구멍표 누락`); }
        }
      }
    }
  }
  const M2 = { id: 'M2', name: '구멍표(N×⌀d·⌴⌵·나사)', pass: holed.length ? m2pass : null, detail: m2detail.slice(0, 12) };

  // M3 — 용접기호 실배치
  const M3 = { id: 'M3', name: '용접기호 실배치(KS B 0052 지시선)', pass: welds.length ? gaHtml.includes('nf-weldarrow') : null, detail: [] };

  // M4 — 나사 표기
  const taps = holed.flatMap((p) => (p.params.holes ?? []).filter((h) => h.kind === 'tap'));
  const M4 = { id: 'M4', name: '나사 표기(M호칭×깊이)', pass: taps.length ? /M\d+(?:×\d+)?/.test(combined) : null, detail: [] };

  // M5 — 재질열 + 일반공차 주기
  const M5 = { id: 'M5', name: '재질열+일반공차 주기(표제란)', pass: combined.includes('재질') && gaHtml.includes('nf-gentol'), detail: [] };

  // M6 — 실윤곽 투영(E1)
  const rotated = (assembly.parts ?? []).some((p) => {
    const a = p.at ?? {};
    return [a.rx ?? 0, a.ry ?? 0, a.rz ?? 0].some((v) => Math.abs(v % 90) > 1e-9);
  });
  const M6 = { id: 'M6', name: '실윤곽 투영(비90° 회전=헐 폴리곤)', pass: rotated ? gaHtml.includes('<polygon points=') : null, detail: [] };

  const items = [M1, M2, M3, M4, M5, M6];
  const applicable = items.filter((i) => i.pass !== null);
  return {
    score: `${applicable.filter((i) => i.pass).length}/${applicable.length}`,
    items,
    ok: applicable.every((i) => i.pass),
    failed: applicable.filter((i) => !i.pass).map((i) => `${i.id} ${i.name}${i.detail.length ? ' — ' + i.detail.join('; ') : ''}`),
    na: items.filter((i) => i.pass === null).map((i) => i.id),
    note: '실시 검도 M1~M6 — 미충족=보완 대상(면책 아님) · 배열 특례 어휘=부품도+STEP 참조 기준(명시)',
  };
}
