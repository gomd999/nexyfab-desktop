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
