import { NextRequest, NextResponse } from 'next/server';
import { validateUploadedFile, sanitizeFileName, UPLOAD_CONFIGS } from '@/lib/file-validation';
import { checkPlan } from '@/lib/plan-guard';
import { type StepAnalysisStats } from './analyze-step-types';

// ─── WASM singleton ───────────────────────────────────────────────────────────
// Cache the occt-import-js initialisation Promise so the WASM module is only
// loaded once per Node.js worker process (~300 ms savings per subsequent call).

let _occtPromise: Promise<unknown> | null = null;

function getOcct(): Promise<unknown> {
  if (!_occtPromise) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _occtPromise = (require('occt-import-js') as () => Promise<unknown>)();
  }
  return _occtPromise;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalyzeStepResponse {
  success: boolean;
  stats?: StepAnalysisStats;
  dfmSuggestions?: string[];
  error?: string;
}

// ─── Allowed MIME / extensions ────────────────────────────────────────────────

const ALLOWED_EXTENSIONS = ['.step', '.stp', '.iges', '.igs'];
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

// ─── DFM heuristics ──────────────────────────────────────────────────────────

function generateDfmSuggestions(stats: StepAnalysisStats): string[] {
  const suggestions: string[] = [];

  if (!stats.isSolid) {
    suggestions.push('형상이 솔리드가 아닙니다 — 열린 셸(open shell)을 닫아 주세요. (Shape is not solid — close open shells.)');
  }
  if (!stats.isManifold) {
    suggestions.push('매니폴드 오류 감지 — 가공 전 메시 검증 필요. (Non-manifold geometry detected — validate mesh before machining.)');
  }
  if (stats.faceCount > 500) {
    suggestions.push(`면 수(${stats.faceCount})가 많습니다 — 블렌드/필릿 단순화를 검토하세요. (High face count (${stats.faceCount}) — consider simplifying blends/fillets.)`);
  }
  if (stats.shellCount > 1) {
    suggestions.push(`셸이 ${stats.shellCount}개입니다 — 조립 분리 여부를 확인하세요. (${stats.shellCount} shells found — verify assembly separation.)`);
  }

  const { w, h, d } = stats.bbox;
  const minDim = Math.min(w, h, d);
  const maxDim = Math.max(w, h, d);
  if (minDim > 0 && maxDim / minDim > 20) {
    suggestions.push('종횡비가 매우 높습니다 — 가공 시 진동 및 처짐 위험. (Very high aspect ratio — risk of vibration/deflection during machining.)');
  }
  if (minDim < 0.5 && minDim > 0) {
    suggestions.push('매우 얇은 단면이 있습니다 — 최소 벽두께 1 mm 이상 권장. (Very thin section detected — minimum wall thickness ≥ 1 mm recommended.)');
  }

  if (stats.volume_cm3 > 0 && stats.surfaceArea_cm2 > 0) {
    const ratio = stats.surfaceArea_cm2 / stats.volume_cm3;
    if (ratio > 30) {
      suggestions.push('표면적/부피 비율이 높습니다 — 내부 포켓 가공 효율을 검토하세요. (High surface-to-volume ratio — review internal pocket machining efficiency.)');
    }
  }

  if (suggestions.length === 0) {
    suggestions.push('DFM 검사 통과 — 주요 가공성 문제가 발견되지 않았습니다. (DFM check passed — no major manufacturability issues detected.)');
  }

  return suggestions;
}

// ─── Mesh stats extraction ────────────────────────────────────────────────────

interface OcctMesh {
  index?: { array: number[] };
  attributes?: {
    position?: { array: number[] };
    normal?: { array: number[] };
  };
}

interface OcctResult {
  success: boolean;
  meshes?: OcctMesh[];
}

