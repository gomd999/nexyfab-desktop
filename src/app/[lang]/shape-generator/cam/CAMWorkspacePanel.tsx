'use client';

import React, { useState } from 'react';
import { useLang } from '../hooks/useLang';
import { loc } from '@/lib/i18n/loc';

/**
 * CAM (Computer-Aided Manufacturing) Workspace
 * 
 * Future commercial milestone: Allow users to generate 2.5D/3-Axis CNC toolpaths 
 * directly in the browser and simulate the milling process.
 */
export default function CAMWorkspacePanel({ onClose }: { onClose?: () => void }) {
  const lang = useLang();
  const [activeTool, setActiveTool] = useState<'face' | 'pocket' | 'contour' | 'drill'>('face');
  const [generating, setGenerating] = useState(false);

  const handleGenerateGCode = () => {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      alert(loc(lang, { ko: 'G-Code 생성 완료(시뮬레이션 모드)', en: 'G-Code generated successfully (simulation mode)', ja: 'G-Code の生成が完了しました（シミュレーションモード）', zh: 'G-Code 生成成功（仿真模式）', es: 'G-Code generado correctamente (modo de simulación)', ar: 'تم إنشاء G-Code بنجاح (وضع المحاكاة)' }));
    }, 2000);
  };

  return (
    <div style={{
      // right: 340 clears the 320px right property pane (2026-06-12)
      position: 'absolute', top: 60, right: 340, width: 340,
      background: 'var(--nx-panel)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
      border: '1px solid #d0d7de', zIndex: 150, display: 'flex', flexDirection: 'column'
    }}>
      <div style={{ padding: '16px', borderBottom: '1px solid #d0d7de', background: 'var(--nx-panel-2)', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--nx-text)' }}>{loc(lang, { ko: 'CAM 작업공간(베타)', en: 'CAM Workspace (Beta)', ja: 'CAM ワークスペース（ベータ）', zh: 'CAM 工作区（测试版）', es: 'Espacio de trabajo CAM (beta)', ar: 'مساحة عمل CAM (تجريبية)' })}</h3>
        {onClose && <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}>×</button>}
      </div>

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: '#57606a' }}>
          {loc(lang, { ko: '현재 솔리드 바디의 CNC 공구 경로를 생성할 가공 전략을 선택하세요.', en: 'Select a machining strategy to generate CNC toolpaths for the current solid body.', ja: '現在のソリッドボディ用 CNC ツールパスを生成する加工方法を選択してください。', zh: '选择加工策略，为当前实体生成 CNC 刀具路径。', es: 'Seleccione una estrategia de mecanizado para generar trayectorias CNC para el sólido actual.', ar: 'اختر استراتيجية تشغيل لإنشاء مسارات أدوات CNC للجسم الصلب الحالي.' })}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(['face', 'pocket', 'contour', 'drill'] as const).map(tool => (
            <button
              key={tool}
              onClick={() => setActiveTool(tool)}
              style={{
                flex: '1 1 45%', padding: '8px', borderRadius: 6,
                border: activeTool === tool ? '2px solid #0969da' : '1px solid #d0d7de',
                background: activeTool === tool ? '#ddf4ff' : 'var(--nx-text)',
                color: activeTool === tool ? '#0969da' : 'var(--nx-text)',
                fontWeight: 600, fontSize: 12, cursor: 'pointer'
              }}
            >
              {loc(lang, { ko: { face: '평면', pocket: '포켓', contour: '윤곽', drill: '드릴' }[tool], en: { face: 'Face milling', pocket: 'Pocket milling', contour: 'Contour milling', drill: 'Drilling' }[tool], ja: { face: '正面フライス', pocket: 'ポケット加工', contour: '輪郭加工', drill: '穴あけ' }[tool], zh: { face: '端面铣削', pocket: '型腔铣削', contour: '轮廓铣削', drill: '钻孔' }[tool], es: { face: 'Fresado frontal', pocket: 'Fresado de cavidad', contour: 'Fresado de contorno', drill: 'Taladrado' }[tool], ar: { face: 'تفريز سطحي', pocket: 'تفريز جيب', contour: 'تفريز محيطي', drill: 'ثقب' }[tool] })}
            </button>
          ))}
        </div>

        <div style={{ background: 'var(--nx-panel-2)', padding: 12, borderRadius: 6, marginTop: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--nx-text)' }}>{loc(lang, { ko: '공구 설정', en: 'Tool Configuration', ja: '工具設定', zh: '刀具配置', es: 'Configuración de herramienta', ar: 'إعداد الأداة' })}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
            <span>{loc(lang, { ko: '엔드밀 지름', en: 'End mill diameter', ja: 'エンドミル径', zh: '立铣刀直径', es: 'Diámetro de la fresa', ar: 'قطر قاطع التفريز' })}:</span> <span>6.0 mm</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
            <span>{loc(lang, { ko: '스핀들 속도', en: 'Spindle speed', ja: '主軸回転数', zh: '主轴转速', es: 'Velocidad del husillo', ar: 'سرعة المغزل' })}:</span> <span>8000 RPM</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span>{loc(lang, { ko: '이송 속도', en: 'Feed rate', ja: '送り速度', zh: '进给速度', es: 'Velocidad de avance', ar: 'معدل التغذية' })}:</span> <span>1200 mm/min</span>
          </div>
        </div>

        <button
          onClick={handleGenerateGCode}
          disabled={generating}
          style={{
            marginTop: 8, padding: '12px', background: '#2da44e', color: 'white',
            border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 13,
            cursor: generating ? 'default' : 'pointer', opacity: generating ? 0.7 : 1
          }}
        >
          {generating ? loc(lang, { ko: '공구 경로 계산 중…', en: 'Calculating toolpaths…', ja: 'ツールパスを計算中…', zh: '正在计算刀具路径…', es: 'Calculando trayectorias…', ar: 'جارٍ حساب مسارات الأدوات…' }) : loc(lang, { ko: 'G-Code 생성', en: 'Generate G-Code', ja: 'G-Code を生成', zh: '生成 G-Code', es: 'Generar G-Code', ar: 'إنشاء G-Code' })}
        </button>
      </div>
    </div>
  );
}
