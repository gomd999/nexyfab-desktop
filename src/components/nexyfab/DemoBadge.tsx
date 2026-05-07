'use client';

/**
 * DemoBadge — 데모 모드 진입 시 페이지 상단에 고정 표시되는 배지.
 *
 * 메시지 의도 (project_nexyfab_demo_mode.md):
 *   "지금 입력 중인 데이터는 임시 저장입니다. 가입하시면 본 계정으로 자동 이관됩니다."
 *   → 가입 동기를 죽이지 않으면서 데이터 손실 불안을 차단.
 *
 * 표시 조건: props.active=true. 부모(예: RFQ 페이지) 가
 * 데모 세션 존재 여부를 판단해서 넘겨준다.
 */

interface Props {
  active: boolean;
  /** 가입 CTA 클릭 시 호출. 미지정 시 /api/auth/signup 방식 모달 열기 권장. */
  onSignupClick?: () => void;
  lang?: string;
}

const DICT: Record<string, { title: string; sub: string; cta: string }> = {
  ko: {
    title: '데모 모드',
    sub:   '입력하신 데이터는 임시 저장됩니다. 가입 시 본 계정으로 자동 이관됩니다.',
    cta:   '가입하고 데이터 보존',
  },
  en: {
    title: 'Demo Mode',
    sub:   'Your data is temporarily saved. Sign up to migrate it to your account.',
    cta:   'Sign up to keep data',
  },
  ja: {
    title: 'デモモード',
    sub:   '入力データは一時保存されます。登録時に本アカウントへ自動移行。',
    cta:   '登録してデータ保存',
  },
  cn: {
    title: '演示模式',
    sub:   '输入的数据将临时保存。注册后自动迁移至正式账户。',
    cta:   '注册并保留数据',
  },
  es: {
    title: 'Modo Demo',
    sub:   'Sus datos se guardan temporalmente. Regístrese para migrarlos a su cuenta.',
    cta:   'Registrarse y conservar',
  },
  ar: {
    title: 'وضع تجريبي',
    sub:   'يتم حفظ بياناتك مؤقتًا. سجّل لنقلها إلى حسابك.',
    cta:   'سجّل لحفظ البيانات',
  },
};

export default function DemoBadge({ active, onSignupClick, lang = 'ko' }: Props) {
  if (!active) return null;
  const t = DICT[lang] ?? DICT.ko;

  return (
    <div
      role="status"
      style={{
        background: 'linear-gradient(135deg, #0c4a6e, #0e7490)',
        borderBottom: '1px solid #155e75',
        padding: '10px 16px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 240px' }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.05em',
            color: '#0c4a6e',
            background: '#67e8f9',
            padding: '3px 8px',
            borderRadius: '4px',
            flexShrink: 0,
          }}
        >
          {t.title.toUpperCase()}
        </span>
        <span style={{ color: '#cffafe', fontSize: '13px', lineHeight: 1.4 }}>
          {t.sub}
        </span>
      </div>

      {onSignupClick && (
        <button
          onClick={onSignupClick}
          style={{
            background: '#22d3ee',
            color: '#0c4a6e',
            border: 'none',
            borderRadius: '6px',
            padding: '7px 14px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t.cta}
        </button>
      )}
    </div>
  );
}
