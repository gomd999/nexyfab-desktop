'use client';

import { useReportWebVitals } from 'next/web-vitals';
import type { WebVitalDevice } from '@/lib/webVitals';

type ReportWebVitalsCallback = Parameters<typeof useReportWebVitals>[0];

const configuredSampleRate = Number(process.env.NEXT_PUBLIC_RUM_SAMPLE_RATE ?? '0.1');
const sampleRate = Number.isFinite(configuredSampleRate)
  ? Math.min(1, Math.max(0, configuredSampleRate))
  : 0.1;

function deviceClass(): WebVitalDevice {
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth <= 1024) return 'tablet';
  return 'desktop';
}

const reportWebVital: ReportWebVitalsCallback = metric => {
  if (!['LCP', 'INP', 'CLS'].includes(metric.name) || Math.random() >= sampleRate) return;
  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    delta: metric.delta,
    rating: metric.rating,
    route: window.location.pathname,
    device: deviceClass(),
    navigationType: metric.navigationType,
  });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/observability/web-vitals/', new Blob([body], { type: 'application/json' }));
    return;
  }
  void fetch('/api/observability/web-vitals/', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
    keepalive: true,
    credentials: 'omit',
  });
};

export default function WebVitalsReporter() {
  useReportWebVitals(reportWebVital);
  return null;
}
