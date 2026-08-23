'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import type { Model3D } from './Preview3D';
import { useProjectsStore } from '@/hooks/useProjects';
import { useAuthStore } from '@/hooks/useAuth';
import { loc } from '@/lib/i18n/loc';
import { toIsoLang } from '@/lib/i18n/normalize';

type Copy = { ko: string; en: string; ja: string; zh: string; es: string; ar: string };
const COPY: Record<string, Copy> = {
  previewLoading: { ko: '3D 로딩…', en: 'Loading 3D…', ja: '3Dを読み込み中…', zh: '正在加载 3D…', es: 'Cargando 3D…', ar: 'جارٍ تحميل 3D…' },
  exGable: { ko: '박공지붕 집, 가로 50 세로 35', en: 'Gable-roof house, width 50 length 35', ja: '切妻屋根の家、幅50 奥行35', zh: '坡屋顶房屋，宽50 长35', es: 'Casa con tejado a dos aguas, ancho 50 largo 35', ar: 'منزل بسقف جملوني، عرض 50 وطول 35' },
  exShop: { ko: '2층 상가 건물, 가로 40 세로 25', en: 'Two-story shop, width 40 length 25', ja: '2階建て店舗、幅40 奥行25', zh: '两层商业楼，宽40 长25', es: 'Edificio comercial de dos plantas, ancho 40 largo 25', ar: 'مبنى تجاري من طابقين، عرض 40 وطول 25' },
  exRoom: { ko: '실내 방, 가로 60 세로 45 높이 30', en: 'Interior room, width 60 length 45 height 30', ja: '室内の部屋、幅60 奥行45 高さ30', zh: '室内房间，宽60 长45 高30', es: 'Habitación interior, ancho 60 largo 45 alto 30', ar: 'غرفة داخلية، عرض 60 وطول 45 وارتفاع 30' },
  exBox: { ko: '선물 상자, 50 x 50 x 40', en: 'Gift box, 50 x 50 x 40', ja: 'ギフトボックス、50 x 50 x 40', zh: '礼品盒，50 x 50 x 40', es: 'Caja de regalo, 50 x 50 x 40', ar: 'علبة هدايا، 50 × 50 × 40' },
  pastedImage: { ko: '붙여넣은 이미지', en: 'Pasted image', ja: '貼り付けた画像', zh: '粘贴的图像', es: 'Imagen pegada', ar: 'صورة ملصقة' },
  aiMaking: { ko: 'AI가 3D 모양을 만드는 중…', en: 'AI is creating the 3D shape…', ja: 'AIが3D形状を作成中…', zh: 'AI 正在创建 3D 形状…', es: 'La IA está creando la forma 3D…', ar: 'ينشئ الذكاء الاصطناعي الشكل ثلاثي الأبعاد…' },
  limitError: { ko: 'AI 생성 무료 한도를 다 썼어요 — 로그인하면 계속 만들 수 있어요.', en: 'You have used your free AI generation limit — sign in to continue.', ja: 'AI無料生成の上限に達しました。ログインすると続けられます。', zh: '已用完 AI 免费生成额度——登录后即可继续。', es: 'Has agotado el límite gratuito de generación de IA. Inicia sesión para continuar.', ar: 'لقد استنفدت حد إنشاء الذكاء الاصطناعي المجاني — سجّل الدخول للمتابعة.' },
  ai3dFailed: { ko: 'AI 3D 생성에 실패했어요. 다른 설명으로 시도해 보세요.', en: 'AI 3D generation failed. Try a different description.', ja: 'AI 3D生成に失敗しました。別の説明を試してください。', zh: 'AI 3D 生成失败。请尝试其他描述。', es: 'La generación 3D con IA falló. Prueba otra descripción.', ar: 'فشل إنشاء 3D بالذكاء الاصطناعي. جرّب وصفًا مختلفًا.' },
  rendering: { ko: '3D 렌더링 중…', en: 'Rendering 3D…', ja: '3Dをレンダリング中…', zh: '正在渲染 3D…', es: 'Renderizando 3D…', ar: 'جارٍ تصيير 3D…' },
  simplify: { ko: '너무 복잡 — 단순화해서 다시 렌더 중…', en: 'Too complex — simplifying and rendering again…', ja: '複雑すぎます。簡略化して再レンダリング中…', zh: '过于复杂——简化后重新渲染…', es: 'Demasiado complejo. Simplificando y renderizando de nuevo…', ar: 'معقد جدًا — جارٍ التبسيط وإعادة التصيير…' },
  renderFailed: { ko: '3D 렌더에 실패했어요 — 더 단순한 설명/낮은 디테일로 다시 시도해 주세요.', en: '3D rendering failed — try a simpler description or lower detail.', ja: '3Dレンダリングに失敗しました。簡単な説明または低い詳細度で再試行してください。', zh: '3D 渲染失败——请尝试更简单的描述或较低的细节。', es: 'Falló el renderizado 3D. Prueba una descripción más simple o menos detalle.', ar: 'فشل تصيير 3D — جرّب وصفًا أبسط أو تفاصيل أقل.' },
  meshReadFailed: { ko: '생성된 3D를 읽지 못했어요.', en: 'Could not read the generated 3D model.', ja: '生成された3Dを読み込めませんでした。', zh: '无法读取生成的 3D 模型。', es: 'No se pudo leer el modelo 3D generado.', ar: 'تعذر قراءة النموذج ثلاثي الأبعاد المُنشأ.' },
  unfoldProgress: { ko: '전개도(접기)를 펼치는 중…', en: 'Unfolding the net…', ja: '展開図を展開中…', zh: '正在展开纸模图…', es: 'Desplegando la plantilla…', ar: 'جارٍ فرد القالب…' },
  sliceProgress: { ko: '적층 도면으로 자르는 중…', en: 'Slicing into stacked layers…', ja: '積層図にスライス中…', zh: '正在切片为叠层图…', es: 'Cortando en capas apiladas…', ar: 'جارٍ تقطيع النموذج إلى طبقات…' },
  foldFallback: { ko: '접기엔 너무 복잡 — 적층으로 전환 중…', en: 'Too complex to fold — switching to stacked layers…', ja: '折りには複雑すぎるため積層に切り替え中…', zh: '折叠过于复杂——切换为叠层…', es: 'Demasiado complejo para plegar. Cambiando a capas apiladas…', ar: 'معقد جدًا للطي — جارٍ التبديل إلى طبقات…' },
  aiError: { ko: 'AI 생성 중 오류가 발생했어요.', en: 'An error occurred while generating with AI.', ja: 'AI生成中にエラーが発生しました。', zh: 'AI 生成时发生错误。', es: 'Se produjo un error al generar con IA.', ar: 'حدث خطأ أثناء الإنشاء بالذكاء الاصطناعي.' },
  analysing: { ko: '무엇을 만들지 분석 중…', en: 'Analysing what to make…', ja: '作るものを分析中…', zh: '正在分析要创建的内容…', es: 'Analizando qué crear…', ar: 'جارٍ تحليل ما سيتم إنشاؤه…' },
  generationError: { ko: '생성 중 오류가 발생했어요.', en: 'An error occurred during generation.', ja: '生成中にエラーが発生しました。', zh: '生成时发生错误。', es: 'Se produjo un error durante la generación.', ar: 'حدث خطأ أثناء الإنشاء.' },
  generationFailed: { ko: '생성에 실패했어요. 다시 시도해 주세요.', en: 'Generation failed. Please try again.', ja: '生成に失敗しました。もう一度お試しください。', zh: '生成失败。请重试。', es: 'La generación falló. Inténtalo de nuevo.', ar: 'فشل الإنشاء. يرجى المحاولة مرة أخرى.' },
  uploadPhotoError: { ko: '먼저 사진을 올리거나 Ctrl+V로 붙여넣어 주세요.', en: 'Upload a photo first or paste one with Ctrl+V.', ja: 'まず写真をアップロードするか、Ctrl+Vで貼り付けてください。', zh: '请先上传照片或使用 Ctrl+V 粘贴。', es: 'Primero sube una foto o pégala con Ctrl+V.', ar: 'ارفع صورة أولًا أو ألصقها باستخدام Ctrl+V.' },
  photoAnalysing: { ko: '사진 분석 중…', en: 'Analysing photo…', ja: '写真を分析中…', zh: '正在分析照片…', es: 'Analizando la foto…', ar: 'جارٍ تحليل الصورة…' },
  reliefMaking: { ko: '레이어드 부조 만드는 중…', en: 'Creating layered relief…', ja: 'レイヤー状レリーフを作成中…', zh: '正在创建分层浮雕…', es: 'Creando relieve por capas…', ar: 'جارٍ إنشاء نقش متعدد الطبقات…' },
  contrastWeak: { ko: '명암 대비가 약해 층을 못 만들었어요 — 대비가 뚜렷한 사진으로 시도해 주세요.', en: 'The contrast was too weak to create layers — try a photo with clearer contrast.', ja: 'コントラストが弱くレイヤーを作れませんでした。コントラストの明瞭な写真をお試しください。', zh: '对比度太弱，无法创建层——请尝试对比度更明显的照片。', es: 'El contraste era demasiado débil para crear capas. Prueba una foto con más contraste.', ar: 'التباين ضعيف جدًا لإنشاء طبقات — جرّب صورة بتباين أوضح.' },
  reliefFailed: { ko: '부조 생성에 실패했어요. 다른 사진으로 시도해 주세요.', en: 'Relief generation failed. Try another photo.', ja: 'レリーフの生成に失敗しました。別の写真をお試しください。', zh: '浮雕生成失败。请尝试其他照片。', es: 'Falló la generación del relieve. Prueba otra foto.', ar: 'فشل إنشاء النقش. جرّب صورة أخرى.' },
  stlReadFailed: { ko: 'STL을 읽지 못했어요 (삼각형이 없어요).', en: 'Could not read the STL (no triangles found).', ja: 'STLを読み込めませんでした（三角形がありません）。', zh: '无法读取 STL（未找到三角形）。', es: 'No se pudo leer el STL (no se encontraron triángulos).', ar: 'تعذر قراءة STL (لم يتم العثور على مثلثات).' },
  unfoldFailed: { ko: '펼치기에 실패했어요. 다른 모델로 시도해 주세요.', en: 'Unfolding failed. Try another model.', ja: '展開に失敗しました。別のモデルをお試しください。', zh: '展开失败。请尝试其他模型。', es: 'Falló el despliegue. Prueba otro modelo.', ar: 'فشل الفرد. جرّب نموذجًا آخر.' },
  sliceFailed: { ko: '슬라이스에 실패했어요. 다른 모델로 시도해 주세요.', en: 'Slicing failed. Try another model.', ja: 'スライスに失敗しました。別のモデルをお試しください。', zh: '切片失败。请尝试其他模型。', es: 'Falló el corte. Prueba otro modelo.', ar: 'فشل التقطيع. جرّب نموذجًا آخر.' },
  signInRequired: { ko: '저장하려면 로그인이 필요해요 — 우측 상단 Sign In 후 다시 시도하세요.', en: 'Sign in to save — use Sign In at the top right and try again.', ja: '保存するにはログインが必要です。右上のSign Inから再試行してください。', zh: '保存需要登录——请点击右上角 Sign In 后重试。', es: 'Inicia sesión para guardar. Usa Sign In arriba a la derecha e inténtalo de nuevo.', ar: 'يلزم تسجيل الدخول للحفظ — استخدم Sign In أعلى اليمين ثم أعد المحاولة.' },
  projectName: { ko: '종이공예', en: 'Papercraft', ja: 'ペーパークラフト', zh: '纸艺', es: 'Papercraft', ar: 'أعمال ورقية' },
  saveFailed: { ko: '저장에 실패했어요. 다시 시도해 주세요.', en: 'Saving failed. Please try again.', ja: '保存に失敗しました。もう一度お試しください。', zh: '保存失败。请重试。', es: 'No se pudo guardar. Inténtalo de nuevo.', ar: 'فشل الحفظ. يرجى المحاولة مرة أخرى.' },
  loadingProject: { ko: '저장된 작업 불러오는 중…', en: 'Loading saved project…', ja: '保存済みの作業を読み込み中…', zh: '正在加载已保存的项目…', es: 'Cargando el proyecto guardado…', ar: 'جارٍ تحميل المشروع المحفوظ…' },
  title: { ko: '말 또는 사진으로 건물 → 레이저컷 전개도', en: 'Building to laser-cut template from text or photo', ja: '文章や写真から建物をレーザーカット展開図に', zh: '用文字或照片将建筑转换为激光切割展开图', es: 'De texto o foto a plantilla de corte láser', ar: 'من نص أو صورة إلى قالب قطع بالليزر' },
  subtitle: { ko: '글·사진(Ctrl+V 붙여넣기)·STL을 넣고 「✨ 만들기」 — 건물이면 즉시, 자동차·동물·캐릭터 등은 AI가 3D로 (자동 판별). 3D 완성 미리보기 + 2D 도면(칼선·접는선·탭)을 함께 보고 레이저컷 DXF로 내보냅니다.', en: 'Add text, a photo (Ctrl+V), or an STL and choose “✨ Create”. Buildings are instant; cars, animals, and characters are generated in 3D by AI. Preview the 3D result and 2D cut/fold/tab drawing, then export laser-cut DXF.', ja: '文章・写真（Ctrl+V）・STLを入力して「✨ 作成」。建物は即時、それ以外はAIが3D化します。3Dプレビューと2D図面を確認してレーザーカットDXFに書き出せます。', zh: '输入文字、照片（Ctrl+V）或 STL 并选择“✨ 创建”。建筑即时生成，汽车、动物和角色由 AI 生成 3D。预览 3D 和 2D 切割/折线/标签图后导出激光切割 DXF。', es: 'Añade texto, una foto (Ctrl+V) o un STL y pulsa «✨ Crear». Los edificios son instantáneos; la IA genera coches, animales y personajes en 3D. Previsualiza el resultado y exporta el DXF para corte láser.', ar: 'أدخل نصًا أو صورة (Ctrl+V) أو STL واضغط «✨ إنشاء». تُنشأ المباني فورًا، بينما ينشئ الذكاء الاصطناعي السيارات والحيوانات والشخصيات ثلاثية الأبعاد. عاين النتيجة ثم صدّر DXF للقطع بالليزر.' },
  placeholder: { ko: '예: 박공지붕 집 가로 50 세로 35 / 코알라 / 장난감 자동차', en: 'Example: gable house width 50 length 35 / koala / toy car', ja: '例: 切妻屋根の家 幅50 奥行35 / コアラ / おもちゃの車', zh: '示例：坡屋顶房屋 宽50 长35 / 考拉 / 玩具车', es: 'Ejemplo: casa a dos aguas ancho 50 largo 35 / koala / coche de juguete', ar: 'مثال: منزل بسقف جملوني عرض 50 طول 35 / كوالا / سيارة لعبة' },
  createTooltip: { ko: '건물이면 즉시, 그 외(자동차·동물·캐릭터)는 AI가 3D로 — 자동 판별', en: 'Buildings are instant; other objects are generated in 3D by AI — automatic detection', ja: '建物は即時、それ以外はAIが3D化 — 自動判定', zh: '建筑即时生成，其他对象由 AI 生成 3D——自动识别', es: 'Edificios al instante; otros objetos en 3D con IA — detección automática', ar: 'المباني فورًا، والأجسام الأخرى ثلاثية الأبعاد بالذكاء الاصطناعي — اكتشاف تلقائي' },
  making: { ko: '만드는 중…', en: 'Creating…', ja: '作成中…', zh: '创建中…', es: 'Creando…', ar: 'جارٍ الإنشاء…' },
  create: { ko: '✨ 만들기', en: '✨ Create', ja: '✨ 作成', zh: '✨ 创建', es: '✨ Crear', ar: '✨ إنشاء' },
  method: { ko: '제작 방식', en: 'Build method', ja: '作成方式', zh: '制作方式', es: 'Método', ar: 'طريقة الإنشاء' },
  slice: { ko: '🥞 적층(쌓기)', en: '🥞 Stack layers', ja: '🥞 積層', zh: '🥞 叠层', es: '🥞 Capas', ar: '🥞 طبقات' },
  sliceDesc: { ko: '곡면·복잡 모델에 강함', en: 'Best for curved or complex models', ja: '曲面・複雑なモデル向け', zh: '适合曲面和复杂模型', es: 'Ideal para modelos curvos o complejos', ar: 'مناسب للنماذج المنحنية والمعقدة' },
  fold: { ko: '📦 접기(전개)', en: '📦 Fold template', ja: '📦 折り展開', zh: '📦 折叠展开', es: '📦 Plantilla plegable', ar: '📦 قالب قابل للطي' },
  foldDesc: { ko: '단순/저폴리에 적합', en: 'Best for simple or low-poly models', ja: '単純・ローポリ向け', zh: '适合简单或低多边形模型', es: 'Ideal para modelos simples o low-poly', ar: 'مناسب للنماذج البسيطة أو منخفضة التفاصيل' },
  materialThickness: { ko: '재료 두께', en: 'Material thickness', ja: '材料の厚さ', zh: '材料厚度', es: 'Grosor del material', ar: 'سماكة المادة' },
  thinPaper: { ko: '얇은 종이', en: 'Thin paper', ja: '薄紙', zh: '薄纸', es: 'Papel fino', ar: 'ورق رقيق' },
  thickPaper: { ko: '두꺼운 종이', en: 'Thick paper', ja: '厚紙', zh: '厚纸', es: 'Papel grueso', ar: 'ورق سميك' },
  detail: { ko: '⚙️ 상세 설정 (선택)', en: '⚙️ Detailed settings (optional)', ja: '⚙️ 詳細設定（任意）', zh: '⚙️ 详细设置（可选）', es: '⚙️ Ajustes detallados (opcional)', ar: '⚙️ إعدادات تفصيلية (اختياري)' },
  applied: { ko: ' · 적용됨', en: ' · Applied', ja: ' · 適用済み', zh: ' · 已应用', es: ' · Aplicado', ar: ' · مطبق' },
  style: { ko: '스타일', en: 'Style', ja: 'スタイル', zh: '风格', es: 'Estilo', ar: 'النمط' },
  none: { ko: '없음', en: 'None', ja: 'なし', zh: '无', es: 'Ninguno', ar: 'لا شيء' },
  cute: { ko: '귀여운', en: 'Cute', ja: 'かわいい', zh: '可爱', es: 'Tierno', ar: 'لطيف' },
  realistic: { ko: '사실적', en: 'Realistic', ja: 'リアル', zh: '写实', es: 'Realista', ar: 'واقعي' },
  simple: { ko: '단순', en: 'Simple', ja: 'シンプル', zh: '简单', es: 'Simple', ar: 'بسيط' },
  keyFeatures: { ko: '핵심 특징', en: 'Key features', ja: '主な特徴', zh: '主要特征', es: 'Características clave', ar: 'السمات الرئيسية' },
  featuresPlaceholder: { ko: '예: 큰 코, 둥근 귀, 앉은 자세, 통통한 몸', en: 'e.g. large nose, round ears, sitting pose, chubby body', ja: '例：大きな鼻、丸い耳、座った姿勢、丸い体', zh: '例如：大鼻子、圆耳朵、坐姿、圆润身体', es: 'ej. nariz grande, orejas redondas, sentado, cuerpo regordete', ar: 'مثال: أنف كبير، أذنان دائريتان، وضعية جلوس، جسم ممتلئ' },
  detailLevel: { ko: '디테일', en: 'Detail', ja: '詳細度', zh: '细节', es: 'Detalle', ar: 'التفاصيل' },
  high: { ko: '높음', en: 'High', ja: '高い', zh: '高', es: 'Alto', ar: 'عالٍ' },
  detailHint: { ko: '※ 상세 설정을 넣으면 건물도 AI가 더 정교하게(창문·내부 등) 만듭니다.', en: '※ Detailed settings make buildings more refined with AI (windows, interiors, etc.).', ja: '※ 詳細設定を入れると建物もAIがより精密に（窓・内部など）なります。', zh: '※ 添加详细设置后，AI 会更精细地生成建筑（窗户、内部等）。', es: '※ Los ajustes detallados hacen que la IA refine los edificios (ventanas, interiores, etc.).', ar: '※ تجعل الإعدادات التفصيلية المباني أدق بالذكاء الاصطناعي (النوافذ والداخلية وغيرها).' },
  uploadPhoto: { ko: '📷 건물·실내 사진 업로드', en: '📷 Upload building or interior photo', ja: '📷 建物・室内写真をアップロード', zh: '📷 上传建筑或室内照片', es: '📷 Subir foto de edificio o interior', ar: '📷 رفع صورة مبنى أو مساحة داخلية' },
  remove: { ko: '✕ 제거', en: '✕ Remove', ja: '✕ 削除', zh: '✕ 移除', es: '✕ Quitar', ar: '✕ إزالة' },
  reliefTooltip: { ko: '사진의 명암을 층으로 — 사진 같은 입체 부조 (적층/레이저컷)', en: 'Turn photo contrast into layers — a photo-like relief (stacked/laser-cut)', ja: '写真の明暗を層に — 写真風の立体レリーフ（積層・レーザーカット）', zh: '将照片明暗转换为层——照片般的立体浮雕（叠层/激光切割）', es: 'Convierte el contraste en capas: relieve fotográfico (capas/corte láser)', ar: 'حوّل تباين الصورة إلى طبقات — نقش مجسم شبيه بالصورة (طبقات/قطع ليزر)' },
  makeRelief: { ko: '🏞️ 입체 부조로 만들기', en: '🏞️ Create relief', ja: '🏞️ レリーフを作成', zh: '🏞️ 创建浮雕', es: '🏞️ Crear relieve', ar: '🏞️ إنشاء نقش' },
  photoHint: { ko: '사진을 올리거나', en: 'Upload a photo or', ja: '写真をアップロードするか', zh: '上传照片或', es: 'Sube una foto o', ar: 'ارفع صورة أو' },
  stlUnfold: { ko: '🧊 STL 펼치기', en: '🧊 Unfold STL', ja: '🧊 STLを展開', zh: '🧊 展开 STL', es: '🧊 Desplegar STL', ar: '🧊 فرد STL' },
  stlSlice: { ko: '🥞 STL 적층 슬라이스', en: '🥞 Slice STL into layers', ja: '🥞 STLを積層スライス', zh: '🥞 STL 叠层切片', es: '🥞 Cortar STL en capas', ar: '🥞 تقطيع STL إلى طبقات' },
  stlHint: { ko: '펼치기=저폴리 접기 / 적층 슬라이스=곡면·고폴리 모델을 층으로 잘라 우드락에 쌓기 (두께 선택 반영).', en: 'Unfold = low-poly folding / stacked slicing = cut curved, high-poly models into layers for foam board (thickness is applied).', ja: '展開＝ローポリ折り / 積層スライス＝曲面・ハイポリを層に切りウッドボードに積層（厚さを反映）。', zh: '展开=低多边形折叠 / 叠层切片=将曲面、高多边形模型切成层叠在泡沫板上（应用所选厚度）。', es: 'Desplegar = plegado low-poly / capas = cortar modelos curvos high-poly para apilarlos en espuma (se aplica el grosor).', ar: 'الفرد = طي منخفض التفاصيل / التقطيع الطبقي = قطع النماذج المنحنية عالية التفاصيل إلى طبقات للوح الرغوة (تُطبق السماكة).' },
  dimensions: { ko: '치수', en: 'Dimensions', ja: '寸法', zh: '尺寸', es: 'Dimensiones', ar: 'الأبعاد' },
  room: { ko: '방(개방)', en: 'Open room', ja: '部屋（開放）', zh: '房间（开放）', es: 'Habitación abierta', ar: 'غرفة مفتوحة' },
  gableRoof: { ko: '박공지붕', en: 'Gable roof', ja: '切妻屋根', zh: '坡屋顶', es: 'Tejado a dos aguas', ar: 'سقف جملوني' },
  flatRoof: { ko: '평지붕', en: 'Flat roof', ja: '平屋根', zh: '平屋顶', es: 'Tejado plano', ar: 'سقف مسطح' },
  face: { ko: '면', en: 'faces', ja: '面', zh: '面', es: 'caras', ar: 'أوجه' },
  pieces: { ko: '조각', en: 'pieces', ja: 'パーツ', zh: '部件', es: 'piezas', ar: 'قطع' },
  layers: { ko: '적층', en: 'layers', ja: '積層', zh: '层', es: 'capas', ar: 'طبقات' },
  cut: { ko: '칼선', en: 'Cut', ja: 'カット', zh: '切割线', es: 'Corte', ar: 'قص' },
  foldLine: { ko: '접는선', en: 'Fold', ja: '折り線', zh: '折线', es: 'Pliegue', ar: 'طي' },
  tab: { ko: '탭', en: 'Tab', ja: 'タブ', zh: '标签', es: 'Pestaña', ar: 'لسان' },
  saveProject: { ko: '💾 프로젝트에 저장', en: '💾 Save to project', ja: '💾 プロジェクトに保存', zh: '💾 保存到项目', es: '💾 Guardar en proyecto', ar: '💾 حفظ في المشروع' },
  saved: { ko: '✓ 저장됨', en: '✓ Saved', ja: '✓ 保存済み', zh: '✓ 已保存', es: '✓ Guardado', ar: '✓ محفوظ' },
  guide: { ko: '🖨 조립 가이드 (PDF)', en: '🖨 Assembly guide (PDF)', ja: '🖨 組立ガイド (PDF)', zh: '🖨 组装指南 (PDF)', es: '🖨 Guía de montaje (PDF)', ar: '🖨 دليل التجميع (PDF)' },
  downloadDxf: { ko: '⬇ DXF 다운로드', en: '⬇ Download DXF', ja: '⬇ DXFをダウンロード', zh: '⬇ 下载 DXF', es: '⬇ Descargar DXF', ar: '⬇ تنزيل DXF' },
  notBuilding: { ko: '🤖 이건 건물이 아닌 것 같아요 — 「건물 전개도」는 박스만 만들어요. 「AI로 만들기」를 누르면 설명한 모양 그대로 3D로 만들어 드려요.', en: '🤖 This does not look like a building — “Building template” only makes boxes. Choose “Create with AI” to make the described shape in 3D.', ja: '🤖 建物ではないようです。「建物展開図」は箱のみ作成します。「AIで作成」で説明どおりの形を3D化できます。', zh: '🤖 这似乎不是建筑——“建筑展开图”只生成盒子。点击“用 AI 创建”即可按描述生成 3D。', es: '🤖 Esto no parece un edificio. «Plantilla de edificio» solo crea cajas. Pulsa «Crear con IA» para generar la forma en 3D.', ar: '🤖 يبدو أن هذا ليس مبنى — «قالب المبنى» ينشئ الصناديق فقط. اختر «إنشاء بالذكاء الاصطناعي» لإنشاء الشكل ثلاثي الأبعاد.' },
  aiCreate: { ko: '🤖 AI로 만들기', en: '🤖 Create with AI', ja: '🤖 AIで作成', zh: '🤖 用 AI 创建', es: '🤖 Crear con IA', ar: '🤖 إنشاء بالذكاء الاصطناعي' },
  foldFallbackNotice: { ko: '📦→🥞 이 모델은 접기엔 너무 복잡해서 적층(쌓기)으로 만들었어요. 접기는 단순/저폴리 모델에 적합해요.', en: '📦→🥞 This model was too complex to fold, so it was made with stacked layers. Folding is best for simple/low-poly models.', ja: '📦→🥞 このモデルは折りには複雑すぎるため積層で作成しました。折りは単純・ローポリ向けです。', zh: '📦→🥞 模型过于复杂，已改用叠层制作。折叠适合简单或低多边形模型。', es: '📦→🥞 Este modelo era demasiado complejo para plegarlo, así que se creó con capas. El plegado es ideal para modelos simples/low-poly.', ar: '📦→🥞 كان هذا النموذج معقدًا جدًا للطي، لذا صُنع بطبقات. الطي مناسب للنماذج البسيطة ومنخفضة التفاصيل.' },
  thickNotice: { ko: '🧱 두꺼운 보드({thickness}mm)는 접기 어렵습니다 — 면을 따로 잘라 탭/풀로 조립하거나, 적층(레이어) 방식을 권장합니다. 탭은 두께에 맞춰 넓혔습니다.', en: '🧱 Thick board ({thickness}mm) is hard to fold — cut faces separately and assemble with tabs/glue, or use stacked layers. Tabs were widened for the thickness.', ja: '🧱 厚いボード（{thickness}mm）は折りにくいため、面を切り分けてタブ・接着剤で組み立てるか積層方式を推奨します。タブは厚さに合わせて広げています。', zh: '🧱 厚板（{thickness}mm）难以折叠——请分别切割面板并用标签/胶水组装，或使用叠层方式。标签已按厚度加宽。', es: '🧱 El tablero grueso ({thickness}mm) es difícil de plegar. Corta las caras y únelas con pestañas/pegamento o usa capas apiladas. Las pestañas se ampliaron según el grosor.', ar: '🧱 يصعب طي اللوح السميك ({thickness}mm) — اقطع الأوجه منفصلة واجمعها بالألسنة/الغراء أو استخدم الطبقات. وُسّعت الألسنة حسب السماكة.' },
  overlapNotice: { ko: '⚠ 일부 면이 겹쳐서 펼쳐졌어요 ({count}개). 저폴리 모델이 더 깔끔하게 펼쳐집니다 — 겹친 부분은 솔기를 나눠 수동 보정이 필요할 수 있어요.', en: '⚠ Some faces overlapped when unfolded ({count}). Low-poly models unfold more cleanly — overlapping parts may need manual seam correction.', ja: '⚠ 一部の面が重なって展開されました（{count}個）。ローポリの方がきれいに展開されます。重なった部分は手動で継ぎ目を補正してください。', zh: '⚠ 展开时有部分面重叠（{count} 个）。低多边形模型展开更整齐——重叠部分可能需要手动修正接缝。', es: '⚠ Algunas caras se solaparon al desplegar ({count}). Los modelos low-poly se despliegan mejor; puede ser necesario corregir las costuras manualmente.', ar: '⚠ تداخلت بعض الأوجه عند الفرد ({count}). تُفرد النماذج منخفضة التفاصيل بشكل أنظف — قد تحتاج الأجزاء المتداخلة إلى تصحيح يدوي للدرز.' },
  preview3d: { ko: '🧊 3D 완성 미리보기 · 드래그로 회전', en: '🧊 Finished 3D preview · drag to rotate', ja: '🧊 3D完成プレビュー · ドラッグで回転', zh: '🧊 3D 成品预览 · 拖动旋转', es: '🧊 Vista previa 3D · arrastra para girar', ar: '🧊 معاينة 3D · اسحب للتدوير' },
  drawing2d: { ko: '📐 2D 도면 (칼선·접는선·탭)', en: '📐 2D drawing (cut · fold · tab)', ja: '📐 2D図面（カット・折り線・タブ）', zh: '📐 2D 图纸（切割线·折线·标签）', es: '📐 Plano 2D (corte · pliegue · pestaña)', ar: '📐 رسم 2D (قص · طي · لسان)' },
  assemblyOrder: { ko: '📋 조립 순서', en: '📋 Assembly order', ja: '📋 組立順序', zh: '📋 组装顺序', es: '📋 Orden de montaje', ar: '📋 ترتيب التجميع' },
};

