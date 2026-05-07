#!/usr/bin/env node
/**
 * register-release.mjs — CI/로컬에서 새 릴리즈를 DB에 등록하는 헬퍼.
 *
 * 사용법:
 *   node scripts/register-release.mjs --version 0.1.0 --notes "첫 릴리즈" [--latest]
 *     [--win-url <url>] [--mac-arm-url <url>] [--mac-x64-url <url>] [--linux-url <url>]
 *     [--win-sig <base64>] [--mac-arm-sig <base64>] [--mac-x64-sig <base64>] [--linux-sig <base64>]
 *
 * 필수 환경변수 (parent .env 또는 CI env):
 *   ADMIN_SECRET   - /api/admin/releases 인증용
 *   APP_URL        - https://nexyfab.com  (기본: http://localhost:3000)
 *
 * URL을 생략하면 서버가 S3_PUBLIC_URL 기반으로 자동 생성합니다.
 */
import './load-parent-env.mjs';

function parseArgs(argv) {
  const args = { latest: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--latest') { args.latest = true; continue; }
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (!val || val.startsWith('--')) { args[key] = true; continue; }
    args[key] = val;
    i++;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.version) {
    console.error('Error: --version is required (e.g. --version 0.1.0)');
    process.exit(1);
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    console.error('Error: ADMIN_SECRET env var is required.');
    process.exit(1);
  }
  const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

  const payload = {
    version: args.version,
    notes: args.notes ?? `## NexyFab ${args.version}\n\n- 새 릴리즈`,
    is_latest: !!args.latest,
    download_win_x64:     args['win-url']     ?? undefined,
    download_mac_aarch64: args['mac-arm-url'] ?? undefined,
    download_mac_x64:     args['mac-x64-url'] ?? undefined,
    download_linux_x64:   args['linux-url']   ?? undefined,
    sig_win_x64:     args['win-sig']     ?? undefined,
    sig_mac_aarch64: args['mac-arm-sig'] ?? undefined,
    sig_mac_x64:     args['mac-x64-sig'] ?? undefined,
    sig_linux_x64:   args['linux-sig']   ?? undefined,
  };

  console.log(`[register-release] POST ${appUrl}/api/admin/releases version=${args.version} latest=${payload.is_latest}`);

  const res = await fetch(`${appUrl}/api/admin/releases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': secret,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`[register-release] Failed (${res.status}): ${text}`);
    process.exit(1);
  }
  console.log(`[register-release] OK (${res.status}): ${text}`);
}

main().catch((err) => {
  console.error('[register-release] Unexpected error:', err);
  process.exit(1);
});
