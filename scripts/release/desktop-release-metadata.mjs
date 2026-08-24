import { spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function resolveReleaseVersion({ refName = '', inputVersion = '' }) {
  const candidate = refName.startsWith('v') ? refName.slice(1) : inputVersion.replace(/^v/, '');
  if (!SEMVER_PATTERN.test(candidate)) {
    throw new Error('Release version must be a strict SemVer value such as 1.2.3 or 1.2.3-rc.1.');
  }
  return candidate;
}

export function extractChangelogSection(source, version) {
  const lines = source.split(/\r?\n/);
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^##\\s+\\[?v?${escapedVersion}\\]?(?:\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return '';

  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    section.push(line);
  }
  return section.join('\n').trim();
}

export function buildReleasePayload({ version, notes, signatures = {} }) {
  return {
    version,
    notes,
    is_latest: true,
    sig_win_x64: signatures.winX64 ?? '',
    sig_mac_aarch64: signatures.macAarch64 ?? '',
    sig_mac_x64: signatures.macX64 ?? '',
    sig_linux_x64: signatures.linuxX64 ?? '',
  };
}

async function findSignature(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findSignature(candidate);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.endsWith('.sig')) {
      const value = (await readFile(candidate, 'utf8')).trim();
      if (value.length > 16_384) throw new Error(`Signature file is unexpectedly large: ${candidate}`);
      return value;
    }
  }
  return '';
}

async function releaseNotes(version) {
  const changelog = await readFile('CHANGELOG.md', 'utf8').catch(() => '');
  const fromChangelog = extractChangelogSection(changelog, version);
  if (fromChangelog) return fromChangelog;

  const tag = spawnSync('git', ['tag', '-l', '--format=%(contents)', `v${version}`], {
    encoding: 'utf8',
    shell: false,
  });
  const fromTag = tag.status === 0 ? tag.stdout.trim() : '';
  return fromTag || `## NexyFab ${version}\n\n- New release`;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? '' : '';
}

async function main() {
  const command = process.argv[2];
  const version = resolveReleaseVersion({ refName: argument('--ref'), inputVersion: argument('--input') });

  if (command === 'version') {
    process.stdout.write(version);
    return;
  }
  if (command !== 'payload') throw new Error('Expected command: version or payload');

  const sigRoot = path.resolve(argument('--sigs') || 'sigs');
  const output = argument('--output');
  if (!output) throw new Error('--output is required for payload generation');

  const signatures = {
    winX64: await findSignature(path.join(sigRoot, 'sig-win-x64')),
    macAarch64: await findSignature(path.join(sigRoot, 'sig-mac-aarch64')),
    macX64: await findSignature(path.join(sigRoot, 'sig-mac-x64')),
    linuxX64: await findSignature(path.join(sigRoot, 'sig-linux-x64')),
  };
  const missing = Object.entries(signatures).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Missing required desktop signatures: ${missing.join(', ')}`);

  const payload = buildReleasePayload({ version, notes: await releaseNotes(version), signatures });
  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
