export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { validateUploadedFile, sanitizeFileName } from '@/lib/file-validation';
import { getStorage } from '@/lib/storage';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { rateLimitCheck } from '@/lib/rate-limit';

// Accepted extensions and their max sizes for this route
const QUICK_QUOTE_CONFIG = {
  allowedExtensions: ['.step', '.stp', '.stl', '.obj', '.blend', '.jpg', '.jpeg', '.png', '.webp'],
  cadExtensions: ['.step', '.stp', '.stl', '.obj', '.blend'],
  maxSizeCad: 50 * 1024 * 1024,  // 50MB
  maxSizeImage: 10 * 1024 * 1024, // 10MB
};

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

async function analyzeImageWithQwen(base64Data: string, mimeType: string) {
    const apiKey = process.env.QWEN_API_KEY;
    const baseUrl = process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

    const prompt = `이 부품/제품 이미지를 분석해서 다음을 JSON으로만 답해줘:
1. 부품 유형 (bracket, housing, shaft, gear, plate, cover, flange, etc.)
2. 예상 제조 공정 (cnc, injection_molding, die_casting, sheet_metal, 3d_printing, forging 중 하나)
3. 복잡도 점수 1-10 (형상 복잡도, 공차 요구 등)
4. 표면 특징 (홀 유무, 나사산, 곡면 등을 배열로)
5. 권장 재료 3가지 (steel_s45c, aluminum_6061, stainless_304, brass, abs_plastic, pom, pc, titanium 중에서)
Format: { "part_type": "...", "process": "...", "complexity": 5, "features": ["...", "..."], "materials": ["...", "...", "..."] }
JSON만 출력하고 다른 설명은 하지 마세요.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            signal: controller.signal,
            body: JSON.stringify({
                model: 'qwen-vl-plus',
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
                        { type: 'text', text: prompt },
                    ],
                }],
                max_tokens: 512,
            }),
        });

        if (!response.ok) throw new Error(`Qwen API error: ${response.status}`);
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON in Qwen response');
        return JSON.parse(jsonMatch[0]);
    } finally {
        clearTimeout(timeout);
    }
}

// ─── 치수로 근사 계산 ────────────────────────────────────────────────────────

function approximateFromDimensions(w: number, h: number, d: number) {
    return {
        volume_cm3: (w * h * d) / 1000,
        surface_area_cm2: (2 * (w * h + w * d + h * d)) / 100,
        bbox: { w, h, d },
    };
}

// ─── 단일 파일 처리 ──────────────────────────────────────────────────────────

type Geometry = { volume_cm3: number; surface_area_cm2: number; bbox: { w: number; h: number; d: number } };

async function processOneFile(
    file: File,
    buffer: Buffer,
    dimensionsRaw: string | null,
): Promise<{ geometry: Geometry | null; aiAnalysis: Record<string, unknown> | null; fileUrl: string; storageKey: string; fileSize: number }> {
    const safeFilename = sanitizeFileName(file.name);
    const storage = getStorage();
    const storageResult = await storage.upload(buffer, safeFilename, 'uploads/quick-quote');
    const fileUrl = storageResult.url;
    const storageKey = storageResult.key;
    const fileSize = storageResult.size;

    const fileType = getFileType(file.name);
    let geometry: Geometry | null = null;
    let aiAnalysis: Record<string, unknown> | null = null;

    // ── STEP / STL ──
    if (fileType === 'step') {
        try {
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
                if (dims.w && dims.h && dims.d) geometry = approximateFromDimensions(Number(dims.w), Number(dims.h), Number(dims.d));
            } catch { /* ignore */ }
        }
    }

    // ── OBJ ──
    if (fileType === 'obj') {
        const parsed = parseOBJ(buffer);
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
                if (dims.w && dims.h && dims.d) geometry = approximateFromDimensions(Number(dims.w), Number(dims.h), Number(dims.d));
            } catch { /* ignore */ }
        }
    }

    // ── BLEND (파서 없음 → 치수 필수) ──
    if (fileType === 'blend') {
        aiAnalysis = { part_type: 'blender_model', process: 'cnc', complexity: 5, features: ['blend_dims_required'], materials: ['steel_s45c', 'aluminum_6061', 'abs_plastic'] };
        if (dimensionsRaw) {
            try {
                const dims = JSON.parse(dimensionsRaw);
                if (dims.w && dims.h && dims.d) geometry = approximateFromDimensions(Number(dims.w), Number(dims.h), Number(dims.d));
            } catch { /* ignore */ }
        }
        if (!geometry) geometry = { volume_cm3: 100, surface_area_cm2: 200, bbox: { w: 100, h: 100, d: 100 } };
    }

    // ── 이미지 ──
    if (fileType === 'image') {
        try {
            aiAnalysis = await analyzeImageWithQwen(buffer.toString('base64'), file.type || 'image/jpeg');
        } catch (e) {
            console.error('Qwen VL error:', e);
            aiAnalysis = { part_type: 'unknown', process: 'cnc', complexity: 5, features: [], materials: ['steel_s45c', 'aluminum_6061', 'abs_plastic'] };
        }
        if (dimensionsRaw) {
            try {
                const dims = JSON.parse(dimensionsRaw);
                if (dims.w && dims.h && dims.d) geometry = approximateFromDimensions(Number(dims.w), Number(dims.h), Number(dims.d));
            } catch { /* ignore */ }
        }
        if (!geometry) geometry = { volume_cm3: 100, surface_area_cm2: 200, bbox: { w: 100, h: 100, d: 10 } };
    }

    // Async virus scan (non-blocking — logged only, does not block upload)
    import('@/lib/virus-scan').then(({ scanBuffer }) =>
      scanBuffer(buffer, safeFilename).then(result => {
        if (!result.skipped && !result.clean) {
          console.error(`[virus-scan] INFECTED file detected: ${safeFilename}, positives: ${result.positives}/${result.total}`);
          // TODO: delete file from storage, notify admin
        }
      })
    ).catch(() => {});

    return { geometry, aiAnalysis, fileUrl, storageKey, fileSize };
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
    // Rate limit: IP당 분당 10회
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
    if (!rateLimitCheck(`quick-quote:${ip}`, 10, 60_000)) {
        return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    try {
        const formData = await req.formData();
        const files = formData.getAll('file') as File[];
        const dimensionsRaw = formData.get('dimensions') as string | null;

        if (!files || files.length === 0) {
            return NextResponse.json({ error: 'file is required' }, { status: 400 });
        }
        if (files.length > 5) {
            return NextResponse.json({ error: 'Maximum 5 files per upload' }, { status: 400 });
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

        // 로컬 스토리지 사용 시 오래된 파일 정리 (24시간 이상)
        if (!process.env.S3_BUCKET) {
            const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'quick-quote');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            try {
                const dirFiles = fs.readdirSync(uploadDir);
                const now = Date.now();
                for (const f of dirFiles) {
                    const fp = path.join(uploadDir, f);
                    const stat = fs.statSync(fp);
                    if (!stat.isDirectory() && now - stat.mtimeMs > 24 * 60 * 60 * 1000) fs.unlinkSync(fp);
                }
            } catch { /* ignore */ }
        }

        // 모든 파일 처리
        const results = await Promise.all(
            files.map(async (file) => {
                const ab = await file.arrayBuffer();
                const buffer = Buffer.from(ab);
                return processOneFile(file, buffer, dimensionsRaw);
            })
        );

        // Save file metadata to nf_files if user is authenticated
        const authUser = await getAuthUser(req).catch(() => null);
        if (authUser) {
            const db = getDbAdapter();
            const now = Date.now();
            for (const r of results) {
                const ext = r.fileUrl.split('.').pop()?.toLowerCase() || '';
                const category = ['step', 'stp', 'stl', 'obj', 'blend'].includes(ext) ? 'cad' : 'image';
                await db.execute(
                    `INSERT INTO nf_files (id, user_id, storage_key, filename, mime_type, size_bytes, category, ref_type, ref_id, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    randomUUID(), authUser.userId, r.storageKey,
                    r.fileUrl.split('/').pop() || 'unknown',
                    'application/octet-stream', r.fileSize,
                    category, 'rfq', null, now,
                );
            }
        }

        const validGeos = results.map(r => r.geometry).filter(Boolean) as Geometry[];
        if (validGeos.length === 0) {
            return NextResponse.json({ error: 'Could not extract geometry. Please provide dimensions.' }, { status: 422 });
        }

        const geometry = validGeos.length === 1 ? validGeos[0] : mergeGeometries(validGeos);
        const aiAnalysis = results[0].aiAnalysis; // 첫 파일 기준 AI 분석
        const fileUrls = results.map(r => r.fileUrl);

        return NextResponse.json({
            geometry,
            aiAnalysis,
            fileUrl: fileUrls[0],
            fileUrls,
            fileCount: files.length,
        });
    } catch (err) {
        console.error('quick-quote upload error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
