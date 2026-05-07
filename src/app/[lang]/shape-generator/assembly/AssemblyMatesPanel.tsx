'use client';

/**
 * 뷰포트 어셈블리 UI 전용: `matesSolver.solveAssembly` (`AssemblyState` / `Mate`).
 * 스냅샷·다운로드에 쓰이는 메시 솔버는 `applyGeometryMatesToPlaced` → `AssemblyMates.solveMates`
 * (`AssemblyMate` + 면 인덱스) — 두 경로는 의도적으로 분리됨(M3_ASSEMBLY.md §1 P1).
 */
import React, { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import {
  solveAssembly,
  calculateDOF,
  type AssemblyState,
  type Mate,
  type MateType,
} from './matesSolver';

// ─── i18n labels ──────────────────────────────────────────────────────────────

const MATE_ICONS: Record<MateType, string> = {
  coincident:    '\u2295', // ⊕
  concentric:    '\u25CE', // ◎
  parallel:      '\u2AF6', // ⫶
  perpendicular: '\u22BE', // ⊾
  distance:      '\u2194', // ↔
  angle:         '\u2220', // ∠
  tangent:       '\u2312', // ⌒
  hinge:         '\u21BA', // ↺
  slider:        '\u21C4', // ⇄
  gear:          '\u2699', // ⚙
  fixed:         '\uD83D\uDD12', // 🔒
};

// Industry-standard constraint names — keep English for Coincident/Concentric/Parallel/Perpendicular
const MATE_LABELS: Record<string, Record<MateType, string>> = {
  en: {
    coincident: 'Coincident', concentric: 'Concentric', parallel: 'Parallel', perpendicular: 'Perpendicular',
    distance: 'Distance', angle: 'Angle', tangent: 'Tangent', hinge: 'Hinge', slider: 'Slider', gear: 'Gear', fixed: 'Fixed',
  },
  ko: {
    coincident: 'Coincident', concentric: 'Concentric', parallel: 'Parallel', perpendicular: 'Perpendicular',
    distance: 'Distance', angle: 'Angle', tangent: 'Tangent', hinge: '힌지', slider: '슬라이더', gear: '기어', fixed: '고정',
  },
  ja: {
    coincident: 'Coincident', concentric: 'Concentric', parallel: 'Parallel', perpendicular: 'Perpendicular',
    distance: 'Distance', angle: 'Angle', tangent: 'Tangent', hinge: 'ヒンジ', slider: 'スライダー', gear: 'ギア', fixed: '固定',
  },
  zh: {
    coincident: 'Coincident', concentric: 'Concentric', parallel: 'Parallel', perpendicular: 'Perpendicular',
    distance: 'Distance', angle: 'Angle', tangent: 'Tangent', hinge: '铰链', slider: '滑块', gear: '齿轮', fixed: '固定',
  },
  es: {
    coincident: 'Coincident', concentric: 'Concentric', parallel: 'Parallel', perpendicular: 'Perpendicular',
    distance: 'Distance', angle: 'Angle', tangent: 'Tangent', hinge: 'Bisagra', slider: 'Deslizador', gear: 'Engranaje', fixed: 'Fijo',
  },
  ar: {
    coincident: 'Coincident', concentric: 'Concentric', parallel: 'Parallel', perpendicular: 'Perpendicular',
    distance: 'Distance', angle: 'Angle', tangent: 'Tangent', hinge: 'مفصلة', slider: 'منزلق', gear: 'ترس', fixed: 'ثابت',
  },
};

const dict = {
  ko: {
    assemblyMates: '어셈블리 구속', parts: '파트', part: '파트',
    noMates: '구속 없음 — 뷰포트에서 면을 선택하세요',
    off: '끄기', on: '켜기',
    solving: '계산 중...', solve: '구속 계산',
    status: '상태', converged: '수렴 ✓', notConverged: '수렴 실패 ⚠',
    iterations: '반복 횟수', remainingDOF: '잔여 자유도',
    unsatisfied: '구속 미충족', conflicting: '충돌 구속',
    dofPreSolve: '자유도(사전·해석)',
    solveTryNext:
      '시도: 충돌·미충족 메이트를 끄거나 삭제, 기준 바디 고정(Fixed), 거리·각도 목표 완화.',
    mateIdsLabel: '메이트 ID',
    idsMore: '외 {{n}}개',
  },
  en: {
    assemblyMates: 'Assembly Mates', parts: 'Parts', part: 'Part',
    noMates: 'No mates — select faces in viewport',
    off: 'Off', on: 'On',
    solving: 'Solving...', solve: 'Solve Mates',
    status: 'Status', converged: 'Converged ✓', notConverged: 'Not Converged ⚠',
    iterations: 'Iterations', remainingDOF: 'Remaining DOF',
    unsatisfied: 'unsatisfied mate(s)', conflicting: 'conflicting mate(s)',
    dofPreSolve: 'DOF (pre-solve)',
    solveTryNext:
      'Try: disable or remove conflicting/unsatisfied mates, fix a reference body, or relax distance/angle targets.',
    mateIdsLabel: 'Mate IDs',
    idsMore: '+{{n}} more',
  },
  ja: {
    assemblyMates: 'アセンブリ拘束', parts: 'パーツ', part: 'パーツ',
    noMates: '拘束なし — ビューポートで面を選択してください',
    off: 'オフ', on: 'オン',
    solving: '計算中...', solve: '拘束を解く',
    status: 'ステータス', converged: '収束 ✓', notConverged: '収束失敗 ⚠',
    iterations: '反復回数', remainingDOF: '残存自由度',
    unsatisfied: '未充足の拘束', conflicting: '競合する拘束',
    dofPreSolve: '自由度（事前・解析）',
    solveTryNext:
      '試す: 競合・未充足の拘束をオフ/削除、基準ボディを固定、距離・角度を緩める。',
    mateIdsLabel: 'メイトID',
    idsMore: 'ほか{{n}}件',
  },
  zh: {
    assemblyMates: '装配约束', parts: '零件', part: '零件',
    noMates: '无约束 — 在视图中选择面',
    off: '关', on: '开',
    solving: '求解中...', solve: '求解约束',
    status: '状态', converged: '收敛 ✓', notConverged: '未收敛 ⚠',
    iterations: '迭代次数', remainingDOF: '剩余自由度',
    unsatisfied: '未满足约束', conflicting: '冲突约束',
    dofPreSolve: '自由度（预解）',
    solveTryNext:
      '可尝试：关闭或删除冲突/未满足约束、固定参考零件、放宽距离/角度目标。',
    mateIdsLabel: '配合 ID',
    idsMore: '另外 {{n}} 个',
  },
  es: {
    assemblyMates: 'Restricciones de Ensamblaje', parts: 'Piezas', part: 'Pieza',
    noMates: 'Sin restricciones — seleccione caras en el viewport',
    off: 'Off', on: 'On',
    solving: 'Resolviendo...', solve: 'Resolver Mates',
    status: 'Estado', converged: 'Convergido ✓', notConverged: 'No Convergido ⚠',
    iterations: 'Iteraciones', remainingDOF: 'DOF Restante',
    unsatisfied: 'restricción(es) insatisfecha(s)', conflicting: 'restricción(es) en conflicto',
    dofPreSolve: 'DOF (pre-solución)',
    solveTryNext:
      'Prueba: desactivar o borrar mates en conflicto, fijar una pieza de referencia o relajar distancia/ángulo.',
    mateIdsLabel: 'IDs de mates',
    idsMore: '+{{n}} más',
  },
  ar: {
    assemblyMates: 'قيود التجميع', parts: 'الأجزاء', part: 'جزء',
    noMates: 'لا توجد قيود — حدد وجوهًا في العرض',
    off: 'إيقاف', on: 'تشغيل',
    solving: 'جار الحل...', solve: 'حل القيود',
    status: 'الحالة', converged: 'تقارب ✓', notConverged: 'لم يتقارب ⚠',
    iterations: 'التكرارات', remainingDOF: 'DOF المتبقية',
    unsatisfied: 'قيد (قيود) غير مستوفاة', conflicting: 'قيد (قيود) متعارضة',
    dofPreSolve: 'درجة الحرية (تقديرية)',
    solveTryNext:
      'جرّب: تعطيل أو حذف القيود المتعارضة، تثبيت مرجع، أو تخفيف مسافة/زاوية.',
    mateIdsLabel: 'معرّفات القيود',
    idsMore: '+{{n}} أخرى',
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Theme {
  panelBg: string;
  border: string;
  text: string;
  textMuted: string;
  cardBg: string;
  accent: string;
  accentBright: string;
}

interface Props {
  theme: Theme;
  lang: string;
  assemblyState: AssemblyState;
  onAssemblyUpdate: (state: AssemblyState) => void;
}

type SolveResult = ReturnType<typeof solveAssembly>;

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssemblyMatesPanel({
  theme,
  lang,
  assemblyState,
  onAssemblyUpdate,
}: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const resolvedLang = langMap[seg] ?? langMap[lang] ?? 'en';
  const tt = dict[resolvedLang];
  const labels = MATE_LABELS[resolvedLang] ?? MATE_LABELS.en;

  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  const [solving, setSolving] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSolve = useCallback(async () => {
    setSolving(true);
    // Yield to allow the UI to repaint with "Solving..." before the
    // synchronous solver blocks the thread.
    await new Promise<void>(resolve => setTimeout(resolve, 10));

    const result = solveAssembly(assemblyState);
    setSolveResult(result);

    // Push updated positions/rotations back to the parent
    const updated: AssemblyState = {
      ...assemblyState,
      bodies: assemblyState.bodies.map((b, i) => ({
        ...b,
        position: result.bodies[i].position,
        rotation: result.bodies[i].rotation,
      })),
      // Mark conflicting mates so the list can highlight them
      mates: assemblyState.mates.map(m => ({
        ...m,
        conflict: result.conflicts.includes(m.id),
      })),
    };
    onAssemblyUpdate(updated);
    setSolving(false);
  }, [assemblyState, onAssemblyUpdate]);

  const toggleMate = useCallback((id: string) => {
    onAssemblyUpdate({
      ...assemblyState,
      mates: assemblyState.mates.map(m =>
        m.id === id ? { ...m, enabled: !m.enabled } : m,
      ),
    });
  }, [assemblyState, onAssemblyUpdate]);

  const deleteMate = useCallback((id: string) => {
    onAssemblyUpdate({
      ...assemblyState,
      mates: assemblyState.mates.filter(m => m.id !== id),
    });
  }, [assemblyState, onAssemblyUpdate]);

  // ── Derived values ────────────────────────────────────────────────────────

  const dof = calculateDOF(assemblyState);

  const dofColor =
    dof === 0 ? '#3fb950' :   // fully constrained — green
    dof >  0 ? '#e3b341' :    // under-constrained — yellow
               '#f85149';     // over-constrained  — red (dof < 0 shouldn't happen; shown as 0)

  const dofBg =
    dof === 0 ? '#16a34a22' :
    dof >  0 ? '#d2992222' :
               '#f8514922';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>
            {tt.assemblyMates}
          </div>
          <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 3, lineHeight: 1.35 }}>
            {tt.dofPreSolve}
          </div>
        </div>
        <div style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 10,
          background: dofBg,
          color: dofColor,
          fontWeight: 700,
          flexShrink: 0,
        }}>
          DOF: {dof}
        </div>
      </div>

      {/* Parts list */}
      {assemblyState.bodies.length > 0 && (
        <div style={{ background: theme.cardBg, borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 10, color: theme.textMuted, marginBottom: 4 }}>
            {tt.parts} ({assemblyState.bodies.length})
          </div>
          {assemblyState.bodies.map((body, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
              <span style={{ fontSize: 11, color: body.fixed ? '#e3b341' : theme.text }}>
                {body.fixed ? '\uD83D\uDD12' : '\u25CB'} {body.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Mates list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {assemblyState.mates.length === 0 ? (
          <div style={{
            fontSize: 11,
            color: theme.textMuted,
            textAlign: 'center',
            padding: 12,
            border: `1px dashed ${theme.border}`,
            borderRadius: 6,
          }}>
            {tt.noMates}
          </div>
        ) : (
          assemblyState.mates.map(mate => {
            const isUnsatisfied = solveResult?.unsatisfied.includes(mate.id);
            const isConflict = mate.conflict || solveResult?.conflicts.includes(mate.id);
            const borderColor = isConflict
              ? '#f85149'
              : isUnsatisfied
                ? '#e3b341'
                : theme.border;

            return (
              <div
                key={mate.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  background: theme.cardBg,
                  borderRadius: 6,
                  border: `1px solid ${borderColor}`,
                  opacity: mate.enabled ? 1 : 0.45,
                  transition: 'opacity 0.15s, border-color 0.15s',
                }}
              >
                <span style={{ fontSize: 14, flexShrink: 0 }}>{MATE_ICONS[mate.type]}</span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: theme.text }}>
                    {labels[mate.type]}
                    {mate.distance !== undefined && ` (${mate.distance}\u202Fmm)`}
                    {mate.angle    !== undefined && ` (${mate.angle}\u00B0)`}
                  </div>
                  <div style={{ fontSize: 10, color: theme.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tt.part}&nbsp;{mate.selections[0].bodyIndex + 1}
                    &nbsp;\u2194&nbsp;
                    {tt.part}&nbsp;{mate.selections[1].bodyIndex + 1}
                  </div>
                </div>

                {isConflict && (
                  <span style={{ fontSize: 10, color: '#f85149', flexShrink: 0 }} title="Conflict">
                    &#x26A0;
                  </span>
                )}

                <button
                  onClick={() => toggleMate(mate.id)}
                  style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${theme.border}`,
                    background: 'transparent',
                    color: theme.textMuted,
                    fontSize: 10,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {mate.enabled ? tt.off : tt.on}
                </button>

                <button
                  onClick={() => deleteMate(mate.id)}
                  style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: 'none',
                    background: '#f8514922',
                    color: '#f85149',
                    fontSize: 10,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  &#x2715;
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Solve button */}
      <button
        onClick={handleSolve}
        disabled={solving || assemblyState.mates.length === 0}
        style={{
          padding: '8px 14px',
          borderRadius: 6,
          border: 'none',
          background: theme.accent,
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          cursor: assemblyState.mates.length === 0 ? 'not-allowed' : 'pointer',
          opacity: assemblyState.mates.length === 0 ? 0.4 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        {solving ? tt.solving : tt.solve}
      </button>

      {/* Solve result card */}
      {solveResult && (
        <div style={{
          background: theme.cardBg,
          borderRadius: 6,
          padding: 10,
          fontSize: 11,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          {/* Status */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: theme.textMuted }}>
              {tt.status}
            </span>
            <span style={{
              color: solveResult.converged ? '#3fb950' : '#e3b341',
              fontWeight: 700,
            }}>
              {solveResult.converged ? tt.converged : tt.notConverged}
            </span>
          </div>

          {/* Iterations */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: theme.textMuted }}>
              {tt.iterations}
            </span>
            <span style={{ color: theme.text }}>{solveResult.iterations}</span>
          </div>

          {/* Remaining DOF */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: theme.textMuted }}>
              {tt.remainingDOF}
            </span>
            <span style={{ color: theme.text }}>{solveResult.remainingDOF}</span>
          </div>

          {/* Unsatisfied warning */}
          {solveResult.unsatisfied.length > 0 && (
            <div style={{ marginTop: 4, color: '#e3b341', fontSize: 10 }}>
              &#x26A0;&nbsp;{solveResult.unsatisfied.length}&nbsp;
              {tt.unsatisfied}
            </div>
          )}

          {/* Conflict warning */}
          {solveResult.conflicts.length > 0 && (
            <div style={{ color: '#f85149', fontSize: 10 }}>
              &#x2715;&nbsp;{solveResult.conflicts.length}&nbsp;
              {tt.conflicting}
            </div>
          )}

          {!solveResult.converged && (
            <div style={{ marginTop: 6, color: theme.textMuted, fontSize: 10, lineHeight: 1.45 }}>
              {tt.solveTryNext}
            </div>
          )}

          {(solveResult.unsatisfied.length > 0 || solveResult.conflicts.length > 0) && (() => {
            const seen = new Set<string>();
            const orderedIds: string[] = [];
            for (const id of solveResult.conflicts) {
              if (!seen.has(id)) { seen.add(id); orderedIds.push(id); }
            }
            for (const id of solveResult.unsatisfied) {
              if (!seen.has(id)) { seen.add(id); orderedIds.push(id); }
            }
            const displayIds = orderedIds.slice(0, 8);
            const rest = orderedIds.length - displayIds.length;
            return (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 9, color: theme.textMuted, marginBottom: 4 }}>{tt.mateIdsLabel}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {displayIds.map(id => {
                    const isConflict = solveResult.conflicts.includes(id);
                    return (
                      <code
                        key={id}
                        style={{
                          fontSize: 9,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: isConflict ? '#f8514922' : '#e3b34122',
                          color: isConflict ? '#f85149' : '#e3b341',
                          border: isConflict ? '1px solid #f8514944' : '1px solid #e3b34144',
                        }}
                      >
                        {id}
                      </code>
                    );
                  })}
                </div>
                {rest > 0 ? (
                  <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 4 }}>
                    {tt.idsMore.replace(/\{\{n\}\}/g, String(rest))}
                  </div>
                ) : null}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