function tr(lang: string, key: string, values?: Record<string, string | number>): string {
  let value = loc(lang, COPY[key] ?? { ko: key, en: key, ja: key, zh: key, es: key, ar: key });
  for (const [name, replacement] of Object.entries(values ?? {})) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}

function PreviewLoading() {
  const pathname = usePathname();
  return <div style={{ color: '#8b949e', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>{tr(toIsoLang(pathname?.split('/')[1]), 'previewLoading')}</div>;
}

// 3D preview is client-only (WebGL) — lazy-load so it never blocks the page.
const Preview3D = dynamic(() => import('./Preview3D'), { ssr: false, loading: () => <PreviewLoading /> });

interface NetResult {
  ok: boolean;
  dims?: { W: number; D: number; H: number; type?: string; roof?: string; gableHeight?: number };
  layers?: { CUT: number; FOLD: number; TAB: number };
  steps?: string[];
  faceCount?: number;
  pieces?: number;
  layerCount?: number;
  overlaps?: number;
  thick?: boolean;
  thickness?: number;
  notBuilding?: boolean;
  foldFallback?: boolean;
  bytes?: number;
  svg?: string;
  dxf?: string;
  error?: string;
}

/** Parse binary or ASCII STL → flat [x,y,z,…] vertex positions. */
function parseStlPositions(buf: ArrayBuffer): number[] {
  const dv = new DataView(buf);
  const triCount = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (triCount > 0 && 84 + triCount * 50 === buf.byteLength) {
    const pos: number[] = []; let off = 84;
    for (let i = 0; i < triCount; i++) {
      off += 12; // skip normal
      for (let v = 0; v < 3; v++) { pos.push(dv.getFloat32(off, true), dv.getFloat32(off + 4, true), dv.getFloat32(off + 8, true)); off += 12; }
      off += 2;
    }
    return pos;
  }
  const txt = new TextDecoder().decode(new Uint8Array(buf));
  const pos: number[] = [];
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) pos.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  return pos;
}

const EXAMPLE_KEYS = ['exGable', 'exShop', 'exRoom', 'exBox'] as const;

export default function PapercraftDemoPage() {
  const pathname = usePathname();
  const locale = toIsoLang(pathname?.split('/')[1]);
  const [prompt, setPrompt] = useState(() => tr(locale, 'exGable'));
  const [result, setResult] = useState<NetResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [thickness, setThickness] = useState(0); // material thickness mm; 0 = thin paper
  const [model3d, setModel3d] = useState<Model3D | null>(null); // finished-product 3D preview
  const [mode, setMode] = useState<'slice' | 'fold'>('slice'); // 적층 슬라이스 / 접기 전개
  const [phase, setPhase] = useState(''); // progress label while generating
  // 상세 설정 — enrich the AI prompt for more accurate / detailed results.
  const [detailOpen, setDetailOpen] = useState(false);
  const [style, setStyle] = useState(''); // '' | English style descriptor
  const [features, setFeatures] = useState(''); // free-text key features
  const [detailHigh, setDetailHigh] = useState(false);
  const [saved, setSaved] = useState(false); // cloud-save state for the current result

  const hasDetail = () => !!(style || features.trim() || detailHigh);
  const composePrompt = (base: string): string => {
    const parts = [base.trim()];
    if (style) parts.push(style);
    if (features.trim()) parts.push(features.trim());
    if (detailHigh) parts.push('highly detailed, clearly recognizable, correct proportions, emphasize characteristic features, multiple distinct parts');
    return parts.filter(Boolean).join(', ');
  };

  const onPickImage = useCallback((file: File | null) => {
    if (!file) { setImage(null); setImageName(''); return; }
    const reader = new FileReader();
    reader.onload = () => { setImage(typeof reader.result === 'string' ? reader.result : null); setImageName(file.name || tr(locale, 'pastedImage')); };
    reader.readAsDataURL(file);
  }, [locale]);

  // Paste an image from the clipboard (Ctrl+V) → use it as the AI input.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const f = items[i].getAsFile();
          if (f) onPickImage(f);
          break;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPickImage]);

  // AI → arbitrary object: text/image → AI OpenSCAD → mesh → slice → 3D + net.
  // Chains the existing endpoints client-side (each keeps its own gating).
  // AI pipeline: text/image → AI OpenSCAD → mesh → fold/slice net. Reused by the
  // unified generator when the description is a non-building object.
  const runAiPipeline = async (text: string): Promise<boolean> => {
    setPhase(tr(locale, 'aiMaking'));
    const r1 = await fetch('/api/nexyfab/scad-intent-from-nl', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, ...(image ? { image } : {}), freeform: true }),
    });
    const j1 = await r1.json().catch(() => ({})) as { scad?: string; error?: string; code?: string };
    if (!r1.ok || !j1.scad) {
      setResult({ ok: false, error: r1.status === 401 || j1.code === 'GUEST_LIMIT'
        ? tr(locale, 'limitError')
        : tr(locale, 'ai3dFailed') });
      return false;
    }
    setPhase(tr(locale, 'rendering'));
    const render = async (scad: string) => {
      const r = await fetch('/api/nexyfab/openscad-render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scad, format: 'stl' }),
      });
      const j = await r.json().catch(() => ({})) as { dataBase64?: string; error?: string };
      return r.ok && j.dataBase64 ? j.dataBase64 : null;
    };
    let stlB64 = await render(j1.scad);
    if (!stlB64) {
      // Complex SCAD (esp. with high detail) can exceed the render budget — ask
      // the model to simplify once, then re-render.
      setPhase(tr(locale, 'simplify'));
      const rr = await fetch('/api/nexyfab/scad-intent-from-nl', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Simplify this so it renders within size limits: set $fn=12, remove tiny/decorative features, keep only the main mass and 2-3 defining parts.', previousScad: j1.scad, repair: true, freeform: true }),
      });
      const jr = await rr.json().catch(() => ({})) as { scad?: string };
      if (jr.scad) stlB64 = await render(jr.scad);
    }
    if (!stlB64) { setResult({ ok: false, error: tr(locale, 'renderFailed') }); return false; }
    const stlBuf = Uint8Array.from(atob(stlB64), c => c.charCodeAt(0)).buffer;
    const positions = parseStlPositions(stlBuf);
    if (positions.length < 9) { setResult({ ok: false, error: tr(locale, 'meshReadFailed') }); return false; }
    setModel3d({ kind: 'mesh', positions });
    // fold (접기) or stacked slice (적층) per the chosen mode.
    setPhase(mode === 'fold' ? tr(locale, 'unfoldProgress') : tr(locale, 'sliceProgress'));
    if (mode === 'fold') {
      const rf = await fetch('/api/nexyfab/papercraft-unfold', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions, ...(thickness > 0 ? { thickness } : {}) }),
      });
      const jf = await rf.json().catch(() => ({})) as NetResult & { code?: string };
      if (jf.ok) { setResult(jf); return true; }
      // Too complex to fold (dense AI mesh) → auto-fall back to stacked slice.
      setPhase(tr(locale, 'foldFallback'));
      const rs = await fetch('/api/nexyfab/papercraft-slice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions, ...(thickness > 0 ? { thickness } : { thickness: 5 }) }),
      });
      const js = await rs.json().catch(() => ({})) as NetResult;
      setResult({ ...js, foldFallback: js.ok });
      return true;
    }
    const r3 = await fetch('/api/nexyfab/papercraft-slice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions, ...(thickness > 0 ? { thickness } : { thickness: 5 }) }),
    });
    setResult(await r3.json());
    return true;
  };

  const onAiGenerate = async () => {
    const text = prompt.trim();
    if (!text && !image) return;
    setLoading(true); setResult(null); setModel3d(null); setSaved(false);
    try { await runAiPipeline(composePrompt(text)); }
    catch { setResult({ ok: false, error: tr(locale, 'aiError') }); }
    finally { setLoading(false); setPhase(''); }
  };

  // Unified: one button. Buildings → fast box generator; objects → AI pipeline.
  const onUnifiedGenerate = async () => {
    const text = prompt.trim();
    if (!text && !image) return;
    setLoading(true); setResult(null); setModel3d(null); setSaved(false); setPhase(tr(locale, 'analysing'));
    try {
      // 상세 설정이 있으면 (단순 박스로 안 끝내고) 항상 AI로 — 복잡한 건물/물체.
      if (hasDetail()) { await runAiPipeline(composePrompt(text)); return; }
      // 사진이 있으면 AI 3D로 (적층/접기 선택대로) — 사진은 박스가 아니라 입체로.
      if (image) { await runAiPipeline(composePrompt(text)); return; }
      // The building generator doubles as the classifier (returns notBuilding).
      const res = await fetch('/api/nexyfab/papercraft-net', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, ...(image ? { image } : {}), ...(thickness > 0 ? { thickness } : {}) }),
      });
      const j = await res.json() as NetResult;
      if (j.ok && !j.notBuilding) {
        // It's architecture → use the fast building net.
        setResult(j);
        if (j.dims) setModel3d({ kind: 'box', W: j.dims.W, D: j.dims.D, H: j.dims.H, roof: (j.dims.roof as 'flat' | 'gable' | 'open') ?? 'flat', gableH: j.dims.gableHeight });
        return;
      }
      // Object (or building gen failed) → AI pipeline (with detail composition).
      await runAiPipeline(composePrompt(text));
    } catch {
      setResult({ ok: false, error: tr(locale, 'generationError') });
    } finally { setLoading(false); setPhase(''); }
  };

  const generate = async (p?: string) => {
    const text = (p ?? prompt).trim();
    // Allow image-only generation (a photo drives the spec). Text or image required.
    if (!text && !image) return;
    if (p) setPrompt(p);
    setLoading(true); setSaved(false);
    try {
      const res = await fetch('/api/nexyfab/papercraft-net', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, ...(image ? { image } : {}), ...(thickness > 0 ? { thickness } : {}) }),
      });
      const j = await res.json() as NetResult;
      setResult(j);
      if (j.ok && j.dims) setModel3d({ kind: 'box', W: j.dims.W, D: j.dims.D, H: j.dims.H, roof: (j.dims.roof as 'flat' | 'gable' | 'open') ?? 'flat', gableH: j.dims.gableHeight });
    } catch {
      setResult({ ok: false, error: tr(locale, 'generationFailed') });
    } finally {
      setLoading(false);
    }
  };

  // Photo → tonal layered relief (사진 같은 적층). Pure image processing — no AI
  // model: luminance → N tonal bands → contour each → stacked relief + heightmap.
  const onPhotoRelief = async () => {
    if (!image) { setResult({ ok: false, error: tr(locale, 'uploadPhotoError') }); return; }
    setLoading(true); setResult(null); setModel3d(null); setSaved(false); setPhase(tr(locale, 'photoAnalysing'));
    try {
      const { imageToField, reliefToSegs, reliefHeightmap } = await import('./relief');
      const { segmentsToDxf, segmentsToSvg } = await import('@/lib/papercraft/netDxf');
      const field = await imageToField(image, 200);
      setPhase(tr(locale, 'reliefMaking'));
      // More tonal bands → finer relief. Thicker board → fewer (chunkier) layers.
      const levels = thickness >= 5 ? 8 : thickness >= 3 ? 10 : 12;
      const { segs, layerCount } = reliefToSegs(field, levels, 1.4);
      if (segs.length === 0) { setResult({ ok: false, error: tr(locale, 'contrastWeak') }); return; }
      const dxf = segmentsToDxf(segs);
      const svg = segmentsToSvg(segs);
      setModel3d({ kind: 'mesh', positions: reliefHeightmap(field, 120, 18) });
      setResult({ ok: true, layerCount, layers: { CUT: segs.length, FOLD: 0, TAB: 0 }, dxf, svg, bytes: dxf.length });
    } catch {
      setResult({ ok: false, error: tr(locale, 'reliefFailed') });
    } finally { setLoading(false); setPhase(''); }
  };

  // Gap 1: upload an arbitrary 3D model (STL) → generic mesh unfold → net.
  const onPickStl = async (file: File | null) => {
    if (!file) return;
    setLoading(true); setSaved(false);
    try {
      const buf = await file.arrayBuffer();
      const positions = parseStlPositions(buf);
      if (positions.length < 9) { setResult({ ok: false, error: tr(locale, 'stlReadFailed') }); return; }
      setModel3d({ kind: 'mesh', positions });
      const res = await fetch('/api/nexyfab/papercraft-unfold', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions, ...(thickness > 0 ? { thickness } : {}) }),
      });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, error: tr(locale, 'unfoldFailed') });
    } finally { setLoading(false); }
  };

  // Slice an uploaded 3D model (STL) into stacked foam-board layers — works for
  // curved / high-poly models that can't fold.
  const onPickStlSlice = async (file: File | null) => {
    if (!file) return;
    setLoading(true); setSaved(false);
    try {
      const buf = await file.arrayBuffer();
      const positions = parseStlPositions(buf);
      if (positions.length < 9) { setResult({ ok: false, error: tr(locale, 'stlReadFailed') }); return; }
      setModel3d({ kind: 'mesh', positions });
      const res = await fetch('/api/nexyfab/papercraft-slice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions, ...(thickness > 0 ? { thickness } : { thickness: 5 }) }),
      });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, error: tr(locale, 'sliceFailed') });
    } finally { setLoading(false); }
  };

  // Save the current papercraft result to 내 프로젝트 (cloud) so it persists and
  // can be reopened later — papercraft work is preserved just like 3D CAD.
  const onSaveProject = async () => {
    if (!result?.ok) return;
    if (!useAuthStore.getState().user) { setResult({ ...result, error: tr(locale, 'signInRequired') }); return; }
    const scene = {
      kind: 'papercraft', prompt, mode, thickness, style, features, detailHigh,
      result: {
        svg: result.svg, dxf: result.dxf, layerCount: result.layerCount, faceCount: result.faceCount,
        pieces: result.pieces, dims: result.dims, layers: result.layers, thick: result.thick,
        thickness: result.thickness, notBuilding: result.notBuilding, foldFallback: result.foldFallback, steps: result.steps,
      },
    };
    const name = `${(prompt.trim() || tr(locale, 'projectName')).slice(0, 60)} · Papercraft`;
    const p = await useProjectsStore.getState().saveProject({ name, shapeId: 'papercraft', sceneData: JSON.stringify(scene) });
    if (p) setSaved(true);
    else setResult({ ...result, error: tr(locale, 'saveFailed') });
  };

  // Reopen a saved papercraft project (?project=id) — restore inputs + result.
  useEffect(() => {
    const pid = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('project') : null;
    if (!pid) return;
    void (async () => {
      setLoading(true); setPhase(tr(locale, 'loadingProject'));
      try {
        const token = useAuthStore.getState().token;
        const r = await fetch(`/api/nexyfab/projects/${pid}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!r.ok) return;
        const { project } = await r.json() as { project?: { shapeId?: string; sceneData?: string } };
        if (project?.shapeId !== 'papercraft' || !project.sceneData) return;
        const s = JSON.parse(project.sceneData) as Record<string, unknown>;
        if (typeof s.prompt === 'string') setPrompt(s.prompt);
        if (s.mode === 'fold' || s.mode === 'slice') setMode(s.mode);
        if (typeof s.thickness === 'number') setThickness(s.thickness);
        if (typeof s.style === 'string') setStyle(s.style);
        if (typeof s.features === 'string') setFeatures(s.features);
        if (typeof s.detailHigh === 'boolean') setDetailHigh(s.detailHigh);
        const res = s.result as NetResult | undefined;
        if (res && res.svg) {
          setResult({ ...res, ok: true });
          setSaved(true);
          if (res.dims) setModel3d({ kind: 'box', W: res.dims.W, D: res.dims.D, H: res.dims.H, roof: (res.dims.roof as 'flat' | 'gable' | 'open') ?? 'flat', gableH: res.dims.gableHeight });
        }
      } catch { /* ignore */ } finally { setLoading(false); setPhase(''); }
    })();
  }, [locale]);

  const downloadDxf = () => {
    if (!result?.dxf) return;
    const blob = new Blob([result.dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `papercraft-${result.dims?.type ?? 'net'}.dxf`; a.click();
    URL.revokeObjectURL(url);
  };

  // Print/Save-as-PDF an assembly guide: the net drawing + numbered fold/glue
  // steps, in a clean print layout (browser "Save as PDF" yields the manual).
  const printGuide = () => {
    if (!result?.svg || !result.steps) return;
    const d = result.dims;
    const w = window.open('', '_blank');
    if (!w) return;
    const stepsHtml = result.steps.map((s) => `<li>${s}</li>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${tr(locale, 'guide')}</title>
      <style>body{font-family:system-ui,sans-serif;margin:32px;color:#111}h1{font-size:22px;margin:0 0 4px}
      .meta{color:#666;font-size:13px;margin-bottom:20px}.net{border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:20px}
      ol{font-size:15px;line-height:1.9;padding-left:22px}li{margin-bottom:4px}
      .legend{font-size:12px;color:#666;margin-top:8px}@media print{button{display:none}}</style></head>
      <body><h1>${tr(locale, 'guide')}</h1>
      <div class="meta">${d ? `${tr(locale, 'dimensions')} ${d.W}×${d.D}×${d.H}mm · ${d.type === 'room' ? tr(locale, 'room') : d.roof === 'gable' ? tr(locale, 'gableRoof') : tr(locale, 'flatRoof')}` : ''}</div>
      <div class="net">${result.svg}</div>
      <div class="legend">${tr(locale, 'cut')} · ${tr(locale, 'foldLine')} · ${tr(locale, 'tab')}</div>
      <h2 style="font-size:16px;margin:18px 0 6px">${tr(locale, 'assemblyOrder')}</h2>
      <ol>${stepsHtml}</ol>
      <button onclick="window.print()" style="margin-top:16px;padding:10px 18px;font-size:14px">${tr(locale, 'guide')}</button>
      </body></html>`);
    w.document.close();
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`@keyframes pcspin{to{transform:rotate(360deg)}} .pc-spin{width:15px;height:15px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;display:inline-block;animation:pcspin .7s linear infinite}`}</style>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '48px 20px' }}>
        <p style={{ color: '#388bfd', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 8px' }}>
          NexyFab · Papercraft
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: '0 0 8px' }}>{tr(locale, 'title')}</h1>
        <p style={{ color: '#8b949e', fontSize: 15, margin: '0 0 28px' }}>
          {tr(locale, 'subtitle')}
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void onUnifiedGenerate(); }}
            placeholder={tr(locale, 'placeholder')}
            style={{ flex: '1 1 320px', padding: '12px 14px', borderRadius: 8, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 15 }}
          />
          <button
            onClick={() => void onUnifiedGenerate()}
            disabled={loading}
            title={tr(locale, 'createTooltip')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 8, border: 'none', background: loading ? '#1f2937' : 'linear-gradient(90deg,#7c3aed,#2563eb)', color: '#fff', fontSize: 15, fontWeight: 800, cursor: loading ? 'default' : 'pointer' }}
          >
            {loading && <span className="pc-spin" aria-hidden="true" />}
            {loading ? (phase || tr(locale, 'making')) : tr(locale, 'create')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#8b949e' }}>{tr(locale, 'method')}</span>
          {[{ v: 'slice', l: tr(locale, 'slice'), d: tr(locale, 'sliceDesc') }, { v: 'fold', l: tr(locale, 'fold'), d: tr(locale, 'foldDesc') }].map(o => (
            <button key={o.v} onClick={() => setMode(o.v as 'slice' | 'fold')} title={o.d}
              style={{ padding: '4px 12px', borderRadius: 16, border: `1px solid ${mode === o.v ? '#7c3aed' : '#30363d'}`, background: mode === o.v ? '#241338' : '#161b22', color: mode === o.v ? '#d8b4fe' : '#8b949e', fontSize: 12, cursor: 'pointer' }}>
              {o.l}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#8b949e' }}>{tr(locale, 'materialThickness')}</span>
          {[{ v: 0, l: tr(locale, 'thinPaper') }, { v: 1, l: tr(locale, 'thickPaper') }, { v: 3, l: 'Foam board 3mm' }, { v: 5, l: 'Foam board 5mm' }].map(o => (
            <button key={o.v} onClick={() => setThickness(o.v)}
              style={{ padding: '4px 12px', borderRadius: 16, border: `1px solid ${thickness === o.v ? '#2563eb' : '#30363d'}`, background: thickness === o.v ? '#13294d' : '#161b22', color: thickness === o.v ? '#cfe1ff' : '#8b949e', fontSize: 12, cursor: 'pointer' }}>
              {o.l}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <button onClick={() => setDetailOpen(o => !o)}
            style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 13, cursor: 'pointer', padding: 0 }}>
            {tr(locale, 'detail')} {detailOpen ? '▾' : '▸'}{hasDetail() && !detailOpen ? tr(locale, 'applied') : ''}
          </button>
          {detailOpen && (
            <div style={{ marginTop: 10, padding: 12, border: '1px solid #30363d', borderRadius: 8, background: '#10141a', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#8b949e', width: 56 }}>{tr(locale, 'style')}</span>
                {[{ v: '', l: tr(locale, 'none') }, { v: 'cute chibi proportions, smooth rounded forms', l: tr(locale, 'cute') }, { v: 'realistic proportions and silhouette', l: tr(locale, 'realistic') }, { v: 'simple low-poly with few parts', l: tr(locale, 'simple') }].map(o => (
                  <button key={o.l} onClick={() => setStyle(o.v)}
                    style={{ padding: '3px 10px', borderRadius: 14, border: `1px solid ${style === o.v ? '#7c3aed' : '#30363d'}`, background: style === o.v ? '#241338' : '#161b22', color: style === o.v ? '#d8b4fe' : '#8b949e', fontSize: 12, cursor: 'pointer' }}>{o.l}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#8b949e', width: 56 }}>{tr(locale, 'keyFeatures')}</span>
                <input value={features} onChange={e => setFeatures(e.target.value)} placeholder={tr(locale, 'featuresPlaceholder')}
                  style={{ flex: '1 1 280px', padding: '7px 10px', borderRadius: 6, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#8b949e', width: 56 }}>{tr(locale, 'detailLevel')}</span>
                <button onClick={() => setDetailHigh(d => !d)}
                  style={{ padding: '3px 10px', borderRadius: 14, border: `1px solid ${detailHigh ? '#7c3aed' : '#30363d'}`, background: detailHigh ? '#241338' : '#161b22', color: detailHigh ? '#d8b4fe' : '#8b949e', fontSize: 12, cursor: 'pointer' }}>{tr(locale, 'high')}{detailHigh ? ' ✓' : ''}</button>
                <span style={{ fontSize: 11, color: '#6b7280' }}>{tr(locale, 'detailHint')}</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {EXAMPLE_KEYS.map(key => (
            <button key={key} onClick={() => void generate(tr(locale, key))} disabled={loading}
              style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid #30363d', background: '#161b22', color: '#8b949e', fontSize: 13, cursor: 'pointer' }}>
              {tr(locale, key)}
            </button>
          ))}
        </div>

        {/* Photo → paper kit: upload a building/room photo, vision estimates the spec. */}
        <div style={{ border: '1px dashed #30363d', borderRadius: 10, padding: 14, marginBottom: 28, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 14, cursor: 'pointer' }}>
            {tr(locale, 'uploadPhoto')}
            <input type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => onPickImage(e.target.files?.[0] ?? null)} />
          </label>
          {image
            ? <span style={{ fontSize: 13, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" style={{ height: 36, borderRadius: 4, border: '1px solid #30363d' }} />
                {imageName} <button onClick={() => onPickImage(null)} style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 13 }}>{tr(locale, 'remove')}</button>
                <button onClick={() => void onPhotoRelief()} disabled={loading}
                  title={tr(locale, 'reliefTooltip')}
                  style={{ marginLeft: 6, padding: '5px 12px', borderRadius: 8, border: 'none', background: loading ? '#1f2937' : 'linear-gradient(90deg,#0ea5e9,#2563eb)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
                  {tr(locale, 'makeRelief')}
                </button>
              </span>
            : <span style={{ fontSize: 13, color: '#8b949e' }}>{tr(locale, 'photoHint')} <b>Ctrl+V</b> → <b>{tr(locale, 'create')}</b> · <b>{tr(locale, 'makeRelief')}</b></span>}
        </div>

        {/* Gap 1: generic 3D model → mesh unfold. */}
        <div style={{ border: '1px dashed #30363d', borderRadius: 10, padding: 14, marginBottom: 28, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 14, cursor: 'pointer' }}>
            {tr(locale, 'stlUnfold')}
            <input type="file" accept=".stl,model/stl" style={{ display: 'none' }}
              onChange={e => void onPickStl(e.target.files?.[0] ?? null)} />
          </label>
          <label style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 14, cursor: 'pointer' }}>
            {tr(locale, 'stlSlice')}
            <input type="file" accept=".stl,model/stl" style={{ display: 'none' }}
              onChange={e => void onPickStlSlice(e.target.files?.[0] ?? null)} />
          </label>
          <span style={{ fontSize: 13, color: '#8b949e' }}>{tr(locale, 'stlHint')}</span>
        </div>

        {result && result.ok && result.svg && (
          <div style={{ border: '1px solid #30363d', borderRadius: 12, padding: 20, background: '#161b22' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 13, color: '#8b949e' }}>
                {result.dims && <>{tr(locale, 'dimensions')} {result.dims.W}×{result.dims.D}×{result.dims.H}mm · {result.dims.type === 'room' ? tr(locale, 'room') : result.dims.roof === 'gable' ? tr(locale, 'gableRoof') : tr(locale, 'flatRoof')}</>}
                {typeof result.faceCount === 'number' && <>{result.faceCount} {tr(locale, 'face')}</>}
                {typeof result.pieces === 'number' && result.pieces > 1 && <> · {result.pieces} {tr(locale, 'pieces')}</>}
                {typeof result.layerCount === 'number' && <>{result.layerCount} {tr(locale, 'layers')}</>}
                {result.layers && <> · {tr(locale, 'cut')} {result.layers.CUT} / {tr(locale, 'foldLine')} {result.layers.FOLD} / {tr(locale, 'tab')} {result.layers.TAB}</>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => void onSaveProject()} disabled={saved}
                  title={tr(locale, 'saveProject')}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid ' + (saved ? '#2ea043' : '#30363d'), background: saved ? '#16331f' : '#161b22', color: saved ? '#56d364' : '#e6edf3', fontSize: 14, fontWeight: 700, cursor: saved ? 'default' : 'pointer' }}>
                  {saved ? tr(locale, 'saved') : tr(locale, 'saveProject')}
                </button>
                <button onClick={printGuide} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  {tr(locale, 'guide')}
                </button>
                <button onClick={downloadDxf} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #238636', background: '#238636', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  {tr(locale, 'downloadDxf')}
                </button>
              </div>
            </div>
            {result.notBuilding && (
              <div style={{ background: '#2a1633', border: '1px solid #7c3aed', borderRadius: 8, padding: '10px 14px', marginBottom: 10, fontSize: 13, color: '#d8b4fe', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>{tr(locale, 'notBuilding')}</span>
                <button onClick={() => void onAiGenerate()} disabled={loading}
                  style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(90deg,#7c3aed,#2563eb)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {tr(locale, 'aiCreate')}
                </button>
              </div>
            )}
            {result.foldFallback && (
              <div style={{ background: '#12243a', border: '1px solid #1a5a8a', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#74b9f0' }}>
                {tr(locale, 'foldFallbackNotice')}
              </div>
            )}
            {result.thick && (
              <div style={{ background: '#12243a', border: '1px solid #1a5a8a', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#74b9f0' }}>
                {tr(locale, 'thickNotice', { thickness: result.thickness ?? 0 })}
              </div>
            )}
            {typeof result.overlaps === 'number' && result.overlaps > 0 && (
              <div style={{ background: '#3a2a12', border: '1px solid #8a6d1a', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#f0c674' }}>
                {tr(locale, 'overlapNotice', { count: result.overlaps ?? 0 })}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: model3d ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr', gap: 12 }}>
              {model3d && (
                <div style={{ background: '#0d1117', borderRadius: 8, height: 340, border: '1px solid #30363d', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 8, left: 10, zIndex: 1, fontSize: 11, color: '#8b949e', pointerEvents: 'none' }}>{tr(locale, 'preview3d')}</div>
                  <Preview3D model={model3d} />
                </div>
              )}
              <div style={{ background: '#fff', borderRadius: 8, padding: 16, position: 'relative' }}>
                <div style={{ position: 'absolute', top: 6, left: 10, fontSize: 11, color: '#999', pointerEvents: 'none' }}>{tr(locale, 'drawing2d')}</div>
                <div dangerouslySetInnerHTML={{ __html: result.svg }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#8b949e' }}>
              <span><span style={{ color: '#dc2626' }}>━</span> {tr(locale, 'cut')}</span>
              <span><span style={{ color: '#2563eb' }}>┄</span> {tr(locale, 'foldLine')}</span>
              <span><span style={{ color: '#16a34a' }}>━</span> {tr(locale, 'tab')}</span>
            </div>
            {result.steps && result.steps.length > 0 && (
              <div style={{ marginTop: 18, borderTop: '1px solid #30363d', paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', marginBottom: 8 }}>{tr(locale, 'assemblyOrder')}</div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#c9d1d9', lineHeight: 1.8 }}>
                  {result.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            )}
          </div>
        )}
        {result && !result.ok && (
          <div style={{ color: '#f85149', fontSize: 14 }}>{result.error ?? tr(locale, 'generationFailed')}</div>
        )}
      </div>
    </div>
  );
}
