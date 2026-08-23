import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const VALID_IMPLEMENTATION_STATES = new Set([
  'COMPATIBILITY_BOUNDARY',
  'EXTERNAL_NOT_RUN',
  'MIGRATION_PENDING',
  'NOT_IMPLEMENTED',
  'PARTIAL',
]);
const VALID_DOMAIN_STATES = new Set(['WORKING', 'PREVIEW', 'PARTIAL', 'NOT_IMPLEMENTED', 'BLOCKED']);

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function exists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function childDirectories(root, relativePath) {
  return fs.readdirSync(path.join(root, relativePath), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function sameMembers(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function compareInventory(issues, label, actual, expected) {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  if (sameMembers(left, right)) return;
  const missing = left.filter((value) => !right.includes(value));
  const stale = right.filter((value) => !left.includes(value));
  if (missing.length) issues.push(`${label}: manifest is missing ${missing.join(', ')}`);
  if (stale.length) issues.push(`${label}: manifest contains absent entries ${stale.join(', ')}`);
}

function railwayCronNames(root) {
  const source = fs.readFileSync(path.join(root, 'railway.toml'), 'utf8');
  return [...source.matchAll(/\[\[cronJobs\]\][\s\S]*?^name\s*=\s*"([^"]+)"/gm)]
    .map((match) => match[1])
    .sort();
}

function walkSourceFiles(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const files = [];
  const queue = [absoluteRoot];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(target);
      else if (/\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name)) files.push(target);
    }
  }
  return files;
}

