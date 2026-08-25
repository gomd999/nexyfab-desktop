#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(root, 'containers', 'commercial-precision-durability', 'compose.yml');
const project = `nexyfab-precision-durability-${process.pid}`;
const keep = process.argv.includes('--keep');
const write = process.argv.includes('--write');

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
}

process.exitCode = exitCode;
