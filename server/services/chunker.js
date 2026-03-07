const TARGET_TOKENS = 500;
const OVERLAP_TOKENS = 50;
const CHARS_PER_TOKEN = 4; // rough estimate

export function chunk(text) {
  if (!text || text.trim().length === 0) return [];

  const targetChars = TARGET_TOKENS * CHARS_PER_TOKEN;
  const overlapChars = OVERLAP_TOKENS * CHARS_PER_TOKEN;

  // Split on semantic boundaries: double newlines, then single newlines, then sentences
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > targetChars && current.length > 0) {
      chunks.push(current.trim());
      // Keep overlap from end of current chunk
      const words = current.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(overlapChars / 5));
      current = overlapWords.join(' ') + '\n\n' + para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  // If any chunk is still too large, split on sentences
  const result = [];
  for (const c of chunks) {
    if (c.length > targetChars * 2) {
      const sentences = c.match(/[^.!?]+[.!?]+/g) || [c];
      let sub = '';
      for (const s of sentences) {
        if ((sub + s).length > targetChars && sub.length > 0) {
          result.push(sub.trim());
          sub = s;
        } else {
          sub += s;
        }
      }
      if (sub.trim()) result.push(sub.trim());
    } else {
      result.push(c);
    }
  }

  return result.map((content, i) => ({
    content,
    chunk_index: i,
    token_count: Math.ceil(content.length / CHARS_PER_TOKEN),
  }));
}
