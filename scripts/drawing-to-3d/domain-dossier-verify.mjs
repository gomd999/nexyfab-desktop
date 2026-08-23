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
/** 이스케이프 + `**강조**` 를 <b> 로. 판정 문구가 마크업을 그대로 노출하지 않게 한다. */
const escMd = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const f = (n, d = 2) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '-');

/**
 * 검사 키 → 한국어 라벨 (260730).
 *
 * ⚠ 실측: 판정 168건 중 **64건(38%)이 영문 코드 키**로 나가고 있었다 —
 *   "checks ductility 판정: 적합 ✓ · flexure 판정: 적합 ✓ · shear 판정: 적합 ✓".
 *   한국어 문서인데 **무엇을 판정했는지 읽을 수 없다.** 값은 정확한데 항목명이
 *   `rc_beam` 같은 계산기의 내부 키 그대로다(계산기가 `checks:{flexure:{…}}` 로 반환하고
 *   labelKo 가 없어 렌더러가 객체 키를 라벨로 쓴다).
 *   분야별: 인테리어 70% · 조경 52% · 건축 43% · 교량 35% · **기계 0%**.
 *   기계가 0% 인 것이 중요하다 — `mech-check` 는 모든 검사에 labelKo 를 붙였다.
 *   **가능한 일이고 하지 않은 것**이었다.
 *
 * ⚠ 여기는 **표시 계층의 보완**이다. 근본은 계산기가 labelKo 를 다는 것이고, 그래서
 *   사전에 없는 키는 **원문 그대로 두고 고지한다**(unlabeledKeys) — 조용히 넘어가면
 *   새 키가 생겨도 아무도 모른다(이 세션에서 반복해 본 형태).
 */
const CHECK_LABEL_KO = {
  // 구조 부재 (rc_beam · rc_column_pm · timber_beam …)
  flexure: '휨', shear: '전단', ductility: '연성(인장지배 확인)', deflection: '처짐',
  rho: '철근비', pm: 'P-M 상관(축력·휨 조합)', axial: '축력', torsion: '비틀림',
  section: '단면 검토', member: '부재 검토', board: '판재(데크보드) 검토',
  column: '기둥', beam: '보', slab: '슬래브', footing: '기초',
  columns: '기둥', beams: '보', slabs: '슬래브', footings: '기초', walls: '벽',
  sizing: '관경 산정', capacity: '내력', stability: '안정',
  // 설비 (drainage_vent)
  slope: '배수 구배', stack: '입상관(수직관)', vent: '통기관', lines: '배수 지관',
  fixtures: '위생기구', drainage: '배수', water: '급수·오수', ventilation: '환기',
  lighting: '조명', electrical: '전기', fire: '소방',
  // 피난·공간
  travel: '보행거리', egress: '피난', occupancy: '수용인원', exits: '출입구',
  // 공통
  checks: '검토 항목', uplift: '풍 상향력', wind: '풍하중', seismic: '지진',
  irrigation: '관수', connection: '접합부', selfChecks: '형상 자기정합',
  railing: '난간 검토', height: '높이', picketGap: '살 사이 간격', postPitch: '기둥 간격',
  boltedPlate: '볼트 접합 판재 검토', edgeDistance: '볼트 연단거리', boltPitch: '볼트 간격',
  holeClearance: '볼트 여유', slenderness: '벽 세장비', jointThickness: '줄눈 두께',
  lintelBearing: '인방 지지길이', blockSpec: '블록 규격 정합',
  penetration: '설비 관통 ↔ 구조 개구', notChecked: '검토하지 않은 항목 (이유와 함께)',
  // 구조 컨테이너 — 판정은 아니지만 문서에서 **소제목으로 실제 읽히는** 것들이다.
  // 실측(560여 소제목): `detail`×94 · `needInputs`×48 이 압도적이라 이것부터가 가독성이다.
  detail: '설명', needInputs: '필요 입력', basis: '산출 근거', geometry: '형상',
  provenance: '출처', user: '사용자 입력', kds: 'KDS 기준값', derived: '형상에서 도출',
  notes: '비고', assumptions: '가정', items: '항목', fields: '입력 항목',
  loads: '하중', load: '하중', dead: '고정하중', live: '활하중', lane: '차선하중',
  truck: '표준트럭하중', ultimate: '극한하중', service: '사용하중', combo: '하중조합',
  // 하중조합의 식별자는 문서에서 그대로 참조되므로 접미 숫자를 잃지 않는다.
  U1: '하중조합 U1', U2: '하중조합 U2',
  forces: '단면력', rebar: '철근', spans: '스팬', unitWeight: '단위중량',
  finishes: '마감', mep: '설비', withLoss: '손실 반영', attempted: '시도한 검토',
  unjudged: '미판정',
  egressUnavailable: '피난 검토 불가',
  x: 'X방향', y: 'Y방향', xs_mm: 'X 격자선(mm)', ys_mm: 'Y 격자선(mm)',
  farthestPointMm: '최원점 거리(mm)', deadShare_kN: '고정하중 분담(kN)',
  /**
   * ⚠ 260731b — **입력을 주면 열리는 분기**에만 나오는 키들이다. 앞 세션의 전수 측정은
   * params 1조합만 돌려서 이것들을 한 번도 보지 못했다(소제목 590 → 626, 영문 2종 → 11종).
   * 고지는 정상 작동했지만 **「고지됨」은 「읽힘」이 아니다** — `all` 이라는 소제목은
   * 독자에게 아무 뜻이 없었다. 실제 내용을 확인하고 이름을 붙였다.
   */
  frameK_kNmm: '골조 강성 (kN/mm)', all: '검토한 횡력원 전부 (지배값 선정 근거)',
  storyShear_kN: '층전단력 (kN)', Fx_kN: '층별 횡력 Fx (kN)',
  matrix: '층별 상세 (변위·P-Δ)', sway: '층 안정 (Q값·유의 여부)', windBasis: '풍 투영면 산정 근거',
  pdelta: 'P-Δ 효과 (θ)', rows: '층별 값', drifts: '층간변위',
  lateralUnavailable: '횡력 검토 불가', sizingUnavailable: '덕트 사이징 불가',
};

