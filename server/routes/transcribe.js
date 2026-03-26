import { Router } from 'express';
import multer from 'multer';
import { createResource } from '../db/queries.js';
import { ingest } from '../workers/ingest.js';
import { ConferenceEve } from '../services/conferenceEve.js';

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

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB per chunk

const SIDECAR_URL = process.env.SIDECAR_URL || 'http://localhost:3501';

// Active transcription sessions: sessionId -> { segments, startedAt, title, eve }
const sessions = new Map();

// ── POST /api/transcribe/start — begin a new session ──
router.post('/start', (req, res) => {
  const id = crypto.randomUUID();
  sessions.set(id, {
    segments: [],
    startedAt: new Date().toISOString(),
    title: req.body.title || `Call ${new Date().toLocaleDateString('en-GB')}`,
    eve: null, // Conference Eve instance, created on toggle
  });
  res.json({ sessionId: id });
});

// ── POST /api/transcribe/eve/enable/:sessionId — toggle Conference Eve on ──
router.post('/eve/enable/:sessionId', async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!session.eve) {
    session.eve = new ConferenceEve(req.params.sessionId);
  }
  await session.eve.init();
  res.json({ ok: true, state: session.eve.getState() });
});

// ── POST /api/transcribe/eve/disable/:sessionId — toggle Conference Eve off ──
router.post('/eve/disable/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.eve) {
    session.eve.destroy();
    session.eve = null;
  }
  res.json({ ok: true });
});

// ── GET /api/transcribe/eve/state/:sessionId — get Eve's current state ──
router.get('/eve/state/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.eve) return res.json({ enabled: false, thoughtCount: 0, thoughts: [] });
  res.json(session.eve.getState());
});

// ── POST /api/transcribe/eve/suppress/:sessionId — "not now Eve" ──
router.post('/eve/suppress/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session?.eve) return res.status(404).json({ error: 'Eve not active' });

  const duration = req.body.duration || 300_000; // 5 min default
  session.eve.suppress(duration);
  res.json({ ok: true, suppressedUntil: Date.now() + duration });
});

// ── POST /api/transcribe/eve/speak/:sessionId — "yes Eve" → consolidated response ──
router.post('/eve/speak/:sessionId', async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session?.eve) return res.status(404).json({ error: 'Eve not active' });

  const result = await session.eve.speak(session.segments);

  // Add Eve's response to the transcript
  if (result.answer) {
    session.segments.push({
      index: session.segments.length,
      timestamp: new Date().toISOString(),
      text: result.answer,
      speaker: 'ai',
    });
  }

  res.json({
    ok: true,
    answer: result.answer,
    audio: result.audio,
    thoughtCount: result.thoughtCount,
  });
});

// ── POST /api/transcribe/chunk/:sessionId — send an audio chunk for transcription ──
router.post('/chunk/:sessionId', upload.single('audio'), async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!req.file) return res.status(400).json({ error: 'No audio file' });

  try {
    // Forward to Whisper sidecar
    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
    formData.append('audio', blob, 'chunk.wav');

    const sttRes = await fetch(`${SIDECAR_URL}/transcribe`, {
      method: 'POST',
      body: formData,
    });

    if (!sttRes.ok) {
      const err = await sttRes.text();
      throw new Error(`Whisper error ${sttRes.status}: ${err}`);
    }

    const { text } = await sttRes.json();
    const trimmed = text?.trim();

    if (trimmed) {
      // Check for "yes Eve" — triggers consolidated speak
      const yesEveMatch = /\byes\s+eve\b/i.test(trimmed);
      // Check for "not now Eve" / "hold on Eve"
      const suppressMatch = /\b(not\s+now|hold\s+on|quiet|shush|shut\s+up)\s+eve\b/i.test(trimmed);
      // Check for "hey eve" wake word
      const eveMatch = trimmed.match(/\bhey\s+eve\b[\s,.:!?]*(.*)/i);

      const segment = {
        index: session.segments.length,
        timestamp: new Date().toISOString(),
        text: trimmed,
        speaker: 'human',
        wakeWord: !!eveMatch,
        question: eveMatch ? (eveMatch[1]?.trim() || null) : undefined,
        yesEve: yesEveMatch,
        suppressEve: suppressMatch,
      };
      session.segments.push(segment);

      // Handle Eve commands
      if (suppressMatch && session.eve) {
        session.eve.suppress();
      }

      // Run Eve evaluation in background (don't block the response)
      let eveReaction = null;
      if (session.eve?.enabled && !yesEveMatch && !suppressMatch) {
        // Fire and forget — client polls for results
        session._pendingEveEval = session.eve.evaluate(session.segments).then(result => {
          session._lastEveReaction = result;
        }).catch(err => {
          console.error('[transcribe] Eve eval error:', err.message);
        });
      }

      res.json({ ok: true, segment, eveReaction });
    } else {
      res.json({ ok: true, segment: null }); // silence
    }
  } catch (err) {
    console.error('[transcribe] Chunk error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/transcribe/eve/reaction/:sessionId — poll for Eve's latest reaction ──
router.get('/eve/reaction/:sessionId', async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Wait for any pending evaluation to complete (max 20s)
  if (session._pendingEveEval) {
    try {
      await Promise.race([
        session._pendingEveEval,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000)),
      ]);
    } catch {}
    session._pendingEveEval = null;
  }

  const reaction = session._lastEveReaction || null;
  session._lastEveReaction = null;

  if (!reaction || !reaction.thought) {
    return res.json({ hasReaction: false });
  }

  // Return the reaction with audio as base64
  const result = {
    hasReaction: true,
    thought: reaction.thought,
    clip: reaction.clip ? { name: reaction.clip.name, emotion: reaction.clip.emotion } : null,
    audio: reaction.audio ? reaction.audio.toString('base64') : null,
    state: session.eve?.getState(),
  };

  res.json(result);
});

