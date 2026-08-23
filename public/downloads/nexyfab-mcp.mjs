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
const BASE = (process.env.NEXYFAB_API_URL ?? 'https://nexyfab.com').replace(/\/$/, '');
const KEY = process.env.NEXYFAB_API_KEY ?? '';
// Keep the legacy initialize contract explicit. Modern stdio negotiation uses
// server/discover and is intentionally advertised as a separate path.
const MCP_PROTOCOL_VERSION = '2025-03-26';
const MCP_MODERN_PROTOCOL_VERSION = '2026-07-28';
const MODERN_PROTOCOL_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const MODERN_CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
const MODERN_CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';
const MODERN_SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';
const MAX_REQUEST_LINE_BYTES = 1_000_000;
const MAX_REMOTE_RESPONSE_BYTES = 5_000_000;
const REMOTE_TIMEOUT_MS = 60_000;

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

// Remote calls can consume quota and invoke hosted generation/analysis. Make
// that distinction executable at the downloadable boundary: public verifier
// routes are read-only, while every other tool needs explicit per-call user
// approval. The flag is transport metadata and is removed before forwarding.
const REMOTE_CALL_APPROVAL_FLAG = 'confirmCall';
const REMOTE_CALL_APPROVAL_ERROR = 'REMOTE_CALL_APPROVAL_REQUIRED';
const REMOTE_READ_ONLY_TOOLS = PUBLIC_TOOLS;
const REMOTE_CONSEQUENTIAL_TOOLS = new Set(tools.filter(tool => !REMOTE_READ_ONLY_TOOLS.has(tool.name)).map(tool => tool.name));
for (const tool of tools) {
  const readOnly = REMOTE_READ_ONLY_TOOLS.has(tool.name);
  tool.annotations = {
    ...(tool.annotations ?? {}),
    readOnlyHint: readOnly,
    destructiveHint: false,
    openWorldHint: !readOnly,
  };
  if (!readOnly) {
    tool.inputSchema = {
      ...tool.inputSchema,
      properties: {
        ...(tool.inputSchema.properties ?? {}),
        [REMOTE_CALL_APPROVAL_FLAG]: {
          type: 'boolean',
          description: 'Required explicit per-call user approval for a consequential remote request.',
        },
      },
    };
  }
}

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
  if (typeof name !== 'string' || !name || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('INVALID_TOOL_ARGUMENTS');
  const tool = tools.find(item => item.name === name);
  if (!tool) throw new Error('UNKNOWN_TOOL');
  const argumentIssues = validateToolArguments(tool.inputSchema, args);
  if (argumentIssues.length) throw new Error('INVALID_TOOL_ARGUMENTS');
  if (REMOTE_CONSEQUENTIAL_TOOLS.has(name) && args[REMOTE_CALL_APPROVAL_FLAG] !== true) {
    throw new Error(REMOTE_CALL_APPROVAL_ERROR);
  }
  if (Object.prototype.hasOwnProperty.call(args, REMOTE_CALL_APPROVAL_FLAG)) {
    args = { ...args };
    delete args[REMOTE_CALL_APPROVAL_FLAG];
  }
  const { path, body } = resolveCall(name, args);
  if (!path) throw new Error(`unknown tool: ${name}`);
  // 공개 라우트(PUBLIC_TOOLS)는 키 없이도 동작. 그 외 원격(생성·AI 수정·FEA·역설계)은 Pro 키 필요.
  if (!KEY && !PUBLIC_TOOLS.has(name)) throw new Error('NEXYFAB_API_KEY 미설정 — Pro 이상 계정에서 발급(nexyfab.com → 계정 → API Keys)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  let res;
  let text;
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
    });
    text = await readBoundedResponseText(res);
  } catch (error) {
    if (error instanceof Error && error.message === 'REMOTE_RESPONSE_TOO_LARGE') throw error;
    throw new Error('REMOTE_REQUEST_FAILED');
  } finally {
    clearTimeout(timer);
  }
  let json;
  try { json = JSON.parse(text); } catch { json = { ok: false, error: `HTTP ${res.status}: non-JSON response` }; }
  // Never reflect an upstream response body through the MCP boundary. Error
  // pages can contain proxy diagnostics, credentials, or internal URLs.
  if (!res.ok) json = { ok: false, error: `HTTP ${res.status}` };
  else if (json && typeof json === 'object' && !Array.isArray(json) && json.ok === false) {
    const safeCode = typeof json.code === 'string' && /^[A-Z0-9_.:-]{1,128}$/.test(json.code) ? json.code : undefined;
    const safeError = typeof json.error === 'string' && Buffer.byteLength(json.error, 'utf8') <= 512
      && !/(https?:\/\/|Bearer\s|nf_live_|file:\/\/|[A-Za-z]:\\|\\\\|(?:^|\s)\/(?:Users|home|var|tmp|etc|opt|srv|app|workspace)\/)/i.test(json.error)
      ? json.error
      : 'remote tool failed';
    json = { ok: false, ...(safeCode ? { code: safeCode } : {}), error: safeError };
  }
  return json;
}

