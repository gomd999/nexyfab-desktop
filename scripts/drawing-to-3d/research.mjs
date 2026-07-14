/**
 * research.mjs — 관련 연구(논문) 참고 레이어 (⑥ 리서치 레이어 1단계).
 *
 * 흐름: 설계(도메인·부품 role) → **결정론 검색어**(AI 불요, 지어낼 여지 없음)
 *   → OpenAlex + Crossref 공식 API 실조회 → **반환된 항목만** 정규화·렌더.
 *
 * 그라운딩 원칙(불변): 인용은 API 응답에 존재하는 DOI/제목만 — LLM이 서지사항을
 * 생성하는 경로가 아예 없다(날조 원천 차단). AI는 후속 단계에서 "관련성 요약"만
 * 붙일 수 있으며 그때도 서지는 이 모듈 산출만 사용.
 *
 * 정직 표기: "검색 기반 자동 수집 — 대표성·최신성·품질 보장 아님, 선별·정독은 사용자.
 * 특허 검토(침해·회피)는 KIPRIS 등 특허 공식 API + 변리사 검토 영역 — 본 부록은 논문만."
 *
 * 소스: OpenAlex(api.openalex.org, 키 불요·CC0) · Crossref(api.crossref.org, 키 불요).
 * polite pool: mailto=nexyfab@nexysys.com.
 */

const MAILTO = 'nexyfab@nexysys.com';
const round = (v, n = 0) => +Number(v).toFixed(n);

/** 도메인·부품 구성 → 결정론 검색어 (영문 — 국제 문헌 커버리지). */
export function buildQueries(assembly = {}, domain = null) {
  const dom = domain ?? assembly.domain ?? 'mech';
  const roles = new Set((assembly.parts ?? []).map((p) => p.role).filter(Boolean));
  const types = new Set((assembly.parts ?? []).map((p) => p.type).filter(Boolean));
  const q = [];
  if (dom === 'building') {
    q.push('reinforced concrete frame gravity load design');
    if (roles.has('slab')) q.push('two-way slab tributary load distribution');
    q.push('isolated footing punching shear design');
  } else if (dom === 'landscape') {
    if (roles.has('joist') || roles.has('deck')) q.push('timber deck joist allowable stress design');
    if (roles.has('column')) q.push('timber pergola wind load overturning');
    q.push('wood structural member load duration factor');
  } else if (dom === 'interior') {
    q.push('evacuation travel distance egress design building');
    q.push('restaurant occupant load egress width');
  } else if (dom === 'civil') {
    q.push('cantilever retaining wall stability Rankine earth pressure');
    q.push('retaining wall earthwork quantity estimation');
  } else {
    // mech/기타 — 부품 타입 기반
    if (types.has('spur_gear')) q.push('involute spur gear design bending stress');
    if (types.has('sheet_profile') || types.has('bent_sheet')) q.push('sheet metal bending K-factor springback');
    if (types.has('flange') || types.has('tube')) q.push('bolted flange joint design pressure vessel');
    if (!q.length) q.push('machine frame structural design verification');
  }
  return q.slice(0, 3);
}