function extractStatsFromResult(result: OcctResult): StepAnalysisStats {
  const meshes: OcctMesh[] = result.meshes ?? [];

  // Count faces (each triangle = 1 face; face groups not directly exposed)
  let totalTriangles = 0;
  let totalEdgesEstimate = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  // Volume & surface area accumulators (signed volume via divergence theorem)
  let signedVolume = 0;
  let surfaceArea = 0;

  for (const mesh of meshes) {
    const positions = mesh.attributes?.position?.array ?? [];
    const indices = mesh.index?.array ?? [];

    // Triangle count
    const triCount = indices.length > 0 ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
    totalTriangles += triCount;
    // Rough edge estimate: each triangle has 3 edges, shared edges ~50%
    totalEdgesEstimate += Math.round(triCount * 1.5);

    if (positions.length === 0) continue;

    // BBox from positions
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    // Volume & surface area per triangle
    const getVec = (idx: number) => {
      const base = idx * 3;
      return [positions[base], positions[base + 1], positions[base + 2]];
    };
    const resolveIdx = (triIdx: number, vertInTri: number): number =>
      indices.length > 0 ? indices[triIdx * 3 + vertInTri] : triIdx * 3 + vertInTri;

    for (let t = 0; t < triCount; t++) {
      const a = getVec(resolveIdx(t, 0));
      const b = getVec(resolveIdx(t, 1));
      const c = getVec(resolveIdx(t, 2));

      // Signed volume contribution (mm³ → divide by 1000 later for cm³)
      signedVolume += (a[0] * (b[1] * c[2] - b[2] * c[1])
                     + b[0] * (c[1] * a[2] - c[2] * a[1])
                     + c[0] * (a[1] * b[2] - a[2] * b[1])) / 6;

      // Surface area
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      surfaceArea += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    }
  }

  // Convert mm → cm (STEP units are typically mm)
  const vol_mm3 = Math.abs(signedVolume);
  const area_mm2 = surfaceArea;
  const volume_cm3 = vol_mm3 / 1000;
  const surfaceArea_cm2 = area_mm2 / 100;

  const bboxW = isFinite(maxX) ? (maxX - minX) / 10 : 0; // cm
  const bboxH = isFinite(maxY) ? (maxY - minY) / 10 : 0;
  const bboxD = isFinite(maxZ) ? (maxZ - minZ) / 10 : 0;

  const isSolid = signedVolume > 0;
  // Manifold check: if signed volume is consistently positive and face/edge ratio is reasonable
  const eulerLike = totalTriangles - totalEdgesEstimate;
  const isManifold = isSolid && eulerLike > -totalTriangles * 0.1;

  return {
    faceCount: totalTriangles,
    edgeCount: totalEdgesEstimate,
    shellCount: meshes.length,
    volume_cm3: Math.round(volume_cm3 * 1000) / 1000,
    surfaceArea_cm2: Math.round(surfaceArea_cm2 * 100) / 100,
    bbox: {
      w: Math.round(bboxW * 10) / 10,
      h: Math.round(bboxH * 10) / 10,
      d: Math.round(bboxD * 10) / 10,
    },
    isSolid,
    isManifold,
  };
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse<AnalyzeStepResponse>> {
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response as NextResponse<AnalyzeStepResponse>;

  const { checkMonthlyLimit } = await import('@/lib/plan-guard');
  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'analyze_step');
  if (!usageCheck.ok) {
    return NextResponse.json(
      { success: false, error: `Free plan limit reached (${usageCheck.limit}/month). Upgrade to Pro for unlimited analysis.` },
      { status: 429 },
    ) as NextResponse<AnalyzeStepResponse>;
  }

  // Size guard
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BYTES) {
    return NextResponse.json({ success: false, error: 'File too large (max 50 MB)' }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ success: false, error: 'No file provided. Use field name "file".' }, { status: 400 });
  }

  // 파일 유효성 검사 (확장자, 크기, 매직 바이트)
  // STEP/IGES only — stricter than UPLOAD_CONFIGS.cad
  const validation = await validateUploadedFile(file, {
    allowedExtensions: ALLOWED_EXTENSIONS,
    maxSizeBytes: MAX_BYTES,
    checkMagicBytes: true,
  });
  if (!validation.valid) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  const safeName = sanitizeFileName(file.name);

  // Read file bytes
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to read file bytes' }, { status: 500 });
  }

  // arrayBuffer alias — WASM 처리에서 재사용
  const arrayBuffer = buffer;

  // Run occt-import-js (Node.js WASM, server-side only)
  try {
    interface OcctModule {
      ReadStepFile: (data: Uint8Array, params: null) => OcctResult;
      ReadIgesFile: (data: Uint8Array, params: null) => OcctResult;
    }
    const oc = (await getOcct()) as OcctModule;

    const uint8 = new Uint8Array(arrayBuffer);
    const name = safeName.toLowerCase();

    let result: OcctResult;
    if (name.endsWith('.iges') || name.endsWith('.igs')) {
      result = oc.ReadIgesFile(uint8, null);
    } else {
      result = oc.ReadStepFile(uint8, null);
    }

    if (!result || !result.success) {
      return NextResponse.json({ success: false, error: 'Failed to parse STEP file' }, { status: 422 });
    }

    const stats = extractStatsFromResult(result);
    const dfmSuggestions = generateDfmSuggestions(stats);

    return NextResponse.json({ success: true, stats, dfmSuggestions }, { status: 200 });
  } catch (err) {
    console.error('[analyze-step] occt error:', err);
    return NextResponse.json({ success: false, error: 'Failed to parse STEP file' }, { status: 500 });
  }
}