/**
 * 키를 한국어로. 배열 인덱스(`lines[0]`)와 숫자 접미(`beams0`)는 번호로 되살린다.
 * 사전에 없으면 **원문 유지** — 그리고 호출측이 `unlabeled` 로 수집해 고지한다.
 */
function labelForKey(k, unlabeled) {
  const key = String(k);
  if (CHECK_LABEL_KO[key]) return esc(CHECK_LABEL_KO[key]);
  const m = key.match(/^([A-Za-z_]+)(?:\[(\d+)\]|(\d+))$/);
  const ko = m ? CHECK_LABEL_KO[m[1]] : null;
  if (ko) return esc(`${ko} #${Number(m[2] ?? m[3]) + 1}`);
  // ⚠ 고지에는 **문서에 실제로 찍힌 키 그대로**를 넣는다. 접미 숫자를 떼고 넣었더니
  //   `U1`·`U2`(하중조합 이름)가 고지에는 `U` 로 나가 **문서에서 찾을 수 없는 키**가 됐다
  //   — 고지가 조치로 이어지지 않으면 고지가 아니다(첫 구현에서 실측으로 잡음).
  if (unlabeled && /^[A-Za-z]/.test(key)) unlabeled.add(key);
  return esc(key);
}

/**
 * 노드가 자체적으로 제공한 labelKo/label도 동일한 사전·고지 계약을 따른다.
 * 계산기가 아직 원문 영문 키를 labelKo에 넣어 반환하는 경우에도 표시를
 * 조용히 번역하거나 고지를 생략하지 않고, 실제 문서에 찍힌 키를 기록한다.
 */
function displayOwnLabel(value, unlabeled) {
  const key = String(value ?? '');
  if (CHECK_LABEL_KO[key]) return escMd(CHECK_LABEL_KO[key]);
  if (unlabeled && /^[A-Za-z]/.test(key)) unlabeled.add(key);
  return escMd(key);
}

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
  /**
   * ⚠ 260801g — 종전엔 **어떤 검토든** 「단면력 산출」이라고 찍었다. `INFO` 는 교량 단면력만
   *   쓰던 값이 아니다 — 끼워맞춤(µm 틈새)·조도(lx)·환기량(CMH)에도 붙는다. 라이브 문서에
   *   `끼워맞춤 H7/g6 … 판정: 단면력 산출` 이 나갔다(실측). **하지 않은 계산을 했다고 적는 것**이라
   *   배지는 중립으로 두고, 무엇을 산출했는지는 각 검토가 자기 말로 적는다.
   */
  if (verdict === 'INFO') return '<span style="color:#2563eb;font-weight:700">산출값 ℹ (INFO — 합·불 판정 아님)</span>';
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
    /**
     * 루트가 INFO 인 검토는 무엇을 산출했는지 자기 말로 적는다(`infoKo`).
     * 없으면 **결과에 실제로 있는 것**으로 판단한다 — 단면력(모멘트)이 실려 있을 때만
     * 「단면력 산출」이라고 쓴다. 그 밖은 중립 문구로 둔다(하지 않은 계산을 적지 않는다).
     */
    const hasMoments = r.moments && typeof r.moments === 'object' && Object.keys(r.moments).length > 0;
    const infoKo = typeof r.infoKo === 'string' && r.infoKo ? r.infoKo
      : hasMoments ? '단면력 산출(합·불 판정 아님, 배근·단면 검토는 별도)'
        : '산출값이다 — 합·불 판정이 아니다.';
    L.push(`<div class="card">${isInfo ? '결과' : '종합 판정'}: ${badge(r.verdict)}${isInfo ? ` — ${esc(infoKo)}` : ''}</div>`);
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
import { civilCheck } from './civil-check.mjs';
import { railingCheck } from './railing-check.mjs';
import { masonryCheck } from './masonry-check.mjs';
import * as bridgeMod from './bridge-check.mjs';
import { loadPathCheck } from './load-path.mjs';
import { shearWallCheck } from './shear-wall-check.mjs';
import { ductRunCheck } from './duct-run-check.mjs';
import { penetrationCheck } from './penetration-check.mjs';
import { canopyCheck } from './canopy-check.mjs';
import { mechCheck } from './mech-check.mjs';

const BRIDGE_DISPATCH = [
  { meta: 'archMeta', fn: 'archBridgeCheck' },
  { meta: 'trussMeta', fn: 'trussBridgeCheck' },
  { meta: 'cableStayedMeta', fn: 'cableStayedCheck' },
  { meta: 'suspensionMeta', fn: 'suspensionCheck' },
  { meta: 'stairMeta', fn: 'stairCheck' },
];

/**
 * 공간 구획·피난 미검토 고지 (260729).
 *
 * `interiorCheck`(보행거리 BFS·수용인원·피난폭)는 이미 있고 인테리어에서 잘 돈다.
 * 그런데 **건축 어셈블리는 그 입력을 하나도 선언하지 않는다** — 실측: gable_house
 * 벽15·commercial_massing 벽43 모두 개구부·roomBounds·exits 가 전부 없다. 그 결과
 * 4층 상업건물 도서가 **공간 구획·피난을 한 번도 보지 않고** 나갔고 아무도 그 사실을
 * 말하지 않았다 — 내진·부재 검토와 같은 자리다.
 *
 * ⚠ 벽 외곽에서 실을 도출하지 않는다. 43장 벽이 감싼 영역을 방 하나로 치면 그건 추측이고,
 * 그 추측 위에 보행거리·수용인원을 얹으면 근거 없는 수치가 된다. 무엇을 선언하면 되는지만
 * 말한다.
 */
