#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  TEXT_BINDING_CANONICALIZATION,
  canonicalTextEqual,
  canonicalTextSha256,
  canonicalizeText,
} from './canonical-text-binding.mjs';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const INTERNAL_PREFIXES = ['/api/cron/', '/api/internal/'];
// Only provider-initiated ingress belongs in the webhook class.  Routes such as
// /api/webhooks/subscriptions are authenticated management APIs, despite their
// directory name.
const WEBHOOK_PATTERN = /(?:\/webhook$|\/shipping-webhook$|\/ses-notifications$|\/webhooks\/(?:dodo|inbound-email)$)/i;
const ADMIN_PATTERN = /^\/api\/(?:admin|nexyfab\/admin)(?:\/|$)/;

const readText = file => canonicalizeText(fs.readFileSync(file));

function walkRoutes(directory, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkRoutes(absolute, result);
    else if (entry.isFile() && entry.name === 'route.ts') result.push(absolute);
  }
  return result;
}

export function routePathFromFile(file, appApiRoot) {
  const relative = path.relative(appApiRoot, path.dirname(file)).replaceAll('\\', '/');
  const segments = relative.split('/').filter(segment => segment && !(segment.startsWith('(') && segment.endsWith(')')));
  return `/api/${segments.join('/')}`.replace(/\/$/, '');
}

export function exportedMethods(source) {
  const methods = new Set();
  const direct = /export\s+(?:async\s+function|const|function)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
  for (const match of source.matchAll(direct)) methods.add(match[1]);
  const aliases = /\bas\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
  for (const match of source.matchAll(aliases)) methods.add(match[1]);
  const reExports = /export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b[^}]*\}\s*from\b/g;
  for (const match of source.matchAll(reExports)) methods.add(match[1]);
  return HTTP_METHODS.filter(method => methods.has(method));
}

function hasAny(source, expressions) {
  return expressions.some(expression => expression.test(source));
}

function hasEnforcedOptionalAuth(source) {
  const assignment = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+getAuthUser\s*\([^;\r\n]*\)\s*\.catch\s*\(\s*\(\)\s*=>\s*null\s*\)/g;
  return [...source.matchAll(assignment)].some(match => {
    const variable = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const immediateRemainder = source.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 300);
    return new RegExp(`^\\s*;?\\s*if\\s*\\(\\s*!\\s*${variable}\\s*\\)\\s*\\{?[\\s\\S]{0,180}?status\\s*:\\s*401`).test(immediateRemainder);
  });
}

