/**
 * easy-summary.mjs — 일반인용 결과 요약 1페이지 (260719).
 *
 * 목적: 도면집 산출물(GA·구조검토·BOQ·실시검도)은 전부 전문가 표기라 일반인은
 *       "이걸 들고 뭘 해야 하는지" 모른다. 같은 데이터를 **쉬운 말 5섹션**으로 옮긴
 *       1페이지를 도면집에 동봉한다. 새 계산은 하지 않는다 — 전부 기존 모듈 재사용.
 *
 * 정직 한계(명시):
 *   · 값이 없으면 지어내지 않고 "입력 필요"/"미산출"로 표기한다.
 *   · 안전·인허가를 보증하지 않는다. 자동 생성 결과이며 유자격 기술사 검토·날인 영역은 그대로 남는다.
 *   · 규격은 시판 카탈로그 스냅 결과가 있을 때만 "발주 가능 규격"으로 적고, 없으면 "도면대로 제작".
 *   · 금액(₩)은 어디에도 쓰지 않는다(실단가 없이 산출=날조 — boq.mjs 원칙 승계).
 */
import { buildAssembly } from './assembly.mjs';
import { computeBOQ } from './boq.mjs';
import { auditAssemblyStd } from './std-snap.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// 분야 → 일반인 표기
const DOMAIN_KO = {
  mech: '기계·설비', building: '건축', civil: '토목', bridge: '교량',
  landscape: '조경', interior: '인테리어', process: '플랜트·공정',
};

// 부품 type → 일반인이 알아듣는 이름(발주 시 쓰는 말). 미등록 type 은 type 그대로(정직).
const TYPE_KO = {
  box: '각재/블록', plate_with_holes: '구멍 뚫린 판재', stepped_plate: '단차 판재', base_plate: '베이스 플레이트',
  l_bracket: 'ㄱ자 브래킷', bent_sheet: '절곡 판금', flange: '플랜지', tube: '파이프(중공)', rect_tube: '각파이프',
  cylinder: '봉/원통', gusset: '보강판(거셋)', spur_gear: '평기어', hex_bolt: '육각 볼트', sheet_profile: '판금 형상재',
  wall_with_openings: '개구부 있는 벽체', hex_nut: '육각 너트', washer: '와셔', angle: 'ㄱ형강(앵글)',
  tee_section: 'T형강', pipe_reducer: '이경관(리듀서)', mesh: '자유 형상(메시)', revolve: '회전체',
  cavity_block: '금형 캐비티', coil_spring: '코일 스프링', pillow_block: '베어링 유닛', rebar: '철근',
  pipe_elbow: '엘보', pipe_tee: '티',
};
const typeKo = (t) => TYPE_KO[t] ?? String(t ?? '부재');

// 실시 검도 게이트 M1~M6 → 쉬운 문장. 미등록 id 는 원문 유지(정직).
const GATE_KO = {
  M1: '도면에 빠진 치수가 있어요 — 제작 전에 채워야 합니다.',
  M2: '구멍 규격표가 빠졌어요 — 구멍 크기·위치를 표로 넣어야 업체가 가공할 수 있습니다.',
  M3: '용접 기호가 도면에 표시되지 않았어요 — 어디를 어떻게 붙일지 표기가 필요합니다.',
  M4: '나사 규격 표기(예: M8×20)가 빠졌어요 — 볼트를 못 고릅니다.',
  M5: '재질·일반공차 표기가 빠졌어요 — 업체가 재료와 허용오차를 정할 수 없습니다.',
  M6: '비스듬히 놓인 부재의 실제 외곽선이 도면에 안 나왔어요 — 도면만 보면 크기를 오해할 수 있습니다.',
};

