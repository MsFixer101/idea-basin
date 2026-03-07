import { theme } from '../styles/theme.js';

export default function Breadcrumb({ path, onNavigate }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, flexWrap: 'wrap' }}>
      {path.map((item, i) => (
        <span key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {i > 0 && <span style={{ color: theme.text.dim, fontSize: 10 }}>\u25B8</span>}
          <span
            onClick={() => onNavigate(item.id)}
            style={{
              cursor: 'pointer',
              color: i === path.length - 1 ? theme.accent.purpleLight : theme.text.muted,
              fontWeight: i === path.length - 1 ? 600 : 400,
            }}
          >{item.label}</span>
        </span>
      ))}
    </div>
  );
}
