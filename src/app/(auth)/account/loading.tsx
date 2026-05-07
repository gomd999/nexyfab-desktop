export default function AccountLoading() {
  return (
    <div style={{
      maxWidth: '700px', margin: '0 auto', padding: '100px 24px 40px',
    }}>
      {/* Profile header skeleton */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
        <div style={{ width: '64px', height: '64px', background: '#f3f4f6', borderRadius: '50%' }} />
        <div>
          <div style={{ width: '160px', height: '20px', background: '#f3f4f6', borderRadius: '6px', marginBottom: '8px' }} />
          <div style={{ width: '200px', height: '14px', background: '#f3f4f6', borderRadius: '6px' }} />
        </div>
      </div>
      {/* Form fields skeleton */}
      {[1, 2, 3].map(i => (
        <div key={i} style={{ marginBottom: '20px' }}>
          <div style={{ width: '80px', height: '12px', background: '#f3f4f6', borderRadius: '4px', marginBottom: '8px' }} />
          <div style={{ width: '100%', height: '44px', background: '#f9fafb', borderRadius: '8px', border: '1px solid #f3f4f6' }} />
        </div>
      ))}
    </div>
  );
}
