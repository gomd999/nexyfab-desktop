#!/usr/bin/env node
/**
 * KDS 국가건설기준 수집+인덱싱 — KCSC 공식 OpenAPI (회원 발급 인증키; 우회 아님).
 *
 * CodeViewer 응답 = 조항 단위 구조화 JSON → PDF보다 우수: 청크에 조항 라벨을 보존해
 * "KDS 11 80 05 §4.4 표 4.4-1" 수준의 정확한 조항 인용이 가능.
 *
 * 인증키: env KCSC_API_KEY 또는 C:/Users/gomd9/Downloads/.env 의 KCSC_API_KEY.
 * 라이선스: 공공누리 제1유형(출처표시) — 확인 2026-07-11. 상업 이용·변형·재배포 허용,
 *   출처 표시 필수(작은 credit으로 충분: "이용자가 인식 가능한 방법"이면 요건 충족).
 *
 * Usage: node kds.mjs [--force] [--only 118005,143110]
 * Output: data/kds/KDS_<code>.json (원문) + .meta.json / data/index/kds-<code>.jsonl (임베딩)
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedTexts } from './embed.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KDS_DIR = join(__dirname, 'data', 'kds');
const INDEX_DIR = join(__dirname, 'data', 'index');
const THROTTLE_MS = 2000;
const CHUNK_SIZE = 1000;

/** 수집 대상 (plan §7 분야 모듈과 1:1) */
const TARGETS = [
  { code: '118005', tags: ['korea', 'kds', 'civil', 'retaining-wall', 'P2'] },       // 콘크리트옹벽
  { code: '118010', tags: ['korea', 'kds', 'civil', 'retaining-wall', 'mse', 'P2'] }, // 보강토옹벽
  { code: '143105', tags: ['korea', 'kds', 'steel', 'lrfd', 'P1'] },                  // 강구조설계 일반(LRFD)
  { code: '143110', tags: ['korea', 'kds', 'steel', 'member-design', 'P1'] },         // 강구조 부재(LRFD)
  { code: '143010', tags: ['korea', 'kds', 'steel', 'asd', 'member-design', 'P1'] },                 // 강구조 부재(허용응력)
  { code: '143125', tags: ['korea', 'kds', 'steel', 'connection', 'P1'] },            // 강구조 연결(LRFD)
  { code: '213000', tags: ['korea', 'kds', 'temporary-structures', 'earth-retention', 'P1', 'P2'] }, // 가설흙막이
  { code: '215000', tags: ['korea', 'kds', 'temporary-structures', 'formwork', 'P1'] }, // 거푸집 및 동바리
  { code: '216000', tags: ['korea', 'kds', 'temporary-structures', 'scaffold', 'P1'] }, // 비계 및 안전시설물
  { code: '411200', tags: ['korea', 'kds', 'building', 'loads', 'P3'] },              // 건축물 설계하중
  // ── 건축·콘크리트 (P3 — RC 계산기 근거, 2026-07-11 API 프로브로 실존 확인) ──
  { code: '142001', tags: ['korea', 'kds', 'concrete', 'building', 'civil', 'P3'] },  // 콘크리트구조 설계(강도설계법) 일반
  { code: '142010', tags: ['korea', 'kds', 'concrete', 'building', 'civil', 'P3'] },  // 해석과 설계 원칙
  { code: '142020', tags: ['korea', 'kds', 'concrete', 'building', 'civil', 'flexure-compression', 'P3'] }, // 휨·압축
  { code: '142022', tags: ['korea', 'kds', 'concrete', 'building', 'civil', 'shear-torsion', 'P3'] },       // 전단·비틀림
  { code: '142024', tags: ['korea', 'kds', 'concrete', 'strut-tie', 'P3'] },          // 스트럿-타이
  { code: '142050', tags: ['korea', 'kds', 'concrete', 'rebar-detailing', 'P3'] },    // 철근상세
  { code: '142052', tags: ['korea', 'kds', 'concrete', 'development-splice', 'P3'] }, // 정착·이음
  { code: '142054', tags: ['korea', 'kds', 'concrete', 'anchor', 'P1', 'P3'] },       // 앵커 (베이스플레이트 계산기 근거)
  { code: '411005', tags: ['korea', 'kds', 'building', 'general', 'P3'] },            // 건축구조기준 총칙
  { code: '413010', tags: ['korea', 'kds', 'building', 'steel', 'P3'] },              // 건축물 강구조
  // ── 조경 (P4 — 스코프: 공학·구조물·배수. 미학·식재디자인은 생성AI 제안 레이어로 분리) ──
  { code: '341010', tags: ['korea', 'kds', 'landscape', 'general', 'P4'] },           // 조경설계 일반
  { code: '342010', tags: ['korea', 'kds', 'landscape', 'grading', 'P4'] },           // 지형설계
  { code: '343010', tags: ['korea', 'kds', 'landscape', 'planting-base', 'P4'] },     // 일반식재기반
  { code: '344010', tags: ['korea', 'kds', 'landscape', 'planting', 'P4'] },          // 수목식재
  { code: '345010', tags: ['korea', 'kds', 'landscape', 'structures', 'P4'] },        // 조경구조물
  { code: '346010', tags: ['korea', 'kds', 'landscape', 'pavement', 'P4'] },          // 보도포장
  { code: '347010', tags: ['korea', 'kds', 'landscape', 'river', 'P4'] },             // 자연친화적 하천조경
  // ── 목구조 (Wave A 조경 — 파고라·데크 부재 계산기 근거. 2026-07-14 API 프로브 실존 확인, 2022 현행) ──
  { code: '415005', tags: ['korea', 'kds', 'timber', 'building', 'landscape', 'general'] },   // 목구조 일반
  { code: '415010', tags: ['korea', 'kds', 'timber', 'building', 'landscape', 'allowable-stress'] }, // 목구조 재료 및 허용응력
  { code: '415015', tags: ['korea', 'kds', 'timber', 'building', 'landscape', 'design-req'] },  // 목구조 설계요구사항
  { code: '415020', tags: ['korea', 'kds', 'timber', 'building', 'landscape', 'member-design'] }, // 목구조 부재설계
  { code: '411700', tags: ['korea', 'kds', 'building', 'seismic'] },   // 건축물 내진설계기준 (등가정적 근거)
  { code: '415030', tags: ['korea', 'kds', 'timber', 'connection'] },  // 목구조 접합부의 설계
];

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const onlyArg = args.find((a) => a.startsWith('--only'));
const ONLY = onlyArg ? (onlyArg.split('=')[1] ?? args[args.indexOf(onlyArg) + 1] ?? '').split(',').filter(Boolean) : null;

