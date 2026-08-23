#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const I18N_FULL_PRODUCT_REVIEW_RECEIPT = 'nexyfab.commercial-i18n-full-product-artifact-review.v1';
export const I18N_FULL_PRODUCT_LOCALES = Object.freeze(['kr', 'en', 'ja', 'cn', 'es', 'ar']);
export const I18N_FULL_PRODUCT_ARTIFACTS = Object.freeze(['visual', 'rtl', 'email', 'pdf', 'export']);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const portable = value => String(value).replaceAll('\\', '/');
const render = value => `${JSON.stringify(value, null, 2)}\n`;

function option(args, name, fallback = null) {
  const found = args.find(value => value.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

function safeEvidenceFile(root, relative) {
  if (typeof root !== 'string' || !root.trim() || typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) return { ok: false, reason: 'path_invalid' };
  const normalized = relative.replaceAll('\\', '/');
  if (normalized.split('/').includes('..')) return { ok: false, reason: 'path_traversal' };
  try {
    const realRoot = fs.realpathSync(path.resolve(root));
    const absolute = path.resolve(realRoot, ...normalized.split('/'));
    if (absolute !== realRoot && !absolute.startsWith(`${realRoot}${path.sep}`)) return { ok: false, reason: 'path_escape' };
    if (!fs.existsSync(absolute) || fs.lstatSync(absolute).isSymbolicLink() || !fs.statSync(absolute).isFile()) return { ok: false, reason: 'file_missing_or_not_regular' };
    const real = fs.realpathSync(absolute);
    if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) return { ok: false, reason: 'realpath_escape' };
    const bytes = fs.readFileSync(real);
    return { ok: true, path: portable(path.relative(realRoot, real)), bytes: bytes.byteLength, sha256: sha256(bytes) };
  } catch { return { ok: false, reason: 'evidence_root_or_file_unreadable' }; }
}

function notRunArtifact(kind, buildId, head) {
  return {
    kind,
    status: 'NOT_RUN',
    reviewStatus: 'UNSIGNED',
    synthetic: false,
    buildId,
    head,
    locales: [...I18N_FULL_PRODUCT_LOCALES],
    artifactPath: null,
    evidencePath: null,
    artifactBytes: null,
    evidenceBytes: null,
    artifactSha256: null,
    evidenceSha256: null,
    execution: { status: 'NOT_RUN', executed: false, exitCode: null },
    reason: `${kind}_execution_not_run`,
  };
}

function acquireArtifact(kind, declaration, { evidenceRoot, buildId, head }) {
  if (!declaration || typeof declaration !== 'object') return notRunArtifact(kind, buildId, head);
  const artifact = safeEvidenceFile(evidenceRoot, declaration.artifactPath);
  const evidence = safeEvidenceFile(evidenceRoot, declaration.evidencePath);
  const declaredBuildId = declaration.buildId ?? buildId;
  const declaredHead = declaration.head ?? head;
  const locales = Array.isArray(declaration.locales) ? declaration.locales : [];
  const execution = declaration.execution && typeof declaration.execution === 'object'
    ? { status: declaration.execution.status ?? 'NOT_RUN', executed: declaration.execution.executed === true, exitCode: declaration.execution.exitCode ?? null }
    : { status: 'NOT_RUN', executed: false, exitCode: null };
  const reasons = [];
  if (declaration.status !== 'PASS') reasons.push('declared_status_not_pass');
  if (declaration.synthetic !== false) reasons.push('synthetic_or_unspecified_artifact');
  if (declaredBuildId !== buildId || declaredHead !== head) reasons.push('build_or_head_mismatch');
  if (JSON.stringify(locales) !== JSON.stringify(I18N_FULL_PRODUCT_LOCALES)) reasons.push('locale_set_incomplete');
  if (!artifact.ok) reasons.push(`artifact_file_${artifact.reason}`);
  if (!evidence.ok) reasons.push(`evidence_file_${evidence.reason}`);
  if (execution.executed !== true || execution.exitCode !== 0 || execution.status !== 'PASS') reasons.push('artifact_execution_not_run_or_failed');
  return {
    kind,
    status: reasons.length ? 'HOLD' : 'PASS',
    reviewStatus: 'UNSIGNED',
    synthetic: declaration.synthetic === true,
    buildId: declaredBuildId,
    head: declaredHead,
    locales: [...I18N_FULL_PRODUCT_LOCALES],
    artifactPath: artifact.ok ? artifact.path : declaration.artifactPath ?? null,
    evidencePath: evidence.ok ? evidence.path : declaration.evidencePath ?? null,
    artifactBytes: artifact.ok ? artifact.bytes : null,
    evidenceBytes: evidence.ok ? evidence.bytes : null,
    artifactSha256: artifact.ok ? artifact.sha256 : null,
    evidenceSha256: evidence.ok ? evidence.sha256 : null,
    execution,
    reason: reasons.length ? [...new Set(reasons)] : null,
  };
}

export function buildI18nFullProductReviewPacket({
  evidenceRoot,
  manifest = null,
  buildId = '',
  head = '',
  generatedAt = new Date().toISOString(),
  expiresAt = null,
} = {}) {
  const artifacts = Object.fromEntries(I18N_FULL_PRODUCT_ARTIFACTS.map(kind => [kind, acquireArtifact(kind, manifest?.artifacts?.[kind], { evidenceRoot, buildId, head })]));
  const blockers = ['review_packet_unsigned', 'hmac_not_generated_by_runner', 'production_pass_not_issued'];
  for (const [kind, artifact] of Object.entries(artifacts)) if (artifact.status !== 'PASS') blockers.push(`${kind}_${artifact.status === 'NOT_RUN' ? 'not_run' : 'artifact_invalid'}`);
  return {
    schema: I18N_FULL_PRODUCT_REVIEW_RECEIPT,
    packetType: 'unsigned_review_packet',
    status: 'HOLD',
    releaseEligible: false,
    buildId,
    head,
    generatedAt,
    expiresAt,
    locales: [...I18N_FULL_PRODUCT_LOCALES],
    artifacts,
    blockers: [...new Set(blockers)],
    signatureStatus: 'UNSIGNED',
    receiptSha256: null,
    receiptHmacSha256: null,
  };
}

export function main(args = process.argv.slice(2)) {
  const evidenceRoot = path.resolve(option(args, 'evidence-root', process.env.I18N_FULL_PRODUCT_EVIDENCE_ROOT ?? ''));
  const manifestPath = option(args, 'manifest', null);
  const manifest = manifestPath && fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  const packet = buildI18nFullProductReviewPacket({
    evidenceRoot,
    manifest,
    buildId: option(args, 'build-id', process.env.NEXYFAB_BUILD_ID ?? ''),
    head: option(args, 'head', process.env.RAILWAY_GIT_COMMIT_SHA ?? ''),
  });
  const output = path.resolve(option(args, 'out', 'docs/evidence/release/i18n-full-product-review-packet.json'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, render(packet));
  process.stdout.write(`${JSON.stringify({ output, status: packet.status, releaseEligible: packet.releaseEligible, blockers: packet.blockers })}\n`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main();
