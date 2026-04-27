# Architettura - Decisioni Tecniche

Questo documento racconta i bivi e le motivazioni dietro le scelte. Quando ti chiedi "perché abbiamo fatto così?", la risposta è qui.

## Backend runtime: mlx_lm.server, non LM Studio

### Le 3 opzioni considerate

| Backend | Pro | Contro |
|---|---|---|
| **mlx_lm.server** (Apple MLX nativo via uv) | Zero overhead, ~5-15% più veloce, MLX nativo, controllo esplicito thinking via `--chat-template-args` | 1 modello/volta, nomi modello = path completo |
| **LM Studio server** | JIT load/eject, switch automatico, GUI, embedding service incluso | Wrapper +5-15% overhead. **Thinking attivo di default su modelli Qwen3/GLM e non disabilitabile via API** (richiede edit del preset in GUI) |
| **llama.cpp server** | Solo per GGUF | **2-2.5x più lento** di MLX su Apple Silicon per MoE (no Neural Accelerators) |

### Decisione

**`mlx_lm.server`**, perché:

1. **Performance**: 32 t/s su GLM (vs 27 t/s LM Studio = -15%)
2. **Thinking off via flag**: per workflow agentic serve `enable_thinking: false`. mlx_lm.server lo prende come `--chat-template-args '{"enable_thinking":false}'`. LM Studio non rispetta `chat_template_kwargs` nel body, serve modificare il preset del modello in GUI.
3. **Sfrutta i Neural Accelerators dell'M5** che llama.cpp non usa.

### Tradeoff accettato

`mlx_lm.server` espone come model ID il **path completo** del modello (es. `/Users/.../GLM-4.7-Flash-MLX-4bit`). Brutto in `opencode.json`, ma funzionale.

LM Studio resta installato perché serve come **catalogo modelli** (`lms get`, `lms ls`), ma il server LM Studio non lo usiamo. I modelli vivono in `~/.lmstudio/models/` e mlx_lm.server vi punta direttamente.

## Un solo modello attivo per volta

### Errore commesso

Inizialmente proposto: 2 server simultanei su 1234 (build) + 1235 (plan). Per agent.plan e agent.build di opencode.

### Cosa è successo

Caricare Qwen3.6-35B (20 GB) + Qwen3-Instruct (17 GB) = 37 GB di pesi richiesti. Su 32 GB totali:
- macOS sistema: 4 GB
- App background: 6 GB
- 2 modelli: 37 GB → **sforamento 15 GB**
- Risultato: swap esplode da 11 GB a 29 GB, compressor da 1.6 GB a 16.7 GB, **thrashing**

### Lezione

Su 32 GB **un solo MoE attivo per volta**. Per cambiare modello serve un kill + restart (overhead ~10-30s di cold load).

Lo script `llm-up <profile>` fa proprio questo: ferma il server precedente con `pkill`, poi lancia il nuovo. opencode in `opencode.json` ha tutti i 4 modelli nel provider `mlx`, ma user-driven sceglie quale è attivo via switch.

## Context window: 64k, KV FP16

### Calcolo

Per MoE 30-35B con GQA moderna (Qwen3 / GLM):
- ~100 KB per token KV cache in FP16
- 64k context = **~6.4 GB di KV cache**

Su 32 GB con un modello 16-20 GB caricato:
- Modello: 16-20 GB
- KV @ 64k: 6.4 GB
- Totale wired-target: 22-26 GB
- Margine: ~6-10 GB per sistema (con `iogpu.wired_limit_mb=28000`)

### Perché non 128k o 256k

A 128k il KV diventa 12.8 GB. Con Qwen3.6 (20 GB) il totale schiena 32 GB → swap garantito durante decode. Inoltre prefill di 128k = 1-3 minuti di "thinking" prima del primo token, che rovina l'UX agentic.

A 64k il time-to-first-token su prompt pieno è 30-50s, tollerabile.

opencode docs raccomandano minimo 64k per tool calling affidabile. Allineato.

## Dashboard backend: FastAPI con SSE, non WebSocket

### Per cosa serve la real-time

- **Status / memoria**: dati ciclici. **HTTP polling** ogni 2s va benissimo (3 endpoint, 200 byte ognuno).
- **Chat streaming**: token-per-token push server→client. **SSE perfetto** (unidirezionale, riconnect automatico, HTTP standard).