// structural.warnings → 쉬운 문장. **새 판정을 만들지 않는다** — structural 이 이미 낸 경고만
// 옮기고, 수치는 structural.tipover / structural.member 원본값을 그대로 쓴다(요약이 원본보다
// 낙관적이면 안 된다). 미등록 패턴은 GATE_KO 와 같은 사상으로 원문을 그대로 노출(정직).
const STRUCT_KO = [
  {
    re: /정적 전도각/,
    ko: (st) => `<b>그대로 두면 넘어질 수 있습니다(전도 위험).</b> 옆으로 ${st?.tipover?.staticAngleDeg ?? '?'}° 만 기울어도 넘어가는 형태입니다 — 안전 기준은 15° 입니다. 무게중심이 높고 바닥에 닿는 폭이 좁다는 뜻이니, <b>바닥 앵커 고정·받침(아웃리거) 확대·위쪽 무게 줄이기</b> 중 하나가 필요합니다.`,
  },
  {
    re: /측방 전도 FS/,
    ko: (st) => `<b>지진·바람처럼 옆에서 미는 힘에 넘어질 수 있습니다.</b> 옆으로 미는 힘(${st?.tipover?.seismicG ?? '?'}g)에 대한 안전 여유가 <b>${st?.tipover?.seismicFS ?? '?'}</b> 로, 필요한 값 1.5 에 못 미칩니다 — <b>바닥 앵커 고정이나 받침(아웃리거)</b> 없이 세우면 안 됩니다.`,
  },
  {
    re: /^부재 .* 초과/,
    ko: (st) => `<b>기둥·보로 쓴 규격(${st?.member?.section ?? '해당 부재'})이 하중을 견디지 못합니다.</b> 더 두껍거나 큰 규격으로 바꿔야 합니다.`,
  },
];
/** structural.warnings 를 쉬운 말로. 미등록 경고는 원문 그대로 남긴다(누락 금지). */
function structuralCautions(st) {
  return (st?.warnings ?? []).map((w) => {
    const hit = STRUCT_KO.find((r) => r.re.test(String(w)));
    return hit ? hit.ko(st) : `구조 검토에서 걸린 항목: ${esc(String(w))}`;
  });
}

/**
 * FEA(응력해석) 안전율 경고 — structural(강체 전도/CG)과 FEA(TET10 응력)는 서로
 * 독립된 계산이라, structural.ok가 true여도 FEA 안전율이 위험할 수 있다(도그푸딩
 * 발견: 65t 등가하중을 준 50×50×20 철판이 FEA 안전율 0.49·응력초과인데도 이
 * 문서가 읽지 않는 structural만 보고 "이상 없음"으로 표시했다). structural과
 * 별개로 이 문서 전용 안전 판정 소스로 추가한다 — FEA를 새로 계산하지 않고,
 * 호출측이 실제로 산출한 safetyFactor/method만 옮긴다(계산 재구현 금지).
 */
function feaCautions(fea) {
  if (!fea || !Number.isFinite(fea.safetyFactor)) return [];
  if (fea.safetyFactor >= 1.2) return [];
  const sf = fea.safetyFactor.toFixed(2);
  return [
    fea.safetyFactor < 1
      ? `<b>응력 해석(FEA) 안전율 ${sf} — 1 미만, 지금 하중에서 재료 강도를 초과합니다.</b> 재질을 올리거나 단면을 키우기 전에는 제작하면 안 됩니다.`
      : `응력 해석(FEA) 안전율 ${sf}로 여유가 매우 작습니다 — 재질·단면 상향을 검토하세요.`,
  ];
}

/**
 * 도메인 안전검토(피난·목재부재·활하중·하중경로 등, domain-dossier-verify.mjs의
 * domainSafetyVerdict) 경고 — FEA와 같은 이유로 별도 소스: 인테리어 등 비기계
 * 분야는 structural(강체 전도)만으로는 코드 위반(예: 정원 초과·출구 부족)을 전혀
 * 못 잡는다(도그푸딩 발견: 240명 정원에 출구 1개인 패키지가 이 문서에서만
 * "이상 없음"으로 표시됨 — 안전검토.html엔 FAIL이 정확히 떠 있었다). 새 판정을
 * 만들지 않는다 — domainSafetyVerdict가 이미 낸 pass/fail만 옮긴다.
 */
function domainSafetyCautions(domainSafety) {
  if (!domainSafety || domainSafety.ok) return [];
  const items = (domainSafety.failed ?? []).join(', ') || '사유 미상';
  return [`<b>${esc(domainSafety.label)}에서 기준 미달 항목이 있습니다: ${esc(items)}.</b> 지금 상태로는 제작·시공에 들어가면 안 됩니다 — 동봉된 '안전검토.html'에서 자세한 수치를 확인하세요.`];
}

