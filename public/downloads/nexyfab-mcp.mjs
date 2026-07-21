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
];

const ROUTE = {
  design_assembly: '/api/nexyfab/drawing/assemble/',
  compose_part: '/api/nexyfab/drawing/compose/',
  edit_part: '/api/nexyfab/drawing/edit-part/',
  face_drag: '/api/nexyfab/drawing/face-drag/',
  part_op: '/api/nexyfab/drawing/part-op/',
  domain_design: '/api/nexyfab/domain-design/',
};

async function callTool(name, args = {}) {
  const path = ROUTE[name];
  if (!path) throw new Error(`unknown tool: ${name}`);
  if (!KEY) throw new Error('NEXYFAB_API_KEY 미설정 — Pro 이상 계정에서 발급(nexyfab.com → 계정 → API Keys)');
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify(args),
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
