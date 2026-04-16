export default function ShapeGeneratorLoading() {
  return (
    <div style={{
      height: '100vh', background: '#0d1117', display: 'flex',
      alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px',
    }}>
      <div style={{
        width: '44px', height: '44px', border: '3px solid #1e293b',
        borderTopColor: '#0b5cff', borderRadius: '50%',
        animation: 'nf-spin 0.7s linear infinite',
      }} />
      <p style={{ color: '#94a3b8', fontSize: '14px', fontWeight: 500 }}>Loading 3D workspace...</p>
      <style>{`@keyframes nf-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