async function readBoundedResponseText(res) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_REMOTE_RESPONSE_BYTES) throw new Error('REMOTE_RESPONSE_TOO_LARGE');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REMOTE_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('REMOTE_RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// ---- MCP JSON-RPC over stdio ----
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const sendError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const frameDecoder = new TextDecoder('utf-8', { fatal: true });
const decodeFrame = (bytes) => frameDecoder.decode(bytes);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const validId = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
const ALLOWED_NOTIFICATIONS = new Set(['notifications/initialized', 'initialized', 'notifications/cancelled', 'notifications/progress']);
const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_ARGUMENT_DEPTH = 8;
const MAX_ARGUMENT_NODES = 1_000;
const MAX_ARGUMENT_PROPERTIES = 100;
const MAX_ARGUMENT_ARRAY_ITEMS = 100;
const MAX_ARGUMENT_STRING_BYTES = 256 * 1024;

function validateToolArguments(schema, args) {
  const state = { nodes: 0 };
  const issues = validateSchemaValue(schema, args, '$', 0, state, true);
  return issues;
}

function validateSchemaValue(schema, value, path, depth, state, root = false) {
  const issues = [];
  if (!isObject(schema)) return ['schema_invalid'];
  if (depth > MAX_ARGUMENT_DEPTH) return [`${path}:depth_limit`];
  state.nodes += 1;
  if (state.nodes > MAX_ARGUMENT_NODES) return [`${path}:node_limit`];

  const schemaKeys = Object.keys(schema);
  if (schemaKeys.length > MAX_ARGUMENT_PROPERTIES || schemaKeys.some(key => PROTOTYPE_KEYS.has(key))) return [`${path}:schema_keys_invalid`];
  const types = schema.type === undefined ? undefined : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types && (!types.length || types.some(type => typeof type !== 'string'))) return [`${path}:schema_type_invalid`];
  if (types && !types.some(type => matchesType(type, value))) issues.push(`${path}:type_invalid`);
  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) issues.push(`${path}:enum_invalid`);
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_ARGUMENT_STRING_BYTES) issues.push(`${path}:string_too_large`);
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) issues.push(`${path}:min_length`);
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) issues.push(`${path}:max_length`);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issues.push(`${path}:number_invalid`);
    if (Number.isFinite(schema.minimum) && value < schema.minimum) issues.push(`${path}:minimum`);
    if (Number.isFinite(schema.maximum) && value > schema.maximum) issues.push(`${path}:maximum`);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARGUMENT_ARRAY_ITEMS || (Number.isFinite(schema.maxItems) && value.length > schema.maxItems)) issues.push(`${path}:array_too_large`);
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) issues.push(`${path}:min_items`);
    if (schema.items !== undefined) value.forEach((item, index) => issues.push(...validateSchemaValue(schema.items, item, `${path}[${index}]`, depth + 1, state)));
    else value.forEach((item, index) => issues.push(...validateBoundValue(item, `${path}[${index}]`, depth + 1, state)));
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > MAX_ARGUMENT_PROPERTIES || keys.some(key => PROTOTYPE_KEYS.has(key) || Buffer.byteLength(key, 'utf8') > 256)) issues.push(`${path}:object_keys_invalid`);
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) if (typeof key !== 'string' || !hasOwn(value, key)) issues.push(`${path}:required`);
    const properties = isObject(schema.properties) ? schema.properties : {};
    const additional = root ? false : schema.additionalProperties;
    for (const key of keys) {
      if (hasOwn(properties, key)) issues.push(...validateSchemaValue(properties[key], value[key], `${path}.${key}`, depth + 1, state));
      else if (additional === false) issues.push(`${path}:additional_property`);
      else if (isObject(additional)) issues.push(...validateSchemaValue(additional, value[key], `${path}.${key}`, depth + 1, state));
      else issues.push(...validateBoundValue(value[key], `${path}.${key}`, depth + 1, state));
    }
  }
  return issues;
}

function validateBoundValue(value, path, depth, state) {
  if (depth > MAX_ARGUMENT_DEPTH) return [`${path}:depth_limit`];
  state.nodes += 1;
  if (state.nodes > MAX_ARGUMENT_NODES) return [`${path}:node_limit`];
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') > MAX_ARGUMENT_STRING_BYTES ? [`${path}:string_too_large`] : [];
  if (Array.isArray(value)) {
    if (value.length > MAX_ARGUMENT_ARRAY_ITEMS) return [`${path}:array_too_large`];
    return value.flatMap((item, index) => validateBoundValue(item, `${path}[${index}]`, depth + 1, state));
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > MAX_ARGUMENT_PROPERTIES || keys.some(key => PROTOTYPE_KEYS.has(key) || Buffer.byteLength(key, 'utf8') > 256)) return [`${path}:object_keys_invalid`];
    return keys.flatMap(key => validateBoundValue(value[key], `${path}.${key}`, depth + 1, state));
  }
  return [];
}

