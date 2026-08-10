// Unit tests for file-validation
import { describe, it, expect } from 'vitest';
import { validateUploadedFile, validateZipArchive, sanitizeFileName } from './file-validation';
import type { FileValidationOptions } from './file-validation';
import { strToU8, zipSync } from 'fflate';

// ---------------------------------------------------------------------------
// Magic byte constants
// ---------------------------------------------------------------------------

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string, content: Uint8Array | string, overrideSize?: number): File {
  const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const file = new File([data.buffer as BlobPart], name, { type: 'application/octet-stream' });
  if (overrideSize !== undefined) {
    // Override the size property to simulate an oversized file without allocating memory
    Object.defineProperty(file, 'size', { value: overrideSize });
  }
  return file;
}

const IMAGE_OPTIONS: FileValidationOptions = {
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
  maxSizeBytes: 5 * 1024 * 1024, // 5 MB
  checkMagicBytes: true,
};

const PDF_OPTIONS: FileValidationOptions = {
  allowedExtensions: ['.pdf'],
  maxSizeBytes: 10 * 1024 * 1024,
  checkMagicBytes: true,
};

// ---------------------------------------------------------------------------
// validateUploadedFile
// ---------------------------------------------------------------------------

describe('validateUploadedFile', () => {
  // --- Size checks ---

  it('rejects a file that exceeds maxSizeBytes', async () => {
    const file = makeFile('photo.jpg', JPEG_MAGIC, 6 * 1024 * 1024);
    const result = await validateUploadedFile(file, IMAGE_OPTIONS);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too large/i);
    expect(result.error).toMatch(/5MB/i);
  });

  it('rejects an empty file (size 0)', async () => {
    const file = makeFile('empty.jpg', new Uint8Array(0));
    const result = await validateUploadedFile(file, IMAGE_OPTIONS);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  // --- Extension checks ---

  it('rejects a disallowed extension', async () => {
    const file = makeFile('malware.exe', 'MZ content');
    const result = await validateUploadedFile(file, IMAGE_OPTIONS);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not allowed/i);
  });

  it('rejects an extension that is completely absent from the list', async () => {
    const file = makeFile('archive.zip', 'PK\x03\x04somedata');
    const result = await validateUploadedFile(file, PDF_OPTIONS);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not allowed/i);
  });

  // --- Happy path ---

  it('accepts a valid JPEG file with correct magic bytes', async () => {
    // Pad with extra bytes so size > 0 and content is long enough
    const content = new Uint8Array(64);
    content.set(JPEG_MAGIC);
    const file = makeFile('photo.jpg', content);
    const result = await validateUploadedFile(file, IMAGE_OPTIONS);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('accepts a valid PNG file with correct magic bytes', async () => {
    const content = new Uint8Array(64);
    content.set(PNG_MAGIC);
    const file = makeFile('image.png', content);
    const result = await validateUploadedFile(file, IMAGE_OPTIONS);
    expect(result.valid).toBe(true);
  });

  // --- Magic byte mismatch ---

  it('rejects a JPEG extension with PNG magic bytes (spoofing)', async () => {
    const content = new Uint8Array(64);
    content.set(PNG_MAGIC); // PNG bytes inside a .jpg file
    const file = makeFile('fake.jpg', content);
    const result = await validateUploadedFile(file, IMAGE_OPTIONS);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/does not match|spoofing/i);
  });

  it('rejects a PNG extension with JPEG magic bytes (spoofing)', async () => {
    const content = new Uint8Array(64);
    content.set(JPEG_MAGIC); // JPEG bytes inside a .png file
    const file = makeFile('fake.png', content);
    const result = await validateUploadedFile(file, IMAGE_OPTIONS);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/does not match|spoofing/i);
  });

  it('accepts a valid PDF with correct magic bytes (%PDF-)', async () => {
    const content = new Uint8Array(64);
    content.set(PDF_MAGIC);
    const file = makeFile('document.pdf', content);
    const result = await validateUploadedFile(file, PDF_OPTIONS);
    expect(result.valid).toBe(true);
  });

  it('rejects a PDF extension with PNG magic bytes', async () => {
    const content = new Uint8Array(64);
    content.set(PNG_MAGIC);
    const file = makeFile('fake.pdf', content);
    const result = await validateUploadedFile(file, PDF_OPTIONS);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/does not match|spoofing/i);
  });

  // --- checkMagicBytes: false ---

  it('skips magic byte check when checkMagicBytes is false', async () => {
    const opts: FileValidationOptions = {
      allowedExtensions: ['.pdf'],
      maxSizeBytes: 10 * 1024 * 1024,
      checkMagicBytes: false,
    };
    // Wrong magic bytes but magic check is disabled
    const content = new Uint8Array(64);
    content.set(PNG_MAGIC);
    const file = makeFile('drawing.pdf', content);
    const result = await validateUploadedFile(file, opts);
    expect(result.valid).toBe(true);
  });

  // --- Boundary: exactly at size limit ---

  it('accepts a file exactly at the size limit', async () => {
    const maxBytes = 10;
    const content = new Uint8Array(maxBytes);
    content.set(PDF_MAGIC);
    const file = makeFile('boundary.pdf', content);
    const opts: FileValidationOptions = {
      allowedExtensions: ['.pdf'],
      maxSizeBytes: maxBytes,
      checkMagicBytes: true,
    };
    const result = await validateUploadedFile(file, opts);
    expect(result.valid).toBe(true);
  });
});

