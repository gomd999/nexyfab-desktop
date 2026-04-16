'use client';

import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { simDict } from './simulatorDict';
import { useToast } from '@/components/ToastProvider';

// ─── 공급망 리스크 시나리오 ──────────────────────────────────
interface RiskScenario {
    id: string;
    name: string;
    icon: string;
    description: string;
    impacts: {
        tariff_delta: number;
        shipping_delta: number;
        labor_delta: number;
        material_delta: number;
        lead_time_delta: number;
    };
}

const RISK_SCENARIOS: RiskScenario[] = [
    { id: 'us_china_tariff', name: '미중 관세전쟁', icon: '⚔️', description: '미국이 중국산 제품에 추가 25% 관세 부과', impacts: { tariff_delta: 25, shipping_delta: 10, labor_delta: 0, material_delta: 5, lead_time_delta: 0 } },
    { id: 'port_strike', name: '항만 파업', icon: '⚓', description: '부산/상하이 항만 2주 파업으로 물류 대란', impacts: { tariff_delta: 0, shipping_delta: 80, labor_delta: 0, material_delta: 0, lead_time_delta: 21 } },
    { id: 'energy_crisis', name: '에너지 위기', icon: '⚡', description: '전기료 50% 급등 (우크라이나 사태급)', impacts: { tariff_delta: 0, shipping_delta: 30, labor_delta: 0, material_delta: 15, lead_time_delta: 0 } },
    { id: 'supply_shortage', name: '부품 공급 부족', icon: '💾', description: '핵심 부품 공급 차질, 원자재 30% 상승', impacts: { tariff_delta: 0, shipping_delta: 0, labor_delta: 0, material_delta: 30, lead_time_delta: 60 } },
    { id: 'currency_shock', name: '환율 급변동', icon: '💱', description: 'KRW/USD 20% 절하 (외환위기 시나리오)', impacts: { tariff_delta: 0, shipping_delta: 0, labor_delta: 20, material_delta: 20, lead_time_delta: 0 } },
    { id: 'climate_disaster', name: '자연재해', icon: '🌊', description: '주요 생산지 자연재해로 공장 2개월 가동 중단', impacts: { tariff_delta: 0, shipping_delta: 40, labor_delta: 0, material_delta: 25, lead_time_delta: 90 } },
];

// ─── 산업별 특화 프리셋 ──────────────────────────────────────
const INDUSTRY_SPECIAL_PRESETS: Record<string, {
    name: string; yield_rate?: number; traceability_cost_per_unit?: number;
    validation_cost?: number; ppap_cost?: number;
    special_certifications: string[]; certification_costs: Record<string, number>;
    special_fields?: Record<string, any>;
}> = {
    semiconductor: { name: '반도체 패키징', yield_rate: 0.92, special_certifications: ['AEC-Q100', 'IATF-16949'], certification_costs: { 'AEC-Q100': 45000000, 'IATF-16949': 30000000 }, special_fields: { package_type: ['QFN', 'BGA', 'LGA', 'DIP'] } },
    medical_device: { name: '의료기기', traceability_cost_per_unit: 500, validation_cost: 50000000, special_certifications: ['FDA-510k', 'CE-MDR', 'ISO-13485', 'KFDA'], certification_costs: { 'FDA-510k': 80000000, 'CE-MDR': 60000000, 'ISO-13485': 25000000, 'KFDA': 20000000 }, special_fields: { device_class: ['Class I', 'Class II', 'Class III'], sterilization_method: ['EO', 'Gamma', 'Autoclave', 'None'] } },
    automotive_tier: { name: '자동차 부품 (Tier)', ppap_cost: 15000000, special_certifications: ['IATF-16949', 'VDA-6.3', 'PPAP'], certification_costs: { 'IATF-16949': 30000000, 'VDA-6.3': 12000000, 'PPAP': 15000000 }, special_fields: { oem_target: ['Hyundai/Kia', 'GM', 'Toyota', 'BMW', 'Tesla'], tier_level: ['Tier 1', 'Tier 2', 'Tier 3'] } }
};

const db = {
    industry_examples: {
        electronics: [
            { id: "PCBA", name: "Main Board (PCBA)", price: 45000, origin: "CN", energy: 2.5, hs: "8517.71", weight: 0.15 },
            { id: "Panel", name: "Display Panel", price: 30000, origin: "KR", energy: 3.0, hs: "8524.11", weight: 0.35 },
            { id: "Battery", name: "Li-ion Battery", price: 15000, origin: "CN", energy: 5.5, hs: "8507.60", weight: 0.22 },
            { id: "Sensor", name: "CMOS Sensor", price: 35000, origin: "KR", energy: 0.8, hs: "9031.80", weight: 0.05 },
            { id: "Case", name: "Metal Case", price: 20000, origin: "CN", energy: 1.2, hs: "3926.90", weight: 0.12 }
        ],
        automotive: [
            { id: "ECU", name: "Vehicle ECU", price: 85000, origin: "CN", energy: 4.5, hs: "8537.10", weight: 0.8 },
            { id: "BatteryP", name: "48V Battery Pack", price: 450000, origin: "KR", energy: 15.0, hs: "8507.60", weight: 12.5 },
            { id: "Module", name: "LED Lamp Module", price: 65000, origin: "CN", energy: 2.2, hs: "8512.20", weight: 1.4 },
            { id: "Brake", name: "Brake System", price: 120000, origin: "CN", energy: 8.5, hs: "8708.30", weight: 5.2 },
            { id: "SensorA", name: "ADAS Sensor", price: 180000, origin: "KR", energy: 1.2, hs: "9014.20", weight: 0.3 }
        ],
        machinery: [
            { id: "Motor", name: "Servo Motor", price: 150000, origin: "CN", energy: 7.5, hs: "8501.52", weight: 4.5 },
            { id: "Pump", name: "Hydraulic Pump", price: 220000, origin: "KR", energy: 12.0, hs: "8413.70", weight: 8.2 },
            { id: "Controller", name: "PLC Controller", price: 180000, origin: "KR", energy: 3.5, hs: "8537.10", weight: 1.2 },
            { id: "FrameM", name: "Cast Iron Frame", price: 80000, origin: "CN", energy: 25.0, hs: "8483.90", weight: 45.0 },
            { id: "Valve", name: "Pressure Valve", price: 45000, origin: "KR", energy: 2.5, hs: "8481.20", weight: 2.1 }
        ],
        medical: [
            { id: "SensorM", name: "Biosensor Array", price: 120000, origin: "CN", energy: 0.5, hs: "9033.00", weight: 0.02 },
            { id: "Optical", name: "Laser Diode", price: 85000, origin: "KR", energy: 1.5, hs: "9013.20", weight: 0.1 },
            { id: "PumpM", name: "Infusion Pump Unit", price: 180000, origin: "KR", energy: 4.2, hs: "9018.90", weight: 0.8 },
            { id: "DisplayM", name: "High-Res Monitor", price: 350000, origin: "KR", energy: 6.0, hs: "8528.52", weight: 2.5 },
            { id: "CasingM", name: "Antimicrobial Case", price: 45000, origin: "CN", energy: 1.8, hs: "3926.90", weight: 0.5 }
        ],
        plastic: [
            { id: "Pellet", name: "Polymer Resin", price: 2500, origin: "CN", energy: 15.0, hs: "3901.10", weight: 1.0 },
            { id: "MoldP", name: "Precision Mold", price: 1500000, origin: "KR", energy: 35.0, hs: "8480.71", weight: 120.0 },
            { id: "Additive", name: "UV Stabilizer", price: 8000, origin: "CN", energy: 2.0, hs: "3812.20", weight: 0.5 },
            { id: "Heat", name: "Heating Element", price: 12000, origin: "CN", energy: 4.5, hs: "8516.80", weight: 0.2 }
        ],
        furniture: [
            { id: "Wood", name: "MDF Panel", price: 15000, origin: "CN", energy: 8.0, hs: "4411.12", weight: 5.5 },
            { id: "Fabric", name: "Upholstery Textile", price: 25000, origin: "CN", energy: 4.5, hs: "5407.52", weight: 1.2 },
            { id: "Foam", name: "PU Foam", price: 12000, origin: "KR", energy: 12.0, hs: "3921.13", weight: 2.5 },
            { id: "Spring", name: "Pocket Spring Set", price: 45000, origin: "CN", energy: 6.5, hs: "7320.20", weight: 8.0 },
            { id: "Gas", name: "Gas Lift Cylinder", price: 180000, origin: "KR", energy: 3.0, hs: "8412.31", weight: 1.5 }
        ],
        textiles: [
            { id: "Yarn", name: "Poly Yarn", price: 3500, origin: "CN", energy: 12.0, hs: "5402.33", weight: 1.0 },
            { id: "Dye", name: "Acid Dye", price: 12000, origin: "CN", energy: 3.5, hs: "3204.11", weight: 0.2 },
            { id: "Zipper", name: "Metal Zipper", price: 1200, origin: "CN", energy: 1.2, hs: "9606.10", weight: 0.05 },
            { id: "Label", name: "Woven Label", price: 500, origin: "KR", energy: 0.5, hs: "5807.10", weight: 0.01 }
        ],
        chemicals: [
            { id: "BaseC", name: "Primary Chemical", price: 12000, origin: "CN", energy: 45.0, hs: "2815.11", weight: 200.0 },
            { id: "Reactive", name: "Active Solvent", price: 45000, origin: "KR", energy: 25.0, hs: "2901.10", weight: 15.0 },
            { id: "Drum", name: "Steel Barrel", price: 35000, origin: "CN", energy: 5.5, hs: "7310.10", weight: 20.0 },
            { id: "Filter", name: "Nano Filter", price: 180000, origin: "KR", energy: 3.2, hs: "8421.21", weight: 0.8 }
        ],
        food: [
            { id: "Grain", name: "Raw Grain Batch", price: 1500, origin: "CN", energy: 5.0, hs: "1001.99", weight: 10.0 },
            { id: "Flavor", name: "Natural Extract", price: 12000, origin: "KR", energy: 2.0, hs: "3302.10", weight: 0.5 },
            { id: "PackageF", name: "Eco Al-Pouch", price: 400, origin: "CN", energy: 1.5, hs: "7607.19", weight: 0.02 },
            { id: "Preserv", name: "Safe Additive", price: 3500, origin: "CN", energy: 1.0, hs: "2916.31", weight: 0.1 }
        ],
        beauty: [
            { id: "Essence", name: "Active Serum Base", price: 25000, origin: "KR", energy: 3.5, hs: "3304.99", weight: 0.2 },
            { id: "GlassB", name: "Premium Glass Bottle", price: 1200, origin: "CN", energy: 8.0, hs: "7010.90", weight: 0.15 },
            { id: "PumpB", name: "Fine Mist Sprayer", price: 800, origin: "KR", energy: 1.2, hs: "8424.89", weight: 0.03 },
            { id: "BoxB", name: "FSC Paper Box", price: 350, origin: "CN", energy: 0.5, hs: "4819.20", weight: 0.02 }
        ],
        toys: [
            { id: "PlasticT", name: "ABS Resin Toy", price: 5500, origin: "CN", energy: 12.0, hs: "9503.00", weight: 0.4 },
            { id: "ElecT", name: "Sound/Light Chip", price: 1500, origin: "CN", energy: 0.8, hs: "8542.39", weight: 0.02 },
            { id: "TextileT", name: "Soft Plush Fabric", price: 3500, origin: "CN", energy: 4.5, hs: "9503.00", weight: 0.3 }
        ],
        metal: [
            { id: "SteelS", name: "SS304 Sheet", price: 4500, origin: "CN", energy: 25.0, hs: "7219.33", weight: 1.0 },
            { id: "AlumE", name: "Aluminum Extrusion", price: 6500, origin: "KR", energy: 35.5, hs: "7604.29", weight: 1.0 },
            { id: "CopperW", name: "Refined Copper Wire", price: 12000, origin: "CN", energy: 15.0, hs: "7408.11", weight: 1.0 }
        ],
        footwear: [
            { id: "UpperS", name: "Mesh/Leather Upper", price: 12000, origin: "CN", energy: 5.5, hs: "6406.10", weight: 0.15 },
            { id: "SoleS", name: "EVA Midsole", price: 4500, origin: "KR", energy: 15.0, hs: "6406.20", weight: 0.12 },
            { id: "GlueS", name: "Eco Adhesive", price: 2500, origin: "CN", energy: 2.5, hs: "3506.91", weight: 0.05 }
        ],
        luxury: [
            { id: "MoveL", name: "Auto Movement", price: 250000, origin: "CN", energy: 0.5, hs: "9108.11", weight: 0.03 },
            { id: "SappL", name: "Sapphire Crystal", price: 45000, origin: "KR", energy: 5.0, hs: "7020.00", weight: 0.02 },
            { id: "GoldL", name: "18K Gold Plating", price: 85000, origin: "CN", energy: 1.2, hs: "7117.19", weight: 0.01 }
        ]
    },
    locations: {
        KR: { labor: 14640, carbon_kg: 0.45, risk: 85, name: "KOREA",   flag: "🇰🇷", resilience: 92, elec: 150, water: 1200, rent: 45000, lead_time_days: 10, strengths: ["고품질 인프라", "첨단기술 클러스터", "FTA 네트워크"], risks: ["높은 인건비", "고령화 노동력"] },
        CN: { labor: 6075,  carbon_kg: 0.61, risk: 65, name: "CHINA",   flag: "🇨🇳", resilience: 72, elec: 110, water: 800,  rent: 22000, lead_time_days: 15, strengths: ["공급망 완결성", "규모의 경제", "풍부한 숙련공"], risks: ["지정학 리스크", "높은 탄소배출"] },
        VN: { labor: 3200,  carbon_kg: 0.52, risk: 72, name: "VIETNAM", flag: "🇻🇳", resilience: 72, elec: 85,  water: 400,  rent: 18000, lead_time_days: 25, strengths: ["저인건비", "縫製/전자 강점", "성장하는 인프라"], risks: ["인프라 미성숙", "숙련공 부족"] },
        IN: { labor: 2800,  carbon_kg: 0.71, risk: 68, name: "INDIA",   flag: "🇮🇳", resilience: 68, elec: 95,  water: 350,  rent: 15000, lead_time_days: 35, strengths: ["IT/정밀가공 강점", "영어 소통", "대규모 내수"], risks: ["물류 인프라 약점", "관료주의"] },
        MX: { labor: 4500,  carbon_kg: 0.47, risk: 75, name: "MEXICO",  flag: "🇲🇽", resilience: 75, elec: 120, water: 600,  rent: 25000, lead_time_days: 20, strengths: ["미국 인접", "USMCA 혜택", "자동차 클러스터"], risks: ["치안 불안", "카르텔 리스크"] },
        TH: { labor: 3800,  carbon_kg: 0.49, risk: 78, name: "THAILAND",flag: "🇹🇭", resilience: 78, elec: 100, water: 450,  rent: 20000, lead_time_days: 22, strengths: ["자동차/전자 클러스터", "안정적 인프라", "ASEAN 허브"], risks: ["정치 불안", "수해 리스크"] },
    },
    destinations: {
        KR: { duty: { KR: 0.0, CN: 0.08, VN: 0.05, IN: 0.08, MX: 0.08, TH: 0.05, electronics: 0.0, automotive: 0.08, machinery: 0.0, medical: 0.0, plastic: 0.065, furniture: 0.08, textiles: 0.13, chemicals: 0.05, food: 0.15, beauty: 0.065, toys: 0.08, metal: 0.05, footwear: 0.13, luxury: 0.20 }, cbam_tax: 0, lt: { KR: 1, CN: 3, VN: 7, IN: 18, MX: 30, TH: 10 }, vat: 0.10, ship_sea: { KR: 5000, CN: 45000, VN: 40000, IN: 90000, MX: 250000, TH: 50000 }, ship_air: { KR: 15000, CN: 120000, VN: 110000, IN: 200000, MX: 550000, TH: 130000 } },
        US: { duty: { KR: 0.0, CN: 0.25, VN: 0.12, IN: 0.05, MX: 0.0, TH: 0.08, electronics: 0.02, automotive: 0.025, machinery: 0.01, medical: 0.0, plastic: 0.053, furniture: 0.01, textiles: 0.16, chemicals: 0.035, food: 0.10, beauty: 0.0, toys: 0.0, metal: 0.02, footwear: 0.20, luxury: 0.05 }, cbam_tax: 0, lt: { KR: 14, CN: 21, VN: 20, IN: 28, MX: 7, TH: 22 }, vat: 0.00, ship_sea: { KR: 150000, CN: 180000, VN: 170000, IN: 220000, MX: 80000, TH: 175000 }, ship_air: { KR: 450000, CN: 550000, VN: 520000, IN: 650000, MX: 250000, TH: 530000 } },
        EU: { duty: { KR: 0.0, CN: 0.05, VN: 0.05, IN: 0.05, MX: 0.05, TH: 0.05, electronics: 0.0, automotive: 0.03, machinery: 0.017, medical: 0.0, plastic: 0.065, furniture: 0.0, textiles: 0.12, chemicals: 0.06, food: 0.12, beauty: 0.0, toys: 0.04, metal: 0.02, footwear: 0.16, luxury: 0.05 }, cbam_tax: 45, lt: { KR: 28, CN: 30, VN: 28, IN: 25, MX: 35, TH: 28 }, vat: 0.19, ship_sea: { KR: 170000, CN: 200000, VN: 190000, IN: 180000, MX: 280000, TH: 195000 }, ship_air: { KR: 500000, CN: 650000, VN: 600000, IN: 580000, MX: 800000, TH: 610000 } },
        JP: { duty: { KR: 0.0, CN: 0.03, VN: 0.0, IN: 0.03, MX: 0.03, TH: 0.0, electronics: 0.0, automotive: 0.0, machinery: 0.0, medical: 0.0, plastic: 0.03, furniture: 0.02, textiles: 0.09, chemicals: 0.03, food: 0.10, beauty: 0.0, toys: 0.0, metal: 0.0, footwear: 0.08, luxury: 0.0 }, cbam_tax: 0, lt: { KR: 3, CN: 5, VN: 6, IN: 15, MX: 25, TH: 7 }, vat: 0.10, ship_sea: { KR: 25000, CN: 40000, VN: 45000, IN: 100000, MX: 220000, TH: 50000 }, ship_air: { KR: 80000, CN: 120000, VN: 115000, IN: 260000, MX: 600000, TH: 130000 } },
        TW: { duty: { KR: 0.0, CN: 0.05, VN: 0.05, IN: 0.05, MX: 0.05, TH: 0.03, electronics: 0.0, automotive: 0.05, machinery: 0.02, medical: 0.0, plastic: 0.05, furniture: 0.05, textiles: 0.10, chemicals: 0.04, food: 0.15, beauty: 0.05, toys: 0.05, metal: 0.05, footwear: 0.10, luxury: 0.10 }, cbam_tax: 0, lt: { KR: 4, CN: 3, VN: 5, IN: 12, MX: 25, TH: 4 }, vat: 0.05, ship_sea: { KR: 20000, CN: 15000, VN: 18000, IN: 70000, MX: 200000, TH: 20000 }, ship_air: { KR: 70000, CN: 50000, VN: 55000, IN: 180000, MX: 550000, TH: 60000 } },
        VN: { duty: { KR: 0.05, CN: 0.0, VN: 0.0, IN: 0.05, MX: 0.08, TH: 0.0, electronics: 0.05, automotive: 0.15, machinery: 0.05, medical: 0.05, plastic: 0.10, furniture: 0.15, textiles: 0.20, chemicals: 0.10, food: 0.20, beauty: 0.15, toys: 0.10, metal: 0.10, footwear: 0.20, luxury: 0.30 }, cbam_tax: 0, lt: { KR: 7, CN: 2, VN: 1, IN: 18, MX: 35, TH: 5 }, vat: 0.10, ship_sea: { KR: 45000, CN: 12000, VN: 5000, IN: 80000, MX: 270000, TH: 15000 }, ship_air: { KR: 140000, CN: 45000, VN: 20000, IN: 200000, MX: 700000, TH: 50000 } },
        CA: { duty: { KR: 0.0, CN: 0.15, VN: 0.12, IN: 0.05, MX: 0.0, TH: 0.1, electronics: 0.0, automotive: 0.06, machinery: 0.0, medical: 0.0, plastic: 0.06, furniture: 0.085, textiles: 0.17, chemicals: 0.05, food: 0.10, beauty: 0.06, toys: 0.05, metal: 0.05, footwear: 0.18, luxury: 0.10 }, cbam_tax: 0, lt: { KR: 18, CN: 25, VN: 22, IN: 30, MX: 8, TH: 25 }, vat: 0.13, ship_sea: { KR: 180000, CN: 210000, VN: 200000, IN: 250000, MX: 90000, TH: 205000 }, ship_air: { KR: 550000, CN: 680000, VN: 640000, IN: 780000, MX: 280000, TH: 650000 } }
    },
    certifications: {
        KC: { name: "KC (한국)", cost: 5000000 },
        CE: { name: "CE (유럽)", cost: 8000000 },
        FCC: { name: "FCC (북미)", cost: 4500000 },
        PSE: { name: "PSE (일본)", cost: 6000000 },
        BSMI: { name: "BSMI (대만)", cost: 5500000 },
        CR: { name: "CR (베트남)", cost: 4000000 }
    },
    qc_levels: {
        basic: { name: "Standard QC", rate: 0.02, cost_per_unit: 500 },
        premium: { name: "Premium (AQL 0.4)", rate: 0.005, cost_per_unit: 2500 }
    },
    tooling_costs: {
        electronics: { mold: 15000000, jig: 10000000, overhead: 0.12, precision: 'high', risk: 'low' },
        automotive: { mold: 45000000, jig: 25000000, overhead: 0.18, precision: 'very_high', risk: 'med' },
        machinery: { mold: 35000000, jig: 50000000, overhead: 0.15, precision: 'high', risk: 'med' },
        medical: { mold: 60000000, jig: 40000000, overhead: 0.25, precision: 'ultra_high', risk: 'high' },
        plastic: { mold: 25000000, jig: 5000000, overhead: 0.08, precision: 'low', risk: 'low' },
        furniture: { mold: 12000000, jig: 8000000, overhead: 0.10, precision: 'low', risk: 'low' },
        textiles: { mold: 2000000, jig: 15000000, overhead: 0.05, precision: 'med', risk: 'low' },
        chemicals: { mold: 0, jig: 85000000, overhead: 0.30, precision: 'high', risk: 'ultra_high' },
        food: { mold: 5000000, jig: 20000000, overhead: 0.10, precision: 'low', risk: 'med' },
        beauty: { mold: 15000000, jig: 10000000, overhead: 0.15, precision: 'med', risk: 'low' },
        toys: { mold: 25000000, jig: 5000000, overhead: 0.08, precision: 'low', risk: 'med' },
        metal: { mold: 8000000, jig: 35000000, overhead: 0.12, precision: 'med', risk: 'med' },
        footwear: { mold: 10000000, jig: 15000000, overhead: 0.08, precision: 'low', risk: 'low' },
        luxury: { mold: 50000000, jig: 30000000, overhead: 0.40, precision: 'ultra_high', risk: 'high' }
    },
    hs_suggestions: [
        // 1. Electronics (85)
        { code: "8517.13", name: "Smartphone / 스마트폰 / 智能手机 / スマートフォン" },
        { code: "8471.30", name: "Laptop / 노트북 / 笔记本电脑 / ノートパソコン" },
        { code: "8517.71", name: "PCBA / 메인보드 / 电路板 / プリント基板" },
        { code: "8524.11", name: "Display Panel / 디스플레이 패널 / 显示面板 / ディスプレイパネル" },
        { code: "8523.51", name: "SSD / 솔리드 스테이트 드라이브 / 固态硬盘 / SSD" },
        { code: "8542.31", name: "Processor / CPU / 处理器 / プロセッサ" },
        { code: "8542.32", name: "Memory / 메모리 / 内存 / メモリ" },
        { code: "8504.40", name: "Adapter / 어댑터 / 电源适配器 / アダプタ" },
        { code: "8518.30", name: "Headphones / 헤드폰 / 耳机 / ヘッドフォン" },
        { code: "8525.89", name: "Digital Camera / 디지털 카메라 / 数码相机 / デジタルカメラ" },
        { code: "8528.52", name: "Monitor / 모니터 / 显示器 / モニター" },
        { code: "8507.60", name: "Lithium Battery / 리튬 배터리 / 锂电池 / 蓄電池" },
        { code: "8544.42", name: "USB Cable / USB 케이블 / USB数据线 / USBケーブル" },
        { code: "8471.60", name: "Mouse/Keyboard / 마우스/키보드 / 鼠标/键盘 / マウス/キーボード" },
        { code: "8519.81", name: "Audio Player / 오디오 플레이어 / 音频播放器 / オーディオプレーヤー" },
        { code: "8527.13", name: "Radio / 라디오 / 收音机 / ラジオ" },
        { code: "8531.20", name: "LCD Module / LCD 모듈 / 液晶模块 / 液晶モジュール" },
        { code: "8534.00", name: "PCB / 인쇄회로기판 / 印刷电路板 / プリント基板" },
        { code: "8536.50", name: "Switch / 스위치 / 开关 / スイッチ" },
        { code: "8537.10", name: "Control Panel / 제어 패널 / 控制面板 / 制御パネル" },
        { code: "8538.90", name: "Parts for Switch / 스위치 부속 / 开关零件 / スイッチ部品" },
        { code: "8532.22", name: "Electrolytic Capacitor / 전해 커패시터 / 电解电容器 / 電解コンデンサ" },
        { code: "8533.21", name: "Fixed Resistor / 고정 저항기 / 固定电阻器 / 固定抵抗器" },
        { code: "8541.10", name: "Diode / 다이오드 / 二极管 / ダイオード" },
        { code: "8541.21", name: "Transistor / 트랜지스터 / 三极管 / トランジスタ" },
        { code: "8541.41", name: "LED / 발광 다이오드 / LED芯片 / LEDチップ" },
        { code: "8543.70", name: "Electronic Cigarette / 전자담배 / 电子烟 / 電子タバコ" },
        { code: "8545.11", name: "Carbon Electrode / 탄소 전극 / 碳电极 / 炭素電極" },
        { code: "8546.20", name: "Ceramic Insulator / 애자 / 陶瓷绝缘子 / がいし" },
        { code: "8548.00", name: "Electrical Waste / 전자 폐기물 / 电子废料 / 電子リサイクル" },

        // 2. Machinery (84)
        { code: "8412.21", name: "Hydraulic Motor / 유압 모터 / 液压马达 / 油圧モーター" },
        { code: "8413.30", name: "Fuel Pump / 연료 펌프 / 燃油泵 / 燃料ポンプ" },
        { code: "8413.70", name: "Centrifugal Pump / 원심 펌프 / 离心泵 / 遠心ポンプ" },
        { code: "8414.10", name: "Vacuum Pump / 진공 펌프 / 真空泵 / 真空ポンプ" },
        { code: "8414.51", name: "Fan / 팬/송풍기 / 风扇 / 扇風機" },
        { code: "8414.80", name: "Air Compressor / 에어 컴프레셔 / 空气压缩机 / コンプレッサー" },
        { code: "8415.10", name: "Air Conditioner / 에어컨 / 空调 / エアコン" },
        { code: "8418.10", name: "Refrigerator / 냉장고 / 冰箱 / 冷蔵庫" },
        { code: "8419.81", name: "Hot Drink Machine / 온음료 제조기 / 热饮机 / 温飲料製造機" },
        { code: "8421.21", name: "Water Filter / 정수기 필터 / 净水器滤芯 / 浄水フィルター" },
        { code: "8421.23", name: "Oil Filter / 오일 필터 / 机油滤清器 / オイルフィルター" },
        { code: "8421.31", name: "Air Filter / 에어 필터 / 空气滤清器 / エアフィルター" },
        { code: "8422.30", name: "Packing Machine / 포장 기계 / 包装机 / 包装機" },
        { code: "8424.89", name: "Sprayer / 분무기 / 喷雾器 / 噴霧器" },
        { code: "8427.10", name: "Electric Forklift / 전기 지게차 / 电动叉车 / 電動フォークリフト" },
        { code: "8428.10", name: "Lift/Elevator / 승강기 / 电梯 / エレベーター" },
        { code: "8429.51", name: "Front-end Shovel / 프론트 엔드 셔블 / 装载机 / シャベルカー" },
        { code: "8431.43", name: "Drilling Parts / 시추기 부품 / 钻探零件 / 掘削機部品" },
        { code: "8443.31", name: "Printer/Copier / 프린터/복사기 / 打印机/复印机 / プリンター" },
        { code: "8450.11", name: "Washing Machine / 세탁기 / 洗衣机 / 洗濯機" },
        { code: "8452.10", name: "Sewing Machine / 재봉기 / 缝纫机 / ミシン" },
        { code: "8458.11", name: "Lathe / 선반 / 车床 / 旋盤" },
        { code: "8459.29", name: "Drilling Machine / 드릴 머신 / 钻床 / ボール盤" },
        { code: "8462.10", name: "Forging Machine / 단조기 / 锻造机 / 鍛造機" },
        { code: "8467.21", name: "Electric Drill / 전기 드릴 / 电钻 / 電気ドリル" },
        { code: "8472.90", name: "ATM/Cash Machine / ATM 기기 / 自动柜员机 / ATM機" },
        { code: "8473.30", name: "Computer Parts / 컴퓨터 부속 / 电脑零件 / コンピュータ部品" },
        { code: "8479.50", name: "Industrial Robot / 산업용 로봇 / 工业机器人 / 産業用ロボット" },
        { code: "8480.71", name: "Injection Mold / 사출 금형 / 注塑模具 / 射出金型" },
        { code: "8481.10", name: "Pressure Valve / 압력 밸브 / 减压阀 / 減圧弁" },
        { code: "8481.20", name: "Hydraulic Valve / 유압 밸브 / 液压阀 / 油圧バルブ" },
        { code: "8481.80", name: "Inlet/Outlet Valve / 주입구 밸브 / 进出水阀 / バルブ" },
        { code: "8482.10", name: "Ball Bearing / 볼 베어링 / 球轴承 / ボールベアリング" },
        { code: "8482.20", name: "Roller Bearing / 롤러 베어링 / 滚子轴承 / ローラーベアリング" },
        { code: "8483.10", name: "Crank Shaft / 크랭크 샤프트 / 曲轴 / クランクシャフト" },
        { code: "8483.40", name: "Gears / 기어 / 齿轮 / ギア" },
        { code: "8483.60", name: "Clutch / 클러치 / 离合器 / クラッチ" },

        // 3. Vehicles & Parts (87)
        { code: "8703.23", name: "Passenger Car / 승용차 / 乘用车 / 乗用車" },
        { code: "8703.80", name: "Electric Car / 전기 승용차 / 电动车 / 電気自動車" },
        { code: "8704.21", name: "Cargo Truck / 적재트럭 / 货车 / トラック" },
        { code: "8708.10", name: "Bumper / 범퍼 / 保险杠 / バンパー" },
        { code: "8708.29", name: "Body Parts / 차트 부속 / 车身零件 / 車体部品" },
        { code: "8708.30", name: "Brake System / 브레이크 시스템 / 刹车零件 / ブレーキ部品" },
        { code: "8708.40", name: "Gearboxes / 변속기 / 变速箱 / ギアボックス" },
        { code: "8708.50", name: "Drive Axles / 구동축 / 驱动轴 / 駆動軸" },
        { code: "8708.70", name: "Wheels / 휠 / 车轮 / ホイール" },
        { code: "8708.80", name: "Suspension / 현가장치 / 悬挂系统 / サスペンション" },
        { code: "8708.91", name: "Radiator / 라디에이터 / 散热器 / ラジエーター" },
        { code: "8708.92", name: "Muffler / 머플러 / 消音器 / マフラー" },
        { code: "8708.93", name: "Clutches / 클러치 / 离合器 / クラッチ" },
        { code: "8708.94", name: "Steering Wheel / 조향장치 / 方向盘 / ステアリング" },
        { code: "8708.99", name: "Misc Auto Parts / 기타 차량 부품 / 其他汽配 / その他車部品" },
        { code: "8711.20", name: "Motorcycle / 오토바이 / 摩托车 / オートバイ" },
        { code: "8712.00", name: "Bicycle / 자전거 / 自行车 / 自転車" },
        { code: "8714.10", name: "Motorcycle Parts / 오토바이 부품 / 摩托车零件 / バイク部品" },
        { code: "8716.39", name: "Trailers / 트레일러 / 挂车 / トレーラー" },

        // 4. Optical & Medical (90)
        { code: "9001.90", name: "Lens / 렌즈 / 镜片 / レンズ" },
        { code: "9002.11", name: "Camera Lens / 카메라 렌즈 / 照相机镜头 / カメラレンズ" },
        { code: "9003.11", name: "Glasses Frames / 안경테 / 眼镜框 / メガネフレーム" },
        { code: "9004.10", name: "Sunglasses / 선글라스 / 太阳镜 / サングラス" },
        { code: "9013.80", name: "LCD Device / LCD 장치 / 液晶设备 / 液晶デバイス" },
        { code: "9017.20", name: "Drawing Tools / 제도기 / 绘图工具 / 製図器" },
        { code: "9018.12", name: "Ultrasound / 초음파기 / 超声仪 / 超音波診断装置" },
        { code: "9018.19", name: "EEG/ECG / 뇌파/심전도 / 脑电图/心电图 / 脳波/心電図" },
        { code: "9018.31", name: "Syringe / 주사기 / 注射器 / 注射器" },
        { code: "9018.39", name: "Catheter / 카테터 / 导管 / カテーテル" },
        { code: "9018.50", name: "Ophthalmic / 안과용 기구 / 眼科仪器 / 眼科用器具" },
        { code: "9018.90", name: "Surgical Instrument / 수술 도구 / 手术器械 / 手術器具" },
        { code: "9019.10", name: "Massage Apparatus / 안마기 / 按摩器 / マッサージ器" },
        { code: "9020.00", name: "Respirator / 인공호흡기 / 呼吸机 / 呼吸機" },
        { code: "9021.10", name: "Orthopedic / 정형외과 기기 / 整形外科用品 / 整形外科用具" },
        { code: "9021.31", name: "Artificial Joints / 인공 관절 / 人工关节 / 人工関節" },
        { code: "9022.14", name: "X-ray / 엑스레이 / X射线机 / X線装置" },
        { code: "9025.11", name: "Thermometer / 온도계 / 温度计 / 温度計" },
        { code: "9026.10", name: "Flow Meter / 유량계 / 流量计 / 流量計" },
        { code: "9027.80", name: "Analysis Instrument / 분석 기기 / 分析仪器 / 分析機器" },
        { code: "9031.80", name: "Sensor / 센서 / 传感器 / センサー" },
        { code: "9032.10", name: "Thermostat / 온도조절기 / 恒温器 / サーモスタット" },

        // 5. Plastics & Rubber (39-40)
        { code: "3901.10", name: "Polyethylene / 폴리에틸렌 / 聚乙烯 / ポリエチレン" },
        { code: "3902.10", name: "Polypropylene / 폴리프로필렌 / 聚丙烯 / ポリプロピレン" },
        { code: "3903.11", name: "Polystyrene / 폴리스티렌 / 聚苯乙烯 / ポリスチレン" },
        { code: "3904.10", name: "PVC / 폴리염화비닐 / 聚氯乙烯 / 聚塩化ビニル" },
        { code: "3907.61", name: "PET / 페트 수지 / PET树脂 / PET樹脂" },
        { code: "3917.23", name: "PVC Pipe / PVC 파이프 / PVC管 / PVCパイプ" },
        { code: "3919.10", name: "Adhesive Tape / 접착 테이프 / 胶带 / 粘着テープ" },
        { code: "3920.10", name: "Vinyl Film / 비닐 필름 / 塑料膜 / ビニールフィルム" },
        { code: "3921.13", name: "PU Foam / 폴리우레탄 폼 / 聚氨酯海绵 / ポリウレタンフォーム" },
        { code: "3923.10", name: "Plastic Box / 플라스틱 상자 / 塑料盒 / プラスチック箱" },
        { code: "3923.30", name: "Plastic Bottle / 플라스틱 병 / 塑料瓶 / プラスチックボトル" },
        { code: "3924.10", name: "Plastic Tableware / 식탁용품 / 塑料餐具 / プラスチック食器" },
        { code: "3926.90", name: "Plastic Article / 플라스틱 제품 / 塑料制品 / プラスチック製品" },
        { code: "4011.10", name: "Passenger Tire / 승용차 승용타이어 / 乘用车轮胎 / 乗用車タイヤ" },
        { code: "4011.20", name: "Truck Tire / 트럭 타이어 / 卡车轮胎 / トラックタイヤ" },
        { code: "4016.93", name: "Gasket/Seal / 가스켓/인장 / 垫圈/密封件 / ガスケット/シール" },

        // 6. Metals & Hardware (72-83)
        { code: "7210.49", name: "Galvanized Steel / 도연강판 / 镀锌板 / 亜鉛めっき鋼板" },
        { code: "7219.33", name: "Stainless Sheet / 스테인리스 강판 / 不锈钢板 / ステンレス鋼板" },
        { code: "7304.11", name: "Iron Pipe / 철관 / 铁管 / 鉄管" },
        { code: "7318.15", name: "Bolt/Screw / 볼트/나사 / 螺栓/螺钉 / ボルト/ねじ" },
        { code: "7318.16", name: "Nut / 너트 / 螺母 / ナット" },
        { code: "7320.20", name: "Spring / 스프링 / 弹簧 / スプリング" },
        { code: "7323.93", name: "Kitchenware / 주방용품 / 不锈钢厨具 / キッチン用品" },
        { code: "7408.11", name: "Copper Wire / 동선 / 铜线 / 銅線" },
        { code: "7604.29", name: "Aluminum Profile / 알루미늄 프로파일 / 铝型材 / アルミプロファイル" },
        { code: "7607.11", name: "Aluminum Foil / 알루미늄 호일 / 铝箔 / アルミホイル" },
        { code: "8205.59", name: "Hand Tools / 수공구 / 手工具 / 手工具" },
        { code: "8301.10", name: "Padlock / 자물쇠 / 挂锁 / 南京錠" },
        { code: "8302.10", name: "Hinge / 경첩 / 铰链 / 蝶番" },

        // 7. Textiles & Apparel (61-64)
        { code: "6109.10", name: "Cotton T-shirt / 면 티셔츠 / 棉T恤 / コットンTシャツ" },
        { code: "6110.20", name: "Cotton Sweater / 면 스웨터 / 棉毛衣 / コットンセーター" },
        { code: "6115.95", name: "Cotton Socks / 면 양말 / 棉袜 / コットンソックス" },
        { code: "6203.42", name: "Cotton Trousers / 면 바지 / 棉裤 / コットンパンツ" },
        { code: "6204.32", name: "Women Jacket / 여성 자켓 / 女装夹克 / レディースジャケット" },
        { code: "6205.20", name: "Men Shirt / 남성 셔츠 / 男士衬衫 / メンズシャツ" },
        { code: "6302.21", name: "Bed Linen / 침구류 / 床上用品 / 寝具" },
        { code: "6307.90", name: "Mask / 마스크 / 面罩 / マスク" },
        { code: "6403.91", name: "Leather Shoes / 가죽 신발 / 皮鞋 / 革靴" },
        { code: "6404.11", name: "Sneakers / 운동화 / 运动鞋 / スニーカー" },

        // 8. Furniture & Lighting (94)
        { code: "9401.30", name: "Office Chair / 사무용 의자 / 办公椅 / オフィスチェア" },
        { code: "9403.10", name: "Metal Desk / 철제 책상 / 金属办公桌 / 金属製デスク" },
        { code: "9403.60", name: "Wooden Furniture / 나무 가구 / 木家具 / 木製家具" },
        { code: "9404.29", name: "Mattress / 매트리스 / 床垫 / マットレス" },
        { code: "9405.10", name: "Chandelier/Lighting / 샹들리에/조명 / 吊灯/灯具 / シャンデリア/照明" },
        { code: "9405.40", name: "LED Lamp / LED 램프 / LED灯 / LEDランプ" },

        // 9. Toys & Sports (95)
        { code: "9503.00", name: "Toys/Dolls / 완구/인형 / 玩具/玩偶 / 玩具/人形" },
        { code: "9504.50", name: "Video Game / 비디오 게임기 / 游戏机 / ビデオゲーム機" },
        { code: "9506.91", name: "Gym Equipment / 운동 기구 / 健身器材 / トレーニング機器" },
        { code: "9506.31", name: "Golf Clubs / 골프채 / 高尔夫球杆 / ゴルフクラブ" },

        // 10. Chemicals (28-38)
        { code: "2815.11", name: "Caustic Soda / 가성소다 / 烧碱 / 苛性ソーダ" },
        { code: "3208.10", name: "Paint/Varnish / 페인트 / 油漆 / ペイント" },
        { code: "3304.99", name: "Skincare / 기초화장품 / 护肤品 / スキンケア" },
        { code: "3305.10", name: "Shampoo / 샴푸 / 洗发水 / シャンプー" },
        { code: "3402.20", name: "Detergent / 세제 / 清洁剂 / 洗剤" },
        { code: "3506.10", name: "Adhesive / 접착제 / 粘合剂 / 接着剤" },
        { code: "3822.19", name: "Diagnostic Reagent / 진단 시약 / 诊断试剂 / 診断試薬" },

        // 11. Food & Bev (01-24)
        { code: "1001.99", name: "Wheat / 밀 / 小麦 / 小麦" },
        { code: "1006.30", name: "Rice / 쌀 / 大米 / 米" },
        { code: "1512.19", name: "Sunflower Oil / 해바라기유 / 葵花籽油 / ひまわり油" },
        { code: "1905.90", name: "Biscuits/Cookie / 쿠키/과자 / 饼干 / ビスケット" },
        { code: "2106.90", name: "Food Preparation / 조제 식료품 / 食品制剂 / 調製食料品" },
        { code: "2202.99", name: "Soft Drink / 음료수 / 饮料 / ソフトドリンク" },
        { code: "2204.21", name: "Wine / 와인 / 葡萄酒 / ワイン" },

        // 12. Luxury & Misc
        { code: "7113.19", name: "Gold Jewelry / 금 장신구 / 黄金首饰 / 黄金ジュエリー" },
        { code: "9101.11", name: "Luxury Watch / 명품 시계 / 奢华腕表 / 高級腕時計" },
        { code: "4202.21", name: "Leather Bag / 가죽 가방 / 皮包 / 革バッグ" },
        { code: "9608.30", name: "Fountain Pen / 만년필 / 钢笔 / 万年筆" },

        // Adding more to reach higher numbers... (Approx 120 so far)
        // [I will continue adding rows until ~400 items total for this edit to avoid massive context swelling, 
        // ensuring high diversity as requested]

        { code: "8471.49", name: "Server / 서버 / 服务器 / サーバー" },
        { code: "8517.61", name: "Base Station / 기지국 / 基站 / 基地局" },
        { code: "8528.72", name: "Television / TV / 电视机 / テレビ" },
        { code: "8529.90", name: "TV Parts / TV 부속 / 电视零件 / テレビ部品" },
        { code: "8473.50", name: "Parts for Pos / 포스 단말기 부품 / POS零件 / POS部品" },
        { code: "8414.30", name: "Freezer Compressor / 냉동기 압축기 / 冷冻机压缩机 / 冷凍用コンプレッサー" },
        { code: "8407.34", name: "Car Engine / 자동차 엔진 / 汽车发动机 / 車エンジン" },
        { code: "8408.20", name: "Truck Engine / 트럭 엔진 / 卡车发动机 / トラックエンジン" },
        { code: "2710.12", name: "Gasoline / 가솔린 / 汽油 / ガソリン" },
        { code: "3004.90", name: "Medicines / 의약품 / 药品 / 医薬品" },
        { code: "2523.29", name: "Portland Cement / 시멘트 / 水泥 / セメント" },
        { code: "4407.11", name: "Pine Wood / 소나무 원목 / 松木 / 松材" },
        { code: "4412.33", name: "Plywood / 합판 / 胶合板 / 合板" },
        { code: "4802.55", name: "Copy Paper / 복사용지 / 复印纸 / コピー用紙" },
        { code: "4819.10", name: "Carton Box / 골판지 상자 / 瓦楞纸箱 / 段ボール箱" },
        { code: "4901.99", name: "Book / 책 / 书籍 / 本" },
        { code: "5201.00", name: "Raw Cotton / 원면 / 棉花 / 綿花" },
        { code: "5402.33", name: "Polyester Yarn / 폴리에스터 원사 / 涤纶丝 / ポリエステル糸" },
        { code: "5101.11", name: "Raw Wool / 원모 / 羊毛 / 羊毛" },
        { code: "6907.21", name: "Ceramic Tile / 타일 / 瓷砖 / タイル" },
        { code: "7007.11", name: "Tempered Glass / 강화 유리 / 钢化玻璃 / 強化ガラス" },
        { code: "7102.39", name: "Diamond / 다이아몬드 / 钻石 / ダイヤモンド" },
        { code: "7307.91", name: "Flange / 플랜지 / 法兰 / フランジ" },
        { code: "8413.11", name: "Gas Pump / 주유기 / 燃油加油机 / 計量機" },
        { code: "8413.81", name: "Liquid Pump / 액체 펌프 / 液体泵 / 液体ポンプ" },
        { code: "8414.60", name: "Cooker Hood / 후드 / 抽油烟机 / 換気扇" },
        { code: "8418.69", name: "Ice Maker / 제빙기 / 制冰机 / 製氷機" },
        { code: "8419.11", name: "Water Heater / 온수기 / 热水器 / 湯沸かし器" },
        { code: "8419.50", name: "Heat Exchanger / 열 교환기 / 热交换器 / 熱交換器" },
        { code: "8421.12", name: "Dryer / 건조기 / 烘干机 / 乾燥機" },
        { code: "8422.11", name: "Dishwasher / 식기세척기 / 洗碗机 / 食器洗い機" },
        { code: "8422.40", name: "Wrapping Machine / 래핑기 / 裹包机 / ラッピング機" },
        { code: "8424.10", name: "Fire Extinguisher / 소화기 / 灭火器 / 消火器" },
        { code: "8425.42", name: "Jack / 잭 / 千斤顶 / ジャッキ" },
        { code: "8428.33", name: "Conveyor / 컨베이어 / 输送机 / コンベア" },
        { code: "8450.20", name: "Ind Washing Machine / 산업용 세탁기 / 工业洗衣机 / 工業用洗濯機" },
        { code: "8501.10", name: "Stepper Motor / 스테퍼 모터 / 步进电机 / ステッピングモーター" },
        { code: "8501.31", name: "DC Motor / DC 모터 / 直流电机 / DCモーター" },
        { code: "8501.52", name: "AC Motor / AC 모터 / 交流电机 / ACモーター" },
        { code: "8504.31", name: "Transformer / 변압기 / 变压器 / 変圧器" },
        { code: "8506.10", name: "Dry Cell / 건전지 / 干电池 / 乾電池" },
        { code: "8508.60", name: "Ind Vacuum / 산업용 진공청소기 / 工业吸尘器 / 工業用掃除機" },
        { code: "8516.10", name: "Elec Water Heater / 전기 온수기 / 电热水器 / 電気温水器" },
        { code: "8516.40", name: "Electric Iron / 전기 다리미 / 电熨斗 / 電気アイロン" },
        { code: "8516.71", name: "Coffee Maker / 커피 메이커 / 咖啡机 / コーヒーメーカー" },
        { code: "8516.79", name: "Fryer / 튀김기 / 油炸锅 / フ라이ヤー" },
        { code: "8517.62", name: "Network Switch / 네트워크 스위치 / 网络交换机 / ネットワークスイッチ" },
        { code: "8518.10", name: "Microphone / 마이크 / 麦克风 / マイク" },
        { code: "8518.21", name: "Speaker / 스피커 / 扬声器 / スピーカー" },
        { code: "8522.90", name: "Audio Parts / 오디오 부품 / 音频零件 / オーディオ部品" },
        { code: "8523.52", name: "Smart Card / 스마트 카드 / 智能卡 / スマートカード" },
        { code: "8525.50", name: "Transmitter / 송신기 / 发射机 / 送信機" },
        { code: "8526.10", name: "Radar / 레이더 / 雷达 / レーダー" },
        { code: "8526.91", name: "GPS / GPS 수신기 / GPS接收机 / GPS" },
        { code: "8528.59", name: "Ind Monitor / 산업용 모니터 / 工业显示器 / 産業用モニター" },
        { code: "8532.10", name: "Fixed Capacitor / 고정 커패시터 / 固定电容器 / 固定コンデンサ" },
        { code: "8533.40", name: "Potentiometer / 가변 저항기 / 电위기 / 可変抵抗器" },
        { code: "8535.10", name: "Fuses / 퓨즈 / 保险丝 / ヒューズ" },
        { code: "8536.10", name: "Low-volt Fuse / 저전압 퓨즈 / 低压保险丝 / 低圧ヒューズ" },
        { code: "8536.41", name: "Relay / 릴레이 / 继电器 / リレー" },
        { code: "8536.69", name: "Plug/Socket / 플러그/소켓 / 插头/插座 / プラグ/ソケット" },
        { code: "8536.90", name: "Connector / 커넥터 / 接插件 / コネクタ" },
        { code: "8539.21", name: "Halogen Lamp / 할로겐 램프 / 卤素灯 / ハロゲンランプ" },
        { code: "8539.31", name: "Fluorescent Lamp / 형광등 / 荧光灯 / 蛍光灯" },
        { code: "8542.33", name: "Amplifiers / 앰프 / 放大器 / アンプ" },
        { code: "8542.39", name: "Other IC / 기타 반도체 / 其他集成电路 / その他IC" },
        { code: "8543.10", name: "Accelerator / 가속기 / 加速器 / 加速器" },
        { code: "8543.30", name: "Electroplating / 도금 기기 / 电镀设备 / 電気めっき装置" },
        { code: "8544.11", name: "Winding Wire / 권선 / 绕组线 / 巻線" },
        { code: "8544.20", name: "Coaxial Cable / 동축 케이블 / 同轴电缆 / 同軸ケーブル" },
        { code: "8544.70", name: "Fiber Optic / 광케이블 / 光缆 / 光ファイバー" },
        { code: "2804.61", name: "Poly Silicon / 폴리실리콘 / 多晶硅 / ポリシリコン" },
        { code: "2805.30", name: "Rare Earth / 희토류 / 稀土 / 稀土類" },
        { code: "2901.21", name: "Ethylene / 에틸렌 / 乙烯 / エチレン" },
        { code: "2901.22", name: "Propylene / 프로필렌 / 丙烯 / プロピレン" },
        { code: "2902.20", name: "Benzene / 벤젠 / 苯 / ベンゼン" },
        { code: "2905.11", name: "Methanol / 메탄올 / 甲醇 / メタノール" },
        { code: "3102.10", name: "Urea / 요소 / 尿素 / 尿素" },
        { code: "3503.00", name: "Gelatin / 젤라틴 / 明胶 / ゼラチン" },
        { code: "3815.11", name: "Catalyst / 촉매 / 催化剂 / 触媒" },
        { code: "3811.11", name: "Anti-knock / 안티노크제 / 抗爆剂 / アンチノック剤" },
        { code: "4015.11", name: "Surgical Gloves / 수술용 장갑 / 手术手套 / 手術用手袋" },
        { code: "4203.10", name: "Leather Coat / 가죽 코트 / 皮大衣 / レザーコート" },
        { code: "4411.92", name: "HDF / 고밀도 섬유판 / 高密度纤维板 / HDF" },
        { code: "6111.20", name: "Baby clothes / 유아용 의복 / 婴儿服装 / ベビー服" },
        { code: "6212.10", name: "Brassiere / 브래지어 / 文胸 / ブラジャー" },
        { code: "6303.91", name: "Curtain / 커튼 / 窗帘 / カーテン" },
        { code: "6908.10", name: "Glazed Tile / 시유 타일 / 釉面砖 / 釉薬タイル" },
        { code: "7013.37", name: "Wine Glass / 와인 잔 / 葡萄酒杯 / ワイングラス" },
        { code: "7108.12", name: "Gold Bullion / 금괴 / 金条 / 金塊" },
        { code: "7321.11", name: "Gas Range / 가스 레인지 / 燃气灶 / ガスコンロ" },
        { code: "7322.11", name: "Radiator / 방열기 / 暖气片 / ラジエーター" },
        { code: "7326.11", name: "Grinding Ball / 연삭구 / 研磨球 / 研磨用ボール" },
        { code: "8202.10", name: "Hand Saw / 손톱 / 手锯 / 手のこぎり" },
        { code: "8211.92", name: "Kitchen Knife / 주방 칼 / 菜刀 / 包丁" },
        { code: "8302.30", name: "Vehicle Fittings / 차량용 하드웨어 / 汽车五金 / 車両用金具" },
        { code: "9005.10", name: "Binoculars / 쌍안경 / 双筒望远镜 / 双眼鏡" },
        { code: "9006.51", name: "SLR Camera / SLR 카메라 / 单反相机 / 一眼レフカメラ" },
        { code: "9011.80", name: "Microscope / 현미경 / 显微镜 / 顕微鏡" },
        { code: "9015.80", name: "Surveying / 측량 기기 / 测量仪器 / 測量機器" },
        { code: "9030.33", name: "Multimeter / 멀티미터 / 万用表 / マルチメーター" },
        { code: "9102.11", name: "Quartz Watch / 쿼츠 시계 / 石英表 / クォーツ時計" },
        { code: "9105.11", name: "Alarm Clock / 알람 시계 / 闹钟 / 目覚まし時計" },
        { code: "9201.10", name: "Upright Piano / 업라이트 피아노 / 立式钢琴 / アップライトピアノ" },
        { code: "9401.61", name: "Upholstered Chair / 쿠션 의자 / 软垫椅 / クッション付き椅子" },
        { code: "9503.00", name: "Puzzles / 퍼즐 / 拼图 / パズル" },
        { code: "9506.62", name: "Inflatable Ball / 공 / 充气球 / ボール" },
        { code: "9603.21", name: "Toothbrush / 칫솔 / 牙刷 / 歯ブラシ" },
        { code: "9613.10", name: "Gas Lighter / 가스 라이터 / 气体打火机 / ガスライター" },
        { code: "9619.00", name: "Diapers / 기저귀 / 尿布 / おむつ" },

        // --- EXTENDED DATABASE (500+ TOTAL) ---
        // Apparel & Accessories (61-62)
        { code: "6101.20", name: "Cotton Overcoat / 코트 / 大衣 / オーバー " },
        { code: "6103.22", name: "Cotton Ensembles / 세트 의복 / 套装 / セットアップ" },
        { code: "6104.33", name: "Synthetic Jackets / 합성섬유 자켓 / 合成纤维夹克 / 合成繊維ジャケット" },
        { code: "6105.10", name: "Cotton Men Shirt / 남성용 셔츠 / 男内衣 / メンズシャツ" },
        { code: "6106.10", name: "Blouses / 블라우스 / 女式衬衫 / ブラウス" },
        { code: "6107.11", name: "Underpants / 팬티 / 内裤 / パンツ" },
        { code: "6108.21", name: "Cotton Briefs / 여성용 팬티 / 女内裤 / ショーツ" },
        { code: "6110.30", name: "Synthetic Sweaters / 스웨터 / 毛衣 / セーター" },
        { code: "6112.31", name: "Swimwear / 수영복 / 泳衣 / 水着" },
        { code: "6114.20", name: "Cotton Outfits / 기타 의류 / 其他服装 / その他衣類" },
        { code: "6115.10", name: "Graduated Compression Hosiery / 압박 스타킹 / 压力袜 / 弾性ストッキング" },
        { code: "6116.10", name: "Gloves / 장갑 / 手套 / 手袋" },
        { code: "6117.10", name: "Shawls/Scarves / 스카프 / 围巾 / スカーフ" },
        { code: "6201.12", name: "Men Cotton Coat / 남성용 코트 / 男士大衣 / メンズコート" },
        { code: "6202.13", name: "Women Synthetic Coat / 여성용 코트 / 女士大衣 / レディースコート" },
        { code: "6203.11", name: "Wool Suits / 양모 수트 / 羊毛西装 / ウールスーツ" },
        { code: "6204.12", name: "Cotton Suite / 여성용 수트 / 女士套装 / レディーススーツ" },
        { code: "6205.30", name: "Synthetic Men Shirt / 합성섬유 셔츠 / 化纤衬衫 / 合成繊維シャツ" },
        { code: "6206.40", name: "Synthetic Blouse / 합성섬유 블라우스 / 化纤女衫 / 合成繊維ブラウス" },
        { code: "6207.11", name: "Cotton Undershirt / 면 내의 / 棉内衣 / コットン内着" },
        { code: "6208.21", name: "Cotton Nightdress / 잠옷 / 睡衣 / パジャマ" },
        { code: "6209.20", name: "Cotton Baby Clothes / 아동복 / 童装 / 子供服" },
        { code: "6210.10", name: "Felt Garments / 부직포 의류 / 毡制服装 / フェルト衣類" },
        { code: "6211.32", name: "Tracksuit / 운동복 / 运动服 / トレーニングウェア" },
        { code: "6212.20", name: "Girdles / 거들 / 束身衣 / ガードル" },
        { code: "6213.20", name: "Handkerchiefs / 손수건 / 手帕 / ハンカチ" },
        { code: "6214.20", name: "Wool Shawls / 양모 숄 / 羊毛披肩 / ウールショール" },
        { code: "6215.20", name: "Synthetic Ties / 넥타이 / 领带 / ネクタイ" },
        { code: "6216.00", name: "Mittens / 벙어리 장갑 / 连指手套 / ミトン" },
        { code: "6217.10", name: "Clothing Accessories / 의복 액세서리 / 服装辅料 / 衣類付属品" },

        // Shoes & Leather (64, 42)
        { code: "6401.10", name: "Waterproof Footwear / 장화 / 雨鞋 / レインブーツ" },
        { code: "6402.19", name: "Plastic Footwear / 플라스틱 신발 / 塑料鞋 / プラスチック靴" },
        { code: "6403.40", name: "Safety Shoes / 안전화 / 安全鞋 / 安全靴" },
        { code: "6405.10", name: "Faux Leather Shoes / 인조 가죽 신발 / 人造革鞋 / 合成皮革靴" },
        { code: "6406.10", name: "Shoe Uppers / 신발 갑피 / 鞋面 / 靴のアッパー" },
        { code: "4201.00", name: "Saddlery / 마구 / 马具 / 馬具" },
        { code: "4202.11", name: "Leather Suitcase / 가죽 트렁크 / 皮箱 / レザーケース" },
        { code: "4202.12", name: "Plastic Case / 플라스틱 수하물 / 塑料旅行箱 / プラスチック製スーツケース" },
        { code: "4202.31", name: "Leather Wallet / 가죽 지갑 / 皮钱包 / レザー財布" },
        { code: "4202.92", name: "Synthetic Bag / 합성섬유 가방 / 化纤包 / 合成繊維バッグ" },
        { code: "4203.21", name: "Sports Gloves / 스포츠 장갑 / 运动手套 / スポーツ手袋" },
        { code: "4205.00", name: "Leather Articles / 기타 가죽 제품 / 其他皮制品 / 革製品" },

        // Materials: Wood, Stone, Metal (44, 68, 72-83)
        { code: "4401.11", name: "Fuel Wood / 땔감 / 薪柴 / 薪" },
        { code: "4403.11", name: "Treated Logs / 처리된 원목 / 原木 / 丸太" },
        { code: "4407.91", name: "Oak Wood / 참나무 재목 / 橡木 / オーク" },
        { code: "4408.10", name: "Veneer Sheets / 단판 / 薄板 / ベニヤ" },
        { code: "4410.11", name: "Particle Board / 파티클 보드 / 刨花板 / パーティクルボード" },
        { code: "4412.31", name: "Tropical Plywood / 열대산 합판 / 热带木胶合板 / 合板" },
        { code: "4415.10", name: "Wooden Pallets / 팔레트 / 托盘 / パレット" },
        { code: "4418.10", name: "Window Frames / 창틀 / 窗框 / 窓枠" },
        { code: "4421.91", name: "Bamboo Articles / 대나무 제품 / 竹制品 / 竹製品" },
        { code: "6802.10", name: "Marble Tiles / 대리석 타일 / 大理石砖 / 大理石タイル" },
        { code: "6804.22", name: "Millstones / 연마석 / 砂轮 / 石臼" },
        { code: "6805.10", name: "Sandpaper / 사포 / 砂纸 / サンドペーパー" },
        { code: "6806.10", name: "Slag Wool / 슬래그 울 / 矿渣棉 / スラグウール" },
        { code: "6810.11", name: "Concrete Blocks / 콘크리트 블록 / 混凝土块 / コンクリートブロック" },
        { code: "6813.20", name: "Brake Lining / 브레이크 라이닝 / 刹车片 / ブレーキライニング" },
        { code: "7201.10", name: "Pig Iron / 선철 / 生铁 / 銑鉄" },
        { code: "7204.10", name: "Cast Iron Scrap / 철 스크랩 / 废铁 / スクラップ" },
        { code: "7207.11", name: "Iron Semi-finished / 반제품 철강 / 半成品钢 / 半製品" },
        { code: "7208.10", name: "Hot-rolled Iron / 열연 강판 / 热轧板 / 熱延鋼板" },
        { code: "7209.15", name: "Cold-rolled Iron / 냉연 강판 / 冷轧板 / 冷延鋼板" },
        { code: "7214.20", name: "Concrete Bars / 철근 / 钢筋 / 鉄筋" },
        { code: "7217.10", name: "Iron Wire / 철선 / 铁丝 / 鉄線" },
        { code: "7301.10", name: "Sheet Piling / 시트파일 / 钢板桩 / 鋼矢板" },
        { code: "7306.30", name: "Tubes/Pipes / 튜브/파이프 / 钢管 / 鋼管" },
        { code: "7308.90", name: "Steel Structures / 철강 구조물 / 钢结构 / 鉄鋼構造物" },
        { code: "7311.00", name: "Gas Cylinders / 가스 용기 / 气瓶 / ガスボンベ" },
        { code: "7312.10", name: "Steel Wire Rope / 와이어 로프 / 钢丝绳 / ワイヤーロープ" },
        { code: "7314.12", name: "Stainless Wire Mesh / 와이어 메쉬 / 不锈钢网 / 金網" },
        { code: "7315.11", name: "Roller Chain / 롤러 체인 / 滚子链 / ローラーチェーン" },
        { code: "7317.00", name: "Nails/Tacks / 못/핀 / 钉子 / 釘" },
        { code: "7321.81", name: "Gas Heaters / 가스 히터 / 燃气加热器 / ガスヒーター" },
        { code: "7324.10", name: "Stainless Sinks / 싱크대 / 不锈钢水槽 / シンク" },
        { code: "7325.10", name: "Cast Iron Articles / 주물 제품 / 铸铁制品 / 鋳物製品" },
        { code: "7403.11", name: "Refined Copper Cathodes / 정제구 / 阴极铜 / 銅カソード" },
        { code: "7407.10", name: "Copper Bars / 동 막대 / 铜棒 / 銅棒" },
        { code: "7411.10", name: "Copper Tubes / 동 파이프 / 铜管 / 銅管" },
        { code: "7502.10", name: "Unwrought Nickel / 니켈 괴 / 未锻轧镍 / ニッケル塊" },
        { code: "7601.10", name: "Unwrought Aluminum / 알루미늄 괴 / 铝锭 / アルミインゴット" },
        { code: "7606.11", name: "Aluminum Plates / 알루미늄 판 / 铝板 / アルミ板" },
        { code: "7610.10", name: "Aluminum Frames / 알루미늄 틀 / 铝合金窗框 / アルミサッシ" },
        { code: "7615.10", name: "Aluminum Cookware / 알루미늄 주방용품 / 铝制厨具 / アルミ調理器具" },
        { code: "7801.10", name: "Unwrought Lead / 연(납) / 未锻轧铅 / 鉛" },
        { code: "7901.11", name: "Zinc Ingots / 아연 괴 / 锌锭 / 亜鉛" },
        { code: "8001.10", name: "Tin Ingots / 주석 괴 / 未锻轧锡 / 錫" },
        { code: "8101.10", name: "Tungsten Powder / 텅스텐 분말 / 钨粉 / タングステン粉" },
        { code: "8108.20", name: "Unwrought Titanium / 티타늄 / 钛 / チタン" },
        { code: "8201.10", name: "Spades/Shovels / 삽 / 铲子 / ショベル" },
        { code: "8203.20", name: "Pliers / 플라이어 / 钳子 / プライヤー" },
        { code: "8204.11", name: "Wrenches / 렌치 / 板手 / レンチ" },
        { code: "8207.13", name: "Rock Drilling Bits / 비트 / 钻头 / ドリルビット" },
        { code: "8212.10", name: "Razors / 면도기 / 剃须刀 / カミソリ" },
        { code: "8214.10", name: "Paper Knives / 칼 / 裁纸刀 / ペーパーナイフ" },
        { code: "8215.10", name: "Tableware Sets / 수저 세트 / 餐具套装 / カトラリー" },
        { code: "8301.30", name: "Furniture Locks / 가구용 자물쇠 / 家具锁 / 家具用錠" },
        { code: "8302.41", name: "Building Hardware / 건축용 하드웨어 / 建筑五金 / 建築用金具" },
        { code: "8305.20", name: "Staples / 스테이플 / 订书钉 / ホッチキス針" },
        { code: "8307.10", name: "Flexible Tubes / 유연한 파이프 / 柔性管 / フレキシブルチューブ" },
        { code: "8308.10", name: "Hooks/Eyes / 후크 / 钩 / フック" },
        { code: "8309.10", name: "Crown Corks / 병뚜껑 / 瓶盖 / 王冠" },
        { code: "8311.10", name: "Welding Rods / 용접봉 / 焊条 / 溶接棒" },

        // Electronics & More Machines (84-85)
        { code: "8401.10", name: "Nuclear Reactors / 원자로 / 核反应堆 / 原子炉" },
        { code: "8403.10", name: "Central Heating Boilers / 보일러 / 锅炉 / ボイラー" },
        { code: "8406.81", name: "Steam Turbines / 증기 터빈 / 蒸汽轮机 / 蒸気タービン" },
        { code: "8411.11", name: "Turbo-jets / 터보 제트 / 涡轮喷气发动机 / ジェットエンジン" },
        { code: "8413.50", name: "Reciprocating Pumps / 왕복 펌프 / 往复泵 / 往復ポンプ" },
        { code: "8414.40", name: "Air Compressor Units / 컴프레셔 유닛 / 空压机组 / コンプレッサー装置" },
        { code: "8415.81", name: "AC with Heat Pump / 냉난방기 / 冷暖空调 / 冷暖房機" },
        { code: "8417.10", name: "Industrial Furnaces / 산업용 용광로 / 工业炉 / 工業用炉" },
        { code: "8418.50", name: "Display Counters / 진열대 케이스 / 展示柜 / ショーケース" },
        { code: "8421.39", name: "Gas Filter / 가스 필터 / 气体过滤 / ガスフィルター" },
        { code: "8422.19", name: "Ind Dishwasher / 산업용 식기세척기 / 工业洗碗机 / 工業用食洗機" },
        { code: "8424.10", name: "Fire Extinguishers / 소화기 / 灭火器 / 消火器" },
        { code: "8425.11", name: "Pulley Tackle / 도르래 / 滑轮 / 滑車" },
        { code: "8426.11", name: "Overhead Cranes / 오버헤드 크레인 / 桥式起重机 / クレーン" },
        { code: "8427.20", name: "Self-propelled Trucks / 지게차 / 叉车 / フォークリフト" },
        { code: "8428.10", name: "Elevators / 엘리베이터 / 电梯 / エレベーター" },
        { code: "8429.11", name: "Bulldozers / 불도저 / 推土机 / ブルドーザー" },
        { code: "8430.41", name: "Self-propelled Drills / 시추기 / 钻机 / ボーリング機" },
        { code: "8432.10", name: "Ploughs / 쟁기 / 犁 / 耕耘機" },
        { code: "8433.11", name: "Lawn Mowers / 잔디깎이 / 割草机 / 芝刈り機" },
        { code: "8434.10", name: "Milking Machines / 착유기 / 挤奶机 / 搾乳機" },
        { code: "8436.10", name: "Poultry Machinery / 축산 기계 / 家畜饲养机械 / 畜産用機械" },
        { code: "8438.10", name: "Bakery Machinery / 제과 기계 / 焙烤机械 / 製パン機械" },
        { code: "8439.10", name: "Pulp Machinery / 펄프 기계 / 纸浆机械 / パルプ製造機" },
        { code: "8441.10", name: "Paper Cutters / 종이 절단기 / 切纸机 / 裁断機" },
        { code: "8442.30", name: "Typesetting Machinery / 식자기 / 排版机 / 写真植字機" },
        { code: "8443.11", name: "Offset Printing / 오프셋 인쇄기 / 胶印机 / オフセット印刷機" },
        { code: "8444.00", name: "Spinning Machines / 방사기 / 纺丝机 / 紡績機" },
        { code: "8445.11", name: "Carding Machines / 소면기 / 梳理机 / 梳毛機" },
        { code: "8447.11", name: "Circular Knitting / 원형 메리야스 기기 / 圆形针织机 / 丸編機" },
        { code: "8450.11", name: "Washers (<10kg) / 세탁기 / 洗衣机 / 洗濯機" },
        { code: "8451.10", name: "Dry-cleaning / 드라이클리닝기 / 干洗机 / ドライクリーニング機" },
        { code: "8455.10", name: "Tube Rolling Mills / 파이프 압연기 / 管轧机 / 圧延機" },
        { code: "8456.11", name: "Laser Machines / 레이저 가공기 / 激光加工机 / レーザー加工機" },
        { code: "8457.10", name: "Machining Centers / 머시닝 센터 / 加工中心 / マシニングセンタ" },
        { code: "8458.11", name: "CNC Lathes / CNC 선반 / CNC车床 / CNC旋盤" },
        { code: "8459.10", name: "Way-unit Head Machines / 웨이유닛 헤드기 / 组合机床 / ウェイユニットヘッド機" },
        { code: "8460.12", name: "Surface Grinders / 평면 연삭기 / 平面磨床 / 平面研削盤" },
        { code: "8461.20", name: "Shaping Machines / 쉐이퍼 / 牛头刨床 / シェーパー" },
        { code: "8462.22", name: "Bending Machines / 벤딩기 / 弯曲机 / ベンディングマシン" },
        { code: "8463.10", name: "Draw-benches / 신선기 / 拉丝机 / 伸線機" },
        { code: "8465.10", name: "Woodworking Machines / 목재 가공기 / 木工机械 / 木工機械" },
        { code: "8466.10", name: "Tool Holders / 툴 홀더 / 刀柄 / ツールホルダー" },
        { code: "8467.11", name: "Pneumatic Tools / 에어 공구 / 气动工具 / エアツール" },
        { code: "8468.10", name: "Hand Blow-pipes / 토치 / 喷灯 / トーチ" },
        { code: "8470.10", name: "Electronic Calculators / 계산기 / 计算器 / 計算機" },
        { code: "8471.10", name: "Analog Computers / 아날로그 컴퓨터 / 模拟计算机 / アナログコンピュータ" },
        { code: "8472.10", name: "Duplicating Machines / 복사기 / 复印机 / 複写機" },
        { code: "8474.10", name: "Sorting Machines / 선별기 / 分类机 / 選別機" },
        { code: "8475.10", name: "Lamp Assembly / 램프 조립기 / 灯具组装机 / ランプ組立機" },
        { code: "8476.21", name: "Vending Machines / 자동판매기 / 自动售货机 / 自動販売機" },
        { code: "8477.10", name: "Injection Machines / 사출기 / 注塑机 / 射出成形機" },
        { code: "8478.10", name: "Tobacco Machinery / 담배 제조기 / 烟草机械 / 煙草製造機" },
        { code: "8479.10", name: "Civil Engineering Machines / 토목 기계 / 土木工程机械 / 土木機械" },
        { code: "8480.10", name: "Moulding Flasks / 주물 상자 / 铸造砂箱 / 鋳型" },
        { code: "8481.30", name: "Check Valves / 체크 밸브 / 止回阀 / 逆止弁" },
        { code: "8482.40", name: "Needle Bearings / 니들 베어링 / 滚针轴承 / ニードルベアリング" },
        { code: "8483.20", name: "Bearing Housings / 베어링 하우징 / 轴承座 / ベアリングハウジング" },
        { code: "8484.10", name: "Joint Gaskets / 조인트 가스켓 / 密封垫圈 / ジョイントガスケット" },
        { code: "8501.10", name: "Motors < 37.5W / 소형 모터 / 微电机 / 小型モーター" },
        { code: "8502.11", name: "Diesel Gen Sets / 발전기 세트 / 柴油发电机组 / 発電機セット" },
        { code: "8503.00", name: "Motor Parts / 모터 부품 / 电机零件 / モーター部品" },
        { code: "8504.10", name: "Ballasts / 안정기 / 镇流器 / 安定器" },
        { code: "8505.11", name: "Metal Magnets / 자석 / 磁铁 / 永久磁石" },
        { code: "8506.10", name: "Alkali Primary Cells / 알칼리 건전지 / 碱性干电池 / アルカリ乾電池" },
        { code: "8508.11", name: "Vacuum Cleaners (<1500W) / 청소기 / 吸尘器 / 掃除機" },
        { code: "8509.40", name: "Food Blenders / 블렌더/믹서 / 搅拌机 / ブレンダー" },
        { code: "8510.10", name: "Shavers / 면도기 / 剃须刀 / シェーバー" },
        { code: "8511.10", name: "Spark Plugs / 점화 플러그 / 火花塞 / 点火プラグ" },
        { code: "8512.10", name: "Bike Lighting / 자전거 전등 / 自行车灯 / 自転車用照明" },
        { code: "8513.10", name: "Flashlights / 손전등 / 手电筒 / 懐中電灯" },
        { code: "8514.10", name: "Resistance Furnaces / 저항가열로 / 电阻炉 / 抵抗炉" },
        { code: "8515.21", name: "Resistance Welders / 용접기 / 电阻焊机 / 抵抗溶接機" },
        { code: "8516.10", name: "Electric Water Heaters / 정탕기 / 电热水器 / 電気温水器" },
        { code: "8517.11", name: "Corded Phones / 유선 전화기 / 有线电话 / 有線電話" },
        { code: "8518.40", name: "Audio Amplifiers / 앰프 / 功率放大器 / アンプ" },
        { code: "8519.20", name: "Coin Audio Players / 코인 오디오 / 投币式放声机 / コイン式プレーヤー" },
        { code: "8521.10", name: "Video Tape Players / 비디오 플레이어 / 录像机 / ビデオデッキ" },
        { code: "8522.10", name: "Pick-up Cartridges / 픽업 카트리지 / 唱头 / ピックアップ" },
        { code: "8523.21", name: "Magnetic Stripe Cards / 마그네틱 카드 / 磁条卡 / 磁気ストライプカード" },
        { code: "8525.60", name: "Transm and Rec / 송수신기 / 接收机 / 送受信機" },
        { code: "8526.91", name: "Radio Navigation / 무선 항행기 / 无线电导航 / 無線航行" },
        { code: "8527.21", name: "Car Radio / 차량용 오디오 / 汽车收音机 / カーオーディオ" },
        { code: "8528.42", name: "CRT Monitors / CRT 모니터 / CRT显示器 / CRTモニター" },
        { code: "8529.10", name: "Aerials/Antennas / 안테나 / 天线 / アンテナ" },
        { code: "8530.10", name: "Railway Signals / 철도 신호기 / 铁路信号设备 / 鉄道信号機" },
        { code: "8531.10", name: "Burglar Alarms / 도난 경보기 / 防盗报警器 / 防犯アラーム" },
        { code: "8532.21", name: "Tantalum Capacitors / 탄탈륨 커패시터 / 钽电容器 / タンタルコンデンサ" },
        { code: "8533.10", name: "Carbon Resistors / 탄소 저항기 / 碳电阻器 / 炭素抵抗器" },
        { code: "8535.21", name: "Circuit Breakers / 차단기 / 断路器 / 遮断器" },
        { code: "8536.41", name: "Relays (<60V) / 릴레이 / 继电器 / リレー" },
        { code: "8539.10", name: "Sealed Beam Lamps / 실드빔 램프 / 密封光束灯 / シールドビーム" },
        { code: "8540.11", name: "Color TV CRT / 컬러 TV CRT / 彩色显像管 / ブラウン管" },
        { code: "8541.30", name: "Thyristors / 사이리스터 / 晶闸管 / サイリスタ" },
        { code: "8543.10", name: "Particle Accelerators / 입자 가속기 / 粒子加速器 / 粒子加速器" },
        { code: "8544.11", name: "Copper Winding Wire / 구리 권선 / 铜绕组线 / 銅巻線" },
        { code: "8545.20", name: "Carbon Brushes / 카본 브러쉬 / 碳刷 / カーボンブラシ" },
        { code: "8546.10", name: "Glass Insulators / 유리 애자 / 玻璃绝缘子 / ガラスがいし" },
        { code: "8547.10", name: "Insulating Fittings / 절연 부속 / 绝缘辅料 / 絶縁付属品" },

        // Misc Industry (70, 71, 90, 91, 92)
        { code: "7001.00", name: "Cullet / 유리의 설 / 碎玻璃 / 屑ガラス" },
        { code: "7005.10", name: "Float Glass / 플로트 판유리 / 浮法玻璃 / フロートガラス" },
        { code: "7007.21", name: "Laminated Car Glass / 적층 차량 유리 / 夹层汽车玻璃 / 合わせガラス" },
        { code: "7010.90", name: "Glass Bottles / 유리병 / 玻璃瓶 / ガラス瓶" },
        { code: "7101.10", name: "Natural Pearls / 천연 진주 / 天然珍珠 / 天然真珠" },
        { code: "7103.10", name: "Unworked Stones / 가공되지 않은 보석 / 未加工宝石 / 未加工原石" },
        { code: "7108.13", name: "Semi-manufactured Gold / 금 가공품 / 黄金半成品 / 金加工品" },
        { code: "7113.11", name: "Silver Jewelry / 은 장신구 / 银首饰 / 銀ジュエリー" },
        { code: "9001.10", name: "Optical Fibers / 광섬유 / 光纤 / 光ファイバー" },
        { code: "9002.19", name: "Projector Lenses / 투영용 장치 렌즈 / 投影机镜头 / プロジェクターレンズ" },
        { code: "9005.80", name: "Telescopes / 망원경 / 望远镜 / 望遠鏡" },
        { code: "9006.10", name: "Special Purpose Cameras / 특수 카메라 / 特殊照相机 / 特殊カメラ" },
        { code: "9010.10", name: "Film Processing / 필름 처리용 기기 / 胶卷处理机 / フィルム現像装置" },
        { code: "9011.10", name: "Stereoscopic Microscopes / 실체 현미경 / 立体显微镜 / 実体顕微鏡" },
        { code: "9013.10", name: "Telescopic Sights / 조준경 / 望远瞄准镜 / 照準器" },
        { code: "9014.10", name: "Compass / 나침반 / 指南针 / コンパス" },
        { code: "9015.10", name: "Rangefinders / 거리 측정기 / 测距仪 / 距離計" },
        { code: "9017.30", name: "Micrometers / 마이크로미터 / 千分尺 / マイクロメーター" },
        { code: "9018.11", name: "ECG / 심전도기 / 心电图机 / 心電計" },
        { code: "9019.20", name: "Respiratory Therapy / 호흡 요법 기구 / 呼吸治疗器 / 呼吸療法用器具" },
        { code: "9021.21", name: "Artificial Teeth / 의치 / 假牙 / 義歯" },
        { code: "9022.21", name: "Alpha/Beta Rays / 방사선 장치 / 射线装置 / 放射線装置" },
        { code: "9025.80", name: "Hydrometers / 비중계 / 比重计 / 比重計" },
        { code: "9026.20", name: "Pressure Gauges / 압계 / 压力表 / 圧力計" },
        { code: "9027.10", name: "Gas Analyzers / 가스 분석기 / 气体分析仪 / ガス分析計" },
        { code: "9030.10", name: "Ionizing Radiation / 이온화 방사선 측정 / 电离辐射测量 / 放射線測定" },
        { code: "9101.91", name: "Pocket Watches / 회중 시계 / 怀表 / 懐中時計" },
        { code: "9103.10", name: "Clocks with Watch Move / 시계 / 钟 / 壁時計" },
        { code: "9105.21", name: "Wall Clocks / 벽시계 / 挂钟 / 掛け時計" },
        { code: "9111.10", name: "Watch Cases / 시계 케이스 / 表壳 / 時計ケース" },
        { code: "9114.10", name: "Watch Springs / 시계 스프링 / 发条 / 時計用ゼンマイ" },
        { code: "9201.20", name: "Grand Pianos / 그랜드 피아노 / 三角钢琴 / グランドピアノ" },
        { code: "9202.10", name: "String Instruments / 현악기 / 弦乐器 / 弦楽器" },
        { code: "9205.10", name: "Brass-wind Instruments / 금관악기 / 铜管乐器 / 金管楽器" },
        { code: "9207.10", name: "Keyboard Instruments / 건반 악기 / 键盘乐器 / 鍵盤楽器" },
        { code: "9209.91", name: "Piano Parts / 피아노 부품 / 钢琴零件 / ピアノ部品" },

        // Chemical & Misc (28-38)
        { code: "2801.10", name: "Chlorine / 염소 / 氯 / 塩素" },
        { code: "2804.10", name: "Hydrogen / 수소 / 氢 / 水素" },
        { code: "2804.21", name: "Argon / 아르곤 / 氩 / アルゴン" },
        { code: "2806.10", name: "Hydrochloric Acid / 염산 / 盐酸 / 塩酸" },
        { code: "2807.00", name: "Sulphuric Acid / 황산 / 硫酸 / 硫酸" },
        { code: "2808.00", name: "Nitric Acid / 질산 / 硝酸 / 硝酸" },
        { code: "2811.21", name: "Carbon Dioxide / 이산화탄소 / 二氧化碳 / 二酸化炭素" },
        { code: "2815.12", name: "Sodium Hydroxide Sol / 수산화나트륨 수용액 / 氢氧化钠溶液 / 水酸化ナトリウム水溶液" },
        { code: "2818.20", name: "Aluminum Oxide / 산화알루미늄 / 氧化铝 / 酸化アルミニウム" },
        { code: "2833.11", name: "Sodium Sulphate / 황산나트륨 / 硫酸钠 / 硫酸ナトリウム" },
        { code: "2903.11", name: "Chloromethane / 클로로메탄 / 氯甲烷 / クロロメタン" },
        { code: "2905.12", name: "Propan-2-ol / 프로판올 / 异丙醇 / イソプロピルアルコール" },
        { code: "2907.11", name: "Phenol / 페놀 / 苯酚 / フェノール" },
        { code: "2909.11", name: "Diethyl Ether / 디에틸 에테르 / 乙醚 / ジエチルエーテル" },
        { code: "2912.11", name: "Methanal / 메탄알 / 甲醛 / ホルムアルデヒド" },
        { code: "2933.31", name: "Pyridine / 피리딘 / 吡啶 / ピリジン" },
        { code: "3004.10", name: "Penicillins / 페니실린 / 青霉素 / ペニシリン" },
        { code: "3005.10", name: "Adhesive Dressings / 접착성 드레싱 / 粘性敷料 / 絆創膏" },
        { code: "3006.10", name: "Sterile Catgut / 봉합사 / 无菌缝合线 / 縫合糸" },
        { code: "3101.00", name: "Animal Fertilizers / 동물성 비료 / 动物肥料 / 動植物性肥料" },
        { code: "3105.10", name: "Fertilizers (<10kg) / 비료 / 肥料 / 肥料" },
        { code: "3204.11", name: "Disperse Dyes / 분산 염료 / 分散染料 / 分散染料" },
        { code: "3206.11", name: "Titanium White / 티타늄 화이트 / 钛白粉 / 酸化チタン" },
        { code: "3207.10", name: "Prepared Pigments / 조제 안료 / 制备颜料 / 調製顔料" },
        { code: "3213.10", name: "Artist Colors / 물감 / 美术颜料 / 絵の具" },
        { code: "3215.11", name: "Black Printing Ink / 흑색 인쇄용 잉크 / 黑色印刷油墨 / 黒インキ" },
        { code: "3301.12", name: "Orange Oil / 오렌지유 / 橙油 / オレンジ油" },
        { code: "3304.10", name: "Lip Makeup / 립 메이크업 / 唇膏 / リップ" },
        { code: "3304.20", name: "Eye Makeup / 아이 메이크업 / 眼妆 / アイメイク" },
        { code: "3304.30", name: "Manicure / 매니큐어 / 指甲油 / マニキュア" },
        { code: "3306.10", name: "Dentifrices / 치약 / 牙膏 / 歯磨き" },
        { code: "3401.11", name: "Toilet Soap / 비누 / 肥皂 / 石鹸" },
        { code: "3404.20", name: "Polyethylene Wax / 왁스 / 蜡 / ワックス" },
        { code: "3405.10", name: "Shoe Polish / 구두약 / 鞋油 / 靴磨き" },
        { code: "3501.10", name: "Casein / 카세인 / 酪蛋白 / カゼイン" },
        { code: "3505.10", name: "Dextrins / 덱스트린 / 糊精 / デキストリン" },
        { code: "3605.00", name: "Matches / 성냥 / 火柴 / マッチ" },
        { code: "3701.10", name: "X-ray Plates / 엑스레이 필름 / X光胶片 / X線フィルム" },
        { code: "3810.10", name: "Pickling Preparations / 산 세척제 / 浸蚀制剂 / 浸漬剤" },
        { code: "3814.00", name: "Organic Solvent / 유기 용제 / 有机溶剂 / 有機溶剤" },
        { code: "3819.00", name: "Hydraulic Brake Fluid / 브레이크 액 / 刹车油 / ブレーキオイル" },
        { code: "3820.00", name: "Antifreeze / 부동액 / 防冻剂 / 不凍液" },

        // Food & Agri (01-24)
        { code: "0101.21", name: "Pure-bred Horses / 순종 말 / 纯种马 / 純粋種馬" },
        { code: "0105.11", name: "Fowls (<185g) / 닭 / 鸡 / 鶏" },
        { code: "0201.10", name: "Carcasses of Beef / 쇠고기 지육 / 牛胴体 / 牛肉ト体" },
        { code: "0301.11", name: "Ornamental Fish / 관상어 / 观赏鱼 / 観賞魚" },
        { code: "0306.11", name: "Rock Lobster / 바닷가재 / 龙虾 / ロブスター" },
        { code: "0401.10", name: "Milk (<1% fat) / 우유 / 牛奶 / 牛乳" },
        { code: "0405.10", name: "Butter / 버터 / 黄油 / バター" },
        { code: "0406.10", name: "Fresh Cheese / 치즈 / 奶酪 / チーズ" },
        { code: "0407.11", name: "Fertilized Hatching Eggs / 부화용 알 / 孵化蛋 / 孵化用卵" },
        { code: "0409.00", name: "Natural Honey / 천연 꿀 / 天然蜂蜜 / 蜂蜜" },
        { code: "0504.00", name: "Guts/Bladders / 창자 / 肠 / 腸" },
        { code: "0601.10", name: "Bulbs/Corms / 구근 / 球茎 / 球根" },
        { code: "0603.11", name: "Roses / 장미 / 玫瑰 / バラ" },
        { code: "0701.10", name: "Seed Potatoes / 씨감자 / 种土豆 / 種芋" },
        { code: "0702.00", name: "Tomatoes / 토마토 / 番茄 / トマト" },
        { code: "0703.10", name: "Onions / 양파 / 洋葱 / 玉ねぎ" },
        { code: "0713.10", name: "Peas / 완두 / 豌豆 / エンドウ" },
        { code: "0801.11", name: "Desiccated Coconuts / 건조 코코넛 / 椰子干 / 乾燥ココナッツ" },
        { code: "0803.10", name: "Plantains / 요리용 바나나 / 芭蕉 / プランテン" },
        { code: "0805.10", name: "Oranges / 오렌지 / 橙子 / オレンジ" },
        { code: "0808.10", name: "Apples / 사과 / 苹果 / りんご" },
        { code: "0811.10", name: "Frozen Strawberries / 냉동 딸기 / 冷冻草莓 / 冷凍いちご" },
        { code: "0901.11", name: "Unroasted Coffee / 생두 / 未烘焙咖啡豆 / 生豆" },
        { code: "0902.10", name: "Green Tea / 녹차 / 绿茶 / 緑茶" },
        { code: "0904.11", name: "Pepper (undried) / 후추 / 胡椒 / コショウ" },
        { code: "0910.11", name: "Ginger (unprocessed) / 생강 / 生姜 / 生姜" },
        { code: "1101.00", name: "Wheat Flour / 밀가루 / 小麦粉 / 小麦粉" },
        { code: "1201.10", name: "Soya Beans (seed) / 대두 / 大豆 / 大豆" },
        { code: "1202.30", name: "Ground-nuts (seed) / 땅콩 / 花生 / 落花生" },
        { code: "1206.00", name: "Sunflower Seeds / 해바라기씨 / 葵花籽 / ひまわりの種" },
        { code: "1301.20", name: "Gum Arabic / 아라비아 고무 / 阿拉伯胶 / アラビアゴム" },
        { code: "1302.11", name: "Opium / 아편 / 阿片 / 阿片" },
        { code: "1507.10", name: "Soya-bean Oil / 대두유 / 大豆油 / 大豆油" },
        { code: "1509.20", name: "Extra Virgin Olive Oil / 올리브유 / 橄榄油 / オリーブオイル" },
        { code: "1601.00", name: "Sausages / 소시지 / 香肠 / ソーセージ" },
        { code: "1604.14", name: "Canned Tuna / 참치 캔 / 金枪鱼罐头 / ツナ缶" },
        { code: "1701.12", name: "Beet Sugar / 비탕 / 甜菜糖 / テンサイ糖" },
        { code: "1704.10", name: "Chewing Gum / 껌 / 口香糖 / ガム" },
        { code: "1801.00", name: "Cocoa Beans / 코코아 빈 / 可可豆 / カカオ豆" },
        { code: "1901.10", name: "Infant Food / 영유아 식품 / 婴儿食品 / 乳幼児用食品" },
        { code: "1902.11", name: "Pasta / 파스타 / 意大利面 / パスタ" },
        { code: "2002.10", name: "Tomatoes Prep / 토마토 가공품 / 番茄制品 / トマト加工品" },
        { code: "2005.20", name: "Potatoes Prep / 감자 가공품 / 马铃薯制品 / ポテト加工品" },
        { code: "2009.11", name: "Orange Juice (frozen) / 냉동 오렌지 주스 / 冷冻橙汁 / 冷凍オレンジジュース" },
        { code: "2103.20", name: "Tomato Ketchup / 케첩 / 番茄酱 / ケチャップ" },
        { code: "2104.10", name: "Soups/Broths / 수프 / 汤 / スープ" },
        { code: "2201.10", name: "Mineral Water / 생수 / 矿泉水 / ミネラルウォーター" },
        { code: "2203.00", name: "Beer / 맥주 / 啤酒 / ビール" },
        { code: "2208.20", name: "Cognac/Brandy / 브랜디 / 白兰地 / ブランデー" },
        { code: "2304.00", name: "Soya-bean Oil-cake / 대두박 / 豆饼 / 大豆油かす" },
        { code: "2401.10", name: "Tobacco (unstemmed) / 엽담배 / 烟叶 / 葉タバコ" },
        { code: "2402.20", name: "Cigarettes / 담배 / 香烟 / タバコ" },

        // Final Batch (96, etc)
        { code: "9601.10", name: "Ivory Articles / 상아 제품 / 象牙制品 / 象牙製品" },
        { code: "9603.10", name: "Brooms / 빗자루 / 扫帚 / ほうき" },
        { code: "9606.10", name: "Press-fasteners / 스냅 단추 / 按扣 / スナップボタン" },
        { code: "9607.11", name: "Zippers / 지퍼 / 拉链 / ファスナー" },
        { code: "9608.10", name: "Ballpoint Pens / 볼펜 / 圆珠笔 / ボールペン" },
        { code: "9613.20", name: "Pocket Lighters / 라이터 / 打火机 / ライター" },
        { code: "9614.00", name: "Smoking Pipes / 파이프 / 烟斗 / パイプ" },
        { code: "9615.11", name: "Combs / 빗 / 梳子 / くし" },
        { code: "9617.00", name: "Vacuum Flasks / 보온병 / 保温瓶 / 魔法瓶" },
        { code: "9701.10", name: "Paintings / 회화 / 绘画 / 絵画" }
    ],
    ai_insights_db: [
        {
            conditions: { dest: 'EU', assy: 'CN' },
            priority: 1,
            title: "스트레스 상황: 유럽향 CBAM 강화 및 장기 물류/세금 리스크",
            bullets: [
                "<strong>규제 세무 리스크:</strong> 2026년 기준 EU CBAM 규제 시행 시, 탄소 배출량에 비례한 추가 세금이 <strong>대당 ₩25,000 이상</strong> 급증할 수 있습니다.",
                "<strong>세무/물류:</strong> 해상 30일 리드타임 중 재고유지비가 발생하며, 통관 시 발생하는 <strong>19%의 부가가치세(VAT)</strong>가 B2B 매입세액공제로 환류되기 전까지 단기 현금 흐름을 크게 압박합니다.",
                "<strong>추천 솔루션:</strong> 유럽 물량은 점진적으로 한국 조립 생산이나 동유럽 SKD 라인으로 스위칭하여 물류비와 규제 페널티를 선제적으로 회피하십시오."
            ]
        },
        {
            conditions: { dest: 'US', assy: 'CN' },
            priority: 1,
            title: "무역 장벽 경고: Section 301 가산 관세 위험",
            bullets: [
                "<strong>관세 리스크:</strong> 미국 수출 시 중국산 완제품에 대한 <strong>25%의 고율 관세</strong>가 부과되고 있습니다.",
                "<strong>원가 타격:</strong> 중국의 저렴한 인건비 이점을 <strong>장거리 물류비(₩18만)</strong>와 가산 관세가 모두 상쇄시킵니다.",
                "<strong>추천 솔루션:</strong> 한국(KR)으로 최종 조립지를 변경하고 부품 원산지 비율을 조정하여 KORUS FTA(무관세) 자격을 획득하세요."
            ]
        },
        {
            conditions: { dest: 'US', assy: 'KR', rvc_pass: false },
            priority: 1,
            title: "원산지 판정 실패: RVC 40% 한계치 미달",
            bullets: [
                "<strong>현재 상황:</strong> 한국에서 조립하지만, 중국산 부품 비중이 높아 <strong>한국산(KORUS FTA) 인정을 받지 못합니다.</strong>",
                "<strong>세금 페널티:</strong> 이 경우 최종 미국에서 중국산으로 간주되어 <strong>기본 관세</strong>에 준하는 페널티를 맞습니다.",
                "<strong>추천 솔루션:</strong> Display Panel이나 Main Board 둘 중 하나를 <strong>한국산(KR)으로 스위칭</strong>하여 부가가치 비율을 40% 위로 끌어올리십시오."
            ]
        },
        {
            conditions: { dest: 'US', assy: 'KR', rvc_pass: true, use_drawback: false },
            priority: 2,
            title: "절세 최적화 기회: 수입 부품 관세 환급 누락",
            bullets: [
                "<strong>현금 흐름:</strong> RVC(원심)는 통과했으나, 부품 반입 과정에서 낸 관세가 원가에 그대로 남아있습니다.",
                "<strong>추천 솔루션:</strong> 좌측의 '수입 부품 관세 환급'을 적용해 원가를 낮추십시오. 평균적으로 최종 가격의 <strong>2~3%</strong> 마진을 추가로 확보할 수 있습니다."
            ]
        },
        {
            conditions: { dest: 'KR', assy: 'KR' },
            priority: 3,
            title: "내수 최적화: 물류 방어 및 환원망",
            bullets: [
                "<strong>내수 안정성:</strong> 최종 물류 리드타임이 불과 1일로, 물류비(₩5,000)와 재고유지비가 <strong>최저 수준</strong>입니다.",
                "<strong>통관 비용:</strong> 내수 판매 시 10%의 부가가치세(VAT)가 발생하지만 매입세액공제로 상계가 가능합니다.",
                "<strong>공급망 전략:</strong> 한국 시장의 경우 수입 부품 관세에 대한 수출 환급이 불가하므로 <strong>저렴한 부품(CN산)을 최대한 확보</strong>하는 것이 이득입니다."
            ]
        },
        {
            conditions: { dest: 'TW', assy: 'CN' },
            priority: 2,
            title: "크로스보더 무역: 단거리 최적화",
            bullets: [
                "<strong>효율성:</strong> 물류 리드타임(3일) 및 물류비가 최저 수준으로 <strong>중간 기회비용이 최소화</strong>되어 있습니다.",
                "<strong>관세 비교:</strong> 5%의 협정 관세와 5%의 통관 VAT가 적용 중입니다. 한국산 완제품의 경쟁력이 강한 분야라면 원심(RVC)을 고려해 한국 조립 전환을 검토해 볼 수 있습니다."
            ]
        },
        {
            conditions: { industry: 'medical' },
            priority: 2,
            title: "Expert Advisor: 의료/정밀기기 분야 진입 전략",
            bullets: [
                "<strong>규제 장벽:</strong> 이 분야는 관세보다는 <strong>GMP 인증 및 임상 데이터</strong> 등의 비관세 장벽이 핵심입니다. 초기 세팅 비용에 UL/FDA 등 전문 인증비를 충분히 반영하십시오.",
                "<strong>품질 비용:</strong> 일반 소비재(85관) 대비 불량률(Scrap) 원가가 3배 이상 높으므로, <strong>Premium QC</strong> 적용이 필수적입니다.",
                "<strong>세이프가드:</strong> 특정 정밀 부품의 경우 원산지 위변조 방지(Blockchain tracking)가 요구될 수 있습니다."
            ]
        },
        {
            conditions: { industry: 'machinery' },
            priority: 2,
            title: "Expert Advisor: 기기 설비(84관) 공급망 특이사항",
            bullets: [
                "<strong>중량물 물류:</strong> 84관 기계류는 부품 당 무게가 상당하므로, AIR 배송 시 비용이 기하급수적으로 증가합니다. <strong>Sea-Freight 기반의 JIT(Just-in-Time)</strong> 재고 관리를 추천합니다.",
                "<strong>관세 혜택:</strong> 한국산 조립 시 '자본재 수입 관세 감면' 대상 여부를 확인하십시오. 특정 스마트 팩토리 설비용은 0% 세율 적용이 가능합니다."
            ]
        },
        {
            conditions: { industry: 'textiles' },
            priority: 2,
            title: "Expert Advisor: 의류/직물류(61-63관) 공급망 특이사항",
            bullets: [
                "<strong>인건비 집약도:</strong> 이 분야는 자동화율이 낮아 <strong>공임(Labor) 비중</strong>이 매우 높습니다. 중국/베트남 생산 시 인건비 10% 상승이 Landed Cost에 치명적일 수 있습니다.",
                "<strong>시즌성 물류:</strong> 패션 주기가 짧으므로 Sea-Freight 보다는 <strong>Sea-Air 복합 운송</strong>을 통한 재고 회전율 극대화가 권장됩니다."
            ]
        },
        {
            conditions: { industry: 'chemicals' },
            priority: 2,
            title: "Expert Advisor: 화학/기초소재(28-30관) 리스크 관리",
            bullets: [
                "<strong>환경 규제:</strong> 관세보다 REACH, RoHS 등 <strong>화학물질 등록 및 관리 비용</strong>이 더 크게 작용합니다. 오버헤드에 환경 부담금을 최소 20% 가산하십시오.",
                "<strong>위험물 운송:</strong> 특수 컨테이너 사용으로 인해 일반 부품 대비 <strong>물류비가 3~5배</strong> 높게 책정될 수 있습니다."
            ]
        },
        {
            conditions: { industry: 'furniture' },
            priority: 2,
            title: "Expert Advisor: 가구/인테리어(94관) 물류 최적화",
            bullets: [
                "<strong>부피 무게:</strong> 실질 중량보다 <strong>CBM(부피) 기반 운임</strong>이 지배적입니다. Flat-pack(조립식) 설계를 통해 물류비를 50%까지 절감할 수 있는지 검토하십시오."
            ]
        },
        {
            conditions: {}, // 기본 Fallback
            priority: 99,
            title: "AI Cost-Advisor: 기본 안정성 점검",
            bullets: [
                "현재 선택하신 공급망 노드(KR/CN)와 타겟 목적지의 <strong>물류, 통관세, VAT 밸런스는 양호</strong>합니다.",
                "<strong>체크 포인트:</strong> HS Code별 FTA 원산지 인정 요건(CTC 등)이 엄격하게 관리되고 있는지 확인하고, 환율 변동성(Hedging)에 대응하세요."
            ]
        }
    ]
};

type AssyHub = 'KR' | 'CN' | 'VN' | 'IN' | 'MX' | 'TH';

type Scenario = {
    id: string;
    name: string;
    assy: AssyHub;
    dest: string;
    volume: number;
    landedCost: number;
    mfg: number;
    partsCost: number;
    vadd: number;
    ship: number;
    duty: number;
    vat: number;
    carbon: number;
    lt: number;
    rvc: number;
    finalPrice: number;
    inlandCost?: number;
    fixedCost?: number;
    fullState?: any;
};

function SimulatorPageInner() {
    const pathname = usePathname();
    const langCode = pathname?.split('/')[1] || 'en';
    const validLangs = ['kr', 'en', 'ja', 'cn', 'es', 'ar'];
    const lang = validLangs.includes(langCode) ? langCode : 'en';
    const langMap: Record<string, keyof typeof simDict> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'cn', es: 'es', ar: 'ar' };
    const t = simDict[langMap[lang]];
    const { toast } = useToast();
    // Mobile 감지 및 PC 모드
    const [mobilePrompt, setMobilePrompt] = useState(false);
    const [isPcMode, setIsPcMode] = useState(false);

    useEffect(() => {
        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
        if (isMobile && !sessionStorage.getItem('simPcMode')) {
            setMobilePrompt(true);
        }
    }, []);

    const switchToPcMode = () => {
        // viewport meta 태그를 PC 너비로 교체
        const existingMeta = document.querySelector('meta[name="viewport"]');
        if (existingMeta) {
            existingMeta.setAttribute('content', 'width=1400');
        } else {
            const meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=1400';
            document.head.appendChild(meta);
        }
        sessionStorage.setItem('simPcMode', '1');
        setIsPcMode(true);
        setMobilePrompt(false);
    };

    const dismissMobilePrompt = () => {
        sessionStorage.setItem('simPcMode', '0');
        setMobilePrompt(false);
    };

    const [assy, setAssy] = useState<AssyHub>('KR');
    const [dest, setDest] = useState('US');
    const [industry, setIndustry] = useState('electronics');
    const [useDrawback, setUseDrawback] = useState(true);
    const [volumeStr, setVolumeStr] = useState('1000');
    const [projectTitle, setProjectTitle] = useState('New Project Simulation');

    // Dynamic Component State
    const [customComponents, setCustomComponents] = useState([...(db as any).industry_examples.electronics]);
    const [bomOrigins, setBomOrigins] = useState<Record<string, 'KR' | 'CN'>>(
        (db as any).industry_examples.electronics.reduce((acc: any, c: any) => ({ ...acc, [c.id]: c.origin as 'KR' | 'CN' }), {})
    );

    // New Component Form
    const [newComp, setNewComp] = useState({ name: '', price: 0, hs: '', weight: 0.1, origin: 'CN' as 'KR' | 'CN' });
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingCompId, setEditingCompId] = useState<string | null>(null);
    const [hsQuery, setHsQuery] = useState('');
    const [showHsSuggestions, setShowHsSuggestions] = useState(false);

    const [aiPanelState, setAiPanelState] = useState<'hidden' | 'loading' | 'done'>('hidden');
    const [currency, setCurrency] = useState('KRW');
    const [rates, setRates] = useState<Record<string, number>>({ KRW: 1, USD: 1 / 1410, EUR: 1 / 1500, CNY: 1 / 195, JPY: 1 / 9.5 });
    const [isStressMode, setIsStressMode] = useState(false);
    const [qcLevel, setQcLevel] = useState<'basic' | 'premium'>('basic');
    const [freightMode, setFreightMode] = useState<'sea' | 'air' | 'custom'>('sea');
    const [customBaseFreight, setCustomBaseFreight] = useState<number | null>(null);
    const [customWeightRate, setCustomWeightRate] = useState<number | null>(null);
    const [includeTooling, setIncludeTooling] = useState(false);

    // Manual Discount Management
    const [overrideDiscounts, setOverrideDiscounts] = useState(false);
    const [manualBomDiscount, setManualBomDiscount] = useState(0.1);
    const [manualLaborDiscount, setManualLaborDiscount] = useState(0.0);
    const [manualShipDiscount, setManualShipDiscount] = useState(0.0);
    const [showCertPanel, setShowCertPanel] = useState(false);
    const [incoterm, setIncoterm] = useState<'EXW' | 'FOB' | 'DDP'>('DDP');
    const [showExwDetails, setShowExwDetails] = useState(false);
    const [isBridgeEditing, setIsBridgeEditing] = useState(false);
    const [showIndustryItems, setShowIndustryItems] = useState(true);
    const [showIndustryDropdown, setShowIndustryDropdown] = useState(false);
    const [industryQuery, setIndustryQuery] = useState('');
    const [showVolumeDropdown, setShowVolumeDropdown] = useState(false);
    const [volumeQuery, setVolumeQuery] = useState('');
    const [ftaThreshold, setFtaThreshold] = useState(40); // RVC 기준 (%)
    const [activeTab, setActiveTab] = useState<0 | 1 | 2>(0); // 0:비용구조 1:저장시나리오 2:비교

    const industryOptions = [
        { value: 'electronics', label: 'IT/전자 (85관)' },
        { value: 'automotive', label: '자동차부품 (87관)' },
        { value: 'machinery', label: '기계 설비 (84관)' },
        { value: 'medical', label: '의료/정밀기기 (90관)' },
        { value: 'plastic', label: '사출/주방 (39관)' },
        { value: 'furniture', label: '가구/침구 (94관)' },
        { value: 'textiles', label: '의류/직물 (61-63관)' },
        { value: 'chemicals', label: '화학/기초소재 (28-30관)' },
        { value: 'food', label: '식품/음료 (01-24관)' },
        { value: 'beauty', label: '화장품/뷰티 (33관)' },
        { value: 'toys', label: '장난감/스포츠 (95관)' },
        { value: 'metal', label: '철강/금속 (72-73관)' },
        { value: 'footwear', label: '신발/잡화 (64관)' },
        { value: 'luxury', label: '시계/귀금속 (71, 91관)' },
        { value: 'none', label: '기타 (직접 입력)' }
    ];

    // Synonyms for fuzzy matching (lowercase)
    const industrySynonyms: Record<string, string[]> = {
        electronics: ['it', '전자', 'electronics', '85'],
        automotive: ['자동차', 'car', 'automotive', '87'],
        machinery: ['기계', 'machinery', '84'],
        medical: ['의료', 'medical', '정밀', '90'],
        plastic: ['플라스틱', 'plastic', '주방', '39'],
        furniture: ['가구', 'furniture', '94'],
        textiles: ['의류', 'textiles', '직물', '61', '62', '63'],
        chemicals: ['화학', 'chemicals', '28', '29', '30'],
        food: ['식품', 'food', '음료', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24'],
        beauty: ['뷰티', 'beauty', '33'],
        toys: ['장난감', 'toys', '스포츠', '95'],
        metal: ['철강', 'metal', '금속', '72', '73'],
        footwear: ['신발', 'footwear', '잡화', '64'],
        luxury: ['시계', 'luxury', '귀금속', '71', '91']
    };

    const resolveIndustryFromQuery = (query: string): string | null => {
        const lower = query.toLowerCase();
        for (const [key, synonyms] of Object.entries(industrySynonyms)) {
            if (synonyms.some(s => lower.includes(s))) {
                return key;
            }
        }
        // fallback: try direct match on label/value
        const direct = industryOptions.find(o => o.label.toLowerCase().includes(lower) || o.value.toLowerCase().includes(lower));
        return direct ? direct.value : null;
    };

    // Bridge Overrides
    const [customInland, setCustomInland] = useState<number | null>(null);
    const [customShip, setCustomShip] = useState<number | null>(null);
    const [customTax, setCustomTax] = useState<number | null>(null);

    // EXW Detailed Overrides
    const [isExwEditing, setIsExwEditing] = useState(false);
    const [mParts, setMParts] = useState<number | null>(null);
    const [mLabor, setMLabor] = useState<number | null>(null);
    const [mScrap, setMScrap] = useState<number | null>(null);
    const [mFixed, setMFixed] = useState<number | null>(null);
    const [mUtil, setMUtil] = useState<number | null>(null);
    const [mOverhead, setMOverhead] = useState<number | null>(null);

    // Timeline Overrides
    const [isTimelineEditing, setIsTimelineEditing] = useState(false);
    const [customMfgDays, setCustomMfgDays] = useState<number | null>(null);
    const [customQcDays, setCustomQcDays] = useState<number | null>(null);
    const [customLtDays, setCustomLtDays] = useState<number | null>(null);

    useEffect(() => {
        const fetchRates = async () => {
            try {
                const res = await fetch('https://api.exchangerate-api.com/v4/latest/KRW');
                const data = await res.json();
                if (data && data.rates) {
                    setRates({
                        KRW: 1,
                        USD: data.rates.USD,
                        EUR: data.rates.EUR,
                        CNY: data.rates.CNY,
                        JPY: data.rates.JPY
                    });
                }
            } catch (e) {
                console.error("Exchange rate fetch failed, using fallback:", e);
            }
        };
        fetchRates();
    }, []);

    // ── 실시간 시장 데이터 ─────────────────────────────────────────────────────
    const [marketData, setMarketData] = useState<{
        rates: { USD_KRW: number; CNY_KRW: number; EUR_KRW: number; VND_KRW: number; JPY_KRW: number };
        materials: Record<string, { value: number; unit: string; source: string }>;
        shipping: Record<string, { value: number; unit: string; source: string }>;
        lastUpdated: string;
    } | null>(null);
    const [useRealtime, setUseRealtime] = useState(true);
    const [marketDataLoading, setMarketDataLoading] = useState(false);

    useEffect(() => {
        const fetchMarketData = async () => {
            setMarketDataLoading(true);
            try {
                const res = await fetch('/api/market-data');
                if (res.ok) {
                    const data = await res.json();
                    setMarketData(data);
                    if (useRealtime && data.rates) {
                        const r = data.rates;
                        setRates({
                            KRW: 1,
                            USD: 1 / r.USD_KRW,
                            EUR: 1 / r.EUR_KRW,
                            CNY: 1 / r.CNY_KRW,
                            JPY: 1 / r.JPY_KRW,
                        });
                    }
                }
            } catch (e) {
                console.error('market-data fetch failed:', e);
            } finally {
                setMarketDataLoading(false);
            }
        };
        fetchMarketData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── 민감도 분석 슬라이더 상태 ────────────────────────────────────────────
    const [sensitivity, setSensitivity] = useState({
        exchangeRate:  0,   // ±30%  (%)
        laborCost:     0,   // ±50%  (%)
        materialCost:  0,   // ±50%  (%)
        volume:        0,   // 0 = 1x (로그 스케일 -90 ~ +900%)
        tariffRate:    0,   // 0~50% 추가 관세
        shippingCost:  0,   // ±100% (%)
    });
    const [showSensitivity, setShowSensitivity] = useState(false);

    const [profitMargin, setProfitMargin] = useState(0.15); // 15% 기인
    const [selectedCerts, setSelectedCerts] = useState<string[]>([]);
    const [matchedInsight, setMatchedInsight] = useState<any>(null);
    const [scenarios, setScenarios] = useState<Scenario[]>([]);
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [exportSelections, setExportSelections] = useState<string[]>(['current']); // 'current' or scenario IDs
    const [exportType, setExportType] = useState<'excel' | 'pdf'>('excel');

    // ─── 리스크 시나리오 state ────────────────────────────────
    const [activeRisks, setActiveRisks] = useState<string[]>([]);

    // ─── 저장/공유 state ──────────────────────────────────────
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
    const [saveSimName, setSaveSimName] = useState('');
    const [saveLoading, setSaveLoading] = useState(false);
    const [savedShareUrl, setSavedShareUrl] = useState('');
    const [shareCodeInput, setShareCodeInput] = useState('');
    const [loadBanner, setLoadBanner] = useState('');
    const [recentSims, setRecentSims] = useState<Array<{ name: string; shareCode: string; savedAt: string; inputs: any; results: any }>>([]);
    const [showRecentList, setShowRecentList] = useState(false);

    // ─── 산업 특화 state ──────────────────────────────────────
    const [specialIndustry, setSpecialIndustry] = useState<string>('none');
    const [specialFields, setSpecialFields] = useState<Record<string, string>>({});
    const [selectedSpecialCerts, setSelectedSpecialCerts] = useState<string[]>([]);

    const router = useRouter();
    const searchParams = useSearchParams();

    // ─── localStorage 최근 시뮬레이션 로드 ──────────────────
    useEffect(() => {
        try {
            const stored = localStorage.getItem('nexyfab_recent_sims');
            if (stored) setRecentSims(JSON.parse(stored));
        } catch { /* ignore */ }
    }, []);

    // ─── 공유 링크 수신 시 자동 불러오기 ────────────────────
    useEffect(() => {
        const shareCode = searchParams.get('share');
        if (!shareCode) return;
        fetch(`/api/simulations?code=${shareCode}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return;
                const st = data.inputs;
                if (st.assy) setAssy(st.assy);
                if (st.dest) setDest(st.dest);
                if (st.industry) setIndustry(st.industry);
                if (st.useDrawback !== undefined) setUseDrawback(st.useDrawback);
                if (st.volumeStr) setVolumeStr(st.volumeStr);
                if (st.customComponents) setCustomComponents(st.customComponents);
                if (st.bomOrigins) setBomOrigins(st.bomOrigins);
                if (st.selectedCerts) setSelectedCerts(st.selectedCerts);
                if (st.profitMargin !== undefined) setProfitMargin(st.profitMargin);
                if (st.isStressMode !== undefined) setIsStressMode(st.isStressMode);
                if (st.qcLevel) setQcLevel(st.qcLevel);
                if (st.freightMode) setFreightMode(st.freightMode);
                if (st.projectTitle) setProjectTitle(st.projectTitle);
                if (st.activeRisks) setActiveRisks(st.activeRisks);
                if (st.specialIndustry) setSpecialIndustry(st.specialIndustry);
                if (st.selectedSpecialCerts) setSelectedSpecialCerts(st.selectedSpecialCerts);
                setLoadBanner(`"${data.name}" 시뮬레이션을 불러왔습니다. (저장일: ${new Date(data.createdAt).toLocaleDateString('ko-KR')})`);
                setTimeout(() => setLoadBanner(''), 5000);
            })
            .catch(() => { });
    }, [searchParams]);

    const industryMetadata: Record<string, { hsHeader: string, items: string[] }> = {
        electronics: { hsHeader: '85관', items: ['스마트폰 (8517.13)', '노트북 (8471.30)', 'SSD (8523.51)', '반도체 (8542.31)', 'PCB (8534.00)', '디스플레이 (8524.11)'] },
        automotive: { hsHeader: '87관', items: ['리튬이온 배터리 (8507.60)', '브레이크 (8708.30)', '조향장치 (8708.94)', '엔진부품 (8409.91)', '휠/타이어 (8708.70)'] },
        machinery: { hsHeader: '84관', items: ['금형 (8480.71)', '산업용 로봇 (8479.50)', '공기 압축기 (8414.80)', '베어링 (8482.10)', '유압펌프 (8413.50)'] },
        medical: { hsHeader: '90관', items: ['진단 기기 (9018.19)', '내시경 (9018.90)', '치과용 기구 (9018.49)', '정형외과용 기기 (9021.10)', '엑스레이 (9022.14)'] },
        plastic: { hsHeader: '39관', items: ['주방용품 (3924.10)', '포장용기 (3923.30)', '플라스틱 패널 (3920.10)', '플라스틱 관 (3917.23)', '비닐 필름 (3920.10)'] },
        furniture: { hsHeader: '94관', items: ['사무용 의자 (9401.30)', '실내 조명 (9405.10)', '나무 가구 (9403.60)', '금속제 책상 (9403.10)', '매트리스 (9404.29)'] },
        textiles: { hsHeader: '61-63관', items: ['면 셔츠 (6205.20)', '메리야스 편물 (6109.10)', '부직포 (5603.11)', '합성섬유 직물 (5407.52)', '지퍼 (9607.11)'] },
        chemicals: { hsHeader: '28-30관', items: ['희토류 산화물 (2805.30)', '폴리머 (3901.10)', '세정제 (3402.20)', '유기용제 (2901.10)', '도료 (3208.10)'] },
        food: { hsHeader: '01-24관', items: ['곡물 (1001.99)', '식물성 유지 (1512.19)', '가공식품 (2106.90)', '과자류 (1905.90)', '음료수 (2202.99)', '첨가제 (2916.31)'] },
        beauty: { hsHeader: '33관', items: ['기초화장품 (3304.99)', '메이크업 (3304.91)', '향수 (3303.00)', '샴푸/헤어케어 (3305.10)', '로션/에센스 (3304.99)'] },
        toys: { hsHeader: '95관', items: ['완구/인형 (9503.00)', '운동기구 (9506.91)', '비디오게임 (9504.50)', '퍼즐 (9503.00)', '무선조종완구 (9503.00)'] },
        metal: { hsHeader: '72-73관', items: ['강판 (7219.33)', '철강관 (7304.11)', '알루미늄박 (7607.11)', '볼트/너트 (7318.15)', '동선 (7408.11)'] },
        footwear: { hsHeader: '64관', items: ['운동화 (6404.11)', '가죽구두 (6403.51)', '샌들 (6402.20)', '장화 (6401.10)', '안전화 (6403.40)'] },
        luxury: { hsHeader: '71, 91관', items: ['손목시계 (9101.11)', '금/은 장신구 (7113.19)', '보석류 (7103.91)', '고급 가방 (4202.21)', '만년필 (9608.30)'] }
    };

    const formatVal = (val: number) => {
        const currentRate = rates[currency] || 1;
        const converted = val * currentRate;
        const symbols: Record<string, string> = { USD: '$', EUR: '€', CNY: '¥', JPY: '¥', KRW: '₩' };
        const symbol = symbols[currency] || '₩';

        if (currency === 'KRW' || currency === 'JPY') {
            return `${symbol} ${Math.round(converted).toLocaleString()}`;
        }
        return `${symbol} ${converted.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    };


    const simData = useMemo(() => {
        let partsCost = 0, interDuty = 0, interShip = 0, energySum = 0;

        const volume = parseInt(volumeStr, 10);
        let bomDiscount = 0;
        let shipDiscount = 0;
        let laborDiscount = 0;

        if (overrideDiscounts) {
            bomDiscount = manualBomDiscount;
            laborDiscount = manualLaborDiscount;
            shipDiscount = manualShipDiscount;
        } else {
            if (volume >= 100000) { bomDiscount = 0.25; shipDiscount = 0.60; laborDiscount = 0.30; }
            else if (volume >= 50000) { bomDiscount = 0.18; shipDiscount = 0.40; laborDiscount = 0.20; }
            else if (volume >= 10000) { bomDiscount = 0.10; shipDiscount = 0.20; laborDiscount = 0.10; }
            else if (volume >= 5000) { bomDiscount = 0.05; shipDiscount = 0.05; laborDiscount = 0.00; }
        }

        // 스트레스 모드 계수 적용
        const stressFactor = isStressMode ? 1.5 : 1.0;

        // ─── 리스크 시나리오 복합 충격 계산 ────────────────────
        const riskImpact = activeRisks.reduce((acc, riskId) => {
            const r = RISK_SCENARIOS.find(s => s.id === riskId);
            if (!r) return acc;
            return {
                tariff_delta: acc.tariff_delta + r.impacts.tariff_delta,
                shipping_delta: acc.shipping_delta + r.impacts.shipping_delta,
                labor_delta: acc.labor_delta + r.impacts.labor_delta,
                material_delta: acc.material_delta + r.impacts.material_delta,
                lead_time_delta: acc.lead_time_delta + r.impacts.lead_time_delta,
            };
        }, { tariff_delta: 0, shipping_delta: 0, labor_delta: 0, material_delta: 0, lead_time_delta: 0 });

        const riskMaterialFactor = 1 + riskImpact.material_delta / 100;
        const riskShippingFactor = 1 + riskImpact.shipping_delta / 100;
        const riskLaborFactor = 1 + riskImpact.labor_delta / 100;

        let totalWeight = 0;
        customComponents.forEach(c => {
            const ori = bomOrigins[c.id] || (c as any).origin;
            const discountedPrice = (c.price * stressFactor * riskMaterialFactor) * (1 - bomDiscount);
            const w = (c as any).weight || 0.1; // Default to 100g if missing
            partsCost += discountedPrice;
            totalWeight += w;
            energySum += (c as any).energy || 1.0;
            if (ori !== assy) {
                // 부품 물류 (인바운드) - 무게 기반 산출 (kg당 3000원 수준 가산)
                interShip += (w * 3500) * (1 - shipDiscount) * stressFactor;
                interDuty += discountedPrice * 0.08;
            }
        });

        const drawback = (useDrawback && assy !== dest) ? interDuty * 0.95 : 0;

        const loc = (db.locations as any)[assy] ?? db.locations.KR;
        // 현실적인 제조 원가 비율을 위해 단위당 조립 공수를 0.5시간 수준으로 조정 (리스크 인건비 반영)
        const labor = (0.5 * loc.labor) * (1 - laborDiscount) * riskLaborFactor;

        // 산업별 특성 추출
        const industryTraits = (db.tooling_costs as any)[industry] || { overhead: 0.15, precision: 'medium', risk: 'low' };

        // 유틸리티 및 오버헤드 (현실적인 배치당 소요량으로 조정)
        const elecCost = 5 * loc.elec;
        const waterCost = 0.1 * loc.water;
        const rentCost = 0.02 * loc.rent;
        const utilityTotal = elecCost + waterCost + rentCost;

        const overheadRate = (industryTraits.overhead || 0.15) * stressFactor;
        const baseMFGBeforeQC = partsCost + labor + utilityTotal;
        const overhead = baseMFGBeforeQC * overheadRate;

        // QC 및 불량 원가 (Scrap) - 정밀도(Precision)에 따른 가중치 적용
        const precisionMultipliers: Record<string, number> = {
            'low': 0.7,
            'medium': 1.0,
            'high': 1.5,
            'very_high': 2.2,
            'ultra_high': 3.5
        };
        const pMult = precisionMultipliers[industryTraits.precision] || 1.0;
        const qc = db.qc_levels[qcLevel];
        const qcCost = qc.cost_per_unit;
        const scrapCost = (partsCost + labor + utilityTotal) * qc.rate * pMult;

        // Overrides Application
        const fParts = mParts ?? partsCost;
        const fLabor = mLabor ?? labor;
        const fUtil = mUtil ?? utilityTotal;
        const fOverhead = mOverhead ?? ((fParts + fLabor + fUtil) * overheadRate);
        const fScrap = mScrap ?? (qcCost + scrapCost);

        const vadd = fLabor + fUtil + fOverhead + fScrap;
        const mfg = fParts + vadd + (interDuty - drawback) + interShip;

        const rvc = (vadd / (fParts + vadd)) * 100;
        const isOriginMatch = rvc >= ftaThreshold;
        const finalOrigin = isOriginMatch ? assy : 'CN';

        const destData = (db.destinations as any)[dest];
        const industryRate = (destData?.duty as any)[industry] || 0.0;
        const baseRate = destData?.duty[finalOrigin] ?? 0.1;
        const finalRate = baseRate + industryRate;
        const finalDuty = mfg * finalRate;

        // 물류 모드에 따른 리드타임 및 비용 (리스크 납기 반영)
        let ltDays = (destData?.lt[assy] ?? 14);
        if (freightMode === 'air') ltDays = Math.max(2, Math.round(ltDays * 0.2));
        ltDays = ltDays * (isStressMode ? 1.5 : 1.0) + riskImpact.lead_time_delta;

        const invCost = mfg * (0.06 / 365) * ltDays;

        const carbonKg = (energySum * loc.carbon_kg) + (totalWeight * (freightMode === 'air' ? 1.5 : 0.05)); // 무게 및 물류 모드 기반 탄소 산출
        const cbamTax = dest === 'EU' ? (carbonKg / 1000) * destData.cbam_tax * 1000 : 0;

        // 최종 {t.logisticsCost} 산출: 기본 요금(전체 물량 분담) + (무게 * 모드별 단가) + 리스크 운임 반영
        const weightRate = customWeightRate !== null ? customWeightRate : (freightMode === 'air' ? 8500 : 800);
        const baseFinalShip = customBaseFreight !== null ? customBaseFreight : (freightMode === 'air' ? (destData?.ship_air[assy] ?? 500000) : (destData?.ship_sea[assy] ?? 150000));
        const finalShip = ((baseFinalShip / volume) + (totalWeight * weightRate)) * (1 - shipDiscount) * stressFactor * riskShippingFactor;

        const vatRate = destData?.vat ?? 0.0;
        const vatableAmount = mfg + finalShip + finalDuty;
        const vatAmount = vatableAmount * vatRate;

        // 인증 및 금형(Tooling) 비용
        const certTotal = selectedCerts.reduce((acc, c) => acc + (db.certifications as any)[c].cost, 0);
        const toolingData = (db.tooling_costs as any)[industry];
        const toolingTotal = includeTooling ? (toolingData.mold + toolingData.jig) : 0;

        const amortizedFixedCost = (certTotal + toolingTotal) / volume;
        const fFixed = mFixed ?? amortizedFixedCost;

        // 인코텀즈 단계별 계산
        const exw = mfg + fFixed;

        // 내륙 운송비 및 항만 비용 (Inland)
        const inlandMap: Record<string, number> = { KR: 18000, CN: 25000, VN: 20000, IN: 30000, MX: 22000, TH: 21000 };
        const inlandCost = customInland !== null ? customInland : (inlandMap[assy] ?? 18000);
        const fob = exw + inlandCost;

        const effectiveShip = customShip !== null ? customShip : finalShip;
        const effectiveTax = customTax !== null ? customTax : (finalDuty + invCost + cbamTax + vatAmount);

        const landedCost = fob + effectiveShip + effectiveTax;

        // 선택된 인코텀즈에 따른 최종 제안가
        const baseQuote = incoterm === 'EXW' ? exw : incoterm === 'FOB' ? fob : landedCost;
        const finalPrice = baseQuote * (1 + profitMargin);

        // 타임라인 데이터 (일 단위)
        const timeline = {
            mfg: customMfgDays !== null ? customMfgDays : Math.round(15 * (1 - laborDiscount)), // 생산 15일 기준
            qc: customQcDays !== null ? customQcDays : (qcLevel === 'premium' ? 5 : 2), // QC 기간
            logistics: customLtDays !== null ? customLtDays : Math.round(ltDays) // 물류 및 통관
        };
        const totalLT = timeline.mfg + timeline.qc + timeline.logistics;

        return {
            partsCost: Math.round(fParts), interDuty: Math.round(interDuty), interShip: Math.round(interShip), drawback: Math.round(drawback), vadd: Math.round(vadd), mfg: Math.round(mfg), rvc, isOriginMatch,
            finalOrigin, finalRate, finalDuty: Math.round(finalDuty), ltDays, invCost: Math.round(invCost), cbamTax: Math.round(cbamTax), carbonKg,
            finalShip: Math.round(finalShip), vatAmount: Math.round(vatAmount), vatRate, landedCost: Math.round(landedCost), loc, bomDiscount, shipDiscount, laborDiscount, volume,
            amortizedFixedCost: Math.round(fFixed), finalPrice: Math.round(finalPrice), profitMargin, labor: Math.round(fLabor), utilityTotal: Math.round(fUtil), overhead: Math.round(fOverhead), qcCost: Math.round(qcCost), scrapCost: Math.round(Math.max(0, fScrap - qcCost)),
            toolingTotal: Math.round(toolingTotal), certTotal: Math.round(certTotal), timeline, totalLT,
            exw: Math.round(exw), fob: Math.round(fob), ddp: Math.round(landedCost), inlandCost: Math.round(inlandCost),
            actualShip: Math.round(effectiveShip), actualTax: Math.round(effectiveTax),
            scrapRate: (fScrap - qcCost) / (fParts + fLabor + fUtil),
            mfgBase: (fParts + fLabor + fUtil),
            totalWeight, weightRate, baseFinalShip, // Export logic for freight method display
            riskImpact, // 리스크 복합 충격 데이터
        };
    }, [assy, dest, useDrawback, bomOrigins, volumeStr, industry, selectedCerts, profitMargin, isStressMode, qcLevel, freightMode, includeTooling, incoterm, customInland, customShip, customTax, overrideDiscounts, manualBomDiscount, manualLaborDiscount, manualShipDiscount, customComponents, mParts, mLabor, mScrap, mFixed, mUtil, mOverhead, customMfgDays, customQcDays, customLtDays, customBaseFreight, customWeightRate, ftaThreshold, activeRisks]);

    const sensitivityResult = useMemo(() => {
        if (!simData) return null;
        const base = simData.landedCost;
        if (!base) return null;

        const erFactor     = 1 + sensitivity.exchangeRate / 100;
        const laborFactor  = 1 + sensitivity.laborCost    / 100;
        const matFactor    = 1 + sensitivity.materialCost / 100;
        const volFactor    = sensitivity.volume >= 0
            ? 1 + sensitivity.volume / 100
            : 1 / (1 - sensitivity.volume / 100);
        const tariffAdd    = simData.mfg * (sensitivity.tariffRate / 100);
        const shipFactor   = 1 + sensitivity.shippingCost / 100;

        const adjParts  = simData.partsCost * matFactor * erFactor;
        const adjLabor  = simData.labor     * laborFactor * erFactor;
        const adjVadd   = simData.vadd - simData.labor + adjLabor;
        const adjMfg    = adjParts + adjVadd + (simData.mfg - simData.partsCost - simData.vadd);
        const adjShip   = simData.finalShip * shipFactor * erFactor;
        const adjDuty   = simData.finalDuty + tariffAdd;
        const adjVat    = (adjMfg + adjShip + adjDuty) * (simData.vatRate ?? 0);
        let adjTotal = adjMfg + adjShip + adjDuty + adjVat + simData.invCost + simData.cbamTax;
        const volScale  = volFactor > 1 ? (1 - (volFactor - 1) * 0.12) : (1 + (1 - volFactor) * 0.15);
        adjTotal = adjTotal * Math.max(0.5, Math.min(2, volScale));

        const delta = adjTotal - base;
        const deltaRate = base > 0 ? (delta / base) * 100 : 0;
        return { adjTotal: Math.round(adjTotal), delta: Math.round(delta), deltaRate };
    }, [simData, sensitivity]);

    const exportToExcel = () => {
        const wb = XLSX.utils.book_new();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

        // Filter scenarios based on selection
        const targetScenarios = scenarios.filter(s => exportSelections.includes(s.id));
        const includeCurrent = exportSelections.includes('current');

        const summaryData = [];

        if (includeCurrent) {
            summaryData.push({
                "No": "Current",
                "Scenario Name": "Current Simulation",
                "Landed Cost": Math.round(simData.landedCost),
                "Target Price": Math.round(simData.finalPrice),
                "Expected Margin (%)": (((simData.finalPrice - simData.landedCost) / (simData.finalPrice || 1)) * 100).toFixed(2) + "%",
                "Lead Time (Days)": simData.totalLT,
                "Logistics & Duty": Math.round(simData.actualShip + simData.actualTax),
                "Status": "Active"
            });
        }

        targetScenarios.forEach((s, idx) => {
            summaryData.push({
                "No": idx + 1,
                "Scenario Name": s.name,
                "Landed Cost": Math.round(s.landedCost),
                "Target Price": Math.round(s.finalPrice),
                "Expected Margin (%)": (((s.finalPrice - s.landedCost) / (s.finalPrice || 1)) * 100).toFixed(2) + "%",
                "Lead Time (Days)": s.lt,
                "Logistics & Duty": Math.round(s.ship + s.duty),
                "Status": "Saved"
            });
        });

        const wsSummary = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, wsSummary, "Summary Overview");

        // Detailed Cost Analysis Sheet
        const analysisData = [];
        if (includeCurrent) {
            analysisData.push({
                "Scenario": "Current Simulation",
                "Assembly Hub": assy,
                "Target Market": dest,
                "Volume (Units)": parseInt(volumeStr),
                "Total Mfg Cost": Math.round(simData.mfg),
                "Materials (BOM)": Math.round(simData.partsCost),
                "Value Added": Math.round(simData.vadd),
                "Total Logistics": Math.round(simData.actualShip),
                "Total Duty/Tax": Math.round(simData.actualTax),
                "Lead Time (Days)": simData.totalLT
            });
        }
        targetScenarios.forEach(s => {
            analysisData.push({
                "Scenario": s.name,
                "Assembly Hub": s.assy,
                "Target Market": s.dest,
                "Volume (Units)": s.volume,
                "Total Mfg Cost": Math.round(s.mfg),
                "Materials (BOM)": Math.round(s.partsCost),
                "Value Added": Math.round(s.vadd),
                "Total Logistics": Math.round(s.ship),
                "Total Duty/Tax": Math.round(s.duty + s.vat),
                "Lead Time (Days)": s.lt
            });
        });

        if (analysisData.length > 0) {
            const wsAnalysis = XLSX.utils.json_to_sheet(analysisData);
            XLSX.utils.book_append_sheet(wb, wsAnalysis, "Cost Analysis");
        }

        // Sheet 3: Current BOM Breakdown
        const currentComponentsReport = customComponents.map(c => {
            const ori = bomOrigins[c.id] || (c as any).origin;
            const dutyRate = (ori !== assy) ? 0.08 : 0;
            return {
                "Component ID": c.id,
                "Name": c.name,
                "HS Code": (c as any).hs || "N/A",
                "Origin": ori,
                "Unit Price (Raw)": c.price,
                "Duty Rate": (dutyRate * 100).toFixed(1) + "%",
                "Landed Unit Cost": Math.round(c.price * (1 + dutyRate)),
                "Weight (kg)": (c as any).weight || 0,
                "Energy (kWh)": (c as any).energy || 0
            };
        });
        const wsBOM = XLSX.utils.json_to_sheet(currentComponentsReport);
        XLSX.utils.book_append_sheet(wb, wsBOM, "BOM Details");

        // Sheet 4: Market & Regulatory Config
        const marketData = [{
            "Metric": "Current Global Settings",
            "Incoterm": incoterm,
            "Currency": currency,
            "Manufacturing Mode": isStressMode ? "STRESS MODE (High Risk)" : "STANDARD",
            "Labor Rate (Hourly)": formatVal(db.locations[assy as keyof typeof db.locations]?.labor || 0),
            "Average Shipping LT": simData.ltDays + " Days",
            "Drawback Applied": useDrawback ? "YES" : "NO",
            "Tooling Included": includeTooling ? "YES" : "NO"
        }];
        const wsMarket = XLSX.utils.json_to_sheet(marketData);
        XLSX.utils.book_append_sheet(wb, wsMarket, "Market Config");

        XLSX.writeFile(wb, `Global_Manufacturing_Cost_Report_${timestamp}.xlsx`);
    };

    const exportToPdf = () => {
        const reportWindow = window.open('', '_blank');
        if (!reportWindow) {
            toast('warning', t.popupBlocked);
            return;
        }

        const timestamp = new Date().toLocaleString();
        const targetScenarios = scenarios.filter(s => exportSelections.includes(s.id));
        const includeCurrent = exportSelections.includes('current');
        const includeComparison = exportSelections.includes('comparison');

        // Display data construction
        const displayScenarios: any[] = [];
        if (includeCurrent) {
            displayScenarios.push({
                id: 'current',
                name: 'Current Detail Analysis',
                assy, dest,
                volume: parseInt(volumeStr),
                mfg: simData.mfg,
                partsCost: simData.partsCost,
                vadd: simData.vadd,
                ship: simData.inlandCost + simData.actualShip,
                duty: simData.actualTax,
                fixedCost: simData.amortizedFixedCost,
                inlandCost: simData.inlandCost,
                lt: simData.totalLT,
                landedCost: simData.landedCost,
                finalPrice: simData.finalPrice,
                rvc: simData.rvc,
                isCurrent: true
            });
        }
        targetScenarios.forEach(s => {
            displayScenarios.push({
                ...s,
                isCurrent: false,
                // Ensure fields exist for old saved data too
                ship: (s.ship || 0) + (s.inlandCost || s.fullState?.customInland || (s.assy === 'CN' ? 25000 : 18000)),
                fixedCost: s.fixedCost || s.fullState?.mFixed || 0
            });
        });

        let compScenarios: any[] = [];
        if (includeComparison) {
            // 비교 분석 대상: 명시적으로 선택된 저장된 시나리오가 있다면 그것들을, 없다면 전체 저장된 시나리오를 사용. ("Current" 제외)
            const savedToCompare = targetScenarios.length > 0 ? targetScenarios : scenarios;
            compScenarios = savedToCompare.map(s => ({ ...s, isCurrent: false }));
        }

        const bestPriceScenarioPDF = compScenarios.length > 0 ? [...compScenarios].sort((a, b) => a.landedCost - b.landedCost)[0] : null;
        const bestLtScenarioPDF = compScenarios.length > 0 ? [...compScenarios].sort((a, b) => a.lt - b.lt)[0] : null;

        const html = `
            <html>
                <head>
                    <title>${t.simulatorTitle} - Strategic Report</title>
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
                    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800;900&display=swap" rel="stylesheet">
                    <style>
                        @page { size: A4 portrait; margin: 10mm; }
                        body { font-family: 'Outfit', 'Pretendard', sans-serif; color: #1e293b; background: #f8fafc; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                        .page { position: relative; width: 100%; max-width: 210mm; padding: 10mm 12mm; margin: auto; box-sizing: border-box; background: white; min-height: 297mm; }
                        
                        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
                        .logo-area { display: flex; align-items: center; gap: 12px; }
                        .logo-box { width: 36px; height: 36px; background: #3b82f6; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 16px; }
                        .brand-name { font-size: 18px; font-weight: 900; color: #0f172a; letter-spacing: -0.02em; }
                        
                        .report-title { font-size: 32px; font-weight: 900; color: #0f172a; margin-bottom: 5px; }
                        .report-date { font-size: 13px; color: #64748b; font-weight: 600; }
                        
                        .divider { height: 1px; background: #e2e8f0; margin: 15px 0 20px 0; }
                        
                        .scenario-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; margin-bottom: 20px; background: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); width: 100%; box-sizing: border-box; page-break-inside: avoid; }
                        .scenario-title { font-size: 15px; font-weight: 900; color: #0f172a; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; page-break-after: avoid; }
                        .badge-active { background: #eff6ff; color: #3b82f6; font-size: 10px; padding: 3px 8px; border-radius: 12px; border: 1px solid #bfdbfe; font-weight: 800; margin-left:8px; }
                        
                        .bar-container { height: 24px; display: flex; border-radius: 6px; overflow: hidden; margin-bottom: 10px; width: 100%; }
                        .bar-segment { display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; font-weight: 800; text-shadow: 0 1px 2px rgba(0,0,0,0.2); }
                        
                        .legend-area { display: flex; gap: 12px; margin-bottom: 20px; font-size: 10px; font-weight: 700; color: #475569; justify-content: center; }
                        .legend-item { display: flex; align-items: center; gap: 6px; }
                        .legend-color { width: 10px; height: 10px; border-radius: 3px; }

                        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
                        .kpi-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #ffffff; }
                        .kpi-title { font-size: 9px; font-weight: 800; color: #64748b; margin-bottom: 6px; text-transform: uppercase; }
                        .kpi-value { font-size: 18px; font-weight: 900; color: #0f172a; }

                        .bridge-table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 0; }
                        .bridge-table td { padding: 6px 0; }
                        .bridge-label { font-weight: 800; color: #334155; width: 35%; }
                        
                        .btn-print { position: fixed; bottom: 30px; right: 30px; padding: 15px 30px; background: #0f172a; color: white; border: none; border-radius: 50px; cursor: pointer; font-weight: 800; z-index: 1000; box-shadow: 0 10px 25px rgba(0,0,0,0.2); transition: 0.2s; }
                        .btn-print:hover { background: #1e293b; transform: translateY(-2px); }
                        @media print { .btn-print { display: none; } body { background: white; } .page { padding: 8mm 10mm; margin: 0; box-shadow: none; min-height: auto; width: 100%; max-width: 100%; } }
                    </style>
                </head>
                <body>
                    <button class="btn-print" onclick="window.print()">PRINT REPORT / SAVE AS PDF</button>
                    <div class="page">
                        <div class="header">
                            <div class="logo-area">
                                <div class="logo-box"><i class="fas fa-microchip"></i></div>
                                <span class="brand-name">Operation Insight Lab</span>
                            </div>
                            <div class="report-date">${timestamp}</div>
                        </div>

                        <h1 class="report-title">${projectTitle} - ${t.simulatorTitle} Summary</h1>
                        <div class="report-date">Target Context: ${displayScenarios.length} Scenario(s) Cost Structure Analysis ${includeComparison ? '& Comparative Analysis' : ''}</div>

                        <div class="divider"></div>

                        ${displayScenarios.map((s: any) => {
            const total = s.landedCost || 1;
            const pBom = Math.round(((s.mfg - s.vadd) / total) * 100);
            const pVadd = Math.round((s.vadd / total) * 100);
            const pFixed = Math.round(((s.fixedCost || 0) / total) * 100);
            const pShip = Math.round(((s.ship || 0) / total) * 100);
            const pTax = Math.max(0, 100 - pBom - pVadd - pFixed - pShip);
            const rvcValue = s.rvc ? s.rvc.toFixed(1) : ((s.vadd / s.mfg) * 100).toFixed(1);

            const comps = s.isCurrent ? customComponents : (s.fullState?.customComponents || []);
            const origins = s.isCurrent ? bomOrigins : (s.fullState?.bomOrigins || {});

            return `
                            <div class="scenario-card">
                                <div class="scenario-title">
                                    <i class="fas fa-layer-group" style="color: #3b82f6;"></i> 
                                    ${s.name} ${s.isCurrent ? '<span class="badge-active">Active Simulation</span>' : ''}
                                </div>

                                <!-- Stacked Bar Chart -->
                                <div class="bar-container">
                                    ${pBom > 0 ? `<div class="bar-segment" style="width: ${pBom}%; background: #3b82f6;">${pBom}%</div>` : ''}
                                    ${pVadd > 0 ? `<div class="bar-segment" style="width: ${pVadd}%; background: #60a5fa;">${pVadd}%</div>` : ''}
                                    ${pFixed > 0 ? `<div class="bar-segment" style="width: ${pFixed}%; background: #94a3b8;">${pFixed}%</div>` : ''}
                                    ${pShip > 0 ? `<div class="bar-segment" style="width: ${pShip}%; background: #fbbf24;">${pShip}%</div>` : ''}
                                    ${pTax > 0 ? `<div class="bar-segment" style="width: ${pTax}%; background: #f87171;">${pTax}%</div>` : ''}
                                </div>
                                
                                <div class="legend-area">
                                    ${pBom > 0 ? `<div class="legend-item"><div class="legend-color" style="background: #3b82f6;"></div> ${t.bomCost} ${pBom}%</div>` : ''}
                                    ${pVadd > 0 ? `<div class="legend-item"><div class="legend-color" style="background: #60a5fa;"></div> ${t.procCost} ${pVadd}%</div>` : ''}
                                    ${pFixed > 0 ? `<div class="legend-item"><div class="legend-color" style="background: #94a3b8;"></div> ${t.fixedCost} ${pFixed}%</div>` : ''}
                                    ${pShip > 0 ? `<div class="legend-item"><div class="legend-color" style="background: #fbbf24;"></div> ${t.logisticsCost} ${pShip}%</div>` : ''}
                                    ${pTax > 0 ? `<div class="legend-item"><div class="legend-color" style="background: #f87171;"></div> ${t.taxCost} ${pTax}%</div>` : ''}
                                </div>

                                <!-- KPI Cards -->
                                <div class="kpi-grid">
                                    <div class="kpi-card" style="background: #eff6ff; border-color: #bfdbfe;">
                                        <div class="kpi-title" style="color: #3b82f6;">Target DDP Quote</div>
                                        <div class="kpi-value" style="color: #1e40af;">${formatVal(s.finalPrice)}</div>
                                    </div>
                                    <div class="kpi-card">
                                        <div class="kpi-title">LANDED COST</div>
                                        <div class="kpi-value">${formatVal(s.landedCost)}</div>
                                    </div>
                                    <div class="kpi-card">
                                        <div class="kpi-title">ORIGIN (RVC%)</div>
                                        <div class="kpi-value" style="color: #10b981;">${s.assy} <span style="font-size:12px; color:#64748b;">(${rvcValue}%)</span></div>
                                    </div>
                                    <div class="kpi-card">
                                        <div class="kpi-title">LEAD TIME / LOG.</div>
                                        <div class="kpi-value">${s.lt}일</div>
                                    </div>
                                </div>

                                <!-- Timeline -->
                                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
                                    <div style="font-size: 11px; font-weight: 900; color: #0f172a; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                                        <i class="fas fa-clock" style="color: #64748b;"></i> Supply Chain Timeline
                                    </div>
                                    <div style="display: flex; height: 24px; border-radius: 6px; overflow: hidden; margin-bottom: 15px; font-size: 10px; font-weight: 800; color: white; text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,0.2);">
                                        <div style="width: ${(s.isCurrent ? simData.timeline.mfg : (s.fullState?.customMfgDays ?? 15)) / (s.lt || 1) * 100}%; background: #64748b; display: flex; align-items: center; justify-content: center;">
                                            ${s.isCurrent ? simData.timeline.mfg : (s.fullState?.customMfgDays ?? 15)}일
                                        </div>
                                        <div style="width: ${(s.isCurrent ? simData.timeline.qc : (s.fullState?.customQcDays ?? 2)) / (s.lt || 1) * 100}%; background: #94a3b8; display: flex; align-items: center; justify-content: center;">
                                            ${s.isCurrent ? simData.timeline.qc : (s.fullState?.customQcDays ?? 2)}일
                                        </div>
                                        <div style="width: ${(s.isCurrent ? simData.timeline.logistics : (s.fullState?.customLtDays ?? 14)) / (s.lt || 1) * 100}%; background: #3b82f6; display: flex; align-items: center; justify-content: center;">
                                            ${s.isCurrent ? simData.timeline.logistics : (s.fullState?.customLtDays ?? 14)}일
                                        </div>
                                    </div>
                                    <div style="display: grid; grid-template-columns: repeat(3, 1fr) 80px; gap: 8px; font-size: 10px; color: #64748b; font-weight: 700;">
                                        <div>
                                            <div style="color: #94a3b8; font-size: 9px; margin-bottom: 2px;">Production</div>
                                            <div style="font-weight: 800; color: #334155;">${s.isCurrent ? simData.timeline.mfg : (s.fullState?.customMfgDays ?? 15)}일</div>
                                        </div>
                                        <div>
                                            <div style="color: #94a3b8; font-size: 9px; margin-bottom: 2px;">QC/Test</div>
                                            <div style="font-weight: 800; color: #334155;">${s.isCurrent ? simData.timeline.qc : (s.fullState?.customQcDays ?? 2)}일</div>
                                        </div>
                                        <div>
                                            <div style="color: #94a3b8; font-size: 9px; margin-bottom: 2px;">Logistics</div>
                                            <div style="font-weight: 800; color: #334155;">${s.isCurrent ? simData.timeline.logistics : (s.fullState?.customLtDays ?? 14)}일</div>
                                        </div>
                                        <div style="text-align: right; border-left: 1px solid #e2e8f0; padding-left: 10px;">
                                            <div style="color: #0f172a; font-size: 10px; font-weight: 900; margin-bottom: 2px;">TOTAL</div>
                                            <div style="font-size: 14px; color: #0f172a; font-weight: 900;">${s.lt}일</div>
                                        </div>
                                    </div>
                                </div>

                                <!-- EXW to DDP Bridge Table -->
                                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px;">
                                    <div style="font-size: 11px; font-weight: 900; color: #0f172a; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                                        <i class="fas fa-flag" style="color: #10b981;"></i> 원가 상승 요인 분석 (EXW &rarr; DDP Bridge)
                                    </div>
                                    
                                    <table class="bridge-table">
                                        <tbody>
                                            <tr style="border-bottom: 1px dashed #cbd5e1;">
                                                <td class="bridge-label">EXW (제조원가 포함 가공비/BOM)</td>
                                                <td style="width: 45%;">
                                                    <div style="width: ${(s.mfg / total) * 100}%; height: 8px; background: #3b82f6; border-radius: 4px;"></div>
                                                </td>
                                                <td style="text-align: right; font-weight: 800; color: #334155; width: 20%;">${formatVal(s.mfg)}</td>
                                            </tr>
                                            <!-- EXW Breakdown Details inside the Bridge -->
                                            <tr style="background: #f1f5f9; border-bottom: 1px dashed #cbd5e1;">
                                                <td colspan="3" style="padding: 12px 15px;">
                                                    <div style="font-size: 11px; font-weight: 800; color: #475569; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                                                        <i class="fas fa-microchip" style="color: #64748b;"></i> 제조 원가(EXW) 상세 산출 내역
                                                    </div>
                                                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; text-align: center; margin-bottom: 15px;">
                                                        <div>
                                                            <div style="font-size: 9px; color: #64748b; margin-bottom: 2px;">자재(BOM)</div>
                                                            <div style="font-weight: 800; font-size: 12px; color: #1e293b;">${formatVal(s.partsCost)}</div>
                                                        </div>
                                                        <div>
                                                            <div style="font-size: 9px; color: #64748b; margin-bottom: 2px;">인건비/공임</div>
                                                            <div style="font-weight: 800; font-size: 12px; color: #1e293b;">${formatVal(s.isCurrent ? simData.labor : (s.fullState?.mLabor ?? 0))}</div>
                                                        </div>
                                                        <div>
                                                            <div style="font-size: 9px; color: #64748b; margin-bottom: 2px;">QC/불량(Scrap)</div>
                                                            <div style="font-weight: 800; font-size: 12px; color: #e11d48;">
                                                                <div>${formatVal(s.isCurrent ? (simData.qcCost + simData.scrapCost) : (s.fullState?.mScrap ?? 0))}</div>
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div style="font-size: 9px; color: #64748b; margin-bottom: 2px;">고정비(인증/금형)</div>
                                                            <div style="font-weight: 800; font-size: 12px; color: #1e293b;">${formatVal(s.isCurrent ? simData.amortizedFixedCost : (s.fullState?.mFixed ?? 0))}</div>
                                                        </div>
                                                    </div>
                                                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; text-align: center; padding-top: 10px; border-top: 1px dashed #cbd5e1;">
                                                        <div>
                                                            <div style="font-size: 9px; color: #64748b; margin-bottom: 2px;">유틸리티/임차</div>
                                                            <div style="font-weight: 800; font-size: 12px; color: #1e293b;">${formatVal(s.isCurrent ? simData.utilityTotal : (s.fullState?.mUtil ?? 0))}</div>
                                                        </div>
                                                        <div>
                                                            <div style="font-size: 9px; color: #64748b; margin-bottom: 2px;">간접비(Overhead)</div>
                                                            <div style="font-weight: 800; font-size: 12px; color: #1e293b;">${formatVal(s.isCurrent ? simData.overhead : (s.fullState?.mOverhead ?? 0))}</div>
                                                        </div>
                                                        <div>
                                                            <div style="font-size: 9px; color: #64748b; margin-bottom: 2px;">부품 조달 물류/관세</div>
                                                            <div style="font-weight: 800; font-size: 12px; color: #1e293b;">${formatVal(s.isCurrent ? ((simData.interShip || 0) + (simData.interDuty || 0) - (simData.drawback || 0)) : (s.mfg - s.partsCost - (s.fullState?.mLabor ?? 0) - (s.fullState?.mScrap ?? 0) - (s.fullState?.mFixed ?? 0) - (s.fullState?.mUtil ?? 0) - (s.fullState?.mOverhead ?? 0)))}</div>
                                                        </div>
                                                        <div style="background: #e0f2fe; padding: 6px; border-radius: 6px;">
                                                            <div style="font-size: 9px; color: #0284c7; margin-bottom: 2px; font-weight: 800;">총 제조원가</div>
                                                            <div style="font-weight: 900; font-size: 13px; color: #0369a1;">${formatVal(s.mfg)}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>

                                            <tr style="border-bottom: 1px dashed #cbd5e1;">
                                                <td style="font-weight: 700; color: #64748b; padding-left: 15px;">+ 물류/운송비 (Logistics)</td>
                                                <td>
                                                    <div style="width: ${(s.ship / total) * 100}%; height: 8px; background: #fbbf24; border-radius: 4px;"></div>
                                                </td>
                                                <td style="text-align: right; font-weight: 700; color: #64748b;">${formatVal(s.ship)}</td>
                                            </tr>
                                            <tr style="border-bottom: 1px solid #cbd5e1;">
                                                <td style="font-weight: 700; color: #64748b; padding-left: 15px;">+ 관세/내국세 (Duty & Tax)</td>
                                                <td>
                                                    <div style="width: ${(s.duty / total) * 100}%; height: 8px; background: #f87171; border-radius: 4px;"></div>
                                                </td>
                                                <td style="text-align: right; font-weight: 700; color: #64748b;">${formatVal(s.duty)}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding-top: 15px; font-weight: 900; font-size: 14px; color: #0f172a;">최종 도착가 (DDP)</td>
                                                <td style="padding-top: 15px;">
                                                    <div style="width: 100%; height: 8px; background: #3b82f6; border-radius: 4px;"></div>
                                                </td>
                                                <td style="padding-top: 15px; text-align: right; font-weight: 900; font-size: 16px; color: #0f172a;">${formatVal(s.landedCost)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <!-- BOM Insight Table for this Scenario -->
                            <div style="margin-bottom: 20px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; background: #ffffff;">
                                <div style="font-size: 13px; font-weight: 900; color: #0f172a; margin-bottom: 15px; display: flex; align-items: center; gap: 8px;">
                                    <i class="fas fa-list" style="color: #3b82f6;"></i> Active Project Detail (BOM Insight)
                                </div>
                                <table style="width: 100%; border-collapse: collapse; margin: 0;">
                                    <thead>
                                        <tr>
                                            <th style="background: #f1f5f9; padding: 12px 15px; font-size: 11px; font-weight: 900; color: #475569; text-align: left; border-bottom: 2px solid #e2e8f0;">Component Name</th>
                                            <th style="background: #f1f5f9; padding: 12px 15px; font-size: 11px; font-weight: 900; color: #475569; text-align: left; border-bottom: 2px solid #e2e8f0;">Origin Hub</th>
                                            <th style="background: #f1f5f9; padding: 12px 15px; font-size: 11px; font-weight: 900; color: #475569; text-align: right; border-bottom: 2px solid #e2e8f0;">Unit Cost (RAW)</th>
                                            <th style="background: #f1f5f9; padding: 12px 15px; font-size: 11px; font-weight: 900; color: #475569; text-align: right; border-bottom: 2px solid #e2e8f0;">Part Weight</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${comps.map((c: any) => `
                                            <tr>
                                                <td style="padding: 12px 15px; font-size: 12px; border-bottom: 1px solid #f1f5f9; font-weight: 600;">${c.name}</td>
                                                <td style="padding: 12px 15px; font-size: 12px; border-bottom: 1px solid #f1f5f9; font-weight: 600;">${origins[c.id] || c.origin}</td>
                                                <td style="padding: 12px 15px; font-size: 12px; border-bottom: 1px solid #f1f5f9; font-weight: 800; text-align: right;">${formatVal(c.price)}</td>
                                                <td style="padding: 12px 15px; font-size: 12px; border-bottom: 1px solid #f1f5f9; font-weight: 600; text-align: right;">${c.weight || 0}kg</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        `;
        }).join('')}

                        ${includeComparison && compScenarios.length > 0 ? `
                        <div style="${displayScenarios.length > 0 ? 'page-break-before: always;' : ''} padding-top: 20px;">
                            <h2 style="font-size: 24px; font-weight: 900; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 25px; display: flex; align-items: center; gap: 10px;">
                                <i class="fas fa-chart-bar" style="color: #3b82f6;"></i> Scenario Comparative Analysis
                            </h2>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px;">
                                <div style="padding: 20px; border-left: 6px solid #10b981; background: #f0fdf4; border-radius: 12px;">
                                    <div style="font-size: 11px; font-weight: 900; color: #059669; margin-bottom: 5px;">LOWEST LANDED COST</div>
                                    <div style="font-size: 16px; font-weight: 900; color: #0f172a; margin-bottom: 5px;">${bestPriceScenarioPDF?.name}</div>
                                    <div style="font-size: 22px; font-weight: 900; color: #10b981;">${formatVal(bestPriceScenarioPDF?.landedCost || 0)}</div>
                                    <div style="display: flex; gap: 20px; margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(16,185,129,0.2);">
                                        <div>
                                            <div style="font-size: 10px; color: #64748b; font-weight: 700;">Mfg Cost</div>
                                            <div style="font-size: 13px; color: #0f172a; font-weight: 800;">${formatVal(bestPriceScenarioPDF?.mfg || 0)}</div>
                                        </div>
                                        <div>
                                            <div style="font-size: 10px; color: #64748b; font-weight: 700;">Logistics & Tax</div>
                                            <div style="font-size: 13px; color: #0f172a; font-weight: 800;">${formatVal((bestPriceScenarioPDF?.ship || 0) + (bestPriceScenarioPDF?.duty || 0) + (bestPriceScenarioPDF?.vat || 0))}</div>
                                        </div>
                                    </div>
                                </div>
                                <div style="padding: 20px; border-left: 6px solid #3b82f6; background: #eff6ff; border-radius: 12px;">
                                    <div style="font-size: 11px; font-weight: 900; color: #2563eb; margin-bottom: 5px;">FASTEST DELIVERY</div>
                                    <div style="font-size: 16px; font-weight: 900; color: #0f172a; margin-bottom: 5px;">${bestLtScenarioPDF?.name}</div>
                                    <div style="font-size: 22px; font-weight: 900; color: #3b82f6;">${bestLtScenarioPDF?.lt} Days</div>
                                    <div style="display: flex; gap: 20px; margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(59,130,246,0.2);">
                                        <div>
                                            <div style="font-size: 10px; color: #64748b; font-weight: 700;">Mfg Cost</div>
                                            <div style="font-size: 13px; color: #0f172a; font-weight: 800;">${formatVal(bestLtScenarioPDF?.mfg || 0)}</div>
                                        </div>
                                        <div>
                                            <div style="font-size: 10px; color: #64748b; font-weight: 700;">Logistics & Tax</div>
                                            <div style="font-size: 13px; color: #0f172a; font-weight: 800;">${formatVal((bestLtScenarioPDF?.ship || 0) + (bestLtScenarioPDF?.duty || 0) + (bestLtScenarioPDF?.vat || 0))}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin: 0; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                                <thead>
                                    <tr style="background: #f8fafc; color: #64748b;">
                                        <th style="padding: 15px; font-weight: 900; border-bottom: 1px solid #e2e8f0; text-align: left;">Scenario</th>
                                        <th style="padding: 15px; font-weight: 900; border-bottom: 1px solid #e2e8f0; text-align: right;">Mfg Cost</th>
                                        <th style="padding: 15px; font-weight: 900; border-bottom: 1px solid #e2e8f0; text-align: right;">Logistics</th>
                                        <th style="padding: 15px; font-weight: 900; border-bottom: 1px solid #e2e8f0; text-align: right;">Duty/Tax</th>
                                        <th style="padding: 15px; font-weight: 900; border-bottom: 1px solid #e2e8f0; text-align: center;">LT (Day)</th>
                                        <th style="padding: 15px; font-weight: 900; border-bottom: 1px solid #e2e8f0; text-align: center;">FTA(RVC)</th>
                                        <th style="padding: 15px; font-weight: 900; border-bottom: 1px solid #e2e8f0; text-align: right;">Target Price</th>
                                        <th style="padding: 15px; font-weight: 900; border-bottom: 1px solid #e2e8f0; text-align: right;">Landed Cost</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${[...compScenarios].sort((a, b) => a.landedCost - b.landedCost).map((s, idx) => `
                                        <tr style="border-bottom: 1px solid #f1f5f9; background: ${idx % 2 === 0 ? 'white' : '#f8fafc'}; color: #334155;">
                                            <td style="padding: 15px; font-weight: 900; font-size: 13px; color: #0f172a;">${s.name} <div style="font-size: 9px; color: #94a3b8; margin-top: 4px; font-weight: 800;">RANK #${idx + 1}</div></td>
                                            <td style="padding: 15px; text-align: right; font-weight: 600;">${formatVal(s.mfg)}</td>
                                            <td style="padding: 15px; text-align: right; font-weight: 600;">${formatVal(s.ship)}</td>
                                            <td style="padding: 15px; text-align: right; font-weight: 600;">${formatVal(s.duty + (s.vat || 0))}</td>
                                            <td style="padding: 15px; text-align: center; font-weight: 600;">${s.lt}</td>
                                            <td style="padding: 15px; text-align: center; font-weight: 900; color: ${(s.rvc || 0) >= 40 ? '#10b981' : '#f87171'};">${(s.rvc || 0).toFixed(1)}%</td>
                                            <td style="padding: 15px; text-align: right; font-weight: 700;">${formatVal(s.finalPrice || 0)}</td>
                                            <td style="padding: 15px; text-align: right; font-weight: 900; font-size: 14px; color: ${idx === 0 ? '#10b981' : '#1e293b'};">${formatVal(s.landedCost)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        ` : ''}

                        <div style="margin-top: 50px; padding: 20px; background: #fffbeb; border-radius: 12px; font-size: 11px; color: #92400e; line-height: 1.6;">
                            <strong>Strategic Disclaimer:</strong> This report is generated based on simulated data and market estimates. Final landed costs and regulatory compliance should be verified with local customs brokers and actual logistics quotes at the time of shipment.
                        </div>
                        
                        <div style="margin-top: 20px; text-align: center; font-size: 11px; color: #94a3b8;">
                            &copy; HELP ALL TECH - Operation Insight Lab. Generated dynamically based on user scenario selections.
                        </div>
                    </div>
                </body>
            </html>
        `;
        reportWindow.document.write(html);
        reportWindow.document.close();
        setIsExportModalOpen(false);
    };

    const handleAssyChange = (val: AssyHub) => { setAssy(val); setAiPanelState('hidden'); };
    const handleDestChange = (val: string) => { setDest(val); setAiPanelState('hidden'); };
    const handleDrawbackChange = (val: boolean) => { setUseDrawback(val); setAiPanelState('hidden'); };
    const handleVolumeChange = (val: string) => {
        setVolumeStr(val);
        setAiPanelState('hidden');
        setOverrideDiscounts(false); // Reset to auto when selecting a new volume
    };
    const loadTemplate = (val: string) => {
        const examples = (db as any).industry_examples[val] || (db as any).industry_examples.electronics;
        setCustomComponents([...examples]);
        setBomOrigins(examples.reduce((acc: any, c: any) => ({ ...acc, [c.id]: c.origin }), {}));
    };

    const handleIndustryChange = (val: string) => {
        setIndustry(val);
        setAiPanelState('hidden');

        // Clear query if it matches a label to keep state clean
        const matchedOption = industryOptions.find(o => o.value === val);
        if (matchedOption) {
            setIndustryQuery('');
        }

        // Only auto-load template if it's a known industry key and BOM is empty
        if (customComponents.length === 0 && val !== 'none' && (db as any).industry_examples[val]) {
            loadTemplate(val);
        }
    };
    const toggleCert = (id: string) => {
        setSelectedCerts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
        setAiPanelState('hidden');
    };

    const handleBomChange = (id: string, val: 'KR' | 'CN') => {
        setBomOrigins(prev => ({ ...prev, [id]: val }));
        setAiPanelState('hidden');
    };

    const addCustomComponent = () => {
        if (!newComp.name || newComp.price <= 0) return;
        const id = "COMP_" + Math.random().toString(36).substr(2, 5);
        const nc = { ...newComp, id, energy: 1.0 };
        setCustomComponents([...customComponents, nc]);
        setBomOrigins(prev => ({ ...prev, [id]: newComp.origin }));
        setNewComp({ name: '', price: 0, hs: '', weight: 0.1, origin: 'CN' });
        setShowAddForm(false);
        setAiPanelState('hidden');
    };

    const removeComponent = (id: string) => {
        setCustomComponents(customComponents.filter(c => c.id !== id));
        setAiPanelState('hidden');
    };

    const updateCustomComponent = (id: string, field: string, value: any) => {
        setCustomComponents(customComponents.map(c => c.id === id ? { ...c, [field]: value } : c));
        setAiPanelState('hidden');
    };

    const loadScenario = (s: Scenario) => {
        if (!s.fullState) {
            toast('warning', t.oldScenario);
            return;
        }
        const st = s.fullState;
        if (st.projectTitle) setProjectTitle(st.projectTitle);
        setAssy(st.assy);
        setDest(st.dest);
        setIndustry(st.industry);
        setUseDrawback(st.useDrawback);
        setVolumeStr(st.volumeStr);
        setCustomComponents(st.customComponents);
        setBomOrigins(st.bomOrigins);
        setSelectedCerts(st.selectedCerts);
        setProfitMargin(st.profitMargin);
        setIsStressMode(st.isStressMode);
        setQcLevel(st.qcLevel);
        setFreightMode(st.freightMode);
        setIncludeTooling(st.includeTooling);
        setIncoterm(st.incoterm);
        setFtaThreshold(st.ftaThreshold);
        setOverrideDiscounts(st.overrideDiscounts);
        setManualBomDiscount(st.manualBomDiscount);
        setManualLaborDiscount(st.manualLaborDiscount);
        setManualShipDiscount(st.manualShipDiscount);
        setCustomInland(st.customInland);
        setCustomShip(st.customShip);
        setCustomTax(st.customTax);
        setMParts(st.mParts);
        setMLabor(st.mLabor);
        setMScrap(st.mScrap);
        setMFixed(st.mFixed);
        setMUtil(st.mUtil);
        setMOverhead(st.mOverhead);
        setCustomMfgDays(st.customMfgDays);
        setCustomQcDays(st.customQcDays);
        setCustomLtDays(st.customLtDays);
        setCustomBaseFreight(st.customBaseFreight);
        setCustomWeightRate(st.customWeightRate);

        setActiveTab(0); // {t.costStructure} 탭으로 이동
        setAiPanelState('hidden'); // AI 패널 초기화 (새 데이터로 분석 필요하므로)

        // 시각 효과를 위해 최상단으로 스크롤 요청이 있을 수 있으나 일단 탭 이동만
    };

    const addScenario = () => {
        if (scenarios.length >= 3) {
            toast('warning', t.maxScenario);
            return;
        }
        const newScenario: Scenario = {
            id: Math.random().toString(36).substr(2, 9),
            name: `${projectTitle} (${assy} ➔ ${dest})`,
            assy,
            dest,
            volume: parseInt(volumeStr),
            landedCost: simData.landedCost,
            mfg: simData.mfg,
            partsCost: simData.partsCost,
            vadd: simData.vadd,
            ship: simData.finalShip,
            duty: simData.finalDuty,
            inlandCost: simData.inlandCost,
            fixedCost: simData.amortizedFixedCost,
            vat: simData.vatAmount,
            carbon: simData.carbonKg,
            lt: simData.ltDays,
            rvc: simData.rvc,
            finalPrice: simData.finalPrice,
            fullState: {
                projectTitle,
                assy, dest, industry, useDrawback, volumeStr, customComponents, bomOrigins, selectedCerts,
                profitMargin, isStressMode, qcLevel, freightMode, includeTooling, incoterm, ftaThreshold,
                overrideDiscounts, manualBomDiscount, manualLaborDiscount, manualShipDiscount,
                customInland, customShip, customTax, mParts, mLabor, mScrap, mFixed, mUtil, mOverhead,
                customMfgDays, customQcDays, customLtDays, customBaseFreight, customWeightRate,
                rvc: simData.rvc
            }
        };
        setScenarios([newScenario, ...scenarios]);
    };

    const removeScenario = (id: string) => {
        setScenarios(prev => prev.filter(s => s.id !== id));
    };

    const moveScenario = (id: string, direction: 'up' | 'down') => {
        setScenarios(prev => {
            const index = prev.findIndex(s => s.id === id);
            if (index === -1) return prev;
            const newScenarios = [...prev];
            const nextIndex = direction === 'up' ? index - 1 : index + 1;
            if (nextIndex < 0 || nextIndex >= prev.length) return prev;
            [newScenarios[index], newScenarios[nextIndex]] = [newScenarios[nextIndex], newScenarios[index]];
            return newScenarios;
        });
    };

    // ─── 저장/공유 핸들러 ────────────────────────────────────
    const handleSaveSimulation = async () => {
        if (!saveSimName.trim()) return;
        setSaveLoading(true);
        try {
            const inputs = {
                projectTitle, assy, dest, industry, useDrawback, volumeStr,
                customComponents, bomOrigins, selectedCerts, profitMargin,
                isStressMode, qcLevel, freightMode, includeTooling, incoterm, ftaThreshold,
                activeRisks, specialIndustry, selectedSpecialCerts
            };
            const results = {
                landedCost: simData.landedCost, finalPrice: simData.finalPrice,
                mfg: simData.mfg, partsCost: simData.partsCost, vadd: simData.vadd,
                finalShip: simData.finalShip, finalDuty: simData.finalDuty,
                rvc: simData.rvc, totalLT: simData.totalLT, carbonKg: simData.carbonKg
            };
            const res = await fetch('/api/simulations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: saveSimName, inputs, results })
            });
            if (res.ok) {
                const data = await res.json();
                setSavedShareUrl(data.shareUrl || `${window.location.origin}/${lang}/simulator?share=${data.shareCode}`);
                // localStorage 최근 목록 저장
                const newEntry = { name: saveSimName, shareCode: data.shareCode, savedAt: new Date().toISOString(), inputs, results };
                const updated = [newEntry, ...recentSims].slice(0, 5);
                setRecentSims(updated);
                try { localStorage.setItem('nexyfab_recent_sims', JSON.stringify(updated)); } catch { }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setSaveLoading(false);
        }
    };

    const handleCopyShareUrl = () => {
        navigator.clipboard.writeText(savedShareUrl).then(() => {
            toast('success', '공유 링크가 클립보드에 복사되었습니다!');
        });
    };

    const handleLoadByCode = async () => {
        if (!shareCodeInput.trim()) return;
        try {
            const res = await fetch(`/api/simulations?code=${shareCodeInput.trim()}`);
            if (!res.ok) { toast('error', '시뮬레이션을 찾을 수 없습니다.'); return; }
            const data = await res.json();
            const st = data.inputs;
            if (st.assy) setAssy(st.assy);
            if (st.dest) setDest(st.dest);
            if (st.industry) { setIndustry(st.industry); }
            if (st.volumeStr) setVolumeStr(st.volumeStr);
            if (st.customComponents) setCustomComponents(st.customComponents);
            if (st.bomOrigins) setBomOrigins(st.bomOrigins);
            if (st.selectedCerts) setSelectedCerts(st.selectedCerts);
            if (st.profitMargin !== undefined) setProfitMargin(st.profitMargin);
            if (st.activeRisks) setActiveRisks(st.activeRisks);
            if (st.specialIndustry) setSpecialIndustry(st.specialIndustry);
            setShareCodeInput('');
            setIsSaveModalOpen(false);
            setLoadBanner(`"${data.name}" 시뮬레이션을 불러왔습니다.`);
            setTimeout(() => setLoadBanner(''), 5000);
        } catch { toast('error', '불러오기 실패'); }
    };

    const handleLoadRecent = (sim: { name: string; inputs: any }) => {
        const st = sim.inputs;
        if (st.assy) setAssy(st.assy);
        if (st.dest) setDest(st.dest);
        if (st.industry) setIndustry(st.industry);
        if (st.volumeStr) setVolumeStr(st.volumeStr);
        if (st.customComponents) setCustomComponents(st.customComponents);
        if (st.bomOrigins) setBomOrigins(st.bomOrigins);
        if (st.selectedCerts) setSelectedCerts(st.selectedCerts);
        if (st.profitMargin !== undefined) setProfitMargin(st.profitMargin);
        if (st.activeRisks) setActiveRisks(st.activeRisks);
        setShowRecentList(false);
        setIsSaveModalOpen(false);
        setLoadBanner(`"${sim.name}" 시뮬레이션을 불러왔습니다.`);
        setTimeout(() => setLoadBanner(''), 4000);
    };

    // ─── 문의 연결 핸들러 ────────────────────────────────────
    const handleRequestQuote = () => {
        const params = new URLSearchParams({
            from: 'simulator',
            projectName: projectTitle || '제조 프로젝트',
            industry,
            location: assy,
            budget: Math.round(simData.landedCost).toString(),
            volume: parseInt(volumeStr, 10).toString(),
        });
        router.push(`/${lang}/project-inquiry/?${params.toString()}`);
    };

    const handleFindPartner = () => {
        router.push(`/factories?field=${industry}`);
    };

    // ─── 리스크 토글 ─────────────────────────────────────────
    const toggleRisk = (id: string) => {
        setActiveRisks(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const runWhatIf = () => {
        setAiPanelState('loading');
        setTimeout(() => {
            // ── 비용 구조 분석 ──
            const totalCost = simData.landedCost;
            const bomRatio = simData.partsCost / totalCost;
            const vaddRatio = simData.vadd / totalCost;
            const shipRatio = simData.finalShip / totalCost;
            const taxRatio = simData.finalDuty / totalCost;

            // ── 비용 효율 점수 (100점 만점) ──
            let costScore = 100;
            if (bomRatio > 0.6) costScore -= 20;       // BOM 비중 과다
            if (shipRatio > 0.25) costScore -= 15;     // {t.logisticsCost} 과다
            if (taxRatio > 0.15) costScore -= 20;      // 관세 부담
            if (!simData.isOriginMatch) costScore -= 15; // FTA 미활용
            if (simData.volume < 5000) costScore -= 10; // 소량 생산
            if (isStressMode) costScore -= 10;          // 스트레스 환경
            if (useDrawback) costScore += 5;            // 관세환급 활용
            costScore = Math.max(10, Math.min(100, costScore));

            // ── 리스크 등급 ──
            const riskScore = (taxRatio > 0.15 ? 30 : 0) + (!simData.isOriginMatch ? 25 : 0) + (shipRatio > 0.3 ? 20 : 0) + (simData.volume < 1000 ? 15 : 0) + (isStressMode ? 10 : 0);
            const riskLevel = riskScore >= 50 ? 'HIGH' : riskScore >= 25 ? 'MEDIUM' : 'LOW';

            // ── 최적화 제언 목록 ──
            const suggestions: { icon: string; title: string; detail: string; impact: string; color: string }[] = [];

            if (!simData.isOriginMatch) {
                suggestions.push({
                    icon: '🏭',
                    title: `원산지 미충족 → FTA 관세 혜택 미적용`,
                    detail: `현재 RVC ${simData.rvc.toFixed(1)}% (기준: ${ftaThreshold}%). KR 부품 비중을 늘리거나 조립국을 변경하면 원산지 충족이 가능합니다.`,
                    impact: `관세율 ${(simData.finalRate * 100).toFixed(1)}% 절감 가능`,
                    color: '#f87171'
                });
            }
            if (shipRatio > 0.2) {
                suggestions.push({
                    icon: '🚢',
                    title: `물류비 비중 ${(shipRatio * 100).toFixed(0)}% 과다`,
                    detail: `현재 운임: ${simData.finalShip.toLocaleString()}₩/개. FCL 묶음 발주 또는 해상+내륙 복합 운송으로 절감 가능합니다.`,
                    impact: `물량 ${Math.round(simData.volume * 1.5).toLocaleString()}개로 확대 시 ${Math.round(shipRatio * 15)}% 절감 추정`,
                    color: '#fbbf24'
                });
            }
            if (bomRatio > 0.55) {
                suggestions.push({
                    icon: '🔩',
                    title: `BOM 비중 ${(bomRatio * 100).toFixed(0)}% — 자재비 집중 구조`,
                    detail: `총 자재비 ${simData.partsCost.toLocaleString()}₩. 대량발주 단가 협상 또는 대체 공급선 확보를 권장합니다.`,
                    impact: `5% 단가 협상 성공 시 개당 ${Math.round(simData.partsCost * 0.05).toLocaleString()}₩ 절감`,
                    color: '#60a5fa'
                });
            }
            if (!useDrawback && simData.interDuty > 0) {
                suggestions.push({
                    icon: '💰',
                    title: `관세 환급(Drawback) 미신청`,
                    detail: `수입 부품에 납부한 관세 ${simData.interDuty.toLocaleString()}₩의 95%를 환급받을 수 있습니다.`,
                    impact: `최대 ${Math.round(simData.interDuty * 0.95).toLocaleString()}₩ 환급 가능`,
                    color: '#34d399'
                });
            }
            if (simData.volume < 5000 && simData.amortizedFixedCost > simData.landedCost * 0.05) {
                suggestions.push({
                    icon: '📈',
                    title: `고정비 상각 부담 — 물량 확대 권장`,
                    detail: `현재 개당 고정비 ${Math.round(simData.amortizedFixedCost).toLocaleString()}₩. 발주 물량이 2배가 되면 개당 고정비가 절반으로 줄어듭니다.`,
                    impact: `물량 2배 시 고정비 ${Math.round(simData.amortizedFixedCost).toLocaleString()}₩ → ${Math.round(simData.amortizedFixedCost / 2).toLocaleString()}₩`,
                    color: '#a78bfa'
                });
            }
            if (suggestions.length === 0) {
                suggestions.push({
                    icon: '✅',
                    title: `현재 공급망 구조 양호`,
                    detail: `비용 효율, 물류, 원산지 기준 모두 최적 범위 내에 있습니다. 스트레스 시나리오를 활용해 리스크 내성을 점검해보세요.`,
                    impact: `현상 유지`,
                    color: '#34d399'
                });
            }

            // ── 원산지 판정 상세 ──
            const originDetail = simData.isOriginMatch
                ? `RVC ${simData.rvc.toFixed(1)}% ≥ ${ftaThreshold}% 기준 충족 → ${simData.finalOrigin} 원산지 인정 (${incoterm} 기준 관세율 ${(simData.finalRate * 100).toFixed(1)}%)`
                : `RVC ${simData.rvc.toFixed(1)}% < ${ftaThreshold}% 기준 미충족 → CN 원산지로 처리 (불리한 관세율 적용)`;

            setMatchedInsight({
                title: `원가 분석 리포트 — ${assy}→${dest} | ${simData.volume.toLocaleString()}개`,
                bullets: [],
                costScore,
                riskLevel,
                riskScore,
                suggestions,
                originDetail,
                bomRatio,
                vaddRatio,
                shipRatio,
                taxRatio,
            } as any);
            setAiPanelState('done');
        }, 900);
    };

    const bestScenarioId = useMemo(() => {
        if (scenarios.length === 0) return null;
        return [...scenarios].sort((a, b) => a.landedCost - b.landedCost)[0].id;
    }, [scenarios]);

    // Visualization Helpers
    const maxLandedCost = useMemo(() => {
        const allCosts = [simData.landedCost, ...scenarios.map(s => s.landedCost)];
        return Math.max(...allCosts) * 1.1;
    }, [simData.landedCost, scenarios]);

    return (
        <div style={{ backgroundColor: '#f0f2f5', color: '#1e293b', minHeight: '100vh', padding: '5rem 2rem', fontFamily: "'Pretendard', 'Inter', sans-serif" }}>

            {/* 모바일 접속 시 PC 버전 전환 확인 다이얼로그 */}
            {mobilePrompt && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 9999,
                    background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem'
                }}>
                    <div style={{
                        background: 'white', borderRadius: '1.5rem', padding: '2rem',
                        maxWidth: '340px', width: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
                        textAlign: 'center', position: 'relative'
                    }}>
                        {/* 아이콘 */}
                        <div style={{ marginBottom: '1rem' }}>
                            <div style={{ width: 56, height: 56, borderRadius: '16px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="2" y="3" width="20" height="14" rx="2" /><polyline points="8 21 12 17 16 21" />
                                </svg>
                            </div>
                        </div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 900, color: '#0f172a', marginBottom: '0.5rem' }}>
                            {t.mobilePromptTitle}
                        </h3>
                        <p style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.7, marginBottom: '1.5rem' }}>
                            {t.mobilePromptDesc}
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <button
                                onClick={switchToPcMode}
                                style={{
                                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                    color: 'white', border: 'none', borderRadius: '0.75rem',
                                    padding: '0.85rem', fontWeight: 800, fontSize: '0.9rem',
                                    cursor: 'pointer', boxShadow: '0 4px 12px rgba(59,130,246,0.3)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                                }}
                            >
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="2" y="3" width="20" height="14" rx="2" /><polyline points="8 21 12 17 16 21" />
                                </svg>
                                {t.pcVersionBtn}
                            </button>
                            <button
                                onClick={dismissMobilePrompt}
                                style={{
                                    background: 'transparent', color: '#94a3b8',
                                    border: '1.5px solid #e2e8f0', borderRadius: '0.75rem',
                                    padding: '0.75rem', fontWeight: 700, fontSize: '0.85rem',
                                    cursor: 'pointer'
                                }}
                            >
                                모바일로 그냥 보기
                            </button>
                        </div>
                        <p style={{ fontSize: '0.6rem', color: '#cbd5e1', marginTop: '1rem' }}>
                            이번 세션에서는 다시 묻지 않습니다
                        </p>
                    </div>
                </div>
            )}
            <style dangerouslySetInnerHTML={{
                __html: `
            .glass-card { background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 1.25rem; padding: 1.5rem; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05); }
            .sim-input-group label { display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.85rem; color: #64748b; font-weight: 700; }
            .sim-select, .sim-input { width: 100%; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 0.7rem 1rem; color: #1e293b; font-size: 0.9rem; outline: none; transition: all 0.2s; }
            .sim-select:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
            .sim-toggle-btn { flex: 1; padding: 0.7rem; border-radius: 0.75rem; border: 1px solid #e2e8f0; background: #ffffff; color: #64748b; cursor: pointer; font-size: 0.85rem; font-weight: 700; transition: all 0.2s; }
            .sim-toggle-btn.active { background: #3b82f6; color: white; border-color: #3b82f6; }
            .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
            .stat-box { padding: 1.25rem; border-radius: 1rem; background: white; border: 1px solid #e2e8f0; }
            .stat-box .label { font-size: 0.7rem; color: #94a3b8; font-weight: 800; margin-bottom: 0.5rem; }
            .stat-box .value { font-size: 1.25rem; font-weight: 800; color: #1e293b; }
            .stat-box.highlight { background: linear-gradient(135deg, #eff6ff 0%, #ffffff 100%); border-left: 4px solid #3b82f6; }
            
            .chart-bar-container { height: 32px; background: #f1f5f9; border-radius: 16px; overflow: hidden; display: flex; margin: 1.5rem 0; box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05); }
            .chart-segment { height: 100%; transition: width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); position: relative; }
            .chart-segment:hover { opacity: 0.85; }
            .chart-segment::after { content: attr(data-label); position: absolute; top: -25px; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 800; color: #64748b; white-space: nowrap; opacity: 0; transition: opacity 0.2s; }
            .chart-segment:hover::after { opacity: 1; }

            .compare-viz-bar { height: 40px; background: #3b82f6; border-radius: 4px; transition: width 0.8s ease; position: relative; display: flex; align-items: center; padding: 0 12px; color: white; font-weight: 800; font-size: 12px; }
            .btn-primary { background: #3b82f6; color: white; border: none; padding: 0.8rem 1.2rem; border-radius: 0.75rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
            .btn-primary:hover { background: #2563eb; transform: translateY(-1px); }
            .btn-outline { background: transparent; border: 1.5px solid #e2e8f0; color: #64748b; padding: 0.8rem 1.2rem; border-radius: 0.75rem; font-weight: 700; cursor: pointer; }
            .btn-outline:hover { background: #f8fafc; border-color: #cbd5e1; }
            .best-tag { background: #dcfce7; color: #166534; font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 800; margin-left: 8px; }
            
            .timeline-segment:hover { filter: brightness(1.15); transform: translateY(-1px); }
            .timeline-legend { cursor: pointer; padding: 4px 8px; border-radius: 6px; transition: all 0.2s ease; border: 1px solid transparent; }
            .timeline-legend:hover { background: #f1f5f9; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05); }
            .fta-tooltip { display: none; }
            .fta-tooltip-wrap:hover .fta-tooltip { display: block; }
`}} />

            <div style={{ maxWidth: 1400, margin: '0 auto' }}>
                <header style={{ marginBottom: '3rem', textAlign: 'center', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: '8px' }}>
                        <select
                            className="sim-select"
                            style={{ fontSize: '0.7rem', padding: '0.4rem 0.8rem', width: 'auto', background: '#f8fafc' }}
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value)}
                        >
                            <option value="KRW">KRW (₩)</option>
                            <option value="USD">USD ($)</option>
                            <option value="EUR">EUR (€)</option>
                            <option value="CNY">CNY (¥)</option>
                            <option value="JPY">JPY (¥)</option>
                        </select>
                        <button
                            onClick={() => { setExportType('excel'); setIsExportModalOpen(true); }}
                            className="btn-primary"
                            style={{ fontSize: '0.7rem', padding: '0.4rem 0.8rem', background: '#059669', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                            <i className="fas fa-file-excel"></i> {t.excelReport}
                        </button>
                        <button
                            onClick={() => { setExportType('pdf'); setIsExportModalOpen(true); }}
                            className="btn-primary"
                            style={{ fontSize: '0.7rem', padding: '0.4rem 0.8rem', background: '#e11d48', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                            <i className="fas fa-file-pdf"></i> {t.pdfReport}
                        </button>
                    </div>
                    <h1 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
                        {t.simulatorTitle}
                    </h1>
                    <p style={{ color: '#64748b', fontSize: '1.1rem', fontWeight: 500 }}>{t.simulatorSub}</p>
                    {/* 실시간 데이터 상태 표시줄 */}
                    <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        {marketDataLoading ? (
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700 }}>
                                <i className="fas fa-spinner fa-spin" style={{ marginRight: 4 }}></i> 실시간 환율 로드 중...
                            </span>
                        ) : marketData ? (
                            <>
                                <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', background: '#f0fdf4', borderRadius: '20px', border: '1px solid #bbf7d0' }}>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
                                    📡 실시간 환율 적용 중 — 1 USD = {marketData.rates.USD_KRW.toLocaleString()}원
                                </span>
                                <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 600 }}>
                                    마지막 업데이트: {new Date(marketData.lastUpdated).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <button
                                    onClick={() => setUseRealtime(v => !v)}
                                    style={{ fontSize: '0.65rem', fontWeight: 800, padding: '3px 10px', borderRadius: '20px', border: '1.5px solid #e2e8f0', background: useRealtime ? '#eff6ff' : '#fff', color: useRealtime ? '#3b82f6' : '#94a3b8', cursor: 'pointer' }}
                                >
                                    {useRealtime ? '수동 입력으로 전환' : '실시간 환율 사용'}
                                </button>
                            </>
                        ) : null}
                    </div>
                </header>

                {/* ─── 불러오기 성공 배너 ─── */}
                {loadBanner && (
                    <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1.25rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.75rem', color: '#166534', fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <i className="fas fa-check-circle"></i> {loadBanner}
                        <button onClick={() => setLoadBanner('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#166534', cursor: 'pointer', fontSize: '1rem' }}>&times;</button>
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '2rem' }}>
                    <div className="glass-card" style={{ alignSelf: 'start' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.5rem', color: '#0f172a' }}>
                            <i className="fas fa-sliders-h" style={{ fontSize: '1.2rem', color: '#3b82f6' }}></i>
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 800 }}>{t.scenarioSetup}</h2>
                        </div>

                        <div className="sim-input-group" style={{ marginBottom: '1.5rem' }}>
                            <label>{t.productTitle}</label>
                            <input
                                type="text"
                                className="sim-input"
                                style={{ fontSize: '0.85rem', padding: '0.6rem', width: '100%', border: '1.5px solid #e1e8f0', background: '#f8fafc' }}
                                value={projectTitle}
                                onChange={(e) => setProjectTitle(e.target.value)}
                                placeholder={t.projectPlaceholder}
                            />
                        </div>

                        <div className="sim-input-group">
                            <label>
                                <span>{t.assemblyHub}</span>
                                {marketData && useRealtime && (
                                    <span style={{ fontSize: '0.65rem', color: '#10b981', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block', animation: 'pulse 2s infinite' }}></span>
                                        실시간 환율 적용
                                    </span>
                                )}
                            </label>
                            {/* 생산지 선택 그리드 */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
                                {(['KR','CN','VN','IN','MX','TH'] as AssyHub[]).map(hub => {
                                    const loc = (db.locations as any)[hub];
                                    const isActive = assy === hub;
                                    return (
                                        <button
                                            key={hub}
                                            onClick={() => handleAssyChange(hub)}
                                            style={{
                                                padding: '0.55rem 0.3rem',
                                                borderRadius: '0.75rem',
                                                border: isActive ? '2px solid #3b82f6' : '1.5px solid #e2e8f0',
                                                background: isActive ? 'linear-gradient(135deg,#eff6ff,#dbeafe)' : '#ffffff',
                                                color: isActive ? '#1e40af' : '#64748b',
                                                cursor: 'pointer', fontWeight: 800, fontSize: '0.72rem',
                                                transition: 'all 0.15s', textAlign: 'center',
                                                boxShadow: isActive ? '0 2px 8px rgba(59,130,246,0.2)' : 'none',
                                            }}
                                        >
                                            <div style={{ fontSize: '1rem' }}>{loc?.flag ?? '🏭'}</div>
                                            <div style={{ marginTop: '2px' }}>{hub}</div>
                                        </button>
                                    );
                                })}
                            </div>
                            {/* 선택된 생산지 태그 표시 */}
                            {(() => {
                                const loc = (db.locations as any)[assy];
                                if (!loc?.strengths) return null;
                                return (
                                    <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                        {loc.strengths.map((s: string) => (
                                            <span key={s} style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: '#dcfce7', color: '#166534' }}>{s}</span>
                                        ))}
                                        {loc.risks.map((r: string) => (
                                            <span key={r} style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: '#fee2e2', color: '#991b1b' }}>{r}</span>
                                        ))}
                                    </div>
                                );
                            })()}
                        </div>

                        <div className="sim-input-group" style={{ marginTop: '1.5rem' }}>
                            <label>{t.targetMarket}</label>
                            <select className="sim-select" value={dest} onChange={(e) => handleDestChange(e.target.value)}>
                                <option value="US">USA (미국/FCC)</option>
                                <option value="EU">EU (유럽/CE)</option>
                                <option value="JP">JAPAN (일본/PSE)</option>
                                <option value="KR">KOREA (내수/KC)</option>
                                <option value="TW">TAIWAN (대만/BSMI)</option>
                                <option value="VN">VIETNAM (베트남/CR)</option>
                                <option value="CA">CANADA (캐나다/UL)</option>
                            </select>
                        </div>

                        <div className="sim-input-group" style={{ marginTop: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <label style={{ margin: 0 }}>{t.moq}</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {overrideDiscounts && (
                                        <button
                                            onClick={() => setOverrideDiscounts(false)}
                                            style={{ fontSize: '0.65rem', border: 'none', background: '#f1f5f9', color: '#94a3b8', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px', fontWeight: 800 }}
                                            title={t.restoreDiscount}
                                        >
                                            {t.auto}
                                        </button>
                                    )}
                                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                        <input
                                            type="number"
                                            value={Math.round(simData.bomDiscount * 100)}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value) || 0;
                                                setManualBomDiscount(val / 100);
                                                setOverrideDiscounts(true);
                                            }}
                                            style={{
                                                width: '52px',
                                                fontSize: '0.75rem',
                                                fontWeight: 800,
                                                color: overrideDiscounts ? '#3b82f6' : '#64748b',
                                                background: overrideDiscounts ? '#eff6ff' : '#f8fafc',
                                                border: '1.5px solid ' + (overrideDiscounts ? '#3b82f6' : '#e2e8f0'),
                                                padding: '2px 16px 2px 6px',
                                                borderRadius: '4px',
                                                textAlign: 'right',
                                                outline: 'none',
                                                transition: 'all 0.2s'
                                            }}
                                        />
                                        <span style={{ position: 'absolute', right: '5px', fontSize: '0.6rem', fontWeight: 900, color: overrideDiscounts ? '#3b82f6' : '#94a3b8', pointerEvents: 'none' }}>%</span>
                                    </div>
                                </div>
                            </div>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="text"
                                    className="sim-input"
                                    style={{ fontSize: '0.85rem', padding: '0.6rem', width: '100%', paddingRight: '2rem', cursor: 'text' }}
                                    placeholder={t.volumePlaceholder}
                                    value={showVolumeDropdown ? volumeQuery : (parseInt(volumeStr) ? parseInt(volumeStr).toLocaleString() + ' unit' : '')}
                                    onChange={e => {
                                        const raw = e.target.value.replace(/[^0-9]/g, '');
                                        setVolumeQuery(raw ? parseInt(raw).toLocaleString() + ' unit' : '');
                                        setShowVolumeDropdown(true);
                                        if (raw) {
                                            handleVolumeChange(raw);
                                        }
                                    }}
                                    onFocus={() => {
                                        setVolumeQuery(parseInt(volumeStr) ? parseInt(volumeStr).toLocaleString() + ' unit' : '');
                                        setShowVolumeDropdown(true);
                                    }}
                                    onBlur={() => {
                                        setTimeout(() => setShowVolumeDropdown(false), 200);
                                    }}
                                />
                                <i className={`fas fa-chevron-${showVolumeDropdown ? 'up' : 'down'}`} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none', fontSize: '0.8rem' }}></i>

                                {showVolumeDropdown && (
                                    <div style={{
                                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                                        background: 'white', border: '1px solid #3b82f6', borderRadius: '0.5rem',
                                        marginTop: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: '160px', overflowY: 'auto'
                                    }}>
                                        {['1000', '5000', '10000', '50000', '100000'].map(v => (
                                            <div
                                                key={v}
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    handleVolumeChange(v);
                                                    setShowVolumeDropdown(false);
                                                }}
                                                style={{ padding: '8px 12px', fontSize: '0.85rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', color: volumeStr === v ? '#3b82f6' : '#1e293b', fontWeight: volumeStr === v ? 800 : 500 }}
                                                onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                            >
                                                {parseInt(v).toLocaleString()} unit
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="sim-input-group" style={{ marginTop: '1.5rem', position: 'relative' }}>
                            <label>{t.industryType}</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    className="sim-input"
                                    style={{ fontSize: '0.85rem', padding: '0.6rem', width: '100%', paddingRight: '2rem', cursor: 'text' }}
                                    placeholder={t.industryPlaceholder}
                                    value={showIndustryDropdown ? industryQuery : (industryOptions.find(o => o.value === industry)?.label || industry)}
                                    onChange={e => {
                                        const query = e.target.value;
                                        setIndustryQuery(query);
                                        // If user is typing something that doesn't match predefined, we treat it as custom industry name
                                        setIndustry(query);
                                        setShowIndustryDropdown(true);
                                    }}
                                    onFocus={() => {
                                        setIndustryQuery('');
                                        setShowIndustryDropdown(true);
                                    }}
                                    onBlur={() => {
                                        setTimeout(() => setShowIndustryDropdown(false), 200);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            const matched = resolveIndustryFromQuery(industryQuery);
                                            if (matched) {
                                                handleIndustryChange(matched);
                                            } else if (industryQuery) {
                                                // Handle as custom industry
                                                handleIndustryChange(industryQuery);
                                            }
                                            setShowIndustryDropdown(false);
                                        }
                                    }}
                                />
                                <i className={`fas fa-chevron-${showIndustryDropdown ? 'up' : 'down'}`} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none', fontSize: '0.8rem' }}></i>

                                {showIndustryDropdown && (
                                    <div style={{
                                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                                        background: 'white', border: '1px solid #3b82f6', borderRadius: '0.5rem',
                                        marginTop: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: '200px', overflowY: 'auto'
                                    }}>
                                        {industryOptions.filter(o => o.label.toLowerCase().includes(industryQuery.toLowerCase()) || o.value.toLowerCase().includes(industryQuery.toLowerCase())).map(o => (
                                            <div
                                                key={o.value}
                                                onMouseDown={(e) => {
                                                    e.preventDefault(); // Prevent blur when clicking
                                                    handleIndustryChange(o.value);
                                                    setShowIndustryDropdown(false);
                                                }}
                                                style={{ padding: '8px 12px', fontSize: '0.85rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', color: industry === o.value ? '#3b82f6' : '#1e293b', fontWeight: industry === o.value ? 800 : 500 }}
                                                onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                            >
                                                {o.label}
                                            </div>
                                        ))}
                                        {industryOptions.filter(o => o.label.toLowerCase().includes(industryQuery.toLowerCase()) || o.value.toLowerCase().includes(industryQuery.toLowerCase())).length === 0 && (
                                            <div style={{ padding: '8px 12px', fontSize: '0.85rem', color: '#94a3b8', textAlign: 'center' }}>검색 결과가 없습니다.</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Industry Trait Badges */}
                            <div style={{ display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap' }}>
                                {(db.tooling_costs as any)[industry] && industry !== 'none' && (
                                    <>
                                        <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: '#f1f5f9', borderRadius: '4px', fontWeight: 700, color: '#64748b' }}>
                                            정밀도: {(db.tooling_costs as any)[industry].precision.toUpperCase()}
                                        </span>
                                        <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: '#f1f5f9', borderRadius: '4px', fontWeight: 700, color: '#64748b' }}>
                                            오버헤드: {Math.round((db.tooling_costs as any)[industry].overhead * 100)}%
                                        </span>
                                        <span style={{
                                            fontSize: '0.65rem', padding: '2px 6px',
                                            background: (db.tooling_costs as any)[industry].risk === 'high' || (db.tooling_costs as any)[industry].risk === 'ultra_high' ? '#fff1f2' : '#f0fdf4',
                                            borderRadius: '4px', fontWeight: 700,
                                            color: (db.tooling_costs as any)[industry].risk === 'high' || (db.tooling_costs as any)[industry].risk === 'ultra_high' ? '#e11d48' : '#166534'
                                        }}>
                                            리스크: {(db.tooling_costs as any)[industry].risk.toUpperCase()}
                                        </span>
                                    </>
                                )}
                            </div>

                            {/* Industry Representative Items */}
                            {industryMetadata[industry] && (
                                <div
                                    onClick={() => setShowIndustryItems(!showIndustryItems)}
                                    style={{ marginTop: '12px', padding: '10px', background: 'rgba(59,130,246,0.03)', border: '1px dashed rgba(59,130,246,0.2)', borderRadius: '0.75rem', cursor: 'pointer' }}
                                >
                                    <div
                                        style={{ fontSize: '0.65rem', color: '#3b82f6', fontWeight: 800, marginBottom: showIndustryItems ? '6px' : '0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <i className="fas fa-tag"></i> 해당 업종 대표 품목 및 HS Code 예시
                                        </div>
                                        <i className={`fas fa-chevron-${showIndustryItems ? 'up' : 'down'}`} style={{ fontSize: '0.6rem' }}></i>
                                    </div>
                                    {showIndustryItems && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                            {industryMetadata[industry]?.items.map((item, idx) => (
                                                <span key={idx} style={{ fontSize: '0.65rem', padding: '3px 8px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '4px', color: '#475569', fontWeight: 600 }}>
                                                    {item}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="sim-input-group" style={{ marginTop: '1.5rem' }} id="bom-details">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                                <label style={{ margin: 0 }}>물류/원산지 최적화 (HS 기반)</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <i className="fas fa-info-circle" style={{ color: '#3b82f6', fontSize: '0.7rem', cursor: 'help' }} title="부품의 원산지(KR/CN)와 조립국가의 부가가치(RVC)를 결합하여 최종 원산지를 판정합니다."></i>
                                    <button
                                        onClick={() => {
                                            if (customComponents.length > 0 && !confirm("현재 작성 중인 BOM 자재가 모두 삭제되고 산업별 예시 템플릿으로 대체됩니다. 계속하시겠습니까?")) return;
                                            loadTemplate(industry);
                                        }}
                                        style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: '4px', background: '#f1f5f9', color: '#64748b', border: 'none', cursor: 'pointer', fontWeight: 800 }}
                                    >
                                        템플릿 로드
                                    </button>
                                    <button
                                        onClick={() => setShowAddForm(!showAddForm)}
                                        style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: '4px', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 800 }}
                                    >
                                        {showAddForm ? '닫기' : '+ 추가'}
                                    </button>
                                </div>
                            </div>

                            {showAddForm && (
                                <div style={{ background: '#fff', border: '1px solid #3b82f6', padding: '1rem', borderRadius: '0.75rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.08)' }}>
                                    <input className="sim-input" style={{ fontSize: '0.85rem', padding: '0.6rem' }} placeholder="부품명 (ex. Heat Sink)" value={newComp.name} onChange={e => setNewComp({ ...newComp, name: e.target.value })} />

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                        <input type="number" className="sim-input" style={{ fontSize: '0.85rem', padding: '0.6rem' }} placeholder="단가 (₩)" value={newComp.price || ''} onChange={e => setNewComp({ ...newComp, price: parseInt(e.target.value) || 0 })} />
                                        <input type="number" step="0.01" className="sim-input" style={{ fontSize: '0.85rem', padding: '0.6rem' }} placeholder="무게 (kg)" value={(newComp as any).weight || ''} onChange={e => setNewComp({ ...newComp, weight: parseFloat(e.target.value) || 0 })} />
                                    </div>

                                    <div style={{ position: 'relative' }}>
                                        <input
                                            className="sim-input"
                                            style={{ fontSize: '0.85rem', padding: '0.6rem', width: '100%', paddingRight: '2rem' }}
                                            placeholder="HS Code 직접 입력 또는 검색 🔍"
                                            value={newComp.hs}
                                            onChange={e => {
                                                const val = e.target.value;
                                                setNewComp({ ...newComp, hs: val });
                                                setHsQuery(val);
                                                setShowHsSuggestions(true);
                                            }}
                                            onFocus={() => setShowHsSuggestions(true)}
                                            onBlur={() => setTimeout(() => setShowHsSuggestions(false), 150)}
                                        />
                                        {showHsSuggestions && hsQuery.length > 0 && (() => {
                                            const filtered = db.hs_suggestions.filter(s => s.code.includes(hsQuery) || s.name.toLowerCase().includes(hsQuery.toLowerCase()));
                                            return (
                                                <div style={{
                                                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                                                    background: 'white', border: '1px solid #3b82f6', borderRadius: '0.5rem',
                                                    marginTop: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: '180px', overflowY: 'auto'
                                                }}>
                                                    {filtered.map(s => (
                                                        <div
                                                            key={s.code}
                                                            onMouseDown={(e) => {
                                                                e.preventDefault();
                                                                setNewComp(prev => ({ ...prev, hs: s.code, name: prev.name || s.name }));
                                                                setHsQuery('');
                                                                setShowHsSuggestions(false);
                                                            }}
                                                            style={{ padding: '8px 12px', fontSize: '0.75rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', color: '#1e293b' }}
                                                            onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                                                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                                        >
                                                            <span style={{ fontWeight: 800, color: '#3b82f6' }}>{s.code}</span> - {s.name}
                                                        </div>
                                                    ))}
                                                    {/* 검색 결과 없을 때: 직접 입력 사용 안내 */}
                                                    {filtered.length === 0 && (
                                                        <div
                                                            onMouseDown={(e) => {
                                                                e.preventDefault();
                                                                setShowHsSuggestions(false);
                                                            }}
                                                            style={{ padding: '10px 12px', fontSize: '0.75rem', cursor: 'pointer', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '6px', background: '#f8faff' }}
                                                            onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                                                            onMouseLeave={(e) => (e.currentTarget.style.background = '#f8faff')}
                                                        >
                                                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                                            <span><strong>&quot;{hsQuery}&quot;</strong> 직접 입력으로 사용 (검색 결과 없음)</span>
                                                        </div>
                                                    )}
                                                    {/* 검색 결과 있을 때도: 현재 입력값 그대로 사용 옵션 */}
                                                    {filtered.length > 0 && (
                                                        <div
                                                            onMouseDown={(e) => {
                                                                e.preventDefault();
                                                                setShowHsSuggestions(false);
                                                            }}
                                                            style={{ padding: '7px 12px', fontSize: '0.7rem', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px', borderTop: '1px dashed #e2e8f0' }}
                                                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                                                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                                        >
                                                            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                                            <span>&quot;{hsQuery}&quot; 입력값 그대로 사용</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                        <a
                                            href={`https://unipass.customs.go.kr/clip/index.do`}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', color: '#3b82f6', fontSize: '0.8rem' }}
                                            title="조회"
                                        >
                                            <i className="fas fa-search"></i>
                                        </a >
                                    </div >

                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <select className="sim-select" style={{ fontSize: '0.85rem', padding: '0.6rem', flex: 1 }} value={newComp.origin} onChange={e => setNewComp({ ...newComp, origin: e.target.value as 'KR' | 'CN' })}>
                                            <option value="CN">CN (중국)</option>
                                            <option value="KR">KR (한국)</option>
                                        </select>
                                        <button className="btn-primary" style={{ flex: 1.5, fontSize: '0.85rem', padding: '0.6rem' }} onClick={addCustomComponent}>등록</button>
                                    </div>
                                </div >
                            )}

                            <div style={{ background: '#f8fafc', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.75rem' }}>
                                {customComponents.map(c => (
                                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid #f1f5f9' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <button onClick={() => removeComponent(c.id)} style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem' }}>×</button>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
                                                {editingCompId === c.id ? (
                                                    <>
                                                        <input
                                                            value={c.name}
                                                            onChange={(e) => updateCustomComponent(c.id, 'name', e.target.value)}
                                                            style={{ fontSize: '0.85rem', fontWeight: 600, border: 'none', background: 'transparent', outline: 'none', padding: 0, margin: 0, width: '100%', color: '#1e293b' }}
                                                        />
                                                        <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.65rem', color: '#94a3b8', gap: '4px', flexWrap: 'wrap' }}>
                                                            HS: <input value={c.hs} onChange={(e) => updateCustomComponent(c.id, 'hs', e.target.value)} style={{ width: '45px', border: '1px solid transparent', background: 'white', borderRadius: '4px', padding: '1px 3px', fontSize: '0.65rem', color: '#64748b', outline: 'none', transition: 'border 0.2s' }} onFocus={e => e.target.style.border = '1px solid #cbd5e1'} onBlur={e => e.target.style.border = '1px solid transparent'} />
                                                            | ₩<input type="number" value={c.price} onChange={(e) => updateCustomComponent(c.id, 'price', parseInt(e.target.value) || 0)} style={{ width: '60px', border: '1px solid transparent', background: 'white', borderRadius: '4px', padding: '1px 3px', fontSize: '0.65rem', color: '#64748b', outline: 'none', transition: 'border 0.2s' }} onFocus={e => e.target.style.border = '1px solid #cbd5e1'} onBlur={e => e.target.style.border = '1px solid transparent'} />
                                                            | <input type="number" step="0.01" value={(c as any).weight || 0.1} onChange={(e) => updateCustomComponent(c.id, 'weight', parseFloat(e.target.value) || 0)} style={{ width: '40px', border: '1px solid transparent', background: 'white', borderRadius: '4px', padding: '1px 3px', fontSize: '0.65rem', color: '#64748b', outline: 'none', transition: 'border 0.2s' }} onFocus={e => e.target.style.border = '1px solid #cbd5e1'} onBlur={e => e.target.style.border = '1px solid transparent'} />kg
                                                            <button onClick={() => setEditingCompId(null)} style={{ border: 'none', background: '#3b82f6', color: 'white', borderRadius: '4px', padding: '2px 6px', fontSize: '0.6rem', cursor: 'pointer', marginLeft: 'auto' }}>완료</button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{c.name}</span>
                                                            <button onClick={() => setEditingCompId(c.id)} style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', padding: '4px' }}>
                                                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-10" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                                            </button>
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.65rem', color: '#94a3b8', gap: '4px' }}>
                                                            HS: {c.hs} | ₩{c.price.toLocaleString()} | {(c as any).weight || 0.1}kg
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <select className="sim-select" style={{ width: 75, padding: '0.2rem', fontSize: '0.8rem' }} value={bomOrigins[c.id] || (c as any).origin || 'CN'} onChange={(e) => handleBomChange(c.id, e.target.value as 'KR' | 'CN')}>
                                            <option value="CN">CN</option>
                                            <option value="KR">KR</option>
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div >

                        <div className="sim-input-group" style={{ marginTop: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                                <label style={{ margin: 0 }}>상세 설정 (인증/수익/환급)</label>
                                <button
                                    onClick={() => setShowCertPanel(!showCertPanel)}
                                    style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: '4px', background: showCertPanel ? '#64748b' : '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 800 }}
                                >
                                    {showCertPanel ? '간편 설정 모드' : '+ 추가 설정'}
                                </button>
                            </div>

                            {showCertPanel && (
                                <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '1rem', borderRadius: '1rem', marginTop: '0.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                                    {/* Profit Margin */}
                                    <div style={{ padding: '0.75rem', background: '#f8fafc', borderRadius: '0.75rem', border: '1px solid #e2e8f0' }}>
                                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span>목표 수익률 (Profit Margin): {Math.round(profitMargin * 100)}%</span>
                                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                                <i className="fas fa-info-circle" style={{ color: '#3b82f6', cursor: 'pointer' }} title="최종 제안가 산출을 위한 마진율입니다."></i>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: '0.6rem', color: '#94a3b8', marginBottom: '0.8rem', lineHeight: 1.4 }}>
                                            선택된 상업 조건(현재: <strong>{incoterm}</strong>) 기준 원가에 마진을 더해 최종 제안가(Quote)를 계산합니다.
                                        </div>
                                        <input type="range" min="0" max="0.5" step="0.01" value={profitMargin} onChange={(e) => setProfitMargin(parseFloat(e.target.value))} style={{ width: '100%', cursor: 'pointer' }} />
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '0.6rem', color: '#cbd5e1', fontWeight: 700 }}>
                                            <span>0%</span>
                                            <span>25%</span>
                                            <span>50%</span>
                                        </div>
                                    </div>

                                    {/* Certifications */}
                                    <div style={{ border: '1px solid #f1f5f9', padding: '0.75rem', borderRadius: '0.75rem' }}>
                                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
                                            <span>글로벌 인증 항목</span>
                                            <span style={{ color: '#3b82f6' }}>{selectedCerts.length}개 선택됨</span>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                            {Object.entries(db.certifications).map(([id, cert]) => (
                                                <label key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '10px', fontSize: '0.75rem', cursor: 'pointer', margin: 0 }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedCerts.includes(id)}
                                                        onChange={() => toggleCert(id)}
                                                        style={{ margin: 0, width: 'auto', height: 'auto', cursor: 'pointer' }}
                                                    />
                                                    <span style={{ whiteSpace: 'nowrap' }}>{cert.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Drawback & Tooling */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '0.75rem', background: '#eff6ff', borderRadius: '0.75rem' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                            <input type="checkbox" checked={useDrawback} onChange={(e) => handleDrawbackChange(e.target.checked)} style={{ transform: 'scale(1.1)' }} />
                                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1d4ed8' }}>관세 환급(Drawback)</span>
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                            <input type="checkbox" checked={includeTooling} onChange={(e) => setIncludeTooling(e.target.checked)} style={{ transform: 'scale(1.1)' }} />
                                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1d4ed8' }}>금형/지그 비용 포함</span>
                                        </label>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="sim-input-group" style={{ marginTop: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                                <label style={{ margin: 0 }}>{t.freightMode}</label>
                                <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>단품 무게 합계: <span style={{ color: '#3b82f6', fontWeight: 800 }}>{simData.totalWeight.toFixed(2)}kg</span></span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button className={`sim-toggle-btn ${freightMode === 'sea' ? 'active' : ''}`} onClick={() => { setFreightMode('sea'); setCustomBaseFreight(null); setCustomWeightRate(null); }}>SEA (Ocean)</button>
                                <button className={`sim-toggle-btn ${freightMode === 'air' ? 'active' : ''}`} onClick={() => { setFreightMode('air'); setCustomBaseFreight(null); setCustomWeightRate(null); }}>AIR (Express)</button>
                            </div>

                            <div style={{ marginTop: '12px', padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.75rem', fontSize: '0.75rem', color: '#475569' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ lineHeight: '1.2' }}>{t.totalContainerFreight}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                                        <input
                                            type="number"
                                            value={customBaseFreight !== null ? customBaseFreight : simData.baseFinalShip}
                                            onChange={e => {
                                                setCustomBaseFreight(Number(e.target.value));
                                                setFreightMode('custom');
                                            }}
                                            style={{ width: '75px', textAlign: 'right', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '2px 4px', fontSize: '0.75rem', outline: 'none', color: '#3b82f6', fontWeight: 800 }}
                                        />
                                        <span>₩</span>
                                        <span style={{ color: '#94a3b8', fontWeight: 600, fontSize: '0.65rem', marginLeft: '2px' }}>
                                            = {((customBaseFreight !== null ? customBaseFreight : simData.baseFinalShip) / Math.max(simData.volume, 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })}₩/개
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ lineHeight: '1.2' }}>무게 비례 단가 (<i className="fas fa-weight-hanging" style={{ marginRight: '2px' }}></i>{simData.totalWeight.toFixed(2)}kg)</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                                        <input
                                            type="number"
                                            value={customWeightRate !== null ? customWeightRate : simData.weightRate}
                                            onChange={e => {
                                                setCustomWeightRate(Number(e.target.value));
                                                setFreightMode('custom');
                                            }}
                                            style={{ width: '55px', textAlign: 'right', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '2px 4px', fontSize: '0.75rem', outline: 'none', color: '#3b82f6', fontWeight: 800 }}
                                        />
                                        <span>₩/kg</span>
                                        <span style={{ color: '#94a3b8', fontWeight: 600, fontSize: '0.65rem', marginLeft: '2px' }}>
                                            = {((customWeightRate !== null ? customWeightRate : simData.weightRate) * simData.totalWeight).toLocaleString(undefined, { maximumFractionDigits: 0 })}₩/개
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px dashed #cbd5e1', fontWeight: 800, color: '#0f172a' }}>
                                    <span>{t.expectedFreight}</span>
                                    <span>{((simData.baseFinalShip / simData.volume) + (simData.totalWeight * simData.weightRate)).toLocaleString(undefined, { maximumFractionDigits: 0 })} ₩/개</span>
                                </div>
                            </div>
                        </div>

                        {/* ─── 산업 특화 계산기 ─── */}
                        <div className="sim-input-group" style={{ marginTop: '1.5rem', padding: '1rem', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: '0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#7c3aed' }}>산업 특화 모드</span>
                                <select
                                    value={specialIndustry}
                                    onChange={e => { setSpecialIndustry(e.target.value); setSelectedSpecialCerts([]); setSpecialFields({}); }}
                                    style={{ fontSize: '0.7rem', padding: '3px 6px', border: '1px solid #c4b5fd', borderRadius: '6px', background: 'white', color: '#7c3aed', fontWeight: 700 }}
                                >
                                    <option value="none">선택 안함</option>
                                    <option value="semiconductor">반도체 패키징</option>
                                    <option value="medical_device">의료기기</option>
                                    <option value="automotive_tier">자동차 부품 (Tier)</option>
                                </select>
                            </div>
                            {specialIndustry !== 'none' && INDUSTRY_SPECIAL_PRESETS[specialIndustry] && (() => {
                                const preset = INDUSTRY_SPECIAL_PRESETS[specialIndustry];
                                const totalCertCost = selectedSpecialCerts.reduce((acc, c) => acc + (preset.certification_costs[c] || 0), 0);
                                const yieldRate = preset.yield_rate;
                                const volume = parseInt(volumeStr, 10) || 1000;
                                const actualNeeded = yieldRate ? Math.ceil(volume / yieldRate) : volume;
                                return (
                                    <div style={{ fontSize: '0.72rem', color: '#6d28d9' }}>
                                        {yieldRate && (
                                            <div style={{ background: '#ede9fe', padding: '6px 10px', borderRadius: '6px', marginBottom: '8px', fontWeight: 700 }}>
                                                수율 {(yieldRate * 100).toFixed(0)}% 적용: {volume.toLocaleString()}개 목표 → 실제 <span style={{ color: '#dc2626', fontWeight: 900 }}>{actualNeeded.toLocaleString()}개</span> 제조 필요
                                            </div>
                                        )}
                                        {preset.validation_cost && (
                                            <div style={{ marginBottom: '4px' }}>임상 검증비: <span style={{ fontWeight: 900 }}>{preset.validation_cost.toLocaleString()}원</span> (고정)</div>
                                        )}
                                        {preset.traceability_cost_per_unit && (
                                            <div style={{ marginBottom: '4px' }}>추적성 비용: <span style={{ fontWeight: 900 }}>{preset.traceability_cost_per_unit.toLocaleString()}원/개</span></div>
                                        )}
                                        {preset.ppap_cost && (
                                            <div style={{ marginBottom: '4px' }}>PPAP 비용: <span style={{ fontWeight: 900 }}>{preset.ppap_cost.toLocaleString()}원</span> (고정)</div>
                                        )}
                                        {preset.special_fields && Object.entries(preset.special_fields).map(([key, vals]) => (
                                            Array.isArray(vals) && (
                                                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                                    <span style={{ minWidth: '70px' }}>{key}:</span>
                                                    <select
                                                        value={specialFields[key] || ''}
                                                        onChange={e => setSpecialFields(prev => ({ ...prev, [key]: e.target.value }))}
                                                        style={{ fontSize: '0.68rem', padding: '2px 4px', border: '1px solid #c4b5fd', borderRadius: '4px', background: 'white', flex: 1 }}
                                                    >
                                                        <option value="">선택</option>
                                                        {vals.map((v: string) => <option key={v} value={v}>{v}</option>)}
                                                    </select>
                                                </div>
                                            )
                                        ))}
                                        <div style={{ marginTop: '8px', borderTop: '1px solid #c4b5fd', paddingTop: '8px' }}>
                                            <div style={{ fontWeight: 800, marginBottom: '4px' }}>필수 인증 선택:</div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                {preset.special_certifications.map(cert => (
                                                    <label key={cert} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', padding: '2px 6px', background: selectedSpecialCerts.includes(cert) ? '#7c3aed' : 'white', color: selectedSpecialCerts.includes(cert) ? 'white' : '#7c3aed', borderRadius: '4px', border: '1px solid #c4b5fd', fontSize: '0.68rem', fontWeight: 700 }}>
                                                        <input type="checkbox" checked={selectedSpecialCerts.includes(cert)} onChange={() => setSelectedSpecialCerts(prev => prev.includes(cert) ? prev.filter(x => x !== cert) : [...prev, cert])} style={{ display: 'none' }} />
                                                        {cert}
                                                    </label>
                                                ))}
                                            </div>
                                            {totalCertCost > 0 && (
                                                <div style={{ marginTop: '6px', fontWeight: 900, color: '#dc2626' }}>
                                                    인증비 합계: {totalCertCost.toLocaleString()}원
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '2rem' }}>
                            <button className="btn-primary" onClick={runWhatIf}><i className="fas fa-microchip"></i> AI 분석 및 리포트 생성</button>
                            <button className="btn-outline" onClick={() => { addScenario(); setActiveTab(1); }}><i className="fas fa-save"></i> 시나리오 데이터 저장</button>
                            <button className="btn-outline" onClick={() => { setIsSaveModalOpen(true); setSavedShareUrl(''); setSaveSimName(projectTitle || '제조 시뮬레이션'); }} style={{ borderColor: '#a5b4fc', color: '#6366f1' }}>
                                <i className="fas fa-cloud-upload-alt"></i> 저장 & 공유 링크 생성
                            </button>
                        </div>
                    </div >

                    {/* ====== 우측 탭 패널 ====== */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                        {/* 탭 헤더 */}
                        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)', borderRadius: '1.25rem 1.25rem 0 0', border: '1px solid rgba(255,255,255,0.3)', borderBottom: 'none', padding: '4px', gap: '2px' }}>
                            {[
                                { icon: 'fas fa-chart-pie', label: t.costStructure },
                                { icon: 'fas fa-save', label: `${t.savedScenarios}${scenarios.length > 0 ? ` (${scenarios.length})` : ''}` },
                                { icon: 'fas fa-chart-bar', label: t.scenarioCompare },
                            ].map((tab, i) => (
                                <button
                                    key={i}
                                    onClick={() => setActiveTab(i as 0 | 1 | 2)}
                                    style={{
                                        flex: 1, padding: '10px 8px', borderRadius: '1rem', border: 'none', cursor: 'pointer',
                                        fontWeight: 800, fontSize: '0.75rem', transition: 'all 0.2s',
                                        background: activeTab === i ? 'white' : 'transparent',
                                        color: activeTab === i ? '#3b82f6' : '#94a3b8',
                                        boxShadow: activeTab === i ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                    }}
                                >
                                    <i className={tab.icon} style={{ fontSize: '0.7rem' }}></i>
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* 탭 컨텐츠 박스 */}
                        <div style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '0 0 1.25rem 1.25rem', boxShadow: '0 8px 32px rgba(0,0,0,0.05)', padding: '0' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', padding: '1.5rem' }}>
                                {activeTab === 0 && (
                                    <>
                                        {/* ─── 저장/공유 빠른 액션 바 ─── */}
                                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '0.75rem 1rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.75rem' }}>
                                            <button onClick={() => { setIsSaveModalOpen(true); setSavedShareUrl(''); setSaveSimName(projectTitle || '제조 시뮬레이션'); setShowRecentList(false); }} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}>
                                                <i className="fas fa-cloud-upload-alt"></i> 저장 &amp; 공유
                                            </button>
                                            <button onClick={() => { setIsSaveModalOpen(true); setShowRecentList(true); setSavedShareUrl(''); }} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', background: '#faf5ff', color: '#7c3aed', border: '1px solid #e9d5ff', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}>
                                                <i className="fas fa-folder-open"></i> 불러오기
                                            </button>
                                            <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: '#94a3b8', fontWeight: 600 }}>
                                                현재 도착가 <span style={{ color: '#0f172a', fontWeight: 900 }}>{formatVal(simData.landedCost)}</span>/개
                                                {activeRisks.length > 0 && <span style={{ marginLeft: '6px', color: '#f59e0b', fontWeight: 800 }}>⚠️ 리스크 {activeRisks.length}개 적용</span>}
                                            </span>
                                        </div>

                                        {/* ─── 공급망 리스크 시나리오 ─── */}
                                        <div className="glass-card" style={{ background: activeRisks.length > 0 ? '#fffbeb' : 'white', border: activeRisks.length > 0 ? '1px solid #fde68a' : '1px solid #e2e8f0', padding: '1.25rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                                <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#92400e', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <i className="fas fa-exclamation-triangle" style={{ color: '#f59e0b' }}></i> 공급망 리스크 시나리오
                                                    {activeRisks.length > 0 && <span style={{ background: '#f59e0b', color: 'white', fontSize: '0.6rem', padding: '2px 6px', borderRadius: '10px', fontWeight: 900 }}>{activeRisks.length}개 활성</span>}
                                                </h3>
                                                {activeRisks.length > 0 && <button onClick={() => setActiveRisks([])} style={{ fontSize: '0.65rem', padding: '3px 8px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '4px', cursor: 'pointer', fontWeight: 700 }}>모두 해제</button>}
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: activeRisks.length > 0 ? '1rem' : '0' }}>
                                                {RISK_SCENARIOS.map(r => {
                                                    const isActive = activeRisks.includes(r.id);
                                                    return (
                                                        <button key={r.id} onClick={() => toggleRisk(r.id)} title={r.description}
                                                            style={{ padding: '5px 10px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s', background: isActive ? '#f59e0b' : '#fef3c7', color: isActive ? 'white' : '#92400e', border: isActive ? '1.5px solid #d97706' : '1.5px solid #fde68a', display: 'flex', alignItems: 'center', gap: '3px' }}
                                                        >
                                                            {isActive && <i className="fas fa-check" style={{ fontSize: '0.55rem' }}></i>}
                                                            {r.icon} {r.name}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            {activeRisks.length > 0 && (() => {
                                                const ri = simData.riskImpact;
                                                return (
                                                    <div>
                                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                                            {ri.tariff_delta > 0 && <span style={{ padding: '2px 7px', background: '#fee2e2', color: '#dc2626', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 800 }}>관세 +{ri.tariff_delta}%</span>}
                                                            {ri.shipping_delta > 0 && <span style={{ padding: '2px 7px', background: '#fef3c7', color: '#92400e', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 800 }}>물류비 +{ri.shipping_delta}%</span>}
                                                            {ri.labor_delta > 0 && <span style={{ padding: '2px 7px', background: '#f3e8ff', color: '#7c3aed', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 800 }}>인건비 +{ri.labor_delta}%</span>}
                                                            {ri.material_delta > 0 && <span style={{ padding: '2px 7px', background: '#ffe4e6', color: '#e11d48', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 800 }}>원자재 +{ri.material_delta}%</span>}
                                                            {ri.lead_time_delta > 0 && <span style={{ padding: '2px 7px', background: '#f1f5f9', color: '#475569', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 800 }}>납기 +{ri.lead_time_delta}일</span>}
                                                        </div>
                                                        <div style={{ padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span style={{ color: '#92400e', fontWeight: 700 }}>시나리오 적용 도착가</span>
                                                            <span style={{ fontSize: '1rem', fontWeight: 900, color: '#dc2626' }}>{formatVal(simData.landedCost)} <span style={{ fontSize: '0.6rem', opacity: 0.8 }}>반영됨</span></span>
                                                        </div>
                                                        <div style={{ marginTop: '6px', fontSize: '0.68rem', color: '#78350f', padding: '5px 10px', background: '#fefce8', borderRadius: '6px' }}>
                                                            대응 전략: 공급망 분산 및 대체 루트 확보로 원가 충격을 최소화하세요.
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>

                                        {/* Real-time KPI & Composition Chart */}
                                        <div className="glass-card">
                                            <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '2rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <i className="fas fa-chart-pie" style={{ color: '#3b82f6' }}></i> {(t as any)?.costStructure || '원가 분석'} (Composition: {incoterm})
                                            </h3>

                                            {/* Stacked Bar Chart for Cost Composition */}
                                            {(() => {
                                                const currentBase = incoterm === 'EXW' ? simData.exw : incoterm === 'FOB' ? simData.fob : simData.landedCost;
                                                const vMat = simData.partsCost + (simData.interShip || 0) + (simData.interDuty || 0) - (simData.drawback || 0);
                                                const vAssy = simData.vadd;
                                                const vFixed = simData.amortizedFixedCost;
                                                const vLog = incoterm === 'EXW' ? 0 : incoterm === 'FOB' ? simData.inlandCost : (simData.inlandCost + simData.actualShip);
                                                const vTax = incoterm === 'DDP' ? simData.actualTax : 0;

                                                const pBOM = Math.round((vMat / (currentBase || 1)) * 100);
                                                const pVA = Math.round((vAssy / (currentBase || 1)) * 100);
                                                const pFix = Math.round((vFixed / (currentBase || 1)) * 100);
                                                const pShip = Math.round((vLog / (currentBase || 1)) * 100);
                                                const pTax = Math.max(0, 100 - pBOM - pVA - pFix - pShip);

                                                return (
                                                    <>
                                                        <div className="chart-bar-container" style={{ height: '32px', background: '#f1f5f9', borderRadius: '16px', overflow: 'hidden', display: 'flex', marginBottom: '1.5rem', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)' }}>
                                                            {pBOM > 0 && (
                                                                <div className="chart-segment" style={{ width: `${pBOM}%`, background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'white', fontWeight: 800 }} title="자재비 상세">
                                                                    {pBOM >= 4 && `${pBOM}%`}
                                                                </div>
                                                            )}
                                                            {pVA > 0 && (
                                                                <div className="chart-segment" style={{ width: `${pVA}%`, background: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'white', fontWeight: 800 }} title="가공비 상세">
                                                                    {pVA >= 4 && `${pVA}%`}
                                                                </div>
                                                            )}
                                                            {pFix > 0 && (
                                                                <div className="chart-segment" style={{ width: `${pFix}%`, background: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'white', fontWeight: 800 }} title="고정비 상세">
                                                                    {pFix >= 4 && `${pFix}%`}
                                                                </div>
                                                            )}
                                                            {pShip > 0 && (
                                                                <div className="chart-segment" style={{ width: `${pShip}%`, background: '#fbbf24', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'white', fontWeight: 800 }} title="물류비 상세">
                                                                    {pShip >= 4 && `${pShip}%`}
                                                                </div>
                                                            )}
                                                            {pTax > 0 && (
                                                                <div className="chart-segment" style={{ width: `${pTax}%`, background: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'white', fontWeight: 800 }} title="세금/관세 상세">
                                                                    {pTax >= 4 && `${pTax}%`}
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
                                                            {pBOM > 0 && (
                                                                <div className="chart-legend-item" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>
                                                                    <span style={{ width: 10, height: 10, background: '#3b82f6', borderRadius: '2px' }} /> {(t as any)?.bomCost || '자재비'} <span style={{ color: '#3b82f6' }}>{pBOM}%</span>
                                                                </div>
                                                            )}
                                                            {pVA > 0 && (
                                                                <div className="chart-legend-item" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>
                                                                    <span style={{ width: 10, height: 10, background: '#60a5fa', borderRadius: '2px' }} /> {(t as any)?.procCost || '가공비'} <span style={{ color: '#60a5fa' }}>{pVA}%</span>
                                                                </div>
                                                            )}
                                                            {pFix > 0 && (
                                                                <div className="chart-legend-item" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>
                                                                    <span style={{ width: 10, height: 10, background: '#94a3b8', borderRadius: '2px' }} /> {(t as any)?.fixedCost || '고정비'} <span style={{ color: '#94a3b8' }}>{pFix}%</span>
                                                                </div>
                                                            )}
                                                            {pShip > 0 && (
                                                                <div className="chart-legend-item" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>
                                                                    <span style={{ width: 10, height: 10, background: '#fbbf24', borderRadius: '2px' }} /> {(t as any)?.logisticsCost || '물류비'} <span style={{ color: '#f59e0b' }}>{pShip}%</span>
                                                                </div>
                                                            )}
                                                            {pTax > 0 && (
                                                                <div className="chart-legend-item" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>
                                                                    <span style={{ width: 10, height: 10, background: '#f87171', borderRadius: '2px' }} /> {(t as any)?.taxCost || '세금/관세'} <span style={{ color: '#ef4444' }}>{pTax}%</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </>
                                                );
                                            })()}

                                            <div className="stat-grid">
                                                <div className="stat-box highlight">
                                                    <div className="label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            <span>Target {incoterm} Quote ({currency})</span>
                                                            {isStressMode && <span className="risk-badge risk-high" style={{ fontSize: '0.5rem', padding: '1px 4px', borderRadius: '4px' }}>HIGH RISK</span>}
                                                        </div>
                                                        <select
                                                            value={incoterm}
                                                            onChange={(e) => setIncoterm(e.target.value as any)}
                                                            style={{ border: 'none', background: 'transparent', fontSize: '0.65rem', fontWeight: 800, color: '#3b82f6', cursor: 'pointer', outline: 'none' }}
                                                        >
                                                            <option value="EXW">EXW (공장 인도)</option>
                                                            <option value="FOB">FOB (본선 인도)</option>
                                                            <option value="DDP">DDP (도착 인도)</option>
                                                        </select>
                                                    </div>
                                                    <div className="value" style={{ color: '#3b82f6' }}>{formatVal(simData.finalPrice)}</div>
                                                </div>
                                                <div className="stat-box">
                                                    <div className="label">{t.landedCostLabel}</div>
                                                    <div className="value">{formatVal(simData.landedCost)}</div>
                                                </div>
                                                <div className="stat-box">
                                                    <div className="label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span>{t.originLabel}</span>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <i className="fas fa-certificate" style={{ color: simData.isOriginMatch ? '#059669' : '#94a3b8' }}></i>
                                                        </div>
                                                    </div>
                                                    <div className="value" style={{ color: simData.isOriginMatch ? '#059669' : '#e11d48', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span>{simData.finalOrigin} <span style={{ fontSize: '0.7rem', fontWeight: 700, opacity: 0.8 }}>({simData.rvc.toFixed(1)}%)</span></span>
                                                        {/* ? 툴팁 아이콘 */}
                                                        <div style={{ position: 'relative', display: 'inline-flex' }} className="fta-tooltip-wrap">
                                                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: 'help', flexShrink: 0 }}>
                                                                <circle cx="12" cy="12" r="10" />
                                                                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                                                                <line x1="12" y1="17" x2="12.01" y2="17" />
                                                            </svg>
                                                            <div style={{
                                                                position: 'absolute', bottom: '120%', left: '50%', transform: 'translateX(-50%)',
                                                                background: '#0f172a', color: 'white', borderRadius: '8px', padding: '10px 12px',
                                                                fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap', zIndex: 200,
                                                                boxShadow: '0 4px 16px rgba(0,0,0,0.3)', lineHeight: '1.6',
                                                                pointerEvents: 'none'
                                                            }} className="fta-tooltip">
                                                                <div style={{ marginBottom: '6px', color: '#60a5fa', fontSize: '0.6rem', fontWeight: 900 }}>FTA별 RVC 기준치 (역내부가가치)</div>
                                                                {[
                                                                    { name: '한-미 FTA', val: 35, color: '#34d399' },
                                                                    { name: 'RCEP / 한-중', val: 40, color: '#60a5fa' },
                                                                    { name: '한-EU FTA', val: 45, color: '#a78bfa' },
                                                                    { name: 'ASEAN 일반', val: 50, color: '#fb923c' },
                                                                    { name: '엄격 기준', val: 60, color: '#f87171' },
                                                                ].map(item => (
                                                                    <div key={item.val} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center', padding: '1px 0', borderBottom: ftaThreshold === item.val ? '1px solid rgba(255,255,255,0.2)' : undefined, background: ftaThreshold === item.val ? 'rgba(255,255,255,0.07)' : undefined, borderRadius: '2px' }}>
                                                                        <span style={{ color: ftaThreshold === item.val ? 'white' : '#94a3b8' }}>{ftaThreshold === item.val ? '▶ ' : ''}{item.name}</span>
                                                                        <span style={{ color: item.color, fontWeight: 900 }}>{item.val}%↑</span>
                                                                    </div>
                                                                ))}
                                                                <div style={{ marginTop: '6px', fontSize: '0.55rem', color: '#64748b', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '4px' }}>※ 시뮬레이션 추정치 (실제 PSR 검토 필요)</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {/* FTA 협정 선택 */}
                                                    <div style={{ marginTop: '6px' }}>
                                                        <select
                                                            value={ftaThreshold}
                                                            onChange={e => setFtaThreshold(Number(e.target.value))}
                                                            style={{ fontSize: '0.55rem', fontWeight: 800, color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '2px 4px', cursor: 'pointer', outline: 'none', width: '100%' }}
                                                            title="FTA 협정별 RVC 기준치"
                                                        >
                                                            <option value={35}>한-미 FTA (RVC 35%)</option>
                                                            <option value={40}>RCEP / 한-중 FTA (RVC 40%)</option>
                                                            <option value={45}>한-EU FTA (RVC 45%)</option>
                                                            <option value={50}>ASEAN 일반 (RVC 50%)</option>
                                                            <option value={60}>엄격 기준 (RVC 60%)</option>
                                                        </select>
                                                    </div>
                                                    <div style={{ fontSize: '0.5rem', color: '#94a3b8', marginTop: '4px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                        <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                                                        {simData.isOriginMatch ? `시뮬레이션 추정치 (${ftaThreshold}% 기준 충족)` : `비원산지 재료 과다 (RVC < ${ftaThreshold}%)`}
                                                    </div>
                                                </div>
                                                <div className="stat-box">
                                                    <div className="label">{t.leadTimeLabel}</div>
                                                    <div className="value" style={{ fontSize: '0.9rem' }}>{simData.ltDays}일 / <span style={{ color: '#e11d48' }}>{formatVal(simData.invCost)}</span></div>
                                                    {/* Carbon Footprint removed as per user request */}
                                                </div>
                                            </div>

                                            <div style={{ marginTop: '1.5rem', background: '#f8fafc', padding: '1rem', borderRadius: '1rem', border: '1px solid #e2e8f0' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                                    <h4 style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', margin: 0 }}>{t.supplyTimeline}</h4>
                                                    <button
                                                        onClick={() => setIsTimelineEditing(!isTimelineEditing)}
                                                        style={{ background: isTimelineEditing ? '#e0f2fe' : 'none', border: isTimelineEditing ? '1px solid #3b82f6' : 'none', color: isTimelineEditing ? '#3b82f6' : '#94a3b8', fontSize: '0.75rem', cursor: 'pointer', transition: 'all 0.2s', padding: '4px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                        title="타임라인 기간 편집"
                                                    >
                                                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-10" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                                        {isTimelineEditing ? <span style={{ fontWeight: 800 }}>{t.save}</span> : <span>{t.edit}</span>}
                                                    </button>
                                                </div>
                                                <div style={{ display: 'flex', marginBottom: isTimelineEditing ? '1rem' : '1.5rem', height: '26px' }}>
                                                    {[
                                                        { label: 'Production', days: simData.timeline.mfg, color: '#64748b' },
                                                        { label: 'QC/Test', days: simData.timeline.qc, color: '#94a3b8' },
                                                        { label: 'Logistics', days: simData.timeline.logistics, color: '#3b82f6' }
                                                    ].map((step, idx, arr) => {
                                                        const isFirst = idx === 0;
                                                        const isLast = idx === arr.length - 1;
                                                        const arrowDepth = 10;
                                                        return (
                                                            <div
                                                                key={step.label}
                                                                className="timeline-segment"
                                                                onClick={() => setIsTimelineEditing(!isTimelineEditing)}
                                                                style={{
                                                                    flex: step.days || 1, // 방어 로직: 0일 때도 렌더링되게
                                                                    background: step.color,
                                                                    position: 'relative',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    color: 'white',
                                                                    fontSize: '0.65rem',
                                                                    fontWeight: 800,
                                                                    marginLeft: isFirst ? '0' : `-${arrowDepth}px`,
                                                                    clipPath: isFirst
                                                                        ? `polygon(0% 0%, calc(100% - ${arrowDepth}px) 0%, 100% 50%, calc(100% - ${arrowDepth}px) 100%, 0% 100%)`
                                                                        : isLast
                                                                            ? `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, ${arrowDepth}px 50%)`
                                                                            : `polygon(0% 0%, calc(100% - ${arrowDepth}px) 0%, 100% 50%, calc(100% - ${arrowDepth}px) 100%, 0% 100%, ${arrowDepth}px 50%)`,
                                                                    paddingLeft: isFirst ? '0' : `${arrowDepth}px`,
                                                                    paddingRight: isLast ? '0' : `${arrowDepth}px`,
                                                                    minWidth: isFirst || isLast ? '50px' : '40px',
                                                                    zIndex: arr.length - idx,
                                                                    cursor: 'pointer',
                                                                    transition: 'all 0.2s ease-in-out'
                                                                }}
                                                                title={`${step.label} 세부일정 편집`}
                                                            >
                                                                <span style={{ position: 'relative', zIndex: 1 }}>{step.days}일</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {isTimelineEditing ? (
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', alignItems: 'end', background: '#fff', padding: '1rem', borderRadius: '0.75rem', border: '1px dashed #cbd5e1' }}>
                                                        <div>
                                                            <label style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, marginBottom: '4px', display: 'block' }}>Production (일)</label>
                                                            <input type="number" min="0" className="sim-input" style={{ fontSize: '0.75rem', padding: '0.4rem', borderColor: customMfgDays !== null ? '#3b82f6' : '#e2e8f0' }} value={customMfgDays !== null ? customMfgDays : simData.timeline.mfg} onChange={(e) => setCustomMfgDays(parseInt(e.target.value) || 0)} onKeyDown={(e) => e.key === 'Enter' && setIsTimelineEditing(false)} />
                                                        </div>
                                                        <div>
                                                            <label style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 700, marginBottom: '4px', display: 'block' }}>QC/Test (일)</label>
                                                            <input type="number" min="0" className="sim-input" style={{ fontSize: '0.75rem', padding: '0.4rem', borderColor: customQcDays !== null ? '#3b82f6' : '#e2e8f0' }} value={customQcDays !== null ? customQcDays : simData.timeline.qc} onChange={(e) => setCustomQcDays(parseInt(e.target.value) || 0)} onKeyDown={(e) => e.key === 'Enter' && setIsTimelineEditing(false)} />
                                                        </div>
                                                        <div>
                                                            <label style={{ fontSize: '0.65rem', color: '#3b82f6', fontWeight: 700, marginBottom: '4px', display: 'block' }}>Logistics (일)</label>
                                                            <input type="number" min="0" className="sim-input" style={{ fontSize: '0.75rem', padding: '0.4rem', borderColor: customLtDays !== null ? '#3b82f6' : '#e2e8f0' }} value={customLtDays !== null ? customLtDays : simData.timeline.logistics} onChange={(e) => setCustomLtDays(parseInt(e.target.value) || 0)} onKeyDown={(e) => e.key === 'Enter' && setIsTimelineEditing(false)} />
                                                        </div>
                                                        <div style={{ textAlign: 'right' }}>
                                                            <button onClick={() => { setCustomMfgDays(null); setCustomQcDays(null); setCustomLtDays(null); }} style={{ fontSize: '0.65rem', background: '#f1f5f9', border: 'none', color: '#64748b', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 700 }}>
                                                                초기화
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 80px', gap: '8px', fontSize: '0.7rem', color: '#64748b', fontWeight: 700 }}>
                                                        <div className="timeline-legend" onClick={() => setIsTimelineEditing(true)}>
                                                            <div style={{ color: '#94a3b8', fontSize: '0.6rem' }}>Production</div>{simData.timeline.mfg}일
                                                        </div>
                                                        <div className="timeline-legend" onClick={() => setIsTimelineEditing(true)}>
                                                            <div style={{ color: '#94a3b8', fontSize: '0.6rem' }}>QC/Test</div>{simData.timeline.qc}일
                                                        </div>
                                                        <div className="timeline-legend" onClick={() => setIsTimelineEditing(true)}>
                                                            <div style={{ color: '#94a3b8', fontSize: '0.6rem' }}>Logistics</div>{simData.timeline.logistics}일
                                                        </div>
                                                        <div style={{ textAlign: 'right', borderLeft: '1px solid #e2e8f0' }}><div style={{ color: '#0f172a', fontSize: '0.65rem' }}>TOTAL</div><span style={{ fontSize: '0.9rem', color: '#0f172a' }}>{simData.totalLT}일</span></div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Detailed MFG Breakdown */}
                                            <div style={{ marginTop: '1.5rem', background: '#f8fafc', padding: '1rem', borderRadius: '1rem', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }} id="exw-section">
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showExwDetails ? '0.8rem' : '0' }}>
                                                    <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: '#475569', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2" /><line x1="8" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="16" y2="14" /><line x1="8" y1="18" x2="16" y2="18" /><line x1="8" y1="6" x2="16" y2="6" /></svg>
                                                        제조 원가(EXW) 상세 산출 내역 예시
                                                    </h4>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        {showExwDetails && (
                                                            <button
                                                                onClick={() => setIsExwEditing(!isExwEditing)}
                                                                style={{ background: isExwEditing ? '#eff6ff' : 'none', border: isExwEditing ? '1px solid #3b82f6' : 'none', color: isExwEditing ? '#3b82f6' : '#94a3b8', fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                                title="수동 편집"
                                                            >
                                                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-10" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                                                {isExwEditing && <span style={{ fontSize: '0.7rem', fontWeight: 800 }}>편집 중</span>}
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => setShowExwDetails(!showExwDetails)}
                                                            style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '0.7rem', fontWeight: 800, cursor: 'pointer' }}
                                                        >
                                                            {showExwDetails ? t.closeDetail : t.openDetail}
                                                        </button>
                                                    </div>
                                                </div>
                                                {showExwDetails && (
                                                    <>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.8rem', textAlign: 'center' }}>
                                                            <div>
                                                                <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '4px' }}>자재(BOM)</div>
                                                                {isExwEditing ? (
                                                                    <input type="text" className="sim-input" style={{ fontSize: '0.75rem', padding: '4px', textAlign: 'center', width: '100%', borderColor: mParts !== null ? '#3b82f6' : '#e2e8f0' }} value={Math.round(simData.partsCost).toLocaleString()} onChange={e => setMParts(parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0)} onKeyDown={e => e.key === 'Enter' && setIsExwEditing(false)} />
                                                                ) : (
                                                                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: mParts !== null ? '#3b82f6' : '#1e293b' }}>{formatVal(simData.partsCost)}</div>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '4px' }}>인건비/공임</div>
                                                                {isExwEditing ? (
                                                                    <input type="text" className="sim-input" style={{ fontSize: '0.75rem', padding: '4px', textAlign: 'center', width: '100%', borderColor: mLabor !== null ? '#3b82f6' : '#e2e8f0' }} value={Math.round(simData.labor).toLocaleString()} onChange={e => setMLabor(parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0)} onKeyDown={e => e.key === 'Enter' && setIsExwEditing(false)} />
                                                                ) : (
                                                                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: mLabor !== null ? '#3b82f6' : '#1e293b' }}>{formatVal(simData.labor)}</div>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '6px' }}>QC/불량(Scrap)</div>
                                                                {isExwEditing ? (
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                                                        <input
                                                                            type="text"
                                                                            className="sim-input"
                                                                            style={{ fontSize: '0.75rem', padding: '4px', textAlign: 'center', width: '100%', borderColor: mScrap !== null ? '#3b82f6' : '#e2e8f0' }}
                                                                            value={Math.round(simData.qcCost + simData.scrapCost).toLocaleString()}
                                                                            onChange={e => setMScrap(parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                                                                            onKeyDown={e => e.key === 'Enter' && setIsExwEditing(false)}
                                                                            placeholder="금액"
                                                                        />
                                                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                                                            <input
                                                                                type="text"
                                                                                className="sim-input"
                                                                                style={{ fontSize: '0.75rem', padding: '4px', textAlign: 'center', width: '100%', borderColor: mScrap !== null ? '#3b82f6' : '#e2e8f0' }}
                                                                                value={(simData.scrapRate * 100).toFixed(1)}
                                                                                onChange={e => {
                                                                                    const val = parseFloat(e.target.value) || 0;
                                                                                    setMScrap((simData.mfgBase * (val / 100)) + simData.qcCost);
                                                                                }}
                                                                                onKeyDown={e => e.key === 'Enter' && setIsExwEditing(false)}
                                                                                placeholder="비율"
                                                                            />
                                                                            <span style={{ position: 'absolute', right: '6px', fontSize: '0.65rem', color: '#94a3b8' }}>%</span>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: mScrap !== null ? '#3b82f6' : '#e11d48', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                                        <span>{formatVal(simData.qcCost + simData.scrapCost)}</span>
                                                                        <span style={{ fontSize: '0.65rem', fontWeight: 600, opacity: 0.7, marginTop: '2px' }}>
                                                                            ({(simData.scrapRate * 100).toFixed(1)}%)
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '4px' }}>고정비(인증/금형)</div>
                                                                {isExwEditing ? (
                                                                    <input type="text" className="sim-input" style={{ fontSize: '0.75rem', padding: '4px', textAlign: 'center', width: '100%', borderColor: mFixed !== null ? '#3b82f6' : '#e2e8f0' }} value={Math.round(simData.amortizedFixedCost).toLocaleString()} onChange={e => setMFixed(parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0)} onKeyDown={e => e.key === 'Enter' && setIsExwEditing(false)} />
                                                                ) : (
                                                                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: mFixed !== null ? '#3b82f6' : '#1e293b' }}>{formatVal(simData.amortizedFixedCost)}</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.8rem', textAlign: 'center', marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px dashed #e2e8f0' }}>
                                                            <div>
                                                                <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '4px' }}>유틸리티/임차</div>
                                                                {isExwEditing ? (
                                                                    <input type="text" className="sim-input" style={{ fontSize: '0.75rem', padding: '4px', textAlign: 'center', width: '100%', borderColor: mUtil !== null ? '#3b82f6' : '#e2e8f0' }} value={Math.round(simData.utilityTotal).toLocaleString()} onChange={e => setMUtil(parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0)} onKeyDown={e => e.key === 'Enter' && setIsExwEditing(false)} />
                                                                ) : (
                                                                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: mUtil !== null ? '#3b82f6' : '#1e293b' }}>{formatVal(simData.utilityTotal)}</div>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '4px' }}>간접비(Overhead)</div>
                                                                {isExwEditing ? (
                                                                    <input type="text" className="sim-input" style={{ fontSize: '0.75rem', padding: '4px', textAlign: 'center', width: '100%', borderColor: mOverhead !== null ? '#3b82f6' : '#e2e8f0' }} value={Math.round(simData.overhead).toLocaleString()} onChange={e => setMOverhead(parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0)} onKeyDown={e => e.key === 'Enter' && setIsExwEditing(false)} />
                                                                ) : (
                                                                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: mOverhead !== null ? '#3b82f6' : '#1e293b' }}>{formatVal(simData.overhead)}</div>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '4px' }}>부품 조달 물류/관세</div>
                                                                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1e293b' }}>{formatVal((simData.interShip || 0) + (simData.interDuty || 0) - (simData.drawback || 0))}</div>
                                                            </div>
                                                            <div style={{ background: '#eff6ff', borderRadius: '0.75rem', padding: '8px 0', border: '1px solid #dbeafe' }}>
                                                                <div style={{ fontSize: '0.65rem', color: '#3b82f6', fontWeight: 800, marginBottom: '2px' }}>총 제조원가</div>
                                                                <div style={{ fontWeight: 900, fontSize: '0.95rem', color: '#1d4ed8' }}>{formatVal(simData.exw)}</div>
                                                            </div>
                                                        </div>
                                                        {isExwEditing && (
                                                            <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                                                                <button
                                                                    onClick={() => {
                                                                        setMParts(null); setMLabor(null); setMScrap(null); setMFixed(null); setMUtil(null); setMOverhead(null);
                                                                    }}
                                                                    style={{ fontSize: '0.6rem', padding: '4px 8px', borderRadius: '4px', background: '#e2e8f0', color: '#64748b', border: 'none', cursor: 'pointer', fontWeight: 800 }}
                                                                >
                                                                    오버라이드 초기화
                                                                </button>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>

                                            {/* Cost Bridge Analysis: EXW to DDP */}
                                            <div style={{ marginTop: '2.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem' }} id="bridge-section">
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                                    <h4 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#475569', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>
                                                        원가 상승 요인 분석 (EXW → DDP Bridge)
                                                    </h4>
                                                    <button
                                                        onClick={() => setIsBridgeEditing(!isBridgeEditing)}
                                                        style={{ background: isBridgeEditing ? '#ecfdf5' : 'none', border: isBridgeEditing ? '1px solid #10b981' : 'none', color: isBridgeEditing ? '#10b981' : '#94a3b8', fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                        title="브릿지 수동 편집"
                                                    >
                                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-10" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                                        {isBridgeEditing && <span style={{ fontSize: '0.7rem', fontWeight: 800 }}>편집 중</span>}
                                                    </button>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                    {[
                                                        { label: 'EXW (제조원가)', val: simData.exw, color: '#3b82f6', id: 'EXW', isCumulative: true },
                                                        { label: '+ 내륙물류/항만', val: simData.inlandCost, color: '#64748b', id: 'FOB', setter: setCustomInland },
                                                        { label: '+ 국제운송비', val: simData.actualShip, color: '#fbbf24', id: 'SHIP', setter: setCustomShip },
                                                        { label: '+ 관세/통관/세금', val: simData.actualTax, color: '#f87171', id: 'DDP', setter: setCustomTax }
                                                    ].map((s, idx) => {
                                                        const isOverride = (idx === 1 && customInland !== null) || (idx === 2 && customShip !== null) || (idx === 3 && customTax !== null);
                                                        const isApplicable = (incoterm === 'DDP') || (incoterm === 'FOB' && idx <= 1) || (incoterm === 'EXW' && idx === 0);

                                                        return (
                                                            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 100px', gap: '12px', alignItems: 'center', opacity: isApplicable ? 1 : 0.4, transition: 'all 0.3s' }}>
                                                                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: isApplicable ? '#0f172a' : '#94a3b8' }}>{s.label}</span>
                                                                <div style={{ height: '10px', background: '#f1f5f9', borderRadius: '5px', display: 'flex' }}>
                                                                    <div style={{ width: `${(s.val / simData.ddp) * 100}%`, height: '100%', background: s.color, borderRadius: '5px', boxSizing: 'border-box' }} />
                                                                </div>

                                                                {s.setter && isBridgeEditing ? (
                                                                    <div style={{ position: 'relative' }}>
                                                                        <input
                                                                            type="text"
                                                                            value={s.val > 0 ? Math.round(s.val).toLocaleString() : ''}
                                                                            onChange={(e) => {
                                                                                const val = e.target.value.replace(/[^0-9]/g, '');
                                                                                const num = parseInt(val) || 0;
                                                                                s.setter!(num);
                                                                                setOverrideDiscounts(true);
                                                                            }}
                                                                            onKeyDown={e => e.key === 'Enter' && setIsBridgeEditing(false)}
                                                                            style={{
                                                                                width: '100%', border: isBridgeEditing ? '1.5px solid #10b981' : 'none', background: isOverride ? '#ecfdf5' : 'transparent', textAlign: 'right', fontSize: '0.75rem', fontWeight: 800, color: isOverride ? '#10b981' : (isApplicable ? '#0f172a' : '#94a3b8'), outline: 'none', padding: '2px 4px', borderRadius: '4px'
                                                                            }}
                                                                        />
                                                                    </div>
                                                                ) : (
                                                                    <span style={{ fontSize: '0.75rem', fontWeight: 800, textAlign: 'right', color: isApplicable ? '#0f172a' : '#94a3b8' }}>
                                                                        {formatVal(Math.round(s.val))}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        );
                                                    })}

                                                    {/* Bridge Reset Button */}
                                                    {isBridgeEditing && (
                                                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                                                            <button
                                                                onClick={() => {
                                                                    setCustomInland(null);
                                                                    setCustomShip(null);
                                                                    setCustomTax(null);
                                                                }}
                                                                style={{ fontSize: '0.65rem', padding: '4px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer', color: '#64748b', fontWeight: 800 }}
                                                            >
                                                                브릿지 오버라이드 초기화
                                                            </button>
                                                        </div>
                                                    )}

                                                    {/* Total Sum Row */}

                                                    {/* Total Sum Row */}
                                                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 100px', gap: '12px', alignItems: 'center', marginTop: '12px', paddingTop: '12px', borderTop: '2px solid #f1f5f9' }}>
                                                        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0f172a' }}>최종 도착가 (DDP)</span>
                                                        <div style={{ height: '10px', background: '#3b82f6', borderRadius: '5px' }} />
                                                        <span style={{ fontSize: '0.85rem', fontWeight: 900, textAlign: 'right', color: '#0f172a' }}>
                                                            {formatVal(Math.round(simData.ddp))}
                                                        </span>
                                                    </div>

                                                    {/* Profit Margin & Final Quote — Compact */}
                                                    <div style={{ marginTop: '14px', background: 'linear-gradient(135deg, #f0fdf4, #ecfdf5)', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '12px 16px' }}>
                                                        {/* Row 1: Margin pills + editable amount */}
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                                <span style={{ fontSize: '0.6rem', fontWeight: 800, color: '#059669', whiteSpace: 'nowrap' }}>📈 마진</span>
                                                                {[5, 10, 15, 20, 25, 30].map(v => (
                                                                    <button key={v} onClick={() => setProfitMargin(v / 100)}
                                                                        style={{
                                                                            padding: '3px 8px', borderRadius: '12px', fontSize: '0.6rem', fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s',
                                                                            border: Math.round(profitMargin * 100) === v ? '1.5px solid #10b981' : '1px solid #d1fae5',
                                                                            background: Math.round(profitMargin * 100) === v ? '#10b981' : '#fff',
                                                                            color: Math.round(profitMargin * 100) === v ? '#fff' : '#6b7280',
                                                                            boxShadow: Math.round(profitMargin * 100) === v ? '0 2px 6px rgba(16,185,129,0.25)' : 'none'
                                                                        }}
                                                                    >{v}%</button>
                                                                ))}
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                                                                <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#059669' }}>+</span>
                                                                <input
                                                                    type="text"
                                                                    value={Math.round(simData.ddp * profitMargin).toLocaleString()}
                                                                    onChange={(e) => {
                                                                        const num = parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0;
                                                                        setProfitMargin(Math.min(simData.ddp > 0 ? num / simData.ddp : 0, 1));
                                                                    }}
                                                                    style={{
                                                                        width: '90px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 800, color: '#059669',
                                                                        border: '1px solid #a7f3d0', borderRadius: '6px', padding: '3px 6px',
                                                                        background: '#fff', outline: 'none', transition: 'border-color 0.2s'
                                                                    }}
                                                                    onFocus={(e) => e.target.style.borderColor = '#10b981'}
                                                                    onBlur={(e) => e.target.style.borderColor = '#a7f3d0'}
                                                                />
                                                            </div>
                                                        </div>
                                                        {/* Row 2: Final Quote */}
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #a7f3d0' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <div style={{ width: '22px', height: '22px', borderRadius: '6px', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                                                                </div>
                                                                <div>
                                                                    <div style={{ fontSize: '0.6rem', color: '#374151', fontWeight: 800 }}>최종 제안가</div>
                                                                    <div style={{ fontSize: '0.5rem', color: '#94a3b8', fontWeight: 600 }}>DDP + {(profitMargin * 100).toFixed(1)}%</div>
                                                                </div>
                                                            </div>
                                                            <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#059669', letterSpacing: '-0.5px' }}>
                                                                {formatVal(Math.round(simData.finalPrice))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div style={{ marginTop: '1.5rem', background: '#f0fdf4', padding: '0.75rem', borderRadius: '0.75rem', fontSize: '0.75rem', color: '#166534', border: '1px solid #bbf7d0' }}>
                                                    <i className="fas fa-info-circle"></i> <strong>분석 의견:</strong>
                                                    {simData.finalDuty > simData.exw * 0.15 ? ' 수입국 고율 관세가 제조 원가 우위를 대부분 상쇄하고 있습니다.' : ' 국제 물류비와 리드타임 금융 비용이 주요 지출원입니다.'}
                                                </div>
                                            </div>

                                            {/* ─── 문의 연결 CTA ─── */}
                                            <div style={{ marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'linear-gradient(135deg, #eff6ff, #f0fdf4)', borderRadius: '1rem', border: '1px solid #bfdbfe' }}>
                                                <p style={{ fontSize: '0.82rem', color: '#1e40af', fontWeight: 800, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <i className="fas fa-clipboard-list"></i> 이 시뮬레이션 결과로 실제 제조 견적을 받아보세요
                                                </p>
                                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                                    <button
                                                        onClick={handleRequestQuote}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.65rem 1.1rem', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: 'white', border: 'none', borderRadius: '0.75rem', fontWeight: 800, fontSize: '0.82rem', cursor: 'pointer', boxShadow: '0 4px 12px rgba(59,130,246,0.3)' }}
                                                    >
                                                        <i className="fas fa-industry"></i> 제조 견적 요청하기
                                                    </button>
                                                    <button
                                                        onClick={handleFindPartner}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.65rem 1.1rem', background: 'white', color: '#1e40af', border: '1.5px solid #bfdbfe', borderRadius: '0.75rem', fontWeight: 800, fontSize: '0.82rem', cursor: 'pointer' }}
                                                    >
                                                        <i className="fas fa-search"></i> 최적 공장 찾기
                                                    </button>
                                                </div>
                                                <p style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.5rem' }}>예상 예산 {formatVal(simData.landedCost)} · {industry} · {assy} 생산 · {parseInt(volumeStr, 10).toLocaleString()}개</p>
                                            </div>
                                        </div>

                                        {/* AI Insight Card */}
                                        {
                                            aiPanelState !== 'hidden' && (
                                                <div className="glass-card" style={{ background: '#0f172a', color: 'white', border: 'none', padding: '2rem' }}>
                                                    {aiPanelState === 'loading' ? (
                                                        <div style={{ textAlign: 'center', padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                                            <div style={{ width: 40, height: 40, border: '3px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                                            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                                                            <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>원가 구조 분석 중...</span>
                                                        </div>
                                                    ) : (() => {
                                                        const ins = matchedInsight as any;
                                                        if (!ins) return null;
                                                        const scoreColor = ins.costScore >= 75 ? '#34d399' : ins.costScore >= 50 ? '#fbbf24' : '#f87171';
                                                        const riskColor = ins.riskLevel === 'HIGH' ? '#f87171' : ins.riskLevel === 'MEDIUM' ? '#fbbf24' : '#34d399';
                                                        return (
                                                            <div>
                                                                {/* 헤더 */}
                                                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                                                                    <div>
                                                                        <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 800, marginBottom: '4px', letterSpacing: '0.1em' }}>AI ANALYSIS REPORT</div>
                                                                        <h3 style={{ fontSize: '1rem', fontWeight: 900, color: 'white', margin: 0 }}>{ins.title}</h3>
                                                                    </div>
                                                                    <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
                                                                        {/* 비용 효율 점수 */}
                                                                        <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.05)', padding: '10px 16px', borderRadius: '10px', border: `1px solid ${scoreColor}40` }}>
                                                                            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: scoreColor, lineHeight: 1 }}>{ins.costScore}</div>
                                                                            <div style={{ fontSize: '0.55rem', color: '#94a3b8', fontWeight: 800, marginTop: '2px' }}>COST SCORE</div>
                                                                        </div>
                                                                        {/* 리스크 등급 */}
                                                                        <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.05)', padding: '10px 16px', borderRadius: '10px', border: `1px solid ${riskColor}40` }}>
                                                                            <div style={{ fontSize: '1.1rem', fontWeight: 900, color: riskColor, lineHeight: 1.2 }}>{ins.riskLevel}</div>
                                                                            <div style={{ fontSize: '0.55rem', color: '#94a3b8', fontWeight: 800, marginTop: '2px' }}>RISK LEVEL</div>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* 비용 구조 바 */}
                                                                <div style={{ marginBottom: '1.5rem' }}>
                                                                    <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 800, marginBottom: '8px', letterSpacing: '0.08em' }}>COST BREAKDOWN</div>
                                                                    <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
                                                                        {ins.bomRatio > 0 && <div style={{ width: `${(ins.bomRatio * 100).toFixed(0)}%`, background: '#3b82f6' }} />}
                                                                        {ins.vaddRatio > 0 && <div style={{ width: `${(ins.vaddRatio * 100).toFixed(0)}%`, background: '#60a5fa' }} />}
                                                                        {ins.shipRatio > 0 && <div style={{ width: `${(ins.shipRatio * 100).toFixed(0)}%`, background: '#fbbf24' }} />}
                                                                        {ins.taxRatio > 0 && <div style={{ flex: 1, background: '#f87171' }} />}
                                                                    </div>
                                                                    <div style={{ display: 'flex', gap: '12px', fontSize: '0.6rem', color: '#94a3b8', fontWeight: 700, flexWrap: 'wrap' }}>
                                                                        {ins.bomRatio > 0 && <span><span style={{ color: '#3b82f6' }}>■</span> BOM {(ins.bomRatio * 100).toFixed(0)}%</span>}
                                                                        {ins.vaddRatio > 0 && <span><span style={{ color: '#60a5fa' }}>■</span> 가공비 {(ins.vaddRatio * 100).toFixed(0)}%</span>}
                                                                        {ins.shipRatio > 0 && <span><span style={{ color: '#fbbf24' }}>■</span> 물류 {(ins.shipRatio * 100).toFixed(0)}%</span>}
                                                                        {ins.taxRatio > 0 && <span><span style={{ color: '#f87171' }}>■</span> 세금 {(ins.taxRatio * 100).toFixed(0)}%</span>}
                                                                    </div>
                                                                </div>

                                                                {/* 원산지 판정 */}
                                                                <div style={{ background: simData.isOriginMatch ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)', border: `1px solid ${simData.isOriginMatch ? '#34d39340' : '#f8717140'}`, borderRadius: '0.75rem', padding: '10px 14px', marginBottom: '1.5rem', fontSize: '0.75rem', color: simData.isOriginMatch ? '#34d399' : '#f87171', fontWeight: 700 }}>
                                                                    <span style={{ marginRight: '6px' }}>{simData.isOriginMatch ? '✅' : '⚠️'}</span>
                                                                    {ins.originDetail}
                                                                </div>

                                                                {/* 최적화 제언 */}
                                                                <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 800, marginBottom: '10px', letterSpacing: '0.08em' }}>OPTIMIZATION INSIGHTS ({ins.suggestions?.length})</div>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                                    {ins.suggestions?.map((s: any, i: number) => (
                                                                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '36px 1fr auto', gap: '12px', alignItems: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: '0.75rem', padding: '12px', border: `1px solid ${s.color}25` }}>
                                                                            <div style={{ fontSize: '1.2rem', textAlign: 'center' }}>{s.icon}</div>
                                                                            <div>
                                                                                <div style={{ fontSize: '0.8rem', fontWeight: 800, color: s.color, marginBottom: '3px' }}>{s.title}</div>
                                                                                <div style={{ fontSize: '0.7rem', color: '#94a3b8', lineHeight: 1.5 }}>{s.detail}</div>
                                                                            </div>
                                                                            <div style={{ fontSize: '0.6rem', fontWeight: 800, color: s.color, background: `${s.color}15`, padding: '4px 8px', borderRadius: '6px', whiteSpace: 'nowrap', textAlign: 'right' }}>{s.impact}</div>
                                                                        </div>
                                                                    ))}
                                                                </div>

                                                                {/* 푸터 */}
                                                                <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.6rem', color: '#475569' }}>
                                                                    <span>※ 시뮬레이션 추정치 기반 분석. 실제 FTA 원산지 판정은 관세사 검토 필요.</span>
                                                                    <span>{new Date().toLocaleDateString('ko-KR')} 생성</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            )
                                        }
                                        {/* ── 민감도 분석 (What-if 슬라이더) ── */}
                                        <div className="glass-card" style={{ background: 'white', border: '1px solid #e2e8f0' }}>
                                            <div
                                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
                                                onClick={() => setShowSensitivity(v => !v)}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <div style={{ width: 32, height: 32, borderRadius: '10px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <i className="fas fa-sliders-h" style={{ color: 'white', fontSize: '0.8rem' }}></i>
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: 900, fontSize: '0.95rem', color: '#0f172a' }}>민감도 분석 (What-if 시뮬레이션)</div>
                                                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>변수별 슬라이더로 도착원가 변화를 즉시 확인</div>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    {sensitivityResult && (sensitivityResult.delta !== 0) && (
                                                        <span style={{
                                                            fontSize: '0.75rem', fontWeight: 900, padding: '4px 10px', borderRadius: '20px',
                                                            background: sensitivityResult.delta > 0 ? '#fee2e2' : '#dcfce7',
                                                            color: sensitivityResult.delta > 0 ? '#dc2626' : '#16a34a',
                                                        }}>
                                                            {sensitivityResult.delta > 0 ? '+' : ''}{sensitivityResult.deltaRate.toFixed(1)}%
                                                        </span>
                                                    )}
                                                    <i className={`fas fa-chevron-${showSensitivity ? 'up' : 'down'}`} style={{ color: '#94a3b8', fontSize: '0.8rem' }}></i>
                                                </div>
                                            </div>

                                            {showSensitivity && (
                                                <div style={{ marginTop: '1.5rem' }}>
                                                    {/* 요약 카드 */}
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                                                        <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '0.75rem', border: '1px solid #e2e8f0' }}>
                                                            <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 800, marginBottom: '4px' }}>기준 도착원가</div>
                                                            <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#0f172a' }}>{formatVal(simData.landedCost)}</div>
                                                        </div>
                                                        <div style={{ padding: '1rem', background: sensitivityResult && sensitivityResult.delta > 0 ? '#fef2f2' : '#f0fdf4', borderRadius: '0.75rem', border: `1px solid ${sensitivityResult && sensitivityResult.delta > 0 ? '#fecaca' : '#bbf7d0'}` }}>
                                                            <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 800, marginBottom: '4px' }}>현재 설정 도착원가</div>
                                                            <div style={{ fontSize: '1.1rem', fontWeight: 900, color: sensitivityResult && sensitivityResult.delta > 0 ? '#dc2626' : '#16a34a' }}>
                                                                {sensitivityResult ? formatVal(sensitivityResult.adjTotal) : formatVal(simData.landedCost)}
                                                                {sensitivityResult && sensitivityResult.delta !== 0 && (
                                                                    <span style={{ fontSize: '0.7rem', marginLeft: '6px' }}>
                                                                        ({sensitivityResult.delta > 0 ? '+' : ''}{sensitivityResult.deltaRate.toFixed(1)}%)
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* 슬라이더 목록 */}
                                                    {([
                                                        { key: 'exchangeRate',  label: '환율 변동',   min: -30,  max: 30,  step: 1, unit: '%', desc: '기준 환율 대비' },
                                                        { key: 'laborCost',     label: '인건비 변동', min: -50,  max: 50,  step: 1, unit: '%', desc: '현지 인건비 대비' },
                                                        { key: 'materialCost',  label: '원자재 변동', min: -50,  max: 50,  step: 1, unit: '%', desc: 'BOM 단가 대비' },
                                                        { key: 'volume',        label: '물량 변화',   min: -90,  max: 500, step: 5, unit: '%', desc: '현재 물량 대비' },
                                                        { key: 'tariffRate',    label: '추가 관세',   min: 0,    max: 50,  step: 1, unit: '%p', desc: '현행 관세에 추가' },
                                                        { key: 'shippingCost',  label: '물류비 변동', min: -50,  max: 100, step: 1, unit: '%', desc: '현재 운임 대비' },
                                                    ] as { key: keyof typeof sensitivity; label: string; min: number; max: number; step: number; unit: string; desc: string }[]).map(item => {
                                                        const val = sensitivity[item.key];
                                                        const pct = ((val - item.min) / (item.max - item.min)) * 100;
                                                        const isZero = val === 0;
                                                        const isPositive = val > 0;
                                                        return (
                                                            <div key={item.key} style={{ marginBottom: '1.25rem' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                                                    <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#374151' }}>{item.label}</span>
                                                                    <span style={{
                                                                        fontSize: '0.75rem', fontWeight: 900, padding: '2px 8px', borderRadius: '12px', minWidth: '52px', textAlign: 'center',
                                                                        background: isZero ? '#f1f5f9' : isPositive ? '#fee2e2' : '#dcfce7',
                                                                        color: isZero ? '#64748b' : isPositive ? '#dc2626' : '#16a34a',
                                                                    }}>
                                                                        {val > 0 ? '+' : ''}{val}{item.unit}
                                                                    </span>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 700, minWidth: '32px', textAlign: 'right' }}>{item.min}{item.unit}</span>
                                                                    <div style={{ flex: 1, position: 'relative' }}>
                                                                        <input
                                                                            type="range"
                                                                            min={item.min} max={item.max} step={item.step}
                                                                            value={val}
                                                                            onChange={e => setSensitivity(prev => ({ ...prev, [item.key]: Number(e.target.value) }))}
                                                                            style={{ width: '100%', accentColor: isZero ? '#94a3b8' : isPositive ? '#ef4444' : '#10b981', cursor: 'pointer' }}
                                                                        />
                                                                    </div>
                                                                    <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 700, minWidth: '38px' }}>{item.max > 0 ? '+' : ''}{item.max}{item.unit}</span>
                                                                </div>
                                                                <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '2px', paddingLeft: '42px' }}>{item.desc}</div>
                                                            </div>
                                                        );
                                                    })}

                                                    {/* 초기화 버튼 */}
                                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                                                        <button
                                                            onClick={() => setSensitivity({ exchangeRate: 0, laborCost: 0, materialCost: 0, volume: 0, tariffRate: 0, shippingCost: 0 })}
                                                            style={{ fontSize: '0.75rem', fontWeight: 800, padding: '6px 14px', borderRadius: '8px', border: '1.5px solid #e2e8f0', background: '#f8fafc', color: '#64748b', cursor: 'pointer' }}
                                                        >
                                                            모두 초기화
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}

                                {/* ━━━ 고급 시각화 1: 워터폴 + Sankey ━━━ */}
                                {activeTab === 0 && (() => {
                                    const [vizTab2, setVizTab2] = React.useState(0);
                                    const fmtKv = (v: number) => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v.toFixed(0);
                                    const wfItems = [
                                        { label: '인건비', val: simData.labor, color: '#6366f1' },
                                        { label: '자재비', val: simData.partsCost, color: '#8b5cf6' },
                                        { label: '오버헤드', val: simData.overhead, color: '#a78bfa' },
                                        { label: '물류비', val: simData.actualShip, color: '#3b82f6' },
                                        { label: '관세', val: simData.finalDuty, color: '#f59e0b' },
                                        { label: '부가세', val: simData.vatAmount, color: '#ef4444' },
                                        { label: '인증비', val: simData.certTotal / Math.max(simData.volume, 1), color: '#10b981' },
                                    ];
                                    const wfTotal = wfItems.reduce((a, b) => a + b.val, 0);
                                    const BW = 520, BH = 220, BG = 48;
                                    const barW = Math.floor((BW - BG * (wfItems.length + 1)) / (wfItems.length + 1));
                                    const maxValV = wfTotal * 1.05;
                                    let cumV = 0;
                                    const wfBars = wfItems.map((it, i) => {
                                        const x = BG + i * (barW + BG);
                                        const y = BH - (cumV + it.val) / maxValV * BH;
                                        const h = it.val / maxValV * BH;
                                        cumV += it.val;
                                        return { ...it, x, y, h };
                                    });
                                    const finalX = BG + wfItems.length * (barW + BG);
                                    const finalY = 0;
                                    const finalH = wfTotal / maxValV * BH;
                                    // Sankey data
                                    const skNodes = [
                                        { id: 'labor', label: '인건비', val: simData.labor, col: 0, color: '#6366f1' },
                                        { id: 'parts', label: '자재비', val: simData.partsCost, col: 0, color: '#8b5cf6' },
                                        { id: 'overhead', label: '오버헤드', val: simData.overhead, col: 0, color: '#a78bfa' },
                                        { id: 'ship', label: '물류비', val: simData.actualShip, col: 1, color: '#3b82f6' },
                                        { id: 'duty', label: '관세+세금', val: simData.finalDuty + simData.vatAmount, col: 1, color: '#f59e0b' },
                                        { id: 'mfg', label: '제조원가', val: simData.labor + simData.partsCost + simData.overhead, col: 2, color: '#6366f1' },
                                        { id: 'landed', label: '랜딩원가', val: simData.landedCost, col: 2, color: '#0ea5e9' },
                                        { id: 'final', label: '최종원가', val: simData.finalPrice, col: 3, color: '#10b981' },
                                    ];
                                    const SKW = 520, SKH = 200, colW = SKW / 4;
                                    const colNodes: {[k: number]: typeof skNodes} = { 0: [], 1: [], 2: [], 3: [] };
                                    skNodes.forEach(n => colNodes[n.col].push(n));
                                    const nodeH = (val: number) => Math.max(8, (val / (simData.finalPrice * 1.1)) * SKH * 0.85);
                                    const colY: {[k: string]: number} = {};
                                    [0,1,2,3].forEach(col => {
                                        let y = 10;
                                        colNodes[col].forEach(n => {
                                            colY[n.id] = y;
                                            y += nodeH(n.val) + 8;
                                        });
                                    });
                                    return (
                                        <div className="glass-card" style={{ background: 'white', marginBottom: '1.5rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#475569', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                                    <i className="fas fa-chart-bar" style={{ color: '#6366f1' }}></i> 비용 구조 분석
                                                </h3>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    {['워터폴', 'Sankey'].map((lb, idx) => (
                                                        <button key={idx} onClick={() => setVizTab2(idx)}
                                                            style={{ fontSize: '0.72rem', fontWeight: 700, padding: '4px 12px', borderRadius: '6px', border: '1.5px solid', borderColor: vizTab2 === idx ? '#6366f1' : '#e2e8f0', background: vizTab2 === idx ? '#6366f1' : '#f8fafc', color: vizTab2 === idx ? '#fff' : '#64748b', cursor: 'pointer' }}>
                                                            {lb}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            {vizTab2 === 0 && (
                                                <div style={{ overflowX: 'auto' }}>
                                                    <svg width={BW + BG * 2} height={BH + 60} style={{ display: 'block', margin: '0 auto' }}>
                                                        <g transform={`translate(0,20)`}>
                                                            {wfBars.map((b, i) => (
                                                                <g key={i}>
                                                                    <rect x={b.x} y={b.y} width={barW} height={b.h} fill={b.color} rx={3} opacity={0.85}/>
                                                                    {i < wfBars.length - 1 && (
                                                                        <line x1={b.x + barW} y1={b.y} x2={wfBars[i+1].x} y2={b.y} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4,3"/>
                                                                    )}
                                                                    <text x={b.x + barW/2} y={b.y - 4} textAnchor="middle" fontSize={9} fill="#64748b">{fmtKv(b.val)}</text>
                                                                    <text x={b.x + barW/2} y={BH + 14} textAnchor="middle" fontSize={9} fill="#475569" fontWeight={700}>{b.label}</text>
                                                                </g>
                                                            ))}
                                                            <rect x={finalX} y={finalY} width={barW} height={finalH} fill="#10b981" rx={3}/>
                                                            <text x={finalX + barW/2} y={finalY - 4} textAnchor="middle" fontSize={9} fill="#10b981" fontWeight={800}>{fmtKv(wfTotal)}</text>
                                                            <text x={finalX + barW/2} y={BH + 14} textAnchor="middle" fontSize={9} fill="#10b981" fontWeight={800}>최종원가</text>
                                                            <line x1={0} y1={BH} x2={BW + BG * 2} y2={BH} stroke="#e2e8f0" strokeWidth={1}/>
                                                        </g>
                                                    </svg>
                                                </div>
                                            )}
                                            {vizTab2 === 1 && (
                                                <div style={{ overflowX: 'auto' }}>
                                                    <svg width={SKW + 80} height={SKH + 20} style={{ display: 'block', margin: '0 auto' }}>
                                                        <g transform="translate(10,10)">
                                                            {[0,1,2,3].map(col => (
                                                                colNodes[col].map(n => {
                                                                    const nx = col * colW + 4;
                                                                    const ny = colY[n.id];
                                                                    const nh = nodeH(n.val);
                                                                    return (
                                                                        <g key={n.id}>
                                                                            <rect x={nx} y={ny} width={colW - 16} height={nh} fill={n.color} rx={4} opacity={0.85}/>
                                                                            <text x={nx + (colW-16)/2} y={ny + nh/2 + 4} textAnchor="middle" fontSize={9} fill="#fff" fontWeight={700}>{n.label}</text>
                                                                        </g>
                                                                    );
                                                                })
                                                            ))}
                                                            {/* flows col0→col2(mfg) */}
                                                            {['labor','parts','overhead'].map(sid => {
                                                                const src = skNodes.find(n => n.id === sid)!;
                                                                const tgt = skNodes.find(n => n.id === 'mfg')!;
                                                                const sx = src.col * colW + colW - 12;
                                                                const sy = colY[src.id] + nodeH(src.val)/2;
                                                                const tx = tgt.col * colW + 4;
                                                                const ty = colY[tgt.id] + nodeH(tgt.val)/2;
                                                                const sw = Math.max(2, nodeH(src.val) * 0.5);
                                                                return <path key={sid} d={`M${sx},${sy} C${(sx+tx)/2},${sy} ${(sx+tx)/2},${ty} ${tx},${ty}`} fill="none" stroke={src.color} strokeWidth={sw} opacity={0.35}/>;
                                                            })}
                                                            {/* mfg→landed, ship→landed, duty→landed */}
                                                            {['mfg','ship','duty'].map(sid => {
                                                                const src = skNodes.find(n => n.id === sid)!;
                                                                const tgt = skNodes.find(n => n.id === 'landed')!;
                                                                const sx = src.col * colW + colW - 16;
                                                                const sy = colY[src.id] + nodeH(src.val)/2;
                                                                const tx = tgt.col * colW + 4;
                                                                const ty = colY[tgt.id] + nodeH(tgt.val)/2;
                                                                const sw = Math.max(2, nodeH(src.val) * 0.45);
                                                                return <path key={sid} d={`M${sx},${sy} C${(sx+tx)/2},${sy} ${(sx+tx)/2},${ty} ${tx},${ty}`} fill="none" stroke={src.color} strokeWidth={sw} opacity={0.35}/>;
                                                            })}
                                                            {/* landed→final */}
                                                            {(() => {
                                                                const src = skNodes.find(n => n.id === 'landed')!;
                                                                const tgt = skNodes.find(n => n.id === 'final')!;
                                                                const sx = src.col * colW + colW - 16;
                                                                const sy = colY[src.id] + nodeH(src.val)/2;
                                                                const tx = tgt.col * colW + 4;
                                                                const ty = colY[tgt.id] + nodeH(tgt.val)/2;
                                                                const sw = Math.max(4, nodeH(src.val) * 0.6);
                                                                return <path d={`M${sx},${sy} C${(sx+tx)/2},${sy} ${(sx+tx)/2},${ty} ${tx},${ty}`} fill="none" stroke="#10b981" strokeWidth={sw} opacity={0.4}/>;
                                                            })()}
                                                        </g>
                                                    </svg>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* ━━━ 고급 시각화 2: Scope 1/2/3 탄소발자국 ━━━ */}
                                {activeTab === 0 && (() => {
                                    const energyKwh = (simData.partsCost / 50000) * 5.0;
                                    const scope1 = energyKwh * 0.12;
                                    const scope2 = energyKwh * 0.45;
                                    const scope3up = (simData.partsCost / 50000) * 2.8;
                                    const scope3dn = simData.totalWeight * 0.18;
                                    const scope3 = scope3up + scope3dn;
                                    const totalScope = scope1 + scope2 + scope3;
                                    const cbamCost = simData.cbamTax;
                                    const baseYear = 2024;
                                    const targetYear = 2030;
                                    const currentYear = 2026;
                                    const reductionTarget = 0.42;
                                    const progressPct = (currentYear - baseYear) / (targetYear - baseYear);
                                    const expectedNow = (1 - reductionTarget * progressPct) * 100;
                                    const scopeItems = [
                                        { label: 'Scope 1 (직접)', val: scope1, color: '#ef4444' },
                                        { label: 'Scope 2 (전기)', val: scope2, color: '#f59e0b' },
                                        { label: 'Scope 3 (공급망)', val: scope3, color: '#6366f1' },
                                    ];
                                    const DN = 80, DR = 32;
                                    let cumAngle = -Math.PI / 2;
                                    const arcs = scopeItems.map(s => {
                                        const angle = (s.val / totalScope) * 2 * Math.PI;
                                        const startA = cumAngle;
                                        cumAngle += angle;
                                        const x1 = DN/2 + DR * Math.cos(startA);
                                        const y1 = DN/2 + DR * Math.sin(startA);
                                        const x2 = DN/2 + DR * Math.cos(cumAngle);
                                        const y2 = DN/2 + DR * Math.sin(cumAngle);
                                        const largeArc = angle > Math.PI ? 1 : 0;
                                        return { ...s, d: `M${DN/2},${DN/2} L${x1},${y1} A${DR},${DR} 0 ${largeArc} 1 ${x2},${y2} Z` };
                                    });
                                    const actualPct = (totalScope / (totalScope * (1 / (1 - reductionTarget * progressPct)))) * 100;
                                    return (
                                        <div className="glass-card" style={{ background: 'white', marginBottom: '1.5rem' }}>
                                            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#475569', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem' }}>
                                                <i className="fas fa-leaf" style={{ color: '#10b981' }}></i> GHG Protocol Scope 1/2/3 탄소발자국
                                            </h3>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                                                    <svg width={DN} height={DN}>
                                                        {arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} opacity={0.85}/>)}
                                                        <circle cx={DN/2} cy={DN/2} r={DR * 0.55} fill="white"/>
                                                        <text x={DN/2} y={DN/2 - 4} textAnchor="middle" fontSize={9} fill="#475569" fontWeight={800}>{totalScope.toFixed(1)}</text>
                                                        <text x={DN/2} y={DN/2 + 8} textAnchor="middle" fontSize={7} fill="#94a3b8">kgCO₂e</text>
                                                    </svg>
                                                    {scopeItems.map((s, i) => (
                                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem' }}>
                                                            <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: s.color }}/>
                                                            <span style={{ color: '#64748b' }}>{s.label}</span>
                                                            <span style={{ fontWeight: 800, color: '#334155' }}>{s.val.toFixed(1)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>SBTi 1.5°C 감축 경로</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>목표: 2030년까지 -42% (대비 2019)</div>
                                                    <div style={{ background: '#f1f5f9', borderRadius: '8px', padding: '8px' }}>
                                                        <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '4px' }}>현재 달성 필요 수준</div>
                                                        <div style={{ fontSize: '1rem', fontWeight: 800, color: '#10b981' }}>{expectedNow.toFixed(1)}%</div>
                                                        <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>of baseline</div>
                                                    </div>
                                                    <div style={{ background: '#fef3c7', borderRadius: '8px', padding: '8px' }}>
                                                        <div style={{ fontSize: '0.65rem', color: '#92400e', marginBottom: '2px' }}>현재 배출 강도</div>
                                                        <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#b45309' }}>{totalScope.toFixed(1)} kgCO₂e/unit</div>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>CBAM 비용 영향</div>
                                                    {cbamCost > 0 ? (
                                                        <>
                                                            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '8px' }}>
                                                                <div style={{ fontSize: '0.65rem', color: '#dc2626', marginBottom: '2px' }}>EU CBAM 부담금</div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#ef4444' }}>{(cbamCost/10000).toFixed(0)}만원</div>
                                                                <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>/ 단위</div>
                                                            </div>
                                                            <div style={{ fontSize: '0.65rem', color: '#64748b' }}>탄소 감축 시 절감 가능: <span style={{ color: '#10b981', fontWeight: 700 }}>{(cbamCost * 0.42 / 10000).toFixed(0)}만원</span></div>
                                                        </>
                                                    ) : (
                                                        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '8px' }}>
                                                            <div style={{ fontSize: '0.65rem', color: '#16a34a' }}>현재 목적지는 CBAM 적용 없음</div>
                                                            <div style={{ fontSize: '0.7rem', color: '#15803d', marginTop: '4px' }}>EU 수출 시 탄소비용 발생</div>
                                                        </div>
                                                    )}
                                                    <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '8px' }}>
                                                        <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '4px' }}>Scope별 비중</div>
                                                        {scopeItems.map((s, i) => (
                                                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
                                                                <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                                                                    <div style={{ width: `${(s.val/totalScope)*100}%`, height: '100%', background: s.color, borderRadius: '3px' }}/>
                                                                </div>
                                                                <span style={{ fontSize: '0.6rem', color: '#64748b', minWidth: '28px' }}>{((s.val/totalScope)*100).toFixed(0)}%</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* ━━━ 고급 시각화 3: 규모의 경제 + BEP ━━━ */}
                                {activeTab === 0 && (() => {
                                    const [spInput, setSpInput] = React.useState(Math.round(simData.finalPrice * 1.3 / 1000) * 1000);
                                    const baseVol = simData.volume;
                                    const baseFixed = simData.toolingTotal + simData.certTotal + simData.qcCost * 0.3;
                                    const baseVar = simData.labor + simData.partsCost + simData.actualShip + simData.finalDuty + simData.vatAmount;
                                    const volMults = [0.1, 0.25, 0.5, 1, 2, 5, 10];
                                    const scalePoints = volMults.map(m => {
                                        const vol = Math.max(1, Math.round(baseVol * m));
                                        const laborEff = Math.pow(m, -0.15);
                                        const matDisc = m >= 5 ? 0.88 : m >= 2 ? 0.94 : m >= 1 ? 1 : 1.06;
                                        const unitFixed = baseFixed / vol;
                                        const unitVar = baseVar * laborEff * matDisc;
                                        const unitCost = unitFixed + unitVar;
                                        return { vol, mult: m, unitCost, unitFixed, unitVar };
                                    });
                                    const basePoint = scalePoints[3];
                                    const sp = spInput || basePoint.unitCost * 1.3;
                                    const bepVol = sp > baseVar ? Math.ceil(baseFixed / (sp - baseVar)) : 0;
                                    const GW = 480, GH = 160;
                                    const maxCost = Math.max(...scalePoints.map(p => p.unitCost)) * 1.1;
                                    const maxVolG = scalePoints[scalePoints.length-1].vol;
                                    const toX = (vol: number) => (Math.log(vol) / Math.log(maxVolG)) * GW;
                                    const toY = (cost: number) => GH - (cost / maxCost) * GH;
                                    const lineD = scalePoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.vol).toFixed(1)},${toY(p.unitCost).toFixed(1)}`).join(' ');
                                    const bepX = bepVol > 0 && bepVol < maxVolG ? toX(bepVol) : -1;
                                    const spY = sp < maxCost ? toY(sp) : -1;
                                    return (
                                        <div className="glass-card" style={{ background: 'white', marginBottom: '1.5rem' }}>
                                            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#475569', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem' }}>
                                                <i className="fas fa-chart-line" style={{ color: '#3b82f6' }}></i> 규모의 경제 &amp; 손익분기점
                                            </h3>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1.5rem', alignItems: 'start' }}>
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                                        <label style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>판매가 설정:</label>
                                                        <input type="number" value={spInput} onChange={e => setSpInput(Number(e.target.value))}
                                                            style={{ width: '100px', padding: '4px 8px', border: '1.5px solid #e2e8f0', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700 }}/>
                                                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>원</span>
                                                    </div>
                                                    <div style={{ overflowX: 'auto' }}>
                                                        <svg width={GW + 20} height={GH + 40} style={{ display: 'block' }}>
                                                            <g transform="translate(10,10)">
                                                                <line x1={0} y1={GH} x2={GW} y2={GH} stroke="#e2e8f0" strokeWidth={1}/>
                                                                <line x1={0} y1={0} x2={0} y2={GH} stroke="#e2e8f0" strokeWidth={1}/>
                                                                {[0.25, 0.5, 0.75].map(r => (
                                                                    <line key={r} x1={0} y1={toY(maxCost * r)} x2={GW} y2={toY(maxCost * r)} stroke="#f1f5f9" strokeWidth={1}/>
                                                                ))}
                                                                <path d={lineD} fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeLinejoin="round"/>
                                                                {scalePoints.map((p, i) => (
                                                                    <circle key={i} cx={toX(p.vol)} cy={toY(p.unitCost)} r={i === 3 ? 5 : 3.5} fill={i === 3 ? '#6366f1' : '#3b82f6'} stroke="white" strokeWidth={1.5}/>
                                                                ))}
                                                                {bepX > 0 && <line x1={bepX} y1={0} x2={bepX} y2={GH} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5,3"/>}
                                                                {bepX > 0 && <text x={bepX + 4} y={16} fontSize={9} fill="#ef4444" fontWeight={800}>BEP</text>}
                                                                {spY > 0 && <line x1={0} y1={spY} x2={GW} y2={spY} stroke="#10b981" strokeWidth={1.5} strokeDasharray="5,3"/>}
                                                                {spY > 0 && <text x={4} y={spY - 3} fontSize={9} fill="#10b981" fontWeight={800}>판매가</text>}
                                                                {scalePoints.map((p, i) => (
                                                                    i % 2 === 0 && <text key={i} x={toX(p.vol)} y={GH + 14} textAnchor="middle" fontSize={8} fill="#94a3b8">{p.vol >= 10000 ? (p.vol/10000).toFixed(0)+'만' : p.vol >= 1000 ? (p.vol/1000).toFixed(0)+'천' : p.vol}</text>
                                                                ))}
                                                            </g>
                                                        </svg>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '160px' }}>
                                                    <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '10px' }}>
                                                        <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '2px' }}>현재 단위원가</div>
                                                        <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#334155' }}>{(basePoint.unitCost/10000).toFixed(1)}만원</div>
                                                    </div>
                                                    <div style={{ background: bepVol > 0 ? '#fef2f2' : '#f0fdf4', borderRadius: '8px', padding: '10px', border: `1px solid ${bepVol > 0 ? '#fecaca' : '#bbf7d0'}` }}>
                                                        <div style={{ fontSize: '0.65rem', color: bepVol > 0 ? '#dc2626' : '#16a34a', marginBottom: '2px' }}>손익분기 수량</div>
                                                        <div style={{ fontSize: '0.95rem', fontWeight: 800, color: bepVol > 0 ? '#ef4444' : '#10b981' }}>
                                                            {bepVol > 0 ? `${bepVol.toLocaleString()}개` : '수익 없음'}
                                                        </div>
                                                    </div>
                                                    <div style={{ background: '#f0fdf4', borderRadius: '8px', padding: '10px' }}>
                                                        <div style={{ fontSize: '0.65rem', color: '#16a34a', marginBottom: '2px' }}>10x 규모 시 원가</div>
                                                        <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#10b981' }}>{(scalePoints[6].unitCost/10000).toFixed(1)}만원</div>
                                                        <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>({(((basePoint.unitCost - scalePoints[6].unitCost)/basePoint.unitCost)*100).toFixed(0)}% 절감)</div>
                                                    </div>
                                                    <div style={{ background: '#eff6ff', borderRadius: '8px', padding: '10px' }}>
                                                        <div style={{ fontSize: '0.65rem', color: '#3b82f6', marginBottom: '2px' }}>현재 마진율</div>
                                                        <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#3b82f6' }}>{sp > 0 ? (((sp - basePoint.unitCost)/sp)*100).toFixed(1) : '0'}%</div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                                                    <thead>
                                                        <tr style={{ background: '#f8fafc' }}>
                                                            {['배수', '수량', '단위원가', '고정비/단위', '변동비/단위', '마진율'].map(h => (
                                                                <th key={h} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#475569', borderBottom: '2px solid #e2e8f0' }}>{h}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {scalePoints.map((p, i) => (
                                                            <tr key={i} style={{ background: i === 3 ? '#eff6ff' : i % 2 === 0 ? '#f8fafc' : 'white', fontWeight: i === 3 ? 800 : 400 }}>
                                                                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#64748b' }}>{p.mult}x</td>
                                                                <td style={{ padding: '5px 8px', textAlign: 'right' }}>{p.vol.toLocaleString()}</td>
                                                                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#334155' }}>{(p.unitCost/10000).toFixed(1)}만</td>
                                                                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#6366f1' }}>{(p.unitFixed/10000).toFixed(1)}만</td>
                                                                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#3b82f6' }}>{(p.unitVar/10000).toFixed(1)}만</td>
                                                                <td style={{ padding: '5px 8px', textAlign: 'right', color: sp > p.unitCost ? '#10b981' : '#ef4444' }}>{sp > 0 ? (((sp - p.unitCost)/sp)*100).toFixed(1) : '-'}%</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Tab 1: {t.savedScenarios} 목록 */}
                                {activeTab === 1 && (
                                    <div className="glass-card" style={{ background: 'white' }}>
                                        <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1.5rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <i className="fas fa-list-ul" style={{ color: '#3b82f6' }}></i> {t.savedScenarios} 목록
                                        </h3>
                                        {scenarios.length === 0 ? (
                                            <div style={{ textAlign: 'center', padding: '4rem 2rem', color: '#94a3b8' }}>
                                                <i className="fas fa-folder-open" style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.3 }}></i>
                                                <p style={{ fontSize: '0.85rem' }}>{t.emptyScenario}<br />왼쪽 하단의 {t.saveScenario} 버튼을 눌러보세요.</p>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                {scenarios.map(s => {
                                                    const marginStr = (((s.finalPrice - s.landedCost) / (s.finalPrice || 1)) * 100).toFixed(1);
                                                    return (
                                                        <div
                                                            key={s.id}
                                                            onClick={() => loadScenario(s)}
                                                            className="scenario-list-card"
                                                            style={{
                                                                display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) auto auto 80px', alignItems: 'center',
                                                                gap: '1.5rem', padding: '1.25rem', border: '1px solid #e2e8f0', borderRadius: '1rem',
                                                                background: '#fff', cursor: 'pointer', transition: 'all 0.2s',
                                                                boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                                                            }}
                                                        >
                                                            {/* Main Info */}
                                                            <div>
                                                                <div style={{ fontWeight: 900, fontSize: '1rem', color: '#0f172a', marginBottom: '4px' }}>{s.name}</div>
                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.65rem' }}>
                                                                    <span style={{ padding: '2px 6px', background: '#f1f5f9', color: '#64748b', borderRadius: '4px', fontWeight: 800 }}>{s.assy} &rarr; {s.dest}</span>
                                                                    <span style={{ color: '#94a3b8' }}>•</span>
                                                                    <span style={{ color: '#64748b', fontWeight: 700 }}>{s.volume.toLocaleString()} units</span>
                                                                </div>
                                                            </div>

                                                            {/* Logistics & Lead Time */}
                                                            <div style={{ padding: '0 1rem', borderLeft: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>
                                                                <div style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', marginBottom: '4px' }}>Lead Time</div>
                                                                <div style={{ fontSize: '0.85rem', fontWeight: 900, color: '#1e293b' }}>{s.lt} Days</div>
                                                                <div style={{ fontSize: '0.65rem', color: '#3b82f6', fontWeight: 700, marginTop: '2px' }}>
                                                                    Log/Tax: {formatVal(s.ship + s.duty)}
                                                                </div>
                                                            </div>

                                                            {/* Financials */}
                                                            <div style={{ textAlign: 'right' }}>
                                                                <div style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', marginBottom: '4px' }}>Landed Cost & Margin</div>
                                                                <div style={{ fontWeight: 900, fontSize: '1rem', color: '#3b82f6' }}>{formatVal(Math.round(s.landedCost))}</div>
                                                                <div style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 800 }}>{marginStr}% Est. Margin</div>
                                                            </div>

                                                            {/* Action */}
                                                            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); removeScenario(s.id); }}
                                                                    style={{ background: '#fff1f2', border: '1px solid #ffe4e6', color: '#e11d48', fontSize: '0.6rem', fontWeight: 800, cursor: 'pointer', padding: '4px 8px', borderRadius: '6px' }}
                                                                >
                                                                    삭제
                                                                </button>
                                                                <div style={{ fontSize: '0.55rem', color: '#94a3b8', fontWeight: 700 }}>LOAD <i className="fas fa-chevron-right" style={{ fontSize: '0.5rem' }}></i></div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                <button
                                                    onClick={() => setActiveTab(2)}
                                                    style={{
                                                        marginTop: '1rem', padding: '1rem', background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                                        color: 'white', border: 'none', borderRadius: '1rem', fontWeight: 800, fontSize: '0.9rem',
                                                        boxShadow: '0 4px 12px rgba(59,130,246,0.3)', cursor: 'pointer'
                                                    }}
                                                >
                                                    시나리오 정밀 비교 분석 가기 &rarr;
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Tab 2: {t.scenarioCompare} 분석 */}
                                {activeTab === 2 && (
                                    <>
                                        {scenarios.length === 0 ? (
                                            <div className="glass-card" style={{ textAlign: 'center', padding: '4rem 2rem', color: '#94a3b8' }}>
                                                <i className="fas fa-chart-bar" style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.3 }}></i>
                                                <p style={{ fontSize: '0.85rem' }}>비교할 시나리오가 충분하지 않습니다.<br />먼저 최소 1개 이상의 시나리오를 저장해주세요.</p>
                                                <button onClick={() => setActiveTab(0)} style={{ marginTop: '1.5rem', padding: '0.6rem 1.2rem', borderColor: '#e2e8f0', color: '#64748b', background: 'white', border: '1px solid', borderRadius: '0.5rem', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>시뮬레이션으로 돌아가기</button>
                                            </div>
                                        ) : (
                                            scenarios.length > 0 && (() => {
                                                const maxCost = Math.max(...scenarios.map(s => s.landedCost)) * 1.05;
                                                const minCost = Math.min(...scenarios.map(s => s.landedCost));
                                                const minLt = Math.min(...scenarios.map(s => s.lt));

                                                const bestPriceScenario = scenarios.find(s => s.landedCost === minCost);
                                                const bestLtScenario = scenarios.find(s => s.lt === minLt);

                                                const sortedByRank = [...scenarios].sort((a, b) => a.landedCost - b.landedCost);
                                                const rankMap = Object.fromEntries(sortedByRank.map((s, i) => [s.id, i + 1]));

                                                // Radar Chart Helper
                                                const renderRadarPath = (s: Scenario) => {
                                                    const maxVals = {
                                                        cost: Math.max(...scenarios.map(x => x.landedCost)),
                                                        lt: Math.max(...scenarios.map(x => x.lt)),
                                                        carbon: Math.max(...scenarios.map(x => x.carbon)),
                                                        duty: Math.max(...scenarios.map(x => x.duty / (x.mfg || 1))),
                                                        vadd: Math.max(...scenarios.map(x => x.vadd / (x.mfg || 1)))
                                                    };

                                                    // Normalize (Inverse: lower is closer to edge/better)
                                                    const getScore = (val: number, max: number) => 0.2 + (0.8 * (1 - (val / (max * 1.1))));

                                                    const points = [
                                                        { angle: -Math.PI / 2, score: getScore(s.landedCost, maxVals.cost) }, // Top: Cost
                                                        { angle: -Math.PI / 2 + (2 * Math.PI / 4), score: getScore(s.lt, maxVals.lt) }, // LT
                                                        { angle: -Math.PI / 2 + (4 * Math.PI / 4), score: 0.3 + (0.7 * ((s.finalPrice - s.landedCost) / (s.finalPrice || 1))) }, // Margin
                                                        { angle: -Math.PI / 2 + (6 * Math.PI / 4), score: getScore(s.duty / (s.mfg || 1), maxVals.duty || 1) } // Duty
                                                    ];

                                                    const centerX = 50, centerY = 50, radius = 40;
                                                    return points.map((p, i) => {
                                                        const x = centerX + radius * p.score * Math.cos(p.angle);
                                                        const y = centerY + radius * p.score * Math.sin(p.angle);
                                                        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
                                                    }).join(' ') + ' Z';
                                                };

                                                return (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                                                        {/* Winner Highlights */}
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                                                            <div className="glass-card" style={{ padding: '1.25rem', borderLeft: '4px solid #10b981', background: 'rgba(16, 185, 129, 0.03)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                <div>
                                                                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#059669', marginBottom: '4px', opacity: 0.8 }}>LOWEST LANDED COST</div>
                                                                    <div style={{ fontSize: '0.85rem', fontWeight: 900, color: '#0f172a' }}>{bestPriceScenario?.name}</div>
                                                                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#10b981', marginTop: '4px' }}>{formatVal(bestPriceScenario?.landedCost || 0)}</div>
                                                                </div>
                                                                {bestPriceScenario && (
                                                                    <div style={{ display: 'flex', gap: '16px', marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid rgba(16, 185, 129, 0.15)' }}>
                                                                        <div>
                                                                            <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 700 }}>Mfg Cost</div>
                                                                            <div style={{ fontSize: '0.75rem', color: '#1e293b', fontWeight: 800 }}>{formatVal(bestPriceScenario.mfg)}</div>
                                                                        </div>
                                                                        <div>
                                                                            <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 700 }}>Logistics & Tax</div>
                                                                            <div style={{ fontSize: '0.75rem', color: '#1e293b', fontWeight: 800 }}>{formatVal(bestPriceScenario.ship + bestPriceScenario.duty + (bestPriceScenario.vat || 0))}</div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="glass-card" style={{ padding: '1.25rem', borderLeft: '4px solid #3b82f6', background: 'rgba(59, 130, 246, 0.03)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                <div>
                                                                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#2563eb', marginBottom: '4px', opacity: 0.8 }}>FASTEST DELIVERY</div>
                                                                    <div style={{ fontSize: '0.85rem', fontWeight: 900, color: '#0f172a' }}>{bestLtScenario?.name}</div>
                                                                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#3b82f6', marginTop: '4px' }}>{bestLtScenario?.lt} Days</div>
                                                                </div>
                                                                {bestLtScenario && (
                                                                    <div style={{ display: 'flex', gap: '16px', marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid rgba(59, 130, 246, 0.15)' }}>
                                                                        <div>
                                                                            <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 700 }}>Mfg Cost</div>
                                                                            <div style={{ fontSize: '0.75rem', color: '#1e293b', fontWeight: 800 }}>{formatVal(bestLtScenario.mfg)}</div>
                                                                        </div>
                                                                        <div>
                                                                            <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 700 }}>Logistics & Tax</div>
                                                                            <div style={{ fontSize: '0.75rem', color: '#1e293b', fontWeight: 800 }}>{formatVal(bestLtScenario.ship + bestLtScenario.duty + (bestLtScenario.vat || 0))}</div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="glass-card">
                                                            {/* 헤더 */}
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                                                                <div>
                                                                    <h3 style={{ fontSize: '1.1rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>시나리오별 다각도 비교</h3>
                                                                    <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px', fontWeight: 600 }}>비용, 리드타임, 탄소 배출량을 종합 시각화합니다.</p>
                                                                </div>
                                                                <div style={{ textAlign: 'right' }}>
                                                                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, display: 'block' }}>COMPARING {scenarios.length} SCENARIOS</span>
                                                                    <span style={{ fontSize: '0.65rem', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', color: '#64748b', fontWeight: 800 }}>GAP: {formatVal(Math.max(...scenarios.map(s => s.landedCost)) - minCost)}</span>
                                                                </div>
                                                            </div>

                                                            {/* 시나리오 카드 리스트 (레이아웃 변경: Grid) */}
                                                            <div style={{ display: 'grid', gridTemplateColumns: scenarios.length > 2 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', gap: '1rem', marginBottom: '3rem' }}>
                                                                {scenarios.map(s => {
                                                                    const rank = rankMap[s.id];
                                                                    const isBest = rank === 1;
                                                                    const diffFromBest = s.landedCost - minCost;
                                                                    const rvc = s.fullState?.rvc || 0;

                                                                    return (
                                                                        <div
                                                                            key={s.id}
                                                                            onClick={() => loadScenario(s)}
                                                                            className="scenario-compare-card"
                                                                            style={{
                                                                                border: isBest ? '2px solid #10b981' : '1px solid #e2e8f0',
                                                                                borderRadius: '1.25rem', padding: '1.5rem',
                                                                                background: isBest ? 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)' : '#ffffff',
                                                                                display: 'flex', flexDirection: 'column', gap: '1.25rem', position: 'relative'
                                                                            }}
                                                                        >
                                                                            {isBest && <div style={{ position: 'absolute', top: '-10px', right: '1.5rem', background: '#10b981', color: 'white', fontSize: '0.6rem', fontWeight: 900, padding: '2px 10px', borderRadius: '20px', boxShadow: '0 4px 10px rgba(16,185,129,0.3)' }}>OPTIMAL</div>}

                                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                                                <div style={{ width: 140, height: 140, position: 'relative' }}>
                                                                                    <svg viewBox="-30 -15 160 145" style={{ width: '100%', height: '100%', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.05))', overflow: 'visible' }}>
                                                                                        <circle cx="50" cy="50" r="40" fill="#f8fafc" />
                                                                                        <circle cx="50" cy="50" r="20" fill="none" stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="2,2" />
                                                                                        <path d="M 50 10 L 50 90 M 10 50 L 90 50 M 20 20 L 80 80 M 20 80 L 80 20" stroke="#e2e8f0" strokeWidth="0.5" />
                                                                                        <path d={renderRadarPath(s)} fill={isBest ? 'rgba(16, 185, 129, 0.45)' : 'rgba(59, 130, 246, 0.35)'} stroke={isBest ? '#10b981' : '#3b82f6'} strokeWidth="1.5" strokeLinejoin="round" />

                                                                                        {/* Labels & Values - High Contrast & Large Font */}
                                                                                        <text x="50" y="0" textAnchor="middle" fontSize="9" fontWeight="900" fill="#475569">COST</text>
                                                                                        <text x="50" y="8" textAnchor="middle" fontSize="8" fontWeight="800" fill="#1e293b">{formatVal(s.landedCost)}</text>
                                                                                        <text x="98" y="46" textAnchor="start" fontSize="9" fontWeight="900" fill="#475569">LT</text>
                                                                                        <text x="98" y="55" textAnchor="start" fontSize="8" fontWeight="800" fill="#1e293b">{s.lt}D</text>
                                                                                        <text x="50" y="105" textAnchor="middle" fontSize="9" fontWeight="900" fill="#475569">MARGIN</text>
                                                                                        <text x="50" y="113" textAnchor="middle" fontSize="8" fontWeight="800" fill="#10b981">{(((s.finalPrice - s.landedCost) / (s.finalPrice || 1)) * 100).toFixed(1)}%</text>
                                                                                        <text x="2" y="46" textAnchor="end" fontSize="9" fontWeight="900" fill="#475569">LOG/TAX</text>
                                                                                        <text x="2" y="55" textAnchor="end" fontSize="8" fontWeight="800" fill="#1e293b">{formatVal(s.ship + s.duty)}</text>
                                                                                    </svg>
                                                                                </div>
                                                                                <div style={{ textAlign: 'right' }}>
                                                                                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>{formatVal(s.landedCost)}</div>
                                                                                    {diffFromBest > 0 && <div style={{ fontSize: '0.65rem', color: '#f87171', fontWeight: 800 }}>+{formatVal(diffFromBest)} (+{((diffFromBest / minCost) * 100).toFixed(1)}%)</div>}
                                                                                    <div style={{ fontSize: '0.6rem', color: '#94a3b8', marginTop: '4px', fontWeight: 700 }}>EST. PRICE: {formatVal(s.finalPrice)}</div>
                                                                                </div>
                                                                            </div>

                                                                            <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                                                                                <div style={{ fontSize: '0.9rem', fontWeight: 900, color: '#1e293b', marginBottom: '4px' }}>{s.name}</div>
                                                                                <div style={{ display: 'flex', gap: '6px', fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8' }}>
                                                                                    <span style={{ padding: '2px 6px', background: '#f1f5f9', borderRadius: '4px' }}>{s.assy} &rarr; {s.dest}</span>
                                                                                    <span>•</span>
                                                                                    <span>{s.volume.toLocaleString()}ea</span>
                                                                                </div>
                                                                            </div>

                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                                    <span style={{ color: '#64748b', fontWeight: 700, fontSize: '0.65rem' }}>Mfg Cost</span>
                                                                                    <span style={{ color: '#0f172a', fontWeight: 900, fontSize: '0.75rem' }}>{formatVal(s.mfg)}</span>
                                                                                </div>
                                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                                    <span style={{ color: '#64748b', fontWeight: 700, fontSize: '0.65rem' }}>Logistics & Duty</span>
                                                                                    <span style={{ color: '#0f172a', fontWeight: 900, fontSize: '0.75rem' }}>{formatVal(s.ship + s.duty + (s.vat || 0))}</span>
                                                                                </div>
                                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                                    <span style={{ color: '#64748b', fontWeight: 700, fontSize: '0.65rem' }}>Lead Time</span>
                                                                                    <span style={{ color: '#0f172a', fontWeight: 900, fontSize: '0.75rem' }}>{s.lt} Days</span>
                                                                                </div>
                                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                                    <span style={{ color: '#64748b', fontWeight: 700, fontSize: '0.65rem' }}>Est. Margin</span>
                                                                                    <span style={{ color: '#10b981', fontWeight: 900, fontSize: '0.75rem' }}>{(((s.finalPrice - s.landedCost) / (s.finalPrice || 1)) * 100).toFixed(1)}%</span>
                                                                                </div>
                                                                            </div>

                                                                            <div style={{ marginTop: 'auto', display: 'flex', gap: '6px', paddingTop: '10px' }}>
                                                                                <button onClick={(e) => { e.stopPropagation(); removeScenario(s.id); }} style={{ flex: 1, padding: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', color: '#94a3b8', fontSize: '0.7rem', fontWeight: 800, transition: 'all 0.2s' }}>REMOVE</button>
                                                                                <button onClick={(e) => { e.stopPropagation(); loadScenario(s); }} style={{ flex: 2, padding: '10px', background: '#3b82f6', border: 'none', borderRadius: '10px', cursor: 'pointer', color: 'white', fontSize: '0.7rem', fontWeight: 800, transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(59,130,246,0.3)' }}>LOAD SCENARIO</button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>

                                                            {/* Detailed Comparison Table */}
                                                            <div style={{ marginTop: '2rem' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem' }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <div style={{ width: 12, height: 12, background: '#3b82f6', borderRadius: '3px' }}></div>
                                                                        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, color: '#1e293b' }}>SCENARIO ATTRIBUTE TABLE</h4>
                                                                    </div>
                                                                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 700 }}>* ALL COSTS IN {currency}</div>
                                                                </div>
                                                                <div style={{ overflowX: 'auto', background: 'white', borderRadius: '1.25rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
                                                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem' }}>
                                                                        <thead>
                                                                            <tr style={{ background: '#f8fafc', color: '#64748b' }}>
                                                                                <th style={{ padding: '18px 20px', fontWeight: 800, borderBottom: '1.5px solid #e2e8f0' }}>Scenario</th>
                                                                                <th style={{ padding: '18px 10px', fontWeight: 800, borderBottom: '1.5px solid #e2e8f0', textAlign: 'right' }}>Mfg Cost</th>
                                                                                <th style={{ padding: '18px 10px', fontWeight: 800, borderBottom: '1.5px solid #e2e8f0', textAlign: 'right' }}>Logistics</th>
                                                                                <th style={{ padding: '18px 10px', fontWeight: 800, borderBottom: '1.5px solid #e2e8f0', textAlign: 'right' }}>Duty/Tax</th>
                                                                                <th style={{ padding: '18px 10px', fontWeight: 800, borderBottom: '1.5px solid #e2e8f0', textAlign: 'center' }}>LT (Day)</th>
                                                                                <th style={{ padding: '18px 10px', fontWeight: 800, borderBottom: '1.5px solid #e2e8f0', textAlign: 'center' }}>FTA(RVC)</th>
                                                                                <th style={{ padding: '18px 10px', fontWeight: 800, borderBottom: '1.5px solid #e2e8f0', textAlign: 'right' }}>Target Price</th>
                                                                                <th style={{ padding: '18px 20px', fontWeight: 800, borderBottom: '1.5px solid #e2e8f0', textAlign: 'right' }}>Landed Cost</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {scenarios.map((s, idx) => (
                                                                                <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? 'white' : 'rgba(248,250,252,0.5)', fontWeight: 600, color: '#334155' }}>
                                                                                    <td style={{ padding: '16px 20px' }}>
                                                                                        <div style={{ color: '#0f172a', fontWeight: 800, fontSize: '0.85rem' }}>{s.name}</div>
                                                                                        <div style={{ fontSize: '0.6rem', color: '#94a3b8', marginTop: '2px' }}>RANK #{idx + 1}</div>
                                                                                    </td>
                                                                                    <td style={{ padding: '16px 10px', textAlign: 'right' }}>{formatVal(s.mfg)}</td>
                                                                                    <td style={{ padding: '16px 10px', textAlign: 'right' }}>{formatVal(s.ship)}</td>
                                                                                    <td style={{ padding: '16px 10px', textAlign: 'right' }}>{formatVal(s.duty + s.vat)}</td>
                                                                                    <td style={{ padding: '16px 10px', textAlign: 'center' }}>{s.lt}</td>
                                                                                    <td style={{ padding: '16px 10px', textAlign: 'center', color: (s.rvc || 0) >= 40 ? '#10b981' : '#f87171' }}>{(s.rvc || 0).toFixed(1)}%</td>
                                                                                    <td style={{ padding: '16px 10px', textAlign: 'right', fontWeight: 700 }}>{formatVal(s.finalPrice || 0)}</td>
                                                                                    <td style={{ padding: '16px 20px', textAlign: 'right', fontWeight: 900, color: s.landedCost === minCost ? '#10b981' : '#1e293b', fontSize: '0.9rem' }}>{formatVal(s.landedCost)}</td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </div>

                                                            {/* Strategic Summary */}
                                                            <div style={{ marginTop: '3rem', padding: '2rem', background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderRadius: '1.5rem', color: 'white' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                                                                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                        <i className="fas fa-lightbulb" style={{ color: '#3b82f6', fontSize: '0.9rem' }}></i>
                                                                    </div>
                                                                    <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 900 }}>STRATEGIC RECOMMENDATION</h4>
                                                                </div>
                                                                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '2rem' }}>
                                                                    <div style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.6 }}>
                                                                        현재 시뮬레이션된 {scenarios.length}개의 옵션 중, <strong style={{ color: '#fff' }}>{bestPriceScenario?.name}</strong> 시나리오가 가장 낮은 Landed Cost를 제공합니다.
                                                                        만약 리드타임이 비즈니스의 핵심 요소라면 <strong style={{ color: '#fff' }}>{bestLtScenario?.name}</strong>({bestLtScenario?.lt}일) 옵션이 전략적 우위에 있습니다.
                                                                    </div>
                                                                    <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '1rem', padding: '1rem' }}>
                                                                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#3b82f6', marginBottom: '10px' }}>PROFITABILITY FORECAST</div>
                                                                        <div style={{ fontSize: '1.2rem', fontWeight: 900 }}>{bestPriceScenario ? (((bestPriceScenario.finalPrice - bestPriceScenario.landedCost) / bestPriceScenario.finalPrice) * 100).toFixed(1) : 0}% <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>MAX MARGIN</span></div>
                                                                        <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '12px', overflow: 'hidden' }}>
                                                                            <div style={{ width: '85%', height: '100%', background: '#3b82f6' }}></div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .chart-segment {
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    cursor: pointer;
                    position: relative;
                }
                .chart-segment:hover {
                    filter: brightness(1.1);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    z-index: 10;
                }
                .chart-legend-item {
                    transition: all 0.2s;
                    cursor: pointer;
                    padding: 6px 12px;
                    border-radius: 8px;
                    border: 1px solid transparent;
                }
                .chart-legend-item:hover {
                    background: #f1f5f9;
                    border-color: #e2e8f0;
                    transform: translateY(-1px);
                }
                .scenario-list-card:hover, .scenario-compare-card:hover {
                    border-color: #3b82f6 !important;
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
                    transform: translateY(-2px);
                }
            `}</style>
            {/* ─── 저장 & 공유 모달 ─── */}
            {isSaveModalOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
                    <div className="glass-card" style={{ width: '100%', maxWidth: '480px', background: 'white', padding: '2rem', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', borderRadius: '1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <i className="fas fa-cloud-upload-alt" style={{ color: '#3b82f6' }}></i> 시뮬레이션 저장 &amp; 공유
                            </h3>
                            <button onClick={() => { setIsSaveModalOpen(false); setShowRecentList(false); setSavedShareUrl(''); }} style={{ background: 'none', border: 'none', fontSize: '1.5rem', color: '#94a3b8', cursor: 'pointer' }}>&times;</button>
                        </div>

                        {/* 탭: 저장 / 불러오기 */}
                        <div style={{ display: 'flex', gap: '4px', marginBottom: '1.5rem', background: '#f8fafc', padding: '4px', borderRadius: '0.75rem' }}>
                            {[{ label: '저장 & 공유', val: false }, { label: '불러오기', val: true }].map(tab => (
                                <button key={String(tab.val)} onClick={() => setShowRecentList(tab.val)}
                                    style={{ flex: 1, padding: '8px', borderRadius: '0.6rem', border: 'none', fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer', background: showRecentList === tab.val ? 'white' : 'transparent', color: showRecentList === tab.val ? '#3b82f6' : '#94a3b8', boxShadow: showRecentList === tab.val ? '0 2px 6px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.15s' }}
                                >{tab.label}</button>
                            ))}
                        </div>

                        {!showRecentList ? (
                            /* 저장 패널 */
                            <div>
                                {!savedShareUrl ? (
                                    <>
                                        <div style={{ marginBottom: '1rem' }}>
                                            <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '6px' }}>시뮬레이션 이름</label>
                                            <input
                                                type="text" value={saveSimName} onChange={e => setSaveSimName(e.target.value)}
                                                placeholder="예: 전자제품 KR→US 최적화 시나리오"
                                                style={{ width: '100%', padding: '0.7rem 1rem', border: '1.5px solid #e2e8f0', borderRadius: '0.75rem', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                        <div style={{ padding: '0.75rem', background: '#f8fafc', borderRadius: '0.75rem', fontSize: '0.72rem', color: '#64748b', marginBottom: '1.25rem' }}>
                                            <div>업종: <strong>{industry}</strong> · 생산지: <strong>{assy}</strong> → 목적지: <strong>{dest}</strong> · 물량: <strong>{parseInt(volumeStr).toLocaleString()}개</strong></div>
                                            <div style={{ marginTop: '4px' }}>도착가: <strong style={{ color: '#3b82f6' }}>{formatVal(simData.landedCost)}/개</strong> · 리드타임: <strong>{simData.totalLT}일</strong></div>
                                        </div>
                                        <button
                                            onClick={handleSaveSimulation}
                                            disabled={saveLoading || !saveSimName.trim()}
                                            style={{ width: '100%', padding: '0.8rem', background: saveLoading || !saveSimName.trim() ? '#e2e8f0' : 'linear-gradient(135deg,#3b82f6,#2563eb)', color: saveLoading || !saveSimName.trim() ? '#94a3b8' : 'white', border: 'none', borderRadius: '0.75rem', fontWeight: 800, fontSize: '0.9rem', cursor: saveLoading || !saveSimName.trim() ? 'not-allowed' : 'pointer' }}
                                        >
                                            {saveLoading ? <><i className="fas fa-spinner fa-spin"></i> 저장 중...</> : <><i className="fas fa-save"></i> 저장하기</>}
                                        </button>
                                    </>
                                ) : (
                                    /* 저장 완료 */
                                    <div>
                                        <div style={{ textAlign: 'center', padding: '1rem 0', marginBottom: '1rem' }}>
                                            <div style={{ width: 48, height: 48, background: '#f0fdf4', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem' }}>
                                                <i className="fas fa-check-circle" style={{ color: '#10b981', fontSize: '1.5rem' }}></i>
                                            </div>
                                            <div style={{ fontWeight: 900, color: '#0f172a', marginBottom: '4px' }}>저장 완료!</div>
                                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>30일간 유효합니다</div>
                                        </div>
                                        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <i className="fas fa-link" style={{ color: '#3b82f6', flexShrink: 0 }}></i>
                                            <span style={{ fontSize: '0.72rem', color: '#475569', wordBreak: 'break-all', flex: 1 }}>{savedShareUrl}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button onClick={handleCopyShareUrl} style={{ flex: 1, padding: '0.7rem', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: '0.75rem', fontWeight: 800, fontSize: '0.82rem', cursor: 'pointer' }}>
                                                <i className="fas fa-copy"></i> 링크 복사
                                            </button>
                                            <button onClick={() => { setSavedShareUrl(''); setSaveSimName(''); }} style={{ flex: 1, padding: '0.7rem', background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '0.75rem', fontWeight: 800, fontSize: '0.82rem', cursor: 'pointer' }}>
                                                새로 저장
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* 불러오기 패널 */
                            <div>
                                {/* 코드로 불러오기 */}
                                <div style={{ marginBottom: '1.25rem' }}>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '6px' }}>공유 코드로 불러오기</label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <input
                                            type="text" value={shareCodeInput} onChange={e => setShareCodeInput(e.target.value)}
                                            placeholder="8자리 공유 코드 입력"
                                            style={{ flex: 1, padding: '0.65rem 0.85rem', border: '1.5px solid #e2e8f0', borderRadius: '0.75rem', fontSize: '0.85rem', outline: 'none', fontFamily: 'monospace', letterSpacing: '0.05em' }}
                                            onKeyDown={e => e.key === 'Enter' && handleLoadByCode()}
                                        />
                                        <button onClick={handleLoadByCode} style={{ padding: '0.65rem 1rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '0.75rem', fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer' }}>
                                            불러오기
                                        </button>
                                    </div>
                                </div>

                                {/* 최근 저장 목록 */}
                                {recentSims.length > 0 ? (
                                    <div>
                                        <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#475569', marginBottom: '10px' }}>최근 저장 내역 (최대 5개)</div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {recentSims.map((sim, i) => (
                                                <button key={i} onClick={() => handleLoadRecent(sim)}
                                                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.75rem', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
                                                    onMouseOver={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                                                    onMouseOut={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
                                                >
                                                    <div>
                                                        <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>{sim.name}</div>
                                                        <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '2px' }}>
                                                            저장일: {new Date(sim.savedAt).toLocaleDateString('ko-KR')} · 코드: <span style={{ fontFamily: 'monospace', color: '#3b82f6' }}>{sim.shareCode}</span>
                                                        </div>
                                                    </div>
                                                    <i className="fas fa-chevron-right" style={{ color: '#94a3b8', fontSize: '0.75rem' }}></i>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.82rem' }}>
                                        <i className="fas fa-history" style={{ fontSize: '1.5rem', marginBottom: '0.5rem', display: 'block', opacity: 0.3 }}></i>
                                        아직 저장된 시뮬레이션이 없습니다.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Export Selection Modal */}
            {
                isExportModalOpen && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
                        <div className="glass-card" style={{ width: '100%', maxWidth: '500px', background: 'white', padding: '2rem', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: '#0f172a' }}>
                                    리포트 출력 설정
                                </h3>
                                <button onClick={() => setIsExportModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', color: '#94a3b8', cursor: 'pointer' }}>&times;</button>
                            </div>

                            <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                                출력할 시나리오를 선택해주세요. 선택된 항목들이 {exportType.toUpperCase()} 리포트에 포함됩니다.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '2rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '1rem', border: '1.5px solid ' + (exportSelections.includes('current') ? '#3b82f6' : '#e2e8f0'), borderRadius: '0.75rem', cursor: 'pointer', background: exportSelections.includes('current') ? '#eff6ff' : 'transparent', transition: 'all 0.2s' }}>
                                    <input
                                        type="checkbox"
                                        checked={exportSelections.includes('current')}
                                        onChange={() => setExportSelections(prev => prev.includes('current') ? prev.filter(x => x !== 'current') : [...prev, 'current'])}
                                        style={{ width: '18px', height: '18px' }}
                                    />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 800, fontSize: '0.9rem', color: exportSelections.includes('current') ? '#1e40af' : '#1e293b' }}>현재 시뮬레이션 상세</div>
                                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>BOM 상세 분석 및 원가 구조 포함</div>
                                    </div>
                                </label>

                                <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '1rem', border: '1.5px solid ' + (exportSelections.includes('comparison') ? '#3b82f6' : '#e2e8f0'), borderRadius: '0.75rem', cursor: 'pointer', background: exportSelections.includes('comparison') ? '#eff6ff' : 'transparent', transition: 'all 0.2s' }}>
                                    <input
                                        type="checkbox"
                                        checked={exportSelections.includes('comparison')}
                                        onChange={() => setExportSelections(prev => prev.includes('comparison') ? prev.filter(x => x !== 'comparison') : [...prev, 'comparison'])}
                                        style={{ width: '18px', height: '18px' }}
                                    />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 800, fontSize: '0.9rem', color: exportSelections.includes('comparison') ? '#1e40af' : '#1e293b' }}>시나리오 비교 분석</div>
                                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>선택된 모든 시나리오 데이터 간 효율성 종합 요약 비교표</div>
                                    </div>
                                </label>

                                {scenarios.map(s => (
                                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '1rem', border: '1.5px solid ' + (exportSelections.includes(s.id) ? '#3b82f6' : '#e2e8f0'), borderRadius: '0.75rem', cursor: 'pointer', background: exportSelections.includes(s.id) ? '#eff6ff' : 'transparent', transition: 'all 0.2s' }}>
                                        <input
                                            type="checkbox"
                                            checked={exportSelections.includes(s.id)}
                                            onChange={() => setExportSelections(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                                            style={{ width: '18px', height: '18px' }}
                                        />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 800, fontSize: '0.9rem', color: exportSelections.includes(s.id) ? '#1e40af' : '#1e293b' }}>{s.name}</div>
                                            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>저장된 시나리오 데이터</div>
                                        </div>
                                        <div style={{ fontWeight: 900, fontSize: '0.8rem', color: '#3b82f6' }}>{formatVal(s.landedCost)}</div>
                                    </label>
                                ))}
                            </div>

                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button className="btn-outline" style={{ flex: 1 }} onClick={() => setIsExportModalOpen(false)}>취소</button>
                                <button
                                    className="btn-primary"
                                    style={{ flex: 2, background: exportType === 'excel' ? '#059669' : '#e11d48' }}
                                    onClick={exportType === 'excel' ? exportToExcel : exportToPdf}
                                    disabled={exportSelections.length === 0}
                                >
                                    <i className={`fas fa-file-${exportType}`}></i> {exportSelections.length}개 항목 {exportType.toUpperCase()} 출력
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}

export default function SimulatorPage() {
    return (
        <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>Loading...</div>}>
            <SimulatorPageInner />
        </Suspense>
    );
}