// 표준 동봉 파일 → 용도 1줄. opts.fileNames 가 오면 그 목록에 있는 것만 설명(없는 파일 안내=거짓말).
const FILE_USE = {
  'GA_2D_drawing.html': '전체 배치 도면 — 업체에 제일 먼저 보내는 도면입니다.',
  'GA_3D.html': '3D 미리보기 — 브라우저로 열어 형태를 확인할 때 씁니다.',
  '부품제작도.html': '부품 하나하나의 제작도 — 가공 업체가 실제로 보고 만드는 도면입니다.',
  '제작사양서.html': '제작 사양서 — 재질·표면처리·용접 조건을 글로 적은 문서입니다.',
  'BOQ.html': '물량 산출서 — 견적 요청 시 "얼마나 들어가는지"를 보여줍니다(금액은 없습니다).',
  'BOQ_내역서.xlsx': '물량 엑셀 — 업체가 단가를 채워 넣어 견적서를 만들 수 있습니다.',
  'structural.html': '구조 검토(개산) — 무게·지지 반력 참고자료입니다.',
  'Dossier.html': '설계 설명서 — 무엇을 왜 이렇게 설계했는지 정리한 문서입니다.',
  '실시검도리포트.html': '도면 완성도 점검표 — 제작 착수 전에 보완할 항목이 적혀 있습니다.',
  'GA_plan.dxf': 'CAD 파일(DXF) — 업체가 오토캐드로 열어 수정·가공에 씁니다.',
  'model.step': '3D CAD 파일(STEP) — 가공·해석 업체가 그대로 불러올 수 있습니다.',
  'model.scad': '3D 모델 소스 — 치수를 바꿔 다시 뽑을 때 씁니다.',
  'assembly.ifc': 'BIM 파일(IFC) — 건축·설비 협업 프로그램에서 엽니다.',
  'FEA.html': '응력 해석(개산) — 참고용이며 구조 안전 판정이 아닙니다.',
};

// 비기계 분야(금속가공 원단위·용접 전제가 성립하지 않음) — boq.mjs 와 동일 목록
const NONMECH = new Set(['building', 'landscape', 'interior', 'civil', 'bridge']);

const fmtM = (mm) => (Number.isFinite(mm) ? (mm / 1000).toFixed(mm < 1000 ? 3 : 2) + ' m' : '미산출');

/** 부품 그룹핑(BOM) — 동일 type+params 를 한 줄로 묶고 qty 합산. part-sheets/BOM 관례와 동일 사상. */
function bomGroups(assembly) {
  const map = new Map();
  for (const p of assembly.parts ?? []) {
    // massProxy 는 별도 그룹으로 분리 — 발주·접합 대상이 아니므로 같은 줄에 섞이면 안 된다(F7).
    const proxy = !!p.massProxy;
    const key = p.type + '|' + JSON.stringify(p.params ?? {}) + '|' + (p.material ?? '') + '|' + proxy;
    const qty = Math.max(1, Math.round(Number(p.qty) || 1));
    const g = map.get(key);
    if (g) { g.qty += qty; g.ids.push(p.id ?? p.type); }
    else map.set(key, { type: p.type, params: p.params ?? {}, material: p.material ?? '', qty, ids: [p.id ?? p.type], proxy });
  }
  return [...map.values()];
}

// 금속 카탈로그(각형강관·T슬롯·베어링·배관)는 목재·콘크리트 부재에 적용할 수 없다 —
// std-snap 이 단면 치수만 보고 스냅한 결과를 재질과 대조해 걸러낸다(엉뚱한 발주 규격 제시 방지).
const NONMETAL = /timber|wood|목재|concrete|콘크리트|glass|유리|stone|석재|plastic|acrylic|가공석/i;
const METAL_KIND = new Set(['squareTube', 'tslot', 'bearingUnit', 'pipe']);

/** 규격 문구 — std-snap 이 발주 가능 규격으로 스냅했을 때만 그 라벨, 아니면 "도면대로 제작". */
function specText(g, stdById) {
  for (const id of g.ids) {
    const hit = stdById.get(id);
    if (!hit?.snap?.ok || !hit.snap.label) continue;
    if (METAL_KIND.has(hit.kind) && NONMETAL.test(String(g.material))) continue; // 재질 불일치 = 제시 안 함
    return { text: hit.snap.label, orderable: true };
  }
  const p = g.params;
  const dims = [];
  if (Number.isFinite(p.width) && Number.isFinite(p.depth)) dims.push(`${p.width}×${p.depth}`);
  if (Number.isFinite(p.height)) dims.push(`H${p.height}`);
  if (Number.isFinite(p.length)) dims.push(`L${p.length}`);
  if (Number.isFinite(p.thickness)) dims.push(`t${p.thickness}`);
  if (Number.isFinite(p.outerDia)) dims.push(`⌀${p.outerDia}`);
  if (Number.isFinite(p.diameter)) dims.push(`⌀${p.diameter}`);
  return { text: dims.length ? `도면대로 제작 (${dims.join(' · ')} mm)` : '도면대로 제작 (치수는 부품도 참조)', orderable: false };
}

