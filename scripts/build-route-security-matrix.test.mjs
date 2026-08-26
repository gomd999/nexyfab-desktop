import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRouteSecurity, exportedMethods } from './build-route-security-matrix.mjs';

test('finds direct, aliased, and forwarded route handler exports', () => {
  assert.deepEqual(exportedMethods('export async function GET() {}\nexport const POST = handler;\nexport { remove as DELETE };\nexport { PATCH } from "../route";'), ['GET', 'POST', 'PATCH', 'DELETE']);
});

test('classifies active CAD proxy coverage without route-local auth', () => {
  const result = analyzeRouteSecurity('/api/cad/v1/part-step', 'export async function POST() { return Response.json({}); }');
  assert.equal(result.classification, 'authenticated');
  assert.equal(result.classificationBasis, 'active-proxy-boundary');
  assert.equal(result.controls.activeProxyEnvelopeSize, true);
  assert.deepEqual(result.gaps, []);
});

test('fails a public parser mutation with missing controls', () => {
  const result = analyzeRouteSecurity('/api/model-import', 'export async function POST(request) { return Response.json(await request.json()); }');
  assert.equal(result.classification, 'public');
  assert.ok(result.gaps.includes('PUBLIC_MUTATION_REVIEW_REQUIRED'));
  assert.equal(result.controls.activeProxyRateLimit, true);
  assert.ok(!result.gaps.includes('MUTATION_RATE_LIMIT_MISSING'));
  assert.equal(result.controls.activeProxyEnvelopeSize, true);
  assert.ok(!result.gaps.includes('UPLOAD_OR_PARSER_SIZE_LIMIT_MISSING'));
  assert.equal(result.controls.boundedRequestBody, false);
  assert.ok(result.gaps.includes('DIRECT_REQUEST_BODY_PARSER_UNBOUNDED'));
});

test('accepts a mutation that uses an incremental bounded request reader', () => {
  const result = analyzeRouteSecurity(
    '/api/model-import',
    'export async function POST(request) { return Response.json(await readBoundedJson(request, 1024)); }',
    'public-design-compute',
  );
  assert.equal(result.controls.boundedRequestBody, true);
  assert.ok(!result.gaps.includes('DIRECT_REQUEST_BODY_PARSER_UNBOUNDED'));
});

test('requires webhook signature verification', () => {
  const result = analyzeRouteSecurity('/api/stripe/webhook', 'export async function POST() { return Response.json({}); }');
  assert.equal(result.classification, 'webhook');
  assert.ok(result.gaps.includes('WEBHOOK_SIGNATURE_MISSING'));
});

test('does not classify outbound webhook subscription management as ingress', () => {
  const result = analyzeRouteSecurity('/api/webhooks/subscriptions', 'export async function POST() { return Response.json({}); }');
  assert.equal(result.classification, 'public');
  assert.ok(!result.gaps.includes('WEBHOOK_SIGNATURE_MISSING'));
});

test('accepts only an explicit exact-route public mutation review', () => {
  const reviewed = analyzeRouteSecurity(
    '/api/public-action',
    'export async function POST() { return Response.json({}); }',
    'public-token-or-intake',
  );
  assert.equal(reviewed.controls.publicMutationPolicy, 'public-token-or-intake');
  assert.ok(!reviewed.gaps.includes('PUBLIC_MUTATION_REVIEW_REQUIRED'));
});

test('does not mistake a swallowed optional identity lookup for an auth gate', () => {
  const result = analyzeRouteSecurity(
    '/api/guest-ai',
    'import { getAuthUser } from "@/lib/auth"; export async function POST(req) { const user = await getAuthUser(req).catch(() => null); return Response.json({ user }); }',
    'public-design-compute',
  );
  assert.equal(result.classification, 'public');
  assert.equal(result.controls.authentication, false);
  assert.deepEqual(result.gaps, []);
});

test('recognizes the plan guard as an auth gate', () => {
  const result = analyzeRouteSecurity(
    '/api/plan-ai',
    "export async function POST(req) { const plan = await checkPlan(req, 'free'); return Response.json({ plan }); }",
  );
  assert.equal(result.classification, 'authenticated');
  assert.equal(result.controls.authentication, true);
  assert.deepEqual(result.gaps, []);
});

test('recognizes an enforced identity lookup as an auth gate', () => {
  const result = analyzeRouteSecurity(
    '/api/private-ai',
    'export async function POST(req) { const user = await getAuthUser(req); if (!user) return new Response(null, { status: 401 }); return Response.json({ ok: true }); }',
  );
  assert.equal(result.classification, 'authenticated');
  assert.equal(result.controls.authentication, true);
});

test('recognizes an immediately enforced optional lookup as an auth gate', () => {
  const result = analyzeRouteSecurity(
    '/api/private-audit',
    'export async function POST(req) { const authUser = await getAuthUser(req).catch(() => null); if (!authUser) { return Response.json({}, { status: 401 }); } return Response.json({ ok: true }); }',
  );
  assert.equal(result.classification, 'authenticated');
  assert.equal(result.controls.authentication, true);
});

test('keeps a route public when identity is only required for an optional sub-operation', () => {
  const result = analyzeRouteSecurity(
    '/api/public-upload',
    'export async function POST(req) { const authUser = await getAuthUser(req).catch(() => null); const body = await req.formData(); if (body.get("replaceId")) { if (!authUser) return Response.json({}, { status: 401 }); } return Response.json({ ok: true }); }',
    'public-token-or-intake',
  );
  assert.equal(result.classification, 'public');
  assert.equal(result.controls.authentication, false);
});
