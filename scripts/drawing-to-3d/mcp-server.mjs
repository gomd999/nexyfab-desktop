#!/usr/bin/env node
/**
 * NexyFab 2D→3D — MCP server (stdio, newline-delimited JSON-RPC 2.0).
 * Claude Code / Claude Desktop / 기타 MCP 클라이언트에서 도면→3D 파이프라인을 tool-call.
 *
 * 등록:  claude mcp add nexyfab-drawing -- node <이 파일 절대경로>
 * 도구:
 *   extract_drawing   도면 이미지(PNG 경로) → 파라메트릭 intent 추출 (Gemini Vision)
 *   edit_drawing      추출 intent + 자연어 지시 → 편집된 intent (패치·게이트 검증)
 *   reconstruct_3d    추출 intent → 게이트 검증 + OpenSCAD + ComponentIntent
 *
 * 원칙(방법론): AI는 이해/패치만, 형상 생성·검증은 결정론 코드(reconstruct/gate).
 * 범위(정직): 어휘 5종(plate/stepped_plate/l_bracket/flange/bent_sheet), 깨끗한 도면
 *   기준. 스캔·복잡 조립도는 미대응. extract/edit는 GEMINI_API_KEY(.env) 필요.
 */
import { createInterface } from 'node:readline';
import { extractDrawing } from './extract.mjs';
import { editDrawing } from './edit.mjs';
import { textToIntent, textToAssembly } from './from-text.mjs';
import { buildAssembly } from './assembly.mjs';
import { buildAssemblyTemplate, listAssemblyTemplates } from './domain-assemblies.mjs';
import { verify3d } from './verify.mjs';
import { renderHtml } from './html-render.mjs';
import { composeWithGate, emitComposite } from './compose.mjs';
import { intentToStep } from './to-step.mjs';
import { gate, toOpenScad } from './reconstruct.mjs';
import { toComponentIntent } from './to-intent.mjs';
import { verifyDomain, listDomains } from './domain-verify.mjs';
import { analyzeDfm } from './dfm.mjs';
import { listTemplates, presetWithVerify } from './preset-registry.mjs';
import { fabSpec, estimateCost, toDxf, DEFAULT_RATES } from './fab.mjs';
import { aiEditPart, applyPartPatch, faceOfPart, faceDragPatch, faceDimOf, partOps } from './edit-part.mjs';
import { autoTagAssembly, assemblyAtLevel } from './assembly.mjs';
import { bladeRingMesh } from './gen-macros.mjs';
import { extractGdt, extractGdtFile } from './gdt-import.mjs';
import { parseLandXml, parseLandXmlFile } from './landxml-import.mjs';
import { stepRoundTrip } from './roundtrip.mjs';
import { refineInterferencesMesh } from './interference-refine.mjs';
import { runDesignBriefTool } from './design-brief.mjs';
import { runCodeCheckTool } from './codecheck.mjs';
import { interiorCheck } from './interior-check.mjs';
import { landscapeCheck } from './landscape-check.mjs';
import * as bridgeMod from './bridge-check.mjs';
import { loadPathCheck, listUsages as loadPathUsages } from './load-path.mjs';

// bridge_check 자동 디스패치(라우트 CHECK_DISPATCH 와 동일): 어셈블리 meta 필드로
// 아치·트러스·사장·현수·계단 간이 체인을 고르고, 없으면 거더교(bridgeCheck) 폴백.
const BRIDGE_DISPATCH = [
  { meta: 'archMeta', fn: 'archBridgeCheck' },
  { meta: 'trussMeta', fn: 'trussBridgeCheck' },
  { meta: 'cableStayedMeta', fn: 'cableStayedCheck' },
  { meta: 'suspensionMeta', fn: 'suspensionCheck' },
  { meta: 'stairMeta', fn: 'stairCheck' },
];

const VOCAB = 'plate_with_holes | stepped_plate | l_bracket | flange | bent_sheet';

// ── Remote proxy (analyze_fea·reconstruct_verify·reconstruct_fleet) ───────────
// 이 3종은 호스팅 서버의 바이너리(OpenSCAD·gmsh·OCCT·메시 처리) 또는 AI 함대가 필요 —
// scripts/ 에 로컬 엔진이 없으므로 NEXYFAB_API_KEY(Pro 이상)로 nexyfab.com API 를 호출한다.
// 키가 없으면 조용히 실패하지 않고 명시적으로 원격 전용임을 반환(정직). code_check 는 순수
// 룰셋이라 로컬(오프라인) 실행 — 이 프록시를 쓰지 않는다.
const _apiUrl = () => (process.env.NEXYFAB_API_URL ?? 'https://nexyfab.com').replace(/\/$/, '');
async function remoteCall(route, body, toolName) {
  const key = process.env.NEXYFAB_API_KEY;
  if (!key) {
    return {
      ok: false, remoteOnly: true,
      error: `'${toolName}' 는 원격 전용 — NEXYFAB_API_KEY 가 필요합니다. 이 도구는 호스팅 서버의 바이너리(OpenSCAD/gmsh/OCCT·LLM)를 사용하므로 로컬 엔진이 없습니다. Pro 이상 계정에서 키를 발급(nexyfab.com → 계정 → API Keys)한 뒤 환경변수 NEXYFAB_API_KEY 로 설정하세요.`,
    };
  }
  let res;
  try {
    res = await fetch(_apiUrl() + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `원격 호출 실패(${_apiUrl()}${route}): ${String(e?.message ?? e)}` };
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }; }
  if (!res.ok && json && json.ok === undefined && json.error === undefined) json = { ok: false, error: `HTTP ${res.status}`, body: json };
  return json;
}

// reconstruct_verify 입력 정형: 확장자/format 으로 STL↔B-rep 경로와 요청 바디를 결정.
async function shapeReconstructInput(args) {
  const fs = await import('node:fs');
  let fmt = typeof args.format === 'string' ? args.format.toLowerCase() : '';
  if (!fmt && typeof args.file === 'string') fmt = (args.file.split('.').pop() ?? '').toLowerCase();
  if (!fmt) fmt = args.stlBase64 ? 'stl' : (typeof args.step === 'string' ? 'step' : '');
  if (!fmt) return { error: 'file(.stl/.step/.iges/.ifc/.dwg/.sat/.x_t) 또는 format 이 필요합니다.' };
  const textFmts = { step: 'step', stp: 'step', iges: 'iges', igs: 'iges', ifc: 'ifc', x_t: 'x_t', xt: 'x_t', xmt_txt: 'x_t' };
  const binFmts = { dwg: 'dwg', sat: 'sat', sab: 'sab' };
  try {
    if (fmt === 'stl') {
      const stlBase64 = typeof args.stlBase64 === 'string' && args.stlBase64 ? args.stlBase64 : fs.readFileSync(args.file).toString('base64');
      return { route: '/api/nexyfab/reverse-engineer/', body: { stlBase64 } };
    }
    if (textFmts[fmt]) {
      const step = typeof args.step === 'string' && args.step ? args.step : fs.readFileSync(args.file, 'utf8');
      return { route: '/api/nexyfab/drawing/import-step/', body: { step, format: textFmts[fmt], ...(args.name ? { name: args.name } : {}) } };
    }
    if (binFmts[fmt]) {
      const stlBase64 = typeof args.stlBase64 === 'string' && args.stlBase64 ? args.stlBase64 : fs.readFileSync(args.file).toString('base64');
      return { route: '/api/nexyfab/drawing/import-step/', body: { stlBase64, format: binFmts[fmt], ...(args.name ? { name: args.name } : {}) } };
    }
    return { error: `지원하지 않는 포맷 '${fmt}' — stl|step|iges|ifc|dwg|sat|x_t` };
  } catch (e) {
    return { error: `파일 읽기 실패: ${String(e?.message ?? e)}` };
  }
}

// reconstruct_verify 응답 정형: 게이트 판정 + export_step 넛지(정직한 실패를 다음 행동으로).
function finalizeReconstruct(r) {
  if (!r || r.ok === false) return r ?? { ok: false, error: '원격 응답 없음' };
  const gate = r.reconstructionGate;
  let suggestion;
  if (gate && gate.status !== 'pass') {
    if (gate.suggestion === 'export_step') suggestion = gate.message ?? '원본을 STEP(AP242)로 재내보내기 하면 B-rep 충실 측정이 가능합니다.';
    else suggestion = '재구성 게이트 미통과 — 곡면/복합 형상은 원본 CAD 에서 STEP(AP242)로 재내보내기(export_step) 하면 충실 대조가 가능합니다.';
  }
  return {
    ok: true,
    reconstructionGate: gate ?? { status: 'unavailable', reason: 'no_gate_in_response' },
    ...(r.observedStats ? { observedStats: r.observedStats } : {}),
    ...(r.stats ? { stats: r.stats } : {}),
    ...(Array.isArray(r.candidates) ? { candidateCount: r.candidates.length } : {}),
    ...(suggestion ? { suggestion } : {}),
  };
}

