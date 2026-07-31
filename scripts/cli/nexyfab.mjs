#!/usr/bin/env node
/**
 * nexyfab — 터미널에서 NexyFab 을 쓰는 CLI (260802).
 *
 * ## 왜 만들었나
 * API 키 발급(`/api/user/api-keys`)과 MCP 도구 45종은 이미 있었지만,
 * **터미널에서 바로 쓰는 경로가 없었다.** MCP 는 Claude 같은 클라이언트가 있어야 하고,
 * CI·스크립트·서버에서 쓰려면 HTTP 를 손으로 짜야 했다.
 *
 * ## 설계에서 고른 것
 *
 * ### 1. **얇은 층으로 둔다** — 새 엔진을 만들지 않는다
 * 판정·형상·게이트는 전부 서버가 한다. 여기서 계산하면 **CLI 결과와 웹 결과가 갈린다.**
 * (이 세션 내내 지킨 규약: 요약이 원본과 갈리면 그게 더 나쁘다.)
 *
 * ### 2. **실패를 조용히 삼키지 않는다**
 * HTTP 상태·서버 메시지를 그대로 보여 주고 exit code 를 다르게 준다 —
 * CI 가 성공/실패를 구별할 수 있어야 한다.
 * 특히 **428(상승 필요)·401(키 문제)·403(플랜)** 은 사용자가 할 일이 달라 따로 안내한다.
 *
 * ### 3. 키를 **로그에 남기지 않는다**
 * `--verbose` 에서도 Authorization 헤더는 마스킹한다. CI 로그는 오래 남는다.
 *
 * ## 사용
 * ```
 * export NEXYFAB_API_KEY=nf_live_...
 * nexyfab whoami
 * nexyfab keys list
 * nexyfab assemble "50mm 정육면체에 10mm 구멍"
 * nexyfab package --file assembly.json --out ./out
 * ```
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const VERSION = '0.1.0';
const BASE = (process.env.NEXYFAB_API_URL ?? 'https://nexyfab.com').replace(/\/$/, '');

/** ⚠ 키를 인자로도 받지만 **환경변수를 권한다** — 셸 히스토리에 남는다. */
function apiKey(argv) {
  const fromArg = argv.key;
  if (fromArg) {
    process.stderr.write('⚠ --key 는 셸 히스토리에 남습니다. NEXYFAB_API_KEY 환경변수를 권합니다.\n');
    return fromArg;
  }
  return process.env.NEXYFAB_API_KEY ?? null;
}

const mask = (k) => (k ? `${k.slice(0, 12)}…${k.slice(-4)}` : '(없음)');

/** 종료 코드 — CI 가 원인을 구별할 수 있어야 한다. */
const EXIT = { ok: 0, usage: 2, auth: 3, plan: 4, elevation: 5, server: 6, network: 7 };

