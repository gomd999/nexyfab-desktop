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

/**
 * @param {object} assembly
 * @param {{ gaHtml?: string, sheetsHtml?: string, welds?: unknown[],
 *           gaFailed?: boolean, sheetsFailed?: boolean }} [sources]
 *   gaFailed/sheetsFailed = 그 소스의 **생성이 실패**했나(호출자의 catch 가 알려준다).
 *   ⚠ "비어 있음"과 다르다 — 애초에 만들지 않은 것은 도면에 정말 없는 것이므로 FAIL 이 맞다.
 */
export function checkExecutionReadiness(assembly, sources = {}) {
  const { gaHtml = '', sheetsHtml = '', welds = [], gaFailed = false, sheetsFailed = false } = sources;
  const combined = gaHtml + '\n' + sheetsHtml;
  /**
   * GA 도면이 아예 생성되지 않았나 (260728 §7-5).
   *
   * (호출자가 `gaFailed: true` 로 알려줄 때만 적용된다 — 아래 주석 참조.)
   * 종전엔 호출자들이 `ga2dDrawing` 실패를 조용히 삼키고 `gaHtml=''` 로 이 함수를 계속
   * 불렀다. 그러면 GA 를 읽는 항목(M3 용접기호·M5 재질열+일반공차·M6 실윤곽)이 전부
   * **"미충족"으로 보고**된다 — 도면이 부실한 게 아니라 **도면이 없는 것**인데, 소비자는
   * "용접 기호가 빠졌어요"를 읽는다. 판정 못 한 것이 **틀린 판정**으로 둔갑하는 경우다
   * (같은 원칙: §7-5 — '이상 없음'과 '확인 못 함'은 다른 말이다).
   *
   * 그래서 GA 가 없으면 GA 의존 항목을 FAIL 이 아니라 **N/A(판정 불가)** 로 돌린다.
   * 부품도만으로 판정 가능한 M1·M2·M4 는 그대로 판정한다.
   */
  // ⚠ **생성 실패**만 본다. 호출자가 애초에 GA/부품도를 만들지 않은 경우(빈 문자열)는
  // 그 도면이 정말 없는 것이므로 종전대로 FAIL 이 맞다 — 기존 회귀("부품도 없는 은닉 치수
  // = M1 정직 거부")가 지키는 계약이고, 그것을 깨지 않는다. 260728 에 이 둘을 한 번 뭉쳤다가
  // 그 테스트에 정확히 잡혔다.
  const gaMissing = gaFailed && gaHtml.trim().length === 0;
  const sheetsMissing = sheetsFailed && sheetsHtml.trim().length === 0;
  const naGa = (id, name) => ({ id, name, pass: null, detail: ['GA 도면이 생성되지 않아 판정 불가(도면 부실이 아님)'] });
  /**
   * 소스가 빠졌을 때의 **정확한** 규칙 (260728) — GA 경우보다 한 단계 섬세하다.
   *
   * M1·M2·M4 는 GA+부품도의 **합집합**(`combined`)에서 숫자·문자열을 찾는다. 그래서:
   *  · 찾았으면(PASS) 소스가 하나 빠져 있어도 **그 판정은 옳다** — 실제로 기입돼 있었다는 뜻.
   *  · 못 찾았으면(FAIL) "도면에 없다"와 "그 도면이 생성되지 않았다"를 **구별할 수 없다.**
   * 따라서 소스 결손 시 **FAIL 만 N/A 로 낮추고 PASS 는 그대로 둔다.** 통째로 N/A 로 만들면
   * 멀쩡히 확인된 것까지 미판정으로 버려 과소 보고가 된다.
   */
  const anySourceMissing = gaMissing || sheetsMissing;
  const naIfSourceMissing = (item) => {
    if (!anySourceMissing || item.pass !== false) return item;
    const which = [gaMissing ? 'GA 도면' : null, sheetsMissing ? '부품 제작도' : null].filter(Boolean).join('·');
    return { ...item, pass: null, detail: [`${which}가 생성되지 않아 "도면에 없음"과 구별 불가 — 판정 불가`, ...item.detail] };
  };
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
  const M1 = naIfSourceMissing({ id: 'M1', name: '치수 충분성(파라미터↔기입 치수)', pass: missing.length === 0, detail: missing.slice(0, 12) });

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
  const M2 = naIfSourceMissing({ id: 'M2', name: '구멍표(N×⌀d·⌴⌵·나사)', pass: holed.length ? m2pass : null, detail: m2detail.slice(0, 12) });

  // M3 — 용접기호 실배치
  const M3 = gaMissing
    ? naGa('M3', '용접기호 실배치(KS B 0052 지시선)')
    : { id: 'M3', name: '용접기호 실배치(KS B 0052 지시선)', pass: welds.length ? gaHtml.includes('nf-weldarrow') : null, detail: [] };

  // M4 — 나사 표기
  const taps = holed.flatMap((p) => (p.params.holes ?? []).filter((h) => h.kind === 'tap'));
  const M4 = naIfSourceMissing({ id: 'M4', name: '나사 표기(M호칭×깊이)', pass: taps.length ? /M\d+(?:×\d+)?/.test(combined) : null, detail: [] });

  // M5 — 재질열 + 일반공차 주기
  const M5 = gaMissing
    ? naGa('M5', '재질열+일반공차 주기(표제란)')
    : { id: 'M5', name: '재질열+일반공차 주기(표제란)', pass: combined.includes('재질') && gaHtml.includes('nf-gentol'), detail: [] };

  // M6 — 실윤곽 투영(E1)
  const rotated = (assembly.parts ?? []).some((p) => {
    const a = p.at ?? {};
    return [a.rx ?? 0, a.ry ?? 0, a.rz ?? 0].some((v) => Math.abs(v % 90) > 1e-9);
  });
  const M6 = gaMissing
    ? naGa('M6', '실윤곽 투영(비90° 회전=헐 폴리곤)')
    : { id: 'M6', name: '실윤곽 투영(비90° 회전=헐 폴리곤)', pass: rotated ? gaHtml.includes('<polygon points=') : null, detail: [] };

  const items = [M1, M2, M3, M4, M5, M6];
  const applicable = items.filter((i) => i.pass !== null);
  // ── 근거 충분성(evidence_sufficient) ─────────────────────────────────────
  // 실 CAD 코퍼스가 독립적으로 같은 함정을 잡았다(REAL_CAD_CORPUS_PRIORS §"빈 검증"):
  // "모든 대조가 skip 되고 watertight 만 남아 score 1.0 으로 통과할 뻔 —
  //  게이트가 아무것도 검증 않고 도장 찍는 최악 케이스."
  //
  // 우리도 똑같았다(260728 실측): GA·부품 제작도가 **둘 다 생성 실패**하면 M1~M6 이
  // 전부 N/A 가 되고, `applicable.every(...)` 는 **빈 배열에서 true** 라
  //   score "0/0" · ok true · 소비자 문구 "0/0 (제작 착수 가능 수준)"
  // 이 나갔다. 도면이 안 만들어진 패키지가 제작 착수 가능으로 선언된 것이다.
  //
  // 판정한 것이 하나도 없으면 통과가 아니다. ⚠ 이건 설계 결함이 아니라 산출물 부재이므로
  // 사유를 함께 실어, 소비자가 "도면을 고쳐야 한다"로 오해하지 않게 한다.
  const evidenceSufficient = applicable.length > 0;
  const naCount = items.length - applicable.length;
  return {
    // 분모 붕괴를 감추지 않는다 — "2/2" 와 "6/6" 은 똑같이 100% 로 읽힌다.
    score: `${applicable.filter((i) => i.pass).length}/${applicable.length}`
      + (naCount ? ` (전 ${items.length}항목 중 ${naCount}개 해당없음·판정불가)` : ''),
    items,
    evidenceSufficient,
    ok: evidenceSufficient && applicable.every((i) => i.pass),
    failed: applicable.filter((i) => !i.pass).map((i) => `${i.id} ${i.name}${i.detail.length ? ' — ' + i.detail.join('; ') : ''}`),
    na: items.filter((i) => i.pass === null).map((i) => i.id),
    note: '실시 검도 M1~M6 — 미충족=보완 대상(면책 아님) · 배열 특례 어휘=부품도+STEP 참조 기준(명시)'
      + (evidenceSufficient ? '' : ' · ⚠ 판정한 항목이 0개 — 검도를 수행하지 못했다(통과가 아니다). '
        + '설계 결함이 아니라 대조할 도면 산출물이 없어서다. 도면 생성 실패 원인을 먼저 확인하라.')
      + (gaMissing ? ' · ⚠ GA 도면 미생성 — M3/M5/M6 은 판정하지 못했다(미충족이 아님)' : '')
      + (sheetsMissing ? ' · ⚠ 부품 제작도 미생성 — 합집합 소스가 빠져 미충족 판정은 판정 불가로 낮췄다' : ''),
    ...(gaMissing ? { gaMissing: true } : {}),
    ...(sheetsMissing ? { sheetsMissing: true } : {}),
  };
}