function validateImportBoundaries(root, issues) {
  const packageFiles = walkSourceFiles(root, 'packages');
  const forbiddenPackageImport = /(?:from\s+|import\s*\()['"](?:@\/|\.\.\/\.\.\/src|\.\.\/\.\.\/apps|\.\.\/\.\.\/workers|\.\.\/\.\.\/containers|\.\.\/\.\.\/domains)/g;
  for (const filename of packageFiles) {
    const source = fs.readFileSync(filename, 'utf8');
    if (forbiddenPackageImport.test(source)) {
      issues.push(`package import boundary violated: ${path.relative(root, filename)}`);
    }
    forbiddenPackageImport.lastIndex = 0;
  }

  const domainFiles = walkSourceFiles(root, 'domains');
  for (const filename of domainFiles) {
    const domain = path.relative(path.join(root, 'domains'), filename).split(path.sep)[0];
    const source = fs.readFileSync(filename, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)) {
      const target = match[1];
      const sibling = target.match(/(?:^|\/)domains\/([^/]+)/)?.[1];
      if (sibling && sibling !== domain) issues.push(`cross-domain implementation import: ${domain} -> ${sibling} in ${path.relative(root, filename)}`);
    }
  }
}

function validateServices(root, architecture, issues) {
  const ids = new Set();
  for (const service of architecture.services ?? []) {
    if (ids.has(service.id)) issues.push(`duplicate service id: ${service.id}`);
    ids.add(service.id);
    if (!VALID_IMPLEMENTATION_STATES.has(service.implementationState)) issues.push(`invalid service state: ${service.id}`);
    if (!exists(root, service.descriptor)) {
      issues.push(`missing service descriptor: ${service.descriptor}`);
      continue;
    }
    const descriptor = readJson(root, service.descriptor);
    if (descriptor.schema !== 'nexyfab.deployable-unit.v1') issues.push(`invalid deployable schema: ${service.descriptor}`);
    if (descriptor.id !== service.id) issues.push(`service descriptor id mismatch: ${service.id}`);
    if (descriptor.implementationState !== service.implementationState) issues.push(`service state mismatch: ${service.id}`);
    if (descriptor.deployEnabled !== false) issues.push(`first-wave deploy must remain disabled: ${service.id}`);
    for (const legacySource of descriptor.legacySource ?? []) {
      if (!exists(root, legacySource)) issues.push(`missing legacy source for ${service.id}: ${legacySource}`);
    }
    if (service.currentSource !== null && !exists(root, service.currentSource)) issues.push(`missing current service source: ${service.id}`);
  }
}

function validateDataOwnership(architecture, issues) {
  const ownership = new Map();
  for (const store of architecture.dataStores ?? []) {
    if (!VALID_IMPLEMENTATION_STATES.has(store.state)) issues.push(`invalid data-store state: ${store.id}`);
    for (const subject of store.owns ?? []) {
      if (ownership.has(subject)) issues.push(`duplicate data authority for ${subject}: ${ownership.get(subject)} and ${store.id}`);
      ownership.set(subject, store.id);
    }
  }
  for (const claim of [
    'queue_delivery_equals_execution_pass',
    'compute_pass_equals_release_pass',
    'container_disk_is_durable',
    'missing_evidence_can_be_promoted_to_pass',
  ]) {
    if (!(architecture.forbiddenClaims ?? []).includes(claim)) issues.push(`missing fail-closed platform rule: ${claim}`);
  }
}

function validateRoutes(root, manifest, issues) {
  const actualRouteGroups = childDirectories(root, manifest.routeRoot);
  const declaredRouteGroups = (manifest.groups ?? []).flatMap((group) => group.routeGroups ?? []);
  compareInventory(issues, 'API route groups', actualRouteGroups, declaredRouteGroups);
  if (new Set(declaredRouteGroups).size !== declaredRouteGroups.length) issues.push('API route groups contain duplicate ownership');

  const actualCronGroups = childDirectories(root, path.join(manifest.routeRoot, 'cron'));
  compareInventory(issues, 'cron route groups', actualCronGroups, manifest.cronRouteGroups ?? []);
  compareInventory(issues, 'Railway cron jobs', railwayCronNames(root), manifest.railwayCronJobs ?? []);

  for (const gap of manifest.knownGaps ?? []) {
    if (!['NOT_RUN', 'BLOCKED'].includes(gap.state)) issues.push(`known gap cannot be promoted without evidence: ${gap.id}`);
    if (typeof gap.reason !== 'string' || gap.reason.trim() === '') issues.push(`known gap reason required: ${gap.id}`);
  }
}

function validateDomains(root, registry, issues) {
  compareInventory(issues, 'domain directories', childDirectories(root, 'domains'), registry.domains ?? []);
  for (const domainId of registry.domains ?? []) {
    const manifestPath = path.join('domains', domainId, 'domain.json');
    if (!exists(root, manifestPath)) {
      issues.push(`missing domain manifest: ${domainId}`);
      continue;
    }
    const manifest = readJson(root, manifestPath);
    if (manifest.schema !== 'nexyfab.cad-domain.v1') issues.push(`invalid domain schema: ${domainId}`);
    if (manifest.id !== domainId) issues.push(`domain id mismatch: ${domainId}`);
    for (const field of ['authoringState', 'exactExecutionState', 'releaseState']) {
      if (!VALID_DOMAIN_STATES.has(manifest[field])) issues.push(`invalid ${field} for ${domainId}`);
    }
    if (manifest.releaseState === 'WORKING' || manifest.releaseState === 'PARTIAL') issues.push(`release state must be evidence truth, not implementation truth: ${domainId}`);
    for (const sourceRoot of manifest.legacySourceRoots ?? []) {
      if (!exists(root, sourceRoot)) issues.push(`missing domain legacy source: ${domainId}:${sourceRoot}`);
    }
  }
}

function validateContracts(root, registry, issues) {
  for (const contractRoot of registry.sharedContracts ?? []) {
    if (!exists(root, path.join(contractRoot, 'package.json'))) issues.push(`missing contract package.json: ${contractRoot}`);
    if (!exists(root, path.join(contractRoot, 'src', 'index.ts'))) issues.push(`missing contract entrypoint: ${contractRoot}`);
  }
  validateImportBoundaries(root, issues);
}

function validateChangeImpact(changeImpact, serviceIds, issues) {
  if (changeImpact.deploymentPolicy?.default !== 'NO_DEPLOY') issues.push('change-impact default must be NO_DEPLOY');
  if (changeImpact.deploymentPolicy?.automaticProductionPromotion !== false) issues.push('automatic production promotion must remain disabled');
  for (const rule of changeImpact.rules ?? []) {
    if (!Array.isArray(rule.paths) || rule.paths.length === 0) issues.push('change-impact rule requires paths');
    if (!Array.isArray(rule.checks) || rule.checks.length === 0) issues.push(`change-impact rule requires checks: ${rule.paths?.join(',')}`);
    for (const unit of rule.deployUnits ?? []) {
      if (!serviceIds.has(unit)) issues.push(`change-impact references unknown deploy unit: ${unit}`);
    }
  }
}

function validateRuntimePlacement(architecture, placement, issues) {
  if (placement.schema !== 'nexyfab.runtime-placement.v1') issues.push('runtime placement schema mismatch');
  const serviceIds = architecture.services.map((service) => service.id).sort();
  const cloudflare = placement.targetDeployments?.cloudflare ?? [];
  const railway = placement.targetDeployments?.railway ?? [];
  compareInventory(issues, 'runtime target services', serviceIds, [...cloudflare, ...railway]);
  if (!sameMembers([...railway].sort(), ['core-api', 'native-fallback'])) {
    issues.push('Railway target allowlist must contain only core-api and native-fallback');
  }
  for (const service of architecture.services) {
    const expected = service.targetPlatform.startsWith('cloudflare') ? 'cloudflare' : 'railway';
    const actual = cloudflare.includes(service.id) ? 'cloudflare' : railway.includes(service.id) ? 'railway' : 'missing';
    if (actual !== expected) issues.push(`runtime placement mismatch: ${service.id} expected ${expected}, received ${actual}`);
  }
  if (!sameMembers(placement.railwayDataAuthorities ?? [], ['relational-system-of-record'])) {
    issues.push('Railway data authority allowlist must contain only the relational system of record');
  }
  if ((placement.observationPolicy?.minimumConsecutiveDays ?? 0) < 30) issues.push('runtime observation must require at least 30 consecutive days');
  if (placement.productionPolicy?.automaticPromotion !== false) issues.push('runtime automatic production promotion must remain disabled');
  if (placement.productionPolicy?.missingEvidenceState !== 'NOT_RUN') issues.push('missing runtime evidence must remain NOT_RUN');
  if (!Array.isArray(placement.requiredLiveChecks) || placement.requiredLiveChecks.length < 8) issues.push('runtime placement requires explicit live checks');
  const retirements = new Set((placement.retirementSequence ?? []).map((stage) => stage.id));
  for (const id of ['railway-cron-jobs', 'railway-redis-job-transport', 'railway-openscad-and-fea', 'railway-ifc-step-and-occt', 'railway-studio-web-origin']) {
    if (!retirements.has(id)) issues.push(`missing Railway retirement stage: ${id}`);
  }
}

export function validatePlatformArchitecture(root = DEFAULT_ROOT) {
  const issues = [];
  const architecture = readJson(root, 'config/platform/platform-architecture.v1.json');
  const routes = readJson(root, 'config/platform/route-ownership.v1.json');
  const changeImpact = readJson(root, 'config/platform/change-impact.v1.json');
  const runtimePlacement = readJson(root, 'config/platform/runtime-placement.v1.json');
  const domains = readJson(root, 'domains/manifest.json');

  if (architecture.schema !== 'nexyfab.platform-architecture.v1') issues.push('platform architecture schema mismatch');
  if (routes.schema !== 'nexyfab.route-ownership.v1') issues.push('route ownership schema mismatch');
  if (changeImpact.schema !== 'nexyfab.change-impact.v1') issues.push('change-impact schema mismatch');
  if (domains.schema !== 'nexyfab.domain-registry.v1') issues.push('domain registry schema mismatch');

  validateServices(root, architecture, issues);
  validateDataOwnership(architecture, issues);
  validateRoutes(root, routes, issues);
  validateDomains(root, domains, issues);
  validateContracts(root, domains, issues);
  validateChangeImpact(changeImpact, new Set(architecture.services.map((service) => service.id)), issues);
  validateRuntimePlacement(architecture, runtimePlacement, issues);

  return {
    schema: 'nexyfab.platform-architecture-validation.v1',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    counts: {
      services: architecture.services.length,
      dataStores: architecture.dataStores.length,
      apiRouteGroups: childDirectories(root, routes.routeRoot).length,
      cronRouteGroups: childDirectories(root, path.join(routes.routeRoot, 'cron')).length,
      domains: domains.domains.length,
      contractPackages: domains.sharedContracts.length,
    },
    issues,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validatePlatformArchitecture(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'PASS') process.exitCode = 1;
}
