import makeWASocket, { useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, downloadMediaMessage, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rm, readFile, writeFile, mkdir } from 'fs/promises';
import { get as getConfig } from './config.js';
import { callClaude } from './claude-cli.js';
import * as geminiClient from './gemini-client.js';
import * as openaiClient from './openai-client.js';
import * as claudeClient from './claude-client.js';
import { scrape } from './scraper.js';
import { embed } from './embedder.js';
import { searchChunks, createResource, updateResource, createNode, getRootNode, getNodeDeep, getResourcesForNode, getPrivateNodeIds } from '../db/queries.js';
import { ingest } from '../workers/ingest.js';
import pool from '../db/pool.js';
import { performSearch } from './web-search.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(__dirname, '..', 'data', 'whatsapp-auth');
const UPLOADS_DIR = join(__dirname, '..', 'uploads');
const WHATSAPP_CAPTURES_ID = '00000000-0000-0000-0000-000000000090';

const SAVE_RE = /^@save\b/i;
const BASIN_RE = /^@basin\b/i;
const SUBBASIN_RE = /^@subbasin\b/i;
const LIST_BASINS_RE = /^\/(basins|subbasins)\b/i;
const MORNING_RE = /^\/morning\b/i;
const MEMORY_RE = /^@memory\b/i;
const DESCRIBE_IMAGE_PROMPT = 'Describe this image concisely in 1-2 sentences. Focus on the key content — what is shown, any text visible, and the main subject.';

let sock = null;
let stopping = false;
let presenceInterval = null;
const sentByBot = new Map(); // msgId → timestamp, cleaned periodically
const messageHistory = new Map(); // groupJid → Array<{sender, text, isBot, timestamp}>
const MAX_HISTORY = 20;

function pushHistory(groupJid, entry) {
  let buf = messageHistory.get(groupJid);
  if (!buf) { buf = []; messageHistory.set(groupJid, buf); }
  buf.push(entry);
  if (buf.length > MAX_HISTORY) buf.splice(0, buf.length - MAX_HISTORY);
}

function formatHistory(groupJid, excludeMsgId) {
  const buf = messageHistory.get(groupJid);
  if (!buf || buf.length === 0) return '';
  const entries = buf
    .filter(e => e.msgId !== excludeMsgId)
    .slice(-10);
  if (entries.length === 0) return '';
  const lines = entries.map(e => {
    const t = new Date(e.timestamp);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const name = e.isBot ? `Bot (${e.sender})` : e.sender;
    return `[${hh}:${mm}] ${name}: ${e.text}`;
  });
  return `Recent conversation:\n${lines.join('\n')}`;
}

setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [id, ts] of sentByBot) {
    if (ts < cutoff) sentByBot.delete(id);
  }
}, 30_000);

// ── Observable state (exposed via getStatus / API) ───────────────────────

let botState = {
  status: 'disconnected', // disconnected | connecting | qr | connected
  qrDataUrl: null,        // base64 PNG data URL for QR code
  groups: [],             // [{ id, name }]
  lastError: null,        // last disconnect error message (e.g. "405 Connection Failure")
  reconnectAttempts: 0,   // how many times we've tried to reconnect
};

export function getStatus() {
  return { ...botState };
}

// ── URL helpers ──────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function extractUrls(text) {
  return (text.match(URL_RE) || [])
    .map(u => u.replace(/[.,;:!?)]+$/, ''))
    .filter(u => {
      try {
        const host = new URL(u).hostname.toLowerCase();
        // Block internal/private hosts (SSRF protection)
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false;
        if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('172.')) return false;
        if (host.startsWith('169.254.')) return false; // link-local / cloud metadata
        return true;
      } catch { return false; }
    });
}

// ── Configurable aliases ─────────────────────────────────────────────────

const DEFAULT_ALIASES = [
  { tag: 'claude', provider: 'claude-cli', model: '' },
  { tag: 'gemini', provider: 'gemini',     model: 'gemini-2.0-flash' },
  { tag: 'grok',   provider: 'grok',       model: 'grok-3-mini-fast' },
];

const PROVIDER_API_BASES = {
  openai:   'https://api.openai.com',
  deepseek: 'https://api.deepseek.com',
  kimi:     'https://api.moonshot.ai',
  qwen:     'https://dashscope-intl.aliyuncs.com/compatible-mode',
};

function getAliases(cfg) {
  const aliases = cfg?.aliases;
  return (Array.isArray(aliases) && aliases.length > 0) ? aliases : DEFAULT_ALIASES;
}

function resolveAlias(text, aliases) {
  for (const alias of aliases) {
    const re = new RegExp(`@${alias.tag}\\b`, 'i');
    if (re.test(text)) return alias;
  }
  return null;
}

function getApiKey(provider, cfg) {
  const map = {
    gemini: cfg.geminiApiKey,
    grok: cfg.grokApiKey,
    claude: cfg.claudeApiKey,
    openai: cfg.openaiApiKey,
    deepseek: cfg.deepseekApiKey,
    kimi: cfg.kimiApiKey,
    qwen: cfg.qwenApiKey,
  };
  return map[provider] || null;
}

const PROVIDER_NEEDS_KEY = new Set(['gemini', 'grok', 'claude', 'openai', 'deepseek', 'kimi', 'qwen']);

const PROVIDER_LABELS = {
  'claude-cli': 'Claude',
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok',
  ollama: 'Ollama',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  qwen: 'Qwen',
};

async function callProvider(provider, model, prompt, system, apiKey, cfg, { imageBase64, imageMime } = {}) {
  const imageOpts = imageBase64 && imageMime ? { imageBase64, imageMime } : {};
  switch (provider) {
    case 'claude-cli':
      // Claude CLI doesn't support vision
      return callClaude(prompt, system);
    case 'claude':
      return claudeClient.generate(prompt, system, apiKey, model || undefined, imageOpts);
    case 'gemini':
      return geminiClient.generate(prompt, system, apiKey, model || undefined, imageOpts);
    case 'grok':
      if (imageBase64) {
        // Grok uses OpenAI-compatible API — pass image through
        const baseUrl = PROVIDER_API_BASES['grok'];
        return openaiClient.generate(prompt, system, apiKey, model || undefined, baseUrl, imageOpts);
      }
      return grokWithSearch(prompt, system, apiKey, model);
    case 'ollama': {
      const ollamaUrl = (cfg?.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
      const messages = [
        { role: 'system', content: system },
      ];
      if (imageBase64) {
        messages.push({ role: 'user', content: prompt, images: [imageBase64] });
      } else {
        messages.push({ role: 'user', content: prompt });
      }
      const startTime = Date.now();
      console.log(`[whatsapp] Ollama request: model=${model || 'llama3.2'}, prompt length=${prompt.length}, system length=${system.length}`);
      const res = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'llama3.2',
          messages,
          stream: false,
        }),
        signal: AbortSignal.timeout(120000),
      });
      const elapsed = Date.now() - startTime;
      if (elapsed > 10000) console.warn(`[whatsapp] Ollama took ${(elapsed / 1000).toFixed(1)}s to respond (model: ${model || 'llama3.2'})`);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[whatsapp] Ollama HTTP ${res.status}: ${errText.substring(0, 200)}`);
        return null;
      }
      const data = await res.json();
      if (!data.message?.content) {
        console.warn(`[whatsapp] Ollama returned empty content:`, JSON.stringify(data).substring(0, 300));
      }
      return data.message?.content || null;
    }
    case 'openai':
    case 'deepseek':
    case 'kimi':
    case 'qwen': {
      const baseUrl = PROVIDER_API_BASES[provider];
      return openaiClient.generate(prompt, system, apiKey, model || undefined, baseUrl, imageOpts);
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ── RAG context ──────────────────────────────────────────────────────────

async function getRagContext(query) {
  try {
    const embedding = await embed(query);
    if (!embedding) return '';
    const chunks = await searchChunks(embedding, 10);
    if (chunks.length === 0) return '';
    // Filter out chunks from private nodes
    const privateIds = await getPrivateNodeIds();
    const filtered = chunks.filter(c => !privateIds.has(c.node_id)).slice(0, 5);
    if (filtered.length === 0) return '';
    return filtered.map((c, i) => {
      const urlPart = c.url ? ` url: ${c.url}` : '';
      return `[${i + 1}] (node: ${c.node_label},${urlPart} similarity: ${parseFloat(c.similarity).toFixed(2)}) ${c.content?.substring(0, 400)}`;
    }).join('\n\n');
  } catch {
    return '';
  }
}

// ── AI calls ─────────────────────────────────────────────────────────────

const SUMMARIZE_SYSTEM = 'You are a helpful assistant. Summarize the following content concisely — 2-4 sentences covering the key points.';
const DEFAULT_CHAT_SYSTEM = `You are a helpful assistant responding in a WhatsApp group called "AI News". This group is connected to *Idea Basin*, a knowledge management app where ideas, links, and research are organized into hierarchical nodes (called "basins").

