'use client';

/**
 * MateInferenceReviewPageContent — Phase 5.2.3 dedicated review page for
 * the STEP-import mate inference pipeline.
 *
 * What this page does (top to bottom):
 *   1. Lets the user pick one of the three canned sample assemblies
 *      (`SAMPLE_ASSEMBLY_NAMES`).
 *   2. Runs `inferMatesFromPlacements` over the picked sample using the
 *      `assemblyPartGeometry` derivers (cube samples → AABB faces; the
 *      cube-only fixtures don't contribute axes, so suggestions are
 *      coincident-only in Phase 1).
 *   3. Generates Phase-1 MOCK confidence + reason strings per mate so the
 *      `MateInferenceReviewPanel` table renders meaningful triage data
 *      even before the inference algorithm scores its suggestions for
 *      real.
 *   4. Mounts the panel and tracks accept / reject decisions in-memory.
 *   5. Surfaces the accepted mates as a separate list with a one-click
 *      "Export JSON" button (uses `URL.createObjectURL`).
 *
 * MOCK CONFIDENCE POLICY (Phase 1)
 * --------------------------------
 * The real inference module doesn't emit per-suggestion scores yet — the
 * geometry predicates are pass/fail. To exercise the panel's confidence
 * bar + threshold-slider UX before a real scorer lands, this page synthe-
 * sises scores from a deterministic hash of `mate.id` (which already
 * encodes kind + counter inside `inferMatesFromPlacements`):
 *
 *   score = 0.3 + (hash(id) / MAX_UINT32) * 0.65   ∈ [0.30, 0.95]
 *
 * - LOWER bound 0.30: makes every mate fall below the default 0.5
 *   threshold sometimes, so the threshold slider has visible effect.
 * - UPPER bound 0.95: leaves headroom under 1.0 so reviewers can tell
 *   "synthetic" from "trusted-by-default missing score".
 * - Deterministic hash (not Math.random): identical sample selection
 *   yields identical scores, so the tests can assert "row data-confidence
 *   matches the expected value for mate id X".
 *
 * Real Phase-2 work will replace `generateMockConfidence` with a scorer
 * that consumes the heuristic's residuals (normal-cross-product magnitude,
 * coplanar-gap, axis perpendicular-distance, etc.).
 *
 * MOCK REASON POLICY (Phase 1)
 * ----------------------------
 * Reasons are stock per-kind strings plus a quantised "tolerance" derived
 * from the same hash. They're INTENTIONALLY plausible-but-fake — the real
 * inference module should attach reason data alongside scoring in Phase 2,
 * at which point this generator goes away.
 *
 * JSON EXPORT FORMAT
 * ------------------
 * `Blob` containing JSON of shape:
 *   {
 *     "version": "1.0",
 *     "sample": "two-cubes-concentric",
 *     "exportedAt": "2026-06-03T...Z",
 *     "acceptedMates": Mate[]   // full Mate IR objects, ready to merge
 *                              // into an AssemblyState
 *   }
 * Filename: `mate-inference-${sample}-${YYYYMMDD-HHMMSS}.json`.
 *
 * The download is triggered by creating an `<a>` and clicking it; the
 * blob URL is revoked synchronously after the click. Tests assert that
 * `URL.createObjectURL` is invoked with a Blob.
 *
 * The export button stays VISIBLE but disabled when no mates have been
 * accepted yet — the affordance is reachable, the action is gated.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  SAMPLE_ASSEMBLY_NAMES,
  getSampleAssembly,
  type SampleAssemblyName,
} from '@/lib/assembly/sampleAssemblies';
import { derivePartGeometryForAssembly } from '@/app/[lang]/shape-generator/assembly/assemblyPartGeometry';
import { inferMatesFromPlacements } from '@/lib/brep-bridge/stepAssemblyMateInference';
import MateInferenceReviewPanel, {
  type ReviewPanelLang,
} from '@/app/[lang]/shape-generator/assembly/MateInferenceReviewPanel';
import type { Mate, MateKind } from '@/lib/assembly/mate';

// ─── i18n ────────────────────────────────────────────────────────────────

type PageLang = ReviewPanelLang; // ko | en | ja | zh | es | ar

interface PageDict {
  title: string;
  subtitle: string;
  samplePickerLabel: string;
  runInferenceBtn: string;
  noInferenceYet: string;
  acceptedHeader: string;
  acceptedEmpty: string;
  exportJsonBtn: string;
  ranInferenceCount: (n: number) => string;
}

const dict: Record<PageLang, PageDict> = {
  ko: {
    title: '메이트 추론 검토',
    subtitle: 'STEP 임포트 메이트 추론 파이프라인의 검토 및 수락 페이지입니다.',
    samplePickerLabel: '샘플 어셈블리',
    runInferenceBtn: '추론 실행',
    noInferenceYet: '추론을 실행하지 않았습니다. 위의 버튼을 클릭하세요.',
    acceptedHeader: '수락된 메이트',
    acceptedEmpty: '아직 수락된 메이트가 없습니다.',
    exportJsonBtn: 'JSON 내보내기',
    ranInferenceCount: (n) => `${n}개의 메이트 추천이 생성되었습니다.`,
  },
  en: {
    title: 'Mate Inference Review',
    subtitle:
      'Review surface for the STEP-import mate inference pipeline. Pick a sample, run inference, triage suggestions.',
    samplePickerLabel: 'Sample assembly',
    runInferenceBtn: 'Run inference',
    noInferenceYet: 'No inference yet. Click the button above to run.',
    acceptedHeader: 'Accepted mates',
    acceptedEmpty: 'No mates accepted yet.',
    exportJsonBtn: 'Export JSON',
    ranInferenceCount: (n) => `${n} mate suggestion${n === 1 ? '' : 's'} generated.`,
  },
  ja: {
    title: '合致推論レビュー',
    subtitle: 'STEPインポートの合致推論パイプラインのレビュー画面です。',
    samplePickerLabel: 'サンプルアセンブリ',
    runInferenceBtn: '推論実行',
    noInferenceYet: '推論はまだ実行されていません。上のボタンをクリックしてください。',
    acceptedHeader: '適用された合致',
    acceptedEmpty: '適用された合致はまだありません。',
    exportJsonBtn: 'JSONエクスポート',
    ranInferenceCount: (n) => `${n}件の合致候補が生成されました。`,
  },
  zh: {
    title: '配合推断审阅',
    subtitle: '用于审阅 STEP 导入配合推断管线的页面。',
    samplePickerLabel: '示例装配',
    runInferenceBtn: '运行推断',
    noInferenceYet: '尚未运行推断。请点击上方按钮。',
    acceptedHeader: '已接受的配合',
    acceptedEmpty: '尚未接受任何配合。',
    exportJsonBtn: '导出 JSON',
    ranInferenceCount: (n) => `已生成 ${n} 个配合建议。`,
  },
  es: {
    title: 'Revisión de inferencia de restricciones',
    subtitle:
      'Página de revisión para la canalización de inferencia de restricciones de importación STEP.',
    samplePickerLabel: 'Ensamblaje de muestra',
    runInferenceBtn: 'Ejecutar inferencia',
    noInferenceYet:
      'Aún no se ha ejecutado la inferencia. Haga clic en el botón de arriba.',
    acceptedHeader: 'Restricciones aceptadas',
    acceptedEmpty: 'Aún no se han aceptado restricciones.',
    exportJsonBtn: 'Exportar JSON',
    ranInferenceCount: (n) =>
      `Se generaron ${n} sugerencia${n === 1 ? '' : 's'} de restricción.`,
  },
  ar: {
    title: 'مراجعة استنتاج القيود',
    subtitle: 'صفحة مراجعة لخط أنابيب استنتاج القيود لاستيراد STEP.',
    samplePickerLabel: 'تجميع نموذجي',
    runInferenceBtn: 'تشغيل الاستنتاج',
    noInferenceYet: 'لم يتم تشغيل الاستنتاج بعد. انقر فوق الزر أعلاه.',
    acceptedHeader: 'القيود المقبولة',
    acceptedEmpty: 'لم يتم قبول أي قيود بعد.',
    exportJsonBtn: 'تصدير JSON',
    ranInferenceCount: (n) => `تم إنشاء ${n} اقتراح قيد.`,
  },
};

// ─── lang normalisation ──────────────────────────────────────────────────

function normalizeLang(raw: string): PageLang {
  if (
    raw === 'ko' ||
    raw === 'en' ||
    raw === 'ja' ||
    raw === 'zh' ||
    raw === 'es' ||
    raw === 'ar'
  ) {
    return raw;
  }
  if (raw === 'cn') return 'zh';
  if (raw === 'kr') return 'ko';
  return 'en';
}

// ─── mock confidence + reasons ───────────────────────────────────────────

/**
 * Deterministic uint32 hash (FNV-1a variant) of a string. We use this
 * instead of `Math.random` so identical sample selections yield identical
 * scores — keeps the tests stable without forcing test code to inject a
 * seeded RNG.
 */
