# Future Enhancements

## 1. Settings Panel: API Key Management & Model Selection

**Status:** Implemented (2026-02-09)
**Priority:** High — blocks use of cloud AI providers (Claude API, OpenAI)

### Current State
- The Settings panel (gear icon) lets you pick providers per feature (scan/embedding/tagging)
- Options include Claude API and OpenAI API, but there are **no input fields to enter API keys**
- `crypto-manager.js` exists and works — encrypts keys in localStorage
- Server-side config at `server/data/config.json` stores provider selections but not keys
- Keys are meant to be passed per-request via `x-api-key` header

### What Was Implemented (2026-02-09)
- API key inputs always visible for Claude (Anthropic), OpenAI, and Brave Search
- Keys encrypted in browser localStorage via existing `crypto-manager.js`
- Status dots show key saved/not saved
- Model selection dropdowns per feature (scan/embedding/tagging):
  - Ollama: synced model list with name, parameters, size
  - Claude API: Claude Haiku 4.5, Sonnet 4.5, Opus 4.6
  - OpenAI: GPT-4o Mini, GPT-4o, GPT-4 Turbo
- Sync button fetches Ollama models, cached in localStorage
- Server stores selected models in `config.json` under `models` key
- `ai-provider.js` reads configured model, falls back to auto-detect if empty
- Ollama Connection section always visible (not gated by provider selection)

### Reference
- **Pattern**: See `client/src/services/crypto-manager.js` for the encryption/decryption implementation

### Implementation Notes
- The SettingsPanel already imports `cryptoManager` — just needs the input fields
- Providers needing keys: `claude` (Anthropic API key), `openai` (OpenAI API key)
- Ollama and Claude CLI don't need keys (local)
- Embedded model doesn't need keys (bundled)

---

## 2. Artifacts: UI Documentation & Discoverability

**Status:** Implemented (2026-02-09)
**Priority:** Medium

### What Was Implemented (2026-02-09)
- Dedicated "Artifacts" node (white, UUID `...0080`) created on server startup — serves as default home for chat-created documents
- `create_artifact` tool now defaults to the Artifacts node when no `node_id` is specified
- Chat empty-state hint: "Tip: Ask me to create research summaries, guides, or code — I'll save them as documents."
- Artifacts section in NodePanel: shows `file://` resources with type badges (MD/HTML/TXT), expandable content preview
- System prompt tells the AI about the Artifacts node so it knows to use it

---

## 3. Editable System Prompt for Chat AI

**Status:** Implemented (2026-02-09)
**Priority:** Medium

### What Was Implemented (2026-02-09)
- Two editable system prompts: "Assistant Prompt" and "Research Prompt" — stored in `server/data/config.json` under `chat` key
- Editable "Behavioral Guidelines" textarea (shared between both modes, one line per bullet point)
- Settings panel section: "Chat Prompts" with Save + Reset to Defaults buttons
- Research/Assistant toggle in chat UI — two pill buttons above the input area
- Visual cue: blue tint on input border and "Deep research mode" label when in research mode
- `buildSystemPrompt(userMessage, mode)` reads prompts from config, falls back to defaults
- Mode passed from frontend (`useChat`) → POST body → `chat.js` route
- Dynamic parts (node summary, RAG context, tool definitions) remain auto-injected

### Config Shape
```json
{
  "chat": {
    "assistantPrompt": "You are the Idea Basin assistant...",
    "researchPrompt": "You are a research assistant...",
    "guidelines": "Be concise and helpful. Use short paragraphs.\n..."
  }
}
```

---

## 4. Quick Capture Improvements

**Status:** v1 complete (2026-02-09)
**Priority:** Low

### Current State
- Print Screen (F13) triggers macOS screen capture, then opens capture popup
- Scissors button in toolbar triggers same flow
- Saves to selected node (defaults to "Idea Basin" scrap drawer)
- Optional "Tag & embed" checkbox for ingestion
- Tray icon in menu bar with Quick Capture option

### Potential Improvements
- Remember last-used node across sessions (currently resets on window recreate)
- Show a brief toast in the main app after successful capture
- OCR for image captures (extract text from screenshots for embedding)
- Drag-and-drop into the capture window
- Keyboard shortcut shown in the scissors button tooltip
