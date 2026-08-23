import { NextRequest, NextResponse } from 'next/server';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { rateLimitAsync } from '@/lib/rate-limit';
import { logError } from '@/app/lib/errorLog';
import { getNexyfabAdminEmail } from '@/lib/nexyfab-email';
import { validateUploadedFile, sanitizeFileName, UPLOAD_CONFIGS } from '@/lib/file-validation';
import { getStorage } from '@/lib/storage';
import { getDbAdapter } from '@/lib/db-adapter';
import { getPartnerAuth } from '@/lib/partner-auth';
import { normPartnerEmail } from '@/lib/partner-factory-access';
import { getTrustedClientIp } from '@/lib/client-ip';
import { readBoundedMultipartForm } from '@/lib/boundedMultipartForm';

export const dynamic = 'force-dynamic';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const MODEL_EXTS = ['stl', 'step', 'stp', 'obj', '3ds', 'iges', 'igs'];
const DOCUMENT_EXTS = ['pdf', 'dwg', 'dxf'];

const SIZE_LIMITS: Record<string, number> = {
  image: 10 * 1024 * 1024,     // 10MB
  // The upload proxy is 64 MiB; reserve 2 MiB for multipart framing/fields.
  model: 62 * 1024 * 1024,
  document: 62 * 1024 * 1024,
};

const MAX_UPLOAD_MULTIPART_BODY_BYTES = 64 * 1024 * 1024;

function getFileType(ext: string): 'image' | 'model' | 'document' | null {
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (MODEL_EXTS.includes(ext)) return 'model';
  if (DOCUMENT_EXTS.includes(ext)) return 'document';
  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parsed row from `nf_contracts.attachments` JSON */
interface ContractAttachmentRow {
  id: string;
  originalName: string;
  filename?: string;
  version?: number;
  uploadedBy?: string;
  url?: string;
  storageKey?: string;
  type?: string;
  size?: number;
  mimeType?: string;
  previousVersionId?: string;
}

// 같은 originalName의 파일 중 최대 버전 번호를 찾아 다음 버전 반환
function getNextVersion(attachments: ContractAttachmentRow[], originalName: string): number {
  const baseName = originalName.replace(/\.[^.]+$/, ''); // 확장자 제거
  const ext = originalName.split('.').pop() || '';
  const pattern = new RegExp(`^${escapeRegex(baseName)}(_v\\d+)?\\.${escapeRegex(ext)}$`);

  const existing = attachments.filter((a: ContractAttachmentRow) => {
    if (a.originalName === originalName) return true;
    if (pattern.test(a.originalName)) return true;
    return false;
  });
  return existing.length + 1;
}

function parseAttachments(raw: string | null): ContractAttachmentRow[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed) ? parsed as ContractAttachmentRow[] : [];
  } catch {
    return [];
  }
}

function isValidContractId(contractId: string): boolean {
  return !/[^a-zA-Z0-9\-_]/.test(contractId);
}

function privateAttachmentUrl(req: NextRequest, contractId: string, attachmentId: string): string {
  const url = new URL('/api/partner/upload', req.url);
  url.searchParams.set('contractId', contractId);
  url.searchParams.set('id', attachmentId);
  return `${url.pathname}${url.search}`;
}