/**
 * 일반인용 결과 요약 HTML 1페이지.
 * @param {object} assembly  parts[] 어셈블리(도메인 템플릿 산출물 포함)
 * @param {object} [opts]
 * @param {string} [opts.title]         문서 제목(없으면 assembly.name)
 * @param {string} [opts.domain]        분야(없으면 assembly.domain → 'mech')
 * @param {object} [opts.executionGate] checkExecutionReadiness() 결과 — **호출자가 넘길 때만** 표시
 * @param {string[]} [opts.fileNames]   실제 동봉 파일명 목록 — 주면 그 파일만 용도 안내
 * @param {object} [opts.fea]           FEA(응력해석) 결과 요약 — **호출자가 넘길 때만** 안전 판정에
 *   반영. `{ safetyFactor: number, method?: string }`. structural(강체 전도/CG)과는 독립적인 계산이므로,
 *   FEA.html을 생성했다면 반드시 이걸 넘겨야 이 문서의 종합 판정에 위험이 드러난다(F2와 동일 원칙).
 * @param {object} [opts.domainSafety]  도메인 안전검토(피난·목재부재·활하중·하중경로) 압축 판정 —
 *   `domain-dossier-verify.mjs`의 `domainSafetyVerdict(assembly, params)` 반환값을 **호출자가 그대로
 *   넘길 때만** 반영. `{ label: string, ok: boolean, failed: string[] }`. '안전검토.html'을 생성했다면
 *   반드시 이걸 넘겨야 이 문서의 종합 판정에 코드 위반(정원 초과·출구 부족 등)이 드러난다(FEA와 동일 원칙 —
 *   260723 도그푸딩 발견: 이걸 안 넘겨서 출구 부족 패키지가 이 문서에서만 "이상 없음"으로 표시됐었다).
 * @returns {string} 자립형 HTML
 */
