#!/usr/bin/env node
/**
 * NexyFab Remote MCP Server (단일 파일 — 의존성 0, Node 18+)
 *
 * NexyFab 호스팅 API 를 MCP 도구로 노출 — Claude Code/Claude Desktop 등 MCP 클라이언트에서
 * 텍스트→어셈블리 생성, 부품 단위 AI 수정, 면 푸시풀, 부품 연산을 바로 사용.
 *
 * 준비: NexyFab Pro 이상 계정에서 API 키 발급(계정 → API Keys) 후:
 *   claude mcp add nexyfab -e NEXYFAB_API_KEY=nf_live_xxx -- node <이 파일 경로>
 *   (선택) NEXYFAB_API_URL 기본 https://nexyfab.com
 *
 * 원칙: AI=이해만, 형상·검증=서버 결정론 게이트(간섭·지지·구조). 산출물=비법정
 * (제작용 실시도서+검토 계산서 — 인허가 도서는 유자격 기술사 날인 영역).
 */
import { createInterface } from 'node:readline';

const BASE = (process.env.NEXYFAB_API_URL ?? 'https://nexyfab.com').replace(/\/$/, '');
const KEY = process.env.NEXYFAB_API_KEY ?? '';

// 공개 라우트(순수 결정론 — 인증 불필요, 키 없이도 동작): 코드체크·분야 검증 계산기·분야 검증 체인.
// 그 외(생성·AI 수정·FEA·역설계 등 호스팅 엔진)는 Pro 키 필요.
const PUBLIC_TOOLS = new Set(['code_check', 'verify_domain', 'interior_check', 'landscape_check', 'bridge_check', 'load_path']);

const ASM_DESC = '{name, parts:[{id,type,params,at:{tx,ty,tz,rx,ry,rz}}...]} — design_assembly 응답의 assembly 를 그대로 전달';

