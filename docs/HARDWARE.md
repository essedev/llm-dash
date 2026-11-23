# Hardware - MacBook Pro M5

## Baseline specs

| | |
|---|---|
| Model | MacBook Pro M5 (Mac17,2) |
| Chip | Apple M5 |
| CPU | 10-core (4 Performance + 6 Efficiency) |
| GPU | 10-core with Neural Accelerators |
| Memory | 32 GB unified |
| OS | macOS 26.3.1 Tahoe (build 25D771280a) |
| GPU API | Metal 4 |

## What makes the M5 special for LLMs

The M5 is the first Apple Silicon chip to integrate **Neural Accelerators inside the GPU** (no longer only in the separate Neural Engine). These accelerators specifically speed up the matmul (matrix multiplication) operations used by transformer layers.

In practice this translates to:

- **MLX 2-2.5x faster** than llama.cpp (GGUF) for MoE models on M5
- **Sustained decode**: 32-37 t/s on 30-35B 4-bit MoE models (it was 25-30 t/s on M4 Pro)
- **Prefill**: ~1500-2000 tok/s, which cuts time-to-first-token on long prompts
- **Native bf16 support** in hardware (useful for mixed quantizations)

To get these benefits you need to use **MLX** as the backend (`mlx_lm.server`), not llama.cpp, which runs on generic CPU/Metal without hitting the Neural Accelerators.

## Unified memory - implications

On Apple Silicon, RAM and VRAM are the same physical pool. This means:

1. **No CPU↔GPU transfers**: zero latency to move tensors
2. **All the RAM is VRAM**: unlike discrete systems where VRAM is limited, here all 32 GB are available to the model
3. **macOS does cap the "wired memory"** the GPU can keep pinned in RAM without pageout

This third point is the main constraint of the setup.

## iogpu.wired_limit_mb

The `iogpu.wired_limit_mb` sysctl controls how much RAM macOS can keep "wired" for the GPU (that is, pinned in physical memory, not swappable during decode).

Default: 0 (meaning ~75% of total RAM = ~24 GB on 32 GB).

**Problem**: loading Qwen3.6-35B (20 GB of weights) + KV cache (6 GB at 64k context) requires ~26 GB wired. Above the default limit, during decode macOS starts paging out blocks of the model and decode collapses from 27 to 10 t/s.

**Fix applied**: raise it to 28 GB with

```bash
sudo sysctl iogpu.wired_limit_mb=28000
```

Persistence: the `config/com.local.wired-limit.plist` file is a LaunchDaemon that reapplies it at every boot. macOS Tahoe no longer reliably reads `/etc/sysctl.conf`, so the LaunchDaemon is the canonical way.

## Realistic memory budget

On 32 GB total:

| Component | Typical cost |
|---|---|
| macOS kernel + system | 3-5 GB (wired) |
| Brave + tabs + renderers | 3-6 GB |
| VS Code + plugin helpers | 1-2 GB |
| Claude Code + cmux | 1-2 GB |
| Docker Desktop (if running) | 4-8 GB |
| **Total background apps** | **~10-15 GB** |
| **Available for LLM** | **~17-22 GB** |

The KV cache comes on top of this: a 16 GB model with 64k context needs ~6 GB more of KV. So the "model you can really load" weighs ~14-16 GB at most in a normal scenario.

For Qwen3.6 (20 GB) you **have to close something** before loading it, or accept paging.

## Measured performance

Benchmarks run on this setup, fibonacci prompt + 3 unit tests, max 500 tokens, temp 0:

| Model | decode tok/s | Model RAM | KV @ 64k |
|---|---|---|---|
| Qwen3-Coder-30B-A3B 2025 | 37.7 | 16 GB | ~6 GB |
| GLM-4.7-Flash | 32.0 | 16 GB | ~6 GB |
| Qwen3.6-35B-A3B-UD | 27.2 (warm cache) | 20 GB | ~6 GB |
| Qwen3.6-35B-A3B-UD | 10.5 (cold) | 20 GB | ~6 GB |

The 27 t/s on Qwen3.6 are reached only with a warm disk cache + wired_limit at 28 GB. Cold, or with the default wired limit, the numbers collapse.

## Useful macros

```bash
# Quick memory status
vm_stat | head -8

# Top RAM processes
ps -axo rss,comm | sort -rn | head -10 | awk '{printf "%.2f GB  %s\n", $1/1024/1024, $2}'

# Swap usage
sysctl vm.swapusage

# Current wired limit
sysctl iogpu.wired_limit_mb
```

See also `docs/MEMORY.md` for the details on how `available_gb` is computed and how the dashboard tells "used" from "available".
