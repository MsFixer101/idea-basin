import { get as getConfig } from './config.js';
import { callProvider, getApiKey } from './whatsapp-bot.js';

const IMAGE_PROMPT_SYSTEM = `You are an image prompt writer for a blog that uses a specific visual style. Given a blog post and a style prompt, write a single image generation prompt that combines the style with a subject inspired by the post's theme.

Rules:
- Start with the style prompt as the base
- Add subject matter that symbolically represents the post's theme (not literal)
- Keep it under 200 words
- Output ONLY the prompt, no preamble or explanation`;

const METADATA_SYSTEM = `You are a blog editor. Given a blog post, generate metadata for it. Return ONLY valid JSON with this exact structure:
{
  "categories": ["Category One", "Category Two"],
  "excerpt": "A compelling 1-2 sentence summary that hooks the reader."
}

Rules:
- Pick 2-4 categories that best describe the post. Use title case. Be specific (e.g. "AI Development" not just "AI").
- The excerpt should be a hook — concise, engaging, makes you want to read more. Max 200 characters.
- Return ONLY the JSON, no markdown fences, no explanation.`;

/**
 * Ask an LLM to generate an image prompt from blog content.
 */
export async function generateImagePrompt(content) {
  const waCfg = await getConfig('whatsapp') || {};
  const blogCfg = await getConfig('blog') || {};
  const provider = blogCfg.provider || waCfg.defaultProvider || 'claude-cli';
  const model = blogCfg.model || '';
  const apiKey = getApiKey(provider, waCfg);

  // Fetch the blog style from Dalla if configured
  let stylePrompt = '';
  const dallaUrl = (blogCfg.dallaUrl || 'http://localhost:3510').replace(/\/+$/, '');
  const styleId = blogCfg.dallaStyleId;
  if (styleId) {
    try {
      const styleRes = await fetch(`${dallaUrl}/api/da/styles/${styleId}`);
      if (styleRes.ok) {
        const style = await styleRes.json();
        stylePrompt = style.prompt || '';
      }
    } catch {}
  }

  const userPrompt = stylePrompt
    ? `Style prompt to use as base:\n${stylePrompt}\n\nWrite an image generation prompt for this blog post:\n\n${content.substring(0, 3000)}`
    : `Write an image generation prompt for this blog post:\n\n${content.substring(0, 3000)}`;

  const result = await callProvider(provider, model, userPrompt, IMAGE_PROMPT_SYSTEM, apiKey, waCfg);
  if (!result) throw new Error('LLM returned empty response for image prompt');
  return result.trim();
}

/**
 * Fetch existing categories from the blog.
 */
