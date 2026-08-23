'use client';

// W7 — Visual template gallery for the SCAD agent.
//
// W2's cheatsheet covers "what *kinds* of things can I ask?"; this
// gallery covers "what's a complete starter project I can launch with
// one click?". Each card is a curated multi-step prompt that produces
// a useful, recognizable artifact, picked to advertise specific agent
// capabilities (assemblies, B-rep, sheet metal, drawings, etc.).
//
// Implementation choice: emoji+text thumbnails. Real 3D thumbnails
// would need pre-rendered images per template — premature without
// usage data telling us which templates win. We can swap to images
// later without changing this component's API.

import React, { useEffect, useState } from 'react';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

interface Template {
  id: string;
  emoji: string;
  /** What the user is making — used as the card's prominent label. */
  title_ko: string; title_en: string;
  /** One-line subtitle clarifying what the agent will do. */
  desc_ko: string; desc_en: string;
  /** Comma-separated capability tags shown as pills on the card. */
  tags: string[];
  /** The prompt that gets auto-sent to the agent on click. */
  prompt_ko: string; prompt_en: string;
}

const TEMPLATES: Template[] = [
  {
    id: 'nema17-mount',
    emoji: '⚙️',
    title_ko: 'NEMA17 모터 마운트', title_en: 'NEMA17 Motor Mount',
    desc_ko: '4개 M3 마운트 홀 + 중심 31mm 보스', desc_en: '4 M3 holes + 31mm center boss',
    tags: ['assembly', 'M3'],
    prompt_ko: 'NEMA17 스테퍼 모터용 L자 마운트 만들어줘. 4×M3 31mm 정사각 패턴 + 중심 22mm 구멍. 두께 5mm.',
    prompt_en: 'L-bracket mount for a NEMA17 stepper. 4×M3 holes in 31mm square pattern + 22mm center hole. 5mm thick.',
  },
  {
    id: 'gear-train',
    emoji: '⚙️',
    title_ko: '평기어 트레인 (1:2)', title_en: 'Spur Gear Train (1:2)',
    desc_ko: '잇수 20+40 모듈 2 + 중심거리 검증', desc_en: 'Teeth 20+40, module 2, mesh check',
    tags: ['gears', 'kinematics'],
    prompt_ko: '평기어 두 개 만들어. 모듈 2, 잇수 20과 40, 두께 6mm. 중심거리 60mm 가나 확인해줘.',
    prompt_en: 'Two spur gears, module 2, teeth 20 and 40, 6mm thick. Verify center distance 60mm meshes correctly.',
  },
  {
    id: 'enclosure',
    emoji: '📦',
    title_ko: '벽 2mm 케이스', title_en: 'Thin-Wall Enclosure',
    desc_ko: '120×80×40 + 4코너 보스 + r=2 fillet', desc_en: '120×80×40 + 4 corner bosses + r=2 fillet',
    tags: ['B-rep', 'shell'],
    prompt_ko: '120×80×40mm 케이스, 벽 두께 2mm, 위 뚫림. 4코너에 M3 보스. 외부 모서리 r=2 fillet.',
    prompt_en: '120×80×40mm enclosure, 2mm walls, open top. M3 bosses in 4 corners. Outer edges r=2 fillet.',
  },
  {
    id: 'sheet-bracket',
    emoji: '📐',
    title_ko: '판금 L 브래킷', title_en: 'Sheet Metal L-Bracket',
    desc_ko: '1.5mm 강판, 90° 한번 접기, 평면 전개', desc_en: '1.5mm steel, single 90° bend, unfold',
    tags: ['sheet metal', 'unfold'],
    prompt_ko: '1.5mm 강판으로 L 브래킷. 50mm 다리, 50mm 베이스, 50mm 폭, 90° 굽힘. 평면 도면도 줘.',
    prompt_en: 'L-bracket from 1.5mm steel. 50mm leg, 50mm base, 50mm wide, 90° bend. Give me the flat pattern.',
  },
  {
    id: 'pipe-tee',
    emoji: '🔧',
    title_ko: 'T자 파이프 조인트', title_en: 'T-Joint Pipe Fitting',
    desc_ko: '외경 30 내경 25, 3-way 결합', desc_en: 'OD 30 ID 25, 3-way junction',
    tags: ['B-rep', 'boolean'],
    prompt_ko: 'T자 파이프 조인트. 외경 30mm 내경 25mm, 본체 길이 100mm, 가지 길이 60mm.',
    prompt_en: 'T-joint pipe fitting. OD 30mm ID 25mm. Main 100mm long, branch 60mm.',
  },
  {
    id: 'threaded-rod',
    emoji: '🔩',
    title_ko: 'M8 진짜 나사봉', title_en: 'M8 Real Threaded Rod',
    desc_ko: '50mm helical, 1.25 pitch (B-rep)', desc_en: '50mm helical, 1.25 pitch (B-rep)',
    tags: ['B-rep', 'helix'],
    prompt_ko: 'M8 나사봉 50mm. 진짜 나선 (helical thread, pitch 1.25). B-rep으로 만들어.',
    prompt_en: 'M8 threaded rod 50mm with real helical threads (pitch 1.25). B-rep please.',
  },
  {
    id: 'drawing-3view',
    emoji: '📊',
    title_ko: '3-뷰 도면 자동', title_en: '3-View Drawing Auto',
    desc_ko: '정면+상면+우측면 + 자동 치수', desc_en: 'Front+top+right + auto dims',
    tags: ['drawing', 'A4'],
    prompt_ko: '40mm 정육면체 위에 지름 20 깊이 10 구멍. 3-뷰 도면 만들고 A4에 자동 치수 넣어줘.',
    prompt_en: '40mm cube with 20mm dia × 10mm hole. Make 3-view drawing on A4 with auto dimensions.',
  },
  {
    id: 'gdt-mount',
    emoji: '⌖',
    title_ko: 'GD&T 위치도 마운트', title_en: 'GD&T Position Mount',
    desc_ko: '4 홀 ⌀0.05 위치도 + 데이텀 ABC', desc_en: '4 holes ⌀0.05 position + datums ABC',
    tags: ['GD&T', 'tolerance'],
    prompt_ko: '60×60 마운트, 4코너 ⌀5mm 홀, 위치도 ⌀0.05 데이텀 A,B,C 적용. 도면 만들어.',
    prompt_en: '60×60 mount, four ⌀5mm corner holes, position ⌀0.05 with datums A,B,C. Make a drawing.',
  },
  {
    id: 'fea-beam',
    emoji: '💪',
    title_ko: 'FEA 외팔보 안전 검토', title_en: 'FEA Cantilever Safety',
    desc_ko: '강철 100×20×5, 100N 끝단 하중', desc_en: 'Steel 100×20×5, 100N tip load',
    tags: ['FEA', 'safety'],
    prompt_ko: '강철 외팔보 100×20×5mm. 한쪽 고정, 반대쪽에 100N 아래로. 최대응력과 안전계수.',
    prompt_en: 'Steel cantilever beam 100×20×5mm. Fix one end, 100N down at the other. Show max stress and safety factor.',
  },
  {
    id: 'toy-car',
    emoji: '🚗',
    title_ko: '간단 토이카', title_en: 'Simple Toy Car',
    desc_ko: '박스 차체 + 4개 휠 + 액슬', desc_en: 'Box body + 4 wheels + axles',
    tags: ['assembly'],
    prompt_ko: '간단한 토이카. 80×40×20 박스 차체, 지름 25 두께 8 휠 4개, 액슬 포함.',
    prompt_en: 'Simple toy car. 80×40×20 box body, 4 wheels of 25mm dia × 8mm thick, with axles.',
  },
  {
    id: 'sketch-extrude',
    emoji: '✏️',
    title_ko: '스케치 → 압출', title_en: 'Sketch → Extrude',
    desc_ko: '제약 풀어진 사각 + 30mm 압출', desc_en: 'Constrained square + 30mm extrude',
    tags: ['sketch', 'B-rep'],
    prompt_ko: '50×50 사각 스케치 만들고 제약 풀어서 30mm 압출.',
    prompt_en: 'Make a 50×50 square sketch with constraints, solve, then extrude 30mm.',
  },
  {
    id: 'lattice',
    emoji: '🔳',
    title_ko: '4×4 그리드 어셈블리', title_en: '4×4 Grid Assembly',
    desc_ko: 'L 브래킷 16개, 50mm 간격', desc_en: '16 L-brackets, 50mm spacing',
    tags: ['assembly', 'pattern'],
    prompt_ko: '4×4 그리드로 L 브래킷 16개 배치, 50mm 간격. 각 브래킷은 30×30×3mm.',
    prompt_en: '4×4 grid pattern of 16 L-brackets, 50mm spacing. Each bracket 30×30×3mm.',
  },
  // T1 — Z series capability templates
  {
    id: 'bearing-housing',
    emoji: '⚙️',
    title_ko: '베어링 하우징 (자동 선택)', title_en: 'Bearing Housing (auto-select)',
    desc_ko: '6204 베어링 하우징 + 키홈 + 리테이닝링', desc_en: '6204 housing + keyway + retainer',
    tags: ['catalog', 'DIN', 'fit'],
    prompt_ko: 'select_bearing으로 부하 1000N 3000rpm에 맞는 베어링 선택해서, 그 OD에 맞는 하우징 만들어. 키홈은 select_key, 리테이닝링은 외부형으로 select_retaining_ring.',
    prompt_en: 'Pick a bearing for 1000N @ 3000rpm via select_bearing. Build a housing for its OD with a keyway (select_key) and external retaining ring groove (select_retaining_ring).',
  },
  {
    id: 'pmi-mbd-mount',
    emoji: '⌖',
    title_ko: 'PMI MBD 마운트 (Y14.41)', title_en: 'PMI MBD Mount (Y14.41)',
    desc_ko: '4 홀 위치도 + 데이텀 타겟 + 표면조도 + AP242 export',
    desc_en: '4 holes ⌀0.05 + datum targets + surface finish + AP242',
    tags: ['PMI', 'GD&T', 'AP242'],
    prompt_ko: '60×60×8 마운트, 4코너 ⌀5mm 홀. add_gdt_frame 위치도 ⌀0.05 데이텀 ABC. add_datum_target A1/A2/A3 (point), B1 (line). 윗면 add_surface_finish Ra 1.6. add_annotated_dimension basic 60. export_pmi_step_ap242로 MBD 패키지.',
    prompt_en: '60×60×8 mount with 4×Ø5 corner holes. add_gdt_frame position Ø0.05 datums A,B,C. Datum targets A1/A2/A3 (point) and B1 (line). Top surface Ra 1.6. add_annotated_dimension basic 60. Then export_pmi_step_ap242 for the MBD package.',
  },
  {
    id: 'parametric-bracket',
    emoji: '🔄',
    title_ko: '파라메트릭 브래킷 (의도 보존)', title_en: 'Parametric Bracket (intent-preserving)',
    desc_ko: 'L 브래킷 + 홀, 두께 변경 시 자동 재구축',
    desc_en: 'L-bracket with hole, thickness changes auto-rebuild',
    tags: ['feature tree', 'parametric'],
    prompt_ko: '50×50×3 L 브래킷 만들고, 코너에서 ⌀5 홀 뚫어. tree_summary로 트리 보여주고, tree_set_param으로 두께를 5로 바꾸면 어떤 노드가 dirty 되는지 확인.',
    prompt_en: 'Make a 50×50×3 L-bracket with a Ø5 corner hole. Show tree_summary, then call tree_set_param to change thickness to 5 — list the dirty nodes.',
  },
  {
    id: 'material-pick',
    emoji: '📚',
    title_ko: '재료 자문 (RAG)', title_en: 'Material Advisory (RAG)',
    desc_ko: '"강철 vs 알루미늄" 자문 + 재료 적용 설계',
    desc_en: '"Steel vs aluminum" advisory + material-driven design',
    tags: ['catalog', 'RAG'],
    prompt_ko: '야외 100°C 환경, 100N 진동 하중에 사용할 마운트. query_engineering_catalog로 재료 자문 받고, 그 재료로 brep_primitive로 마운트 만들어. 안전계수 fea_stress로 확인.',
    prompt_en: 'Outdoor mount at 100°C with 100N vibration. Query the catalog for material advice, then build a mount with that material and check safety with fea_stress.',
  },
  // Σ series simulation templates
  {
    id: 'sim-cfd-airflow',
    emoji: '💨',
    title_ko: 'CFD 공력 평가', title_en: 'CFD Airflow Eval',
    desc_ko: '50mm 부품 주변 공기 흐름 + 항력계수',
    desc_en: 'Airflow over 50mm part + drag coefficient',
    tags: ['CFD', 'Σ-mock'],
    prompt_ko: '50mm 정육면체 만들고 sim_cfd로 공기 10 m/s 흐름 평가 (참조 길이 50mm). 레이놀즈 + 흐름 영역 + Cd 보고.',
    prompt_en: 'Make a 50mm cube. Run sim_cfd with air at 10 m/s, ref length 50mm. Report Reynolds + regime + Cd.',
  },
  {
    id: 'sim-cam-toolpath',
    emoji: '🛠️',
    title_ko: 'CAM 5축 툴패스', title_en: 'CAM 5-axis Toolpath',
    desc_ko: '6mm 엔드밀, 50% 스텝오버, finishing pass',
    desc_en: '6mm endmill, 50% stepover, finishing pass',
    tags: ['CAM', 'Σ-mock'],
    prompt_ko: 'brep_primitive로 100×100×50 stock 만들고, sim_cam으로 6mm 툴 50% 스텝오버 finishing 패스 생성. 가공 시간 + 세그먼트 수.',
    prompt_en: 'Make a 100×100×50 stock with brep_primitive. Run sim_cam with 6mm tool, 50% stepover, finishing op. Show machining time + segments.',
  },
  {
    id: 'sim-mold-fill',
    emoji: '🟦',
    title_ko: '사출 충전 분석', title_en: 'Injection Mold Fill',
    desc_ko: 'PA66 80MPa, 2mm 벽, 충전시간 + 핫스팟',
    desc_en: 'PA66 80MPa, 2mm wall, fill time + hotspots',
    tags: ['mold', 'Σ-mock'],
    prompt_ko: 'sim_mold_fill로 PA66, 80MPa 압력, 2mm 벽두께, 부피 100cm³ 시뮬. 충전시간 + 샷 무게 + 두께 경고.',
    prompt_en: 'sim_mold_fill: PA66, 80 MPa, 2mm wall, volume 100 cm³. Report fill time, shot weight, thickness warnings.',
  },
  {
    id: 'sim-thermal',
    emoji: '🔥',
    title_ko: '열 정상상태 (방열판)', title_en: 'Thermal Steady-State',
    desc_ko: '20W 발열 알루미늄 방열판, 정상 온도',
    desc_en: '20W aluminum heatsink, steady-state temp',
    tags: ['thermal', 'Σ-mock'],
    prompt_ko: 'sim_thermal로 알루미늄 방열판 (k=160 W/mK), 20W 발열, 표면적 200cm², 대류 15 W/m²K, 주위 25°C. 정상 온도 + 열저항.',
    prompt_en: 'sim_thermal: aluminum heatsink (k=160 W/mK), 20W power, 200 cm² surface, h=15 W/m²K, ambient 25°C. Steady temp + thermal resistance.',
  },
];