How the WhatsApp bot works:
- Users tag an AI by its configured alias (e.g. @claude, @qwen, @gemini, etc.)
- Sharing a URL auto-summarizes it and saves it to the knowledge base
- The bot can search the knowledge base for relevant context (provided below when available)
- You can see recent group messages (provided below when available) — use them to follow the conversation naturally and respond to follow-up questions in context

What you *can* do in this chat:
- Answer questions using your own knowledge, knowledge base context, and live web search results (all provided below when available)
- Summarize URLs that are shared (this happens automatically)
- The bot saves shared URLs as resources in a "WhatsApp Captures" basin

What you *cannot* do from this chat:
- You cannot edit or delete nodes — but users can create new basins with *@basin* and *@subbasin*
- You cannot edit or delete resources in the knowledge base

Users can also capture content directly:
- *@save <text>* — saves free-text as a searchable note in WhatsApp Captures
- *@basin <name>* — creates a new top-level basin
- *@subbasin <parent> > <name>* — creates a basin directly under a named parent
- */basins* — lists all top-level basins
- */subbasins* — lists all basins with their sub-basins
- Sending an image with a caption — saves the image and generates an AI description

If someone asks you to "move something" or "delete a node", explain that those actions require the Idea Basin app.

IMPORTANT: Context (conversation history, knowledge base results, web search results) is provided directly in the prompt below. You also have read-only tools to query the knowledge base for data questions (counts, listings, node contents). NEVER say you are "having trouble reaching" anything or "unable to access" anything — use the context, tools, and your own knowledge to answer.

Keep responses concise and WhatsApp-friendly — short paragraphs, no markdown headers. Use *bold* for emphasis (WhatsApp formatting).

When you use knowledge base context or web search results in your answer, *always* cite your sources with embedded links at the end. Format: "Sources: <url1> <url2>". If context entries include URLs, you MUST link to them. This is critical — never make claims from the knowledge base without citing the source URL.`;

// ── WhatsApp tool use (read-only queries against Idea Basin API) ──────

const WHATSAPP_TOOLS = `
You also have access to read-only tools to query the Idea Basin knowledge base directly. Use these when the user asks data questions you can't answer from the context already provided (counts, listings, specific node contents).

To use a tool, output a use_tool block:
<use_tool>{"name": "tool_name", "args": {"key": "value"}}</use_tool>

Available tools:

1. query_nodes — Get the full node tree with resource counts for each basin.
   Use for: "what basins do I have?", "how many resources?", "show me the tree"
   Args: none — use {}

2. query_node — Get details about a specific node including its children and resources.
   Use for: "what's in WhatsApp Captures?", "how many items in X?", "list resources in Y"
   Args: { "id": "node-uuid" }
   Well-known IDs: WhatsApp Captures = "00000000-0000-0000-0000-000000000090", Artifacts = "00000000-0000-0000-0000-000000000080"

3. search_knowledge — Semantic search across all resources in the knowledge base.
   Use for: "find resources about X", "search for Y", "anything about Z?"
   Args: { "q": "search terms" }

4. save_memory — Save a useful fact to persistent memory for future conversations.
   Use for: remembering user preferences, corrections, key facts, important context
   Args: { "text": "fact to remember" }

Rules:
- Only use a tool when the provided context doesn't already answer the question.
- Output ONE use_tool per response, then STOP and wait for the result.
- After receiving tool results, answer the user's question directly — do NOT call another tool.
- Never use use_tool tags for anything other than these 4 tools.
- If you learn something worth remembering long-term (user preferences, corrections, key facts), proactively suggest saving it or use save_memory directly.
- Users can also save memories with *@memory <text>* in the chat.
`;

const WA_TOOL_CALL_RE = /<use_tool>([\s\S]*?)<\/use_tool>/g;

function parseWaToolCalls(text) {
  const calls = [];
  let match;
  while ((match = WA_TOOL_CALL_RE.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name && typeof parsed.name === 'string') {
        calls.push({ name: parsed.name, args: parsed.args || {} });
      }
    } catch { /* malformed JSON, skip */ }
  }
  WA_TOOL_CALL_RE.lastIndex = 0;
  return calls;
}

function stripToolCalls(text) {
  return text.replace(WA_TOOL_CALL_RE, '').trim();
}

const WA_TOOL_ALLOWLIST = new Set(['query_nodes', 'query_node', 'search_knowledge', 'save_memory']);
const WA_TOOL_RESULT_MAX = 3000;

async function executeWhatsAppTool({ name, args }) {
  if (!WA_TOOL_ALLOWLIST.has(name)) {
    return { tool: name, error: `Unknown tool: ${name}` };
  }
  try {
    let data;
    const fetchOpts = { signal: AbortSignal.timeout(10000) };

    switch (name) {
      case 'query_nodes': {
        const res = await fetch('http://localhost:3500/api/nodes/root', fetchOpts);
        if (!res.ok) return { tool: name, error: `API returned ${res.status}` };
        data = await res.json();
        break;
      }
      case 'query_node': {
        if (!args.id) return { tool: name, error: 'id is required' };
        const nodeId = encodeURIComponent(args.id);
        // Fetch node details and resources in parallel
        const [nodeRes, resRes] = await Promise.all([
          fetch(`http://localhost:3500/api/nodes/${nodeId}`, fetchOpts),
          fetch(`http://localhost:3500/api/nodes/${nodeId}/resources`, fetchOpts),
        ]);
        if (!nodeRes.ok) return { tool: name, error: `API returned ${nodeRes.status}` };
        const node = await nodeRes.json();
        const resources = resRes.ok ? await resRes.json() : [];
        data = { ...node, resources };
        break;
      }
      case 'search_knowledge': {
        if (!args.q) return { tool: name, error: 'q is required' };
        const res = await fetch(`http://localhost:3500/api/search?q=${encodeURIComponent(args.q)}`, fetchOpts);
        if (!res.ok) return { tool: name, error: `API returned ${res.status}` };
        data = await res.json();
        break;
      }
      case 'save_memory': {
        if (!args.text) return { tool: name, error: 'text is required' };
        const { saveMemory } = await import('./whatsapp-memory.js');
        data = await saveMemory(args.text, 'ai');
        break;
      }
    }

    // Format results to be concise
    const formatted = formatToolResult(name, data);
    if (formatted.length > WA_TOOL_RESULT_MAX) {
      return { tool: name, result: formatted.substring(0, WA_TOOL_RESULT_MAX) + '... [truncated]' };
    }
    return { tool: name, result: formatted };
  } catch (err) {
    return { tool: name, error: err.message };
  }
}