const tools = [
  {
    name: 'design_assembly',
    description: '자연어 → 다부품 어셈블리 생성(AI 계획 + 결정론 게이트: 어휘·간섭·지지·구조). 반환: assembly(수정 체인의 입력), openscad, parts(월드 AABB), draft(1차 골격), interferences, structural.',
    inputSchema: { type: 'object', required: ['description'], properties: { description: { type: 'string', description: '예: "베이스 플레이트 1000x800x20 위에 지름 200 높이 400 원통 기둥 2개…"' } } },
  },
  {
    name: 'compose_part',
    description: '자연어 → 단일 부품(범용 프리미티브 조합 intent + SCAD). 게이트 통과분만 반환.',
    inputSchema: { type: 'object', required: ['description'], properties: { description: { type: 'string' } } },
  },
  {
    name: 'edit_part',
    description: '🎯 어셈블리에서 선택 부품만 AI 수정 — 대상 외 부품 불변은 서버 코드가 보장, 적용 전 결정론 게이트. REV 이력 자동. 반환 assembly 로 체인 계속.',
    inputSchema: {
      type: 'object', required: ['assembly', 'partId', 'instruction'],
      properties: { assembly: { type: 'object', description: ASM_DESC }, partId: { type: 'string' }, instruction: { type: 'string' }, face: { type: 'object', description: "{face:'z+|axis+|radial'} 선택" } },
    },
  },
  {
    name: 'face_drag',
    description: '면 푸시풀(AI 없음, 결정론) — 명명 면(box: x±/y±/z± · 회전체: axis±/radial) + deltaMm(±) 또는 targetMm(치수 직접 지정). 모호=정직 거부.',
    inputSchema: {
      type: 'object', required: ['assembly', 'partId', 'face'],
      properties: { assembly: { type: 'object', description: ASM_DESC }, partId: { type: 'string' }, face: { type: 'string' }, deltaMm: { type: 'number' }, targetMm: { type: 'number' } },
    },
  },
  {
    name: 'part_op',
    description: '부품 일괄 연산(AI 없음) — delete | duplicate(+opts.offset[3]) | translate(opts{dx,dy,dz}) | fillet(opts{r} → STEP 에만 반영·표시 무필렛 명시).',
    inputSchema: {
      type: 'object', required: ['assembly', 'op', 'partIds'],
      properties: { assembly: { type: 'object', description: ASM_DESC }, op: { type: 'string', enum: ['delete', 'duplicate', 'translate', 'fillet'] }, partIds: { type: 'array', items: { type: 'string' } }, opts: { type: 'object' } },
    },
  },
  {
    name: 'domain_design',
    description: '비-기계 도메인 설계 검증(토목·인테리어·건설·조경) — 자연어 브리프 → LLM 계획 + 결정론 코드 게이트(토목: 휨·처짐·좌굴·옹벽·사면 / 인테리어: 피난동선·유효폭·수용인원·복도·위생·반자 / 건설: 물량·철근·공정·거푸집·비용·토공 / 조경: 관수·배수·식재·조경면적·객토) → 검증 패키지 또는 명시 거부(stage·reason·failedGateIds). 산출물=검토 초안(면허 기술사/건축사 최종 책임·"대체" 아님).',
    inputSchema: {
      type: 'object', required: ['domain', 'brief'],
      properties: {
        domain: { type: 'string', enum: ['civil', 'interior', 'construction', 'landscape'], description: 'civil(토목)|interior(인테리어)|construction(건설)|landscape(조경)' },
        brief: {
          type: 'object', required: ['id'],
          properties: {
            id: { type: 'string' },
            text: { type: 'string', description: '자유텍스트 설계 요구(예: "6m 강재 보, 등분포하중 20kN/m")' },
            params: { type: 'object', description: "결정론 픽스처 사용 시 {fixture:'steel-beam'|'office-floor'|'rc-frame'|'park-plaza'}" },
          },
        },
      },
    },
  },
  {
    name: 'analyze_fea',
    description: '간이 FEA(구조 — 선형정적만) — scad + 재료(materialKey) + 상면 등가 하중(loadKg, 날조 금지·명시 필수) → 안전율/최대응력/변위/리포트. precise=true 면 gmsh 정밀 메시(느림). 열/모달/열탄성은 이 도구로 불가(온도·주파수 입력 없음). 원격(서버 OpenSCAD/gmsh)·선형등방 스크리닝·비법정.',
    inputSchema: { type: 'object', required: ['scad', 'loadKg'], properties: { scad: { type: 'string', description: 'OpenSCAD 텍스트' }, materialKey: { type: 'string', description: '기본 steel' }, loadKg: { type: 'number', description: '상면 등가 하중 kg(0 초과)' }, precise: { type: 'boolean' } } },
  },
  {
    name: 'reconstruct_verify',
    description: '검증된 역설계 — format=stl → reverse-engineer(라운드트립), step/iges/ifc/dwg/sat/x_t → import-step(B-rep 대조). 반환 reconstructionGate{status:pass|fail|unavailable, mode, checks(bbox/genus/watertight), feedback} + suggestion(export_step). 곡면/복합=정직 실패. 원격·Pro.',
    inputSchema: { type: 'object', properties: { format: { type: 'string', description: 'stl|step|iges|ifc|dwg|sat|x_t (기본 stl)' }, stlBase64: { type: 'string', description: 'STL/바이너리(dwg·sat) base64' }, step: { type: 'string', description: 'STEP/IGES/IFC/X_T 텍스트' }, name: { type: 'string' } } },
  },
  {
    name: 'reconstruct_fleet',
    description: 'AI 재구성 함대 — STL → 다모델 파라메트릭 SCAD 제안 + 결정론 게이트 검증(피드백·계열 전환). 반환 aiFleet{passed,verified,attemptsUsed,seriesSwitched,familiesUsed,feedback}. 원격+Pro·비용 소모(복잡 부품 비통과 정상·날조 통과 없음).',
    inputSchema: { type: 'object', required: ['stlBase64'], properties: { stlBase64: { type: 'string' }, attempts: { type: 'integer', description: '서버 상한 적용(현재 3)' } } },
  },
  {
    name: 'code_check',
    description: '코드체크/감리 보조(결정론) — 측정 피처 → 공개 법령 조항 인용 PASS/FAIL/NA + 실측 vs 요구. 41룰 12카테고리: 주차·피난방화·계단·경사로·복도·난간·출입구·승강기·접근로·위생·건축(구조/일조/건폐율)·실내건축(접근성). 피처 미제공=NA(준수 가정 안 함). {list:true}=41룰 카탈로그(키 목록). 순수 룰셋 — 키 없이도 동작(공개 라우트). 비법정(disclaimer 동봉).',
    inputSchema: { type: 'object', properties: { features: { type: 'object' }, list: { type: 'boolean' } } },
  },
  {
    name: 'verify_domain',
    description: '분야별 공학 계산기 검증(공개 라우트·키 불필요) — compose intent + domain + calculatorId → 형상 파생 단면/경간 + 사용자 하중/재료로 실제 계산. 5분야: temporary-rack(column_buckling|simple_beam)·building-member(rc_beam|rc_column_pm|isolated_footing)·civil(retaining_wall_stability|box_culvert_frame)·interior(occupancy_egress)·landscape(timber_beam|timber_nail|landscape_drainage). 반환 verdict/checks/derived/citations/refs/status/disclaimer. 하중 누락=needInputs(지어내지 않음). {list:true}=분야·입력 명세. 계산기=draft(비법정).',
    inputSchema: { type: 'object', properties: { intent: { type: 'object' }, domain: { type: 'string' }, calculatorId: { type: 'string' }, memberRef: {}, params: { type: 'object' }, standardId: { type: 'string' }, list: { type: 'boolean' } } },
  },
  {
    name: 'interior_check',
    description: '인테리어 피난·마감 체인(공개 라우트·키 불필요) — assembly → 보행거리 BFS(최원점→출입구 우회)+수용인원/피난폭(문폭 형상 파생)+마감 물량(개구 공제). verify_domain(단일 계산기)과 달리 피난 전 과정 체인. 반환 {travel,occupancy,finishes,checks}. 미입력값 날조 없음. 비법정(건축사 최종 책임).',
    inputSchema: { type: 'object', required: ['assembly'], properties: { assembly: { type: 'object', description: ASM_DESC }, params: { type: 'object' } } },
  },
  {
    name: 'landscape_check',
    description: '조경 구조 체인(공개 라우트·키 불필요) — assembly → 목재 부재(timber_beam, 단면·스팬 형상 파생, KDS 41 50 10)+풍하중 전도(입력 풍압→FS·앵커 인발). 풍압 미입력 시 전도 정직 생략. 반환 {timber,overturning,checks}. 비법정.',
    inputSchema: { type: 'object', required: ['assembly'], properties: { assembly: { type: 'object', description: ASM_DESC }, params: { type: 'object' } } },
  },
  {
    name: 'bridge_check',
    description: '교량 검토 체인(공개 라우트·키 불필요) — assembly meta 자동 디스패치: bridgeMeta=거더교(고정+KL-510 활하중 영향선+극한 I 조합 KDS 24 12 11) / archMeta·trussMeta·cableStayedMeta·suspensionMeta·stairMeta=아치·트러스·사장·현수·산업계단 간이 폐형 체인. meta 없으면 거더 폴백. 반환 {loads,checks,verdict}. 비법정(기술사 날인 별도).',
    inputSchema: { type: 'object', required: ['assembly'], properties: { assembly: { type: 'object', description: ASM_DESC + ' + bridgeMeta|archMeta|trussMeta|cableStayedMeta|suspensionMeta|stairMeta' }, params: { type: 'object' } } },
  },
  {
    name: 'load_path',
    description: '건축 하중경로 자동 체인(공개 라우트·키 불필요) — assembly → 슬래브 자중(형상)+활하중(KDS 41 12 00 용도표)→하중조합→보(rc_beam)→기둥(rc_column_pm)→기초(isolated_footing). 웹 라우트는 슬래브 SLS 처짐(Mindlin)도 동봉. 하중 날조 없음(자중=형상·활하중=표·철근/기초/지반=입력). 반환 {loads,beams,columns,footings,checks,slabSLS}. 비법정.',
    inputSchema: { type: 'object', required: ['assembly'], properties: { assembly: { type: 'object', description: ASM_DESC }, params: { type: 'object' } } },
  },
];