async function call(path, { method = 'GET', body, key, verbose } = {}) {
  const url = BASE + path;
  const headers = { accept: 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (verbose) {
    // ⚠ 키는 마스킹한다 — CI 로그는 오래 남는다.
    process.stderr.write(`→ ${method} ${url}  auth=${mask(key)}\n`);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    return { kind: 'network', error: `연결 실패: ${String(e?.message ?? e)} (${url})` };
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 아래에서 원문으로 보고 */ }
  if (!res.ok) {
    const msg = json?.error ?? json?.message ?? text.slice(0, 300);
    return { kind: 'http', status: res.status, error: msg, json };
  }
  return { kind: 'ok', status: res.status, json: json ?? {} };
}

/** HTTP 실패를 **사용자가 할 일**로 번역한다. */
function reportFailure(r) {
  if (r.kind === 'network') { process.stderr.write(`✗ ${r.error}\n`); return EXIT.network; }
  const { status, error } = r;
  if (status === 401) {
    process.stderr.write(`✗ 인증 실패(401): ${error}\n`
      + '  → NEXYFAB_API_KEY 가 설정돼 있는지, 키가 파기·만료되지 않았는지 확인하세요.\n');
    return EXIT.auth;
  }
  if (status === 403) {
    process.stderr.write(`✗ 권한 없음(403): ${error}\n`
      + '  → 플랜(Pro 이상) 또는 키 스코프를 확인하세요.\n');
    return EXIT.plan;
  }
  if (status === 428) {
    process.stderr.write(`✗ 관리자 상승 필요(428): ${error}\n`
      + '  → 관리자 API 는 이메일 OTP step-up 이 필요합니다. 웹 콘솔에서 인증 후 다시 시도하세요.\n');
    return EXIT.elevation;
  }
  if (status === 429) {
    process.stderr.write(`✗ 요청이 많습니다(429): ${error}\n`);
    return EXIT.server;
  }
  process.stderr.write(`✗ 서버 오류(${status}): ${error}\n`);
  return EXIT.server;
}

// ── 명령 ────────────────────────────────────────────────────────────────────

async function cmdWhoami(argv) {
  const key = apiKey(argv);
  if (!key) { process.stderr.write('✗ NEXYFAB_API_KEY 가 없습니다.\n'); return EXIT.auth; }
  // 키 목록 조회는 인증만 필요하고 부작용이 없다 — 키 유효성 확인에 가장 안전한 호출이다.
  const r = await call('/api/user/api-keys', { key, verbose: argv.verbose });
  if (r.kind !== 'ok') return reportFailure(r);
  process.stdout.write(`✓ 키 유효: ${mask(key)}\n`);
  process.stdout.write(`  등록된 키 ${Array.isArray(r.json?.keys) ? r.json.keys.length : '?'}개\n`);
  return EXIT.ok;
}

async function cmdKeys(argv) {
  const key = apiKey(argv);
  if (!key) { process.stderr.write('✗ NEXYFAB_API_KEY 가 없습니다.\n'); return EXIT.auth; }
  const sub = argv._[1] ?? 'list';

  if (sub === 'list') {
    const r = await call('/api/user/api-keys', { key, verbose: argv.verbose });
    if (r.kind !== 'ok') return reportFailure(r);
    const keys = r.json?.keys ?? [];
    if (!keys.length) { process.stdout.write('(등록된 키 없음)\n'); return EXIT.ok; }
    for (const k of keys) {
      const exp = k.expiresAt ? new Date(k.expiresAt).toISOString().slice(0, 10) : '만료없음';
      process.stdout.write(`${k.keyPrefix ?? '?'}  ${k.name ?? ''}  [${k.status ?? '?'}]  만료 ${exp}\n`);
    }
    return EXIT.ok;
  }

  if (sub === 'create') {
    const name = argv._[2];
    if (!name) { process.stderr.write('사용: nexyfab keys create <이름> [--days N]\n'); return EXIT.usage; }
    const body = { name, scopes: [], ipWhitelist: [] };
    if (argv.days) body.expiresInDays = Number(argv.days);
    const r = await call('/api/user/api-keys', { method: 'POST', body, key, verbose: argv.verbose });
    if (r.kind !== 'ok') return reportFailure(r);
    // ⚠ 평문은 **여기서만** 나온다. 파일로 흘리지 않고 stdout 에만 쓴다.
    process.stdout.write(`${r.json.key}\n`);
    process.stderr.write('⚠ 이 키는 다시 볼 수 없습니다. 안전하게 보관하세요.\n');
    return EXIT.ok;
  }

  if (sub === 'revoke') {
    const id = argv._[2];
    if (!id) { process.stderr.write('사용: nexyfab keys revoke <keyId>\n'); return EXIT.usage; }
    const r = await call(`/api/user/api-keys?id=${encodeURIComponent(id)}`, { method: 'DELETE', key, verbose: argv.verbose });
    if (r.kind !== 'ok') return reportFailure(r);
    process.stdout.write(`✓ 파기됨: ${id}\n`);
    return EXIT.ok;
  }

  process.stderr.write(`알 수 없는 하위 명령: ${sub}\n`);
  return EXIT.usage;
}

async function cmdAssemble(argv) {
  const key = apiKey(argv);
  if (!key) { process.stderr.write('✗ NEXYFAB_API_KEY 가 없습니다.\n'); return EXIT.auth; }
  const text = argv._.slice(1).join(' ').trim();
  if (!text) { process.stderr.write('사용: nexyfab assemble "<자연어 설명>"\n'); return EXIT.usage; }
  const r = await call('/api/nexyfab/drawing/assemble', { method: 'POST', body: { description: text }, key, verbose: argv.verbose });
  if (r.kind !== 'ok') return reportFailure(r);
  const out = argv.out ? resolve(String(argv.out)) : null;
  const json = JSON.stringify(r.json.assembly ?? r.json, null, 2);
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, json); process.stdout.write(`✓ 저장: ${out}\n`); }
  else process.stdout.write(json + '\n');
  return EXIT.ok;
}