export function analyzeRouteSecurity(route, source, publicMutationPolicy = null) {
  const methods = exportedMethods(source);
  const mutation = methods.some(method => MUTATION_METHODS.has(method));
  const unsafeDirectBodyParser = /\b(?:req|request)(?:\s*\.\s*clone\s*\(\s*\))?\s*\.\s*(?:json|text|formData|arrayBuffer|blob)\s*\(/.test(source);
  // Some public/guest routes enrich telemetry or model selection with an
  // optional identity lookup. A swallowed null result is not an auth gate.
  const authenticationSource = source.replace(
    /\bgetAuthUser\s*\([^;\r\n]*\)\s*\.catch\s*\(\s*\(\)\s*=>\s*null\s*\)/g,
    '',
  );
  const controls = {
    authentication: hasEnforcedOptionalAuth(source) || hasAny(authenticationSource, [
      /\bgetAuthUser\s*\(/, /\brequireAuth\b/, /\brequireAdmin\b/, /\bverifyAdmin\b/,
      /\bverifyJWT\b/, /\bnf_access_token\b/, /\bx-admin-(?:secret|token)\b/i,
      /\bcheckPlan\b/, /\bgetPartnerAuth\b/, /\bx-seed-key\b/i,
    ]) || (route.startsWith('/api/cad/v1') && !(route === '/api/cad/v1/capabilities' && methods.every(method => method === 'GET'))),
    objectAcl: hasAny(source, [
      /\bauthori[sz]e\w*\b/i, /\bpermission\w*\b/i, /\bcanAccess\b/, /\b(?:assert|resolve)\w*Access\b/,
      /\bowner[_A-Z]\w*/i, /\borg[_A-Z]\w*.*\buser[_A-Z]\w*/is, /\bproject[_A-Z]\w*.*\buser[_A-Z]\w*/is,
    ]),
    csrfOrigin: hasAny(source, [/\bcsrf\b/i, /\bvalidate\w*Origin\b/, /headers\.get\(['"]origin['"]\)/]),
    schema: hasAny(source, [/\.safeParse\(/, /\.parse\(/, /\bvalidate\w*\(/, /\bparse\w*(?:Payload|Input|Body)\b/]),
    size: hasAny(source, [/content-length/i, /MAX_\w*(?:BYTES|SIZE)/, /Buffer\.byteLength/, /\.size\s*[><=]/]),
    rateLimit: hasAny(source, [/\brateLimit(?:Async|Check)?\b/, /\bwithRateLimit\b/]),
    audit: hasAny(source, [/\blogAudit\b/, /\blogCadPipelineAudit\b/, /\baudit\w*\(/i]),
    idempotency: /idempoten/i.test(source),
    webhookSignature: hasAny(source, [
      /constructEvent\b/, /timingSafeEqual\b/, /verify\w*Signature\b/i, /webhook\w*secret/i, /signature\w*verif/i,
    ]),
    boundedRequestBody: mutation && !unsafeDirectBodyParser,
  };

  // Next 16 executes src/proxy.ts for every /api route. Production defaults
  // to enforce mode: all non-ingress API calls get an IP/route rate bucket,
  // and cookie-authenticated mutations get the central Origin/Sec-Fetch-Site
  // check. Route-local controls remain visible, but these effective controls
  // prevent false gaps in the matrix.
  controls.activeProxyRateLimit = !WEBHOOK_PATTERN.test(route);
  controls.activeProxyCookieOrigin = mutation && !WEBHOOK_PATTERN.test(route);
  controls.activeProxyEnvelopeSize = mutation;
  controls.publicMutationPolicy = publicMutationPolicy;

  let classification;
  let classificationBasis;
  if (/SCIM_NOT_IMPLEMENTED|status:\s*410/.test(source)) {
    classification = 'disabled';
    classificationBasis = 'explicit-not-implemented-or-gone';
  } else if (ADMIN_PATTERN.test(route) && route !== '/api/admin/auth') {
    classification = 'admin';
    classificationBasis = 'admin-route-prefix';
  } else if (WEBHOOK_PATTERN.test(route)) {
    classification = 'webhook';
    classificationBasis = 'webhook-route-pattern';
  } else if (INTERNAL_PREFIXES.some(prefix => route.startsWith(prefix))) {
    classification = 'internal-worker';
    classificationBasis = 'internal-route-prefix';
  } else if (controls.authentication) {
    classification = 'authenticated';
    classificationBasis = route.startsWith('/api/cad/v1') ? 'active-proxy-boundary' : 'route-local-auth-signal';
  } else {
    classification = 'public';
    classificationBasis = 'effective-no-auth-signal';
  }

  const gaps = [];
  if (methods.length === 0) gaps.push('METHOD_EXPORT_UNRESOLVED');
  if (classification === 'admin' && !controls.authentication) gaps.push('ADMIN_AUTH_MISSING');
  if (classification === 'webhook' && mutation && !controls.webhookSignature) gaps.push('WEBHOOK_SIGNATURE_MISSING');
  if (classification === 'public' && mutation && !controls.publicMutationPolicy) gaps.push('PUBLIC_MUTATION_REVIEW_REQUIRED');
  if (mutation && unsafeDirectBodyParser) gaps.push('DIRECT_REQUEST_BODY_PARSER_UNBOUNDED');
  if (mutation && classification !== 'webhook' && !controls.rateLimit && !controls.activeProxyRateLimit && !route.startsWith('/api/cad/v1')) {
    gaps.push('MUTATION_RATE_LIMIT_MISSING');
  }
  if (mutation && classification === 'authenticated' && !controls.csrfOrigin && !controls.activeProxyCookieOrigin && !route.startsWith('/api/cad/v1')) {
    gaps.push('COOKIE_MUTATION_ORIGIN_REVIEW_REQUIRED');
  }
  if (mutation && /(?:upload|import|file|cad|step|ifc|dxf|dwg|mesh|archive)/i.test(route) && !controls.size && !controls.activeProxyEnvelopeSize) {
    gaps.push('UPLOAD_OR_PARSER_SIZE_LIMIT_MISSING');
  }

  return { route, methods, mutation, classification, classificationBasis, controls, gaps };
}

function forwardedRouteDependencies(file, source, appApiRoot, seen = new Set()) {
  const dependencies = [];
  // Next route wrappers often re-export a supported HTTP method from a
  // sibling core module so business logic remains testable without violating
  // the framework's route-module export contract. Follow only those explicit
  // HTTP-method re-exports; scanning every relative import would incorrectly
  // inherit dormant security signals from unrelated helpers.
  const dependencySpecifiers = new Set([
    ...[...source.matchAll(/export\s*\{[^}]*\b(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b[^}]*\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map(match => match[1]),
    // Wrapper routes may import a parent route handler under an alias and
    // call it from their own framework-supported export.
    ...[...source.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]*route)['"]/g)].map(match => match[1]),
  ]);
  for (const specifier of dependencySpecifiers) {
    const unresolved = path.resolve(path.dirname(file), specifier);
    const candidates = [
      unresolved,
      `${unresolved}.ts`,
      `${unresolved}.tsx`,
      path.join(unresolved, 'route.ts'),
      path.join(unresolved, 'index.ts'),
    ];
    const dependency = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!dependency || seen.has(dependency)) continue;
    const relative = path.relative(appApiRoot, dependency);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    seen.add(dependency);
    const dependencySource = readText(dependency);
    dependencies.push({ file: dependency, source: dependencySource });
    dependencies.push(...forwardedRouteDependencies(dependency, dependencySource, appApiRoot, seen));
  }
  return dependencies;
}

export function buildRouteSecurityMatrix(root, generatedAt = new Date().toISOString()) {
  const appApiRoot = path.join(root, 'src', 'app', 'api');
  const policyPath = path.join(root, 'security', 'public-mutation-policy.json');
  const policyDocument = JSON.parse(readText(policyPath));
  const policyByRoute = new Map();
  const policyConfigIssues = [];
  for (const policy of policyDocument.policies ?? []) {
    if (typeof policy.id !== 'string' || !Array.isArray(policy.routes)) {
      policyConfigIssues.push('INVALID_POLICY_ENTRY');
      continue;
    }
    for (const route of policy.routes) {
      if (typeof route !== 'string' || !route.startsWith('/api/')) {
        policyConfigIssues.push(`INVALID_POLICY_ROUTE:${String(route)}`);
      } else if (policyByRoute.has(route)) {
        policyConfigIssues.push(`DUPLICATE_POLICY_ROUTE:${route}`);
      } else {
        policyByRoute.set(route, policy.id);
      }
    }
  }
  const routes = walkRoutes(appApiRoot)
    .sort((left, right) => left.localeCompare(right))
    .map(file => {
      const source = readText(file);
      const dependencies = forwardedRouteDependencies(file, source, appApiRoot);
      const securitySource = [source, ...dependencies.map(item => item.source)].join('\n');
      return {
        ...analyzeRouteSecurity(
          routePathFromFile(file, appApiRoot),
          securitySource,
          policyByRoute.get(routePathFromFile(file, appApiRoot)) ?? null,
        ),
        file: path.relative(root, file).replaceAll('\\', '/'),
        sourceSha256: canonicalTextSha256(source),
        securityDependencies: dependencies.map(item => ({
          file: path.relative(root, item.file).replaceAll('\\', '/'),
          sha256: canonicalTextSha256(item.source),
        })),
      };
    });
  const routeByPath = new Map(routes.map(route => [route.route, route]));
  for (const [route, policy] of policyByRoute) {
    const analyzed = routeByPath.get(route);
    if (!analyzed) policyConfigIssues.push(`STALE_POLICY_ROUTE:${policy}:${route}`);
    else if (analyzed.classification !== 'public' || !analyzed.mutation) {
      policyConfigIssues.push(`POLICY_ROUTE_NOT_PUBLIC_MUTATION:${policy}:${route}`);
    }
  }
  const byClassification = Object.fromEntries(
    ['public', 'authenticated', 'admin', 'webhook', 'internal-worker', 'disabled']
      .map(name => [name, routes.filter(route => route.classification === name).length]),
  );
  const gapCounts = {};
  for (const route of routes) for (const gap of route.gaps) gapCounts[gap] = (gapCounts[gap] ?? 0) + 1;
  return {
    schema: 'nexyfab.route-security-matrix.v1',
    textCanonicalization: TEXT_BINDING_CANONICALIZATION,
    generatedAt,
    status: routes.every(route => route.gaps.length === 0) && policyConfigIssues.length === 0 ? 'pass' : 'fail',
    summary: {
      routeFiles: routes.length,
      exportedHandlers: routes.reduce((sum, route) => sum + route.methods.length, 0),
      classifiedRoutes: routes.length,
      unknownClassifications: 0,
      routesWithGaps: routes.filter(route => route.gaps.length > 0).length,
      gapCounts,
      byClassification,
      publicMutationPolicies: policyByRoute.size,
      policyConfigIssues,
    },
    routes,
  };
}

function markdown(report) {
  const lines = [
    '# NexyFab Route Security Matrix', '',
    `- Schema: \`${report.schema}\``,
    `- Text binding: \`${report.textCanonicalization}\``,
    `- Status: **${report.status.toUpperCase()}**`,
    `- Route files: ${report.summary.routeFiles}`,
    `- Exported handlers: ${report.summary.exportedHandlers}`,
    `- Classified: ${report.summary.classifiedRoutes}; unknown: ${report.summary.unknownClassifications}`,
    `- Routes with gaps: ${report.summary.routesWithGaps}`, '',
    `- Reviewed public mutations: ${report.summary.publicMutationPolicies}`,
    `- Policy configuration issues: ${report.summary.policyConfigIssues.length}`, '',
    '## Classification', '',
    '| Class | Routes |', '|---|---:|',
    ...Object.entries(report.summary.byClassification).map(([name, count]) => `| ${name} | ${count} |`),
    '', '## Gap counts', '', '| Gap | Count |', '|---|---:|',
    ...Object.entries(report.summary.gapCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => `| ${name} | ${count} |`),
    '', '## Routes requiring adjustment', '',
    '| Route | Methods | Effective class | Gaps |', '|---|---|---|---|',
    ...report.routes.filter(route => route.gaps.length).map(route =>
      `| \`${route.route}\` | ${route.methods.join(', ') || 'unresolved'} | ${route.classification} | ${route.gaps.join(', ')} |`),
    '',
  ];
  return lines.join('\n');
}

export function main(args = process.argv.slice(2)) {
  const root = process.cwd();
  const write = args.includes('--write');
  const jsonPath = path.join(root, 'docs', 'evidence', 'security', 'route-security-matrix-260810.json');
  const mdPath = path.join(root, 'docs', 'evidence', 'security', 'route-security-matrix-260810.md');
  let storedGeneratedAt = null;
  try { storedGeneratedAt = JSON.parse(readText(jsonPath)).generatedAt ?? null; } catch { /* missing/stale evidence */ }
  const report = buildRouteSecurityMatrix(root, write || !storedGeneratedAt ? new Date().toISOString() : storedGeneratedAt);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const md = `${markdown(report)}\n`;
  if (write) {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, json);
    fs.writeFileSync(mdPath, md);
  } else if (!fs.existsSync(jsonPath) || !fs.existsSync(mdPath)
    || !canonicalTextEqual(fs.readFileSync(jsonPath), json)
    || !canonicalTextEqual(fs.readFileSync(mdPath), md)) {
    console.error(JSON.stringify({ ok: false, code: 'ROUTE_SECURITY_MATRIX_STALE' }));
    return 1;
  }
  console.log(JSON.stringify({ ok: report.status === 'pass', ...report.summary }));
  return report.status === 'pass' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
