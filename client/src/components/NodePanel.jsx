import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { NODE_COLORS, theme } from '../styles/theme.js';
import { useMobile } from '../hooks/useMobile.js';
import ResourceItem from './ResourceItem.jsx';
import AddResource from './AddResource.jsx';
import GroupSuggestions from './GroupSuggestions.jsx';
import { api } from '../hooks/useApi.js';
import { renderMarkdown, markdownStyles } from '../utils/markdown.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

const ARTIFACT_TYPE_BADGES = {
  '.md': { label: 'MD', color: '#22d3ee' },
  '.html': { label: 'HTML', color: '#f97316' },
  '.txt': { label: 'TXT', color: '#94a3b8' },
};

const ROOT_NODE_ID = '00000000-0000-0000-0000-000000000001';
const SCRAP_NODE_ID = '00000000-0000-0000-0000-000000000050';

// ── ArtifactViewer modal ──────────────────────────────────────────────

const VIEWER_STYLES = markdownStyles('viewer-md', { fontSize: '13px', lineHeight: '1.7' });

const READING_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const CODE_FONT = "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";

function buildPopoutHTML(content, filename, mode) {
  const mdStyles = markdownStyles('viewer-md', { fontSize: '15px', lineHeight: '1.8' });
  const rendered = mode === 'rendered' ? renderMarkdown(content) : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${filename}</title>
<style>
  body { margin: 0; padding: 40px 48px; background: #0d0819; color: #e2e8f0;
    font-family: ${READING_FONT}; max-width: 720px; }
  ${mdStyles}
  .viewer-md code, .viewer-md pre { font-family: ${CODE_FONT}; }
  .markup { font-family: ${CODE_FONT}; font-size: 13px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word; color: #94a3b8; }
</style></head>
<body>${mode === 'rendered'
    ? `<div class="viewer-md">${rendered}</div>`
    : `<pre class="markup">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`
  }</body></html>`;
}

function ArtifactViewer({ item, onClose }) {
  const [mode, setMode] = useState('rendered');
  const [copied, setCopied] = useState(false);

  const isNote = item.type === 'note' && !item.url;
  const path = item.url?.replace('file://', '') || '';
  const filename = isNote ? (item.description?.substring(0, 60) || 'Note') : (path.split('/').pop() || 'Unknown');
  const ext = isNote ? '.md' : (filename.includes('.') ? '.' + filename.split('.').pop() : '.md');
  const badge = isNote ? { label: 'NOTE', color: '#a78bfa' } : (ARTIFACT_TYPE_BADGES[ext] || ARTIFACT_TYPE_BADGES['.txt']);
  const content = item.content || item.raw_content || '';

  useEffect(() => {
    if (ext !== '.md') setMode('markup');
  }, [ext]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleOpen = () => {
    if (path) {
      fetch('/api/open', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
    }
  };

  const handlePopout = () => {
    const html = buildPopoutHTML(content, filename, mode);
    if (window.ideaBasin?.popout) {
      window.ideaBasin.popout(html, filename);
    } else {
      const w = window.open('', '_blank', 'width=800,height=900');
      if (w) { w.document.write(html); w.document.close(); }
    }
    onClose();
  };

  const pillStyle = (active) => ({
    background: active ? theme.bg.card : 'transparent',
    border: `1px solid ${active ? theme.border.default : 'transparent'}`,
    color: active ? theme.text.secondary : theme.text.ghost,
    padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
    fontSize: 10, fontFamily: theme.font, fontWeight: 600,
  });

  const btnStyle = {
    background: 'none', border: `1px solid ${theme.border.subtle}`,
    color: theme.text.dim, padding: '3px 8px', borderRadius: 4,
    cursor: 'pointer', fontSize: 10, fontFamily: theme.font,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <style>{VIEWER_STYLES}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          margin: 16, borderRadius: 10, overflow: 'hidden',
          background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
        }}
      >
        {/* Header — title row */}
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px 0', background: theme.bg.deep,
        }}>
          <button onClick={handlePopout} style={{
            ...btnStyle, padding: '2px 6px', fontSize: 9,
          }} title="Pop out to new window"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="5" width="10" height="10" rx="1.5"/><path d="M5 5V2.5A1.5 1.5 0 016.5 1H13.5A1.5 1.5 0 0115 2.5V9.5A1.5 1.5 0 0113.5 11H11"/></svg></button>
          <span style={{
            color: theme.text.primary, fontWeight: 600, fontSize: 12, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{filename}</span>
          <span style={{
            background: badge.color + '22', color: badge.color,
            padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700,
          }}>{badge.label}</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: theme.text.muted,
            cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1,
          }}>{'\u2715'}</button>
        </div>

        {/* Header — action row */}
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 14px 10px', background: theme.bg.deep,
          borderBottom: `1px solid ${theme.border.subtle}`,
        }}>
          <div style={{ display: 'flex', gap: 0 }}>
            <button onClick={() => setMode('rendered')} style={pillStyle(mode === 'rendered')}>Rendered</button>
            <button onClick={() => setMode('markup')} style={pillStyle(mode === 'markup')}>Markup</button>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={handleCopy} style={{
            ...btnStyle, color: copied ? theme.accent.green : theme.text.dim,
          }}>{copied ? 'Copied' : 'Copy'}</button>
          {path && !isNote && <button onClick={handleOpen} style={btnStyle}>Open</button>}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {mode === 'rendered' ? (
            <div
              className="viewer-md"
              style={{ color: theme.text.primary }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          ) : (
            <pre style={{
              color: theme.text.secondary, fontFamily: theme.font,
              fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', margin: 0,
            }}>{content}</pre>
          )}
        </div>

        {/* Footer */}
        <div style={{
          flexShrink: 0, padding: '6px 14px',
          borderTop: `1px solid ${theme.border.subtle}`,
          fontSize: 9, color: theme.text.ghost,
        }}>{isNote ? `Note · ${new Date(item.created_at).toLocaleString()}` : path}</div>
      </div>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────

function SectionHeader({ children, count }) {
  return (
    <div style={{
      fontSize: 10, color: theme.text.dim, fontWeight: 600,
      letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8,
    }}>
      {children}{count != null && ` (${count})`}
    </div>
  );
}

// ── NodePanel ──────────────────────────────────────────────────────────

export default function NodePanel({ node, resources, crossRefs, alsoInMap, onAddResource, onAddChildNode, onCreateCrossRef, onDeleteCrossRef, onRefresh, onDelete, onMerge, onNavigate, onNavigateToPanel, siblings, externalShowAdd, onExternalShowAddConsumed }) {
  const [showAdd, setShowAdd] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showAddChild, setShowAddChild] = useState(false);
  const [childLabel, setChildLabel] = useState('');
  const [childColor, setChildColor] = useState('#c084fc');
  const fileInputRef = useRef(null);
  const mobile = useMobile();
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedGroups, setSuggestedGroups] = useState(null);
  const [suggestedCrossRefs, setSuggestedCrossRefs] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [applying, setApplying] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [showAddCrossRef, setShowAddCrossRef] = useState(false);
  const [crossRefTargetId, setCrossRefTargetId] = useState('');
  const [crossRefReason, setCrossRefReason] = useState('');
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const [viewerItem, setViewerItem] = useState(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [basinSearch, setBasinSearch] = useState('');
  const [basinSearchResults, setBasinSearchResults] = useState(null);
  const [recentResources, setRecentResources] = useState([]);
  const actionsMenuRef = useRef(null);
  const searchTimerRef = useRef(null);

  useEffect(() => {
    if (externalShowAdd) {
      setShowAdd(true);
      onExternalShowAddConsumed?.();
    }
  }, [externalShowAdd, onExternalShowAddConsumed]);

  const isScrapNode = node?.id === SCRAP_NODE_ID;

  // Load recent resources for scrap node
  useEffect(() => {
    if (!isScrapNode) { setRecentResources([]); return; }
    (async () => {
      try {
        const recent = await api.getRecent(10);
        setRecentResources(recent);
      } catch (err) {
        console.error('Failed to load recent:', err);
      }
    })();
  }, [isScrapNode]);

  // Basin-scoped search with debounce
  useEffect(() => {
    if (!basinSearch.trim() || !node) {
      setBasinSearchResults(null);
      return;
    }
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await api.search(basinSearch, node.id);
        setBasinSearchResults(results);
      } catch (err) {
        console.error('Basin search failed:', err);
        setBasinSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(searchTimerRef.current);
  }, [basinSearch, node]);

  // Close actions menu on outside click
  useEffect(() => {
    if (!showActionsMenu) return;
    const handler = (e) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target)) {
        setShowActionsMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showActionsMenu]);

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      if (IMAGE_TYPES.includes(file.type)) {
        const base64 = await fileToBase64(file);
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, data: base64, node_id: node.id }),
        });
        const result = await res.json();
        if (result.ok) {
          await onAddResource({
            node_id: node.id,
            url: result.url,
            type: 'link',
            why: `Uploaded: ${file.name}`,
          });
        }
      }
    }
    e.target.value = '';
  };

  if (!node) return null;

  const handleAdd = async (data) => {
    await onAddResource({ ...data, node_id: node.id });
    setShowAdd(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragging(false);

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (IMAGE_TYPES.includes(file.type)) {
        const base64 = await fileToBase64(file);
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, data: base64, node_id: node.id }),
        });
        const result = await res.json();
        if (result.ok) {
          await onAddResource({
            node_id: node.id,
            url: result.url,
            type: 'link',
            why: `Dropped image: ${file.name}`,
          });
        }
      } else {
        const path = file.path || file.name;
        if (path && path.startsWith('/')) {
          await onAddResource({
            node_id: node.id,
            url: `file://${path}`,
            type: 'research',
            why: `Dropped: ${file.name}`,
          });
        }
      }
    }
  };

  const handlePaste = async (e) => {
    const text = e.clipboardData?.getData('text/plain')?.trim();
    if (!text) return;
    const paths = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('/') || l.startsWith('~/'));
    if (paths.length === 0) return;
    e.preventDefault();
    for (const p of paths) {
      try {
        await api.importFilePath(p, node.id);
      } catch (err) {
        console.error('Import failed:', p, err);
      }
    }
    if (onRefresh) onRefresh();
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleSuggestGroups = async () => {
    setSuggesting(true);
    setSuggestedGroups(null);
    try {
      const data = await api.suggestGroups(node.id);
      setSuggestedGroups(data.groups || []);
      setSuggestedCrossRefs(data.cross_refs || []);
      setSelectedGroups((data.groups || []).map(() => true));
    } catch (err) {
      console.error('Failed to suggest groups:', err);
    } finally {
      setSuggesting(false);
    }
  };

  const handleApplyGroups = async () => {
    if (!suggestedGroups) return;
    const approved = suggestedGroups.filter((_, i) => selectedGroups[i]);
    if (approved.length === 0) return;

    const approvedLabels = new Set(approved.map(g => g.label));
    const approvedRefs = suggestedCrossRefs.filter(
      ref => approvedLabels.has(ref.from) && approvedLabels.has(ref.to)
    );

    setApplying(true);
    try {
      await api.applyGroups(node.id, { groups: approved, cross_refs: approvedRefs });
      setSuggestedGroups(null);
      setSuggestedCrossRefs([]);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to apply groups:', err);
    } finally {
      setApplying(false);
    }
  };

  const resourceCount = resources.length;
  const childCount = node.child_count || 0;
  const connectionCount = crossRefs?.length || 0;

  return (
    <>
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onPaste={handlePaste}
      style={{
        width: '100%', maxWidth: 360, padding: '16px 14px',
        outline: dragging ? `2px dashed ${theme.accent.purple}` : 'none',
        outlineOffset: -2,
        borderRadius: 8,
      }}
    >
      {/* ═══════════════════════ ZONE 1: Identity ═══════════════════════ */}
      <div style={{ marginBottom: 16 }}>
        {/* Header: color dot + label + actions menu */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{
            width: 12, height: 12, borderRadius: '50%', background: node.color || '#818cf8',
            boxShadow: `0 0 10px ${node.color || '#818cf8'}33`, flexShrink: 0,
          }} />
          {editingLabel ? (
            <input
              autoFocus
              value={labelDraft}
              onChange={e => setLabelDraft(e.target.value)}
              onKeyDown={async e => {
                if (e.key === 'Enter' && labelDraft.trim()) {
                  setEditingLabel(false);
                  await api.updateNode(node.id, { label: labelDraft.trim() });
                  if (onRefresh) onRefresh();
                }
                if (e.key === 'Escape') setEditingLabel(false);
              }}
              onBlur={async () => {
                if (labelDraft.trim() && labelDraft.trim() !== node.label) {
                  await api.updateNode(node.id, { label: labelDraft.trim() });
                  if (onRefresh) onRefresh();
                }
                setEditingLabel(false);
              }}
              style={{
                flex: 1, fontSize: 15, fontWeight: 700, color: '#f1f5f9',
                background: theme.bg.card, border: `1px solid ${theme.border.active}`,
                borderRadius: 6, padding: '4px 8px', fontFamily: 'inherit', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          ) : (
            <span
              onClick={() => { setLabelDraft(node.label); setEditingLabel(true); }}
              style={{
                flex: 1, fontSize: 15, fontWeight: 700, color: '#f1f5f9', cursor: 'pointer',
                borderBottom: '1px dashed transparent',
              }}
              onMouseEnter={e => e.currentTarget.style.borderBottomColor = theme.border.default}
              onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'transparent'}
              title="Click to rename"
            >
              {node.label}
            </span>
          )}
          {node.private && <span title="Private node" style={{ fontSize: 12, flexShrink: 0 }}>🔒</span>}
          {/* Actions menu button */}
          <div ref={actionsMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setShowActionsMenu(!showActionsMenu)}
              style={{
                background: showActionsMenu ? theme.bg.card : 'none',
                border: `1px solid ${showActionsMenu ? theme.border.default : 'transparent'}`,
                color: theme.text.muted, cursor: 'pointer', fontSize: 16,
                padding: '2px 6px', borderRadius: 4, lineHeight: 1, fontFamily: 'inherit',
              }}
            >{'\u22EF'}</button>
            {showActionsMenu && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 30,
                background: theme.bg.card, border: `1px solid ${theme.border.default}`,
                borderRadius: 6, padding: 4, minWidth: 140,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}>
                <div
                  onClick={() => { setShowAddChild(true); setShowActionsMenu(false); }}
                  style={{ padding: '6px 10px', fontSize: 11, color: theme.text.secondary, cursor: 'pointer', borderRadius: 4 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = theme.bg.hover}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >Add sub-basin</div>
                <div
                  onClick={() => { setShowAdd(true); setShowActionsMenu(false); }}
                  style={{ padding: '6px 10px', fontSize: 11, color: theme.text.secondary, cursor: 'pointer', borderRadius: 4 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = theme.bg.hover}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >Add resource</div>
                <div
                  onClick={() => { fileInputRef.current?.click(); setShowActionsMenu(false); }}
                  style={{ padding: '6px 10px', fontSize: 11, color: theme.text.secondary, cursor: 'pointer', borderRadius: 4 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = theme.bg.hover}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >Upload image</div>
                <div
                  onClick={async () => {
                    setShowActionsMenu(false);
                    await api.updateNode(node.id, { private: !node.private });
                    if (onRefresh) onRefresh();
                  }}
                  style={{ padding: '6px 10px', fontSize: 11, color: node.private ? '#fbbf24' : theme.text.secondary, cursor: 'pointer', borderRadius: 4 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = theme.bg.hover}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >{node.private ? '🔓 Make public' : '🔒 Make private'}</div>
                {node.parent_id && node.parent_id !== ROOT_NODE_ID && (
                  <div
                    onClick={async () => {
                      setShowActionsMenu(false);
                      await api.updateNode(node.id, { parent_id: ROOT_NODE_ID });
                      if (onRefresh) onRefresh();
                    }}
                    style={{ padding: '6px 10px', fontSize: 11, color: theme.text.secondary, cursor: 'pointer', borderRadius: 4 }}
                    onMouseEnter={(e) => e.currentTarget.style.background = theme.bg.hover}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >Move to root level</div>
                )}
                {resources.length >= 3 && !suggestedGroups && (
                  <div
                    onClick={() => { handleSuggestGroups(); setShowActionsMenu(false); }}
                    style={{ padding: '6px 10px', fontSize: 11, color: theme.accent.cyan, cursor: 'pointer', borderRadius: 4 }}
                    onMouseEnter={(e) => e.currentTarget.style.background = theme.bg.hover}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >Suggest groups</div>
                )}
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple
            onChange={handleFileUpload} style={{ display: 'none' }} />
        </div>

        {/* Description immediately below */}
        {node.description && (
          <div style={{ fontSize: 12, color: theme.text.secondary, lineHeight: '18px', marginBottom: 4, paddingLeft: 22 }}>
            {node.description}
          </div>
        )}

        {/* Why */}
        {node.why && (
          <div style={{
            fontSize: 11, color: theme.accent.amber, marginBottom: 4, paddingLeft: 22,
          }}>{node.why}</div>
        )}

        {/* Stats */}
        <div style={{ display: 'flex', gap: 8, fontSize: 10, color: theme.text.muted, paddingLeft: 22 }}>
          <span>{resourceCount} resource{resourceCount !== 1 ? 's' : ''}</span>
          <span style={{ color: theme.text.ghost }}>{'\u00B7'}</span>
          <span>{childCount} sub-basin{childCount !== 1 ? 's' : ''}</span>
          <span style={{ color: theme.text.ghost }}>{'\u00B7'}</span>
          <span>{connectionCount} connection{connectionCount !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Basin-scoped search */}
      <div style={{ marginBottom: 14 }}>
        <input
          type="text"
          placeholder="Search this basin..."
          value={basinSearch}
          onChange={e => setBasinSearch(e.target.value)}
          style={{
            width: '100%', background: theme.bg.deep, border: `1px solid ${theme.border.subtle}`,
            borderRadius: 6, padding: '6px 10px', color: theme.text.primary, fontSize: 11,
            fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
          }}
          onFocus={e => e.currentTarget.style.borderColor = theme.border.default}
          onBlur={e => { if (!basinSearch) e.currentTarget.style.borderColor = theme.border.subtle; }}
        />
        {basinSearchResults && basinSearchResults.length > 0 && (
          <div style={{
            marginTop: 4, background: theme.bg.item, borderRadius: 6,
            border: `1px solid ${theme.border.subtle}`, maxHeight: 160, overflowY: 'auto',
          }}>
            {basinSearchResults.map((r, i) => (
              <div key={i} style={{
                padding: '6px 10px', fontSize: 11, color: theme.text.secondary,
                borderBottom: i < basinSearchResults.length - 1 ? `1px solid ${theme.border.subtle}` : 'none',
                cursor: 'pointer',
              }}
                onMouseEnter={e => e.currentTarget.style.background = theme.bg.hover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => {
                  // If result has a resource, try to open it
                  const url = r.url;
                  if (url?.startsWith('file://')) {
                    const matchItem = resources.find(res => res.url === url);
                    if (matchItem) setViewerItem(matchItem);
                  } else if (url?.startsWith('http')) {
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }
                }}
              >
                <div style={{ fontWeight: 500 }}>{r.resource_description || r.content?.slice(0, 80) || r.url}</div>
                {r.similarity && (
                  <span style={{ fontSize: 9, color: theme.text.ghost }}>{Math.round(r.similarity * 100)}% match</span>
                )}
              </div>
            ))}
          </div>
        )}
        {basinSearchResults && basinSearchResults.length === 0 && basinSearch.trim() && (
          <div style={{ marginTop: 4, fontSize: 10, color: theme.text.dim, textAlign: 'center', padding: 8 }}>
            No results
          </div>
        )}
      </div>

      {/* Add sub-basin (shown when triggered from actions menu) */}
      {showAddChild && (
        <div style={{
          background: '#1a1540', borderRadius: 8, padding: 12, marginBottom: 14,
          border: `1px solid ${theme.border.default}`,
        }}>
          <input autoFocus={!mobile} type="text" placeholder="Sub-basin name..." value={childLabel}
            onChange={e => setChildLabel(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && childLabel.trim() && onAddChildNode) {
                onAddChildNode({ parent_id: node.id, label: childLabel.trim(), color: childColor });
                setChildLabel(''); setShowAddChild(false);
              }
              if (e.key === 'Escape') { setShowAddChild(false); setChildLabel(''); }
            }}
            style={{
              width: '100%', background: theme.bg.card, border: `1px solid ${theme.border.default}`,
              borderRadius: 6, padding: '8px 10px', color: theme.text.primary, fontSize: 12,
              fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box',
            }} />
          <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
            {NODE_COLORS.map(c => (
              <div key={c} onClick={() => setChildColor(c)} style={{
                width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer',
                border: childColor === c ? '2px solid #fff' : '2px solid transparent',
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => {
              if (childLabel.trim() && onAddChildNode) {
                onAddChildNode({ parent_id: node.id, label: childLabel.trim(), color: childColor });
                setChildLabel(''); setShowAddChild(false);
              }
            }} disabled={!childLabel.trim()} style={{
              flex: 1, background: childLabel.trim() ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : '#1a1040',
              border: 'none', color: childLabel.trim() ? '#fff' : theme.text.dim,
              padding: '7px', borderRadius: 6, cursor: childLabel.trim() ? 'pointer' : 'default',
              fontSize: 11, fontFamily: 'inherit', fontWeight: 600,
            }}>Create</button>
            <button onClick={() => { setShowAddChild(false); setChildLabel(''); }} style={{
              background: 'none', border: `1px solid ${theme.border.default}`,
              color: theme.text.muted, padding: '7px 12px', borderRadius: 6,
              cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Suggesting spinner */}
      {suggesting && (
        <div style={{
          fontSize: 11, color: theme.text.dim, textAlign: 'center',
          padding: '12px', marginBottom: 14,
        }}>Analyzing resources...</div>
      )}

      {/* Group suggestions */}
      {suggestedGroups && suggestedGroups.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <GroupSuggestions
            groups={suggestedGroups}
            crossRefs={suggestedCrossRefs}
            selected={selectedGroups}
            onToggle={(i) => setSelectedGroups(prev => {
              const next = [...prev];
              next[i] = !next[i];
              return next;
            })}
            onApply={handleApplyGroups}
            onCancel={() => { setSuggestedGroups(null); setSuggestedCrossRefs([]); }}
            applying={applying}
          />
        </div>
      )}

      {suggestedGroups && suggestedGroups.length === 0 && (
        <div style={{
          marginBottom: 14, fontSize: 11, color: theme.text.dim, textAlign: 'center',
          padding: '10px', background: theme.bg.item, borderRadius: 6,
        }}>
          No meaningful groups found.{' '}
          <span onClick={() => setSuggestedGroups(null)} style={{
            color: theme.accent.cyan, cursor: 'pointer',
          }}>Dismiss</span>
        </div>
      )}

      {/* Add resource form */}
      {showAdd && (
        <div style={{ marginBottom: 14 }}>
          <AddResource onAdd={handleAdd} onCancel={() => setShowAdd(false)} />
        </div>
      )}

      {/* Drop zone hint when dragging */}
      {dragging && (
        <div style={{
          background: '#1a1540', border: '2px dashed #7c3aed', borderRadius: 10,
          padding: 20, textAlign: 'center', marginBottom: 12,
          color: theme.accent.purpleLight, fontSize: 12,
        }}>
          Drop files or images here
        </div>
      )}

      {/* ═══════════════════════ ZONE 2: Connections ═══════════════════════ */}
      <div style={{ marginBottom: 16 }}>
        <SectionHeader count={connectionCount}>Connections</SectionHeader>

        {crossRefs && crossRefs.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {crossRefs.map(ref => {
              const isSource = ref.source_node_id === node.id;
              const linkedLabel = isSource ? ref.target_label : ref.source_label;
              const linkedColor = isSource ? ref.target_color : ref.source_color;
              const linkedId = isSource ? ref.target_node_id : ref.source_node_id;
              const sharedTags = ref.shared_tag_count || 0;
              const sharedRes = ref.shared_resource_count || 0;
              const metricsStr = [
                sharedTags > 0 ? `${sharedTags} shared tag${sharedTags > 1 ? 's' : ''}` : null,
                sharedRes > 0 ? `${sharedRes} shared` : null,
              ].filter(Boolean).join(' \u00B7 ');

              return (
                <div key={ref.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', marginBottom: 4, borderRadius: 6,
                  background: theme.bg.item,
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: linkedColor || '#818cf8',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                      onClick={() => (onNavigateToPanel || onNavigate)?.(linkedId)}
                      style={{
                        fontSize: 12, color: theme.text.secondary, cursor: 'pointer',
                        display: 'block',
                      }}
                      title={`Open ${linkedLabel}`}
                    >
                      {linkedLabel}
                    </span>
                    {(metricsStr || ref.reason) && (
                      <div style={{ fontSize: 9, color: theme.text.dim, marginTop: 1 }}>
                        {metricsStr}{metricsStr && ref.reason ? ' \u00B7 ' : ''}{ref.reason || ''}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onDeleteCrossRef && onDeleteCrossRef(ref.id)}
                    style={{
                      background: 'none', border: 'none', color: theme.text.ghost,
                      cursor: 'pointer', fontSize: 12, padding: '0 4px', lineHeight: 1,
                      flexShrink: 0,
                    }}
                    title="Remove cross-reference"
                  >{'\u2715'}</button>
                </div>
              );
            })}
          </div>
        )}

        {showAddCrossRef ? (
          <div style={{
            background: '#1a1540', borderRadius: 8, padding: 12, marginBottom: 8,
            border: `1px solid ${theme.border.default}`,
          }}>
            <select
              value={crossRefTargetId}
              onChange={e => setCrossRefTargetId(e.target.value)}
              style={{
                width: '100%', background: theme.bg.card, border: `1px solid ${theme.border.default}`,
                borderRadius: 6, padding: '8px 10px', color: theme.text.primary, fontSize: 12,
                fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box',
              }}
            >
              <option value="">Select node to link...</option>
              {(siblings || []).filter(s => s.id !== node.id).map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <input
              type="text" placeholder="Reason (optional)..."
              value={crossRefReason}
              onChange={e => setCrossRefReason(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && crossRefTargetId && onCreateCrossRef) {
                  onCreateCrossRef({ target_node_id: crossRefTargetId, reason: crossRefReason || undefined });
                  setCrossRefTargetId(''); setCrossRefReason(''); setShowAddCrossRef(false);
                }
                if (e.key === 'Escape') { setShowAddCrossRef(false); setCrossRefTargetId(''); setCrossRefReason(''); }
              }}
              style={{
                width: '100%', background: theme.bg.card, border: `1px solid ${theme.border.default}`,
                borderRadius: 6, padding: '8px 10px', color: theme.text.primary, fontSize: 12,
                fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => {
                  if (crossRefTargetId && onCreateCrossRef) {
                    onCreateCrossRef({ target_node_id: crossRefTargetId, reason: crossRefReason || undefined });
                    setCrossRefTargetId(''); setCrossRefReason(''); setShowAddCrossRef(false);
                  }
                }}
                disabled={!crossRefTargetId}
                style={{
                  flex: 1, background: crossRefTargetId ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : '#1a1040',
                  border: 'none', color: crossRefTargetId ? '#fff' : theme.text.dim,
                  padding: '7px', borderRadius: 6, cursor: crossRefTargetId ? 'pointer' : 'default',
                  fontSize: 11, fontFamily: 'inherit', fontWeight: 600,
                }}
              >Link</button>
              <button onClick={() => { setShowAddCrossRef(false); setCrossRefTargetId(''); setCrossRefReason(''); }} style={{
                background: 'none', border: `1px solid ${theme.border.default}`,
                color: theme.text.muted, padding: '7px 12px', borderRadius: 6,
                cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
              }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAddCrossRef(true)} style={{
            width: '100%', background: 'transparent', border: `1px dashed ${theme.border.default}`,
            color: theme.text.dim, padding: '6px', borderRadius: 6, cursor: 'pointer',
            fontSize: 10, fontFamily: 'inherit',
          }}>+ Add cross-reference</button>
        )}
      </div>

      {/* ═══════════════════════ ZONE 3: Content ═══════════════════════ */}
      <div style={{ marginBottom: 16 }}>
        <SectionHeader count={resourceCount}>Content</SectionHeader>

        {/* Recent resources section for scrap/Idea Basin node */}
        {isScrapNode && recentResources.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: theme.accent.amber, fontWeight: 600, marginBottom: 6 }}>
              Recent across all basins
            </div>
            {recentResources.map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 8px', borderRadius: 4, cursor: 'pointer',
                fontSize: 11,
              }}
                onMouseEnter={e => e.currentTarget.style.background = theme.bg.item}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => {
                  if (r.url?.startsWith('file://') && r.content) {
                    setViewerItem(r);
                  } else if (r.url?.startsWith('http')) {
                    window.open(r.url, '_blank', 'noopener,noreferrer');
                  } else if (r.node_id) {
                    onNavigateToPanel?.(r.node_id);
                  }
                }}
              >
                <span style={{ fontSize: 12, opacity: 0.6 }}>
                  {r.url?.startsWith('file://') ? '\u{1F4DD}' : '\u{1F517}'}
                </span>
                <span style={{ flex: 1, color: theme.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.description || r.why || r.url?.split('/').pop() || 'Untitled'}
                </span>
                {r.node_label && (
                  <span style={{
                    fontSize: 9, color: r.node_color || theme.text.dim,
                    padding: '1px 5px', borderRadius: 3,
                    background: (r.node_color || '#818cf8') + '15',
                    flexShrink: 0,
                  }}>{r.node_label}</span>
                )}
              </div>
            ))}
            <div style={{ borderBottom: `1px solid ${theme.border.subtle}`, marginTop: 8, marginBottom: 8 }} />
          </div>
        )}

        {/* Unified resource list — all types in one list */}
        {resources.length > 0 ? (
          resources.map(item => (
            <ResourceItem
              key={item.id}
              item={item}
              onRefresh={onRefresh}
              alsoIn={alsoInMap?.[item.id]}
              onNavigateToPanel={onNavigateToPanel}
              onOpenViewer={setViewerItem}
            />
          ))
        ) : (
          <div style={{
            fontSize: 11, color: theme.text.dim, textAlign: 'center', padding: 16,
          }}>No resources yet</div>
        )}
      </div>

      {/* ═══════════════════════ ZONE 4: Manage (collapsed) ═══════════════════════ */}
      <div style={{
        borderTop: `1px solid ${theme.border.subtle}`, paddingTop: 12,
      }}>
        <button
          onClick={() => setShowManage(!showManage)}
          style={{
            width: '100%', background: 'transparent', border: 'none',
            color: theme.text.ghost, cursor: 'pointer', fontSize: 10,
            fontFamily: 'inherit', textAlign: 'left', padding: '4px 0',
          }}
        >{showManage ? '\u25BE' : '\u25B8'} Manage</button>

        {showManage && (
          <div style={{ marginTop: 8 }}>
            {/* Merge */}
            {showMerge ? (
              <div style={{
                background: '#1a1540', borderRadius: 8, padding: 12, marginBottom: 8,
                border: `1px solid ${theme.border.default}`,
              }}>
                <div style={{ fontSize: 11, color: theme.text.secondary, marginBottom: 8 }}>
                  Merge into another basin (moves all children & resources):
                </div>
                <select
                  value={mergeTargetId}
                  onChange={e => setMergeTargetId(e.target.value)}
                  style={{
                    width: '100%', background: theme.bg.card, border: `1px solid ${theme.border.default}`,
                    borderRadius: 6, padding: '8px 10px', color: theme.text.primary, fontSize: 12,
                    fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box',
                  }}
                >
                  <option value="">Select target...</option>
                  {(siblings || []).filter(s => s.id !== node.id).map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => { if (mergeTargetId && onMerge) { onMerge(node.id, mergeTargetId); setShowMerge(false); setMergeTargetId(''); } }}
                    disabled={!mergeTargetId}
                    style={{
                      flex: 1, background: mergeTargetId ? '#7c3aed' : '#1a1040',
                      border: 'none', color: mergeTargetId ? '#fff' : theme.text.dim,
                      padding: '7px', borderRadius: 6, cursor: mergeTargetId ? 'pointer' : 'default',
                      fontSize: 11, fontFamily: 'inherit', fontWeight: 600,
                    }}
                  >Merge</button>
                  <button onClick={() => { setShowMerge(false); setMergeTargetId(''); }} style={{
                    background: 'none', border: `1px solid ${theme.border.default}`,
                    color: theme.text.muted, padding: '7px 12px', borderRadius: 6,
                    cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
                  }}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowMerge(true)} style={{
                width: '100%', background: '#1a1540', border: `1px solid ${theme.border.default}`,
                color: theme.accent.indigo, padding: '8px', borderRadius: 8, cursor: 'pointer',
                fontSize: 11, fontFamily: 'inherit', marginBottom: 8,
              }}>Merge into...</button>
            )}

            {/* Private indicator */}
            {node.private && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 0', marginBottom: 4, fontSize: 11, color: '#fbbf24',
              }}>
                🔒 Private — hidden from AI chat, search, WhatsApp & briefing
              </div>
            )}

            {/* Delete */}
            {confirmDelete ? (
              <div style={{
                background: '#1a0f0f', borderRadius: 8, padding: 12,
                border: '1px solid #7f1d1d',
              }}>
                <div style={{ fontSize: 11, color: '#fca5a5', marginBottom: 8 }}>
                  Delete "{node.label}"? Children and resources will be moved to the parent basin.
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { if (onDelete) onDelete(node.id); setConfirmDelete(false); }} style={{
                    flex: 1, background: '#991b1b', border: 'none', color: '#fff',
                    padding: '7px', borderRadius: 6, cursor: 'pointer',
                    fontSize: 11, fontFamily: 'inherit', fontWeight: 600,
                  }}>Delete</button>
                  <button onClick={() => setConfirmDelete(false)} style={{
                    background: 'none', border: '1px solid #7f1d1d',
                    color: '#fca5a5', padding: '7px 12px', borderRadius: 6,
                    cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
                  }}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} style={{
                width: '100%', background: 'transparent', border: `1px solid #7f1d1d44`,
                color: '#ef4444', padding: '8px', borderRadius: 8, cursor: 'pointer',
                fontSize: 11, fontFamily: 'inherit',
              }}>Delete basin</button>
            )}
          </div>
        )}
      </div>
    </div>
    {viewerItem && createPortal(
      <ArtifactViewer item={viewerItem} onClose={() => setViewerItem(null)} />,
      document.body
    )}
    </>
  );
}

function fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  });
}
