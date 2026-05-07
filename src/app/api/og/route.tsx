import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

const PAGE_LABELS: Record<string, Record<string, string>> = {
  home: { kr: 'AI 3D 모델링 & 제조 파트너 매칭', en: 'AI 3D Modeling & Manufacturing Matching', ja: 'AI 3Dモデリング & 製造マッチング', cn: 'AI 3D建模 & 制造匹配', es: 'Modelado 3D IA & Manufactura', ar: 'نمذجة ثلاثية الأبعاد والتصنيع' },
  'shape-generator': { kr: '3D Shape Generator', en: '3D Shape Generator', ja: '3D Shape Generator', cn: '3D Shape Generator', es: '3D Shape Generator', ar: '3D Shape Generator' },
  'quick-quote': { kr: 'AI 빠른 견적', en: 'AI Quick Quote', ja: 'AIクイック見積もり', cn: 'AI快速报价', es: 'Cotización Rápida con IA', ar: 'عرض أسعار AI سريع' },
  nexyfab: { kr: 'NexyFab CAD 워크벤치', en: 'NexyFab CAD Workbench', ja: 'NexyFab CADワークベンチ', cn: 'NexyFab CAD工作台', es: 'NexyFab CAD Workbench', ar: 'NexyFab CAD' },
  pricing: { kr: '요금제', en: 'Pricing Plans', ja: '料金プラン', cn: '价格方案', es: 'Planes de Precios', ar: 'خطط الأسعار' },
  'how-it-works': { kr: '매칭 프로세스', en: 'How It Works', ja: 'マッチングプロセス', cn: '匹配流程', es: 'Cómo Funciona', ar: 'كيف يعمل' },
  simulator: { kr: '제조 시뮬레이터', en: 'Manufacturing Simulator', ja: '製造シミュレーター', cn: '制造模拟器', es: 'Simulador de Manufactura', ar: 'محاكي التصنيع' },
  'partner-register': { kr: '파트너 등록', en: 'Partner Register', ja: 'パートナー登録', cn: '合作伙伴注册', es: 'Registro de Socios', ar: 'تسجيل الشركاء' },
  'project-inquiry': { kr: '프로젝트 문의', en: 'Project Inquiry', ja: 'プロジェクトお問い合わせ', cn: '项目咨询', es: 'Consulta de Proyecto', ar: 'استفسار المشروع' },
};

