import { enqueueOpenScadJob, getOpenScadJobAsync } from './jobQueue';
import { runOpenScadCli, type OpenScadMeshFormat } from './runOpenScadCli';

type OpenScadExecutionResult = Awaited<ReturnType<typeof runOpenScadCli>>;

/**
 * Single server-side OpenSCAD boundary. Development may use the local CLI,
 * while production delegates to the isolated Redis worker and waits for the
 * bounded result. Callers never need to know where the native process lives.
 */
export async function executeOpenScad(input: {
  scadSource: string;
  format: OpenScadMeshFormat;
  timeoutMs?: number;
  importStl?: Uint8Array;
  userId?: string;
  renderArgs?: string[];
}): Promise<OpenScadExecutionResult> {
  if (process.env.OPENSCAD_EXTERNAL_WORKER !== '1') {
    return runOpenScadCli({
      scadSource: input.scadSource,
      format: input.format,
      timeoutMs: input.timeoutMs,
      importStl: input.importStl,
      renderArgs: input.renderArgs,
    });
  }

  const userId = input.userId?.trim() || 'system:server-render';
  const job = await enqueueOpenScadJob({
    userId,
    scad: input.scadSource,
    format: input.format,
    ...(input.importStl?.byteLength ? { importStl: input.importStl } : {}),
    ...(input.renderArgs?.length ? { renderArgs: input.renderArgs } : {}),
  });
  if (job.status === 'failed') {
    return { ok: false, code: 'EXIT', message: job.errorMessage ?? 'OpenSCAD worker unavailable' };
  }

  const waitMs = Math.min(180_000, Math.max(1000, input.timeoutMs ?? 90_000) + 15_000);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const current = await getOpenScadJobAsync(job.id, userId);
    if (current?.status === 'failed') {
      return { ok: false, code: 'EXIT', message: current.errorMessage ?? 'OpenSCAD worker failed' };
    }
    if (current?.status === 'complete' && current.resultBase64) {
      return { ok: true, buffer: Buffer.from(current.resultBase64, 'base64'), stderr: '' };
    }
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  return { ok: false, code: 'TIMEOUT', message: `OpenSCAD worker exceeded ${waitMs}ms` };
}
