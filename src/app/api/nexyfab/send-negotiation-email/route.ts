/**
 * POST /api/nexyfab/send-negotiation-email
 *
 * 협상 이메일 실제 발송 엔드포인트.
 * quote-negotiator가 생성한 초안을 실제로 발송함.
 * SMTP(nodemailer) 또는 RESEND_API_KEY 환경변수로 Resend 사용.
 * Pro+ 플랜 전용.
 */

import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

interface SendBody {
  to: string;          // 수신자 이메일
  subject: string;
  body: string;
  fromName?: string;   // 발신자 이름 (선택)
  replyTo?: string;    // 회신 주소 (선택 — 고객 이메일)
  projectId?: string;
}

function buildTransporter() {
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    return nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: resendKey },
    });
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (smtpHost && smtpUser && smtpPass) {
    return nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: smtpUser, pass: smtpPass },
    });
  }

  return null;
}

function textToHtml(text: string): string {
  return `<div style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#1a1a1a;max-width:640px">${
    text
      .split('\n')
      .map(l => l.trim() === '' ? '<br>' : `<p style="margin:4px 0">${l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`)
      .join('')
  }</div>`;
}

export async function POST(req: NextRequest) {
  const { checkPlan, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'pro');
  if (!planCheck.ok) return planCheck.response;

  const body = await req.json() as SendBody;
  if (!body.to || !body.subject || !body.body) {
    return NextResponse.json({ error: 'to, subject, body are required' }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.to)) {
    return NextResponse.json({ error: '유효하지 않은 이메일 주소입니다.' }, { status: 400 });
  }

  const fromEmail = process.env.NEXYFAB_FROM_EMAIL ?? process.env.SMTP_USER ?? 'nexyfab@nexysys.com';
  const fromName = body.fromName ?? 'NexyFab Procurement';

  const transporter = buildTransporter();
  if (!transporter) {
    return NextResponse.json(
      { error: 'SMTP가 구성되지 않았습니다. RESEND_API_KEY 또는 SMTP_HOST를 환경 변수에 설정하세요.' },
      { status: 503 },
    );
  }

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: body.to,
      replyTo: body.replyTo,
      subject: body.subject,
      text: body.body,
      html: textToHtml(body.body),
    });

    recordUsageEvent(planCheck.userId, 'quote_negotiator');

    return NextResponse.json({
      ok: true,
      messageId: (info as { messageId?: string }).messageId,
    });
  } catch (err) {
    console.error('[send-negotiation-email] SMTP error:', err);
    return NextResponse.json(
      { error: '이메일 발송에 실패했습니다. SMTP 설정을 확인하세요.' },
      { status: 500 },
    );
  }
}
