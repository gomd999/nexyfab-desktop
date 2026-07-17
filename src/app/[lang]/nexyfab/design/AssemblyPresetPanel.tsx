'use client';

/**
 * 도메인 어셈블리 프리셋 패널 (#6 비-기계 3D UI) — RC 골조·파고라·데크·카페 등
 * 결정론 어셈블리 템플릿(parts[])을 파라미터로 생성하고, 빌드 결과(질량·간섭·경고)를
 * 보여준 뒤 설계 패키지(zip: GA 3D 계통색·2D GA·구조·BOQ 재적·Dossier·FEA·SCAD)를
 * 바로 다운로드한다. GET/POST /api/nexyfab/drawing/preset?kind=assembly.
 *
 * 어셈블리 템플릿이 없는 분야(mech·rack·civil)에서는 렌더되지 않는다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { isKorean, toIsoLang } from '@/lib/i18n/normalize';
import type { PickEvent, PickMode } from './AssemblyViewer3D';
import InteriorPlanEditor, { type Furn } from './InteriorPlanEditor';

// 3D 픽킹 뷰어 — three 청크 분리(ssr 불가·클라 전용)
const AssemblyViewer3D = dynamic(() => import('./AssemblyViewer3D'), { ssr: false });

// ─── i18n dictionary (6-lang, identical key sets — see AIAdvisor.tsx pattern) ──

const dict = {
  ko: {
    tplTitle: '어셈블리 템플릿',
    tplSub: '다부재 · 설계 패키지 지원',
    buildBusy: '빌드 중…',
    buildBtn: '어셈블리 생성',
    builtParts: '생성됨 · 부재 ',
    clash: '간섭',
    advTitle: '고급 입력(JSON — 선형·곡선·구조물·등고·토공·배관)', advHint: '숫자 폼과 병합 · 게이트 거부 문구가 그대로 오류로 표시됩니다', advBad: 'JSON 객체가 필요합니다', floating: '부유', faceContact: '면접촉(매립 권장)', pipeBad: '배관 위반', pipeOk: '배관', sleeve: '슬리브',
    failed: '실패: ',
    packaging: '패키지 생성 중…',
    pkgBtn: '📦 설계 패키지 다운로드',
    pkgFailed: '패키지 생성 실패',
    pkgFailPrefix: '패키지 실패: ',
    papersBtn: '관련 논문 부록 (OpenAlex·Crossref 실인용)',
    reportFailed: '리포트 HTML 생성 실패',
    reportHtml: '리포트 HTML',
    checking: '검증 중…',
    // 유료 전문 조사 의뢰
    erBtn: '전문 조사 의뢰 (유료) — 선행기술·회피설계',
    erDesc: '전문가가 직접 수행(AI 검색 도구 지원)하는 유료 서비스입니다. 접수 후 견적·일정을 회신드립니다. 현재 설계 스냅샷이 자동 첨부됩니다.',
    erNeedNameEmail: '이름·이메일을 입력해 주세요.',
    erDone: '✅ 접수 완료 — 검토 후 견적과 일정으로 회신드립니다.',
    erFailPrefix: '접수 실패: ',
    erName: '이름/회사',
    erEmail: '이메일',
    erMsgPh: '요청사항 (대상 시장·경쟁사·우려 특허 등)',
    erSubmitting: '접수 중…',
    erSubmit: '의뢰 접수 (견적 회신)',
    erDisclaimer: '⚠ 본 서비스는 변리사의 정식 FTO 의견서를 대체하지 않습니다(필요 시 변리사 연계 안내).',
    svcPriorArt: '선행기술 조사·분석',
    svcPriorArtD: '특허·논문 정밀 조사, 유사도 분석 리포트',
    svcDesignAround: '회피 설계 검토',
    svcDesignAroundD: '조사 결과 기반 설계 변경 포인트 + 재검증',
    svcGlobal: '글로벌 확장 조사',
    svcGlobalD: '미국·중국·유럽 특허 랜드스케이프',
    // 토목 (옹벽)
    cvTitle: '옹벽 안정 검증',
    cvSub: '단면 자동 파생 · 토질만 입력',
    cvGamma: '뒤채움 γ kN/m³',
    cvPhi: '내부마찰각 °',
    cvMu: '저면 마찰 μ',
    cvQa: '허용지지력 kPa',
    cvSurcharge: '상재하중 kPa',
    cvKh: '지진계수 kh (0=정적)',
    cvRun: '🧱 옹벽 안정 검증 실행',
    cvSeismicMO: '지진시(M-O)',
    // 인테리어
    inTitle: '피난·마감 검증',
    inSub: '보행거리 BFS 실측 · 문폭 형상 파생',
    inRun: '🚪 피난·마감 검증 실행',
    inTravel: '최원점 보행거리',
    inUnreachable: '미도달',
    inEgress: '수용·피난폭',
    inDoors: '문폭합',
    inSeats: '좌석',
    inFinish: '마감',
    inFloor: '바닥',
    inWall: '벽',
    inCeiling: '천장',
    // 조경
    lsTitle: '목재 부재·풍하중 검증',
    lsSub: 'KDS 41 50 10 허용응력 · 단면·스팬 형상 파생',
    lsSpecies: '수종군',
    lsLarch: '낙엽송류',
    lsPine: '소나무류',
    lsKoreanPine: '잣나무류',
    lsCedar: '삼나무류',
    lsGrade: '등급',
    gradeSuffix: '등급',
    lsUsage: '용도(데크 활하중)',
    lsUseRes: '주거 2.0',
    lsUseGarden: '정원·집회 5.0',
    lsUseAssembly: '집회(이동석) 5.0',
    lsWind: '풍압 kN/m² (0=생략)',
    lsRun: '🌳 부재·풍하중 검증 실행',
    lsJoist: '장선/서까래',
    lsTip: '전도',
    lsAnchor: '앵커',
    lsPerPost: '본',
    // 건축 (하중경로)
    bdTitle: '하중경로 검증',
    bdSub: '자중(형상)+활하중(KDS 표 3.2-1) → 보→기둥→기초',
    bdUsage: '용도(활하중)',
    bdOffice: '일반 사무실',
    bdBeamAs: '보 As mm²',
    bdStirrupAv: '스터럽 Av',
    bdSpacingS: '간격 s',
    bdColAst: '기둥 Ast',
    bdFtgB: '기초 B',
    bdFtgL: '기초 L',
    bdQAllow: '지지력 kPa',
    bdSeisZone: '지진구역 (선택)',
    bdSeisOff: '미검토',
    bdZoneI: '구역 I (0.11)',
    bdZoneII: '구역 II (0.07)',
    bdSite: '지반',
    bdRTable: '표 6.2-1',
    bdChainBusy: '체인 검증 중…',
    bdRun: '⛓ 하중경로 검증 실행',
    bdSlab: '슬래브',
    bdFooting: '기초',
    bdInputsNeeded: '입력 필요',
    bdSlabDefl: '슬래브 처짐',
    bdSeismic: '지진',
    bdCol: '기둥',
    bdWindV0: '기본풍속 V0 m/s',
    bdWindV0Ph: '그림 5.5-1 지역값',
    bdWindExp: '지표면조도',
    bdWindTerrain: '지형(간편법)',
    bdTerrainNormal: '일반',
    bdTerrainFlatOpen: '평탄 개활지',
    bdTerrainCoast: '해안',
    bdWind: '풍하중',
    inLuxLabel: '목표조도 lx',
    inLuxPh: 'KS A 3011 용도별',
    inLumenLabel: '램프광속 lm',
    inVentLabel: '인당환기량 m³/h·인',
    inLoadLabel: '부하밀도 VA/m²',
    inLight: '조명',
    inFixSuffix: '등',
    inAvgLux: '평균',
    inVent: '환기',
    inElec: '전기',
    inCircuitSuffix: '회로',
    lsConn: '접합철물',
    lsConnNone: '미지정(기본)',
    lsConnNailOpt: '못 89×4.11 2본',
    lsConnBoltOpt: '볼트 D12',
    lsNail: '못',
    lsBolt: '볼트',
    lsConnRow: '접합부',
    lsDemand: '반력',
    lsCapacity: '내력',
    lsRatio: '비율',
    vwTitle: '3D 뷰어 — 면 클릭 편집',
    vwSub: '면=파라미터 매핑 · 수정 시 자동 재검증',
    vwHide: '접기',
    vwShow: '펼치기',
    fpHint: '부재의 면을 클릭하면 매핑된 파라미터 편집이 열립니다.',
    fpFace: '면',
    fpParam: '파라미터',
    fpReadOnly: '부품 개별 치수 — 읽기 전용 (템플릿 파라미터 아님)',
    fpSection: '복합 단면 면 — 편집 가능한 템플릿 파라미터만 표시합니다.',
    fpUnmapped: '이 면은 파라미터 매핑이 없습니다 — 비검증 직접편집(P4)은 전문가 CAD에서.',
    fpReverify: '수정 반영 → 재검증 중…',
    fpMapFail: '면 매핑 조회 실패: ',
    pmFace: '면',
    pmEdge: '모서리',
    pmDist: '거리',
    edHint: '모서리 = 두 치수의 교차 — 수정할 치수를 선택하세요.',
    dsHint: '거리 모드 — 부재 두 개를 차례로 클릭하세요.',
    dsPickB: '기준 부재 선택됨 — 두 번째 부재를 클릭하세요.',
    dsGap: '중심 간격',
    dsDerived: '이 간격은 배치 수에서 파생 — 개수 파라미터를 수정하세요.',
    dsNone: '거리 매핑 없음 — 이 부재 쌍의 간격은 템플릿 파라미터가 아닙니다.',
    nlPh: '말로 수정 — 예: "3500으로", "10% 늘려", "bayX 200 줄여"',
    nlSend: '적용',
    nlBusy: '해석 중…',
    nlSrcRegex: '정규식',
    nlSrcAi: 'AI',
    nlApplied: '적용됨: ',
    nlFail: '해석 실패: ',
    vcTitle: '음성 입력',
    swBtn: '안전범위',
    swBusy: '스윕 중… (체인 8회)',
    swFail: '스윕 실패: ',
    glBtn: '목표 탐색',
    glMin: '최소 통과값',
    glMax: '최대 통과값',
    glFound: '통과 경계 ≈ ',
    snLabel: '표준 절점',
    snSrc: '출처: ',
    fpTplWide: '템플릿 치수 — 같은 역할 전체에 적용됩니다.',
    dfTitle: '수정 전후',
    dfBeamRatio: '보 휨비율',
    dfMemberRatio: '부재 휨비율',
    dfSeisCol: '지진 기둥',
    hsUndo: '실행취소',
    hsRedo: '다시실행',
    hsList: '이력',
    hsInit: '초기값',
    inSprkLabel: '스프링클러 수평거리 m',
    inSprkPh: 'NFTC 103 1.7/2.1/2.3',
    shBtn: '공유',
    shCopied: '공유 링크가 복사되었습니다.',
    shTooBig: '설계가 커서 링크로 담을 수 없습니다 — 저장을 사용하세요.',
    shPrompt: '아래 링크를 복사하세요:',
    shRestored: '공유 링크에서 복원됨',
    pjSave: '저장',
    pjNamePh: '프로젝트 이름',
    pjLoad: '불러오기',
    pjDel: '삭제',
    pjNote: '저장: 게스트=브라우저 · 로그인=서버 동기화(☁ 서버 버튼).',
    pjRestored: '불러옴: ',
    pjSaveFail: '저장 실패(브라우저 저장소)',
    unitTitle: '표시 단위 전환 — 입력은 mm 고정',
    hkHelp: 'Ctrl+Z/Y = 실행취소/다시실행 · 1/2/3 = 면/모서리/거리 · Esc = 선택 해제',
    abBtn: '비교',
    abEnd: '비교 종료',
    abRestoreA: 'A로 복원',
    abTitle: 'A/B 비교',
    abParamDiff: '파라미터 차이',
    abNoDiff: '차이 없음',
    brTitle: '거더교 자동 체인',
    brSub: 'DC·DW 형상 파생 · KL-510 영향선 · 극한 I 조합',
    brPav: '포장두께 mm (DW·선택)',
    brLanes: '차로수 (선택)',
    brDF: 'DF (미입력=레버룰)',
    brAs: '거더 As mm² (선택·단면검토)',
    brRun: '🌉 거더교 체인 실행',
    brDC: '고정하중 DC',
    brLL: '활하중',
    brUlt: '극한',
    brSection: '단면검토',
    uniBtn: '통합 리포트',
    uniBusy: '리포트 구성 중…',
    uniNone: '포함할 리포트가 없습니다 — 검증이 실패했거나 실행되지 않았습니다.',
    uniMissing: '누락(실패/미실행): ',
    uniPrint: '인쇄 / PDF',
    svBtn: '서버',
    svLoginNote: '로그인 시 서버 저장 사용 가능(기기 간 동기화).',
    svSave: '서버 저장',
    svBusy: '서버 통신 중…',
    svFailPrefix: '서버 저장소 오류: ',
    svSaved: '서버에 저장되었습니다: ',
    svEmpty: '서버 프로젝트 없음',
    svNeedName: '프로젝트 이름을 입력하세요.',
  },
  en: {
    tplTitle: 'Assembly template',
    tplSub: 'multi-part · design package',
    buildBusy: 'Building…',
    buildBtn: 'Build assembly',
    builtParts: 'Built · parts ',
    clash: 'clash',
    advTitle: 'Advanced input (JSON — alignment·curves·structures·contours·earthwork·pipes)', advHint: 'Merged with numeric form · gate refusals shown verbatim', advBad: 'A JSON object is required', floating: 'floating', faceContact: 'face-contact (embed advised)', pipeBad: 'pipe violations', pipeOk: 'pipes', sleeve: 'sleeves',
    failed: 'Failed: ',
    packaging: 'Packaging…',
    pkgBtn: '📦 Download design package',
    pkgFailed: 'package failed',
    pkgFailPrefix: 'Package failed: ',
    papersBtn: 'Related papers (real OpenAlex·Crossref citations)',
    reportFailed: 'report HTML failed',
    reportHtml: 'Report HTML',
    checking: 'Checking…',
    erBtn: 'Expert research request (paid) — prior art & design-around',
    erDesc: 'Performed by an expert (AI-assisted). We reply with a quote & schedule. Your design snapshot is attached automatically.',
    erNeedNameEmail: 'Name & email required.',
    erDone: '✅ Received — we will reply with a quote & schedule.',
    erFailPrefix: 'Failed: ',
    erName: 'Name/Company',
    erEmail: 'Email',
    erMsgPh: 'Details (target market, competitors, patents of concern…)',
    erSubmitting: 'Submitting…',
    erSubmit: 'Submit request',
    erDisclaimer: '⚠ Not a substitute for a formal attorney FTO opinion (referral available).',
    svcPriorArt: 'Prior-art search & analysis',
    svcPriorArtD: 'patent & paper deep search, similarity report',
    svcDesignAround: 'Design-around review',
    svcDesignAroundD: 'design change points + re-verification',
    svcGlobal: 'Global landscape',
    svcGlobalD: 'US/CN/EU patent landscape',
    cvTitle: 'Retaining wall stability',
    cvSub: 'section from shape · soil only',
    cvGamma: 'γ backfill kN/m³',
    cvPhi: 'φ °',
    cvMu: 'μ base',
    cvQa: 'qAllow kPa',
    cvSurcharge: 'surcharge kPa',
    cvKh: 'seismic kh (0=static)',
    cvRun: '🧱 Run stability check',
    cvSeismicMO: 'Seismic (M-O)',
    inTitle: 'Egress & finish check',
    inSub: 'travel BFS · door width from shape',
    inRun: '🚪 Run egress & finish check',
    inTravel: 'Max travel',
    inUnreachable: 'unreachable',
    inEgress: 'Occupancy/egress',
    inDoors: 'doors',
    inSeats: 'seats',
    inFinish: 'Finish',
    inFloor: 'floor',
    inWall: 'wall',
    inCeiling: 'ceiling',
    lsTitle: 'Timber member & wind check',
    lsSub: 'KDS 41 50 10 allowable stress · section/span from shape',
    lsSpecies: 'Species',
    lsLarch: 'Larch',
    lsPine: 'Pine',
    lsKoreanPine: 'Korean pine',
    lsCedar: 'Cedar',
    lsGrade: 'Grade',
    gradeSuffix: '',
    lsUsage: 'Usage (deck live)',
    lsUseRes: 'Residential 2.0',
    lsUseGarden: 'Garden/assembly 5.0',
    lsUseAssembly: 'Assembly 5.0',
    lsWind: 'Wind kN/m² (0=skip)',
    lsRun: '🌳 Run timber & wind check',
    lsJoist: 'Joist',
    lsTip: 'Tip-over',
    lsAnchor: 'anchor',
    lsPerPost: 'post',
    bdTitle: 'Load-path check',
    bdSub: 'dead(shape)+live(KDS table 3.2-1) → beam→column→footing',
    bdUsage: 'Usage (live load)',
    bdOffice: 'Office',
    bdBeamAs: 'beam As mm²',
    bdStirrupAv: 'stirrup Av',
    bdSpacingS: 'spacing s',
    bdColAst: 'col Ast',
    bdFtgB: 'ftg B',
    bdFtgL: 'ftg L',
    bdQAllow: 'qAllow kPa',
    bdSeisZone: 'Seismic zone (opt.)',
    bdSeisOff: 'off',
    bdZoneI: 'Zone I (0.11)',
    bdZoneII: 'Zone II (0.07)',
    bdSite: 'Site',
    bdRTable: 'table 6.2-1',
    bdChainBusy: 'Checking…',
    bdRun: '⛓ Run load-path check',
    bdSlab: 'Slab',
    bdFooting: 'Footing',
    bdInputsNeeded: 'inputs needed',
    bdSlabDefl: 'Slab deflection',
    bdSeismic: 'Seismic',
    bdCol: 'col',
    bdWindV0: 'basic wind speed V0 m/s',
    bdWindV0Ph: 'regional value, Fig. 5.5-1',
    bdWindExp: 'Surface roughness (exposure)',
    bdWindTerrain: 'Terrain (simplified method)',
    bdTerrainNormal: 'normal',
    bdTerrainFlatOpen: 'flat open',
    bdTerrainCoast: 'coastal',
    bdWind: 'Wind',
    inLuxLabel: 'target illuminance lx',
    inLuxPh: 'per use, KS A 3011',
    inLumenLabel: 'lamp luminous flux lm',
    inVentLabel: 'ventilation m³/h·person',
    inLoadLabel: 'load density VA/m²',
    inLight: 'Lighting',
    inFixSuffix: ' fixtures',
    inAvgLux: 'avg',
    inVent: 'Ventilation',
    inElec: 'Electrical',
    inCircuitSuffix: ' circuits',
    lsConn: 'Connection hardware',
    lsConnNone: 'none (default)',
    lsConnNailOpt: 'nails 89×4.11 ×2',
    lsConnBoltOpt: 'bolt D12',
    lsNail: 'nail',
    lsBolt: 'bolt',
    lsConnRow: 'Connection',
    lsDemand: 'reaction',
    lsCapacity: 'capacity',
    lsRatio: 'ratio',
    vwTitle: '3D viewer — click a face to edit',
    vwSub: 'face=parameter mapping · auto re-verify on change',
    vwHide: 'Collapse',
    vwShow: 'Expand',
    fpHint: 'Click a face of a member to open its mapped parameter.',
    fpFace: 'face',
    fpParam: 'parameter',
    fpReadOnly: 'Per-part dimension — read-only (not a template parameter)',
    fpSection: 'Composite section face — only editable template parameters are shown.',
    fpUnmapped: 'This face has no parameter mapping — unverified direct editing (P4) lives in the expert CAD.',
    fpReverify: 'Applying change → re-verifying…',
    fpMapFail: 'Face mapping lookup failed: ',
    pmFace: 'Face',
    pmEdge: 'Edge',
    pmDist: 'Distance',
    edHint: 'An edge crosses two dimensions — choose the one to edit.',
    dsHint: 'Distance mode — click two members in turn.',
    dsPickB: 'First member selected — click the second one.',
    dsGap: 'center spacing',
    dsDerived: 'This spacing is derived from the layout count — edit the count parameter.',
    dsNone: "No distance mapping — this pair's spacing is not a template parameter.",
    nlPh: 'Edit by words — e.g. "set to 3500", "increase 10%", "reduce bayX by 200"',
    nlSend: 'Apply',
    nlBusy: 'Interpreting…',
    nlSrcRegex: 'regex',
    nlSrcAi: 'AI',
    nlApplied: 'Applied: ',
    nlFail: 'Interpretation failed: ',
    vcTitle: 'Voice input',
    swBtn: 'Safe range',
    swBusy: 'Sweeping… (8 chain runs)',
    swFail: 'Sweep failed: ',
    glBtn: 'Goal search',
    glMin: 'min passing value',
    glMax: 'max passing value',
    glFound: 'Pass boundary ≈ ',
    snLabel: 'standard nodes',
    snSrc: 'source: ',
    fpTplWide: 'Template dimension — applies to every member of the same role.',
    dfTitle: 'Before→after',
    dfBeamRatio: 'beam flexure ratio',
    dfMemberRatio: 'member flexure ratio',
    dfSeisCol: 'seismic column',
    hsUndo: 'Undo',
    hsRedo: 'Redo',
    hsList: 'History',
    hsInit: 'initial',
    inSprkLabel: 'sprinkler radius m',
    inSprkPh: 'NFTC 103: 1.7/2.1/2.3',
    shBtn: 'Share',
    shCopied: 'Share link copied.',
    shTooBig: 'Design too large for a link — use Save instead.',
    shPrompt: 'Copy this link:',
    shRestored: 'Restored from share link',
    pjSave: 'Save',
    pjNamePh: 'Project name',
    pjLoad: 'Load',
    pjDel: 'Delete',
    pjNote: 'Browser storage — no cross-device sync (server save later).',
    pjRestored: 'Loaded: ',
    pjSaveFail: 'Save failed (browser storage)',
    unitTitle: 'Display unit toggle — inputs stay in mm',
    hkHelp: 'Ctrl+Z/Y = undo/redo · 1/2/3 = face/edge/distance · Esc = clear pick',
    abBtn: 'Compare',
    abEnd: 'End compare',
    abRestoreA: 'Restore A',
    abTitle: 'A/B compare',
    abParamDiff: 'Parameter diffs',
    abNoDiff: 'no differences',
    brTitle: 'Girder bridge auto chain',
    brSub: 'DC·DW from shape · KL-510 influence line · Ultimate I combo',
    brPav: 'pavement thk mm (DW, opt.)',
    brLanes: 'lanes (opt.)',
    brDF: 'DF (blank=lever rule)',
    brAs: 'girder As mm² (opt., section check)',
    brRun: '🌉 Run bridge chain',
    brDC: 'Dead load DC',
    brLL: 'Live load',
    brUlt: 'Ultimate',
    brSection: 'Section check',
    uniBtn: 'Unified report',
    uniBusy: 'Composing report…',
    uniNone: 'No reports to include — checks failed or were not run.',
    uniMissing: 'Missing (failed/not run): ',
    uniPrint: 'Print / PDF',
    svBtn: 'Server',
    svLoginNote: 'Sign in to use server save (cross-device sync).',
    svSave: 'Save to server',
    svBusy: 'Contacting server…',
    svFailPrefix: 'Server storage error: ',
    svSaved: 'Saved to server: ',
    svEmpty: 'No server projects',
    svNeedName: 'Enter a project name.',
  },
  ja: {
    tplTitle: 'アセンブリテンプレート',
    tplSub: '複数部材 · 設計パッケージ対応',
    buildBusy: 'ビルド中…',
    buildBtn: 'アセンブリ生成',
    builtParts: '生成完了 · 部材 ',
    clash: '干渉',
    advTitle: '高度な入力（JSON — 線形・曲線・構造物・等高・土工・配管）', advHint: '数値フォームと結合・ゲート拒否文をそのまま表示', advBad: 'JSONオブジェクトが必要です', floating: '浮遊', faceContact: '面接触（埋込推奨）', pipeBad: '配管違反', pipeOk: '配管', sleeve: 'スリーブ',
    failed: '失敗: ',
    packaging: 'パッケージ生成中…',
    pkgBtn: '📦 設計パッケージをダウンロード',
    pkgFailed: 'パッケージ生成に失敗',
    pkgFailPrefix: 'パッケージ失敗: ',
    papersBtn: '関連論文付録（OpenAlex·Crossref 実引用）',
    reportFailed: 'レポートHTML生成に失敗',
    reportHtml: 'レポートHTML',
    checking: '検証中…',
    erBtn: '専門調査の依頼（有料）— 先行技術·回避設計',
    erDesc: '専門家が直接実施（AI検索ツール支援）する有料サービスです。受付後、見積·日程をご返信します。現在の設計スナップショットが自動添付されます。',
    erNeedNameEmail: '氏名·メールアドレスを入力してください。',
    erDone: '✅ 受付完了 — 検討後、見積と日程をご返信します。',
    erFailPrefix: '受付失敗: ',
    erName: '氏名/会社',
    erEmail: 'メール',
    erMsgPh: 'ご依頼内容（対象市場·競合·懸念特許など）',
    erSubmitting: '送信中…',
    erSubmit: '依頼を送信（見積返信）',
    erDisclaimer: '⚠ 本サービスは弁理士の正式なFTO鑑定書に代わるものではありません（必要に応じて弁理士をご紹介します）。',
    svcPriorArt: '先行技術調査·分析',
    svcPriorArtD: '特許·論文の精密調査、類似度分析レポート',
    svcDesignAround: '回避設計レビュー',
    svcDesignAroundD: '調査結果に基づく設計変更ポイント + 再検証',
    svcGlobal: 'グローバル展開調査',
    svcGlobalD: '米·中·欧の特許ランドスケープ',
    cvTitle: '擁壁安定性検証',
    cvSub: '断面は形状から自動導出 · 土質のみ入力',
    cvGamma: '裏込め γ kN/m³',
    cvPhi: '内部摩擦角 °',
    cvMu: '底面摩擦 μ',
    cvQa: '許容支持力 kPa',
    cvSurcharge: '上載荷重 kPa',
    cvKh: '地震係数 kh（0=静的）',
    cvRun: '🧱 擁壁安定性検証を実行',
    cvSeismicMO: '地震時（M-O）',
    inTitle: '避難·仕上げ検証',
    inSub: '歩行距離BFS実測 · 扉幅は形状から導出',
    inRun: '🚪 避難·仕上げ検証を実行',
    inTravel: '最遠点歩行距離',
    inUnreachable: '未到達',
    inEgress: '収容·避難幅',
    inDoors: '扉幅合計',
    inSeats: '座席',
    inFinish: '仕上げ',
    inFloor: '床',
    inWall: '壁',
    inCeiling: '天井',
    lsTitle: '木部材·風荷重検証',
    lsSub: 'KDS 41 50 10 許容応力 · 断面·スパンは形状から導出',
    lsSpecies: '樹種群',
    lsLarch: 'カラマツ類',
    lsPine: 'マツ類',
    lsKoreanPine: 'チョウセンゴヨウ類',
    lsCedar: 'スギ類',
    lsGrade: '等級',
    gradeSuffix: '等級',
    lsUsage: '用途（デッキ活荷重）',
    lsUseRes: '住宅 2.0',
    lsUseGarden: '庭園·集会 5.0',
    lsUseAssembly: '集会（可動席）5.0',
    lsWind: '風圧 kN/m²（0=省略）',
    lsRun: '🌳 部材·風荷重検証を実行',
    lsJoist: '根太/垂木',
    lsTip: '転倒',
    lsAnchor: 'アンカー',
    lsPerPost: '本',
    bdTitle: '荷重経路検証',
    bdSub: '自重（形状）+活荷重（KDS 表3.2-1）→ 梁→柱→基礎',
    bdUsage: '用途（活荷重）',
    bdOffice: '一般事務室',
    bdBeamAs: '梁 As mm²',
    bdStirrupAv: 'あばら筋 Av',
    bdSpacingS: '間隔 s',
    bdColAst: '柱 Ast',
    bdFtgB: '基礎 B',
    bdFtgL: '基礎 L',
    bdQAllow: '支持力 kPa',
    bdSeisZone: '地震区域（任意）',
    bdSeisOff: '未検討',
    bdZoneI: '区域 I（0.11）',
    bdZoneII: '区域 II（0.07）',
    bdSite: '地盤',
    bdRTable: '表6.2-1',
    bdChainBusy: 'チェーン検証中…',
    bdRun: '⛓ 荷重経路検証を実行',
    bdSlab: 'スラブ',
    bdFooting: '基礎',
    bdInputsNeeded: '入力が必要',
    bdSlabDefl: 'スラブたわみ',
    bdSeismic: '地震',
    bdCol: '柱',
    bdWindV0: '基本風速 V0 m/s',
    bdWindV0Ph: '図5.5-1 地域値',
    bdWindExp: '地表面粗度',
    bdWindTerrain: '地形（簡便法）',
    bdTerrainNormal: '一般',
    bdTerrainFlatOpen: '平坦開放地',
    bdTerrainCoast: '海岸',
    bdWind: '風荷重',
    inLuxLabel: '目標照度 lx',
    inLuxPh: 'KS A 3011 用途別',
    inLumenLabel: 'ランプ光束 lm',
    inVentLabel: '一人当たり換気量 m³/h·人',
    inLoadLabel: '負荷密度 VA/m²',
    inLight: '照明',
    inFixSuffix: '灯',
    inAvgLux: '平均',
    inVent: '換気',
    inElec: '電気',
    inCircuitSuffix: '回路',
    lsConn: '接合金物',
    lsConnNone: '未指定（既定）',
    lsConnNailOpt: '釘 89×4.11 2本',
    lsConnBoltOpt: 'ボルト D12',
    lsNail: '釘',
    lsBolt: 'ボルト',
    lsConnRow: '接合部',
    lsDemand: '反力',
    lsCapacity: '耐力',
    lsRatio: '比率',
    vwTitle: '3Dビューア — 面をクリックして編集',
    vwSub: '面=パラメータマッピング · 変更時に自動再検証',
    vwHide: '折りたたむ',
    vwShow: '展開',
    fpHint: '部材の面をクリックすると、マッピングされたパラメータ編集が開きます。',
    fpFace: '面',
    fpParam: 'パラメータ',
    fpReadOnly: '部品個別寸法 — 読み取り専用（テンプレートパラメータではありません）',
    fpSection: '複合断面の面 — 編集可能なテンプレートパラメータのみ表示します。',
    fpUnmapped: 'この面にはパラメータマッピングがありません — 非検証の直接編集（P4）はエキスパートCADで。',
    fpReverify: '変更反映 → 再検証中…',
    fpMapFail: '面マッピングの取得に失敗: ',
    pmFace: '面',
    pmEdge: 'エッジ',
    pmDist: '距離',
    edHint: 'エッジは2つの寸法の交差 — 編集する寸法を選択してください。',
    dsHint: '距離モード — 部材を2つ順にクリックしてください。',
    dsPickB: '基準部材を選択済み — 2つ目の部材をクリックしてください。',
    dsGap: '中心間隔',
    dsDerived: 'この間隔は配置数から導出 — 個数パラメータを修正してください。',
    dsNone: '距離マッピングなし — この部材ペアの間隔はテンプレートパラメータではありません。',
    nlPh: '言葉で修正 — 例:「3500に」「10%増やす」「bayXを200減らす」',
    nlSend: '適用',
    nlBusy: '解釈中…',
    nlSrcRegex: '正規表現',
    nlSrcAi: 'AI',
    nlApplied: '適用済み: ',
    nlFail: '解釈失敗: ',
    vcTitle: '音声入力',
    swBtn: '安全範囲',
    swBusy: 'スイープ中…（チェーン8回）',
    swFail: 'スイープ失敗: ',
    glBtn: '目標探索',
    glMin: '最小合格値',
    glMax: '最大合格値',
    glFound: '合格境界 ≈ ',
    snLabel: '標準節点',
    snSrc: '出典: ',
    fpTplWide: 'テンプレート寸法 — 同じ役割の部材すべてに適用されます。',
    dfTitle: '修正前後',
    dfBeamRatio: '梁曲げ比率',
    dfMemberRatio: '部材曲げ比率',
    dfSeisCol: '地震柱',
    hsUndo: '元に戻す',
    hsRedo: 'やり直す',
    hsList: '履歴',
    hsInit: '初期値',
    inSprkLabel: 'スプリンクラー水平距離 m',
    inSprkPh: 'NFTC 103 1.7/2.1/2.3',
    shBtn: '共有',
    shCopied: '共有リンクをコピーしました。',
    shTooBig: '設計が大きすぎてリンク化できません — 保存を使用してください。',
    shPrompt: 'このリンクをコピーしてください:',
    shRestored: '共有リンクから復元',
    pjSave: '保存',
    pjNamePh: 'プロジェクト名',
    pjLoad: '読み込み',
    pjDel: '削除',
    pjNote: 'ブラウザ保存 — 端末間同期なし（サーバー保存は今後）。',
    pjRestored: '読み込み完了: ',
    pjSaveFail: '保存に失敗（ブラウザ保存）',
    unitTitle: '表示単位切替 — 入力はmm固定',
    hkHelp: 'Ctrl+Z/Y = 元に戻す/やり直す · 1/2/3 = 面/エッジ/距離 · Esc = 選択解除',
    abBtn: '比較',
    abEnd: '比較終了',
    abRestoreA: 'Aに復元',
    abTitle: 'A/B比較',
    abParamDiff: 'パラメータ差分',
    abNoDiff: '差分なし',
    brTitle: '桁橋自動チェーン',
    brSub: 'DC·DW形状導出 · KL-510影響線 · 極限I組合せ',
    brPav: '舗装厚 mm（DW·任意）',
    brLanes: '車線数（任意）',
    brDF: 'DF（未入力=てこ法則）',
    brAs: '桁 As mm²（任意·断面照査）',
    brRun: '🌉 桁橋チェーンを実行',
    brDC: '死荷重 DC',
    brLL: '活荷重',
    brUlt: '極限',
    brSection: '断面照査',
    uniBtn: '統合レポート',
    uniBusy: 'レポート作成中…',
    uniNone: '含められるレポートがありません — 検証が失敗したか未実行です。',
    uniMissing: '欠落（失敗/未実行）: ',
    uniPrint: '印刷 / PDF',
    svBtn: 'サーバー',
    svLoginNote: 'ログインするとサーバー保存が使えます（端末間同期）。',
    svSave: 'サーバーに保存',
    svBusy: 'サーバー通信中…',
    svFailPrefix: 'サーバー保存エラー: ',
    svSaved: 'サーバーに保存しました: ',
    svEmpty: 'サーバープロジェクトなし',
    svNeedName: 'プロジェクト名を入力してください。',
  },
  zh: {
    tplTitle: '装配模板',
    tplSub: '多部件 · 支持设计包',
    buildBusy: '构建中…',
    buildBtn: '生成装配体',
    builtParts: '已生成 · 部件 ',
    clash: '干涉',
    advTitle: '高级输入（JSON — 线形·曲线·构造物·等高·土方·管路）', advHint: '与数值表单合并·门禁拒绝原文显示', advBad: '需要 JSON 对象', floating: '悬空', faceContact: '面接触（建议嵌入）', pipeBad: '管路违规', pipeOk: '管路', sleeve: '套管',
    failed: '失败: ',
    packaging: '正在生成设计包…',
    pkgBtn: '📦 下载设计包',
    pkgFailed: '设计包生成失败',
    pkgFailPrefix: '设计包失败: ',
    papersBtn: '相关论文附录（OpenAlex·Crossref 真实引用）',
    reportFailed: '报告HTML生成失败',
    reportHtml: '报告HTML',
    checking: '验证中…',
    erBtn: '专家调研委托（付费）— 现有技术·规避设计',
    erDesc: '由专家亲自执行（AI检索工具辅助）的付费服务。受理后将回复报价与日程。当前设计快照会自动附上。',
    erNeedNameEmail: '请输入姓名和邮箱。',
    erDone: '✅ 已受理 — 审核后将回复报价与日程。',
    erFailPrefix: '受理失败: ',
    erName: '姓名/公司',
    erEmail: '邮箱',
    erMsgPh: '需求说明（目标市场、竞品、担忧的专利等）',
    erSubmitting: '提交中…',
    erSubmit: '提交委托（回复报价）',
    erDisclaimer: '⚠ 本服务不能替代专利代理人出具的正式FTO意见书（如需可推荐专利代理人）。',
    svcPriorArt: '现有技术检索·分析',
    svcPriorArtD: '专利·论文深度检索，相似度分析报告',
    svcDesignAround: '规避设计评审',
    svcDesignAroundD: '基于调研结果的设计变更点 + 复核',
    svcGlobal: '全球布局调研',
    svcGlobalD: '美·中·欧专利布局',
    cvTitle: '挡土墙稳定性验证',
    cvSub: '截面自形状自动导出 · 仅需输入土质',
    cvGamma: '回填土 γ kN/m³',
    cvPhi: '内摩擦角 °',
    cvMu: '底面摩擦 μ',
    cvQa: '容许承载力 kPa',
    cvSurcharge: '地面超载 kPa',
    cvKh: '地震系数 kh（0=静力）',
    cvRun: '🧱 运行挡土墙稳定性验证',
    cvSeismicMO: '地震工况（M-O）',
    inTitle: '疏散·装修验证',
    inSub: '步行距离BFS实测 · 门宽自形状导出',
    inRun: '🚪 运行疏散·装修验证',
    inTravel: '最远点步行距离',
    inUnreachable: '不可达',
    inEgress: '容纳·疏散宽度',
    inDoors: '门宽合计',
    inSeats: '座位',
    inFinish: '装修',
    inFloor: '地面',
    inWall: '墙面',
    inCeiling: '吊顶',
    lsTitle: '木构件·风荷载验证',
    lsSub: 'KDS 41 50 10 容许应力 · 截面·跨度自形状导出',
    lsSpecies: '树种组',
    lsLarch: '落叶松类',
    lsPine: '松类',
    lsKoreanPine: '红松类',
    lsCedar: '杉木类',
    lsGrade: '等级',
    gradeSuffix: '级',
    lsUsage: '用途（露台活荷载）',
    lsUseRes: '住宅 2.0',
    lsUseGarden: '花园·集会 5.0',
    lsUseAssembly: '集会（活动座椅）5.0',
    lsWind: '风压 kN/m²（0=跳过）',
    lsRun: '🌳 运行构件·风荷载验证',
    lsJoist: '搁栅/椽条',
    lsTip: '倾覆',
    lsAnchor: '锚栓',
    lsPerPost: '根',
    bdTitle: '荷载路径验证',
    bdSub: '自重（形状）+活荷载（KDS 表3.2-1）→ 梁→柱→基础',
    bdUsage: '用途（活荷载）',
    bdOffice: '普通办公室',
    bdBeamAs: '梁 As mm²',
    bdStirrupAv: '箍筋 Av',
    bdSpacingS: '间距 s',
    bdColAst: '柱 Ast',
    bdFtgB: '基础 B',
    bdFtgL: '基础 L',
    bdQAllow: '承载力 kPa',
    bdSeisZone: '地震分区（可选）',
    bdSeisOff: '不考虑',
    bdZoneI: '分区 I（0.11）',
    bdZoneII: '分区 II（0.07）',
    bdSite: '场地',
    bdRTable: '表6.2-1',
    bdChainBusy: '链式验证中…',
    bdRun: '⛓ 运行荷载路径验证',
    bdSlab: '楼板',
    bdFooting: '基础',
    bdInputsNeeded: '需要输入',
    bdSlabDefl: '楼板挠度',
    bdSeismic: '地震',
    bdCol: '柱',
    bdWindV0: '基本风速 V0 m/s',
    bdWindV0Ph: '图5.5-1 地区值',
    bdWindExp: '地面粗糙度',
    bdWindTerrain: '地形（简化法）',
    bdTerrainNormal: '一般',
    bdTerrainFlatOpen: '平坦开阔地',
    bdTerrainCoast: '海岸',
    bdWind: '风荷载',
    inLuxLabel: '目标照度 lx',
    inLuxPh: 'KS A 3011 按用途',
    inLumenLabel: '灯具光通量 lm',
    inVentLabel: '人均通风量 m³/h·人',
    inLoadLabel: '负荷密度 VA/m²',
    inLight: '照明',
    inFixSuffix: '盏',
    inAvgLux: '平均',
    inVent: '通风',
    inElec: '电气',
    inCircuitSuffix: '条回路',
    lsConn: '连接五金件',
    lsConnNone: '未指定（默认）',
    lsConnNailOpt: '钉 89×4.11 2根',
    lsConnBoltOpt: '螺栓 D12',
    lsNail: '钉',
    lsBolt: '螺栓',
    lsConnRow: '连接节点',
    lsDemand: '反力',
    lsCapacity: '承载力',
    lsRatio: '比值',
    vwTitle: '3D查看器 — 点击面进行编辑',
    vwSub: '面=参数映射 · 修改后自动重新验证',
    vwHide: '收起',
    vwShow: '展开',
    fpHint: '点击构件的面即可打开映射的参数编辑。',
    fpFace: '面',
    fpParam: '参数',
    fpReadOnly: '零件单独尺寸 — 只读（非模板参数）',
    fpSection: '复合截面的面 — 仅显示可编辑的模板参数。',
    fpUnmapped: '该面没有参数映射 — 非验证直接编辑（P4）请在专家CAD中进行。',
    fpReverify: '应用修改 → 重新验证中…',
    fpMapFail: '面映射查询失败: ',
    pmFace: '面',
    pmEdge: '棱边',
    pmDist: '距离',
    edHint: '棱边是两个尺寸的交线 — 请选择要修改的尺寸。',
    dsHint: '距离模式 — 请依次点击两个构件。',
    dsPickB: '已选第一个构件 — 请点击第二个构件。',
    dsGap: '中心间距',
    dsDerived: '该间距由布置数量导出 — 请修改数量参数。',
    dsNone: '无距离映射 — 该构件对的间距不是模板参数。',
    nlPh: '用语言修改 — 例: "改为3500"、"增加10%"、"bayX减少200"',
    nlSend: '应用',
    nlBusy: '解析中…',
    nlSrcRegex: '正则',
    nlSrcAi: 'AI',
    nlApplied: '已应用: ',
    nlFail: '解析失败: ',
    vcTitle: '语音输入',
    swBtn: '安全范围',
    swBusy: '扫描中…（链式验证8次）',
    swFail: '扫描失败: ',
    glBtn: '目标搜索',
    glMin: '最小通过值',
    glMax: '最大通过值',
    glFound: '通过边界 ≈ ',
    snLabel: '标准节点',
    snSrc: '来源: ',
    fpTplWide: '模板尺寸 — 应用于同一角色的所有构件。',
    dfTitle: '修改前后',
    dfBeamRatio: '梁弯曲比',
    dfMemberRatio: '构件弯曲比',
    dfSeisCol: '地震柱',
    hsUndo: '撤销',
    hsRedo: '重做',
    hsList: '历史',
    hsInit: '初始值',
    inSprkLabel: '喷头水平距离 m',
    inSprkPh: 'NFTC 103 1.7/2.1/2.3',
    shBtn: '分享',
    shCopied: '分享链接已复制。',
    shTooBig: '设计过大，无法生成链接 — 请使用保存。',
    shPrompt: '请复制此链接:',
    shRestored: '已从分享链接恢复',
    pjSave: '保存',
    pjNamePh: '项目名称',
    pjLoad: '载入',
    pjDel: '删除',
    pjNote: '浏览器存储 — 不跨设备同步（服务器保存为后续功能）。',
    pjRestored: '已载入: ',
    pjSaveFail: '保存失败（浏览器存储）',
    unitTitle: '显示单位切换 — 输入固定为mm',
    hkHelp: 'Ctrl+Z/Y = 撤销/重做 · 1/2/3 = 面/棱边/距离 · Esc = 取消选择',
    abBtn: '对比',
    abEnd: '结束对比',
    abRestoreA: '恢复到A',
    abTitle: 'A/B对比',
    abParamDiff: '参数差异',
    abNoDiff: '无差异',
    brTitle: '梁桥自动链',
    brSub: 'DC·DW取自形状 · KL-510影响线 · 极限I组合',
    brPav: '铺装厚度 mm（DW·可选）',
    brLanes: '车道数（可选）',
    brDF: 'DF（留空=杠杆法）',
    brAs: '梁 As mm²（可选·截面验算）',
    brRun: '🌉 运行梁桥链',
    brDC: '恒载 DC',
    brLL: '活载',
    brUlt: '极限',
    brSection: '截面验算',
    uniBtn: '综合报告',
    uniBusy: '正在生成报告…',
    uniNone: '没有可包含的报告 — 验证失败或未执行。',
    uniMissing: '缺失（失败/未执行）: ',
    uniPrint: '打印 / PDF',
    svBtn: '服务器',
    svLoginNote: '登录后可使用服务器保存（跨设备同步）。',
    svSave: '保存到服务器',
    svBusy: '正在连接服务器…',
    svFailPrefix: '服务器存储错误: ',
    svSaved: '已保存到服务器: ',
    svEmpty: '无服务器项目',
    svNeedName: '请输入项目名称。',
  },
  es: {
    tplTitle: 'Plantilla de ensamblaje',
    tplSub: 'multipieza · paquete de diseño',
    buildBusy: 'Generando…',
    buildBtn: 'Generar ensamblaje',
    builtParts: 'Generado · piezas ',
    clash: 'interferencia',
    advTitle: 'Entrada avanzada (JSON)', advHint: 'Se combina con el formulario · rechazos de puerta mostrados tal cual', advBad: 'Se requiere un objeto JSON', floating: 'flotante', faceContact: 'contacto plano (empotrar)', pipeBad: 'violaciones de tubería', pipeOk: 'tuberías', sleeve: 'pasamuros',
    failed: 'Error: ',
    packaging: 'Empaquetando…',
    pkgBtn: '📦 Descargar paquete de diseño',
    pkgFailed: 'fallo al generar el paquete',
    pkgFailPrefix: 'Fallo del paquete: ',
    papersBtn: 'Anexo de artículos relacionados (citas reales OpenAlex·Crossref)',
    reportFailed: 'fallo al generar el informe HTML',
    reportHtml: 'Informe HTML',
    checking: 'Verificando…',
    erBtn: 'Solicitud de investigación experta (de pago) — estado de la técnica y diseño alternativo',
    erDesc: 'Servicio de pago realizado por un experto (asistido por IA). Tras la recepción respondemos con presupuesto y calendario. Se adjunta automáticamente la instantánea de su diseño.',
    erNeedNameEmail: 'Se requieren nombre y correo.',
    erDone: '✅ Recibido — responderemos con presupuesto y calendario.',
    erFailPrefix: 'Fallo: ',
    erName: 'Nombre/Empresa',
    erEmail: 'Correo',
    erMsgPh: 'Detalles (mercado objetivo, competidores, patentes de interés…)',
    erSubmitting: 'Enviando…',
    erSubmit: 'Enviar solicitud (respuesta con presupuesto)',
    erDisclaimer: '⚠ Este servicio no sustituye un dictamen FTO formal de un agente de patentes (derivación disponible).',
    svcPriorArt: 'Búsqueda y análisis del estado de la técnica',
    svcPriorArtD: 'búsqueda profunda de patentes y artículos, informe de similitud',
    svcDesignAround: 'Revisión de diseño alternativo',
    svcDesignAroundD: 'puntos de cambio de diseño + reverificación',
    svcGlobal: 'Panorama global',
    svcGlobalD: 'panorama de patentes EE. UU./China/UE',
    cvTitle: 'Estabilidad de muro de contención',
    cvSub: 'sección derivada de la forma · solo datos del suelo',
    cvGamma: 'γ relleno kN/m³',
    cvPhi: 'φ °',
    cvMu: 'μ base',
    cvQa: 'capacidad portante adm. kPa',
    cvSurcharge: 'sobrecarga kPa',
    cvKh: 'kh sísmico (0=estático)',
    cvRun: '🧱 Ejecutar verificación de estabilidad',
    cvSeismicMO: 'Sísmico (M-O)',
    inTitle: 'Verificación de evacuación y acabados',
    inSub: 'recorrido BFS · ancho de puertas de la forma',
    inRun: '🚪 Ejecutar verificación de evacuación y acabados',
    inTravel: 'Recorrido máximo',
    inUnreachable: 'inaccesible',
    inEgress: 'Aforo/evacuación',
    inDoors: 'puertas',
    inSeats: 'asientos',
    inFinish: 'Acabados',
    inFloor: 'suelo',
    inWall: 'pared',
    inCeiling: 'techo',
    lsTitle: 'Verificación de miembro de madera y viento',
    lsSub: 'esfuerzo admisible KDS 41 50 10 · sección/luz de la forma',
    lsSpecies: 'Especie',
    lsLarch: 'Alerce',
    lsPine: 'Pino',
    lsKoreanPine: 'Pino coreano',
    lsCedar: 'Cedro',
    lsGrade: 'Grado',
    gradeSuffix: '',
    lsUsage: 'Uso (carga viva de la terraza)',
    lsUseRes: 'Residencial 2.0',
    lsUseGarden: 'Jardín/reunión 5.0',
    lsUseAssembly: 'Reunión 5.0',
    lsWind: 'Viento kN/m² (0=omitir)',
    lsRun: '🌳 Ejecutar verificación de madera y viento',
    lsJoist: 'Vigueta',
    lsTip: 'Vuelco',
    lsAnchor: 'anclaje',
    lsPerPost: 'poste',
    bdTitle: 'Verificación de trayectoria de cargas',
    bdSub: 'peso propio (forma)+carga viva (KDS tabla 3.2-1) → viga→columna→zapata',
    bdUsage: 'Uso (carga viva)',
    bdOffice: 'Oficina',
    bdBeamAs: 'viga As mm²',
    bdStirrupAv: 'estribo Av',
    bdSpacingS: 'separación s',
    bdColAst: 'columna Ast',
    bdFtgB: 'zapata B',
    bdFtgL: 'zapata L',
    bdQAllow: 'capacidad kPa',
    bdSeisZone: 'Zona sísmica (opcional)',
    bdSeisOff: 'sin considerar',
    bdZoneI: 'Zona I (0.11)',
    bdZoneII: 'Zona II (0.07)',
    bdSite: 'Suelo',
    bdRTable: 'tabla 6.2-1',
    bdChainBusy: 'Verificando…',
    bdRun: '⛓ Ejecutar verificación de trayectoria de cargas',
    bdSlab: 'Losa',
    bdFooting: 'Zapata',
    bdInputsNeeded: 'faltan datos',
    bdSlabDefl: 'Deflexión de losa',
    bdSeismic: 'Sísmico',
    bdCol: 'columna',
    bdWindV0: 'velocidad básica del viento V0 m/s',
    bdWindV0Ph: 'valor regional, fig. 5.5-1',
    bdWindExp: 'Rugosidad superficial (exposición)',
    bdWindTerrain: 'Terreno (método simplificado)',
    bdTerrainNormal: 'normal',
    bdTerrainFlatOpen: 'llano abierto',
    bdTerrainCoast: 'costero',
    bdWind: 'Viento',
    inLuxLabel: 'iluminancia objetivo lx',
    inLuxPh: 'según uso, KS A 3011',
    inLumenLabel: 'flujo luminoso de lámpara lm',
    inVentLabel: 'ventilación m³/h·persona',
    inLoadLabel: 'densidad de carga VA/m²',
    inLight: 'Iluminación',
    inFixSuffix: ' luminarias',
    inAvgLux: 'media',
    inVent: 'Ventilación',
    inElec: 'Eléctrico',
    inCircuitSuffix: ' circuitos',
    lsConn: 'Herraje de unión',
    lsConnNone: 'ninguno (predet.)',
    lsConnNailOpt: 'clavos 89×4.11 ×2',
    lsConnBoltOpt: 'perno D12',
    lsNail: 'clavo',
    lsBolt: 'perno',
    lsConnRow: 'Unión',
    lsDemand: 'reacción',
    lsCapacity: 'capacidad',
    lsRatio: 'relación',
    vwTitle: 'Visor 3D — haga clic en una cara para editar',
    vwSub: 'cara=mapeo de parámetros · reverificación automática al cambiar',
    vwHide: 'Plegar',
    vwShow: 'Desplegar',
    fpHint: 'Haga clic en una cara de la pieza para abrir su parámetro mapeado.',
    fpFace: 'cara',
    fpParam: 'parámetro',
    fpReadOnly: 'Dimensión por pieza — solo lectura (no es un parámetro de plantilla)',
    fpSection: 'Cara de sección compuesta — solo se muestran los parámetros de plantilla editables.',
    fpUnmapped: 'Esta cara no tiene mapeo de parámetros — la edición directa sin verificar (P4) está en el CAD experto.',
    fpReverify: 'Aplicando cambio → reverificando…',
    fpMapFail: 'Fallo al consultar el mapeo de la cara: ',
    pmFace: 'Cara',
    pmEdge: 'Arista',
    pmDist: 'Distancia',
    edHint: 'Una arista cruza dos cotas — elija la que desea editar.',
    dsHint: 'Modo distancia — haga clic en dos piezas sucesivamente.',
    dsPickB: 'Primera pieza seleccionada — haga clic en la segunda.',
    dsGap: 'separación entre centros',
    dsDerived: 'Esta separación se deriva del número de elementos — edite el parámetro de cantidad.',
    dsNone: 'Sin mapeo de distancia — la separación de este par no es un parámetro de plantilla.',
    nlPh: 'Editar con palabras — p. ej. "a 3500", "aumenta 10%", "reduce bayX 200"',
    nlSend: 'Aplicar',
    nlBusy: 'Interpretando…',
    nlSrcRegex: 'regex',
    nlSrcAi: 'IA',
    nlApplied: 'Aplicado: ',
    nlFail: 'Fallo de interpretación: ',
    vcTitle: 'Entrada de voz',
    swBtn: 'Rango seguro',
    swBusy: 'Barriendo… (8 verificaciones)',
    swFail: 'Fallo del barrido: ',
    glBtn: 'Búsqueda de objetivo',
    glMin: 'valor mínimo que pasa',
    glMax: 'valor máximo que pasa',
    glFound: 'Límite de aprobación ≈ ',
    snLabel: 'nodos estándar',
    snSrc: 'fuente: ',
    fpTplWide: 'Cota de plantilla — se aplica a todas las piezas del mismo rol.',
    dfTitle: 'Antes→después',
    dfBeamRatio: 'ratio de flexión de viga',
    dfMemberRatio: 'ratio de flexión del miembro',
    dfSeisCol: 'columna sísmica',
    hsUndo: 'Deshacer',
    hsRedo: 'Rehacer',
    hsList: 'Historial',
    hsInit: 'inicial',
    inSprkLabel: 'radio de rociador m',
    inSprkPh: 'NFTC 103: 1.7/2.1/2.3',
    shBtn: 'Compartir',
    shCopied: 'Enlace copiado.',
    shTooBig: 'Diseño demasiado grande para un enlace — use Guardar.',
    shPrompt: 'Copie este enlace:',
    shRestored: 'Restaurado desde el enlace',
    pjSave: 'Guardar',
    pjNamePh: 'Nombre del proyecto',
    pjLoad: 'Cargar',
    pjDel: 'Eliminar',
    pjNote: 'Almacenamiento del navegador — sin sincronización entre dispositivos (guardado en servidor: próximamente).',
    pjRestored: 'Cargado: ',
    pjSaveFail: 'Fallo al guardar (almacenamiento del navegador)',
    unitTitle: 'Cambio de unidad de visualización — las entradas siguen en mm',
    hkHelp: 'Ctrl+Z/Y = deshacer/rehacer · 1/2/3 = cara/arista/distancia · Esc = quitar selección',
    abBtn: 'Comparar',
    abEnd: 'Terminar comparación',
    abRestoreA: 'Restaurar A',
    abTitle: 'Comparación A/B',
    abParamDiff: 'Diferencias de parámetros',
    abNoDiff: 'sin diferencias',
    brTitle: 'Cadena automática de puente de vigas',
    brSub: 'DC·DW de la forma · línea de influencia KL-510 · combinación Última I',
    brPav: 'espesor de pavimento mm (DW, opc.)',
    brLanes: 'carriles (opc.)',
    brDF: 'DF (vacío=regla de la palanca)',
    brAs: 'As de viga mm² (opc., comprobación de sección)',
    brRun: '🌉 Ejecutar cadena de puente',
    brDC: 'Carga muerta DC',
    brLL: 'Carga viva',
    brUlt: 'Última',
    brSection: 'Comprobación de sección',
    uniBtn: 'Informe unificado',
    uniBusy: 'Componiendo informe…',
    uniNone: 'No hay informes que incluir — las verificaciones fallaron o no se ejecutaron.',
    uniMissing: 'Faltantes (fallidos/no ejecutados): ',
    uniPrint: 'Imprimir / PDF',
    svBtn: 'Servidor',
    svLoginNote: 'Inicie sesión para usar el guardado en servidor (sincronización entre dispositivos).',
    svSave: 'Guardar en servidor',
    svBusy: 'Conectando con el servidor…',
    svFailPrefix: 'Error de almacenamiento en servidor: ',
    svSaved: 'Guardado en el servidor: ',
    svEmpty: 'Sin proyectos en el servidor',
    svNeedName: 'Introduzca un nombre de proyecto.',
  },
  ar: {
    tplTitle: 'قالب التجميع',
    tplSub: 'متعدد الأجزاء · حزمة تصميم',
    buildBusy: 'جارٍ البناء…',
    buildBtn: 'إنشاء التجميع',
    builtParts: 'تم الإنشاء · الأجزاء ',
    clash: 'تداخل',
    advTitle: 'إدخال متقدم (JSON)', advHint: 'يُدمج مع النموذج الرقمي · تُعرض رسائل الرفض كما هي', advBad: 'مطلوب كائن JSON', floating: 'معلّق', faceContact: 'تلامس سطحي (يُنصح بالدمج)', pipeBad: 'مخالفات الأنابيب', pipeOk: 'أنابيب', sleeve: 'جلبة عبور',
    failed: 'فشل: ',
    packaging: 'جارٍ إنشاء الحزمة…',
    pkgBtn: '📦 تنزيل حزمة التصميم',
    pkgFailed: 'فشل إنشاء الحزمة',
    pkgFailPrefix: 'فشل الحزمة: ',
    papersBtn: 'ملحق الأوراق البحثية ذات الصلة (استشهادات حقيقية OpenAlex·Crossref)',
    reportFailed: 'فشل إنشاء تقرير HTML',
    reportHtml: 'تقرير HTML',
    checking: 'جارٍ التحقق…',
    erBtn: 'طلب بحث متخصص (مدفوع) — التقنية السابقة والتصميم الالتفافي',
    erDesc: 'خدمة مدفوعة يقوم بها خبير مباشرة (بمساعدة أدوات بحث الذكاء الاصطناعي). بعد الاستلام نرد بعرض السعر والجدول الزمني. تُرفق لقطة التصميم الحالية تلقائيًا.',
    erNeedNameEmail: 'يرجى إدخال الاسم والبريد الإلكتروني.',
    erDone: '✅ تم الاستلام — سنرد بعرض السعر والجدول الزمني بعد المراجعة.',
    erFailPrefix: 'فشل الاستلام: ',
    erName: 'الاسم/الشركة',
    erEmail: 'البريد الإلكتروني',
    erMsgPh: 'التفاصيل (السوق المستهدف، المنافسون، براءات الاختراع المثيرة للقلق…)',
    erSubmitting: 'جارٍ الإرسال…',
    erSubmit: 'إرسال الطلب (رد بعرض السعر)',
    erDisclaimer: '⚠ هذه الخدمة ليست بديلاً عن رأي FTO رسمي من محامي براءات (الإحالة متاحة عند الحاجة).',
    svcPriorArt: 'البحث في التقنية السابقة وتحليلها',
    svcPriorArtD: 'بحث معمق في البراءات والأوراق، تقرير تحليل التشابه',
    svcDesignAround: 'مراجعة التصميم الالتفافي',
    svcDesignAroundD: 'نقاط تعديل التصميم + إعادة التحقق',
    svcGlobal: 'المشهد العالمي',
    svcGlobalD: 'مشهد البراءات في الولايات المتحدة والصين وأوروبا',
    cvTitle: 'التحقق من استقرار الجدار الاستنادي',
    cvSub: 'المقطع مشتق من الشكل · إدخال خصائص التربة فقط',
    cvGamma: 'γ الردم kN/m³',
    cvPhi: 'زاوية الاحتكاك الداخلي °',
    cvMu: 'μ القاعدة',
    cvQa: 'قدرة التحمل المسموحة kPa',
    cvSurcharge: 'الحمل الإضافي kPa',
    cvKh: 'معامل الزلزال kh (0=استاتيكي)',
    cvRun: '🧱 تشغيل فحص الاستقرار',
    cvSeismicMO: 'زلزالي (M-O)',
    inTitle: 'فحص الإخلاء والتشطيبات',
    inSub: 'مسافة السير BFS · عرض الأبواب من الشكل',
    inRun: '🚪 تشغيل فحص الإخلاء والتشطيبات',
    inTravel: 'أقصى مسافة سير',
    inUnreachable: 'غير قابل للوصول',
    inEgress: 'الإشغال/عرض الإخلاء',
    inDoors: 'مجموع عرض الأبواب',
    inSeats: 'مقاعد',
    inFinish: 'التشطيبات',
    inFloor: 'أرضية',
    inWall: 'جدار',
    inCeiling: 'سقف',
    lsTitle: 'فحص العنصر الخشبي وحمل الرياح',
    lsSub: 'إجهاد مسموح KDS 41 50 10 · المقطع/الباع من الشكل',
    lsSpecies: 'نوع الخشب',
    lsLarch: 'أرزية (لاركس)',
    lsPine: 'صنوبر',
    lsKoreanPine: 'صنوبر كوري',
    lsCedar: 'أرز (سيدر)',
    lsGrade: 'الدرجة',
    gradeSuffix: '',
    lsUsage: 'الاستخدام (الحمل الحي للسطح)',
    lsUseRes: 'سكني 2.0',
    lsUseGarden: 'حديقة/تجمع 5.0',
    lsUseAssembly: 'تجمع 5.0',
    lsWind: 'ضغط الرياح kN/m² (0=تخطي)',
    lsRun: '🌳 تشغيل فحص العنصر الخشبي والرياح',
    lsJoist: 'رافدة',
    lsTip: 'انقلاب',
    lsAnchor: 'مرساة',
    lsPerPost: 'عمود',
    bdTitle: 'فحص مسار الأحمال',
    bdSub: 'حمل ميت (الشكل)+حمل حي (KDS جدول 3.2-1) → جسر→عمود→أساس',
    bdUsage: 'الاستخدام (الحمل الحي)',
    bdOffice: 'مكتب',
    bdBeamAs: 'الجسر As mm²',
    bdStirrupAv: 'الكانة Av',
    bdSpacingS: 'التباعد s',
    bdColAst: 'العمود Ast',
    bdFtgB: 'الأساس B',
    bdFtgL: 'الأساس L',
    bdQAllow: 'قدرة التحمل kPa',
    bdSeisZone: 'المنطقة الزلزالية (اختياري)',
    bdSeisOff: 'بدون',
    bdZoneI: 'المنطقة I (0.11)',
    bdZoneII: 'المنطقة II (0.07)',
    bdSite: 'الموقع',
    bdRTable: 'الجدول 6.2-1',
    bdChainBusy: 'جارٍ التحقق…',
    bdRun: '⛓ تشغيل فحص مسار الأحمال',
    bdSlab: 'البلاطة',
    bdFooting: 'الأساس',
    bdInputsNeeded: 'مطلوب إدخال',
    bdSlabDefl: 'انحراف البلاطة',
    bdSeismic: 'زلزالي',
    bdCol: 'العمود',
    bdWindV0: 'سرعة الرياح الأساسية V0 m/s',
    bdWindV0Ph: 'قيمة المنطقة، الشكل 5.5-1',
    bdWindExp: 'خشونة سطح الأرض (التعرض)',
    bdWindTerrain: 'التضاريس (الطريقة المبسطة)',
    bdTerrainNormal: 'عادي',
    bdTerrainFlatOpen: 'مستوٍ مكشوف',
    bdTerrainCoast: 'ساحلي',
    bdWind: 'الرياح',
    inLuxLabel: 'الإضاءة المستهدفة lx',
    inLuxPh: 'حسب الاستخدام، KS A 3011',
    inLumenLabel: 'التدفق الضوئي للمصباح lm',
    inVentLabel: 'معدل التهوية m³/h·شخص',
    inLoadLabel: 'كثافة الحمل VA/m²',
    inLight: 'الإضاءة',
    inFixSuffix: ' وحدة',
    inAvgLux: 'متوسط',
    inVent: 'التهوية',
    inElec: 'الكهرباء',
    inCircuitSuffix: ' دارة',
    lsConn: 'قطع التوصيل المعدنية',
    lsConnNone: 'غير محدد (افتراضي)',
    lsConnNailOpt: 'مسامير 89×4.11 ×2',
    lsConnBoltOpt: 'برغي D12',
    lsNail: 'مسمار',
    lsBolt: 'برغي',
    lsConnRow: 'الوصلة',
    lsDemand: 'رد الفعل',
    lsCapacity: 'المقاومة',
    lsRatio: 'النسبة',
    vwTitle: 'عارض ثلاثي الأبعاد — انقر على وجه للتحرير',
    vwSub: 'الوجه=ربط المعاملات · إعادة تحقق تلقائية عند التعديل',
    vwHide: 'طيّ',
    vwShow: 'توسيع',
    fpHint: 'انقر على وجه العنصر لفتح المعامل المرتبط به.',
    fpFace: 'وجه',
    fpParam: 'معامل',
    fpReadOnly: 'بُعد خاص بالجزء — للقراءة فقط (ليس معامل قالب)',
    fpSection: 'وجه مقطع مركب — تُعرض معاملات القالب القابلة للتحرير فقط.',
    fpUnmapped: 'لا يوجد ربط معاملات لهذا الوجه — التحرير المباشر غير المتحقق (P4) في CAD الخبراء.',
    fpReverify: 'تطبيق التعديل → إعادة التحقق جارية…',
    fpMapFail: 'فشل استعلام ربط الوجه: ',
    pmFace: 'وجه',
    pmEdge: 'حافة',
    pmDist: 'مسافة',
    edHint: 'الحافة تقاطع بُعدين — اختر البُعد المراد تحريره.',
    dsHint: 'وضع المسافة — انقر على عنصرين بالتتابع.',
    dsPickB: 'تم اختيار العنصر الأول — انقر على العنصر الثاني.',
    dsGap: 'التباعد المركزي',
    dsDerived: 'هذا التباعد مشتق من عدد التوزيع — عدّل معامل العدد.',
    dsNone: 'لا يوجد ربط مسافة — تباعد هذا الزوج ليس معامل قالب.',
    nlPh: 'التعديل بالكلام — مثال: "اجعلها 3500"، "زد 10%"',
    nlSend: 'تطبيق',
    nlBusy: 'جارٍ التفسير…',
    nlSrcRegex: 'تعبير نمطي',
    nlSrcAi: 'ذكاء اصطناعي',
    nlApplied: 'تم التطبيق: ',
    nlFail: 'فشل التفسير: ',
    vcTitle: 'إدخال صوتي',
    swBtn: 'النطاق الآمن',
    swBusy: 'جارٍ المسح… (8 عمليات تحقق)',
    swFail: 'فشل المسح: ',
    glBtn: 'بحث عن الهدف',
    glMin: 'أدنى قيمة ناجحة',
    glMax: 'أقصى قيمة ناجحة',
    glFound: 'حد النجاح ≈ ',
    snLabel: 'قيم قياسية',
    snSrc: 'المصدر: ',
    fpTplWide: 'بُعد قالب — يُطبق على جميع العناصر بنفس الدور.',
    dfTitle: 'قبل→بعد',
    dfBeamRatio: 'نسبة انحناء الجسر',
    dfMemberRatio: 'نسبة انحناء العنصر',
    dfSeisCol: 'عمود زلزالي',
    hsUndo: 'تراجع',
    hsRedo: 'إعادة',
    hsList: 'السجل',
    hsInit: 'أولي',
    inSprkLabel: 'نصف قطر المرشّ m',
    inSprkPh: 'NFTC 103: 1.7/2.1/2.3',
    shBtn: 'مشاركة',
    shCopied: 'تم نسخ رابط المشاركة.',
    shTooBig: 'التصميم كبير جدًا للرابط — استخدم الحفظ.',
    shPrompt: 'انسخ هذا الرابط:',
    shRestored: 'استُعيد من رابط المشاركة',
    pjSave: 'حفظ',
    pjNamePh: 'اسم المشروع',
    pjLoad: 'تحميل',
    pjDel: 'حذف',
    pjNote: 'تخزين المتصفح — بلا مزامنة بين الأجهزة (الحفظ على الخادم لاحقًا).',
    pjRestored: 'تم التحميل: ',
    pjSaveFail: 'فشل الحفظ (تخزين المتصفح)',
    unitTitle: 'تبديل وحدة العرض — تبقى المدخلات بالمليمتر',
    hkHelp: 'Ctrl+Z/Y = تراجع/إعادة · 1/2/3 = وجه/حافة/مسافة · Esc = إلغاء الاختيار',
    abBtn: 'مقارنة',
    abEnd: 'إنهاء المقارنة',
    abRestoreA: 'استعادة A',
    abTitle: 'مقارنة A/B',
    abParamDiff: 'فروق المعاملات',
    abNoDiff: 'لا فروق',
    brTitle: 'سلسلة جسر العوارض التلقائية',
    brSub: 'DC·DW من الشكل · خط تأثير KL-510 · تركيبة الحد الأقصى I',
    brPav: 'سماكة الرصف mm (DW، اختياري)',
    brLanes: 'عدد الحارات (اختياري)',
    brDF: 'DF (فارغ=قاعدة الرافعة)',
    brAs: 'As للعارضة mm² (اختياري·فحص المقطع)',
    brRun: '🌉 تشغيل سلسلة الجسر',
    brDC: 'الحمل الميت DC',
    brLL: 'الحمل الحي',
    brUlt: 'الحد الأقصى',
    brSection: 'فحص المقطع',
    uniBtn: 'تقرير موحد',
    uniBusy: 'جارٍ إعداد التقرير…',
    uniNone: 'لا توجد تقارير للإدراج — فشلت عمليات التحقق أو لم تُنفذ.',
    uniMissing: 'مفقود (فشل/لم يُنفذ): ',
    uniPrint: 'طباعة / PDF',
    svBtn: 'الخادم',
    svLoginNote: 'سجّل الدخول لاستخدام الحفظ على الخادم (مزامنة بين الأجهزة).',
    svSave: 'حفظ على الخادم',
    svBusy: 'جارٍ الاتصال بالخادم…',
    svFailPrefix: 'خطأ تخزين الخادم: ',
    svSaved: 'تم الحفظ على الخادم: ',
    svEmpty: 'لا مشاريع على الخادم',
    svNeedName: 'أدخل اسم المشروع.',
  },
} as const;

// 거리 픽킹 매핑 — scripts/drawing-to-3d/face-param-map.mjs DISTANCE_MAP 미러 (동기화 유지 — 라우트 추가 없이 클라 판정)
const DISTANCE_MAP: Record<string, Record<string, { x?: string; y?: string } | null>> = {
  building: { column: { x: 'bayX', y: 'bayY' }, beam: { x: 'bayX', y: 'bayY' } },
  bridge: { girder: { y: 'girderSpacing' } },
  landscape: { joist: { x: 'joistSpacing', y: 'joistSpacing' }, post: { x: 'width', y: 'depth' } },
  interior: { table: null }, // 테이블 간격은 rows/cols 파생 — 개별 간격 파라미터 없음(정직)
};

// Web Speech API 언어 — 현재 로케일 기준(기본 ko-KR)
const VOICE_LANG: Record<string, string> = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', es: 'es-ES', ar: 'ar-SA' };

// ③ 표준규격 스냅 — scripts/drawing-to-3d/snap-lists.mjs SNAP_LISTS/PARAM_SNAP 미러 (동기화 유지)
//    출처 명시 절점만 — 지어낸 값 없음. 목록에 없는 mm 파라미터는 입력 블러 시 10mm 그리드 반올림.
const SNAP_MIRROR: Record<string, { values: number[]; source: string }> = {
  boltDia: { values: [12, 16, 19, 22, 25], source: 'KDS 41 50 30 표 4.5-2 절점(원문 파싱)' },
  nailLen: { values: [50, 63, 76, 82, 89, 101, 114, 127, 139, 152], source: 'KDS 41 50 30 표 4.4-4 못 길이 절점' },
  sideThk: { values: [12, 19, 25, 38], source: 'KDS 41 50 30 표 4.4-4 측면부재 절점' },
  mainThk: { values: [38, 89, 140], source: 'KDS 41 50 30 표 4.5-2 주부재 두께 절점' },
  postSize: { values: [38, 89, 140, 184, 235, 286], source: '구조용 제재 관례 규격 계열(38 배수 — 참고용)' },
};

// ①② param-sweep 지원 도메인 (scripts/drawing-to-3d/param-sweep.mjs CHAINS 미러)
const SWEEP_DOMAINS = ['building', 'landscape', 'interior', 'bridge'];

// Round5 — 공유 링크/브라우저 저장 스냅샷 (표시·복원용 전체 상태)
interface SavedState {
  v?: number; name?: string; at?: number;
  domain: string; templateId: string;
  params: Record<string, number>;
  // 프로젝트 통합(v2): 검증 요약·전수 루프 요약·편집 타임라인(영구화)
  chainSummary?: Record<string, unknown> | null;
  loopSummary?: Record<string, unknown> | null;
  timeline?: Array<{ at: number; label: string }>;
  furn?: Furn[] | null;
  chainP?: Record<string, number | string>;
  lsP?: Record<string, number | string>;
  inP?: Record<string, number>;
  cvP?: Record<string, number>;
}
const PROJ_KEY = 'nf-design-projects'; // localStorage — 최대 20개
const DOMAIN_EMOJI: Record<string, string> = { building: '🏢', civil: '🧱', landscape: '🌳', interior: '☕', bridge: '🌉' };

interface BandPoint { value: number; pass: boolean; fails?: string[]; inputs?: number; metric?: { label?: string; value?: number; unit?: string } | null }
interface SnapInfo { kind?: string; values?: number[]; step?: number; source?: string }
interface HistEntry { params: Record<string, number>; furn?: Furn[] | null; label: string; verdict?: string; at?: number }
interface DiffSummary { verdict: string; nums: Record<string, { v: number; unit?: string }>; strs: Record<string, string> }

/** ④ 전후 diff — 판정 변화 + 수치 지표 델타(최대 3), 문자열 지표는 변화 시 a→b */
function buildDiff(prev: DiffSummary | null, cur: DiffSummary): { from: string; to: string; deltas: string[] } {
  const deltas: string[] = [];
  if (prev) {
    for (const [k, c] of Object.entries(cur.nums)) {
      const p = prev.nums[k];
      if (p && Number.isFinite(p.v) && Number.isFinite(c.v) && p.v !== c.v) {
        const pct = p.v !== 0 ? ((c.v - p.v) / Math.abs(p.v)) * 100 : 0;
        deltas.push(`${k} ${p.v}→${c.v}${c.unit ?? ''} (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)`);
      }
    }
    for (const [k, c] of Object.entries(cur.strs)) {
      const p = prev.strs[k];
      if (p && p !== c) deltas.push(`${k} ${p}→${c}`);
    }
  }
  return { from: prev?.verdict ?? '—', to: cur.verdict, deltas: deltas.slice(0, 3) };
}

