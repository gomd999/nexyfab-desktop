/**
 * citations.mjs — 분야 검증 근거의 **구조화된 인용**(완벽화 Pillar ③).
 *
 * 계산기별로 그 검토가 근거한 문서·조항을 돌려준다. 인용 문서는 전부 미 연방 퍼블릭도메인
 * (17 U.S.C. §105). **인용문(전문)은 날조하지 않는다** — 문서·조항·링크·라이선스만(검증가능).
 *
 * 문서 메타는 여기 **인라인**한다(knowledge-crawler/sources.json에서 발췌). 이유: 크롤러
 * 디렉토리(323MB)는 Docker 이미지에서 제외되므로 런타임에 sources.json을 못 읽는다.
 * 전문(full-text) 의미검색 RAG은 별개 인프라(코퍼스+Workers AI 프로덕션 등재) — 여기선
 * 코퍼스 수록 PD 문서로의 "구조화된 참조"까지. 코퍼스 밖(AISC·KDS·ACI)은 조항번호만 표기.
 */

const PD = 'US-Government-Public-Domain';

// 인용 대상 PD 문서 메타(sources.json 발췌 — 미 연방정부 저작물).
const SOURCE_META = {
  'usace-em-1110-2-2502': {
    title: 'USACE EM 1110-2-2502 — Retaining and Flood Walls',
    publisher: 'U.S. Army Corps of Engineers (USACE)',
    url: 'https://www.publications.usace.army.mil/Portals/76/Publications/EngineerManuals/EM_1110-2-2502.pdf',
    license: PD,
  },
  'usace-em-1110-2-2100': {
    title: 'USACE EM 1110-2-2100 — Stability Analysis of Concrete Structures',
    publisher: 'U.S. Army Corps of Engineers (USACE)',
    url: 'https://www.publications.usace.army.mil/Portals/76/Publications/EngineerManuals/EM_1110-2-2100.pdf',
    license: PD,
  },
  'fhwa-sbdh-vol4': {
    title: 'FHWA Steel Bridge Design Handbook — Vol. 4: Structural Behavior of Steel',
    publisher: 'U.S. DOT Federal Highway Administration (FHWA)',
    url: 'https://www.fhwa.dot.gov/bridge/steel/pubs/hif16002/volume04.pdf',
    license: PD,
  },
  'fhwa-sbdh-vol13': {
    title: 'FHWA Steel Bridge Design Handbook — Vol. 13: Bracing System Design',
    publisher: 'U.S. DOT Federal Highway Administration (FHWA)',
    url: 'https://www.fhwa.dot.gov/bridge/steel/pubs/hif16002/volume13.pdf',
    license: PD,
  },
  'osha-3150': {
    title: 'OSHA 3150 — A Guide to Scaffold Use in the Construction Industry',
    publisher: 'U.S. Occupational Safety and Health Administration (OSHA)',
    url: 'https://www.osha.gov/sites/default/files/publications/osha3150.pdf',
    license: PD,
  },
};

/** 계산기 → [{ sourceId?(PD 문서), clause, note? }]. sourceId 없으면 조항-only(코퍼스 미수록). */
const CALC_CITATIONS = {
  retaining_wall_stability: [
    { sourceId: 'usace-em-1110-2-2502', clause: '옹벽 안정 — 임계 파괴면·안전율(전도·활동·지지력)', note: '중력식·캔틸레버 옹벽 안정 검토의 1차 근거', page: 126 },
    { sourceId: 'usace-em-1110-2-2100', clause: '콘크리트 구조 안정 해석 일반', note: '안정 해석 방법론 참조' },
  ],
  column_buckling: [
    { sourceId: 'fhwa-sbdh-vol4', clause: '압축재 거동 — 휨좌굴·유효좌굴길이', note: '강부재 좌굴 거동 근거(코퍼스 수록)', page: 66 },
    { clause: 'AISC 360-16 §E3 (휨좌굴 Fcr)', note: 'AISC 원문 비-PD 미수록 — 조항 참조만' },
  ],
  simple_beam: [
    { sourceId: 'fhwa-sbdh-vol4', clause: '휨부재 거동 — 공칭 휨강도', note: '강보 거동 근거(코퍼스 수록)', page: 213 },
    { clause: 'AISC 360-16 §F2 (허용휨)', note: 'AISC 원문 비-PD 미수록 — 조항 참조만' },
  ],
  rack_frame: [
    { sourceId: 'fhwa-sbdh-vol13', clause: '브레이싱·횡지지 설계(브레이스 소요력)', note: '횡변위·브레이싱 근거', page: 15 },
    { sourceId: 'osha-3150', clause: '가설 구조(비계) 사용 지침', note: '가설재 안전 일반 지침' },
  ],
  landscape_drainage: [
    { clause: '합리식 Q=CiA + Manning 유속식', note: '일반 수문·수리(공식=아이디어, 저작권 무관). 코퍼스 미수록' },
  ],
  rc_beam: [
    { clause: 'KDS 14 20 / ACI 318 (RC 휨·전단)', note: 'KDS·ACI 원문 비-PD 미수록 — 조항 참조만' },
  ],
  rc_column_pm: [
    { clause: 'KDS 14 20 / ACI 318 (P-M 상관)', note: 'KDS·ACI 원문 비-PD 미수록 — 조항 참조만' },
  ],
};

/** 계산기 id → 구조화된 인용 목록(문서 메타 해석). */
export function getCitations(calculatorId) {
  const specs = CALC_CITATIONS[calculatorId] ?? [];
  return specs.map((c) => {
    const s = c.sourceId ? SOURCE_META[c.sourceId] : null;
    // 페이지가 있으면 PDF 딥링크(#page=N)로 원문 그 페이지를 바로 연다.
    const url = s?.url ? (c.page ? `${s.url}#page=${c.page}` : s.url) : null;
    return {
      clause: c.clause,
      note: c.note ?? null,
      statutory: false,
      inCorpus: !!s,
      page: c.page ?? null,
      title: s?.title ?? null,
      publisher: s?.publisher ?? null,
      url,
      license: s?.license ?? null,
    };
  });
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('citations.mjs');
if (isMain) {
  const id = process.argv[2] || 'retaining_wall_stability';
  console.log(JSON.stringify(getCitations(id), null, 2));
}
