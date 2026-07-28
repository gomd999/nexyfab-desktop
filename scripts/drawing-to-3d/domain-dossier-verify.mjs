/**
 * domain-dossier-verify.mjs — 도시에 "검증" 문서(③ 형상+검증 한 장).
 *
 * 어셈블리(형상)에 심긴 검증 메타(retainingWall·boxCulvert…)를 감지해 engineering-core의
 * **진짜 계산기**(verifyDomain)를 돌리고, 그 KDS 대조 결과(전도·활동·지지력·편심 등)를
 * 도시에에 실을 수 있는 HTML로 렌더한다. 도시에의 structural.html(강체 근사 개념검토)과
 * 달리, 여기는 분야 코드 대조(인용 조항 포함)를 **실행값**으로 싣는다.
 *
 * 정직성:
 *  · 하중을 지어내지 않는다. 옹벽 토압은 형상+토질(기본값 명시)에서 계산기가 산출하므로
 *    외부하중 없이 검증 가능. 외부하중이 꼭 필요한데 없으면 INPUT_GATE("이 값 필요")를
 *    그대로 보여준다(억지 통과 없음).
 *  · 형상 파생 입력과 가정(기본값)을 분리 표기(provenance) — 어디까지가 형상이고 어디부터
 *    가정인지 숨기지 않는다.
 *  · 계산기 status=draft(공표예제 게이트 확충중) + 비법정 disclaimer 그대로 전달.
 *  · 적용 가능한 검증이 없으면 null 반환 → 파일을 만들지 않는다(없는 검증을 지어내지 않음).
 */
import { verifyDomain } from './domain-verify.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const f = (n, d = 2) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '-');

/** 어셈블리 메타 → 적용 가능한 검증 목록(형상이 검증 입력을 줄 수 있는 것만). */
function planVerifications(assembly) {
  const out = [];
  if (assembly?.retainingWall) out.push({ domain: 'civil', calculatorId: 'retaining_wall_stability', label: '옹벽 안정 (전도·활동·지지력·편심)' });
  if (assembly?.boxCulvert) out.push({ domain: 'civil', calculatorId: 'box_culvert_frame', label: '박스 암거 라멘 단면력' });
  return out;
}

/** 적용 가능한 검증을 모두 실행 → [{domain, calculatorId, label, result}]. */
export function runDossierVerifications(assembly, params = {}) {
  return planVerifications(assembly).map((v) => ({
    ...v,
    result: verifyDomain({ intent: assembly, domain: v.domain, calculatorId: v.calculatorId, params }),
  }));
}

const badge = (verdict) => {
  if (verdict === 'PASS') return '<span style="color:#16a34a;font-weight:700">적합 ✓ (PASS)</span>';
  if (verdict === 'FAIL') return '<span style="color:#dc2626;font-weight:700">검토 ✕ (FAIL)</span>';
  if (verdict === 'INFO') return '<span style="color:#2563eb;font-weight:700">단면력 산출 ℹ (INFO)</span>';
  return `<span style="color:#64748b;font-weight:700">${esc(verdict ?? '—')}</span>`;
};

/**
 * check 객체의 숫자 필드를 "키=값" 압축(FS·값 위주). null(=지압 성립 불가 등 계산기가
 * 명시적으로 산출 불가라 표시한 값)은 숨기지 않고 "—"로 표기 — 예) 전도 벽의
 * qmax_kPa:null이 그냥 사라지면 "qmin=0.0 ≤ allow=200.0 FAIL"만 남아 자기모순으로
 * 읽힌다. calculator의 `note`(엣지케이스 설명, 예: "합력이 저판 외부…")도 예전엔
 * 항상 스킵돼 무엇이 왜 FAIL인지 설명이 도세에서 통째로 증발했다 — 존재하면 덧붙인다.
 */
