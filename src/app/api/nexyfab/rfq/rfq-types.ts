// ─── Types ────────────────────────────────────────────────────────────────────

export interface RFQEntry {
  rfqId: string;
  userId: string;
  userEmail?: string;
  shapeId: string;
  shapeName: string;
  materialId: string;
  quantity: number;
  volume_cm3: number;
  surface_area_cm2: number;
  bbox: { w: number; h: number; d: number };
  dfmResults?: Array<{
    process: string;
    score: number;
    issues: Array<{ severity: string; description: string }>;
  }>;
  costEstimates?: Array<{
    process: string;
    unitCost: number;
    leadTime: string;
    confidence: string;
  }>;
  note?: string;
  deadline?: string;
  preferredFactoryId?: string;
  status: 'pending' | 'assigned' | 'quoted' | 'accepted' | 'rejected';
  assignedFactoryId?: string;
  assignedFactoryName?: string;
  assignedAt?: string;
  quoteAmount?: number;
  manufacturerNote?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Row → RFQEntry ───────────────────────────────────────────────────────────

export function rowToRfq(row: Record<string, unknown>): RFQEntry {
  return {
    rfqId: row.id as string,
    userId: row.user_id as string,
    userEmail: (row.user_email as string) || undefined,
    shapeId: (row.shape_id as string) ?? '',
    shapeName: (row.shape_name as string) ?? '',
    materialId: (row.material_id as string) ?? '',
    quantity: (row.quantity as number) ?? 1,
    volume_cm3: (row.volume_cm3 as number) ?? 0,
    surface_area_cm2: (row.surface_area_cm2 as number) ?? 0,
    bbox: row.bbox ? JSON.parse(row.bbox as string) : { w: 0, h: 0, d: 0 },
    dfmResults: row.dfm_results ? JSON.parse(row.dfm_results as string) : undefined,
    costEstimates: row.cost_estimates ? JSON.parse(row.cost_estimates as string) : undefined,
    note: (row.note as string) || undefined,
    deadline: (row.deadline as string) || undefined,
    preferredFactoryId: (row.preferred_factory_id as string) || undefined,
    status: (row.status as RFQEntry['status']) ?? 'pending',
    assignedFactoryId: (row.assigned_factory_id as string) || undefined,
    assignedFactoryName: (row.assigned_factory_name as string) || undefined,
    assignedAt: row.assigned_at != null ? new Date(row.assigned_at as number).toISOString() : undefined,
    quoteAmount: row.quote_amount != null ? (row.quote_amount as number) : undefined,
    manufacturerNote: (row.manufacturer_note as string) || undefined,
    createdAt: new Date(row.created_at as number).toISOString(),
    updatedAt: new Date(row.updated_at as number).toISOString(),
  };
}
