const MUTATION_CONFIRMATION = 'NEXYFAB_STAGING_MUTATIONS_ONLY';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const STAGING_HOST_MARKERS = ['staging', 'stage', 'preview', 'test'];
const PRODUCTION_HOSTS = new Set(['nexyfab.com', 'www.nexyfab.com']);

export type StagingSafetyInput = {
  baseURL: string;
  confirmation?: string;
  accountEmails: string[];
  tenantMarker?: string;
};

/**
 * Hard boundary for E2E suites that create users, projects, jobs, shares, or
 * review records. Production is rejected even if an operator supplies the
 * confirmation phrase accidentally.
 */
export function assertStagingMutationSafety(input: StagingSafetyInput): URL {
  const target = new URL(input.baseURL);
  const hostname = target.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.has(hostname)) {
    throw new Error(`Refusing mutating E2E against production host: ${hostname}`);
  }

  const local = LOCAL_HOSTS.has(hostname);
  const markedHost = STAGING_HOST_MARKERS.some(marker => hostname.includes(marker));
  if (!local && !markedHost) {
    throw new Error(`Refusing mutating E2E: target host is not recognisably staging (${hostname})`);
  }
  if (!local && input.confirmation !== MUTATION_CONFIRMATION) {
    throw new Error(`Set E2E_STAGING_MUTATION_CONFIRM=${MUTATION_CONFIRMATION}`);
  }

  const marker = (input.tenantMarker ?? 'e2e').trim().toLowerCase();
  if (!marker) throw new Error('E2E tenant marker must not be empty');
  if (input.accountEmails.length < 1) throw new Error('At least one staging test account is required');
  for (const rawEmail of input.accountEmails) {
    const email = rawEmail.trim().toLowerCase();
    if (!email.includes('@') || !email.includes(marker)) {
      throw new Error(`Refusing account without staging tenant marker "${marker}": ${email}`);
    }
  }
  return target;
}

export function isProductionTarget(baseURL: string): boolean {
  return PRODUCTION_HOSTS.has(new URL(baseURL).hostname.toLowerCase());
}

