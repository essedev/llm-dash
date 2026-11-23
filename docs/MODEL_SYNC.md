# MODEL_SYNC: Model ↔ config alignment prompt

This is NOT a deterministic script: it is an **operational prompt** to give to an LLM agent (opencode, Claude Code, ...) launched from the root of the `llm-dash` repo. The agent compares the models actually present on disk with the project configs and realigns them (adds the missing ones, removes the orphans, classifies by tier).

It exists because the model list is duplicated in several places and tends to drift: you download or delete a model in `~/.lmstudio/models/` and the configs fall behind.

## How to use it

Open an agent in the repo root and paste the "PROMPT" block below. The agent does everything: scan, diff, edit, validation, report. You review the final report.

---

## PROMPT (paste from here)

You are a maintenance agent for the `llm-dash` repo. Goal: align the local LLM models present on disk with all the project's configs. Work objectively, do not invent models, verify everything with commands.

### 1. Source of truth = the disk

List the models present:

```bash
find ~/.lmstudio/models -maxdepth 2 -mindepth 2 -type d | sort
```

For each one determine: format (MLX vs GGUF: look at the files - `*.safetensors` + `config.json` = MLX; `*.gguf` = GGUF), on-disk size (`du -sh`), and family/type from the name (coder, instruct, VL=vision, embedding, MoE vs dense).

### 2. Places to keep in sync (all of them)

A "wired" model must appear consistently in:

1. `config/llm-dash.toml` - `[profiles.<name>]` section: every startable profile has `label`, `tag`, `path` (relative to `models_dir`), `size_gb`, `ctx`, `tier`, `note`, and optionally `[profiles.<name>.chat_template_args]`. This is the **single source of truth**: `bin/llm-serve` and `main.py` read it at runtime, they must not be edited by hand.
2. `config/opencode.json.example` - `provider.mlx.models`: key = absolute path of the model, value = `{ name, limit:{context, output} }`.
3. `~/.config/opencode/opencode.json` (LIVE config, outside the repo) - same `provider.mlx.models` block. DO NOT touch `agent`, `mcp`, the `openrouter` provider, or other fields: add/remove ONLY entries under `provider.mlx.models`.
4. `docs/MODELS.md` - "Default profiles" and "Other" tables: keep the model's row with size and rationale.

The profile keys in `config/llm-dash.toml` must match the names used in the dashboard. The absolute paths (models_dir + path) must match across the two `opencode.json` files and `MODELS.md`.

### 3. Classification rules (tier)

Decide the tier of each model on disk with this logic, based on the real findings of the setup (see `docs/EVALS.md`):

- **`default`** (agentic daily driver profile): format MLX **AND** on-disk size >= ~16 GB **AND** a family with tool calling parsed by `mlx_lm.server`. Supported parsers: GLM-4.7 (GLM47), Qwen3 / Qwen3-Coder, Kimi K2, MiniMax M2.
- **`other`** (startable profile but not a daily driver): MLX servable by `mlx_lm.server`, but with at least one caveat: size < 16 GB (below the reliable agentic floor) **or** a family whose tool parser is NOT natively supported (Qwen2.5-Coder, Mistral, Gemma, DeepSeek-V2 → they run in chat but without reliable tool calling).
- **NOT a profile** (present on disk but outside `config/llm-dash.toml`; in `MODELS.md` it stays documented with profile `-`):
  - **GGUF** format → `mlx_lm.server` only loads MLX, it is not servable here;
  - **vision-only** model used for screenshots/UI (e.g. Qwen3-VL) → different use case, not a text profile;
  - **embedding** → handled by LM Studio.

If in doubt about the parser, default to `other` and flag it in the report (do not promote to `default` without certainty).

### 4. Compute the diff and apply

- **To add**: model on disk classified `default`/`other` but missing from one of the 4 places → add it to all of them.
- **To remove**: entry in a config that points to a path NO longer present on disk → remove it from all 4 places.
- **To reclassify**: tier in `config/llm-dash.toml` not consistent with the rules above → fix `tier` and move the row in `MODELS.md`.

For `size_gb` use the integer closest to `du -sh`. For `ctx`/`context` use the model's native context if you know it for certain, otherwise 32768 (conservative). `output` = 8192. For `chat_template_args`, add `enable_thinking = false` only to the models that support it (GLM-4.7, Qwen3.6, Qwen3.8).

### 5. Validate (mandatory before the report)

```bash
python3 -c "import tomllib; d=tomllib.load(open('config/llm-dash.toml','rb')); print(f'{len(d[\"profiles\"])} profili OK')"
python3 -c "import ast; ast.parse(open('main.py').read())"
python3 -m json.tool config/opencode.json.example >/dev/null
python3 -m json.tool ~/.config/opencode/opencode.json >/dev/null
make models
```

`make models` must list exactly the profiles you put in `config/llm-dash.toml`. If the dashboard is running, `curl -s http://127.0.0.1:1230/api/profiles` must return the same profiles with the right tiers.

### 6. Final report

Close with a table: for each model → assigned tier, action (added/removed/reclassified/unchanged), and the files touched. Explicitly list any models left out of the profiles and why (GGUF / vision / embedding / uncertain parser). Do not commit: leave the review to the user.

---

## Notes

- Current state (November 2026): 1 `default` profile (`coder`, also `server.default_profile`) + 2 `other` (`qwen35-9b`, `qwen38`); gemma-4-E4B (GGUF) stays outside the profiles. If you remove the model of `server.default_profile`, pick another one: `llm-up` with no arguments uses it. Details in [MODELS.md](MODELS.md).
- If you add a new family as `default`, first check that `mlx_lm.server` parses its tools: launch the server and make a call with a tool, check that the tool_call is emitted. The findings in [EVALS.md](EVALS.md) list what is parsed and what is not.
- To add a model, just edit `config/llm-dash.toml`: `bin/llm-serve` and `main.py` read it at runtime. No need to touch the code.
