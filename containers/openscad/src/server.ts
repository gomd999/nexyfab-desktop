import { createComputeServiceHandler, startNodeComputeServer } from '../../runtime/src/computeService';
import { createOpenScadExecutor } from './executor';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
};
const handle = createComputeServiceHandler(createOpenScadExecutor({
  workerIdentitySha256: required('NEXYFAB_WORKER_IDENTITY_SHA256'),
  producerBuildId: required('NEXYFAB_WORKER_BUILD_ID'),
}), { computeSharedSecret: required('NEXYFAB_COMPUTE_SHARED_SECRET') });
startNodeComputeServer(handle);
