/**
 * 통합 환경변수 로더 (CommonJS) — repo 상위의 .env 를 process.env 로 불러옵니다.
 *
 * 규칙:
 *   1. 존재하는 후보 파일을 순서대로 병합 (같은 키는 뒤 파일이 앞 파일을 덮어씀).
 *      - 일반: ../../../.env (…/nexyfab.com/new/scripts → repo 루트 .env)
 *      - 0429_nexyfab.com 번들: ../../../../.env 후 ../../../.env (monorepo 루트 → 번들)
 *   2. 스크립트 로드 시점의 OS env 키는 덮어쓰지 않음 (Railway/CI/shell export 우선).
 *   3. 각 파일 내부는 last-wins (뒤쪽 줄이 앞쪽 키를 override).
 *   4. Next.js 가 이후 .env.local 을 로드하면 그 값이 여기서 넣은 값을 override 가능.
 *
 * 사용:
 *   - next.config.ts:  require('./scripts/load-parent-env.cjs');
 *   - *.mjs:            import('./load-parent-env.cjs') 또는 createRequire 로 require.
 */
const fs = require('node:fs');
const path = require('node:path');

// new/scripts → …/nexyfab.com → 상위 폴더 이름이 0429 번들이면 monorepo 루(.env) 한 단계 더 올라감.
// 일반 clone(nexysys_1/nexyfab.com/new)에서는 ../../../../ 가 워크스페이스 밖이 될 수 있어 제외.
const bundleParent = path.basename(path.resolve(__dirname, '../../..'));
const PARENT_ENV_CANDIDATES =
  bundleParent === '0429_nexyfab.com'
    ? [
        path.resolve(__dirname, '../../../../.env'),
        path.resolve(__dirname, '../../../.env'),
      ]
    : [path.resolve(__dirname, '../../../.env')];

function parseEnvFile(filePath) {
  const parsed = {};
  if (!fs.existsSync(filePath)) return parsed;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    parsed[key] = val;
  }
  return parsed;
}

/**
 * 단일 파일을 process.env 에 반영 (테스트·스크립트용).
 * OS/이미 설정된 키는 건드리지 않음.
 */
function loadParentEnv(filePath) {
  const osPreexisting = new Set(Object.keys(process.env));
  const parsed = parseEnvFile(filePath);
  if (Object.keys(parsed).length === 0 && !fs.existsSync(filePath)) {
    if (process.env.NEXYFAB_ENV_DEBUG) {
      console.warn(`[parent-env] not found: ${filePath}`);
    }
    return { loaded: 0, path: filePath, exists: false };
  }
  let loaded = 0;
  for (const [key, val] of Object.entries(parsed)) {
    if (osPreexisting.has(key)) continue;
    process.env[key] = val;
    loaded++;
  }
  if (process.env.NEXYFAB_ENV_DEBUG && fs.existsSync(filePath)) {
    console.log(`[parent-env] loaded ${loaded} keys from ${filePath}`);
  }
  return { loaded, path: filePath, exists: fs.existsSync(filePath) };
}

function loadAllParentEnvFiles() {
  const osPreexisting = new Set(Object.keys(process.env));
  const merged = {};
  const loadedPaths = [];
  for (const filePath of PARENT_ENV_CANDIDATES) {
    if (!fs.existsSync(filePath)) continue;
    loadedPaths.push(filePath);
    Object.assign(merged, parseEnvFile(filePath));
  }
  let loaded = 0;
  for (const [key, val] of Object.entries(merged)) {
    if (osPreexisting.has(key)) continue;
    process.env[key] = val;
    loaded++;
  }
  if (process.env.NEXYFAB_ENV_DEBUG && loadedPaths.length === 0) {
    console.warn('[parent-env] no candidate .env found:', PARENT_ENV_CANDIDATES.join(', '));
  }
  return { loaded, paths: loadedPaths };
}

loadAllParentEnvFiles();

module.exports = { loadParentEnv, loadAllParentEnvFiles, PARENT_ENV_CANDIDATES, parseEnvFile };
