export const AUTH_CONTRACT_VERSION = 'nexyfab.auth-context.v1' as const;

export interface AuthContext {
  contractVersion: typeof AUTH_CONTRACT_VERSION;
  subjectId: string;
  tenantId: string;
  sessionId: string;
  permissions: string[];
  issuedAt: string;
  expiresAt: string;
}

export interface ServiceIdentity {
  serviceId: string;
  environment: 'local' | 'preview' | 'staging' | 'production';
  identitySha256: string;
  allowedOperations: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;

export function validateServiceIdentity(identity: ServiceIdentity): string[] {
  const issues: string[] = [];
  if (!identity.serviceId.trim()) issues.push('service_id_required');
  if (!SHA256.test(identity.identitySha256)) issues.push('invalid_service_identity_sha256');
  if (identity.allowedOperations.length === 0) issues.push('allowed_operations_required');
  return issues;
}