function formatToolResult(name, data) {
  switch (name) {
    case 'query_nodes': {
      // data is the root node with children — compact, max depth 2
      const lines = [];
      function walk(node, depth = 0) {
        const indent = '  '.repeat(depth);
        const rc = node.resource_count ?? '?';
        const cc = node.children?.length ?? 0;
        const parts = [`${rc} res`];
        if (cc > 0) parts.push(`${cc} sub`);
        lines.push(`${indent}${node.label} (${parts.join(', ')}) [${node.id}]`);
        if (depth < 2 && node.children) node.children.forEach(c => walk(c, depth + 1));
      }
      walk(data);
      return lines.join('\n');
    }
    case 'query_node': {
      const lines = [`*${data.label}* [id: ${data.id}]`];
      if (data.description) lines.push(`Description: ${data.description}`);
      const resources = data.resources || [];
      lines.push(`Resources: ${resources.length} total`);
      if (resources.length > 0) {
        const byType = {};
        resources.forEach(r => { byType[r.type] = (byType[r.type] || 0) + 1; });
        lines.push(`Breakdown: ${Object.entries(byType).map(([t, c]) => `${c} ${t}`).join(', ')}`);
        // Show first 15 resources
        resources.slice(0, 15).forEach(r => {
          const desc = r.description ? r.description.substring(0, 80) : r.url || '(no description)';
          lines.push(`  - [${r.type}] ${desc}`);
        });
        if (resources.length > 15) lines.push(`  ... and ${resources.length - 15} more`);
      }
      if (data.children?.length > 0) {
        lines.push(`Children: ${data.children.map(c => c.label).join(', ')}`);
      }
      return lines.join('\n');
    }
    case 'search_knowledge': {
      const results = Array.isArray(data) ? data : data.results || [];
      if (results.length === 0) return 'No results found.';
      return results.slice(0, 8).map(r => {
        const sim = r.similarity ? ` (${(parseFloat(r.similarity) * 100).toFixed(0)}%)` : '';
        const content = (r.content || '').substring(0, 120);
        return `[${r.node_label || 'unknown'}]${sim} ${content}`;
      }).join('\n');
    }
    case 'save_memory':
      return `Saved to memory: "${data.text}"`;
    default:
      return JSON.stringify(data).substring(0, WA_TOOL_RESULT_MAX);
  }
}

async function grokWithSearch(prompt, system, apiKey, model) {
  const res = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'grok-3-mini-fast',
      instructions: system,
      input: prompt,
      tools: [{ type: 'web_search' }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Grok API error: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const textOutput = data.output?.find(o => o.type === 'message');
  return textOutput?.content?.find(c => c.type === 'output_text')?.text
    || textOutput?.content?.[0]?.text
    || data.output_text
    || null;
}

function extractYouTubeId(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function getYouTubeTranscript(videoId) {
  const { execFile } = await import('child_process');
  return new Promise((resolve, reject) => {
    const script = `
from youtube_transcript_api import YouTubeTranscriptApi
try:
    ytt_api = YouTubeTranscriptApi()
    t = ytt_api.fetch("${videoId}")
    text = " ".join(s.text for s in t)
    print(text[:12000])
except Exception as e:
    print(f"ERROR: {e}")
`;
    const pythonPath = process.env.PYTHON_PATH || 'python3';
    execFile(pythonPath, ['-c', script], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(err.message));
      const out = stdout.trim();
      if (out.startsWith('ERROR:')) return reject(new Error(out));
      if (!out) return reject(new Error('Empty transcript'));
      resolve(out);
    });
  });
}

function extractXPostPath(url) {
  // Match x.com/user/status/id or twitter.com/user/status/id
  const m = url.match(/(?:x\.com|twitter\.com)\/([^/]+)\/status\/(\d+)/);
  return m ? { user: m[1], id: m[2] } : null;
}

async function getXPostContent(user, postId) {
  const res = await fetch(`https://api.fxtwitter.com/${user}/status/${postId}`);
  if (!res.ok) throw new Error(`fxtwitter returned ${res.status}`);
  const data = await res.json();
  const tweet = data.tweet;
  if (!tweet) throw new Error('No tweet data returned');

  const author = tweet.author?.name || user;
  const handle = tweet.author?.screen_name || user;
  let content = `@${handle} (${author}):\n${tweet.text || ''}`;

  if (tweet.quote) {
    content += `\n\nQuoted @${tweet.quote.author?.screen_name || '?'}:\n${tweet.quote.text || ''}`;
  }

  // Include engagement stats for context
  const likes = tweet.likes || 0;
  const retweets = tweet.retweets || 0;
  const replies = tweet.replies || 0;
  content += `\n\n[${likes.toLocaleString()} likes, ${retweets.toLocaleString()} retweets, ${replies.toLocaleString()} replies]`;

  return content;
}

async function summarizeWithProvider(url, alias, cfg) {
  // Grok has web search — can summarize from URL directly
  if (alias.provider === 'grok') {
    const apiKey = getApiKey(alias.provider, cfg);
    return grokWithSearch(`Summarize this URL: ${url}`, SUMMARIZE_SYSTEM, apiKey, alias.model);
  }

  // YouTube: pull transcript instead of scraping (page scrape returns garbage)
  const ytId = extractYouTubeId(url);
  if (ytId) {
    try {
      const transcript = await getYouTubeTranscript(ytId);
      console.log(`[whatsapp] YouTube transcript fetched for ${ytId} (${transcript.length} chars)`);
      const prompt = `Summarize this YouTube video transcript (${url}):\n\n${transcript.substring(0, 8000)}`;
      const apiKey = getApiKey(alias.provider, cfg);
      return callProvider(alias.provider, alias.model, prompt, SUMMARIZE_SYSTEM, apiKey, cfg);
    } catch (err) {
      console.warn(`[whatsapp] YouTube transcript failed for ${ytId}:`, err.message);
      // Fall through to regular scraping
    }
  }

  // X/Twitter: fetch via fxtwitter API (x.com scraping requires login)
  const xPost = extractXPostPath(url);
  if (xPost) {
    try {
      const content = await getXPostContent(xPost.user, xPost.id);
      console.log(`[whatsapp] X post fetched for ${xPost.user}/${xPost.id} (${content.length} chars)`);
      const prompt = `Summarize this X/Twitter post (${url}):\n\n${content}`;
      const apiKey = getApiKey(alias.provider, cfg);
      return callProvider(alias.provider, alias.model, prompt, SUMMARIZE_SYSTEM, apiKey, cfg);
    } catch (err) {
      console.warn(`[whatsapp] X post fetch failed:`, err.message);
      // Fall through to regular scraping
    }
  }

  // All other URLs: try scraping first, fall back to web search
  const scraped = await scrape(url);
  if (scraped && scraped.length > 100) {
    const prompt = `Summarize this content from ${url}:\n\n${scraped.substring(0, 8000)}`;
    const apiKey = getApiKey(alias.provider, cfg);
    return callProvider(alias.provider, alias.model, prompt, SUMMARIZE_SYSTEM, apiKey, cfg);
  }

  // Scraping failed or returned garbage — use web search to get context about the URL
  console.log(`[whatsapp] Scrape failed/thin for ${url}, falling back to web search`);
  try {
    const { results } = await performSearch(url, 5);
    if (results.length > 0) {
      const context = results.map(r => `${r.title}: ${r.snippet}`).join('\n\n');
      const prompt = `Summarize what this link is about based on web search results (${url}):\n\n${context}`;
      const apiKey = getApiKey(alias.provider, cfg);
      return callProvider(alias.provider, alias.model, prompt, SUMMARIZE_SYSTEM, apiKey, cfg);
    }
  } catch (err) {
    console.warn(`[whatsapp] Web search fallback failed for ${url}:`, err.message);
  }

  return `Could not fetch content from ${url}`;
}