function normOpenAlex(w) {
  return {
    source: 'OpenAlex',
    title: w.display_name ?? '',
    year: w.publication_year ?? null,
    authors: (w.authorships ?? []).slice(0, 3).map((a) => a.author?.display_name).filter(Boolean),
    doi: (w.doi ?? '').replace(/^https?:\/\/doi\.org\//, '') || null,
    url: w.doi ?? w.id ?? null,
    venue: w.primary_location?.source?.display_name ?? null,
    cited: w.cited_by_count ?? null,
  };
}
function normCrossref(w) {
  return {
    source: 'Crossref',
    title: Array.isArray(w.title) ? w.title[0] : (w.title ?? ''),
    year: w.issued?.['date-parts']?.[0]?.[0] ?? null,
    authors: (w.author ?? []).slice(0, 3).map((a) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean),
    doi: w.DOI ?? null,
    url: w.DOI ? `https://doi.org/${w.DOI}` : (w.URL ?? null),
    venue: Array.isArray(w['container-title']) ? w['container-title'][0] : null,
    cited: w['is-referenced-by-count'] ?? null,
  };
}

/** 검색어 1개 → 두 소스 조회(실패한 소스는 건너뜀 — 부분 결과 정직 반환). */
export async function searchPapers(query, { perSource = 4 } = {}) {
  const out = [];
  const errs = [];
  try {
    const r = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${perSource}&sort=relevance_score:desc&mailto=${MAILTO}`);
    if (r.ok) {
      const j = await r.json();
      out.push(...(j.results ?? []).map(normOpenAlex));
    } else errs.push(`OpenAlex ${r.status}`);
  } catch (e) { errs.push('OpenAlex ' + e.message.slice(0, 40)); }
  try {
    const r = await fetch(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${perSource}&select=DOI,title,author,issued,container-title,is-referenced-by-count,URL&mailto=${MAILTO}`);
    if (r.ok) {
      const j = await r.json();
      out.push(...(j.message?.items ?? []).map(normCrossref));
    } else errs.push(`Crossref ${r.status}`);
  } catch (e) { errs.push('Crossref ' + e.message.slice(0, 40)); }
  // 결정론 관련성 게이트: 제목에 (앵커어 포함) 또는 (질의어 ≥2개 포함) — 키워드 노이즈 제거.
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const anchor = words[0]; // 도메인 앵커 (timber/reinforced/evacuation/cantilever/involute…)
  const relevant = (p) => {
    const t = p.title.toLowerCase();
    if (anchor && t.includes(anchor)) return true;
    return words.filter((w) => t.includes(w)).length >= 2;
  };
  // DOI 기준 중복 제거 + 관련성 게이트, 인용수 내림차순
  const seen = new Set();
  const dedup = out.filter((p) => {
    const k = p.doi ?? p.title.toLowerCase();
    if (!p.title || seen.has(k) || !relevant(p)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => (b.cited ?? 0) - (a.cited ?? 0));
  return { query, papers: dedup, dropped: out.length - dedup.length, errors: errs };
}

/** 어셈블리/도메인 → 검색어 전부 조회. */
export async function researchForDesign(assembly, { domain = null, perSource = 4 } = {}) {
  const queries = buildQueries(assembly ?? {}, domain);
  const groups = [];
  for (const q of queries) groups.push(await searchPapers(q, { perSource }));
  const total = groups.reduce((s, g) => s + g.papers.length, 0);
  return {
    ok: true,
    queries, groups, total,
    grounding: '서지사항 전부 OpenAlex/Crossref 공식 API 응답 원문 — AI 생성 인용 없음',
    disclaimer: '검색 기반 자동 수집(비법정) — 대표성·최신성·품질 보장 아님, 선별·정독은 사용자 책임. 특허 검토(침해·회피)는 별도 특허 API+변리사 영역.',
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** 관련 연구 부록 HTML (A4 인쇄양식). */
export function researchReport(r, { title = '관련 연구 근거' } = {}) {
  const groups = (r.groups ?? []).map((g) => `
<h2>🔍 ${esc(g.query)}</h2>
${g.papers.length ? `<table><tr><th style="width:46%">제목</th><th>저자</th><th>연도</th><th>게재</th><th>피인용</th><th>DOI</th></tr>
${g.papers.map((p) => `<tr><td style="text-align:left">${esc(p.title)}</td><td>${esc(p.authors.join(', '))}${p.authors.length >= 3 ? ' 외' : ''}</td><td>${p.year ?? '-'}</td><td style="text-align:left">${esc(p.venue ?? '-')}</td><td>${p.cited ?? '-'}</td><td>${p.url ? `<a href="${esc(p.url)}" target="_blank">${esc(p.doi ?? '링크')}</a>` : '-'}</td></tr>`).join('')}</table>` : '<div class="note">결과 없음</div>'}
${g.errors.length ? `<div class="note">소스 오류: ${g.errors.map(esc).join(' · ')}</div>` : ''}`).join('');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 portrait;margin:12mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937;font-size:13px}
.nf-print-bar{position:sticky;top:0;z-index:9;background:#1f2937;color:#fff;padding:7px 16px;font-size:12.5px;display:flex;gap:12px;align-items:center}.nf-print-bar button{background:#2563eb;color:#fff;border:0;padding:5px 13px;border-radius:6px;cursor:pointer}
.sheet{max-width:900px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 22px}.hd{padding:15px 24px;border-bottom:2px solid #1f2937}.hd h1{margin:0;font-size:18px}.hd .s{color:#64748b;font-size:12px}
h2{font-size:13.5px;margin:18px 24px 6px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}table{border-collapse:collapse;margin:6px 24px;font-size:11px;width:calc(100% - 48px)}td,th{border:1px solid #cbd5e1;padding:4px 7px;text-align:center}th{background:#f1f5f9}a{color:#2563eb}
.honest{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;margin:8px 24px;padding:8px 14px;font-size:11.5px;color:#92400e}.note{font-size:11px;color:#94a3b8;padding:4px 24px}
@media print{.nf-print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body><div class="nf-print-bar"><b>관련 연구 근거 (자동 수집)</b><button onclick="print()">🖨 인쇄 / PDF</button></div>
<div class="sheet"><div class="hd"><h1>${esc(title)} — 관련 연구 근거</h1><div class="s">nexyfab research layer · OpenAlex + Crossref 공식 API · 총 ${r.total}건</div></div>
<div class="honest">⚠ <b>${esc(r.grounding)}</b>. ${esc(r.disclaimer)}</div>
${groups}
<div class="note">데이터: OpenAlex(CC0) · Crossref. 검색어는 설계 구성에서 결정론 생성.</div>
</div></body></html>`;
}

// --- self-test (실 API 호출) ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('research.mjs');
if (isMain) {
  const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
  const asm = buildAssemblyTemplate('landscape', 'pergola', {});
  const r = await researchForDesign(asm, {});
  console.log('검색어:', r.queries.join(' | '));
  for (const g of r.groups) console.log(`- "${g.query}": ${g.papers.length}건`, g.papers[0] ? `(1위: ${g.papers[0].title.slice(0, 60)}… ${g.papers[0].year}, 인용 ${g.papers[0].cited})` : '', g.errors.join(','));
  const html = researchReport(r);
  console.log('HTML:', (html.length / 1024).toFixed(0) + 'KB | DOI 링크:', (html.match(/doi\.org/g) ?? []).length, '개');
  const pass = r.ok && r.total > 0 && html.includes('AI 생성 인용 없음');
  console.log(pass ? 'research self-test: PASS' : 'research self-test: FAIL');
  if (!pass) process.exit(1);
}