function spaceUnavailable(assembly) {
  if (assembly?.domain !== 'building') return null;
  const walls = (assembly.parts ?? []).filter((p) => p.role === 'wall' && p.unverified !== true);
  if (!walls.length) return null;                       // 공간을 감싸는 벽이 없다 = 해당 없음
  if (assembly.roomBounds?.W && assembly.roomBounds?.D) return null; // 이미 선언돼 있으면 검토 경로가 있다
  return {
    labelKo: '공간 구획·피난 검토',
    needInputs: [
      { name: 'roomBounds{W,D}', labelKo: '실 경계 — 벽 외곽에서 도출하면 추측이 된다' },
      { name: 'exits[{x,y,widthMm}]', labelKo: '출입구 위치·폭 — 없으면 피난 검토가 원리상 불가능하다' },
      { name: 'usage', labelKo: '용도 — 재실밀도·피난 기준이 용도로 정해진다' },
    ],
    // ⚠ 이 어셈블리가 **사람이 쓰는 공간인지**는 선언돼 있지 않다(물탱크·승강로처럼
    // 벽이 있어도 재실 공간이 아닐 수 있다). 단정하지 않고 조건부로 적는다.
    messageKo: `공간 구획·피난 미검토 — 벽 ${walls.length}장이 공간을 감싸고 있으나 실 경계·출입구·용도가 `
      + '선언돼 있지 않습니다. 벽 외곽만으로 실을 나누면 추측이 되므로 나누지 않았습니다. '
      + '**사람이 사용하는 공간이라면** 실 경계·출입구·용도를 선언하십시오 — 보행거리·수용인원·'
      + '피난폭을 검토합니다(인테리어와 같은 엔진). 설비 공간이면 해당 없습니다. '
      + '어느 쪽이든 이 문서는 **피난을 확인하지 않았습니다.**',
  };
}

/** Which domains have a wired safety/code check, and how to run it. Returns
 *  null when the domain has no applicable check (e.g. 'mech' — a mechanical
 *  part has no egress/timber/bridge-load concept) so no file is forced. */
/**
 * 감사용 진입점 (260729d) — **표시 계층을 거치지 않고** 검사 결과 원본을 얻는다.
 *
 * 이 세션에 5분야 깊이를 세 번 쟀고 세 번 다 표시(HTML)를 통해 세다가 틀릴 뻔했다:
 * ①표시 누락을 능력 부족으로(과소) ②입력 대기를 판정으로(과대) ③분모 확대를 저하로(반전).
 * 원본 트리를 직접 순회하면 표시가 바뀌어도 측정이 흔들리지 않는다.
 */
export function auditDomainSafety(assembly, params = {}) {
  return runDomainSafetyCheck(assembly, params);
}

/**
 * N-시리즈(260808) — 계층 IR 템플릿의 **결정론 게이트 결과를 검사 트리에 정식
 * 편입**한다. 기둥 수직 연속성·BOQ 패턴곱 교차·표고 연속 같은 게이트는 형상에서
 * 결정론으로 판정된 **실판정**이다(입력 대기가 아니다). 템플릿 래퍼가
 * `assembly.hierarchyGates = [{ labelKo, pass }]` 로 싣고, 여기서 도메인 분기와
 * 무관하게 결과에 합류한다 — 난간(railing) 합류와 같은 「전 분기 공통 부착」 규약.
 */
function withHierarchyGates(assembly, run) {
  const gates = assembly?.hierarchyGates;
  if (!Array.isArray(gates) || !gates.length) return run;
  // mech 처럼 도메인 검토가 의도적으로 null 침묵하는 경우에도 계층 게이트는
  // 실판정이므로 최소 결과를 합성한다(다른 템플릿의 침묵은 그대로 존중).
  if (!run?.result || typeof run.result !== 'object') {
    return {
      label: '계층 정합 게이트 (전개 결과 결정론 검증)',
      result: { ok: gates.every((g) => g.pass !== false), hierarchyGates: { labelKo: '계층 정합 게이트 (전개 결과 결정론 검증)', checks: gates.map((g) => ({ labelKo: g.labelKo, pass: g.pass !== false })) } },
    };
  }
  return {
    ...run,
    result: {
      ...run.result,
      hierarchyGates: {
        labelKo: '계층 정합 게이트 (전개 결과 결정론 검증)',
        checks: gates.map((g) => ({ labelKo: g.labelKo, pass: g.pass !== false })),
      },
    },
  };
}

function runDomainSafetyCheck(assembly, params) {
  return withHierarchyGates(assembly, runDomainSafetyCheckInner(assembly, params));
}

