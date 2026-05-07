// ─── Types ────────────────────────────────────────────────────────────────────

export interface SSOConfig {
  provider: 'saml' | 'oidc' | null;
  entityId?: string;
  ssoUrl?: string;
  certificate?: string; // SAML cert (stored in full; returned masked)
  clientId?: string;
  clientSecret?: string; // stored; never returned
  issuer?: string;
  enabled: boolean;
}
