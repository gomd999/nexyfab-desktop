'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function UnsubscribePage() {
  const params = useSearchParams();
  const success = params.get('success') === '1';
  const error   = params.get('error');
  const email   = params.get('email') ?? '';

  if (success) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f8f9fb', fontFamily: 'system-ui, sans-serif', padding: '24px',
      }}>
        <div style={{
          maxWidth: '480px', width: '100%', background: '#fff',
          borderRadius: '16px', padding: '48px 40px', textAlign: 'center',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111', marginBottom: '12px' }}>
            수신거부 완료
          </h1>
          <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.7, marginBottom: '8px' }}>
            {email && <><strong>{email}</strong><br /></>}
            NexyFab 마케팅 이메일 수신을 거부하셨습니다.
          </p>
          <p style={{ fontSize: '13px', color: '#999', marginBottom: '32px', lineHeight: 1.6 }}>
            서비스 관련 중요 알림 이메일(결제 영수증, 보안 알림 등)은
            계속 발송될 수 있습니다.
          </p>
          <a href="https://nexyfab.com" style={{
            display: 'inline-block', padding: '12px 28px',
            background: '#0b5cff', color: '#fff', borderRadius: '8px',
            textDecoration: 'none', fontSize: '14px', fontWeight: 700,
          }}>
            홈으로 돌아가기
          </a>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f8f9fb', fontFamily: 'system-ui, sans-serif', padding: '24px',
      }}>
        <div style={{
          maxWidth: '480px', width: '100%', background: '#fff',
          borderRadius: '16px', padding: '48px 40px', textAlign: 'center',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111', marginBottom: '12px' }}>
            유효하지 않은 링크
          </h1>
          <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.7, marginBottom: '32px' }}>
            수신거부 링크가 만료되었거나 올바르지 않습니다.<br />
            이메일에서 링크를 다시 클릭하거나 고객 지원에 문의해 주세요.
          </p>
          <a href="mailto:support@nexyfab.com" style={{
            display: 'inline-block', padding: '12px 28px',
            background: '#111', color: '#fff', borderRadius: '8px',
            textDecoration: 'none', fontSize: '14px', fontWeight: 700,
          }}>
            고객 지원 문의
          </a>
        </div>
      </div>
    );
  }

  // Default: unsubscribe landing (no params)
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f8f9fb', fontFamily: 'system-ui, sans-serif', padding: '24px',
    }}>
      <div style={{
        maxWidth: '480px', width: '100%', background: '#fff',
        borderRadius: '16px', padding: '48px 40px', textAlign: 'center',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}>
        <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111', marginBottom: '12px' }}>
          이메일 수신거부
        </h1>
        <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.7, marginBottom: '32px' }}>
          수신거부를 원하시면 이메일 하단의 &quot;수신 거부&quot; 링크를 클릭해 주세요.
        </p>
        <a href="https://nexyfab.com" style={{
          display: 'inline-block', padding: '12px 28px',
          background: '#0b5cff', color: '#fff', borderRadius: '8px',
          textDecoration: 'none', fontSize: '14px', fontWeight: 700,
        }}>
          홈으로 돌아가기
        </a>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <UnsubscribePage />
    </Suspense>
  );
}
