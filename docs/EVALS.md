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
| 2026-05-19 | Limite agentic locale - 5 modelli su Pi/opencode | GLM-4.7-Flash unico funzionante; sotto 16 GB nessun modello agentic su mlx_lm 0.31; degradazione 4-bit sopra ~15K context |
| 2026-05-20 | Primo roadmap-a-pezzi (Qwen3.5-9B, Qwen3-14B) | Niente corruption, ma `App.jsx` resta al template Vite: senza "leggi i file esistenti" i componenti nascono scollegati |
| 2026-05-23 | Roadmap v2 con file-reading, 4 modelli locali | qwen3.6-35B 6/6 task in 4 min; GLM 5/6; qwen3-coder-30B 4/6; qwen3-14B 3/6 |
| 2026-05-25 | Monolithic locale + scoring manuale + cloud | qwen3.6-35B 18/18 (replicato); GLM 0/18 per corruption sistemica; 6 modelli cloud da 12/18 a 17/18 |
| 2026-05-26 | Round 5: refit metodologico (SPEC condiviso) | Smoke test passato su qwen3-coder-30B, batch sui 4 modelli locali non ancora lanciato |
| 2026-08-15 | Qwen3.8-27B dense su questo setup | Carica e fa tool calling su mlx-lm 0.31.3, ma 7,1 t/s: fuori dai profili default, vedi [MODELS.md](MODELS.md) |

Dettagli, findings, lezioni metodologiche, ipotesi prioritizzate per test futuri: tutto in [`local-llm-eval/README.md`](../../local-llm-eval/README.md) e nella cronologia [`local-llm-eval/HISTORY.md`](../../local-llm-eval/HISTORY.md).

## Take-away principali (sintesi per chi legge solo qui)

- **Floor minimo agentic affidabile su `mlx_lm.server` 0.31**: 16 GB on-disk (GLM-4.7-Flash, Qwen3-Coder-30B-A3B). Sotto: parser/template/format mismatch.
- **mlx_lm.server parser supportati**: solo GLM47, Qwen / Qwen3-Coder, Kimi K2, MiniMax M2. Mistral / Gemma 4 / DeepSeek-V2 / Qwen2.5-Coder NON parsati nativamente.
- **GLM-4.7-Flash 4-bit MLX degrada sopra ~15K context** (token corruption sui numeri: `2`, `5`, `02` casuali). Context window 65K dichiarato, usabile ~15-20K. Confermato su 3 run: la cifra che si infetta cambia, il fenomeno no.
- **opencode è inadatto** come frame per testare modelli locali: 25K system prompt + skill auto-loading + auto-reject permessi.
- **Pi è il frame giusto** con flag `--no-skills --no-extensions --no-prompt-templates --no-context-files` (750 tok system prompt).
- **La roadmap-a-pezzi non è meglio in assoluto** (revisione del 25/05, supera la raccomandazione del 19/05): salva i modelli fragili (GLM 0/18 → 11/18) ma peggiora quelli capaci (qwen3.6-35B 18/18 → 10/18), perché il context reset tra task elimina la coerenza cross-layer. Vale come rimedio alla corruption, non come pratica di default.
- **Su scaffold piccoli il locale è alla pari col cloud**: qwen3.6-35B 18/18 contro Opus 4.7 17/18 e DeepSeek V4 Flash 17/18. Vale solo per questa classe di task: refactor multi-file e long-context non sono stati testati.

## Format per nuovi esperimenti

Vedi sezione "Format per futuri esperimenti" in fondo a [`local-llm-eval/README.md`](../../local-llm-eval/README.md). In sintesi:

1. Sandbox nuova `~/Development/Projects/local-llm-eval/<topic-data>/`
2. `HUMAN_PROMPTS.md` con verbatim + osservazioni turn-per-turn
3. Transcript in `turn-NN.jsonl`
4. Writeup in `local-llm-eval/README.md` sotto nuova sezione + nuova riga nell'indice
5. Aggiungere riga al "Indice esperimenti" anche in questo file
