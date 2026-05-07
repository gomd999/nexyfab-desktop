#!/usr/bin/env tsx
/**
 * NexyFab Database Backup
 * Usage:
 *   npx tsx scripts/backup.ts           -- backup to S3 (or local if no S3)
 *   npx tsx scripts/backup.ts --local   -- force local backup only
 *   npx tsx scripts/backup.ts --list    -- list recent backups
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.join(__dirname, '..');

// parent .env → .env.local 순으로 로드. OS/CI env 는 파일 값보다 우선.
function loadEnvFile(filePath: string, allowOverride: boolean, osKeys: Set<string>) {
  if (!fs.existsSync(filePath)) return;
  const parsed: Record<string, string> = {};
  for (const raw of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    parsed[key] = value;
  }
  for (const [k, v] of Object.entries(parsed)) {
    if (osKeys.has(k)) continue;
    if (!allowOverride && process.env[k] !== undefined) continue;
    process.env[k] = v;
  }
}
const osKeysAtStart = new Set(Object.keys(process.env));
loadEnvFile(path.resolve(ROOT, '../..', '.env'), false, osKeysAtStart);
loadEnvFile(path.join(ROOT, '.env.local'), true, osKeysAtStart);

const BACKUP_DIR = path.join(ROOT, 'backups');
const DB_PATH = path.join(ROOT, 'data', 'nexyfab.db');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS ?? '30', 10);

async function main() {
  const args = process.argv.slice(2);
  const forceLocal = args.includes('--local');
  const listMode = args.includes('--list');

  if (listMode) {
    listBackups();
    return;
  }

  console.log(`[backup] Starting NexyFab backup — ${new Date().toISOString()}`);

  if (process.env.DATABASE_URL) {
    await backupPostgres(forceLocal);
  } else {
    await backupSqlite(forceLocal);
  }
}

async function backupSqlite(forceLocal: boolean) {
  if (!fs.existsSync(DB_PATH)) {
    console.error('[backup] SQLite DB not found at:', DB_PATH);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `nexyfab-sqlite-${timestamp}.db`;

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const localPath = path.join(BACKUP_DIR, filename);

  // Copy SQLite file (safe copy — SQLite WAL mode handles concurrency)
  fs.copyFileSync(DB_PATH, localPath);
  console.log(`[backup] SQLite backup created: ${localPath} (${(fs.statSync(localPath).size / 1024).toFixed(1)} KB)`);

  if (!forceLocal && process.env.S3_BUCKET && process.env.AWS_REGION) {
    await uploadToS3(localPath, `backups/${filename}`);
  }

  cleanOldBackups();
}

async function backupPostgres(forceLocal: boolean) {
  const dbUrl = process.env.DATABASE_URL!;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `nexyfab-postgres-${timestamp}.sql.gz`;

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const localPath = path.join(BACKUP_DIR, filename);

  try {
    // pg_dump via DATABASE_URL
    execSync(`pg_dump "${dbUrl}" | gzip > "${localPath}"`, { stdio: 'inherit' });
    console.log(`[backup] PostgreSQL backup created: ${localPath}`);
  } catch (err) {
    console.error('[backup] pg_dump failed. Is pg_dump installed?', err);
    process.exit(1);
  }

  if (!forceLocal && process.env.S3_BUCKET && process.env.AWS_REGION) {
    await uploadToS3(localPath, `backups/${filename}`);
  }

  cleanOldBackups();
}

async function uploadToS3(localPath: string, s3Key: string) {
  try {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region: process.env.AWS_REGION });
    const fileBuffer = fs.readFileSync(localPath);

    await client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: 'application/octet-stream',
      StorageClass: 'STANDARD_IA', // infrequent access = cheaper for backups
      Metadata: {
        'nexyfab-backup': 'true',
        'created-at': new Date().toISOString(),
      },
    }));

    console.log(`[backup] Uploaded to S3: s3://${process.env.S3_BUCKET}/${s3Key}`);
  } catch (err) {
    console.error('[backup] S3 upload failed (keeping local copy):', err);
  }
}

function cleanOldBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const files = fs.readdirSync(BACKUP_DIR);
  let deleted = 0;
  for (const f of files) {
    const fp = path.join(BACKUP_DIR, f);
    const stat = fs.statSync(fp);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(fp);
      deleted++;
    }
  }
  if (deleted > 0) console.log(`[backup] Cleaned ${deleted} old backup(s) (>${RETENTION_DAYS} days)`);
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) { console.log('No backups found.'); return; }
  const files = fs.readdirSync(BACKUP_DIR)
    .map(f => ({ name: f, stat: fs.statSync(path.join(BACKUP_DIR, f)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, 20);

  console.log('\nRecent backups:');
  for (const { name, stat } of files) {
    console.log(`  ${name} — ${(stat.size / 1024).toFixed(1)} KB — ${new Date(stat.mtime).toLocaleString()}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
