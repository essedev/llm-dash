# Memory Management

## available vs used - the difference that matters

On macOS the `used` metric is misleading because it includes filesystem cache that is **reclaimable on the fly**. The number that decides whether the model fits in RAM is `available_gb`.

### Typical breakdown

```
Free:        1-3 GB     ← truly free
Active:      6-15 GB    ← foreground apps (Brave, VS Code, Claude)
Inactive:    5-13 GB    ← recent app cache, reclaimable
Wired:       3-5 GB     ← kernel + system (not reclaimable)
Compressed:  0.1-3 GB   ← compressor pages (low = healthy)
Cached:      5-10 GB    ← filesystem cache (highly reclaimable)
```

**`available = free + inactive + cached + part-of-compressed`**

In Python, `psutil.virtual_memory().available` computes this automatically on macOS.

### Why the dashboard uses pressure + breakdown

The Memory section shows:

1. **`% used`** as the primary figure (`(total - available) / total * 100`): the standard psutil metric, from 0 to 100 regardless of total size.
2. **Pressure badge low/medium/high**: derived from `vm.percent + compressed_gb + swap_used_gb`. Thresholds:
   - **Low**: percent < 72%, compressed < 8% of total, swap < 2 GB
   - **Medium**: percent 72-87%, or compressed 8-18%, or swap 2-8 GB
   - **High**: percent ≥ 88%, or compressed > 18%, or swap > 8 GB
3. **Stack meter**: a 5-segment bar (wired / active / compressed / inactive / free) to see at a glance where the RAM goes.
4. **Reclaimable**: `available_gb` (free + inactive + speculative). Green if ≥ 8 GB.

When you load a model, macOS first takes from Inactive/Cached (fast reallocation, no swap), then if it needs more it also pushes Active apps out to swap (slow). Pressure accounts for both compressor and swap, not just the "used" number.

## KV cache - hidden costs

For every token in the context, the cache takes:

```
KV_per_token = n_layers × n_kv_heads × head_dim × 2 (K+V) × bytes_per_element
```

For modern MoE models with GQA (Qwen3, GLM, Gemma 4):
- ~100 KB / token in FP16
- ~50 KB / token in INT8
- ~25 KB / token in INT4

At 64k context:
- FP16 = 6.4 GB
- INT8 = 3.2 GB
- INT4 = 1.6 GB

`mlx_lm.server` 0.31 does NOT expose KV quantization via a flag (it exists in `mlx_lm.generate` with `--kv-bits` but not on the server). So on the server the KV cache is native FP16.

**The effective budget for the model** is therefore `available - 6.4 GB`.

## Concrete scenarios

### Scenario A: Brave + VS Code + Claude active (normal case)

```
Total:           32 GB
System + apps: -10 GB
─────────────────────────
Available:       22 GB
KV @ 64k:       -6.4 GB
─────────────────────────
Model budget:    15.6 GB → Qwen3.8-27B (15 GB) borderline
```

You have to close a few tabs to fit.

### Scenario B: only cmux + opencode (development focus)

```
Total:           32 GB
System + apps:  -7 GB
─────────────────────────
Available:       25 GB
KV @ 64k:       -6.4 GB
─────────────────────────
Model budget:    18.6 GB → Qwen3.6 (20 GB) borderline
```

Tight but doable with wired_limit at 28 GB.

### Scenario C: Docker Desktop running with 3 containers

```
Total:           32 GB
System + apps: -10 GB
Docker VM:       -6 GB
─────────────────────────
Available:       16 GB
KV @ 64k:       -6.4 GB
─────────────────────────
Model budget:    9.6 GB → only Qwen3.5-9B (6 GB)
```

For serious agentic LLM work you have to shut Docker down, or limit Docker Desktop to 4 GB of RAM (Settings → Resources → Memory).

## iogpu.wired_limit_mb

The sysctl that lets MLX "wire" the whole model in RAM without pageout.

```bash
sudo sysctl iogpu.wired_limit_mb=28000   # 28 GB
```

Without it, even with enough RAM, macOS can page out blocks of the model during decode, and throughput collapses.

To persist it: `config/com.local.wired-limit.plist` as a LaunchDaemon.

### Check

```bash
sysctl iogpu.wired_limit_mb
# iogpu.wired_limit_mb: 28000  ← ok
```

## Swap - when it is a problem

Swap on macOS is a file in `/private/var/vm/`. macOS readily writes inactive pages to it.

**Swap used 0-10 GB**: normal, no impact.
**Swap 10-20 GB**: caution, system under pressure.
**Swap > 20 GB**: thrashing, reboot or close heavy apps.

```bash
sysctl vm.swapusage
# total = 13312.00M  used = 11722.00M  free = 1590.00M
```

### Recovery

If swap is bloated after an intensive MLX session:

1. `llm-down` (unloads the model)
2. `sudo purge` (asks for a password, frees inactive + compressor)
3. Close Brave tabs you are not using
4. If still high: **reboot** (resets swap)

## Cold start - filesystem disk cache

The 20 GB of Qwen3.6 safetensors are read from disk on the first `mlx_lm.server` boot (~30s). macOS keeps them in the **filesystem cache** after reading. On the second boot they start from the RAM cache (5s).

Implications:
- **First start of the day**: slow (30-40s).
- **Model switch shortly after**: fast (<5s) if the cache holds.
- **Model switch after opening heavy files**: slow, because the filesystem cache was evicted.

## Compressor - stress signal

The macOS compressor compresses inactive pages to free RAM without writing to swap. It uses very fast LZ4.

- **Compressor 0-3 GB**: normal.
- **Compressor 3-10 GB**: under stress, swap is the next step.
- **Compressor > 10 GB**: thrashing imminent or underway.

In `psutil.virtual_memory()` the compressor is included in `used`, but the system counts it as "available" because it can decompress it on demand (slowly, though).

## Recommended workflow

1. **Serious coding session**: close Brave, leave only cmux + an editor + opencode. Load Qwen3.6 (`coder`). Work.
2. **Normal day usage**: if you need headroom, Qwen3.8-27B (15 GB) or Qwen3.5-9B (6 GB) instead of Qwen3.6 (20 GB).
3. **When the pressure badge goes to medium/high**: close something or switch to a smaller model. `% used` alone is not enough: also look at compressor and swap in the legend.
4. **After an intensive MLX session**: `llm-down` when you finish, it frees 16-20 GB instantly.

## Useful macros

```bash
# Quick snapshot
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
