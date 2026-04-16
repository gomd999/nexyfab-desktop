export default function PartnerLoading() {
  return (
    <div style={{
      maxWidth: '1100px', margin: '0 auto', padding: '100px 24px 40px',
    }}>
      {/* Header skeleton */}
      <div style={{ width: '200px', height: '24px', background: '#f3f4f6', borderRadius: '6px', marginBottom: '28px' }} />
      {/* Cards skeleton */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '32px' }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ height: '110px', background: '#f9fafb', borderRadius: '12px', border: '1px solid #f3f4f6' }} />
        ))}
      </div>
      {/* List skeleton */}
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          height: '64px', background: '#f9fafb', borderRadius: '10px',
          border: '1px solid #f3f4f6', marginBottom: '10px',
        }} />
      ))}
      <style>{`
        div[style] { animation: nf-pulse 1.5s ease-in-out infinite; }
        @keyframes nf-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}
