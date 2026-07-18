/**
 * fab-spec.mjs — 제작 사양서(G5) + 리프팅 계획(G6) 자동 생성 (260718, 실시 트랙).
 *
 * 정직 원칙: 수치는 폐형 산출(표면적=부품별 공식 합·시험압=1.5×설계압 관례 명시·
 * 러그 하중=W/4×충격 1.25 관례 명시). WPS·도장계 제품명·검사 등급은 입력 원칙(날조 금지).
 */
import { structuralCheck } from './structural.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function fabricationSpec(assembly, { title = '제작 사양서', designPressureBar = null, paintSystem = null } = {}) {
  const { computeBOQ } = await import('./boq.mjs');
  const boq = computeBOQ(assembly);
  const totalSurfM2 = boq.surfaceM2 ?? 0;
  const totalMassKg = boq.totalMassKg ?? 0;
  let st = null;
  try { st = structuralCheck(assembly, {}); } catch { /* 정직: 실패 시 리프팅 표 생략 */ }
  // 리프팅(G6): CG 대칭 4점 러그 — 러그당 하중 = W/4 × 충격계수 1.25(관례 명시)
  let lift = '';
  if (st?.cgWorldMm && st?.totalMassKg) {
    const W = st.totalMassKg;
    const per = (W / 4) * 1.25;
    lift = `<h2>리프팅 계획 (검토용 — 러그 상세 설계는 후속)</h2>
<table><tbody>
<tr><td>총 질량(자동 산출·솔리드 가정 과대측)</td><td>${W.toFixed(0)} kg</td></tr>
<tr><td>무게중심 CG (x,y,z)</td><td>(${st.cgWorldMm.map((v) => v.toFixed(0)).join(', ')}) mm</td></tr>
<tr><td>인양점</td><td>상부 프레임 4점(CG 대칭 배치 — 도면 표기 후속)</td></tr>
<tr><td>러그당 설계하중</td><td>${per.toFixed(0)} kgf (=W/4×충격계수 1.25 — 관례, 러그 강도 검토=볼트/피로 계산기 연동 후속)</td></tr>
</tbody></table>`;
  }
  const test = designPressureBar
    ? `<tr><td>수압시험 압력</td><td>${(designPressureBar * 1.5).toFixed(1)} bar (=1.5×설계압 ${designPressureBar} bar — 관례, 적용 코드 확정은 입력)</td></tr>
<tr><td>시험 유지시간</td><td>입력 원칙(코드별 상이 — 자동 부여 금지)</td></tr>`
    : `<tr><td>수압시험</td><td>설계압 미입력 — 압력 지정 시 1.5× 자동 산출</td></tr>`;
  const insp = (assembly.parts ?? []).slice(0, 1).length
    ? `<tr><td>치수 검사 포인트</td><td>전체 외형(L×W×H)·베이스 대각(직각도)·주요 장비 센터 위치 — GA 도면 치수 기준</td></tr>`
    : '';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4;margin:14mm}body{font-family:'Segoe UI','Malgun Gothic',sans-serif;color:#1f2937;max-width:860px;margin:20px auto;padding:0 16px}h1{font-size:18px;border-bottom:2px solid #1f2937;padding-bottom:6px}h2{font-size:14px;margin-top:18px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #cbd5e1;padding:5px 9px;text-align:left}td:first-child{background:#f1f5f9;width:220px}</style></head><body>
<h1>${esc(title)}</h1>
<h2>도장 (물량=표면적 폐형 합산)</h2>
<table><tbody>
<tr><td>도장 대상 표면적</td><td>${totalSurfM2.toFixed(2)} m² (부품별 표면적 공식 합 — 겹침면 미공제 과대측 명시)</td></tr>
<tr><td>도장계(시스템)</td><td>${esc(paintSystem ?? '입력 원칙 — 발주처 사양(예: 에폭시 2회+우레탄 상도)을 지정하세요')}</td></tr>
<tr><td>총 질량(참고)</td><td>${totalMassKg.toFixed(0)} kg (솔리드 가정 과대측)</td></tr>
</tbody></table>
<h2>시험·검사</h2>
<table><tbody>${test}${insp}
<tr><td>용접 검사</td><td>육안 100% + 등급별 NDE는 입력 원칙(코드 확정 필요)</td></tr>
</tbody></table>
${lift}
<div style="font-size:11px;color:#94a3b8;margin-top:16px">nexyfab 자동생성(비법정) — 수치=폐형 산출·관례는 근거 병기, 코드/등급/제품 지정값은 입력 원칙.</div>
</body></html>`;
}
