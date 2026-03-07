import { theme } from '../styles/theme.js';

export default function ConfirmMoveModal({ sourceLabel, targetLabel, onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)',
      backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 100,
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
        borderRadius: 14, padding: 28, width: 360, maxWidth: '90vw',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#f1f5f9' }}>
          Move Basin
        </div>
        <div style={{ fontSize: 13, color: theme.text.secondary, lineHeight: '20px', marginBottom: 20 }}>
          Move <strong style={{ color: '#f1f5f9' }}>{sourceLabel}</strong> under{' '}
          <strong style={{ color: '#f1f5f9' }}>{targetLabel}</strong>?
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onConfirm} style={{
            flex: 1, background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
            border: 'none', color: '#fff', padding: '10px', borderRadius: 8,
            cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600,
          }}>Move</button>
          <button onClick={onCancel} style={{
            flex: 1, background: 'none', border: `1px solid ${theme.border.default}`,
            color: theme.text.muted, padding: '10px', borderRadius: 8,
            cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