function attachmentDisposition(filename: string): string {
  const asciiName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// GET /api/partner/upload?id=ATT-xxx&contractId=xxx
export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const attachmentId = req.nextUrl.searchParams.get('id');
  const contractId = req.nextUrl.searchParams.get('contractId');
  if (!attachmentId || !contractId || !isValidContractId(contractId)) {
    return NextResponse.json({ error: 'A valid id and contractId are required.' }, { status: 400 });
  }

  const db = getDbAdapter();
  const contractRow = await db.queryOne<{ attachments: string | null }>(
    `SELECT attachments FROM nf_contracts WHERE id = ?
       AND partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?`,
    contractId,
    normPartnerEmail(partner.email),
  );
  if (!contractRow) {
    return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  }

  const attachment = parseAttachments(contractRow.attachments).find(row => row.id === attachmentId);
  if (!attachment) {
    return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  }

  try {
    if (attachment.storageKey) {
      const storage = getStorage();
      if (!process.env.S3_BUCKET && attachment.storageKey.startsWith('private/')) {
        const buffer = await storage.download?.(attachment.storageKey);
        if (!buffer) throw new Error('Private storage download is unavailable');
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type': attachment.mimeType || 'application/octet-stream',
            'Content-Disposition': attachmentDisposition(attachment.originalName),
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }

      const signedUrl = await storage.getSignedUrl(attachment.storageKey, 300);
      return NextResponse.redirect(signedUrl);
    }

    // Read-only compatibility for Closed Beta attachments created before private storage.
    const legacyPrefix = `/uploads/contracts/${contractId}/`;
    if (attachment.url?.startsWith(legacyPrefix) && !attachment.url.slice(legacyPrefix.length).includes('/')) {
      return NextResponse.redirect(new URL(attachment.url, req.url));
    }
  } catch (err) {
    logError('Partner attachment download failed', err instanceof Error ? err : undefined, {
      url: '/api/partner/upload',
      userId: partner.email,
    });
    return NextResponse.json({ error: 'Failed to download file.' }, { status: 500 });
  }

  return NextResponse.json({ error: 'File not found.' }, { status: 404 });
}

