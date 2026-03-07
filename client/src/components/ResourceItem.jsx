import { useState } from 'react';
import { RESOURCE_TYPES, theme } from '../styles/theme.js';
import { api } from '../hooks/useApi.js';

const isImageUrl = (url) => url && url.startsWith('/uploads/') && /\.(png|jpe?g|gif|webp|svg)$/i.test(url);

function humanTitle(item) {
  if (item.description) return item.description;
  if (item.why && !item.why.startsWith('Artifact:') && !item.why.startsWith('Saved artifact:')) return item.why;
  if (!item.url) return 'Untitled';
  if (item.url.startsWith('file://')) {
    const filename = item.url.replace('file://', '').split('/').pop() || 'Unknown';
    return filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  }
  try {
    const u = new URL(item.url);
    return u.hostname.replace('www.', '');
  } catch {
    return item.url.slice(0, 50);
  }
}

function resourceIcon(item) {
  if (isImageUrl(item.url)) return '\u{1F5BC}';
  if (item.url?.startsWith('file://')) return '\u{1F4DD}';
  const rt = RESOURCE_TYPES[item.type] || RESOURCE_TYPES.link;
  return rt.icon;
}

export default function ResourceItem({ item, onRefresh, alsoIn, onNavigateToPanel, onOpenViewer }) {
  const [hovered, setHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDesc, setEditDesc] = useState(item.description || '');
  const [editWhy, setEditWhy] = useState(item.why || '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  const rt = RESOURCE_TYPES[item.type] || RESOURCE_TYPES.link;
  const isIngesting = item.status === 'ingesting' || item.status === 'pending';
  const isArtifact = item.url?.startsWith('file://');
  const isNote = item.type === 'note' && !item.url && item.content;
  const isWeb = item.url?.startsWith('http');
  const isImage = isImageUrl(item.url);
  const title = humanTitle(item);
  const why = item.why && item.description ? item.why.replace(/^(Artifact|Saved artifact): /, '') : null;
  const date = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const handleClick = () => {
    if (editing || confirmDelete) return;
    if ((isArtifact || isNote) && onOpenViewer) {
      onOpenViewer(item);
    } else if (isWeb) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    } else if (isImage) {
      setLightbox(true);
    }
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    try {
      await api.deleteResource(item.id);
      onRefresh?.();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleSave = async (e) => {
    e.stopPropagation();
    setSaving(true);
    try {
      await api.updateResource(item.id, {
        description: editDesc || null,
        why: editWhy || null,
      });
      setEditing(false);
      setShowMenu(false);
      onRefresh?.();
    } catch (err) {
      console.error('Update failed:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); if (!editing && !confirmDelete) setShowMenu(false); }}
      onClick={handleClick}
      style={{
        padding: '8px 10px',
        cursor: editing || confirmDelete ? 'default' : 'pointer',
        borderRadius: 6,
        background: hovered && !editing ? theme.bg.item : 'transparent',
        transition: 'background 0.15s',
        position: 'relative',
      }}
    >
      {/* Row 1: icon + title + date */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 14, lineHeight: '20px', flexShrink: 0, opacity: 0.7 }}>
          {resourceIcon(item)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              fontSize: 12, color: theme.text.primary, fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }}>{title}</span>
            <span style={{ fontSize: 9, color: theme.text.ghost, flexShrink: 0 }}>{date}</span>
            {/* Overflow menu trigger */}
            <span
              onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
              style={{
                fontSize: 14, color: theme.text.dim, cursor: 'pointer',
                padding: '0 2px', lineHeight: 1, flexShrink: 0,
                opacity: hovered || showMenu ? 1 : 0,
                transition: 'opacity 0.15s',
              }}
            >{'\u22EF'}</span>
          </div>

          {/* Why annotation */}
          {why && !editing && (
            <div style={{
              fontSize: 11, color: theme.accent.amber, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{why}</div>
          )}

          {/* Ingesting indicator */}
          {isIngesting && (
            <div style={{ fontSize: 10, color: theme.accent.amber, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="ib-pulse">{'\u25CF'}</span> Processing...
            </div>
          )}

          {/* Also in links */}
          {alsoIn && alsoIn.length > 0 && !editing && (
            <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, color: theme.text.ghost }}>Also in:</span>
              {alsoIn.map((n, i) => (
                <span key={n.id}>
                  <span
                    onClick={(e) => { e.stopPropagation(); onNavigateToPanel?.(n.id); }}
                    style={{
                      fontSize: 10, color: n.color || theme.accent.indigo, cursor: 'pointer',
                      textDecoration: 'none',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                    onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                  >{n.label}</span>
                  {i < alsoIn.length - 1 && <span style={{ fontSize: 9, color: theme.text.ghost, marginLeft: 2 }}>{'\u00B7'}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Overflow dropdown menu */}
      {showMenu && !editing && !confirmDelete && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', right: 10, top: 28, zIndex: 20,
            background: theme.bg.card, border: `1px solid ${theme.border.default}`,
            borderRadius: 6, padding: 4, minWidth: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          <div
            onClick={(e) => { e.stopPropagation(); setEditing(true); setShowMenu(false); }}
            style={{
              padding: '5px 10px', fontSize: 11, color: theme.text.secondary,
              cursor: 'pointer', borderRadius: 4,
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = theme.bg.hover}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >Edit</div>
          <div
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); setShowMenu(false); }}
            style={{
              padding: '5px 10px', fontSize: 11, color: theme.accent.red,
              cursor: 'pointer', borderRadius: 4,
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = theme.bg.hover}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >Delete</div>
        </div>
      )}

      {/* Edit form (inline) */}
      {editing && (
        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8, marginLeft: 22 }}>
          <div style={{ fontSize: 10, color: theme.text.dim, marginBottom: 3 }}>Description</div>
          <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)}
            rows={2} style={{
              width: '100%', background: theme.bg.deep, border: `1px solid ${theme.border.default}`,
              color: theme.text.primary, padding: '6px 8px', borderRadius: 6,
              fontSize: 11, fontFamily: 'inherit', outline: 'none', resize: 'vertical',
              boxSizing: 'border-box',
            }} />
          <div style={{ fontSize: 10, color: theme.text.dim, marginBottom: 3, marginTop: 6 }}>Why</div>
          <textarea value={editWhy} onChange={e => setEditWhy(e.target.value)}
            rows={1} style={{
              width: '100%', background: theme.bg.deep, border: `1px solid ${theme.border.default}`,
              color: theme.accent.amber, padding: '6px 8px', borderRadius: 6,
              fontSize: 11, fontFamily: 'inherit', outline: 'none', resize: 'vertical',
              boxSizing: 'border-box',
            }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={handleSave} disabled={saving} style={{
              background: theme.accent.purple, border: 'none', color: '#fff',
              padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit',
            }}>{saving ? 'Saving...' : 'Save'}</button>
            <button onClick={(e) => { e.stopPropagation(); setEditing(false); }} style={{
              background: 'none', border: `1px solid ${theme.border.default}`,
              color: theme.text.muted, padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
              fontSize: 10, fontFamily: 'inherit',
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Delete confirmation (inline) */}
      {confirmDelete && (
        <div onClick={(e) => e.stopPropagation()} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', marginTop: 6, marginLeft: 22,
          background: theme.accent.red + '11', borderRadius: 6, border: `1px solid ${theme.accent.red}33`,
        }}>
          <span style={{ fontSize: 11, color: theme.accent.red, flex: 1 }}>Delete?</span>
          <button onClick={handleDelete} style={{
            background: theme.accent.red, border: 'none', color: '#fff',
            padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit',
          }}>Delete</button>
          <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }} style={{
            background: 'none', border: `1px solid ${theme.border.default}`,
            color: theme.text.muted, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
            fontSize: 10, fontFamily: 'inherit',
          }}>Cancel</button>
        </div>
      )}

      {/* Image thumbnail for uploads */}
      {isImage && (
        <div style={{ marginTop: 6, marginLeft: 22, borderRadius: 6, overflow: 'hidden' }}>
          <img src={item.url} alt="" style={{
            width: '100%', maxHeight: 120, objectFit: 'cover', display: 'block',
            borderRadius: 6, background: '#0d0b1a',
          }} />
        </div>
      )}

      {/* Image lightbox overlay */}
      {lightbox && (
        <div
          onClick={(e) => { e.stopPropagation(); setLightbox(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.85)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <img src={item.url} alt="" style={{
            maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain',
            borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }} />
        </div>
      )}
    </div>
  );
}
