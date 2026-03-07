import { useState, useCallback, useRef } from 'react';

let msgId = 0;

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  const sendMessage = useCallback(async (text, mode, attachments) => {
    if (!text.trim() || loading) return;

    const userMsg = { id: ++msgId, role: 'user', content: text.trim() };
    const assistantMsg = { id: ++msgId, role: 'assistant', content: '', toolCalls: [] };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setLoading(true);

    // Build full message history for the server (exclude toolCalls metadata)
    const history = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    })).filter(m => m.role === 'user' || m.role === 'assistant');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          mode: mode || 'assistant',
          ...(attachments?.length ? { attachments } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id ? { ...m, content: err.error || 'Request failed', error: true } : m
        ));
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data;
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          switch (data.event) {
            case 'text':
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: (m.content ? m.content + '\n\n' : '') + data.content }
                  : m
              ));
              break;

            case 'tool_call':
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, toolCalls: [...(m.toolCalls || []), { name: data.name, args: data.args, status: 'running', result: null }] }
                  : m
              ));
              break;

            case 'tool_result':
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantMsg.id) return m;
                const tcs = [...(m.toolCalls || [])];
                const idx = tcs.findLastIndex(tc => tc.name === data.name && tc.status === 'running');
                if (idx >= 0) {
                  tcs[idx] = { ...tcs[idx], status: 'done', result: data.result };
                }
                return { ...m, toolCalls: tcs };
              }));
              break;

            case 'research_start':
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, research: { question: data.question, tasks: (data.tasks || []).map(t => ({ ...t, status: 'running', tools: [] })), status: 'running' } }
                  : m
              ));
              break;

            case 'sub_agent_tool':
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantMsg.id || !m.research) return m;
                const tasks = m.research.tasks.map(t =>
                  t.id === data.taskId
                    ? { ...t, tools: [...(t.tools || []), { name: data.tool, args: data.args, status: 'running' }] }
                    : t
                );
                return { ...m, research: { ...m.research, tasks } };
              }));
              break;

            case 'sub_agent_result':
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantMsg.id || !m.research) return m;
                const tasks = m.research.tasks.map(t => {
                  if (t.id !== data.taskId) return t;
                  const tools = [...(t.tools || [])];
                  const idx = tools.findLastIndex(tl => tl.name === data.tool && tl.status === 'running');
                  if (idx >= 0) tools[idx] = { ...tools[idx], status: 'done', result: data.result };
                  return { ...t, tools };
                });
                return { ...m, research: { ...m.research, tasks } };
              }));
              break;

            case 'sub_agent_text':
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantMsg.id || !m.research) return m;
                const tasks = m.research.tasks.map(t =>
                  t.id === data.taskId
                    ? { ...t, status: 'done', findings: data.text }
                    : t
                );
                return { ...m, research: { ...m.research, tasks } };
              }));
              break;

            case 'research_synthesizing':
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id && m.research
                  ? { ...m, research: { ...m.research, status: 'synthesizing' } }
                  : m
              ));
              break;

            case 'research_complete':
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id && m.research
                  ? { ...m, research: { ...m.research, status: data.status || 'done', synthesis: data.synthesis, artifact: data.artifact } }
                  : m
              ));
              break;

            case 'error':
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: m.content || data.message, error: true }
                  : m
              ));
              break;

            case 'done':
              break;
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: m.content || 'Connection failed', error: true }
            : m
        ));
      }
    }

    setLoading(false);
    abortRef.current = null;
  }, [messages, loading]);

  const clearChat = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setLoading(false);
  }, []);

  return { messages, loading, sendMessage, clearChat };
}
