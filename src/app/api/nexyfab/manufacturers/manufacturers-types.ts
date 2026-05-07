// ─── Types ────────────────────────────────────────────────────────────────────

export interface Manufacturer {
  id: string;
  name: string;
  nameKo: string;
  region: string;
  processes: string[];
  minLeadTime: number; // days
  maxLeadTime: number;
  rating: number; // 1-5
  reviewCount: number;
  priceLevel: 'low' | 'medium' | 'high';
  certifications: string[];
  description: string;
  descriptionKo: string;
}
