/**
 * 타입별 최소 responseSchema — gemini-2.5-flash/pro가 union 스키마(전 필드)에서
 * bent_sheet 등에 엉뚱한 필드(width)를 채우려다 degenerate-number로 폭주(MAX_TOKENS)
 * 하는 실패를 제거한다. 2단계: 분류(CLASSIFY_SCHEMA) → 타입별 최소 스키마 추출.
 *
 * PARAMS(reconstruct)에서 필드 목록을 끌어와 스키마를 파생 — 단일 출처.
 */
import { PARAMS } from './reconstruct.mjs';

const NUM = { type: 'NUMBER' };
export const ALL_TYPES = Object.keys(PARAMS); // 7종

export const CLASSIFY_SCHEMA = {
  type: 'OBJECT', required: ['type'],
  properties: { type: { type: 'STRING', enum: [...ALL_TYPES, 'unknown'] }, confidence: NUM },
};

/** 타입별 스키마: 해당 파라미터 + confidence(+ plate는 holes 배열). */
export const TYPE_SCHEMAS = Object.fromEntries(ALL_TYPES.map((t) => {
  const props = { confidence: NUM };
  for (const k of PARAMS[t]) props[k] = NUM;
  if (t === 'plate_with_holes') {
    props.holes = { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: NUM, y: NUM, d: NUM, fit: { type: 'STRING' } }, required: ['x', 'y', 'd'] } };
  }
  const required = [...PARAMS[t]];
  if (t === 'sheet_profile') {
    props.segments = { type: 'ARRAY', items: NUM };
    props.angles = { type: 'ARRAY', items: NUM };
    required.push('segments', 'angles');
  }
  if (t === 'composite') {
    props.subs = { type: 'ARRAY', items: { type: 'OBJECT', properties: { type: { type: 'STRING' } }, required: ['type'] } };
    required.push('subs');
  }
  if (t === 'extrude_profile') {
    // profile=[[x,y],…] · holes=[{x,y,d}] — 배열이라 PARAMS 로는 표현되지 않는다(특례).
    props.profile = { type: 'ARRAY', items: { type: 'ARRAY', items: NUM } };
    props.holes = { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: NUM, y: NUM, d: NUM, fit: { type: 'STRING' } }, required: ['x', 'y', 'd'] } };
    props.fillets = { type: 'ARRAY', items: { type: 'OBJECT', properties: { i: NUM, r: NUM }, required: ['i', 'r'] } };
    props.filletR = NUM;
    required.push('profile');
  }
  if (t === 'wall_with_openings') {
    props.openings = { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: NUM, w: NUM, h: NUM, sill: NUM }, required: ['x', 'w', 'h'] } };
  }
  return [t, { type: 'OBJECT', required, properties: props }];
}));

/**
 * 타입별 필드 힌트(프롬프트용)
 *
 * ★260803 — **힌트가 없는 어휘는 사실상 존재하지 않는다.**
 *
 * `from-text.mjs typeSpecLine` 이 `TYPE_HINTS[t] ?? PARAMS[t].join(',')` 로 폴백하므로
 * 「어휘 목록에는 나온다」. 그런데 실측에서 **그것만으로는 안 골린다**:
 * ```
 *   요청  : 힌지 마찰 와셔 — 외경 18mm, 내경 8mm, 두께 1mm  (= washer 파라미터와 정확히 일치)
 *   선택  : flange                                          ← 힌트가 있는 쪽
 *   결과  : bcd invalid · boltHoleD invalid · boltCount invalid ·
 *           BCD not between bore and OD · bolt holes break bore rim   (부품당 6건 × 10부품)
 * ```
 * 즉 모델은 **설명이 붙은 어휘를 고른다.** 이름만 나열된 어휘는 후보에서 밀린다.
 * 260802 에 `type` enum 이 9종 하드코딩이던 것을 `ALL_TYPES` 로 고쳤는데
 * **힌트 쪽은 안 고쳤다** — 같은 단일소스 결손의 네 번째 판이었다.
 *
 * ⚠ 새 어휘를 추가하면 **여기도 같이 채운다.** 회귀 `ai-prompt-contract` 가 빈 힌트를 막는다.
 * ⚠ 힌트는 `PARAMS` 와 **게이트가 실제로 요구하는 것**에서만 쓴다 — 지어내지 않는다.
 *   구분 문구(「~는 X 를 써라」)는 실측에서 오분류가 확인된 쌍에만 단다.
 */
