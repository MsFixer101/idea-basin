import { Router } from 'express';
import { readFile, stat } from 'fs/promises';
import { basename } from 'path';
import pool from '../db/pool.js';
import { callClaude } from '../services/claude-cli.js';
import { embed } from '../services/embedder.js';
import { searchChunks } from '../db/queries.js';
import {
  TOOL_DEFINITIONS,
  toolExecutors,
  parseToolCalls,
  extractText,
  ARTIFACTS_NODE_ID,
} from '../services/chat-tools.js';
import { get as getConfig } from '../services/config.js';

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────

async function getNodeSummary() {
  const { rows } = await pool.query(`
    SELECT n.id, n.label, n.parent_id,
      (SELECT count(*)::int FROM resources r WHERE r.node_id = n.id) as resource_count
    FROM nodes n ORDER BY n.created_at LIMIT 50
  `);
  if (rows.length === 0) return 'The knowledge base is empty.';
  return rows.map(n =>
    `- ${n.label} (${n.id}): ${n.resource_count} resources${n.parent_id ? '' : ' [ROOT]'}`
  ).join('\n');
}

async function getRagContext(userMessage) {
  try {
    const embedding = await embed(userMessage);
    if (!embedding) return '';
    const chunks = await searchChunks(embedding, 5);
    if (chunks.length === 0) return '';
    return chunks.map((c, i) =>
      `[${i + 1}] (node: ${c.node_label}, similarity: ${parseFloat(c.similarity).toFixed(2)}) ${c.content?.substring(0, 400)}`
    ).join('\n\n');
  } catch {
    return '';
  }
}

async function buildSystemPrompt(userMessage, mode = 'assistant') {
  const [nodeSummary, ragContext, chatConfig] = await Promise.all([
    getNodeSummary(),
    getRagContext(userMessage),
    getConfig('chat'),
  ]);

  const rolePrompt = mode === 'research'
    ? (chatConfig?.researchPrompt || 'You are a research assistant embedded in a knowledge management app.')
    : (chatConfig?.assistantPrompt || 'You are the Idea Basin assistant \u2014 a helpful AI embedded in a knowledge management app.');

  const guidelines = chatConfig?.guidelines ||
    'Be concise and helpful. Use short paragraphs.';

  let prompt = `${rolePrompt}

## Knowledge Base Structure
${nodeSummary}

There is a dedicated "Artifacts" node (${ARTIFACTS_NODE_ID}) for storing created documents. When using create_artifact without a specific node context, use this node.

`;

  if (ragContext) {
    prompt += `## Relevant Knowledge (auto-retrieved from the user's latest message)
${ragContext}

`;
  }

  prompt += TOOL_DEFINITIONS;

  prompt += `
## Behavioral Guidelines
${guidelines.split('\n').map(l => `- ${l}`).join('\n')}
`;

  return prompt;
}

function formatConversation(messages) {
  return messages.map(m => {
    if (m.role === 'user') return `Human: ${m.content}`;
    if (m.role === 'assistant') return `Assistant: ${m.content}`;
    if (m.role === 'tool_result') {
      const resultStr = JSON.stringify(m.result);
      return `Tool Result for ${m.name}: ${resultStr.length > 2000 ? resultStr.substring(0, 2000) + '...(truncated)' : resultStr}`;
    }
    return '';
  }).join('\n\n');
}

function sendSSE(res, event, data) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
  }
}

// ── POST /api/chat ─────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { messages, mode, attachments } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Abort controller for cancellation on client disconnect
  const abortController = new AbortController();
  res.on('close', () => abortController.abort());

  try {
    // Inject file attachments into the last user message
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      const lastUserIdx = messages.findLastIndex(m => m.role === 'user');
      if (lastUserIdx >= 0) {
        let prefix = '';
        for (const att of attachments) {
          if (!att.path) continue;
          const resolved = att.path.startsWith('~/') ? att.path.replace('~', process.env.HOME) : att.path;
          if (!resolved.startsWith('/Users/')) continue;
          try {
            const fileStat = await stat(resolved);
            if (!fileStat.isFile() || fileStat.size > 5 * 1024 * 1024) continue;
            const content = await readFile(resolved, 'utf-8');
            const name = basename(resolved);
            prefix += `\u{1F4CE} ${name}:\n\`\`\`\n${content}\n\`\`\`\n\n`;
          } catch {
            // Skip unreadable files
          }
        }
        if (prefix) {
          messages[lastUserIdx] = {
            ...messages[lastUserIdx],
            content: prefix + messages[lastUserIdx].content,
          };
        }
      }
    }

    const latestUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const systemPrompt = await buildSystemPrompt(latestUserMsg, mode || 'assistant');

    // Keep only the last ~10 messages to avoid prompt bloat on long conversations
    const trimmed = messages.length > 10 ? messages.slice(-10) : messages;
    const conversation = [...trimmed];
    const MAX_ITERATIONS = 20;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const prompt = formatConversation(conversation);
      let response;
      try {
        response = await callClaude(prompt, systemPrompt);
      } catch (err) {
        sendSSE(res, 'error', { message: err.message });
        break;
      }

      const toolCalls = parseToolCalls(response);
      const textContent = extractText(response);

      // Send any text to the client
      if (textContent) {
        sendSSE(res, 'text', { content: textContent });
      }

      // No tool calls — we're done
      if (toolCalls.length === 0) break;

      // Process tool calls
      for (const tc of toolCalls) {
        sendSSE(res, 'tool_call', { name: tc.name, args: tc.args });

        let result;
        const executor = toolExecutors[tc.name];
        if (!executor) {
          result = { error: `Unknown tool: ${tc.name}` };
        } else {
          try {
            // deep_research needs SSE callback + abort signal
            if (tc.name === 'deep_research') {
              result = await executor(
                tc.args,
                (event, data) => sendSSE(res, event, data),
                abortController.signal
              );
            } else {
              result = await executor(tc.args);
            }
          } catch (err) {
            result = { error: err.message };
          }
        }

        sendSSE(res, 'tool_result', { name: tc.name, result });

        // Append clean text + tool result (not raw response with XML) to avoid prompt bloat
        conversation.push({ role: 'assistant', content: textContent || `[used tool: ${tc.name}]` });
        // For deep_research, send a compact summary instead of the full synthesis to save context
        const conversationResult = tc.name === 'deep_research' && result?.status === 'done'
          ? { status: 'done', artifact_saved: !!result.artifact, summary: 'Research synthesis complete and saved as artifact.' }
          : result;
        conversation.push({ role: 'tool_result', name: tc.name, result: conversationResult });
      }
    }
  } catch (err) {
    console.error('Chat error:', err);
    sendSSE(res, 'error', { message: 'Internal server error' });
  }

  sendSSE(res, 'done', {});
  res.end();
});

export default router;
