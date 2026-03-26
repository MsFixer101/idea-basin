import { Router } from 'express';
import { getStatus, startBot, stopBot, disconnectBot, refreshGroups, sendToGroup, sendImageToGroup, addPendingImageApproval } from '../services/whatsapp-bot.js';
import { get as getConfig, save as saveConfig } from '../services/config.js';

const router = Router();

// GET /api/whatsapp/status — current bot state (QR, connection, groups)
router.get('/status', (req, res) => {
  res.json(getStatus());
});

// POST /api/whatsapp/connect — start the bot (triggers QR if not paired)
router.post('/connect', async (req, res) => {
  try {
    const cfg = await getConfig('whatsapp');
    if (!cfg?.enabled) {
      // Auto-enable when user clicks connect
      await saveConfig({ whatsapp: { ...cfg, enabled: true } });
    }
    await startBot();
    // Give it a moment for QR/connection
    setTimeout(() => res.json(getStatus()), 1000);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/stop — stop bot but keep auth (can restart without QR)
router.post('/stop', async (req, res) => {
  try {
    await stopBot();
    await saveConfig({ whatsapp: { enabled: false } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/disconnect — stop bot and clear auth (requires new QR scan)
router.post('/disconnect', async (req, res) => {
  try {
    await disconnectBot();
    await saveConfig({ whatsapp: { enabled: false } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/repair — clear stale auth and reconnect (generates new QR)
router.post('/repair', async (req, res) => {
  try {
    await disconnectBot();
    await saveConfig({ whatsapp: { enabled: true } });
    await startBot();
    setTimeout(() => res.json(getStatus()), 2000);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/refresh-groups — re-fetch groups from WhatsApp
router.post('/refresh-groups', async (req, res) => {
  try {
    const groups = await refreshGroups();
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/select-group — save chosen group JID and restart bot
router.post('/select-group', async (req, res) => {
  try {
    const { groupJid } = req.body;
    if (!groupJid) return res.status(400).json({ error: 'groupJid required' });

    await saveConfig({ whatsapp: { groupJid } });

    // Restart bot with the new group JID
    await stopBot();
    await startBot();

    res.json({ ok: true, groupJid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/select-chat-group — save chat-only group JID and restart bot
router.post('/select-chat-group', async (req, res) => {
  try {
    const { groupJid } = req.body;
    if (!groupJid) return res.status(400).json({ error: 'groupJid required' });

    await saveConfig({ whatsapp: { chatGroupJid: groupJid } });

    // Restart bot with the new group JID
    await stopBot();
    await startBot();

    res.json({ ok: true, chatGroupJid: groupJid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/send-image — receive image from external app, send to WhatsApp group
const SOURCE_APP_URLS = {
  // Add external app URLs here, e.g.: 'my-app': 'http://localhost:3456'
};

router.post('/send-image', async (req, res) => {
  try {
    const { imageUrl, caption, sourceId, sourceApp } = req.body;
    if (!imageUrl || !caption) {
      return res.status(400).json({ error: 'imageUrl and caption are required' });
    }

    // Fetch the image into a buffer
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      return res.status(502).json({ error: `Failed to fetch image: HTTP ${imgResp.status}` });
    }
    const imageBuffer = Buffer.from(await imgResp.arrayBuffer());

    // Send to WhatsApp group
    const sent = await sendImageToGroup(imageBuffer, caption);
    if (!sent) {
      return res.status(503).json({ error: 'WhatsApp bot not connected or no group configured' });
    }

    // Track for approval workflow if sourceId provided
    if (sourceId && sourceApp) {
      const callbackUrl = SOURCE_APP_URLS[sourceApp] || `http://localhost:3456`;
      addPendingImageApproval(sent.key.id, { sourceId, sourceApp, callbackUrl });
    }

    res.json({ success: true, messageId: sent.key.id });
  } catch (err) {
    console.error('[whatsapp] send-image failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/send-message — send text message to WhatsApp group (used by Ticker reminders, Memoria, etc.)
router.post('/send-message', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const sent = await sendToGroup(message);
    if (!sent) {
      return res.status(503).json({ error: 'WhatsApp bot not connected or no group configured' });
    }

    res.json({ success: true, messageId: sent.key.id });
  } catch (err) {
    console.error('[whatsapp] send-message failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
