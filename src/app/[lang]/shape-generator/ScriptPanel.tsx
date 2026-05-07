'use client';

import React, { useState, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useSceneStore } from './store/sceneStore';
import { SHAPES } from './shapes';
import { MATERIAL_PRESETS } from './materials';
import { useFeatureStack } from './useFeatureStack';
import type { FeatureType } from './features/types';

interface ScriptPanelProps {
  visible: boolean;
  onClose: () => void;
  lang: string;
}

interface LogEntry {
  type: 'info' | 'error' | 'success';
  msg: string;
}

const dict = {
  ko: {
    title: 'NexyScript 코드 편집기',
    loadExample: '예제 불러오기',
    basicShape: '기본 형상',
    parametric: '파라미터 계산',
    featuresOpt: '피처 추가',
    noOutput: '// 출력 없음',
    footerHint: 'Ctrl+Enter 실행 · Tab 들여쓰기',
    clear: '초기화',
    run: '실행',
    unknownShape: (id: string) => `알 수 없는 형상 ID: "${id}"`,
    unknownMaterial: (id: string) => `알 수 없는 재료 ID: "${id}"`,
    unsupportedFeature: (type: string) => `지원하지 않는 피처: "${type}"`,
    shapeApplied: (id: string) => `shape("${id}") 적용됨`,
    materialApplied: (id: string) => `재료 "${id}" 적용됨`,
    featureAdded: (type: string) => `피처 "${type}" 추가됨`,
    execError: (m: string) => `실행 오류: ${m}`,
  },
  en: {
    title: 'NexyScript Editor',
    loadExample: 'Load example',
    basicShape: 'Basic shape',
    parametric: 'Parametric',
    featuresOpt: 'Features',
    noOutput: '// No output',
    footerHint: 'Ctrl+Enter to run · Tab indents',
    clear: 'Clear',
    run: 'Run',
    unknownShape: (id: string) => `Unknown shape ID: "${id}"`,
    unknownMaterial: (id: string) => `Unknown material ID: "${id}"`,
    unsupportedFeature: (type: string) => `Unsupported feature: "${type}"`,
    shapeApplied: (id: string) => `shape("${id}") applied`,
    materialApplied: (id: string) => `Material "${id}" applied`,
    featureAdded: (type: string) => `Feature "${type}" added`,
    execError: (m: string) => `Execution error: ${m}`,
  },
  ja: {
    title: 'NexyScript エディタ',
    loadExample: 'サンプルを読み込む',
    basicShape: '基本形状',
    parametric: 'パラメトリック',
    featuresOpt: 'フィーチャ追加',
    noOutput: '// 出力なし',
    footerHint: 'Ctrl+Enter で実行 · Tab でインデント',
    clear: 'クリア',
    run: '実行',
    unknownShape: (id: string) => `不明な形状ID: "${id}"`,
    unknownMaterial: (id: string) => `不明な材料ID: "${id}"`,
    unsupportedFeature: (type: string) => `サポートされないフィーチャ: "${type}"`,
    shapeApplied: (id: string) => `shape("${id}") 適用済み`,
    materialApplied: (id: string) => `材料 "${id}" 適用済み`,
    featureAdded: (type: string) => `フィーチャ "${type}" を追加`,
    execError: (m: string) => `実行エラー: ${m}`,
  },
  zh: {
    title: 'NexyScript 代码编辑器',
    loadExample: '加载示例',
    basicShape: '基本形状',
    parametric: '参数化',
    featuresOpt: '添加特征',
    noOutput: '// 无输出',
    footerHint: 'Ctrl+Enter 运行 · Tab 缩进',
    clear: '清除',
    run: '运行',
    unknownShape: (id: string) => `未知形状ID: "${id}"`,
    unknownMaterial: (id: string) => `未知材料ID: "${id}"`,
    unsupportedFeature: (type: string) => `不支持的特征: "${type}"`,
    shapeApplied: (id: string) => `shape("${id}") 已应用`,
    materialApplied: (id: string) => `材料 "${id}" 已应用`,
    featureAdded: (type: string) => `特征 "${type}" 已添加`,
    execError: (m: string) => `执行错误: ${m}`,
  },
  es: {
    title: 'Editor NexyScript',
    loadExample: 'Cargar ejemplo',
    basicShape: 'Forma básica',
    parametric: 'Paramétrico',
    featuresOpt: 'Características',
    noOutput: '// Sin salida',
    footerHint: 'Ctrl+Enter para ejecutar · Tab para sangría',
    clear: 'Limpiar',
    run: 'Ejecutar',
    unknownShape: (id: string) => `ID de forma desconocido: "${id}"`,
    unknownMaterial: (id: string) => `ID de material desconocido: "${id}"`,
    unsupportedFeature: (type: string) => `Característica no soportada: "${type}"`,
    shapeApplied: (id: string) => `shape("${id}") aplicada`,
    materialApplied: (id: string) => `Material "${id}" aplicado`,
    featureAdded: (type: string) => `Característica "${type}" añadida`,
    execError: (m: string) => `Error de ejecución: ${m}`,
  },
  ar: {
    title: 'محرر NexyScript',
    loadExample: 'تحميل مثال',
    basicShape: 'شكل أساسي',
    parametric: 'بارامتري',
    featuresOpt: 'الميزات',
    noOutput: '// لا يوجد إخراج',
    footerHint: 'Ctrl+Enter للتشغيل · Tab للمسافة',
    clear: 'مسح',
    run: 'تشغيل',
    unknownShape: (id: string) => `معرّف شكل غير معروف: "${id}"`,
    unknownMaterial: (id: string) => `معرّف مادة غير معروف: "${id}"`,
    unsupportedFeature: (type: string) => `ميزة غير مدعومة: "${type}"`,
    shapeApplied: (id: string) => `تم تطبيق shape("${id}")`,
    materialApplied: (id: string) => `تم تطبيق المادة "${id}"`,
    featureAdded: (type: string) => `تمت إضافة الميزة "${type}"`,
    execError: (m: string) => `خطأ في التنفيذ: ${m}`,
  },
};

