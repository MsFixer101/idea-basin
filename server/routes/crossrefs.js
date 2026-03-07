import { Router } from 'express';
import * as db from '../db/queries.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateId(req, res, next) {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid cross-reference ID format' });
  }
  next();
}

// POST /api/crossrefs — create manual cross-reference
router.post('/', async (req, res) => {
  try {
    const { source_node_id, target_node_id, reason } = req.body;
    if (!source_node_id || !target_node_id) {
      return res.status(400).json({ error: 'source_node_id and target_node_id required' });
    }
    const ref = await db.createCrossRef({ source_node_id, target_node_id, reason });
    res.status(201).json(ref);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crossrefs/suggested — AI-suggested cross-refs
router.get('/suggested', async (req, res) => {
  try {
    const suggestions = await db.getSuggestedCrossRefs();
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/crossrefs/:id — remove a cross-reference
router.delete('/:id', validateId, async (req, res) => {
  try {
    await db.deleteCrossRef(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
