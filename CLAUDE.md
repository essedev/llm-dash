# llm-dash - agent instructions

Control plane for local LLMs on Apple Silicon: profile wrapper around `mlx_lm.server`, web dashboard (port 1230), opencode integration. Target hardware: MacBook Pro M5, 32 GB unified memory.

Public repository: code, comments, docs and commits in English; README.md is mirrored in README.it.md in the same commit.

## Commands

```bash
make setup          # symlink scripts into ~/.local/bin + build CSS
make models         # list startable profiles
make dev            # dashboard in foreground (1230)
make dash           # dashboard in background
make status         # running server + memory
make lint           # prose language check
llm-up [profile]    # start mlx_lm.server (default: server.default_profile in config/llm-dash.toml)
llm-switch <profile># switch model (kill + restart)
llm-down            # stop everything
```

Rebuild the CSS after every change to `src/input.css`: `pnpm run build`. `static/output.css` is generated, never edited by hand.

## Conventions

Language, glossary and code conventions: [docs/CONVENTIONS.md](docs/CONVENTIONS.md).

## Gotchas

- **Adding a model touches 4 places**, listed in `docs/MODEL_SYNC.md`: `config/llm-dash.toml` (single source of truth per profile: label, path, size, ctx, tier, note, chat_template_args), the two `opencode.json` files, `docs/MODELS.md`. `bin/llm-serve` and `main.py` read the TOML at runtime and are not edited. Skipping one of the 4 leaves the model invisible on one side.
- **The default profile is `server.default_profile`** in the TOML. Removing that profile's model means picking another default, or `llm-up` without arguments fails.
- **`/v1/models` of `mlx_lm.server` lists the whole cache, not the loaded model.** To know what is running, read `--model` from the process (`served_model_path()` in `main.py`). Taking `data[0]` shows a random model.
- **marked >= 5 removed the `highlight` option from `setOptions`**: passing it there is dead code and blocks stay uncolored. Highlighting is applied to the DOM after parsing, in `enhanceCode()`.
- **`sse_starlette` separates events with `\r\n\r\n`** and splits multi-line data: without CRLF normalization and rejoining the `data:` lines, events disappear and code loses its newlines.
- **Alpine's `$nextTick` is a `setTimeout`**: DOM work that must land before the next paint (code highlighting, scroll) goes in `requestAnimationFrame` or `queueMicrotask`. See the streaming section of `docs/DASHBOARD.md`.
- **Native VL models can be served by `mlx_lm`** when the architecture module exists (e.g. `qwen3_5.py` drops the vision weights and loads only the text tower). mlx-vlm is not needed: before saying a model cannot be served, look for its module in `mlx_lm/models/`.
- **Dense models pay for memory bandwidth**: on this hardware a 27B dense runs at ~7 t/s against 27-37 t/s for A3B MoE models. It is not a RAM problem and neither freeing memory nor a lower quantization fixes it.
- `wired_limit_mb=28000` is set once (LaunchDaemon in `config/`), otherwise memory pressure halves throughput.

## Pointers

| Where | What |
|---|---|
| `docs/CONVENTIONS.md` | Language, glossary, code conventions |
| `docs/MODELS.md` | Catalog by tier, ranking by role, measured throughput |
| `docs/MODEL_SYNC.md` | Prompt to realign models on disk and config |
| `docs/ARCHITECTURE.md` | Why mlx_lm and not LM Studio, one model at a time, SSE and not WebSocket |
| `docs/DASHBOARD.md` | UI stack, endpoints, streaming, CSS classes |
| `docs/RUNBOOK.md` | Daily workflow and troubleshooting |
| `docs/MEMORY.md` | available vs used, KV cache, headroom budget |
| [local-llm-eval](https://github.com/essedev/local-llm-eval) | The experiments that measure the limits of this setup |
