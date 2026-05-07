/** Thrown when `/api/nexyfab/brep/step-import` returns a JSON error body (localized server message). */
export class StepImportApiError extends Error {
  constructor(
    message: string,
    readonly apiCode?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'StepImportApiError';
  }
}
