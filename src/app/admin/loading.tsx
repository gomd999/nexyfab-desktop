export default function AdminLoading() {
  return (
    <div style={{
      maxWidth: '1100px', margin: '0 auto', padding: '100px 24px 40px',
    }}>
      {/* Header skeleton */}
      <div style={{ width: '180px', height: '24px', background: '#f3f4f6', borderRadius: '6px', marginBottom: '28px' }} />
      {/* Stat row skeleton */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '32px' }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: '90px', background: '#f9fafb', borderRadius: '12px', border: '1px solid #f3f4f6' }} />
        ))}
      </div>
      {/* Table skeleton */}
      {[1, 2, 3, 4].map(i => (
        <div key={i} style={{
          height: '52px', background: '#f9fafb', borderRadius: '8px',
          border: '1px solid #f3f4f6', marginBottom: '8px',
        }} />
      ))}
    </div>
  );
}
