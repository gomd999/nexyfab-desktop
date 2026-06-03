/**
 * POST /api/step-import
 *
 * Phase 5.2 user-facing STEP importer endpoint. Wraps the pure-TS reader in
 * `src/lib/brep-bridge/stepImport.ts` and exposes it to the sketch / shape-
 * generator UI so users can drop a STEP file onto the canvas and get back a
 * FeatureTree of supported extrude features (box / convex polygon prism).
 *
 * Request — two encodings supported:
 *
 *   1. JSON   `{ source: "ISO-10303-21;\nHEADER;...\nEND-ISO-10303-21;\n" }`
 *      Useful when the client already has the STEP source in memory
 *      (e.g. pasted via textarea or fetched from another endpoint).
 *
 *   2. multipart/form-data with a `file` field containing the .step / .stp
 *      file blob. Streams via `req.formData()`; same 5 MB cap as the JSON
 *      branch.
 *
 * Either encoding flows into the same validator → importStep() pipeline.
 *
 * Pipeline:
 *   1. Pre-flight validation via `validateStep` (structural ISO-10303-21
 *      compliance). Errors here ⇒ 400 BAD_REQUEST + `errors[]` (importStep
 *      is NOT invoked — the file is unparseable as-is).
 *   2. importStep on the source (only when validation passes).
 *   3. Response merges importStep's `warnings` / `unsupported` with the
 *      validator's `warnings`, plus a structured `validation` envelope
 *      (protocol / schema / entityCount / warnings).
 *
 * Response (success):
 *   {
 *     ok: true,
 *     tree: FeatureTree,
 *     warnings: string[],        // import-time + validator warnings (merged)
 *     unsupported: string[],
 *     validation: {
 *       protocol?: 'AP203' | 'AP214' | 'AP242',
 *       schema?: string,
 *       entityCount: number,
 *       warnings: string[],      // validator warnings only
 *     },
 *   }
 *
 * Response (error):
 *   {
 *     ok: false,
 *     error: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE' | 'PARSE_ERROR',
 *     message: string,
 *     errors?: string[],         // structured validator errors when present
 *     validation?: { protocol?, schema?, entityCount, warnings },
 *   }
 *
 * The `error` field is an *English* code key — the UI is expected to map
 * codes to localised strings (Phase 5.2 ships six locales: ko / en / ja /
 * zh / es / ar). The free-form `message` field carries the underlying
 * StepImportError / first validation error for debugging only; it should
 * NOT be displayed verbatim to end users in a localised UI.
 *
 * Size cap rationale: the importer is a pure-JS regex walk over the entity
 * graph. At ~5 MB of STEP source the parser already churns through a few
 * hundred thousand entities; round-tripping that on the request thread
 * inside a Next.js serverless function risks blowing the response timeout
 * (10 s default on Vercel; longer on Railway but still finite). Real-world
 * STEP files that exceed 5 MB are usually full assemblies whose geometry
 * is dominated by curved surfaces / fillets / chamfers that this Phase 1
 * importer can't represent anyway — they belong on the Phase 2 OCCT
 * server-side path. Users who hit the cap get a clear 413 directing them
 * to the (future) full-OCCT upload route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { importStep, StepImportError } from '@/lib/brep-bridge/stepImport';
import { validateStep } from '@/lib/brep-bridge/stepValidator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 5 MB cap on STEP source size. See route header rationale. */
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

interface StepImportJsonBody {
  source?: unknown;
}

