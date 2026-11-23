# Models: Catalog, Ranking, Benchmarks

## Catalog on disk

Models present in `~/.lmstudio/models/`, split by **tier**, the same concept used in the dashboard ("Other" section) and in `llm-serve list`. To keep disk and config aligned automatically, see [MODEL_SYNC.md](MODEL_SYNC.md).

### Default profiles (agentic daily drivers)

MoE models in MLX format, >=16 GB, with tool calling parsed natively by `mlx_lm.server`.

| Profile | Model | Size | Role |
|---|---|---|---|
| `coder` | `unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit` | 20 GB | **Default profile** (`server.default_profile`): agentic coding, SWE-bench 73.4%, reasoning on |

### Other (on disk, not daily drivers)

Startable where it makes sense, but kept out of the defaults for the reasons below. The first 2 are profiles (tier "other"); gemma is not a profile.

| Profile | Model | Size | Why it is not a default |
|---|---|---|---|
| `qwen35-9b` | `mlx-community/Qwen3.5-9B-MLX-4bit` | 6 GB | Under 16 GB = the reliable agentic floor on this setup |
| `qwen38` | `lmstudio-community/Qwen3.8-27B-MLX-4bit` | 15 GB | Dense 27B: tool calling works, but 7.1 t/s measured (see below) |
| - | `unsloth/gemma-4-E4B-it-GGUF` | 6.3 GB | GGUF: `mlx_lm.server` only loads MLX, so it cannot be served here (inline via LM Studio) |

## Models removed in the cleanup

Deleted to free ~50 GB and cut confusion:

| Model | Reason |
|---|---|
| `Qwen2.5-Coder-7B-Instruct-GGUF` | Superseded by Qwen3-Coder-30B-A3B (same 4-bit footprint, far better quality) |
| `DeepSeek-R1-Distill-Qwen-14B-GGUF` | Obsolete distill, reasoning is now covered by Qwen3-Instruct |
| `gemma-3-27b-it-qat-4bit` | Gemma 3 superseded by the Gemma 4 family, and redundant with the Qwen3 models |
| `gemma-4-26B-A4B-it-GGUF` | Redundant with Qwen3-30B-Instruct (same planner role, Qwen wins the benchmarks) |

No longer on disk as of November 2026, profiles removed from the config: GLM-4.7-Flash (`build`), Qwen3-30B-Instruct-2507 (`plan`), Qwen3-Coder-30B (`coder-old`), Qwen2.5-Coder-14B (`coder-14b`), Qwen3-14B (`qwen3-14b`), Qwen3-VL-30B, nomic embedding. The rankings and benchmarks below stay as historical measurements.

## Ranking by role

### Agentic coding (default opencode build)

| # | Model | Coding | Agentic | Speed t/s | Verdict |
|---|---|---|---|---|---|
| 1 | **GLM-4.7-Flash** | 7/10 | **9/10** | 32 | Top tool calling, terminal-bench tool-use 40.7% |
| 2 | Qwen3.6-35B-UD | **9/10** | 8/10 | 27 (warm) | Wins on long multi-file tasks, SWE-bench 73.4% |
| 3 | Qwen3-Coder-30B (2025) | 7/10 | 7/10 | 37 | Fastest, lower quality |

GLM and Qwen3.6 differ by ~5-10% in quality depending on the task. The practical difference:

- **GLM**: wins on short multi-step tasks (tool call loops, interactive debugging)
- **Qwen3.6**: wins on long refactors (>30k tokens) and long-context reasoning (29% vs 15%)

### Pure planning / reasoning

| # | Model | Reasoning | Verdict |
|---|---|---|---|
| 1 | **Qwen3-30B-Instruct-2507** | 9/10 | Specialized in instruction following, direct output, no wasted tokens |
| 2 | Qwen3.6-35B-UD (reasoning on) | 8/10 | More verbose, ~50% slower with reasoning |
| 3 | GLM-4.7-Flash | 7/10 | Decent but not specialized |

### Vision / screenshots

| # | Model | Verdict |
|---|---|---|
| 1 | **Qwen3-VL-30B-A3B** | The only decent option for 32 GB. Qwen3-VL family, supports UI grounding |

GLM-4.6V exists but is little tested; Pixtral 12B is lighter but less capable.

### Instant inline / autocomplete

| # | Model | Speed | Verdict |
|---|---|---|---|
| 1 | **Gemma-4-E4B** | 100+ t/s | For short snippets, in-editor completion |

