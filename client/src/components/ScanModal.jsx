import { useState, useEffect } from 'react';
import { theme } from '../styles/theme.js';
import { api } from '../hooks/useApi.js';
import cryptoManager from '../services/crypto-manager.js';
import GroupSuggestions from './GroupSuggestions.jsx';

export default function ScanModal({ onClose }) {
  const [dirPath, setDirPath] = useState('');
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [ingesting, setIngesting] = useState(false);
  const [ingestResults, setIngestResults] = useState(null);
  const [providerInfo, setProviderInfo] = useState(null);
  const [groupSuggestions, setGroupSuggestions] = useState({}); // { nodeId: { groups, cross_refs, selected, applying } }
  const [suggestingNodes, setSuggestingNodes] = useState(new Set());

  // Provider → crypto-manager key ID mapping
  const PROVIDER_KEY_MAP = {
    claude: 'anthropic', openai: 'openai', deepseek: 'deepseek',
    kimi: 'kimi', gemini: 'gemini', grok: 'grok', qwen: 'qwen',
  };

  // Load config to know which provider is active
  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.getConfig();
        // Support both old (providers.scan) and new (features.scan.provider) format
        if (cfg.features) {
          setProviderInfo({
            scan: cfg.features.scan?.provider,
            tagging: cfg.features.tagging?.provider,
          });
        } else {
          setProviderInfo(cfg.providers || {});
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const getApiKeyHeader = async () => {
    if (!providerInfo) return {};
    // Check scan and tagging providers for API key needs
    const providers = [providerInfo.scan, providerInfo.tagging].filter(Boolean);
    for (const p of providers) {
      const keyId = PROVIDER_KEY_MAP[p];
      if (keyId) {
        const key = await cryptoManager.getAPIKey(keyId);
        if (key) return { 'x-api-key': key };
      }
    }
    return {};
  };

  const handleScan = async () => {
    if (!dirPath.trim()) return;
    setScanning(true);
    setResults(null);
    setSelected(new Set());
    try {
      const extraHeaders = await getApiKeyHeader();
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: JSON.stringify({ path: dirPath.trim(), max_depth: 4 }),
      });
      const data = await res.json();
      setResults(data);
      // Pre-select all suggestions
      if (data.suggestions) {
        setSelected(new Set(data.suggestions.map((_, i) => i)));
      }
    } catch (err) {
      console.error('Scan failed:', err);
    } finally {
      setScanning(false);
    }
  };

  const handleIngest = async () => {
    if (!results?.suggestions) return;
    const items = results.suggestions
      .filter((_, i) => selected.has(i))
      .map(s => ({ path: s.path, node_id: s.node_id }));
    if (items.length === 0) return;

    setIngesting(true);
    try {
      const extraHeaders = await getApiKeyHeader();
      const res = await fetch('/api/scan/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      setIngestResults(data);

      // Check which nodes received 3+ files → auto-suggest groups
      const nodeCounts = {};
      for (const item of items) {
        nodeCounts[item.node_id] = (nodeCounts[item.node_id] || 0) + 1;
      }
      // Also include node labels from suggestions
      const nodeLabels = {};
      for (const s of results.suggestions) {
        if (s.node_id && s.node_label) nodeLabels[s.node_id] = s.node_label;
      }

      const eligibleNodes = Object.entries(nodeCounts)
        .filter(([, count]) => count >= 3)
        .map(([nodeId]) => nodeId);

      if (eligibleNodes.length > 0) {
        // Suggest groups for each eligible node (sequentially to avoid overloading)
        for (const nodeId of eligibleNodes) {
          setSuggestingNodes(prev => new Set([...prev, nodeId]));
          try {
            const groupData = await api.suggestGroups(nodeId);
            if (groupData.groups?.length > 0) {
              setGroupSuggestions(prev => ({
                ...prev,
                [nodeId]: {
                  label: nodeLabels[nodeId] || nodeId,
                  groups: groupData.groups,
                  cross_refs: groupData.cross_refs || [],
                  selected: groupData.groups.map(() => true),
                  applying: false,
                },
              }));
            }
          } catch (err) {
            console.error(`Failed to suggest groups for node ${nodeId}:`, err);
          } finally {
            setSuggestingNodes(prev => {
              const next = new Set(prev);
              next.delete(nodeId);
              return next;
            });
          }
        }
      }
    } catch (err) {
      console.error('Ingest failed:', err);
    } finally {
      setIngesting(false);
    }
  };

  const toggleSelect = (idx) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (!results?.suggestions) return;
    if (selected.size === results.suggestions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.suggestions.map((_, i) => i)));
    }
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
        borderRadius: 14, padding: window.innerWidth < 640 ? 16 : 24,
        width: 600, maxWidth: '95vw', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#f1f5f9' }}>
          Scan Local Files
        </div>

        {/* Provider badge */}
        {providerInfo && (
          <div style={{
            fontSize: 9, color: theme.text.dim, marginBottom: 10,
            display: 'flex', gap: 8,
          }}>
            <span style={{
              background: theme.bg.card, border: `1px solid ${theme.border.subtle}`,
              padding: '2px 6px', borderRadius: 4,
            }}>
              scan: {providerInfo.scan || 'embedded'}
            </span>
            <span style={{
              background: theme.bg.card, border: `1px solid ${theme.border.subtle}`,
              padding: '2px 6px', borderRadius: 4,
            }}>
              embed: {providerInfo.embedding || 'embedded'}
            </span>
            <span style={{
              background: theme.bg.card, border: `1px solid ${theme.border.subtle}`,
              padding: '2px 6px', borderRadius: 4,
            }}>
              tag: {providerInfo.tagging || 'disabled'}
            </span>
          </div>
        )}

        {/* Directory input */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            type="text" value={dirPath} onChange={e => setDirPath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleScan()}
            placeholder="/path/to/directory"
            style={{
              flex: 1, background: theme.bg.deep, border: `1px solid ${theme.border.default}`,
              borderRadius: 6, padding: '8px 10px', color: theme.text.primary,
              fontSize: 12, fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button onClick={handleScan} disabled={scanning || !dirPath.trim()} style={{
            background: scanning ? '#1a1040' : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
            border: 'none', color: scanning ? theme.text.dim : '#fff',
            padding: '8px 16px', borderRadius: 6, cursor: scanning ? 'default' : 'pointer',
            fontSize: 12, fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
        </div>

        {/* Quick paths */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            { label: 'Home', path: `/Users/${process.env.USER || 'you'}` },
            { label: 'Documents', path: `/Users/${process.env.USER || 'you'}/Documents` },
            { label: 'Desktop', path: `/Users/${process.env.USER || 'you'}/Desktop` },
            { label: 'Downloads', path: `/Users/${process.env.USER || 'you'}/Downloads` },
          ].map(q => (
            <button key={q.path} onClick={() => setDirPath(q.path)} style={{
              background: dirPath === q.path ? theme.bg.hover : 'transparent',
              border: `1px solid ${dirPath === q.path ? theme.accent.purple : theme.border.subtle}`,
              color: dirPath === q.path ? theme.accent.purpleLight : theme.text.dim,
              padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit',
            }}>{q.label}</button>
          ))}
        </div>

        {/* Scanning indicator */}
        {scanning && (
          <div style={{ textAlign: 'center', padding: 30, color: theme.accent.amber }}>
            <div className="ib-pulse" style={{ fontSize: 14, marginBottom: 8 }}>●</div>
            <div style={{ fontSize: 12 }}>AI is scanning and classifying files...</div>
            <div style={{ fontSize: 10, color: theme.text.dim, marginTop: 4 }}>This may take a moment</div>
          </div>
        )}

        {/* Results */}
        {results && !scanning && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: theme.text.secondary }}>
                Scanned {results.total_scanned} files — {results.suggestions?.length || 0} matched to nodes
              </div>
              {results.suggestions?.length > 0 && (
                <button onClick={toggleAll} style={{
                  background: 'none', border: 'none', color: theme.accent.indigo,
                  fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  {selected.size === results.suggestions.length ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 14 }}>
              {(results.suggestions || []).map((s, i) => (
                <div key={i} onClick={() => toggleSelect(i)} style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px',
                  background: selected.has(i) ? '#1a1540' : 'transparent',
                  borderRadius: 6, cursor: 'pointer', marginBottom: 4,
                  border: `1px solid ${selected.has(i) ? theme.border.default : 'transparent'}`,
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
                    background: selected.has(i) ? theme.accent.purple : 'transparent',
                    border: `2px solid ${selected.has(i) ? theme.accent.purple : theme.border.default}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 11, fontWeight: 700,
                  }}>
                    {selected.has(i) ? '\u2713' : ''}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: theme.text.primary, wordBreak: 'break-all' }}>
                      {s.name}
                    </div>
                    <div style={{ fontSize: 9, color: theme.text.dim, marginTop: 2, wordBreak: 'break-all' }}>
                      {s.path}
                    </div>
                    <div style={{ fontSize: 10, color: theme.accent.amber, marginTop: 3 }}>
                      {s.reason}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 9, color: theme.accent.purpleLight, background: theme.bg.card,
                    padding: '2px 8px', borderRadius: 4, flexShrink: 0, whiteSpace: 'nowrap',
                  }}>
                    {'\u2192'} {s.node_label}
                  </div>
                </div>
              ))}

              {results.suggestions?.length === 0 && (
                <div style={{ textAlign: 'center', padding: 20, color: theme.text.dim, fontSize: 12 }}>
                  No files matched any nodes. Try a different directory.
                </div>
              )}
            </div>

            {/* Ingest results */}
            {ingestResults && (
              <div style={{
                background: '#0f2a0f', border: '1px solid #22c55e33', borderRadius: 8,
                padding: '8px 12px', marginBottom: 10, fontSize: 11, color: theme.accent.green,
              }}>
                Ingested {ingestResults.results?.filter(r => r.status === 'ready').length || 0} files successfully
              </div>
            )}

            {/* Post-ingest grouping suggestions */}
            {suggestingNodes.size > 0 && (
              <div style={{
                textAlign: 'center', padding: 12, color: theme.accent.cyan,
                fontSize: 11, marginBottom: 10,
              }}>
                <span className="ib-pulse" style={{ marginRight: 6 }}>●</span>
                Analyzing for sub-basin grouping...
              </div>
            )}

            {Object.entries(groupSuggestions).map(([nodeId, data]) => (
              <div key={nodeId} style={{ marginBottom: 12 }}>
                <div style={{
                  fontSize: 11, color: theme.accent.amber, marginBottom: 6, fontWeight: 600,
                }}>
                  Group resources in "{data.label}"
                </div>
                <GroupSuggestions
                  groups={data.groups}
                  crossRefs={data.cross_refs}
                  selected={data.selected}
                  onToggle={(i) => setGroupSuggestions(prev => {
                    const next = { ...prev };
                    const sel = [...next[nodeId].selected];
                    sel[i] = !sel[i];
                    next[nodeId] = { ...next[nodeId], selected: sel };
                    return next;
                  })}
                  onApply={async () => {
                    const approved = data.groups.filter((_, i) => data.selected[i]);
                    if (approved.length === 0) return;
                    const approvedLabels = new Set(approved.map(g => g.label));
                    const approvedRefs = (data.cross_refs || []).filter(
                      ref => approvedLabels.has(ref.from) && approvedLabels.has(ref.to)
                    );
                    setGroupSuggestions(prev => ({
                      ...prev,
                      [nodeId]: { ...prev[nodeId], applying: true },
                    }));
                    try {
                      await api.applyGroups(nodeId, { groups: approved, cross_refs: approvedRefs });
                      setGroupSuggestions(prev => {
                        const next = { ...prev };
                        delete next[nodeId];
                        return next;
                      });
                    } catch (err) {
                      console.error('Failed to apply groups:', err);
                      setGroupSuggestions(prev => ({
                        ...prev,
                        [nodeId]: { ...prev[nodeId], applying: false },
                      }));
                    }
                  }}
                  onCancel={() => setGroupSuggestions(prev => {
                    const next = { ...prev };
                    delete next[nodeId];
                    return next;
                  })}
                  applying={data.applying}
                />
              </div>
            ))}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{
                flex: 1, background: 'transparent', border: `1px solid ${theme.border.default}`,
                color: theme.text.muted, padding: '8px', borderRadius: 6, cursor: 'pointer',
                fontSize: 11, fontFamily: 'inherit',
              }}>Close</button>
              <button onClick={handleIngest} disabled={selected.size === 0 || ingesting} style={{
                flex: 1,
                background: selected.size > 0 && !ingesting ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : '#1a1040',
                border: 'none',
                color: selected.size > 0 && !ingesting ? '#fff' : theme.text.dim,
                padding: '8px', borderRadius: 6,
                cursor: selected.size > 0 && !ingesting ? 'pointer' : 'default',
                fontSize: 11, fontFamily: 'inherit', fontWeight: 600,
              }}>
                {ingesting ? 'Ingesting...' : `Pour ${selected.size} files in`}
              </button>
            </div>
          </div>
        )}

        {/* No results yet */}
        {!results && !scanning && (
          <div style={{ textAlign: 'center', padding: 30, color: theme.text.dim }}>
            <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.2 }}>{'\u{1F50D}'}</div>
            <div style={{ fontSize: 12 }}>Pick a directory and hit Scan</div>
            <div style={{ fontSize: 10, marginTop: 4, opacity: 0.6 }}>
              AI reads your files and suggests which basin to file them in
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