async function chatWithProvider(text, alias, cfg, ragContext, history, { imageBase64, imageMime } = {}) {
  const historyBlock = history ? `${history}\n\n` : '';
  const contextBlock = ragContext ? `Relevant knowledge base context:\n${ragContext}\n\n` : '';

  // Web search for all providers (Grok already has built-in search, skip to avoid double-searching)
  let webBlock = '';
  if (alias.provider !== 'grok') {
    try {
      // Truncate query to first 200 chars — Brave returns 422 on long queries
      const searchQuery = text.length > 200 ? text.substring(0, 200) : text;
      const { results } = await performSearch(searchQuery, 3);
      if (results.length > 0) {
        const formatted = results.map(r => `- ${r.title}: ${r.snippet} (${r.url})`).join('\n');
        webBlock = `Web search results:\n${formatted}\n\n`;
      }
    } catch (err) {
      console.warn(`[whatsapp] Web search failed:`, err.message);
    }
  }

  const imageNote = imageBase64 ? '[An image is attached. Address BOTH the image AND the text below.]\n\n' : '';
  const prompt = `${historyBlock}${contextBlock}${webBlock}${imageNote}User question: ${text}`;
  if (history) {
    console.log(`[whatsapp] History injected (${history.split('\n').length - 1} messages):\n${history}`);
  } else {
    console.log(`[whatsapp] No history available for this message`);
  }
  const apiKey = getApiKey(alias.provider, cfg);
  const modelIdentity = `You are ${alias.tag} (${alias.provider}${alias.model ? ', model: ' + alias.model : ''}). Do not pretend to be a different AI.\n\n`;
  const chatCfg = await getConfig('chat') || {};
  const chatSystem = chatCfg.whatsappPrompt || DEFAULT_CHAT_SYSTEM;
  let systemWithTools = modelIdentity + chatSystem + '\n\n' + WHATSAPP_TOOLS;

  // Inject persistent memories into system prompt
  try {
    const { getMemories } = await import('./whatsapp-memory.js');
    const memories = await getMemories();
    if (memories.length > 0) {
      const memBlock = memories.map(m => `- ${m.text} (${m.date.split('T')[0]})`).join('\n');
      systemWithTools += `\n\n## Your Memory\nThese are facts you've saved from previous conversations:\n${memBlock}`;
    }
  } catch (err) {
    console.warn('[whatsapp] Failed to load memories:', err.message);
  }

  const imageOpts = imageBase64 && imageMime ? { imageBase64, imageMime } : {};

  // First call — AI may respond directly or use a tool
  let response = await callProvider(alias.provider, alias.model, prompt, systemWithTools, apiKey, cfg, imageOpts);
  if (!response) return response;

  // Check for tool calls in the response
  const toolCalls = parseWaToolCalls(response);
  if (toolCalls.length === 0) {
    // No tools used — strip any stray tags and return
    return stripToolCalls(response);
  }

  // Execute the first tool call only (max 1 per turn)
  const toolCall = toolCalls[0];
  console.log(`[whatsapp] Tool call: ${toolCall.name}(${JSON.stringify(toolCall.args)})`);
  const toolResult = await executeWhatsAppTool(toolCall);
  console.log(`[whatsapp] Tool result (${toolCall.name}): ${toolResult.error || toolResult.result?.substring(0, 200)}`);

  // Build follow-up prompt with tool results
  const resultBlock = toolResult.error
    ? `Tool error (${toolCall.name}): ${toolResult.error}`
    : `Tool result (${toolCall.name}):\n${toolResult.result}`;

  const followUp = `${prompt}\n\nYou previously called a tool. Here are the results:\n\n${resultBlock}\n\nNow answer the user's question using the tool results above. Do NOT call any more tools. Respond directly.`;

  // Second call — AI must answer with tool results, no more tool calls
  const finalResponse = await callProvider(alias.provider, alias.model, followUp, systemWithTools, apiKey, cfg);
  return stripToolCalls(finalResponse || '');
}

// ── URL processing + resource creation ──────────────────────────────────

async function processUrl(url, alias, cfg) {
  let summary;
  try {
    summary = await summarizeWithProvider(url, alias, cfg);
  } catch (err) {
    console.error(`[whatsapp] Summarize failed (${alias.provider}):`, err.message);
    summary = `Could not summarize — ${err.message}`;
  }

  const resource = await createResource({
    node_id: WHATSAPP_CAPTURES_ID,
    url,
    type: 'link',
    description: summary || 'Shared via WhatsApp',
    status: 'pending',
  });

  ingest(resource.id).catch(err => console.error(`[whatsapp] Ingest failed for ${resource.id}:`, err.message));

  return { summary, resourceId: resource.id };
}

async function processUrlWithContext(url, userText, alias, cfg) {
  // User provided substantial text alongside the URL — use it as the description
  // instead of scraping (YouTube etc. often return garbage)
  const truncated = userText.substring(0, 2000);
  const resource = await createResource({
    node_id: WHATSAPP_CAPTURES_ID,
    url,
    type: 'link',
    description: truncated,
    status: 'pending',
  });

  ingest(resource.id).catch(err => console.error(`[whatsapp] Ingest failed for ${resource.id}:`, err.message));

  // Summarize the user's own text rather than scraping the page
  let summary;
  try {
    const prompt = `Summarize this content shared in a WhatsApp group (from ${url}):\n\n${truncated}`;
    const apiKey = getApiKey(alias.provider, cfg);
    summary = await callProvider(alias.provider, alias.model, prompt, SUMMARIZE_SYSTEM, apiKey, cfg);
  } catch (err) {
    console.error(`[whatsapp] Summarize user context failed:`, err.message);
    summary = truncated.substring(0, 300) + '...';
  }

  return { summary, resourceId: resource.id };
}

// ── Node list for placement ─────────────────────────────────────────────

async function getNodeList() {
  const root = await getRootNode();
  if (!root) return [];

  const tree = await getNodeDeep(root.id, 2);
  const nodes = [];

  function walk(node, depth) {
    if (!node) return;
    if (node.id !== root.id && node.id !== WHATSAPP_CAPTURES_ID) {
      nodes.push({ id: node.id, label: node.label, depth });
    }
    if (node.children) {
      for (const child of node.children) walk(child, depth + 1);
    }
  }

  walk(tree, 0);
  return nodes;
}

async function suggestBasin(text, nodes) {
  try {
    const embedding = await embed(text);
    if (!embedding) return null;
    const chunks = await searchChunks(embedding, 20);
    if (chunks.length === 0) return null;

    // Tally similarity scores per node, pick the best
    const scores = new Map(); // nodeId → { total, count, label }
    const privateIds = await getPrivateNodeIds();
    const nodeIds = new Set(nodes.map(n => n.id));

    for (const c of chunks) {
      if (privateIds.has(c.node_id)) continue;
      if (!nodeIds.has(c.node_id)) continue; // only consider placeable basins
      const sim = parseFloat(c.similarity);
      if (sim < 0.3) continue; // ignore weak matches
      const entry = scores.get(c.node_id) || { total: 0, count: 0, label: c.node_label };
      entry.total += sim;
      entry.count += 1;
      scores.set(c.node_id, entry);
    }

    if (scores.size === 0) return null;

    // Score = weighted: best avg similarity * log(count+1) to reward depth of match
    let best = null;
    let bestScore = 0;
    for (const [id, entry] of scores) {
      const avg = entry.total / entry.count;
      const score = avg * Math.log2(entry.count + 1);
      if (score > bestScore) {
        bestScore = score;
        best = nodes.find(n => n.id === id);
      }
    }

    return best;
  } catch (err) {
    console.error('[whatsapp] suggestBasin failed:', err.message);
    return null;
  }
}

async function findNodesByName(query) {
  const nodes = await getNodeList();
  const q = query.toLowerCase();
  const exact = nodes.filter(n => n.label.toLowerCase() === q);
  if (exact.length > 0) return exact;
  return nodes.filter(n => n.label.toLowerCase().includes(q));
}