### Perché non WebSocket

| | SSE | WebSocket |
|---|---|---|
| Direzione | server→client | bidirezionale |
| Protocollo | HTTP normale | upgrade separato |
| Riconnect automatico | sì built-in | va implementato |
| Auth (cookie/header) | standard HTTP | più complicato |
| Complessità | bassissima | media |

WebSocket sarebbe over-engineering: il client manda 1 request, riceve N token. Direzione single. Stessa scelta che fanno OpenAI / Anthropic / Mistral nelle loro API streaming.

## Frontend: Tailwind v4 buildato + Alpine.js, niente React

### Il principio

L'utente vuole "leggera ma completa" - non vuole infrastruttura React/Vite/npm watch.

### Stack scelto

- **Tailwind v4 buildato** via pnpm CLI (`pnpm run build`). CSS-first via `@theme` come progetti Yellow. Output minificato `static/output.css` ~18 KB.
- **Alpine.js 3.14** (~17 KB) come asset statico (no CDN). Reattività + state via `x-data`, `x-text`, `x-show`, eventi DOM custom (`conv:select`, `conv:new`, `conv:list`).
- **marked.js** per markdown + **highlight.js** per syntax highlighting come asset statici.
- **Geist + JetBrains Mono** via Google Fonts (caching browser).

### File structure separati

- `templates/index.html` (struttura)
- `static/app.js` (logica Alpine, esposta come `dash()`, `chat()`, `conversations()`, `logsView()`)
- `src/input.css` (Tailwind input + custom `@layer components`)
- `main.py` (FastAPI server + endpoints)

Niente bundler, niente node_modules in path critici. Editi `app.js` o `index.html` e refreshi il browser.

## Scartato: LM Studio come default

Razionalizzato dopo aver fatto il bench:

1. **Performance**: LM Studio = 27.7 t/s, mlx_lm.server = 32.0 t/s. -13% di overhead misurato.
2. **Thinking control**: LM Studio non rispetta `chat_template_kwargs` nel body. Serve modificare il preset in GUI. mlx_lm.server espone direttamente il flag CLI.
3. **Footprint**: LM Studio app deve restare aperta per servire (anche se in background). mlx_lm.server è un processo Python puro.

LM Studio resta utile per: `lms get` (download), `lms ls` (catalogo), GUI di esplorazione modelli. Per il runtime di servizio: mlx_lm.server.

## Scartato: docs Markdown viewer in cmux

Sarebbe stato comodo ma aggiunge dipendenza esterna. Documentazione vive in `docs/` e si legge in qualunque editor o sul GitHub render se mai diventa repo pubblico.

## Scartato: MCP control panel

L'utente già ha 1 MCP server (`context7`) configurato in opencode. Per chi gestisce 1-2 MCP, un control panel non aggiunge valore. Skippato.

## Decisione "Quiet Instrument" per il design

L'utente ha richiesto stile minimal-bello, da developer tools. Ho rifiutato lo stereotipo ChatGPT-clone e ho scelto:

- **Tipografia**: solo Geist (sans) + JetBrains Mono (mono). Niente serif, niente Inter (overused).
- **Color**: monocromatico zinc + un solo accent **lime electric `#a3e635`** (oscilloscope green).
- **Layout**: 3 colonne nette, frame con border 1px hairline (no shadow), barre metriche LCD-style con texture verticale.
- **Capitalize correttamente**: "Online", "Halt Server", "Transmit". Solo i `caption` rimangono in UPPERCASE small-caps stile spec sheet.

Il design system completo è in `src/input.css` con `@layer components`.

## Stack runtime sintesi

```
[Browser] ←─2s polling─┐
                       │
[Browser] ←─SSE token─┐│
                      ▼▼
        ┌──────────────────────────────────┐
        │ llm-dash (FastAPI, porta 1230)   │
        │  /api/status  ─ psutil → PID     │
        │  /api/memory  ─ psutil           │
        │  /api/switch  ─ subprocess llm-up│
        │  /api/chat    ─ httpx stream → ──┼──┐
        └──────────────────────────────────┘  │
                                              ▼
                          mlx_lm.server (porta 1234, OpenAI-compat)
                                              │
                                       GLM-4.7-Flash MLX (active)
```

Tre processi: dashboard (1230), runtime LLM (1234), opencode quando in uso. Niente Docker, niente container, tutto user-level.
