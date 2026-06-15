/**
 * Quote-provider registry.
 *
 * Single source of truth for which providers exist + their order of
 * preference. Order matters because `getDefaultProvider()` returns the
 * first CONFIGURED provider — internal is always first so we always have
 * a working fallback even when no partner keys are set.
 *
 * Adding a new provider: import here, append to PROVIDERS, that's it.
 * The route / UI / agent tool all read from this list — no other file
 * needs an edit.
 */
import { internalQuoteProvider } from './internalProvider';
import { xometryQuoteProvider } from './xometryProvider';
import type { QuoteProvider } from './types';

/** Order matters: getDefaultProvider() returns the first configured one,
 *  and the UI dropdown renders in this order. Internal first guarantees
 *  a working fallback when external partners aren't wired yet. */
const PROVIDERS: QuoteProvider[] = [internalQuoteProvider, xometryQuoteProvider];

export function listProviders(): QuoteProvider[] {
  // Return a fresh array so callers can't mutate the registry order.
  return PROVIDERS.slice();
}

export function getProvider(id: string): QuoteProvider | null {
  return PROVIDERS.find(p => p.id === id) ?? null;
}

/**
 * Returns the first configured provider in PROVIDERS order. Falls back to
 * PROVIDERS[0] (always internalQuoteProvider) when none are configured —
 * the internal estimator is hard-coded to isConfigured() === true so the
 * fallback is never actually reached, but the type-level guarantee saves
 * the callers a null-check.
 */
export function getDefaultProvider(): QuoteProvider {
  return PROVIDERS.find(p => p.isConfigured()) ?? PROVIDERS[0]!;
}