// ── Pending placements ──────────────────────────────────────────────────

const pendingPlacements = new Map();
const PLACEMENT_TTL = 5 * 60 * 1000;

// Image approval workflow: messageId → { sourceId, sourceApp, callbackUrl, timestamp }
const pendingImageApprovals = new Map();
const IMAGE_APPROVAL_TTL = 24 * 60 * 60 * 1000; // 24 hours

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingPlacements) {
    if (now - val.timestamp > PLACEMENT_TTL) pendingPlacements.delete(key);
  }
  for (const [key, val] of pendingImageApprovals) {
    if (now - val.timestamp > IMAGE_APPROVAL_TTL) pendingImageApprovals.delete(key);
  }
}, 60_000);

// ── Rate limiting ───────────────────────────────────────────────────────

const rateLimits = new Map(); // sender → [timestamp, ...]
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10;        // max 10 AI requests per sender per minute

function isRateLimited(sender) {
  const now = Date.now();
  const timestamps = (rateLimits.get(sender) || []).filter(t => now - t < RATE_LIMIT_WINDOW);
  rateLimits.set(sender, timestamps);
  if (timestamps.length >= RATE_LIMIT_MAX) return true;
  timestamps.push(now);
  return false;
}

// ── Text note & image capture ────────────────────────────────────────────

async function saveTextNote(text) {
  const resource = await createResource({
    node_id: WHATSAPP_CAPTURES_ID,
    type: 'note',
    content: text,
    description: text.substring(0, 200),
    status: 'pending',
  });
  ingest(resource.id).catch(err => console.error(`[whatsapp] Ingest failed for note ${resource.id}:`, err.message));
  return resource;
}

async function saveImage(msg, caption, cfg) {
  // Download media buffer
  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  const mime = msg.message.imageMessage.mimetype || 'image/jpeg';
  const ext = mime === 'image/png' ? 'png' : 'jpeg';

  // Write to uploads directory
  const subdir = WHATSAPP_CAPTURES_ID;
  await mkdir(join(UPLOADS_DIR, subdir), { recursive: true });
  const filename = `whatsapp-${Date.now()}.${ext}`;
  const filePath = join(UPLOADS_DIR, subdir, filename);
  await writeFile(filePath, buffer);

  const url = `/uploads/${subdir}/${filename}`;

  // Get AI description via Gemini Vision
  let description = caption;
  if (cfg.geminiApiKey) {
    try {
      const base64 = buffer.toString('base64');
      description = await geminiClient.describeImage(base64, mime, DESCRIBE_IMAGE_PROMPT, cfg.geminiApiKey);
    } catch (err) {
      console.error('[whatsapp] Gemini image description failed:', err.message);
      // Fall back to caption
    }
  }

  const resource = await createResource({
    node_id: WHATSAPP_CAPTURES_ID,
    type: 'file',
    url,
    description: description || 'Image shared via WhatsApp',
    content: caption || null,
    status: 'pending',
  });

  if (caption) {
    ingest(resource.id).catch(err => console.error(`[whatsapp] Ingest failed for image ${resource.id}:`, err.message));
  }

  return { resource, description };
}

// ── Message handler ─────────────────────────────────────────────────────

