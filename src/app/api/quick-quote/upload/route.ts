export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import path from 'path';
import { getNexyfabAdminEmail } from '@/lib/nexyfab-email';
import { validateUploadedFile, sanitizeFileName } from '@/lib/file-validation';
import { getStorage } from '@/lib/storage';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { getRfqAccessForUser } from '@/lib/rfq-partner-access';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { checkOrigin } from '@/lib/csrf';
import { visionCompletion } from '@/lib/ai/vision';
import { consumeEngineeringChatGuestQuota, GUEST_ENGINEERING_CHAT_DAILY_LIMIT } from '@/lib/ai/engineeringChatGuestQuota';
import { guardStudioAi } from '@/lib/studio-ai-guard';
import { approximateGeometryFromDimensions, isValidGeometry, type Geometry } from './geometry';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

// Accepted extensions and their max sizes for this route
const QUICK_QUOTE_CONFIG = {
  allowedExtensions: ['.step', '.stp', '.stl', '.obj', '.blend', '.jpg', '.jpeg', '.png', '.webp'],
  cadExtensions: ['.step', '.stp', '.stl', '.obj', '.blend'],
  maxSizeCad: 50 * 1024 * 1024,  // 50MB
  maxSizeImage: 10 * 1024 * 1024, // 10MB
};
const INLINE_OCCT_PARSE_MAX_BYTES = 3 * 1024 * 1024;
const MULTIPART_FRAMING_ALLOWANCE_BYTES = 1024 * 1024;
const MAX_ANONYMOUS_MULTIPART_BODY_BYTES = QUICK_QUOTE_CONFIG.maxSizeCad + MULTIPART_FRAMING_ALLOWANCE_BYTES;
// src/proxy.ts enforces 64 MiB for upload routes. Keep authenticated aggregate
// uploads honest instead of advertising an unreachable 251 MiB envelope.
const MAX_AUTHENTICATED_MULTIPART_BODY_BYTES = 64 * 1024 * 1024;

// ─── 파일 타입 감지 ─────────────────────────────────────────────────────────

function getFileType(filename: string): 'step' | 'obj' | 'blend' | 'image' {
    const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
    if (['.step', '.stp', '.stl'].includes(ext)) return 'step';
    if (ext === '.obj') return 'obj';
    if (ext === '.blend') return 'blend';
    return 'image';
}

// ─── Mesh 계산 함수 ─────────────────────────────────────────────────────────

function computeVolume(vertices: number[], faces: number[]): number {
    let vol = 0;
    for (let i = 0; i < faces.length; i += 3) {
        const a = faces[i], b = faces[i + 1], c = faces[i + 2];
        const ax = vertices[a * 3], ay = vertices[a * 3 + 1], az = vertices[a * 3 + 2];
        const bx = vertices[b * 3], by = vertices[b * 3 + 1], bz = vertices[b * 3 + 2];
        const cx = vertices[c * 3], cy = vertices[c * 3 + 1], cz = vertices[c * 3 + 2];
        vol += (ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by)) / 6;
    }
    return Math.abs(vol);
}

function computeSurfaceArea(vertices: number[], faces: number[]): number {
    let area = 0;
    for (let i = 0; i < faces.length; i += 3) {
        const a = faces[i], b = faces[i + 1], c = faces[i + 2];
        const ax = vertices[a * 3], ay = vertices[a * 3 + 1], az = vertices[a * 3 + 2];
        const bx = vertices[b * 3], by = vertices[b * 3 + 1], bz = vertices[b * 3 + 2];
        const cx = vertices[c * 3], cy = vertices[c * 3 + 1], cz = vertices[c * 3 + 2];
        const abx = bx - ax, aby = by - ay, abz = bz - az;
        const acx = cx - ax, acy = cy - ay, acz = cz - az;
        const crossX = aby * acz - abz * acy;
        const crossY = abz * acx - abx * acz;
        const crossZ = abx * acy - aby * acx;
        area += Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ) / 2;
    }
    return area;
}

