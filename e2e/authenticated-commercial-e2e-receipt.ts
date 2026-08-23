export type E2EObservation = {
  id: string;
  request: { method: string; pathname: string };
  httpStatus: number;
  bodyBytes: number;
  bodySha256: string;
  contentType: string;
  marker?: string;
  markerSha256?: string;
};

import {
  AUTHENTICATED_E2E_MAX_AGE_MS,
  AUTHENTICATED_E2E_REQUIRED_CHECKS,
  AUTHENTICATED_E2E_SCHEMA,
  buildAuthenticatedCommercialE2EReceipt as buildReceipt,
  verifyAuthenticatedCommercialE2EReceipt as verifyReceipt,
  writeAuthenticatedE2ESource as writeSource,
} from './authenticated-commercial-e2e-receipt.mjs';

export { AUTHENTICATED_E2E_MAX_AGE_MS, AUTHENTICATED_E2E_REQUIRED_CHECKS, AUTHENTICATED_E2E_SCHEMA };

type SourceBinding = { path: string; bytes: number; sha256: string };
export type AuthenticatedCommercialE2EReceipt = {
  schema: string;
  generatedAt: string;
  ok: boolean;
  environment: string;
  target: string;
  release: unknown;
  requiredChecks: string[];
  checks: string[];
  observations: E2EObservation[];
  sourceBindings: SourceBinding[];
  ready: unknown;
  freshness: { generatedAt: string; maxAgeMs: number };
  credentialsPersisted: boolean;
  transientProjectRetained: boolean;
  sha256?: string;
};

export function buildAuthenticatedCommercialE2EReceipt(input: {
  generatedAt?: string;
  target: string;
  release: unknown;
  observations: E2EObservation[];
  ready: unknown;
  sourceBindings: SourceBinding[];
  now?: number;
}): AuthenticatedCommercialE2EReceipt {
  return buildReceipt(input) as AuthenticatedCommercialE2EReceipt;
}

export function writeAuthenticatedE2ESource(input: {
  root?: string;
  artifactPath: string;
  generatedAt: string;
  target: string;
  observations: E2EObservation[];
}): { document: unknown; binding: SourceBinding } {
  return writeSource(input);
}

export function verifyAuthenticatedCommercialE2EReceipt(
  receipt: unknown,
  expectedRelease: unknown,
  options: { root?: string; now?: number } = {},
): boolean {
  return verifyReceipt(receipt, expectedRelease, options);
}
