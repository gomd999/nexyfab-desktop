import { startNodeComputeServer } from '../../runtime/src/computeService';
import { createNativeFallbackRouter } from './router';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
};
startNodeComputeServer(createNativeFallbackRouter({
  computeSharedSecret: required('NEXYFAB_COMPUTE_SHARED_SECRET'),
  upstreamSharedSecret: required('NEXYFAB_UPSTREAM_COMPUTE_SHARED_SECRET'),
  exactOrigin: process.env.NEXYFAB_EXACT_COMPUTE_ORIGIN,
  openscadOrigin: process.env.NEXYFAB_OPENSCAD_ORIGIN,
  feaOrigin: process.env.NEXYFAB_FEA_ORIGIN,
  interopOrigin: process.env.NEXYFAB_INTEROP_ORIGIN,
}));
