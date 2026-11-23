# Runbook - Workflow & Troubleshooting

## Daily startup

### Morning, first session

```bash
# 1. Check wired_limit (should be 28000 from the LaunchDaemon)
sysctl iogpu.wired_limit_mb
# if it is 0 or different:  sudo sysctl iogpu.wired_limit_mb=28000

# 2. Start the LLM server (default profile, server.default_profile)
llm-up

# 3. Start the dashboard (background)
llm-dash --bg

# 4. Open the browser
open http://127.0.0.1:1230
```

Cold start of the first model: ~30s (reading 16-20 GB from disk). Later switches are faster (~10s) as long as the filesystem cache holds.

### Quick start for a specific task

```bash
# Agentic coding, reasoning on (the default profile)
llm-up coder              # Qwen3.6-35B (~30s cold)

# Dense 27B, more headroom but ~7 t/s
llm-up qwen38             # Qwen3.8-27B

# Light, when memory is tight
llm-up qwen35-9b          # Qwen3.5-9B
```

## Essential commands

| Command | What it does | Time |
|---|---|---|
| `llm-up <profile>` | Start the server | 5-30s |
| `llm-switch <profile>` | Switch model (kill + restart) | 5-30s |
| `llm-down` | Stop the server | <2s |
| `llm-dash` | Dashboard in the foreground | 1s |
| `llm-dash --bg` | Dashboard in the background | 1s |
| `llm-dash stop` | Stop the dashboard | <1s |

Profiles: `coder` (Qwen3.6, default), `qwen38` (Qwen3.8-27B), `qwen35-9b` (Qwen3.5-9B). Full list: `make models`.

Env overrides: `PORT=1235 llm-serve coder`, `THINK=false llm-serve coder`.

## End of session

```bash
llm-down                  # frees 16-20 GB of RAM
llm-dash stop             # optional, the dashboard is light (~80 MB)
```

## Switching model with opencode open

opencode always talks to `http://127.0.0.1:1234`. From a separate terminal (or from the dashboard UI by clicking a profile):

```bash
llm-switch coder
```

Wait 10-30s: on its next request opencode will find Qwen3.6.

## Troubleshooting

### Symptom: very slow decode (<15 t/s) on a model that should do 30+

**Likely cause**: memory pressure. The model is paging during decode.

**Diagnosis**:
```bash
sysctl vm.swapusage          # swap > 15 GB?
vm_stat | head -8            # Compressed > 5 GB?
```

**Fix**:
1. `llm-down` (unloads the model)
2. Close unneeded Brave tabs (~3-5 GB quickly)
3. `sudo purge` (frees inactive + compressor)
4. `llm-up <profile>` again
5. If it persists: **reboot** (resets swap)

### Symptom: Qwen3.6 at 10 t/s even with a clean system

**Cause**: filesystem disk cache evicted + wired_limit not applied.

**Diagnosis**:
```bash
sysctl iogpu.wired_limit_mb       # 28000? if 0 or different, fix it
```

**Fix**:
```bash
sudo sysctl iogpu.wired_limit_mb=28000
llm-switch coder                  # reload the model, now with the limit in place
```

If the LaunchDaemon was not applied at boot:
```bash
sudo launchctl unload /Library/LaunchDaemons/com.local.wired-limit.plist
sudo launchctl load /Library/LaunchDaemons/com.local.wired-limit.plist
```

### Symptom: dashboard shows Free 0 GB and Compressor 14+ GB

**Cause**: swap thrashing. You probably had 2 models loaded, or the model was over budget.

**Fix**:
```bash
llm-down                   # unload the model
sudo purge                 # if you have passwordless sudo, otherwise wait
# Check recovery:
vm_stat | head -5
```

If `Compressed` does not drop below 5 GB within 1-2 minutes: **reboot**.

### Symptom: opencode says "model not found" or 404

**Diagnosis**:
```bash
curl http://127.0.0.1:1234/v1/models
# must list the full path of the active model
```