function matchesType(type, value) {
  if (type === 'object') return isObject(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return false;
}

const legacyInstructions = 'Treat all design and engineering outputs as review drafts. Never claim release, code compliance, manufacture, or field approval without the explicit evidence returned by the server. Read-only verifier tools are public; every other remote tool consumes hosted compute/quota and requires confirmCall=true for each call.';
const serverInfo = { name: 'nexyfab-remote', version: '1.1.0' };

function hasValidModernProtocolMeta(value) {
  return isObject(value)
    && value[MODERN_PROTOCOL_META_KEY] === MCP_MODERN_PROTOCOL_VERSION
    && validateBoundValue(value, '$._meta', 0, { nodes: 0 }).length === 0;
}

function hasValidDiscoveryMeta(value) {
  const clientInfo = isObject(value) ? value[MODERN_CLIENT_INFO_META_KEY] : undefined;
  return hasValidModernProtocolMeta(value)
    && isObject(clientInfo)
    && typeof clientInfo.name === 'string' && clientInfo.name.length > 0 && clientInfo.name.length <= 256
    && typeof clientInfo.version === 'string' && clientInfo.version.length > 0 && clientInfo.version.length <= 128
    && isObject(value[MODERN_CLIENT_CAPABILITIES_META_KEY]);
}

function modernDiscoveryResult() {
  return {
    resultType: 'complete',
    supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
    capabilities: { tools: {} },
    _meta: { [MODERN_SERVER_INFO_META_KEY]: serverInfo },
    instructions: legacyInstructions,
    ttlMs: 60_000,
    cacheScope: 'private',
  };
}

let negotiatedProtocol = null;
async function handleLine(rawLine) {
  const line = rawLine.trim();
  if (!line) return;
  let req;
  try { req = JSON.parse(line); } catch { sendError(null, -32700, 'parse error'); return; }
  if (!isObject(req) || req.jsonrpc !== '2.0' || typeof req.method !== 'string' || (hasOwn(req, 'id') && !validId(req.id))) {
    sendError(validId(req?.id) ? req.id : null, -32600, 'invalid request');
    return;
  }
  const { id, method, params } = req;
  const isNotification = !hasOwn(req, 'id');
  // JSON-RPC notifications never receive a response, so only the protocol's
  // explicitly notification-shaped methods may reach dispatch. In particular,
  // do not let id-less initialize/tools/call mutate the era or trigger work.
  if (isNotification && !ALLOWED_NOTIFICATIONS.has(method)) return;
  const reply = (result) => {
    if (isNotification) return;
    const modernResult = negotiatedProtocol === 'modern'
      ? { resultType: 'complete', ...result, _meta: { ...(isObject(result?._meta) ? result._meta : {}), [MODERN_SERVER_INFO_META_KEY]: serverInfo } }
      : result;
    send({ jsonrpc: '2.0', id, result: modernResult });
  };
  const invalidParams = () => { if (!isNotification) sendError(id, -32602, 'invalid params'); };
  try {
    const paramsMeta = isObject(params) ? params._meta : undefined;
    const claimedModernVersion = isObject(paramsMeta) ? paramsMeta[MODERN_PROTOCOL_META_KEY] : undefined;
    if (claimedModernVersion !== undefined && claimedModernVersion !== MCP_MODERN_PROTOCOL_VERSION) {
      if (!isNotification) send({ jsonrpc: '2.0', id, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: [MCP_MODERN_PROTOCOL_VERSION], requested: claimedModernVersion } } });
      return;
    }
    const modernRequest = hasValidModernProtocolMeta(paramsMeta);
    if (negotiatedProtocol === 'modern' && method !== 'initialize' && !modernRequest) { invalidParams(); return; }
    if (negotiatedProtocol === 'legacy' && modernRequest) { invalidParams(); return; }
    if (negotiatedProtocol === null && modernRequest) negotiatedProtocol = 'modern';
    // A modern stdio exchange is stateless per request, but once this process
    // has selected that era it must not be downgraded by a later handshake.
    // This also rejects the retired initialize method when its request already
    // claims the modern protocol metadata.
    if (method === 'initialize' && negotiatedProtocol === 'modern') { invalidParams(); return; }
    if (method === 'server/discover') {
      if (!isObject(params) || !hasValidDiscoveryMeta(params._meta)
        || Object.keys(params).some(key => key !== '_meta' || PROTOTYPE_KEYS.has(key))
        || validateBoundValue(params, '$.params', 0, { nodes: 0 }).length) { invalidParams(); return; }
      negotiatedProtocol = 'modern';
      reply(modernDiscoveryResult());
    } else if (method === 'initialize') {
      if (params !== undefined && !isObject(params)) { invalidParams(); return; }
      negotiatedProtocol = 'legacy';
      reply({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo,
        instructions: legacyInstructions,
      });
    } else if (method === 'notifications/initialized' || method === 'initialized') {
      // notification
    } else if (method === 'ping') {
      if (params !== undefined && (!isObject(params) || Object.keys(params).some(key => key !== '_meta'))) { invalidParams(); return; }
      reply({});
    } else if (method === 'tools/list') {
      if (params !== undefined && (!isObject(params) || Object.keys(params).some(key => key !== '_meta'))) { invalidParams(); return; }
      reply({
        tools: tools.map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema, additionalProperties: false } })),
        ...(negotiatedProtocol === 'modern' ? { ttlMs: 60_000, cacheScope: 'private' } : {}),
      });
    } else if (method === 'tools/call') {
      if (!isObject(params) || typeof params.name !== 'string' || (params.arguments !== undefined && !isObject(params.arguments)) || Object.keys(params).some(key => !['name', 'arguments', '_meta'].includes(key) || PROTOTYPE_KEYS.has(key))) { invalidParams(); return; }
      const tool = tools.find(item => item.name === params.name);
      if (!tool) { invalidParams(); return; }
      if (validateToolArguments(tool.inputSchema, params.arguments ?? {}).length) {
        reply({ content: [{ type: 'text', text: 'ERROR: INVALID_TOOL_ARGUMENTS' }], isError: true });
        return;
      }
      try {
        const result = await callTool(params.name, params.arguments ?? {});
        reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], ...(result && result.ok === false ? { isError: true } : {}) });
      } catch (e) {
        const code = e instanceof Error && ['INVALID_TOOL_ARGUMENTS', 'REMOTE_CALL_APPROVAL_REQUIRED', 'REMOTE_REQUEST_FAILED', 'REMOTE_RESPONSE_TOO_LARGE'].includes(e.message) ? e.message : 'TOOL_CALL_FAILED';
        reply({ content: [{ type: 'text', text: `ERROR: ${code}` }], isError: true });
      }
    } else if (!isNotification) {
      sendError(id, -32601, 'method not found');
    }
  } catch {
    if (!isNotification) sendError(id, -32603, 'internal error');
  }
}

