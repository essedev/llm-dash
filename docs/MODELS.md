# Modelli - Catalogo, Classifica, Benchmark

## Catalogo su disco

Modelli presenti in `~/.lmstudio/models/`. Divisi per **tier**, lo stesso concetto usato in dashboard (sezione "Altri") e in `llm-serve list`. Per allineare automaticamente disco e config vedi [MODEL_SYNC.md](MODEL_SYNC.md).

### Profili default (daily driver agentici)

MoE in formato MLX, >=16 GB, con tool calling parsato nativamente da `mlx_lm.server`.

| Profilo | Modello | Size | Ruolo |
|---|---|---|---|
| `build` | `lmstudio-community/GLM-4.7-Flash-MLX-4bit` | 16 GB | **Build default** - tool calling, ~32 t/s |
| `coder` | `unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit` | 20 GB | Deeper coding, SWE-bench 73.4% |
| `plan` | `lmstudio-community/Qwen3-30B-A3B-Instruct-2507-MLX-4bit` | 17 GB | **Planner** reasoning + planning |
| `coder-old` | `lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-MLX-4bit` | 16 GB | Fast fallback ~37 t/s |

### Altri (su disco, non daily driver)

Avviabili dove ha senso, ma fuori dai 4 default per i motivi sotto. I primi 3 sono profili (tier "other"); VL/gemma/embedding non sono profili.

| Profilo | Modello | Size | Perché non è default |
|---|---|---|---|
| `coder-14b` | `lmstudio-community/Qwen2.5-Coder-14B-Instruct-MLX-4bit` | 8 GB | `mlx_lm.server` non parsa i suoi tool: niente agentic, solo chat |
| `qwen35-9b` | `mlx-community/Qwen3.5-9B-MLX-4bit` | 6 GB | Sotto i 16 GB = floor agentic affidabile su questo setup |
| `qwen3-14b` | `Qwen/Qwen3-14B-MLX-4bit` | 7 GB | Dense 14B general purpose, non agentic-tuned |
| `qwen38` | `lmstudio-community/Qwen3.8-27B-MLX-4bit` | 15 GB | Dense 27B: tool calling ok, ma 7,1 t/s misurati (vedi sotto) |
| - | `lmstudio-community/Qwen3-VL-30B-A3B-Instruct-MLX-4bit` | 17 GB | Vision (screenshot/UI): non avviato come profilo testo |
| - | `unsloth/gemma-4-E4B-it-GGUF` | 6.3 GB | GGUF: `mlx_lm.server` carica solo MLX, qui non è servibile (inline via LM Studio) |
| - | `text-embedding-nomic-embed-text-v1.5` | 84 MB | Embedding, gestito da LM Studio |

## Modelli rimossi nel cleanup

Cancellati per liberare ~50 GB e ridurre confusione:

| Modello | Motivo |
|---|---|
| `Qwen2.5-Coder-7B-Instruct-GGUF` | Superato da Qwen3-Coder-30B-A3B (stessi 4-bit footprint, qualità lontane) |
| `DeepSeek-R1-Distill-Qwen-14B-GGUF` | Distill obsoleto, reasoning ora coperto da Qwen3-Instruct |
| `gemma-3-27b-it-qat-4bit` | Gemma 3 superato da Gemma 4 famiglia, e ridondante con i Qwen3 |
| `gemma-4-26B-A4B-it-GGUF` | Ridondante con Qwen3-30B-Instruct (stesso ruolo planner, Qwen vince benchmark) |

## Classifica per ruolo

### Coding agentic (default opencode build)

| # | Modello | Coding | Agentic | Speed t/s | Verdetto |
|---|---|---|---|---|---|
| 1 | **GLM-4.7-Flash** | 7/10 | **9/10** | 32 | Top tool calling, terminal-bench tool-use 40.7% |
| 2 | Qwen3.6-35B-UD | **9/10** | 8/10 | 27 (warm) | Vince su task lunghi multi-file, SWE-bench 73.4% |
| 3 | Qwen3-Coder-30B (2025) | 7/10 | 7/10 | 37 | Più veloce, qualità inferiore |

GLM e Qwen3.6 differiscono ~5-10% in qualità a seconda del task. Differenza pratica:

- **GLM**: vince su task brevi multi-step (loops di tool call, debug interattivo)
- **Qwen3.6**: vince su refactor lunghi (>30k token), long-context reasoning (29% vs 15%)

### Planning / reasoning puro

| # | Modello | Reasoning | Verdetto |
|---|---|---|---|
| 1 | **Qwen3-30B-Instruct-2507** | 9/10 | Specializzato instruction-following, output diretto, no spreco token |
| 2 | Qwen3.6-35B-UD (thinking on) | 8/10 | Più verbose, ~50% più lento con reasoning |
| 3 | GLM-4.7-Flash | 7/10 | Decente ma non specializzato |

### Vision / screenshot

| # | Modello | Verdetto |
|---|---|---|
| 1 | **Qwen3-VL-30B-A3B** | Unica opzione decente per 32 GB. Family Qwen3-VL, supporta UI grounding |

