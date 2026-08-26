#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalTextBytes } from './canonical-evidence-bytes.mjs';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const mode = args.has('--write') ? 'write' : 'check';
const lockPath = path.join(root, 'package-lock.json');
const outputPath = path.join(root, 'src', 'content', 'third-party-notices.generated.json');
const overridesPath = path.join(root, 'docs', 'legal', 'license-overrides.json');
const criticalCopyleft = new Set(['opencascade.js', 'occt-import-js', '@salusoft89/planegcs']);

if (!fs.existsSync(lockPath)) throw new Error('package-lock.json is required');
const lockBytes = canonicalTextBytes(fs.readFileSync(lockPath));
const lock = JSON.parse(lockBytes.toString('utf8'));
if (lock.lockfileVersion !== 3 || !lock.packages) throw new Error('package-lock v3 packages map is required');
if (!fs.existsSync(overridesPath)) throw new Error('docs/legal/license-overrides.json is required');
const overridesBytes = canonicalTextBytes(fs.readFileSync(overridesPath));
const overridesDocument = JSON.parse(overridesBytes.toString('utf8'));
if (overridesDocument.schema !== 'nexyfab.license-overrides.v1' || !Array.isArray(overridesDocument.overrides)) {
  throw new Error('license override document must use nexyfab.license-overrides.v1');
}

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const packageNameFromPath = packagePath => {
  const marker = 'node_modules/';
  const index = packagePath.lastIndexOf(marker);
  const tail = index >= 0 ? packagePath.slice(index + marker.length) : packagePath;
  const parts = tail.split('/');
  return parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
};
const repositoryUrl = value => {
  const raw = typeof value === 'string' ? value : value?.url;
  if (!raw) return null;
  if (raw.startsWith('github:')) return `https://github.com/${raw.slice(7)}`;
  return raw.replace(/^git\+/, '').replace(/\.git$/, '');
};
const findLicense = packageDir => {
  if (!fs.existsSync(packageDir)) return null;
  const name = fs.readdirSync(packageDir).find(entry => /^(licen[cs]e|copying)(\.|$)/i.test(entry));
  if (!name) return null;
  const file = path.join(packageDir, name);
  if (!fs.statSync(file).isFile()) return null;
  const bytes = canonicalTextBytes(fs.readFileSync(file));
  return { file: name, sha256: sha256(bytes), bytes: bytes.length };
};

const packages = [];
const issues = [];
const overrideMap = new Map();
for (const override of overridesDocument.overrides) {
  const key = `${override.package}@${override.version}`;
  if (overrideMap.has(key)) throw new Error(`duplicate license override: ${key}`);
  if (!override.license || !override.licenseFile || !/^https:\/\//.test(override.evidenceUrl ?? '') || !override.reviewedAt) {
    throw new Error(`incomplete license override: ${key}`);
  }
  const licenseFilePath = path.resolve(root, ...String(override.licenseFile).split('/'));
  if (!licenseFilePath.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(licenseFilePath)) {
    throw new Error(`license override artifact missing or outside repository: ${key}`);
  }
  overrideMap.set(key, { ...override, licenseFilePath });
}
const usedOverrides = new Set();
for (const [packagePath, lockEntry] of Object.entries(lock.packages)) {
  if (!packagePath || lockEntry.dev === true) continue;
  const name = lockEntry.name ?? packageNameFromPath(packagePath);
  if (!name || !lockEntry.version) continue;
  const packageDir = path.join(root, ...packagePath.split('/'));
  const manifestPath = path.join(packageDir, 'package.json');
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch { issues.push({ code: 'INVALID_PACKAGE_MANIFEST', package: `${name}@${lockEntry.version}` }); }
  }
  let licenseArtifact = findLicense(packageDir);
  const licenseText = licenseArtifact ? fs.readFileSync(path.join(packageDir, licenseArtifact.file), 'utf8') : '';
  const inferredLicense = /^MIT License\b/i.test(licenseText.trim()) ? 'MIT' : null;
  const packageKey = `${name}@${lockEntry.version}`;
  const reviewedOverride = overrideMap.get(packageKey);
  let license = manifest?.license ?? lockEntry.license ?? inferredLicense;
  let licenseReview = null;
  if (!license && reviewedOverride) {
    const bytes = canonicalTextBytes(fs.readFileSync(reviewedOverride.licenseFilePath));
    license = reviewedOverride.license;
    licenseArtifact = {
      file: reviewedOverride.licenseFile,
      sha256: sha256(bytes),
      bytes: bytes.length,
    };
    licenseReview = {
      evidenceUrl: reviewedOverride.evidenceUrl,
      evidenceNote: reviewedOverride.evidenceNote,
      reviewedAt: reviewedOverride.reviewedAt,
    };
    usedOverrides.add(packageKey);
  }
  if (!license) issues.push({ code: 'LICENSE_METADATA_MISSING', package: `${name}@${lockEntry.version}` });
  if (criticalCopyleft.has(name) && !licenseArtifact) {
    issues.push({ code: 'COPYLEFT_LICENSE_TEXT_MISSING', package: `${name}@${lockEntry.version}` });
  }
  packages.push({
    name,
    version: String(lockEntry.version),
    license: license ?? 'UNKNOWN',
    url: repositoryUrl(manifest?.repository) ?? manifest?.homepage ?? `https://www.npmjs.com/package/${encodeURIComponent(name)}/v/${lockEntry.version}`,
    direct: packagePath === `node_modules/${name}`,
    ...(licenseArtifact ? { licenseArtifact } : {}),
    ...(licenseReview ? { licenseReview } : {}),
  });
}