interface ParamSpec { name: string; labelKo: string; unit: string; default: number; min: number; max: number }
interface Template { domain: string; id: string; labelKo: string; labelEn: string; params: ParamSpec[] }

interface AssemblyPart {
  id?: string; type?: string; material?: string; role?: string;
  params?: Record<string, unknown>;
  at?: { tx?: number; ty?: number; tz?: number; rx?: number; ry?: number; rz?: number };
  aabb?: { min: number[]; max: number[] };
}
interface Structural { totalMassKg?: number; warnings?: string[]; ok?: boolean }
interface Usage { key: string; kNm2: number; label: string }
interface IntResp {
  ok: boolean; error?: string;
  travel?: {
    maxTravelM: number; limitM: number; pass: boolean; unreachableM2: number; limitNote?: string;
    farthestPointMm?: number[];
    grid?: { nx: number; ny: number; cellMm: number; dist_dm: number[]; blocked: number[] };
  };
  egress?: { verdict?: string; derived?: { doorWidthSumMm: number; seatCount: number }; error?: string | null } | null;
  finishes?: { floorM2: number; wallM2: number; ceilingM2: number };
  lighting?: { verdict?: string; fixtures?: number; layout?: string; avgLuxProvided?: number; roomIndex?: number } | null;
  ventilation?: { verdict?: string; occupants?: number | null; requiredCMH?: number; ACH?: number } | null;
  electrical?: { verdict?: string; totalVA?: number; circuits?: number } | null;
  fire?: {
    verdict?: string; note?: string;
    sprinkler?: { heads?: number; layout?: string; spacingX?: number; spacingY?: number; radiusM?: number } | null;
    extinguisher?: { units?: number; basisAreaM2?: number } | null;
  } | null;
  disclaimer?: string;
}
interface LsResp {
  ok: boolean; error?: string;
  member?: { section: string; spanMm: number; spacingMm: number; verdict?: string; load?: { total_kNm: number; liveRef?: string }; checks?: { flexure?: { ratio?: number } } | null; error?: string | null } | null;
  wind?: { skipped?: boolean; note?: string; FS?: number; worst?: string; pass?: boolean; anchorUpliftPerPost_kN?: number; fsLimit?: number } | null;
  connection?: { type?: string; demandN?: number; verdict?: string; checks?: { shear?: { capacity_N?: number; ratio?: number } } | null; note?: string; error?: string | null } | null;
  disclaimer?: string;
}
// Round6 — 거더교 자동 체인 (scripts/drawing-to-3d/bridge-check.mjs 응답)
interface BrResp {
  ok: boolean; error?: string;
  geometry?: { span_m?: number; nGirders?: number; spacing_m?: number; deckW_m?: number };
  dead?: { wDC_kNm?: number; girderSelf?: number; deckShare?: number; crossShare?: number; wDW_kNm?: number; dwNote?: string; M_DC?: number; M_DW?: number };
  live?: { DF?: number; dfSrc?: string; nLanes?: number; M_LL?: number; V_LL?: number; detail?: { govern?: string } };
  ultimate?: { Mu_kNm?: number; Vu_kN?: number; combo?: string };
  service?: { Ms_kNm?: number };
  section?: { verdict?: string; error?: string; note?: string } | null;
  disclaimer?: string;
}

