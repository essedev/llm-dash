# llm-dash - istruzioni per l'agent

Control plane per LLM locali su Apple Silicon: wrapper a profili su `mlx_lm.server`, dashboard web (porta 1230), integrazione opencode. Hardware target: MacBook Pro M5, 32 GB unificati.

## Comandi

```bash
make setup          # symlink script in ~/.local/bin + build CSS
make models         # elenca i profili avviabili
make dev            # dashboard in foreground (1230)
make dash           # dashboard in background
make status         # server attivo + memoria
llm-up <profile>    # avvia mlx_lm.server (default: build)
llm-switch <profile># cambia modello (kill + restart)
llm-down            # ferma tutto
```

Il CSS va ribuildato dopo ogni modifica a `src/input.css`: `pnpm run build`. Non si edita `static/output.css` a mano, è generato.

## Convenzioni

- **Un solo modello attivo per volta**, tutti sulla porta 1234. Su 32 GB due MoE da 16+ GB non ci stanno, e il tentativo manda il sistema in swap.
- **Niente bundler JS**: Alpine, marked e highlight.js sono asset statici serviti da `/static`. Si edita e si ricarica il browser.
- Tailwind v4 CSS-first: il tema sta in `@theme` dentro `src/input.css`, non esiste `tailwind.config.ts`.
- Prosa e UI in italiano, codice e identificatori in inglese.
- Gli script in `bin/` sono **symlinkati** in `~/.local/bin`, non copiati: `./install.sh` fa backup e ricrea i link. Se un comando da terminale si comporta diversamente dal repo, il link è rotto o è tornato una copia.

## Gotcha

- **Aggiungere un modello tocca 5 punti**, elencati in `docs/MODEL_SYNC.md`: `bin/llm-serve` (case + `print_profiles`), `main.py` (`PROFILES` + `detect_active_profile`), i due `opencode.json`, `docs/MODELS.md`. Saltarne uno lascia il modello invisibile o inavviabile da un lato solo.
- **`/v1/models` di `mlx_lm.server` elenca tutta la cache, non il modello caricato.** Per sapere cosa sta girando si legge il `--model` dal processo (`served_model_path()` in `main.py`). Prendere `data[0]` mostra un modello a caso.
- **marked >= 5 ha rimosso l'opzione `highlight` da `setOptions`**: passarla lì è codice morto e i blocchi restano senza colore. L'evidenziazione si applica al DOM dopo il parse, in `enhanceCode()`.
- **`sse_starlette` separa gli eventi con `\r\n\r\n`** e splitta i dati multi-riga: senza la normalizzazione CRLF e la riconcatenazione delle righe `data:`, gli eventi spariscono e le newline del codice si perdono.
- **I modelli VL nativi possono essere serviti da `mlx_lm`** se esiste il modulo dell'architettura (es. `qwen3_5.py` scarta i pesi vision e carica la sola torre testuale). Non serve mlx-vlm: prima di dire che un modello non è servibile, cerca il modulo in `mlx_lm/models/`.
- **I dense pagano la banda di memoria**: su questo hardware un 27B dense fa ~7 t/s contro i 27-37 t/s dei MoE A3B. Non è un problema di RAM e non si risolve né liberando memoria né scendendo di quantizzazione.
- `wired_limit_mb=28000` va impostato una volta (LaunchDaemon in `config/`), altrimenti la memory pressure dimezza il throughput.

## Puntatori

| Dove | Cosa |
|---|---|
| `docs/MODELS.md` | Catalogo per tier, classifica per ruolo, throughput misurato |
| `docs/MODEL_SYNC.md` | Prompt per riallineare modelli su disco e config |
| `docs/ARCHITECTURE.md` | Perché mlx_lm e non LM Studio, un modello per volta, SSE e non WebSocket |
| `docs/DASHBOARD.md` | Stack UI, endpoint, streaming, classi CSS |
| `docs/RUNBOOK.md` | Workflow quotidiano e troubleshooting |
| `docs/MEMORY.md` | available vs used, KV cache, budget di headroom |
| [macbook-m5-agentic-coding-eval](https://github.com/essedev/macbook-m5-agentic-coding-eval) | Gli esperimenti che misurano i limiti di questo setup |