const SUBTITLES: Record<string, Record<string, string>> = {
  home: { kr: '브라우저에서 3D 모델링부터 AI 견적까지. 30만+ 공장 DB', en: 'From 3D modeling to AI quoting — all in your browser. 300K+ factories', ja: 'ブラウザで3DモデリングからAI見積もりまで。30万以上の工場', cn: '浏览器3D建模到AI报价。30万+工厂数据库', es: 'Modelado 3D a cotización IA en tu navegador. 300K+ fábricas', ar: 'من النمذجة إلى التسعير في متصفحك. 300 ألف+ مصنع' },
  'shape-generator': { kr: '16종 파라메트릭 3D 형상 · DFM 분석 · AI 견적', en: '16 parametric shapes · DFM analysis · AI cost estimation', ja: '16種パラメトリック形状 · DFM分析 · AI見積もり', cn: '16种参数化形状 · DFM分析 · AI成本估算', es: '16 formas paramétricas · Análisis DFM · Estimación IA', ar: '16 شكل · تحليل DFM · تقدير التكلفة' },
  'quick-quote': { kr: 'STEP 파일 업로드 → AI 즉시 제조 원가 예측', en: 'Upload STEP file → AI instant manufacturing cost prediction', ja: 'STEPファイル → AI即時製造原価予測', cn: '上传STEP文件 → AI即时制造成本预测', es: 'Sube STEP → predicción instantánea IA', ar: 'ارفع ملف STEP → تنبؤ تكلفة فوري' },
  nexyfab: { kr: '3D 설계 · FEA 해석 · DFM 분석 · 제조사 매칭', en: '3D design · FEA · DFM analysis · manufacturer matching', ja: '3D設計 · FEA · DFM分析 · 製造マッチング', cn: '3D设计 · FEA · DFM分析 · 制造商匹配', es: 'Diseño 3D · FEA · DFM · socios de manufactura', ar: 'تصميم 3D · FEA · DFM · مطابقة المصنّعين' },
  pricing: { kr: 'Free · Pro · Enterprise 요금제 비교', en: 'Free · Pro · Enterprise plan comparison', ja: 'Free · Pro · Enterprise プラン比較', cn: 'Free · Pro · Enterprise 方案比较', es: 'Comparación Free · Pro · Enterprise', ar: 'مقارنة Free · Pro · Enterprise' },
  'how-it-works': { kr: 'DB 검색 → AI 분석 → 검증된 파트너', en: 'DB Search → AI Analysis → Verified Partner', ja: 'DB検索 → AI分析 → 検証済みパートナー', cn: 'DB搜索 → AI分析 → 验证合作伙伴', es: 'Búsqueda DB → Análisis IA → Socio Verificado', ar: 'بحث DB → تحليل AI → شريك موثق' },
  simulator: { kr: '한국·중국 제조 원가 · 관세 · 물류 시뮬레이션', en: 'Korea & China manufacturing cost · tariff · logistics simulation', ja: '韓国・中国製造原価 · 関税 · 物流シミュレーション', cn: '韩中制造成本 · 关税 · 物流模拟', es: 'Simulación costos Corea/China · aranceles · logística', ar: 'محاكاة تكاليف كوريا والصين' },
  'partner-register': { kr: '글로벌 프로젝트 매칭 기회 확보', en: 'Get matched with global projects', ja: 'グローバルプロジェクトマッチング', cn: '获得全球项目匹配机会', es: 'Proyectos globales a tu alcance', ar: 'فرص مشاريع عالمية' },
  'project-inquiry': { kr: 'AI가 최적의 제조 파트너를 매칭해드립니다', en: 'AI matches you with the optimal manufacturer', ja: 'AIが最適な製造パートナーをマッチング', cn: 'AI为您匹配最优制造合作伙伴', es: 'IA conecta con el fabricante ideal', ar: 'يطابقك AI مع المصنّع الأمثل' },
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = searchParams.get('page') || 'home';
  const lang = searchParams.get('lang') || 'en';

  const title = PAGE_LABELS[page]?.[lang] || PAGE_LABELS[page]?.['en'] || 'Nexyfab';
  const subtitle = SUBTITLES[page]?.[lang] || SUBTITLES[page]?.['en'] || '';
  const isRtl = lang === 'ar';

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          background: '#0d1117',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background gradient blobs */}
        <div style={{
          position: 'absolute', top: '-80px', left: '-80px',
          width: '400px', height: '400px',
          background: 'radial-gradient(circle, rgba(11,92,255,0.25) 0%, transparent 70%)',
          display: 'flex',
        }} />
        <div style={{
          position: 'absolute', bottom: '-100px', right: '-60px',
          width: '500px', height: '500px',
          background: 'radial-gradient(circle, rgba(139,156,244,0.15) 0%, transparent 70%)',
          display: 'flex',
        }} />

        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '40px 60px 0',
          justifyContent: isRtl ? 'flex-end' : 'flex-start',
        }}>
          {/* Logo mark */}
          <div style={{
            width: '48px', height: '48px', borderRadius: '12px',
            background: 'linear-gradient(135deg, #0b5cff 0%, #8b9cf4 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '26px', fontWeight: 900, color: '#fff', fontFamily: 'system-ui',
            marginRight: isRtl ? '0' : '16px',
            marginLeft: isRtl ? '16px' : '0',
          }}>
            N
          </div>
          <span style={{
            fontSize: '28px', fontWeight: 700, color: '#e6edf3',
            fontFamily: 'system-ui',
          }}>
            nexyfab
          </span>
        </div>

        {/* Main content */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          justifyContent: 'center', padding: '0 60px',
          textAlign: isRtl ? 'right' : 'left',
        }}>
          <div style={{
            fontSize: '15px', fontWeight: 600,
            color: '#0b5cff', marginBottom: '20px',
            fontFamily: 'system-ui', letterSpacing: '2px',
            textTransform: 'uppercase',
            display: 'flex',
            justifyContent: isRtl ? 'flex-end' : 'flex-start',
          }}>
            nexyfab.com
          </div>
          <div style={{
            fontSize: title.length > 30 ? '44px' : '58px',
            fontWeight: 800,
            color: '#e6edf3',
            fontFamily: 'system-ui',
            lineHeight: 1.1,
            marginBottom: '24px',
            maxWidth: '900px',
            display: 'flex',
            flexWrap: 'wrap',
          }}>
            {title}
          </div>
          {subtitle && (
            <div style={{
              fontSize: '22px', color: '#8b949e',
              fontFamily: 'system-ui', lineHeight: 1.5,
              maxWidth: '800px',
              display: 'flex',
              flexWrap: 'wrap',
            }}>
              {subtitle}
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: isRtl ? 'flex-end' : 'space-between',
          padding: '0 60px 40px',
        }}>
          <div style={{
            display: 'flex', gap: '8px', flexWrap: 'wrap',
          }}>
            {['AI 3D CAD', 'DFM Analysis', 'Manufacturing Match'].map((tag) => (
              <div key={tag} style={{
                padding: '6px 14px', borderRadius: '20px',
                background: 'rgba(11,92,255,0.15)',
                border: '1px solid rgba(11,92,255,0.3)',
                fontSize: '13px', color: '#7baeff',
                fontFamily: 'system-ui', fontWeight: 500,
                display: 'flex',
              }}>
                {tag}
              </div>
            ))}
          </div>
          <div style={{
            fontSize: '14px', color: '#484f58', fontFamily: 'system-ui',
            display: 'flex',
          }}>
            300,000+ manufacturers
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