// ─── OBJ 파서 ────────────────────────────────────────────────────────────────

function parseOBJ(buffer: Buffer): { vertices: number[]; faces: number[] } | null {
    try {
        const text = buffer.toString('utf8');
        const vertices: number[] = [];
        const faces: number[] = [];

        for (const rawLine of text.split('\n')) {
            const line = rawLine.trim();
            const parts = line.split(/\s+/);
            if (parts[0] === 'v') {
                const x = parseFloat(parts[1]);
                const y = parseFloat(parts[2]);
                const z = parseFloat(parts[3]);
                if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                    vertices.push(x, y, z);
                }
            } else if (parts[0] === 'f') {
                // f v1[/vt1[/vn1]] v2[/vt2[/vn2]] ...  (1-indexed)
                const idx = parts.slice(1).map(p => parseInt(p.split('/')[0]) - 1);
                // 팬 삼각분할
                for (let i = 1; i < idx.length - 1; i++) {
                    if (idx[0] >= 0 && idx[i] >= 0 && idx[i + 1] >= 0) {
                        faces.push(idx[0], idx[i], idx[i + 1]);
                    }
                }
            }
        }
        if (vertices.length === 0) return null;
        return { vertices, faces };
    } catch {
        return null;
    }
}

// ─── Qwen-VL 이미지 분석 ────────────────────────────────────────────────────