async function handleMessage(msg, groupJid, mode = 'full') {
  if (!sock) return;
  const jid = msg.key?.remoteJid;
  if (!jid || jid !== groupJid) return;
  // Skip messages the bot itself sent (avoid self-loops), but allow
  // fromMe messages — they come from the user's phone which shares the account.
  if (sentByBot.has(msg.key?.id)) {
    sentByBot.delete(msg.key.id);
    return;
  }

  const text = msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || '';
  if (!text.trim()) return;

  const sender = msg.key.participant || msg.key.remoteJid;
  if (isRateLimited(sender)) {
    console.log(`[whatsapp] Rate limited: ${sender}`);
    return;
  }

  // ── Image approval workflow: check if this is a reply to a pending approval ──
  const approvalQuotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
  if (approvalQuotedId && pendingImageApprovals.has(approvalQuotedId)) {
    const lower = text.trim().toLowerCase();
    const isApprove = /^(approve|approved|yes|ok|y)$/i.test(lower);
    const isReject = /^(reject|rejected|no|n)$/i.test(lower);
    if (isApprove || isReject) {
      const approval = pendingImageApprovals.get(approvalQuotedId);
      const tag = isApprove ? 'approved' : 'rejected';
      try {
        const resp = await fetch(`${approval.callbackUrl}/api/vault/${approval.sourceId}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: ['inference', tag] }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        await sendReply(jid, msg, `*${isApprove ? 'Approved' : 'Rejected'}* ✓`);
        pendingImageApprovals.delete(approvalQuotedId);
      } catch (err) {
        console.error('[whatsapp] Image approval callback failed:', err.message);
        await sendReply(jid, msg, `*System:* Failed to ${tag} — ${err.message}`);
      }
      return;
    }
  }

  // ── Chat-only mode: skip all capture/management commands ──
  if (mode === 'chat') {
    return handleChatOnly(msg, jid, text, sender);
  }

  // ── @memory: save to AI memory ──
  if (MEMORY_RE.test(text)) {
    const memText = text.replace(MEMORY_RE, '').trim();
    if (!memText) {
      await sendReply(jid, msg, '*System:* Usage: *@memory <text to remember>*\nExample: @memory I prefer concise answers with code examples');
      return;
    }
    try {
      const { saveMemory } = await import('./whatsapp-memory.js');
      await saveMemory(memText, 'user');
      await sendReply(jid, msg, `*System:* Saved to AI memory.`);
    } catch (err) {
      console.error('[whatsapp] Save memory failed:', err.message);
      await sendReply(jid, msg, `*System:* Failed to save memory: ${err.message}`);
    }
    return;
  }

  // ── @save: free-text note capture ──
  if (SAVE_RE.test(text)) {
    const noteText = text.replace(SAVE_RE, '').trim();
    if (!noteText) {
      await sendReply(jid, msg, '*System:* Usage: *@save <your note>*\nExample: @save Verizon AI Connect reusing data centers for inference');
      return;
    }
    try {
      await saveTextNote(noteText);
      await sendReply(jid, msg, `*System:* Saved to WhatsApp Captures.`);
    } catch (err) {
      console.error('[whatsapp] Save text note failed:', err.message);
      await sendReply(jid, msg, '*System:* Failed to save note. Try again in a moment.');
    }
    return;
  }

  // ── /basins or /subbasins: list node tree ──
  if (LIST_BASINS_RE.test(text)) {
    const showSubs = /^\/subbasins\b/i.test(text);
    try {
      const root = await getRootNode();
      const tree = await getNodeDeep(root.id, 2);
      const children = (tree.children || []).filter(
        c => c.id !== WHATSAPP_CAPTURES_ID && c.id !== '00000000-0000-0000-0000-000000000080'
      );
      if (children.length === 0) {
        await sendReply(jid, msg, '*System:* No basins yet. Create one with *@basin <name>*');
      } else {
        let reply = `*System — Basins:*`;
        children.forEach((c, i) => {
          const count = c.resource_count ?? '';
          reply += `\n${i + 1}. ${c.label}${count ? ` (${count})` : ''}`;
          if (showSubs && c.children) {
            c.children.forEach(sub => {
              const subCount = sub.resource_count ?? '';
              reply += `\n   └ ${sub.label}${subCount ? ` (${subCount})` : ''}`;
            });
          }
        });
        await sendReply(jid, msg, reply);
      }
    } catch (err) {
      console.error('[whatsapp] /basins failed:', err.message);
      await sendReply(jid, msg, '*System:* Failed to list basins.');
    }
    return;
  }

  // ── /morning: trigger morning briefing ──
  if (MORNING_RE.test(text)) {
    try {
      const { triggerNow } = await import('./morning-briefing.js');
      await sendReply(jid, msg, '*System:* Generating morning briefing...');
      const briefing = await triggerNow();
      if (briefing === null) {
        await sendReply(jid, msg, '*System:* Briefing is already running, hold tight.');
      }
      // Briefing is delivered via sendToGroup() inside generateBriefing, no need to send again
    } catch (err) {
      console.error('[whatsapp] /morning failed:', err.message);
      await sendReply(jid, msg, `*System:* Briefing failed — ${err.message}`);
    }
    return;
  }

  // ── @basin: create a new top-level basin ──
  if (BASIN_RE.test(text)) {
    const label = text.replace(BASIN_RE, '').trim();
    if (!label) {
      await sendReply(jid, msg, '*System:* Usage: *@basin <name>*\nExample: @basin AI Research');
      return;
    }
    try {
      const root = await getRootNode();
      await createNode({ parent_id: root.id, label });
      await sendReply(jid, msg, `*System:* Created *${label}* at the top level.`);
    } catch (err) {
      console.error('[whatsapp] @basin failed:', err.message);
      await sendReply(jid, msg, '*System:* Failed to create basin. Try again in a moment.');
    }
    return;
  }

  // ── @subbasin: create basin under a named parent ──
  if (SUBBASIN_RE.test(text)) {
    const args = text.replace(SUBBASIN_RE, '').trim();
    const sepIdx = args.indexOf(' > ');
    if (sepIdx === -1 || !args.substring(0, sepIdx).trim() || !args.substring(sepIdx + 3).trim()) {
      await sendReply(jid, msg, '*System:* Usage: *@subbasin <parent> > <name>*\nExample: @subbasin Projects > Logo Design');
      return;
    }
    const parentQuery = args.substring(0, sepIdx).trim();
    const label = args.substring(sepIdx + 3).trim();
    try {
      const matches = await findNodesByName(parentQuery);
      if (matches.length === 0) {
        await sendReply(jid, msg, `*System:* No basin matching *${parentQuery}* found.`);
      } else if (matches.length === 1) {
        const node = await createNode({ parent_id: matches[0].id, label });
        await sendReply(jid, msg, `*System:* Created *${label}* under *${matches[0].label}*.`);
      } else {
        let replyText = `*System:* Multiple basins match *${parentQuery}*. Which one?`;
        matches.forEach((n, i) => {
          replyText += `\n${i + 1}. ${n.label}`;
        });
        const sent = await sendReply(jid, msg, replyText);
        if (sent) {
          pendingPlacements.set(sent.key.id, {
            type: 'basin',
            label,
            nodes: matches,
            sender,
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      console.error('[whatsapp] @subbasin failed:', err.message);
      await sendReply(jid, msg, '*System:* Failed to create basin. Try again in a moment.');
    }
    return;
  }

  // ── Image with caption ──
  if (msg.message?.imageMessage && text.trim()) {
    const cfg = await getConfig('whatsapp') || {};
    const aliases = getAliases(cfg);
    const alias = resolveAlias(text, aliases);

    if (alias) {
      // Image + @alias → send image to AI for analysis
      if (alias.provider === 'ollama') {
        const ollamaUrl = await getConfig('ollama.url');
        cfg.ollamaUrl = ollamaUrl || 'http://localhost:11434';
      }
      const cleanText = text.replace(new RegExp(`@${alias.tag}\\b`, 'i'), '').trim() || 'Describe this image.';
      const providerLabel = PROVIDER_LABELS[alias.provider] || alias.tag.charAt(0).toUpperCase() + alias.tag.slice(1);

      if (alias.provider === 'claude-cli') {
        await sendReply(jid, msg, `*${providerLabel}:* Claude CLI doesn't support image analysis. Try a cloud provider like @gemini or @claude.`);
        return;
      }

      if (PROVIDER_NEEDS_KEY.has(alias.provider)) {
        const apiKey = getApiKey(alias.provider, cfg);
        if (!apiKey) {
          await sendReply(jid, msg, `*${providerLabel}:* Not configured. Add a ${providerLabel} API key in Idea Basin settings.`);
          return;
        }
      }

      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const mime = msg.message.imageMessage.mimetype || 'image/jpeg';
        const imageBase64 = buffer.toString('base64');
        const ragContext = await getRagContext(cleanText);
        const history = formatHistory(jid, msg.key?.id);
        const reply = await chatWithProvider(cleanText, alias, cfg, ragContext, history, { imageBase64, imageMime: mime });
        await sendReply(jid, msg, `*${providerLabel}:* ${reply}`, providerLabel);
      } catch (err) {
        console.error(`[whatsapp] Image + AI failed:`, err.message);
        await sendReply(jid, msg, `*${providerLabel}:* Sorry, couldn't analyse the image. Try again.`);
      }
      return;
    }

    // No alias — save image as before
    try {
      const { description } = await saveImage(msg, text.trim(), cfg);
      await sendReply(jid, msg, `*System:* Saved to WhatsApp Captures.\n\n*AI description:* ${description}`);
    } catch (err) {
      console.error('[whatsapp] Save image failed:', err.message);
      await sendReply(jid, msg, '*System:* Failed to save image. Try again in a moment.');
    }
    return;
  }

  const cfg = await getConfig('whatsapp') || {};

  // Check if this is a placement reply (quoted message response)
  const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
  if (quotedId && pendingPlacements.has(quotedId)) {
    const result = await handlePlacementReply(msg, text, quotedId);
    if (result === true || result === 'feedback') return;
  }

  // Check if this is a reply to the most recent placement (number or basin name)
  if (pendingPlacements.size > 0) {
    const entries = [...pendingPlacements.entries()];
    const latest = entries[entries.length - 1];
    if (latest && Date.now() - latest[1].timestamp < PLACEMENT_TTL) {
      const result = await handlePlacementReply(msg, text, latest[0]);
      if (result === true) return;
      if (result === 'feedback') return; // feedback was sent, stop processing
    }
  }

  const urls = extractUrls(text);
  const aliases = getAliases(cfg);
  let alias = resolveAlias(text, aliases);
  let explicit = !!alias;

  // URL auto-routing: if no explicit mention but URLs found, use defaultProvider alias
  if (!alias && urls.length > 0) {
    const defaultTag = cfg.defaultProvider || 'claude-cli';
    alias = aliases.find(a => a.tag === defaultTag || a.provider === defaultTag) || aliases[0];
    explicit = false;
  }

  if (!alias) return;

  // Fetch ollama URL from full config for ollama providers
  if (alias.provider === 'ollama') {
    const ollamaUrl = await getConfig('ollama.url');
    cfg.ollamaUrl = ollamaUrl || 'http://localhost:11434';
  }

  const cleanText = text.replace(new RegExp(`@${alias.tag}\\b`, 'i'), '').trim();
  const providerLabel = PROVIDER_LABELS[alias.provider] || alias.tag.charAt(0).toUpperCase() + alias.tag.slice(1);

  // Check if the cleaned text (after removing alias) is a placement reply
  if (pendingPlacements.size > 0) {
    const entries = [...pendingPlacements.entries()];
    const latest = entries[entries.length - 1];
    if (latest && Date.now() - latest[1].timestamp < PLACEMENT_TTL) {
      const result = await handlePlacementReply(msg, cleanText, latest[0]);
      if (result === true || result === 'feedback') return;
    }
  }

  // Check API key availability
  if (PROVIDER_NEEDS_KEY.has(alias.provider)) {
    const apiKey = getApiKey(alias.provider, cfg);
    if (!apiKey) {
      await sendReply(jid, msg, `*${providerLabel}:* Not configured. Add a ${providerLabel} API key in Idea Basin settings.`);
      return;
    }
  }

  try {
    if (urls.length > 0) {
      const url = urls[0];
      // If user provided substantial text alongside the URL (e.g. pasted a summary),
      // use their text as the description instead of scraping the (often useless) page
      const textWithoutUrl = cleanText.replace(URL_RE, '').trim();
      const userProvidedContext = !explicit && textWithoutUrl.length > 100;
      const { summary, resourceId } = userProvidedContext
        ? await processUrlWithContext(url, textWithoutUrl, alias, cfg)
        : await processUrl(url, alias, cfg);

      const nodes = await getNodeList();
      let suggested = null;

      let replyText = `*${providerLabel}:* ${summary}`;
      replyText += `\n\n*System:* Saved to WhatsApp Captures.`;

      if (nodes.length > 0) {
        suggested = await suggestBasin(summary, nodes);
        if (suggested) {
          replyText += `\n*Suggested basin:* ${suggested.label}`;
          replyText += `\nReply *yes* to move, or type a different basin name.`;
        } else {
          replyText += `\n*Move to a basin?* Reply with a basin name.`;
        }
      }

      const sent = await sendReply(jid, msg, replyText);
      if (sent && nodes.length > 0) {
        pendingPlacements.set(sent.key.id, {
          type: 'resource',
          resourceId,
          nodes,
          suggested,
          sender: msg.key.participant || msg.key.remoteJid,
          timestamp: Date.now(),
        });
      }
    } else {
      const ragContext = await getRagContext(cleanText);
      const history = formatHistory(jid, msg.key?.id);
      const reply = await chatWithProvider(cleanText, alias, cfg, ragContext, history);
      await sendReply(jid, msg, `*${providerLabel}:* ${reply}`, providerLabel);
    }
  } catch (err) {
    console.error(`[whatsapp] Error handling message:`, err.message);
    await sendReply(jid, msg, `*${providerLabel}:* Sorry, something went wrong. Try again in a moment.`);
  }
}

