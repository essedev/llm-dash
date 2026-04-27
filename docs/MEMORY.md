# Gestione Memoria

## available vs used - la differenza che conta

Su macOS la metrica `used` è fuorviante perché include cache filesystem **recuperabile al volo**. Il numero che decide se il modello sta in RAM è `available_gb`.

### Decomposizione tipica

```
Free:        1-3 GB     ← libera "vera"
Active:      6-15 GB    ← app foreground (Brave, VS Code, Claude)
Inactive:    5-13 GB    ← cache app recenti, recuperabile
Wired:       3-5 GB     ← kernel + sistema (non ricuperabile)
Compressed:  0.1-3 GB   ← compressor pages (basso = sano)
Cached:      5-10 GB    ← filesystem cache (altamente recuperabile)
```

**`available = free + inactive + cached + parte-di-compressed`**

In Python via `psutil.virtual_memory().available` macOS calcola questo automaticamente.

### Perché la dashboard usa pressure + breakdown

La sezione Memory mostra:

1. **`% used`** primario (`(total - available) / total * 100`): è la metrica psutil standard, fra 0-100 indipendente dalla dimensione totale.
2. **Pressure badge low/medium/high**: derivata da `vm.percent + compressed_gb + swap_used_gb`. Soglie:
   - **Low**: percent < 72%, compressed < 8% di total, swap < 2 GB
   - **Medium**: percent 72-87%, oppure compressed 8-18%, oppure swap 2-8 GB
   - **High**: percent ≥ 88%, oppure compressed > 18%, oppure swap > 8 GB
3. **Stack meter**: barra 5-segmenti (wired / active / compressed / inactive / free) per vedere a colpo d'occhio dove va la RAM.
4. **Reclaimable**: `available_gb` (free + inactive + speculative). Verde se ≥ 8 GB.

Quando carichi un modello, macOS prende prima da Inactive/Cached (riallocazione veloce, niente swap), poi se servisse di più caccia anche app Active in swap (lento). La pressione tiene conto sia di compressor che di swap, non solo del numero "used".

## KV cache - costi nascosti

Per ogni token nel context la cache occupa:

```
KV_per_token = n_layers × n_kv_heads × head_dim × 2 (K+V) × bytes_per_element
```

Per MoE moderni con GQA (Qwen3, GLM, Gemma 4):
- ~100 KB / token in FP16
- ~50 KB / token in INT8
- ~25 KB / token in INT4

A context 64k:
- FP16 = 6.4 GB
- INT8 = 3.2 GB
- INT4 = 1.6 GB

`mlx_lm.server` 0.31 NON espone quantizzazione KV via flag (esiste in `mlx_lm.generate` con `--kv-bits` ma non sul server). Quindi sul server la KV è FP16 nativa.

**Il budget effettivo per il modello** è quindi `available - 6.4 GB`.

## Scenari concreti

### Scenario A: Brave + VS Code + Claude attivi (caso normale)

```
Total:           32 GB
Sistema + app:  -10 GB
─────────────────────────
Disponibile:     22 GB
KV @ 64k:       -6.4 GB
─────────────────────────
Budget modello:  15.6 GB → GLM-4.7 (16 GB) borderline
```

Devi chiudere qualche tab per starci.

### Scenario B: solo cmux + opencode (development focus)

```
Total:           32 GB
Sistema + app:   -7 GB
─────────────────────────
Disponibile:     25 GB
KV @ 64k:       -6.4 GB
─────────────────────────
Budget modello:  18.6 GB → Qwen3.6 (20 GB) borderline
```

Stretto ma fattibile con wired_limit a 28 GB.

### Scenario C: Docker Desktop attivo con 3 container

```
Total:           32 GB
Sistema + app:  -10 GB
Docker VM:       -6 GB
─────────────────────────
Disponibile:     16 GB
KV @ 64k:       -6.4 GB
─────────────────────────
Budget modello:  9.6 GB → solo Gemma-E4B (6 GB)
```

Per LLM agentic serio devi spegnere Docker, o limitare Docker Desktop a 4 GB di RAM (Settings → Resources → Memory).

## iogpu.wired_limit_mb

Il sysctl che permette a MLX di "wirare" tutto il modello in RAM senza pageout.

```bash
sudo sysctl iogpu.wired_limit_mb=28000   # 28 GB
```

Senza questo, anche con RAM sufficiente, durante decode macOS può paginare blocchi del modello → throughput crolla.

Per persistenza: `config/com.local.wired-limit.plist` come LaunchDaemon.

### Verifica

```bash
sysctl iogpu.wired_limit_mb
# iogpu.wired_limit_mb: 28000  ← ok
```

## Swap - quando è un problema

Lo swap su macOS è un file in `/private/var/vm/`. macOS ci scrive volentieri pagine inactive.

**Swap usato 0-10 GB**: normale, non impatta.
**Swap 10-20 GB**: attenzione, sistema sotto pressione.
**Swap > 20 GB**: thrashing, riavvia o chiudi app pesanti.

```bash
sysctl vm.swapusage
# total = 13312.00M  used = 11722.00M  free = 1590.00M
```

### Recovery

Se lo swap è gonfio dopo una sessione MLX intensa:

1. `llm-down` (libera il modello)
2. `sudo purge` (richiede password, libera inactive + compressor)
3. Chiudi tab Brave non in uso
4. Se ancora alto: **riavvio** (resetta swap)

## Cold start - cache disco filesystem

I 20 GB di safetensors di Qwen3.6 vengono letti da disco al primo `mlx_lm.server` boot (~30s). macOS li tiene in **filesystem cache** dopo la lettura. Al secondo boot, partono dalla cache RAM (5s).

Implicazioni:
- **Primo avvio del giorno**: lento (30-40s).
- **Switch modello dopo poco**: rapido (<5s) se la cache regge.
- **Switch modello dopo che hai aperto file pesanti**: lento, perché filesystem cache è stata sgomberata.

## Compressor - segnale di stress

Il compressor di macOS comprime pagine inactive per liberare RAM senza scrivere swap. Usa LZ4 super veloce.

- **Compressor 0-3 GB**: normale.
- **Compressor 3-10 GB**: sotto stress, prossimo passo è swap.
- **Compressor > 10 GB**: thrashing imminente o in corso.

In `psutil.virtual_memory()` il compressor è incluso in `used` ma il sistema lo conta come "available" perché può decomprimerlo on-demand (lento però).

## Workflow consigliato

1. **Sessione di coding seria**: chiudi Brave, lascia solo cmux + un editor + opencode. Carica Qwen3.6 o GLM. Lavora.
2. **Day usage normale**: GLM-4.7 (16 GB) basta nel 90% dei casi e lascia headroom.
3. **Quando il badge pressure passa a medium/high**: chiudi qualcosa o swap a modello più piccolo. `% used` da solo non basta - guarda anche compressor e swap nella legenda.
4. **Dopo sessione MLX intensa**: `llm-down` quando finisci, libera 16-20 GB istantanei.

## Macros utili

```bash
# Snapshot rapido
function memstat() {
  vm_stat | head -8
  echo
  sysctl vm.swapusage
  echo
  echo "Top RAM hogs:"
  ps -axo rss,comm | sort -rn | head -10 | awk '{printf "  %.2f GB  %s\n", $1/1024/1024, $2}'
}

# Wired limit check
sysctl iogpu.wired_limit_mb
```
