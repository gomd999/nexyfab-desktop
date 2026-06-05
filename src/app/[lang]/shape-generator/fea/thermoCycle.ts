/**
 * thermoCycle.ts — ideal (Carnot) thermodynamic cycle performance between a hot
 * reservoir T_H and cold reservoir T_C (absolute temperatures):
 *
 *   heat engine COP-less:  η = 1 − T_C/T_H
 *   refrigerator:          COP_R  = T_C/(T_H − T_C) = Q_C/W
 *   heat pump:             COP_HP = T_H/(T_H − T_C) = Q_H/W = COP_R + 1
 *   energy balance:        Q_H = Q_C + W
 *
 * Verified against those closed forms, the COP_HP = COP_R + 1 identity, the
 * COP_HP = 1/η relation, the energy balance, and the COP → ∞ limit as T_H → T_C.
 */

/** Carnot heat-engine efficiency η = 1 − T_C/T_H. */
export function carnotEfficiency(TH: number, TC: number): number { return 1 - TC / TH; }

/** Carnot refrigeration COP = T_C/(T_H − T_C). */
export function carnotCOPRefrigeration(TH: number, TC: number): number { return TC / (TH - TC); }

/** Carnot heat-pump COP = T_H/(T_H − T_C). */
export function carnotCOPHeatPump(TH: number, TC: number): number { return TH / (TH - TC); }

/** Refrigeration COP from duty/work: COP_R = Q_C/W. */
export function copRefrigeration(QC: number, W: number): number { return QC / W; }
/** Heat-pump COP from duty/work: COP_HP = Q_H/W. */
export function copHeatPump(QH: number, W: number): number { return QH / W; }
/** Heat rejected to the hot reservoir: Q_H = Q_C + W. */
export function heatRejected(QC: number, W: number): number { return QC + W; }
