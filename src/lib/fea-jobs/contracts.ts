// Compatibility entry point for application code. Platform workers and compute
// containers import the shared package directly so this app path is not a
// cross-workspace dependency.
export * from '../../../packages/fea-contracts/src/index';
