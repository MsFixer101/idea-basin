# Idea Basin — AI Configuration

Idea Basin uses AI for three features: **scanning** (classifying files into nodes), **embedding** (vector search), and **tagging** (auto-generating tags and summaries). Each feature can be configured independently via the Settings panel.

## Provider Options

| Provider | Scan | Embedding | Tagging | Requires |
|----------|------|-----------|---------|----------|
| **Embedded** | Cosine similarity matching | 384-dim vectors (bge-micro-v2) | — | Nothing (ships with app) |
| **Ollama** | LLM classification with reasons | 768-dim vectors (nomic-embed-text) | Tags + summaries | Ollama running locally |
| **Claude API** | LLM classification with reasons | — | Tags + summaries | Anthropic API key |
| **OpenAI API** | LLM classification with reasons | — | Tags + summaries | OpenAI API key |

## Default Configuration

Out of the box, Idea Basin runs with:
- **Scan:** Embedded (offline, no setup)
- **Embedding:** Embedded (offline, no setup)
- **Tagging:** Disabled

This means the app works immediately without any external services. The embedded model (~25 MB) downloads automatically on first use.

## Setup by Provider

### Embedded (zero-config default)

No setup needed. The app uses `TaylorAI/bge-micro-v2` (quantized) via Transformers.js. The model downloads to `server/data/models/` on first use and is cached for subsequent runs.

- **Scan:** Matches files to nodes using cosine similarity between file content and node descriptions
- **Embedding:** Produces 384-dimensional vectors stored in the `embedding_384` column
- **Tagging:** Not available via embedded model (set tagging to Ollama or a cloud API if you want tags)

### Ollama (local, full-featured)

1. Install Ollama: https://ollama.com
2. Pull required models:
   ```bash
   ollama pull nomic-embed-text   # for embeddings
   ollama pull qwen2.5:7b         # for scan + tagging (or any chat model)
   ```
3. In Settings, set providers to "Ollama"
4. Verify the connection status shows green

Ollama URL defaults to `http://localhost:11434`. Change it in Settings if running on a different host/port.

### Claude API

1. Get an API key from https://console.anthropic.com
2. In Settings, set Scan and/or Tagging to "Claude API"
3. Enter your API key in the API Keys section
4. Uses `claude-haiku-4-5-20251001` (fast, cost-effective)

API keys are encrypted with AES-GCM and stored in your browser's localStorage. They are sent to the server per-request in the `x-api-key` header but never stored on disk.

### OpenAI API

1. Get an API key from https://platform.openai.com
2. In Settings, set Scan and/or Tagging to "OpenAI API"
3. Enter your API key in the API Keys section
4. Uses `gpt-4o-mini` (fast, cost-effective)

## Recommended Configurations

### Offline (no internet required)
| Feature | Provider |
|---------|----------|
| Scan | Embedded |
| Embedding | Embedded |
| Tagging | Disabled |

### Balanced (local with full features)
| Feature | Provider |
|---------|----------|
| Scan | Ollama |
| Embedding | Embedded |
| Tagging | Ollama |

### Quality (cloud APIs)
| Feature | Provider |
|---------|----------|
| Scan | Claude API |
| Embedding | Embedded |
| Tagging | Claude API |

## Embedding Dimensions

The database supports two embedding dimensions:
- `embedding` column: 768-dim (Ollama nomic-embed-text)
- `embedding_384` column: 384-dim (embedded bge-micro-v2)

When you search, the query is embedded with whatever provider is currently configured, and the search queries the matching column. Existing embeddings in the other column are preserved — switching providers doesn't destroy data.

## Mobile Access via Tailscale

Idea Basin works in mobile browsers. To access it securely from your phone without exposing it to the public internet, use [Tailscale](https://tailscale.com) — a private mesh VPN built on WireGuard.

### Setup

1. **Install Tailscale** on both your Mac (server) and phone
   - Mac: https://tailscale.com/download/mac
   - iOS: App Store
   - Android: Play Store
2. **Sign in** on both devices with the same account — they'll join the same private tailnet
3. **Start the Idea Basin server** on your Mac:
   ```bash
   cd server && npm run dev
   ```
4. **Find your Mac's Tailscale IP:**
   ```bash
   tailscale ip -4
   ```
   This returns a `100.x.y.z` address — only visible to your tailnet devices
5. **Open on your phone:** `http://100.x.y.z:3500`

### Why not just use local WiFi?

You could access `http://<mac-local-ip>:3500` on the same WiFi, but Tailscale is better because:

- **Works off-network** — access your basin from anywhere, not just home WiFi
- **Encrypted** — WireGuard encryption means HTTP is fine (no need for HTTPS/certs)
- **No port forwarding** — nothing exposed to the internet, no router config needed
- **Private** — only your devices can see the server

### Production-style mobile access

For a smoother experience, build the client so everything serves from one port:

```bash
cd client && npm run build    # outputs to client/dist/
cd ../server && npm run dev   # serves API on :3500
```

Then configure Express to serve the built client (or add a static middleware for `../client/dist`).

### Notes

- API keys in localStorage are per-browser — re-enter them on your phone
- The responsive UI adapts to mobile viewports (buttons stack, panel goes full-width)
- File scanning paths (like `/Users/you/...`) reference the server's filesystem, which is your Mac

## Troubleshooting

**Embedded model fails to load**
- Check `server/data/models/` for cached files. Delete the directory to force re-download.
- Ensure Node.js has internet access for the initial download.

**Ollama not reachable**
- Verify Ollama is running: `curl http://localhost:11434/api/tags`
- Check the URL in Settings matches your Ollama instance.

**Scan returns no matches (embedded mode)**
- The similarity threshold is 0.3. If your node descriptions are too short or generic, files may not match.
- Add more descriptive text to node descriptions and "why" fields.

**API key errors**
- Verify the key is correct by testing in the provider's web console.
- If you see decryption errors, the browser fingerprint may have changed. Remove and re-enter the key.

**Search returns no results after switching embedding provider**
- Existing chunks were embedded with the previous provider's dimension. New chunks will use the new dimension.
- To re-embed existing resources, use the "Re-ingest" button on individual resources.
