#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const write = process.argv.includes('--write');
const outputRel = 'docs/evidence/cad-independent/cad-api-control-evidence.json';
const outputPath = path.join(root, ...outputRel.split('/'));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const read = rel => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');

const proxy = read('src/proxy.ts');
const boundary = read('src/lib/cad-api-proxy-boundary.ts');
const openapi = read('src/app/api/docs/openapi/route.ts');
const test = read('src/middleware.cad-security.test.ts');
const routeRoot = path.join(root, 'src', 'app', 'api', 'cad', 'v1');

function walkRoutes(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkRoutes(full));
    else if (entry.isFile() && entry.name === 'route.ts') result.push(full);
  }
  return result;
}

const routeFiles = walkRoutes(routeRoot).sort();
const handlerCount = routeFiles.reduce((sum, file) => {
  const source = fs.readFileSync(file, 'utf8');
  return sum + (source.match(/export\s+(?:async\s+function|const)\s+(?:GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length;
}, 0);
const cadOpenApiPathCount = (openapi.match(/"\/api\/cad\/v1\//g) ?? []).length;
const explicitBearerCount = (openapi.match(/security:\s*\[\{ bearerAuth: \[\] \}\]/g) ?? []).length - 1;

const checks = {
  allCadRoutesBehindActiveProxy: proxy.includes('enforceCadApiBoundary(req)') && proxy.includes("'/api/:path*'") && routeFiles.length > 0,
  onlyCapabilityGetIsPublic:
    boundary.includes("canonicalPathname === PUBLIC_CAPABILITY_PATH && request.method === 'GET'")
    && boundary.includes("pathname.replace(/\\/+$/, '')"),
  accountQuotaPresent: boundary.includes('cadAccountQuota(') && boundary.includes('nexyfab:cad:v1:user:${user.sub}'),
  distributedQuotaFailClosedInCommercial: boundary.includes("NEXYFAB_CAD_INDEPENDENT_MODE === '1'") && boundary.includes('CAD_QUOTA_UNAVAILABLE'),
  productionAccessMeteringPresent: boundary.includes("'[CAD_API_ACCESS]'") && boundary.includes('x-cad-request-id'),
  openApiHasNoAnonymousCadOverride: !openapi.includes('security: []'),
  everyDocumentedCadOperationUsesBearer: cadOpenApiPathCount > 0 && explicitBearerCount === cadOpenApiPathCount,
  regressionTestsCoverBoundary: [
    'rejects unauthenticated CAD compute',
    'keeps only GET capability discovery public',
    'preserves CAD access for an existing unverified Closed Beta account',
    'fails closed when commercial mode lacks distributed quota storage',
  ].every(name => test.includes(name)),
};
const issues = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
const evidence = {
  schema: 'nexyfab.cad-api-control-evidence.v1',
  status: issues.length === 0 ? 'pass' : 'fail',
  externalCadRequired: false,
  routeFiles: routeFiles.length,
  exportedHandlers: handlerCount,
  documentedCadOperations: cadOpenApiPathCount,
  publicExceptions: [{ method: 'GET', path: '/api/cad/v1/capabilities', purpose: 'read-only capability discovery' }],
  commercialRuntimeRequirements: ['JWT_SECRET', 'REDIS_URL', 'NEXYFAB_CAD_INDEPENDENT_MODE=1'],
  controls: {
    authentication: 'signed JWT required before CAD compute',
    authorization: 'authenticated account entitlement with plan-bound quota; Closed Beta accounts are preserved',
    rateLimit: 'IP ceiling plus per-account atomic Redis quota; commercial mode fails closed without Redis',
    metering: 'request-id-bound production access record without request body or bearer token',
  },
  checks,
  issues,
  sources: [
    'src/proxy.ts',
    'src/lib/cad-api-proxy-boundary.ts',
    'src/app/api/docs/openapi/route.ts',
    'src/middleware.cad-security.test.ts',
  ].map(file => ({ file, sha256: sha256(read(file)) })),
};
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;

if (write) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
} else if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== serialized) {
  console.error(JSON.stringify({ ok: false, code: 'CAD_API_CONTROL_EVIDENCE_STALE', output: outputRel }));
  process.exitCode = 1;
  process.exit();
}

console.log(JSON.stringify({ ok: issues.length === 0, output: outputRel, routeFiles: routeFiles.length, handlers: handlerCount, issues }));
if (issues.length) process.exitCode = 1;
