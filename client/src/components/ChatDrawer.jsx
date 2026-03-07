import { useState, useRef, useEffect } from 'react';
import { theme } from '../styles/theme.js';
import { useChat } from '../hooks/useChat.js';
import { useMobile } from '../hooks/useMobile.js';
import { renderMarkdown, markdownStyles } from '../utils/markdown.js';

// ── Tool call card ─────────────────────────────────────────────────────

const TOOL_ICONS = {
  search_knowledge: '\u{1F50D}',
  list_nodes: '\u{1F4CB}',
  get_node: '\u{1F4C2}',
  create_node: '\u2795',
  add_resource: '\u{1F4CE}',
  read_file: '\u{1F4C4}',
  open_file: '\u{1F4C1}',
  create_crossref: '\u{1F517}',
  list_crossrefs: '\u{1F517}',
  internet_search: '\u{1F310}',
  create_artifact: '\u{1F4DD}',
  search_files: '\u{1F4C0}',
  fetch_url: '\u{1F310}',
  search_papers: '\u{1F4DA}',
  deep_research: '\u{1F9EA}',
};

function ToolCallCard({ tc }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = tc.status === 'running';

  return (
    <div style={{
      background: theme.bg.deep, border: `1px solid ${theme.border.subtle}`,
      borderRadius: 6, padding: '4px 8px', marginTop: 6, fontSize: 11,
    }}>
      <div
        onClick={() => !isRunning && setExpanded(!expanded)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: isRunning ? 'default' : 'pointer' }}
      >
        <span>{TOOL_ICONS[tc.name] || '\u{1F527}'}</span>
        <span style={{ color: theme.text.secondary }}>{tc.name}</span>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: isRunning ? theme.accent.amber : tc.result?.error ? theme.accent.red : theme.accent.green,
          animation: isRunning ? 'pulse 1s infinite' : 'none',
        }} />
        {isRunning && <span style={{ color: theme.text.dim }}>running...</span>}
        {!isRunning && <span style={{ color: theme.text.dim }}>{expanded ? '\u25B2' : '\u25BC'}</span>}
      </div>
      {expanded && (
        <div style={{ marginTop: 4, color: theme.text.muted, fontSize: 10, lineHeight: 1.4 }}>
          {tc.args && Object.keys(tc.args).length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: theme.text.dim }}>args: </span>
              <code style={{ wordBreak: 'break-all' }}>{JSON.stringify(tc.args)}</code>
            </div>
          )}
          {tc.result && (
            <div>
              <span style={{ color: theme.text.dim }}>result: </span>
              <code style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(tc.result, null, 2).substring(0, 800)}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Search result card ─────────────────────────────────────────────────

function SearchResultCard({ tc }) {
  const results = tc.result?.results || [];
  const provider = tc.result?.provider;
  if (results.length === 0) return <ToolCallCard tc={tc} />;

  return (
    <div style={{
      background: theme.bg.deep, border: `1px solid ${theme.border.subtle}`,
      borderRadius: 6, padding: '6px 8px', marginTop: 6, fontSize: 11,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span>{'\u{1F310}'}</span>
        <span style={{ color: theme.text.secondary }}>Web Search</span>
        {provider && <span style={{ color: theme.text.ghost, fontSize: 9 }}>via {provider}</span>}
      </div>
      {results.map((r, i) => (
        <div key={i} style={{
          padding: '4px 0', borderTop: i > 0 ? `1px solid ${theme.border.subtle}` : 'none',
        }}>
          <a
            href={r.url} target="_blank" rel="noopener noreferrer"
            style={{ color: theme.accent.cyan, fontSize: 11, textDecoration: 'none', lineHeight: 1.3 }}
          >
            {r.title}
          </a>
          {r.snippet && (
            <div style={{ color: theme.text.muted, fontSize: 10, marginTop: 2, lineHeight: 1.3 }}>
              {r.snippet.substring(0, 200)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Artifact card ─────────────────────────────────────────────────────

// renderMarkdown imported from ../utils/markdown.js (default opts match chat sizing)

function ArtifactCard({ tc }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { id, title, type, content, path } = tc.result || {};

  if (!content) return <ToolCallCard tc={tc} />;

  const TYPE_BADGES = {
    markdown: { label: 'MD', color: theme.accent.cyan },
    code: { label: 'CODE', color: theme.accent.green },
    html: { label: 'HTML', color: theme.accent.orange },
    text: { label: 'TXT', color: theme.text.muted },
  };
  const badge = TYPE_BADGES[type] || TYPE_BADGES.text;

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{
      background: theme.bg.deep, border: `1px solid ${theme.border.subtle}`,
      borderRadius: 6, marginTop: 6, overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
          cursor: 'pointer', fontSize: 11,
        }}
      >
        <span>{'\u{1F4DD}'}</span>
        <span style={{ color: theme.text.primary, flex: 1, fontWeight: 600 }}>{title}</span>
        <span style={{
          background: badge.color + '22', color: badge.color,
          padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
        }}>{badge.label}</span>
        <button onClick={handleCopy} style={{
          background: 'none', border: `1px solid ${theme.border.subtle}`,
          color: copied ? theme.accent.green : theme.text.dim,
          padding: '1px 6px', borderRadius: 4, cursor: 'pointer',
          fontSize: 9, fontFamily: theme.font,
        }}>{copied ? 'Copied' : 'Copy'}</button>
        <span style={{ color: theme.text.dim, fontSize: 10 }}>{expanded ? '\u25B2' : '\u25BC'}</span>
      </div>

      {/* Content */}
      {expanded && (
        <div style={{
          padding: '0 8px 8px', maxHeight: 400, overflowY: 'auto',
          borderTop: `1px solid ${theme.border.subtle}`,
        }}>
          {type === 'markdown' && (
            <div
              className="chat-md"
              style={{ color: theme.text.primary, paddingTop: 8 }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          )}
          {type === 'code' && (
            <pre style={{
              color: theme.accent.green, fontSize: 10, lineHeight: 1.4,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', paddingTop: 8,
              margin: 0, fontFamily: theme.font,
            }}>{content}</pre>
          )}
          {type === 'html' && (
            <iframe
              srcDoc={content} sandbox=""
              style={{
                width: '100%', height: 300, border: `1px solid ${theme.border.subtle}`,
                borderRadius: 4, background: '#fff', marginTop: 8,
              }}
            />
          )}
          {type === 'text' && (
            <pre style={{
              color: theme.text.secondary, fontSize: 10, lineHeight: 1.4,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', paddingTop: 8,
              margin: 0, fontFamily: theme.font,
            }}>{content}</pre>
          )}
          {path && (
            <div style={{ fontSize: 9, color: theme.text.ghost, marginTop: 6 }}>
              Saved: {path}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Paper result card ─────────────────────────────────────────────────

function PaperResultCard({ tc }) {
  const papers = tc.result?.papers || [];
  if (papers.length === 0) return <ToolCallCard tc={tc} />;

  return (
    <div style={{
      background: theme.bg.deep, border: `1px solid ${theme.border.subtle}`,
      borderRadius: 6, padding: '6px 8px', marginTop: 6, fontSize: 11,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span>{'\u{1F4DA}'}</span>
        <span style={{ color: theme.text.secondary }}>Academic Papers</span>
        <span style={{ color: theme.text.ghost, fontSize: 9 }}>{papers.length} results</span>
      </div>
      {papers.map((p, i) => (
        <div key={i} style={{
          padding: '4px 0', borderTop: i > 0 ? `1px solid ${theme.border.subtle}` : 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <div style={{ flex: 1 }}>
              <a
                href={p.url || '#'} target="_blank" rel="noopener noreferrer"
                style={{ color: theme.accent.cyan, fontSize: 11, textDecoration: 'none', lineHeight: 1.3 }}
              >
                {p.title}
              </a>
              <div style={{ color: theme.text.muted, fontSize: 9, marginTop: 1 }}>
                {p.authors && <span>{p.authors.substring(0, 80)}{p.authors.length > 80 ? '...' : ''}</span>}
                {p.year && <span> ({p.year})</span>}
                {p.citations != null && <span> \u00B7 {p.citations} cites</span>}
                {p.source && <span style={{ color: theme.text.ghost }}> \u00B7 {p.source === 'semantic_scholar' ? 'S2' : 'arXiv'}</span>}
              </div>
            </div>
            {p.doi && (
              <a
                href={`https://doi.org/${p.doi}`} target="_blank" rel="noopener noreferrer"
                style={{ color: theme.text.ghost, fontSize: 8, textDecoration: 'none', flexShrink: 0, padding: '2px 4px', border: `1px solid ${theme.border.subtle}`, borderRadius: 3 }}
              >DOI</a>
            )}
          </div>
          {p.abstract && (
            <div style={{ color: theme.text.muted, fontSize: 9, marginTop: 2, lineHeight: 1.3 }}>
              {p.abstract.substring(0, 150)}{p.abstract.length > 150 ? '...' : ''}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Research card ─────────────────────────────────────────────────────

function ResearchCard({ research }) {
  const [expanded, setExpanded] = useState(true);
  const [showSynthesis, setShowSynthesis] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!research) return null;

  const { question, tasks = [], status, synthesis, artifact } = research;
  const completedCount = tasks.filter(t => t.status === 'done' || t.findings).length;
  const totalCount = tasks.length;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;

  const statusLabel = status === 'running' ? 'Researching...'
    : status === 'synthesizing' ? 'Synthesizing...'
    : status === 'done' ? 'Complete'
    : status === 'cancelled' ? 'Cancelled'
    : 'Pending';

  const statusColor = status === 'running' ? theme.accent.amber
    : status === 'synthesizing' ? theme.accent.cyan
    : status === 'done' ? theme.accent.green
    : theme.text.muted;

  const handleCopy = (e) => {
    e.stopPropagation();
    if (synthesis) {
      navigator.clipboard.writeText(synthesis).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  };

  return (
    <div style={{
      background: '#0c1929', border: `1px solid #1e3a5f`,
      borderRadius: 6, marginTop: 6, overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
          cursor: 'pointer', fontSize: 11,
        }}
      >
        <span>{'\u{1F9EA}'}</span>
        <span style={{ color: '#60a5fa', flex: 1, fontWeight: 600, fontSize: 11 }}>
          {question?.substring(0, 50)}{question?.length > 50 ? '...' : ''}
        </span>
        <span style={{
          color: statusColor, fontSize: 9, fontWeight: 600,
          animation: (status === 'running' || status === 'synthesizing') ? 'pulse 1.5s infinite' : 'none',
        }}>{statusLabel}</span>
        <span style={{ color: theme.text.dim, fontSize: 10 }}>{expanded ? '\u25B2' : '\u25BC'}</span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: '#1e3a5f' }}>
        <div style={{
          height: '100%', background: status === 'done' ? theme.accent.green : '#2563eb',
          width: status === 'synthesizing' || status === 'done' ? '100%' : `${progress * 100}%`,
          transition: 'width 0.5s ease',
        }} />
      </div>

      {expanded && (
        <div style={{ padding: '4px 8px 6px' }}>
          {/* Sub-agent lanes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {tasks.map((task, i) => (
              <div key={task.id || i} style={{
                background: theme.bg.deep, borderRadius: 4, padding: '4px 6px',
                border: `1px solid ${task.findings ? '#1a3520' : task.tools?.some(t => t.status === 'running') ? '#3b3520' : theme.border.subtle}`,
              }}>
                <div style={{ fontSize: 9, color: theme.text.secondary, marginBottom: 2, lineHeight: 1.3 }}>
                  {task.description?.substring(0, 60)}{task.description?.length > 60 ? '...' : ''}
                </div>
                {/* Tool call dots */}
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {(task.tools || []).map((tl, j) => (
                    <span key={j} title={`${tl.name}${tl.args?.query ? ': ' + tl.args.query : ''}`} style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: tl.status === 'running' ? theme.accent.amber
                        : tl.result?.error ? theme.accent.red
                        : theme.accent.green,
                      animation: tl.status === 'running' ? 'pulse 1s infinite' : 'none',
                    }} />
                  ))}
                  {task.findings && <span style={{ fontSize: 8, color: theme.accent.green }}>done</span>}
                  {!task.findings && (!task.tools || task.tools.length === 0) && task.status === 'running' && (
                    <span style={{ fontSize: 8, color: theme.accent.amber, animation: 'pulse 1.5s infinite' }}>starting...</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Synthesis result */}
          {synthesis && (
            <div style={{ marginTop: 6 }}>
              <div
                onClick={() => setShowSynthesis(!showSynthesis)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  cursor: 'pointer', fontSize: 10,
                }}
              >
                <span>{'\u{1F4DD}'}</span>
                <span style={{ color: theme.text.primary, flex: 1, fontWeight: 600 }}>Research Synthesis</span>
                <button onClick={handleCopy} style={{
                  background: 'none', border: `1px solid ${theme.border.subtle}`,
                  color: copied ? theme.accent.green : theme.text.dim,
                  padding: '1px 6px', borderRadius: 4, cursor: 'pointer',
                  fontSize: 9, fontFamily: theme.font,
                }}>{copied ? 'Copied' : 'Copy'}</button>
                <span style={{ color: theme.text.dim }}>{showSynthesis ? '\u25B2' : '\u25BC'}</span>
              </div>
              {showSynthesis && (
                <div style={{
                  marginTop: 4, maxHeight: 400, overflowY: 'auto',
                  borderTop: `1px solid ${theme.border.subtle}`, paddingTop: 6,
                }}>
                  <div
                    className="chat-md"
                    style={{ color: theme.text.primary, fontSize: 10 }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(synthesis) }}
                  />
                </div>
              )}
              {artifact?.path && (
                <div style={{ fontSize: 8, color: theme.text.ghost, marginTop: 4 }}>
                  Saved: {artifact.path}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tool result dispatcher ────────────────────────────────────────────

function ToolResultCard({ tc }) {
  if (tc.name === 'internet_search' && tc.result && !tc.result.error) return <SearchResultCard tc={tc} />;
  if (tc.name === 'create_artifact' && tc.result && !tc.result.error) return <ArtifactCard tc={tc} />;
  if (tc.name === 'search_papers' && tc.result && !tc.result.error) return <PaperResultCard tc={tc} />;
  // deep_research is rendered via ResearchCard in MessageBubble, so just show a minimal card here
  if (tc.name === 'deep_research') return null;
  return <ToolCallCard tc={tc} />;
}

// ── Message bubble ─────────────────────────────────────────────────────

function MessageBubble({ msg, loading }) {
  const isUser = msg.role === 'user';
  const hasResearch = !isUser && msg.research;
  const isEmpty = !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && !hasResearch;
  const isThinking = !isUser && isEmpty && loading;

  return (
    <div style={{
      display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 8,
    }}>
      <div style={{
        maxWidth: '85%', padding: '8px 12px', borderRadius: 10,
        background: isUser
          ? 'linear-gradient(135deg, #7c3aed, #6d28d9)'
          : theme.bg.card,
        color: isUser ? '#fff' : msg.error ? theme.accent.red : theme.text.primary,
        fontSize: 13, lineHeight: 1.5,
        ...( isUser ? { whiteSpace: 'pre-wrap' } : {}),
        wordBreak: 'break-word',
      }}>
        {isThinking ? (
          <span style={{ color: theme.text.muted, animation: 'pulse 1.5s infinite' }}>Thinking...</span>
        ) : isUser ? (
          msg.content || '\u2026'
        ) : msg.content ? (
          <div className="chat-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
        ) : (
          (msg.toolCalls?.length > 0 || hasResearch) ? '' : '\u2026'
        )}
        {!isUser && msg.toolCalls?.map((tc, i) => (
          <ToolResultCard key={i} tc={tc} />
        ))}
        {hasResearch && <ResearchCard research={msg.research} />}
      </div>
    </div>
  );
}

// ── Chat Drawer ────────────────────────────────────────────────────────

export default function ChatDrawer() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [researchMode, setResearchMode] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const { messages, loading, sendMessage, clearChat } = useChat();
  const mobile = useMobile();
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens (skip on mobile to avoid viewport trap)
  useEffect(() => {
    if (open && inputRef.current && !mobile) {
      inputRef.current.focus();
    }
  }, [open, mobile]);

  const handleSend = () => {
    if (!input.trim() || loading) return;
    sendMessage(input, researchMode ? 'research' : 'assistant', attachments.length ? attachments : undefined);
    setInput('');
    setAttachments([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputPaste = (e) => {
    const text = e.clipboardData?.getData('text/plain')?.trim();
    if (!text) return;
    const paths = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('/') || l.startsWith('~/'));
    if (paths.length === 0) return;
    e.preventDefault();
    setAttachments(prev => [...prev, ...paths.map(p => ({ path: p, name: p.split('/').pop() }))]);
  };

  return (
    <>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        ${markdownStyles('chat-md', { fontSize: '11px', lineHeight: '1.5' })}`}</style>

      {/* Floating button */}
      {!open && (
        <button onClick={() => setOpen(true)} style={{
          position: 'fixed', bottom: mobile ? 80 : 20, left: mobile ? 'auto' : 20, right: mobile ? 16 : 'auto', zIndex: 9999,
          width: 52, height: 52, borderRadius: '50%',
          background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
          border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(124, 58, 237, 0.4)',
        }}>
          {'\u2726'}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', zIndex: 9999,
          bottom: mobile ? 0 : 20, left: mobile ? 'auto' : 20, right: mobile ? 0 : 'auto',
          width: mobile ? '100%' : 380,
          height: mobile ? '100%' : '70vh',
          maxHeight: mobile ? '100%' : 600,
          background: theme.bg.surface,
          border: mobile ? 'none' : `1px solid ${theme.border.default}`,
          borderRadius: mobile ? 0 : 12,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderBottom: `1px solid ${theme.border.subtle}`,
          }}>
            <span style={{ fontSize: 13, color: theme.text.secondary, fontWeight: 600, flex: 1 }}>Chat</span>
            {messages.length > 0 && (
              <button onClick={clearChat} style={{
                background: 'none', border: `1px solid ${theme.border.subtle}`,
                color: theme.text.dim, padding: '3px 8px', borderRadius: 6,
                cursor: 'pointer', fontSize: 10, fontFamily: theme.font,
              }}>Clear</button>
            )}
            <button onClick={() => setOpen(false)} style={{
              background: 'none', border: 'none', color: theme.text.muted,
              cursor: 'pointer', fontSize: 16, padding: '2px 6px', lineHeight: 1,
            }}>{'\u2715'}</button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{
            flex: 1, overflowY: 'auto', padding: '8px 12px',
            display: 'flex', flexDirection: 'column',
          }}>
            {messages.length === 0 && (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: theme.text.dim, fontSize: 12, textAlign: 'center', padding: 20, gap: 12,
              }}>
                <div>Ask questions about your knowledge base, create nodes, or just chat.</div>
                <div style={{ fontSize: 10, color: theme.text.ghost, lineHeight: 1.5 }}>
                  Tip: Ask me to create research summaries, guides, or code — I'll save them as documents.
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <MessageBubble key={msg.id} msg={msg} loading={loading && i === messages.length - 1} />
            ))}
          </div>

          {/* Mode toggle */}
          <div style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0,
            padding: '4px 12px 0', borderTop: `1px solid ${theme.border.subtle}`,
          }}>
            {['assistant', 'research'].map(m => (
              <button key={m} onClick={() => setResearchMode(m === 'research')} style={{
                background: (m === 'research') === researchMode ? (researchMode ? '#1e3a5f' : theme.bg.card) : 'transparent',
                border: `1px solid ${(m === 'research') === researchMode ? (researchMode ? '#2563eb44' : theme.border.default) : 'transparent'}`,
                color: (m === 'research') === researchMode ? (researchMode ? '#60a5fa' : theme.text.secondary) : theme.text.ghost,
                padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                fontSize: 10, fontFamily: theme.font, fontWeight: 600,
                textTransform: 'capitalize',
              }}>{m}</button>
            ))}
            {researchMode && (
              <span style={{ marginLeft: 8, fontSize: 9, color: '#60a5fa' }}>Deep research mode</span>
            )}
          </div>

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div style={{
              flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: 4,
              padding: '4px 12px 0',
            }}>
              {attachments.map((att, i) => (
                <span key={i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: theme.bg.card, border: `1px solid ${theme.border.default}`,
                  borderRadius: 12, padding: '2px 8px', fontSize: 10, color: theme.text.secondary,
                  maxWidth: 180, overflow: 'hidden',
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</span>
                  <span
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                    style={{ cursor: 'pointer', color: theme.text.ghost, fontSize: 11, lineHeight: 1, flexShrink: 0 }}
                  >{'\u2715'}</span>
                </span>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{
            flexShrink: 0, display: 'flex', alignItems: mobile ? 'flex-end' : 'center', gap: 8,
            padding: mobile ? '10px 12px' : '4px 12px 8px', borderTop: 'none',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handleInputPaste}
              placeholder={loading ? 'Thinking...' : mobile ? 'Paste text or ask anything...' : 'Ask anything... (paste text here)'}
              disabled={loading}
              rows={Math.min(Math.max(input.split('\n').length, 1), mobile ? 4 : 6)}
              style={{
                flex: 1, background: theme.bg.input,
                border: `1px solid ${researchMode ? '#2563eb44' : theme.border.subtle}`,
                color: theme.text.primary, padding: mobile ? '10px 12px' : '8px 10px', borderRadius: 6,
                fontSize: mobile ? 16 : 13, fontFamily: theme.font, outline: 'none',
                opacity: loading ? 0.5 : 1, resize: 'none', lineHeight: 1.4,
              }}
            />
            <button onClick={handleSend} disabled={loading || !input.trim()} style={{
              background: input.trim() && !loading ? theme.accent.purple : theme.bg.card,
              border: 'none', color: input.trim() && !loading ? '#fff' : theme.text.dim,
              padding: mobile ? '12px 18px' : '8px 14px', borderRadius: 6,
              cursor: input.trim() && !loading ? 'pointer' : 'default',
              fontSize: mobile ? 18 : 13, fontFamily: theme.font, fontWeight: 600,
            }}>{'\u25B6'}</button>
          </div>
        </div>
      )}
    </>
  );
}
