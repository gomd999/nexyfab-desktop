#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  TEXT_BINDING_CANONICALIZATION,
  canonicalTextEqual,
  canonicalTextSha256,
  canonicalizeText,
} from './canonical-text-binding.mjs';

const root = process.cwd();
const write = process.argv.includes('--write');
const outputRel = 'docs/evidence/cad-independent/cad-api-control-evidence.json';
const outputPath = path.join(root, ...outputRel.split('/'));
let storedGeneratedAt = null;
try { storedGeneratedAt = JSON.parse(canonicalizeText(fs.readFileSync(outputPath))).generatedAt ?? null; } catch { /* missing/stale evidence */ }
const generatedAt = write || !storedGeneratedAt ? new Date().toISOString() : storedGeneratedAt;
const read = rel => canonicalizeText(fs.readFileSync(path.join(root, ...rel.split('/'))));

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
const routeSources = routeFiles.map(file => ({
  file,
  relative: path.relative(root, file).replaceAll('\\', '/'),
  source: canonicalizeText(fs.readFileSync(file)),
}));
const delegatedIngressByRoute = new Map([
  ['src/app/api/cad/v1/feature-program/route.ts', 'src/app/api/nexyfab/cad-feature-program/route.ts'],
  ['src/app/api/cad/v1/part-step/route.ts', 'src/app/api/nexyfab/cad-feature-step/route.ts'],
]);
const delegatedIngressSources = [...new Set(delegatedIngressByRoute.values())]
  .map(relative => ({ relative, source: read(relative) }));
const boundedReaderPattern = /\breadBounded(?:Json|MultipartForm|MultipartBody|RawBody)(?:\s*<[^()\r\n]{1,300}>)?\s*\(/;
const handlerCount = routeFiles.reduce((sum, file) => {
  const source = canonicalizeText(fs.readFileSync(file));
  return sum + (source.match(/export\s+(?:async\s+function|const)\s+(?:GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length;
}, 0);
const unsafeRequestBodyParsers = routeSources.flatMap(({ relative, source }) => {
  const matches = source.match(/\b(?:req|request)\s*\.\s*(?:json|text|formData|arrayBuffer|blob)\s*\(/g) ?? [];
  return matches.map(parser => ({ file: relative, parser: parser.replace(/\s+/g, '') }));
});
const mutationRoutesMissingBoundedIngress = routeSources
  .filter(({ source }) => /export\s+(?:async\s+function|const)\s+(?:POST|PUT|PATCH|DELETE)\b/.test(source))
  .filter(({ relative, source }) => {
    if (boundedReaderPattern.test(source)) return false;
    const delegated = delegatedIngressByRoute.get(relative);
    if (!delegated || !/\blegacyPost\s*\(\s*req\s*\)/.test(source)) return true;
    return !boundedReaderPattern.test(delegatedIngressSources.find(item => item.relative === delegated)?.source ?? '');
  })
  .map(({ relative }) => relative);
const cadRouteTreeSha256 = canonicalTextSha256(routeSources
  .map(({ relative, source }) => `${relative}\0${source}`)
  .join('\0'));
const cadOpenApiPathCount = (openapi.match(/"\/api\/cad\/v1\//g) ?? []).length;
const explicitBearerCount = (openapi.match(/security:\s*\[\{ bearerAuth: \[\] \}\]/g) ?? []).length - 1;

const checks = {
  allCadRoutesBehindActiveProxy: proxy.includes('enforceCadApiBoundary(req)') && proxy.includes("'/api/:path*'") && routeFiles.length > 0,
  onlyCapabilityGetIsPublic:
    boundary.includes("canonicalPathname === PUBLIC_CAPABILITY_PATH && request.method === 'GET'")
    && boundary.includes("pathname.replace(/\\/+$/, '')"),
  accountQuotaPresent: boundary.includes('cadAccountQuota(') && boundary.includes('nexyfab:cad:v1:user:${user.userId}'),
  distributedQuotaFailClosedInCommercial: boundary.includes("NEXYFAB_CAD_INDEPENDENT_MODE === '1'") && boundary.includes('CAD_QUOTA_UNAVAILABLE'),
  productionAccessMeteringPresent: boundary.includes("'[CAD_API_ACCESS]'") && boundary.includes('x-cad-request-id'),
  openApiHasNoAnonymousCadOverride: !openapi.includes('security: []'),
  everyDocumentedCadOperationUsesBearer: cadOpenApiPathCount > 0 && explicitBearerCount === cadOpenApiPathCount,
  allCadRequestBodiesUseBoundedReaders: unsafeRequestBodyParsers.length === 0,
  allCadMutationRoutesDeclareBoundedIngress: mutationRoutesMissingBoundedIngress.length === 0,
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
  textCanonicalization: TEXT_BINDING_CANONICALIZATION,
  generatedAt,
  status: issues.length === 0 ? 'pass' : 'fail',
  externalCadRequired: false,
  routeFiles: routeFiles.length,
  exportedHandlers: handlerCount,
  documentedCadOperations: cadOpenApiPathCount,
  cadRouteTreeSha256,
  unsafeRequestBodyParsers,
  mutationRoutesMissingBoundedIngress,
  publicExceptions: [{ method: 'GET', path: '/api/cad/v1/capabilities', purpose: 'read-only capability discovery' }],
  commercialRuntimeRequirements: ['JWT_SECRET', 'REDIS_URL', 'NEXYFAB_CAD_INDEPENDENT_MODE=1'],
  controls: {
    authentication: 'signed JWT required before CAD compute',
    authorization: 'authenticated account entitlement with plan-bound quota; Closed Beta accounts are preserved',
    rateLimit: 'IP ceiling plus per-account atomic Redis quota; commercial mode fails closed without Redis',
    metering: 'request-id-bound production access record without request body or bearer token',
    requestBodyLimits: 'actual streamed bytes are capped before JSON, multipart, or raw-body parsing',
  },
  checks,
  issues,
  sources: [
    'src/proxy.ts',
    'src/lib/cad-api-proxy-boundary.ts',
    'src/app/api/docs/openapi/route.ts',
    'src/middleware.cad-security.test.ts',
  ].map(file => ({ file, sha256: canonicalTextSha256(read(file)) }))
    .concat(routeSources.map(({ relative, source }) => ({ file: relative, sha256: canonicalTextSha256(source) })))
    .concat(delegatedIngressSources.map(({ relative, source }) => ({ file: relative, sha256: canonicalTextSha256(source) }))),
};
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;

if (write) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
} else if (!fs.existsSync(outputPath) || !canonicalTextEqual(fs.readFileSync(outputPath), serialized)) {
  console.error(JSON.stringify({ ok: false, code: 'CAD_API_CONTROL_EVIDENCE_STALE', output: outputRel }));
  process.exitCode = 1;
  process.exit();
}

console.log(JSON.stringify({ ok: issues.length === 0, output: outputRel, routeFiles: routeFiles.length, handlers: handlerCount, issues }));
if (issues.length) process.exitCode = 1;