// ── Chat-only handler (no capture, no save, no placement — but supports images) ──

async function handleChatOnly(msg, jid, text, sender) {
  const cfg = await getConfig('whatsapp') || {};
  const aliases = getAliases(cfg);
  const alias = resolveAlias(text, aliases);
  if (!alias) return;

  // Fetch ollama URL for ollama providers
  if (alias.provider === 'ollama') {
    const ollamaUrl = await getConfig('ollama.url');
    cfg.ollamaUrl = ollamaUrl || 'http://localhost:11434';
  }

  const cleanText = text.replace(new RegExp(`@${alias.tag}\\b`, 'i'), '').trim() || (msg.message?.imageMessage ? 'Describe this image.' : '');
  const providerLabel = PROVIDER_LABELS[alias.provider] || alias.tag.charAt(0).toUpperCase() + alias.tag.slice(1);

  if (!cleanText) return;

  // Check API key availability
  if (PROVIDER_NEEDS_KEY.has(alias.provider)) {
    const apiKey = getApiKey(alias.provider, cfg);
    if (!apiKey) {
      await sendReply(jid, msg, `*${providerLabel}:* Not configured. Add a ${providerLabel} API key in Idea Basin settings.`);
      return;
    }
  }

  try {
    // Extract image if present
    let imageOpts = {};
    if (msg.message?.imageMessage) {
      if (alias.provider === 'claude-cli') {
        await sendReply(jid, msg, `*${providerLabel}:* Claude CLI doesn't support image analysis. Try a cloud provider like @gemini or @claude.`);
        return;
      }
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const mime = msg.message.imageMessage.mimetype || 'image/jpeg';
      imageOpts = { imageBase64: buffer.toString('base64'), imageMime: mime };
    }

    const ragContext = await getRagContext(cleanText);
    const history = formatHistory(jid, msg.key?.id);
    const reply = await chatWithProvider(cleanText, alias, cfg, ragContext, history, imageOpts);
    await sendReply(jid, msg, `*${providerLabel}:* ${reply}`, providerLabel);
  } catch (err) {
    console.error(`[whatsapp] Error in chat-only handler:`, err.message);
    await sendReply(jid, msg, `*${providerLabel}:* Sorry, something went wrong. Try again in a moment.`);
  }
}

async function handlePlacementReply(msg, text, placementId) {
  const placement = pendingPlacements.get(placementId);
  if (!placement) return false;

  const sender = msg.key.participant || msg.key.remoteJid;
  if (placement.sender && sender !== placement.sender) return false;

  const input = text.trim();
  let targetNode = null;

  // "yes" / "y" confirms the suggested basin
  if (/^(yes|y|yep|yeah|sure|ok)$/i.test(input) && placement.suggested) {
    targetNode = placement.suggested;
  }

  // Try numeric match
  if (!targetNode) {
    const num = parseInt(input, 10);
    if (!isNaN(num) && String(num) === input && num >= 1 && num <= placement.nodes.length) {
      targetNode = placement.nodes[num - 1];
    }
  }

  // Try name match if numeric didn't work
  if (!targetNode) {
    const q = input.toLowerCase();
    // Exact match first
    const exact = placement.nodes.find(n => n.label.toLowerCase() === q);
    if (exact) {
      targetNode = exact;
    } else {
      // Partial/contains match
      const partial = placement.nodes.filter(n => n.label.toLowerCase().includes(q));
      if (partial.length === 1) {
        targetNode = partial[0];
      } else if (partial.length > 1) {
        let reply = `*System:* Multiple basins match "${input}":`;
        partial.forEach((n, i) => reply += `\n${i + 1}. ${n.label}`);
        reply += `\nReply with the number.`;
        await sendReply(msg.key.remoteJid, msg, reply);
        return 'feedback';
      }
      // If no match at all, this might not be a placement reply — return false
      // so the message can be processed normally
      if (!targetNode) return false;
    }
  }

  try {
    if (placement.type === 'basin') {
      await createNode({ parent_id: targetNode.id, label: placement.label });
      pendingPlacements.delete(placementId);
      await sendReply(msg.key.remoteJid, msg, `*System:* Created *${placement.label}* under *${targetNode.label}*.`);
    } else {
      await updateResource(placement.resourceId, { node_id: targetNode.id });
      pendingPlacements.delete(placementId);
      await sendReply(msg.key.remoteJid, msg, `*System:* Moved to *${targetNode.label}*.`);
    }
    return true;
  } catch (err) {
    console.error(`[whatsapp] Placement failed:`, err.message);
    await sendReply(msg.key.remoteJid, msg, `*System:* Failed to move — ${err.message}`);
    return 'feedback';
  }
}

async function markOffline() {
  try { await sock?.sendPresenceUpdate('unavailable'); } catch {}
}

async function sendReply(jid, quotedMsg, text, botLabel) {
  if (!sock) return null;
  try {
    const sent = await sock.sendMessage(jid, { text }, { quoted: quotedMsg });
    if (sent?.key?.id) sentByBot.set(sent.key.id, Date.now());
    // Record bot reply in history buffer
    if (botLabel) {
      pushHistory(jid, { sender: botLabel, text: text.slice(0, 500), isBot: true, timestamp: Date.now(), msgId: sent?.key?.id });
    }
    // Re-mark offline after every send so WhatsApp doesn't flip us to "online"
    markOffline();
    return sent;
  } catch (err) {
    console.error(`[whatsapp] Send failed:`, err.message);
    return null;
  }
}

// ── Exported helpers for briefing service ────────────────────────────────

export { callProvider, getApiKey };

export async function sendToGroup(text) {
  if (!sock || botState.status !== 'connected') {
    console.warn('[whatsapp] sendToGroup: not connected');
    return null;
  }
  const cfg = await getConfig('whatsapp') || {};
  const groupJid = cfg.groupJid;
  if (!groupJid) {
    console.warn('[whatsapp] sendToGroup: no group configured');
    return null;
  }
  try {
    const sent = await sock.sendMessage(groupJid, { text });
    if (sent?.key?.id) sentByBot.set(sent.key.id, Date.now());
    markOffline();
    return sent;
  } catch (err) {
    console.error('[whatsapp] sendToGroup failed:', err.message);
    return null;
  }
}

