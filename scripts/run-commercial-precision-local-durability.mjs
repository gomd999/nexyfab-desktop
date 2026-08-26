#!/usr/bin/env node
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(root, 'containers', 'commercial-precision-durability', 'compose.yml');
const project = `nexyfab-precision-durability-${process.pid}`;
const keep = process.argv.includes('--keep');
const write = process.argv.includes('--write');
const crossStoreOutput = path.join(root, 'docs', 'evidence', 'cad-independent', 'commercial-precision-cross-store-restore-20260825.json');

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() : '';
    throw new Error(`${executable} ${args.join(' ')} failed (${result.status})${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout ?? '').trim();
}

function compose(...args) {
  return command('docker', ['compose', '--project-name', project, '--file', composeFile, ...args], {
    capture: args[0] === 'port',
  });
}

function publishedPort(service, containerPort) {
  const value = compose('port', service, String(containerPort));
  const match = value.match(/:(\d+)\s*$/);
  if (!match) throw new Error(`published port unavailable for ${service}:${containerPort}`);
  return Number(match[1]);
}

let exitCode = 0;
let temporaryDirectory;
try {
  compose('up', '--detach', '--wait');
  const databasePort = publishedPort('postgres', 5432);
  const redisPort = publishedPort('redis', 6379);
  const objectStoragePort = publishedPort('object-storage', 9000);
  const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  command(process.execPath, [
    tsxCli, 'scripts/commercial-precision-local-durability-campaign.ts',
    ...(write ? ['--write'] : []),
  ], {
    env: {
      ...process.env,
      LOCAL_DURABILITY_DATABASE_URL: `postgresql://nexyfab:local-durability-only@127.0.0.1:${databasePort}/nexyfab`,
      LOCAL_DURABILITY_REDIS_URL: `redis://127.0.0.1:${redisPort}`,
      LOCAL_DURABILITY_S3_ENDPOINT: `http://127.0.0.1:${objectStoragePort}`,
      LOCAL_DURABILITY_COMPOSE_PROJECT: project,
    },
  });

  // Docker Desktop may republish random host ports when the campaign restarts
  // the persistence services. Resolve them again before the independent
  // restore process opens fresh clients.
  const restoreDatabasePort = publishedPort('postgres', 5432);
  const restoreObjectStoragePort = publishedPort('object-storage', 9000);

  // Reuse the completed commercial campaign state before its disposable
  // volumes are removed. This gives the restore drill real immutable input,
  // output, snapshot, outbox, journal, and workspace bindings without seeding
  // a second synthetic database model.
  compose('exec', '--no-TTY', 'postgres', 'psql', '-U', 'nexyfab', '-d', 'nexyfab',
    '-X', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE nexyfab_restore_drill_local');
  const objectEndpoint = `http://127.0.0.1:${restoreObjectStoragePort}`;
  const objectClient = new S3Client({
    endpoint: objectEndpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'nexyfab-local', secretAccessKey: 'local-durability-secret-only' },
  });
  try {
    await objectClient.send(new CreateBucketCommand({ Bucket: 'nexyfab-local-backup' }));
    await objectClient.send(new CreateBucketCommand({ Bucket: 'nexyfab-local-restore-drill' }));
  } finally {
    objectClient.destroy();
  }

  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'nexyfab-cross-store-restore-'));
  const backupFile = path.join(temporaryDirectory, 'postgres.sql.gz');
  const receiptPath = path.join(temporaryDirectory, 'cross-store-restore.json');
  const gitHead = command('git', ['rev-parse', 'HEAD'], { capture: true });
  command(process.execPath, ['scripts/verify-backup-restore.mjs'], {
    env: {
      ...process.env,
      SOURCE_DATABASE_URL: `postgresql://nexyfab:local-durability-only@127.0.0.1:${restoreDatabasePort}/nexyfab`,
      RESTORE_DATABASE_URL: `postgresql://nexyfab:local-durability-only@127.0.0.1:${restoreDatabasePort}/nexyfab_restore_drill_local`,
      RESTORE_DRILL_ENVIRONMENT: 'local-fixture',
      RESTORE_DRILL_CONFIRM: 'NEXYFAB_ISOLATED_RESTORE_ONLY',
      RESTORE_EVIDENCE_CLASS: 'local-fixture',
      RESTORE_POSTGRES_CLIENT_CONTAINER: `${project}-postgres-1`,
      RESTORE_RELEASE_BUILD_ID: `local-cross-store-${gitHead.slice(0, 12)}`,
      RESTORE_RELEASE_DEPLOYMENT_ID: project,
      RESTORE_RELEASE_GIT_HEAD: gitHead,
      BACKUP_FILE: backupFile,
      BACKUP_RESTORE_RECEIPT: receiptPath,
      POSTGRES_MIGRATION_SQL: path.join(root, 'src', 'lib', 'db-postgres-migrations.sql'),
      RESTORE_OBJECT_DRILL_CONFIRM: 'NEXYFAB_ISOLATED_OBJECT_RESTORE_ONLY',
      ...Object.fromEntries(['SOURCE', 'BACKUP', 'TARGET'].flatMap(role => [
        [`RESTORE_OBJECT_${role}_ENDPOINT`, objectEndpoint],
        [`RESTORE_OBJECT_${role}_REGION`, 'us-east-1'],
        [`RESTORE_OBJECT_${role}_ACCESS_KEY_ID`, 'nexyfab-local'],
        [`RESTORE_OBJECT_${role}_SECRET_ACCESS_KEY`, 'local-durability-secret-only'],
        [`RESTORE_OBJECT_${role}_FORCE_PATH_STYLE`, '1'],
      ])),
      RESTORE_OBJECT_SOURCE_BUCKET: 'nexyfab-local-durability',
      RESTORE_OBJECT_SOURCE_PREFIX: 'private/',
      RESTORE_OBJECT_BACKUP_BUCKET: 'nexyfab-local-backup',
      RESTORE_OBJECT_BACKUP_PREFIX: `backup/${gitHead}/`,
      RESTORE_OBJECT_TARGET_BUCKET: 'nexyfab-local-restore-drill',
      RESTORE_OBJECT_TARGET_PREFIX: `restore-drill/${gitHead}/`,
    },
  });
  if (write) copyFileSync(receiptPath, crossStoreOutput);
} catch (error) {
  process.stderr.write(`[commercial-precision-local-durability] ${error instanceof Error ? error.message : String(error)}\n`);
  exitCode = 1;
} finally {
  if (!keep) {
    try { compose('down', '--volumes', '--remove-orphans'); }
    catch (error) {
      process.stderr.write(`[commercial-precision-local-durability] cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
      exitCode = 1;
    }
  } else {
    process.stderr.write(`[commercial-precision-local-durability] retained compose project ${project}\n`);
  }
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}

process.exitCode = exitCode;
