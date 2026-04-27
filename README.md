# LLM Dash

Piattaforma personale per gestire LLM locali su Apple Silicon - control plane + dashboard web + integrazione opencode.

```
   LLM·Dash
   ──────────
   Local AI runtime + chat browser + control panel
   Optimized for MacBook Pro M5 / 32 GB unified memory
```

## In sintesi

- **Runtime backend**: `mlx_lm.server` (Apple MLX nativo, ~32 t/s su MoE 4-bit)
- **Modelli core**: GLM-4.7-Flash, Qwen3.6-35B-A3B, Qwen3-30B-Instruct, Qwen3-Coder-30B
- **Frontend agent**: opencode (CLI agentic)
- **UI web**: dashboard FastAPI + Tailwind v4 + Alpine.js (porta 1230)
- **1 modello attivo per volta** (32 GB non bastano per 2 MoE da 16+ GB)

## Quick start

```bash
# 1. Setup (una volta sola)
make setup                   # symlink script + build CSS

# 2. Wired memory limit (una volta, manuale per sudo)
sudo sysctl iogpu.wired_limit_mb=28000
# Persistente al boot:
sudo cp config/com.local.wired-limit.plist /Library/LaunchDaemons/
sudo launchctl load /Library/LaunchDaemons/com.local.wired-limit.plist

# 3. Config opencode (se non già fatta)
cp config/opencode.json.example ~/.config/opencode/opencode.json

# 4. Avvia tutto
llm-up build                 # avvia GLM-4.7 su porta 1234
llm-dash --bg                # avvia dashboard su porta 1230
open http://127.0.0.1:1230   # control panel + chat
```

## Comandi quotidiani

| Comando | Cosa fa |
|---|---|
| `llm-up [profile]` | Avvia mlx_lm.server con un profilo (default: build) |
| `llm-switch <profile>` | Cambia modello (kill + restart) |
| `llm-down` | Ferma server LLM |
| `llm-dash` | Dashboard UI in foreground |
| `llm-dash --bg` | Dashboard in background |
| `llm-dash stop` | Ferma dashboard |

Profili disponibili: `build` (GLM-4.7), `coder` (Qwen3.6-35B), `plan` (Qwen3-30B-Instruct), `coder-old` (Qwen3-Coder-30B).

Vedi `make help` per l'elenco completo.

## Documentazione

| Documento | Contenuto |
|---|---|
| [docs/HARDWARE.md](docs/HARDWARE.md) | M5, RAM unificata, Neural Accelerators, wired_limit |
| [docs/MODELS.md](docs/MODELS.md) | Catalogo 7 modelli, classifica, benchmark, motivazioni drop |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Decisioni tecniche: mlx_lm vs LM Studio, 1 modello/volta, SSE vs WS |
| [docs/MEMORY.md](docs/MEMORY.md) | available vs used, KV cache, swap, headroom budgeting |
| [docs/OPENCODE.md](docs/OPENCODE.md) | Integrazione opencode, provider mlx, agent profiles |
| [docs/DASHBOARD.md](docs/DASHBOARD.md) | Stack della UI, file structure, come modificare |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Workflow quotidiano, troubleshooting, recovery |

## Struttura progetto

```
llm-dash/
├── README.md                 ← entry point
├── Makefile                  ← comandi standard
├── install.sh                ← deploy script
│
├── docs/                     ← documentazione completa
│   ├── HARDWARE.md
│   ├── MODELS.md
│   ├── ARCHITECTURE.md
│   ├── MEMORY.md
│   ├── OPENCODE.md
│   ├── DASHBOARD.md
│   └── RUNBOOK.md
│
├── bin/                      ← script (symlinkati a ~/.local/bin/)
│   ├── llm-serve             ← wrapper mlx_lm.server con profili
│   ├── llm-up                ← avvia 1 server in tmux
│   ├── llm-switch            ← alias di llm-up
│   ├── llm-down              ← ferma tutto
│   └── llm-dash              ← lancia dashboard
│
├── config/                   ← config esempi
│   ├── opencode.json.example
│   └── com.local.wired-limit.plist
│
├── main.py                   ← FastAPI dashboard (backend)
├── pyproject.toml            ← uv project (deps Python)
├── package.json              ← pnpm (deps Tailwind)
├── src/input.css             ← Tailwind v4 source
├── static/
│   ├── output.css            ← CSS buildato
│   ├── app.js                ← Alpine logic (chat + dash + storage)
│   ├── alpine.min.js
│   ├── marked.min.js
│   ├── highlight.min.js
│   └── highlight.css
└── templates/
    └── index.html            ← UI markup (Jinja2 template)
```

## Stack

- **Python**: uv 0.10, FastAPI, uvicorn, httpx, psutil, sse-starlette, Jinja2
- **Frontend**: Tailwind CSS v4 (CSS-first via @theme), Alpine.js 3.14, marked.js, highlight.js
- **Backend LLM**: mlx-lm 0.31 + mlx-metal 0.31 (Apple Silicon native)
- **Tooling**: pnpm 10, Node per Tailwind CLI build

## Hardware target

MacBook Pro M5, 10-core CPU (4P+6E), 10-core GPU con Neural Accelerators, 32 GB unified memory, macOS 26.x Tahoe.
