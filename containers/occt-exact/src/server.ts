import { createComputeServiceHandler, startNodeComputeServer } from '../../runtime/src/computeService';
import { createExactOcctExecutor } from './executor';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

const executor = createExactOcctExecutor({
  workerIdentitySha256: required('NEXYFAB_WORKER_IDENTITY_SHA256'),
  kernelIdentitySha256: required('NEXYFAB_KERNEL_IDENTITY_SHA256'),
  producerBuildId: required('NEXYFAB_WORKER_BUILD_ID'),
});
const handle = createComputeServiceHandler(executor, {
  computeSharedSecret: required('NEXYFAB_COMPUTE_SHARED_SECRET'),
  timeoutMs: Number(process.env.NEXYFAB_COMPUTE_TIMEOUT_MS ?? 10 * 60_000),
});

startNodeComputeServer(handle);
