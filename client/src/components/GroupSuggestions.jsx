import { theme } from '../styles/theme.js';

export default function GroupSuggestions({ groups, crossRefs, selected, onToggle, onApply, onCancel, applying }) {
  const selectedCount = selected.filter(Boolean).length;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 10, color: theme.accent.cyan, marginBottom: 8, fontWeight: 600,
        letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        Suggested Sub-basins
      </div>

      {groups.map((group, i) => (
        <div key={i} onClick={() => onToggle(i)} style={{
          background: selected[i] ? '#0f1a2a' : theme.bg.item,
          border: `1px solid ${selected[i] ? '#22d3ee44' : theme.border.subtle}`,
          borderRadius: 8, padding: '10px 12px', marginBottom: 6, cursor: 'pointer',
          transition: 'border-color 0.15s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              background: selected[i] ? theme.accent.cyan : 'transparent',
              border: `2px solid ${selected[i] ? theme.accent.cyan : theme.border.default}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#000', fontSize: 10, fontWeight: 700,
            }}>
              {selected[i] ? '\u2713' : ''}
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>
              {group.label}
            </span>
            <span style={{
              fontSize: 9, color: theme.text.dim, marginLeft: 'auto',
            }}>
              {group.resource_ids.length} items
            </span>
          </div>
          {group.description && (
            <div style={{ fontSize: 10, color: theme.text.secondary, marginTop: 4, marginLeft: 24 }}>
              {group.description}
            </div>
          )}
          <div style={{ marginTop: 6, marginLeft: 24, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(group.resources || []).map(r => (
              <span key={r.id} style={{
                fontSize: 9, color: theme.text.muted, background: theme.bg.card,
                padding: '1px 6px', borderRadius: 3, maxWidth: 160,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {r.name}
              </span>
            ))}
          </div>
        </div>
      ))}

      {/* Cross-references preview */}
      {crossRefs && crossRefs.length > 0 && selectedCount >= 2 && (
        <div style={{
          fontSize: 10, color: theme.text.dim, marginTop: 8, marginBottom: 8,
          padding: '6px 10px', background: theme.bg.item, borderRadius: 6,
          border: `1px solid ${theme.border.subtle}`,
        }}>
          <span style={{ color: theme.accent.amber, fontWeight: 600 }}>Links:</span>{' '}
          {crossRefs.map((ref, i) => (
            <span key={i}>
              {ref.from} <span style={{ color: theme.text.ghost }}>{'\u2194'}</span> {ref.to}
              {i < crossRefs.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button onClick={onApply} disabled={selectedCount === 0 || applying} style={{
          flex: 1,
          background: selectedCount > 0 && !applying
            ? 'linear-gradient(135deg, #0891b2, #06b6d4)' : '#1a1040',
          border: 'none',
          color: selectedCount > 0 && !applying ? '#fff' : theme.text.dim,
          padding: '8px', borderRadius: 6,
          cursor: selectedCount > 0 && !applying ? 'pointer' : 'default',
          fontSize: 11, fontFamily: 'inherit', fontWeight: 600,
        }}>
          {applying ? 'Creating...' : `Create ${selectedCount} sub-basin${selectedCount !== 1 ? 's' : ''}`}
        </button>
        <button onClick={onCancel} style={{
          background: 'none', border: `1px solid ${theme.border.default}`,
          color: theme.text.muted, padding: '8px 12px', borderRadius: 6,
          cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
        }}>Cancel</button>
      </div>
    </div>
  );
}
