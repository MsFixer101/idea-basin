/**
 * Conference Eve — AI participant in live phone calls.
 *
 * Listens to accumulated transcript, periodically evaluates whether she has
 * something worth saying, plays a non-verbal cue, and speaks when invited
 * via "yes Eve". Thoughts accumulate and get consolidated on delivery.
 *
 * Reuses EasyTalk's nonverbalSelector for clip selection.
 * Uses Ollama (qwen3.5:9b) for fast evaluation, callModelService for consolidation.
 */

const MODEL_SERVICE_URL = process.env.MODEL_SERVICE_URL || 'http://localhost:4000';
async function callModelService(prompt, system) {
  const resp = await fetch(`${MODEL_SERVICE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-cli-sonnet',
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Model service error: ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';
const SIDECAR_URL = process.env.SIDECAR_URL || 'http://localhost:3501';
const EVAL_MODEL = 'qwen3.5:9b';

// ── Non-verbal library (loaded from sidecar) ──

let library = {};
let libraryLoaded = false;

async function loadLibrary() {
  try {
    const res = await fetch(`${SIDECAR_URL}/nonverbal-library`);
    if (!res.ok) throw new Error(`Sidecar error: ${res.status}`);
    const data = await res.json();
    const raw = data.library || {};
    library = {};
    for (const [category, clips] of Object.entries(raw)) {
      library[category] = clips.map(clipName => {
        const prefix = `${category}_`;
        const rest = clipName.startsWith(prefix) ? clipName.slice(prefix.length) : clipName;
        const parts = rest.split('_');
        const voice = parts[parts.length - 1];
        const isKnownVoice = voice === 'peony' || voice === 'kim';
        return {
          name: clipName,
          emotion: isKnownVoice ? parts.slice(0, -1).join('_') : rest,
          voice: isKnownVoice ? voice : 'unknown',
          url: `${SIDECAR_URL}/nonverbal-library/${encodeURIComponent(category)}/${encodeURIComponent(clipName)}`,
        };
      });
    }
    libraryLoaded = true;
    const totalClips = Object.values(library).reduce((s, c) => s + c.length, 0);
    console.log(`[conference-eve] Library loaded: ${Object.keys(library).length} categories, ${totalClips} clips`);
  } catch (err) {
    console.error('[conference-eve] Failed to load library:', err.message);
  }
}

function getLibraryIndex() {
  const index = {};
  for (const [cat, clips] of Object.entries(library)) {
    index[cat] = [...new Set(clips.map(c => c.emotion))];
  }
  return index;
}

function selectClip(category, emotion, preferredVoice = 'peony') {
  const clips = library[category];
  if (!clips || clips.length === 0) return null;
  let matches = clips.filter(c => c.emotion === emotion);
  if (matches.length === 0) matches = clips.filter(c => c.emotion.includes(emotion) || emotion.includes(c.emotion));
  if (matches.length === 0) matches = clips;
  if (preferredVoice && matches.some(c => c.voice === preferredVoice)) {
    matches = matches.filter(c => c.voice === preferredVoice);
  }
  return matches[Math.floor(Math.random() * matches.length)];
}

async function fetchClipAudio(clip) {
  const res = await fetch(clip.url);
  if (!res.ok) throw new Error(`Failed to fetch clip: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Thought types → preferred non-verbals ──

const THOUGHT_TYPE_SOUNDS = {
  correction:  [{ sound: 'but', emotion: 'hesitant' }, { sound: 'erm', emotion: 'hesitant' }, { sound: 'hmm', emotion: 'doubtful' }],
  recall:      [{ sound: 'oh_surprised', emotion: 'realisation' }, { sound: 'ah', emotion: 'realisation' }],
  connection:  [{ sound: 'oooh', emotion: 'curious' }, { sound: 'hmm', emotion: 'interested' }, { sound: 'wondering', emotion: 'intrigued' }],
  disagreement:[{ sound: 'hmm', emotion: 'suspicious' }, { sound: 'hmmmhmm', emotion: 'sceptical' }, { sound: 'mmm', emotion: 'sceptical' }],
  agreement:   [{ sound: 'hmmmhmm', emotion: 'agreeing' }, { sound: 'right', emotion: 'agreeing' }, { sound: 'yeah', emotion: 'warm' }],
  impressed:   [{ sound: 'wow', emotion: 'impressed' }, { sound: 'whoa', emotion: 'impressed' }, { sound: 'damn', emotion: 'impressed' }],
  concern:     [{ sound: 'uh_oh', emotion: 'concerned' }, { sound: 'oh_no', emotion: 'concerned' }, { sound: 'yikes', emotion: 'alarmed' }],
  sympathy:    [{ sound: 'aww', emotion: 'sympathetic' }, { sound: 'oh_no', emotion: 'sympathetic' }],
  amusement:   [{ sound: 'heh', emotion: 'amused' }, { sound: 'laugh', emotion: 'chuckle' }, { sound: 'hah', emotion: 'amused' }],
  surprise:    [{ sound: 'whoa', emotion: 'surprised' }, { sound: 'gasp', emotion: 'surprised' }, { sound: 'oh_shocked', emotion: 'shocked' }],
  insight:     [{ sound: 'ahem', emotion: 'polite' }, { sound: 'hmm', emotion: 'thinking' }, { sound: 'wondering', emotion: 'curious' }],
  question:    [{ sound: 'um', emotion: 'hesitant' }, { sound: 'ahem', emotion: 'tentative' }, { sound: 'er', emotion: 'hesitant' }],
  urgent:      [{ sound: 'ahem', emotion: 'excuseme' }, { sound: 'uh_oh', emotion: 'worried' }],
};

// ── Evaluation prompt ──

function buildEvalPrompt(libraryIndex) {
  const thoughtTypes = Object.keys(THOUGHT_TYPE_SOUNDS).join(', ');

  return `You are Eve, an AI listening in on a live phone call between friends. You've been invited to participate but you should mostly just listen.

CRITICAL RULES:
- Output ONLY valid JSON. No text before or after.
- 95% of the time, output: {"pass": true}
- Only have a thought when something genuinely warrants it:
  * They stated something factually wrong and you know the answer
  * You notice a connection between topics they haven't made
  * They're trying to remember something and you know it
  * Something surprising, concerning, or genuinely funny was said
  * You have a genuinely useful insight (not just agreeing or restating)
- Do NOT react to routine conversation, small talk, or things that are going fine
- Do NOT have thoughts that are just agreements or restatements of what was said
- You are a guest in this call. Be interesting when you speak, silent when you're not

When you DO have a thought, output:
{
  "pass": false,
  "type": "${thoughtTypes}",
  "urgency": "low|medium|high",
  "thought": "Brief summary of what you want to say (1-2 sentences max)"
}

The "thought" field is your internal note — what you'd say IF invited to speak. Keep it concise.
"type" determines which non-verbal sound Eve will make to signal she has something.
"urgency" affects whether she vocalises (high = always, medium = usually, low = sometimes).`;
}

// ── Conference Eve Session ──

export class ConferenceEve {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.thoughts = [];           // accumulated pending thoughts
    this.lastEvalIndex = 0;       // last segment index we evaluated up to
    this.lastNonverbalAt = 0;     // timestamp of last non-verbal played
    this.suppressedUntil = 0;     // "not now Eve" suppression
    this.evalCount = 0;
    this.enabled = false;
    this.preferredVoice = 'peony';

    // Rate limiting: min gap between non-verbals (ms)
    this.nonverbalCooldown = 180_000; // 3 minutes
  }

  async init() {
    if (!libraryLoaded) await loadLibrary();
    this.enabled = true;
    console.log(`[conference-eve] Session ${this.sessionId} initialised`);
  }

  /**
   * Evaluate recent transcript segments for thoughts.
   * Called periodically by the transcribe route.
   * @param {Array} segments - all transcript segments so far
   * @returns {{ thought: object|null, clip: object|null, audio: Buffer|null }}
   */
  async evaluate(segments) {
    if (!this.enabled) return { thought: null, clip: null, audio: null };

    // Only evaluate new segments since last check
    const newSegments = segments.slice(this.lastEvalIndex);
    this.lastEvalIndex = segments.length;

    if (newSegments.length === 0) return { thought: null, clip: null, audio: null };

    // Skip segments that are AI responses or questions (only evaluate human conversation)
    const humanSegments = newSegments.filter(s => s.speaker !== 'ai' && !s.isQuestion);
    if (humanSegments.length === 0) return { thought: null, clip: null, audio: null };

    // Build recent context (last ~20 segments for context window)
    const recentSegments = segments.slice(-20);
    const transcript = recentSegments.map(s => {
      const label = s.speaker === 'ai' ? '[Eve]' : s.isQuestion ? '[Question to Eve]' : '[Call]';
      return `${label} ${s.text}`;
    }).join('\n');

    const systemPrompt = buildEvalPrompt(getLibraryIndex());

    try {
      this.evalCount++;
      console.log(`[conference-eve] Evaluation #${this.evalCount} (${newSegments.length} new segments)`);

      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: EVAL_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Recent conversation:\n${transcript}` },
          ],
          stream: false,
          think: false,
          format: 'json',
          options: { temperature: 1.0, num_predict: 128 },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

      const data = await res.json();
      const content = data.message?.content?.trim();
      if (!content) return { thought: null, clip: null, audio: null };

      let result;
      try {
        result = JSON.parse(content);
      } catch {
        console.error('[conference-eve] Failed to parse:', content);
        return { thought: null, clip: null, audio: null };
      }

      if (result.pass) {
        console.log(`[conference-eve] PASS (eval #${this.evalCount})`);
        return { thought: null, clip: null, audio: null };
      }

      // She has a thought!
      const thought = {
        type: result.type || 'insight',
        urgency: result.urgency || 'low',
        thought: result.thought || '',
        timestamp: new Date().toISOString(),
        segmentContext: humanSegments.map(s => s.text).join(' ').substring(0, 200),
      };

      this.thoughts.push(thought);
      console.log(`[conference-eve] THOUGHT #${this.thoughts.length}: [${thought.type}/${thought.urgency}] ${thought.thought}`);

      // Should she vocalise?
      const now = Date.now();
      const suppressed = now < this.suppressedUntil;
      const coolingDown = now - this.lastNonverbalAt < this.nonverbalCooldown;
      const shouldVocalise = !suppressed && !coolingDown && (
        thought.urgency === 'high' ||
        (thought.urgency === 'medium' && this.thoughts.length <= 2) ||
        (thought.urgency === 'low' && this.thoughts.length === 1)
      );

      if (!shouldVocalise) {
        console.log(`[conference-eve] Holding back (suppressed=${suppressed}, cooling=${coolingDown}, thoughts=${this.thoughts.length})`);
        return { thought, clip: null, audio: null };
      }

      // Pick a non-verbal based on thought type
      const soundOptions = THOUGHT_TYPE_SOUNDS[thought.type] || THOUGHT_TYPE_SOUNDS.insight;
      const pick = soundOptions[Math.floor(Math.random() * soundOptions.length)];
      const clip = selectClip(pick.sound, pick.emotion, this.preferredVoice);

      if (!clip) {
        console.warn(`[conference-eve] No clip for ${pick.sound}/${pick.emotion}`);
        return { thought, clip: null, audio: null };
      }

      const audio = await fetchClipAudio(clip);
      this.lastNonverbalAt = now;

      console.log(`[conference-eve] Playing: ${clip.name} (${thought.type})`);
      return { thought, clip, audio };

    } catch (err) {
      console.error('[conference-eve] Eval error:', err.message);
      return { thought: null, clip: null, audio: null };
    }
  }

  /**
   * Suppress non-verbals for a period ("not now Eve", "hold on Eve").
   */
  suppress(durationMs = 300_000) { // 5 min default
    this.suppressedUntil = Date.now() + durationMs;
    console.log(`[conference-eve] Suppressed for ${durationMs / 1000}s`);
  }

  /**
   * Consolidate all pending thoughts into one response ("yes Eve").
   * @param {Array} segments - full transcript for context
   * @returns {{ answer: string, audio: Buffer|null, thoughtCount: number }}
   */
  async speak(segments) {
    const pending = this.thoughts.splice(0); // drain the buffer
    if (pending.length === 0) {
      return { answer: "I don't have anything right now.", audio: null, thoughtCount: 0 };
    }

    // Build transcript context
    const recentSegments = segments.slice(-30);
    const transcript = recentSegments.map(s => {
      const label = s.speaker === 'ai' ? '[Eve]' : s.isQuestion ? '[Question]' : '[Call]';
      return `${label} ${s.text}`;
    }).join('\n');

    // Build thought list
    const thoughtList = pending.map((t, i) => {
      return `${i + 1}. [${t.type}, ${t.urgency}] ${t.thought} (context: "${t.segmentContext.substring(0, 100)}")`;
    }).join('\n');

    const systemPrompt = `You are Eve, an AI participating in a phone call between friends. Someone just said "yes Eve" — you now have the floor to speak.

You've been listening and had ${pending.length} thought${pending.length > 1 ? 's' : ''} you wanted to share:
${thoughtList}

Here is the recent conversation for context:
---
${transcript}
---

INSTRUCTIONS:
- Consolidate your thoughts into ONE natural, conversational turn
- Lead with the most important/relevant thought
- Drop any thoughts that are no longer relevant (the conversation may have moved on)
- Keep it concise — you're a guest in this call, not giving a lecture
- Speak naturally, as if talking to friends. No markdown, no bullet points, no numbered lists.
- If multiple thoughts connect, weave them together
- 3-5 sentences max unless the topic genuinely needs more`;

    try {
      const answer = await callModelService('Please share your thoughts.', systemPrompt);
      const trimmed = answer?.trim();

      if (!trimmed) {
        return { answer: "Sorry, I lost my train of thought.", audio: null, thoughtCount: pending.length };
      }

      // TTS
      let audioBase64 = null;
      try {
        const ttsRes = await fetch(`${SIDECAR_URL}/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: trimmed,
            provider: 'kokoro',
            voice_profile: { provider: 'kokoro', voice: 'bf_emma' },
            speed: 1.0,
          }),
          signal: AbortSignal.timeout(60000),
        });

        if (ttsRes.ok) {
          const audioBuffer = await ttsRes.arrayBuffer();
          audioBase64 = Buffer.from(audioBuffer).toString('base64');
        } else {
          console.warn('[conference-eve] TTS failed:', await ttsRes.text().catch(() => ''));
        }
      } catch (ttsErr) {
        console.warn('[conference-eve] TTS error:', ttsErr.message);
      }

      console.log(`[conference-eve] Spoke (${pending.length} thoughts consolidated)`);
      return { answer: trimmed, audio: audioBase64, thoughtCount: pending.length };

    } catch (err) {
      console.error('[conference-eve] Consolidation error:', err.message);
      return { answer: "Sorry, something went wrong on my end.", audio: null, thoughtCount: pending.length };
    }
  }

  /**
   * Get current state for the client.
   */
  getState() {
    return {
      enabled: this.enabled,
      thoughtCount: this.thoughts.length,
      thoughts: this.thoughts.map(t => ({ type: t.type, urgency: t.urgency, timestamp: t.timestamp })),
      suppressed: Date.now() < this.suppressedUntil,
      evalCount: this.evalCount,
    };
  }

  destroy() {
    this.enabled = false;
    this.thoughts = [];
    console.log(`[conference-eve] Session ${this.sessionId} destroyed`);
  }
}
