'use client';

// Autonomy dashboard — Wave A WA-E · GA3 (design-partner 자동화율 실측 시각화).
//
// The read-only face of `src/lib/ai/design-driver/autonomyMetrics.ts`: it takes
// per-run AutonomyEvent logs, MEASURES them with the shared computeRunAutonomy →
// computeBatchAutonomy → buildAutonomyReport pipeline (no re-derivation here —
// this panel owns no statistics), and renders the three GA3 axes:
//
//   - zero-touch rate     (numerator/denominator always shown together)
//   - mean interventions   per run
//   - median review time   (over reviewed runs only)
//
//   + sample size, an explicit low-sample warning (n < MIN_SAMPLE_SIZE), and a
//     per-run list. Event sequences the measurer REFUSES (bad ordering, unpaired
//     review sessions, …) are surfaced as "measurement refused" rows with the
//     reason — never silently dropped, never counted toward the rate.
//
// Honesty invariants (랜딩 mock/허위 금지):
//   - No live event store is wired here. The panel is props-injected so it can
//     be tested in isolation and the store binding is a follow-up. It renders
//     ONLY what the injected logs measure.
//   - Empty logs ⇒ an explicit "no measurement yet" empty state. It NEVER
//     fabricates a 0% / n=0 headline — a measured-nothing state and a
//     measured-zero state are different and are shown differently.

import { useMemo } from 'react';
import { useLang } from '../hooks/useLang';
import { loc } from '../lib/loc';
import {
  computeRunAutonomy,
  computeBatchAutonomy,
  buildAutonomyReport,
  type AutonomyEvent,
  type RunAutonomy,
  type RunAutonomyResult,
} from '@/lib/ai/design-driver/autonomyMetrics';

export interface AutonomyDashboardPanelProps {
  /**
   * Per-run event sequences — each inner array is ONE design-partner run's
   * AutonomyEvent log (run_started … approved/abandoned). The panel measures
   * them itself; callers pass raw events, not pre-computed stats, so the
   * displayed numbers are always the measurer's own output.
   */
  runEventLogs: readonly (readonly AutonomyEvent[])[];
}