interface ChainCheck { verdict?: string; error?: string | null }
interface ChainResp {
  ok: boolean; error?: string;
  loads?: { usage: { label: string; live_kNm2: number }; slab: { D_kN: number; L_kN: number; finishNote: string } };
  beams?: Array<ChainCheck & { id: string; section: string; Mu_kNm: number; Vu_kN: number; combo: string; checks?: { flexure?: { ratio?: number }; shear?: { ratio?: number } } }>;
  columns?: Array<ChainCheck & { id: string; section: string; Pu_kN: number }>;
  footing?: ChainCheck & { needInputs?: string[] };
  seismic?: { error?: string; V_kN?: number; Cs?: number; column?: { MuE_kNm?: number; verdict?: string } } | null;
  wind?: { error?: string; H_m?: number; B_m?: number; D_m?: number; x?: { method: string; baseShear_kN: number; p_Nm2: number }; y?: { method: string; baseShear_kN: number; p_Nm2: number }; column?: { MuW_kNm?: number; PuW_kN?: number; verdict?: string }; note?: string } | null;
  slabSLS?: { live: { delta_mm: number; limit_mm: number; pass: boolean }; total: { delta_mm: number; limit_mm: number; pass: boolean }; panelMm?: string } | null;
  disclaimer?: string;
}
interface BuildResp {
  ok: boolean;
  assembly?: { name?: string; domain?: string; parts?: AssemblyPart[] };
  openscad?: string;
  composeIntent?: { name?: string; features?: unknown[] };
  interferences?: Array<{ a: string; b: string }>;
  structural?: Structural | null;
  // 설계 타당성 그물(위시빌더 260717 제품 배선): 부유·면접촉 매립 제안·배관 검사
  support?: { supported: string[]; floating: string[]; faceContacts: Array<{ part: string; on: string; gapMm: number; suggestTzMm: number }> } | null;
  pipes?: { routes: unknown[]; errors: string[]; obstacleViolations: unknown[]; sleeves?: unknown[]; crossViolations: unknown[] } | null;
  designOk?: boolean | null;
  gateErrors?: string[];
  error?: string;
}

