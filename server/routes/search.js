import { Router } from 'express';
import * as db from '../db/queries.js';
import { embed } from '../services/embedder.js';

const router = Router();

// GET /api/search?q=...&node=...
router.get('/', async (req, res) => {
  try {
    const { q, node, limit } = req.query;
    if (!q) return res.status(400).json({ error: 'q parameter required' });

    const embedding = await embed(q);
    if (!embedding) return res.status(500).json({ error: 'Failed to generate embedding' });

    const maxResults = parseInt(limit) || 10;
    const results = await db.searchChunks(embedding, maxResults + 10, node || null);
    const privateIds = await db.getPrivateNodeIds();
    const filtered = results.filter(r => !privateIds.has(r.node_id)).slice(0, maxResults);
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
