export default function QuickQuoteLoading() {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: '16px',
    }}>
      <div style={{
        width: '36px', height: '36px', border: '3px solid #e5e7eb',
        borderTopColor: '#6366f1', borderRadius: '50%',
        animation: 'nf-spin 0.7s linear infinite',
      }} />
      <p style={{ color: '#6b7280', fontSize: '14px' }}>Loading Quick Quote...</p>
    </div>
  );
}
