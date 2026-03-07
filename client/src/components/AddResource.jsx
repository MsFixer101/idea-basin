import { useState } from 'react';
import { RESOURCE_TYPES, theme, detectType } from '../styles/theme.js';
import { useMobile } from '../hooks/useMobile.js';

const MODES = [
  { key: 'url', label: '\u{1F517} URL' },
  { key: 'file', label: '\u{1F4C1} File Path' },
  { key: 'note', label: '\u{1F4A1} Note / Idea' },
];

function detectFileType(path) {
  if (!path) return 'link';
  const ext = path.split('.').pop().toLowerCase();
  if (['py', 'js', 'ts', 'jsx', 'tsx', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb', 'sh', 'sql', 'json', 'yaml', 'yml', 'toml'].includes(ext)) return 'code';
  if (['md', 'txt', 'rtf', 'doc', 'docx', 'pdf'].includes(ext)) return 'research';
  if (['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'link';
  return 'link';
}

export default function AddResource({ onAdd, onCancel }) {
  const mobile = useMobile();
  const [mode, setMode] = useState('url');
  const [url, setUrl] = useState('');
  const [filePath, setFilePath] = useState('');
  const [why, setWhy] = useState('');
  const [type, setType] = useState('auto');
  const [noteText, setNoteText] = useState('');

  const handleSubmit = () => {
    if (mode === 'note' && noteText.trim()) {
      onAdd({ url: null, why: null, type: 'note', content: noteText.trim() });
    } else if (mode === 'file' && filePath.trim()) {
      const resolvedType = type === 'auto' ? detectFileType(filePath) : type;
      onAdd({
        url: `file://${filePath.trim()}`,
        why: why.trim() || null,
        type: resolvedType,
        is_local: true,
      });
    } else if (mode === 'url' && url.trim()) {
      // If the text doesn't look like a URL, treat it as a note instead
      const text = url.trim();
      const looksLikeUrl = /^(https?:\/\/|file:\/\/|www\.)/.test(text) || /\.\w{2,}(\/|$)/.test(text);
      if (!looksLikeUrl) {
        onAdd({ url: null, why: null, type: 'research', content: text, description: text.slice(0, 120) });
      } else {
        onAdd({
          url: text,
          why: why.trim() || null,
          type: type === 'auto' ? detectType(text) : type,
        });
      }
    }
  };

  const canSubmit = mode === 'note' ? noteText.trim()
    : mode === 'file' ? filePath.trim()
    : url.trim();

  const inputStyle = {
    width: '100%', background: theme.bg.deep, border: `1px solid ${theme.border.default}`,
    borderRadius: 6, padding: mobile ? '10px 12px' : '8px 10px', color: theme.text.primary,
    fontSize: mobile ? 16 : 12, fontFamily: 'inherit', outline: 'none', marginBottom: 8, boxSizing: 'border-box',
  };

  return (
    <div style={{ background: '#1a1540', borderRadius: 10, padding: 14, marginBottom: 16 }}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {MODES.map(m => (
          <button key={m.key} onClick={() => setMode(m.key)} style={{
            flex: 1, background: mode === m.key ? theme.bg.hover : 'transparent',
            border: `1px solid ${mode === m.key ? theme.accent.purple : theme.border.default}`,
            color: mode === m.key ? theme.text.primary : theme.text.muted,
            padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
          }}>{m.label}</button>
        ))}
      </div>

      {mode === 'note' ? (
        <textarea autoFocus={!mobile} placeholder="Dump your thought here..." value={noteText}
          onChange={e => setNoteText(e.target.value)} rows={3}
          style={{ ...inputStyle, resize: 'vertical' }} />
      ) : mode === 'file' ? (
        <>
          <input autoFocus={!mobile} type="text" placeholder="/Users/you/path/to/file.py" value={filePath}
            onChange={e => setFilePath(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            style={inputStyle} />
          <input type="text" placeholder="Why does this matter?" value={why}
            onChange={e => setWhy(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            style={{ ...inputStyle, color: theme.accent.amber }} />
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setType('auto')} style={{
              background: type === 'auto' ? theme.bg.hover : 'transparent',
              border: `1px solid ${type === 'auto' ? theme.accent.purple : theme.border.subtle}`,
              color: type === 'auto' ? theme.text.primary : theme.text.dim,
              padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit',
            }}>Auto</button>
            {Object.entries(RESOURCE_TYPES).filter(([k]) => !['note', 'idea'].includes(k)).map(([key, val]) => (
              <button key={key} onClick={() => setType(key)} style={{
                background: type === key ? theme.bg.hover : 'transparent',
                border: `1px solid ${type === key ? val.color : theme.border.subtle}`,
                color: type === key ? val.color : theme.text.dim,
                padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit',
              }}>{val.icon} {val.label}</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <input autoFocus={!mobile} type="text" placeholder="Paste URL..." value={url}
            onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            style={inputStyle} />
          <input type="text" placeholder="Why does this matter?" value={why}
            onChange={e => setWhy(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            style={{ ...inputStyle, color: theme.accent.amber }} />
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setType('auto')} style={{
              background: type === 'auto' ? theme.bg.hover : 'transparent',
              border: `1px solid ${type === 'auto' ? theme.accent.purple : theme.border.subtle}`,
              color: type === 'auto' ? theme.text.primary : theme.text.dim,
              padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit',
            }}>Auto</button>
            {Object.entries(RESOURCE_TYPES).filter(([k]) => !['note', 'idea'].includes(k)).map(([key, val]) => (
              <button key={key} onClick={() => setType(key)} style={{
                background: type === key ? theme.bg.hover : 'transparent',
                border: `1px solid ${type === key ? val.color : theme.border.subtle}`,
                color: type === key ? val.color : theme.text.dim,
                padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit',
              }}>{val.icon} {val.label}</button>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} style={{
          flex: 1, background: 'transparent', border: `1px solid ${theme.border.default}`,
          color: theme.text.muted, padding: mobile ? '12px' : '7px', borderRadius: 6, cursor: 'pointer',
          fontSize: mobile ? 14 : 11, fontFamily: 'inherit',
        }}>Cancel</button>
        <button onClick={handleSubmit} disabled={!canSubmit} style={{
          flex: 1, background: canSubmit ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : '#1a1040',
          border: 'none', color: canSubmit ? '#fff' : theme.text.dim,
          padding: mobile ? '12px' : '7px', borderRadius: 6, cursor: canSubmit ? 'pointer' : 'default',
          fontSize: mobile ? 14 : 11, fontFamily: 'inherit', fontWeight: 600,
        }}>Pour it in</button>
      </div>
    </div>
  );
}
