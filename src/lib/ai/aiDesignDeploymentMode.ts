type AiDesignDeploymentEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Durable AI Design state is an operational concern, not manufacturing
 * release authority. Public no-payment deployments can therefore persist
 * editable work in PostgreSQL while commercial release remains disabled.
 */
export function aiDesignDurablePersistenceEnabled(
  env: AiDesignDeploymentEnvironment = process.env,
): boolean {
  return env.NEXYFAB_AI_DESIGN_DURABLE_MODE === '1'
    || env.NEXYFAB_COMMERCIAL_MODE === '1';
}
