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

// Load .env.local
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

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