// POST /api/partner/upload
export async function POST(req: NextRequest) {
  // Rate limiting — IP당 분당 10회
  const ip = getTrustedClientIp(req.headers);
  if (!(await rateLimitAsync(`partner-upload:${ip}`, 10, 60 * 1000)).allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 });
  }

  const partner = await getPartnerAuth(req);
  if (!partner) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  let formData: FormData;
  try {
    const boundedForm = await readBoundedMultipartForm(req, MAX_UPLOAD_MULTIPART_BODY_BYTES);
    if (boundedForm.tooLarge) {
      return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }
    if (!boundedForm.form) throw new Error('invalid multipart body');
    formData = boundedForm.form;
  } catch (err) {
    logError('파일 데이터 파싱 실패', err instanceof Error ? err : undefined, { url: '/api/partner/upload' });
    return NextResponse.json({ error: '파일 데이터를 읽을 수 없습니다.' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const contractId = formData.get('contractId') as string | null;

  if (!file || !contractId) {
    return NextResponse.json({ error: 'file과 contractId가 필요합니다.' }, { status: 400 });
  }
  // Path traversal 방지
  if (/[^a-zA-Z0-9\-_]/.test(contractId)) {
    return NextResponse.json({ error: '유효하지 않은 contractId입니다.' }, { status: 400 });
  }

  // 계약 존재 및 권한 확인
  const db = getDbAdapter();
  const contractRow = await db.queryOne<{ id: string; attachments: string | null }>(
    `SELECT id, attachments FROM nf_contracts WHERE id = ?
       AND partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?`,
    contractId,
    normPartnerEmail(partner.email),
  );
  if (!contractRow) {
    return NextResponse.json({ error: '계약을 찾을 수 없습니다.' }, { status: 404 });
  }

  const originalName = sanitizeFileName(file.name);
  const ext = originalName.split('.').pop()?.toLowerCase() || '';
  const fileType = getFileType(ext);

  if (!fileType) {
    return NextResponse.json(
      { error: `허용되지 않는 파일 형식입니다. 허용: ${[...IMAGE_EXTS, ...MODEL_EXTS, ...DOCUMENT_EXTS].join(', ')}` },
      { status: 400 }
    );
  }

  // 공유 파일 유효성 검사 (크기 + 매직 바이트)
  // 이미지와 PDF는 매직 바이트 검사, 3D 모델/DWG/DXF는 검사 생략
  const validationConfig = fileType === 'image'
    ? UPLOAD_CONFIGS.image
    : fileType === 'document' && ext === 'pdf'
      ? UPLOAD_CONFIGS.document
      : {
          allowedExtensions: [...MODEL_EXTS, ...DOCUMENT_EXTS].map(e => `.${e}`),
          maxSizeBytes: SIZE_LIMITS[fileType],
          checkMagicBytes: false, // STL/STEP/OBJ/DWG/DXF have no standard magic bytes
        };

  const validation = await validateUploadedFile(file, validationConfig);
  if (!validation.valid) {
    logError('파일 유효성 검사 실패', undefined, {
      url: '/api/partner/upload',
      userId: partner.email,
      filename: originalName,
      mimeType: file.type,
    });
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // 파일 읽기 (저장에 재사용)
  const arrayBuffer = await file.arrayBuffer();

  const attachments = parseAttachments(contractRow.attachments);

  // ─── 버전 감지 ────────────────────────────────────────────────────────────
  const version = getNextVersion(attachments, originalName);

  // 이전 버전의 ID 찾기
  let previousVersionId: string | undefined;
  if (version > 1) {
    const prev = [...attachments]
      .filter((a: ContractAttachmentRow) => a.originalName === originalName)
      .sort((a: ContractAttachmentRow, b: ContractAttachmentRow) => (b.version || 1) - (a.version || 1))[0];
    if (prev) previousVersionId = prev.id;
  }

  const timestamp = Date.now();
  const filename = `${timestamp}_${originalName}`;
  const buffer = Buffer.from(arrayBuffer);
  const attachmentId = `ATT-${timestamp}`;

  let fileKey: string;
  try {
    const result = await getStorage().uploadPrivate(buffer, originalName, `contracts/${contractId}`);
    fileKey = result.key;
  } catch (err) {
    logError('Private partner upload failed', err instanceof Error ? err : undefined, {
      url: '/api/partner/upload',
      userId: partner.email,
      filename: originalName,
    });
    return NextResponse.json({ error: '파일 업로드 중 오류가 발생했습니다.' }, { status: 500 });
  }
  const fileUrl = privateAttachmentUrl(req, contractId, attachmentId);

  // 계약에 attachment 추가 (version 포함)
  const attachment: ContractAttachmentRow & {
    filename: string;
    type: string;
    mimeType: string;
    size: number;
    url: string;
    uploadedBy: string;
    uploadedAt: string;
    version: number;
    storageKey?: string;
    previousVersionId?: string;
  } = {
    id: attachmentId,
    filename,
    originalName,
    type: fileType,
    mimeType: file.type,
    size: file.size,
    url: fileUrl,
    ...(fileKey ? { storageKey: fileKey } : {}),
    uploadedBy: partner.company || partner.email,
    uploadedAt: new Date().toISOString(),
    version,
  };

  if (previousVersionId) {
    attachment.previousVersionId = previousVersionId;
  }

  try {
    attachments.push(attachment);
    await db.execute(
      'UPDATE nf_contracts SET attachments = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(attachments), new Date().toISOString(), contractId,
    );
  } catch (err) {
    await getStorage().delete(fileKey).catch(() => {});
    logError('파일 업로드 DB 저장 실패', err instanceof Error ? err : undefined, {
      url: '/api/partner/upload',
      userId: partner.email,
    });
    return NextResponse.json({ error: '파일 저장 중 오류가 발생했습니다.' }, { status: 500 });
  }

  // Save file metadata to nf_files for storage tracking
  if (fileKey) {
    try {
      const db = getDbAdapter();
      const mimeType = file.type || 'application/octet-stream';
      const cat = fileType === 'model' ? 'cad' : fileType === 'image' ? 'image' : 'document';
      const fileId = randomUUID();
      const cadRoot = cat === 'cad' ? fileId : null;
      await db.execute(
        `INSERT INTO nf_files (id, user_id, storage_key, filename, mime_type, size_bytes, category, ref_type, ref_id, created_at, replaces_file_id, cad_root_id, cad_version, uploaded_by_role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        fileId, partner.partnerId, fileKey, originalName,
        mimeType, file.size, cat, 'contract', contractId, Date.now(),
        null, cadRoot, 1, 'partner',
      );
    } catch (err) {
      // Non-blocking — contracts.json is already updated
      logError('nf_files 메타데이터 저장 실패', err instanceof Error ? err : undefined, {
        url: '/api/partner/upload', userId: partner.email,
      });
    }
  }

  // Async virus scan — runs after file is saved so we have fileKey/fileUrl for cleanup
  const _scanKey = fileKey;
  const _scanContractId = contractId;
  import('@/lib/virus-scan').then(({ scanBuffer }) =>
    scanBuffer(buffer, originalName).then(async result => {
      if (!result.skipped && !result.clean) {
        console.error(`[virus-scan] INFECTED: positives=${result.positives}/${result.total} contract=${_scanContractId}`);
        // Delete from R2 if stored there
        if (_scanKey) {
          try {
            await getStorage().delete(_scanKey);
          } catch { /* ignore */ }
        }
        // Notify admin
        const { sendEmail } = await import('@/lib/nexyfab-email');
        sendEmail(
          getNexyfabAdminEmail(),
          '[NexyFab] ⚠️ Infected partner upload detected',
          `<p>Virus scan flagged a partner-uploaded file.</p><p>Contract: ${_scanContractId}</p><p>Positives: ${result.positives}/${result.total}</p><p>Report: ${result.permalink ?? 'N/A'}</p><p>File deleted from storage.</p>`,
        ).catch(() => {});
      }
    })
  ).catch(() => {});

  return NextResponse.json({ attachment }, { status: 201 });
}

// DELETE /api/partner/upload?id=ATT-xxx&contractId=xxx
export async function DELETE(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const attachmentId = req.nextUrl.searchParams.get('id');
  const contractId = req.nextUrl.searchParams.get('contractId');

  if (!attachmentId || !contractId) {
    return NextResponse.json({ error: 'id와 contractId가 필요합니다.' }, { status: 400 });
  }
  if (/[^a-zA-Z0-9\-_]/.test(contractId)) {
    return NextResponse.json({ error: '유효하지 않은 contractId입니다.' }, { status: 400 });
  }

  const db = getDbAdapter();
  const contractRow = await db.queryOne<{ id: string; attachments: string | null }>(
    `SELECT id, attachments FROM nf_contracts WHERE id = ?
       AND partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?`,
    contractId,
    normPartnerEmail(partner.email),
  );
  if (!contractRow) {
    return NextResponse.json({ error: '계약을 찾을 수 없습니다.' }, { status: 404 });
  }

  const attachments = parseAttachments(contractRow.attachments);
  const attIdx = attachments.findIndex((a: ContractAttachmentRow) => a.id === attachmentId);

  if (attIdx === -1) {
    return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
  }

  const att = attachments[attIdx];

  // 본인이 올린 파일만 삭제 가능
  if (att.uploadedBy !== (partner.company || partner.email)) {
    return NextResponse.json({ error: '본인이 업로드한 파일만 삭제할 수 있습니다.' }, { status: 403 });
  }

  // 실제 파일 삭제 (R2 or 로컬)
  if (att.storageKey) {
    try {
      const storage = getStorage();
      await storage.delete(att.storageKey);
    } catch { /* 파일 없어도 DB에서는 제거 */ }
  } else if (att.url) {
    const filePath = path.join(process.cwd(), 'public', att.url);
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch { /* ignore */ }
  }

  const newAttachments = attachments.filter((_a, i: number) => i !== attIdx);
  await db.execute(
    'UPDATE nf_contracts SET attachments = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(newAttachments), new Date().toISOString(), contractId,
  );

  return NextResponse.json({ success: true });
}
