import { Router } from 'express';
import { scanDirectory, readFileContent } from '../services/scanner.js';
import { generateTags, generateSummary } from '../services/tagger.js';
import { getClassifier } from '../services/ai-provider.js';
import { classifyBySimilarity } from '../services/embedded-model.js';
import * as db from '../db/queries.js';
import pool from '../db/pool.js';

const router = Router();

// POST /api/scan — scan a directory and classify files against nodes
router.post('/', async (req, res) => {
  try {
    const { path: dirPath, max_depth } = req.body;
    if (!dirPath) return res.status(400).json({ error: 'path required' });

    const apiKey = req.headers['x-api-key'] || null;

    // Get all nodes for classification
    const { rows: allNodes } = await pool.query(
      'SELECT id, label, description, why, parent_id FROM nodes ORDER BY created_at'
    );

    // Scan the directory
    console.log(`[scan] Scanning ${dirPath}...`);
    const files = await scanDirectory(dirPath, { maxDepth: max_depth || 4 });
    console.log(`[scan] Found ${files.length} files`);

    if (files.length === 0) {
      return res.json({ files: [], suggestions: [] });
    }

    // Read previews for each file (first 500 chars)
    for (const f of files) {
      const content = await readFileContent(f.path);
      f.preview = content?.substring(0, 500) || '';
    }

    // Get the classifier
    const classifier = await getClassifier(apiKey);
    const suggestions = [];

    if (classifier.type === 'embedded') {
      // Embedded model: cosine similarity matching
      console.log('[scan] Using embedded model for classification');
      const nodeList = allNodes.map(n => ({
        id: n.id, label: n.label,
        description: n.description || '', why: n.why || '',
      }));
      const fileList = files.map(f => ({
        path: f.path, name: f.name,
        preview: f.preview.substring(0, 300),
      }));

      const matches = await classifyBySimilarity(fileList, nodeList);
      for (const m of matches) {
        const file = files.find(f => f.path === m.path);
        const node = allNodes.find(n => n.id === m.node_id);
        if (file && node) {
          suggestions.push({
            path: m.path,
            name: file.name,
            size: file.size,
            modified: file.modified,
            preview: file.preview.substring(0, 200),
            node_id: m.node_id,
            node_label: node.label,
            reason: m.reason,
          });
        }
      }
    } else {
      // LLM-based classification (Ollama, Claude, OpenAI)
      console.log(`[scan] Using ${classifier.type} for classification`);
      const batchSize = 20;

      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);

        const nodeList = allNodes.map(n => ({
          id: n.id, label: n.label,
          description: n.description || '', why: n.why || '',
        }));

        const fileList = batch.map(f => ({
          path: f.path, name: f.name,
          preview: f.preview.substring(0, 300),
        }));

        const system = `You are a file classifier. Match each file to the most relevant node using ONLY the exact node IDs provided. Respond in English only.
Rules:
- Use the exact UUID from the NODES list for node_id. Do NOT invent IDs.
- If a file doesn't clearly belong to any node, set node_id to null.
- Return ONLY a JSON array: [{"path": "...", "node_id": "<exact UUID>" or null, "reason": "5 words max"}]
- No explanation, no markdown, just the JSON array.`;

        const prompt = `NODES:\n${JSON.stringify(nodeList)}\n\nFILES:\n${JSON.stringify(fileList)}`;

        const result = await classifier.classify(prompt, system);
        if (result) {
          try {
            const match = result.match(/\[[\s\S]*\]/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              for (const s of parsed) {
                const file = batch.find(f => f.path === s.path);
                if (file && s.node_id) {
                  const node = allNodes.find(n => n.id === s.node_id);
                  suggestions.push({
                    path: s.path,
                    name: file.name,
                    size: file.size,
                    modified: file.modified,
                    preview: file.preview.substring(0, 200),
                    node_id: s.node_id,
                    node_label: node?.label || 'Unknown',
                    reason: s.reason,
                  });
                }
              }
            }
          } catch (e) {
            console.error('[scan] Failed to parse AI response:', e.message);
          }
        }
      }
    }

    console.log(`[scan] ${suggestions.length} files matched to nodes`);
    res.json({ total_scanned: files.length, suggestions });
  } catch (err) {
    console.error('[scan] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scan/ingest — ingest approved files as resources
router.post('/ingest', async (req, res) => {
  try {
    const { items } = req.body; // [{ path, node_id }]
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

    const apiKey = req.headers['x-api-key'] || null;
    const results = [];

    for (const item of items) {
      const content = await readFileContent(item.path);
      if (!content) {
        results.push({ path: item.path, status: 'failed', error: 'Could not read file' });
        continue;
      }

      const resource = await db.createResource({
        node_id: item.node_id,
        url: `file://${item.path}`,
        type: 'note',
        why: item.why || null,
        description: null,
        content,
        status: 'ingesting',
      });

      // Run lightweight ingestion (no scraping needed — we already have the content)
      try {
        const { chunk } = await import('../services/chunker.js');
        const { embed } = await import('../services/embedder.js');

        const chunks = chunk(content);
        for (const c of chunks) {
          const embedding = await embed(c.content);
          await db.createChunk({
            resource_id: resource.id,
            content: c.content,
            embedding,
            chunk_index: c.chunk_index,
            token_count: c.token_count,
          });
        }

        const tags = await generateTags(content, apiKey);
        if (tags.length > 0) await db.setResourceTags(resource.id, tags);

        const summary = await generateSummary(content, apiKey);
        await db.updateResource(resource.id, { description: summary, status: 'ready' });

        results.push({ path: item.path, status: 'ready', resource_id: resource.id });
      } catch (err) {
        await db.updateResource(resource.id, { status: 'ready', description: `File ingested (${err.message})` });
        results.push({ path: item.path, status: 'partial', resource_id: resource.id });
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