export default function AssemblyPresetPanel({
  lang,
  domain,
  onApply,
  onBuildInfo,
}: {
  lang: string;
  domain: string;
  onApply: (intent: { name?: string; features?: unknown[] }, scad: string) => void | Promise<void>;
  /** 빌드 결과 요약(간섭 건수 등) — 검증 그물 ④ 연동(2026-07-16) */
  onBuildInfo?: (info: { interferences: number; floating?: number | null; assembly?: Record<string, unknown> | null }) => void;
}) {
  const ko = isKorean(lang);
  const t = dict[toIsoLang(lang)] ?? dict.ko;
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tid, setTid] = useState('');
  const [params, setParams] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [advJson, setAdvJson] = useState('');
  const [advErr, setAdvErr] = useState<string | null>(null);
  // §C-v2 선형 에디터 상태 — 산출은 advJson(단일 소스)에 병합 기록
  const [edIps, setEdIps] = useState<Array<[number, number]>>([[0, 0], [120000, 0]]);
  const [edCurves, setEdCurves] = useState<Record<number, { R: number; Ls?: number }>>({});
  const [edSel, setEdSel] = useState<number | null>(null);
  const [edDrag, setEdDrag] = useState<number | null>(null);
  const edWorld = useCallback(() => {
    const xs = edIps.map((p) => p[0]), ys = edIps.map((p) => p[1]);
    const pad = 20000;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
    const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    // 화면비(640:240) 유지 — 왜곡 없는 자동 맞춤
    let w = x1 - x0, h = y1 - y0;
    if (w / h > 640 / 240) h = w * (240 / 640); else w = h * (640 / 240);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2, w, h };
  }, [edIps]);
  const edCommit = useCallback((ips: Array<[number, number]>, curves: Record<number, { R: number; Ls?: number }>) => {
    // advJson 병합(다른 키 보존) — 파싱 실패 시 에디터 키만으로 재작성(정직: 오류 표시)
    let base: Record<string, unknown> = {};
    try { base = advJson.trim() ? JSON.parse(advJson) as Record<string, unknown> : {}; } catch { base = {}; }
    base.ips = ips;
    const cArr = Object.entries(curves).map(([k, v]) => ({ ip: Number(k), R: v.R, ...(v.Ls ? { Ls: v.Ls } : {}) }));
    if (cArr.length) base.curves = cArr; else delete base.curves;
    setAdvJson(JSON.stringify(base));
    setAdvErr(null);
  }, [advJson]);
  const [pkgBusy, setPkgBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [built, setBuilt] = useState<BuildResp | null>(null);
  // 하중경로 체인 (building 전용, Wave A·B1)
  const [usages, setUsages] = useState<Usage[]>([]);
  const [chainP, setChainP] = useState<Record<string, number | string>>({ usage: 'office', fck: 24, fy: 400, beamAs: 1548, beamAv: 142.7, beamS: 250, colAst: 3097, fB: 2200, fL: 2200, fT: 500, fD: 420, qAllow: 200, seisZone: '', seisSite: 'S4', seisR: 5, windV0: '', windExposure: 'C', windTerrain: 'normal' });
  const [chain, setChain] = useState<ChainResp | null>(null);
  const [chainBusy, setChainBusy] = useState(false);

  // P1+P2 — "AI가 초안을 만들고, 사람이 면을 잡아 고친다": 뷰어 픽킹 + 디바운스 리빌드 + 자동 재검증
  const [viewerOpen, setViewerOpen] = useState(true);
  const [pickMode, setPickMode] = useState<PickMode>('face');
  const [pick, setPick] = useState<PickEvent | null>(null);
  const [edgeSel, setEdgeSel] = useState<string | null>(null); // 모서리 후보 중 선택된 파라미터
  const handlePick = useCallback((ev: PickEvent) => {
    setPick(ev);
    setEdgeSel(ev.kind === 'edge' && ev.candidates.length === 1 ? ev.candidates[0].param : null);
  }, []);
  // 말로 수정 (NL edit) — /api/nexyfab/drawing/edit-intent (서버=문장→구조화 변환만, 적용·클램프=클라)
  const [nlText, setNlText] = useState('');
  const [nlBusy, setNlBusy] = useState(false);
  const [nlMsg, setNlMsg] = useState<{ ok: true; source?: string; note?: string; summary: string } | { ok: false; error: string } | null>(null);
  // 음성 입력 (Web Speech API — 미지원 브라우저는 버튼 숨김)
  const [voiceAvail, setVoiceAvail] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setVoiceAvail(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    return () => { try { recRef.current?.stop(); } catch { /* noop */ } };
  }, []);

  // ①② 안전범위 밴드 + 목표 탐색 — /api/nexyfab/drawing/param-sweep (결정론 체인 재실행 8회)
  const [swBusyP, setSwBusyP] = useState<string | null>(null);
  const [swRes, setSwRes] = useState<{ param: string; band: BandPoint[]; note?: string; snap?: SnapInfo } | null>(null);
  const [swErr, setSwErr] = useState<{ param: string; msg: string } | null>(null);
  const [goalDir, setGoalDir] = useState<'minPass' | 'maxPass'>('minPass');
  const [goalBusyP, setGoalBusyP] = useState<string | null>(null);
  const [goalRes, setGoalRes] = useState<{ param: string; result: string; value?: number; note?: string } | null>(null);
  // ④ 수정 전후 diff 카드 — 재검증 직전 요약을 보관 → 완료 시 비교
  const prevSumRef = useRef<DiffSummary | null>(null);
  const diffArmedRef = useRef(false);
  const [diffCard, setDiffCard] = useState<{ from: string; to: string; deltas: string[] } | null>(null);
  // ⑤ undo/redo 이력 — 파라미터+가구 스냅샷 스택(최대 30), idx=현재 위치
  const [hist, setHist] = useState<{ entries: HistEntry[]; idx: number }>({ entries: [], idx: -1 });
  const [histOpen, setHistOpen] = useState(false);
  // Round4 — 인테리어 자유배치: null=템플릿 그리드, 배열=customFurniture(빌드 파라미터에 동봉)
  const [furn, setFurn] = useState<Furn[] | null>(null);
  // Round5 — 공통 편의: 단위 토글(표시 전용)·A/B 비교·저장 프로젝트·공유 복원·단축키
  const [unitM, setUnitM] = useState(false); // true=m 표시 (입력은 mm 고정)
  const [abA, setAbA] = useState<{ params: Record<string, number>; furn: Furn[] | null; sum: DiffSummary | null; at: number } | null>(null);
  const [projects, setProjects] = useState<SavedState[]>([]);
  const [pjSelAt, setPjSelAt] = useState('');
  const [saveName, setSaveName] = useState('');
  const restoreRef = useRef<SavedState | null>(null); // ?d= 링크·불러오기 → 템플릿 로드 후 적용
  const [uniBusy, setUniBusy] = useState(false); // Round6 — 통합 리포트 구성 중
  // Round7 — 서버 프로젝트 저장 (/api/nexyfab/drawing/projects · nf_access_token, 401=비로그인 정직 안내)
  const [svOpen, setSvOpen] = useState(false);
  const [svAuth, setSvAuth] = useState<boolean | null>(null); // null=미확인 · false=비로그인(로컬 저장은 계속 가능)
  const [svList, setSvList] = useState<Array<{ id: string; name: string; domain: string; updated_at?: string }>>([]);
  const [svSel, setSvSel] = useState('');
  const [svBusyF, setSvBusyF] = useState(false);
  const [svMsg, setSvMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const hkRef = useRef<{ undo: () => void; redo: () => void; mode: (m: PickMode) => void; esc: () => void } | null>(null);

  // 저장 프로젝트 로드 (mount)
  useEffect(() => {
    try {
      const a = JSON.parse(window.localStorage.getItem(PROJ_KEY) ?? '[]') as SavedState[];
      if (Array.isArray(a)) setProjects(a);
    } catch { /* 손상된 저장소 — 빈 목록 */ }
  }, []);

  // ?d= 공유 링크 파싱 (base64url → JSON) — 템플릿 로드 후 restoreRef로 적용·자동 빌드
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('d');
      if (!q) return;
      const b64 = q.replace(/-/g, '+').replace(/_/g, '/');
      const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      const d = JSON.parse(json) as SavedState;
      if (d && d.domain === domain && d.templateId && d.params) restoreRef.current = d;
    } catch { /* 잘못된 링크 — 무시(정직: 복원 안 함) */ }
  }, [domain]);

  // 키보드 단축키 — Ctrl+Z/Y=undo/redo · 1/2/3=면/모서리/거리 · Esc=선택 해제 (입력 포커스 시 비활성)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      const hk = hkRef.current;
      if (!hk || typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); hk.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); hk.redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '1') hk.mode('face');
      else if (e.key === '2') hk.mode('edge');
      else if (e.key === '3') hk.mode('dist');
      else if (e.key === 'Escape') hk.esc();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const generateRef = useRef<() => Promise<void>>(async () => {});
  const reverifyPending = useRef(false);
  const rebuildTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (rebuildTimer.current) clearTimeout(rebuildTimer.current); }, []);
  const scheduleRebuild = useCallback(() => {
    if (rebuildTimer.current) clearTimeout(rebuildTimer.current);
    rebuildTimer.current = setTimeout(() => {
      reverifyPending.current = true; // 리빌드 완료(built 갱신) 후 도메인 체인 자동 재실행
      void generateRef.current();
    }, 600);
  }, []);

  useEffect(() => {
    if (domain !== 'building') return;
    fetch('/api/nexyfab/drawing/load-path/')
      .then((r) => r.json())
      .then((d: { ok: boolean; usages?: Usage[] }) => { if (d.ok && d.usages) setUsages(d.usages); })
      .catch(() => {});
  }, [domain]);

  // 유료 전문 조사 의뢰 (컨설팅 신청형) — /api/contact 재사용: nf_support_tickets + 관리자 메일
  const [erOpen, setErOpen] = useState(false);
  const [erP, setErP] = useState<Record<string, string>>({ name: '', email: '', service: 'prior-art', message: '' });
  const [erBusy, setErBusy] = useState(false);
  const [erMsg, setErMsg] = useState<string | null>(null);
  const ER_SERVICES: Array<[string, string, string]> = [
    ['prior-art', t.svcPriorArt, t.svcPriorArtD],
    ['design-around', t.svcDesignAround, t.svcDesignAroundD],
    ['global', t.svcGlobal, t.svcGlobalD],
  ];
  const submitExpertRequest = useCallback(async () => {
    if (!built?.assembly || !erP.name.trim() || !erP.email.trim()) { setErMsg(t.erNeedNameEmail); return; }
    setErBusy(true); setErMsg(null);
    try {
      const svc = ER_SERVICES.find(([k]) => k === erP.service);
      const res = await fetch('/api/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: erP.name.trim(), email: erP.email.trim(), category: 'other',
          subject: `[전문 조사 의뢰] ${svc?.[1] ?? erP.service} — ${built.assembly.name ?? domain}`,
          message: (erP.message.trim() || '(요청사항 없음)') + '\n\n— 설계 스냅샷 자동 첨부(context 참조)',
          // context는 4,000자 제한 — 원시 어셈블리 대신 재현 가능한 템플릿+파라미터 스냅샷
          context: {
            type: 'expert-research-request', service: erP.service, domain,
            template: tid, params,
            design: {
              name: built.assembly.name ?? null,
              parts: built.assembly.parts?.length ?? 0,
              massKg: built.structural?.totalMassKg ?? null,
              materials: [...new Set((built.assembly.parts ?? []).map((p) => p.material).filter(Boolean))],
            },
          },
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(j.error ?? 'submit failed');
      setErMsg(t.erDone);
      setErP((s) => ({ ...s, message: '' }));
    } catch (e) {
      setErMsg(t.erFailPrefix + (e instanceof Error ? e.message : String(e)));
    } finally {
      setErBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, erP, t, domain, tid, params]);

  // 공용: 체인 리포트 HTML 다운로드 (라우트 format:'html')
  const downloadHtmlReport = useCallback(async (url: string, bodyObj: Record<string, unknown>, filename: string) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...bodyObj, format: 'html' }) });
      const j = (await r.json()) as { html?: string };
      if (!j.html) throw new Error('no html');
      const blobUrl = URL.createObjectURL(new Blob([j.html], { type: 'text/html' }));
      const a = document.createElement('a'); a.href = blobUrl; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    } catch {
      setMsg(t.reportFailed);
    }
  }, [t]);

  // 토목 체인 (civil 전용): 옹벽 안정 — 단면=형상 메타 자동 파생, 토질만 입력
  const [cvP, setCvP] = useState<Record<string, number>>({ gammaBackfill: 18, phiBackfill: 30, baseFriction: 0.5, allowableBearing: 200, surcharge: 0, seismicKh: 0 });
  const [cv, setCv] = useState<{ ok?: boolean; verdict?: string; error?: string; checks?: Record<string, { FS?: number; pass?: boolean }>; seismic?: { verdict?: string; kh?: number; error?: string; checks?: Record<string, { FS?: number; pass?: boolean }> } | null } | null>(null);
  const [cvBusy, setCvBusy] = useState(false);
  const civilBody = useCallback(() => ({
    intent: built?.assembly, domain: 'civil', calculatorId: 'retaining_wall_stability', params: cvP,
  }), [built, cvP]);
  const runCivil = useCallback(async () => {
    if (!built?.assembly) return;
    setCvBusy(true); setCv(null);
    try {
      const r = await fetch('/api/nexyfab/drawing/verify-domain/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(civilBody()) });
      setCv(await r.json());
    } catch (e) {
      setCv({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setCvBusy(false);
    }
  }, [built, civilBody]);

  // 조경 체인 (landscape 전용, Wave A 조경 L1+L2)
  const [lsP, setLsP] = useState<Record<string, number | string>>({ species: 'pine', grade: 2, usage: 'residence_living', windPressure: 0, extraW: 0, connType: 'none' });
  const [ls, setLs] = useState<LsResp | null>(null);
  const [lsBusy, setLsBusy] = useState(false);

  const lsBody = useCallback(() => ({
    assembly: built?.assembly,
    params: {
      species: lsP.species, grade: Number(lsP.grade), usage: lsP.usage,
      extraW_kNm: Number(lsP.extraW) || 0,
      ...(Number(lsP.windPressure) > 0 ? { windPressure_kNm2: Number(lsP.windPressure) } : {}),
      // 접합철물(KDS 41 50 30 못/볼트) — 미지정 시 생략 (규격 기본값=서버)
      ...(lsP.connType !== 'none' ? { connection: { type: lsP.connType } } : {}),
    },
  }), [built, lsP]);
  const runLandscape = useCallback(async () => {
    if (!built?.assembly) return;
    setLsBusy(true); setLs(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/landscape-check/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lsBody()),
      });
      setLs((await res.json()) as LsResp);
    } catch (e) {
      setLs({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLsBusy(false);
    }
  }, [built, lsBody]);

  // 인테리어 체인 (interior 전용, Wave A I2+I3 · 설비 MEP 개산)
  const [intR, setIntR] = useState<IntResp | null>(null);
  const [intBusy, setIntBusy] = useState(false);
  const [inP, setInP] = useState<Record<string, number>>({ targetLux: 0, lampLumen: 0, ventPerPersonCMH: 0, loadDensityVAm2: 0, sprinklerRadiusM: 0 });
  const intBody = useCallback(() => ({
    assembly: built?.assembly,
    params: {
      returnGrid: true, // Round4 — 피난 히트맵 오버레이용 BFS 격자 동봉
      // 설비 개산(조명·환기·전기·소방) — 기준값 날조 금지: 입력 시에만 전달
      ...(inP.targetLux > 0 ? { targetLux: inP.targetLux } : {}),
      ...(inP.lampLumen > 0 ? { lampLumen: inP.lampLumen } : {}),
      ...(inP.ventPerPersonCMH > 0 ? { ventPerPersonCMH: inP.ventPerPersonCMH } : {}),
      ...(inP.loadDensityVAm2 > 0 ? { loadDensityVAm2: inP.loadDensityVAm2 } : {}),
      ...(inP.sprinklerRadiusM > 0 ? { sprinklerRadiusM: inP.sprinklerRadiusM } : {}),
    },
  }), [built, inP]);
  const runInterior = useCallback(async () => {
    if (!built?.assembly) return;
    setIntBusy(true); setIntR(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/interior-check/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intBody()),
      });
      setIntR((await res.json()) as IntResp);
    } catch (e) {
      setIntR({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setIntBusy(false);
    }
  }, [built, intBody]);

  const chainBody = useCallback(() => ({
    assembly: built?.assembly,
    params: {
      usage: chainP.usage, fck: Number(chainP.fck), fy: Number(chainP.fy),
      beamAs: Number(chainP.beamAs), beamAv: Number(chainP.beamAv), beamS: Number(chainP.beamS),
      colAst: Number(chainP.colAst),
      footing: { B: Number(chainP.fB), L: Number(chainP.fL), t: Number(chainP.fT), d: Number(chainP.fD), qAllow: Number(chainP.qAllow) },
      // 지진(등가정적) — 구역 선택 시에만 (R=표 6.2-1 시스템 결정)
      ...(chainP.seisZone ? { seismic: { zone: chainP.seisZone, siteClass: chainP.seisSite, R: Number(chainP.seisR) || 5 } } : {}),
      // 풍하중(KDS 41 12 00) — V0 입력 시에만 (H·B·D=형상 파생, 간편법/정식법 자동선택)
      ...(Number(chainP.windV0) > 0 ? { wind: { V0: Number(chainP.windV0), exposure: chainP.windExposure, terrain: chainP.windTerrain } } : {}),
    },
  }), [built, chainP]);
  // 검증 A/B — A 시점 체인 판정 스냅샷
  const [abAChain, setAbAChain] = useState<{ rows: Array<{ id: string; v: string; key: string }> } | null>(null);
  // 전수 설계 루프 상태
  const [loop, setLoop] = useState<{ ok: boolean; error?: string; summary?: Record<string, unknown>; crossCheck?: { pass?: boolean }; members?: Array<{ id: string; verdict: string }> } | null>(null);
  const [loopBusy, setLoopBusy] = useState(false);
  const runDesignLoop = useCallback(async () => {
    if (!built?.assembly) return;
    setLoopBusy(true); setLoop(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/design-loop/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chainBody()),
      });
      setLoop((await res.json()) as typeof loop);
    } catch (e) {
      setLoop({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally { setLoopBusy(false); }
  }, [built, chainBody]);

  // 자동 배근 제안 (FAIL 부재 → 이분법 최소 배근 → 전수 재검증)
  const [suggest, setSuggest] = useState<{ ok: boolean; suggestions?: Array<Record<string, unknown>>; verified?: boolean; disclaimer?: string } | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const runSuggest = useCallback(async () => {
    if (!built?.assembly) return;
    setSuggestBusy(true); setSuggest(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/design-loop/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...chainBody(), mode: 'suggest' }),
      });
      setSuggest((await res.json()) as typeof suggest);
    } catch (e) {
      setSuggest({ ok: false, disclaimer: e instanceof Error ? e.message : String(e) });
    } finally { setSuggestBusy(false); }
  }, [built, chainBody]);

  const runChain = useCallback(async () => {
    if (!built?.assembly) return;
    setChainBusy(true); setChain(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/load-path/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chainBody()),
      });
      setChain((await res.json()) as ChainResp);
    } catch (e) {
      setChain({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setChainBusy(false);
    }
  }, [built, chainBody]);

  // Round6 — 거더교 체인 (bridge 전용): DC·DW·KL-510 활하중·극한 I — 전부 선택 입력(미입력=정직 기본)
  const [brP, setBrP] = useState<Record<string, number>>({ pavementThk_mm: 0, nLanes: 0, DF: 0, As_mm2: 0 });
  const [br, setBr] = useState<BrResp | null>(null);
  const [brBusy, setBrBusy] = useState(false);
  const brBody = useCallback(() => ({
    assembly: built?.assembly,
    params: {
      ...(brP.pavementThk_mm > 0 ? { pavementThk_mm: brP.pavementThk_mm } : {}),
      ...(brP.nLanes > 0 ? { nLanes: Math.round(brP.nLanes) } : {}),
      ...(brP.DF > 0 ? { DF: brP.DF } : {}), // 미입력 = 레버룰 자동(서버가 dfSrc로 명시)
      ...(brP.As_mm2 > 0 ? { As_mm2: brP.As_mm2 } : {}),
    },
  }), [built, brP]);
  const runBridge = useCallback(async () => {
    if (!built?.assembly) return;
    setBrBusy(true); setBr(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/bridge-check/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brBody()),
      });
      setBr((await res.json()) as BrResp);
    } catch (e) {
      setBr({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBrBusy(false);
    }
  }, [built, brBody]);

  // Round5 — 공유 링크/저장 프로젝트 복원: 상태 일괄 적용 + 자동 빌드(같은 디바운스→재검증 파이프)
  // 어셈블리 도면→3D(2026-07-16): 이미지 → 템플릿 매칭(extract-preset kind=assembly) →
  // 판독값 확인 카드 승인 → restoreRef 경로로 파라미터 적용+자동 빌드. 사진=형태 힌트만(§3).
  const aFileRef = useRef<HTMLInputElement>(null);
  const aModeRef = useRef<'drawing' | 'photo'>('drawing');
  const [aDrawBusy, setADrawBusy] = useState(false);
  const [aDrawErr, setADrawErr] = useState<string | null>(null);
  const [aDrawRes, setADrawRes] = useState<{ templateId: string; labelKo?: string; labelEn?: string; confidence: number; values: Record<string, number>; filled?: string[]; clamped?: string[]; notes?: string; photo?: boolean } | null>(null);
  const onPickAsmFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setADrawErr(ko ? 'PNG·JPG·WebP 이미지만 지원합니다.' : 'PNG/JPG/WebP only.'); return; }
    if (f.size > 6_000_000) { setADrawErr(ko ? '이미지가 너무 큽니다(6MB 이하).' : 'Image too large (max 6MB).'); return; }
    const mode = aModeRef.current;
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result || '').replace(/^data:[^,]+,/, '');
      void (async () => {
        setADrawBusy(true); setADrawErr(null); setADrawRes(null);
        try {
          const r = await fetch('/api/nexyfab/drawing/extract-preset/', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: b64, mimeType: f.type, domain, kind: 'assembly' }),
          });
          const j = (await r.json()) as ({ ok: true } & NonNullable<typeof aDrawRes>) | { ok: false; error?: string };
          if (j.ok) setADrawRes(mode === 'photo' ? { ...j, values: {}, filled: undefined, clamped: undefined, photo: true } : j);
          else setADrawErr(j.error ?? (ko ? '판독 실패' : 'Read failed'));
        } catch (err) {
          setADrawErr(err instanceof Error ? err.message : String(err));
        } finally {
          setADrawBusy(false);
        }
      })();
    };
    reader.readAsDataURL(f);
  };
  const confirmAsmDraw = () => {
    if (!aDrawRes || !templates) return;
    const tp = templates.find((x) => x.id === aDrawRes.templateId);
    if (!tp) { setADrawErr(ko ? '템플릿을 찾을 수 없습니다.' : 'Template not found.'); return; }
    const merged = { ...Object.fromEntries(tp.params.map((p) => [p.name, p.default])), ...aDrawRes.values };
    const snap: SavedState = { domain, templateId: tp.id, params: merged, name: ko ? '도면 판독' : 'from drawing' };
    setADrawRes(null);
    if (tid === tp.id) {
      applyRestore(snap, ko ? '도면 판독 적용 — 자동 빌드' : 'Applied from drawing');
    } else {
      restoreRef.current = snap; // tpl 이펙트가 applyRestore(스냅샷 적용+자동 빌드) 수행
      setTid(tp.id);
    }
  };

  const applyRestore = (d: SavedState, label: string) => {
    setParams({ ...d.params });
    setFurn(d.furn ?? null);
    if (d.chainP) setChainP((s) => ({ ...s, ...d.chainP }));
    if (d.lsP) setLsP((s) => ({ ...s, ...d.lsP }));
    if (d.inP) setInP((s) => ({ ...s, ...d.inP }));
    if (d.cvP) setCvP((s) => ({ ...s, ...d.cvP }));
    setMsg(label);
    setPick(null); setEdgeSel(null); setNlMsg(null);
    setSwRes(null); setSwErr(null); setGoalRes(null);
    setDiffCard(null); setAbA(null);
    prevSumRef.current = null; diffArmedRef.current = false;
    setHist({ entries: [{ params: { ...d.params }, furn: d.furn ?? null, label }], idx: 0 });
    scheduleRebuild();
  };

  useEffect(() => {
    let alive = true;
    fetch(`/api/nexyfab/drawing/preset/?kind=assembly&domain=${encodeURIComponent(domain)}`)
      .then((r) => r.json())
      .then((d: { ok: boolean; templates?: Template[] }) => {
        if (!alive || !d.ok || !d.templates?.length) return;
        setTemplates(d.templates);
        // 공유 링크/불러오기 복원 대기 중이면 해당 템플릿으로 진입
        const r0 = restoreRef.current;
        setTid(r0 && d.templates.some((x) => x.id === r0.templateId) ? r0.templateId : d.templates[0].id);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [domain]);

  const tpl = useMemo(() => templates?.find((tp) => tp.id === tid) ?? null, [templates, tid]);

  useEffect(() => {
    if (!tpl) return;
    // 복원 대기(공유 링크·불러오기)가 이 템플릿을 향하면 기본값 대신 스냅샷 적용 + 자동 빌드
    const r0 = restoreRef.current;
    if (r0 && r0.templateId === tpl.id) {
      restoreRef.current = null;
      applyRestore(r0, r0.name ? t.pjRestored + r0.name : t.shRestored);
      setBuilt(null);
      return;
    }
    const defs = Object.fromEntries(tpl.params.map((p) => [p.name, p.default]));
    setParams(defs);
    setMsg(null);
    setBuilt(null);
    setPick(null);
    setEdgeSel(null);
    setNlMsg(null);
    setSwRes(null); setSwErr(null); setGoalRes(null);
    setDiffCard(null);
    prevSumRef.current = null;
    diffArmedRef.current = false;
    setFurn(null);
    setHist({ entries: [{ params: defs, furn: null, label: t.hsInit }], idx: 0 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl]);

  const generate = useCallback(async () => {
    if (!tid) return;
    // §C-v1 고급 입력(JSON) 병합 — 파싱 실패는 정직하게 필드 오류로(빌드 강행 금지)
    let adv: Record<string, unknown> = {};
    if (advJson.trim()) {
      try { adv = JSON.parse(advJson) as Record<string, unknown>; }
      catch (e) { setAdvErr(`JSON: ${e instanceof Error ? e.message : String(e)}`); return; }
      if (typeof adv !== 'object' || adv === null || Array.isArray(adv)) { setAdvErr(t.advBad); return; }
    }
    setBusy(true); setMsg(null); setBuilt(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/preset/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Round4: 인테리어 자유배치 가구는 같은 빌드 파라미터에 동봉 — 형상·검증이 그대로 추종
        body: JSON.stringify({ kind: 'assembly', domain, templateId: tid, params: { ...params, ...adv, ...(furn ? { customFurniture: furn } : {}) } }),
      });
      const data = (await res.json()) as BuildResp;
      if (data.ok && data.composeIntent && data.openscad) {
        setBuilt(data);
        onBuildInfo?.({ interferences: data.interferences?.length ?? 0, floating: data.support?.floating?.length ?? null, assembly: (data as { assembly?: Record<string, unknown> }).assembly ?? null }); // 그물 ④+④b+패키지
        await onApply(data.composeIntent, data.openscad);
        const mass = data.structural?.totalMassKg;
        const pipeBad = (data.pipes?.errors?.length ?? 0) + (data.pipes?.obstacleViolations?.length ?? 0) + (data.pipes?.crossViolations?.length ?? 0);
        setMsg(
          t.builtParts + (data.assembly?.parts?.length ?? 0)
          + (mass ? ` · ${mass >= 1000 ? (mass / 1000).toFixed(1) + 't' : mass.toFixed(0) + 'kg'}` : '')
          + (data.interferences?.length ? ` · ⚠${t.clash} ${data.interferences.length}` : '')
          + (data.support?.floating?.length ? ` · ⚠${t.floating} ${data.support.floating.length}: ${data.support.floating.slice(0, 3).join(',')}` : '')
          + (data.support?.faceContacts?.length ? ` · ${t.faceContact} ${data.support.faceContacts.length}` : '')
          + (data.pipes ? (pipeBad ? ` · ⚠${t.pipeBad} ${pipeBad}` : ` · ${t.pipeOk} ${data.pipes.routes?.length ?? 0}`) : '')
          + (data.pipes?.sleeves?.length ? ` · ${t.sleeve} ${data.pipes.sleeves.length}` : ''),
        );
      } else {
        setMsg(t.failed + (data.gateErrors?.join('; ') ?? data.error ?? ''));
      }
    } catch (e) {
      setMsg(t.failed + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [tid, params, furn, advJson, onApply, t, domain]);

  // 면 편집 디바운스 리빌드가 항상 최신 generate(최신 params 클로저)를 부르도록 유지
  useEffect(() => { generateRef.current = generate; }, [generate]);

  // ④ 분야별 결과 요약(diff 카드용) — 대표 수치 지표 + 종합 판정 (은폐 없이 결과 트리에서만)
  const summarize = useCallback((): DiffSummary | null => {
    if (domain === 'building') {
      if (!chain?.ok) return null;
      const verdicts = [
        ...(chain.beams ?? []).map((b) => b.verdict ?? ''),
        ...(chain.columns ?? []).map((c) => c.verdict ?? ''),
        chain.footing?.verdict ?? '',
        chain.seismic?.column?.verdict ?? '',
        chain.wind?.column?.verdict ?? '',
        ...(chain.slabSLS ? [chain.slabSLS.live.pass && chain.slabSLS.total.pass ? 'PASS' : 'FAIL'] : []),
      ].filter(Boolean);
      const nums: DiffSummary['nums'] = {};
      const fr = chain.beams?.[0]?.checks?.flexure?.ratio ?? chain.beams?.[0]?.checks?.shear?.ratio;
      if (typeof fr === 'number') nums[t.dfBeamRatio] = { v: fr };
      if (typeof chain.slabSLS?.total.delta_mm === 'number') nums[t.bdSlabDefl] = { v: chain.slabSLS.total.delta_mm, unit: 'mm' };
      const strs: DiffSummary['strs'] = {};
      if (chain.seismic?.column?.verdict) strs[t.dfSeisCol] = chain.seismic.column.verdict;
      return { verdict: verdicts.includes('FAIL') ? 'FAIL' : verdicts.includes('PASS') ? 'PASS' : '—', nums, strs };
    }
    if (domain === 'landscape') {
      if (!ls?.ok) return null;
      const fail = ls.member?.verdict === 'FAIL' || (!!ls.wind && !ls.wind.skipped && ls.wind.pass === false) || ls.connection?.verdict === 'FAIL';
      const nums: DiffSummary['nums'] = {};
      const mr = ls.member?.checks?.flexure?.ratio;
      if (typeof mr === 'number') nums[t.dfMemberRatio] = { v: mr };
      return { verdict: fail ? 'FAIL' : ls.member?.verdict === 'PASS' ? 'PASS' : '—', nums, strs: {} };
    }
    if (domain === 'interior') {
      if (!intR?.ok) return null;
      const fail = intR.travel?.pass === false || intR.egress?.verdict === 'FAIL';
      const nums: DiffSummary['nums'] = {};
      if (typeof intR.travel?.maxTravelM === 'number') nums[t.inTravel] = { v: intR.travel.maxTravelM, unit: 'm' };
      return { verdict: fail ? 'FAIL' : intR.travel?.pass ? 'PASS' : '—', nums, strs: {} };
    }
    if (domain === 'civil') {
      if (!cv?.ok) return null;
      const checks = Object.values(cv.checks ?? {});
      const verdict = cv.verdict ?? (checks.length ? (checks.every((c) => c.pass) ? 'PASS' : 'FAIL') : '—');
      return { verdict, nums: {}, strs: {} };
    }
    if (domain === 'bridge') {
      if (!br?.ok) return null;
      const nums: DiffSummary['nums'] = {};
      if (typeof br.ultimate?.Mu_kNm === 'number') nums['Mu'] = { v: br.ultimate.Mu_kNm, unit: 'kN·m' };
      if (typeof br.live?.M_LL === 'number') nums['M_LL'] = { v: br.live.M_LL, unit: 'kN·m' };
      // 판정은 단면검토(As 입력) 시에만 존재 — 없으면 '—' (정직)
      return { verdict: br.section?.verdict === 'PASS' ? 'PASS' : br.section?.verdict === 'FAIL' ? 'FAIL' : '—', nums, strs: {} };
    }
    return null;
  }, [domain, chain, ls, intR, cv, br, t]);

  // P1 "수정하면 검증이 따라온다" — 면 편집 리빌드 완료 시 해당 도메인 체인 자동 재실행
  // ④ 재검증 직전 현재 요약 보관 → 완료 시 전후 diff
  useEffect(() => {
    if (!built?.assembly || !reverifyPending.current) return;
    reverifyPending.current = false;
    prevSumRef.current = summarize();
    setDiffCard(null);
    if (domain === 'building') { diffArmedRef.current = true; void runChain(); }
    else if (domain === 'landscape') { diffArmedRef.current = true; void runLandscape(); }
    else if (domain === 'interior') { diffArmedRef.current = true; void runInterior(); }
    else if (domain === 'civil') { diffArmedRef.current = true; void runCivil(); }
    else if (domain === 'bridge') { diffArmedRef.current = true; void runBridge(); }
  }, [built, domain, runChain, runLandscape, runInterior, runCivil, runBridge, summarize]);

  // ④ 재검증 완료 → diff 카드 표시 + ⑤ 현재 이력 엔트리에 verdict 스탬프
  useEffect(() => {
    if (!diffArmedRef.current) return;
    const cur = summarize();
    if (!cur) return; // 러너가 결과를 null로 초기화한 시점 — 완료 대기
    diffArmedRef.current = false;
    setDiffCard(buildDiff(prevSumRef.current, cur));
    setHist((h) => (h.idx >= 0 && h.entries[h.idx]
      ? { ...h, entries: h.entries.map((e, i) => (i === h.idx ? { ...e, verdict: cur.verdict } : e)) }
      : h));
  }, [chain, ls, intR, cv, br, summarize]);

  const downloadPackage = useCallback(async () => {
    if (!built?.assembly) return;
    setPkgBusy(true);
    try {
      const r = await fetch('/api/nexyfab/drawing/package/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assembly: built.assembly }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; zipBase64?: string; files?: Array<{ name: string; content: string; mime?: string }>; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? t.pkgFailed);
      if (typeof j.zipBase64 === 'string') {
        const bin = atob(j.zipBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
        const a = document.createElement('a'); a.href = url; a.download = 'design_package.zip'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } else if (Array.isArray(j.files)) {
        for (const f of j.files) {
          const url = URL.createObjectURL(new Blob([f.content], { type: f.mime ?? 'text/html' }));
          const a = document.createElement('a'); a.href = url; a.download = f.name; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        }
      } else throw new Error(t.pkgFailed);
    } catch (e) {
      setMsg(t.pkgFailPrefix + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPkgBusy(false);
    }
  }, [built, t]);

  if (!templates) return null;

  const warnings = built?.structural?.warnings ?? [];

  // ── 면 편집(P2) 헬퍼 — 템플릿 파라미터 스텝 편집(디바운스 리빌드 → 자동 재검증 연동) ──
  const stepFor = (v: number) => (Math.abs(v) < 1000 ? 10 : Math.abs(v) < 10000 ? 50 : 100);

  // ⑤ 이력 스택 — push는 "적용된 편집"에서만(스테퍼·스냅칩·밴드·목표적용·NL·블러·가구), 복원/undo/redo는 idx 이동만
  const pushHist = (nextParams: Record<string, number>, label: string, nextFurn: Furn[] | null = furn) => {
    setHist((h) => {
      const cut = h.entries.slice(0, h.idx + 1);
      let entries = [...cut, { params: nextParams, furn: nextFurn, label }];
      if (entries.length > 30) entries = entries.slice(entries.length - 30);
      return { entries, idx: entries.length - 1 };
    });
  };
  const restoreHist = (i: number) => {
    const e = hist.entries[i];
    if (!e || i === hist.idx || i < 0 || i >= hist.entries.length) return;
    setParams(e.params);
    setFurn(e.furn ?? null); // 가구 배치도 스냅샷에 포함 — 복원 시 함께 되돌림
    setHist((h) => ({ ...h, idx: i }));
    scheduleRebuild();
  };
  // Round4 — 배치 에디터 커밋: customFurniture 갱신 → 같은 디바운스→리빌드→재검증 파이프
  const onFurnChange = (list: Furn[] | null, label: string) => {
    setFurn(list);
    pushHist({ ...params }, label, list);
    scheduleRebuild();
  };

  const editParam = (name: string, next: number) => {
    if (!Number.isFinite(next)) return;
    const old = Number(params[name]);
    if (old === next) return;
    const nextParams = { ...params, [name]: next };
    setParams(nextParams);
    pushHist(nextParams, `${name} ${Number.isFinite(old) ? old : '—'}→${next}`);
    scheduleRebuild();
  };
  // 숫자 입력: 타이핑 중은 이력 없이 리빌드만, 블러 시 확정(③ 목록 외 mm 파라미터는 10mm 그리드 반올림)
  const inputParam = (name: string, v: number) => {
    if (!Number.isFinite(v)) return;
    setParams((s) => ({ ...s, [name]: v }));
    scheduleRebuild();
  };
  const blurParam = (name: string) => {
    const spec = tpl?.params.find((p) => p.name === name);
    let v = Number(params[name]);
    if (!Number.isFinite(v)) return;
    if (!SNAP_MIRROR[name] && spec?.unit === 'mm') {
      const r = Math.round(v / 10) * 10;
      v = spec ? Math.min(spec.max, Math.max(spec.min, r)) : r;
    }
    const curEntry = hist.entries[hist.idx];
    if (v === Number(params[name]) && curEntry && Number(curEntry.params[name]) === v) return; // 변경 없음
    const nextParams = { ...params, [name]: v };
    setParams(nextParams);
    pushHist(nextParams, `${name} →${v}`);
    scheduleRebuild();
  };

  // ①② 스윕 공통 — 체인 러너와 동일 파라미터(assembly 제외)를 그대로 전달
  const sweepChainParams = (): Record<string, unknown> => {
    if (domain === 'building') return chainBody().params;
    if (domain === 'landscape') return lsBody().params;
    if (domain === 'interior') {
      const p2: Record<string, unknown> = { ...intBody().params };
      delete p2.returnGrid; // 스윕 8회에 격자 8개 동봉 방지(전송량)
      return p2;
    }
    if (domain === 'bridge') return brBody().params; // Round6 — 교량 체인 입력 그대로
    return {};
  };
  // 스윕/빌드 공용 — 템플릿 파라미터 + (인테리어) 자유배치 가구
  const sweepBuildParams = (): Record<string, unknown> => ({ ...params, ...(furn ? { customFurniture: furn } : {}) });
  const runSweep = async (name: string) => {
    const spec = tpl?.params.find((p) => p.name === name);
    if (!spec || !tid || swBusyP) return;
    setSwBusyP(name); setSwRes(null); setSwErr(null); setGoalRes(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/param-sweep/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, templateId: tid, params: sweepBuildParams(), chainParams: sweepChainParams(), param: name, min: spec.min, max: spec.max, points: 8 }),
      });
      const j = (await res.json()) as { ok?: boolean; band?: BandPoint[]; note?: string; snap?: SnapInfo; error?: string };
      if (!j.ok || !j.band) { setSwErr({ param: name, msg: j.error ?? '—' }); return; }
      setSwRes({ param: name, band: j.band, note: j.note, snap: j.snap });
    } catch (e) {
      setSwErr({ param: name, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSwBusyP(null);
    }
  };
  const runGoal = async (name: string) => {
    const spec = tpl?.params.find((p) => p.name === name);
    if (!spec || !tid || goalBusyP) return;
    setGoalBusyP(name); setGoalRes(null); setSwErr(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/param-sweep/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, templateId: tid, params: sweepBuildParams(), chainParams: sweepChainParams(), param: name, min: spec.min, max: spec.max, points: 8, goal: goalDir }),
      });
      const j = (await res.json()) as { ok?: boolean; result?: string; value?: number; band?: BandPoint[]; note?: string; snap?: SnapInfo; error?: string };
      if (!j.ok) { setSwErr({ param: name, msg: j.error ?? '—' }); return; }
      setGoalRes({ param: name, result: j.result ?? '—', value: j.value, note: j.note });
      if (j.band) setSwRes({ param: name, band: j.band, note: undefined, snap: j.snap });
    } catch (e) {
      setSwErr({ param: name, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setGoalBusyP(null);
    }
  };

  const renderParamEditor = (name: string) => {
    const spec = tpl?.params.find((p) => p.name === name) ?? null;
    const cur = Number(params[name] ?? spec?.default ?? 0);
    const clampV = (v: number) => (spec ? Math.min(spec.max, Math.max(spec.min, v)) : v);
    const snap = SNAP_MIRROR[name];
    const showBand = swRes?.param === name && swRes.band.length > 0;
    const bandMin = showBand ? swRes.band[0].value : 0;
    const bandMax = showBand ? swRes.band[swRes.band.length - 1].value : 0;
    const markerPct = showBand && bandMax > bandMin ? Math.min(100, Math.max(0, ((cur - bandMin) / (bandMax - bandMin)) * 100)) : null;
    return (
      <div key={name} style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 10.5, flex: 1, color: 'var(--nx-text-2, #46505e)' }}>
            {spec?.labelKo ?? name}{spec?.unit ? ` (${spec.unit})` : ''} · <code style={{ fontSize: 10 }}>{name}</code>
          </span>
          <button type="button" onClick={() => editParam(name, clampV(cur - stepFor(cur)))} style={stepBtn}>−</button>
          <input
            type="number" inputMode="decimal" value={cur}
            onChange={(e) => inputParam(name, Number(e.target.value))}
            onBlur={() => blurParam(name)}
            style={{ ...inpStyle, width: 84 }}
          />
          <button type="button" onClick={() => editParam(name, clampV(cur + stepFor(cur)))} style={stepBtn}>+</button>
        </div>
        {/* ⑥ 템플릿 치수 = 같은 역할 부재 전체에 일괄 적용(명시) · Round5 단위 토글 표시(입력은 mm) */}
        <div style={{ marginTop: 2, fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }}>
          {t.fpTplWide}
          {unitM && spec?.unit === 'mm' && <span style={{ marginLeft: 6, color: 'var(--nx-accent, #2563eb)' }}>≈ {(cur / 1000).toFixed(3)} m</span>}
        </div>
        {/* ③ 표준규격 스냅 절점 — snap-lists.mjs 미러, 출처 툴팁 */}
        {snap && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }} title={t.snSrc + snap.source}>{t.snLabel}:</span>
            {snap.values.map((v) => (
              <button
                key={v} type="button" onClick={() => editParam(name, clampV(v))} title={t.snSrc + snap.source}
                style={{ ...stepBtn, width: 'auto', height: 18, padding: '0 6px', fontSize: 9.5, ...(cur === v ? { background: 'var(--nx-accent, #2563eb)', color: '#fff', border: '1px solid var(--nx-accent, #2563eb)' } : {}) }}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        {/* ①② 안전범위 밴드 + 목표 탐색 (결정론 스윕 — AI 아님) */}
        {SWEEP_DOMAINS.includes(domain) && spec && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void runSweep(name)} disabled={swBusyP !== null} style={{ ...stepBtn, width: 'auto', height: 22, padding: '0 8px', fontSize: 10 }}>
              {swBusyP === name ? t.swBusy : `📊 ${t.swBtn}`}
            </button>
            <select value={goalDir} onChange={(e) => setGoalDir(e.target.value as 'minPass' | 'maxPass')} style={{ ...selStyle, width: 'auto', padding: '2px 4px', fontSize: 10 }}>
              <option value="minPass">{t.glMin}</option>
              <option value="maxPass">{t.glMax}</option>
            </select>
            <button type="button" onClick={() => void runGoal(name)} disabled={goalBusyP !== null} style={{ ...stepBtn, width: 'auto', height: 22, padding: '0 8px', fontSize: 10 }}>
              {goalBusyP === name ? t.swBusy : `🎯 ${t.glBtn}`}
            </button>
          </div>
        )}
        {swErr?.param === name && <div style={{ marginTop: 3, fontSize: 10, color: '#991b1b' }}>{t.swFail}{swErr.msg}</div>}
        {showBand && (
          <div style={{ marginTop: 4 }}>
            <div style={{ position: 'relative', paddingTop: 10 }}>
              {markerPct !== null && (
                <div style={{ position: 'absolute', top: -2, left: `calc(${markerPct}% - 5px)`, fontSize: 9 }}>▼</div>
              )}
              <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--nx-border, #dfe3e8)' }}>
                {swRes.band.map((bp, bi) => (
                  <button
                    key={bi} type="button" onClick={() => editParam(name, clampV(bp.value))}
                    title={`${bp.value}${spec?.unit ?? 'mm'} · ${bp.pass ? 'PASS' : bp.fails?.length ? 'FAIL: ' + bp.fails[0] : 'INPUT'}${bp.metric && typeof bp.metric.value === 'number' ? ` · ${bp.metric.label ?? ''} ${bp.metric.value}${bp.metric.unit ?? ''}` : ''}`}
                    style={{ flex: 1, border: 'none', cursor: 'pointer', padding: 0, background: bp.pass ? '#16a34a' : bp.fails?.length ? '#dc2626' : '#9ca3af' }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--nx-text-3, #6b7684)' }}>
                <span>{spec?.unit === 'mm' ? fmtLen(bandMin) : bandMin}</span><span>{spec?.unit === 'mm' ? fmtLen(bandMax) : bandMax}</span>
              </div>
            </div>
            {swRes.note && <div style={{ marginTop: 2, fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }}>{swRes.note}</div>}
          </div>
        )}
        {goalRes?.param === name && (
          goalRes.result === 'found' && typeof goalRes.value === 'number' ? (
            <div style={{ marginTop: 3, fontSize: 10.5 }}>
              🎯 {t.glFound}<b>{spec?.unit === 'mm' ? fmtLen(goalRes.value) : `${goalRes.value}${spec?.unit || ''}`}</b>
              <button
                type="button" onClick={() => editParam(name, clampV(goalRes.value as number))}
                style={{ ...stepBtn, width: 'auto', height: 20, padding: '0 8px', fontSize: 10, marginLeft: 5, background: 'var(--nx-accent, #2563eb)', color: '#fff', border: '1px solid var(--nx-accent, #2563eb)' }}
              >
                {t.nlSend}
              </button>
              {goalRes.note && <div style={{ marginTop: 2, fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }}>{goalRes.note}</div>}
            </div>
          ) : (
            <div style={{ marginTop: 3, fontSize: 10, color: '#b45309' }}>{goalRes.note ?? goalRes.result}</div>
          )
        )}
      </div>
    );
  };
  const isTplParam = (name?: string): name is string => !!name && Object.prototype.hasOwnProperty.call(params, name);
  const pickedPart = pick && (pick.kind === 'face' || pick.kind === 'edge')
    ? (built?.assembly?.parts?.find((p) => p.id === pick.partId) ?? null)
    : null;
  // Round5 ③ 단위 토글 — 표시 전용(mm↔m, 입력은 mm 고정)
  const fmtLen = (v: number | undefined | null): string =>
    typeof v === 'number' && Number.isFinite(v) ? (unitM ? `${(v / 1000).toFixed(3)} m` : `${v}mm`) : '—';

  const roParam = pick?.kind === 'face' ? pick.mapResult.param : pick?.kind === 'edge' ? (edgeSel ?? undefined) : undefined;
  const roValRaw = roParam ? pickedPart?.params?.[roParam] : undefined;
  const roVal = typeof roValRaw === 'number' ? fmtLen(roValRaw) : '—';
  const anyBusy = busy || chainBusy || lsBusy || intBusy || cvBusy || brBusy;

  // Round5 ④ 단축키 최신 핸들러 유지 (window keydown 효과가 ref로 호출)
  hkRef.current = {
    undo: () => restoreHist(hist.idx - 1),
    redo: () => restoreHist(hist.idx + 1),
    mode: (m: PickMode) => { if (built?.assembly) { setPickMode(m); setPick(null); setEdgeSel(null); } },
    esc: () => { setPick(null); setEdgeSel(null); },
  };

  // Round5 ①② 공유 링크 + 브라우저 저장/불러오기
  const snapshotState = (): SavedState => ({
    v: 2, domain, templateId: tid, params, furn, chainP, lsP, inP, cvP,
    // 통합: 마지막 체인 판정 요약 + 전수 루프 요약 + 편집 타임라인(undo 이력 영구화 — 라벨·시각만, 파라미터는 diff로 재현 가능 명시)
    chainSummary: chain?.ok ? {
      beams: (chain.beams ?? []).map((b) => ({ id: b.id, v: b.verdict, Mu: b.Mu_kNm })),
      columns: (chain.columns ?? []).map((c) => ({ id: c.id, v: c.verdict, Pu: c.Pu_kN })),
    } : null,
    loopSummary: loop?.ok ? (loop.summary as Record<string, unknown>) : null,
    timeline: hist.entries.map((e) => ({ at: e.at ?? Date.now(), label: e.label ?? '' })).slice(-100),
  });
  const shareLink = async () => {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(snapshotState()));
      let bin = '';
      bytes.forEach((b) => { bin += String.fromCharCode(b); });
      const enc = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (enc.length > 6144) { setMsg(t.shTooBig); return; } // 정직 한계 — URL 길이
      const url = `${window.location.origin}${window.location.pathname}?d=${enc}`;
      try {
        await navigator.clipboard.writeText(url);
        setMsg(t.shCopied);
      } catch {
        window.prompt(t.shPrompt, url); // 클립보드 불가 브라우저 폴백
      }
    } catch {
      setMsg(t.shTooBig);
    }
  };
  // Round6 ② 통합 리포트 — 도메인 체인 리포트(format:'html')들을 한 문서로 합쳐 인쇄 창 오픈.
  // 성공한 리포트만 포함(정직) — 실패/미실행은 문서 하단에 누락 목록으로 명시.
  const reportSources = (): Array<{ name: string; url: string; body: Record<string, unknown> }> => {
    if (!built?.assembly) return [];
    if (domain === 'building') return [{ name: t.bdTitle, url: '/api/nexyfab/drawing/load-path/', body: chainBody() }];
    if (domain === 'landscape') return [{ name: t.lsTitle, url: '/api/nexyfab/drawing/landscape-check/', body: lsBody() }];
    if (domain === 'interior') return [{ name: t.inTitle, url: '/api/nexyfab/drawing/interior-check/', body: intBody() }];
    if (domain === 'civil') return [{ name: t.cvTitle, url: '/api/nexyfab/drawing/verify-domain/', body: civilBody() }];
    if (domain === 'bridge') return [{ name: t.brTitle, url: '/api/nexyfab/drawing/bridge-check/', body: brBody() }];
    return [];
  };
  const unifiedReport = async () => {
    if (!built?.assembly || uniBusy) return;
    setUniBusy(true);
    try {
      const srcs = reportSources();
      const sheets: string[] = [];
      const missing: string[] = [];
      let style = '';
      for (const src of srcs) {
        try {
          const r = await fetch(src.url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...src.body, format: 'html' }),
          });
          const j = (await r.json().catch(() => ({}))) as { html?: string };
          if (!j.html) { missing.push(src.name); continue; }
          if (!style) style = j.html.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? '';
          // 리포트 쉘의 시트 블록 추출 — 실패 시 body 폴백(인쇄바 제거)
          const sheet = j.html.match(/<div class="sheet">[\s\S]*<\/div>(?=\s*<\/body>)/)?.[0]
            ?? j.html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1]?.replace(/<div class="nf-print-bar">[\s\S]*?<\/div>/, '')
            ?? null;
          if (sheet) sheets.push(sheet);
          else missing.push(src.name);
        } catch {
          missing.push(src.name);
        }
      }
      if (!sheets.length) { setMsg(t.uniNone); return; }
      const title = `${built.assembly.name ?? domain} — ${t.uniBtn}`;
      const doc = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>${style}</head><body>`
        + `<div class="nf-print-bar"><b>${title}</b><button onclick="print()">🖨 ${t.uniPrint}</button></div>`
        + sheets.map((sh, i) => `<div style="${i < sheets.length - 1 ? 'page-break-after:always' : ''}">${sh}</div>`).join('')
        + (missing.length ? `<div style="max-width:900px;margin:10px auto 20px;padding:8px 14px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:12px;color:#92400e">${t.uniMissing}${missing.join(', ')}</div>` : '')
        + '</body></html>';
      const w = window.open('about:blank', '_blank');
      if (w) {
        w.document.write(doc);
        w.document.close();
      } else {
        // 팝업 차단 폴백 — 파일 다운로드
        const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
        const a = document.createElement('a'); a.href = url; a.download = 'unified_report.html'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      }
    } finally {
      setUniBusy(false);
    }
  };

  const persistProjects = (list: SavedState[]) => {
    setProjects(list);
    try { window.localStorage.setItem(PROJ_KEY, JSON.stringify(list)); } catch { setMsg(t.pjSaveFail); }
  };
  const saveProject = () => {
    const name = saveName.trim();
    if (!name || !tid) return;
    const entry: SavedState = { ...snapshotState(), name, at: Date.now() };
    persistProjects([entry, ...projects.filter((p) => !(p.name === name && p.domain === domain))].slice(0, 20));
    setSaveName('');
  };
  const doRestore = (d: SavedState) => {
    if (d.templateId === tid) applyRestore(d, d.name ? t.pjRestored + d.name : t.shRestored);
    else { restoreRef.current = d; setTid(d.templateId); }
  };
  const domProjects = projects.filter((p) => p.domain === domain);

  // Round7 — 서버 저장: 401=비로그인 정직 안내(로컬 저장 차단 안 함), 목록은 현재 도메인만
  const svCall = async (input: string, init?: RequestInit): Promise<Response | null> => {
    const r = await fetch(input, init);
    if (r.status === 401) { setSvAuth(false); setSvList([]); return null; }
    setSvAuth(true);
    return r;
  };
  const fetchServerList = async () => {
    setSvBusyF(true); setSvMsg(null);
    try {
      const r = await svCall('/api/nexyfab/drawing/projects/');
      if (!r) return;
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; projects?: Array<{ id: string; name: string; domain: string; updated_at?: string }>; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? 'list failed');
      setSvList((j.projects ?? []).filter((p) => p.domain === domain));
    } catch (e) {
      setSvMsg({ ok: false, text: t.svFailPrefix + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setSvBusyF(false);
    }
  };
  const toggleServer = () => {
    const next = !svOpen;
    setSvOpen(next);
    if (next) void fetchServerList();
  };
  const saveServer = async () => {
    const name = saveName.trim();
    if (!name) { setSvMsg({ ok: false, text: t.svNeedName }); return; }
    setSvBusyF(true); setSvMsg(null);
    try {
      const r = await svCall('/api/nexyfab/drawing/projects/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, domain, snapshot: snapshotState() }), // 동명 upsert(서버)
      });
      if (!r) return;
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? 'save failed');
      setSvMsg({ ok: true, text: t.svSaved + name });
      await fetchServerList();
    } catch (e) {
      setSvMsg({ ok: false, text: t.svFailPrefix + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setSvBusyF(false);
    }
  };
  const loadServer = async () => {
    if (!svSel) return;
    setSvBusyF(true); setSvMsg(null);
    try {
      const r = await svCall('/api/nexyfab/drawing/projects/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loadId: svSel }),
      });
      if (!r) return;
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; snapshot?: SavedState; error?: string };
      if (!r.ok || !j.ok || !j.snapshot?.templateId || !j.snapshot.params) throw new Error(j.error ?? 'load failed');
      doRestore({ ...j.snapshot, name: svList.find((p) => p.id === svSel)?.name ?? j.snapshot.name });
    } catch (e) {
      setSvMsg({ ok: false, text: t.svFailPrefix + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setSvBusyF(false);
    }
  };
  const deleteServer = async () => {
    if (!svSel) return;
    setSvBusyF(true); setSvMsg(null);
    try {
      const r = await svCall(`/api/nexyfab/drawing/projects/?id=${encodeURIComponent(svSel)}`, { method: 'DELETE' });
      if (!r) return;
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? 'delete failed');
      setSvSel('');
      await fetchServerList();
    } catch (e) {
      setSvMsg({ ok: false, text: t.svFailPrefix + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setSvBusyF(false);
    }
  };
  const selProj = domProjects.find((p) => String(p.at) === pjSelAt) ?? null;

  // Round5 ⑥ A/B 비교 — A=스냅샷(파라미터+가구+요약), B=현재 편집 상태(라이브)
  const toggleAb = () => {
    if (abA) { setAbA(null); setAbAChain(null); return; }
    setAbA({ params: { ...params }, furn: furn ? [...furn] : null, sum: summarize(), at: Date.now() });
    // 검증판 A/B: A 시점의 체인 판정 스냅샷(체인 실행돼 있으면)
    setAbAChain(chain?.ok ? {
      rows: [
        ...(chain.beams ?? []).map((b) => ({ id: String(b.id).split(' ')[0], v: String(b.verdict), key: `Mu ${b.Mu_kNm}` })),
        ...(chain.columns ?? []).map((c) => ({ id: String(c.id).split(' ')[0], v: String(c.verdict), key: `Pu ${c.Pu_kN}` })),
      ],
    } : null);
  };
  const restoreA = () => {
    if (!abA) return;
    setParams({ ...abA.params });
    setFurn(abA.furn);
    pushHist({ ...abA.params }, 'A', abA.furn);
    scheduleRebuild();
  };
  const abB = abA ? summarize() : null;
  const abParamDiffs = abA
    ? Object.keys({ ...abA.params, ...params })
        .filter((k) => abA.params[k] !== params[k])
        .map((k) => `${k}: ${abA.params[k] ?? '—'} → ${params[k] ?? '—'}`)
    : [];
  if (abA && JSON.stringify(abA.furn) !== JSON.stringify(furn)) {
    abParamDiffs.push(`customFurniture: ${abA.furn ? abA.furn.length : 'grid'} → ${furn ? furn.length : 'grid'}`);
  }

  // 거리 픽킹 판정 — DISTANCE_MAP 미러 (role 동일 + 축 매핑 존재 시에만 편집)
  const distInfo = (() => {
    if (pick?.kind !== 'dist') return null;
    const role = pick.roleA;
    if (!role || pick.roleA !== pick.roleB) return { kind: 'none' as const };
    const d = DISTANCE_MAP[domain];
    if (!d || !Object.prototype.hasOwnProperty.call(d, role)) return { kind: 'none' as const };
    const m = d[role];
    if (m === null) return { kind: 'derived' as const };
    const param = m[pick.axis];
    return param ? { kind: 'param' as const, param } : { kind: 'none' as const };
  })();

  // NL 편집의 selectedParam — 현재 픽킹에서 잡힌 파라미터(있으면)
  const selectedParam =
    pick?.kind === 'face' ? (pick.mapResult.ok ? pick.mapResult.param : undefined)
    : pick?.kind === 'edge' ? (edgeSel ?? undefined)
    : pick?.kind === 'dist' ? (distInfo?.kind === 'param' ? distInfo.param : undefined)
    : undefined;

  // 말로 수정 — 서버(정규식→LLM 폴백)는 구조화 편집만 반환, 적용·min/max 클램프는 여기서(결정론)
  const sendNl = async () => {
    const utterance = nlText.trim();
    if (!utterance || !tpl || nlBusy) return;
    setNlBusy(true); setNlMsg(null);
    try {
      const allowedParams = tpl.params.map((p) => ({ name: p.name, current: Number(params[p.name] ?? p.default), min: p.min, max: p.max, unit: p.unit }));
      const res = await fetch('/api/nexyfab/drawing/edit-intent/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utterance, allowedParams, ...(selectedParam ? { selectedParam } : {}) }),
      });
      const j = (await res.json()) as { ok?: boolean; edits?: Array<{ param: string; op: 'set' | 'delta'; value: number }>; source?: string; note?: string; error?: string };
      if (!j.ok || !j.edits?.length) { setNlMsg({ ok: false, error: j.error ?? '—' }); return; }
      const next = { ...params };
      const applied: string[] = [];
      for (const e of j.edits) {
        const spec = tpl.params.find((p) => p.name === e.param);
        if (!spec || !Number.isFinite(e.value)) continue;
        const cur = Number(next[e.param] ?? spec.default);
        const raw = e.op === 'set' ? e.value : cur + e.value;
        next[e.param] = Math.min(spec.max, Math.max(spec.min, raw));
        applied.push(`${e.param} ${e.op === 'set' ? '→' : 'Δ'}${e.value}`);
      }
      if (!applied.length) { setNlMsg({ ok: false, error: j.error ?? '—' }); return; }
      setParams(next);
      pushHist(next, applied.join(' · ')); // ⑤ NL 편집도 이력 스택에
      scheduleRebuild();
      setNlMsg({ ok: true, source: j.source, note: j.note, summary: applied.join(' · ') });
      setNlText('');
    } catch (e) {
      setNlMsg({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setNlBusy(false);
    }
  };

  // 음성 입력 — transcript는 입력창을 채울 뿐, 자동 전송하지 않음(확인 후 적용)
  const startVoice = () => {
    interface SRec {
      lang: string; interimResults: boolean; maxAlternatives: number;
      onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onend: (() => void) | null; onerror: (() => void) | null;
      start: () => void; stop: () => void;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SRec; webkitSpeechRecognition?: new () => SRec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (voiceOn) { try { recRef.current?.stop(); } catch { /* noop */ } setVoiceOn(false); return; }
    const rec = new Ctor();
    rec.lang = VOICE_LANG[toIsoLang(lang)] ?? 'ko-KR';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      const tr = ev.results[0]?.[0]?.transcript;
      if (tr) setNlText((s) => (s ? s + ' ' : '') + tr);
    };
    rec.onend = () => setVoiceOn(false);
    rec.onerror = () => setVoiceOn(false);
    recRef.current = rec;
    setVoiceOn(true);
    rec.start();
  };

  return (
    <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: 'var(--nx-accent-soft, #eef4ff)', border: '1px solid var(--nx-border, #dfe3e8)' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>
          {t.tplTitle}
          <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
            {t.tplSub}
          </span>
        </div>
        {/* 어셈블리 도면→3D — §3 역할 분리: 도면=치수 판독 · 사진=형태 힌트만 */}
        <input ref={aFileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onPickAsmFile} style={{ display: 'none' }} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button type="button" onClick={() => { aModeRef.current = 'drawing'; aFileRef.current?.click(); }} disabled={aDrawBusy}
            title={ko ? '치수 도면 — 치수를 판독합니다' : 'Dimensioned drawing'}
            style={{ padding: '4px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit' }}>
            📐 {ko ? '도면' : 'Drawing'}
          </button>
          <button type="button" onClick={() => { aModeRef.current = 'photo'; aFileRef.current?.click(); }} disabled={aDrawBusy}
            title={ko ? '사진·렌더 — 형태 힌트만, 치수는 읽지 않습니다' : 'Photo — shape hint only'}
            style={{ padding: '4px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit' }}>
            📷 {ko ? '사진' : 'Photo'}
          </button>
        </div>
      </div>

      {/* Round5 ⑤ 템플릿 갤러리 — 카드 그리드(이모지+라벨+파라미터 요약, 지어낸 썸네일 없음) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
        {templates.map((tp) => (
          <button
            // 카드 클릭 = 선택 + 기본값 즉시 빌드(대화-우선 2026-07-16). tpl 이펙트가 기본값을
            // 깔고, 600ms 디바운스(generateRef)가 최신 클로저로 빌드 — 스테일 params 없음.
            key={tp.id} type="button" onClick={() => { setTid(tp.id); scheduleRebuild(); }}
            style={{
              textAlign: 'left', padding: 8, borderRadius: 8, cursor: 'pointer',
              border: tid === tp.id ? '2px solid var(--nx-accent, #2563eb)' : '1px solid var(--nx-border, #dfe3e8)',
              background: tid === tp.id ? 'var(--nx-accent-soft, #eef4ff)' : 'var(--nx-panel, #fff)',
              color: 'inherit',
            }}
          >
            <div style={{ fontSize: 16, lineHeight: 1 }}>{DOMAIN_EMOJI[tp.domain] ?? '📐'}</div>
            <div style={{ fontSize: 11.5, fontWeight: 800, marginTop: 3 }}>{ko ? tp.labelKo : tp.labelEn}</div>
            <div style={{ fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)', marginTop: 2, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {tp.params.slice(0, 4).map((p) => `${p.labelKo} ${p.default}${p.unit}`).join(' · ')}
            </div>
          </button>
        ))}
      </div>

      {aDrawBusy && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--nx-accent, #2563eb)' }}>{ko ? '이미지 판독 중…' : 'Reading image…'}</div>}
      {aDrawErr && <div style={{ marginTop: 6, fontSize: 11, color: '#991b1b' }}>{aDrawErr}</div>}
      {/* 판독 확인 카드 — 승인해야 빌드(허위 형상 방지) */}
      {aDrawRes && (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid var(--nx-accent, #2563eb)', background: 'var(--nx-panel, #fff)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 800 }}>
            📷 {ko ? aDrawRes.labelKo : aDrawRes.labelEn ?? aDrawRes.labelKo}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
              {ko ? '판독 신뢰도' : 'confidence'} {Math.round(aDrawRes.confidence * 100)}%
            </span>
          </div>
          <div style={{ marginTop: 4, fontSize: 10.5, lineHeight: 1.6 }}>
            {aDrawRes.photo
              ? (ko ? '사진 = 형태 힌트만 — 치수는 사용하지 않습니다(정책 §3). 기본값으로 빌드 후 말로 수정하세요.' : 'Photo = shape hint only — dims not read.')
              : Object.entries(aDrawRes.values).map(([k, v]) => `${k}: ${v}`).join(' · ') || (ko ? '판독된 치수 없음' : 'no dimensions read')}
          </div>
          {!!aDrawRes.filled?.length && (
            <div style={{ marginTop: 2, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{ko ? '기본값 사용: ' : 'defaults: '}{aDrawRes.filled.join(', ')}</div>
          )}
          {!!aDrawRes.clamped?.length && (
            <div style={{ marginTop: 2, fontSize: 10, color: '#b45309' }}>{ko ? '범위 보정: ' : 'clamped: '}{aDrawRes.clamped.join(', ')}</div>
          )}
          {aDrawRes.notes && <div style={{ marginTop: 2, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{aDrawRes.notes}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" onClick={confirmAsmDraw} disabled={busy}
              style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: 'none', background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {ko ? '이 값으로 어셈블리 빌드' : 'Build with these'}
            </button>
            <button type="button" onClick={() => setADrawRes(null)}
              style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'transparent', color: 'inherit', fontSize: 12, cursor: 'pointer' }}>
              {ko ? '취소' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* 접이식 — 숫자 직접 입력(전문가용). 카드 클릭=즉시 빌드가 기본, 폼은 보조(2026-07-16) */}
      {tpl && (
        <details style={{ margin: '6px 0 2px' }}>
          <summary style={{ fontSize: 11, fontWeight: 700, cursor: 'pointer', color: 'var(--nx-text-2, #46505e)' }}>
            {ko ? '세부 치수 직접 입력' : 'Edit dimensions directly'}
          </summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, margin: '8px 0' }}>
            {tpl.params.map((p) => (
              <label key={p.name} style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{p.labelKo}{p.unit ? ` (${p.unit})` : ''}</span>
                <input
                  type="number" inputMode="decimal"
                  value={params[p.name] ?? ''}
                  min={p.min} max={p.max}
                  onChange={(e) => setParams((s) => ({ ...s, [p.name]: Number(e.target.value) }))}
                  style={inpStyle}
                />
              </label>
            ))}
          </div>
        </details>
      )}

      {tpl && domain === 'civil' && tid === 'retaining_wall_alignment' && (
        // §C-v2 SVG 선형 에디터 — 클릭=IP 추가·드래그=이동·선택=R/Ls 입력.
        // 산출은 advJson(단일 소스)에 기록 → 기존 생성 경로가 그대로 소비(결정론 게이트 동일).
        <details open style={{ margin: '4px 0 2px' }}>
          <summary style={{ fontSize: 11, fontWeight: 700, cursor: 'pointer', color: 'var(--nx-text-2, #46505e)' }}>
            {ko ? '선형 에디터 (클릭=IP 추가 · 드래그=이동 · 점 선택=R/Ls)' : 'Alignment editor (click=add IP · drag=move · select=R/Ls)'}
          </summary>
          <svg
            viewBox="0 0 640 240"
            style={{ width: '100%', height: 200, background: 'var(--nx-bg-1, #fff)', border: '1px solid var(--nx-line, #d6dbe3)', borderRadius: 8, marginTop: 6, touchAction: 'none', cursor: 'crosshair' }}
            onPointerDown={(e) => {
              const svg = e.currentTarget;
              const r = svg.getBoundingClientRect();
              const px = ((e.clientX - r.left) / r.width) * 640, py = ((e.clientY - r.top) / r.height) * 240;
              const w = edWorld();
              const wx = w.x0 + (px / 640) * w.w, wy = w.y1 - (py / 240) * w.h;
              // 기존 점 히트(월드 반경 = 화면 10px 상당)
              const hitR = (10 / 640) * w.w;
              const hit = edIps.findIndex(([x, y]) => Math.hypot(x - wx, y - wy) < hitR);
              if (hit >= 0) { setEdSel(hit); setEdDrag(hit); }
              else { const next = [...edIps, [Math.round(wx), Math.round(wy)] as [number, number]]; setEdIps(next); setEdSel(next.length - 1); edCommit(next, edCurves); }
            }}
            onPointerMove={(e) => {
              if (edDrag == null) return;
              const svg = e.currentTarget;
              const r = svg.getBoundingClientRect();
              const w = edWorld();
              const wx = w.x0 + (((e.clientX - r.left) / r.width) * 640 / 640) * w.w;
              const wy = w.y1 - (((e.clientY - r.top) / r.height) * 240 / 240) * w.h;
              setEdIps((s) => s.map((p, i) => (i === edDrag ? [Math.round(wx), Math.round(wy)] : p)));
            }}
            onPointerUp={() => { if (edDrag != null) { setEdDrag(null); edCommit(edIps, edCurves); } }}
          >
            {(() => {
              const w = edWorld();
              const X = (v: number) => ((v - w.x0) / w.w) * 640;
              const Y = (v: number) => ((w.y1 - v) / w.h) * 240;
              return (
                <g>
                  <polyline points={edIps.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')} fill="none" stroke="#dc2626" strokeWidth={1.4} strokeDasharray="8 3 2 3" />
                  {edIps.map(([x, y], i) => (
                    <g key={i}>
                      <circle cx={X(x)} cy={Y(y)} r={i === edSel ? 7 : 5} fill={edCurves[i]?.R ? '#2563eb' : '#fff'} stroke={i === edSel ? '#dc2626' : '#0f172a'} strokeWidth={1.4} />
                      <text x={X(x) + 8} y={Y(y) - 8} fontSize={10} fill="#334155">IP{i}{edCurves[i]?.R ? ` R${Math.round(edCurves[i].R / 1000)}m${edCurves[i].Ls ? `+Ls${Math.round((edCurves[i].Ls ?? 0) / 1000)}m` : ''}` : ''}</text>
                    </g>
                  ))}
                  <text x={6} y={232} fontSize={9} fill="#94a3b8">{ko ? `범위 ${Math.round(w.w / 1000)}m × ${Math.round(w.h / 1000)}m (자동 맞춤) · 곡선·게이트는 생성 시 결정론 검증` : `extent ${Math.round(w.w / 1000)}×${Math.round(w.h / 1000)} m (auto-fit)`}</text>
                </g>
              );
            })()}
          </svg>
          {edSel != null && edSel > 0 && edSel < edIps.length - 1 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, fontSize: 11 }}>
              <span>IP{edSel}</span>
              <label>R(mm) <input type="number" value={edCurves[edSel]?.R ?? ''} style={{ ...inpStyle, width: 90 }} onChange={(e) => { const R = Number(e.target.value); const next = { ...edCurves }; if (R > 0) next[edSel] = { ...next[edSel], R }; else delete next[edSel]; setEdCurves(next); edCommit(edIps, next); }} /></label>
              <label>Ls(mm) <input type="number" value={edCurves[edSel]?.Ls ?? ''} style={{ ...inpStyle, width: 80 }} onChange={(e) => { const Ls = Number(e.target.value); const next = { ...edCurves }; if (next[edSel]) { if (Ls > 0) next[edSel] = { ...next[edSel], Ls }; else next[edSel] = { R: next[edSel].R }; setEdCurves(next); edCommit(edIps, next); } }} /></label>
              <button type="button" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--nx-line, #d6dbe3)', background: 'transparent', cursor: 'pointer', color: 'inherit' }}
                onClick={() => { const next = edIps.filter((_, i) => i !== edSel); const nc: Record<number, { R: number; Ls?: number }> = {}; Object.entries(edCurves).forEach(([k, v]) => { const ki = Number(k); if (ki < edSel!) nc[ki] = v; else if (ki > edSel!) nc[ki - 1] = v; }); setEdIps(next); setEdCurves(nc); setEdSel(null); edCommit(next, nc); }}>
                {ko ? 'IP 삭제' : 'delete'}
              </button>
            </div>
          )}
        </details>
      )}

      {tpl && (
        // §C-v1 고급 입력(JSON) — 배열 파라미터(ips·curves·structures·contours·siteBoundary·
        // profileGround·earthwork·pipes·surveyPoints+origin[Wave 2 실측 지반선]) 입력 수단.
        // 스키마 오류=게이트 문구 그대로 표시.
        <details style={{ margin: '4px 0 2px' }}>
          <summary style={{ fontSize: 11, fontWeight: 700, cursor: 'pointer', color: 'var(--nx-text-2, #46505e)' }}>
            {t.advTitle}
          </summary>
          <textarea
            value={advJson}
            onChange={(e) => { setAdvJson(e.target.value); setAdvErr(null); }}
            placeholder={'{ "ips": [[0,0],[120000,0]], "curves": [{"ip":1,"R":30000}], "structures": [{"sta":60000,"type":"culvert"}], "earthwork": {"formationElevM":6,"widthM":3,"slopeN":1.5}, "surveyPoints": [[E,N,EL(m)],...], "origin": {"E":200000,"N":450000} }'}
            spellCheck={false}
            style={{ width: '100%', minHeight: 84, fontFamily: 'ui-monospace, monospace', fontSize: 11, padding: 8, borderRadius: 8, border: '1px solid var(--nx-line, #d6dbe3)', background: 'var(--nx-bg-1, #fff)', color: 'inherit', marginTop: 6 }}
          />
          {advErr && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>⚠ {advErr}</div>}
          <div style={{ fontSize: 10, color: 'var(--nx-text-3, #6b7684)', marginTop: 2 }}>{t.advHint}</div>
        </details>
      )}

      <button type="button" onClick={generate} disabled={busy} style={genStyle}>
        {busy ? t.buildBusy : t.buildBtn}
      </button>

      {/* Round5 ①② 공유·저장·서버 — 접이식(패널 길이 절감, 2026-07-16 UX) */}
      <details style={{ marginTop: 6 }}>
        <summary style={{ fontSize: 11, fontWeight: 700, cursor: 'pointer', color: 'var(--nx-text-2, #46505e)' }}>
          💾 {ko ? '저장 · 공유 · 서버' : 'Save · Share · Server'}
        </summary>
      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => void shareLink()} style={{ ...rptBtn, marginTop: 0 }}>🔗 {t.shBtn}</button>
        <input
          value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={t.pjNamePh}
          onKeyDown={(e) => { if (e.key === 'Enter') saveProject(); }}
          style={{ ...inpStyle, width: 110 }}
        />
        <button type="button" onClick={saveProject} disabled={!saveName.trim()} style={{ ...rptBtn, marginTop: 0 }}>💾 {t.pjSave}</button>
        {domProjects.length > 0 && (
          <>
            <select value={pjSelAt} onChange={(e) => setPjSelAt(e.target.value)} style={{ ...selStyle, width: 'auto', flex: 1, minWidth: 90 }}>
              <option value="">—</option>
              {domProjects.map((p) => (
                <option key={p.at} value={String(p.at)}>{p.name}{p.at ? ` (${new Date(p.at).toLocaleDateString()})` : ''}</option>
              ))}
            </select>
            <button type="button" onClick={() => { if (selProj) doRestore(selProj); }} disabled={!selProj} style={{ ...rptBtn, marginTop: 0 }}>{t.pjLoad}</button>
            <button type="button" onClick={() => { if (selProj) { persistProjects(projects.filter((p) => p !== selProj)); setPjSelAt(''); } }} disabled={!selProj} style={{ ...rptBtn, marginTop: 0, color: '#991b1b' }}>{t.pjDel}</button>
          </>
        )}
      </div>
      <div style={{ marginTop: 3, fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }}>{t.pjNote}</div>

      {/* Round7 — 서버 저장 (계정 연동): 401=비로그인 정직 안내, 로컬 저장은 계속 사용 가능 */}
      <div style={{ marginTop: 4 }}>
        <button type="button" onClick={toggleServer} style={{ ...rptBtn, marginTop: 0, ...(svOpen ? { background: 'var(--nx-accent-soft, #eef4ff)' } : {}) }}>
          ☁ {t.svBtn}
        </button>
        {svOpen && (
          <div style={{ marginTop: 4 }}>
            {svAuth === false && (
              <div style={{ fontSize: 10, color: '#b45309' }}>{t.svLoginNote}</div>
            )}
            {svAuth === true && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" onClick={() => void saveServer()} disabled={svBusyF} style={{ ...rptBtn, marginTop: 0 }}>☁ {t.svSave}</button>
                <select value={svSel} onChange={(e) => setSvSel(e.target.value)} style={{ ...selStyle, width: 'auto', flex: 1, minWidth: 90 }}>
                  <option value="">{svList.length ? '—' : t.svEmpty}</option>
                  {svList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.updated_at ? ` (${String(p.updated_at).slice(0, 10)})` : ''}</option>
                  ))}
                </select>
                <button type="button" onClick={() => void loadServer()} disabled={svBusyF || !svSel} style={{ ...rptBtn, marginTop: 0 }}>{t.pjLoad}</button>
                <button type="button" onClick={() => void deleteServer()} disabled={svBusyF || !svSel} style={{ ...rptBtn, marginTop: 0, color: '#991b1b' }}>{t.pjDel}</button>
              </div>
            )}
            {svBusyF && <div style={{ fontSize: 10, marginTop: 2, color: 'var(--nx-accent, #2563eb)' }}>{t.svBusy}</div>}
            {svMsg && <div style={{ fontSize: 10, marginTop: 2, color: svMsg.ok ? '#16a34a' : '#991b1b' }}>{svMsg.text}</div>}
          </div>
        )}
      </div>
      </details>

      {built && (
        <button type="button" onClick={downloadPackage} disabled={pkgBusy} style={{ ...genStyle, marginTop: 6, background: 'var(--nx-panel, #fff)', color: 'var(--nx-accent, #2563eb)', border: '1px solid var(--nx-accent, #2563eb)' }}>
          {pkgBusy ? t.packaging : t.pkgBtn}
        </button>
      )}
      {built && (
        <button
          type="button"
          onClick={() => downloadHtmlReport('/api/nexyfab/drawing/research/', { assembly: built.assembly, domain }, 'related_research.html')}
          style={{ ...rptBtn, width: '100%' }}
        >
          📚 {t.papersBtn}
        </button>
      )}
      {built && (
        <button type="button" onClick={() => void unifiedReport()} disabled={uniBusy} style={{ ...rptBtn, width: '100%' }}>
          📑 {uniBusy ? t.uniBusy : t.uniBtn}
        </button>
      )}

      {/* 유료 전문 조사 의뢰 — 컨설팅 신청형: 신청 → 운영자 직접 수행(AI 도구 지원) → 견적 회신 */}
      {built && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
          <button type="button" onClick={() => setErOpen((v) => !v)} style={{ ...rptBtn, width: '100%', background: erOpen ? 'var(--nx-accent-soft, #eef4ff)' : 'var(--nx-panel, #fff)' }}>
            🔎 {t.erBtn}
          </button>
          {erOpen && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              <div style={{ color: 'var(--nx-text-3, #6b7684)', marginBottom: 5, lineHeight: 1.5 }}>
                {t.erDesc}
              </div>
              <select value={erP.service} onChange={(e) => setErP((s) => ({ ...s, service: e.target.value }))} style={selStyle}>
                {ER_SERVICES.map(([k, lb, desc]) => <option key={k} value={k}>{lb} — {desc}</option>)}
              </select>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, margin: '6px 0' }}>
                <input placeholder={t.erName} value={erP.name} onChange={(e) => setErP((s) => ({ ...s, name: e.target.value }))} style={inpStyle} />
                <input placeholder={t.erEmail} type="email" value={erP.email} onChange={(e) => setErP((s) => ({ ...s, email: e.target.value }))} style={inpStyle} />
              </div>
              <textarea
                placeholder={t.erMsgPh}
                value={erP.message} onChange={(e) => setErP((s) => ({ ...s, message: e.target.value }))}
                rows={3} style={{ ...inpStyle, resize: 'vertical' }}
              />
              <button type="button" onClick={submitExpertRequest} disabled={erBusy} style={{ ...genStyle, marginTop: 5, background: '#0f172a' }}>
                {erBusy ? t.erSubmitting : t.erSubmit}
              </button>
              {erMsg && <div style={{ marginTop: 5, color: erMsg.startsWith('✅') ? '#16a34a' : '#991b1b' }}>{erMsg}</div>}
              <div style={{ marginTop: 5, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>
                {t.erDisclaimer}
              </div>
            </div>
          )}
        </div>
      )}

      {msg && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--nx-text-2, #46505e)' }}>{msg}</div>}
      {warnings.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#991b1b' }}>
          {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {/* P1+P2 — 3D 픽킹 뷰어: AI가 초안, 사람이 면을 잡아 고친다 (면=파라미터 매핑 · 수정 시 자동 재검증) */}
      {built?.assembly?.parts && built.assembly.parts.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
          <button type="button" onClick={() => setViewerOpen((v) => !v)} style={{ ...rptBtn, width: '100%', marginTop: 0, textAlign: 'left' }}>
            🧊 {t.vwTitle}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>{t.vwSub}</span>
            <span style={{ float: 'right' }}>{viewerOpen ? t.vwHide : t.vwShow}</span>
          </button>
          {viewerOpen && (
            <>
              {/* 픽킹 모드: 면 / 모서리(Alt+클릭도 가능) / 거리 + ⑤ undo/redo·이력 + Round5 단위·단축키·A/B */}
              <div style={{ display: 'flex', gap: 4, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {(['face', 'edge', 'dist'] as const).map((m) => (
                  <button
                    key={m} type="button"
                    onClick={() => { setPickMode(m); setPick(null); setEdgeSel(null); }}
                    style={{ ...stepBtn, width: 'auto', padding: '0 10px', fontSize: 11, ...(pickMode === m ? { background: 'var(--nx-accent, #2563eb)', color: '#fff', border: '1px solid var(--nx-accent, #2563eb)' } : {}) }}
                  >
                    {m === 'face' ? t.pmFace : m === 'edge' ? t.pmEdge : t.pmDist}
                  </button>
                ))}
                <button type="button" title={t.unitTitle} onClick={() => setUnitM((v) => !v)} style={{ ...stepBtn, width: 'auto', padding: '0 8px', fontSize: 10.5, ...(unitM ? { background: 'var(--nx-accent-soft, #eef4ff)' } : {}) }}>
                  {unitM ? 'm' : 'mm'}
                </button>
                <span title={t.hkHelp} style={{ fontSize: 12, cursor: 'help', color: 'var(--nx-text-3, #6b7684)' }}>⌨</span>
                <button type="button" onClick={toggleAb} style={{ ...stepBtn, width: 'auto', padding: '0 8px', fontSize: 10.5, ...(abA ? { background: 'var(--nx-accent, #2563eb)', color: '#fff', border: '1px solid var(--nx-accent, #2563eb)' } : {}) }}>
                  ⚖ {abA ? t.abEnd : t.abBtn}
                </button>
                <div style={{ flex: 1 }} />
                <button type="button" title={t.hsUndo} disabled={hist.idx <= 0} onClick={() => restoreHist(hist.idx - 1)} style={{ ...stepBtn, opacity: hist.idx <= 0 ? 0.4 : 1 }}>↶</button>
                <button type="button" title={t.hsRedo} disabled={hist.idx >= hist.entries.length - 1} onClick={() => restoreHist(hist.idx + 1)} style={{ ...stepBtn, opacity: hist.idx >= hist.entries.length - 1 ? 0.4 : 1 }}>↷</button>
                <button type="button" onClick={() => setHistOpen((v) => !v)} style={{ ...stepBtn, width: 'auto', padding: '0 8px', fontSize: 10.5, ...(histOpen ? { background: 'var(--nx-accent-soft, #eef4ff)' } : {}) }}>
                  {t.hsList}{hist.entries.length > 1 ? ` ${hist.entries.length - 1}` : ''}
                </button>
              </div>
              {histOpen && hist.entries.length > 0 && (
                <div style={{ marginTop: 4, maxHeight: 120, overflowY: 'auto', border: '1px solid var(--nx-border, #dfe3e8)', borderRadius: 6 }}>
                  {hist.entries.map((e, i) => (
                    <button
                      key={i} type="button" onClick={() => restoreHist(i)}
                      style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', padding: '3px 8px', border: 'none', borderBottom: '1px solid var(--nx-border, #eef1f4)', background: i === hist.idx ? 'var(--nx-accent-soft, #eef4ff)' : 'transparent', cursor: 'pointer', fontSize: 10.5, color: 'inherit', textAlign: 'left' }}
                    >
                      <span>{i}. {e.label}</span>
                      {e.verdict && <b style={{ color: e.verdict === 'PASS' ? '#16a34a' : e.verdict === 'FAIL' ? '#dc2626' : '#6b7684' }}>{e.verdict}</b>}
                    </button>
                  ))}
                </div>
              )}
              <AssemblyViewer3D parts={built.assembly.parts} onPick={handlePick} mode={pickMode} unit={unitM ? 'm' : 'mm'} height={260} />
              {(!pick || pick.kind === 'dist-pending') && (
                <div style={{ marginTop: 5, fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)' }}>
                  {pick?.kind === 'dist-pending' ? t.dsPickB : pickMode === 'dist' ? t.dsHint : t.fpHint}
                </div>
              )}
              {pick && pick.kind !== 'dist-pending' && (
                <div style={{ marginTop: 6, padding: 8, borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', fontSize: 11 }}>
                  {pick.kind === 'face' && (
                    <>
                      <div style={{ fontWeight: 800 }}>
                        {pick.partId} <span style={{ fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>({pick.type}) · {t.fpFace} {pick.face}</span>
                      </div>
                      {pick.mapResult.ok && pick.mapResult.param && (
                        isTplParam(pick.mapResult.param) ? (
                          renderParamEditor(pick.mapResult.param)
                        ) : (
                          <div style={{ marginTop: 4 }}>
                            {t.fpParam} <code>{pick.mapResult.param}</code> = {roVal}
                            <div style={{ marginTop: 2, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{t.fpReadOnly}</div>
                          </div>
                        )
                      )}
                      {pick.mapResult.reason === 'section' && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)' }}>{t.fpSection}</div>
                          {pick.mapResult.note && <div style={{ marginTop: 2, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{pick.mapResult.note}</div>}
                          {(pick.mapResult.sectionParams ?? []).filter((sp) => isTplParam(sp)).map((sp) => renderParamEditor(sp))}
                        </div>
                      )}
                      {pick.mapResult.ok === false && pick.mapResult.reason && pick.mapResult.reason !== 'section' && (
                        <div style={{ marginTop: 4, fontSize: 10.5, color: '#b45309' }}>{t.fpUnmapped}</div>
                      )}
                      {!pick.mapResult.ok && !pick.mapResult.reason && pick.mapResult.error && (
                        <div style={{ marginTop: 4, fontSize: 10.5, color: '#991b1b' }}>{t.fpMapFail}{pick.mapResult.error}</div>
                      )}
                    </>
                  )}
                  {pick.kind === 'edge' && (
                    <>
                      <div style={{ fontWeight: 800 }}>
                        {pick.partId} <span style={{ fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>({pick.type}) · {t.pmEdge} {pick.faces[0]}×{pick.faces[1]}</span>
                      </div>
                      {pick.candidates.length > 0 && (
                        <>
                          <div style={{ marginTop: 3, fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)' }}>{t.edHint}</div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                            {pick.candidates.map((c) => (
                              <button
                                key={c.param} type="button" onClick={() => setEdgeSel(c.param)}
                                style={{ ...stepBtn, width: 'auto', height: 22, padding: '0 8px', fontSize: 10.5, ...(edgeSel === c.param ? { background: 'var(--nx-accent, #2563eb)', color: '#fff', border: '1px solid var(--nx-accent, #2563eb)' } : {}) }}
                              >
                                {c.param} ({c.face})
                              </button>
                            ))}
                          </div>
                          {edgeSel && (isTplParam(edgeSel) ? renderParamEditor(edgeSel) : (
                            <div style={{ marginTop: 4 }}>
                              {t.fpParam} <code>{edgeSel}</code> = {roVal}
                              <div style={{ marginTop: 2, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{t.fpReadOnly}</div>
                            </div>
                          ))}
                        </>
                      )}
                      {pick.candidates.length === 0 && pick.sectionParams && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)' }}>{t.fpSection}</div>
                          {pick.note && <div style={{ marginTop: 2, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{pick.note}</div>}
                          {pick.sectionParams.filter((sp) => isTplParam(sp)).map((sp) => renderParamEditor(sp))}
                        </div>
                      )}
                      {pick.candidates.length === 0 && !pick.sectionParams && (
                        <div style={{ marginTop: 4, fontSize: 10.5, color: '#b45309' }}>{t.fpUnmapped}</div>
                      )}
                    </>
                  )}
                  {pick.kind === 'dist' && (
                    <>
                      <div style={{ fontWeight: 800 }}>
                        {pick.aId} ↔ {pick.bId} <span style={{ fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>· {pick.axis.toUpperCase()} · {t.dsGap} {fmtLen(pick.distanceMm)}</span>
                      </div>
                      {distInfo?.kind === 'param' && (
                        isTplParam(distInfo.param) ? renderParamEditor(distInfo.param) : (
                          <div style={{ marginTop: 4 }}>
                            {t.fpParam} <code>{distInfo.param}</code>
                            <div style={{ marginTop: 2, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{t.fpReadOnly}</div>
                          </div>
                        )
                      )}
                      {distInfo?.kind === 'derived' && <div style={{ marginTop: 4, fontSize: 10.5, color: '#b45309' }}>{t.dsDerived}</div>}
                      {distInfo?.kind === 'none' && <div style={{ marginTop: 4, fontSize: 10.5, color: '#b45309' }}>{t.dsNone}</div>}
                    </>
                  )}
                  {anyBusy && <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--nx-accent, #2563eb)' }}>{t.fpReverify}</div>}
                </div>
              )}
              {/* ④ 수정 전후 diff 카드 — 재검증 완료 시 판정 변화 + 대표 지표 델타(최대 3) */}
              {diffCard && (
                <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 7, fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 6, border: '1px solid ' + (diffCard.to === 'FAIL' ? '#fecaca' : 'var(--nx-border, #dfe3e8)'), background: diffCard.to === 'FAIL' ? '#fef2f2' : 'var(--nx-panel, #fff)' }}>
                  <span style={{ fontWeight: 800 }}>{t.dfTitle}</span>
                  <b style={{ color: diffCard.to === 'FAIL' ? '#dc2626' : diffCard.to === 'PASS' ? '#16a34a' : '#6b7684' }}>
                    {diffCard.from}→{diffCard.to}
                  </b>
                  <span style={{ flex: 1, color: 'var(--nx-text-2, #46505e)' }}>{diffCard.deltas.join(' · ')}</span>
                  <button type="button" onClick={() => setDiffCard(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--nx-text-3, #6b7684)', padding: 0 }}>×</button>
                </div>
              )}
              {/* Round5 ⑥ A/B 비교 — A=스냅샷, B=현재(라이브). 지표=summarize() 재사용 */}
              {abA && (
                <div style={{ marginTop: 6, padding: 8, borderRadius: 7, fontSize: 10.5, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <b>⚖ {t.abTitle}</b>
                    <div style={{ flex: 1 }} />
                    <button type="button" onClick={restoreA} style={{ ...stepBtn, width: 'auto', height: 20, padding: '0 8px', fontSize: 10 }}>{t.abRestoreA}</button>
                    <button type="button" onClick={() => setAbA(null)} style={{ ...stepBtn, width: 'auto', height: 20, padding: '0 8px', fontSize: 10 }}>{t.abEnd}</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '2px 10px' }}>
                    <span />
                    <b>A</b>
                    <b>B</b>
                    <span />
                    <b style={{ color: abA.sum?.verdict === 'PASS' ? '#16a34a' : abA.sum?.verdict === 'FAIL' ? '#dc2626' : '#6b7684' }}>{abA.sum?.verdict ?? '—'}</b>
                    <b style={{ color: abB?.verdict === 'PASS' ? '#16a34a' : abB?.verdict === 'FAIL' ? '#dc2626' : '#6b7684' }}>{abB?.verdict ?? '—'}</b>
                    {[...new Set([...Object.keys(abA.sum?.nums ?? {}), ...Object.keys(abB?.nums ?? {})])].map((k) => (
                      <span key={k} style={{ display: 'contents' }}>
                        <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{k}</span>
                        <span>{abA.sum?.nums[k] ? `${abA.sum.nums[k].v}${abA.sum.nums[k].unit ?? ''}` : '—'}</span>
                        <span>{abB?.nums[k] ? `${abB.nums[k].v}${abB.nums[k].unit ?? ''}` : '—'}</span>
                      </span>
                    ))}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }}>
                    {t.abParamDiff}: {abParamDiffs.length ? abParamDiffs.join(' · ') : t.abNoDiff}
                  </div>
                  {/* 검증 A/B — A 시점 체인 판정 vs 현재 체인 판정 (둘 다 실행돼 있을 때) */}
                  {abAChain && chain?.ok && (
                    <div style={{ marginTop: 4, fontSize: 10.5 }}>
                      <b>{ko ? '검증 비교(A→B)' : 'Verification diff (A→B)'}:</b>{' '}
                      {[...(chain.beams ?? []).map((b) => ({ id: String(b.id).split(' ')[0], v: String(b.verdict), key: `Mu ${b.Mu_kNm}` })),
                        ...(chain.columns ?? []).map((c) => ({ id: String(c.id).split(' ')[0], v: String(c.verdict), key: `Pu ${c.Pu_kN}` }))]
                        .map((cur, i) => {
                          const prev = abAChain.rows.find((r) => r.id === cur.id) ?? abAChain.rows[i];
                          if (!prev) return null;
                          const changed = prev.v !== cur.v || prev.key !== cur.key;
                          return (
                            <span key={i} style={{ display: 'inline-block', margin: '0 6px 2px 0', padding: '0 6px', borderRadius: 4, background: changed ? (cur.v === 'PASS' && prev.v !== 'PASS' ? '#dcfce7' : cur.v === 'FAIL' ? '#fee2e2' : '#fef9c3') : 'var(--nx-hover, #eef1f4)' }}>
                              {cur.id}: {prev.key}·{prev.v} → {cur.key}·{cur.v}
                            </span>
                          );
                        })}
                      <span style={{ color: 'var(--nx-text-3, #6b7684)' }}>{ko ? '(A 스냅샷 시점 체인 기준 — B는 체인 재실행 후 비교)' : '(A snapshot chain vs current — rerun chain for B)'}</span>
                    </div>
                  )}
                </div>
              )}
              {/* 말로 수정(NL) — 서버=문장→구조화 편집 변환만, 적용·클램프·재검증=클라 결정론 */}
              <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                <input
                  value={nlText} onChange={(e) => setNlText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void sendNl(); }}
                  placeholder={t.nlPh}
                  style={{ ...inpStyle, flex: 1, width: 'auto' }}
                />
                {voiceAvail && (
                  <button
                    type="button" title={t.vcTitle} onClick={startVoice}
                    style={{ ...stepBtn, width: 30, ...(voiceOn ? { background: '#fee2e2', border: '1px solid #dc2626' } : {}) }}
                  >
                    🎤
                  </button>
                )}
                <button
                  type="button" onClick={() => void sendNl()} disabled={nlBusy || !nlText.trim()}
                  style={{ ...stepBtn, width: 'auto', padding: '0 10px', fontSize: 11, background: 'var(--nx-accent, #2563eb)', color: '#fff', border: '1px solid var(--nx-accent, #2563eb)' }}
                >
                  {nlBusy ? t.nlBusy : t.nlSend}
                </button>
              </div>
              {nlMsg && (nlMsg.ok ? (
                <div style={{ marginTop: 4, fontSize: 10.5 }}>
                  <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9.5, fontWeight: 800, background: 'var(--nx-accent-soft, #eef4ff)', color: 'var(--nx-accent, #2563eb)', border: '1px solid var(--nx-border, #dfe3e8)' }}>
                    {nlMsg.source === 'llm' ? t.nlSrcAi : t.nlSrcRegex}
                  </span>{' '}
                  {t.nlApplied}{nlMsg.summary}
                  {nlMsg.note && <div style={{ marginTop: 2, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{nlMsg.note}</div>}
                </div>
              ) : (
                <div style={{ marginTop: 4, fontSize: 10.5, color: '#991b1b' }}>{t.nlFail}{nlMsg.error}</div>
              ))}
            </>
          )}
        </div>
      )}

      {/* 토목 체인 (civil): 옹벽 안정 — 단면=형상 자동 파생(C1), 토질만 입력 */}
      {domain === 'civil' && built && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
            {t.cvTitle}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
              {t.cvSub}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 6 }}>
            {([['gammaBackfill', t.cvGamma], ['phiBackfill', t.cvPhi], ['baseFriction', t.cvMu], ['allowableBearing', t.cvQa], ['surcharge', t.cvSurcharge], ['seismicKh', t.cvKh]] as Array<[string, string]>).map(([k, lb]) => (
              <label key={k} style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{lb}</span>
                <input type="number" step="0.1" value={cvP[k]} onChange={(e) => setCvP((s) => ({ ...s, [k]: Number(e.target.value) }))} style={inpStyle} />
              </label>
            ))}
          </div>
          <button type="button" onClick={runCivil} disabled={cvBusy} style={{ ...genStyle, background: '#b45309' }}>
            {cvBusy ? t.checking : t.cvRun}
          </button>
          {cv && !cv.ok && <div style={{ marginTop: 5, fontSize: 11, color: '#991b1b' }}>{cv.error}</div>}
          {cv?.ok && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              {Object.entries(cv.checks ?? {}).map(([k, c]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                  <span>{k}{typeof c.FS === 'number' ? ` FS ${c.FS.toFixed(2)}` : ''}</span>
                  <b style={{ color: c.pass ? '#16a34a' : '#dc2626' }}>{c.pass ? 'PASS' : 'FAIL'}</b>
                </div>
              ))}
              {cv.seismic && !cv.seismic.error && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                  <span>{t.cvSeismicMO} kh={cv.seismic.kh}{cv.seismic.checks ? ` · ${Object.entries(cv.seismic.checks).map(([k2, c2]) => `${k2} ${c2.FS?.toFixed(2)}`).join(' · ')}` : ''}</span>
                  <b style={{ color: cv.seismic.verdict === 'PASS' ? '#16a34a' : '#dc2626' }}>{cv.seismic.verdict}</b>
                </div>
              )}
              {cv.seismic?.error && <div style={{ color: '#991b1b', padding: '2px 0' }}>{cv.seismic.error}</div>}
              <button type="button" onClick={() => downloadHtmlReport('/api/nexyfab/drawing/verify-domain/', civilBody(), 'retaining_wall_check.html')} style={rptBtn}>
                📄 {t.reportHtml}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 인테리어 체인 (interior · Wave A I2+I3): 보행거리 BFS + 피난폭 + 마감 물량 */}
      {domain === 'interior' && built && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
            {t.inTitle}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
              {t.inSub}
            </span>
          </div>
          {/* Round4 — 2D 탑뷰 배치 에디터: customFurniture ↔ 같은 빌드/재검증 파이프 */}
          <InteriorPlanEditor
            lang={lang}
            width={Number(params.width) || 8000}
            depth={Number(params.depth) || 6000}
            doorWidth={Number(params.doorWidth) || 1000}
            exitCount={Number(params.exitCount) || 1}
            rows={Number(params.tableRows) || 2}
            cols={Number(params.tableCols) || 3}
            furniture={furn}
            onChange={onFurnChange}
            result={intR}
            unit={unitM ? 'm' : 'mm'}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 6 }}>
            {([['targetLux', t.inLuxLabel, t.inLuxPh], ['lampLumen', t.inLumenLabel, ''], ['ventPerPersonCMH', t.inVentLabel, ''], ['loadDensityVAm2', t.inLoadLabel, ''], ['sprinklerRadiusM', t.inSprkLabel, t.inSprkPh]] as Array<[string, string, string]>).map(([k, lb, ph]) => (
              <label key={k} style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{lb}</span>
                <input type="number" step="0.1" placeholder={ph || undefined} value={inP[k] || ''} onChange={(e) => setInP((s) => ({ ...s, [k]: Number(e.target.value) }))} style={inpStyle} />
              </label>
            ))}
          </div>
          <button type="button" onClick={runInterior} disabled={intBusy} style={{ ...genStyle, background: '#7c3aed' }}>
            {intBusy ? t.checking : t.inRun}
          </button>
          {intR && !intR.ok && <div style={{ marginTop: 5, fontSize: 11, color: '#991b1b' }}>{intR.error}</div>}
          {intR?.ok && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                <span>{t.inTravel} {intR.travel?.maxTravelM}m / {intR.travel?.limitM}m{intR.travel && intR.travel.unreachableM2 > 0 ? ` · ⚠${t.inUnreachable} ${intR.travel.unreachableM2}m²` : ''}</span>
                <b style={{ color: intR.travel?.pass ? '#16a34a' : '#dc2626' }}>{intR.travel?.pass ? 'PASS' : 'FAIL'}</b>
              </div>
              {intR.egress && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                  <span>{t.inEgress} <span style={{ color: 'var(--nx-text-3, #6b7684)' }}>{t.inDoors} {intR.egress.derived?.doorWidthSumMm}mm · {t.inSeats} {intR.egress.derived?.seatCount}</span></span>
                  <b style={{ color: intR.egress.verdict === 'PASS' ? '#16a34a' : '#dc2626' }}>{intR.egress.verdict}</b>
                </div>
              )}
              {intR.finishes && (
                <div style={{ padding: '2px 0', color: 'var(--nx-text-2, #46505e)' }}>
                  {t.inFinish}: {t.inFloor} {intR.finishes.floorM2} · {t.inWall} {intR.finishes.wallM2} · {t.inCeiling} {intR.finishes.ceilingM2} m²
                </div>
              )}
              {intR.lighting?.verdict === 'INFO' && (
                <div style={{ padding: '2px 0', color: 'var(--nx-text-2, #46505e)' }}>
                  {t.inLight}: {intR.lighting.fixtures}{t.inFixSuffix} ({intR.lighting.layout}) · {t.inAvgLux} {intR.lighting.avgLuxProvided} lx
                </div>
              )}
              {intR.ventilation?.verdict === 'INFO' && (
                <div style={{ padding: '2px 0', color: 'var(--nx-text-2, #46505e)' }}>
                  {t.inVent}: {intR.ventilation.requiredCMH} CMH (ACH {intR.ventilation.ACH})
                </div>
              )}
              {intR.electrical?.verdict === 'INFO' && (
                <div style={{ padding: '2px 0', color: 'var(--nx-text-2, #46505e)' }}>
                  {t.inElec}: {intR.electrical.totalVA} VA → {intR.electrical.circuits}{t.inCircuitSuffix}
                </div>
              )}
              <button type="button" onClick={() => downloadHtmlReport('/api/nexyfab/drawing/interior-check/', intBody(), 'egress_finish_check.html')} style={rptBtn}>
                📄 {t.reportHtml}
              </button>
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{intR.disclaimer}</div>
            </div>
          )}
        </div>
      )}

      {/* 조경 체인 (landscape · Wave A L1+L2): 목재 부재 검토 + 풍하중 전도 */}
      {domain === 'landscape' && built && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
            {t.lsTitle}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
              {t.lsSub}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 6 }}>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{t.lsSpecies}</span>
              <select value={String(lsP.species)} onChange={(e) => setLsP((s) => ({ ...s, species: e.target.value }))} style={selStyle}>
                <option value="larch">{t.lsLarch}</option>
                <option value="pine">{t.lsPine}</option>
                <option value="koreanpine">{t.lsKoreanPine}</option>
                <option value="cedar">{t.lsCedar}</option>
              </select>
            </label>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{t.lsGrade}</span>
              <select value={String(lsP.grade)} onChange={(e) => setLsP((s) => ({ ...s, grade: Number(e.target.value) }))} style={selStyle}>
                {[1, 2, 3].map((g) => <option key={g} value={g}>{g}{t.gradeSuffix}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{t.lsUsage}</span>
              <select value={String(lsP.usage)} onChange={(e) => setLsP((s) => ({ ...s, usage: e.target.value }))} style={selStyle}>
                <option value="residence_living">{t.lsUseRes}</option>
                <option value="roof_garden">{t.lsUseGarden}</option>
                <option value="assembly_moving">{t.lsUseAssembly}</option>
              </select>
            </label>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{t.lsWind}</span>
              <input type="number" step="0.1" value={lsP.windPressure as number} onChange={(e) => setLsP((s) => ({ ...s, windPressure: Number(e.target.value) }))} style={inpStyle} />
            </label>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{t.lsConn}</span>
              <select value={String(lsP.connType)} onChange={(e) => setLsP((s) => ({ ...s, connType: e.target.value }))} style={selStyle}>
                <option value="none">{t.lsConnNone}</option>
                <option value="nail">{t.lsConnNailOpt}</option>
                <option value="bolt">{t.lsConnBoltOpt}</option>
              </select>
            </label>
          </div>
          <button type="button" onClick={runLandscape} disabled={lsBusy} style={{ ...genStyle, background: '#15803d' }}>
            {lsBusy ? t.checking : t.lsRun}
          </button>
          {ls && !ls.ok && <div style={{ marginTop: 5, fontSize: 11, color: '#991b1b' }}>{ls.error}</div>}
          {ls?.ok && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              {ls.member && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                  <span>{t.lsJoist} {ls.member.section} L{ls.member.spanMm}@{ls.member.spacingMm} <span style={{ color: 'var(--nx-text-3, #6b7684)' }}>w {ls.member.load?.total_kNm}kN/m</span></span>
                  <b style={{ color: ls.member.verdict === 'PASS' ? '#16a34a' : '#dc2626' }}>{ls.member.verdict}</b>
                </div>
              )}
              {ls.wind && !ls.wind.skipped && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                  <span>{t.lsTip} FS {ls.wind.FS} ({ls.wind.worst}){!ls.wind.pass && ls.wind.anchorUpliftPerPost_kN ? ` — ${t.lsAnchor} ${ls.wind.anchorUpliftPerPost_kN}kN/${t.lsPerPost}` : ''}</span>
                  <b style={{ color: ls.wind.pass ? '#16a34a' : '#dc2626' }}>{ls.wind.pass ? 'PASS' : 'FAIL'}</b>
                </div>
              )}
              {ls.wind?.skipped && <div style={{ color: 'var(--nx-text-3, #6b7684)' }}>{ls.wind.note}</div>}
              {ls.connection && ls.connection.type !== 'unspecified' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                  <span>{t.lsConnRow}({ls.connection.type === 'nail' ? t.lsNail : t.lsBolt}): {t.lsDemand} {ls.connection.demandN}N → {t.lsCapacity} {ls.connection.checks?.shear?.capacity_N ?? '—'}N ({t.lsRatio} {ls.connection.checks?.shear?.ratio ?? '—'})</span>
                  <b style={{ color: ls.connection.verdict === 'PASS' ? '#16a34a' : ls.connection.verdict === 'FAIL' ? '#dc2626' : '#d97706' }}>{ls.connection.verdict}</b>
                </div>
              )}
              {ls.connection?.type === 'unspecified' && <div style={{ color: 'var(--nx-text-3, #6b7684)' }}>{ls.connection.note}</div>}
              <button type="button" onClick={() => downloadHtmlReport('/api/nexyfab/drawing/landscape-check/', lsBody(), 'timber_wind_check.html')} style={rptBtn}>
                📄 {t.reportHtml}
              </button>
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{ls.disclaimer}</div>
            </div>
          )}
        </div>
      )}

      {/* 하중경로 자동 체인 (building · Wave A B1): 슬래브 자중+활하중 → 보 → 기둥 → 기초 */}
      {domain === 'building' && built && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
            {t.bdTitle}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
              {t.bdSub}
            </span>
          </div>
          <label style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
            <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{t.bdUsage}</span>
            <select value={String(chainP.usage)} onChange={(e) => setChainP((s) => ({ ...s, usage: e.target.value }))} style={selStyle}>
              {(usages.length ? usages : [{ key: 'office', kNm2: 2.5, label: t.bdOffice }]).map((u) => (
                <option key={u.key} value={u.key}>{u.label} — {u.kNm2} kN/m²</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, marginBottom: 6 }}>
            {([
              ['fck', 'fck MPa'], ['fy', 'fy MPa'], ['beamAs', t.bdBeamAs],
              ['beamAv', t.bdStirrupAv], ['beamS', t.bdSpacingS], ['colAst', t.bdColAst],
              ['fB', t.bdFtgB], ['fL', t.bdFtgL], ['qAllow', t.bdQAllow],
            ] as Array<[string, string]>).map(([k, lb]) => (
              <label key={k} style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{lb}</span>
                <input type="number" value={chainP[k] as number} onChange={(e) => setChainP((s) => ({ ...s, [k]: Number(e.target.value) }))} style={inpStyle} />
              </label>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, marginBottom: 6 }}>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{t.bdSeisZone}</span>
              <select value={String(chainP.seisZone)} onChange={(e) => setChainP((s) => ({ ...s, seisZone: e.target.value }))} style={selStyle}>
                <option value="">{t.bdSeisOff}</option>
                <option value="I">{t.bdZoneI}</option>
                <option value="II">{t.bdZoneII}</option>
              </select>
            </label>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{t.bdSite}</span>
              <select value={String(chainP.seisSite)} onChange={(e) => setChainP((s) => ({ ...s, seisSite: e.target.value }))} style={selStyle}>
                {['S1', 'S2', 'S3', 'S4', 'S5'].map((s2) => <option key={s2} value={s2}>{s2}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>R ({t.bdRTable})</span>
              <input type="number" step="0.5" value={chainP.seisR as number} onChange={(e) => setChainP((s) => ({ ...s, seisR: Number(e.target.value) }))} style={inpStyle} />
            </label>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{t.bdWindV0}</span>
              <input type="number" step="0.5" placeholder={t.bdWindV0Ph} value={chainP.windV0 as number} onChange={(e) => setChainP((s) => ({ ...s, windV0: e.target.value }))} style={inpStyle} />
            </label>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{t.bdWindExp}</span>
              <select value={String(chainP.windExposure)} onChange={(e) => setChainP((s) => ({ ...s, windExposure: e.target.value }))} style={selStyle}>
                {['A', 'B', 'C', 'D'].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{t.bdWindTerrain}</span>
              <select value={String(chainP.windTerrain)} onChange={(e) => setChainP((s) => ({ ...s, windTerrain: e.target.value }))} style={selStyle}>
                <option value="normal">{t.bdTerrainNormal}</option>
                <option value="flatOpen">{t.bdTerrainFlatOpen}</option>
                <option value="coast">{t.bdTerrainCoast}</option>
              </select>
            </label>
          </div>
          <button type="button" onClick={runChain} disabled={chainBusy} style={{ ...genStyle, background: '#0e7490' }}>
            {chainBusy ? t.bdChainBusy : t.bdRun}
          </button>
          {chain && !chain.ok && <div style={{ marginTop: 5, fontSize: 11, color: '#991b1b' }}>{chain.error}</div>}
          {chain?.ok && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              <div style={{ color: 'var(--nx-text-2, #46505e)', marginBottom: 3 }}>
                {t.bdSlab}: D {chain.loads?.slab.D_kN}kN · L {chain.loads?.slab.L_kN}kN ({chain.loads?.usage.label} {chain.loads?.usage.live_kNm2}kN/m²) · {chain.loads?.slab.finishNote}
              </div>
              {[...(chain.beams ?? []).map((b) => ({ nm: `${b.id} (${b.section})`, dt: `Mu ${b.Mu_kNm}kN·m · ${b.combo}`, v: b.verdict })),
                ...(chain.columns ?? []).map((c) => ({ nm: `${c.id}`, dt: `Pu ${c.Pu_kN}kN`, v: c.verdict })),
                { nm: t.bdFooting, dt: chain.footing?.needInputs ? t.bdInputsNeeded : '', v: chain.footing?.verdict },
                ...(chain.slabSLS ? [{ nm: `${t.bdSlabDefl} ${chain.slabSLS.panelMm ?? ''}`, dt: `δL ${chain.slabSLS.live.delta_mm}/${chain.slabSLS.live.limit_mm} · δT ${chain.slabSLS.total.delta_mm}/${chain.slabSLS.total.limit_mm}mm`, v: chain.slabSLS.live.pass && chain.slabSLS.total.pass ? 'PASS' : 'FAIL' }] : []),
                ...(chain.seismic && !chain.seismic.error ? [{ nm: `${t.bdSeismic} V=${chain.seismic.V_kN}kN (Cs ${chain.seismic.Cs})`, dt: `${t.bdCol} MuE ${chain.seismic.column?.MuE_kNm}kN·m`, v: chain.seismic.column?.verdict }] : []),
                ...(chain.wind && !chain.wind.error && chain.wind.x && chain.wind.y ? [{
                  nm: `${t.bdWind} V=${Math.max(chain.wind.x.baseShear_kN, chain.wind.y.baseShear_kN)}kN (${(chain.wind.x.baseShear_kN >= chain.wind.y.baseShear_kN ? chain.wind.x : chain.wind.y).method})`,
                  dt: `p ${(chain.wind.x.baseShear_kN >= chain.wind.y.baseShear_kN ? chain.wind.x : chain.wind.y).p_Nm2}N/m² · ${t.bdCol} MuW ${chain.wind.column?.MuW_kNm}kN·m`,
                  v: chain.wind.column?.verdict,
                }] : [])]
                .map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                    <span>{r.nm} <span style={{ color: 'var(--nx-text-3, #6b7684)' }}>{r.dt}</span></span>
                    <b style={{ color: r.v === 'PASS' ? '#16a34a' : r.v === 'FAIL' ? '#dc2626' : '#d97706' }}>{r.v}</b>
                  </div>
                ))}
              {chain.wind?.error && <div style={{ color: '#991b1b', padding: '2px 0' }}>{chain.wind.error}</div>}
              <button type="button" onClick={() => downloadHtmlReport('/api/nexyfab/drawing/load-path/', chainBody(), 'load_path_check.html')} style={rptBtn}>
                📄 {t.reportHtml}
              </button>
              {/* 전수 설계 루프 — 전 부재 자동 순회(교차검증 게이트 포함) */}
              <button type="button" onClick={runDesignLoop} disabled={loopBusy} style={{ ...rptBtn, background: '#7c3aed', color: '#fff' }}>
                🔁 {loopBusy ? (ko ? '전수 검토 중…' : 'Looping…') : (ko ? '전수 설계 루프(전 부재)' : 'Full member loop')}
              </button>
              {loop && !loop.ok && <div style={{ color: '#991b1b', padding: '2px 0', fontSize: 11 }}>{loop.error}</div>}
              {loop?.ok && loop.summary && (
                <div style={{ marginTop: 4, fontSize: 11 }}>
                  <b>{ko ? '전수 판정' : 'All-member verdicts'}:</b> {String(loop.summary.total)}{ko ? '부재' : ' members'} —
                  <span style={{ color: '#16a34a' }}> PASS {String(loop.summary.PASS)}</span> ·
                  <span style={{ color: '#dc2626' }}> FAIL {String(loop.summary.FAIL)}</span> ·
                  INPUT {String(loop.summary.INPUT)} · {ko ? '교차검증' : 'cross-check'} {loop.crossCheck?.pass === true ? '✓' : '⚠'}
                  {(loop.members ?? []).filter((m) => m.verdict === 'FAIL').slice(0, 6).map((m, i) => (
                    <span key={i} style={{ display: 'inline-block', margin: '0 0 0 6px', padding: '0 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b' }}>{m.id}</span>
                  ))}
                  <button type="button" onClick={() => downloadHtmlReport('/api/nexyfab/drawing/design-loop/', chainBody(), 'design_loop_sheets.html')} style={rptBtn}>
                    🖨 {ko ? '일괄 계산서(부재별 1장)' : 'All member sheets'}
                  </button>
                  {Number(loop.summary.FAIL) > 0 && (
                    <button type="button" onClick={runSuggest} disabled={suggestBusy} style={{ ...rptBtn, background: '#16a34a', color: '#fff' }}>
                      {suggestBusy ? (ko ? '탐색 중…' : 'Searching…') : `✨ ${ko ? 'FAIL 부재 자동 배근 제안' : 'Auto rebar suggestion'}`}
                    </button>
                  )}
                  {suggest && suggest.ok && (
                    <div style={{ marginTop: 4, fontSize: 11 }}>
                      <b>{ko ? '자동 제안' : 'Suggestions'}:</b> {(suggest.suggestions ?? []).length}{ko ? '건' : ''} —
                      {ko ? ' 적용 시 ' : ' after: '}<span style={{ color: suggest.verified ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                        {suggest.verified ? (ko ? '전 부재 PASS(재검증 완료)' : 'All PASS (re-verified)') : (ko ? '일부 잔여(단면 증대 필요 부재 포함)' : 'partial')}
                      </span>
                      <div style={{ maxHeight: 90, overflowY: 'auto', marginTop: 2 }}>
                        {(suggest.suggestions ?? []).slice(0, 20).map((s, i) => (
                          <span key={i} style={{ display: 'inline-block', margin: '0 4px 2px 0', padding: '0 6px', borderRadius: 4, background: s.result === 'SECTION' ? '#fee2e2' : '#dcfce7', fontSize: 10 }}>
                            {String(s.id)} {s.result === 'SECTION' ? (ko ? '단면증대 필요' : 'resize') : `${String(s.param)} ${String(s.from)}→${String(s.to)}`}
                          </span>
                        ))}
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{String(suggest.disclaimer ?? '')}</span>
                    </div>
                  )}
                </div>
              )}
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{chain.disclaimer}</div>
            </div>
          )}
        </div>
      )}

      {/* Round6 — 거더교 자동 체인 (bridge): DC·DW 형상 파생 + KL-510 영향선 + 극한 I (+선택 단면검토) */}
      {domain === 'bridge' && built && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
            {t.brTitle}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
              {t.brSub}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 6 }}>
            {([['pavementThk_mm', t.brPav], ['nLanes', t.brLanes], ['DF', t.brDF], ['As_mm2', t.brAs]] as Array<[string, string]>).map(([k, lb]) => (
              <label key={k} style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{lb}</span>
                <input type="number" step="0.01" value={brP[k] || ''} onChange={(e) => setBrP((s) => ({ ...s, [k]: Number(e.target.value) }))} style={inpStyle} />
              </label>
            ))}
          </div>
          <button type="button" onClick={runBridge} disabled={brBusy} style={{ ...genStyle, background: '#334155' }}>
            {brBusy ? t.checking : t.brRun}
          </button>
          {br && !br.ok && <div style={{ marginTop: 5, fontSize: 11, color: '#991b1b' }}>{br.error}</div>}
          {br?.ok && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                <span>
                  {t.brDC} {br.dead?.wDC_kNm}kN/m
                  <span style={{ color: 'var(--nx-text-3, #6b7684)' }}> (={br.dead?.girderSelf}+{br.dead?.deckShare}+{br.dead?.crossShare}) · {br.dead?.dwNote}</span>
                </span>
                <b>M_DC {br.dead?.M_DC}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                <span>
                  {t.brLL} M_LL {br.live?.M_LL}kN·m
                  <span style={{ color: 'var(--nx-text-3, #6b7684)' }}> · DF {br.live?.DF} ({br.live?.dfSrc}){br.live?.detail?.govern ? ` · ${br.live.detail.govern}` : ''}</span>
                </span>
                <b>V_LL {br.live?.V_LL}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                <span>{t.brUlt} Mu {br.ultimate?.Mu_kNm}kN·m · Vu {br.ultimate?.Vu_kN}kN</span>
              </div>
              <div style={{ padding: '2px 0', fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{br.ultimate?.combo}</div>
              {br.section && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                  <span>{t.brSection}{br.section.note ? <span style={{ color: 'var(--nx-text-3, #6b7684)' }}> · {br.section.note}</span> : null}{br.section.error ? <span style={{ color: '#991b1b' }}> {br.section.error}</span> : null}</span>
                  <b style={{ color: br.section.verdict === 'PASS' ? '#16a34a' : br.section.verdict === 'FAIL' ? '#dc2626' : '#d97706' }}>{br.section.verdict}</b>
                </div>
              )}
              <button type="button" onClick={() => downloadHtmlReport('/api/nexyfab/drawing/bridge-check/', brBody(), 'bridge_check.html')} style={rptBtn}>
                📄 {t.reportHtml}
              </button>
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{br.disclaimer}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const selStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 12,
  border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'var(--nx-text, #1a2230)',
};
const inpStyle: React.CSSProperties = {
  padding: '5px 7px', borderRadius: 6, fontSize: 12, border: '1px solid var(--nx-border, #dfe3e8)',
  background: 'var(--nx-panel, #fff)', color: 'inherit', width: '100%', boxSizing: 'border-box',
};
const genStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 7, border: 'none',
  background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const rptBtn: React.CSSProperties = {
  marginTop: 5, padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'var(--nx-text, #1a2230)',
};
const stepBtn: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 6, fontSize: 14, fontWeight: 800, cursor: 'pointer', lineHeight: 1,
  border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'var(--nx-text, #1a2230)',
};
