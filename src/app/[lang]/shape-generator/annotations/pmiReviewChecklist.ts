/**
 * pmiReviewChecklist.ts — Run a PMI (Product Manufacturing
 * Information) review checklist on annotations attached to a 3D CAD
 * model.
 *
 * Per ASME Y14.41 / ISO 16792, MBD (Model Based Definition)
 * deliverables must provide complete PMI:
 *
 *   - Every functional surface has a Ra / Rz callout (or default note).
 *   - Every datum feature is declared once.
 *   - Every FCF references existing datums.
 *   - Every diameter has Ø prefix; every position has zone diameter.
 *   - Critical-to-function (CTF) features have GD&T position or form.
 *   - Notes don't duplicate dimensions ("typ" notes used sparingly).
 *
 * Module returns a structured checklist with pass/fail per item +
 * recommended remediations.
 */

export interface PmiAnnotation {
  id: string;
  kind: 'dimension' | 'gdt' | 'note' | 'surface-finish' | 'datum';
  /** Free text content. */
  text: string;
  /** Linked feature ID. */
  featureId?: string;
  /** Whether on a critical-to-function feature. */
  ctf?: boolean;
}

export interface ModelFeature {
  id: string;
  kind: 'plane' | 'cylinder' | 'cone' | 'sphere' | 'fillet' | 'hole';
  isFunctional: boolean;
  isCTF: boolean;
}

export interface ChecklistItem {
  id: string;
  title: string;
  passed: boolean;
  severity: 'critical' | 'major' | 'minor';
  details?: string;
}

export interface ReviewResult {
  items: ChecklistItem[];
  passedCount: number;
  failedCount: number;
  scorePct: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function runChecklist(features: ModelFeature[], annotations: PmiAnnotation[]): ReviewResult {
  const items: ChecklistItem[] = [];

  // CHK-1: Every functional surface has Ra / Rz callout or default note.
  const hasGlobalRa = annotations.some(a => a.kind === 'note' && /ra\s*\d/i.test(a.text));
  const surfaces = features.filter(f => f.kind === 'plane' && f.isFunctional);
  const surfacesWithRa = surfaces.filter(s =>
    annotations.some(a => a.featureId === s.id && a.kind === 'surface-finish'),
  );
  items.push({
    id: 'CHK-1',
    title: 'Functional surfaces have Ra / Rz callouts',
    passed: hasGlobalRa || surfaces.length === surfacesWithRa.length,
    severity: 'major',
    details: hasGlobalRa ? 'Global Ra note present' : `${surfacesWithRa.length}/${surfaces.length} functional surfaces have callouts.`,
  });

  // CHK-2: Every datum feature declared exactly once.
  const datumCounts = new Map<string, number>();
  for (const a of annotations.filter(x => x.kind === 'datum')) {
    if (!a.featureId) continue;
    datumCounts.set(a.featureId, (datumCounts.get(a.featureId) ?? 0) + 1);
  }
  const duplicates = Array.from(datumCounts.values()).filter(v => v > 1);
  items.push({
    id: 'CHK-2',
    title: 'No duplicate datum declarations',
    passed: duplicates.length === 0,
    severity: 'critical',
    details: duplicates.length === 0 ? undefined : `${duplicates.length} feature(s) have multiple datums.`,
  });

  // CHK-3: Diameter dimensions have Ø prefix.
  const cyls = features.filter(f => f.kind === 'cylinder' || f.kind === 'hole');
  const dimsOnCyls = annotations.filter(a => a.kind === 'dimension' && a.featureId && cyls.some(c => c.id === a.featureId));
  const missingPhi = dimsOnCyls.filter(a => !a.text.includes('Ø') && !a.text.toLowerCase().startsWith('dia'));
  items.push({
    id: 'CHK-3',
    title: 'Diameter callouts have Ø prefix',
    passed: missingPhi.length === 0,
    severity: 'minor',
    details: missingPhi.length === 0 ? undefined : `${missingPhi.length} cylinder/hole dims missing Ø.`,
  });

  // CHK-4: CTF features have GD&T (position or form).
  const ctfFeatures = features.filter(f => f.isCTF);
  const ctfWithGdt = ctfFeatures.filter(f =>
    annotations.some(a => a.featureId === f.id && a.kind === 'gdt'),
  );
  items.push({
    id: 'CHK-4',
    title: 'Critical-to-function features have GD&T',
    passed: ctfFeatures.length === ctfWithGdt.length,
    severity: 'critical',
    details: ctfWithGdt.length === ctfFeatures.length ? undefined : `${ctfFeatures.length - ctfWithGdt.length} CTF feature(s) lack GD&T.`,
  });

  // CHK-5: Notes don't excessively duplicate dim values.
  const typNotes = annotations.filter(a => a.kind === 'note' && /\btyp\.?\b/i.test(a.text));
  items.push({
    id: 'CHK-5',
    title: '"TYP" notes used sparingly',
    passed: typNotes.length <= Math.max(2, annotations.length * 0.1),
    severity: 'minor',
    details: typNotes.length === 0 ? undefined : `${typNotes.length} TYP notes; verify each is necessary.`,
  });

  // CHK-6: Position FCF includes zone diameter.
  const positionFcfs = annotations.filter(a => a.kind === 'gdt' && /position/i.test(a.text));
  const missingZone = positionFcfs.filter(a => !a.text.includes('Ø'));
  items.push({
    id: 'CHK-6',
    title: 'Position FCFs include zone diameter Ø',
    passed: missingZone.length === 0,
    severity: 'major',
    details: missingZone.length === 0 ? undefined : `${missingZone.length} position FCF(s) missing zone Ø.`,
  });

  const passed = items.filter(i => i.passed).length;
  const failed = items.length - passed;
  return {
    items,
    passedCount: passed,
    failedCount: failed,
    scorePct: items.length === 0 ? 0 : (passed / items.length) * 100,
  };
}

// ── Severity-aware sorting ────────────────────────────────────

export function failedBySeverity(result: ReviewResult): ChecklistItem[] {
  const order: ChecklistItem['severity'][] = ['critical', 'major', 'minor'];
  return result.items
    .filter(i => !i.passed)
    .slice()
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}

// ── Custom-rule extension ─────────────────────────────────────

export interface CustomCheck {
  id: string;
  title: string;
  severity: 'critical' | 'major' | 'minor';
  evaluate: (features: ModelFeature[], annotations: PmiAnnotation[]) => { passed: boolean; details?: string };
}

export function runChecklistWithCustom(
  features: ModelFeature[],
  annotations: PmiAnnotation[],
  custom: CustomCheck[] = [],
): ReviewResult {
  const base = runChecklist(features, annotations);
  for (const c of custom) {
    const out = c.evaluate(features, annotations);
    const item: ChecklistItem = { id: c.id, title: c.title, passed: out.passed, severity: c.severity };
    if (out.details !== undefined) item.details = out.details;
    base.items.push(item);
  }
  const passed = base.items.filter(i => i.passed).length;
  return {
    items: base.items,
    passedCount: passed,
    failedCount: base.items.length - passed,
    scorePct: base.items.length === 0 ? 0 : (passed / base.items.length) * 100,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface ReviewSummary {
  totalChecks: number;
  passedCount: number;
  failedCount: number;
  scorePct: number;
  criticalFailures: number;
}

export function summarize(result: ReviewResult): ReviewSummary {
  return {
    totalChecks: result.items.length,
    passedCount: result.passedCount,
    failedCount: result.failedCount,
    scorePct: result.scorePct,
    criticalFailures: result.items.filter(i => !i.passed && i.severity === 'critical').length,
  };
}
