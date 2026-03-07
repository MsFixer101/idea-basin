import * as fs from 'fs/promises';
import * as path from 'path';
import * as db from '../db/queries.js';
import { scrape, scrapeYouTube, scrapeGitHub, scrapeArxiv, checkAuthWalled } from '../services/scraper.js';
import { chunk } from '../services/chunker.js';
import { embed } from '../services/embedder.js';
import { generateTags, generateSummary } from '../services/tagger.js';

function detectScrapeStrategy(url) {
  if (url.startsWith('file://')) return 'local';
  const u = url.toLowerCase();
  if (/youtube|youtu\.be/.test(u)) return 'youtube';
  if (/vimeo|loom/.test(u)) return 'video';
  if (/github\.com|gitlab\.com/.test(u)) return 'github';
  if (/arxiv\.org/.test(u)) return 'arxiv';
  return 'default';
}

async function readLocalFile(fileUrl) {
  const filePath = fileUrl.replace('file://', '');
  const stat = await fs.stat(filePath);
  if (stat.size > 5 * 1024 * 1024) {
    throw new Error('File too large (>5MB)');
  }
  const content = await fs.readFile(filePath, 'utf-8');
  const name = path.basename(filePath);
  return `# ${name}\n\n${content}`;
}

export async function ingest(resourceId) {
  console.log(`[ingest] Starting for resource ${resourceId}`);

  const resource = await db.getResource(resourceId);
  if (!resource) return;

  try {
    // Content-only resources, or uploads with content — skip scraping, go straight to chunking
    const isUpload = resource.url && resource.url.startsWith('/uploads/');
    if (resource.content && (!resource.url || isUpload)) {
      await db.updateResource(resourceId, { status: 'ingesting' });

      const rawContent = resource.content;
      await db.updateResource(resourceId, { raw_content: rawContent });
      console.log(`[ingest] Content-only resource, ${rawContent.length} chars`);

      const chunks = chunk(rawContent);
      console.log(`[ingest] Created ${chunks.length} chunks`);

      for (const c of chunks) {
        const embedding = await embed(c.content);
        await db.createChunk({
          resource_id: resourceId,
          content: c.content,
          embedding,
          chunk_index: c.chunk_index,
          token_count: c.token_count,
        });
      }
      console.log(`[ingest] Embedded ${chunks.length} chunks`);

      const tags = await generateTags(rawContent);
      if (tags.length > 0) {
        await db.setResourceTags(resourceId, tags);
        console.log(`[ingest] Tagged with: ${tags.join(', ')}`);
      }

      const summary = await generateSummary(rawContent);
      await db.updateResource(resourceId, {
        description: summary || 'Content ingested successfully',
        status: 'ready',
      });

      console.log(`[ingest] Complete for content-only resource ${resourceId}`);
      return;
    }

    // URL-less resources with no content — nothing to do
    if (!resource.url) return;

    // Check for auth-walled URLs first
    const authService = checkAuthWalled(resource.url);
    if (authService) {
      console.log(`[ingest] ${authService} requires authentication — saving URL only`);
      await db.updateResource(resourceId, {
        status: 'ready',
        description: `${authService} link (requires authentication — URL saved for reference)`,
      });
      return;
    }

    // Update status
    await db.updateResource(resourceId, { status: 'ingesting' });

    // Scrape based on URL type
    const strategy = detectScrapeStrategy(resource.url);
    let rawContent;

    switch (strategy) {
      case 'local':
        rawContent = await readLocalFile(resource.url);
        break;
      case 'youtube':
        rawContent = await scrapeYouTube(resource.url);
        break;
      case 'github':
        rawContent = await scrapeGitHub(resource.url);
        break;
      case 'arxiv':
        rawContent = await scrapeArxiv(resource.url);
        break;
      default:
        rawContent = await scrape(resource.url);
    }

    // If scrape returned very little, still mark as ready with what we have
    if (!rawContent || rawContent.trim().length < 30) {
      console.log(`[ingest] Minimal content for ${resource.url} — saving URL only`);
      await db.updateResource(resourceId, {
        status: 'ready',
        description: 'Could not extract content — URL saved for reference',
      });
      return;
    }

    await db.updateResource(resourceId, { raw_content: rawContent });
    console.log(`[ingest] Scraped ${rawContent.length} chars (${strategy})`);

    // Chunk
    const chunks = chunk(rawContent);
    console.log(`[ingest] Created ${chunks.length} chunks`);

    // Embed & store chunks
    for (const c of chunks) {
      const embedding = await embed(c.content);
      await db.createChunk({
        resource_id: resourceId,
        content: c.content,
        embedding,
        chunk_index: c.chunk_index,
        token_count: c.token_count,
      });
    }
    console.log(`[ingest] Embedded ${chunks.length} chunks`);

    // Tag
    const tags = await generateTags(rawContent);
    if (tags.length > 0) {
      await db.setResourceTags(resourceId, tags);
      console.log(`[ingest] Tagged with: ${tags.join(', ')}`);
    }

    // Summarize
    const summary = await generateSummary(rawContent);
    await db.updateResource(resourceId, {
      description: summary || 'Content ingested successfully',
      status: 'ready',
    });

    console.log(`[ingest] Complete for resource ${resourceId}`);
  } catch (err) {
    console.error(`[ingest] Failed for resource ${resourceId}:`, err.message);
    await db.updateResource(resourceId, {
      status: 'ready',
      description: `Ingestion error: ${err.message} — URL saved for reference`,
    });
  }
}
