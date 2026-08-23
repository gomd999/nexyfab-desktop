import type { CadComputeExecutor, ResolvedComputeInput } from '../../runtime/src/computeService';
import { validateFeaJobRequest, type FeaJobRequest, type FeaJobResult } from '../../../src/lib/fea-jobs/contracts';
import { solveFeaJob } from '../../../services/fea-worker/solver';

const SHA256 = /^[a-f0-9]{64}$/;
export type FeaSolver = (request: FeaJobRequest) => Promise<FeaJobResult>;

export function createFeaComputeExecutor(options: {
  workerIdentitySha256: string; producerBuildId: string; solve?: FeaSolver;
}): CadComputeExecutor {
  if (!SHA256.test(options.workerIdentitySha256)) throw new Error('worker_identity_invalid');
  const solve = options.solve ?? solveFeaJob;
  return {
    serviceId: 'fea', workerIdentitySha256: options.workerIdentitySha256,
    kernelIdentitySha256: 'NOT_APPLICABLE', producerBuildId: options.producerBuildId,
    supports: message => message.kind === 'FEA_SOLVE',
    async execute(_message, inputs: ResolvedComputeInput[], signal) {
      if (inputs.length !== 1) throw new Error('fea_requires_one_request_artifact');
      if (signal.aborted) throw new Error('fea_cancelled_before_validation');
      let parsed: unknown;
      try { parsed = JSON.parse(inputs[0]!.bytes.toString('utf8')); }
      catch { throw new Error('fea_request_json_invalid'); }
      const validated = validateFeaJobRequest(parsed);
      if (!validated.ok) throw new Error(`fea_request_rejected:${validated.code}`);
      const result = await solve(validated.request);
      if (signal.aborted) throw new Error('fea_cancelled_after_solver');
      return [{
        filename: 'fea-result.json', mediaType: 'application/json', format: 'json',
        bytes: Buffer.from(`${JSON.stringify({ schema: 'nexyfab.fea-result-artifact.v1', result }, null, 2)}\n`),
      }];
    },
  };
}