function hashStringToUint32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // Multiply by FNV prime, mod 2^32. `Math.imul` keeps the result in
    // 32-bit territory so the >>> 0 normalisation at the end is cheap.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Map a Mate id → confidence in [0.30, 0.95]. The lower bound keeps every
 * mate well above zero (avoids the panel's "score is unset" sentinel
 * coding); the upper bound stops just shy of 1.0 so the synthetic origin
 * stays visually distinct.
 */
export function generateMockConfidence(mateId: string): number {
  const h = hashStringToUint32(mateId);
  const frac = h / 0xffffffff; // [0, 1]
  // 0.30 + frac * 0.65 = [0.30, 0.95]. Round to 2 decimals so the displayed
  // % matches the data-confidence attribute exactly.
  return Math.round((0.3 + frac * 0.65) * 100) / 100;
}

/**
 * Stock reason templates keyed by mate kind. The tolerance suffix is
 * derived from the same hash as the confidence so identical mate ids
 * yield identical reasons — keeps the page reproducible across reloads.
 */
function reasonTemplate(kind: MateKind, mateId: string): string {
  // Quantise the hash to two plausible-tolerance buckets so the reason
  // doesn't read like a uniform distribution.
  const h = hashStringToUint32(mateId);
  const tolTenths = (h % 9) + 1; // 1..9
  const tolMm = (tolTenths / 100).toFixed(2); // "0.01" .. "0.09" mm
  switch (kind) {
    case 'coincident':
      return `Coplanar within ${tolMm}mm`;
    case 'concentric':
      return `Axes collinear within ${tolMm}mm`;
    case 'parallel':
      return `Axes parallel within 0.5°, offset ${tolMm}mm`;
    case 'perpendicular':
      return `Normals orthogonal within 0.5°`;
    case 'distance':
      return `Gap ${tolMm}mm`;
    case 'angle':
      return `Angle within 0.5°`;
    case 'tangent':
      return `Surfaces tangent within ${tolMm}mm`;
    case 'hinge':
      return `Hinge axis match within ${tolMm}mm`;
    case 'slot':
      return `Slot direction parallel within 0.5°`;
    case 'gear':
      return `Gear axes parallel within 0.5°`;
    case 'rack_pinion':
      return `Rack & pinion alignment within ${tolMm}mm`;
    default:
      return `Heuristic match within ${tolMm}mm`;
  }
}