async function fetchExistingCategories() {
  const cfg = await getConfig('blog') || {};
  const blogUrl = (cfg.blogUrl || '').replace(/\/+$/, '');
  if (!blogUrl) return [];
  try {
    const res = await fetch(`${blogUrl}/api/categories`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const cats = await res.json();
    return cats.map(c => c.name);
  } catch {
    return [];
  }
}

/**
 * Ask an LLM to generate categories + excerpt for a blog post.
 * Returns { categories: string[], excerpt: string }
 */
export async function generateMetadata(title, content) {
  const waCfg = await getConfig('whatsapp') || {};
  const blogCfg = await getConfig('blog') || {};
  const provider = blogCfg.provider || waCfg.defaultProvider || 'claude-cli';
  const model = blogCfg.model || '';
  const apiKey = getApiKey(provider, waCfg);

  const existingCategories = await fetchExistingCategories();
  const catNote = existingCategories.length
    ? `\n\nExisting categories on the blog (prefer reusing these where they fit, but you may suggest new ones): ${existingCategories.join(', ')}`
    : '';

  const userPrompt = `Generate categories and excerpt for this blog post:${catNote}\n\nTitle: ${title}\n\n${content.substring(0, 3000)}`;
  const result = await callProvider(provider, model, userPrompt, METADATA_SYSTEM, apiKey, waCfg);
  if (!result) throw new Error('LLM returned empty response for metadata');

  // Parse JSON — handle possible markdown fences
  const cleaned = result.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  try {
    const parsed = JSON.parse(cleaned);
    return {
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      excerpt: typeof parsed.excerpt === 'string' ? parsed.excerpt : '',
    };
  } catch (err) {
    console.error('[blog-publisher] Failed to parse metadata JSON:', cleaned);
    throw new Error('LLM returned invalid JSON for metadata');
  }
}

/**
 * Trigger embedding generation on the blog for a post.
 */
export async function generateEmbedding(postId) {
  const cfg = await getConfig('blog') || {};
  const blogUrl = (cfg.blogUrl || '').replace(/\/+$/, '');
  const blogToken = cfg.blogToken;
  if (!blogUrl || !blogToken) throw new Error('Blog URL/token not configured');

  const res = await fetch(`${blogUrl}/api/generate-embedding`, {
    method: 'POST',
    headers: { 'X-Blog-Token': blogToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_id: postId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding generation failed (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * Fetch upcoming scheduled posts from the blog.
 * Returns [{ id, title, slug, publish_date }] sorted by date ascending.
 */
export async function fetchScheduledPosts() {
  const cfg = await getConfig('blog') || {};
  const blogUrl = (cfg.blogUrl || '').replace(/\/+$/, '');
  const blogToken = cfg.blogToken;
  if (!blogUrl || !blogToken) return [];

  try {
    const res = await fetch(`${blogUrl}/api/scheduled-posts`, {
      headers: { 'X-Blog-Token': blogToken },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

/**
 * Calculate the next available Tuesday at 10:00 UK time after the latest scheduled post.
 * Returns { suggested: Date, lastScheduled: Date|null, scheduledPosts: array }
 */
export async function suggestNextPublishDate() {
  const scheduled = await fetchScheduledPosts();
  const lastScheduled = scheduled.length
    ? new Date(scheduled[scheduled.length - 1].publish_date)
    : null;

  // Find next Tuesday at 10:00 UK time after the latest scheduled post (or now)
  const after = lastScheduled || new Date();
  const next = nextTuesday10am(after);

  return { suggested: next, lastScheduled, scheduledPosts: scheduled };
}

/**
 * Find the next Tuesday at 10:00 UK time strictly after the given date.
 */
function nextTuesday10am(after) {
  // Work in UTC, offset for UK time (GMT+0 or BST+1)
  const d = new Date(after);
  // Move to next day to ensure "strictly after"
  d.setDate(d.getDate() + 1);
  // Find the next Tuesday (day 2)
  while (d.getDay() !== 2) {
    d.setDate(d.getDate() + 1);
  }
  // Set to 10:00 UK time — approximate with Europe/London
  // UK is UTC+0 in winter, UTC+1 in summer (BST)
  const ukOffset = getUKOffset(d);
  d.setUTCHours(10 - ukOffset, 0, 0, 0);
  return d;
}

function getUKOffset(date) {
  // Simple BST check: last Sunday of March to last Sunday of October
  const year = date.getUTCFullYear();
  const marchLast = new Date(Date.UTC(year, 2, 31));
  while (marchLast.getUTCDay() !== 0) marchLast.setUTCDate(marchLast.getUTCDate() - 1);
  const octLast = new Date(Date.UTC(year, 9, 31));
  while (octLast.getUTCDay() !== 0) octLast.setUTCDate(octLast.getUTCDate() - 1);
  return (date >= marchLast && date < octLast) ? 1 : 0;
}

/**
 * Schedule a post for publication at a given date.
 */
export async function schedulePost(postId, publishDate) {
  const cfg = await getConfig('blog') || {};
  const blogUrl = (cfg.blogUrl || '').replace(/\/+$/, '');
  const blogToken = cfg.blogToken;
  if (!blogUrl || !blogToken) throw new Error('Blog URL/token not configured');

  const res = await fetch(`${blogUrl}/api/schedule-post`, {
    method: 'POST',
    headers: { 'X-Blog-Token': blogToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_id: postId, publish_date: publishDate.toISOString() }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Schedule failed (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * Generate an image via Dalla.
 * Returns the image as a Buffer.
 * Optionally accepts a reference image buffer for img2img style transfer.
 */
export async function generateImage(prompt, referenceImageBuffer) {
  const cfg = await getConfig('blog') || {};
  const dallaUrl = (cfg.dallaUrl || 'http://localhost:3510').replace(/\/+$/, '');

  const body = {
    prompt,
    width: cfg.dallaWidth || 1024,
    height: cfg.dallaHeight || 1024,
    steps: cfg.inferenceSteps || 30,
  };

  // If a reference image was provided, include it for img2img
  if (referenceImageBuffer) {
    body.reference_image = referenceImageBuffer.toString('base64');
    body.strength = cfg.dallaStrength || 0.5;
  }

  const res = await fetch(`${dallaUrl}/api/da/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(900_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Dalla generation failed (${res.status}): ${err.error}`);
  }

  const result = await res.json();
  if (!result.image_base64) throw new Error('Dalla returned no image');

  return Buffer.from(result.image_base64, 'base64');
}

/**
 * Push a draft post (with optional images) to the blog.
 * imageBuffer = AI-generated featured image (Buffer or null)
 * extraImages = user-attached images [{ buffer, filename }]
 */
export async function publishDraft({ title, content, excerpt, categories, imageBuffer, extraImages }) {
  const cfg = await getConfig('blog') || {};
  const blogUrl = (cfg.blogUrl || '').replace(/\/+$/, '');
  const blogToken = cfg.blogToken;
  if (!blogUrl) throw new Error('Blog URL not configured (blog.blogUrl)');
  if (!blogToken) throw new Error('Blog token not configured (blog.blogToken)');

  const formData = new FormData();
  formData.append('title', title);
  formData.append('content', content);
  if (excerpt) formData.append('excerpt', excerpt);
  if (categories) formData.append('categories', categories);

  // Featured image: prefer AI-generated, fall back to first user image
  const featuredBuf = imageBuffer || extraImages?.[0]?.buffer;
  if (featuredBuf) {
    const ext = imageBuffer ? 'png' : (extraImages[0].filename.split('.').pop() || 'jpeg');
    const blob = new Blob([featuredBuf], { type: `image/${ext}` });
    formData.append('featured_image', blob, `featured.${ext}`);
  }

  const res = await fetch(`${blogUrl}/api/create-draft`, {
    method: 'POST',
    headers: { 'X-Blog-Token': blogToken },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Blog API failed (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * Full pipeline: generate image prompt → generate image → publish draft.
 * extraImages = [{ buffer, filename }] from user-attached images.
 * onProgress(message) is called at each step.
 * Returns { imagePrompt, blogResult } on success.
 */
export async function runPipeline(title, content, extraImages, onProgress) {
  const notify = onProgress || (() => {});
  const hasUserImages = extraImages && extraImages.length > 0;

  // Step 1: Generate image prompt
  notify('Generating image prompt...');
  let imagePrompt;
  try {
    imagePrompt = await generateImagePrompt(content);
  } catch (err) {
    throw new Error(`Image prompt generation failed: ${err.message}`);
  }

  // Step 2: Generate image with Dalla
  notify(`Creating image with Dalla...\n_Prompt: ${imagePrompt}_`);
  let imageBuffer;
  try {
    imageBuffer = await generateImage(imagePrompt);
  } catch (err) {
    // Non-fatal — publish with user images or without any image
    console.error('[blog-publisher] Image generation failed:', err.message);
    const fallback = hasUserImages ? 'Using attached image as featured.' : 'Publishing without featured image.';
    notify(`Image generation failed (${err.message}). ${fallback}`);
    imageBuffer = null;
  }

  // Step 3: Publish draft
  const imgNote = hasUserImages ? ` + ${extraImages.length} attached` : '';
  notify(`Pushing draft to blog...${imgNote ? ` (${imgNote.trim()})` : ''}`);
  let blogResult;
  try {
    blogResult = await publishDraft({ title, content, imageBuffer, extraImages });
  } catch (err) {
    throw new Error(`Blog publish failed: ${err.message}`);
  }

  return { imagePrompt, blogResult };
}

// ── Audio generation via local Kokoro TTS ───────────────────────────────

const KOKORO_URL = 'http://localhost:3501';
const KOKORO_VOICE = 'af_heart';

/**
 * Generate audio narration via local Kokoro TTS and upload to blog.
 */
export async function generateAudio(content, postId, blogUrl, audioToken) {
  if (!blogUrl) throw new Error('Blog URL not configured');
  if (!audioToken) throw new Error('Audio token not configured (blog.audioToken)');
  blogUrl = blogUrl.replace(/\/+$/, '');

  const plainText = stripMarkdown(content);
  if (!plainText) throw new Error('No text content to narrate');

  const chunks = chunkText(plainText, 1500);
  console.log(`[blog-publisher] Generating audio: ${chunks.length} chunks, ${plainText.length} chars`);

  const mp3Buffers = [];
  for (let i = 0; i < chunks.length; i++) {
    const res = await fetch(`${KOKORO_URL}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: chunks[i],
        provider: 'kokoro',
        voice_profile: { provider: 'kokoro', voice: KOKORO_VOICE },
        output_format: 'mp3',
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`TTS chunk ${i + 1}/${chunks.length} failed (${res.status})`);
    const arrayBuf = await res.arrayBuffer();
    mp3Buffers.push(Buffer.from(arrayBuf));
    console.log(`[blog-publisher] TTS chunk ${i + 1}/${chunks.length} done (${chunks[i].length} chars)`);
  }

  const fullMp3 = Buffer.concat(mp3Buffers);
  console.log(`[blog-publisher] Audio complete: ${(fullMp3.length / 1024).toFixed(0)}KB, uploading...`);

  const formData = new FormData();
  formData.append('post_id', String(postId));
  formData.append('audio', new Blob([fullMp3], { type: 'audio/mpeg' }), 'audio.mp3');

  const uploadRes = await fetch(`${blogUrl}/api/upload-audio`, {
    method: 'POST',
    headers: { 'X-Audio-Token': audioToken },
    body: formData,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Audio upload failed (${uploadRes.status}): ${err}`);
  }
  return uploadRes.json();
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')          // code blocks
    .replace(/`[^`]+`/g, '')                  // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')     // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // links → text
    .replace(/<[^>]+>/g, ' ')                 // HTML tags
    .replace(/^#{1,6}\s+/gm, '')              // headers
    .replace(/\*{1,3}|_{1,3}/g, '')           // bold/italic
    .replace(/^[-*_]{3,}\s*$/gm, '')          // horizontal rules
    .replace(/^>\s?/gm, '')                   // blockquotes
    .replace(/^[-*+]\s+/gm, '')              // unordered list markers
    .replace(/^\d+\.\s+/gm, '')              // ordered list markers
    .replace(/\n{3,}/g, '\n\n')               // collapse newlines
    .replace(/[ \t]+/g, ' ')                  // collapse spaces
    .trim();
}

function chunkText(text, maxChars = 1500) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 > maxChars && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
