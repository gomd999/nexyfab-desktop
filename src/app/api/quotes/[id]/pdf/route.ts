import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// Module-level cache: load NanumGothic once per server process
let _koreanFontBase64: string | null = null;
function getKoreanFontBase64(): string | null {
  if (_koreanFontBase64) return _koreanFontBase64;
  try {
    const fontPath = path.join(process.cwd(), 'public/fonts/NanumGothic-Regular.ttf');
    _koreanFontBase64 = fs.readFileSync(fontPath).toString('base64');
    return _koreanFontBase64;
  } catch {
    return null;
  }
}

interface QuoteRow {
  id: string;
  inquiry_id: string | null;
  project_name: string;
  factory_name: string;
  estimated_amount: number;
  details: string;
  valid_until: string | null;
  partner_email: string | null;
  status: string;
  created_at: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();
  const quote = await db.queryOne<QuoteRow>('SELECT * FROM nf_quotes WHERE id = ?', id);

  if (!quote) {
    return NextResponse.json({ error: '견적을 찾을 수 없습니다.' }, { status: 404 });
  }

  // 소유권 확인: admin이거나 해당 RFQ의 소유자만 PDF 다운로드 가능
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin && quote.inquiry_id) {
    const rfq = await db.queryOne<{ user_id: string }>(
      'SELECT user_id FROM nf_rfqs WHERE id = ?', quote.inquiry_id,
    );
    if (!rfq || rfq.user_id !== authUser.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // Generate PDF with jsPDF
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Embed NanumGothic for Korean support
  const koreanFont = getKoreanFontBase64();
  if (koreanFont) {
    doc.addFileToVFS('NanumGothic-Regular.ttf', koreanFont);
    doc.addFont('NanumGothic-Regular.ttf', 'NanumGothic', 'normal');
  }

  // Helper: set appropriate font (Korean-capable if available, else Helvetica)
  const setBodyFont = (style: 'normal' | 'bold' = 'normal') => {
    if (koreanFont) {
      doc.setFont('NanumGothic', 'normal'); // NanumGothic has no bold variant embedded
    } else {
      doc.setFont('helvetica', style);
    }
  };

  const marginLeft = 20;
  const pageWidth = 210;
  const contentWidth = pageWidth - marginLeft * 2;

  // Header background
  doc.setFillColor(15, 23, 42); // #0f172a
  doc.rect(0, 0, pageWidth, 40, 'F');

  // Company name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('NexyFab', marginLeft, 18);

  // Document title
  doc.setFontSize(11);
  setBodyFont();
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text('견적서 / Quotation', marginLeft, 28);

  // Quote ID & Date right-aligned
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text(`Quote #${quote.id}`, pageWidth - marginLeft, 18, { align: 'right' });
  doc.text(new Date(quote.created_at).toLocaleDateString('ko-KR'), pageWidth - marginLeft, 26, { align: 'right' });

  // Reset text color
  doc.setTextColor(15, 23, 42);

  // Status badge area
  const statusColors: Record<string, [number, number, number]> = {
    pending:  [251, 191, 36],
    accepted: [34, 197, 94],
    rejected: [239, 68, 68],
    expired:  [148, 163, 184],
  };
  const [r, g, b] = statusColors[quote.status] ?? [148, 163, 184];
  doc.setFillColor(r, g, b);
  doc.roundedRect(marginLeft, 50, 30, 8, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  const statusLabel: Record<string, string> = { pending: 'PENDING', accepted: 'ACCEPTED', rejected: 'REJECTED', expired: 'EXPIRED' };
  doc.text(statusLabel[quote.status] ?? quote.status.toUpperCase(), marginLeft + 15, 55.5, { align: 'center' });

  // Section: Quote Details
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  setBodyFont('bold');
  doc.text('견적 상세 / Quote Details', marginLeft, 72);

  // Separator line
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(marginLeft, 74, pageWidth - marginLeft, 74);

  // Info table
  const rows: [string, string][] = [
    ['프로젝트명', quote.project_name],
    ['제조사 / 파트너', quote.factory_name || '-'],
    ['견적 금액', `${Number(quote.estimated_amount).toLocaleString('ko-KR')} KRW`],
    ['유효 기간', quote.valid_until || '기간 없음'],
    ['파트너 이메일', quote.partner_email || '-'],
    ['문의 ID', quote.inquiry_id || '-'],
  ];

  doc.setFontSize(10);
  let y = 82;
  for (const [label, value] of rows) {
    setBodyFont('bold');
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(label, marginLeft, y);
    setBodyFont('normal');
    doc.setTextColor(15, 23, 42);
    // Wrap long values
    const wrapped = doc.splitTextToSize(value, contentWidth - 60);
    doc.text(wrapped, marginLeft + 60, y);
    y += 8 * (Array.isArray(wrapped) ? wrapped.length : 1);
    if (y > 250) { doc.addPage(); y = 20; }
  }

  // Details section
  if (quote.details) {
    y += 4;
    setBodyFont('bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('상세 내용 / Details', marginLeft, y);
    doc.setLineWidth(0.3);
    doc.line(marginLeft, y + 2, pageWidth - marginLeft, y + 2);
    y += 8;
    setBodyFont('normal');
    doc.setFontSize(10);
    const detailLines = doc.splitTextToSize(quote.details, contentWidth);
    doc.text(detailLines, marginLeft, y);
  }

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('Generated by NexyFab · nexyfab.com', pageWidth / 2, 287, { align: 'center' });

  const pdfBytes = doc.output('arraybuffer');

  return new NextResponse(pdfBytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="quote-${quote.id}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
