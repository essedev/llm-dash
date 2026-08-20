# Runbook - Workflow & Troubleshooting

## Avvio quotidiano

### Mattina, prima sessione

```bash
# 1. Verifica wired_limit (dovrebbe essere 28000 dal LaunchDaemon)
sysctl iogpu.wired_limit_mb
# se è 0 o diverso:  sudo sysctl iogpu.wired_limit_mb=28000

# 2. Avvia server LLM (default GLM-4.7)
llm-up build

# 3. Avvia dashboard (background)
llm-dash --bg

# 4. Apri browser
open http://127.0.0.1:1230
```

Cold start del primo modello: ~30s (lettura 16-20 GB da disco). I successivi switch sono più rapidi (~10s) finché la cache filesystem regge.

### Avvio rapido per task specifico

```bash
# Coding profondo
llm-up coder              # Qwen3.6-35B (~30s cold)

# Planning
llm-up plan               # Qwen3-30B-Instruct (~10s)

# Velocità grezza
llm-up coder-old          # Qwen3-Coder-30B 2025 (~10s, 37 t/s)
```

## Comandi essenziali

| Comando | Cosa fa | Tempo |
|---|---|---|
| `llm-up <profile>` | Avvia server | 5-30s |
| `llm-switch <profile>` | Cambia modello (kill + restart) | 5-30s |
| `llm-down` | Ferma server | <2s |
| `llm-dash` | Dashboard foreground | 1s |
| `llm-dash --bg` | Dashboard background | 1s |
| `llm-dash stop` | Ferma dashboard | <1s |

Profili: `build` (GLM-4.7), `coder` (Qwen3.6), `plan` (Qwen3-Instruct), `coder-old` (Qwen3-Coder).

Override env: `PORT=1235 llm-serve build`, `THINK=true llm-serve coder`.

## Fine sessione

```bash
llm-down                  # libera 16-20 GB di RAM
llm-dash stop             # opzionale, dashboard è leggera (~80 MB)
```

## Switch modello con opencode aperto

opencode parla sempre con `http://127.0.0.1:1234`. Da terminale separato (o dalla UI dashboard cliccando su un profile):

```bash
llm-switch coder
```

Aspetta 10-30s, opencode al prossimo request troverà Qwen3.6.

## Troubleshooting

### Sintomo: decode lentissimo (<15 t/s) su un modello che dovrebbe fare 30+

**Causa probabile**: memory pressure. Il modello sta facendo paging durante decode.

**Diagnosi**:
```bash
sysctl vm.swapusage          # swap > 15 GB?
vm_stat | head -8            # Compressed > 5 GB?
```

**Fix**:
1. `llm-down` (libera il modello)
2. Chiudi tab Brave inutili (~3-5 GB rapidi)
3. `sudo purge` (libera inactive + compressor)
4. `llm-up <profile>` di nuovo
5. Se persiste: **riavvio** (resetta swap)

### Sintomo: Qwen3.6 a 10 t/s anche con sistema pulito

**Causa**: cache disco filesystem evacuata + wired_limit non applicato.

**Diagnosi**:
```bash
sysctl iogpu.wired_limit_mb       # 28000? se 0 o diverso, fix
```

**Fix**:
```bash
sudo sysctl iogpu.wired_limit_mb=28000
llm-switch coder                  # ricarica modello, ora con limit ok
```

Se il LaunchDaemon non si è applicato al boot:
```bash
sudo launchctl unload /Library/LaunchDaemons/com.local.wired-limit.plist
sudo launchctl load /Library/LaunchDaemons/com.local.wired-limit.plist
```

### Sintomo: dashboard mostra Free 0 GB e Compressor 14+ GB

**Causa**: swap thrashing. Probabilmente avevi 2 modelli caricati o il modello era oltre budget.

**Fix**:
```bash
llm-down                   # libera modello
sudo purge                 # se hai sudo passive, altrimenti aspetta
# Verifica recupero:
vm_stat | head -5
```

Se `Compressed` non scende sotto 5 GB in 1-2 minuti: **riavvio**.

### Sintomo: opencode dice "model not found" o 404