const ROUTE = {
  design_assembly: '/api/nexyfab/drawing/assemble/',
  compose_part: '/api/nexyfab/drawing/compose/',
  edit_part: '/api/nexyfab/drawing/edit-part/',
  face_drag: '/api/nexyfab/drawing/face-drag/',
  part_op: '/api/nexyfab/drawing/part-op/',
  domain_design: '/api/nexyfab/domain-design/',
  analyze_fea: '/api/nexyfab/drawing/fea-quick/',
  code_check: '/api/nexyfab/codecheck/',
  verify_domain: '/api/nexyfab/drawing/verify-domain/',
  interior_check: '/api/nexyfab/drawing/interior-check/',
  landscape_check: '/api/nexyfab/drawing/landscape-check/',
  bridge_check: '/api/nexyfab/drawing/bridge-check/',
  load_path: '/api/nexyfab/drawing/load-path/',
};

function resolveCall(name, args) {
  if (name === 'reconstruct_fleet') return { path: '/api/nexyfab/reverse-engineer/', body: { stlBase64: args.stlBase64, mode: 'ai-fleet', ...(Number.isFinite(args.attempts) ? { attempts: args.attempts } : {}) } };
  if (name === 'reconstruct_verify') {
    const fmt = String(args.format ?? (args.step ? 'step' : 'stl')).toLowerCase();
    const textFmts = { step: 'step', stp: 'step', iges: 'iges', igs: 'iges', ifc: 'ifc', x_t: 'x_t', xt: 'x_t', xmt_txt: 'x_t' };
    const binFmts = { dwg: 'dwg', sat: 'sat', sab: 'sab' };
    if (fmt === 'stl') return { path: '/api/nexyfab/reverse-engineer/', body: { stlBase64: args.stlBase64 } };
    if (textFmts[fmt]) return { path: '/api/nexyfab/drawing/import-step/', body: { step: args.step, format: textFmts[fmt], ...(args.name ? { name: args.name } : {}) } };
    if (binFmts[fmt]) return { path: '/api/nexyfab/drawing/import-step/', body: { stlBase64: args.stlBase64, format: binFmts[fmt], ...(args.name ? { name: args.name } : {}) } };
    return { path: '/api/nexyfab/reverse-engineer/', body: { stlBase64: args.stlBase64 } };
  }
  return { path: ROUTE[name], body: args };
}

