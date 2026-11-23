# EVALS: Pointer to the experiments

The experiments that test the real limits of the setup this repo configures (mlx_lm.server, model profiles, opencode, etc.) live **outside the repo to keep it clean**, in a separate sandbox folder, published as the sibling repo [essedev/local-llm-eval](https://github.com/essedev/local-llm-eval).

## Canonical location

```
~/Development/Projects/local-llm-eval/
```

Full writeup: [`local-llm-eval/README.md`](https://github.com/essedev/local-llm-eval/blob/main/README.md)

All the artifacts (code generated during the tests, JSONL transcripts, verbatim human prompts) live in subfolders inside `local-llm-eval/`. Each folder has its own `HUMAN_PROMPTS.md` with turn-by-turn observations.

## Experiment index

| Date | Topic | Outcome in brief |
|---|---|---|
| 2026-05-19 | Local agentic limit - 5 models on Pi/opencode | GLM-4.7-Flash the only one working; below 16 GB no agentic model on mlx_lm 0.31; 4-bit degradation above ~15K context |
| 2026-05-20 | First piecewise roadmap (Qwen3.5-9B, Qwen3-14B) | No corruption, but `App.jsx` stays at the Vite template: without "read the existing files" the components are born disconnected |
| 2026-05-23 | Roadmap v2 with file reading, 4 local models | qwen3.6-35B 6/6 tasks in 4 min; GLM 5/6; qwen3-coder-30B 4/6; qwen3-14B 3/6 |
| 2026-05-25 | Local monolithic + manual scoring + cloud | qwen3.6-35B 18/18 (replicated); GLM 0/18 from systemic corruption; 6 cloud models from 12/18 to 17/18 |
| 2026-05-26 | Round 5: methodological refit (shared SPEC) | Smoke test passed on qwen3-coder-30B, batch on the 4 local models not launched yet |
| 2026-08-15 | Qwen3.8-27B dense on this setup | Loads and does tool calling on mlx-lm 0.31.3, but 7.1 t/s: outside the default profiles, see [MODELS.md](MODELS.md) |

Details, findings, methodological lessons, prioritized hypotheses for future tests: all in [`local-llm-eval/README.md`](https://github.com/essedev/local-llm-eval/blob/main/README.md) and in the history [`local-llm-eval/HISTORY.md`](https://github.com/essedev/local-llm-eval/blob/main/HISTORY.md).

## Main takeaways (summary for those who read only here)

- **Minimum reliable agentic floor on `mlx_lm.server` 0.31**: 16 GB on disk (GLM-4.7-Flash, Qwen3-Coder-30B-A3B). Below it: parser/template/format mismatch.
- **mlx_lm.server supported parsers**: only GLM47, Qwen / Qwen3-Coder, Kimi K2, MiniMax M2. Mistral / Gemma 4 / DeepSeek-V2 / Qwen2.5-Coder are NOT parsed natively.
- **GLM-4.7-Flash 4-bit MLX degrades above ~15K context** (token corruption on numbers: random `2`, `5`, `02`). Declared context window 65K, usable ~15-20K. Confirmed over 3 runs: the digit that gets infected changes, the phenomenon does not.
- **opencode is unsuitable** as a frame for testing local models: 25K system prompt + skill auto-loading + permission auto-reject.
- **Pi is the right frame** with the flags `--no-skills --no-extensions --no-prompt-templates --no-context-files` (750 tok system prompt).
- **The piecewise roadmap is not better in absolute terms** (revision of 05/25, superseding the 05/19 recommendation): it saves fragile models (GLM 0/18 → 11/18) but hurts capable ones (qwen3.6-35B 18/18 → 10/18), because the context reset between tasks removes cross-layer coherence. It works as a remedy for corruption, not as a default practice.
- **On small scaffolds local is on par with cloud**: qwen3.6-35B 18/18 against Opus 4.7 17/18 and DeepSeek V4 Flash 17/18. This holds only for this class of task: multi-file refactors and long context were not tested.

## Format for new experiments

See the "Format for future experiments" section at the end of [`local-llm-eval/README.md`](https://github.com/essedev/local-llm-eval/blob/main/README.md). In short:

1. New sandbox `~/Development/Projects/local-llm-eval/<topic-date>/`
2. `HUMAN_PROMPTS.md` with verbatim prompts + turn-by-turn observations
3. Transcripts in `turn-NN.jsonl`
4. Writeup in `local-llm-eval/README.md` under a new section + a new row in the index
5. Add a row to the "Experiment index" in this file as well
