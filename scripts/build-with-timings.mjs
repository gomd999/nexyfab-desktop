#!/usr/bin/env node
import { spawn } from 'node:child_process';

const startedAt = Date.now();
const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const args = npmCli ? [npmCli, 'run', 'build'] : ['run', 'build'];
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: false,
});

function relay(stream, destination) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1).padStart(7);
      destination.write(`[build +${seconds}s] ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (pending) destination.write(`[build +${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${pending}\n`);
  });
}

relay(child.stdout, process.stdout);
relay(child.stderr, process.stderr);
child.on('error', error => {
  console.error(`[build] unable to start: ${error.message}`);
  process.exitCode = 1;
});
child.on('close', code => {
  const elapsedMs = Date.now() - startedAt;
  console.log(JSON.stringify({ event: 'build-complete', ok: code === 0, exitCode: code ?? 1, elapsedMs }));
  process.exitCode = code ?? 1;
});