function runDomainSafetyCheckInner(assembly, params) {
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
  /**
   * ★260802 — **`civil` 분기가 아예 없었다.** 5도메인 중 유일하게 안전검토 계층이 없어
   *   판정 0개(템플릿 3종 전부)로 나왔다. 계산기 검증은 도달하고 있었으므로 「검토가 없다」가
   *   아니라 **「안전검토가 없다」**였다 — 실측으로 구별한 뒤에야 옳게 고칠 수 있었다.
   * ⚠ 전도·활동·지지력·라멘 단면력은 **계산기가 한다.** 여기서는 형상 비례만 본다(중복 금지).
   */
  if (domain === 'civil') {
    const cv = civilCheck(assembly);
    if (cv) return { label: cv.label, result: cv };
  }
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
    /**
     * ⚠ 260801: 난간은 **어느 하위 경로로 가든 붙인다**(관통 검사와 같은 규약).
     * 계단이든 라멘이든 벽식이든 난간이 있으면 추락 방지 기준은 똑같이 적용된다.
     * 계단 분기 안에만 넣으면 발코니·파라펫 난간이 통째로 빠진다 — 이 세션에서
     * 「특정 분기에만 붙여 정작 필요한 곳에서 사라짐」을 네 번 잡았다.
     */
    /**
     * ⚠ 조적은 **전단벽이 아니다.** 메타 디스패치를 안 두면 `masonry_wall` 이 벽식 횡력
     *   검토로 가서 「전단벽이 아니다」로 거부되고, 블록 99장을 쌓은 벽에 **판정이 0** 이 된다
     *   (실측으로 확인). bridge·mech 와 같은 「선언 메타로 디스패치」 규약을 따른다.
     */
    const mas = masonryCheck(assembly, params);
    const rail = railingCheck(assembly, params);
    const withRail = (r) => (rail && r && typeof r === 'object'
      ? { ...r, checks: { ...(r.checks ?? {}), railing: rail } } : r);

    if (mas) return { label: mas.label ?? '조적 벽체 검토', result: withRail(mas) };
    if (assembly.stairMeta && typeof bridgeMod.stairCheck === 'function') {
      return { label: '계단 검토 (트레드·스트링거 휨)', result: withRail(bridgeMod.stairCheck(assembly, params)) };
    }
    // 본체가 구조가 아닌 어셈블리(덕트 계통 등)는 자기 검토로 — duct_sizing 계산기가
    // 존재하면서 한 번도 불리지 않았다(260729).
    // 설비 관통 ↔ 구조 개구 (260729b P1-7) — 어느 하위 경로로 가든 붙인다.
    // 덕트 계통이든 라멘이든 벽식이든 **관통은 똑같이 일어난다**.
    const pen = penetrationCheck(assembly);
    const withPen = (r) => {
      const base = (pen && r && typeof r === 'object'
        ? { ...r, checks: { ...(r.checks ?? {}), penetration: pen } } : r);
      return withRail(base);
    };

    // 캐노피는 중력이 아니라 **풍 상향력**이 지배한다 — 하중경로 검토의 대상이 아니라
    // 처음부터 다른 검토가 필요하다(260729d P1-①). 메타 디스패치는 bridge 와 같은 규약.
    const canopy = canopyCheck(assembly, params);
    if (canopy) return { label: canopy.label ?? '캐노피 검토', result: withPen(canopy) };

    const duct = ductRunCheck(assembly);
    if (duct) return { label: duct.label ?? '덕트 계통 검토', result: withPen(duct) };
    const lp = loadPathCheck(assembly, params);
    // 라멘이 아니면(벽식) 침묵하지 말고 **그 구조에 맞는 검토**로 넘긴다 (260729).
    // 종전엔 벽식 3종이 "해당 없음"으로 조용히 빠졌는데, 정작 shear_wall 계산기는
    // 어디서도 불리지 않고 있었다 — stairCheck 와 똑같은 자리였다.
    if (lp?.notApplicable) {
      const sw = shearWallCheck(assembly, params);
      if (sw) {
        const nCols = (assembly.parts ?? []).filter((p) => p.role === 'column' && p.unverified !== true).length;
        // 라멘 검토가 왜 대상이 아닌지를 **횡력 검토 안에 남긴다.** 그러지 않으면
        // 소비자는 연직하중 경로가 검토된 줄 알거나, 아무 이유 없이 검토가 바뀐 줄 안다.
        return {
          label: sw.label ?? '벽식 횡력 검토',
          result: withPen({
            ...sw,
            // ⚠ checks 에만 넣으면 **소비자에 도달하지 않는다.** domainSafetyVerdict 는
            //   {label, ok, failed, unavailable} 만 돌려주고 checks 를 넘기지 않아,
            //   pass:null 인 고지는 쉬운요약에서 통째로 사라진다(형태 ②).
            //   `lateralUnavailable` 은 "성공했어도 안 돌린 항목"을 올리는 채널이라 여기 태운다.
            // 항목 형태는 {labelKo, messageKo} 다 — 문자열을 넣으면 소비부가
            // `${u.labelKo}: ${u.messageKo}` 로 찍어 **"undefined: undefined"** 가 나간다(실측).
            // ⚠ **기둥이 있을 때만** 붙인다. 기둥이 0본인 순수 벽식(물탱크 등)은 벽이
            //   연직도 받으므로 "골조의 연직 경로를 안 봤다"는 고지가 성립하지 않는다 —
            //   붙이면 해당 없는 항목을 미검토로 세는 과고지가 된다(실측: water_tank).
            lateralUnavailable: [
              ...(Array.isArray(sw.lateralUnavailable) ? sw.lateralUnavailable : []),
              // ⚠ 기둥 수는 **어셈블리에서 직접** 센다. `sw.basis` 는 횡력 검토가 성공했을
              //   때만 있어서(입력 부족으로 거부되면 없다) 그걸 조건으로 쓰면 정작 거부된
              //   문서에서 이 고지가 사라진다 — 실측으로 확인한 세 번째 같은 함정.
              ...(nCols > 0 ? [{
                labelKo: '연직 하중경로 (슬래브→보→기둥→기초)',
                messageKo: `검토하지 않았습니다 — 기둥 ${nCols}본이 있으나 직교 격자 라멘이 아니라 `
                  + '하중경로 검토의 적용범위 밖입니다. **횡력이 검토됐다고 연직이 확인된 것이 아닙니다.**',
              }] : []),
            ],
            checks: {
              ...(sw.checks ?? {}),
              loadPathScope: {
                labelKo: '연직 하중경로 — 이 검토의 적용범위 밖', pass: null,
                detail: [
                  String(lp.error ?? '직교 격자 라멘이 아니라 하중경로 검토 대상이 아니다'),
                  '슬래브→보→기둥→기초 연직 경로는 **검토하지 않았다** — 횡력이 검토됐다고 연직이 확인된 것이 아니다.',
                ],
              },
            },
          }),
        };
      }
    }
    return { label: '하중경로 검토 (슬래브→보→기둥→기초)', result: withPen(lp) };
  }
  if (domain === 'mech' || domain === undefined) {
    // 260728: mech 은 여기(도메인 안전)에도 verificationReportHtml(civil KDS)에도 걸리지
    // 않아 **도메인 판정이 하나도 없었다** — 템플릿 16종으로 가장 많은 분야인데.
    // mechCheck 는 적용 가능한 검사가 없으면 null 을 돌려주므로, 그때는 종전대로 미적용이다.
    // ⚠ 260729d: `mechCheck(assembly)` 로 **params 를 넘기지 않아** `seismicG` 를 줘도
    //   지진 전도가 돌지 않았다. 사용자가 지반가속도를 줄 수 있는 경로(verifyParams)를
    //   웹·MCP 양쪽에 배선해 놓고 **마지막 한 칸에서 끊겨 있던** 것이다 — 형태 ①.
    const r = mechCheck(assembly, params);
    return r ? { label: r.label ?? '기계 검토', result: r } : null;
  }
  return null; // 해당 없음(civil은 verificationReportHtml)
}