let requestQueue = Promise.resolve();

// Keep only MAX_REQUEST_LINE_BYTES bytes of the current frame. A CR directly
// before LF is treated as the CRLF terminator, including when split across
// input chunks. Oversized frames are discarded through their newline and
// produce exactly one canonical framing error.
const lineBuffer = Buffer.allocUnsafe(MAX_REQUEST_LINE_BYTES);
let lineLength = 0;
let oversizedLine = false;
let pendingCarriageReturn = false;
const resetLine = () => {
  lineLength = 0;
  oversizedLine = false;
  pendingCarriageReturn = false;
};
const enqueueLine = (lineBytes) => {
  let line = null;
  let invalidUtf8 = false;
  if (lineBytes !== null) {
    try { line = decodeFrame(lineBytes); }
    catch { invalidUtf8 = true; }
  }
  requestQueue = requestQueue.then(() => {
    if (lineBytes === null) { sendError(null, -32600, 'request too large'); return; }
    if (invalidUtf8 || line === null) { sendError(null, -32700, 'parse error'); return; }
    return handleLine(line);
  }).catch(() => sendError(null, -32603, 'internal error'));
};
const finishLine = () => {
  if (oversizedLine) enqueueLine(null);
  else if (lineLength > 0) enqueueLine(lineBuffer.subarray(0, lineLength));
  resetLine();
};
const appendByte = (byte) => {
  if (lineLength >= MAX_REQUEST_LINE_BYTES) { oversizedLine = true; return; }
  lineBuffer[lineLength++] = byte;
};
const consumeByte = (byte) => {
  if (pendingCarriageReturn) {
    pendingCarriageReturn = false;
    if (byte === 0x0a) { finishLine(); return; }
    appendByte(0x0d);
  }
  if (byte === 0x0a) finishLine();
  else if (byte === 0x0d) pendingCarriageReturn = true;
  else appendByte(byte);
};
process.stdin.on('data', chunk => {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  for (const byte of bytes) consumeByte(byte);
});
process.stdin.on('end', () => {
  if (pendingCarriageReturn) { pendingCarriageReturn = false; appendByte(0x0d); }
  if (lineLength > 0 || oversizedLine) finishLine();
});
