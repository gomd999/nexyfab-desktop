/**
 * eng-domain/civil — the civil DomainModule (통합판). The multi-member plan →
 * gate-chain → atomic package spine drives the REAL, KDS-verified engineering-core
 * calculators (via ./engineAdapter). The earlier pure-TS re-derivations (checks.ts)
 * were removed as redundant + less complete once the audited engine backs the gates.
 */
export * from './module';
export { runEngineCalc, checkMetrics, type EngineCalcResult } from './engineAdapter';
