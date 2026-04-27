# Hardware - MacBook Pro M5

## Specs di partenza

| | |
|---|---|
| Modello | MacBook Pro M5 (Mac17,2) |
| Chip | Apple M5 |
| CPU | 10-core (4 Performance + 6 Efficiency) |
| GPU | 10-core con Neural Accelerators |
| Memoria | 32 GB unified |
| OS | macOS 26.3.1 Tahoe (build 25D771280a) |
| GPU API | Metal 4 |

## Cosa rende M5 speciale per LLM

L'M5 è il primo Apple Silicon che integra **Neural Accelerators dentro la GPU** (non più solo nel Neural Engine separato). Questi acceleratori velocizzano specificamente le operazioni matmul (matrix multiplication) usate dai layer dei transformer.

In pratica si traduce in:

- **MLX 2-2.5x più veloce** rispetto a llama.cpp (GGUF) per modelli MoE su M5
- **Decode sustained**: 32-37 t/s su modelli MoE 30-35B 4-bit (era 25-30 t/s su M4 Pro)
- **Prefill**: ~1500-2000 tok/s, riduce il time-to-first-token su prompt lunghi
- **Supporto bf16 nativo** in hardware (utile per quantizzazioni miste)

Per sfruttare questi vantaggi serve usare **MLX** come backend (`mlx_lm.server`), non llama.cpp che gira su CPU/Metal generico senza hit sui Neural Accelerators.

## Memory unified - implicazioni

Su Apple Silicon RAM e VRAM sono lo stesso pool fisico. Significa:

1. **Niente trasferimenti CPU↔GPU**: latenza zero per spostare tensori
2. **Tutta la RAM è VRAM**: a differenza dei sistemi discreti dove la VRAM è limitata, qui i 32 GB sono completamente disponibili al modello
3. **macOS però limita la "wired memory"** che la GPU può tenere bloccata in RAM senza pageout

Questo terzo punto è il vincolo principale del setup.

## iogpu.wired_limit_mb

Il sysctl `iogpu.wired_limit_mb` controlla quanta RAM macOS può tenere "wired" alla GPU (cioè bloccata in memoria fisica, non swappabile durante decode).

Default: 0 (significa ~75% della RAM totale = ~24 GB su 32 GB).

**Problema**: caricare Qwen3.6-35B (20 GB di pesi) + KV cache (6 GB a 64k context) richiede ~26 GB wired. Sopra il limite default, durante il decode macOS comincia a paginare blocchi del modello, il decode crolla da 27 a 10 t/s.

**Fix applicato**: alzare a 28 GB con

```bash
sudo sysctl iogpu.wired_limit_mb=28000
```

Persistenza: il file `config/com.local.wired-limit.plist` è un LaunchDaemon che lo riapplica ad ogni boot. macOS Tahoe non legge più affidabilmente `/etc/sysctl.conf`, il LaunchDaemon è la via canonica.

## Budget di memoria realistico

Su 32 GB totali:

| Componente | Costo tipico |
|---|---|
| macOS kernel + sistema | 3-5 GB (wired) |
| Brave + tab + renderer | 3-6 GB |
| VS Code + helper plugin | 1-2 GB |
| Claude Code + cmux | 1-2 GB |
| Docker Desktop (se attivo) | 4-8 GB |
| **App background totali** | **~10-15 GB** |
| **Disponibile per LLM** | **~17-22 GB** |

A questo si applica il KV cache: per un modello da 16 GB con context 64k servono ~6 GB di KV in più. Quindi il "modello realmente carcabile" pesa ~14-16 GB max in scenario normale.

Per Qwen3.6 (20 GB) **bisogna chiudere qualcosa** prima di caricarlo, oppure accettare paging.

## Performance misurata

Bench fatti in questo setup, prompt fibonacci + 3 unit test, max 500 token, temp 0:

| Modello | tok/s decode | RAM modello | KV @ 64k |
|---|---|---|---|
| Qwen3-Coder-30B-A3B 2025 | 37.7 | 16 GB | ~6 GB |
| GLM-4.7-Flash | 32.0 | 16 GB | ~6 GB |
| Qwen3.6-35B-A3B-UD | 27.2 (warm cache) | 20 GB | ~6 GB |
| Qwen3.6-35B-A3B-UD | 10.5 (cold) | 20 GB | ~6 GB |

I 27 t/s su Qwen3.6 si raggiungono solo con cache disco warm + wired_limit 28 GB. A freddo o con wired default i numeri crollano.

## Macros utili

```bash
# Stato memoria veloce
vm_stat | head -8

# Top processi RAM
ps -axo rss,comm | sort -rn | head -10 | awk '{printf "%.2f GB  %s\n", $1/1024/1024, $2}'

# Swap usage
sysctl vm.swapusage

# Wired limit corrente
sysctl iogpu.wired_limit_mb
```

Vedi anche `docs/MEMORY.md` per il dettaglio sul calcolo `available_gb` e su come la dashboard distingue "used" da "available".
