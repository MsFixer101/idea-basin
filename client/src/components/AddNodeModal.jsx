import { useState } from 'react';
import { NODE_COLORS, theme } from '../styles/theme.js';

export default function AddNodeModal({ parentLabel, onAdd, onClose }) {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#c084fc');

  const handleSubmit = () => {
    if (label.trim()) {
      onAdd({ label: label.trim(), color });
      onClose();
    }
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)',
      backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
        borderRadius: 14, padding: 28, width: 360, maxWidth: '90vw',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#f1f5f9' }}>
          New Node in {parentLabel}
        </div>
        <input autoFocus type="text" placeholder="Name..." value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          style={{
            width: '100%', background: theme.bg.card, border: `1px solid ${theme.border.default}`,
            borderRadius: 8, padding: '10px 12px', color: theme.text.primary, fontSize: 13,
            fontFamily: 'inherit', outline: 'none', marginBottom: 12, boxSizing: 'border-box',
          }} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {NODE_COLORS.map(c => (
            <div key={c} onClick={() => setColor(c)} style={{
              width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer',
              border: color === c ? '3px solid #fff' : '3px solid transparent',
            }} />
          ))}
        </div>
        <button onClick={handleSubmit} disabled={!label.trim()} style={{
          width: '100%',
          background: label.trim() ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : '#1a1040',
          border: 'none', color: label.trim() ? '#fff' : theme.text.dim,
          padding: '10px', borderRadius: 8, cursor: label.trim() ? 'pointer' : 'default',
          fontSize: 12, fontFamily: 'inherit', fontWeight: 600,
        }}>Create</button>
      </div>
    </div>
  );
}