/** ms → "12.3 min" for the per-run list (raw ms kept in the summary line). */
function minutes(ms: number): string {
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function AutonomyDashboardPanel({ runEventLogs }: AutonomyDashboardPanelProps) {
  const lang = useLang();

  const { runs, refused, report } = useMemo(() => {
    const measured: RunAutonomyResult[] = runEventLogs.map((log) => computeRunAutonomy(log));
    const okRuns: RunAutonomy[] = [];
    const refusedRows: string[] = [];
    for (const m of measured) {
      if (m.ok) okRuns.push(m.run);
      else refusedRows.push(m.reason);
    }
    return {
      runs: okRuns,
      refused: refusedRows,
      report: buildAutonomyReport(computeBatchAutonomy(okRuns)),
    };
  }, [runEventLogs]);

  // Empty = "no measurement yet". Distinct from a measured n=0 (all refused).
  if (runEventLogs.length === 0) {
    return (
      <div
        data-testid="autonomy-empty"
        style={{ padding: 10, fontSize: 11, color: 'var(--nx-text-3, #8b949e)', lineHeight: 1.5 }}
      >
        {loc(lang, {
          ko: '측정 없음 — 아직 계측된 설계 파트너 런이 없습니다. 자동화율은 실측 이벤트가 쌓인 뒤에만 표시되며, 목표치는 첫 실측 후에 정합니다(측정 없는 목표는 날조).',
          en: 'No measurement yet — no design-partner runs have been recorded. Autonomy numbers appear only once real events accrue; targets are set only after the first measurement (a target without a measurement is fabrication).',
          ja: '測定なし — 記録された設計パートナー実行はまだありません。自動化率は実測イベントが蓄積された後にのみ表示されます。',
          zh: '暂无测量 — 尚无已记录的设计伙伴运行。自动化率仅在积累真实事件后显示。',
          es: 'Sin medición todavía — no se han registrado ejecuciones. Los números de autonomía aparecen solo cuando se acumulan eventos reales.',
          ar: 'لا يوجد قياس بعد — لم تُسجّل أي عمليات تشغيل. تظهر أرقام الاستقلالية فقط بعد تراكم أحداث حقيقية.',
        })}
      </div>
    );
  }

  const batch = report.raw;

  return (
    <div
      data-testid="autonomy-dashboard"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--nx-text, #e6edf3)', overflow: 'auto', height: '100%', padding: 2 }}
    >
      <div style={{ fontWeight: 700, fontSize: 12 }}>
        {loc(lang, {
          ko: '설계 자동화율 (실측)',
          en: 'Design autonomy (measured)',
          ja: '設計自動化率（実測）',
          zh: '设计自动化率（实测）',
          es: 'Autonomía de diseño (medida)',
          ar: 'استقلالية التصميم (مقيسة)',
        })}
      </div>

      {/* Sample line — every number is cited with its sample. */}
      <div data-testid="autonomy-sample" style={{ fontSize: 10, color: batch.lowSample ? 'var(--nx-warn, #ef4444)' : 'var(--nx-text-3, #8b949e)' }}>
        {report.display.sample}
      </div>

      {/* Three GA3 axes — reported side by side, never fused into one score. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Metric
          testId="autonomy-zerotouch"
          label={loc(lang, { ko: 'zero-touch 비율', en: 'zero-touch rate', ja: 'ゼロタッチ率', zh: '零接触率', es: 'tasa zero-touch', ar: 'معدل بدون تدخل' })}
          value={report.display.zeroTouchRate}
          hint={loc(lang, {
            ko: '개입 0회 & 최종 승인 / 전체 런',
            en: '0 interventions & approved / all runs',
            ja: '介入0回かつ承認 / 全実行',
            zh: '零介入且已批准 / 全部运行',
            es: '0 intervenciones y aprobado / todas',
            ar: '0 تدخّل ومعتمد / كل العمليات',
          })}
        />
        <Metric
          testId="autonomy-mean"
          label={loc(lang, { ko: '평균 개입 횟수', en: 'mean interventions', ja: '平均介入回数', zh: '平均介入次数', es: 'intervenciones medias', ar: 'متوسط التدخلات' })}
          value={report.display.meanInterventionCount}
          hint={loc(lang, {
            ko: '수정요청 + 사람 게이트 재시도',
            en: 'change-requests + human gate retries',
            ja: '修正依頼＋人によるゲート再試行',
            zh: '修改请求 + 人工门控重试',
            es: 'peticiones de cambio + reintentos humanos',
            ar: 'طلبات التعديل + إعادة المحاولات البشرية',
          })}
        />
        <Metric
          testId="autonomy-median"
          label={loc(lang, { ko: '중앙값 검토 시간', en: 'median review time', ja: '検討時間の中央値', zh: '审查时间中位数', es: 'tiempo de revisión mediano', ar: 'وسيط وقت المراجعة' })}
          value={report.display.medianReviewDuration}
          hint={loc(lang, {
            ko: '검토가 있었던 런만 대상',
            en: 'over runs that had a review',
            ja: 'レビューがあった実行のみ',
            zh: '仅含有审查的运行',
            es: 'solo ejecuciones con revisión',
            ar: 'العمليات التي بها مراجعة فقط',
          })}
        />
      </div>

      {/* Low-sample warning — numbers reported but flagged, not hidden. */}
      {batch.lowSample && (
        <div
          data-testid="autonomy-lowsample"
          style={{ fontSize: 10, color: 'var(--nx-warn, #ef4444)', border: '1px solid var(--nx-warn, #ef4444)', borderRadius: 4, padding: 6, lineHeight: 1.4 }}
        >
          {loc(lang, {
            ko: `표본 부족(n=${batch.sampleSize}) — 위 수치는 표시하되 통계적으로 신뢰할 수 없습니다. 표본과 함께만 인용하세요.`,
            en: `Low sample (n=${batch.sampleSize}) — the numbers above are shown but are not statistically reliable. Cite them only with the sample.`,
            ja: `標本不足(n=${batch.sampleSize}) — 上記の数値は表示しますが統計的に信頼できません。標本と併記してください。`,
            zh: `样本不足(n=${batch.sampleSize}) — 上述数字仅供显示，统计上不可靠。请与样本一并引用。`,
            es: `Muestra baja (n=${batch.sampleSize}) — los números se muestran pero no son fiables. Cítelos solo con la muestra.`,
            ar: `عينة صغيرة (n=${batch.sampleSize}) — تُعرض الأرقام لكنها غير موثوقة إحصائيًا. اذكرها مع حجم العينة فقط.`,
          })}
        </div>
      )}

      {/* Outcome tally — so approved/abandoned/in-progress is never implied by the rate alone. */}
      <div style={{ fontSize: 10, color: 'var(--nx-text-3, #8b949e)' }}>
        {loc(lang, { ko: '결과', en: 'outcomes', ja: '結果', zh: '结果', es: 'resultados', ar: 'النتائج' })}
        {`: approved=${batch.approvedCount} · abandoned=${batch.abandonedCount} · in_progress=${batch.inProgressCount}`}
      </div>

      {/* Per-run list. */}
      {runs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--nx-text-3, #8b949e)' }}>
            {loc(lang, { ko: '런 목록', en: 'runs', ja: '実行一覧', zh: '运行列表', es: 'ejecuciones', ar: 'العمليات' })}
          </div>
          {runs.map((r) => (
            <div
              key={r.runId}
              data-testid="autonomy-run"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, border: '1px solid var(--nx-border, #30363d)', borderRadius: 4, padding: '3px 6px' }}
            >
              <span
                data-testid="autonomy-run-badge"
                title={r.zeroTouch ? 'zero-touch' : 'touched'}
                style={{
                  fontSize: 9, padding: '0 5px', borderRadius: 8,
                  background: r.zeroTouch ? 'var(--nx-ok-bg, rgba(34,197,94,0.15))' : 'var(--nx-bg-2, #0d1117)',
                  color: r.zeroTouch ? 'var(--nx-ok, #22c55e)' : 'var(--nx-text-3, #8b949e)',
                }}
              >
                {r.zeroTouch ? 'zero-touch' : r.finalStatus}
              </span>
              <span style={{ fontWeight: 600 }}>{r.runId}</span>
              <span style={{ color: 'var(--nx-text-3, #8b949e)' }}>
                {loc(lang, { ko: '개입', en: 'interventions', ja: '介入', zh: '介入', es: 'interv.', ar: 'تدخلات' })} {r.interventionCount}
              </span>
              {r.reviewSessionCount > 0 && (
                <span style={{ color: 'var(--nx-text-3, #8b949e)' }}>· {minutes(r.reviewDurationMs)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Refused sequences — measurement said no; shown with reason, not counted. */}
      {refused.length > 0 && (
        <div data-testid="autonomy-refused" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--nx-warn, #ef4444)' }}>
            {loc(lang, {
              ko: `측정 거부 ${refused.length}건 (자동화율에 포함되지 않음)`,
              en: `${refused.length} refused by the measurer (excluded from the rate)`,
              ja: `測定拒否 ${refused.length}件（率に含まれません）`,
              zh: `测量拒绝 ${refused.length} 项（不计入比率）`,
              es: `${refused.length} rechazadas por el medidor (excluidas de la tasa)`,
              ar: `${refused.length} مرفوضة من القياس (مستبعدة من المعدل)`,
            })}
          </div>
          {refused.map((reason, i) => (
            <div key={i} data-testid="autonomy-refused-row" style={{ fontSize: 9, color: 'var(--nx-warn, #ef4444)', lineHeight: 1.4 }}>
              · {reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ testId, label, value, hint }: { testId: string; label: string; value: string; hint: string }) {
  return (
    <div data-testid={testId} style={{ border: '1px solid var(--nx-border, #30363d)', borderRadius: 4, padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 10, color: 'var(--nx-text-3, #8b949e)' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--nx-text-3, #8b949e)' }}>{hint}</div>
    </div>
  );
}

export default AutonomyDashboardPanel;