// ─── component ───────────────────────────────────────────────────────────

export interface MateInferenceReviewPageContentProps {
  lang: string;
}

interface InferenceRun {
  sample: SampleAssemblyName;
  suggestions: Mate[];
  confidence: Record<string, number>;
  reasons: Record<string, string>;
  partNames: Record<string, string>;
}

export function MateInferenceReviewPageContent({
  lang,
}: MateInferenceReviewPageContentProps): React.ReactElement {
  const editorLang = normalizeLang(lang);
  const t = dict[editorLang];

  // ── controlled selection ───────────────────────────────────────────────
  const [sample, setSample] = useState<SampleAssemblyName>(
    SAMPLE_ASSEMBLY_NAMES[0]!,
  );

  // ── current inference run ──────────────────────────────────────────────
  const [run, setRun] = useState<InferenceRun | null>(null);

  // ── accepted / rejected (per-run, in-memory) ───────────────────────────
  // We track both so an accepted mate can't be rejected later (and vice
  // versa) and rejected mates disappear from the suggestion table.
  const [accepted, setAccepted] = useState<Mate[]>([]);
  const [rejectedIds, setRejectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  // Changing the sample resets the run + decisions so the user doesn't
  // accidentally export mates from a stale sample.
  const handleSampleChange = useCallback((next: string) => {
    if ((SAMPLE_ASSEMBLY_NAMES as ReadonlyArray<string>).includes(next)) {
      setSample(next as SampleAssemblyName);
      setRun(null);
      setAccepted([]);
      setRejectedIds(new Set());
    }
  }, []);

  // ── run the inference pass ─────────────────────────────────────────────
  const handleRunInference = useCallback(() => {
    const preset = getSampleAssembly(sample);
    const { partFaces, partAxes } = derivePartGeometryForAssembly(
      preset.state.parts,
      preset.featureTrees,
    );
    const suggestions = inferMatesFromPlacements(
      preset.state,
      partFaces,
      partAxes,
    );
    const confidence: Record<string, number> = {};
    const reasons: Record<string, string> = {};
    for (const m of suggestions) {
      confidence[m.id] = generateMockConfidence(m.id);
      reasons[m.id] = reasonTemplate(m.kind, m.id);
    }
    const partNames: Record<string, string> = {};
    for (const p of preset.state.parts) {
      partNames[p.id] = p.name;
    }
    setRun({ sample, suggestions, confidence, reasons, partNames });
    // New run wipes prior decisions (they belong to the previous batch).
    setAccepted([]);
    setRejectedIds(new Set());
  }, [sample]);

  // ── accept / reject handlers ───────────────────────────────────────────
  const handleAccept = useCallback(
    (mateId: string) => {
      if (!run) return;
      const mate = run.suggestions.find((m) => m.id === mateId);
      if (!mate) return;
      setAccepted((prev) => {
        if (prev.some((m) => m.id === mateId)) return prev;
        return [...prev, mate];
      });
      // An accepted mate shouldn't sit in the rejected set if it was
      // toggled there earlier — drop it.
      setRejectedIds((prev) => {
        if (!prev.has(mateId)) return prev;
        const next = new Set(prev);
        next.delete(mateId);
        return next;
      });
    },
    [run],
  );

  const handleReject = useCallback(
    (mateId: string) => {
      if (!run) return;
      setRejectedIds((prev) => {
        if (prev.has(mateId)) return prev;
        const next = new Set(prev);
        next.add(mateId);
        return next;
      });
      // Drop from accepted in case the user reversed their decision.
      setAccepted((prev) => prev.filter((m) => m.id !== mateId));
    },
    [run],
  );

  // ── visible suggestions = run.suggestions minus rejected ───────────────
  const visibleSuggestions = useMemo<Mate[]>(() => {
    if (!run) return [];
    return run.suggestions.filter((m) => !rejectedIds.has(m.id));
  }, [run, rejectedIds]);

  // ── part-name lookup ───────────────────────────────────────────────────
  const partNameLookup = useCallback(
    (partId: string): string | undefined => {
      if (!run) return undefined;
      return run.partNames[partId];
    },
    [run],
  );

  // ── JSON export ────────────────────────────────────────────────────────
  const handleExportJson = useCallback(() => {
    if (accepted.length === 0 || !run) return;
    const payload = {
      version: '1.0',
      sample: run.sample,
      exportedAt: new Date().toISOString(),
      acceptedMates: accepted,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    try {
      // Compose a stable filename so repeated exports for the same sample
      // sort sensibly on disk.
      const stamp = new Date()
        .toISOString()
        .replace(/[-:T]/g, '')
        .slice(0, 15); // YYYYMMDDTHHMMSS → YYYYMMDDHHMMSS
      const filename = `mate-inference-${run.sample}-${stamp}.json`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      // Revoke synchronously — the click already opened the download
      // dialog, the browser doesn't need the URL after this tick.
      URL.revokeObjectURL(url);
    }
  }, [accepted, run]);

  const dir = editorLang === 'ar' ? 'rtl' : 'ltr';

  return (
    <main
      data-testid="mate-inference-review-page"
      dir={dir}
      style={{
        minHeight: '100vh',
        padding: 24,
        background: '#0f0f10',
        color: '#eee',
        fontFamily: 'system-ui, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h1
          data-testid="mate-inference-review-page-title"
          style={{ fontSize: 18, margin: 0 }}
        >
          {t.title}
        </h1>
        <p
          style={{
            fontSize: 12,
            color: '#aaa',
            marginTop: 4,
            marginBottom: 0,
            maxWidth: 720,
          }}
        >
          {t.subtitle}
        </p>
      </header>

      {/* Controls: sample picker + run button */}
      <section
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          padding: '10px 12px',
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: 6,
          marginBottom: 12,
        }}
      >
        <label
          htmlFor="mate-inference-review-sample-select"
          style={{ fontSize: 12 }}
        >
          {t.samplePickerLabel}
        </label>
        <select
          id="mate-inference-review-sample-select"
          data-testid="mate-inference-review-sample-select"
          value={sample}
          onChange={(e) => handleSampleChange(e.target.value)}
          style={{
            background: '#1a1a1a',
            color: '#eee',
            border: '1px solid #333',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 12,
          }}
        >
          {SAMPLE_ASSEMBLY_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <button
          type="button"
          data-testid="mate-inference-review-run-btn"
          onClick={handleRunInference}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            background: '#2563eb22',
            color: '#60a5fa',
            border: '1px solid #2563eb55',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {t.runInferenceBtn}
        </button>

        {run !== null && (
          <span
            data-testid="mate-inference-review-run-count"
            style={{ fontSize: 11, color: '#aaa' }}
          >
            {t.ranInferenceCount(run.suggestions.length)}
          </span>
        )}
      </section>

      {/* Suggestions table (only after a run) */}
      {run === null ? (
        <div
          data-testid="mate-inference-review-no-run"
          style={{
            padding: 16,
            background: '#1a1a1a',
            border: '1px dashed #333',
            borderRadius: 6,
            fontSize: 12,
            color: '#888',
            textAlign: 'center',
            marginBottom: 12,
          }}
        >
          {t.noInferenceYet}
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <MateInferenceReviewPanel
            lang={editorLang}
            suggestions={visibleSuggestions}
            confidence={run.confidence}
            reasons={run.reasons}
            onAccept={handleAccept}
            onReject={handleReject}
            partNameById={partNameLookup}
          />
        </div>
      )}

      {/* Accepted list */}
      <section
        data-testid="mate-inference-review-accepted-section"
        style={{
          padding: 12,
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <h2
            data-testid="mate-inference-review-accepted-header"
            style={{ fontSize: 13, fontWeight: 700, margin: 0 }}
          >
            {t.acceptedHeader} ({accepted.length})
          </h2>
          <button
            type="button"
            data-testid="mate-inference-review-export-json"
            onClick={handleExportJson}
            disabled={accepted.length === 0}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background:
                accepted.length === 0 ? '#33333355' : '#16a34a22',
              color: accepted.length === 0 ? '#666' : '#22c55e',
              border:
                accepted.length === 0
                  ? '1px solid #33333355'
                  : '1px solid #16a34a55',
              borderRadius: 4,
              cursor: accepted.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {t.exportJsonBtn}
          </button>
        </div>
        {accepted.length === 0 ? (
          <div
            data-testid="mate-inference-review-accepted-empty"
            style={{
              padding: 12,
              border: '1px dashed #333',
              borderRadius: 4,
              fontSize: 11,
              color: '#888',
              textAlign: 'center',
            }}
          >
            {t.acceptedEmpty}
          </div>
        ) : (
          <ul
            data-testid="mate-inference-review-accepted-list"
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {accepted.map((m) => (
              <li
                key={m.id}
                data-testid={`mate-inference-review-accepted-item-${m.id}`}
                style={{
                  padding: '4px 8px',
                  background: '#0f0f10',
                  border: '1px solid #333',
                  borderRadius: 3,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: '#ccc',
                }}
              >
                {m.kind} · {m.a.partId}/{m.a.refId} ↔ {m.b.partId}/{m.b.refId}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default MateInferenceReviewPageContent;
