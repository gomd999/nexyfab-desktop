/**
 * nexyfab-eng-api — 엔지니어링 계산기 + RAG 검색 HTTP API (Wave 2, plan §8).
 * AI 서비스 연동용: OpenAI function-calling/커스텀 에이전트가 API key로 호출.
 *
 * 인증: Authorization: Bearer nxk_… → sha256 → D1 api_keys (일일 쿼터 포함)
 * 엔드포인트:
 *   GET  /v1/calculators          — 계산기 목록+JSON Schema (tool 스펙 자동생성용)
 *   POST /v1/calc/{id}            — {input:{…}, standard?:'KDS'|'AISC360'|'AASHTO'}
 *   POST /v1/rag/search           — {query:'…', k?:5}  (bge-m3 임베딩 + Vectorize)
 * 모든 계산 결과에 비법정 라벨+조항 인용+KOGL 출처표시(attribution) 포함.
 */
import { calculators, runCalculatorCore } from '../../core.mjs';
import { optimizeSection } from '../../optimize.mjs';
import { analyzeFrame2D } from '../../analysis/frame2d.mjs';
import ksh from '../../sections/ks-h-beams.json';
import kds from '../../standards/kds.json';
import aisc from '../../standards/aisc360.json';
import aashto from '../../standards/aashto-lrfd.json';

