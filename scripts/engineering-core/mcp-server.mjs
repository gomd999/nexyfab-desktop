#!/usr/bin/env node
/**
 * NexyFab Engineering Core — MCP server (stdio, newline-delimited JSON-RPC 2.0).
 * Claude Code / Claude Desktop / 기타 MCP 클라이언트에서 계산기+RAG를 tool-call.
 *
 * 등록:  claude mcp add nexyfab-eng -- node <이 파일 절대경로>
 * 도구:  calc 4종(분야별) + eng_rag_search(코퍼스 검색) + eng_list_standards(튜닝 파라미터 확인)
 *
 * Wave 2 TODO: 동일 도구를 Cloudflare Worker HTTP API로 노출 + API key 발급(D1)·rate limit —
 * 외부 AI 서비스(OpenAI tools, 커스텀 에이전트)용. MCP는 로컬/개발, HTTP는 상용.
 */
import { createInterface } from 'node:readline';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculators, loadStandards, runCalculator } from './registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = join(__dirname, '..', 'knowledge-crawler', 'data', 'index');

// ---- RAG (lazy) ----
let ragChunks = null;
async function ragSearch(query, k = 5) {
  const { embedTexts, cosine } = await import('../knowledge-crawler/embed.mjs');
  if (!ragChunks) {
    if (!existsSync(INDEX_DIR)) throw new Error('RAG index 없음 — knowledge-crawler에서 node crawl.mjs && node index.mjs 먼저 실행');
    ragChunks = [];
    for (const f of readdirSync(INDEX_DIR).filter((f) => f.endsWith('.jsonl'))) {
      for (const line of readFileSync(join(INDEX_DIR, f), 'utf8').split('\n')) {
        if (line.trim()) ragChunks.push(JSON.parse(line));
      }
    }
  }
  const [qVec] = await embedTexts([query]);
  return ragChunks
    .map((c) => ({ score: cosine(qVec, c.embedding), docId: c.docId, title: c.title, page: c.page, license: c.license, text: c.text }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((h) => ({ ...h, score: +h.score.toFixed(4), text: h.text.slice(0, 500) }));
}

// ---- MCP tools ----
const standardIds = Object.keys(loadStandards());
function calcTool(c) {
  return {
    name: c.id,
    description: `[${c.domain}] ${c.title} — ${c.description} 상태: ${c.status}. 근거: ${c.refs.join(' | ')}`,
    inputSchema: {
      ...c.inputSchema,
      properties: {
        ...c.inputSchema.properties,
        standard: { type: 'string', enum: standardIds, description: `적용 기준 (기본 KDS). 계수는 standards/*.json에서 튜닝 가능` },
      },
    },
  };
}
const tools = [
  ...calculators.map(calcTool),
  {
    name: 'eng_rag_search',
    description: '엔지니어링 기준 코퍼스(미 연방 PD 8문서: 옹벽 EM 1110-2-2502·GEC11·GEC7, 철골 SBDH Vol.4/13/14, OSHA 3150) 시맨틱 검색. 한국어 질의 지원(bge-m3). 반환: 문서/페이지/라이선스/발췌 — 조항 인용용.',
    inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, k: { type: 'integer', minimum: 1, maximum: 20 } } },
  },
  {
    name: 'eng_list_standards',
    description: '적용 가능한 설계기준 파라미터 세트 목록과 튜닝 가능한 계수(φ, 안전율, Fnv 등) 전체 반환.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function callTool(name, args = {}) {
  if (name === 'eng_rag_search') return ragSearch(args.query, args.k ?? 5);
  if (name === 'eng_list_standards') return loadStandards();
  const calc = calculators.find((c) => c.id === name);
  if (!calc) throw new Error(`unknown tool: ${name}`);
  const { standard, ...input } = args;
  return runCalculator(name, input, standard ?? 'KDS');
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
        serverInfo: { name: 'nexyfab-engineering-core', version: '0.1.0' },
      });
    } else if (method === 'notifications/initialized' || method === 'initialized') {
      // notification — no response
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
