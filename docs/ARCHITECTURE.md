# Architecture - Technical Decisions

This document tells the story of the forks in the road and the reasons behind the choices. When you ask yourself "why did we do it this way?", the answer is here.

## Backend runtime: mlx_lm.server, not LM Studio

### The 3 options considered

| Backend | Pros | Cons |
|---|---|---|
| **mlx_lm.server** (native Apple MLX via uv) | Zero overhead, ~5-15% faster, native MLX, explicit thinking control via `--chat-template-args` | 1 model at a time, model names = full path |
| **LM Studio server** | JIT load/eject, automatic switching, GUI, embedding service included | Wrapper adds +5-15% overhead. **Thinking is on by default on Qwen3/GLM models and cannot be disabled via the API** (requires editing the preset in the GUI) |
| **llama.cpp server** | GGUF only | **2-2.5x slower** than MLX on Apple Silicon for MoE (no Neural Accelerators) |

### Decision

**`mlx_lm.server`**, because:

1. **Performance**: 32 t/s on GLM (vs 27 t/s on LM Studio = -15%)
2. **Thinking off via flag**: agentic workflows need `enable_thinking: false`. mlx_lm.server takes it as `--chat-template-args '{"enable_thinking":false}'`. LM Studio does not honor `chat_template_kwargs` in the body, so the model preset has to be edited in the GUI.
3. **It uses the M5 Neural Accelerators**, which llama.cpp does not.

### Accepted tradeoff

`mlx_lm.server` exposes the model's **full path** as its model ID (e.g. `/Users/.../GLM-4.7-Flash-MLX-4bit`). Ugly in `opencode.json`, but functional.

LM Studio stays installed because it serves as the **model catalog** (`lms get`, `lms ls`), but we do not use the LM Studio server. Models live in `~/.lmstudio/models/` and mlx_lm.server points straight at them.

## One active model at a time

### Mistake made

Initially proposed: 2 simultaneous servers on 1234 (build) + 1235 (plan), for opencode's agent.plan and agent.build.

### What happened

Loading Qwen3.6-35B (20 GB) + Qwen3-Instruct (17 GB) = 37 GB of weights required. On 32 GB total:
- macOS system: 4 GB
- Background apps: 6 GB
- 2 models: 37 GB → **15 GB over**
- Result: swap blows up from 11 GB to 29 GB, compressor from 1.6 GB to 16.7 GB, **thrashing**

### Lesson

On 32 GB, **only one MoE active at a time**. Changing model requires a kill + restart (~10-30s of cold load overhead).

The `llm-up <profile>` script does exactly this: it stops the previous server with `pkill`, then launches the new one. In `opencode.json`, opencode has all 4 models in the `mlx` provider, but the user chooses which one is active through the switch.

## Context window: 64k, KV FP16

### Calculation

For a 30-35B MoE with modern GQA (Qwen3 / GLM):
- ~100 KB per token of KV cache in FP16
- 64k context = **~6.4 GB of KV cache**

On 32 GB with a 16-20 GB model loaded:
- Model: 16-20 GB
- KV @ 64k: 6.4 GB
- Wired target total: 22-26 GB
- Margin: ~6-10 GB for the system (with `iogpu.wired_limit_mb=28000`)

### Why not 128k or 256k

At 128k the KV becomes 12.8 GB. With Qwen3.6 (20 GB) the total breaks through 32 GB → guaranteed swap during decode. Also, a 128k prefill = 1-3 minutes of "thinking" before the first token, which ruins the agentic UX.

At 64k the time-to-first-token on a full prompt is 30-50s, tolerable.

The opencode docs recommend a minimum of 64k for reliable tool calling. Aligned.

## Dashboard backend: FastAPI with SSE, not WebSocket

### What needs real-time

- **Status / memory**: cyclic data. **HTTP polling** every 2s works fine (3 endpoints, 200 bytes each).
- **Chat streaming**: token-by-token server→client push. **SSE is perfect** (unidirectional, automatic reconnect, standard HTTP).

### Why not WebSocket