const STANDARDS = { [kds.id]: kds, [aisc.id]: aisc, [aashto.id]: aashto };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 1), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function authenticate(request, env, endpoint) {
  const auth = request.headers.get('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(\S+)$/);
  if (!m) return { ok: false, error: 'missing Authorization: Bearer <api key>' };
  const hash = await sha256hex(m[1]);
  const row = await env.DB.prepare('SELECT id,name,plan,daily_limit,usage_today,usage_date,disabled FROM api_keys WHERE key_hash=?').bind(hash).first();
  if (!row || row.disabled) return { ok: false, error: 'invalid or disabled API key' };
  const today = new Date().toISOString().slice(0, 10);
  const used = row.usage_date === today ? row.usage_today : 0;
  if (used >= row.daily_limit) return { ok: false, error: `daily quota exceeded (${row.daily_limit}/day)`, status: 429 };
  await env.DB.batch([
    env.DB.prepare('UPDATE api_keys SET usage_today=?, usage_date=? WHERE id=?').bind(used + 1, today, row.id),
    env.DB.prepare('INSERT INTO usage_log(key_id,day,endpoint,calls) VALUES(?,?,?,1) ON CONFLICT(key_id,day,endpoint) DO UPDATE SET calls=calls+1').bind(row.id, today, endpoint),
  ]);
  return { ok: true, key: row };
}

/** 키 관리(admin) — X-Admin-Secret = wrangler secret ADMIN_SECRET. Wave 3: NexyFab 앱 백엔드가 이 레이어를 호출해 계정·과금 연동(usage_log가 청구 원장). */
async function handleAdmin(request, env, path) {
  if (!env.ADMIN_SECRET || (request.headers.get('X-Admin-Secret') ?? '') !== env.ADMIN_SECRET) {
    return json({ error: 'admin auth failed' }, 403);
  }
  if (path === '/v1/admin/keys' && request.method === 'GET') {
    const keys = await env.DB.prepare('SELECT id,name,plan,daily_limit,usage_today,usage_date,disabled,created_at FROM api_keys').all();
    const usage = await env.DB.prepare('SELECT key_id,day,endpoint,calls FROM usage_log ORDER BY day DESC LIMIT 200').all();
    return json({ keys: keys.results, recentUsage: usage.results });
  }
  if (path === '/v1/admin/keys' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (!body.name) return json({ error: 'name required' }, 400);
    const raw = new Uint8Array(24);
    crypto.getRandomValues(raw);
    const key = 'nxk_' + btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const hash = await sha256hex(key);
    await env.DB.prepare('INSERT INTO api_keys(key_hash,name,plan,daily_limit,usage_date,created_at) VALUES(?,?,?,?,?,?)')
      .bind(hash, body.name, body.plan ?? 'standard', body.dailyLimit ?? 500, '', new Date().toISOString()).run();
    return json({ apiKey: key, note: '이 키는 재조회 불가 — 즉시 안전한 곳에 보관' }, 201);
  }
  const del = path.match(/^\/v1\/admin\/keys\/(\d+)$/);
  if (del && request.method === 'DELETE') {
    await env.DB.prepare('UPDATE api_keys SET disabled=1 WHERE id=?').bind(+del[1]).run();
    return json({ revoked: +del[1] });
  }
  return json({ error: 'not found' }, 404);
}

async function embed(env, text) {
  const r = await env.AI.run('@cf/baai/bge-m3', { text: [text] });
  const vec = r?.data?.[0] ?? r?.result?.data?.[0];
  if (!vec) throw new Error('embedding failed');
  return vec;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    try {
      if (path === '/v1/health') return json({ ok: true, service: 'nexyfab-eng-api', calculators: calculators.length });
      if (path.startsWith('/v1/admin/')) return handleAdmin(request, env, path);

      const auth = await authenticate(request, env, path);
      if (!auth.ok) return json({ error: auth.error }, auth.status ?? 401);

      if (path === '/v1/calculators' && request.method === 'GET') {
        // 분야별 필터: ?domain=civil / steel / temporary-structures / building (부분일치)
        const domainFilter = (url.searchParams.get('domain') ?? '').trim().toLowerCase();
        const list = calculators.filter((c) => !domainFilter || c.domain.toLowerCase().includes(domainFilter));
        return json({
          standards: Object.keys(STANDARDS),
          domains: [...new Set(calculators.map((c) => c.domain))],
          ...(domainFilter ? { domainFilter } : {}),
          disclaimer: '구조 검토 참고자료(비법정) — 법정 계산서는 기술사 날인 영역',
          calculators: list.map((c) => ({
            id: c.id, domain: c.domain, title: c.title, description: c.description,
            status: c.status, refs: c.refs, inputSchema: c.inputSchema,
          })),
        });
      }

      const calcMatch = path.match(/^\/v1\/calc\/([a-z0-9_]+)$/);
      if (calcMatch && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        try {
          const result = runCalculatorCore(STANDARDS, calcMatch[1], body.input ?? {}, body.standard ?? 'KDS');
          return json(result);
        } catch (e) {
          return json({ error: e.message, code: e.code ?? 'CALC_ERROR' }, 400);
        }
      }

      if (path === '/v1/analyze/frame2d' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        try { return json(analyzeFrame2D(body)); } catch (e) { return json({ error: e.message }, 400); }
      }

      if (path === '/v1/optimize/section' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        try {
          const result = optimizeSection(STANDARDS, {
            calculator: body.calculator, standard: body.standard ?? 'KDS', axis: body.axis ?? 'ry',
            fixedInput: body.fixedInput ?? {}, sections: body.sections ?? ksh.sections,
          });
          return json({ sectionCatalog: body.sections ? 'user-supplied' : ksh.name, ...result });
        } catch (e) {
          return json({ error: e.message }, 400);
        }
      }

      if (path === '/v1/rag/search' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const query = (body.query ?? '').trim();
        if (!query) return json({ error: 'query required' }, 400);
        const k = Math.min(Math.max(body.k ?? 5, 1), 20);
        // 분야별 필터: tags(부분일치, 예: 'civil'·'kds'·'retaining-wall') / excludeSuperseded(구 기준 제외)
        const tagFilter = (body.tags ?? '').trim().toLowerCase();
        const excludeSuperseded = body.excludeSuperseded === true;
        const vec = await embed(env, query);
        const fetchK = tagFilter || excludeSuperseded ? Math.min(k * 4, 50) : k;
        const res = await env.VECTORIZE.query(vec, { topK: fetchK, returnMetadata: 'all' });
        if (tagFilter || excludeSuperseded) {
          res.matches = (res.matches ?? []).filter((m) => {
            const tags = (m.metadata?.tags ?? '').toLowerCase();
            if (excludeSuperseded && tags.includes('superseded')) return false;
            return !tagFilter || tags.includes(tagFilter);
          }).slice(0, k);
        }
        return json({
          query, k,
          ...(tagFilter ? { tags: tagFilter } : {}), ...(excludeSuperseded ? { excludeSuperseded } : {}),
          attribution: 'KDS 원문: 국가건설기준센터(국토교통부) 공공누리 제1유형 / 미 연방 간행물: 퍼블릭 도메인(17 U.S.C. §105)',
          note: 'superseded 태그 문서는 구 기준 — 현행 조항은 kds-* 문서 우선',
          hits: (res.matches ?? []).map((m) => ({
            score: +m.score.toFixed(4), docId: m.metadata?.docId, title: m.metadata?.title,
            page: m.metadata?.page, clause: m.metadata?.clause || undefined,
            license: m.metadata?.license, text: m.metadata?.text,
          })),
        });
      }

      return json({ error: 'not found', endpoints: ['GET /v1/health', 'GET /v1/calculators', 'POST /v1/calc/{id}', 'POST /v1/optimize/section', 'POST /v1/analyze/frame2d', 'POST /v1/rag/search'] }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