function bytesOf(s: string): number {
  // Char count is a cheap upper-bound proxy for byte length on ASCII-ish
  // STEP files; for the strict check we fall back to a Buffer measure.
  // Avoiding `Buffer.byteLength` on every keystroke also keeps the hot
  // path tight when the source is well under the cap.
  if (s.length <= MAX_SOURCE_BYTES) return s.length;
  return Buffer.byteLength(s, 'utf8');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentType = req.headers.get('content-type') ?? '';

  let source: string | null = null;

  if (contentType.includes('multipart/form-data')) {
    // multipart/form-data branch: pull the file blob, read as text.
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'BAD_REQUEST', message: 'Could not parse multipart form data' },
        { status: 400 },
      );
    }
    const fileEntry = form.get('file');
    if (!fileEntry || typeof fileEntry === 'string') {
      return NextResponse.json(
        { ok: false, error: 'BAD_REQUEST', message: 'multipart body missing `file` field' },
        { status: 400 },
      );
    }
    // Quick size pre-check on the blob before pulling the text into RAM.
    if (typeof (fileEntry as Blob).size === 'number' && (fileEntry as Blob).size > MAX_SOURCE_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: 'PAYLOAD_TOO_LARGE',
          message: `STEP file is ${(fileEntry as Blob).size} bytes (max ${MAX_SOURCE_BYTES})`,
        },
        { status: 413 },
      );
    }
    try {
      source = await (fileEntry as Blob).text();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'BAD_REQUEST', message: 'Could not read uploaded file as text' },
        { status: 400 },
      );
    }
  } else {
    // JSON branch.
    let body: StepImportJsonBody;
    try {
      body = (await req.json()) as StepImportJsonBody;
    } catch {
      return NextResponse.json(
        { ok: false, error: 'BAD_REQUEST', message: 'Body must be valid JSON' },
        { status: 400 },
      );
    }
    if (typeof body.source !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'BAD_REQUEST', message: '`source` field must be a string' },
        { status: 400 },
      );
    }
    source = body.source;
  }

  if (source === null || source.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'BAD_REQUEST', message: 'STEP source is empty' },
      { status: 400 },
    );
  }

  if (bytesOf(source) > MAX_SOURCE_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: 'PAYLOAD_TOO_LARGE',
        message: `STEP source exceeds ${MAX_SOURCE_BYTES} byte limit`,
      },
      { status: 413 },
    );
  }

  // ── pre-flight validation ───────────────────────────────────────────────
  // Runs BEFORE importStep so we don't churn the heavier parser on files
  // that already fail structural ISO-10303-21 checks. Hard errors abort
  // with a 400 + `errors[]` payload; warnings are merged into the success
  // response so callers always see compliance hints (unknown schema,
  // missing PRODUCT, etc.).
  const validation = validateStep(source);
  const validationEnvelope = {
    ...(validation.protocol ? { protocol: validation.protocol } : {}),
    ...(validation.schema !== undefined ? { schema: validation.schema } : {}),
    entityCount: validation.entityCount,
    warnings: validation.warnings,
  };

  if (!validation.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: 'BAD_REQUEST',
        message: `validation_failed: ${validation.errors[0] ?? 'unknown'}`,
        errors: validation.errors,
        validation: validationEnvelope,
      },
      { status: 400 },
    );
  }

  try {
    const result = importStep(source);
    // Merge importer-time advisories with validator warnings. The importer
    // warnings come first (they reflect heal/parse decisions the user might
    // want to act on); validator warnings follow with a `validate:` prefix
    // so callers can tell where each line originated.
    const mergedWarnings = [
      ...result.warnings,
      ...validation.warnings.map((w) => `validate:${w}`),
    ];
    return NextResponse.json({
      ok: true,
      tree: result.tree,
      warnings: mergedWarnings,
      unsupported: result.unsupported,
      validation: validationEnvelope,
    });
  } catch (err) {
    // Only StepImportError (or other thrown errors from importStep) reach
    // here; per-solid issues are routed into `unsupported` and never
    // throw. Map everything to PARSE_ERROR so the UI can show the
    // localised "Could not parse STEP file" copy. The validation envelope
    // is preserved so the UI can still surface the detected protocol /
    // entity count even when import fails downstream.
    const msg = err instanceof StepImportError
      ? err.message
      : err instanceof Error
        ? err.message
        : 'unknown parse error';
    return NextResponse.json(
      {
        ok: false,
        error: 'PARSE_ERROR',
        message: msg,
        validation: validationEnvelope,
      },
      { status: 400 },
    );
  }
}