/**
 * 스키마 불문 제네릭 렌더러. 노드에 verdict/pass가 있으면 배지를, 스칼라 필드는
 * key=value로, 중첩 객체/배열은 소제목 아래 재귀 렌더. 판정을 지어내지 않고
 * (원본 값만 표시) 서브 결과를 숨기지도 않는다(빈 배열/객체만 스킵).
 */
function renderGenericCheckTree(node, depth = 0, unlabeled = null, labelHoisted = false) {
  // ⚠ 260729: 스칼라를 빈 문자열로 버리고 있었다. 그 결과 `detail: [...문장...]` 같은
  //   **문자열 배열이 "#1 #2 #3" 으로만 찍히고 내용이 통째로 사라졌다**(라이브 실측).
  //   "전단벽 시스템으로 분류해야 한다" 같은 핵심 경고가 안전검토.html 에 한 글자도
  //   안 나갔다 — 판정했는데 소비자에 도달 안 함(§6-G ⑤). 교량·조경·인테리어의
  //   detail 도 전부 같은 경로라 **모든 도메인이 영향**을 받았다.
  if (node == null) return '';
  if (typeof node !== 'object') {
    const t = String(node);
    if (!t.trim()) return '';
    // 판정 문구의 **강조**를 살린다 — 아니면 마크업이 원문 그대로 새어 보인다.
    return `<div class="gvals">${escMd(t)}</div>`;
  }
  if (Array.isArray(node)) {
    if (!node.length) return '';
    return node.map((item, i) => {
      const inner = renderGenericCheckTree(item, depth + 1, unlabeled);
      if (!inner) return '';
      // 문자열 목록은 번호만 앞에 붙이고 **본문을 그대로** — 개수만 남기지 않는다.
      return `<div class="gnode"><b>#${i + 1}</b> ${inner}</div>`;
    }).filter(Boolean).join('\n');
  }
  // ⚠ `labelKo`/`label` 은 **값이 아니라 그 노드의 이름**이다. 스칼라로 두면
  //   소제목엔 영문 키(`flexure`)가 뜨고 본문엔 `labelKo=휨` 이 값처럼 찍힌다 —
  //   이름이 있는데 이름 자리에 안 들어간 것이다(260730 실측: 기계는 전 검사에
  //   labelKo 가 있는데도 소제목이 전부 영문이었다). 부모가 소제목으로 올린다.
  //
  // ⚠ 다만 **부모가 올려 준 경우에만** 스칼라에서 뺀다. 무조건 빼면 배열 원소
  //   (`needInputs[]` 처럼 부모 소제목이 하나뿐인 목록)의 한국어 설명이 통째로
  //   사라진다 — 라벨을 살리려다 라벨을 지우는 형태다. 안 올려졌으면 여기서 그린다.
  const skip = new Set(['verdict', 'pass', 'refs', 'error', 'note', 'labelKo', 'label']);
  const ownLabel = typeof node.labelKo === 'string' && node.labelKo.trim() ? node.labelKo
    : (typeof node.label === 'string' && node.label.trim() ? node.label : '');
  const parts = [];
  if (ownLabel && !labelHoisted && depth > 0) parts.push(`<div class="ghead">${displayOwnLabel(ownLabel, unlabeled)}</div>`);
  // ⚠ `INPUT`(입력 대기)은 **판정이 아니다.** "판정: INPUT" 으로 찍으면 판정 개수에도
  //   세어지고 소비자에게도 판정처럼 보인다 — 이 세션 내내 강제한 구별이 표시에서 무너진다.
  // ⚠ 표식은 `'INPUT'` 뿐 아니라 **`'INPUT(footing)'` 같은 괄호형**도 쓴다(rc_frame 실측).
  //   엄밀 비교만 하면 그런 것들이 "판정: INPUT(footing)" 으로 판정처럼 찍힌다.
  // ⚠ 정규식 대신 startsWith — 여기 단어경계를 쓰려다 셸·파이썬 이스케이프를 거치며
  //   **백스페이스 제어문자(0x08)** 가 파일에 박혀 정규식이 조용히 안 맞았다(실측:
  //   girder_bridge 가 계속 "판정: INPUT" 으로 찍혔다). 문자열 API 가 이런 사고를 안 만든다.
  if (typeof node.verdict === 'string' && node.verdict.startsWith('INPUT')) {
    parts.push('<div class="card warn"><b>입력 대기 — 판정하지 않음</b>'
      + (node.verdict !== 'INPUT' ? ` <span class="note">(${esc(node.verdict)})</span>` : '')
      + (Array.isArray(node.needInputs) && node.needInputs.length
        ? `: ${node.needInputs.map((x) => escMd(x.reason ?? x.labelKo ?? x.field ?? x.name ?? '')).join(' · ')}`
        : '') + '</div>');
  } else if (typeof node.verdict === 'string') {
    /**
     * ⚠ 260730: 라벨이 **빈 문자열**인 판정이 5건 있었다(`industrial_stair` · 아치·사장·
     * 현수·트러스교). 전부 **루트 결과 노드**라 문서에 "판정: 적합 ✓" 만 덩그러니 나갔다 —
     * **무엇이 적합한지 모르는 채 안심하게 된다.** 이름 없는 판정은 판정이 없는 것보다
     * 나쁠 수 있다. 루트는 개별 검토의 **합**이므로 그렇게 이름을 준다.
     */
    parts.push(depth === 0
      ? `<div><b>종합 판정</b>(아래 개별 검토의 합): ${badge(node.verdict)}</div>`
      : `<div>판정: ${badge(node.verdict)}</div>`);
  }
  else if (typeof node.pass === 'boolean') parts.push(`<div>판정: ${node.pass ? '적합 ✓' : '검토 ✕'}</div>`);
  // ⚠ 260729b: **교량 검사는 전부 `ok` 를 쓴다.** `pass` 만 그리던 탓에 타이 인장·행어
  //   장력·주케이블 장력 같은 **실판정 2~4건이 문서에서 합·불 없이** 나갔다(값만 나감).
  //   실측: suspension 4건 중 1건, arch·truss 3건 중 1건만 배지가 찍혔다(§6-G ⑤).
  //   ⚠ 이름 없는 `ok` 는 그리지 않는다 — 루트 결과·어셈블리 게이트가 판정으로 오인된다.
  else if (typeof node.ok === 'boolean' && (typeof node.name === 'string' || typeof node.labelKo === 'string')) {
    parts.push(`<div>판정: ${node.ok ? '적합 ✓' : '검토 ✕'}${isSelfConsistency(node) ? ' <span class="note">(형상 자기정합 — 안전 판정 아님)</span>' : ''}</div>`);
  }
  const scalarEntries = Object.entries(node).filter(
    ([k, v]) => !skip.has(k) && (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' || typeof v === 'boolean' || v === null),
  );
  if (scalarEntries.length) {
    parts.push(
      `<div class="gvals">${scalarEntries
        .map(([k, v]) => `${esc(k)}=${v === null ? '—' : (typeof v === 'number' ? f(v, 2) : escMd(String(v)))}`)
        .join(' · ')}</div>`,
    );
  }
  if (typeof node.note === 'string' && node.note) parts.push(`<div class="note">${escMd(node.note)}</div>`);
  if (typeof node.error === 'string' && node.error) parts.push(`<div class="card warn">⚠ ${escMd(node.error)}</div>`);
  for (const [k, v] of Object.entries(node)) {
    if (skip.has(k) || typeof v !== 'object' || v === null) continue;
    if (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0) continue;
    // 소제목: ① 노드가 스스로 밝힌 이름(labelKo/label) → ② 키 사전 → ③ 원문 + 미등록 고지.
    const own = !Array.isArray(v) && (typeof v.labelKo === 'string' && v.labelKo.trim() ? v.labelKo
      : (typeof v.label === 'string' && v.label.trim() ? v.label : ''));
    const inner = renderGenericCheckTree(v, depth + 1, unlabeled, Boolean(own));
    const head = own ? displayOwnLabel(own, unlabeled) : labelForKey(k, unlabeled);
    if (inner) parts.push(`<div class="gsection"><div class="ghead">${head}</div>${inner}</div>`);
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
 * 실제로 **합·불을 낸** 항목 수 (260729 — 근거 충분성).
 *
 * collectFailingChecks 의 형제. 실패만 세면 "판정 0개"와 "전부 통과"가 구별되지 않는다 —
 * 실측: 조경 6종·girder_bridge 가 판정 0개인데 `ok: failed.length === 0` 이라
 * **"이상 없음"으로 나갔다.** 실시검도·완성도 게이트에는 evidence_sufficient 를 넣었으면서
 * 정작 도메인 안전 판정에는 넣지 않았던 자리다(실 CAD 코퍼스가 잡은 그 함정).
 *
 * pass:null(판정 보류)은 세지 않는다 — 그것도 "판정한 것"이 아니다.
 */
/**
 * 검사 노드가 **형상 자기정합**인가. 안전 판정이 아니다.
 *
 * ⚠ 260729b: `girder_bridge` 는 실판정이 0인데 "바닥판 폭 자기정합"
 * (`kind:'self-consistency'`) 하나로 `evidenceSufficient` 가 충족돼 **「이상 없음」으로
 * 나갔다.** 바닥판 폭이 선언값과 맞는다는 것은 형상이 자기모순이 아니라는 뜻이지
 * 구조가 안전하다는 뜻이 아니다 — 앞 세션에 넣은 「판정 0개는 통과가 아니다」 안전망이
 * **범주 오류로 뚫린 자리**다. 세지 않는 게 아니라 **다른 칸에 센다.**
 */
function isSelfConsistency(node) {
  const k = typeof node?.kind === 'string' ? node.kind : '';
  if (/self[-_ ]?consistency/i.test(k)) return true;
  const nm = typeof node?.name === 'string' ? node.name : (typeof node?.labelKo === 'string' ? node.labelKo : '');
  return /자기정합/.test(nm);
}

function countJudged(node) {
  if (node == null || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce((s, x) => s + countJudged(x), 0);
  let n = 0;
  if (isSelfConsistency(node)) {
    // 자기정합은 안전 판정 분모에서 뺀다. 하위 노드는 계속 훑는다(중첩 가능).
  } else if (node.pass === true || node.pass === false) n += 1;
  else if (node.verdict === 'PASS' || node.verdict === 'FAIL') n += 1;
  // ⚠ 260729 정정: 교량·조경 검사 항목은 `pass` 가 아니라 **`ok`** 를 쓴다
  // (예: {name:'바닥판 폭 자기정합', ok:true}). `pass` 만 세던 첫 구현은 이들을
  // 통째로 놓쳐 **판정하고 있는 템플릿을 "판정 0개"로 고지**했다 — 내가 고치려던
  // 결함의 거울상이다. 루트 결과도 `ok` 를 갖지만 `name`/`labelKo` 가 없으므로
  // 그것으로 검사 항목과 구별한다.
  else if ((node.ok === true || node.ok === false)
    && (typeof node.name === 'string' || typeof node.labelKo === 'string')) n += 1;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'refs' || k === 'error' || k === 'note' || k === 'inputsEcho') continue;
    if (v && typeof v === 'object') n += countJudged(v);
  }
  return n;
}

/** 자기정합 검사 건수 — 「안전 판정 M건 · 자기정합 N건」으로 나눠 보고하기 위한 것. */
function countSelfConsistency(node) {
  if (node == null || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce((s, x) => s + countSelfConsistency(x), 0);
  let n = isSelfConsistency(node) && (node.ok === true || node.ok === false || node.pass === true || node.pass === false) ? 1 : 0;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'refs' || k === 'error' || k === 'note' || k === 'inputsEcho') continue;
    if (v && typeof v === 'object') n += countSelfConsistency(v);
  }
  return n;
}

/**
 * **입력 대기** 항목 수 (260729). 판정 0개의 이유를 가른다.
 *
 * ⚠ "해당 없음"과 "판정 불가"를 여기서도 뭉개면 안 된다 — 이 세션 내내 강제한 구별이다.
 * 실측으로 둘 다 나왔다:
 *  · fence_run: 목재 부재가 없어 목재 검토가 빈다 → **해당 없음**
 *  · rc_frame: 보·기둥·기초가 전부 verdict "INPUT(beamAs/colAst/footing)" 이다.
 *    부재는 있고 단면력(Mu·Vu)도 산출됐는데 **철근이 선언되지 않아** 강도 판정을 못 한
 *    것이다 → **판정 불가(입력 필요)**. 이걸 "대상 없음"이라 하면 입력하면 된다는
 *    사실이 사라진다.
 */
function countInputGated(node) {
  if (node == null || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce((s, x) => s + countInputGated(x), 0);
  let n = 0;
  if (typeof node.verdict === 'string' && /^INPUT/.test(node.verdict)) n += 1;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'refs' || k === 'error' || k === 'note' || k === 'inputsEcho') continue;
    if (v && typeof v === 'object') n += countInputGated(v);
  }
  return n;
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
    // ⚠ 이 조기 반환이 **공간 고지를 통째로 삼키고 있었다**(260729). 벽이 있는 건축
    // 어셈블리는 거의 전부 여기(거부)로 빠지므로, 성공 경로에만 붙이면 정작 필요한
    // 곳에 한 건도 도달하지 않는다 — 실측으로 확인하고 양쪽에 붙였다.
    const sp0 = spaceUnavailable(assembly);
    // ⚠ 이 조기 반환은 `lateralUnavailable` 도 삼키고 있었다(260729 — 공간 고지에 이어
    //   **같은 함정 두 번째**). 입력이 없어 거부된 검토라도, 그와 별개로 "안 돌린 항목"은
    //   여전히 안 돌린 것이다. 성공 경로에만 붙이면 정작 거부된 문서에서 사라진다.
    const lat0 = Array.isArray(r?.lateralUnavailable) ? r.lateralUnavailable : [];
    // ⚠ 260729c: 이 경로는 **실제로 판정한 항목까지 통째로 버리고** 있었다.
    //   실측: tower_crane 은 정적 전도를 산출했는데(적합) 지배 입력이 없다는 이유로
    //   쉬운요약에는 "입력 필요" 만 나갔다 — 본 것이 있는데 안 본 것처럼 읽힌다.
    //   거부 사유와 **그와 별개로 판정한 것**은 함께 있어야 한다.
    const judgedHere = collectFailingChecks(r);
    const judgedCount = countJudged(r);
    return {
      label: run.label,
      // 실제 판정에서 걸린 것이 있으면 그것은 그대로 실패로 올린다(거부와 무관).
      ok: judgedHere.length === 0, failed: judgedHere,
      unavailable: [
        `${run.label}: ${need}`,
        ...lat0.map((u) => (typeof u === 'string' ? u : `${u.labelKo}: ${u.messageKo}`)),
        ...(sp0 ? [`${sp0.labelKo}: ${sp0.messageKo}`] : []),
      ],
      ...(judgedCount > 0 ? {
        judgedDespiteRefusal: judgedCount,
        judgedNote: `지배 입력이 없어 본 검토는 하지 못했지만, 그와 **별개로 ${judgedCount}개 항목은 `
          + `실제로 판정했다**(형상·질량만으로 결정되는 것). 문서의 해당 항목을 확인할 것.`,
      } : {}),
    };
  }
  const failed = collectFailingChecks(r);
  // ── 근거 충분성 (260729) ─────────────────────────────────────────────────
  // 판정한 항목이 0개면 "이상 없음"이 아니다. 실측: 조경 6종(단지·울타리·화단벽·
  // 주차포장·정자·식재)과 girder_bridge 가 여기 걸렸다 — 목재 부재가 없는 조경이라
  // 목재 검토가 비는 것이 **정상**인데, 그것이 "조경 검토 이상 없음"으로 인쇄됐다.
  const judged = countJudged(r);
  // 검토가 **성공했더라도** 그 안에서 안 돌린 항목이 있으면 함께 올린다(260729).
  // 하중경로가 ok=true 인데 지진·풍을 한 번도 안 본 채로 나가면, 소비자는 그것을
  // 구조 검증으로 읽는다 — 통과와 미실시는 같은 자리에 놓일 수 없다.
  const lateral = Array.isArray(r?.lateralUnavailable) ? r.lateralUnavailable : [];
  // 공간 구획·피난은 building 의 어느 하위 경로(라멘·벽식·덕트)로 가든 똑같이 빠진다 —
  // 그래서 개별 검사가 아니라 **디스패치 뒤**에서 한 번 본다(260729).
  const space = spaceUnavailable(assembly);
  if (space) lateral.push(space);
  // 덕트 사이징처럼 **검토 안의 미실시 항목**도 같은 자리로 올린다(260729).
  if (r?.sizingUnavailable?.messageKo) lateral.push({ labelKo: '덕트 사이징', messageKo: r.sizingUnavailable.messageKo });
  if (r?.egressUnavailable?.messageKo) lateral.push({ labelKo: '수용인원·피난폭', messageKo: r.egressUnavailable.messageKo });
  const evidenceSufficient = judged > 0;
  const inputGated = countInputGated(r);
  const noEvidence = !evidenceSufficient
    ? [inputGated > 0
      // 부재는 있는데 지배 입력이 없어 판정을 못 한 경우 — 입력하면 된다는 사실을 지운면 안 된다.
      ? `${run.label}: **판정한 항목이 0개입니다** — 검토 대상 ${inputGated}개가 입력 대기 상태입니다(단면력은 산출됐으나 철근 등 지배 입력이 선언되지 않음). "이상 없음"이 아니라 **판정 불가**입니다.`
      // ⚠ 이유를 단정하지 않는다. INPUT 표식이 없으면 우리가 아는 것은 "합·불을 낸 항목이
      // 0개"라는 사실뿐이다 — 적용 대상이 없어서일 수도(목재 없는 조경), 검사 항목이
      // 아예 산출되지 않아서일 수도 있다(girder_bridge 는 철근 미입력 시 단면 검토를
      // 만들지도 않는다). 모르는 것을 아는 것처럼 적으면 그게 또 다른 날조다.
      : `${run.label}: **판정한 항목이 0개입니다** — 이 검사에서 합·불을 낸 항목이 하나도 없습니다. `
        + '적용 대상이 없거나(예: 목재 부재가 없는 조경) 검토 항목이 산출되지 않은 것이며, '
        + '어느 쪽이든 **"이상 없음"이 아닙니다.**']
    : [];
  return {
    label: run.label, ok: failed.length === 0, failed, judged, evidenceSufficient,
    ...(lateral.length || noEvidence.length
      ? { unavailable: [...lateral.map((u) => `${u.labelKo}: ${u.messageKo}`), ...noEvidence] }
      : {}),
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
  /**
   * ⚠ 260729c: `ok === false` 일 때 **계산된 checks 를 통째로 버리고** 있었다.
   *
   * 실측: `tower_crane` 은 `mechCheck` 가 `staticTipover`(적합)·`seismicTipover`(입력 대기)를
   * 실제로 산출하는데, 지배 입력(카운터웨이트)이 없어 `ok:false` 라는 이유로 안전검토.html
   * 에 **"검토 불가" 한 줄만** 나갔다. 기계 6종이 전부 그랬고, 그들에게는 전도가 유일한
   * 판정이었다 — 배선해 놓고 정작 필요한 곳에서 사라진 것이다.
   *
   * 「검토 불가」와 「그 안에서 실제로 본 것」은 **함께 있어야 한다.** 사유는 사유대로 적고,
   * 산출된 검토는 그대로 그린다. 이 세션에서 「조기 반환이 고지를 삼킨다」를 네 번 잡았는데,
   * **여기가 그 마지막 진입점**이라 개별 자리가 아니라 렌더 입구에서 한 번에 처리한다.
   */
  // ⚠ 「검토 불가」와 「입력 대기」는 다른 말이다. needInputs 가 있는 것은 **정직 거부**
  //   (지배 입력이 없어 판정하지 않음)이지 검사가 실패한 것이 아니다. 종전에는 error 가
  //   없으면 "검토 불가: 알 수 없는 사유" 로 나가 원인을 모르는 실패처럼 읽혔다.
  const needs = Array.isArray(r?.needInputs) ? r.needInputs : [];
  const reason = r && r.ok === false
    // escMd — 260729b 실측: 이 분기만 esc 라 steel_canopy 의 `**풍 상향력이 지배**` 가
    // 원문 그대로 샜다. 강조 처리는 **모든 문자열 출구**를 통과해야 한다.
    ? (needs.length && !r.error && !r.gateError
      ? `<div class="card warn"><b>입력 대기 — 판정하지 않음</b>: 지배 입력이 없어 이 검토를 `
        + `수행하지 않았습니다(값을 지어내지 않습니다). <b>"이상 없음"이 아닙니다.</b>`
        + `<div style="margin-top:6px">필요 입력: ${needs.map((x) => escMd(x.labelKo ?? x.name ?? '')).join(' · ')}</div></div>`
      : `<div class="card warn">검토 불가: ${escMd(r.error ?? r.gateError ?? '사유 미상')}`
        + (needs.length ? `<div style="margin-top:6px">필요 입력: ${needs.map((x) => escMd(x.labelKo ?? x.name ?? '')).join(' · ')}</div>` : '')
        + '</div>')
    : '';
  /**
    * ⚠ 사전에 없는 키는 **원문 그대로 나간다** — 그리고 그 사실을 고지한다.
    * 조용히 넘어가면 계산기에 새 키가 생겨도 아무도 모른다(이 세션에서 반복해 잡은 형태:
    * 있는데 안 닿음 · 없는데 없다고 안 함). 고지가 곧 다음 세션의 작업 목록이다.
    *
    * ⚠ 배포 직후 **이 기구가 스스로를 잡았다.** 같은 세션에 새로 만든 단지 배치 검토의
    * `notChecked` 가 라이브 문서에 영문 그대로 나갔고, 고지가 그것을 이름으로 짚었다 —
    * 사전을 붙이는 것만으로는 새 키를 못 막는다는 것이 실증된 것이다(그래서 고지가 있다).
    */
  const unlabeled = new Set();
  const tree = renderGenericCheckTree(r, 0, unlabeled);
  const unlabeledNote = unlabeled.size
    ? `<div class="note">⚠ 이 문서의 다음 항목명은 계산기 내부 키가 그대로 표시됐습니다(한국어 라벨 미등록): `
      + `${[...unlabeled].map((k) => `<code>${esc(k)}</code>`).join(' · ')}. `
      + `값과 판정은 정상이며, 표기만 보완 대상입니다.</div>`
    : '';
  const body = (reason
    ? reason + (tree ? `<div class="note">아래는 그와 <b>별개로 실제 산출된 검토</b>다 — 「검토 불가」가 전부가 아니다.</div>${tree}` : '')
    : (tree || '<div class="note">산출된 세부 검토값이 없습니다.</div>')) + unlabeledNote;
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
