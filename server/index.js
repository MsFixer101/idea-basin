import express from 'express';
import cors from 'cors';
import { execFile } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOADS_DIR = join(__dirname, 'uploads');
import nodesRouter from './routes/nodes.js';
import resourcesRouter from './routes/resources.js';
import searchRouter from './routes/search.js';
import crossrefsRouter from './routes/crossrefs.js';
import scanRouter from './routes/scan.js';
import configRouter from './routes/config.js';
import chatRouter from './routes/chat.js';
import whatsappRouter from './routes/whatsapp.js';
import briefingRouter from './routes/briefing.js';
import pool from './db/pool.js';
import { startBot } from './services/whatsapp-bot.js';
import { startScheduler } from './services/morning-briefing.js';
import { get as getConfig } from './services/config.js';

// Prevent EPIPE/ECONNRESET crashes (broken pipe when client disconnects)
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ECONNRESET' || err.code === 'ERR_STREAM_DESTROYED') return;
  try { process.stderr.write(`Uncaught exception: ${err.stack || err}\n`); } catch {}
  process.exit(1);
});

const app = express();
const PORT = process.env.PORT || 3500;

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (server-to-server, Electron, curl)
    if (!origin) return cb(null, true);
    // Allow localhost dev servers and Tailscale IPs (100.x.x.x)
    if (/^https?:\/\/(localhost|127\.0\.0\.1|100\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    cb(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/nodes', nodesRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/search', searchRouter);
app.use('/api/crossrefs', crossrefsRouter);
app.use('/api/scan', scanRouter);
app.use('/api/config', configRouter);
app.use('/api/chat', chatRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/briefing', briefingRouter);

// Serve uploaded images
app.use('/uploads', express.static(UPLOADS_DIR));

// Upload an image (base64 body)
app.post('/api/upload', async (req, res) => {
  try {
    const { filename, data, node_id } = req.body;
    if (!filename || !data) return res.status(400).json({ error: 'filename and data required' });

    // data is base64 encoded
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'File too large (>10MB)' });

    // Save to uploads/<node_id>/<timestamp>-<filename>
    const subdir = node_id || 'general';
    await mkdir(join(UPLOADS_DIR, subdir), { recursive: true });
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedName = `${Date.now()}-${safeName}`;
    const filePath = join(UPLOADS_DIR, subdir, storedName);
    await writeFile(filePath, buffer);

    const url = `/uploads/${subdir}/${storedName}`;
    res.json({ ok: true, url, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Open a local file in the default application
app.post('/api/open', (req, res) => {
  const { path } = req.body;
  if (!path || typeof path !== 'string') return res.status(400).json({ error: 'path required' });
  // Only allow absolute paths under /Users
  if (!path.startsWith('/Users/')) return res.status(403).json({ error: 'Restricted path' });
  execFile('open', [path], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// Serve built client — no-cache on index.html so mobile always gets fresh builds
const CLIENT_DIST = join(__dirname, '..', 'client', 'dist');
app.use(express.static(CLIENT_DIST, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback — serve index.html for non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(join(CLIENT_DIST, 'index.html'));
});

// Ensure Artifacts node exists under root
async function ensureArtifactsNode() {
  const ARTIFACTS_ID = '00000000-0000-0000-0000-000000000080';
  const ROOT_ID = '00000000-0000-0000-0000-000000000001';
  try {
    const { rows } = await pool.query('SELECT id FROM nodes WHERE id = $1', [ARTIFACTS_ID]);
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO nodes (id, parent_id, label, description, why, color)
         VALUES ($1, $2, 'Artifacts', 'Documents, summaries, and code created by the chat assistant.', 'So generated content has a home.', '#ffffff')`,
        [ARTIFACTS_ID, ROOT_ID]
      );
      console.log('Created Artifacts node');
    }
  } catch (err) {
    console.error('ensureArtifactsNode warning:', err.message);
  }
}

// Ensure WhatsApp Captures node exists under root
async function ensureWhatsAppCapturesNode() {
  const WHATSAPP_ID = '00000000-0000-0000-0000-000000000090';
  const ROOT_ID = '00000000-0000-0000-0000-000000000001';
  try {
    const { rows } = await pool.query('SELECT id FROM nodes WHERE id = $1', [WHATSAPP_ID]);
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO nodes (id, parent_id, label, description, why, color)
         VALUES ($1, $2, 'WhatsApp Captures', 'URLs and resources shared via WhatsApp.', 'So mobile captures have a home.', '#25D366')`,
        [WHATSAPP_ID, ROOT_ID]
      );
      console.log('Created WhatsApp Captures node');
    }
  } catch (err) {
    console.error('ensureWhatsAppCapturesNode warning:', err.message);
  }
}

// Run migrations before starting
async function migrate() {
  try {
    // Add embedding_384 column if it doesn't exist
    await pool.query(`
      ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding_384 vector(384)
    `);
    // Add private column to nodes if it doesn't exist
    await pool.query(`
      ALTER TABLE nodes ADD COLUMN IF NOT EXISTS private boolean DEFAULT false
    `);
  } catch (err) {
    // Column may already exist — safe to ignore
    if (!err.message.includes('already exists')) {
      console.error('Migration warning:', err.message);
    }
  }
}

migrate().then(() => ensureArtifactsNode()).then(() => ensureWhatsAppCapturesNode()).then(() => {
  app.listen(PORT, () => {
    console.log(`Idea Basin server running on http://localhost:${PORT}`);
    startBot().catch(err => console.error('[whatsapp] Bot startup failed:', err.message));
    startScheduler().catch(err => console.error('[briefing] Scheduler startup failed:', err.message));
  });
});
