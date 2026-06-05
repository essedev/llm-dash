# EVALS - Pointer agli esperimenti

Gli esperimenti che testano i limiti reali del setup configurato da questo repo (mlx_lm.server, profili modello, opencode, ecc.) vivono **fuori dal repo per non inquinarlo**, in una cartella sandbox separata.

## Posizione canonica

```
~/Development/Projects/local-llm-eval/
```

Writeup completo: [`local-llm-eval/README.md`](../../local-llm-eval/README.md)

Tutti gli artifact (codice generato durante i test, transcript JSONL, prompt umani verbatim) vivono in sotto-cartelle dentro `local-llm-eval/`. Ogni cartella ha il proprio `HUMAN_PROMPTS.md` con osservazioni turn-per-turn.

## Indice esperimenti

| Data | Topic | Esito sintetico |
|---|---|---|
| 2026-05-19 | Limite agentic locale - 5 modelli testati su Pi/opencode | GLM-4.7-Flash unico funzionante; sotto 16 GB nessun modello agentic su mlx_lm 0.31; degradazione 4-bit sopra ~15K context |

Dettagli, findings, lezioni metodologiche, ipotesi prioritizzate per test futuri: tutto in [`local-llm-eval/README.md`](../../local-llm-eval/README.md).

## Take-away principali (sintesi per chi legge solo qui)

- **Floor minimo agentic affidabile su `mlx_lm.server` 0.31**: 16 GB on-disk (GLM-4.7-Flash, Qwen3-Coder-30B-A3B). Sotto: parser/template/format mismatch.
- **mlx_lm.server parser supportati**: solo GLM47, Qwen / Qwen3-Coder, Kimi K2, MiniMax M2. Mistral / Gemma 4 / DeepSeek-V2 / Qwen2.5-Coder NON parsati nativamente.
- **GLM-4.7-Flash 4-bit MLX degrada sopra ~15K context** (token corruption sui numeri: `2`, `5`, `02` casuali). Context window 65K dichiarato, usabile ~15-20K.
- **opencode è inadatto** come frame per testare modelli locali: 25K system prompt + skill auto-loading + auto-reject permessi.
- **Pi è il frame giusto** con flag `--no-skills --no-extensions --no-prompt-templates --no-context-files` (750 tok system prompt).
- **Pattern raccomandato per local agentic**: roadmap-a-pezzi con context reset tra task atomici, NON prompt monolitico. Tenere ogni pezzo a <10K context.

## Format per nuovi esperimenti

Vedi sezione "Format per futuri esperimenti" in fondo a [`local-llm-eval/README.md`](../../local-llm-eval/README.md). In sintesi:

1. Sandbox nuova `~/Development/Projects/local-llm-eval/<topic-data>/`
2. `HUMAN_PROMPTS.md` con verbatim + osservazioni turn-per-turn
3. Transcript in `turn-NN.jsonl`
4. Writeup in `local-llm-eval/README.md` sotto nuova sezione + nuova riga nell'indice
5. Aggiungere riga al "Indice esperimenti" anche in questo file
