import { Router } from 'express';
import { getSchedulerStatus, triggerNow, startScheduler } from '../services/morning-briefing.js';
import { fetchRecentItems } from '../services/rss-service.js';
import { get as getConfig, save as saveConfig } from '../services/config.js';

const router = Router();

// GET /api/briefing/status
router.get('/status', (req, res) => {
  res.json(getSchedulerStatus());
});

// POST /api/briefing/trigger — manual trigger
router.post('/trigger', async (req, res) => {
  try {
    const text = await triggerNow();
    if (text === null) {
      res.json({ ok: false, error: 'Briefing already running' });
    } else {
      res.json({ ok: true, briefing: text });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/briefing/test-rss — fetch RSS and return raw items
router.post('/test-rss', async (req, res) => {
  try {
    const cfg = await getConfig('briefing') || {};
    const feeds = req.body.feeds || cfg.rssFeeds || [];
    const items = await fetchRecentItems(feeds, 48);
    res.json({ ok: true, items, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/briefing/restart-scheduler — restart after config change
router.post('/restart-scheduler', async (req, res) => {
  try {
    await startScheduler();
    res.json({ ok: true, status: getSchedulerStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