async function cmdPackage(argv) {
  const key = apiKey(argv);
  if (!key) { process.stderr.write('✗ NEXYFAB_API_KEY 가 없습니다.\n'); return EXIT.auth; }
  const file = argv.file ?? argv._[1];
  if (!file) { process.stderr.write('사용: nexyfab package --file <assembly.json> [--out <dir>] [--lang ko|en|ja|zh|es|ar]\n'); return EXIT.usage; }
  let assembly;
  try { assembly = JSON.parse(readFileSync(resolve(String(file)), 'utf8')); }
  catch (e) { process.stderr.write(`✗ 어셈블리 파일을 읽지 못했습니다: ${String(e?.message ?? e)}\n`); return EXIT.usage; }

  const options = {};
  if (argv.lang) options.lang = String(argv.lang);
  if (argv.title) options.title = String(argv.title);

  const r = await call('/api/nexyfab/drawing/package', { method: 'POST', body: { assembly, options }, key, verbose: argv.verbose });
  if (r.kind !== 'ok') return reportFailure(r);

  const dir = resolve(String(argv.out ?? './nexyfab-out'));
  mkdirSync(dir, { recursive: true });
  const files = r.json?.files ?? [];
  let written = 0;
  for (const f of files) {
    if (typeof f?.content !== 'string') continue;
    writeFileSync(resolve(dir, f.name), f.content);
    written++;
  }
  if (r.json?.zipBase64) {
    writeFileSync(resolve(dir, 'package.zip'), Buffer.from(r.json.zipBase64, 'base64'));
    written++;
  }
  process.stdout.write(`✓ ${written}개 파일 → ${dir}\n`);
  /**
   * ⚠ **실패한 산출물을 성공으로 세지 않는다.** 서버는 못 만든 것을 목록으로 알려 준다 —
   *   그걸 안 보여 주면 사용자는 파일 수만 보고 다 됐다고 읽는다.
   */
  const failed = r.json?.outputsFailed ?? [];
  if (failed.length) {
    process.stderr.write(`⚠ 만들지 못한 산출물 ${failed.length}건: ${failed.join(', ')}\n`);
  }
  const dl = r.json?.summary?.documentLang ?? r.json?.documentLang;
  if (dl && dl.requested && dl.coverage !== 'full') {
    process.stderr.write(`⚠ 문서 언어: 요청 ${dl.requested} · 본문 ${dl.content} · 번역 ${dl.coverage}\n`);
  }
  return EXIT.ok;
}

// ── 인자 파싱 (의존성 없이) ─────────────────────────────────────────────────
function parseArgv(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { out._.push(...args.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const name = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) { out[name] = true; }
      else { out[name] = next; i++; }
      continue;
    }
    out._.push(a);
  }
  return out;
}

const USAGE = `nexyfab ${VERSION}

  nexyfab whoami                        키가 유효한지 확인
  nexyfab keys list                     내 API 키 목록
  nexyfab keys create <이름> [--days N] 키 발급 (평문은 1회만 출력)
  nexyfab keys revoke <keyId>           키 파기
  nexyfab assemble "<설명>" [--out f]   자연어 → 어셈블리 JSON
  nexyfab package --file <a.json>       도면·물량·검토·STEP 패키지
        [--out <dir>] [--lang ko|en|ja|zh|es|ar] [--title <제목>]

환경변수
  NEXYFAB_API_KEY   필수. Pro 이상 계정에서 발급(웹 → 계정 → API Keys)
  NEXYFAB_API_URL   기본 https://nexyfab.com

종료 코드
  0 성공 · 2 사용법 · 3 인증 · 4 플랜/권한 · 5 관리자 상승 필요 · 6 서버 · 7 네트워크
`;

export async function main(args = process.argv.slice(2)) {
  const argv = parseArgv(args);
  const cmd = argv._[0];
  if (!cmd || argv.help || cmd === 'help') { process.stdout.write(USAGE); return EXIT.ok; }
  if (argv.version || cmd === 'version') { process.stdout.write(VERSION + '\n'); return EXIT.ok; }
  switch (cmd) {
    case 'whoami': return cmdWhoami(argv);
    case 'keys': return cmdKeys(argv);
    case 'assemble': return cmdAssemble(argv);
    case 'package': return cmdPackage(argv);
    default:
      process.stderr.write(`알 수 없는 명령: ${cmd}\n\n${USAGE}`);
      return EXIT.usage;
  }
}

export { parseArgv, EXIT, USAGE, mask };

// 직접 실행일 때만 종료 코드를 세팅한다(테스트에서 import 하면 실행되지 않는다).
if (import.meta.url === `file://${process.argv[1]?.split('\\').join('/')}`
  || import.meta.url.endsWith(process.argv[1]?.split('\\').join('/') ?? '\u0000')) {
  main().then((code) => { process.exitCode = code; });
}
