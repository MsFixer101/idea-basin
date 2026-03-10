import { Router } from 'express';
import { getMemories, saveMemory, deleteMemory } from '../services/whatsapp-memory.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const entries = await getMemories();
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { text, source } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    const entry = await saveMemory(text, source || 'user');
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ok = await deleteMemory(req.params.id);
    res.json({ ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
