/**
 * domain-driver — the domain-agnostic "plan → measured gate → verified package"
 * spine (다분야 확장 Phase 1). A domain is a `DomainModule`; `runDomainDriver`
 * executes it with the mechanical driver's honesty invariants. Civil / interior /
 * landscape / construction modules (Batch 2) implement `DomainModule` and reuse
 * this runner + refusal IR unchanged.
 */

export type {
  DomainModule,
  DomainGateResult,
  DomainRefusal,
  DomainDriverResult,
} from './types';
export { runDomainDriver } from './runner';
