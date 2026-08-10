// Allowed file types with magic byte signatures
const FILE_SIGNATURES: Record<string, { bytes: number[]; offset: number }[]> = {
  'application/pdf': [{ bytes: [0x25, 0x50, 0x44, 0x46], offset: 0 }], // %PDF
  'image/jpeg': [{ bytes: [0xFF, 0xD8, 0xFF], offset: 0 }],
  'image/png': [{ bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset: 0 }],
  'image/webp': [{ bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }], // RIFF
  'model/step': [
    { bytes: Array.from('ISO-10303').map(c => c.charCodeAt(0)), offset: 0 },
    { bytes: Array.from('STEP;').map(c => c.charCodeAt(0)), offset: 0 },
  ],
  'model/iges': [
    { bytes: Array.from('IGES').map(c => c.charCodeAt(0)), offset: 0 },
  ],
  'model/stl-binary': [{ bytes: [], offset: 0 }], // STL has no magic bytes - use size check
  'application/zip': [
    { bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 },
    { bytes: [0x50, 0x4B, 0x05, 0x06], offset: 0 },
  ],
};

const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.step': 'model/step',
  '.stp': 'model/step',
  '.iges': 'model/iges',
  '.igs': 'model/iges',
  '.stl': 'model/stl-binary',
  '.dxf': 'model/dxf',
  '.dwg': 'model/dwg',
  '.zip': 'application/zip',
};

export interface FileValidationOptions {
  allowedExtensions: readonly string[];
  maxSizeBytes: number;
  checkMagicBytes?: boolean;
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export interface ZipArchivePolicy {
  maxEntries: number;
  maxPathDepth: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
}

export const DEFAULT_ZIP_ARCHIVE_POLICY: ZipArchivePolicy = {
  maxEntries: 2_000,
  maxPathDepth: 16,
  maxUncompressedBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 100,
};

const readU16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const readU32 = (view: DataView, offset: number) => view.getUint32(offset, true);

/** Inspect the ZIP central directory without inflating attacker-controlled data. */
export async function validateZipArchive(
  file: File,
  policy: ZipArchivePolicy = DEFAULT_ZIP_ARCHIVE_POLICY,
): Promise<FileValidationResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEocd = 22;
  if (bytes.byteLength < minimumEocd) return { valid: false, error: 'Invalid ZIP archive.' };

  const searchStart = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let offset = bytes.byteLength - minimumEocd; offset >= searchStart; offset -= 1) {
    if (readU32(view, offset) === 0x06054B50) { eocd = offset; break; }
  }
  if (eocd < 0) return { valid: false, error: 'Invalid ZIP central directory.' };

  const disk = readU16(view, eocd + 4);
  const centralDisk = readU16(view, eocd + 6);
  const entries = readU16(view, eocd + 10);
  const centralSize = readU32(view, eocd + 12);
  const centralOffset = readU32(view, eocd + 16);
  if (disk !== 0 || centralDisk !== 0) return { valid: false, error: 'Multi-disk ZIP archives are not supported.' };
  if (entries === 0xFFFF || centralSize === 0xFFFFFFFF || centralOffset === 0xFFFFFFFF) {
    return { valid: false, error: 'ZIP64 archives require the isolated archive ingestion path.' };
  }
  if (entries > policy.maxEntries) return { valid: false, error: `ZIP contains too many entries (max ${policy.maxEntries}).` };
  if (centralOffset + centralSize > eocd || centralOffset + centralSize > bytes.byteLength) {
    return { valid: false, error: 'Invalid ZIP central directory bounds.' };
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  let offset = centralOffset;
  let parsedEntries = 0;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  while (offset < centralOffset + centralSize && parsedEntries < entries) {
    if (offset + 46 > bytes.byteLength || readU32(view, offset) !== 0x02014B50) {
      return { valid: false, error: 'Invalid ZIP entry directory.' };
    }
    const flags = readU16(view, offset + 8);
    const method = readU16(view, offset + 10);
    const compressed = readU32(view, offset + 20);
    const uncompressed = readU32(view, offset + 24);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const externalAttributes = readU32(view, offset + 38);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > bytes.byteLength || nextOffset > centralOffset + centralSize) {
      return { valid: false, error: 'Invalid ZIP entry bounds.' };
    }
    if ((flags & 0x1) !== 0) return { valid: false, error: 'Encrypted ZIP entries are not supported.' };
    if (method !== 0 && method !== 8) return { valid: false, error: 'Unsupported ZIP compression method.' };

    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const normalized = name.replaceAll('\\', '/');
    const segments = normalized.split('/').filter(Boolean);
    if (!normalized || normalized.includes('\0') || normalized.startsWith('/')
      || /^[A-Za-z]:\//.test(normalized) || segments.includes('..') || segments.includes('.')) {
      return { valid: false, error: 'Unsafe path in ZIP archive.' };
    }
    if (segments.length > policy.maxPathDepth) {
      return { valid: false, error: `ZIP path nesting is too deep (max ${policy.maxPathDepth}).` };
    }
    if (/\.(?:zip|rar|7z|tar|tgz|gz|bz2|xz)$/i.test(normalized)) {
      return { valid: false, error: 'Nested archives are not allowed.' };
    }
    const unixMode = (externalAttributes >>> 16) & 0xFFFF;
    if ((unixMode & 0o170000) === 0o120000) {
      return { valid: false, error: 'Symbolic links are not allowed in ZIP archives.' };
    }

    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    if (totalUncompressed > policy.maxUncompressedBytes) {
      return { valid: false, error: 'ZIP uncompressed size exceeds the safety limit.' };
    }
    const entryRatio = uncompressed === 0 ? 1 : uncompressed / Math.max(1, compressed);
    if (entryRatio > policy.maxCompressionRatio) {
      return { valid: false, error: 'ZIP compression ratio exceeds the safety limit.' };
    }
    parsedEntries += 1;
    offset = nextOffset;
  }
  if (parsedEntries !== entries || offset !== centralOffset + centralSize) {
    return { valid: false, error: 'ZIP entry count does not match its directory.' };
  }
  const totalRatio = totalUncompressed === 0 ? 1 : totalUncompressed / Math.max(1, totalCompressed);
  if (totalRatio > policy.maxCompressionRatio) {
    return { valid: false, error: 'ZIP total compression ratio exceeds the safety limit.' };
  }
  return { valid: true };
}

