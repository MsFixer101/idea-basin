import { execFile, execFileSync } from 'child_process';
import { writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import pool from '../db/pool.js';
import { embed } from './embedder.js';
import { ingest } from '../workers/ingest.js';
import {
  searchChunks,
  getNodeWithChildren,
  getResourcesForNode,
  createNode,
  createResource,
  getNode,
  getCrossRefs,
  createCrossRef,
} from '../db/queries.js';
import { readFileContent } from './scanner.js';
import { performSearch } from './web-search.js';
import { searchPapers } from './academic-search.js';
import { runResearch } from './research-agents.js';

import { homedir } from 'os';
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || join(homedir(), 'idea-basin-artifacts');
export const ARTIFACTS_NODE_ID = '00000000-0000-0000-0000-000000000080';

// ── Tool definitions (injected into system prompt) ─────────────────────

export const TOOL_DEFINITIONS = `
You have tools available. To use a tool, output a tool_call block:
<tool_call>{"name": "tool_name", "args": {"key": "value"}}</tool_call>

Available tools:

1. search_knowledge — Search the knowledge base using semantic similarity.
   Args: { "query": "search text", "node_id": "optional uuid", "limit": 5 }

2. list_nodes — List all nodes in the knowledge base with resource counts.
   Args: none — use {}

3. get_node — Get details about a specific node including children and resources.
   Args: { "node_id": "uuid" }

4. create_node — Create a new node in the knowledge base.
   Args: { "parent_id": "uuid", "label": "name", "description": "optional", "color": "optional hex" }

5. add_resource — Add a resource (note, idea, link, etc.) to a node. Content stays in the database only.
   Args: { "node_id": "uuid", "type": "note|idea|link|research|video|code", "content": "text content", "url": "optional url", "why": "optional reason" }

6. save_resource — Save content as a .md file on disk AND add it as a resource. Use this when the user pastes text they want to keep as a readable file. The file is saved to ~/idea-basin-artifacts/<node-label>/.
   Args: { "node_id": "uuid", "title": "filename without extension", "content": "the full text content", "type": "note|idea|research", "why": "optional reason" }

7. read_file — Read the contents of a local file (restricted to /Users/).
   Args: { "path": "/absolute/path/to/file" }

8. open_file — Open a local file in the default application (restricted to /Users/).
   Args: { "path": "/absolute/path/to/file" }

9. create_crossref — Create a cross-reference (link) between two related nodes.
   Args: { "source_node_id": "uuid", "target_node_id": "uuid", "reason": "why they're related" }

10. list_crossrefs — List all cross-references for a given node.
    Args: { "node_id": "uuid" }

11. internet_search — Search the web for current information, recent developments, or topics not in the knowledge base.
    Args: { "query": "search terms", "num_results": 5 }

12. create_artifact — Create a rich document (markdown, code, HTML) that is saved to disk and added to the knowledge base. Use this when producing substantial content like research summaries, code, guides, or detailed analysis.
    Args: { "node_id": "optional uuid (defaults to Artifacts node)", "title": "document title", "type": "markdown|code|html|text", "content": "the full document content" }

13. search_files — Search for files on the local machine by name pattern. Returns matching file paths with size and modification date. Restricted to /Users/.
    Args: { "directory": "/Users/you/Documents", "pattern": "*.pdf", "max_results": 20 }

14. fetch_url — Fetch a web page and return its text content. Use this to read articles, papers, documentation, or any URL the user provides. Essential for reading arxiv abstracts, blog posts, etc.
    Args: { "url": "https://arxiv.org/abs/2502.03783" }

15. search_papers — Search academic papers on Semantic Scholar and arXiv. Returns real papers with titles, abstracts, authors, citation counts, and DOIs.
    Args: { "query": "search terms", "source": "all|semantic_scholar|arxiv", "limit": 5, "year": "2024-2026" }

16. deep_research — Launch parallel research sub-agents for thorough investigation of a topic. Each agent searches independently (papers, web, knowledge base) and findings are synthesized into a comprehensive artifact. Use this for broad research questions that benefit from multiple angles of investigation.
    Args: { "question": "The main research question", "tasks": [{ "id": "papers_ss", "description": "what to investigate", "tools": ["search_papers", "fetch_url"], "focus": "specific angle" }], "node_id": "optional uuid for saving the artifact" }

Your available tools are ONLY the 16 listed above. To search the web, use internet_search. To read a specific URL, use fetch_url. To find local files, use search_files. To search academic papers, use search_papers. For thorough multi-angle research, use deep_research. All tools work immediately — no permissions or approval needed.

Rules for tool use:
- You may call multiple tools in sequence — after each tool result, decide if you need more.
- You have a maximum of 20 tool calls per conversation turn, so you can do thorough research across multiple searches and saves.
- Always search_knowledge before answering questions about the knowledge base.
- When creating nodes or resources, confirm what you did in your response.
- Only output ONE tool_call per response. Wait for the result before calling another.
- When a user pastes text content they want to keep, use save_resource (not add_resource) so it creates a real .md file on disk they can read later. Use add_resource only for quick notes or URLs.
- Give the file a descriptive title based on the content (not the user's message).
- To look up anything on the internet (papers, current events, unfamiliar topics), use internet_search.
- When the user provides a URL, ALWAYS use fetch_url to read its content before summarizing or storing it. Never guess what a URL contains.
- After an internet_search, review the results carefully. Only store results that are genuinely relevant to what was asked. Use fetch_url to verify a result's content if the snippet is ambiguous. Do not blindly save every search result.
- When producing substantial content (research summaries, code, guides, detailed analysis), use create_artifact to present it as a formatted document that is saved to the knowledge base.
`;

// ── Tool executors ─────────────────────────────────────────────────────

export const toolExecutors = {
  async search_knowledge({ query, node_id, limit }) {
    const embedding = await embed(query);
    if (!embedding) return { error: 'Embedding failed — is the embedding provider configured?' };
    const results = await searchChunks(embedding, limit || 5, node_id || null);
    return results.map(r => ({
      content: r.content?.substring(0, 600),
      similarity: parseFloat(r.similarity).toFixed(3),
      node: r.node_label,
      resource_type: r.type,
      url: r.url,
      description: r.resource_description,
    }));
  },

  async list_nodes() {
    const { rows } = await pool.query(`
      SELECT n.id, n.label, n.description, n.color, n.parent_id,
        (SELECT count(*)::int FROM resources r WHERE r.node_id = n.id) as resource_count,
        (SELECT count(*)::int FROM nodes c WHERE c.parent_id = n.id) as child_count
      FROM nodes n ORDER BY n.created_at
    `);
    return rows;
  },

  async get_node({ node_id }) {
    if (!node_id) return { error: 'node_id is required' };
    const node = await getNodeWithChildren(node_id);
    if (!node) return { error: 'Node not found' };
    const resources = await getResourcesForNode(node_id);
    return {
      ...node,
      resources: resources.map(r => ({
        id: r.id,
        type: r.type,
        url: r.url,
        description: r.description,
        why: r.why,
        status: r.status,
        tags: r.tags,
      })),
    };
  },

  async create_node({ parent_id, label, description, color }) {
    if (!parent_id || !label) return { error: 'parent_id and label are required' };
    const node = await createNode({ parent_id, label, description, color });
    return { created: true, id: node.id, label: node.label };
  },

  async add_resource({ node_id, type, url, content, why }) {
    if (!node_id || !type) return { error: 'node_id and type are required' };
    const resource = await createResource({ node_id, url, type, why, content, status: 'pending' });
    if (content) {
      ingest(resource.id).catch(err => console.error('Ingestion failed:', err.message));
    }
    return { created: true, id: resource.id, type: resource.type };
  },

  async save_resource({ node_id, title, content, type, why }) {
    if (!node_id || !title || !content) return { error: 'node_id, title, and content are required' };

    // Get node label for folder name
    const node = await getNode(node_id);
    if (!node) return { error: 'Node not found' };

    // Sanitize folder/file names
    const folderName = node.label.replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
    const fileName = title.replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
    const dir = join(ARTIFACTS_DIR, folderName);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, `${fileName}.md`);
    await writeFile(filePath, content, 'utf-8');

    // Create resource with file:// URL so it can be opened
    const resource = await createResource({
      node_id,
      url: `file://${filePath}`,
      type: type || 'research',
      why: why || `Saved artifact: ${title}`,
      content,
      status: 'pending',
    });

    // Trigger ingestion (chunking + embedding)
    ingest(resource.id).catch(err => console.error('Ingestion failed:', err.message));

    // Link to Artifacts node so it appears in the white circle
    if (node_id !== ARTIFACTS_NODE_ID) {
      try {
        await createResource({
          node_id: ARTIFACTS_NODE_ID,
          url: `file://${filePath}`,
          type: 'research',
          why: `Artifact: ${title}`,
          content,
          status: 'ready',
        });
      } catch (err) {
        console.error('Artifact link failed:', err.message);
      }
    }

    return { saved: true, path: filePath, resource_id: resource.id };
  },

  async read_file({ path: userPath }) {
    if (!userPath || typeof userPath !== 'string') return { error: 'path is required' };
    const { resolve } = await import('path');
    const resolved = resolve(userPath);
    if (!resolved.startsWith('/Users/')) return { error: 'Path must be under /Users/' };
    const content = await readFileContent(resolved);
    if (content === null) return { error: 'Could not read file' };
    return { path: resolved, content };
  },

  async create_crossref({ source_node_id, target_node_id, reason }) {
    if (!source_node_id || !target_node_id) return { error: 'source_node_id and target_node_id are required' };
    const ref = await createCrossRef({ source_node_id, target_node_id, reason });
    return { created: true, id: ref.id, source_node_id: ref.source_node_id, target_node_id: ref.target_node_id, reason: ref.reason };
  },

  async list_crossrefs({ node_id }) {
    if (!node_id) return { error: 'node_id is required' };
    const refs = await getCrossRefs(node_id);
    return refs.map(r => ({
      id: r.id,
      source_node_id: r.source_node_id,
      source_label: r.source_label,
      source_color: r.source_color,
      target_node_id: r.target_node_id,
      target_label: r.target_label,
      target_color: r.target_color,
      reason: r.reason,
    }));
  },

  async internet_search({ query, num_results }) {
    if (!query) return { error: 'query is required' };
    try {
      const { results, provider } = await performSearch(query, num_results || 5);
      return { results, provider };
    } catch (err) {
      return { error: `Search failed: ${err.message}` };
    }
  },

  async create_artifact({ node_id, title, type, content }) {
    if (!title || !content) return { error: 'title and content are required' };
    if (!node_id) node_id = ARTIFACTS_NODE_ID;
    if (!type) type = 'markdown';

    // Reuse save_resource logic
    const node = await getNode(node_id);
    if (!node) return { error: 'Node not found' };

    const folderName = node.label.replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
    const fileName = title.replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
    const dir = join(ARTIFACTS_DIR, folderName);
    await mkdir(dir, { recursive: true });

    const ext = type === 'code' ? '.txt' : type === 'html' ? '.html' : '.md';
    const filePath = join(dir, `${fileName}${ext}`);
    await writeFile(filePath, content, 'utf-8');

    const resource = await createResource({
      node_id,
      url: `file://${filePath}`,
      type: 'research',
      why: `Artifact: ${title}`,
      content,
      status: 'pending',
    });

    ingest(resource.id).catch(err => console.error('Ingestion failed:', err.message));

    // Mirror to Artifacts node so it appears in the white circle
    if (node_id !== ARTIFACTS_NODE_ID) {
      try {
        await createResource({
          node_id: ARTIFACTS_NODE_ID,
          url: `file://${filePath}`,
          type: 'research',
          why: `Artifact: ${title}`,
          content,
          status: 'ready',
        });
      } catch (err) {
        console.error('Artifact mirror failed:', err.message);
      }
    }

    return { id: resource.id, title, type, content, path: filePath };
  },

  async fetch_url({ url }) {
    if (!url) return { error: 'url is required' };
    if (!url.startsWith('http://') && !url.startsWith('https://')) return { error: 'url must start with http:// or https://' };
    // Block private/reserved IPs and metadata endpoints (SSRF protection)
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
          host.startsWith('10.') || host.startsWith('192.168.') ||
          host === '169.254.169.254' || host === 'metadata.google.internal' ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
        return { error: 'Cannot fetch private/internal URLs' };
      }
    } catch { return { error: 'Invalid URL' }; }

    try {
      // For arxiv abstract pages, use the abs URL (not pdf)
      let fetchUrl = url;
      if (url.includes('arxiv.org/pdf/')) {
        fetchUrl = url.replace('/pdf/', '/abs/');
      }

      const response = await fetch(fetchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,text/plain',
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });

      if (!response.ok) return { error: `HTTP ${response.status}: ${response.statusText}` };

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/pdf')) {
        return { url, note: 'This URL points to a PDF. Use the /abs/ URL instead for readable text.' };
      }

      const html = await response.text();

      // Strip HTML tags, scripts, styles to get text
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

      // Truncate to avoid huge payloads
      const truncated = text.length > 8000 ? text.substring(0, 8000) + '... [truncated]' : text;

      return { url: fetchUrl, content: truncated, length: text.length };
    } catch (err) {
      return { error: `Fetch failed: ${err.message}` };
    }
  },

  async search_files({ directory, pattern, max_results }) {
    if (!directory) return { error: 'directory is required' };
    const { resolve: resolvePath } = await import('path');
    directory = resolvePath(directory);
    if (!directory.startsWith('/Users/')) return { error: 'directory must be under /Users/' };
    if (!pattern) pattern = '*';
    const limit = Math.min(max_results || 20, 50);

    try {
      // Use find with -iname for case-insensitive glob matching, max depth 5
      const args = [directory, '-maxdepth', '5', '-iname', pattern, '-not', '-path', '*/.*', '-not', '-path', '*/node_modules/*'];
      let output = execFileSync('find', args, { timeout: 10000, maxBuffer: 1024 * 1024 }).toString().trim();
      // Limit results
      const lines = output.split('\n').filter(Boolean);
      output = lines.slice(0, limit).join('\n');
      if (!output) return { files: [], message: 'No files found matching that pattern' };

      const paths = output.split('\n');
      const files = [];
      for (const p of paths) {
        try {
          const s = await stat(p);
          files.push({
            path: p,
            size: s.size > 1048576 ? `${(s.size / 1048576).toFixed(1)} MB` : `${(s.size / 1024).toFixed(0)} KB`,
            modified: s.mtime.toISOString().split('T')[0],
          });
        } catch {
          files.push({ path: p });
        }
      }
      return { files, count: files.length };
    } catch (err) {
      return { error: `Search failed: ${err.message}` };
    }
  },

  async search_papers({ query, source, limit, year }) {
    if (!query) return { error: 'query is required' };
    try {
      const papers = await searchPapers(query, {
        source: source || 'all',
        limit: limit || 5,
        year: year || undefined,
      });
      return { papers, count: papers.length };
    } catch (err) {
      return { error: `Paper search failed: ${err.message}` };
    }
  },

  // deep_research executor — needs SSE callback, so it returns a function wrapper.
  // The actual executor is wired in chat.js with the SSE callback.
  async deep_research({ question, tasks, node_id }, sseCallback, signal) {
    if (!question) return { error: 'question is required' };
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      // Auto-generate a sensible task plan if none provided
      tasks = [
        { id: 'papers_1', description: `Search academic papers about: ${question}`, tools: ['search_papers', 'fetch_url'], focus: 'key papers and citations' },
        { id: 'papers_2', description: `Search arXiv preprints about: ${question}`, tools: ['search_papers'], focus: 'recent preprints' },
        { id: 'web', description: `Search the web for recent developments on: ${question}`, tools: ['internet_search', 'fetch_url'], focus: 'blog posts, benchmarks, practical applications' },
        { id: 'kb', description: `Search the knowledge base for existing information on: ${question}`, tools: ['search_knowledge', 'list_nodes', 'get_node'], focus: 'what we already know' },
      ];
    }
    try {
      const result = await runResearch(question, tasks, node_id || null, sseCallback, signal);
      return result;
    } catch (err) {
      return { error: `Research failed: ${err.message}` };
    }
  },

  async open_file({ path: userPath }) {
    if (!userPath || typeof userPath !== 'string') return { error: 'path is required' };
    const { resolve: resolvePath } = await import('path');
    const resolved = resolvePath(userPath);
    if (!resolved.startsWith('/Users/')) return { error: 'Path must be under /Users/' };
    return new Promise((resolve) => {
      execFile('open', [resolved], (err) => {
        if (err) resolve({ error: err.message });
        else resolve({ opened: true, path: resolved });
      });
    });
  },
};

// ── Response parsing ───────────────────────────────────────────────────

const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;

export function parseToolCalls(text) {
  const calls = [];
  let match;
  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name && typeof parsed.name === 'string') {
        calls.push({ name: parsed.name, args: parsed.args || {} });
      }
    } catch {
      // malformed JSON, skip
    }
  }
  TOOL_CALL_RE.lastIndex = 0; // reset regex state
  return calls;
}

export function extractText(text) {
  return text.replace(TOOL_CALL_RE, '').trim();
}
