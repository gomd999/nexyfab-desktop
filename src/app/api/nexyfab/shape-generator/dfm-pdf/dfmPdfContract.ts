export interface DfmPdfIssueInput {
  process: string;
  type: string;
  severity: 'error' | 'warning' | 'info';
  description: string;
  suggestion: string;
}

export interface DfmPdfResultInput {
  process: string;
  score: number;
  feasible: boolean;
  estimatedDifficulty: string;
  issues: DfmPdfIssueInput[];
}

export interface DfmPdfGeometryInput {
  volume_cm3?: number;
  surface_area_cm2?: number;
  bbox?: { w: number; h: number; d: number };
  triangleCount?: number;
}

export interface DfmPdfRequestBody {
  lang?: string;
  projectName?: string;
  results: DfmPdfResultInput[];
  geometry?: DfmPdfGeometryInput;
  generatedAt?: string;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const boundedString = (value: unknown, maximum: number, allowEmpty = false): value is string => (
  typeof value === 'string' && value.length <= maximum && (allowEmpty || value.trim().length > 0)
);
const finite = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
);

function validIssue(value: unknown): value is DfmPdfIssueInput {
  if (!record(value)) return false;
  return boundedString(value.process, 128)
    && boundedString(value.type, 128)
    && (value.severity === 'error' || value.severity === 'warning' || value.severity === 'info')
    && boundedString(value.description, 4_000)
    && boundedString(value.suggestion, 4_000);
}

function validResult(value: unknown): value is DfmPdfResultInput {
  if (!record(value) || !Array.isArray(value.issues) || value.issues.length > 200) return false;
  return boundedString(value.process, 128)
    && finite(value.score, 0, 100)
    && typeof value.feasible === 'boolean'
    && boundedString(value.estimatedDifficulty, 128)
    && value.issues.every(validIssue);
}

function validGeometry(value: unknown): value is DfmPdfGeometryInput {
  if (!record(value)) return false;
  if (value.volume_cm3 !== undefined && !finite(value.volume_cm3, 0, 1e18)) return false;
  if (value.surface_area_cm2 !== undefined && !finite(value.surface_area_cm2, 0, 1e18)) return false;
  if (value.triangleCount !== undefined && (!Number.isSafeInteger(value.triangleCount) || !finite(value.triangleCount, 0, 100_000_000))) return false;
  if (value.bbox !== undefined) {
    if (!record(value.bbox) || !finite(value.bbox.w, Number.EPSILON, 1e12) || !finite(value.bbox.h, Number.EPSILON, 1e12) || !finite(value.bbox.d, Number.EPSILON, 1e12)) return false;
  }
  return true;
}

export function validateDfmPdfBody(value: unknown): value is DfmPdfRequestBody {
  if (!record(value) || !Array.isArray(value.results) || value.results.length < 1 || value.results.length > 20) return false;
  if (value.lang !== undefined && !boundedString(value.lang, 32)) return false;
  if (value.projectName !== undefined && !boundedString(value.projectName, 200)) return false;
  if (value.generatedAt !== undefined && (!boundedString(value.generatedAt, 64) || !Number.isFinite(Date.parse(value.generatedAt)))) return false;
  if (value.geometry !== undefined && !validGeometry(value.geometry)) return false;
  return value.results.every(validResult);
}
