export default function NexyFabLoading() {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '36px', height: '36px', border: '3px solid #e5e7eb',
        borderTopColor: '#0b5cff', borderRadius: '50%',
        animation: 'nf-spin 0.7s linear infinite',
      }} />
      <style>{`@keyframes nf-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
