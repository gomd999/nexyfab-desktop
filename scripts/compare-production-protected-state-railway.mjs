#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { compareProtectedState } from './compare-production-protected-state.mjs';

const railway = process.platform === 'win32'
  ? {
      file: 'powershell.exe',
      prefix: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(process.env.APPDATA ?? '', 'npm', 'railway.ps1')],
    }
  : { file: 'railway', prefix: [] };
const environment = process.env.RAILWAY_COMPARE_ENVIRONMENT ?? 'production';
const webService = process.env.RAILWAY_COMPARE_WEB_SERVICE ?? 'nexyfab.com';
const databaseService = process.env.RAILWAY_COMPARE_DATABASE_SERVICE ?? 'Postgres-KN2x';
const baselineDatabase = process.env.RAILWAY_COMPARE_BASELINE_DATABASE ?? 'nexyfab_restore_drill_260810';
const output = path.resolve(process.env.PROTECTED_STATE_RECEIPT_OUTPUT ?? 'docs/evidence/release/production-protected-state-receipt.json');

function variables(service) {
  const raw = execFileSync(railway.file, [...railway.prefix,
    'variable', 'list', '--service', service, '--environment', environment, '--json',
  ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(raw);
}

function publicDatabaseUrl(privateValue, publicValue, databaseName) {
  const privateUrl = new URL(privateValue);
  const publicUrl = new URL(publicValue);
  publicUrl.username = privateUrl.username;
  publicUrl.password = privateUrl.password;
  publicUrl.pathname = `/${databaseName}`;
  return publicUrl.toString();
}

try {
  const web = variables(webService);
  const database = variables(databaseService);
  if (!web.DATABASE_URL || !database.DATABASE_PUBLIC_URL) {
    throw new Error('Required Railway database references are unavailable');
  }
  const productionName = new URL(web.DATABASE_URL).pathname.replace(/^\//, '');
  const candidateUrl = publicDatabaseUrl(web.DATABASE_URL, database.DATABASE_PUBLIC_URL, productionName);
  const baselineUrl = publicDatabaseUrl(web.DATABASE_URL, database.DATABASE_PUBLIC_URL, baselineDatabase);
  const receipt = await compareProtectedState({
    baselineUrl,
    candidateUrl,
    release: {
      buildId: process.env.RELEASE_BUILD_ID ?? null,
      deploymentId: process.env.RELEASE_DEPLOYMENT_ID ?? null,
      gitHead: process.env.RELEASE_GIT_HEAD ?? null,
    },
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ ok: receipt.ok, protectedTableCount: receipt.protectedTableCount, blockers: receipt.blockers }));
  if (!receipt.ok) process.exitCode = 1;
} catch (error) {
  console.error(`[production-protected-state-railway] ${error instanceof Error ? error.message : 'comparison failed'}`);
  process.exitCode = 1;
}