// ── POST /api/transcribe/ask/:sessionId — ask AI a question with transcript context ──
router.post('/ask/:sessionId', async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { question } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'question required' });

  // Build transcript context (last ~50 segments to stay within context limits)
  const recentSegments = session.segments.slice(-50);
  const transcriptContext = recentSegments.map(s => {
    const label = s.speaker === 'ai' ? '[AI]' : '[Call]';
    return `${label} ${s.text}`;
  }).join('\n');

  const systemPrompt = `You are participating in a live phone call as a helpful AI assistant. The call is between friends and you've been invited to contribute.

You can hear what's being said (via transcription). When asked a question, give a concise, conversational answer — this will be spoken aloud via TTS so keep it natural and not too long. Aim for 2-4 sentences unless more detail is specifically requested.

Don't use markdown formatting, bullet points, or numbered lists — your response will be spoken aloud. Write the way you'd speak.

Here is the conversation so far:
---
${transcriptContext || '(No transcript yet)'}
---`;

  try {
    console.log(`[transcribe] AI question: "${question.substring(0, 100)}"`);
    const answer = await callModelService(question, systemPrompt);
    const trimmedAnswer = answer?.trim();

    if (!trimmedAnswer) {
      return res.status(502).json({ error: 'Empty response from AI' });
    }

    // Add both question and answer to transcript
    session.segments.push({
      index: session.segments.length,
      timestamp: new Date().toISOString(),
      text: question.trim(),
      speaker: 'human',
      isQuestion: true,
    });
    session.segments.push({
      index: session.segments.length,
      timestamp: new Date().toISOString(),
      text: trimmedAnswer,
      speaker: 'ai',
    });

    // Synthesize TTS
    let audioBase64 = null;
    try {
      const ttsRes = await fetch(`${SIDECAR_URL}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmedAnswer,
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
        console.warn('[transcribe] TTS failed:', await ttsRes.text().catch(() => ''));
      }
    } catch (ttsErr) {
      console.warn('[transcribe] TTS error:', ttsErr.message);
    }

    res.json({
      ok: true,
      answer: trimmedAnswer,
      audio: audioBase64,
    });
  } catch (err) {
    console.error('[transcribe] AI error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/transcribe/session/:sessionId — get current transcript ──
router.get('/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({
    title: session.title,
    startedAt: session.startedAt,
    segments: session.segments,
    eve: session.eve?.getState() || null,
  });
});

// ── POST /api/transcribe/save/:sessionId — save transcript to Idea Basin ──
router.post('/save/:sessionId', async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.segments.length === 0) return res.status(400).json({ error: 'No transcript to save' });

  const { node_id } = req.body;
  const WHATSAPP_NODE = '00000000-0000-0000-0000-000000000090';
  const targetNode = node_id || WHATSAPP_NODE;

  // Build full transcript text
  const transcript = session.segments.map(s => {
    const time = new Date(s.timestamp);
    const hh = String(time.getHours()).padStart(2, '0');
    const mm = String(time.getMinutes()).padStart(2, '0');
    const ss = String(time.getSeconds()).padStart(2, '0');
    const label = s.speaker === 'ai' ? '[Eve]' : s.isQuestion ? '[Question]' : '';
    const prefix = label ? `${label} ` : '';
    return `[${hh}:${mm}:${ss}] ${prefix}${s.text}`;
  }).join('\n\n');

  const content = `# ${session.title}\n\nStarted: ${session.startedAt}\nSegments: ${session.segments.length}\n\n---\n\n${transcript}`;

  try {
    const resource = await createResource({
      node_id: targetNode,
      type: 'note',
      why: 'Call transcription',
      description: `${session.title} — ${session.segments.length} segments`,
      content,
      status: 'pending',
    });

    // Trigger ingestion for RAG embedding
    ingest(resource.id).catch(err => console.error(`[transcribe] Ingest failed:`, err.message));

    // Clean up Eve
    if (session.eve) session.eve.destroy();

    res.json({ ok: true, resourceId: resource.id });
  } catch (err) {
    console.error('[transcribe] Save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/transcribe/session/:sessionId — discard a session ──
router.delete('/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (session?.eve) session.eve.destroy();
  sessions.delete(req.params.sessionId);
  res.json({ ok: true });
});

export default router;
