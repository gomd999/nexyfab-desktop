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