type TemplateGalleryCopy = { open: string; title: string; close: string; send: string; subtitle: string };
const dict: Record<'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar', TemplateGalleryCopy> = {
  ko: { open: '🎨 템플릿', title: '시작 템플릿', close: '닫기', send: '✦ 시작', subtitle: '클릭하면 즉시 에이전트가 작업을 시작합니다' },
  en: { open: '🎨 Templates', title: 'Starter Templates', close: 'Close', send: '✦ Start', subtitle: 'Click to launch the agent on this template instantly' },
  ja: { open: '🎨 テンプレート', title: 'スターターテンプレート', close: '閉じる', send: '✦ 開始', subtitle: 'クリックしてエージェントをすぐに開始' },
  zh: { open: '🎨 模板', title: '入门模板', close: '关闭', send: '✦ 开始', subtitle: '点击即可使用此模板启动代理' },
  es: { open: '🎨 Plantillas', title: 'Plantillas iniciales', close: 'Cerrar', send: '✦ Iniciar', subtitle: 'Haz clic para iniciar el agente al instante con esta plantilla' },
  ar: { open: '🎨 قوالب', title: 'قوالب البدء', close: 'إغلاق', send: '✦ بدء', subtitle: 'انقر لتشغيل الوكيل فورًا باستخدام هذا القالب' },
};
// Template records remain a stable ko/en data contract. Display strings go
// through the commercial catalog so every route locale receives the matching
// translation when available, with the source pair retained as a safe fallback
// for server-provided or newly added templates.
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export interface TemplateGalleryProps {
  lang: string;
  /** Auto-send the prompt — picks straight to the agent without filling input. */
  onPick: (prompt: string) => void;
}

