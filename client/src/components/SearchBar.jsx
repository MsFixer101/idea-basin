import { useState, useEffect, useRef, useCallback } from 'react';
import { theme, RESOURCE_TYPES } from '../styles/theme.js';
import { api } from '../hooks/useApi.js';

export default function SearchBar({ onNavigate }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    if (!showResults) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showResults]);

  const close = useCallback(() => {
    setQuery('');
    setResults([]);
    setLoading(false);
    setShowResults(false);
    inputRef.current?.blur();
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleInput = useCallback((e) => {
    const q = e.target.value;
    setQuery(q);
    setShowResults(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.search(q);
        setResults(res.slice(0, 8));
      } catch (err) {
        console.error('Search failed:', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }, [close]);

  const handleResultClick = useCallback((nodeId) => {
    onNavigate(nodeId);
    close();
  }, [onNavigate, close]);

  return (
    <div ref={containerRef} style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: theme.bg.input,
        border: `1px solid ${theme.border.default}`,
        borderRadius: 6,
        padding: '0 8px',
        gap: 6,
        width: 280,
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={theme.text.muted} strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
          <circle cx="10.5" cy="10.5" r="7" />
          <line x1="15.5" y1="15.5" x2="21" y2="21" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (query.trim()) setShowResults(true); }}
          placeholder="Search knowledge base…"
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: theme.text.primary,
            fontFamily: theme.font,
            fontSize: 12,
            padding: '6px 0',
          }}
        />
        {loading && (
          <div style={{
            width: 12, height: 12, flexShrink: 0,
            border: `2px solid ${theme.border.default}`,
            borderTopColor: theme.accent.purple,
            borderRadius: '50%',
            animation: 'searchSpin 0.6s linear infinite',
          }} />
        )}
        {!loading && (
          <span style={{ fontSize: 9, color: theme.text.dim, flexShrink: 0, letterSpacing: '0.5px' }}>⌘K</span>
        )}
      </div>

      {/* Inline keyframes for spinner */}
      <style>{`@keyframes searchSpin { to { transform: rotate(360deg); } }`}</style>

      {/* Results dropdown */}
      {showResults && query.trim() && !loading && results.length === 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: theme.bg.card, border: `1px solid ${theme.border.default}`,
          borderRadius: 8, padding: '12px 14px',
          color: theme.text.dim, fontSize: 11, textAlign: 'center',
          zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          No results found
        </div>
      )}

      {showResults && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          width: 360, maxHeight: 400, overflowY: 'auto',
          background: theme.bg.card, border: `1px solid ${theme.border.default}`,
          borderRadius: 8, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {results.map((r, i) => {
            const typeMeta = RESOURCE_TYPES[r.type] || RESOURCE_TYPES.note;
            const similarity = r.similarity != null ? Math.round(r.similarity * 100) : null;
            const snippet = (r.content || '').slice(0, 120).replace(/\n/g, ' ');

            return (
              <div
                key={`${r.node_id}-${r.resource_id}-${i}`}
                onClick={() => r.node_id && handleResultClick(r.node_id)}
                style={{
                  padding: '10px 14px',
                  cursor: r.node_id ? 'pointer' : 'default',
                  borderBottom: i < results.length - 1 ? `1px solid ${theme.border.subtle}` : 'none',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = theme.bg.hover}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {/* Node label row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: r.node_color || theme.accent.indigo, flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 11, color: theme.text.secondary, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.node_label || 'Unknown'}
                  </span>
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 4,
                    background: typeMeta.color + '22', color: typeMeta.color,
                    flexShrink: 0,
                  }}>
                    {typeMeta.label}
                  </span>
                  {similarity != null && (
                    <span style={{ fontSize: 9, color: theme.text.dim, flexShrink: 0 }}>
                      {similarity}%
                    </span>
                  )}
                </div>
                {/* Content snippet */}
                <div style={{
                  fontSize: 11, color: theme.text.muted, lineHeight: 1.4,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {snippet || r.resource_description || '(no content)'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
