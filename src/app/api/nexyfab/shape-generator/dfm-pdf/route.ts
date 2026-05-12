/**
 * B1 — DFM analysis PDF report endpoint.
 *
 * Client-side DFM analysis runs in the browser and produces DFMResult
 * structs. This endpoint takes those results + a few context fields
 * (project name, geometry stats) and renders an A4 PDF report the
 * user can attach to a quote request or send to a manufacturing partner.
 *
 * Reuses the NanumGothic font + jsPDF pattern from /api/quotes/[id]/pdf.
 * Auth required (PDFs may contain customer-specific data); plan gate
 * is light — free users get the report watermarked, Pro+ get clean.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkPlan } from '@/lib/plan-guard';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

interface DFMIssueIn {
  process: string;
  type: string;
  severity: 'error' | 'warning' | 'info';
  description: string;
  suggestion: string;
}

interface DFMResultIn {
  process: string;
  score: number;
  feasible: boolean;
  estimatedDifficulty: string;
  issues: DFMIssueIn[];
}

interface PdfRequestBody {
  projectName?: string;
  results: DFMResultIn[];
  geometry?: {
    volume_cm3?: number;
    surface_area_cm2?: number;
    bbox?: { w: number; h: number; d: number };
    triangleCount?: number;
  };
  generatedAt?: string;
}

function validateBody(body: unknown): body is PdfRequestBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.results)) return false;
  for (const r of b.results) {
    if (!r || typeof r !== 'object') return false;
    const rr = r as Record<string, unknown>;
    if (typeof rr.process !== 'string' || typeof rr.score !== 'number') return false;
    if (!Array.isArray(rr.issues)) return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;
  const watermark = planCheck.plan === 'free';

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!validateBody(body)) {
    return NextResponse.json({ error: 'invalid body shape' }, { status: 400 });
  }

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const koreanFont = getKoreanFontBase64();
  if (koreanFont) {
    doc.addFileToVFS('NanumGothic-Regular.ttf', koreanFont);
    doc.addFont('NanumGothic-Regular.ttf', 'NanumGothic', 'normal');
  }
  const setFont = (style: 'normal' | 'bold' = 'normal') => {
    if (koreanFont) doc.setFont('NanumGothic', 'normal');
    else doc.setFont('helvetica', style);
  };

  const margin = 18;
  const pageW = 210;
  const contentW = pageW - margin * 2;

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 36, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('NexyFab', margin, 16);
  doc.setFontSize(10);
  setFont();
  doc.setTextColor(148, 163, 184);
  doc.text('DFM Analysis Report / 제조 가능성 보고서', margin, 25);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.text(new Date(body.generatedAt ?? Date.now()).toLocaleString('ko-KR'), pageW - margin, 16, { align: 'right' });
  doc.text(`User: ${auth.userId.slice(0, 8)}…`, pageW - margin, 22, { align: 'right' });

  let y = 48;

  // Project info
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(13);
  setFont('bold');
  doc.text(body.projectName ?? 'Untitled Project', margin, y);
  y += 8;

  if (body.geometry) {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    setFont();
    const g = body.geometry;
    const facts = [
      g.bbox && `BBox: ${g.bbox.w.toFixed(1)} × ${g.bbox.h.toFixed(1)} × ${g.bbox.d.toFixed(1)} mm`,
      typeof g.volume_cm3 === 'number' && `Volume: ${g.volume_cm3.toFixed(2)} cm³`,
      typeof g.surface_area_cm2 === 'number' && `Surface: ${g.surface_area_cm2.toFixed(2)} cm²`,
      typeof g.triangleCount === 'number' && `${g.triangleCount.toLocaleString()} triangles`,
    ].filter(Boolean) as string[];
    doc.text(facts.join('  ·  '), margin, y);
    y += 8;
  }

  // Results table
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  for (const result of body.results) {
    if (y > 260) {
      doc.addPage();
      y = 24;
    }

    // Process header
    doc.setFontSize(11);
    setFont('bold');
    doc.setTextColor(15, 23, 42);
    doc.text(result.process.toUpperCase(), margin, y);

    // Score badge
    const scoreColor = result.score >= 80 ? [34, 197, 94]
                     : result.score >= 55 ? [251, 191, 36]
                     : [239, 68, 68];
    doc.setFillColor(scoreColor[0], scoreColor[1], scoreColor[2]);
    doc.roundedRect(margin + 60, y - 5, 28, 7, 1.5, 1.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.text(`${result.score.toFixed(0)} / 100`, margin + 74, y, { align: 'center' });

    doc.setFontSize(9);
    setFont();
    doc.setTextColor(100, 116, 139);
    doc.text(`${result.feasible ? '✓ Feasible' : '✕ Not feasible'} · ${result.estimatedDifficulty}`, margin + 95, y);

    y += 8;

    if (result.issues.length === 0) {
      doc.setFontSize(9);
      setFont();
      doc.setTextColor(34, 197, 94);
      doc.text('  No issues detected.', margin, y);
      y += 8;
    } else {
      for (const issue of result.issues) {
        if (y > 275) {
          doc.addPage();
          y = 24;
        }
        const sevColor = issue.severity === 'error' ? [239, 68, 68]
                       : issue.severity === 'warning' ? [251, 191, 36]
                       : [59, 130, 246];
        doc.setFillColor(sevColor[0], sevColor[1], sevColor[2]);
        doc.circle(margin + 2, y - 1.5, 1.2, 'F');

        doc.setFontSize(9);
        setFont('bold');
        doc.setTextColor(15, 23, 42);
        doc.text(`[${issue.severity}] ${issue.type}`, margin + 6, y);
        y += 5;

        setFont();
        doc.setTextColor(71, 85, 105);
        const desc = doc.splitTextToSize(issue.description, contentW - 6);
        doc.text(desc, margin + 6, y);
        y += desc.length * 4 + 1;

        doc.setTextColor(100, 116, 139);
        const sug = doc.splitTextToSize(`→ ${issue.suggestion}`, contentW - 6);
        doc.text(sug, margin + 6, y);
        y += sug.length * 4 + 4;
      }
    }
    y += 4;
  }

  // Watermark for free plan
  if (watermark) {
    doc.setTextColor(200, 200, 200);
    doc.setFontSize(40);
    setFont('bold');
    doc.text('FREE PLAN', pageW / 2, 150, {
      align: 'center',
      angle: 30,
    });
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    setFont();
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} / ${pageCount}  ·  Generated by NexyFab`, pageW / 2, 290, { align: 'center' });
  }

  const pdfBytes = doc.output('arraybuffer');
  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="dfm-${Date.now()}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
