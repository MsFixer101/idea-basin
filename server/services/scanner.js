import { readdir, stat, readFile } from 'fs/promises';
import { join, extname, basename } from 'path';

// File types we can read and ingest
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.jsonl', '.csv', '.yml', '.yaml', '.toml',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.sh', '.sql', '.html', '.css',
  '.env', '.cfg', '.ini', '.xml', '.rst', '.org',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '__pycache__', '.venv', 'venv',
  'dist', 'build', '.cache', '.Trash', 'Library', '.npm', '.nvm',
  '.ollama', '.docker', 'Applications', 'Pictures', 'Music', 'Movies',
]);

const MAX_FILE_SIZE = 500_000; // 500KB max per file
const MAX_FILES = 200; // cap results

export async function scanDirectory(dirPath, opts = {}) {
  const { maxDepth = 4, extensions = null } = opts;
  const results = [];

  async function walk(dir, depth) {
    if (depth > maxDepth || results.length >= MAX_FILES) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission denied, etc.
    }

    for (const entry of entries) {
      if (results.length >= MAX_FILES) break;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        const allowedExts = extensions ? new Set(extensions) : TEXT_EXTENSIONS;
        if (!allowedExts.has(ext)) continue;
        if (entry.name.startsWith('.')) continue;

        try {
          const info = await stat(fullPath);
          if (info.size > MAX_FILE_SIZE || info.size === 0) continue;

          results.push({
            path: fullPath,
            name: entry.name,
            ext,
            size: info.size,
            modified: info.mtime,
          });
        } catch {
          continue;
        }
      }
    }
  }

  await walk(dirPath, 0);
  return results;
}

export async function readFileContent(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8');
    // Truncate very long files for AI classification
    return content.substring(0, 8000);
  } catch {
    return null;
  }
}

export async function classifyFiles(files, nodes, generateFn) {
  // Build a map of node labels + descriptions for the AI
  const nodeList = nodes.map(n => ({
    id: n.id,
    label: n.label,
    description: n.description || '',
    why: n.why || '',
  }));

  const fileList = files.map(f => ({
    path: f.path,
    name: f.name,
    preview: f.preview?.substring(0, 500) || '',
  }));

  const system = `You are a file organiser. Given a list of files with previews and a list of project nodes, assign each file to the most relevant node.

Rules:
- Only assign a file if it clearly belongs. If unsure, assign to null.
- Return a JSON array of objects: [{"path": "...", "node_id": "...", "reason": "..."}]
- "reason" should be 5-10 words explaining why.
- Return ONLY the JSON array. No explanation.`;

  const prompt = `NODES:\n${JSON.stringify(nodeList, null, 2)}\n\nFILES:\n${JSON.stringify(fileList, null, 2)}`;

  return generateFn(prompt, system);
}
