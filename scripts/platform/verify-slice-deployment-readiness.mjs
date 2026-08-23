import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = path.join(ROOT, 'config/platform/slice-deployment.v1.json');
const RECEIPT = path.join(ROOT, 'docs/evidence/platform-runtime/slice-deployment-readiness.json');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function exists(relative) { return fs.existsSync(path.join(ROOT, relative)); }
function gitHead() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

export function evaluateSliceDeploymentReadiness(manifest, root = ROOT) {
  const issues = [];
  if (manifest.schema !== 'nexyfab.slice-deployment.v1') issues.push('manifest_schema_invalid');
  if (manifest.policy?.default !== 'NO_DEPLOY') issues.push('default_deploy_policy_must_be_NO_DEPLOY');
  if (manifest.policy?.automaticPromotion !== false) issues.push('automatic_promotion_must_remain_disabled');
  const slices = Array.isArray(manifest.slices) ? manifest.slices : [];
  if (slices.length !== 3) issues.push('expected_three_scope_slices');
  const ids = new Set();
  const results = slices.map((slice) => {
    const localIssues = [];
    if (!slice.id || ids.has(slice.id)) localIssues.push('slice_id_missing_or_duplicate');
    ids.add(slice.id);
    for (const source of slice.sourceRoots ?? []) if (!fs.existsSync(path.join(root, source))) localIssues.push(`source_missing:${source}`);
    if (!slice.build?.contextRoot || !fs.existsSync(path.join(root, slice.build.contextRoot))) localIssues.push('build_context_missing');
    if (!slice.build?.dockerfile || !fs.existsSync(path.join(root, slice.build.dockerfile))) localIssues.push('dockerfile_missing');
    if (!slice.health?.mode) localIssues.push('health_mode_missing');
    if (!slice.rollback?.owner || slice.rollback.requiredBuildBinding !== true) localIssues.push('rollback_binding_incomplete');
    return { id: slice.id, scope: slice.scope, deployUnit: slice.deployUnit, status: localIssues.length ? 'FAIL' : 'READY_FOR_STAGING', issues: localIssues };
  });
  return { ok: issues.length === 0 && results.every(result => result.status !== 'FAIL'), issues, slices: results };
}

export function buildSliceDeploymentReceipt(manifest, root = ROOT) {
  const evaluation = evaluateSliceDeploymentReadiness(manifest, root);
  const external = { state: 'NOT_RUN', reason: 'live Cloudflare/Railway staging evidence is not available in this workspace' };
  return {
    schema: 'nexyfab.slice-deployment-readiness-receipt.v1',
    generatedAt: new Date().toISOString(),
    gitHead: gitHead(),
    local: evaluation,
    staging: external,
    rollback: { state: 'NOT_RUN', reason: 'rollback target requires a live staging deployment' },
    status: evaluation.ok ? 'HOLD' : 'BLOCKED',
  };
}

function main() {
  const manifest = readJson(MANIFEST);
  const receipt = buildSliceDeploymentReceipt(manifest);
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(RECEIPT), { recursive: true });
    fs.writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (process.argv.includes('--check') && receipt.status !== 'HOLD') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
