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
import { verify3d } from './verify.mjs';
import { renderHtml } from './html-render.mjs';
import { gate, toOpenScad } from './reconstruct.mjs';
import { toComponentIntent } from './to-intent.mjs';

const VOCAB = 'plate_with_holes | stepped_plate | l_bracket | flange | bent_sheet';

const tools = [
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
];

async function callTool(name, args = {}) {
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
