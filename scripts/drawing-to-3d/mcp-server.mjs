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
import { gate, toOpenScad } from './reconstruct.mjs';
import { toComponentIntent } from './to-intent.mjs';

const VOCAB = 'plate_with_holes | stepped_plate | l_bracket | flange | bent_sheet';

const tools = [
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
];

async function callTool(name, args = {}) {
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
  throw new Error(`unknown tool: ${name}`);
}

// ---- JSON-RPC over stdio ----
const rl = createInterface({ input: process.stdin });
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

rl.on('line', async (line) => {
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