async function analyzeImageWithVision(base64Data: string, mimeType: string, signal?: AbortSignal) {
    const prompt = `이 부품/제품 이미지를 분석해서 다음을 JSON으로만 답해줘:
1. 부품 유형 (bracket, housing, shaft, gear, plate, cover, flange, etc.)
2. 예상 제조 공정 (cnc, injection_molding, die_casting, sheet_metal, 3d_printing, forging 중 하나)
3. 복잡도 점수 1-10 (형상 복잡도, 공차 요구 등)
4. 표면 특징 (홀 유무, 나사산, 곡면 등을 배열로)
5. 권장 재료 3가지 (steel_s45c, aluminum_6061, stainless_304, brass, abs_plastic, pom, pc, titanium 중에서)
Format: { "part_type": "...", "process": "...", "complexity": 5, "features": ["...", "..."], "materials": ["...", "...", "..."] }
JSON만 출력하고 다른 설명은 하지 마세요.`;

    // Product policy: all visual-language work is auto-routed through the
    // shared vision layer (GPT Luna first), rather than a hidden Qwen-only
    // path with separate credentials and no cache telemetry.
    const response = await visionCompletion({
        prompt,
        images: [{
            bytes: new Uint8Array(Buffer.from(base64Data, 'base64')),
            mimeType: ['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)
                ? mimeType as 'image/png' | 'image/jpeg' | 'image/webp'
                : 'image/png',
            label: `Uploaded manufacturing part (${mimeType})`,
        }],
        maxTokens: 512,
        timeoutMs: 30_000,
        signal,
    });
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in vision response');
    return JSON.parse(jsonMatch[0]);
}

// ─── 치수로 근사 계산 ────────────────────────────────────────────────────────

// ─── 단일 파일 처리 ──────────────────────────────────────────────────────────

// Client/server measurements must remain within the bounded geometry envelope.
const isValidGeo = isValidGeometry;

async function processOneFile(
    file: File,
    buffer: Buffer,
    dimensionsRaw: string | null,
    clientGeo: Geometry | null,
    persistPrivate: boolean,
    signal?: AbortSignal,
): Promise<{
    geometry: Geometry | null;
    aiAnalysis: Record<string, unknown> | null;
    storageKey: string | null;
    fileSize: number;
    filename: string;
    mimeType: string;
    category: 'cad' | 'image';
}> {
    const safeFilename = sanitizeFileName(file.name);
    const fileSize = buffer.length;

    const fileType = getFileType(file.name);
    let geometry: Geometry | null = null;
    let aiAnalysis: Record<string, unknown> | null = null;

    // ── STEP / STL ──
    if (fileType === 'step') {
        // Prefer the browser-extracted geometry (완제품 평가와 동일한 OCCT WASM 경로).
        // The client already tessellated the file and measured volume/surface/bbox,
        // so we skip the flaky server-side parse entirely when it's available.
        if (isValidGeo(clientGeo)) {
            geometry = clientGeo;
            aiAnalysis = { part_type: 'mechanical_part', process: 'cnc', complexity: 5, features: ['client_extracted'], materials: ['steel_s45c', 'aluminum_6061', 'stainless_304'] };
        }
        // Server-side parse only as a fallback when the browser didn't send geometry.
        if (
            !geometry
            && buffer.length <= INLINE_OCCT_PARSE_MAX_BYTES
            && process.env.NEXYFAB_ENABLE_INLINE_OCCT_PARSE === '1'
        ) try {
            const occtModule = await import('occt-import-js');
            const wasmPath = path.join(process.cwd(), 'node_modules/occt-import-js/dist/occt-import-js.wasm');
            const occt = await occtModule.default({
                locateFile: (p: string) => p.endsWith('.wasm') ? wasmPath : p,
            });
            const fileBuffer = new Uint8Array(buffer);
            const result = occt.ReadStepFile(fileBuffer, null);

            if (result?.success && result.meshes?.length > 0) {
                let totalVolume = 0, totalSurface = 0;
                let minX = Infinity, minY = Infinity, minZ = Infinity;
                let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

                for (const mesh of result.meshes) {
                    if (!mesh.attributes?.position?.array || !mesh.index?.array) continue;
                    const verts = Array.from(mesh.attributes.position.array as Float32Array);
                    const idxs = Array.from(mesh.index.array as Uint32Array);
                    totalVolume += computeVolume(verts, idxs);
                    totalSurface += computeSurfaceArea(verts, idxs);
                    for (let i = 0; i < verts.length; i += 3) {
                        minX = Math.min(minX, verts[i]);     maxX = Math.max(maxX, verts[i]);
                        minY = Math.min(minY, verts[i + 1]); maxY = Math.max(maxY, verts[i + 1]);
                        minZ = Math.min(minZ, verts[i + 2]); maxZ = Math.max(maxZ, verts[i + 2]);
                    }
                }
                geometry = {
                    volume_cm3: totalVolume / 1000,
                    surface_area_cm2: totalSurface / 100,
                    bbox: { w: Math.round(maxX - minX), h: Math.round(maxY - minY), d: Math.round(maxZ - minZ) },
                };
                aiAnalysis = { part_type: 'mechanical_part', process: 'cnc', complexity: 5, features: ['step_parsed'], materials: ['steel_s45c', 'aluminum_6061', 'stainless_304'] };
            }
        } catch (e) { console.error('OCCT parse error:', e); }

        // fallback to dimensions
        if (!geometry && dimensionsRaw) {
            try {
                const dims = JSON.parse(dimensionsRaw);
                if (dims.w && dims.h && dims.d) geometry = approximateGeometryFromDimensions(Number(dims.w), Number(dims.h), Number(dims.d));
            } catch { /* ignore */ }
        }
    }

    // ── OBJ ──
    if (fileType === 'obj') {
        if (isValidGeo(clientGeo)) {
            geometry = clientGeo;
            aiAnalysis = { part_type: 'mechanical_part', process: 'cnc', complexity: 5, features: ['client_extracted'], materials: ['steel_s45c', 'aluminum_6061', 'stainless_304'] };
        }
        const parsed = geometry ? null : parseOBJ(buffer);
        if (parsed && parsed.faces.length > 0) {
            const vol = computeVolume(parsed.vertices, parsed.faces);
            const area = computeSurfaceArea(parsed.vertices, parsed.faces);
            // 바운딩박스
            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            for (let i = 0; i < parsed.vertices.length; i += 3) {
                minX = Math.min(minX, parsed.vertices[i]);     maxX = Math.max(maxX, parsed.vertices[i]);
                minY = Math.min(minY, parsed.vertices[i + 1]); maxY = Math.max(maxY, parsed.vertices[i + 1]);
                minZ = Math.min(minZ, parsed.vertices[i + 2]); maxZ = Math.max(maxZ, parsed.vertices[i + 2]);
            }
            // OBJ는 단위가 불명확 — mm 가정 후 cm 변환
            geometry = {
                volume_cm3: vol / 1000,
                surface_area_cm2: area / 100,
                bbox: { w: Math.round(maxX - minX), h: Math.round(maxY - minY), d: Math.round(maxZ - minZ) },
            };
            aiAnalysis = { part_type: 'mechanical_part', process: 'cnc', complexity: 5, features: ['obj_parsed'], materials: ['steel_s45c', 'aluminum_6061', 'stainless_304'] };
        }

        if (!geometry && dimensionsRaw) {
            try {
                const dims = JSON.parse(dimensionsRaw);
                if (dims.w && dims.h && dims.d) geometry = approximateGeometryFromDimensions(Number(dims.w), Number(dims.h), Number(dims.d));
            } catch { /* ignore */ }
        }
    }

    // ── BLEND (파서 없음 → 치수 필수) ──
    if (fileType === 'blend') {
        aiAnalysis = { part_type: 'blender_model', process: 'cnc', complexity: 5, features: ['blend_dims_required'], materials: ['steel_s45c', 'aluminum_6061', 'abs_plastic'] };
        if (dimensionsRaw) {
            try {
                const dims = JSON.parse(dimensionsRaw);
                if (dims.w && dims.h && dims.d) geometry = approximateGeometryFromDimensions(Number(dims.w), Number(dims.h), Number(dims.d));
            } catch { /* ignore */ }
        }
        if (!geometry) geometry = { volume_cm3: 100, surface_area_cm2: 200, bbox: { w: 100, h: 100, d: 100 } };
    }

    // ── 이미지 ──
    if (fileType === 'image') {
        try {
            aiAnalysis = await analyzeImageWithVision(buffer.toString('base64'), file.type || 'image/jpeg', signal);
        } catch (e) {
            console.error('Vision analysis error:', e);
            aiAnalysis = { part_type: 'unknown', process: 'cnc', complexity: 5, features: [], materials: ['steel_s45c', 'aluminum_6061', 'abs_plastic'] };
        }
        if (dimensionsRaw) {
            try {
                const dims = JSON.parse(dimensionsRaw);
                if (dims.w && dims.h && dims.d) geometry = approximateGeometryFromDimensions(Number(dims.w), Number(dims.h), Number(dims.d));
            } catch { /* ignore */ }
        }
        if (!geometry) geometry = { volume_cm3: 100, surface_area_cm2: 200, bbox: { w: 100, h: 100, d: 10 } };
    }

    // Async virus scan — delete file and alert admin if infected
    // Reject overflow/non-finite server results too (including dimensions
    // supplied by the client) before private persistence or response.
    if (geometry && !isValidGeo(geometry)) geometry = null;

    let storageKey: string | null = null;
    if (persistPrivate && geometry) {
        const storageResult = await getStorage().uploadPrivate(buffer, safeFilename, 'quick-quote');
        storageKey = storageResult.key;
    }

    const _storageKeyForScan = storageKey;
    import('@/lib/virus-scan').then(({ scanBuffer }) =>
      scanBuffer(buffer, safeFilename).then(async result => {
        if (!result.skipped && !result.clean) {
          console.error(`[virus-scan] INFECTED: positives=${result.positives}/${result.total} permalink=${result.permalink ?? 'n/a'}`);
          // Delete infected file from storage
          if (_storageKeyForScan) {
            try {
              const { getStorage } = await import('@/lib/storage');
              await getStorage().delete(_storageKeyForScan);
            } catch (e) {
              console.error('[virus-scan] Failed to delete infected file from storage:', e instanceof Error ? e.message : e);
            }
          }
          // Notify admin (fire-and-forget)
          const { sendEmail } = await import('@/lib/nexyfab-email');
          sendEmail(
            getNexyfabAdminEmail(),
            '[NexyFab] ⚠️ Infected file detected',
            `<p>Virus scan flagged a file during quick-quote upload.</p><p>Positives: ${result.positives}/${result.total}</p><p>Report: ${result.permalink ?? 'N/A'}</p><p>File has been deleted from storage.</p>`,
          ).catch(() => {});
        }
      })
    ).catch(() => {});

    return {
        geometry,
        aiAnalysis,
        storageKey,
        fileSize,
        filename: safeFilename,
        mimeType: file.type || 'application/octet-stream',
        category: fileType === 'image' ? 'image' : 'cad',
    };
}

// ─── Geometry 합산 ────────────────────────────────────────────────────────────

function mergeGeometries(geos: Geometry[]): Geometry {
    const totalVol = geos.reduce((s, g) => s + g.volume_cm3, 0);
    const totalArea = geos.reduce((s, g) => s + g.surface_area_cm2, 0);
    const maxW = Math.max(...geos.map(g => g.bbox.w));
    const maxH = Math.max(...geos.map(g => g.bbox.h));
    const maxD = Math.max(...geos.map(g => g.bbox.d));
    return { volume_cm3: totalVol, surface_area_cm2: totalArea, bbox: { w: maxW, h: maxH, d: maxD } };
}

// ─── POST Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    if (!checkOrigin(req)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const authUser = await getAuthUser(req).catch(() => null);

    // Rate limit: authenticated users get a higher quota; anonymous uploads stay constrained.
    const ip = getTrustedClientIp(req.headers);
    const rateKey = authUser ? `quick-quote:user:${authUser.userId}` : `quick-quote:anon:${ip}`;
    const rateLimit = authUser ? 10 : 3;
    if (!(await rateLimitAsync(rateKey, rateLimit, 60_000)).allowed) {
        return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    let cleanupStorageKeys: string[] = [];
    try {
        const maximumBodyBytes = authUser ? MAX_AUTHENTICATED_MULTIPART_BODY_BYTES : MAX_ANONYMOUS_MULTIPART_BODY_BYTES;
        const boundedForm = await readBoundedMultipartForm(req, maximumBodyBytes);
        if (boundedForm.tooLarge) {
            return NextResponse.json({ error: 'Upload payload is too large' }, { status: 413 });
        }
        if (!boundedForm.form) throw new Error('invalid multipart body');
        const formData = boundedForm.form;
        const files = formData.getAll('file') as File[];
        const dimensionsRaw = formData.get('dimensions') as string | null;
        // Browser-extracted geometry keyed by filename (완제품 평가와 동일한 클라 OCCT/mesh 경로).
        // When present we trust it over the server-side parse.
        let clientGeometries: Record<string, unknown> = {};
        try {
            const raw = formData.get('clientGeometries');
            if (typeof raw === 'string' && raw) {
                if (Buffer.byteLength(raw, 'utf8') > 128 * 1024) {
                    return NextResponse.json({ error: 'clientGeometries is too large' }, { status: 400 });
                }
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) clientGeometries = parsed as Record<string, unknown>;
            }
        } catch { /* ignore malformed — server parse / dims fallback still runs */ }
        const rfqIdRaw = String(formData.get('rfqId') ?? '').trim();
        const replacesFileIdRaw = String(formData.get('replacesFileId') ?? '').trim();

        if (rfqIdRaw || replacesFileIdRaw) {
            if (!authUser) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
            if (replacesFileIdRaw && !rfqIdRaw) {
                return NextResponse.json({ error: 'rfqId is required when replacesFileId is set' }, { status: 400 });
            }
        }
        if (replacesFileIdRaw && files.length > 1) {
            return NextResponse.json({ error: 'Version upload supports only one file at a time' }, { status: 400 });
        }

        let rfqAccess: Awaited<ReturnType<typeof getRfqAccessForUser>> = null;
        if (rfqIdRaw && authUser) {
            rfqAccess = await getRfqAccessForUser(rfqIdRaw, authUser);
            if (!rfqAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (!files || files.length === 0) {
            return NextResponse.json({ error: 'file is required' }, { status: 400 });
        }
        const maxFiles = authUser ? 5 : 1;
        if (files.length > maxFiles) {
            return NextResponse.json({ error: `Maximum ${maxFiles} file${maxFiles === 1 ? '' : 's'} per upload` }, { status: 400 });
        }

        // 파일 유효성 검사 (확장자, 크기, 매직 바이트)
        for (const file of files) {
            const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
            const isCad = QUICK_QUOTE_CONFIG.cadExtensions.includes(ext);
            const validation = await validateUploadedFile(file, {
                allowedExtensions: QUICK_QUOTE_CONFIG.allowedExtensions,
                maxSizeBytes: isCad ? QUICK_QUOTE_CONFIG.maxSizeCad : QUICK_QUOTE_CONFIG.maxSizeImage,
                // OBJ/BLEND don't have reliable magic bytes; images and STEP do
                checkMagicBytes: !(['.obj', '.blend'].includes(ext)),
            });
            if (!validation.valid) {
                return NextResponse.json({ error: `${file.name}: ${validation.error}` }, { status: 400 });
            }
        }

        for (const file of files) {
            if (Object.prototype.hasOwnProperty.call(clientGeometries, file.name)
                && !isValidGeo(clientGeometries[file.name])) {
                return NextResponse.json({ error: `${file.name}: invalid or oversized geometry` }, { status: 400 });
            }
        }

        if (dimensionsRaw) {
            if (Buffer.byteLength(dimensionsRaw, 'utf8') > 4 * 1024) {
                return NextResponse.json({ error: 'dimensions is too large' }, { status: 400 });
            }
            try {
                const dims = JSON.parse(dimensionsRaw) as { w?: unknown; h?: unknown; d?: unknown };
                if (dims.w !== undefined || dims.h !== undefined || dims.d !== undefined) {
                    const candidate = approximateGeometryFromDimensions(Number(dims.w), Number(dims.h), Number(dims.d));
                    if (!isValidGeo(candidate)) {
                        return NextResponse.json({ error: 'invalid or oversized dimensions' }, { status: 400 });
                    }
                }
            } catch {
                return NextResponse.json({ error: 'invalid dimensions' }, { status: 400 });
            }
        }

        // 모든 파일 처리
        // Image analysis is a paid AI path. Apply the shared studio guard for
        // authenticated budget/monthly slots and anonymous burst control, then
        // also enforce the non-resettable guest daily quota for anonymous use.
        const hasImage = files.some(file => getFileType(file.name) === 'image');
        if (hasImage) {
            const aiGuard = await guardStudioAi(req);
            if (aiGuard) return aiGuard;
        }
        if (!authUser && hasImage) {
            const guestQuota = await consumeEngineeringChatGuestQuota(req, ip);
            if (!guestQuota.allowed) {
                if (guestQuota.unavailable) {
                    return NextResponse.json({
                        error: 'Guest AI quota is temporarily unavailable.',
                        code: 'GUEST_CHAT_QUOTA_UNAVAILABLE',
                        resetAtMs: guestQuota.resetAt,
                    }, { status: 503 });
                }
                return NextResponse.json({
                    error: 'Guest AI quota reached. Please sign in or try again later.',
                    code: 'GUEST_CHAT_QUOTA',
                    limit: GUEST_ENGINEERING_CHAT_DAILY_LIMIT,
                    resetAtMs: guestQuota.resetAt,
                }, { status: 429 });
            }
        }

        // The platform parser still materializes FormData, but process files
        // sequentially so authenticated multi-file requests never add every
        // per-file ArrayBuffer to the peak at once.
        const results: Awaited<ReturnType<typeof processOneFile>>[] = [];
        for (const file of files) {
            const buffer = Buffer.from(await file.arrayBuffer());
            const cg = clientGeometries[file.name];
            results.push(await processOneFile(file, buffer, dimensionsRaw, isValidGeo(cg) ? cg : null, !!authUser, req.signal));
        }

        const validGeos = results.map(r => r.geometry).filter(Boolean) as Geometry[];
        cleanupStorageKeys = results.flatMap(r => r.storageKey ? [r.storageKey] : []);
        if (validGeos.length === 0) {
            return NextResponse.json({ error: 'Could not extract geometry. Please provide dimensions.' }, { status: 422 });
        }

        // Save file metadata to nf_files if user is authenticated
        const savedFileIds: string[] = [];
        if (authUser) {
            const db = getDbAdapter();
            const now = Date.now();
            const uploadedByRole = rfqAccess
                ? (rfqAccess.role === 'owner' ? 'customer' : 'partner')
                : null;

            let parentForVersion: {
                id: string;
                cad_root_id: string | null;
                cad_version: number;
                ref_type: string | null;
                ref_id: string | null;
                category: string;
            } | null = null;
            if (replacesFileIdRaw && rfqIdRaw) {
                parentForVersion = await db.queryOne<{
                    id: string;
                    cad_root_id: string | null;
                    cad_version: number;
                    ref_type: string | null;
                    ref_id: string | null;
                    category: string;
                }>(
                    `SELECT id, cad_root_id, cad_version, ref_type, ref_id, category FROM nf_files WHERE id = ?`,
                    replacesFileIdRaw,
                ).catch(() => null) ?? null;
                if (
                    !parentForVersion
                    || parentForVersion.ref_type !== 'rfq'
                    || parentForVersion.ref_id !== rfqIdRaw
                    || parentForVersion.category !== 'cad'
                ) {
                    await Promise.all(cleanupStorageKeys.map(key => getStorage().delete(key).catch(() => {})));
                    cleanupStorageKeys = [];
                    return NextResponse.json({ error: 'Invalid replacesFileId' }, { status: 400 });
                }
            }

            for (const r of results) {
                if (!r.storageKey) throw new Error('Authenticated upload did not persist to private storage');
                const category = r.category;
                const fileId = randomUUID();
                const safeName = r.filename;

                const refType = rfqIdRaw ? 'rfq' : null;
                const refId = rfqIdRaw || null;

                let replacesId: string | null = null;
                let cadRootId: string | null = null;
                let cadVersion = 1;
                if (category === 'cad') {
                    if (parentForVersion && results.length === 1) {
                        replacesId = parentForVersion.id;
                        cadRootId = parentForVersion.cad_root_id ?? parentForVersion.id;
                        cadVersion = (parentForVersion.cad_version || 1) + 1;
                    } else {
                        cadRootId = fileId;
                    }
                }

                await db.execute(
                    `INSERT INTO nf_files (id, user_id, storage_key, filename, mime_type, size_bytes, category, ref_type, ref_id, created_at, replaces_file_id, cad_root_id, cad_version, uploaded_by_role)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    fileId,
                    authUser.userId,
                    r.storageKey,
                    safeName,
                    r.mimeType,
                    r.fileSize,
                    category,
                    refType,
                    refId,
                    now,
                    replacesId,
                    cadRootId,
                    cadVersion,
                    uploadedByRole,
                );
                savedFileIds.push(fileId);
            }
        }

        const geometry = validGeos.length === 1 ? validGeos[0] : mergeGeometries(validGeos);
        const aiAnalysis = results[0].aiAnalysis; // 첫 파일 기준 AI 분석
        const fileUrls = savedFileIds.map(id => `/api/nexyfab/files/${encodeURIComponent(id)}/download`);
        cleanupStorageKeys = [];

        return NextResponse.json({
            geometry,
            aiAnalysis,
            fileUrl: fileUrls[0] || '',
            fileUrls,
            url: fileUrls[0] || '',
            fileCount: files.length,
            ...(savedFileIds.length > 0 ? { savedFileIds } : {}),
        });
    } catch (err) {
        await Promise.all(cleanupStorageKeys.map(key => getStorage().delete(key).catch(() => {})));
        console.error('quick-quote upload error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