**Diagnosi**:
```bash
curl http://127.0.0.1:1234/v1/models
# deve listare il path completo del modello attivo
```

**Fix**:
- Verifica il model ID in `~/.config/opencode/opencode.json` matchi ESATTAMENTE quello in `/v1/models`
- Se hai cambiato profilo: in opencode seleziona il nuovo modello dal config (o riavvia opencode)

### Sintomo: tool calling rotto in opencode

**Cause possibili**:
1. **Context window troppo basso**: i tool result vengono troncati. Verifica `limit.context >= 65536` nel config.
2. **Thinking attivo**: il modello sprecca tutti i token in reasoning, niente content. Verifica che `llm-serve` sia partito con `THINK=false` (default sui profili default, es. build/coder).
3. **Modello non supporta tool calling bene**: solo GLM-4.7 e Qwen3.6 sono affidabili. Gemma-E4B e Qwen3-Coder-30B sono marginali.

### Sintomo: dashboard si vede male (no styling)

**Diagnosi**:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:1230/static/output.css
```

Se 404: build CSS:
```bash
cd ~/Development/Projects/llm-dash
pnpm run build
```

Se ancora rotto: hard refresh browser (Cmd+Shift+R) per skippare cache.

### Sintomo: dashboard non si avvia, "address already in use"

**Diagnosi**:
```bash
lsof -i :1230
# vedrai il PID che occupa la porta
```

**Fix**:
```bash
llm-dash stop             # se gestito da noi
# o brutalmente:
pkill -f "llm-dash/main.py"
pkill -f "uvicorn"
# poi:
llm-dash --bg
```

### Sintomo: Switch modello bloccato a "Switching..."

**Diagnosi**:
```bash
ps aux | grep "lms get\|mlx_lm.server"
tail -50 /tmp/llm-build.log    # se nohup
# o
tmux attach -t llm             # se tmux
```

Se `llm-up` è bloccato (es. download non completato), kill:
```bash
pkill -f "llm-serve"
pkill -f "mlx_lm.server"
sleep 2
llm-up build                   # retry
```

### Sintomo: download modello fallito a metà

**Causa**: `lms get` ha avuto un disconnect WebSocket.

**Fix**: rilancia lo stesso comando, riprende da dove era:
```bash
lms get https://huggingface.co/<owner>/<model> -y
```

I file `.part` esistenti vengono ripresi.

## Recovery dopo crash sistema

```bash
# Verifica wired_limit applicato
sysctl iogpu.wired_limit_mb

# Verifica nessun mlx_lm.server zombie
pgrep -lf mlx_lm.server

# Avvia tutto
llm-up build
llm-dash --bg
```

Lo swap pre-esistente non è un problema, viene gestito al volo. Se persiste pressure: `sudo purge` o reboot soft.

## Manutenzione periodica

### Settimanale

```bash
# Update mlx-lm
uv tool upgrade mlx-lm

# Update opencode
brew upgrade opencode

# Cleanup cache se serve spazio
rm -rf ~/Library/Caches/com.exafunction.lms     # cache LM Studio
```

### Mensile

```bash
# Verifica modelli ancora rilevanti
lms ls

# Se esce un nuovo modello migliore (es. Qwen3.7), valuta drop dei vecchi:
rm -rf ~/.lmstudio/models/<owner>/<old-model>
```

### Quando upgrade macOS

```bash
# Verifica compatibilità mlx-lm con nuovo macOS
mlx_lm.generate --help

# Verifica wired_limit ancora applicabile (Apple potrebbe rinominarlo)
sysctl iogpu.wired_limit_mb
```

## Comandi diagnostici utili

```bash
# Status server LLM
curl http://127.0.0.1:1234/v1/models | python3 -m json.tool

# Memoria via dashboard
curl http://127.0.0.1:1230/api/memory | python3 -m json.tool

# Quick chat test
curl -X POST http://127.0.0.1:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"<full-path>","messages":[{"role":"user","content":"PONG"}],"max_tokens":10}'

# Top RAM hogs
ps -axo rss,comm | sort -rn | head -10 | awk '{printf "%.2f GB  %s\n", $1/1024/1024, $2}'
```