function apiKey() {
  if (process.env.KCSC_API_KEY) return process.env.KCSC_API_KEY;
  const env = readFileSync('C:/Users/gomd9/Downloads/.env', 'utf8');
  const m = env.match(/^KCSC_API_KEY=(\S+)/m);
  if (!m) throw new Error('KCSC_API_KEY not found (env or Downloads/.env)');
  return m[1];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripHtml = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** 조항 리스트 → 조항 라벨 보존 청크 */
function chunkClauses(list) {
  const chunks = [];
  let buf = '', firstLabel = null, lastLabel = null, firstSort = 0;
  const flush = () => {
    if (buf.trim().length >= 60) {
      chunks.push({ text: buf.trim(), clause: firstLabel === lastLabel ? firstLabel : `${firstLabel}~${lastLabel}`, sort: firstSort });
    }
    buf = ''; firstLabel = null;
  };
  for (const c of list) {
    const text = stripHtml(c.contents ?? '');
    if (!text) continue;
    const labeled = `[${c.title} ${c.label}] ${text}`;
    if (buf && buf.length + labeled.length > CHUNK_SIZE) flush();
    if (!firstLabel) { firstLabel = `${c.title} ${c.label}`.trim(); firstSort = c.sort; }
    lastLabel = `${c.title} ${c.label}`.trim();
    buf += (buf ? ' ' : '') + labeled;
  }
  flush();
  return chunks;
}

async function main() {
  const key = apiKey();
  mkdirSync(KDS_DIR, { recursive: true });
  mkdirSync(INDEX_DIR, { recursive: true });
  let ok = 0, fail = 0, totalChunks = 0;

  for (const t of TARGETS) {
    if (ONLY && !ONLY.includes(t.code)) continue;
    const docId = `kds-${t.code}`;
    const rawPath = join(KDS_DIR, `KDS_${t.code}.json`);
    const outPath = join(INDEX_DIR, `${docId}.jsonl`);
    try {
      let doc;
      if (existsSync(rawPath) && !FORCE) {
        doc = JSON.parse(readFileSync(rawPath, 'utf8'));
        console.log(`[${docId}] using cached raw`);
      } else {
        const url = `https://kcsc.re.kr/OpenApi/CodeViewer/KDS/${t.code}?key=${key}`;
        console.log(`[${docId}] GET CodeViewer/KDS/${t.code}`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json) || !json[0]?.list) throw new Error(`unexpected response: ${JSON.stringify(json).slice(0, 120)}`);
        doc = json[0];
        writeFileSync(rawPath, JSON.stringify(doc, null, 1));
        await sleep(THROTTLE_MS);
      }
      const title = `KDS ${t.code.replace(/(\d{2})(\d{2})(\d{2})/, '$1 $2 $3')} ${doc.name} (${doc.version})`;
      const meta = {
        docId, title, publisher: '국가건설기준센터(KCSC) / 국토교통부 고시',
        sourceUrl: `https://kcsc.re.kr/OpenApi/CodeViewer/KDS/${t.code}`,
        license: 'KOGL-Type1',
        licenseNote: '공공누리 제1유형(출처표시) — 상업적 이용·변형·2차적 저작물 허용, 출처 표시 필수(확인 2026-07-11). 표준 표기: "본 저작물은 국가건설기준센터(국토교통부)의 건설기준을 공공누리 제1유형에 따라 이용하였습니다. 출처: 국가건설기준센터(https://www.kcsc.re.kr)". 수집: 회원 OpenAPI 인증키(유효 ~2027-07-11).',
        tags: t.tags, fetchedAt: new Date().toISOString(),
        sha256: createHash('sha256').update(JSON.stringify(doc)).digest('hex'),
        clauses: doc.list.length, version: doc.version,
      };
      writeFileSync(join(KDS_DIR, `KDS_${t.code}.meta.json`), JSON.stringify(meta, null, 2));

      if (existsSync(outPath) && !FORCE) { console.log(`[${docId}] index exists — skip embed`); ok++; continue; }
      const chunks = chunkClauses(doc.list);
      console.log(`[${docId}] ${doc.list.length} clauses -> ${chunks.length} chunks; embedding…`);
      const embeddings = await embedTexts(chunks.map((c) => c.text));
      const lines = chunks.map((c, i) => JSON.stringify({
        docId, title, page: c.sort, clause: c.clause, chunkId: `${docId}#${i}`,
        text: c.text, embedding: embeddings[i], license: meta.license, sourceUrl: meta.sourceUrl, tags: t.tags,
      }));
      writeFileSync(outPath, lines.join('\n') + '\n');
      totalChunks += chunks.length;
      ok++;
      console.log(`[${docId}] indexed -> ${outPath}`);
    } catch (e) {
      fail++;
      console.error(`[${docId}] FAIL — ${e.message}`);
    }
  }
  console.log(`\ndone: ${ok} docs, +${totalChunks} chunks, ${fail} failed`);
  if (fail) process.exitCode = 1;
}

main();