export default function ScadAgentTemplateGallery({ lang, onPick }: TemplateGalleryProps) {
  const [open, setOpen] = useState(false);
  const langKey = langMap[lang] ?? 'en';
  const t = dict[langKey as keyof typeof dict] ?? dict.en;
  const L = createCommercialLocalizer(langKey);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={openBtnStyle}>{t.open}</button>
    );
  }

  return (
    <div style={overlayStyle} onClick={() => setOpen(false)}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--nx-text)' }}>{t.title}</div>
            <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginTop: 2 }}>{t.subtitle}</div>
          </div>
          <button onClick={() => setOpen(false)} style={closeBtnStyle} aria-label={t.close}>✕</button>
        </div>
        <div style={gridStyle}>
          {TEMPLATES.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => { onPick(L(tpl.prompt_ko, tpl.prompt_en)); setOpen(false); }}
              style={cardStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--nx-accent)';
                e.currentTarget.style.background = '#0d2547';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--nx-border)';
                e.currentTarget.style.background = 'var(--nx-bg)';
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 4 }}>{tpl.emoji}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--nx-text)', marginBottom: 3 }}>
                {L(tpl.title_ko, tpl.title_en)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginBottom: 6, minHeight: 26, lineHeight: 1.3 }}>
                {L(tpl.desc_ko, tpl.desc_en)}
              </div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {tpl.tags.map(tag => (
                  <span key={tag} style={tagPillStyle}>{tag}</span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const openBtnStyle: React.CSSProperties = {
  padding: '4px 10px', fontSize: 10, fontWeight: 700,
  borderRadius: 6, border: '1px solid var(--nx-border)',
  background: 'transparent', color: 'var(--nx-text-2)', cursor: 'pointer',
};
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'var(--nx-glass-input)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
  width: 'min(820px, 92vw)', maxHeight: '85vh',
  background: 'var(--nx-panel)',
  border: '1px solid var(--nx-border)', borderRadius: 10,
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start',
  padding: '14px 18px',
  borderBottom: '1px solid var(--nx-panel-2)',
  justifyContent: 'space-between',
};
const closeBtnStyle: React.CSSProperties = {
  padding: '4px 10px', fontSize: 14,
  borderRadius: 4, border: '1px solid var(--nx-border)',
  background: 'transparent', color: 'var(--nx-text-2)', cursor: 'pointer',
};
const gridStyle: React.CSSProperties = {
  padding: 14,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: 10,
  overflowY: 'auto',
  flex: 1,
};
const cardStyle: React.CSSProperties = {
  padding: 12, textAlign: 'left',
  background: 'var(--nx-bg)',
  border: '1px solid var(--nx-border)',
  borderRadius: 8,
  color: 'var(--nx-text)',
  cursor: 'pointer',
  transition: 'all 0.12s',
  display: 'flex', flexDirection: 'column',
};
const tagPillStyle: React.CSSProperties = {
  padding: '1px 6px',
  fontSize: 9, fontWeight: 600,
  background: '#1f6feb22',
  color: 'var(--nx-accent-2)',
  borderRadius: 8,
  fontFamily: 'monospace',
};
