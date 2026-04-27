# Integrazione opencode

## Setup

Il file `~/.config/opencode/opencode.json` punta a mlx_lm.server come provider locale OpenAI-compatible.

Esempio in `config/opencode.json.example`. Sostituisci `/Users/doppia` con il tuo `$HOME` se diverso.

## Provider config

```json
{
  "provider": {
    "mlx": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "mlx_lm.server (porta 1234)",
      "options": { "baseURL": "http://127.0.0.1:1234/v1" },
      "models": {
        "/Users/doppia/.lmstudio/models/lmstudio-community/GLM-4.7-Flash-MLX-4bit": {
          "name": "GLM-4.7-Flash (build default)",
          "limit": { "context": 65536, "output": 8192 }
        },
        "/Users/doppia/.lmstudio/models/unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit": {
          "name": "Qwen3.6-35B-A3B (deeper coding)",
          "limit": { "context": 65536, "output": 8192 }
        }
      }
    }
  },
  "model": "mlx//Users/doppia/.lmstudio/models/lmstudio-community/GLM-4.7-Flash-MLX-4bit"
}
```

### Note importanti

- **I model ID sono path completi** del filesystem. È perché mlx_lm.server espone i modelli con quell'ID nel `/v1/models` e si aspetta il path nei body request. Brutto ma funzionale.
- **Context limit 64k** allineato a quanto regge il sistema con un modello 16-20 GB caricato.
- **Output limit 8192** standard per generazione lunga (refactor, code generation).
- Il `model` di default è la stringa `<provider>/<model_id>`, quindi `mlx//Users/...` (doppio slash perché il path inizia con `/`).

## Workflow tipico

### Il caso comune

```bash
# 1. Server up
llm-up build                    # GLM-4.7 attivo

# 2. Vai in un progetto e lancia opencode
cd ~/Development/Yellow/qualche-progetto
opencode

# Ora hai un'agent CLI che parla con il modello locale
# Tool calling, file edit, terminal commands
```

### Switch modello durante una sessione

opencode parla sempre con `http://127.0.0.1:1234`. Per cambiare modello durante una sessione:

```bash
# Da un altro terminale (o dalla dashboard web cliccando su un profile):
llm-switch coder                # ferma GLM, parte Qwen3.6 (~10-30s)
```

opencode ricaricherà i model sul prossimo request. Se `opencode.json` ha tutti i modelli registrati nel provider, basta selezionarne uno diverso dalla UI di opencode (o riavviare opencode).

### Workflow planning → build

Per task seri, due fasi:

```bash
# Fase 1: planning (modello dedicato, non spreca token in coding)
llm-switch plan                 # Qwen3-30B-Instruct
opencode                        # → "Analizza questo modulo e proponi un piano di refactor"

# Fase 2: implementazione
llm-switch build                # GLM-4.7
opencode                        # → "Implementa il punto 2 del piano"
```

Note: opencode ha il concetto di "agent profiles" (`agent.plan`, `agent.build`) ma per ora con un solo server attivo non li uso esplicitamente. Vado manualmente.

## Integrazione MCP

Il provider opencode include il MCP server `context7` per accedere alle docs ufficiali delle librerie:

```json
"mcp": {
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp",
    "headers": { "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}" }
  }
}
```

Il modello locale (GLM-4.7 e Qwen3.6 supportano tool calling) può usare `context7.search-docs` per recuperare documentazione di librerie aggiornate (es. Tailwind v4, FastAPI nuove API).

## Caveat su tool calling locale

Tool calling con modelli locali funziona, ma **non è infallibile come Claude Sonnet 4.5+**. Aspettati:

- **Buone**: tool call singoli, parametri JSON corretti, parallel calls (2-3 tool insieme)
- **Marginali**: chain di 5+ tool call con stato condiviso
- **Difficili**: error recovery in loop multi-step, decisione complessa "ho abbastanza info per rispondere?"

Per task agentici lunghi e critici (es. refactor su clienti Yellow), Claude API resta preferibile. Locale è ottimo per: brainstorm, prototipi personali, esperimenti.

## Strategia mista cloud + locale

| Caso d'uso | Tool |
|---|---|
| Coding agentic Yellow client (paid) | Claude Code + Anthropic API |
| Sperimentazione personale | opencode + locale |
| Brainstorm architettura | opencode + Qwen3-Instruct locale |
| Refactor critico multi-file | Claude Code API |
| "Spiegami questa libreria" | opencode + GLM-4.7 + context7 MCP |
| Inline autocomplete editor | locale (Gemma-E4B) |

Locale = privacy, gratis, offline. Cloud = qualità top, affidabilità tool calling, latenza bassa.

## Debug opencode + locale

Se opencode non vede i modelli:

1. **Verifica server attivo**: `curl http://127.0.0.1:1234/v1/models`
2. **Verifica path nel config**: il model ID deve matchare ESATTAMENTE quello che il server espone
3. **Logs server**: `tmux attach -t llm` (se avviato via `llm-up` con tmux)
4. **Logs opencode**: lancia opencode con `--debug` o controlla `~/.config/opencode/logs/`

Se tool calling fallisce:
- Verifica che il context window in `opencode.json` sia ≥ 64k (sotto, opencode tronca tool result e rompe il loop)
- Verifica che `THINK=false` (nello script `llm-serve` è il default per build/coder profiles)
