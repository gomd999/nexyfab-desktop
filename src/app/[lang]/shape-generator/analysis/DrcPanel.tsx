'use client';

// G7 — DRC panel UI for F7 rule engine.
//
// Lets the user load a .drc.json rule set, run it against the current
// geometry, and see violations grouped by severity. Adding/editing rules
// inline is a stretch goal — for the MVP we focus on import / export of
// rule files (organisations check their standard into git) and run-on-click.

import React, { useState } from 'react';
import * as THREE from 'three';
import {
  runDrc, ruleSetFromJson, ruleSetToJson,
  type DrcReport, type DrcRuleSet, type DrcViolation,
} from './drcEngine';

interface DrcPanelProps {
  open: boolean;
  geometry: THREE.BufferGeometry | null;
  ruleSet: DrcRuleSet | null;
  onRuleSetChange: (set: DrcRuleSet | null) => void;
  lang: 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
  onClose: () => void;
}

const dict = {
  ko: { title: 'DRC (설계 규칙 검사)', importBtn: '룰셋 불러오기', exportBtn: '룰셋 저장', runBtn: '검사 실행', noRuleSet: '룰셋이 없습니다. 회사 표준 .drc.json 파일을 불러오세요.', noGeometry: '지오메트리가 없습니다.', passing: '통과', failing: '실패', violations: '위반', total: '총 규칙', error: '에러', warning: '경고', info: '정보' },
  en: { title: 'DRC (Design Rule Check)', importBtn: 'Import Rule Set', exportBtn: 'Export Rule Set', runBtn: 'Run Check', noRuleSet: 'No rule set loaded. Import your organisation\'s .drc.json file.', noGeometry: 'No geometry to check.', passing: 'Passing', failing: 'Failing', violations: 'Violations', total: 'Rules', error: 'Error', warning: 'Warning', info: 'Info' },
  ja: { title: 'DRC (設計規則チェック)', importBtn: 'ルールセット読込', exportBtn: 'ルールセット保存', runBtn: '実行', noRuleSet: 'ルールセットがありません', noGeometry: 'ジオメトリなし', passing: '合格', failing: '不合格', violations: '違反', total: 'ルール', error: 'エラー', warning: '警告', info: '情報' },
  zh: { title: 'DRC (设计规则检查)', importBtn: '导入规则', exportBtn: '导出规则', runBtn: '运行检查', noRuleSet: '未加载规则集', noGeometry: '无几何体', passing: '通过', failing: '失败', violations: '违规', total: '规则', error: '错误', warning: '警告', info: '信息' },
  es: { title: 'DRC (Verificación de Reglas)', importBtn: 'Importar Reglas', exportBtn: 'Exportar Reglas', runBtn: 'Ejecutar', noRuleSet: 'Sin reglas cargadas', noGeometry: 'Sin geometría', passing: 'Aprobado', failing: 'Reprobado', violations: 'Violaciones', total: 'Reglas', error: 'Error', warning: 'Advertencia', info: 'Info' },
  ar: { title: 'DRC (فحص قواعد التصميم)', importBtn: 'استيراد القواعد', exportBtn: 'تصدير', runBtn: 'تشغيل', noRuleSet: 'لا توجد قواعد محملة', noGeometry: 'لا توجد هندسة', passing: 'ناجح', failing: 'فاشل', violations: 'انتهاكات', total: 'القواعد', error: 'خطأ', warning: 'تحذير', info: 'معلومات' },
};

const SEVERITY_COLORS = {
  error: '#f85149',
  warning: '#d29922',
  info: '#58a6ff',
};

const C = {
  bg: '#161b22',
  border: '#30363d',
  text: '#c9d1d9',
  muted: '#8b949e',
  accent: '#58a6ff',
  green: '#3fb950',
  red: '#f85149',
};