export const tools = [
  {
    name: 'design_brief',
    description:
      `★ Wave A AI 설계 드라이버 — 한 문장 brief → **검증된 설계 패키지** 또는 명시 거부. ` +
      `LLM은 계획(DesignPlan)까지만, 그 아래는 전부 결정론: 지오메트리(부피·워터타이트)→조립 수렴→` +
      `DFM→치수 실측 게이트를 모두 실행하고, 전 게이트 통과 시에만 패키지(부품별 3뷰 시트 IR·DXF·` +
      `실측 치수·BOM·검증 리포트)를 낸다. 하나라도 실패하면 패키지 없이 거부 IR(stage·reason·failed ` +
      `게이트 id — 값 날조 없음). API/웹과 동일 계약(결정론 플래너 기준). 현재 플래너는 fixture 3종` +
      `(l-bracket·stepped-shaft·pin-block-assembly); 미지 brief는 정직 거부(LLM 플래너=WA-D1).`,
    inputSchema: {
      type: 'object', required: ['text'],
      properties: {
        text: { type: 'string', description: '설계 요청 자연어(brief.text)' },
        id: { type: 'string', description: 'brief id(생략 시 fixture/text에서 파생)' },
        fixture: { type: 'string', description: '결정론 플래너 라우팅 키: l-bracket | stepped-shaft | pin-block-assembly' },
        params: { type: 'object', description: '구조화 파라미터(숫자/문자)' },
      },
    },
  },
  {
    name: 'compose_3d',
    description:
      `★ 범용 자유조합 — 고정 어휘(7종) 없이 AI가 범용 프리미티브(revolve/extrude/cylinder/box/sphere ` +
      `+ boolean/pattern/placement)를 조합해 임의 형상을 만든다. "수처리 탱크·용기·축·복합부품" 등 ` +
      `템플릿 밖 형상 대응. 흐름: 텍스트 → AI 조합 → 결정론 게이트(폴리곤 닫힘·회전축·정규화) → ` +
      `게이트 실패 시 AI 교정루프 → 실렌더 manifold 검증. AI=계획, 형상·검증=결정론. ` +
      `반환: {intent, gatePassed, rounds, verify(manifold), scad}. 실증: 200L 원뿔탱크 텍스트→manifold.`,
    inputSchema: {
      type: 'object', required: ['description'],
      properties: { description: { type: 'string', description: '만들 부품/장비 자연어 설명' }, maxRounds: { type: 'integer' } },
    },
  },
  {
    name: 'text_to_intent',
    description:
      `입구 B — 자연어 텍스트만으로 파라메트릭 도면 intent를 생성한다(이미지 불필요). 예: ` +
      `"가로 200 세로 100 두께 10 판, 네 귀퉁이 안쪽 15에 ⌀8 구멍 4개". 어휘 5종. ` +
      `치수 미기입 시 통상값+confidence↓(오라클 아닌 "계획서"). 출력은 extract_drawing과 동일 형식 — ` +
      `edit_drawing/reconstruct_3d로 이어진다. AI는 설명→intent까지만, 형상·검증은 결정론.`,
    inputSchema: {
      type: 'object', required: ['description'],
      properties: { description: { type: 'string', description: '부품 자연어 설명' }, model: { type: 'string' } },
    },
  },
  {
    name: 'text_to_assembly',
    description:
      `자연어로 복합 다부품 제품(어셈블리)을 생성한다. 예: "200×200×10 베이스판 위 네 귀퉁이에 ` +
      `80×60 L브래킷 4개". AI는 어셈블리 계획(부품+배치)까지만; 각 부품은 결정론 재구성, ` +
      `부품별 기하 게이트 + 부품쌍 AABB 간섭검사. 출력: OpenSCAD + 부품 목록 + 간섭 경고. ` +
      `범위=어휘 5종 조합·축정렬 배치(자유 조립 아님).`,
    inputSchema: {
      type: 'object', required: ['description'],
      properties: { description: { type: 'string' }, model: { type: 'string' } },
    },
  },
  {
    name: 'build_assembly',
    description:
      `어셈블리 계획(JSON: {name, parts:[{id,type,params,at}]})을 결정론적으로 3D로 빌드·검증한다 ` +
      `(Gemini 불필요). text_to_assembly 산출을 사람이 수정한 뒤 재빌드하거나, 직접 계획을 넣을 때 사용. ` +
      `출력: OpenSCAD + 부품 AABB + 게이트/간섭 리포트.`,
    inputSchema: {
      type: 'object', required: ['assembly'],
      properties: { assembly: { type: 'object', description: '{name, parts:[{id,type,params,at:{tx,ty,tz,rx,ry,rz}}]}' } },
    },
  },
  {
    name: 'export_step',
    description:
      `범용 조합 intent(compose_3d 산출)를 **진짜 B-rep STEP**으로 방출한다(CNC/제조용). ` +
      `OpenSCAD(메시)와 달리 replicad/OCCT로 해석적 B-rep 빌드 — revolve/extrude/cylinder/box/sphere ` +
      `+ boolean(fuse/cut) + pattern. outPath에 .step 저장, 엔티티 수 반환. 실증: 200L탱크→480엔티티.`,
    inputSchema: {
      type: 'object', required: ['intent', 'outPath'],
      properties: { intent: { type: 'object', description: 'compose_3d 범용조합 intent' }, outPath: { type: 'string', description: '.step 절대경로' } },
    },
  },
  {
    name: 'html_render',
    description:
      `intent 또는 어셈블리를 브라우저에서 바로 열리는 자립형 3D 뷰어 HTML로 렌더한다 ` +
      `(사용자 요청 "html형 랜더링"). 실렌더 STL 임베드 + three.js PBR·조명·궤도컨트롤·📷스크린샷. ` +
      `outPath에 파일로 저장하고 경로·크기 반환. 제안서/공유용 오프라인 파일.`,
    inputSchema: {
      type: 'object', required: ['outPath'],
      properties: {
        intent: { type: 'object', description: '단품 intent (intent 또는 assembly 중 하나)' },
        assembly: { type: 'object', description: '어셈블리 계획' },
        outPath: { type: 'string', description: '저장할 .html 절대경로' },
        title: { type: 'string' }, subtitle: { type: 'string' },
      },
    },
  },
  {
    name: 'verify_3d',
    description:
      `정확성 검증 — intent를 실제 openscad-wasm으로 렌더해 STL의 bbox·manifold를 ` +
      `기대 치수와 대조한다. "만들었다"가 아니라 "만든 것이 치수와 맞다"를 기계 확인. ` +
      `반환: {pass, manifold, nonManifoldEdges, dims[{axis,expected,actual,errorMm}], maxErrorMm}. ` +
      `치수 정확도엔 VLM보다 이 결정론 대조가 강함.`,
    inputSchema: {
      type: 'object', required: ['intent'],
      properties: { intent: { type: 'object', description: 'extract/text/edit 산출 intent' }, tolMm: { type: 'number', description: '허용오차(기본 0.5)' } },
    },
  },
  {
    name: 'extract_drawing',
    description:
      `기계 제작 도면 이미지(3각법 정투상 PNG)를 읽어 파라메트릭 intent(치수·구멍 등)로 추출한다. ` +
      `Gemini Vision 사용. 지원 어휘: ${VOCAB}. 깨끗한 합성 도면 기준(스캔·복잡 조립도 미검증). ` +
      `반환: {type, 치수필드…, holes[], confidence, repaired}. 이후 edit_drawing/reconstruct_3d로 이어진다.`,
    inputSchema: {
      type: 'object', required: ['imagePath'],
      properties: {
        imagePath: { type: 'string', description: '로컬 도면 PNG 파일 절대경로' },
        model: { type: 'string', description: 'Gemini 모델 (기본 gemini-2.5-flash)' },
      },
    },
  },
  {
    name: 'edit_drawing',
    description:
      `추출된 도면 intent를 자연어 지시로 수정한다. 예: "두께 12로, 구멍 전부 ⌀10, (90,45)에 ⌀6 추가". ` +
      `AI는 구조화 패치(setParams/holes.add·removeNearest·setDiameterAll)만 제안하고, 적용·검증은 결정론. ` +
      `잘못된 편집(판 밖 구멍 등)은 게이트가 거부·롤백한다. 반환: {accepted, extraction, changes, gateErrors, intent}.`,
    inputSchema: {
      type: 'object', required: ['extraction', 'instruction'],
      properties: {
        extraction: { type: 'object', description: 'extract_drawing 산출 intent (또는 이전 edit 결과)' },
        instruction: { type: 'string', description: '자연어 수정 지시' },
      },
    },
  },
  {
    name: 'reconstruct_3d',
    description:
      `추출/편집된 intent를 결정론적으로 3D로 재구성한다. 기하 게이트(범위·판재성·구멍 내접) 검증 후 ` +
      `OpenSCAD 텍스트 + shape-generator ComponentIntent(op:subtract 포함)를 반환. 게이트 실패 시 gateErrors만. ` +
      `SCAD는 OpenSCAD/openscad-wasm으로 STL/STEP 렌더 가능.`,
    inputSchema: {
      type: 'object', required: ['extraction'],
      properties: { extraction: { type: 'object', description: 'intent (extract 또는 edit 산출)' } },
    },
  },
  {
    name: 'list_domains',
    description:
      `분야별 상시검증(②)에 쓸 수 있는 설계 분야·계산기·입력 명세를 반환한다. ` +
      `분야: 가설·랙·경량철골(좌굴·휨) / 건축 부재(RC 보) / 조경 배수. 각 계산기의 status(draft 등)와 ` +
      `근거(refs), 사용자 입력 필드(하중·재료)를 준다. 형상이 줄 수 있는 입력(단면·경간)은 verify_domain이 자동 파생.`,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mech_preset',
    description:
      `분야별 **결정론 파라메트릭 프리셋** — AI 없이 파라미터로 형상을 만든다(항상 유효·manifold). ` +
      `domain=mech(원통용기·플레이트·절곡브래킷·각관) | rack(랙포스트·랙빔). templateId 없이 호출하면 ` +
      `그 분야 템플릿·파라미터 명세를 반환. 반환: {intent, scad, verify} (compose와 동일 형식).`,
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'mech | rack (기본 mech)' },
        templateId: { type: 'string', description: '생략 시 그 분야 카탈로그' },
        params: { type: 'object', description: '파라미터 — 명세는 templateId 생략 호출로 확인' },
      },
    },
  },
  {
    name: 'fab_estimate',
    description:
      `판재 레이저 제조 명세(결정론) + 예상비용(추정) + 절단 DXF. spec(절단길이·피어싱·중량·면적)은 정확, ` +
      `estimate.total은 **예상**(편집 단가 × 명세). dxf는 평판 절단용(실사용 가능). 평판만 대상 — 각관·용기는 ` +
      `applicable:false. 반환: {spec, estimate, dxf}. 확정 견적은 RFQ.`,
    inputSchema: {
      type: 'object', required: ['intent'],
      properties: {
        intent: { type: 'object', description: 'compose/preset intent' },
        thicknessMm: { type: 'number', description: '두께 명시(생략 시 형상서)' },
        rates: { type: 'object', description: `단가표 오버라이드 {materialPerKg,cutPerM,piercePerHole,bendPerOp,setup,marginPct}. 기본=${JSON.stringify(DEFAULT_RATES)}` },
      },
    },
  },
  {
    name: 'analyze_dfm',
    description:
      `판금·절삭 제조성(DFM) 검사 — 형상 intent에서 홀·두께·벽을 결정론적으로 읽어 최소 홀·홀-엣지 거리· ` +
      `홀 간격·최소 두께·얇은 벽 규칙을 검사한다(메시 휴리스틱 아님, 파라미터 직독). process=laser|punch로 임계 조정. ` +
      `반환: {checks[{rule,severity,title,message}], worst, thickness}. 비법정 참고(샵 관행값).`,
    inputSchema: {
      type: 'object', required: ['intent'],
      properties: {
        intent: { type: 'object', description: 'compose/preset intent' },
        process: { type: 'string', description: 'laser | punch (기본 laser)' },
        thicknessMm: { type: 'number', description: '두께 명시(생략 시 형상서 파생)' },
      },
    },
  },
  {
    name: 'edit_part',
    description:
      `🎯 선택 부품만 수정(자율 수정 루프) — AI는 「지시→패치」 이해만, 적용·게이트(어휘·간섭·` +
      `지지·구조)는 결정론. 대상 외 부품 불변은 코드가 보장. face(명명 면 또는 normal)로 면 컨텍스트 ` +
      `전달 가능. REV 이력 자동 축적. GEMINI_API_KEY 필요. 반환: {assembly, patch, interferences, ` +
      `floating, massKg, openscad, parts, composeIntent}.`,
    inputSchema: {
      type: 'object', required: ['assembly', 'partId', 'instruction'],
      properties: {
        assembly: { type: 'object', description: '{name, parts:[{id,type,params,at}...]}' },
        partId: { type: 'string' },
        instruction: { type: 'string', description: '예: "높이를 600으로", "중심 유지하고 폭 160"' },
        face: { type: 'object', description: "{face:'z+|axis+|radial'…} 또는 {normal:[x,y,z]}" },
      },
    },
  },
  {
    name: 'face_drag',
    description:
      `면 푸시풀(AI 없음, 순수 결정론) — 명명 면(box 6면·회전체 축단±/radial, 회전 배치 포함) 또는 ` +
      `픽 노멀 + deltaMm(±) 또는 targetMm(치수 직접 지정) → 파라미터/배치 결정론 패치 + 재빌드 게이트. ` +
      `모호 조합=정직 거부.`,
    inputSchema: {
      type: 'object', required: ['assembly', 'partId'],
      properties: {
        assembly: { type: 'object' }, partId: { type: 'string' },
        face: { type: 'string', description: "'z+'|'x-'|'axis+'|'radial'…(faceOfPart 명명)" },
        normal: { type: 'array', items: { type: 'number' }, description: '월드 노멀 [x,y,z](face 대신)' },
        deltaMm: { type: 'number', description: '면 확장(+)/축소(−) mm' },
        targetMm: { type: 'number', description: '해당 면 치수의 목표값(delta 대신)' },
      },
    },
  },
  {
    name: 'part_op',
    description:
      `부품 일괄 연산(AI 없음) — delete | duplicate(+offset[3]) | translate{dx,dy,dz} | fillet{r}` +
      `(part.filletMm→STEP B-rep 에만 반영, 표시=무필렛 명시). 재빌드 게이트 + REV 축적.`,
    inputSchema: {
      type: 'object', required: ['assembly', 'op', 'partIds'],
      properties: {
        assembly: { type: 'object' }, op: { type: 'string', enum: ['delete', 'duplicate', 'translate', 'fillet'] },
        partIds: { type: 'array', items: { type: 'string' } },
        opts: { type: 'object', description: '{offset:[x,y,z]} | {dx,dy,dz} | {r}' },
      },
    },
  },
  {
    name: 'lod_assembly',
    description:
      `1차 골격→2차 상세(LOD) — 계통/상세 자동 태깅(미지정만, detail2=철물·자유곡면) 후 ` +
      `level 이하 부분집합을 빌드. level=1이면 골격 프리뷰(생성 시간·비용 절약), 2=전체.`,
    inputSchema: {
      type: 'object', required: ['assembly'],
      properties: { assembly: { type: 'object' }, level: { type: 'integer', description: '기본 1(골격)' } },
    },
  },
  {
    name: 'blade_ring',
    description:
      `NACA 4-digit 블레이드 링(자유곡면 생성기, x축 로프트) — 팬/프로펠러/임펠러 블리스크 mesh 부품 ` +
      `생성. 반환 {params(mesh), gen} 을 assembly 부품 {type:'mesh', params, gen} 으로 사용 — 이후 수정은 ` +
      `edit_part 가 gen.params 재생성으로 처리(정점 직접 수정 금지·추적성).`,
    inputSchema: {
      type: 'object', required: ['nB', 'rRoot', 'rTip', 'chord', 'cx', 'pitch'],
      properties: {
        nB: { type: 'integer', description: '블레이드 수(2~60)' }, rRoot: { type: 'number' }, rTip: { type: 'number' },
        chord: { type: 'number' }, cx: { type: 'number', description: '축방향 중심 x' },
        cy: { type: 'number' }, cz: { type: 'number' }, pitch: { type: 'number' }, naca: { type: 'string', description: "기본 '4412'" },
      },
    },
  },
  {
    name: 'generate_package',
    description:
      `실시 도서 세트 일괄 생성(outDir 에 파일 저장) — GA 2D(완성도 체크리스트 게이트)·GA 3D(오프라인 ` +
      `뷰어)·부품 제작도·BOQ·제작사양서·Dossier·DXF(C9 게이트)·선택 STEP(부품별 B-rep 컴파운드·` +
      `filletMm 반영). 비법정(제작용 실시도서+검토 계산서 — 인허가 도서=기술사 날인 영역). ` +
      `반환: 파일 목록 + 완성도/C9 결과.`,
    inputSchema: {
      type: 'object', required: ['assembly', 'outDir'],
      properties: {
        assembly: { type: 'object' }, outDir: { type: 'string', description: '저장 디렉터리(절대경로)' },
        title: { type: 'string' }, withStep: { type: 'boolean', description: 'STEP 포함(수십 초 소요 가능)' },
      },
    },
  },
  {
    name: 'list_templates',
    description:
      '분야별 결정론 어셈블리 템플릿 목록(형상 합성기의 앞문). domain 생략 시 전 분야. ' +
      '반환 각 항목: { domain, id, labelKo, labelEn, params[] }. ' +
      'generate_domain_package 의 domain/templateId/params 로 그대로 사용.',
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string', description: '예: building|civil|interior|landscape (생략=전 분야)' } },
    },
  },
  {
    name: 'generate_domain_package',
    description:
      '분야 템플릿 → 완제 실시 도서(도시에) 원샷. buildAssemblyTemplate(형상 결정론 합성) 후 ' +
      'generate_package 와 동일 산출(GA 2D·GA 3D·부품제작도·BOQ·제작사양서·Dossier·DXF·선택 STEP). ' +
      '입력값 불가 시 기본값으로 대체하지 않고 정직 거부(paramErrors). 비법정(기술사 날인=별도).',
    inputSchema: {
      type: 'object', required: ['domain', 'templateId', 'outDir'],
      properties: {
        domain: { type: 'string' }, templateId: { type: 'string' },
        params: { type: 'object', description: '템플릿 파라미터(치수 등) — 생략 시 기본값' },
        outDir: { type: 'string', description: '저장 디렉터리(절대경로)' },
        title: { type: 'string' }, withStep: { type: 'boolean' },
      },
    },
  },
  {
    name: 'loft_part',
    description:
      'ⓒ 로프트/스윕 저작 — 단면을 이어 매끈한 곡면 mesh 생성(박스 아님). ' +
      'profile.type=circle|superellipse|naca|roundedRect|polygon. 방식: (a) 로프트=stations[{at:[x,y,z],' +
      'scale,rot}]+axis, (b) 스윕=kind:"sweep"+path[[x,y,z]...]+scale(단면을 경로 따라 압출, 회전최소화 ' +
      '프레임). 다중 바디는 {bodies:[<바디스펙>...]} 또는 배열 → 어셈블리 반환. 반환: assembly + 체적/삼각형수.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' }, profile: { type: 'object', description: '{type, ...params}' },
        stations: { type: 'array', items: { type: 'object' }, description: '로프트' },
        path: { type: 'array', items: { type: 'array' }, description: '스윕(kind:sweep) 경로 [[x,y,z]...]' },
        kind: { type: 'string', enum: ['loft', 'sweep'] }, scale: { type: 'number' },
        axis: { type: 'string', enum: ['x', 'y', 'z'] }, material: { type: 'string' }, role: { type: 'string' },
        bodies: { type: 'array', items: { type: 'object' }, description: '다중 바디' },
      },
    },
  },
  {
    name: 'resolve_constraints',
    description:
      'ⓑ 조립 구속 — 부품을 절대좌표가 아니라 관계로 배치. 각 부품 constraints[](offset·concentric·' +
      'onFace·mirror·centerline)를 to 의존성 위상정렬로 해석해 at 확정. 순환·미지참조 등은 정직 throw. ' +
      '반환: at가 확정된 어셈블리(buildAssembly/render_preview/generate_package 에 그대로 투입).',
    inputSchema: { type: 'object', required: ['assembly'], properties: { assembly: { type: 'object' } } },
  },
  {
    name: 'render_preview',
    description:
      '헤드리스 렌더→PNG(ⓐ) — 어셈블리를 top/side/iso 그레이스케일 PNG로 (브라우저·GL 없이 ' +
      '순수 노드 테셀레이션·투영·z버퍼). 저작 루프의 "눈": 만든 배치를 이미지로 되받아 검증·수정. ' +
      'outDir 지정 시 파일 저장, 미지정 시 뷰별 base64 반환(AI/자동화가 바로 판독).',
    inputSchema: {
      type: 'object', required: ['assembly'],
      properties: {
        assembly: { type: 'object' },
        outDir: { type: 'string', description: '저장 디렉터리(생략 시 base64 반환)' },
        views: { type: 'array', items: { type: 'string', enum: ['iso', 'side', 'top', 'front'] } },
      },
    },
  },
  {
    name: 'extract_gdt',
    description:
      `STEP AP242 시맨틱 PMI(GD&T) 판독(결정론 — AI 없음): 데이텀(A/B/C…)·기하공차(⊥⌖⏥… 크기+` +
      `데이텀 참조+MMC/LMC)·치수(공칭±리밋). NIST MBE 검증모델 17파일 전수 무크래시 실측. ` +
      `그래픽 주석·서피스 텍스처=v1 범위 외(unparsed 정직 보고). 값=모델 내장 공차의 판독.`,
    inputSchema: {
      type: 'object',
      properties: {
        stepPath: { type: 'string', description: '.stp/.step 절대경로 (stepText 와 택1)' },
        stepText: { type: 'string', description: 'STEP 본문 텍스트' },
      },
    },
  },
  {
    name: 'step_roundtrip',
    description:
      `A1 라운드트립 정합 게이트 — 「만든 STEP 이 예측과 맞다」 기계 확인: STEP 직렬화→재임포트→` +
      `부피·AABB 재측정 ↔ 폐형 예측(Σ부품 체적·∪AABB) 대조(밴드 명시·드롭 부품=동일 모집단 제외). ` +
      `실측: 제트 85부품 오차 0.07%. 반환 {verdict, volume, aabb, dropped}.`,
    inputSchema: { type: 'object', required: ['assembly'], properties: { assembly: { type: 'object' } } },
  },
  {
    name: 'refine_interferences',
    description:
      `B1 의심쌍 메시 부울 2차 간섭 — AABB/폐형 규칙이 보수로 남긴 간섭쌍만 openscad ` +
      `intersection() 실기하 재판정(회전·사면·revolve·자유곡면 전부 정확). 교집합≤ε=실분리 해제, ` +
      `>ε=확정+실측 부피. build_assembly 의 interferences 를 그대로 넣는다.`,
    inputSchema: {
      type: 'object', required: ['assembly', 'interferences'],
      properties: { assembly: { type: 'object' }, interferences: { type: 'array' }, epsMm3: { type: 'number' } },
    },
  },
  {
    name: 'execution_gate',
    description:
      `T2 실시 검도 게이트 M1~M6(260719b) — 「이 도면만으로 제작 착수 가능한가」 결정론 판정: ` +
      `M1 치수충분성(파라미터 자유도↔기입 치수)·M2 구멍표·M3 용접 지시선·M4 나사 표기·` +
      `M5 재질+일반공차·M6 실윤곽. GA/부품도를 내부 생성해 대조. 반환 {score, ok, items, failed, na}.`,
    inputSchema: { type: 'object', required: ['assembly'], properties: { assembly: { type: 'object' } } },
  },
  {
    name: 'std_audit',
    description:
      `시판 규격 감사(G1+R2-⑪) — 배관 d·각형강관·T슬롯(알루미늄)·필로우 블록(UCP) 부재를 표준 ` +
      `카탈로그와 대조: 스냅 권고(편차%)·규격 외 정직 경고. 보고 전용(형상 무변경). ` +
      `반환 {items:[{id,kind,input,snap}], warnings}.`,
    inputSchema: { type: 'object', required: ['assembly'], properties: { assembly: { type: 'object' } } },
  },
  {
    name: 'dxf_reconcile',
    description:
      `T3 DXF DIMENSION 결정론 판독(260719b) — ASCII DXF 치수 엔티티(실측값 42) 분류(선형H/V·` +
      `지름·반지름) 후 intent 수치 파라미터를 ±tolPct 최근접 실측값으로 교체(추론→판독 격상). ` +
      `교체 이력·unverified(추론 잔존)·coverage 전부 보고. 반환 {seed, reconciled}.`,
    inputSchema: {
      type: 'object', required: ['dxfText', 'intent'],
      properties: { dxfText: { type: 'string' }, intent: { type: 'object' }, tolPct: { type: 'number' } },
    },
  },
  {
    name: 'import_landxml',
    description:
      `LandXML 1.x 도로 선형 임포트(결정론): Line/Curve(arc) 체인→엔진 선형 입력({ips, curves}) ` +
      `— IP=탄젠트 교점, 단위 자동 mm 환산(m/ft), 요소장 합↔선언 길이 검산. 종단 PVI 판독. ` +
      `clothoid·복합곡선=unsupported 정직 보고. 반환 ips/curves 를 civil 템플릿에 그대로 투입 가능.`,
    inputSchema: {
      type: 'object',
      properties: {
        xmlPath: { type: 'string', description: '.xml 절대경로(xmlText 와 택1)' },
        xmlText: { type: 'string' },
      },
    },
  },
  {
    name: 'verify_domain',
    description:
      `설계 형상 + 분야 → 진짜 공학 계산기(engineering-core) 검증. 형상에서 단면특성(A·Ix·Sx·r)·경간 L을 ` +
      `**결정론 파생**하고, 하중·재료(Fy·Pu·w·P·Mu 등)만 params로 받아 합쳐 계산한다. 반환: {verdict, checks, ` +
      `derived(형상파생), provenance(geometry/user 분리), refs, citations(인용 조항), status, disclaimer}. 하중 누락 ` +
      `시 값을 지어내지 않고 {needInputs}로 필요한 입력을 알려준다. 5개 분야(가설·랙 / 건축RC / 토목 / 인테리어 / ` +
      `조경) 계산기는 전부 draft(비법정 참고). 분야 전체 목록·입력 명세는 list_domains.`,
    inputSchema: {
      type: 'object', required: ['intent', 'domain', 'calculatorId'],
      properties: {
        intent: { type: 'object', description: 'compose_3d 범용조합 intent(features[])' },
        domain: { type: 'string', description: 'list_domains의 slug: temporary-rack | building-member | civil | interior | landscape' },
        calculatorId: { type: 'string', description: '분야 내 계산기 id — temporary-rack:column_buckling|simple_beam · building-member:rc_beam|rc_column_pm|isolated_footing · civil:retaining_wall_stability|box_culvert_frame · interior:occupancy_egress · landscape:timber_beam|timber_nail|landscape_drainage' },
        memberRef: { description: '부재 피처 선택(id 또는 index). 생략 시 첫 프리즘형 부재.' },
        params: { type: 'object', description: '사용자 입력 하중·재료 {Fy, Pu, w, P, Mu, As, fck, fy…}' },
        standardId: { type: 'string', description: '기준(기본 KDS)' },
      },
    },
  },
  {
    name: 'analyze_fea',
    description:
      `★ 간이 FEA(구조·열·모달·열탄성) — 형상을 실제 메시로 이산화해 선형정적 응력/안전율을 낸다. ` +
      `AI 없음(결정론+수치해석). 입력=scad(또는 compose_3d intent) + 재료(materialKey) + 상면 등가 하중(loadKg, ` +
      `날조 금지·명시 필수). precise=true 면 gmsh 경계정합 메시(인증후보급, ~수십초). 반환: {method, ` +
      `safetyFactor, maxStressMPa, maxDispMm, material, yieldMPa, mesh, raiser, reportHtml}. ` +
      `⚠원격 전용 — 호스팅 서버의 OpenSCAD/gmsh 바이너리가 필요(NEXYFAB_API_KEY 미설정 시 정직 거부). ` +
      `선형등방·자동 경계조건(스크리닝)·비법정 — 상세 해석은 유자격 기술자.`,
    inputSchema: {
      type: 'object', required: ['loadKg'],
      properties: {
        scad: { type: 'string', description: 'OpenSCAD 텍스트(intent 와 택1)' },
        intent: { type: 'object', description: 'compose_3d 범용조합 intent(scad 미지정 시 로컬 emitComposite 로 변환)' },
        materialKey: { type: 'string', description: '재료 키(steel|al|... 기본 steel)' },
        loadKg: { type: 'number', description: '상면 등가 하중(kg, 0 초과 — 날조 금지·명시 필수)' },
        precise: { type: 'boolean', description: 'gmsh 경계정합 정밀 메시(느림)' },
      },
    },
  },
  {
    name: 'reconstruct_verify',
    description:
      `★ 검증된 역설계 — 실물 형상을 NexyFab 재구성하고 게이트로 「재구성이 원본과 맞다」를 기계 대조. ` +
      `STL(.stl)→reverse-engineer(휴리스틱 분류→렌더 라운드트립), STEP/IGES/IFC/DWG/SAT/X_T→import-step ` +
      `(B-rep 판독→bbox/genus/watertight 대조). 반환: {reconstructionGate:{status:pass|fail|unavailable, ` +
      `mode, checks(bbox/genus/watertight), feedback}, suggestion(export_step)}. 곡면/복합은 정직 실패, ` +
      `측정 불가는 unavailable(가짜 통과 금지). ⚠원격 전용(서버 OCCT/메시 처리·Pro) — 키 미설정 시 거부.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: '입력 파일 절대경로(.stl/.step/.iges/.ifc/.dwg/.sat/.x_t) — 확장자로 포맷 추론' },
        format: { type: 'string', description: '포맷 강제(stl|step|iges|ifc|dwg|sat|x_t)' },
        stlBase64: { type: 'string', description: 'STL/바이너리(dwg·sat) base64(file 대신)' },
        step: { type: 'string', description: 'STEP/IGES/IFC/X_T 텍스트(file 대신)' },
        name: { type: 'string' },
      },
    },
  },
  {
    name: 'reconstruct_fleet',
    description:
      `★ AI 재구성 함대(lever F) — 휴리스틱이 못 여는 부품을 여러 모델 계열이 파라메트릭 SCAD 를 제안하고 ` +
      `결정론 재구성 게이트가 원본과 대조·통과분만 채택(피드백·계열 전환으로 재시도). 반환: {aiFleet:{passed, ` +
      `verified, attemptsUsed, seriesSwitched, familiesUsed, feedback}}. ⚠원격 전용 + Pro + 비용 예산 소모 ` +
      `(시도마다 LLM+렌더). 정직: 복잡 부품 비통과는 정상이며 날조된 통과는 없음. 키 미설정 시 거부.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'STL 파일 절대경로(.stl)' },
        stlBase64: { type: 'string', description: 'STL base64(file 대신)' },
        attempts: { type: 'integer', description: '시도 상한 힌트(서버가 자체 상한으로 제한, 현재 3)' },
      },
    },
  },
  {
    name: 'code_check',
    description:
      `★ 코드체크 / 감리 보조(결정론·LOCAL) — 측정된 설계 피처를 실제 공개 법령/공표기준 조항과 대조해 룰별 ` +
      `PASS/FAIL/NA + 인용 조항 + 실측 vs 요구값을 낸다. 룰셋 41종(웹과 동일 계약) 12개 카테고리: 주차(parking)· ` +
      `피난·방화(egress-fire)·계단·경사로·복도·난간·출입구·승강기·접근로·위생·건축(구조/일조/건폐율·용적률)· ` +
      `실내건축(accessibility/interior). 숫자 날조 없음(피처 미제공=NA, 준수 가정 안 함). ✔로컬 실행(순수 룰셋 — ` +
      `NEXYFAB_API_KEY 불필요, 오프라인 가능). {list:true} 로 41룰 카탈로그. 비법정 감리 보조(면허 감리자·기술사의 ` +
      `법정 감리를 대체하지 않음, disclaimer 항상 동봉).`,
    inputSchema: {
      type: 'object',
      properties: {
        features: { type: 'object', description: '측정 피처(단위 m·경사=rise/run). 예: {rampSlope:0.09, doorEffectiveWidth_m:0.9, parkingStallWidth_m:2.5, emergencyExitWidth_m:1.5, travelDistanceToStair_m:28, corridorCategory:"school", corridorBothSidesRooms:true, corridorWidth_m:2.1} — 키 목록은 {list:true}' },
        list: { type: 'boolean', description: '41룰 카탈로그만 반환(id·category·clause·source·requirement)' },
      },
    },
  },
  {
    name: 'interior_check',
    description:
      `인테리어 피난·마감 체인(결정론·LOCAL) — 어셈블리에서 보행거리 BFS(최원점→출입구, 장애물 우회)· ` +
      `수용인원/피난폭(occupancy_egress, 문폭 형상 파생)·마감 물량(개구 공제)을 한 번에 검토한다. verify_domain(단일 ` +
      `계산기)과 달리 피난 전 과정 체인. 반환 {travel, occupancy, finishes, checks…}. 미입력 값은 지어내지 않음. ` +
      `비법정(건축사 최종 책임). 순수 mjs — 키 불필요·오프라인.`,
    inputSchema: {
      type: 'object', required: ['assembly'],
      properties: {
        assembly: { type: 'object', description: '{name, parts:[{id,type,params,role,at}...]} (문·벽·가구 role 포함)' },
        params: { type: 'object', description: '용도·점유밀도·출구 등 입력(occupantDensityM2·exitCount 등)' },
      },
    },
  },
  {
    name: 'landscape_check',
    description:
      `조경 구조 체인(결정론·LOCAL) — 목재 부재 검토(timber_beam, 단면·스팬·간격 형상 파생, KDS 41 50 10) + ` +
      `풍하중 전도(입력 풍압 → FS·앵커 인발). 풍압 미입력 시 전도는 정직 생략(지어내지 않음). ` +
      `반환 {timber, overturning, checks…}. 비법정 검토 초안. 순수 mjs — 키 불필요·오프라인.`,
    inputSchema: {
      type: 'object', required: ['assembly'],
      properties: {
        assembly: { type: 'object', description: '{name, parts:[...]} (장선·보 등 목재 부재)' },
        params: { type: 'object', description: '수종·등급·하중·풍압 등 입력' },
      },
    },
  },
  {
    name: 'bridge_check',
    description:
      `교량 간이/실시급 검토 체인(결정론·LOCAL) — 어셈블리 meta 로 자동 디스패치: bridgeMeta=거더교(고정하중 ` +
      `형상×밀도 + KL-510 활하중 영향선 + 극한 I 조합 KDS 24 12 11, 선택 rc_beam 단면검토) / archMeta·trussMeta· ` +
      `cableStayedMeta·suspensionMeta·stairMeta=아치·트러스·사장·현수·산업계단 간이 폐형 체인. meta 없으면 거더 폴백. ` +
      `반환 {loads, checks, verdict…}. 비법정(기술사 날인 별도). 순수 mjs — 키 불필요·오프라인.`,
    inputSchema: {
      type: 'object', required: ['assembly'],
      properties: {
        assembly: { type: 'object', description: '{name, parts, bridgeMeta|archMeta|trussMeta|cableStayedMeta|suspensionMeta|stairMeta}' },
        params: { type: 'object', description: '경간·거더수·분배계수·재료 등 입력' },
      },
    },
  },
  {
    name: 'load_path',
    description:
      `건축 하중경로 자동 체인(결정론·LOCAL) — 슬래브 자중(형상)+활하중(KDS 41 12 00 용도표) → 하중조합 → ` +
      `보(rc_beam) → 기둥(rc_column_pm) → 기초(isolated_footing). {list:true} 로 활하중 용도표만 반환. 하중은 ` +
      `지어내지 않음(자중=형상, 활하중=표 선택, 철근·기초·지반=입력). 반환 {loads, beams, columns, footings, ` +
      `checks…}. ⚠슬래브 SLS 처짐(Mindlin)은 웹 전용 부가검토 — 로컬 체인 미포함(웹 라우트에서만). 비법정. ` +
      `순수 mjs — 키 불필요·오프라인.`,
    inputSchema: {
      type: 'object',
      properties: {
        assembly: { type: 'object', description: '{name, parts:[{role:slab|beam|column...}]}' },
        params: { type: 'object', description: '용도(usage)·fck·철근·기초·지반 등 입력' },
        list: { type: 'boolean', description: '활하중 용도표(KDS 41 12 00 표 3.2-1)만 반환' },
      },
    },
  },
];