function checkNums(chk) {
  const skip = new Set(['pass', 'label', 'name', 'note', 'unit']);
  const entries = Object.entries(chk).filter(([k, v]) => {
    if (skip.has(k)) return false;
    if (typeof v === 'number') return Number.isFinite(v);
    return v === null;
  });
  const nums = entries
    .slice(0, 5)
    .map(([k, v]) => (v === null ? `${k}=—` : `${k}=${f(v, k.toLowerCase().includes('fs') || k === 'e' ? 2 : 1)}`));
  const base = nums.join(', ') || '—';
  return typeof chk.note === 'string' && chk.note ? `${base} — ${chk.note}` : base;
}

function citationText(c) {
  if (!c) return '';
  if (typeof c === 'string') return c;
  return [c.code ?? c.id ?? c.clause, c.title ?? c.name ?? c.labelKo].filter(Boolean).join(' ');
}

function renderRun(run) {
  const r = run.result;
  const L = [];
  L.push(`<h2>${esc(run.label)}</h2>`);
  if (r.ok) {
    const isInfo = r.verdict === 'INFO';
    L.push(`<div class="card">${isInfo ? '결과' : '종합 판정'}: ${badge(r.verdict)}${isInfo ? ' — 단면력 산출(합·불 판정 아님, 배근·단면 검토는 별도)' : ''}</div>`);
    const checks = r.checks && typeof r.checks === 'object' ? Object.entries(r.checks) : [];
    if (checks.length) {
      L.push('<table><tr><th>검토 항목</th><th>실측값</th><th>판정</th></tr>');
      for (const [k, c] of checks) {
        if (!c || typeof c !== 'object') continue;
        L.push(`<tr><td style="text-align:left">${esc(c.labelKo ?? c.label ?? k)}</td><td>${esc(checkNums(c))}</td><td>${c.pass ? '적합 ✓' : '검토 ✕'}</td></tr>`);
      }
      L.push('</table>');
    }
    // 단면력(모멘트) — box_culvert 등 INFO형 계산기의 실체 산출값
    if (r.moments && typeof r.moments === 'object' && Object.keys(r.moments).length) {
      L.push('<table><tr><th>부재 위치</th><th>모멘트 (kN·m)</th></tr>');
      for (const [k, v] of Object.entries(r.moments)) if (typeof v === 'number') L.push(`<tr><td style="text-align:left">${esc(k)}</td><td>${f(v, 2)}</td></tr>`);
      L.push('</table>');
    }
    // 형상 파생 vs 가정(기본값) — 정직 표기
    const geom = r.provenance?.geometry ?? [];
    const user = r.provenance?.user ?? [];
    L.push(`<div class="prov"><b>입력 출처</b> · 형상 파생: <code>${geom.map(esc).join(', ') || '—'}</code> · 가정/기본값: <code>${user.map(esc).join(', ') || '—'}</code></div>`);
    // 인용 조항
    const cites = Array.isArray(r.citations) ? r.citations.map(citationText).filter(Boolean) : [];
    if (cites.length) L.push(`<div class="cite"><b>대조 기준</b>: ${cites.slice(0, 6).map(esc).join(' · ')}</div>`);
    if (r.status) L.push(`<div class="note">${esc(r.status)}</div>`);
  } else if (Array.isArray(r.needInputs) && r.needInputs.length) {
    // INPUT_GATE — 하중을 지어내지 않고 필요한 입력을 되돌린다(정직)
    L.push('<div class="card warn"><b>검증하려면 다음 입력이 필요합니다</b>(값을 지어내지 않습니다):<ul style="margin:6px 0">'
      + r.needInputs.map((s) => `<li>${esc(s.labelKo ?? s.name)}${s.unit ? ` (${esc(s.unit)})` : ''}</li>`).join('') + '</ul></div>');
  } else {
    L.push(`<div class="card warn">검증 불가: ${esc(r.error ?? r.gateError ?? '알 수 없는 사유')}</div>`);
  }
  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 도메인별 안전/코드 체크(egress·목재부재·교량 활하중·하중경로) — 도세 패키지
// 안전검토.html. `verifyDomain`(civil의 retainingWall/boxCulvert)과 달리 이
// 체크들은 함수마다 결과 모양이 다르고(다중 섹션·중첩) 앞으로도 바뀔 수 있어,
// renderRun처럼 손으로 스키마를 맞추는 대신 실제 반환값을 있는 그대로 그리는
// **스키마 불문 제네릭 렌더러**를 쓴다 — 판정을 지어내지 않고, 서브결과를
// 숨기지도 않는다(도그푸딩이 잡은 원 결함: 이 체크들이 도세에서 아예 호출조차
// 안 돼 인테리어/조경/교량 문서가 피난·목재·활하중 검토 없이 나가고 있었다).
// ─────────────────────────────────────────────────────────────────────────────
import { interiorCheck } from './interior-check.mjs';
import { interiorComponentCheck } from './interior-component-check.mjs';
import { landscapeCheck } from './landscape-check.mjs';
import * as bridgeMod from './bridge-check.mjs';
import { loadPathCheck } from './load-path.mjs';
import { shearWallCheck } from './shear-wall-check.mjs';
import { mechCheck } from './mech-check.mjs';

const BRIDGE_DISPATCH = [
  { meta: 'archMeta', fn: 'archBridgeCheck' },
  { meta: 'trussMeta', fn: 'trussBridgeCheck' },
  { meta: 'cableStayedMeta', fn: 'cableStayedCheck' },
  { meta: 'suspensionMeta', fn: 'suspensionCheck' },
  { meta: 'stairMeta', fn: 'stairCheck' },
];

/** Which domains have a wired safety/code check, and how to run it. Returns
 *  null when the domain has no applicable check (e.g. 'mech' — a mechanical
 *  part has no egress/timber/bridge-load concept) so no file is forced. */
function runDomainSafetyCheck(assembly, params) {
  const domain = assembly?.domain;
  if (domain === 'interior') {
    // 260729: interior 도 무조건 interiorCheck(피난·수용인원)로 갔다 — building 이 무조건
    // loadPathCheck 로 가던 것과 같은 고정 배선. 붙박이장·카운터바·칸막이벽·천장그리드는
    // **방이 아니라 부분 요소**라 roomBounds 가 없는 게 맞는데 "메타 필요"로 거부됐다.
    const comp = interiorComponentCheck(assembly);
    if (comp) return { label: comp.label ?? '실내 부분요소 검토', result: comp };
    return { label: '실내건축 검토 (피난·수용인원 등)', result: interiorCheck(assembly, params) };
  }
  if (domain === 'landscape') return { label: '조경 검토 (목재부재·배수 등)', result: landscapeCheck(assembly, params) };
  if (domain === 'bridge') {
    const disp = BRIDGE_DISPATCH.find((d) => assembly[d.meta] && typeof bridgeMod[d.fn] === 'function');
    const fn = disp ? bridgeMod[disp.fn] : bridgeMod.bridgeCheck;
    return { label: '교량 검토 (활하중·단면력 등)', result: fn(assembly, params) };
  }
  if (domain === 'building') {
    // 260729: building 은 **무조건 loadPathCheck** 였다 — bridge·mech 가 선언 메타로
    // 디스패치하는 것과 달리 유일하게 도메인 단위 고정 배선이었다. 그 결과 계단이
    // 라멘 골조 검토로 넘어가 "role 태깅 필요"로 거부됐는데, 정작 `stairCheck`
    // (bridge-check.mjs, 트레드 휨·스트링거 휨)는 **존재하면서 놀고 있었다.**
    if (assembly.stairMeta && typeof bridgeMod.stairCheck === 'function') {
      return { label: '계단 검토 (트레드·스트링거 휨)', result: bridgeMod.stairCheck(assembly, params) };
    }
    const lp = loadPathCheck(assembly, params);
    // 라멘이 아니면(벽식) 침묵하지 말고 **그 구조에 맞는 검토**로 넘긴다 (260729).
    // 종전엔 벽식 3종이 "해당 없음"으로 조용히 빠졌는데, 정작 shear_wall 계산기는
    // 어디서도 불리지 않고 있었다 — stairCheck 와 똑같은 자리였다.
    if (lp?.notApplicable) {
      const sw = shearWallCheck(assembly, params);
      if (sw) return { label: sw.label ?? '벽식 횡력 검토', result: sw };
    }
    return { label: '하중경로 검토 (슬래브→보→기둥→기초)', result: lp };
  }
  if (domain === 'mech' || domain === undefined) {
    // 260728: mech 은 여기(도메인 안전)에도 verificationReportHtml(civil KDS)에도 걸리지
    // 않아 **도메인 판정이 하나도 없었다** — 템플릿 16종으로 가장 많은 분야인데.
    // mechCheck 는 적용 가능한 검사가 없으면 null 을 돌려주므로, 그때는 종전대로 미적용이다.
    const r = mechCheck(assembly);
    return r ? { label: r.label ?? '기계 검토', result: r } : null;
  }
  return null; // 해당 없음(civil은 verificationReportHtml)
}

/**
 * 스키마 불문 제네릭 렌더러. 노드에 verdict/pass가 있으면 배지를, 스칼라 필드는
 * key=value로, 중첩 객체/배열은 소제목 아래 재귀 렌더. 판정을 지어내지 않고
 * (원본 값만 표시) 서브 결과를 숨기지도 않는다(빈 배열/객체만 스킵).
 */
function renderGenericCheckTree(node, depth = 0) {
  if (node == null || typeof node !== 'object') return '';
  if (Array.isArray(node)) {
    if (!node.length) return '';
    return node.map((item, i) => `<div class="gnode"><b>#${i + 1}</b>${renderGenericCheckTree(item, depth + 1)}</div>`).join('\n');
  }
  const skip = new Set(['verdict', 'pass', 'refs', 'error', 'note']);
  const parts = [];
  if (typeof node.verdict === 'string') parts.push(`<div>판정: ${badge(node.verdict)}</div>`);
  else if (typeof node.pass === 'boolean') parts.push(`<div>판정: ${node.pass ? '적합 ✓' : '검토 ✕'}</div>`);
  const scalarEntries = Object.entries(node).filter(
    ([k, v]) => !skip.has(k) && (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' || typeof v === 'boolean' || v === null),
  );
  if (scalarEntries.length) {
    parts.push(
      `<div class="gvals">${scalarEntries
        .map(([k, v]) => `${esc(k)}=${v === null ? '—' : esc(typeof v === 'number' ? f(v, 2) : String(v))}`)
        .join(' · ')}</div>`,
    );
  }
  if (typeof node.note === 'string' && node.note) parts.push(`<div class="note">${esc(node.note)}</div>`);
  if (typeof node.error === 'string' && node.error) parts.push(`<div class="card warn">⚠ ${esc(node.error)}</div>`);
  for (const [k, v] of Object.entries(node)) {
    if (skip.has(k) || typeof v !== 'object' || v === null) continue;
    if (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0) continue;
    const inner = renderGenericCheckTree(v, depth + 1);
    if (inner) parts.push(`<div class="gsection"><div class="ghead">${esc(k)}</div>${inner}</div>`);
  }
  if (Array.isArray(node.refs) && node.refs.length) {
    parts.push(`<div class="cite">근거: ${node.refs.map((r) => citationText(r) || esc(String(r))).join(' · ')}</div>`);
  }
  return parts.join('\n');
}

/**
 * 스키마 불문 실패 수집기(renderGenericCheckTree와 동일 철학) — 트리를 걸어
 * pass:false 또는 verdict:'FAIL' 인 노드의 키를 모은다. 자식 중 실패가 있으면
 * 그 자식들(더 구체적)만 보고하고, 자식이 전혀 실패를 안 냈을 때만 자기 자신의
 * verdict/pass를 본다(egress처럼 verdict가 checks의 롤업인 도메인과, verdict만
 * 있고 하위 pass 매트릭스가 없는 도메인 둘 다 정확히 처리).
 */
function collectFailingChecks(node, key) {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((item) => collectFailingChecks(item, key));
  const childFailures = Object.entries(node)
    .filter(([k, v]) => k !== 'refs' && k !== 'error' && k !== 'note' && v && typeof v === 'object')
    .flatMap(([k, v]) => collectFailingChecks(v, k));
  if (childFailures.length) return childFailures;
  if (node.pass === false) return [key ?? '검토'];
  if (node.verdict === 'FAIL') return [key ?? '검토'];
  return [];
}

/**
 * easySummary() 용 압축 판정 — domainSafetyReportHtml과 같은 소스(runDomainSafetyCheck)를
 * 재사용해 PASS/FAIL 여부만 뽑는다. **새 판정을 만들지 않는다**(feaCautions와 동일 원칙) —
 * 여기서 나온 pass/verdict 필드만 읽는다. 이 분야에 적용 가능한 안전검토가 없으면 null
 * (mech 등 — "검토 없음"과 "검토했는데 통과"를 혼동하면 안 된다).
 * @returns {{label:string, ok:boolean, failed:string[]}|null}
 */
export function domainSafetyVerdict(assembly, params = {}) {
  const run = runDomainSafetyCheck(assembly, params);
  if (!run) return null;
  const r = run.result;
  // **해당 없음 ≠ 판정 불가** (260729). 적용 대상이 아닌 것을 "확인하지 못함"으로 실으면
  // 소비자는 "입력을 더 주면 판정된다"고 읽는다. mech 가 null 로 침묵하는 것과 같은 처리.
  if (r?.notApplicable) return null;
  if (!r || r.ok === false) {
    /**
     * ⚠ **"확인 못 함"은 "기준 미달"이 아니다** (260728).
     * 종전엔 실행 불가를 `failed` 에 넣어 쉬운요약이 "기준 미달 항목이 있습니다: 검토 실행
     * 불가…  지금 상태로는 제작·시공에 들어가면 안 됩니다" 로 인쇄했다 — 입력이 없어서
     * 판정을 못 한 것을 **기준 위반으로 표기**한 것이다(§6-G 의 "판정이 뒤바뀜" 변형).
     * `unavailable` 로 분리해 §7-5 의 "확인하지 못함" 블록으로 보낸다. 안전 판정을 날조해
     * '위험'으로 바꾸지 않고, 판정 못 했다는 사실도 숨기지 않는다 — 같은 원칙의 양면.
     */
    const need = Array.isArray(r?.needInputs) && r.needInputs.length
      ? `입력 필요: ${r.needInputs.map((x) => x.labelKo ?? x.name).join(', ')}`
      : (r?.error ?? r?.gateError ?? '사유 미상');
    return { label: run.label, ok: true, failed: [], unavailable: [`${run.label}: ${need}`] };
  }
  const failed = collectFailingChecks(r);
  // 검토가 **성공했더라도** 그 안에서 안 돌린 항목이 있으면 함께 올린다(260729).
  // 하중경로가 ok=true 인데 지진·풍을 한 번도 안 본 채로 나가면, 소비자는 그것을
  // 구조 검증으로 읽는다 — 통과와 미실시는 같은 자리에 놓일 수 없다.
  const lateral = Array.isArray(r?.lateralUnavailable) ? r.lateralUnavailable : [];
  return {
    label: run.label, ok: failed.length === 0, failed,
    ...(lateral.length ? { unavailable: lateral.map((u) => `${u.labelKo}: ${u.messageKo}`) } : {}),
  };
}

// 옹벽·암거 계산기의 check 키 → 일반인 표기. 미등록 키는 원문 그대로(정직 — 지어내지 않음).
const CHECK_KO = {
  overturning: '전도', sliding: '활동(미끄러짐)', bearing: '지지력', eccentricity: '편심',
};

/**
 * easySummary() 용 압축 판정 — **코드 대조 검증**(verificationReportHtml과 같은 소스인
 * runDossierVerifications: 옹벽 안정·박스 암거) 결과를 PASS/FAIL만 뽑는다.
 * `domainSafetyVerdict`와 형제 함수이며 담당 도메인이 서로 다르다 —
 * domainSafetyVerdict는 interior/landscape/bridge/building, 이쪽은 civil(retainingWall·
 * boxCulvert). 그래서 **civil은 지금까지 어느 쪽으로도 쉬운요약에 도달하지 못했다**
 * (260723 A-7 전수감사 발견: 활동 FS 0.9로 KDS FAIL인 3 m 옹벽이 검증.html엔 FAIL,
 * 쉬운요약.html엔 "구조 안전 이상 없음"으로 나갔다 — structural은 자중 강체 전도만 보고
 * 토압을 모델링하지 않으므로 두 판정이 갈리는 건 정상이고, 갈릴 때 소비자 문서가
 * 낙관적인 쪽만 싣는 것이 결함이었다).
 *
 * **새 판정을 만들지 않는다** — 계산기가 낸 verdict/checks[].pass만 옮긴다.
 * 적용 가능한 검증이 없으면 null("검증 없음"과 "검증했는데 통과"는 다르다).
 *
 * @returns {{label:string, ok:boolean, failed:string[], decisive:boolean}|null}
 *   decisive=false → 합·불 판정이 아닌 산출(박스 암거 단면력 INFO 등). ok=true 라도
 *   "이상 없음"으로 읽으면 안 된다.
 */
export function codeVerificationVerdict(assembly, params = {}) {
  const runs = runDossierVerifications(assembly, params);
  if (!runs.length) return null;
  const failed = [];
  const unavailable = [];
  let decisive = false;
  for (const run of runs) {
    const r = run.result;
    if (!r || r.ok === false) {
      // INPUT_GATE(값을 지어내지 않고 입력을 요구) 또는 실행 실패 — 통과로 둔갑시키지 않는다.
      const need = Array.isArray(r?.needInputs) && r.needInputs.length
        ? `입력 필요: ${r.needInputs.map((s) => s.labelKo ?? s.name).join(', ')}`
        : (r?.error ?? r?.gateError ?? '사유 미상');
      // "확인 못 함"은 "기준 미달"이 아니다 — domainSafetyVerdict 와 같은 분리(260728).
      unavailable.push(`${run.label} 검증 불가 — ${need}`);
      continue;
    }
    if (r.verdict === 'INFO') continue; // 단면력 산출 = 합·불 판정 아님(실패도 통과도 아님)
    decisive = true;
    const before = failed.length;
    for (const [k, c] of Object.entries(r.checks ?? {})) {
      if (c && typeof c === 'object' && c.pass === false) failed.push(c.labelKo ?? c.label ?? CHECK_KO[k] ?? k);
    }
    // 항목별 pass 매트릭스 없이 종합 verdict만 FAIL인 계산기도 놓치지 않는다.
    if (r.verdict === 'FAIL' && failed.length === before) failed.push(`${run.label} 종합 FAIL`);
  }
  return {
    label: runs.map((r) => r.label).join(' · '),
    ok: failed.length === 0, failed, decisive,
    ...(unavailable.length ? { unavailable } : {}),
  };
}

/**
 * 안전검토 문서 HTML(인테리어 피난·조경 목재·교량 활하중·건축 하중경로). 해당
 * 도메인에 적용 가능한 체크가 없거나 체크 자체가 미적용(ok:false — 형상 메타
 * 부족 등)이면 그 사유를 보여준다("파일이 그냥 안 나옴"으로 숨기지 않는다).
 */
export function domainSafetyReportHtml(assembly, { title = '안전검토', params = {} } = {}) {
  const run = runDomainSafetyCheck(assembly, params);
  if (!run) return null; // 이 도메인엔 적용 가능한 안전검토가 없음(정직 — mech 등)
  const r = run.result;
  const body =
    r && r.ok === false
      ? `<div class="card warn">검토 불가: ${esc(r.error ?? r.gateError ?? '알 수 없는 사유')}</div>`
      : renderGenericCheckTree(r) || '<div class="note">산출된 세부 검토값이 없습니다.</div>';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)} — 안전검토</title>
<style>@page{size:A4 portrait;margin:12mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937;font-size:13px}
.sheet{max-width:900px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 22px}
.hd{padding:15px 24px;border-bottom:2px solid #1f2937}.hd h1{margin:0;font-size:18px}.hd .s{color:#64748b;font-size:12px}
.gsection{margin:6px 24px 6px 12px;padding:6px 0 6px 12px;border-left:2px solid #e2e8f0}
.ghead{font-weight:700;font-size:12.5px;color:#334155;margin-bottom:3px}
.gvals{font-size:12px;color:#1f2937;margin:2px 0}
.gnode{margin:4px 0 4px 12px;padding-left:8px;border-left:2px dashed #cbd5e1}
.card{margin:8px 24px;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;line-height:1.7}.card.warn{background:#fef2f2;border-color:#fecaca;color:#991b1b}
.cite{margin:6px 24px 6px 12px;font-size:11.5px;color:#334155}.note{margin:6px 24px 6px 12px;font-size:11px;color:#64748b}
.foot{margin:14px 24px 0;padding-top:8px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b}
@media print{body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body><div class="sheet"><div class="hd"><h1>${esc(title)} — ${esc(run.label)}</h1>
<div class="s">nexyfab domain safety check · 형상 파생 입력 · 실행값(스키마 불문 렌더)</div></div>
${body}
<div class="foot">⚠ 비법정 참고자료 — 법정 계산서·인허가 도서는 등록 기술사(해당 분야)의 직접 검토·날인 영역.</div>
</div></body></html>`;
}

/**
 * 검증 문서 HTML. 적용 가능한 검증이 없으면 null(파일 미생성).
 * @param assembly parts[] + 검증 메타(retainingWall 등)
 */
export function verificationReportHtml(assembly, { title = '설계 검증', params = {} } = {}) {
  const runs = runDossierVerifications(assembly, params);
  if (!runs.length) return null;
  const disclaimer = runs.map((x) => x.result?.disclaimer).find(Boolean)
    ?? '구조 검토 참고자료(비법정) — 법정 계산서·인허가 도서는 등록 기술사(해당 분야)의 직접 검토·날인 영역.';
  const body = runs.map(renderRun).join('\n');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)} — 검증</title>
<style>@page{size:A4 portrait;margin:12mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937;font-size:13px}
.sheet{max-width:900px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 22px}
.hd{padding:15px 24px;border-bottom:2px solid #1f2937}.hd h1{margin:0;font-size:18px}.hd .s{color:#64748b;font-size:12px}
h2{font-size:14px;margin:18px 24px 6px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}
table{border-collapse:collapse;margin:6px 24px;font-size:12px;width:calc(100% - 48px)}td,th{border:1px solid #cbd5e1;padding:4px 9px;text-align:center}th{background:#f1f5f9}
.card{margin:8px 24px;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;line-height:1.7}.card.warn{background:#fef2f2;border-color:#fecaca;color:#991b1b}
.prov{margin:6px 24px;font-size:11.5px;color:#475569}.prov code,.cite code{background:#f1f5f9;padding:1px 5px;border-radius:4px}
.cite{margin:6px 24px;font-size:11.5px;color:#334155}.note{margin:6px 24px;font-size:11px;color:#64748b}
.foot{margin:14px 24px 0;padding-top:8px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b}
@media print{body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body><div class="sheet"><div class="hd"><h1>${esc(title)} — 코드 대조 검증</h1>
<div class="s">nexyfab domain-verify · 형상 파생 입력 + KDS 계산기 실행값 · 형상↔검증 정합</div></div>
${body}
<div class="foot">⚠ 계산기 status=draft(공표예제 게이트 확충중). ${esc(disclaimer)}</div>
</div></body></html>`;
}