export default function DrcPanel({
  open, geometry, ruleSet, onRuleSetChange, lang, onClose,
}: DrcPanelProps) {
  const t = dict[lang] ?? dict.en;
  const [report, setReport] = useState<DrcReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  if (!open) return null;

  const handleImport = (file: File) => {
    setLoadError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const set = ruleSetFromJson(String(reader.result ?? ''));
        onRuleSetChange(set);
        setReport(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
  };

  const handleExport = () => {
    if (!ruleSet) return;
    const blob = new Blob([ruleSetToJson(ruleSet)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ruleSet.name || 'drc-ruleset'}.drc.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRun = () => {
    if (!geometry || !ruleSet) return;
    const r = runDrc(geometry, ruleSet);
    setReport(r);
  };

  return (
    <div style={{
      position: 'fixed', right: 16, top: 64, width: 'min(520px, calc(100vw - 32px))',
      maxHeight: '80vh', background: C.bg, border: `1px solid ${C.border}`,
      borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 200,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>✅ {t.title}</span>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', color: C.muted,
          fontSize: 16, cursor: 'pointer',
        }}>×</button>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <label style={{
            flex: 1, padding: '6px 10px', borderRadius: 4, border: `1px solid ${C.accent}`,
            background: C.accent + '22', color: C.accent, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', textAlign: 'center',
          }}>
            {t.importBtn}
            <input
              type="file"
              accept=".json,.drc"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); }}
            />
          </label>
          <button
            onClick={handleExport}
            disabled={!ruleSet}
            style={{
              flex: 1, padding: '6px 10px', borderRadius: 4,
              border: `1px solid ${C.border}`, background: 'transparent',
              color: ruleSet ? C.text : C.muted,
              fontSize: 11, fontWeight: 600,
              cursor: ruleSet ? 'pointer' : 'not-allowed',
            }}
          >{t.exportBtn}</button>
          <button
            onClick={handleRun}
            disabled={!geometry || !ruleSet}
            style={{
              flex: 1, padding: '6px 10px', borderRadius: 4, border: 'none',
              background: (geometry && ruleSet) ? C.green : '#374151',
              color: '#fff', fontSize: 11, fontWeight: 700,
              cursor: (geometry && ruleSet) ? 'pointer' : 'not-allowed',
            }}
          >{t.runBtn}</button>
        </div>

        {loadError && (
          <div style={{ fontSize: 11, color: C.red, padding: 8, background: 'rgba(248,81,73,0.08)', borderRadius: 4 }}>
            {loadError}
          </div>
        )}
        {!ruleSet && <div style={{ fontSize: 11, color: C.muted, padding: 8 }}>{t.noRuleSet}</div>}
        {ruleSet && !geometry && <div style={{ fontSize: 11, color: C.muted, padding: 8 }}>{t.noGeometry}</div>}

        {ruleSet && (
          <div style={{ fontSize: 12, color: C.muted, padding: '6px 0' }}>
            <strong style={{ color: C.text }}>{ruleSet.name}</strong> — {ruleSet.rules.length} {t.total}
          </div>
        )}

        {report && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 10px', borderRadius: 4,
              background: report.passing ? 'rgba(63,185,80,0.12)' : 'rgba(248,81,73,0.12)',
              color: report.passing ? C.green : C.red,
              fontSize: 12, fontWeight: 700,
            }}>
              <span>{report.passing ? `✓ ${t.passing}` : `✗ ${t.failing}`}</span>
              <span>{report.violations.length} {t.violations} / {report.totalRules} {t.total}</span>
            </div>
            {report.violations.map((v: DrcViolation, i) => (
              <div
                key={`${v.ruleId}-${i}`}
                style={{
                  padding: '6px 10px', borderRadius: 4,
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${SEVERITY_COLORS[v.severity]}55`,
                  borderLeftWidth: 3,
                  borderLeftColor: SEVERITY_COLORS[v.severity],
                  fontSize: 11,
                }}
              >
                <div style={{ color: SEVERITY_COLORS[v.severity], fontWeight: 700, marginBottom: 2 }}>
                  [{t[v.severity]}] {v.ruleLabel}
                </div>
                <div style={{ color: C.muted }}>{v.detail}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
