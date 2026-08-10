export interface ExportStepRequest {
  requestId: number;
  handle: string;
}

export interface ExportStepResponse {
  type: 'EXPORT_STEP_RESULT';
  requestId: number;
  stepText: string | null;
}

type StepExporter = (handle: string) => Promise<string | null>;

/** Export STEP in the worker that owns the OCCT registry handle. */
export async function handleExportStepRequest(
  request: ExportStepRequest,
  exporter?: StepExporter,
): Promise<ExportStepResponse> {
  const { requestId, handle } = request;
  if (!Number.isSafeInteger(requestId) || requestId < 0 || !handle) {
    return { type: 'EXPORT_STEP_RESULT', requestId, stepText: null };
  }
  try {
    const exportStep = exporter ?? (await import('../features/occtEngine')).exportOcctStep;
    const stepText = await exportStep(handle);
    return {
      type: 'EXPORT_STEP_RESULT',
      requestId,
      stepText: stepText?.includes('ISO-10303-21') ? stepText : null,
    };
  } catch {
    return { type: 'EXPORT_STEP_RESULT', requestId, stepText: null };
  }
}
