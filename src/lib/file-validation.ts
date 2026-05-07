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
