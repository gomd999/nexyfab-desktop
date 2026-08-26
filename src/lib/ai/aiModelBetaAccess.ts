/**
 * Public no-payment beta entitlement.
 *
 * This flag is intentionally separate from billing and manufacturing release
 * authority. It only unlocks the governed public model catalog; raw provider
 * model IDs are still rejected server-side.
 */
export function aiModelBetaAccessEnabled(
  value = process.env.NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS,
): boolean {
  return value === '1';
}