async function callTool(name, args = {}) {
  const { path, body } = resolveCall(name, args);
  if (!path) throw new Error(`unknown tool: ${name}`);
  // 공개 라우트(PUBLIC_TOOLS)는 키 없이도 동작. 그 외 원격(생성·AI 수정·FEA·역설계)은 Pro 키 필요.
  if (!KEY && !PUBLIC_TOOLS.has(name)) throw new Error('NEXYFAB_API_KEY 미설정 — Pro 이상 계정에서 발급(nexyfab.com → 계정 → API Keys)');
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }; }
  if (!res.ok && json && json.error === undefined) json = { ok: false, error: `HTTP ${res.status}`, body: json };
  return json;
}

// ---- MCP JSON-RPC over stdio ----
const rl = createInterface({ input: process.stdin });
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
  try {
    if (method === 'initialize') {
      reply({ protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'nexyfab-remote', version: '1.0.0' } });
    } else if (method === 'notifications/initialized' || method === 'initialized') {
      // notification
    } else if (method === 'ping') {
      reply({});
    } else if (method === 'tools/list') {
      reply({ tools });
    } else if (method === 'tools/call') {
      try {
        const result = await callTool(params.name, params.arguments ?? {});
        reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], ...(result && result.ok === false ? { isError: true } : {}) });
      } catch (e) {
        reply({ content: [{ type: 'text', text: `ERROR: ${e.message}` }], isError: true });
      }
    } else if (id !== undefined) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
    }
  } catch (e) {
    if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
  }
});