export async function callTool(name, args = {}) {
  if (name === 'design_brief') {
    // 동일 계약: API 라우트와 같은 shared runner(결정론 플래너)를 tsx 서브프로세스로 실행.
    return runDesignBriefTool({ text: args.text, id: args.id, fixture: args.fixture, params: args.params });
  }
  if (name === 'compose_3d') {
    const r = await composeWithGate(args.description, { maxRounds: args.maxRounds ?? 2 });
    if (r.gatePassed && !r.scad) r.scad = emitComposite(r.intent);
    return r;
  }
  if (name === 'text_to_intent') {
    const { intent, model, repaired } = await textToIntent(args.description, { model: args.model });
    return { ...intent, repaired: !!repaired, _model: model };
  }
  if (name === 'text_to_assembly') {
    const { assembly, model } = await textToAssembly(args.description, { model: args.model });
    const built = buildAssembly(assembly);
    return { assembly, ...built, _model: model };
  }
  if (name === 'build_assembly') {
    return buildAssembly(args.assembly);
  }
  if (name === 'verify_3d') {
    return verify3d(args.intent, { tolMm: args.tolMm ?? 0.5 });
  }
  if (name === 'export_step') {
    const { writeFileSync } = await import('node:fs');
    const { step, entities } = await intentToStep(args.intent);
    writeFileSync(args.outPath, step);
    return { path: args.outPath, bytes: step.length, entities, format: 'STEP (B-rep, ISO-10303)' };
  }
  if (name === 'html_render') {
    const { writeFileSync } = await import('node:fs');
    const spec = args.assembly ? { assembly: args.assembly } : { intent: args.intent };
    const html = await renderHtml(spec, { title: args.title ?? 'NexyFab 3D', subtitle: args.subtitle ?? '' });
    writeFileSync(args.outPath, html);
    return { path: args.outPath, bytes: html.length, note: '브라우저로 열어 3D 확인·📷 스크린샷' };
  }
  if (name === 'extract_drawing') {
    const { intent, usage, model, repaired } = await extractDrawing(args.imagePath, { model: args.model });
    return { ...intent, repaired: !!repaired, _model: model, _tokens: usage?.totalTokenCount };
  }
  if (name === 'edit_drawing') {
    return editDrawing(args.extraction, args.instruction);
  }
  if (name === 'reconstruct_3d') {
    const ex = args.extraction;
    const gateErrors = gate(ex);
    if (gateErrors.length) return { gatePassed: false, gateErrors };
    return {
      gatePassed: true,
      gateErrors: [],
      openscad: toOpenScad(ex),
      intent: toComponentIntent(ex),
    };
  }
  if (name === 'mech_preset') {
    const domain = args.domain ?? 'mech';
    if (!args.templateId) return { domain, templates: listTemplates(domain) };
    return presetWithVerify(domain, args.templateId, args.params ?? {});
  }
  if (name === 'analyze_dfm') {
    return analyzeDfm(args.intent, { process: args.process, thicknessMm: args.thicknessMm });
  }
  if (name === 'fab_estimate') {
    const spec = fabSpec(args.intent, { thicknessMm: args.thicknessMm });
    return { spec, estimate: estimateCost(spec, args.rates ?? {}), dxf: toDxf(args.intent) };
  }
  if (name === 'list_domains') {
    return { domains: listDomains() };
  }
  if (name === 'step_roundtrip') {
    return stepRoundTrip(args.assembly);
  }
  if (name === 'refine_interferences') {
    return refineInterferencesMesh(args.assembly, args.interferences, { epsMm3: args.epsMm3 ?? 1 });
  }
  if (name === 'execution_gate') {
    // T2(260719b): GA+부품도 내부 생성 → 기입 치수 결정론 대조(도면집과 동일 수학)
    const built = buildAssembly(args.assembly);
    if (!built.ok) return { ok: false, gateErrors: built.gateErrors };
    const pkg = await import('./package.mjs');
    const ps = await import('./part-sheets.mjs');
    const eg = await import('./execution-gate.mjs');
    let gaHtml = '', sheetsHtml = '';
    try { gaHtml = pkg.ga2dDrawing(args.assembly, { title: args.assembly.name ?? 'gate', domain: args.assembly.domain ?? 'mech', welds: built.welds }); } catch { /* GA 실패=치수 소스 부품도만 */ }
    try { sheetsHtml = ps.partSheets(args.assembly, { title: 'gate' }); } catch { /* skip */ }
    return eg.checkExecutionReadiness(args.assembly, { gaHtml, sheetsHtml, welds: built.welds ?? [] });
  }
  if (name === 'std_audit') {
    const std = await import('./std-snap.mjs');
    return std.auditAssemblyStd(args.assembly);
  }
  if (name === 'dxf_reconcile') {
    const dx = await import('./dxf-seed.mjs');
    const seed = dx.extractDxfSeed(args.dxfText);
    const reconciled = dx.reconcileIntentWithDxf(args.intent, seed, args.tolPct > 0 ? { tolPct: args.tolPct } : undefined);
    return { ok: true, seed, reconciled };
  }
  if (name === 'import_landxml') {
    if (args.xmlPath) return parseLandXmlFile(args.xmlPath);
    if (args.xmlText) return parseLandXml(args.xmlText);
    return { ok: false, error: 'xmlPath 또는 xmlText 필요' };
  }
  if (name === 'extract_gdt') {
    if (args.stepPath) return extractGdtFile(args.stepPath);
    if (args.stepText) return extractGdt(args.stepText);
    return { ok: false, error: 'stepPath 또는 stepText 필요' };
  }
  if (name === 'edit_part') {
    return aiEditPart(args.assembly, args.partId, args.instruction, { face: args.face ?? null });
  }
  if (name === 'face_drag') {
    const part = (args.assembly?.parts ?? []).find((p) => p.id === args.partId);
    if (!part) return { ok: false, error: `부품 '${args.partId}' 없음` };
    const face = args.face ? { face: args.face } : (Array.isArray(args.normal) ? faceOfPart(part, args.normal) : null);
    if (!face) return { ok: false, error: 'face 또는 normal 필요(명명 불가=정직 거부)' };
    let d = args.deltaMm;
    if (Number.isFinite(args.targetMm)) {
      const dim = faceDimOf(part, face.face);
      if (!dim) return { ok: false, error: '이 면은 치수 직접 입력 미지원(모호 — 정직 거부)', face };
      d = Number(args.targetMm) - dim.value;
    }
    if (!Number.isFinite(d) || d === 0) return { ok: false, error: 'deltaMm 또는 targetMm 필요(0 제외)' };
    const fp = faceDragPatch(part, face.face, d);
    if (!fp.ok) return { ok: false, error: fp.error, face };
    return { ...applyPartPatch(args.assembly, args.partId, fp.patch, { kind: 'face-drag', note: `${face.face} ${d >= 0 ? '+' : ''}${Math.round(d)}mm` }), face, patch: fp.patch };
  }
  if (name === 'part_op') {
    return partOps(args.assembly, args.op, args.partIds, args.opts ?? {});
  }
  if (name === 'lod_assembly') {
    const tagged = autoTagAssembly(args.assembly);
    const level = args.level ?? 1;
    const subset = assemblyAtLevel(tagged, level);
    const built = buildAssembly(subset);
    return {
      ok: !!built.ok, level, assembly: tagged,
      subsetParts: (subset.parts ?? []).length, totalParts: (tagged.parts ?? []).length,
      openscad: built.openscad, parts: built.parts ?? [], gateErrors: built.gateErrors ?? [],
      interferences: built.interferences ?? [],
    };
  }
  if (name === 'blade_ring') {
    const genParams = { nB: args.nB, rRoot: args.rRoot, rTip: args.rTip, chord: args.chord, cx: args.cx, cy: args.cy ?? 0, cz: args.cz ?? 0, pitch: args.pitch, naca: args.naca ?? '4412' };
    return { params: bladeRingMesh(genParams), gen: { kind: 'blade_ring', params: genParams }, usage: "assembly 부품으로: {id, type:'mesh', params, gen, at:{tx:0,ty:0,tz:0}}" };
  }
  if (name === 'loft_part') {
    // 단일 바디(loft/sweep) 또는 다중 바디({bodies:[...]}/배열) 통합 처리.
    const { assemblyFromSpec } = await import('./loft.mjs');
    const assembly = assemblyFromSpec(args);
    const volumeMm3 = assembly.parts.reduce((s, p) => s + (p.params.volumeMm3 || 0), 0);
    const triCount = assembly.parts.reduce((s, p) => s + (p.params.triCount || 0), 0);
    return { ok: true, assembly, part: assembly.parts[0], parts: assembly.parts.length, volumeMm3, triCount };
  }

  if (name === 'resolve_constraints') {
    const { resolveConstraints } = await import('./assembly-constraints.mjs');
    return { ok: true, assembly: resolveConstraints(args.assembly) };
  }

  if (name === 'render_preview') {
    const { renderPreview } = await import('./render-preview.mjs');
    const { pngs, triCount } = renderPreview(args.assembly, { ...(Array.isArray(args.views) && args.views.length ? { views: args.views } : {}) });
    const res = { ok: true, triCount, parts: args.assembly?.parts?.length ?? 0 };
    if (args.outDir) {
      const fs = await import('node:fs'), path = await import('node:path');
      fs.mkdirSync(args.outDir, { recursive: true });
      res.files = [];
      for (const [v, buf] of Object.entries(pngs)) { const fp = path.join(args.outDir, `preview_${v}.png`); fs.writeFileSync(fp, buf); res.files.push({ name: `preview_${v}.png`, bytes: buf.length }); }
      res.outDir = args.outDir;
    } else {
      res.views = {};
      for (const [v, buf] of Object.entries(pngs)) res.views[v] = buf.toString('base64');
    }
    return res;
  }

  if (name === 'list_templates') {
    return { ok: true, ...(args.domain ? { domain: args.domain } : {}), templates: listAssemblyTemplates(args.domain) };
  }

  if (name === 'generate_domain_package') {
    // 앞문: 분야 템플릿 → 결정론 어셈블리 → generate_package 와 동일 도시에.
    const asm = buildAssemblyTemplate(args.domain, args.templateId, args.params ?? {});
    if (!asm) return { ok: false, error: `unknown template '${args.domain}/${args.templateId}' — list_templates 로 확인` };
    if (asm.ok === false || (Array.isArray(asm.alignmentErrors) && asm.alignmentErrors.length)) {
      // 정직 거부: 입력값 불가를 기본값으로 덮지 않는다.
      return { ok: false, error: asm.error ?? 'invalid_params', paramErrors: asm.paramErrors ?? asm.alignmentErrors ?? [], message: asm.message };
    }
    return callTool('generate_package', { assembly: asm, outDir: args.outDir, title: args.title ?? asm.name, withStep: args.withStep });
  }

  if (name === 'generate_package') {
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.mkdirSync(args.outDir, { recursive: true });
    const built = buildAssembly(args.assembly);
    if (!built.ok) return { ok: false, gateErrors: built.gateErrors };
    const title = args.title ?? args.assembly.name ?? 'NexyFab 설계';
    const pkg = await import('./package.mjs');
    const boqm = await import('./boq.mjs');
    const pd = await import('./pid_dossier.mjs');
    const dxfm = await import('./dxf-export.mjs');
    const ps = await import('./part-sheets.mjs');
    const fsp = await import('./fab-spec.mjs');
    const dc = await import('./drawing-completeness.mjs');
    const rnd = await import('./html-render.mjs');
    const files = [];
    const save = (nm, content) => { const p = path.join(args.outDir, nm); fs.writeFileSync(p, content); files.push({ name: nm, bytes: content.length }); };
    const revHistory = Array.isArray(args.assembly.revisions)
      ? args.assembly.revisions.map((r, i) => ({ rev: String(i + 1), date: r.at ? new Date(r.at).toISOString().slice(0, 10) : '', note: `${r.kind ?? 'edit'} ${r.target ?? ''} ${r.note ?? ''}`.trim().slice(0, 90) }))
      : undefined;
    let completeness = null, c9 = null;
    let gaHtml = '', sheetsHtml = '';
    try { const ga = pkg.ga2dDrawing(args.assembly, { title, domain: args.assembly.domain ?? 'mech', welds: built.welds, ...(revHistory ? { revHistory } : {}) }); gaHtml = ga; save('GA_2D_drawing.html', ga); completeness = dc.checkDrawingCompleteness(ga); } catch (e) { files.push({ name: 'GA_2D_drawing.html', error: String(e).slice(0, 120) }); }
    try { save('structural.html', pkg.structuralReport(args.assembly, { title })); } catch { /* skip */ }
    // ③ 형상+검증: 어셈블리 검증 메타(옹벽 등) → 분야 KDS 계산기 실행값(전도·활동·지지력…). 메타 없으면 미생성(정직).
    try { const dv = await import('./domain-dossier-verify.mjs'); const vh = dv.verificationReportHtml(args.assembly, { title, params: args.verifyParams ?? {} }); if (vh) save('검증.html', vh); } catch { /* skip */ }
    try { save('BOQ.html', boqm.boqReport(args.assembly, { title, domain: args.assembly.domain ?? 'mech' })); } catch { /* skip */ }
    try { save('Dossier.html', pd.dossierReport(args.assembly, { title })); } catch { /* skip */ }
    try { sheetsHtml = ps.partSheets(args.assembly, { title: title + ' — 부품 제작도' }); save('부품제작도.html', sheetsHtml); } catch { /* skip */ }
    try { save('제작사양서.html', await fsp.fabricationSpec(args.assembly, { title: title + ' — 제작 사양서' })); } catch { /* skip */ }
    try { const d = dxfm.dxfPlan(args.assembly, args.assembly.domain ?? 'mech', undefined, { title, dwgNo: 'NX-GA-001' }); if (d) { save('GA_plan.dxf', d); c9 = dc.checkDxfLayers(d); } } catch { /* skip */ }
    try { save('GA_3D.html', await rnd.renderColoredHtml({ assembly: args.assembly }, { title, subtitle: 'nexyfab 자동생성 GA(비법정)' })); } catch (e) { files.push({ name: 'GA_3D.html', error: String(e).slice(0, 120) }); }
    let step = null;
    let roundtrip = null;
    if (args.withStep) {
      try { const r = await intentToStep(built.composeIntent); save('model.step', r.step); step = { entities: r.entities, dropped: r.fuseReport?.dropped ?? [] }; } catch (e) { step = { error: String(e).slice(0, 120) }; }
      // A1: STEP 동봉 시 라운드트립 정합 자동(생성≠검증)
      try { roundtrip = await stepRoundTrip(args.assembly); } catch (e) { roundtrip = { error: String(e).slice(0, 120) }; }
    }
    // B1: 잔여 간섭이 있으면 의심쌍 메시 부울 1패스 자동(과탐 해제·실측 관통량)
    let interferenceRefine = null;
    if ((built.interferences ?? []).length) {
      try { interferenceRefine = await refineInterferencesMesh(args.assembly, built.interferences); } catch (e) { interferenceRefine = { error: String(e).slice(0, 120) }; }
    }
    // T2(260719b): 실시 검도 M1~M6 — GA+부품도 기입 치수 결정론 대조(웹 라우트와 동급)
    let executionGate = null;
    try {
      const eg = await import('./execution-gate.mjs');
      executionGate = eg.checkExecutionReadiness(args.assembly, { gaHtml, sheetsHtml, welds: built.welds ?? [] });
    } catch (e) { executionGate = { error: String(e).slice(0, 120) }; }
    // 일반인용 쉬운 요약(260719) — 전문가 산출물을 쉬운 말 5섹션 1페이지로(검도 결과 반영)
    try { const es = await import('./easy-summary.mjs'); save('쉬운요약.html', es.easySummary(args.assembly, { title, domain: args.assembly.domain ?? 'mech', fileNames: files.map((f) => f.name), ...(executionGate && !executionGate.error ? { executionGate } : {}) })); } catch { /* skip */ }
    // 체결 자동(260719b): 플랜지 짝 볼트 세트 — BOM 보조(강도등급·개스킷=입력 명시)
    let fasteners = null;
    try { const fa = await import('./fastener-auto.mjs'); fasteners = fa.autoFasteners(args.assembly); } catch (e) { fasteners = { error: String(e).slice(0, 120) }; }
    return { ok: true, outDir: args.outDir, files, completeness, c9, step, roundtrip, interferenceRefine, executionGate, fasteners, note: '비법정 — 제작용 실시도서+검토 계산서. 인허가 도서=유자격 기술사 날인 영역.' };
  }
  if (name === 'verify_domain') {
    return verifyDomain({
      intent: args.intent, domain: args.domain, calculatorId: args.calculatorId,
      memberRef: args.memberRef, params: args.params ?? {}, standardId: args.standardId ?? 'KDS',
    });
  }
  if (name === 'analyze_fea') {
    let scad = typeof args.scad === 'string' && args.scad ? args.scad : null;
    if (!scad && args.intent) { try { scad = emitComposite(args.intent); } catch (e) { return { ok: false, error: `intent → scad 변환 실패: ${String(e?.message ?? e)}` }; } }
    if (!scad) return { ok: false, error: 'scad 또는 intent(compose_3d 산출)가 필요합니다.' };
    const loadKg = Number(args.loadKg);
    if (!Number.isFinite(loadKg) || loadKg <= 0) return { ok: false, error: '상면 등가 하중(loadKg, 0 초과)을 명시하세요 — 하중 날조 금지.' };
    return remoteCall('/api/nexyfab/drawing/fea-quick/', { scad, materialKey: args.materialKey ?? 'steel', loadKg, precise: args.precise === true }, 'analyze_fea');
  }
  if (name === 'reconstruct_verify') {
    const shaped = await shapeReconstructInput(args);
    if (shaped.error) return { ok: false, error: shaped.error };
    const r = await remoteCall(shaped.route, shaped.body, 'reconstruct_verify');
    return finalizeReconstruct(r);
  }
  if (name === 'reconstruct_fleet') {
    let stlBase64 = typeof args.stlBase64 === 'string' && args.stlBase64 ? args.stlBase64 : null;
    if (!stlBase64 && args.file) { try { const fs = await import('node:fs'); stlBase64 = fs.readFileSync(args.file).toString('base64'); } catch (e) { return { ok: false, error: `STL 읽기 실패: ${String(e?.message ?? e)}` }; } }
    if (!stlBase64) return { ok: false, error: 'STL 파일(file) 또는 stlBase64 가 필요합니다.' };
    const r = await remoteCall('/api/nexyfab/reverse-engineer/', { stlBase64, mode: 'ai-fleet', ...(Number.isFinite(args.attempts) ? { attempts: args.attempts } : {}) }, 'reconstruct_fleet');
    if (!r || r.ok === false) return r;
    return { ok: true, aiFleet: r.aiFleet ?? { note: '응답에 aiFleet 없음(모드 미적용?)' }, ...(r.observedStats ? { observedStats: r.observedStats } : {}), ...(r.usage ? { usage: r.usage } : {}) };
  }
  if (name === 'code_check') {
    return runCodeCheckTool({ features: args.features, list: args.list === true });
  }
  if (name === 'interior_check') {
    return interiorCheck(args.assembly, args.params ?? {});
  }
  if (name === 'landscape_check') {
    return landscapeCheck(args.assembly, args.params ?? {});
  }
  if (name === 'bridge_check') {
    // 라우트와 동일 자동 디스패치: 어셈블리 meta → 아치·트러스·사장·현수·계단, 없으면 거더 폴백.
    const asm = args.assembly ?? {};
    const disp = BRIDGE_DISPATCH.find((d) => asm[d.meta] && typeof bridgeMod[d.fn] === 'function');
    const fn = disp ? bridgeMod[disp.fn] : bridgeMod.bridgeCheck;
    return fn(args.assembly, args.params ?? {});
  }
  if (name === 'load_path') {
    if (args.list === true) return { ok: true, usages: loadPathUsages(), ref: 'KDS 41 12 00:2022 표 3.2-1' };
    return loadPathCheck(args.assembly, args.params ?? {});
  }
  throw new Error(`unknown tool: ${name}`);
}

// ---- JSON-RPC over stdio ---- (직접 실행 시에만 — cli.mjs 가 import 해 도구면 재사용)
import { pathToFileURL as _p2f } from 'node:url';
const IS_MAIN = process.argv[1] && import.meta.url === _p2f(process.argv[1]).href;
const rl = IS_MAIN ? createInterface({ input: process.stdin }) : null;
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

rl?.on('line', async (line) => {
  line = line.trim();
  if (!line) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    if (method === 'initialize') {
      reply({
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'nexyfab-drawing-to-3d', version: '0.1.0' },
      });
    } else if (method === 'notifications/initialized' || method === 'initialized') {
      // notification
    } else if (method === 'ping') {
      reply({});
    } else if (method === 'tools/list') {
      reply({ tools });
    } else if (method === 'tools/call') {
      try {
        const result = await callTool(params.name, params.arguments ?? {});
        reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        reply({ content: [{ type: 'text', text: `ERROR: ${e.message}` }], isError: true });
      }
    } else if (id !== undefined) {
      fail(-32601, `method not found: ${method}`);
    }
  } catch (e) {
    fail(-32603, e.message);
  }
});
