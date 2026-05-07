/**
 * email-templates.ts — HTML 이메일 템플릿 함수 모음
 * 각 함수는 { subject, html } 을 반환합니다.
 */

// Base layout wrapper
function layout(content: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #0f172a; color: white; padding: 28px 32px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
    .header p { margin: 4px 0 0; color: #94a3b8; font-size: 13px; }
    .body { padding: 32px; }
    .body p { color: #334155; line-height: 1.6; font-size: 14px; margin: 0 0 16px; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 20px 0; }
    .info-box .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    .info-box .row:last-child { border-bottom: none; }
    .info-box .label { color: #64748b; }
    .info-box .value { color: #0f172a; font-weight: 600; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; }
    .badge-success { background: #dcfce7; color: #166534; }
    .badge-info { background: #dbeafe; color: #1e40af; }
    .badge-warning { background: #fef9c3; color: #854d0e; }
    .cta { display: inline-block; background: #0f172a; color: #ffffff !important; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 700; margin: 8px 0; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 32px; text-align: center; }
    .footer p { color: #94a3b8; font-size: 12px; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    ${content}
    <div class="footer">
      <p>NexyFab · <a href="https://nexyfab.com" style="color:#64748b">nexyfab.com</a> · 문의: <a href="mailto:support@nexyfab.com" style="color:#64748b">support@nexyfab.com</a></p>
      <p style="margin-top:4px">이 이메일은 자동 발송되었습니다. 회신하지 마세요.</p>
    </div>
  </div>
</body>
</html>`;
}

export function planUpgradeEmail(opts: { name: string; plan: 'Pro' | 'Team' }): { subject: string; html: string } {
  const subject = `[NexyFab] ${opts.plan} 플랜 구독이 완료되었습니다`;
  const html = layout(`
    <div class="header">
      <h1>NexyFab</h1>
      <p>구독 확인</p>
    </div>
    <div class="body">
      <p>안녕하세요 <strong>${opts.name}</strong>님,</p>
      <p>NexyFab <span class="badge badge-success">${opts.plan}</span> 플랜 구독이 성공적으로 완료되었습니다.</p>
      <p>이제 모든 ${opts.plan} 기능을 이용하실 수 있습니다.</p>
      <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexyfab.com'}/en/nexyfab/dashboard" class="cta">대시보드 바로가기</a>
      <p style="margin-top:24px; color:#64748b; font-size:13px">문의사항이 있으시면 support@nexyfab.com으로 연락해 주세요.</p>
    </div>
  `, subject);
  return { subject, html };
}

export function newQuoteEmail(opts: { projectName: string; details: string; validUntil: string | null }): { subject: string; html: string } {
  const subject = '[NexyFab] 새 견적 요청이 배정되었습니다';
  const html = layout(`
    <div class="header">
      <h1>NexyFab</h1>
      <p>새 견적 요청</p>
    </div>
    <div class="body">
      <p>새로운 견적 요청이 배정되었습니다. 파트너 포털에서 확인하고 견적을 제출해 주세요.</p>
      <div class="info-box">
        <div class="row"><span class="label">프로젝트명</span><span class="value">${opts.projectName}</span></div>
        <div class="row"><span class="label">요청 상세</span><span class="value">${opts.details || '없음'}</span></div>
        <div class="row"><span class="label">유효기간</span><span class="value">${opts.validUntil || '없음'}</span></div>
      </div>
      <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexyfab.com'}/partner/quotes" class="cta">견적 제출하기</a>
    </div>
  `, subject);
  return { subject, html };
}

export function quoteStatusEmail(opts: { projectName: string; status: 'accepted' | 'rejected' }): { subject: string; html: string } {
  const accepted = opts.status === 'accepted';
  const subject = accepted ? '[NexyFab] 견적이 채택되었습니다' : '[NexyFab] 견적이 선택되지 않았습니다';
  const html = layout(`
    <div class="header">
      <h1>NexyFab</h1>
      <p>견적 결과 알림</p>
    </div>
    <div class="body">
      <p><strong>${opts.projectName}</strong> 프로젝트의 견적이 ${accepted ? '<span class="badge badge-success">채택</span>' : '<span class="badge badge-warning">선택되지 않음</span>'} 되었습니다.</p>
      ${accepted ? '<p>계약이 곧 생성됩니다. 파트너 포털에서 진행 상황을 확인해 주세요.</p>' : '<p>다음 기회에 더 좋은 결과를 기대합니다.</p>'}
      <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexyfab.com'}/partner/quotes" class="cta">파트너 포털</a>
    </div>
  `, subject);
  return { subject, html };
}

export function passwordResetEmail(opts: { resetUrl: string }): { subject: string; html: string } {
  const subject = '[NexyFab] 비밀번호 재설정 링크';
  const html = layout(`
    <div class="header">
      <h1>NexyFab</h1>
      <p>비밀번호 재설정</p>
    </div>
    <div class="body">
      <p>비밀번호 재설정을 요청하셨습니다. 아래 버튼을 클릭하여 새 비밀번호를 설정하세요.</p>
      <p style="color:#ef4444; font-size:13px">이 링크는 1시간 후 만료됩니다.</p>
      <a href="${opts.resetUrl}" class="cta">비밀번호 재설정</a>
      <p style="margin-top:24px; color:#64748b; font-size:13px">요청하지 않으셨다면 이 이메일을 무시하세요.</p>
    </div>
  `, subject);
  return { subject, html };
}
