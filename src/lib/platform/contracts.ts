/**
 * Compatibility boundary for the first modularization wave.
 * Existing application code can import this stable path while contract packages
 * move to independently deployable applications and workers.
 */
export * from '../../../packages/auth-contracts/src/index';
export * from '../../../packages/artifact-contracts/src/index';
export * from '../../../packages/cad-contracts/src/index';
export * from '../../../packages/job-contracts/src/index';
