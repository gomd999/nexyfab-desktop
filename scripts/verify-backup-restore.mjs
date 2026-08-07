#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

export function assertDrillTarget(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('RESTORE_DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('RESTORE_DATABASE_URL must use postgres:// or postgresql://');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database.includes('_restore_drill')) {
    throw new Error("Refusing restore: target database name must contain '_restore_drill'");
  }
  return { database, hostname: parsed.hostname };
}

function runPsql(databaseUrl, args, input) {
  const child = spawn('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`psql exited ${code}: ${stderr.slice(-1000)}`));
    });
  });
  return { child, completion };
}

export async function verifyBackupRestore({ backupFile, databaseUrl }) {
  const target = assertDrillTarget(databaseUrl);
  if (!existsSync(backupFile) || !statSync(backupFile).isFile()) {
    throw new Error(`Backup file not found: ${backupFile}`);
  }
  if (statSync(backupFile).size === 0) throw new Error('Backup file is empty');

  const restore = runPsql(databaseUrl, [], true);
  const source = createReadStream(backupFile);
  const sql = backupFile.endsWith('.gz') ? source.pipe(createGunzip()) : source;
  await pipeline(sql, restore.child.stdin);
  await restore.completion;

  const check = runPsql(databaseUrl, [
    '-At',
    '-c',
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';",
  ], false);
  const tableCount = Number((await check.completion).trim());
  if (!Number.isFinite(tableCount) || tableCount < 1) {
    throw new Error(`Restore integrity check failed: public table count=${tableCount}`);
  }
  return { ok: true, ...target, tableCount, backupBytes: statSync(backupFile).size };
}

async function main() {
  const backupFile = process.env.BACKUP_FILE;
  const databaseUrl = process.env.RESTORE_DATABASE_URL;
  if (!backupFile || !databaseUrl) {
    throw new Error('Set BACKUP_FILE and RESTORE_DATABASE_URL (database name must include _restore_drill)');
  }
  const result = await verifyBackupRestore({ backupFile, databaseUrl });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`[backup-restore] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