| | SSE | WebSocket |
|---|---|---|
| Direction | server→client | bidirectional |
| Protocol | plain HTTP | separate upgrade |
| Automatic reconnect | yes, built in | has to be implemented |
| Auth (cookie/header) | standard HTTP | more complicated |
| Complexity | very low | medium |

WebSocket would be over-engineering: the client sends 1 request and receives N tokens. Single direction. The same choice OpenAI / Anthropic / Mistral make in their streaming APIs.

## Frontend: built Tailwind v4 + Alpine.js, no React

### The principle

The user wants "light but complete", with no React/Vite/npm watch infrastructure.

### Chosen stack

- **Tailwind v4 built** via the pnpm CLI (`pnpm run build`). CSS-first via `@theme`. Minified output `static/output.css` ~18 KB.
- **Alpine.js 3.14** (~17 KB) as a static asset (no CDN). Reactivity + state via `x-data`, `x-text`, `x-show`, custom DOM events (`conv:select`, `conv:new`, `conv:list`).
- **marked.js** for markdown + **highlight.js** for syntax highlighting as static assets.
- **Geist + JetBrains Mono** via Google Fonts (browser caching).

### Separate file structure

- `templates/index.html` (structure)
- `static/app.js` (Alpine logic, exposed as `dash()`, `chat()`, `conversations()`, `logsView()`)
- `src/input.css` (Tailwind input + custom `@layer components`)
- `main.py` (FastAPI server + endpoints)

No bundler, no node_modules in critical paths. Edit `app.js` or `index.html` and reload the browser.

## Rejected: LM Studio as the default

Rationalized after running the bench:

1. **Performance**: LM Studio = 27.7 t/s, mlx_lm.server = 32.0 t/s. -13% overhead measured.
2. **Thinking control**: LM Studio does not honor `chat_template_kwargs` in the body. The preset has to be edited in the GUI. mlx_lm.server exposes the CLI flag directly.
3. **Footprint**: the LM Studio app has to stay open to serve (even in the background). mlx_lm.server is a plain Python process.

LM Studio remains useful for: `lms get` (download), `lms ls` (catalog), the model-browsing GUI. For the serving runtime: mlx_lm.server.

## Rejected: Markdown docs viewer in cmux

It would have been handy but adds an external dependency. Documentation lives in `docs/` and can be read in any editor, or in GitHub's rendering if it ever becomes a public repo.

## Rejected: MCP control panel

The user already has 1 MCP server (`context7`) configured in opencode. For someone managing 1-2 MCPs, a control panel adds no value. Skipped.

## The "Quiet Instrument" design decision

The user asked for a minimal-beautiful style, in the manner of developer tools. I rejected the ChatGPT-clone stereotype and chose:

- **Typography**: only Geist (sans) + JetBrains Mono (mono). No serif, no Inter (overused).
- **Color**: monochrome zinc + a single accent, **electric lime `#a3e635`** (oscilloscope green).
- **Layout**: 3 clean columns, frames with a 1px hairline border (no shadow), LCD-style metric bars with vertical texture.
- **Proper capitalization**: "Online", "Halt Server", "Transmit". Only the `caption`s stay in spec-sheet UPPERCASE small-caps.

The full design system is in `src/input.css` with `@layer components`.

## Runtime stack summary

```
[Browser] ←─2s polling─┐
                       │
[Browser] ←─SSE token─┐│
                      ▼▼
        ┌──────────────────────────────────┐
        │ llm-dash (FastAPI, port 1230)    │
        │  /api/status  ─ psutil → PID     │
        │  /api/memory  ─ psutil           │
        │  /api/switch  ─ subprocess llm-up│
        │  /api/chat    ─ httpx stream → ──┼──┐
        └──────────────────────────────────┘  │
                                              ▼
                          mlx_lm.server (port 1234, OpenAI-compat)
                                              │
                                       GLM-4.7-Flash MLX (active)
```

Three processes: dashboard (1230), LLM runtime (1234), opencode when in use. No Docker, no containers, everything at user level.