GLM-4.6V esiste ma poco testato; Pixtral 12B è più leggero ma meno capable.

### Inline / autocomplete fulminei

| # | Modello | Speed | Verdetto |
|---|---|---|---|
| 1 | **Gemma-4-E4B** | 100+ t/s | Per snippet brevi, completion in editor |

## Benchmark dettagliati (2026)

### SWE-bench Verified
- Qwen3.6-35B-A3B: **73.4%** (top open source per la sua size class)
- GLM-4.7-Flash: ~70%
- Qwen3-Coder-30B-A3B (2025): ~50-55%

### Terminal-Bench 2.0 (agentic)
- Qwen3.6-35B-A3B: 51.5
- GLM-4.7-Flash: 40.7 (Coding/Terminal/Tool Use bucket - vince qui)

### MMLU-Pro
- Qwen3.6-35B-A3B: 85.3
- Qwen3-30B-Instruct-2507: ~80
- GLM-4.7-Flash: ~78

### GPQA Diamond
- Qwen3.6-35B-A3B: 84.2

## Performance misurata (questo setup)

Stesso prompt (fibonacci + pytest), max_tokens 500, temp 0, mlx_lm.server porta 1234, M5 32 GB:

| Modello | Cold start | Warm decode | Note |
|---|---|---|---|
| Qwen3-Coder-30B 2025 | 11.7s | **37.7 t/s** | Cache disco già letta |
| GLM-4.7-Flash | 17.9s | **32.0 t/s** | Cold da disco |
| Qwen3.6-35B-UD | 32.9s | 10.5 t/s (memory pressure) → **27.2 t/s** (warm + wired_limit) | Quantization "UD" leggermente più lenta |
| Qwen3.8-27B (dense) | 68s | **7,1 t/s** | Misura con 6,9 GB liberi; tetto teorico ~9-10 |

### Perché Qwen3.8-27B non è un profilo default (2026-08-15)

È l'unico dense della lista, e su questo hardware la differenza con i MoE non è marginale.
Un A3B attiva 3B di parametri per token, un dense 27B rilegge tutti i 15 GB di pesi: il
throughput lo detta la banda di memoria, non la GPU. I 7,1 t/s misurati corrispondono a
~107 GB/s effettivi, cioè il modello sta già girando vicino al suo tetto fisico: liberare
RAM non lo porta oltre ~9-10 t/s, e scendere a 3-bit non cambierebbe categoria d'uso.

Le due incognite sollevate al download sono cadute entrambe:

- **Carica su `mlx_lm.server`** benché sia un VL nativo (`Qwen3_5ForConditionalGeneration`,
  convertito con mlx-vlm). `mlx_lm/models/qwen3_5.py` scarta i pesi `vision_tower` e
  `model.visual` e costruisce solo la torre testuale. Niente mlx-vlm, niente upgrade di mlx-lm.
- **Tool call parsati nativamente**: `finish_reason: tool_calls` con argomenti JSON validi,
  su mlx-lm 0.31.3 senza modifiche.

Uso pratico: domande singole dove la qualità per token ripaga l'attesa (review, refactor
ragionato), non loop agentici. Su un loop da 30 tool call la differenza con `build` è tra
5 e 25 minuti. Non esistono conversioni MLX text-only né 3-bit MLX di questo modello: il
3-bit di Unsloth è solo GGUF, quindi fuori da `mlx_lm.server`.

**Insight chiave**: la quantization "UD" (Unsloth Dynamic) di Qwen3.6 ha un piccolo overhead vs il 4-bit standard di lmstudio-community. Per sostituire con `mlx-community/Qwen3.6-35B-A3B-4bit` (non UD) servirebbero +18 GB di download, da considerare se i 27 t/s non bastano.

## Verità onesta sulle differenze

**GLM ≈ Qwen3.6 > Qwen3-Coder-30B (2025)**. Le differenze pratiche tra i top 2 sono del 5-10%, non del 50%. Per la maggior parte dei task agentici daily la scelta è equivalente.

Se dovessi tenere un solo modello per coding: **Qwen3.6**, perché copre coding + ha thinking mode da attivare per planning quando serve. Costo: qualche t/s in meno sul daily driver.

## Workflow consigliato

1. **Default operativo**: `llm-up build` → GLM-4.7 attivo. Va bene per il 90% dei task.
2. **Refactor profondo / task lungo**: `llm-switch coder` → Qwen3.6.
3. **Planning architetturale prima di codice**: `llm-switch plan` → Qwen3-Instruct.
4. **Inline editor**: Gemma-E4B su processo separato (LM Studio o secondo server).

## Decisioni di drop ripensabili

- **Qwen3-Coder-30B (2025) - 16 GB**: 37 t/s (più veloce di tutti) ma qualità inferiore. Lo tengo come fast fallback se serve velocità grezza. Drop = -16 GB.
- **Qwen3-VL-30B - 17 GB**: tienilo solo se lavori con screenshot/mockup. Confermato come "lo voglio" durante il setup.
- **Gemma-4-E4B - 6.3 GB**: leggero, comodo. Tienilo.