## Detailed benchmarks (2026)

### SWE-bench Verified
- Qwen3.6-35B-A3B: **73.4%** (top open source for its size class)
- GLM-4.7-Flash: ~70%
- Qwen3-Coder-30B-A3B (2025): ~50-55%

### Terminal-Bench 2.0 (agentic)
- Qwen3.6-35B-A3B: 51.5
- GLM-4.7-Flash: 40.7 (Coding/Terminal/Tool Use bucket, it wins here)

### MMLU-Pro
- Qwen3.6-35B-A3B: 85.3
- Qwen3-30B-Instruct-2507: ~80
- GLM-4.7-Flash: ~78

### GPQA Diamond
- Qwen3.6-35B-A3B: 84.2

## Measured performance (this setup)

Same prompt (fibonacci + pytest), max_tokens 500, temp 0, mlx_lm.server on port 1234, M5 32 GB:

| Model | Cold start | Warm decode | Notes |
|---|---|---|---|
| Qwen3-Coder-30B 2025 | 11.7s | **37.7 t/s** | Disk cache already read |
| GLM-4.7-Flash | 17.9s | **32.0 t/s** | Cold from disk |
| Qwen3.6-35B-UD | 32.9s | 10.5 t/s (memory pressure) → **27.2 t/s** (warm + wired_limit) | "UD" quantization slightly slower |
| Qwen3.8-27B (dense) | 68s | **7.1 t/s** | Measured with 6.9 GB free; theoretical ceiling ~9-10 |

### Why Qwen3.8-27B is not a default profile (2026-08-15)

It is the only dense model in the list, and on this hardware the gap with the MoE models is not marginal.
An A3B activates 3B parameters per token, while a dense 27B rereads all 15 GB of weights: throughput
is set by memory bandwidth, not by the GPU. The 7.1 t/s measured correspond to ~107 GB/s effective,
so the model is already running close to its physical ceiling: freeing RAM does not take it past
~9-10 t/s, and dropping to 3-bit would not change its category of use.

Both unknowns raised at download time turned out fine:

- **It loads on `mlx_lm.server`** even though it is a native VL model (`Qwen3_5ForConditionalGeneration`,
  converted with mlx-vlm). `mlx_lm/models/qwen3_5.py` discards the `vision_tower` and
  `model.visual` weights and builds only the text tower. No mlx-vlm, no mlx-lm upgrade.
- **Tool calls are parsed natively**: `finish_reason: tool_calls` with valid JSON arguments,
  on mlx-lm 0.31.3 with no changes.

Practical use: one-off questions where quality per token repays the wait (review, reasoned
refactors), not agentic loops. On a loop of 30 tool calls the difference from `build` is between
5 and 25 minutes. There are no text-only MLX conversions or 3-bit MLX builds of this model: the
Unsloth 3-bit is GGUF only, so it is outside `mlx_lm.server`.

**Key insight**: the "UD" (Unsloth Dynamic) quantization of Qwen3.6 has a small overhead vs the standard lmstudio-community 4-bit. Replacing it with `mlx-community/Qwen3.6-35B-A3B-4bit` (non-UD) would take an extra 18 GB download, worth considering if 27 t/s is not enough.

## The honest truth on the differences

**GLM ≈ Qwen3.6 > Qwen3-Coder-30B (2025)**. The practical differences between the top 2 are 5-10%, not 50%. For most daily agentic tasks the choice is equivalent.

If I had to keep a single model for coding: **Qwen3.6**, because it covers coding and has a reasoning mode to turn on for planning when needed. Cost: a few t/s less on the daily driver.

## Recommended workflow

1. **Operational default**: `llm-up build` → GLM-4.7 active. Fine for 90% of tasks.
2. **Deep refactor / long task**: `llm-switch coder` → Qwen3.6.
3. **Architectural planning before code**: `llm-switch plan` → Qwen3-Instruct.
4. **Inline editor**: Gemma-E4B on a separate process (LM Studio or a second server).

## Drop decisions worth revisiting

- **Qwen3-Coder-30B (2025) - 16 GB**: 37 t/s (faster than all the others) but lower quality. I keep it as a fast fallback for when raw speed is needed. Dropping it = -16 GB.
- **Qwen3-VL-30B - 17 GB**: keep it only if you work with screenshots/mockups. Confirmed as "I want it" during setup.
- **Gemma-4-E4B - 6.3 GB**: light and handy. Keep it.