const EXAMPLE_SCRIPTS: Record<string, string> = {
  basic: `// 기본 형상 생성 예시
shape('box', { width: 100, height: 80, depth: 50 });
setMaterial('steel');
log('박스 형상 생성 완료');`,

  parametric: `// 파라미터 반복 예시 — 치수를 계산하여 적용
const r = 30;
const h = r * 3;
shape('cylinder', { radius: r, height: h });
setMaterial('aluminum');
log('원기둥: r=' + r + ', h=' + h);`,

  features: `// 피처 추가 예시
shape('box', { width: 120, height: 60, depth: 40 });
addFeature('fillet', { radius: 5 });
addFeature('shell', { thickness: 3 });
setMaterial('abs_white');
log('필렛 + 쉘 피처 적용 완료');`,
};

const HELP_TEXT = `// ── NexyScript API ──────────────────────────────────────
// shape(id, params)  형상 선택 + 파라미터 적용
//   ids: 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'pipe'
//
// addFeature(type, params)  피처 스택에 추가
//   types: 'fillet' | 'chamfer' | 'shell' | 'draft' | 'pattern'
//
// setMaterial(id)  재료 적용
//   ids: 'steel' | 'aluminum' | 'titanium' | 'copper' | 'abs_white' ...
//
// log(msg)  콘솔 출력`;

function buildExecutor(
  setSelectedId: (id: string) => void,
  setParams: (p: Record<string, number>) => void,
  setMaterialId: (id: string) => void,
  addFeatureFn: (type: FeatureType, params: Record<string, number>) => void,
  logFn: (entry: LogEntry) => void,
  t: typeof dict.en,
) {
  return function execute(code: string) {
    const api = {
      shape(id: string, params: Record<string, number> = {}) {
        const found = SHAPES.find(s => s.id === id);
        if (!found) {
          logFn({ type: 'error', msg: t.unknownShape(id) });
          return;
        }
        setSelectedId(id);
        if (Object.keys(params).length > 0) setParams(params);
        logFn({ type: 'info', msg: t.shapeApplied(id) });
      },
      setMaterial(id: string) {
        const found = MATERIAL_PRESETS.find(m => m.id === id);
        if (!found) {
          logFn({ type: 'error', msg: t.unknownMaterial(id) });
          return;
        }
        setMaterialId(id);
        logFn({ type: 'info', msg: t.materialApplied(id) });
      },
      addFeature(type: string, params: Record<string, number> = {}) {
        const validTypes: FeatureType[] = ['fillet', 'chamfer', 'shell', 'draft', 'linearPattern', 'circularPattern', 'mirror', 'boolean'];
        if (!validTypes.includes(type as FeatureType)) {
          logFn({ type: 'error', msg: t.unsupportedFeature(type) });
          return;
        }
        addFeatureFn(type as FeatureType, params);
        logFn({ type: 'info', msg: t.featureAdded(type) });
      },
      log(msg: unknown) {
        logFn({ type: 'success', msg: String(msg) });
      },
    };

    try {
       
      const fn = new Function(
        'shape', 'setMaterial', 'addFeature', 'log',
        code,
      );
      fn(api.shape, api.setMaterial, api.addFeature, api.log);
    } catch (err: any) {
      // Runtime error messages are shown verbatim (not translated)
      logFn({ type: 'error', msg: t.execError(err?.message ?? String(err)) });
    }
  };
}