export const TYPE_HINTS = {
  plate_with_holes: 'width,depth,thickness,holes[{x,y,d}] (좌하단 원점, 대칭구멍 좌표계산). '
    + '⚠ holes 는 **원형만** — 사각 개구(통풍구·덕트홀)는 slab_with_openings 를 써라',
  stepped_plate: 'width,depth,thickness,stepWidth,stepThickness',
  l_bracket: 'legA,legB,width,thickness',
  flange: 'outerDia,boreDia,thickness,bcd,boltHoleD,boltCount',
  bent_sheet: 'webWidth,flangeHeight,length,thickness (U채널 절곡판금)',
  tube: 'outerDia,innerDia,length (원형 파이프/중공 원통)',
  rect_tube: 'width,height,wallThk,length (각관/사각 중공재)',
  box: 'width,depth,height (속찬 직육면체 블록)',
  cylinder: 'diameter,length (속찬 원기둥 봉·포스트)',
  cone: 'dia1,dia2,height (속찬 원뿔대 — dia2=0 이면 뾰족한 원뿔. 셸은 pipe_reducer)',
  torus: 'majorDia,minorDia (속찬 원환/도넛 — majorDia=중심원 지름, minorDia=관 지름. 셸은 pipe_elbow)',
  gusset: 'legA,legB,thickness (직각삼각 거셋 보강판)',
  base_plate: 'width,depth,thickness,boltDia (4모서리 볼트홀 베이스판)',
  spur_gear: 'module,teeth,thickness,boreDia (인벌류트 스퍼기어 — 외경=m(z+2), boreDia 0=무보어)',
  hex_bolt: 'threadDia,length (육각볼트 M3~M36 — 머리치수 ISO 표준표 자동, 나사산 미형상 관례)',
  sheet_profile: 'thickness,width,segments[],angles[] (다단 절곡 판금 — 세그먼트 길이열+절곡각열(|a|≤120°), Z/햇/채널 단면. width=압출 길이)',
  wall_with_openings: 'length,thickness,height,openings[{x,w,h,sill}] (벽체 — X길이·Y두께·Z높이, 문=sill 0·창=sill>0)',
  /**
   * ⚠ 260802 — `revolve` 는 파라미터가 배열이라 `PARAMS` 가 비어 있고, 힌트도 없어
   *   프롬프트에 **빈 스펙**(`revolve: `)이 나가고 있었다. 회귀(`ai-prompt-contract`)가 잡았다.
   *   게이트(`reconstruct.mjs revolve`)가 실제로 요구하는 형태를 그대로 옮긴다 — 지어내지 않는다.
   */
  revolve: 'profile[[r,z],...] (회전체 — r≥0, 3점 이상 닫힌 단면) · angleDeg(0<θ≤360, 선택: 부분 회전)',
  composite: 'subs[{type,params,at?,op?}] (복합 부품 — 하위의 합·차로 한 부품. `op:subtract` 는 뺀다.'
    + '코퍼스 실측 형상 aspect `complex` 447/1071=42%. ⚠ 중첩은 **1단만**(하위의 하위 금지). '
    + '⚠ add 끼리 **겹침은 공제하지 않는다** — 겹치면 부피가 과대하다. ⚠ 표면적은 접촉면을 '
    + '알 수 없어 **미산출**이며 BOQ 가 이름으로 고지한다',
  masonry_block: 'length,thickness,height,coreCount,coreW,coreD (조적 블록 — 속빈 공동 0~4개를 실제로 공제. '
    + 'KS F 4002 콘크리트 기본블록 390×190×(190·150·100). ⚠ 치수 기본값은 KS 표준이고 참고 코퍼스에서 나온 것이 아니다 '
    + '— 코퍼스는 조적의 **존재/빈도**만 알려줬다(부품 단위 치수 없음)',
  extrude_profile: 'profile[[x,y],…],depth,holes[{x,y,d,kind?,cbDia?,cbDepth?,csDia?,thread?,depth?,pattern?}],filletR?,fillets?[{i,r}] (임의 폐곡선 압출 — XY 평면 폴리라인을 +Z 로 depth 만큼. '
    + '실물 압출의 67.6%가 이 형태(참고 코퍼스 10,508 프로파일 실측). 마지막 점은 자동 닫음. '
    + '⚠ 홀은 **원형만** — 비원형 내부 루프는 지원하지 않는다. ⚠ 자기교차는 검사하지 않는다. '
    + '홀 가공 상세(cbore·csink·tap·blind)와 패턴(linear{count,pitch}·circular{count,bcd})을 받는다 — '
    + '`plate_with_holes` 와 **같은 단일 소스**라 부피·표면적·SCAD 가 갈리지 않는다. '
    + '필렛은 **볼록 꼭짓점만** 원호(현 분할)로 반영한다 — 형상·부피·표면적이 모두 같은 형상을 본다. '
    + '홀에 `fit`(H7·h6 등 공차 등급)을 **표기로 받는다** — ⚠ 형식만 검증하고 '
    + '틈새/조임은 판정하지 않는다(짝이 되는 축이 선언돼야 한다)',

  // ── 260803 보충: 힌트가 비어 있던 17종 ────────────────────────────────────
  // 위 주석 참조 — 이름만 나열된 어휘는 모델이 고르지 않는다. 라이브에서 실증됐다.

  // 체결·기계요소 — 라이브 오분류가 실제로 난 구간
  washer: 'outerDia,boreDia,thickness (평와셔·마찰와셔 — **볼트원 없음**). '
    + '⚠ 외경/내경/두께 셋만 주어지면 flange 가 아니라 **이것**이다. '
    + 'flange 는 bcd·boltHoleD·boltCount 가 함께 있을 때만',
  hex_nut: 'af,thickness,boreDia (육각너트 — af=대변거리(맞변), boreDia=나사 안지름. 나사산 미형상 관례)',
  coil_spring: 'wireDia,coilDia,pitch,turns (코일 스프링 — coilDia=코일 중심원 지름. '
    + '게이트: wireDia < coilDia/2 · pitch ≥ wireDia(밀착 초과 시 코일 겹침))',
  pillow_block: 'boreDia,width,height,depth,boltPitch (베어링 하우징/필로우 블록 — boltPitch=베이스 볼트 중심간 거리)',

  // 형강 — 압연 단면
  h_section: 'H,B,tw,tf,length (H형강 — H=춤, B=플랜지 폭, tw=웨브 두께, tf=플랜지 두께)',
  c_channel: 'H,B,tw,tf,length (ㄷ형강/채널 — 한쪽만 열린 단면. U자 절곡판금은 bent_sheet)',
  tee_section: 'H,B,tw,tf,length (T형강)',
  angle: 'legA,legB,thickness,length (ㄱ형강/앵글 — legA·legB=두 변 길이. '
    + '삼각 보강판은 gusset, L자 브래킷은 l_bracket)',

  // 판·슬래브
  slab_with_openings: 'length,depth,thickness,openings[{x,y,w,d}] (슬래브·판 — **사각 개구**를 공제. '
    + 'X=length·Y=depth·Z=thickness, 개구는 좌하단 원점 기준 x,y 와 크기 w,d. '
    + '⚠ 통풍구·덕트홀 같은 **사각 개구는 원형 holes 로 못 낸다** — 이것을 써라)',

  // 배관 부속
  pipe_elbow: 'od,bendR,angleDeg,wallThk (관 엘보 — od=바깥지름, bendR=곡률 중심반경, angleDeg=굽힘각. 속찬 원환은 torus)',
  pipe_tee: 'runOD,branchOD,runLen,branchLen,wallThk (관 티 분기 — run=주관, branch=가지관)',
  pipe_reducer: 'dia1,dia2,length,wallThk (관 리듀서 — 속빈 원뿔대. 속찬 원뿔대는 cone)',

  // 교량 거더
  i_girder: 'length,topW,topT,webT,webH,botW,botT (I형 판형 거더 — 상·하 플랜지 폭/두께가 다를 수 있다. '
    + '압연 H형강은 h_section)',
  tapered_girder: 'length,topW,topT,webT,webH1,webH2,botW,botT (변단면 거더 — webH1→webH2 로 웨브 춤이 변한다)',

  // 배열/객체 파라미터를 갖는 특례 3종
  rebar: 'dia,points[[x,y,z],…] (철근 — 지름과 절점 폴리라인. 점 2~200개)',
  cavity_block: 'blockW,blockD,blockH,cavity{type,params,at?} (공동 블록 — 직육면체에서 '
    + '**임의 어휘 하나를 공제**한다. cavity.type 은 다른 어휘명)',
  mesh: 'volumeMm3 (+verts/faces/aabb) — 외부 메시를 받은 부품. '
    + '⚠ 새로 설계할 때 고르지 마라. 임포트된 형상 전용이다',
};