for (const key of overrideMap.keys()) {
  if (!usedOverrides.has(key)) issues.push({ code: 'LICENSE_OVERRIDE_UNUSED', package: key });
}

const uniquePackages = [...packages.reduce((map, item) => {
  const key = `${item.name}@${item.version}`;
  const existing = map.get(key);
  map.set(key, existing ? { ...existing, direct: existing.direct || item.direct } : item);
  return map;
}, new Map()).values()];
uniquePackages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
for (const name of criticalCopyleft) {
  const item = uniquePackages.find(pkg => pkg.name === name);
  if (!item) issues.push({ code: 'REQUIRED_COPYLEFT_COMPONENT_MISSING', package: name });
  else if (!/^LGPL-/i.test(item.license)) issues.push({ code: 'COPYLEFT_LICENSE_UNEXPECTED', package: `${item.name}@${item.version}`, license: item.license });
}

const output = {
  schema: 'nexyfab.third-party-notices.v1',
  title: 'Open-source and third-party components',
  notice: 'Generated from package-lock.json for production dependencies. Legal review and corresponding-source delivery records remain separate release evidence.',
  packageLockSha256: sha256(lockBytes),
  licenseOverridesSha256: sha256(overridesBytes),
  packageCount: uniquePackages.length,
  criticalCopyleft: uniquePackages.filter(item => criticalCopyleft.has(item.name)),
  issues,
  packages: uniquePackages,
};
const serialized = `${JSON.stringify(output, null, 2)}\n`;

if (mode === 'write') {
  fs.writeFileSync(outputPath, serialized, 'utf8');
  const summary = { ok: issues.length === 0, mode, output: path.relative(root, outputPath).replaceAll('\\', '/'), packages: uniquePackages.length, criticalCopyleft: output.criticalCopyleft.length, issues };
  (issues.length ? console.error : console.log)(JSON.stringify(summary, null, issues.length ? 2 : 0));
  if (issues.length) process.exitCode = 1;
} else if (issues.length) {
  console.error(JSON.stringify({ ok: false, mode, issues }, null, 2));
  process.exitCode = 1;
} else if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== serialized) {
  console.error(JSON.stringify({ ok: false, mode, code: 'THIRD_PARTY_NOTICES_STALE', expectedPackages: uniquePackages.length }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, mode, packages: uniquePackages.length, criticalCopyleft: output.criticalCopyleft.length }));
}
