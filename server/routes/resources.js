import { Router } from 'express';
import { readFile, stat, copyFile, mkdir } from 'fs/promises';
import { basename, extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as db from '../db/queries.js';
import { ingest } from '../workers/ingest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOADS_DIR = join(__dirname, '..', 'uploads');

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const CODE_EXTS = new Set(['py', 'js', 'ts', 'jsx', 'tsx', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb', 'sh', 'sql', 'json', 'yaml', 'yml', 'toml']);
const RESEARCH_EXTS = new Set(['md', 'txt', 'rtf', 'doc', 'docx', 'pdf']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'webm', 'mkv']);

function detectFileType(filePath) {
  const ext = extname(filePath).slice(1).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (CODE_EXTS.has(ext)) return 'code';
  if (RESEARCH_EXTS.has(ext)) return 'research';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'link';
}

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateId(req, res, next) {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid resource ID format' });
  }
  next();
}

// POST /api/resources — create resource (triggers ingestion if URL)
router.post('/', async (req, res) => {
  try {
    const { node_id, url, type, why, content } = req.body;
    if (!node_id || !type) return res.status(400).json({ error: 'node_id and type required' });

    const hasUrl = url && url.trim();
    // Reject relative file paths — must use import-path endpoint or provide full path
    if (hasUrl) {
      const u = url.trim();
      const looksLikeRelativePath = !u.startsWith('http') && !u.startsWith('/') && !u.startsWith('file://') && (u.includes('/') || u.endsWith('.md') || u.endsWith('.txt') || u.endsWith('.pdf'));
      if (looksLikeRelativePath) {
        return res.status(400).json({ error: `"${u}" looks like a relative file path. Use a full path starting with / or ~` });
      }
    }
    const isUpload = hasUrl && url.trim().startsWith('/uploads/');
    const needsIngest = (hasUrl && !isUpload) || content;
    const resource = await db.createResource({
      node_id,
      url: hasUrl ? url.trim() : null,
      type,
      why,
      description: content && !hasUrl ? content.substring(0, 200) : (isUpload ? why : null),
      content: content || null,
      status: needsIngest ? 'pending' : 'ready',
    });

    // Trigger background ingestion for URL or content resources (skip uploaded images)
    if (needsIngest) {
      ingest(resource.id).catch(err => console.error('Ingestion failed:', err.message));
    }

    const full = await db.getResource(resource.id);
    res.status(201).json(full);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/resources/import-path — import a local file by path
router.post('/import-path', async (req, res) => {
  try {
    const { path: filePath, node_id } = req.body;
    if (!node_id || !filePath) return res.status(400).json({ error: 'node_id and path required' });

    // Expand ~ to /Users/<user>
    const resolved = filePath.startsWith('~/') ? filePath.replace('~', process.env.HOME) : filePath;

    // Security: only allow paths under /Users/
    if (!resolved.startsWith('/Users/')) {
      return res.status(403).json({ error: 'Path must be under /Users/' });
    }

    // Verify file exists
    let fileStat;
    try {
      fileStat = await stat(resolved);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }
    if (!fileStat.isFile()) return res.status(400).json({ error: 'Path is not a file' });

    const name = basename(resolved);
    const type = detectFileType(resolved);

    if (type === 'image') {
      // Copy image to uploads/<node_id>/
      if (fileStat.size > 10 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (>10MB)' });
      const subdir = node_id;
      await mkdir(join(UPLOADS_DIR, subdir), { recursive: true });
      const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storedName = `${Date.now()}-${safeName}`;
      await copyFile(resolved, join(UPLOADS_DIR, subdir, storedName));
      const uploadUrl = `/uploads/${subdir}/${storedName}`;

      const resource = await db.createResource({
        node_id,
        url: uploadUrl,
        type: 'link',
        why: `Imported: ${name}`,
        description: name,
        status: 'ready',
      });
      const full = await db.getResource(resource.id);
      return res.status(201).json(full);
    }

    // Text/code file — read content
    if (fileStat.size > 5 * 1024 * 1024) return res.status(413).json({ error: 'File too large (>5MB)' });
    const content = await readFile(resolved, 'utf-8');

    const resource = await db.createResource({
      node_id,
      url: `file://${resolved}`,
      type,
      why: `Imported: ${name}`,
      description: name,
      content,
      status: 'pending',
    });

    // Trigger ingestion for chunking + embedding
    ingest(resource.id).catch(err => console.error('Import ingestion failed:', err.message));

    const full = await db.getResource(resource.id);
    res.status(201).json(full);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/resources/:id
router.get('/:id', validateId, async (req, res) => {
  try {
    const resource = await db.getResource(req.params.id);
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    res.json(resource);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/resources/:id — update resource
router.patch('/:id', validateId, async (req, res) => {
  try {
    const resource = await db.updateResource(req.params.id, req.body);
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    res.json(resource);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/resources/:id/reingest — re-trigger ingestion
router.post('/:id/reingest', validateId, async (req, res) => {
  try {
    const resource = await db.getResource(req.params.id);
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    if (!resource.url && !resource.content) return res.status(400).json({ error: 'No URL or content to ingest' });
    await db.updateResource(req.params.id, { status: 'pending', description: null });
    ingest(resource.id).catch(err => console.error('Re-ingestion failed:', err.message));
    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/resources/:id
router.delete('/:id', validateId, async (req, res) => {
  try {
    await db.deleteResource(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
