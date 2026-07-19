#!/usr/bin/env node
/**
 * 3면 스모크(API·CLI·MCP) — 배포 전/후 표준 검증(260719, 사용자 표준: 테스트도 3면으로).
 *
 * 사용: node scripts/e2e/smoke-3surface.mjs [--base https://nexyfab.com] [--key nf_live_xxx]
 *   기본 base=https://nexyfab.com · key 없으면 익명(게스트 리밋 하에 결정론 라우트만).
 * 검증(전부 결정론 — AI 비용 0):
 *   ① API  face-drag(targetMm)·part-op(duplicate) 실호출
 *   ② CLI  원격 모드(cli.mjs → base) part-op
 *   ③ MCP  단일파일(public/downloads/nexyfab-mcp.mjs → base) face_drag
 * exit 0=전부 통과 · 1=실패(어느 면인지 stdout).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = (flag('base', 'https://nexyfab.com')).replace(/\/$/, '');
const KEY = flag('key', process.env.NEXYFAB_API_KEY ?? 'nf_live_smoke');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ASM = {
  name: 'Smoke Bench', domain: 'mech',
  parts: [
    { id: 'base', type: 'box', params: { width: 600, depth: 400, height: 40 }, at: { tx: 0, ty: 0, tz: 0 }, role: 'frame', material: 'steel' },
    { id: 'post', type: 'cylinder', params: { diameter: 120, length: 300 }, at: { tx: 300, ty: 200, tz: 40 }, role: 'column', material: 'steel' },
  ],
};

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

// ① API
try {
  const r1 = await fetch(`${BASE}/api/nexyfab/drawing/face-drag/`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assembly: ASM, partId: 'post', face: 'axis+', targetMm: 500 }),
  });
  const j1 = await r1.json().catch(() => ({}));
  check('API face-drag(targetMm)', r1.ok && j1.ok === true && j1.patch?.params?.length === 500, JSON.stringify(j1.patch ?? j1.error ?? ''));
  const r2 = await fetch(`${BASE}/api/nexyfab/drawing/part-op/`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assembly: ASM, op: 'duplicate', partIds: ['post'] }),
  });
  const j2 = await r2.json().catch(() => ({}));
  check('API part-op(duplicate)', r2.ok && j2.ok === true && Array.isArray(j2.parts) && j2.parts.length === 3, `parts=${j2.parts?.length ?? '?'}`);
} catch (e) {
  check('API 호출', false, String(e.message));
}

// ② CLI 원격
try {
  const tmp = join(ROOT, 'scripts', 'e2e', '.smoke-asm.json');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  writeFileSync(tmp, JSON.stringify(ASM));
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'drawing-to-3d', 'cli.mjs'), 'part-op', tmp, '--op', 'duplicate', '--ids', 'post', '--raw'], {
    env: { ...process.env, NEXYFAB_API_KEY: KEY, NEXYFAB_API_URL: BASE }, encoding: 'utf8', timeout: 60_000,
  });
  let ok = false, detail = '';
  try { const j = JSON.parse(r.stdout); ok = j.ok === true; detail = `massKg=${j.massKg}`; } catch { detail = (r.stdout || r.stderr || '').slice(0, 80); }
  check('CLI 원격(part-op)', ok, detail);
  try { unlinkSync(tmp); } catch { /* ignore */ }
} catch (e) {
  check('CLI 원격', false, String(e.message));
}

// ③ MCP 단일파일
try {
  const req = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'face_drag', arguments: { assembly: ASM, partId: 'post', face: 'radial', deltaMm: 20 } } });
  const r = spawnSync(process.execPath, [join(ROOT, 'public', 'downloads', 'nexyfab-mcp.mjs')], {
    input: req + '\n', env: { ...process.env, NEXYFAB_API_KEY: KEY, NEXYFAB_API_URL: BASE }, encoding: 'utf8', timeout: 60_000,
  });
  let ok = false, detail = '';
  try {
    const line = (r.stdout || '').split('\n').find((l) => l.trim());
    const body = JSON.parse(JSON.parse(line).result.content[0].text);
    ok = body.ok === true && body.patch?.params?.diameter === 160;
    detail = JSON.stringify(body.patch ?? body.error ?? '');
  } catch { detail = (r.stdout || r.stderr || '').slice(0, 80); }
  check('MCP 원격(face_drag)', ok, detail);
} catch (e) {
  check('MCP 원격', false, String(e.message));
}

// 페이지 마커(배포 확인)
try {
  const r = await fetch(`${BASE}/kr/nexyfab/developers/`);
  check('페이지 /nexyfab/developers', r.status === 200, `HTTP ${r.status}`);
  const d = await fetch(`${BASE}/downloads/nexyfab-mcp.mjs`);
  check('다운로드 nexyfab-mcp.mjs', d.status === 200, `HTTP ${d.status}`);
} catch (e) {
  check('페이지 마커', false, String(e.message));
}

console.log(fails ? `\n✘ ${fails}건 실패` : '\n✔ 3면 스모크 전부 통과');
process.exit(fails ? 1 : 0);