export async function sendImageToGroup(imageBuffer, caption) {
  if (!sock || botState.status !== 'connected') {
    console.warn('[whatsapp] sendImageToGroup: not connected');
    return null;
  }
  const cfg = await getConfig('whatsapp') || {};
  const groupJid = cfg.groupJid;
  if (!groupJid) {
    console.warn('[whatsapp] sendImageToGroup: no group configured');
    return null;
  }
  try {
    const sent = await sock.sendMessage(groupJid, { image: imageBuffer, caption });
    if (sent?.key?.id) sentByBot.set(sent.key.id, Date.now());
    markOffline();
    return sent;
  } catch (err) {
    console.error('[whatsapp] sendImageToGroup failed:', err.message);
    return null;
  }
}

export function addPendingImageApproval(messageId, { sourceId, sourceApp, callbackUrl }) {
  pendingImageApprovals.set(messageId, {
    sourceId,
    sourceApp,
    callbackUrl,
    timestamp: Date.now(),
  });
}

// ── Connection lifecycle ─────────────────────────────────────────────────

async function connectBot(groupJid, chatGroupJid) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const logger = pino({ level: 'warn' });

  botState = { status: 'connecting', qrDataUrl: null, groups: [] };

  // Fetch current WhatsApp version to avoid 405 "Method Not Allowed" errors
  // when the default version baked into Baileys becomes outdated
  let version;
  try {
    const result = await fetchLatestBaileysVersion();
    version = result.version;
    console.log(`[whatsapp] Using WA version: ${version.join('.')}`);
  } catch (err) {
    console.warn('[whatsapp] Could not fetch latest version, using default:', err.message);
  }

  sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
    ...(version && { version }),
  });

  // Use ev.process() for all event handling — the Baileys v7 recommended pattern.
  // Individual ev.on() listeners can miss events due to the internal buffer system.
  sock.ev.process(async (events) => {
    if (events['creds.update']) {
      await saveCreds();
    }

    if (events['connection.update']) {
      const { connection, lastDisconnect, qr } = events['connection.update'];

      if (qr) {
        try {
          const dataUrl = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
          botState = { ...botState, status: 'qr', qrDataUrl: dataUrl };
          console.log('[whatsapp] QR code ready — scan from Settings or phone');
        } catch (err) {
          console.error('[whatsapp] QR generation failed:', err.message);
        }
      }

      if (connection === 'open') {
        botState = { ...botState, status: 'connected', qrDataUrl: null, lastError: null, reconnectAttempts: 0 };
        console.log('[whatsapp] Connected');

        // Mark as offline so the user's phone gets notifications.
        // Must be repeated periodically — a single call isn't enough.
        try {
          await sock.sendPresenceUpdate('unavailable');
          console.log('[whatsapp] Presence set to unavailable');
        } catch (err) {
          console.error('[whatsapp] Failed to set presence:', err.message);
        }
        if (presenceInterval) clearInterval(presenceInterval);
        presenceInterval = setInterval(() => {
          sock?.sendPresenceUpdate('unavailable').catch(() => {});
        }, 5 * 60_000); // every 5 minutes

        try {
          const groups = await sock.groupFetchAllParticipating();
          botState.groups = Object.values(groups).map(g => ({
            id: g.id,
            name: g.subject || '(unnamed)',
          }));
          console.log(`[whatsapp] Found ${botState.groups.length} groups`);
        } catch (err) {
          console.error('[whatsapp] Failed to fetch groups:', err.message);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMsg = lastDisconnect?.error?.output?.payload?.message || lastDisconnect?.error?.message || '';
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          botState = { status: 'disconnected', qrDataUrl: null, groups: [], lastError: 'Logged out by WhatsApp', reconnectAttempts: 0 };
          console.log('[whatsapp] Logged out — clearing stale auth so next connect gets a fresh QR');
          rm(AUTH_DIR, { recursive: true, force: true }).catch(() => {});
        } else if (!stopping) {
          const attempts = (botState.reconnectAttempts || 0) + 1;
          const delay = Math.min(5000 * Math.pow(2, attempts - 1), 60_000); // 5s → 10s → 20s → 40s → 60s cap
          botState = { ...botState, status: 'connecting', lastError: `${statusCode} ${errorMsg}`.trim(), reconnectAttempts: attempts };
          console.log(`[whatsapp] Disconnected (code ${statusCode}), attempt ${attempts}, reconnecting in ${delay / 1000}s...`);

          // Give up after 5 failed attempts — likely needs re-pairing
          if (attempts >= 5) {
            botState = { ...botState, status: 'error', lastError: `Connection failed after ${attempts} attempts (${statusCode} ${errorMsg}). Re-pair required.` };
            console.error(`[whatsapp] Giving up after ${attempts} attempts — re-pair from Settings`);
          } else {
            setTimeout(() => connectBot(groupJid, chatGroupJid), delay);
          }
        } else {
          botState = { status: 'disconnected', qrDataUrl: null, groups: [], lastError: null, reconnectAttempts: 0 };
        }
      }
    }

    if (events['messages.upsert']) {
      const { messages, type } = events['messages.upsert'];

      for (const m of messages) {
        if (type !== 'notify') continue;
        const jid = m.key?.remoteJid;

        // Record incoming message in history buffer (skip bot's own messages)
        if (jid && !sentByBot.has(m.key?.id)) {
          const msgText = m.message?.conversation
            || m.message?.extendedTextMessage?.text
            || m.message?.imageMessage?.caption
            || '';
          if (msgText.trim()) {
            const pushName = m.pushName || m.key.participant || 'Unknown';
            pushHistory(jid, { sender: pushName, text: msgText.slice(0, 500), isBot: false, timestamp: Date.now(), msgId: m.key?.id });
          }
        }

        try {
          if (groupJid && jid === groupJid) {
            await handleMessage(m, groupJid, 'full');
          } else if (chatGroupJid && jid === chatGroupJid) {
            await handleMessage(m, chatGroupJid, 'chat');
          }
        } catch (err) {
          console.error('[whatsapp] Unhandled error in message handler:', err.message);
        }
      }
    }
  });
}

export async function startBot() {
  const cfg = await getConfig('whatsapp');
  if (!cfg?.enabled) {
    console.log('[whatsapp] Bot disabled (set whatsapp.enabled = true in config)');
    return;
  }

  stopping = false;
  console.log('[whatsapp] Starting bot...');
  await connectBot(cfg.groupJid || '', cfg.chatGroupJid || '');
}

export async function stopBot() {
  stopping = true;
  if (presenceInterval) { clearInterval(presenceInterval); presenceInterval = null; }
  if (sock) {
    sock.end(undefined);
    sock = null;
  }
  botState = { status: 'disconnected', qrDataUrl: null, groups: [], lastError: null, reconnectAttempts: 0 };
  console.log('[whatsapp] Bot stopped');
}

export async function refreshGroups() {
  if (!sock || botState.status !== 'connected') return botState.groups;
  try {
    const groups = await sock.groupFetchAllParticipating();
    botState.groups = Object.values(groups).map(g => ({
      id: g.id,
      name: g.subject || '(unnamed)',
    }));
    console.log(`[whatsapp] Refreshed: ${botState.groups.length} groups`);
  } catch (err) {
    console.error('[whatsapp] Failed to refresh groups:', err.message);
  }
  return botState.groups;
}

export async function disconnectBot() {
  await stopBot();
  // Clear auth so next connect gets a fresh QR
  try {
    await rm(AUTH_DIR, { recursive: true, force: true });
    console.log('[whatsapp] Auth cleared');
  } catch {}
}
