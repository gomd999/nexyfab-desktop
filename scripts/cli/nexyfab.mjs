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
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { resolve, dirname, relative, isAbsolute, sep } from "node:path";

const VERSION = "0.1.0";
const MAX_PACKAGE_FILES = 128;
const MAX_PACKAGE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PACKAGE_TOTAL_BYTES = 256 * 1024 * 1024;
// Keep local inputs and remote responses bounded before any request is made.
const MAX_CLI_JSON_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_CLI_TEXT_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_CLI_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const MIN_CALL_TIMEOUT_MS = 25;
const MAX_CALL_TIMEOUT_MS = 120_000;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE = (process.env.NEXYFAB_API_URL ?? "https://nexyfab.com").replace(
  /\/$/,
  "",
);

/** ⚠ 키를 인자로도 받지만 **환경변수를 권한다** — 셸 히스토리에 남는다. */
function apiKey(argv) {
  const fromArg = argv.key;
  if (fromArg) {
    process.stderr.write(
      "⚠ --key 는 셸 히스토리에 남습니다. NEXYFAB_API_KEY 환경변수를 권합니다.\n",
    );
    return fromArg;
  }
  return process.env.NEXYFAB_API_KEY ?? null;
}

const mask = (k) => (k ? `${k.slice(0, 12)}…${k.slice(-4)}` : "(없음)");

/** 종료 코드 — CI 가 원인을 구별할 수 있어야 한다. */
const EXIT = {
  ok: 0,
  usage: 2,
  auth: 3,
  plan: 4,
  elevation: 5,
  server: 6,
  network: 7,
  response: 8,
};

function callTimeoutMs() {
  const parsed = Number(process.env.NEXYFAB_CLI_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_CALL_TIMEOUT_MS;
  return Math.min(MAX_CALL_TIMEOUT_MS, Math.max(MIN_CALL_TIMEOUT_MS, Math.floor(parsed)));
}

function responseTooLarge() {
  return {
    kind: "response_too_large",
    error: "server response exceeds the local size limit",
  };
}

function responseInvalid() {
  return {
    kind: "response_invalid",
    error: "server returned invalid JSON",
  };
}

async function readResponseBody(res) {
  const declared = res.headers?.get?.("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_CLI_RESPONSE_BYTES) {
    return responseTooLarge();
  }
  if (!res.body?.getReader) {
    const text = await res.text();
    return Buffer.byteLength(text, "utf8") > MAX_CLI_RESPONSE_BYTES
      ? responseTooLarge()
      : { ok: true, text };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = part.value instanceof Uint8Array
        ? part.value
        : new Uint8Array(part.value ?? []);
      total += chunk.byteLength;
      if (total > MAX_CLI_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        return responseTooLarge();
      }
      chunks.push(Buffer.from(chunk));
    }
  } finally {
    reader.releaseLock?.();
  }
  try {
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    };
  } catch {
    return responseInvalid();
  }
}

async function call(path, { method = "GET", body, key, verbose } = {}) {
  const url = BASE + path;
  const headers = { accept: "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (verbose) {
    // Keep endpoint details out of logs as well as the credential itself.
    process.stderr.write(`→ ${method} request  auth=${mask(key)}\n`);
  }
  let res;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), callTimeoutMs());
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return {
      kind: "network",
      error: controller.signal.aborted
        ? "request timed out"
        : "network request failed",
    };
  }
  let response;
  try {
    response = await readResponseBody(res);
  } catch {
    clearTimeout(timer);
    return {
      kind: "network",
      error: controller.signal.aborted
        ? "request timed out"
        : "network response could not be read",
    };
  }
  clearTimeout(timer);
  if (!response.ok) return response;
  const { text } = response;
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) return responseInvalid();
  }
  if (!res.ok) {
    return { kind: "http", status: res.status, error: "server request failed", json };
  }
  return { kind: "ok", status: res.status, json: json ?? {} };
}