/**
 * 실시 검도 리포트 HTML — 웹 라우트와 MCP 두 발생지가 **같은 소스**를 쓴다.
 * 260728: 이 렌더러는 원래 route.ts 안에 인라인되어 있었고, MCP generate_package 는
 * checkExecutionReadiness 를 **계산해놓고 리포트 파일은 쓰지 않았다** — 판정을 만들어두고
 * 소비자 문서로 내보내지 않는 A-7 패턴 그대로다. 옮기면서 복제하지 않고 여기로 올린다
 * (같은 결함이 두 발생지에서 갈리는 것을 막는 유일한 방법은 소스를 하나로 두는 것이다).
 * @param {object} gate checkExecutionReadiness() 반환값
 * @returns {string} HTML
 */
export function executionReportHtml(gate, { title = 'NexyFab 설계' } = {}) {
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = (gate.items ?? []).map((i) =>
    `<tr><td>${esc(i.id)} ${esc(i.name)}</td><td class="${i.pass === null ? 'na' : i.pass ? 'ok' : 'no'}">${i.pass === null ? 'N/A' : i.pass ? 'PASS' : 'FAIL'}</td><td style="text-align:left">${esc((i.detail ?? []).join('; ') || '—')}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)} — 실시 검도 M1~M6</title>
<style>body{font-family:'Segoe UI','Malgun Gothic',sans-serif;max-width:860px;margin:20px auto;color:#1f2937}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #cbd5e1;padding:6px 10px}th{background:#f1f5f9}.ok{color:#15803d;font-weight:700}.no{color:#b91c1c;font-weight:700}.na{color:#94a3b8}</style></head><body>
<h2>실시 검도 게이트 (M1~M6) — ${esc(gate.score)} ${gate.evidenceSufficient === false
    // 판정 0개를 "보완 필요"로 적으면 설계를 고치라는 뜻으로 읽힌다 — 원인은 산출물 부재다.
    ? '<span class="no">판정 불가</span>'
    : gate.ok ? '<span class="ok">PASS</span>' : '<span class="no">보완 필요</span>'}</h2>
<table><thead><tr><th>항목</th><th>판정</th><th>상세</th></tr></thead><tbody>
${rows}
</tbody></table>
<p style="font-size:12px;color:#64748b">${esc(gate.note)}</p></body></html>`;
}
