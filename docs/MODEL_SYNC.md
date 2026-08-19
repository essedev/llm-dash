# MODEL_SYNC - Prompt di allineamento modelli ↔ config

Questo NON è uno script deterministico: è un **prompt operativo** da dare a un agente LLM (opencode, Claude Code, ...) lanciato dalla root del repo `llm-dash`. L'agente confronta i modelli realmente presenti su disco con le config del progetto e le riallinea (aggiunge i mancanti, rimuove gli orfani, classifica per tier).

Serve perché la lista modelli è duplicata in più punti e tende a divergere: scarichi/cancelli un modello in `~/.lmstudio/models/` e le config restano indietro.

## Come si usa

Apri un agente nella root del repo e incolla il blocco "PROMPT" qui sotto. L'agente fa tutto: scansione, diff, edit, validazione, report. Tu rivedi il report finale.

---

## PROMPT (incolla da qui)

Sei un agente di manutenzione del repo `llm-dash`. Obiettivo: allineare i modelli LLM locali presenti su disco con tutte le config del progetto. Lavora in modo oggettivo, non inventare modelli, verifica tutto con i comandi.

### 1. Sorgente di verità = il disco

Elenca i modelli presenti:

```bash
find ~/.lmstudio/models -maxdepth 2 -mindepth 2 -type d | sort
```

Per ognuno determina: formato (MLX vs GGUF: guarda i file - `*.safetensors` + `config.json` = MLX; `*.gguf` = GGUF), size on-disk (`du -sh`), e famiglia/tipo dal nome (coder, instruct, VL=vision, embedding, MoE vs dense).

### 2. Punti da tenere in sync (tutti)

Un modello "wired" deve comparire in modo coerente in:

1. `config/llm-dash.toml` - sezione `[profiles.<nome>]`: ogni profilo avviabile ha `label`, `tag`, `path` (relativo a `models_dir`), `size_gb`, `ctx`, `tier`, `note`, e opzionalmente `[profiles.<nome>.chat_template_args]`. Questo è il **single source of truth**: `bin/llm-serve` e `main.py` lo leggono a runtime, non vanno editati a mano.
2. `config/opencode.json.example` - `provider.mlx.models`: chiave = path assoluto del modello, valore = `{ name, limit:{context, output} }`.
3. `~/.config/opencode/opencode.json` (config LIVE, fuori dal repo) - stesso blocco `provider.mlx.models`. NON toccare `agent`, `mcp`, provider `openrouter`, o altri campi: aggiungi/rimuovi SOLO entry sotto `provider.mlx.models`.
4. `docs/MODELS.md` - tabelle "Profili default" e "Altri": tieni la riga del modello con size e motivazione.

Le chiavi profilo in `config/llm-dash.toml` devono coincidere con i nomi usati in dashboard. I path assoluti (models_dir + path) devono coincidere tra i due `opencode.json` e `MODELS.md`.

### 3. Regole di classificazione (tier)

Decidi il tier di ogni modello su disco con questa logica, basata sui findings reali del setup (vedi `docs/EVALS.md`):

- **`default`** (profilo agentico daily driver): formato MLX **E** size on-disk >= ~16 GB **E** famiglia con tool-calling parsato da `mlx_lm.server`. Parser supportati: GLM-4.7 (GLM47), Qwen3 / Qwen3-Coder, Kimi K2, MiniMax M2.
- **`other`** (profilo avviabile ma non daily driver): MLX servibile da `mlx_lm.server`, ma con almeno un caveat: size < 16 GB (sotto il floor agentic affidabile) **oppure** famiglia con parser tool NON supportato nativamente (Qwen2.5-Coder, Mistral, Gemma, DeepSeek-V2 → girano in chat ma senza tool calling affidabile).
- **NON profilo** (presente su disco ma fuori da `config/llm-dash.toml`; in `MODELS.md` resta documentato con profilo `-`):
  - formato **GGUF** → `mlx_lm.server` carica solo MLX, non è servibile qui;
  - modello **vision-only** usato per screenshot/UI (es. Qwen3-VL) → caso d'uso diverso, non profilo testo;
  - **embedding** → gestito da LM Studio.

In caso di dubbio sul parser, default a `other` e segnalalo nel report (non promuovere a `default` senza certezza).

### 4. Calcola il diff e applica

- **Da aggiungere**: modello su disco classificato `default`/`other` ma assente in uno dei 4 punti → aggiungilo in tutti.
- **Da rimuovere**: entry in una config che punta a un path NON più presente su disco → rimuovila da tutti i 4 punti.
- **Da riclassificare**: tier in `config/llm-dash.toml` non coerente con le regole sopra → correggi `tier` e sposta la riga in `MODELS.md`.

Per `size_gb` usa l'intero più vicino al `du -sh`. Per `ctx`/`context` usa il context nativo del modello se lo conosci con certezza, altrimenti 32768 (conservativo). `output` = 8192. Per `chat_template_args`, aggiungi `enable_thinking = false` solo ai modelli che lo supportano (GLM-4.7, Qwen3.6, Qwen3.8).

### 5. Valida (obbligatorio prima del report)

```bash
python3 -c "import tomllib; d=tomllib.load(open('config/llm-dash.toml','rb')); print(f'{len(d[\"profiles\"])} profili OK')"
python3 -c "import ast; ast.parse(open('main.py').read())"
python3 -m json.tool config/opencode.json.example >/dev/null
python3 -m json.tool ~/.config/opencode/opencode.json >/dev/null
make models
```

`make models` deve elencare esattamente i profili che hai messo in `config/llm-dash.toml`. Se la dashboard è attiva, `curl -s http://127.0.0.1:1230/api/profiles` deve restituire gli stessi profili con i tier giusti.

### 6. Report finale

Chiudi con una tabella: per ogni modello → tier assegnato, azione (added/removed/reclassified/unchanged), e i file toccati. Elenca esplicitamente eventuali modelli lasciati fuori dai profili e perché (GGUF / vision / embedding / parser incerto). Non committare: lascia la review all'utente.

---

## Note

- Lo stato attuale (giugno 2026): 4 profili `default` + 4 `other` (`coder-14b`, `qwen35-9b`, `qwen3-14b`, `qwen38`); Qwen3-VL, gemma-4-E4B (GGUF) ed embedding restano fuori dai profili. Dettaglio in [MODELS.md](MODELS.md).
- Se aggiungi una famiglia nuova come `default`, verifica prima che `mlx_lm.server` ne parsi i tool: lancia il server e fai una chiamata con un tool, controlla che il tool_call venga emesso. I findings in [EVALS.md](EVALS.md) elencano cosa è parsato e cosa no.
- Per aggiungere un modello basta editare `config/llm-dash.toml`: `bin/llm-serve` e `main.py` lo leggono a runtime. Non serve toccare il codice.
