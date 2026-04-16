export default function DashboardLoading() {
  return (
    <div style={{
      maxWidth: '1100px', margin: '0 auto', padding: '100px 24px 40px',
    }}>
      {/* Header skeleton */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '28px' }}>
        <div>
          <div style={{ width: '220px', height: '28px', background: '#f3f4f6', borderRadius: '8px', marginBottom: '8px' }} />
          <div style={{ width: '140px', height: '16px', background: '#f3f4f6', borderRadius: '6px' }} />
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ width: '150px', height: '44px', background: '#f3f4f6', borderRadius: '12px' }} />
          <div style={{ width: '100px', height: '44px', background: '#f3f4f6', borderRadius: '12px' }} />
        </div>
      </div>
      {/* Stat cards skeleton */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '36px' }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ height: '100px', background: '#f9fafb', borderRadius: '16px', border: '1px solid #f3f4f6' }} />
        ))}
      </div>
      {/* Project cards skeleton */}
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          height: '120px', background: '#f9fafb', borderRadius: '16px',
          border: '1px solid #f3f4f6', marginBottom: '12px',
        }} />
      ))}
      <style>{`
        div[style] { animation: nf-pulse 1.5s ease-in-out infinite; }
        @keyframes nf-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}