describe('validateZipArchive', () => {
  const zipFile = (entries: Record<string, Uint8Array>) => makeFile('assembly.zip', zipSync(entries));

  it('accepts a bounded CAD assembly ZIP without inflating it in the validator', async () => {
    const result = await validateZipArchive(zipFile({
      'assembly/root.step': strToU8('ISO-10303-21;DATA;ENDSEC;END-ISO-10303-21;'),
      'assembly/readme.txt': strToU8('manifest'),
    }));
    expect(result.valid).toBe(true);
  });

  it('rejects path traversal entries', async () => {
    const result = await validateZipArchive(zipFile({ '../outside.step': strToU8('data') }));
    expect(result).toMatchObject({ valid: false, error: expect.stringMatching(/unsafe path/i) });
  });

  it('rejects nested archives', async () => {
    const result = await validateZipArchive(zipFile({ 'parts/nested.zip': strToU8('PK') }));
    expect(result).toMatchObject({ valid: false, error: expect.stringMatching(/nested archive/i) });
  });

  it('rejects excessive compression ratios before extraction', async () => {
    const result = await validateZipArchive(zipFile({ 'huge.step': new Uint8Array(1024 * 1024) }));
    expect(result).toMatchObject({ valid: false, error: expect.stringMatching(/compression ratio/i) });
  });

  it('enforces entry-count policy', async () => {
    const file = zipFile({ 'a.step': strToU8('a'), 'b.step': strToU8('b') });
    const result = await validateZipArchive(file, {
      maxEntries: 1,
      maxPathDepth: 16,
      maxUncompressedBytes: 1024,
      maxCompressionRatio: 100,
    });
    expect(result).toMatchObject({ valid: false, error: expect.stringMatching(/too many entries/i) });
  });
});

// ---------------------------------------------------------------------------
// sanitizeFileName
// ---------------------------------------------------------------------------

describe('sanitizeFileName', () => {
  it('replaces forward slashes to prevent path traversal', () => {
    const result = sanitizeFileName('../../etc/passwd');
    // Each / and . sequences are sanitised
    expect(result).not.toContain('/');
    expect(result).not.toContain('..');
  });

  it('replaces backslashes', () => {
    const result = sanitizeFileName('C:\\Windows\\system32\\file.txt');
    expect(result).not.toContain('\\');
  });

  it('removes null bytes', () => {
    const name = 'file\x00name.txt';
    const result = sanitizeFileName(name);
    expect(result).not.toContain('\x00');
  });

  it('replaces dangerous characters < > : " | ? *', () => {
    const dangerous = 'file<>:"|?*.txt';
    const result = sanitizeFileName(dangerous);
    expect(result).not.toMatch(/[<>:"|?*]/);
  });

  it('collapses consecutive dots (path traversal mitigation)', () => {
    const result = sanitizeFileName('some..file..name');
    expect(result).not.toContain('..');
  });

  it('removes leading dots', () => {
    const result = sanitizeFileName('...hidden');
    expect(result).not.toMatch(/^\./);
  });

  it('trims to 255 characters maximum', () => {
    const long = 'a'.repeat(300) + '.txt';
    const result = sanitizeFileName(long);
    expect(result.length).toBeLessThanOrEqual(255);
  });

  it('preserves a safe filename unchanged (modulo double-dot collapse)', () => {
    const safe = 'my_document_v2.pdf';
    expect(sanitizeFileName(safe)).toBe('my_document_v2.pdf');
  });

  it('handles an empty string without throwing', () => {
    expect(() => sanitizeFileName('')).not.toThrow();
    expect(sanitizeFileName('')).toBe('');
  });
});