**Fix**:
- Check that the model ID in `~/.config/opencode/opencode.json` matches EXACTLY the one in `/v1/models`
- If you changed profile: select the new model from the config in opencode (or restart opencode)

### Symptom: tool calling broken in opencode

**Possible causes**:
1. **Context window too small**: tool results get truncated. Check `limit.context >= 65536` in the config.
2. **Thinking enabled**: the model burns all its tokens on reasoning, leaving no content. Start it with `THINK=false llm-serve coder` (`coder` has `enable_thinking = true` in the TOML; `llm-serve` runs in the foreground, so the variable reaches it, which is not guaranteed through the tmux session of `llm-up`).
3. **Model does not support tool calling well**: among the installed models only Qwen3.6 (`coder`) is a reliable daily driver; Qwen3.8-27B handles tools but at ~7 t/s, Qwen3.5-9B is below the 16 GB floor (see `docs/MODELS.md`).

### Symptom: dashboard looks broken (no styling)

**Diagnosis**:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:1230/static/output.css
```

If 404: build the CSS:
```bash
cd ~/Development/Projects/llm-dash
pnpm run build
```

If still broken: hard refresh the browser (Cmd+Shift+R) to skip the cache.

### Symptom: dashboard does not start, "address already in use"

**Diagnosis**:
```bash
lsof -i :1230
# shows the PID holding the port
```

**Fix**:
```bash
llm-dash stop             # if managed by us
# or the brute-force way:
pkill -f "llm-dash/main.py"
pkill -f "uvicorn"
# then:
llm-dash --bg
```

### Symptom: model switch stuck on "Switching..."

**Diagnosis**:
```bash
ps aux | grep "lms get\|mlx_lm.server"
tail -50 /tmp/llm-coder.log    # if nohup, one log per profile
# or
tmux attach -t llm             # if tmux
```

If `llm-up` is stuck (e.g. a download did not complete), kill it:
```bash
pkill -f "llm-serve"
pkill -f "mlx_lm.server"
sleep 2
llm-up                         # retry
```

### Symptom: model download failed midway

**Cause**: `lms get` had a WebSocket disconnect.

**Fix**: rerun the same command, it resumes where it left off:
```bash
lms get https://huggingface.co/<owner>/<model> -y
```

Existing `.part` files are resumed.

## Recovery after a system crash

```bash
# Check that wired_limit is applied
sysctl iogpu.wired_limit_mb

# Check there is no zombie mlx_lm.server
pgrep -lf mlx_lm.server

# Start everything
llm-up
llm-dash --bg
```

Pre-existing swap is not a problem, it is handled on the fly. If pressure persists: `sudo purge` or a soft reboot.

## Periodic maintenance

### Weekly

```bash
# Update mlx-lm
uv tool upgrade mlx-lm

# Update opencode
brew upgrade opencode

# Clean the cache if you need space
rm -rf ~/Library/Caches/com.exafunction.lms     # LM Studio cache
```

### Monthly

```bash
# Check the models are still relevant
lms ls

# If a better new model comes out (e.g. Qwen3.7), consider dropping the old ones:
rm -rf ~/.lmstudio/models/<owner>/<old-model>
```

### When upgrading macOS

```bash
# Check mlx-lm compatibility with the new macOS
mlx_lm.generate --help

# Check wired_limit can still be applied (Apple might rename it)
sysctl iogpu.wired_limit_mb
```

## Useful diagnostic commands

```bash
# LLM server status
curl http://127.0.0.1:1234/v1/models | python3 -m json.tool

# Memory via the dashboard
curl http://127.0.0.1:1230/api/memory | python3 -m json.tool

# Quick chat test
curl -X POST http://127.0.0.1:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"<full-path>","messages":[{"role":"user","content":"PONG"}],"max_tokens":10}'

# Top RAM hogs
ps -axo rss,comm | sort -rn | head -10 | awk '{printf "%.2f GB  %s\n", $1/1024/1024, $2}'
```
