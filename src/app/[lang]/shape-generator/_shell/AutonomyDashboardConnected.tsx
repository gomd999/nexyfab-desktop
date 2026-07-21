'use client';

// AutonomyDashboardConnected — Wave A · WA-E / §GA3.
//
// The store binding for the props-injected AutonomyDashboardPanel. The panel
// stays store-free (testable in isolation, owned by the GA3 준비물 track); this
// thin wrapper subscribes to the REAL autonomySessionStore and feeds the panel
// the per-run event logs collected from actual UI actions.
//
// runs / runOrder are subscribed individually (stable references that change
// only on a store mutation) and assembled with useMemo — never returning a
// fresh array straight from a zustand selector.
//
// Honesty: with no partner session yet the store is empty, so the panel renders
// its "측정 없음(n=0)" empty state. Real zero-touch numbers appear only once
// real actions accrue (GA3).

import { useMemo } from 'react';
import { useAutonomySessionStore } from './autonomySessionStore';
import { AutonomyDashboardPanel } from './AutonomyDashboardPanel';

export function AutonomyDashboardConnected() {
  const runs = useAutonomySessionStore((s) => s.runs);
  const runOrder = useAutonomySessionStore((s) => s.runOrder);
  const logs = useMemo(() => runOrder.map((id) => runs[id]!), [runs, runOrder]);
  return <AutonomyDashboardPanel runEventLogs={logs} />;
}

export default AutonomyDashboardConnected;