export default function ScriptPanel({ visible, onClose, lang }: ScriptPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const resolvedKey = langMap[seg] ?? langMap[lang] ?? 'en';
  const t = dict[resolvedKey];

  const [code, setCode] = useState(EXAMPLE_SCRIPTS.basic);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setSelectedId = useSceneStore(s => s.setSelectedId);
  const setParams = useSceneStore(s => s.setParams);
  const setMaterialId = useSceneStore(s => s.setMaterialId);
  const { addFeature } = useFeatureStack();

  const appendLog = useCallback((entry: LogEntry) => {
    setLogs(prev => [...prev.slice(-99), entry]);
  }, []);

  const handleRun = useCallback(() => {
    setLogs([]);
    const executor = buildExecutor(setSelectedId, setParams, setMaterialId, addFeature, appendLog, t);
    executor(code);
  }, [code, setSelectedId, setParams, setMaterialId, addFeature, appendLog, t]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
    // Tab → 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newCode = code.slice(0, start) + '  ' + code.slice(end);
      setCode(newCode);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
  };

  if (!visible) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        background: '#0d1117', border: '1px solid #30363d', borderRadius: 12,
        width: 600, maxWidth: '95vw', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid #21262d',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 11, fontWeight: 800, fontStyle: 'italic',
              color: '#a78bfa', background: '#6366f122',
              borderRadius: 4, padding: '2px 6px', letterSpacing: 0.5,
            }}>
              NS
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#c9d1d9' }}>
              {t.title}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Example presets */}
            <select
              onChange={(e) => { if (e.target.value) setCode(EXAMPLE_SCRIPTS[e.target.value]); e.target.value = ''; }}
              defaultValue=""
              style={{
                background: '#21262d', border: '1px solid #30363d', borderRadius: 5,
                color: '#8b949e', fontSize: 11, padding: '3px 6px', cursor: 'pointer',
              }}
            >
              <option value="" disabled>{t.loadExample}</option>
              <option value="basic">{t.basicShape}</option>
              <option value="parametric">{t.parametric}</option>
              <option value="features">{t.featuresOpt}</option>
            </select>
            <button
              onClick={() => setShowHelp(v => !v)}
              style={{
                padding: '3px 8px', borderRadius: 5, border: `1px solid ${showHelp ? '#388bfd' : '#30363d'}`,
                background: showHelp ? '#388bfd1a' : 'transparent',
                color: showHelp ? '#58a6ff' : '#8b949e', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >
              API
            </button>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 6px', borderRadius: 4 }}
              onMouseEnter={e => { e.currentTarget.style.color = '#c9d1d9'; e.currentTarget.style.background = '#21262d'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.background = 'none'; }}
            >
              &times;
            </button>
          </div>
        </div>

        {/* API help block */}
        {showHelp && (
          <pre style={{
            margin: 0, padding: '10px 16px',
            fontSize: 11, color: '#484f58', background: '#010409',
            borderBottom: '1px solid #21262d', fontFamily: 'ui-monospace, monospace',
            whiteSpace: 'pre-wrap', lineHeight: 1.6,
          }}>
            {HELP_TEXT}
          </pre>
        )}

        {/* Code editor */}
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {/* Line numbers overlay */}
          <textarea
            ref={textareaRef}
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            style={{
              width: '100%', height: '100%', minHeight: 220,
              padding: '12px 16px 12px 48px',
              background: '#010409', border: 'none', outline: 'none',
              color: '#c9d1d9', fontSize: 12.5, fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
              lineHeight: 1.65, resize: 'none',
              boxSizing: 'border-box',
            }}
          />
          {/* Gutter */}
          <div style={{
            position: 'absolute', top: 0, left: 0, width: 40,
            padding: '12px 0', pointerEvents: 'none',
            fontFamily: 'ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.65,
            color: '#30363d', textAlign: 'right',
          }}>
            {code.split('\n').map((_, i) => (
              <div key={i} style={{ paddingRight: 8 }}>{i + 1}</div>
            ))}
          </div>
        </div>

        {/* Console output */}
        <div style={{
          borderTop: '1px solid #21262d',
          background: '#010409',
          maxHeight: 120, overflowY: 'auto',
          padding: logs.length === 0 ? '6px 16px' : '6px 0',
        }}>
          {logs.length === 0 ? (
            <span style={{ fontSize: 11, color: '#30363d', fontFamily: 'monospace' }}>
              {t.noOutput}
            </span>
          ) : logs.map((entry, i) => (
            <div
              key={i}
              style={{
                padding: '2px 16px', fontSize: 11.5,
                fontFamily: 'ui-monospace, monospace',
                color: entry.type === 'error' ? '#f85149' : entry.type === 'success' ? '#3fb950' : '#8b949e',
                background: entry.type === 'error' ? '#f851490a' : 'transparent',
              }}
            >
              {entry.type === 'error' ? '✗ ' : entry.type === 'success' ? '▶ ' : '  '}{entry.msg}
            </div>
          ))}
        </div>

        {/* Footer / Run button */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', borderTop: '1px solid #21262d',
          background: '#0d1117',
        }}>
          <span style={{ fontSize: 10, color: '#484f58' }}>
            {t.footerHint}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { setCode(''); setLogs([]); }}
              style={{
                padding: '5px 14px', borderRadius: 6, border: '1px solid #30363d',
                background: 'transparent', color: '#8b949e', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {t.clear}
            </button>
            <button
              onClick={handleRun}
              style={{
                padding: '5px 18px', borderRadius: 6, border: '1px solid #238636',
                background: '#238636', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 0 0 0 #238636',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2ea043'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#238636'; }}
            >
              ▶ {t.run}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
