#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { chromium, firefox, webkit } from '@playwright/test';
import { pathToFileURL } from 'node:url';

export function browserInstallIssues(paths) {
  return Object.entries(paths)
    .filter(([, executable]) => !executable || !existsSync(executable))
    .map(([name, executable]) => ({
      name,
      executable,
      installCommand: `npx playwright install --with-deps ${name}`,
    }));
}

export function installedBrowserPaths() {
  return {
    chromium: chromium.executablePath(),
    firefox: firefox.executablePath(),
    webkit: webkit.executablePath(),
  };
}

async function main() {
  const allPaths = installedBrowserPaths();
  const requested = process.argv.slice(2);
  const paths = requested.length
    ? Object.fromEntries(requested.filter(name => name in allPaths).map(name => [name, allPaths[name]]))
    : allPaths;
  if (requested.length && Object.keys(paths).length !== requested.length) {
    throw new Error('Browser names must be chromium, firefox or webkit');
  }
  const issues = browserInstallIssues(paths);
  for (const [name, executable] of Object.entries(paths)) {
    const installed = !issues.some(issue => issue.name === name);
    process.stdout.write(`${installed ? 'PASS' : 'MISSING'} ${name}: ${executable}\n`);
  }
  if (issues.length) {
    process.stderr.write('\nInstall missing runtimes before the browser matrix:\n');
    for (const issue of issues) process.stderr.write(`- ${issue.installCommand}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) void main();