export async function validateUploadedFile(
  file: File,
  options: FileValidationOptions,
): Promise<FileValidationResult> {
  // 1. Check file size
  if (file.size > options.maxSizeBytes) {
    const maxMB = (options.maxSizeBytes / 1024 / 1024).toFixed(0);
    return { valid: false, error: `File too large. Maximum size is ${maxMB}MB.` };
  }

  if (file.size === 0) {
    return { valid: false, error: 'File is empty.' };
  }

  // 2. Check file extension
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
  if (!options.allowedExtensions.includes(ext)) {
    return {
      valid: false,
      error: `File type not allowed. Allowed: ${options.allowedExtensions.join(', ')}`,
    };
  }

  // 3. Check magic bytes (first 64 bytes)
  if (options.checkMagicBytes !== false) {
    const expectedMime = EXTENSION_TO_MIME[ext];
    if (expectedMime && FILE_SIGNATURES[expectedMime]) {
      const headerBytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const signatures = FILE_SIGNATURES[expectedMime];

      if (signatures.length > 0) {
        const matchesAny = signatures.some(sig => {
          if (sig.bytes.length === 0) return true; // No magic bytes defined
          const slice = headerBytes.slice(sig.offset, sig.offset + sig.bytes.length);
          return sig.bytes.every((b, i) => slice[i] === b);
        });

        if (!matchesAny) {
          return {
            valid: false,
            error: `File content does not match its extension (${ext}). Possible file spoofing.`,
          };
        }
      }
    }
  }

  if (ext === '.zip') return validateZipArchive(file);

  return { valid: true };
}

export function sanitizeFileName(name: string): string {
  // Remove path separators, null bytes, and dangerous characters
  return name
    .replace(/[/\\:*?"<>|]/g, '_')  // Windows/Unix path chars
    .replace(/\0/g, '')               // Null bytes
    .replace(/\.{2,}/g, '.')          // Multiple dots (path traversal)
    .replace(/^\.+/, '')              // Leading dots
    .slice(0, 255);                   // Max filename length
}

// Preset configurations for different upload types
export const UPLOAD_CONFIGS = {
  cad: {
    allowedExtensions: ['.step', '.stp', '.iges', '.igs', '.stl', '.dxf'],
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
    checkMagicBytes: true,
  },
  document: {
    allowedExtensions: ['.pdf'],
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    checkMagicBytes: true,
  },
  image: {
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
    maxSizeBytes: 5 * 1024 * 1024, // 5MB
    checkMagicBytes: true,
  },
  drawing: {
    allowedExtensions: ['.pdf', '.dwg', '.dxf', '.png', '.jpg', '.jpeg'],
    maxSizeBytes: 20 * 1024 * 1024, // 20MB
    checkMagicBytes: false, // DWG/DXF don't have standard magic bytes
  },
} as const;