/** HTTP 실패를 **사용자가 할 일**로 번역한다. */
function reportFailure(r) {
  if (r.kind === "network") {
    process.stderr.write(`✗ ${r.error}\n`);
    return EXIT.network;
  }
  if (r.kind === "response_too_large" || r.kind === "response_invalid") {
    process.stderr.write(`✗ ${r.error}\n`);
    return EXIT.response;
  }
  const { status, error } = r;
  if (status === 401) {
    process.stderr.write(
      `✗ 인증 실패(401): ${error}\n` +
        "  → NEXYFAB_API_KEY 가 설정돼 있는지, 키가 파기·만료되지 않았는지 확인하세요.\n",
    );
    return EXIT.auth;
  }
  if (status === 403) {
    process.stderr.write(
      `✗ 권한 없음(403): ${error}\n` +
        "  → 플랜(Pro 이상) 또는 키 스코프를 확인하세요.\n",
    );
    return EXIT.plan;
  }
  if (status === 428) {
    process.stderr.write(
      `✗ 관리자 상승 필요(428): ${error}\n` +
        "  → 관리자 API 는 이메일 OTP step-up 이 필요합니다. 웹 콘솔에서 인증 후 다시 시도하세요.\n",
    );
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
  if (!key) {
    process.stderr.write("✗ NEXYFAB_API_KEY 가 없습니다.\n");
    return EXIT.auth;
  }
  // 키 목록 조회는 인증만 필요하고 부작용이 없다 — 키 유효성 확인에 가장 안전한 호출이다.
  const r = await call("/api/user/api-keys", { key, verbose: argv.verbose });
  if (r.kind !== "ok") return reportFailure(r);
  process.stdout.write(`✓ 키 유효: ${mask(key)}\n`);
  process.stdout.write(
    `  등록된 키 ${Array.isArray(r.json?.keys) ? r.json.keys.length : "?"}개\n`,
  );
  return EXIT.ok;
}

async function cmdKeys(argv) {
  const key = apiKey(argv);
  if (!key) {
    process.stderr.write("✗ NEXYFAB_API_KEY 가 없습니다.\n");
    return EXIT.auth;
  }
  const sub = argv._[1] ?? "list";

  if (sub === "list") {
    const r = await call("/api/user/api-keys", { key, verbose: argv.verbose });
    if (r.kind !== "ok") return reportFailure(r);
    const keys = r.json?.keys ?? [];
    if (!keys.length) {
      process.stdout.write("(등록된 키 없음)\n");
      return EXIT.ok;
    }
    for (const k of keys) {
      const exp = k.expiresAt
        ? new Date(k.expiresAt).toISOString().slice(0, 10)
        : "만료없음";
      process.stdout.write(
        `${k.keyPrefix ?? "?"}  ${k.name ?? ""}  [${k.status ?? "?"}]  만료 ${exp}\n`,
      );
    }
    return EXIT.ok;
  }

  if (sub === "create") {
    const name = argv._[2];
    if (!name) {
      process.stderr.write("사용: nexyfab keys create <이름> [--days N]\n");
      return EXIT.usage;
    }
    const body = { name, scopes: [], ipWhitelist: [] };
    if (argv.days) body.expiresInDays = Number(argv.days);
    const r = await call("/api/user/api-keys", {
      method: "POST",
      body,
      key,
      verbose: argv.verbose,
    });
    if (r.kind !== "ok") return reportFailure(r);
    // ⚠ 평문은 **여기서만** 나온다. 파일로 흘리지 않고 stdout 에만 쓴다.
    process.stdout.write(`${r.json.key}\n`);
    process.stderr.write(
      "⚠ 이 키는 다시 볼 수 없습니다. 안전하게 보관하세요.\n",
    );
    return EXIT.ok;
  }

  if (sub === "revoke") {
    const id = argv._[2];
    if (!id) {
      process.stderr.write("사용: nexyfab keys revoke <keyId>\n");
      return EXIT.usage;
    }
    const r = await call(`/api/user/api-keys?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      key,
      verbose: argv.verbose,
    });
    if (r.kind !== "ok") return reportFailure(r);
    process.stdout.write(`✓ 파기됨: ${id}\n`);
    return EXIT.ok;
  }

  process.stderr.write(`알 수 없는 하위 명령: ${sub}\n`);
  return EXIT.usage;
}

async function cmdAssemble(argv) {
  const key = apiKey(argv);
  if (!key) {
    process.stderr.write("✗ NEXYFAB_API_KEY 가 없습니다.\n");
    return EXIT.auth;
  }
  const text = argv._.slice(1).join(" ").trim();
  if (!text) {
    process.stderr.write('사용: nexyfab assemble "<자연어 설명>"\n');
    return EXIT.usage;
  }
  const r = await call("/api/nexyfab/drawing/assemble", {
    method: "POST",
    body: { description: text },
    key,
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  const out = argv.out ? resolve(String(argv.out)) : null;
  const json = JSON.stringify(r.json.assembly ?? r.json, null, 2);
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, json);
    process.stdout.write(`✓ 저장: ${out}\n`);
  } else process.stdout.write(json + "\n");
  return EXIT.ok;
}

function writeJsonResult(value, outFile) {
  const json = JSON.stringify(value, null, 2);
  if (!outFile) {
    process.stdout.write(json + "\n");
    return;
  }
  const out = resolve(String(outFile));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  process.stdout.write(`saved: ${out}\n`);
}

/**
 * Package file names come from the API response, not from the CLI user.
 * Keep those names inside the requested output directory even if a broken or
 * compromised response contains an absolute path or `..` segments.
 */
function packageOutputPath(dir, name) {
  if (typeof name !== "string" || !name || name.includes("\0")) {
    return { ok: false, error: "server returned an invalid package filename" };
  }
  // Check both separators so the guard behaves the same on Windows and Unix.
  if (
    isAbsolute(name) ||
    /^[A-Za-z]:[\\/]/.test(name) ||
    /^[\\/]{1,2}/.test(name) ||
    name.split(/[\\/]+/).includes("..")
  ) {
    return {
      ok: false,
      error: `server returned an unsafe package filename: ${name}`,
    };
  }
  const root = resolve(dir);
  const output = resolve(root, name);
  const outside = relative(root, output);
  if (!outside || outside === ".." || outside.startsWith(`..${sep}`) || isAbsolute(outside)) {
    return {
      ok: false,
      error: `server returned an unsafe package filename: ${name}`,
    };
  }
  return { ok: true, path: output };
}

/** Canonical multi-part AI CAD entry point (same contract as web and MCP). */
async function cmdDesign(argv) {
  const text = argv._.slice(1).join(" ").trim();
  if (!text) {
    process.stderr.write(
      'usage: nexyfab design "<product description>" [--out product.json]\n',
    );
    return EXIT.usage;
  }
  const r = await call("/api/cad/v1/product-decomposition", {
    method: "POST",
    body: { text },
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return EXIT.ok;
}

async function cmdCapabilities(argv) {
  const r = await call("/api/cad/v1/capabilities", {
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return EXIT.ok;
}

async function cmdRelease(argv) {
  const sub = argv._[1];
  const file = argv.file ?? argv._[2];
  if (sub !== "decision" || !file) {
    process.stderr.write(
      "usage: nexyfab release decision --file evidence.json [--out result.json]\n",
    );
    return EXIT.usage;
  }
  const parsed = readJsonFile(file, "CAD release evidence");
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n");
    return EXIT.usage;
  }
  const r = await call("/api/cad/v1/release/decision", {
    method: "POST",
    body: parsed.value,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind === "http" && r.status === 409 && r.json?.decision) {
    writeJsonResult(r.json, argv.out);
    return EXIT.server;
  }
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return EXIT.ok;
}

/** Deterministic topology/reference reconciliation for automation and CI. */
async function cmdTopology(argv) {
  const sub = argv._[1];
  const file = argv.file ?? argv._[2];
  if (sub !== "reconcile" || !file) {
    process.stderr.write(
      "usage: nexyfab topology reconcile --file payload.json [--out result.json]\n",
    );
    return EXIT.usage;
  }
  const parsed = readJsonFile(file, "topology payload");
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n");
    return EXIT.usage;
  }
  const body = parsed.value;
  const r = await call("/api/cad/v1/topology/reconcile", {
    method: "POST",
    body,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return EXIT.ok;
}

function safeInputPath(file) {
  if (typeof file !== "string" || !file.trim() || file.includes("\u0000")) {
    return { ok: false, error: "input path is invalid" };
  }
  const normalized = file.replaceAll("\\", "/");
  if (normalized.split("/").includes("..")) {
    return { ok: false, error: "input path traversal is not allowed" };
  }
  return { ok: true, path: resolve(file) };
}

function readInputBytes(file, label, maxBytes) {
  const safe = safeInputPath(String(file));
  if (!safe.ok) return safe;
  let stats;
  try {
    stats = statSync(safe.path);
  } catch {
    return { ok: false, error: `cannot read ${label}` };
  }
  if (!stats.isFile()) return { ok: false, error: `cannot read ${label}` };
  if (stats.size > maxBytes) {
    return { ok: false, error: `${label} exceeds the local size limit` };
  }
  let bytes;
  try {
    bytes = readFileSync(safe.path);
  } catch {
    return { ok: false, error: `cannot read ${label}` };
  }
  if (bytes.byteLength > maxBytes) {
    return { ok: false, error: `${label} exceeds the local size limit` };
  }
  return { ok: true, bytes };
}

function readInputText(file, label, maxBytes = MAX_CLI_TEXT_INPUT_BYTES) {
  const input = readInputBytes(file, label, maxBytes);
  if (!input.ok) return input;
  try {
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes),
    };
  } catch {
    return { ok: false, error: `${label} is not valid UTF-8` };
  }
}

function readJsonFile(file, label, maxBytes = MAX_CLI_JSON_INPUT_BYTES) {
  const input = readInputText(file, label, maxBytes);
  if (!input.ok) return input;
  try {
    return { ok: true, value: JSON.parse(input.text) };
  } catch {
    return { ok: false, error: `${label} is invalid JSON` };
  }
}

async function cmdPart(argv) {
  const prompt = argv._.slice(1).join(" ").trim();
  if (!prompt) {
    process.stderr.write(
      'usage: nexyfab part "<request>" [--current program.json] [--selection selection.json] [--out program.json]\n',
    );
    return EXIT.usage;
  }
  const body = { prompt };
  if (argv.current) {
    const parsed = readJsonFile(argv.current, "current program");
    if (!parsed.ok) {
      process.stderr.write(parsed.error + "\n");
      return EXIT.usage;
    }
    body.previousProgram = parsed.value;
  }
  if (argv.selection) {
    const parsed = readJsonFile(argv.selection, "selection context");
    if (!parsed.ok) {
      process.stderr.write(parsed.error + "\n");
      return EXIT.usage;
    }
    body.selectionContext = parsed.value;
  }
  const r = await call("/api/cad/v1/feature-program", {
    method: "POST",
    body,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return EXIT.ok;
}

async function cmdArtifact(argv, kind) {
  const file = argv.file ?? argv._[1];
  if (!file) {
    process.stderr.write(`usage: nexyfab ${kind} --file <json> --out <file>\n`);
    return EXIT.usage;
  }
  const parsed = readJsonFile(
    file,
    kind === "mesh" ? "FeatureTree" : "feature program",
  );
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n");
    return EXIT.usage;
  }
  const route =
    kind === "mesh" ? "/api/cad/v1/feature-tree-mesh" : "/api/cad/v1/part-step";
  const body =
    kind === "mesh"
      ? { tree: parsed.value.tree ?? parsed.value }
      : parsed.value;
  const r = await call(route, {
    method: "POST",
    body,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  const encoded = kind === "mesh" ? r.json.stl : r.json.step;
  if (typeof encoded !== "string") {
    process.stderr.write(
      `server did not return ${kind === "mesh" ? "stl" : "step"} base64\n`,
    );
    return EXIT.server;
  }
  const out = resolve(
    String(argv.out ?? (kind === "mesh" ? "./model.stl" : "./model.step")),
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(encoded, "base64"));
  process.stdout.write(`saved: ${out}\n`);
  return EXIT.ok;
}

async function cmdAssembly(argv) {
  const sub = argv._[1];
  const file = argv.file ?? argv._[2];
  if (!["verify", "edit"].includes(sub) || !file) {
    process.stderr.write(
      'usage: nexyfab assembly verify|edit --file payload.json [--command "쉘 두께 2mm"] [--out result.json]\n',
    );
    return EXIT.usage;
  }
  const parsed = readJsonFile(file, "assembly verification payload");
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n");
    return EXIT.usage;
  }
  const body =
    sub === "edit"
      ? {
          ...parsed.value,
          command: argv.command ?? parsed.value.command,
          ...(argv["verify-brep"] ? { verifyBrep: true } : {}),
        }
      : parsed.value;
  if (sub === "edit" && !body.command) {
    process.stderr.write(
      'assembly edit requires --command "..." or command in the payload\n',
    );
    return EXIT.usage;
  }
  const route =
    sub === "edit"
      ? "/api/cad/v1/assembly/selection-edit"
      : "/api/cad/v1/assembly/verify";
  const r = await call(route, {
    method: "POST",
    body,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return sub === "verify" && r.json.releaseReady !== true && argv.strict
    ? EXIT.server
    : EXIT.ok;
}

async function cmdProject(argv) {
  const sub = argv._[1];
  const file = argv.file ?? argv._[2];
  if (sub !== "verify" || !file) {
    process.stderr.write(
      "usage: nexyfab project verify --file evidence.json [--out result.json] [--strict]\n",
    );
    return EXIT.usage;
  }
  const parsed = readJsonFile(file, "cross-domain project evidence");
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n");
    return EXIT.usage;
  }
  const r = await call("/api/cad/v1/project/verify", {
    method: "POST",
    body: parsed.value,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return argv.strict && r.json.releaseReady !== true ? EXIT.server : EXIT.ok;
}

async function cmdInterior(argv) {
  const sub = argv._[1];
  const file = argv.file ?? argv._[2];
  if (
    !["door-swing", "space-boundary", "egress", "mep-interference"].includes(
      sub,
    ) ||
    !file
  ) {
    process.stderr.write(
      "usage: nexyfab interior <door-swing|space-boundary|egress|mep-interference> --file evidence.json [--out result.json] [--strict]\n",
    );
    return EXIT.usage;
  }
  const parsed = readJsonFile(file, `${sub} evidence`);
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n");
    return EXIT.usage;
  }
  const routes = {
    "door-swing": "/api/cad/v1/interior/door-swing/verify",
    "space-boundary": "/api/cad/v1/interior/space-boundary/verify",
    egress: "/api/cad/v1/interior/egress/verify",
    "mep-interference": "/api/cad/v1/interior/mep-interference/verify",
  };
  const route = routes[sub];
  const r = await call(route, {
    method: "POST",
    body: parsed.value,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  const passed =
    sub === "space-boundary"
      ? r.json.result?.closed === true
      : sub === "egress"
        ? r.json.result?.passed === true
        : r.json.result?.clear === true;
  return argv.strict && !passed ? EXIT.server : EXIT.ok;
}

async function cmdBrep(argv) {
  const sub = argv._[1],
    file = argv.file ?? argv._[2];
  if (sub !== "push-pull" || !file) {
    process.stderr.write(
      "usage: nexyfab brep push-pull --file payload.json [--out model.step]\n",
    );
    return EXIT.usage;
  }
  const parsed = readJsonFile(file, "B-rep push/pull payload");
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n");
    return EXIT.usage;
  }
  const r = await call("/api/cad/v1/brep/push-pull", {
    method: "POST",
    body: parsed.value,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  if (argv.out) {
    if (typeof r.json.step !== "string") {
      process.stderr.write("server returned no STEP artifact\n");
      return EXIT.server;
    }
    const out = resolve(String(argv.out));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(r.json.step, "base64"));
    process.stdout.write(`saved: ${out}\n`);
  } else writeJsonResult(r.json);
  return EXIT.ok;
}

function referenceLengthUnit(argv) {
  if (argv["scale-to-mm"] !== undefined) {
    const scaleToMm = Number(argv["scale-to-mm"]);
    return Number.isFinite(scaleToMm) && scaleToMm > 0
      ? {
          ok: true,
          value: {
            kind: "scale-to-mm",
            scaleToMm,
            label: argv.unit ? String(argv.unit) : undefined,
          },
        }
      : {
          ok: false,
          error: "--scale-to-mm must be a finite number greater than zero",
        };
  }
  const scales = { mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, ft: 304.8 };
  const unit = typeof argv.unit === "string" ? argv.unit.toLowerCase() : "";
  if (!unit || scales[unit] === undefined)
    return {
      ok: false,
      error: "--unit is required (mm|cm|m|in|ft), or provide --scale-to-mm",
    };
  return unit === "mm"
    ? { ok: true, value: { kind: "mm" } }
    : {
        ok: true,
        value: { kind: "scale-to-mm", scaleToMm: scales[unit], label: unit },
      };
}

async function cmdReference(argv) {
  const sub = argv._[1],
    file = argv.file ?? argv._[2],
    scenarioId = argv.scenario;
  if (sub === "mechanical-relations") {
    if (!file) {
      process.stderr.write(
        "usage: nexyfab reference mechanical-relations --file assembly.step [--angular-tolerance N] [--linear-tolerance N] [--strict]\n",
      );
      return EXIT.usage;
    }
    const safe = safeInputPath(String(file));
    if (!safe.ok) {
      process.stderr.write(safe.error + "\n");
      return EXIT.usage;
    }
    const resolved = safe.path,
      extension = resolved.split(".").pop()?.toLowerCase();
    if (!["step", "stp"].includes(extension)) {
      process.stderr.write(
        "mechanical-relations accepts only .step or .stp files\n",
      );
      return EXIT.usage;
    }
    const input = readInputText(file, "STEP input");
    if (!input.ok) {
      process.stderr.write(input.error + "\n");
      return EXIT.usage;
    }
    const step = input.text;
    const body = {
      step,
      ...(argv["angular-tolerance"] === undefined
        ? {}
        : { angularToleranceRad: Number(argv["angular-tolerance"]) }),
      ...(argv["linear-tolerance"] === undefined
        ? {}
        : { linearTolerance: Number(argv["linear-tolerance"]) }),
    };
    const r = await call("/api/cad/v1/step/mechanical-relations", {
      method: "POST",
      body,
      key: apiKey(argv),
      verbose: argv.verbose,
    });
    if (r.kind !== "ok") return reportFailure(r);
    writeJsonResult(r.json, argv.out);
    return argv.strict && r.json.releaseReady !== true ? EXIT.server : EXIT.ok;
  }
  if (
    sub !== "analyze" ||
    !file ||
    typeof scenarioId !== "string" ||
    !scenarioId.trim()
  ) {
    process.stderr.write(
      "usage: nexyfab reference analyze --file model.step --scenario fixture-id --unit mm [--tolerance N] [--out evidence.json]\n",
    );
    return EXIT.usage;
  }
  const unit = referenceLengthUnit(argv);
  if (!unit.ok) {
    process.stderr.write(unit.error + "\n");
    return EXIT.usage;
  }
  const safe = safeInputPath(String(file));
  if (!safe.ok) {
    process.stderr.write(safe.error + "\n");
    return EXIT.usage;
  }
  const resolved = safe.path;
  const extension = resolved.split(".").pop()?.toLowerCase();
  if (extension !== "step" && extension !== "stp") {
    process.stderr.write(
      "reference analyze accepts only .step or .stp files\n",
    );
    return EXIT.usage;
  }
  const stepInput = readInputText(file, "STEP input");
  if (!stepInput.ok) {
    process.stderr.write(stepInput.error + "\n");
    return EXIT.usage;
  }
  const source = stepInput.text;
  if (!source.trim()) {
    process.stderr.write("STEP input is empty\n");
    return EXIT.usage;
  }
  const tolerance =
    argv.tolerance === undefined ? undefined : Number(argv.tolerance);
  if (
    tolerance !== undefined &&
    (!Number.isFinite(tolerance) || tolerance <= 0)
  ) {
    process.stderr.write(
      "--tolerance must be a finite number greater than zero\n",
    );
    return EXIT.usage;
  }
  const body = {
    format: extension,
    step: source,
    encoding: "utf8",
    scenarioId: scenarioId.trim(),
    lengthUnit: unit.value,
    ...(tolerance === undefined
      ? {}
      : { declaredSourceTolerance: { value: tolerance } }),
  };
  const r = await call("/api/cad/v1/reference/analyze", {
    method: "POST",
    body,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  // The response contract contains only governed evidence/policy metadata;
  // preserve it for API/CLI parity without echoing the local path or STEP body.
  writeJsonResult(r.json, argv.out);
  return EXIT.ok;
}

async function cmdIfc(argv) {
  const sub = argv._[1],
    before = argv.before,
    after = argv.after,
    file = argv.file ?? argv._[2];
  const readIfc = (file, label) => {
    const safe = safeInputPath(String(file));
    if (!safe.ok) return safe;
    const resolved = safe.path;
    if (resolved.split(".").pop()?.toLowerCase() !== "ifc")
      return { ok: false, error: `${label} must be an .ifc file` };
    const input = readInputText(file, `${label} IFC`);
    if (!input.ok) return input;
    return input.text.trim()
      ? { ok: true, source: input.text }
      : { ok: false, error: `${label} IFC is empty` };
  };
  if (sub === "domain-ir") {
    if (
      !file ||
      !["alignment", "structural-analysis"].includes(String(argv.domain))
    ) {
      process.stderr.write(
        "usage: nexyfab ifc domain-ir --file model.ifc --domain alignment|structural-analysis [--inputs viennese-inputs.json] [--strict]\n",
      );
      return EXIT.usage;
    }
    const input = readIfc(file, "domain");
    if (!input.ok) {
      process.stderr.write(input.error + "\n");
      return EXIT.usage;
    }
    let vienneseBendInputs;
    if (argv.inputs) {
      const parsed = readJsonFile(argv.inputs, "Viennese inputs JSON");
      if (!parsed.ok) {
        process.stderr.write(parsed.error + "\n");
        return EXIT.usage;
      }
      vienneseBendInputs = parsed.value;
      if (
        !vienneseBendInputs ||
        typeof vienneseBendInputs !== "object" ||
        Array.isArray(vienneseBendInputs)
      ) {
        process.stderr.write(
          "Viennese inputs JSON must be an object keyed by IFC entity id\n",
        );
        return EXIT.usage;
      }
    }
    const response = await call("/api/cad/v1/ifc/domain-ir", {
      method: "POST",
      body: {
        ifc: input.source,
        domain: argv.domain,
        ...(vienneseBendInputs === undefined ? {} : { vienneseBendInputs }),
      },
      key: apiKey(argv),
      verbose: argv.verbose,
    });
    if (response.kind !== "ok") return reportFailure(response);
    writeJsonResult(response.json, argv.out);
    return argv.strict && response.json.releaseReady === false
      ? EXIT.server
      : EXIT.ok;
  }
  if (sub === "spatial-ir") {
    if (!file) {
      process.stderr.write(
        "usage: nexyfab ifc spatial-ir --file model.ifc [--strict]\n",
      );
      return EXIT.usage;
    }
    const input = readIfc(file, "spatial");
    if (!input.ok) {
      process.stderr.write(input.error + "\n");
      return EXIT.usage;
    }
    const response = await call("/api/cad/v1/ifc/spatial-ir", {
      method: "POST",
      body: { ifc: input.source },
      key: apiKey(argv),
      verbose: argv.verbose,
    });
    if (response.kind !== "ok") return reportFailure(response);
    writeJsonResult(response.json, argv.out);
    return argv.strict && response.json.releaseReady === false
      ? EXIT.server
      : EXIT.ok;
  }
  if (sub === "recovery-plan") {
    if (!file) {
      process.stderr.write(
        "usage: nexyfab ifc recovery-plan --file model.ifc [--strict]\n",
      );
      return EXIT.usage;
    }
    const input = readIfc(file, "recovery");
    if (!input.ok) {
      process.stderr.write(input.error + "\n");
      return EXIT.usage;
    }
    const response = await call("/api/cad/v1/ifc/recovery-plan", {
      method: "POST",
      body: { ifc: input.source },
      key: apiKey(argv),
      verbose: argv.verbose,
    });
    if (response.kind !== "ok") return reportFailure(response);
    writeJsonResult(response.json, argv.out);
    return argv.strict && response.json.releaseReady === false
      ? EXIT.server
      : EXIT.ok;
  }
  if (sub === "recover-geometry") {
    if (!file || !argv.inputs) {
      process.stderr.write(
        "usage: nexyfab ifc recover-geometry --file model.ifc --inputs authoritative-inputs.json [--strict]\n",
      );
      return EXIT.usage;
    }
    const input = readIfc(file, "recovery");
    if (!input.ok) {
      process.stderr.write(input.error + "\n");
      return EXIT.usage;
    }
    const parsed = readJsonFile(argv.inputs, "authoritative inputs JSON");
    if (!parsed.ok) {
      process.stderr.write(parsed.error + "\n");
      return EXIT.usage;
    }
    const authoritativeInputs = parsed.value;
    if (!Array.isArray(authoritativeInputs)) {
      process.stderr.write("authoritative inputs JSON must be an array\n");
      return EXIT.usage;
    }
    const response = await call("/api/cad/v1/ifc/recover-geometry", {
      method: "POST",
      body: { ifc: input.source, authoritativeInputs },
      key: apiKey(argv),
      verbose: argv.verbose,
    });
    if (response.kind !== "ok") return reportFailure(response);
    writeJsonResult(response.json, argv.out);
    return argv.strict && response.json.releaseReady === false
      ? EXIT.server
      : EXIT.ok;
  }
  if (sub !== "semantic-roundtrip" || !before || !after) {
    process.stderr.write(
      "usage: nexyfab ifc semantic-roundtrip --before source.ifc --after reimported.ifc [--out evidence.json] [--strict]\n",
    );
    return EXIT.usage;
  }
  const a = readIfc(before, "before"),
    b = readIfc(after, "after");
  if (!a.ok || !b.ok) {
    process.stderr.write((a.error ?? b.error) + "\n");
    return EXIT.usage;
  }
  const r = await call("/api/cad/v1/ifc/semantic-roundtrip", {
    method: "POST",
    body: { beforeIfc: a.source, afterIfc: b.source },
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return argv.strict && r.json.releaseReady === false ? EXIT.server : EXIT.ok;
}

async function cmdManufacturing(argv) {
  const sub = argv._[1];
  const file = argv.file ?? argv._[2];
  if (sub !== "verify" || !file) {
    process.stderr.write(
      "usage: nexyfab manufacturing verify --file evidence.json [--out result.json] [--strict]\n",
    );
    return EXIT.usage;
  }
  const parsed = readJsonFile(file, "manufacturing evidence");
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n");
    return EXIT.usage;
  }
  const r = await call("/api/cad/v1/manufacturing/verify", {
    method: "POST",
    body: parsed.value,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return r.json.designOk === false && argv.strict ? EXIT.server : EXIT.ok;
}

async function cmdGeneration(argv) {
  const sub = argv._[1];
  const file = argv.file ?? argv._[2];
  if (!["verify", "state", "advance", "finalize"].includes(sub) || !file) {
    process.stderr.write(
      "usage: nexyfab generation <verify|state|advance|finalize> --file payload.json [--out result.json] [--strict]\n",
    );
    return EXIT.usage;
  }
  const parsed = readJsonFile(
    file,
    sub === "verify"
      ? "AI generation evidence"
      : ["advance", "finalize"].includes(sub)
        ? "AI generation run evidence"
        : "AI generation state action",
  );
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n");
    return EXIT.usage;
  }
  const route =
    sub === "verify"
      ? "/api/cad/v1/generation/verify"
      : sub === "advance"
        ? "/api/cad/v1/generation/advance"
        : sub === "finalize"
          ? "/api/cad/v1/generation/finalize"
          : "/api/cad/v1/generation/state";
  const r = await call(route, {
    method: "POST",
    body: parsed.value,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return ((sub === "verify" && r.json.releaseReady === false) ||
    (sub === "advance" &&
      r.json.state?.stages?.assembly_solve?.status === "failed") ||
    (sub === "finalize" && r.json.stoppedAt !== "complete")) &&
    argv.strict
    ? EXIT.server
    : EXIT.ok;
}

async function cmdRobot(argv) {
  const sub = argv._[1];
  const file = argv.file ?? argv._[2];
  if (sub !== "generate" || !file) {
    process.stderr.write(
      "usage: nexyfab robot generate --file spec.json [--out result.json]\n",
    );
    return EXIT.usage;
  }
  const parsed = readJsonFile(file, "6-axis robot specification");
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n");
    return EXIT.usage;
  }
  const body = parsed.value?.spec ? parsed.value : { spec: parsed.value };
  const r = await call("/api/cad/v1/robot/generate", {
    method: "POST",
    body,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return r.json.releaseReady === false && argv.strict ? EXIT.server : EXIT.ok;
}

async function cmdAnimation(argv) {
  const sub = argv._[1],
    file = argv.file ?? argv._[2];
  if (!["command", "evaluate", "verify"].includes(sub) || !file) {
    process.stderr.write(
      'usage: nexyfab animation command|evaluate|verify --file animation.json [--command "0~120 frames arm X 100mm"] [--out result.json] [--strict]\n',
    );
    return EXIT.usage;
  }
  const parsed = readJsonFile(file, "assembly animation payload");
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n");
    return EXIT.usage;
  }
  const body =
    sub === "command"
      ? {
          ...parsed.value,
          command: argv.command ?? argv._.slice(3).join(" ").trim(),
        }
      : parsed.value;
  if (sub === "command" && !body.command) {
    process.stderr.write('animation command requires --command "..."\n');
    return EXIT.usage;
  }
  const r = await call(`/api/cad/v1/assembly/animation/${sub}`, {
    method: "POST",
    body,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return sub === "verify" && argv.strict && r.json.releaseReady === false
    ? EXIT.server
    : EXIT.ok;
}

async function cmdSpecialVerify(argv, command, route, label, wrapSpec = true, expectedSub = "verify") {
  const sub = argv._[1];
  const file = argv.file ?? argv._[2];
  if (sub !== expectedSub || !file) {
    process.stderr.write(`usage: nexyfab ${command} ${expectedSub} --file spec.json [--out result.json] [--strict]\n`);
    return EXIT.usage;
  }
  const parsed = readJsonFile(file, label);
  if (!parsed.ok) {
    process.stderr.write(parsed.error + "\n");
    return EXIT.usage;
  }
  const body =
    wrapSpec && !parsed.value?.spec ? { spec: parsed.value } : parsed.value;
  const r = await call(route, {
    method: "POST",
    body,
    key: apiKey(argv),
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);
  writeJsonResult(r.json, argv.out);
  return r.json.designOk === false && argv.strict ? EXIT.server : EXIT.ok;
}

async function cmdPackage(argv) {
  const key = apiKey(argv);
  if (!key) {
    process.stderr.write("✗ NEXYFAB_API_KEY 가 없습니다.\n");
    return EXIT.auth;
  }
  const file = argv.file ?? argv._[1];
  if (!file) {
    process.stderr.write(
      "사용: nexyfab package --file <assembly.json> [--out <dir>] [--lang ko|en|ja|zh|es|ar]\n",
    );
    return EXIT.usage;
  }
  const parsed = readJsonFile(file, "assembly file");
  if (!parsed.ok) {
    process.stderr.write(`✗ ${parsed.error}\n`);
    return EXIT.usage;
  }
  const assembly = parsed.value;

  const options = {};
  if (argv.lang) options.lang = String(argv.lang);
  if (argv.title) options.title = String(argv.title);

  const r = await call("/api/nexyfab/drawing/package", {
    method: "POST",
    body: { assembly, options },
    key,
    verbose: argv.verbose,
  });
  if (r.kind !== "ok") return reportFailure(r);

  const dir = resolve(String(argv.out ?? "./nexyfab-out"));
  if (r.json?.files !== undefined && !Array.isArray(r.json.files)) {
    process.stderr.write("server returned malformed package files\n");
    return EXIT.server;
  }
  const files = r.json?.files ?? [];
  if (files.length > MAX_PACKAGE_FILES) {
    process.stderr.write("server returned too many package files\n");
    return EXIT.server;
  }
  const packageEntries = [];
  const seenPackagePaths = new Set();
  let totalBytes = 0;
  for (const f of files) {
    if (!f || typeof f !== "object" || typeof f.name !== "string" || typeof f.content !== "string") {
      process.stderr.write("server returned a malformed package file entry\n");
      return EXIT.server;
    }
    const target = packageOutputPath(dir, f.name);
    if (!target.ok) {
      process.stderr.write(`${target.error}\n`);
      return EXIT.server;
    }
    const pathKey = process.platform === "win32" ? target.path.toLowerCase() : target.path;
    if (seenPackagePaths.has(pathKey)) {
      process.stderr.write(`server returned a duplicate package filename: ${f.name}\n`);
      return EXIT.server;
    }
    seenPackagePaths.add(pathKey);
    const bytes = Buffer.byteLength(f.content, "utf8");
    totalBytes += bytes;
    if (bytes > MAX_PACKAGE_FILE_BYTES || totalBytes > MAX_PACKAGE_TOTAL_BYTES) {
      process.stderr.write("server package output exceeds the local size limit\n");
      return EXIT.server;
    }
    packageEntries.push({ file: f, path: target.path });
  }
  let zipBytes = null;
  if (r.json?.zipBase64 !== undefined && r.json.zipBase64 !== null && r.json.zipBase64 !== "") {
    const encoded = r.json.zipBase64;
    if (typeof encoded !== "string" || !BASE64.test(encoded)) {
      process.stderr.write("server returned malformed package zip data\n");
      return EXIT.server;
    }
    zipBytes = Buffer.from(encoded, "base64");
    const zipPath = resolve(dir, "package.zip");
    const zipPathKey = process.platform === "win32" ? zipPath.toLowerCase() : zipPath;
    if (zipBytes.length === 0 || zipBytes.length > MAX_PACKAGE_TOTAL_BYTES || totalBytes + zipBytes.length > MAX_PACKAGE_TOTAL_BYTES || seenPackagePaths.has(zipPathKey)) {
      process.stderr.write("server package zip is empty, oversized, or conflicts with a package file\n");
      return EXIT.server;
    }
  }
  mkdirSync(dir, { recursive: true });
  let written = 0;
  for (const { file: f, path } of packageEntries) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.content);
    written++;
  }
  if (zipBytes) {
    writeFileSync(
      resolve(dir, "package.zip"),
      zipBytes,
    );
    written++;
  }
  process.stdout.write(`✓ ${written}개 파일 → ${dir}\n`);
  /**
   * ⚠ **실패한 산출물을 성공으로 세지 않는다.** 서버는 못 만든 것을 목록으로 알려 준다 —
   *   그걸 안 보여 주면 사용자는 파일 수만 보고 다 됐다고 읽는다.
   */
  const failed = r.json?.outputsFailed ?? [];
  if (failed.length) {
    process.stderr.write(
      `⚠ 만들지 못한 산출물 ${failed.length}건: ${failed.join(", ")}\n`,
    );
  }
  const dl = r.json?.summary?.documentLang ?? r.json?.documentLang;
  if (dl && dl.requested && dl.coverage !== "full") {
    process.stderr.write(
      `⚠ 문서 언어: 요청 ${dl.requested} · 본문 ${dl.content} · 번역 ${dl.coverage}\n`,
    );
  }
  return EXIT.ok;
}

// ── 인자 파싱 (의존성 없이) ─────────────────────────────────────────────────
function parseArgv(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      out._.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const name = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[name] = true;
      } else {
        out[name] = next;
        i++;
      }
      continue;
    }
    out._.push(a);
  }
  return out;
}

/**
 * Exact command labels advertised by GET /api/cad/v1/capabilities.
 *
 * Keep these as user-invocable spellings, including required flag hints.  The
 * capability parity test rejects a server entry that is absent here, and also
 * rejects a CLI-only claim that the server does not advertise.
 */
export const CAD_V1_CLI_COMMANDS = Object.freeze([
  "design",
  "part",
  "mesh",
  "step",
  "release decision",
  "reference analyze",
  "ifc semantic-roundtrip",
  "ifc domain-ir",
  "ifc spatial-ir",
  "reference mechanical-relations",
  "ifc recovery-plan",
  "ifc recover-geometry",
  "topology reconcile",
  "assembly verify",
  "project verify",
  "interior door-swing --file",
  "interior space-boundary --file",
  "interior egress --file",
  "interior mep-interference --file",
  "animation evaluate",
  "animation command",
  "assembly edit --verify-brep",
  "brep push-pull",
  "animation verify",
  "generation verify",
  "generation state --file",
  "generation advance --file",
  "generation finalize --file",
  "robot generate",
  "manufacturing verify",
  "sheet-metal verify",
  "weldment verify",
  "tolerance analyze",
  "pmi verify",
]);

const CAD_V1_CLI_COMMAND_LIST = CAD_V1_CLI_COMMANDS
  .map((command) => `  nexyfab ${command}`)
  .join("\n");

const USAGE = `nexyfab ${VERSION}

CAD v1 capability commands (exact spellings; run "nexyfab capabilities" for schemas):
${CAD_V1_CLI_COMMAND_LIST}

  nexyfab reference analyze --file m.step --scenario id --unit mm  exact CAD evidence JSON
  nexyfab ifc semantic-roundtrip --before a.ifc --after b.ifc [--strict]  IFC semantic preservation evidence
  nexyfab interior door-swing --file f [--strict]  continuous door swing clearance
  nexyfab interior space-boundary --file f [--strict]  planar room closure
  nexyfab interior egress --file f [--strict]  governed route and clear-width check
  nexyfab interior mep-interference --file f [--strict]  continuous MEP collision check
  nexyfab generation state --file action.json  staged generation checkpoint transition
  nexyfab generation advance --file run.json  kernel·topology·assembly evidence advancement
  nexyfab generation finalize --file evidence.json  motion·G0-G9·STEP roundtrip finalization
  nexyfab whoami                        키가 유효한지 확인
  nexyfab keys list                     내 API 키 목록
  nexyfab keys create <이름> [--days N] 키 발급 (평문은 1회만 출력)
  nexyfab keys revoke <keyId>           키 파기
  nexyfab assemble "<설명>" [--out f]   자연어 → 어셈블리 JSON
  nexyfab design "<product>" [--out f]  AI 다중 부품 제품 → 검증된 어셈블리 JSON
  nexyfab capabilities                 공통 CAD v1·legacy 호환 기능 조회
  nexyfab release decision --file f    STEP·IFC·BOM·도면·전문가 승인 릴리스 판정
  nexyfab part "<request>" [--current f] 선택 가능한 정밀 Feature Program 생성·수정
  nexyfab mesh --file tree.json --out m.stl  FeatureTree → STL
  nexyfab step --file program.json --out m.step  Feature Program → 검증된 STEP
  nexyfab assembly verify --file f [--strict]  Mate·DoF·간섭·운동 통합 검증
  nexyfab manufacturing verify --file f [--strict]  G0-G9 제조 증거 검증(견적 전송 없음)
  nexyfab sheet-metal verify --file f [--strict]  판금 전개·Bend Table·DXF 검증
  nexyfab weldment verify --file f [--strict]  용접 프레임 Miter·Cut List 검증
  nexyfab tolerance analyze --file f [--strict]  최악조건·RSS 공차 누적 분석
  nexyfab pmi verify --file f [--strict]  GD&T·안정 위상 참조 검증
  nexyfab topology reconcile --file f   면·선 참조와 Mate·도면·PMI 일괄 재연결
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
  if (!cmd || argv.help || cmd === "help") {
    process.stdout.write(USAGE);
    return EXIT.ok;
  }
  if (argv.version || cmd === "version") {
    process.stdout.write(VERSION + "\n");
    return EXIT.ok;
  }
  switch (cmd) {
    case "whoami":
      return cmdWhoami(argv);
    case "keys":
      return cmdKeys(argv);
    case "assemble":
      return cmdAssemble(argv);
    case "design":
      return cmdDesign(argv);
    case "capabilities":
      return cmdCapabilities(argv);
    case "release":
      return cmdRelease(argv);
    case "part":
      return cmdPart(argv);
    case "mesh":
      return cmdArtifact(argv, "mesh");
    case "step":
      return cmdArtifact(argv, "step");
    case "assembly":
      return cmdAssembly(argv);
    case "project":
      return cmdProject(argv);
    case "interior":
      return cmdInterior(argv);
    case "brep":
      return cmdBrep(argv);
    case "reference":
      return cmdReference(argv);
    case "ifc":
      return cmdIfc(argv);
    case "generation":
      return cmdGeneration(argv);
    case "robot":
      return cmdRobot(argv);
    case "animation":
      return cmdAnimation(argv);
    case "manufacturing":
      return cmdManufacturing(argv);
    case "sheet-metal":
      return cmdSpecialVerify(
        argv,
        "sheet-metal",
        "/api/cad/v1/sheet-metal/verify",
        "sheet-metal spec",
      );
    case "weldment":
      return cmdSpecialVerify(
        argv,
        "weldment",
        "/api/cad/v1/weldment/verify",
        "weldment spec",
      );
    case "tolerance":
      return cmdSpecialVerify(
        argv,
        "tolerance",
        "/api/cad/v1/tolerance/analyze",
        "tolerance chain",
        false,
        "analyze",
      );
    case "pmi":
      return cmdSpecialVerify(
        argv,
        "pmi",
        "/api/cad/v1/pmi/verify",
        "PMI payload",
        false,
      );
    case "topology":
      return cmdTopology(argv);
    case "package":
      return cmdPackage(argv);
    default:
      process.stderr.write(`알 수 없는 명령: ${cmd}\n\n${USAGE}`);
      return EXIT.usage;
  }
}

export { parseArgv, EXIT, USAGE, mask };

// 직접 실행일 때만 종료 코드를 세팅한다(테스트에서 import 하면 실행되지 않는다).
if (
  import.meta.url === `file://${process.argv[1]?.split("\\").join("/")}` ||
  import.meta.url.endsWith(process.argv[1]?.split("\\").join("/") ?? "\u0000")
) {
  main().then((code) => {
    process.exitCode = code;
  });
}