export function easySummary(assembly, opts = {}) {
  const title = opts.title ?? assembly?.name ?? '설계';
  const domain = opts.domain ?? assembly?.domain ?? 'mech';
  const domainKo = DOMAIN_KO[domain] ?? domain;

  const built = buildAssembly(assembly ?? {});
  // 게이트 실패=요약할 형상이 없음 — 지어내지 않고 사유만 안내(정직).
  if (!built.ok) {
    return page(title, domainKo, `<section><h2>① 이게 뭔가요</h2>
<p class="warn">형상이 아직 완성되지 않아 요약을 만들 수 없습니다. 아래 항목을 먼저 고쳐 주세요.</p>
<ul>${(built.gateErrors ?? []).map((e) => `<li>${esc(e)}</li>`).join('') || '<li>사유 미상 — 입력 필요</li>'}</ul></section>`);
  }

  let boq = null;
  try { boq = computeBOQ(assembly); } catch { boq = null; }
  let std = { items: [], warnings: [] };
  try { std = auditAssemblyStd(assembly) ?? std; } catch { /* 규격 대조 실패 시 빈 목록 — 없는 규격을 지어내지 않는다 */ }
  const stdById = new Map((std.items ?? []).map((i) => [i.id, i]));

  // ① 크기·무게·개수
  const aabbs = built.parts ?? [];
  const env = [0, 1, 2].map((k) => (aabbs.length
    ? Math.max(...aabbs.map((p) => p.aabb.max[k])) - Math.min(...aabbs.map((p) => p.aabb.min[k]))
    : NaN));
  const structural = built.structural ?? null;
  let massKg = Number.isFinite(structural?.totalMassKg) ? structural.totalMassKg
    : Number.isFinite(boq?.totalMassKg) ? boq.totalMassKg : null;
  // 표시 프록시(massProxy) 질량 제외 — 수관 구체 등은 체적×밀도가 실중량과 무관하므로
  // 총 무게에 넣으면 일반인이 수십 t 로 오독한다(260719b). 제외분은 문장으로 고지.
  const proxyIds = new Set((assembly.parts ?? []).filter((p) => p.massProxy).map((p) => p.id));
  let proxyNote = '';
  if (proxyIds.size && massKg != null && Array.isArray(structural?.massBreakdown)) {
    const proxyMass = structural.massBreakdown.filter((r) => proxyIds.has(r.id)).reduce((s, r) => s + (r.massKg || 0), 0);
    if (proxyMass > 0) {
      massKg = Math.max(0, +(massKg - proxyMass).toFixed(1));
      proxyNote = ` 표시용 형상(${proxyIds.size}개 — 예: 수목 수관)은 실제 무게와 무관하므로 총 무게에서 뺐습니다.`;
    }
  }
  const massText = massKg == null ? '미산출' : massKg >= 1000 ? `${(massKg / 1000).toFixed(1)} t (${Math.round(massKg)} kg)` : `${massKg} kg`;
  const partCount = (assembly.parts ?? []).length;

  const s1 = `<section><h2>① 이게 뭔가요</h2>
<p>이 도면집은 <b>${esc(title)}</b>(분야: ${esc(domainKo)}) 한 세트를 만들기 위한 자료입니다.</p>
<div class="kpi">
  <div><b>${esc(fmtM(env[0]))} × ${esc(fmtM(env[1]))} × ${esc(fmtM(env[2]))}</b><span>전체 크기 (가로×세로×높이)</span></div>
  <div><b>${esc(massText)}</b><span>총 무게${massKg == null ? ' — 재질 입력 필요' : ' (개산)'}</span></div>
  <div><b>${partCount}개</b><span>부재(부품) 개수</span></div>
</div>
<p class="sub">크기는 부재가 차지하는 전체 범위입니다. 무게는 형상×재질 밀도로 계산한 개산값이며, 볼트·마감·부속은 포함되지 않습니다.${esc(proxyNote)}</p></section>`;

  // ② 무엇을 사면 되나요
  const allGroups = bomGroups(assembly);
  // ①에서 "무게에서 뺐다"고 밝힌 표시용 형상을 ②에서 다시 발주 대상으로 세지 않는다(F7).
  const groups = allGroups.filter((g) => !g.proxy);
  const proxyGroups = allGroups.filter((g) => g.proxy);
  const rows = groups.map((g) => {
    const sp = specText(g, stdById);
    return `<tr><td class="l">${esc(typeKo(g.type))}</td><td class="l">${esc(sp.text)}${sp.orderable ? ' <span class="tag ok">발주 규격</span>' : ' <span class="tag">제작품</span>'}</td><td>${g.qty}</td><td>${esc(g.material || '입력 필요')}</td></tr>`;
  }).join('');
  const stdWarn = (std.warnings ?? []).length
    ? `<p class="warn">규격 확인이 필요한 항목이 ${std.warnings.length}건 있습니다 — 시판 규격과 치수가 달라 그대로는 주문이 어려울 수 있습니다.</p>
<ul class="small">${std.warnings.slice(0, 8).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
    : '<p class="sub">시판 규격 대조에서 걸린 항목은 없습니다. (대조 대상이 아닌 부재는 검사하지 않습니다.)</p>';
  const s2 = `<section><h2>② 무엇을 사면 되나요</h2>
<table><thead><tr><th>부재</th><th>규격</th><th>개수</th><th>재질</th></tr></thead><tbody>${rows || '<tr><td colspan="4">부재 없음 — 입력 필요</td></tr>'}</tbody></table>
<p class="sub"><b>발주 규격</b>은 철물점·자재상에서 그대로 주문할 수 있는 시판 규격입니다. <b>제작품</b>은 가공 업체에 도면을 주고 만들어야 합니다.</p>
${proxyGroups.length ? `<p class="sub"><b>아래는 표시용 형상입니다 — 발주·제작 대상이 아닙니다.</b> 도면에서 자리와 크기를 보여주기 위한 것이며(예: 수목 수관), 무게에도 접합 계산에도 넣지 않았습니다.</p>
<table><thead><tr><th>표시용 형상</th><th>크기</th><th>개수</th></tr></thead><tbody>${proxyGroups.map((g) => `<tr><td class="l">${esc(typeKo(g.type))}</td><td class="l">${esc(specText(g, new Map()).text.replace('도면대로 제작', '도면 표기'))}</td><td>${g.qty}</td></tr>`).join('')}</tbody></table>` : ''}
${stdWarn}</section>`;

  // ③ 만들 때 주의할 점
  const cautions = [];
  // 표시용 형상(massProxy)이 낀 접합은 계상하지 않는다 — 나무를 용접하라고 지시하게 된다(F7).
  const welds = (built.welds ?? []).filter((w) => !proxyIds.has(w.a) && !proxyIds.has(w.b));
  const weldMm = welds.reduce((s, w) => s + (Number(w.lengthMm) || 0), 0);
  const weldM = welds.length === (built.welds ?? []).length && Number.isFinite(built.weldTotalMm)
    ? built.weldTotalMm / 1000
    : (Number.isFinite(weldMm) ? weldMm / 1000 : null);
  if (welds.length) {
    // 비기계 분야는 "용접"으로 단정하지 않는다 — 접합 방식(용접·볼트·목재 철물)은 재질·공법이 정한다.
    // (boq.mjs 가 비기계 분야 용접 공수를 산출하지 않는 것과 같은 사유 — 없는 근거로 단정하지 않음)
    cautions.push(NONMECH.has(domain)
      ? `부재끼리 맞닿아 <b>접합해야 하는 곳이 ${welds.length}군데</b>, 접합선 총 길이 ${weldM == null ? '미산출' : weldM.toFixed(2) + ' m'}입니다 — 접합 방법(용접·볼트·목재 철물 등)은 재질과 공법에 따라 정해야 합니다.`
      : `용접이 ${welds.length}군데, 총 길이 ${weldM == null ? '미산출' : weldM.toFixed(2) + ' m'} 필요합니다 — 용접 가능한 업체를 찾아야 합니다.`);
  }
  const floating = built.support?.floating ?? [];
  if (floating.length) {
    cautions.push(`<b>부유 부품 ${floating.length}개</b> — 바닥이나 다른 부재에 닿아 있지 않아 그대로는 세울 수 없습니다. 받침을 추가하거나 위치를 낮춰야 합니다: ${floating.slice(0, 6).join(', ')}${floating.length > 6 ? ' 외' : ''}`);
  }
  const unknownSup = built.support?.unknown ?? [];
  if (unknownSup.length) cautions.push(`지지 여부를 판정할 수 없는 부재 ${unknownSup.length}개 — 치수 입력 필요: ${unknownSup.slice(0, 6).join(', ')}`);
  const itf = built.interferences ?? [];
  if (itf.length) {
    cautions.push(`<b>부품끼리 겹치는 곳 ${itf.length}군데</b> — 실제로는 들어가지 않는 자리가 있습니다. 제작 전에 도면을 고쳐야 합니다: ${itf.slice(0, 4).map((i) => `${i.a}↔${i.b}`).join(', ')}`);
  }
  const eg = opts.executionGate ?? null;
  if (eg && Array.isArray(eg.failed)) {
    for (const f of eg.failed) {
      const id = String(f).slice(0, 2);
      cautions.push(GATE_KO[id] ?? `도면 점검 항목 미충족: ${f}`);
    }
  }
  // 구조 안전 판정 — structural.html/FEA.html 을 읽지 않을 사람 전용 문서이므로,
  // 여기서 빠지면 안전 경고가 어디에도 도달하지 않는다(F2). structural·FEA 각각이
  // 낸 것만 옮기고 새로 계산하지 않는다. structural(강체 전도/CG)과 FEA(응력)는
  // 서로 독립된 계산이라 한쪽만 보면 안 된다 — structural.ok=true인데 FEA 안전율이
  // 위험한 경우가 실제로 있었다(도그푸딩: 과하중 철판이 FEA는 초과인데 이 문서는
  // structural만 보고 "이상 없음"으로 표시).
  const structCautions = structuralCautions(structural);
  const feaCautionList = feaCautions(opts.fea);
  const domainSafetyCautionList = domainSafetyCautions(opts.domainSafety);
  const allSafetyCautions = [...structCautions, ...feaCautionList, ...domainSafetyCautionList];
  const feaFailed = !!opts.fea && Number.isFinite(opts.fea.safetyFactor) && opts.fea.safetyFactor < 1.2;
  const domainSafetyFailed = !!opts.domainSafety && opts.domainSafety.ok === false;
  const safetyBlock = structural == null && !opts.fea && !opts.domainSafety
    ? '<p class="sub">구조 검토(무게·전도)가 산출되지 않았습니다 — 안전 판정은 이 요약에 없습니다. 동봉된 구조 검토 문서를 확인하세요.</p>'
    : allSafetyCautions.length
      ? `<p class="warn"><b>⚠ 안전 경고 — 지금 형상 그대로 만들면 위험합니다.</b> 구조 검토(개산)에서 아래 ${allSafetyCautions.length}건이 걸렸습니다. 만들기 전에 반드시 해결하거나 기술사 검토를 받으세요.</p>
<ul>${allSafetyCautions.map((c) => `<li>${c}</li>`).join('')}</ul>`
      : '<p class="sub">구조 검토(개산)에서 걸린 안전 경고는 없습니다 — 다만 이는 형상·무게 기준 개산이며, 실제 지반·바람·지진·사용 하중은 반영되어 있지 않습니다(안전 보증 아님).</p>';
  // 종합 판정(구조 + FEA + 도메인 안전검토 + 형상 타당성)을 한 줄로 — 어느 쪽이든 FAIL 이면 요약에서도 FAIL 로 보여야 한다.
  const structVerdictFailed = structural?.ok === false || built.designOk === false || feaFailed || domainSafetyFailed;
  const feaVerdictText = opts.fea && Number.isFinite(opts.fea.safetyFactor)
    ? ` · 응력 해석(개산) <b>${feaFailed ? '보완 필요' : '이상 없음'}</b>`
    : '';
  const domainSafetyVerdictText = opts.domainSafety
    ? ` · ${esc(opts.domainSafety.label)} <b>${domainSafetyFailed ? '보완 필요' : '이상 없음'}</b>`
    : '';
  const verdict = `<p class="${structVerdictFailed ? 'warn' : 'sub'}">자동 점검 종합: 구조 안전(개산) <b>${structural == null ? '미산출' : structural.ok ? '이상 없음' : '보완 필요'}</b>${feaVerdictText}${domainSafetyVerdictText} · 형상 타당성(부유·간섭·배관) <b>${built.designOk == null ? '미산출' : built.designOk ? '이상 없음' : '보완 필요'}</b>${structVerdictFailed ? ' — 보완 없이 제작에 들어가면 안 됩니다.' : ''}</p>`;

  const s3 = `<section><h2>③ 만들 때 주의할 점</h2>
${safetyBlock}
${cautions.length
    ? `<ul>${cautions.map((c) => `<li>${c}</li>`).join('')}</ul>`
    : '<p class="sub">형상 점검(부유·간섭·접합·도면 표기)에서 걸린 항목은 없습니다. 이 점검은 형상·표기만 봅니다 — 안전 판정은 위의 구조 검토 결과를 따르세요.</p>'}
${verdict}
${eg ? `<p class="sub">도면 점검 결과: ${esc(eg.score ?? '미산출')} ${eg.ok ? '(제작 착수 가능 수준)' : '(위 항목 보완 필요)'}</p>` : '<p class="sub">도면 점검(실시 검도) 결과는 이 요약에 포함되지 않았습니다 — 동봉된 검도 리포트를 확인하세요.</p>'}</section>`;

  // ④ 다음에 뭘 하나요
  // 실제 동봉 목록이 있을 때만 파일별 용도를 적는다 — 목록이 없으면 "무엇이 들어있는지 모른다"가
  // 사실이므로 전체 카탈로그를 나열하지 않는다(없는 파일 안내=거짓 안내).
  const hasList = Array.isArray(opts.fileNames) && opts.fileNames.length > 0;
  const names = hasList ? opts.fileNames.filter((n) => FILE_USE[n]) : [];
  const unknownFiles = hasList ? opts.fileNames.filter((n) => !FILE_USE[n]) : [];
  const fileRows = hasList
    ? names.map((n) => `<li><code>${esc(n)}</code> — ${esc(FILE_USE[n])}</li>`).join('')
      + unknownFiles.map((n) => `<li><code>${esc(n)}</code> — 용도 설명 미등록(파일은 동봉됨)</li>`).join('')
    : '<li>동봉 파일 목록이 전달되지 않았습니다 — 실제 받은 폴더의 파일을 그대로 보내세요.</li>';
  const expertNeeds = [];
  // 인허가 안내 기준(F11) — 종전 조건은 `domain !== 'mech'` 뿐이라 가구 한 점(카운터 바)에도
  // 건축신고를 요구했다. 판정을 **대지에 정착하는 구조물인가**로 바꾼다:
  //  · ALWAYS: building·civil·bridge·process — 정의상 건축물/공작물/플랜트(건축법·국토안전·소방/위험물)
  //  · landscape: 파고라·정자 등은 건축법 제83조 공작물 축조신고 대상이 되는 일이 잦아 포함(안전측)
  //  · interior·mech: 원칙적으로 제품·가구이나, **사람이 밑을 지나거나 실 규모를 차지하면**
  //    (높이 2.4 m 이상 = 통상 실내 층고 수준, 또는 바닥 점유 30 m² 이상) 공작물·대수선 소지가
  //    있어 포함. 그 미만이라도 "필요 없다"고 단정하지 않고 관할 확인 안내를 남긴다(안전측).
  // 애매하면 요구하는 쪽으로 기운다 — 빠뜨린 인허가가 불필요한 확인보다 훨씬 비싸기 때문.
  const PERMIT_DOMAINS = new Set(['building', 'civil', 'bridge', 'process', 'landscape']);
  const footprintM2 = Number.isFinite(env[0]) && Number.isFinite(env[1]) ? (env[0] / 1000) * (env[1] / 1000) : 0;
  const structureScale = (Number.isFinite(env[2]) && env[2] >= 2400) || footprintM2 >= 30;
  if (PERMIT_DOMAINS.has(domain) || structureScale) expertNeeds.push('건축물·구조물 인허가(건축신고·공작물 축조신고·구조안전확인) 해당 여부 — 대지에 정착하는 구조물이면 착공 전 신고가 필요합니다.');
  else expertNeeds.push('설치 장소에 따라 별도 인허가(소방·전기·가스, 임대 건물이면 건물주 승인)가 필요할 수 있습니다 — 관할 기관·건물 관리주체에 확인하세요.');
  expertNeeds.push('구조 안전성 최종 확인 — 이 문서의 구조 계산은 개산이며 법적 효력이 없습니다.');
  if (welds.length) expertNeeds.push(NONMECH.has(domain) ? '부재 접합 방법·접합부 품질 기준' : '용접부 품질 기준(용접사 자격·검사 방법)');
  if (built.pipes?.routes?.length) expertNeeds.push('배관 계통 압력·재질 적합성');
  if (structCautions.length) expertNeeds.push('③의 안전 경고(전도·부재 하중) 해소 — 앵커·받침·단면 상향 방안은 구조기술사가 정해야 합니다.');
  if (floating.length || itf.length) expertNeeds.push('위 ③의 형상 문제를 고친 뒤 재검토');
  const s4 = `<section><h2>④ 다음에 뭘 하나요</h2>
<ol class="steps">
  <li><b>도면을 출력하거나 그대로 전달하세요.</b> HTML 파일은 브라우저로 열고 "인쇄 / PDF" 버튼을 누르면 A4로 나옵니다.</li>
  <li><b>업체에 견적을 문의하세요.</b> 아래 파일을 함께 보내면 됩니다.
    <ul class="small">${fileRows}</ul>
  </li>
  <li><b>전문가 확인이 필요한 항목이 남아 있습니다.</b>
    <ul class="small">${expertNeeds.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
  </li>
</ol></section>`;

  // ⑤ 꼭 알아두세요
  const s5 = `<section><h2>⑤ 꼭 알아두세요</h2>
<div class="honest">
<p><b>이 문서는 자동 생성 결과이며, 인허가·구조안전 확인은 유자격 기술사의 검토·날인이 필요합니다.</b></p>
<ul class="small">
  <li>비법정 문서입니다 — 관공서 제출·인허가 도서로 쓸 수 없습니다.</li>
  <li>무게·구조·용접량은 형상에서 계산한 <b>개산</b>이며, 실제 시공 조건(지반·풍하중·지진·사용 하중)은 반영되어 있지 않습니다.</li>
  <li>금액(₩)은 산출하지 않습니다 — 실단가·노임 데이터 없이 만든 금액은 사실이 아니기 때문입니다. 견적은 업체에서 받으세요.</li>
  <li>이 요약은 쉬운 말로 옮긴 것입니다. 값이 다르게 보이면 <b>원본 도면·리포트가 기준</b>입니다.</li>
</ul>
</div></section>`;

  return page(title, domainKo, s1 + s2 + s3 + s4 + s5);
}

// 자립형 HTML 셸(인라인 CSS — boq.mjs·실시검도 리포트 스타일 계열)
function page(title, domainKo, body) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — 쉬운 요약</title>
<style>@page{size:A4 portrait;margin:12mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937;font-size:14px;line-height:1.7}
.nf-print-bar{position:sticky;top:0;z-index:9;background:#1f2937;color:#fff;padding:7px 16px;font-size:12.5px;display:flex;gap:12px;align-items:center}.nf-print-bar button{background:#2563eb;color:#fff;border:0;padding:5px 13px;border-radius:6px;cursor:pointer}
.sheet{max-width:900px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 26px}
.hd{padding:18px 26px;border-bottom:2px solid #1f2937}.hd h1{margin:0;font-size:20px}.hd .s{color:#64748b;font-size:12.5px;margin-top:4px}
section{padding:0 26px}h2{font-size:16px;margin:22px 0 8px;padding-bottom:5px;border-bottom:1px solid #e2e8f0}
p{margin:6px 0}ul,ol{margin:6px 0;padding-left:22px}li{margin:3px 0}
.sub{font-size:12.5px;color:#64748b}.small{font-size:12.5px}
.warn{background:#fef2f2;border-left:4px solid #dc2626;padding:8px 12px;color:#991b1b;font-size:13px}
.kpi{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.kpi div{flex:1;min-width:150px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:9px 13px}.kpi b{display:block;font-size:17px;color:#2563eb}.kpi span{font-size:11px;color:#64748b}
table{border-collapse:collapse;width:100%;font-size:12.5px;margin:8px 0}td,th{border:1px solid #cbd5e1;padding:5px 9px;text-align:center}th{background:#f1f5f9}td.l{text-align:left}
.tag{display:inline-block;font-size:10.5px;background:#f1f5f9;color:#64748b;border-radius:4px;padding:1px 6px}.tag.ok{background:#dcfce7;color:#15803d}
.steps>li{margin:10px 0}code{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:12px}
.honest{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;color:#92400e;font-size:13px}
@media print{.nf-print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body><div class="nf-print-bar"><b>쉬운 요약 — 처음 보시는 분용</b><button onclick="print()">🖨 인쇄 / PDF</button></div>
<div class="sheet"><div class="hd"><h1>${esc(title)} — 쉬운 요약</h1><div class="s">nexyfab 자동 생성 · 분야 ${esc(domainKo)} · 비법정 문서(인허가·구조안전 확인은 유자격 기술사 영역)</div></div>
${body}
</div></body></html>`;
}
