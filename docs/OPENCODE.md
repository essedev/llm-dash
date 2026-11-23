# opencode integration

## Setup

The file `~/.config/opencode/opencode.json` points to mlx_lm.server as a local OpenAI-compatible provider.

Example in `config/opencode.json.example`. Replace `/Users/you` with your `$HOME`.

## Provider config

```json
{
  "provider": {
    "mlx": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "mlx_lm.server (port 1234)",
      "options": { "baseURL": "http://127.0.0.1:1234/v1" },
      "models": {
        "/Users/you/.lmstudio/models/unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit": {
          "name": "Qwen3.6-35B-A3B (coder default)",
          "limit": { "context": 65536, "output": 8192 }
        },
        "/Users/you/.lmstudio/models/lmstudio-community/Qwen3.8-27B-MLX-4bit": {
          "name": "Qwen3.8-27B (others - dense, ~7 t/s)",
          "limit": { "context": 65536, "output": 8192 }
        }
      }
    }
  },
  "model": "mlx//Users/you/.lmstudio/models/unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit"
}
```

### Important notes

- **Model IDs are full filesystem paths.** This is because mlx_lm.server exposes models with that ID in `/v1/models` and expects the path in request bodies. Ugly but functional.
- **Context limit 64k**, aligned with what the system sustains with a 16-20 GB model loaded.
- **Output limit 8192**, standard for long generation (refactors, code generation).
- The default `model` is the string `<provider>/<model_id>`, hence `mlx//Users/...` (double slash because the path starts with `/`).

## Typical workflow

### The common case

```bash
# 1. Server up
llm-up                          # default profile (coder, Qwen3.6)

# 2. Go to a project and launch opencode
cd ~/code/some-project
opencode

# Now you have an agent CLI talking to the local model
# Tool calling, file edit, terminal commands
```

### Switching model during a session

opencode always talks to `http://127.0.0.1:1234`. To change model during a session:

```bash
# From another terminal (or from the web dashboard by clicking a profile):
llm-switch qwen38               # stops Qwen3.6, starts Qwen3.8-27B (~10-30s)
```

opencode will reload the models on the next request. If `opencode.json` has all the models registered in the provider, just select a different one from the opencode UI (or restart opencode).

### Planning

With a single agentic profile on disk there is no longer a model dedicated to planning: use `coder` with thinking on (`enable_thinking = true`, override with `THINK=false llm-up`), which reasons before answering.

## MCP integration

The opencode provider includes the `context7` MCP server to access the official library docs:

```json
"mcp": {
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp",
    "headers": { "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}" }
  }
}
```

The local model (GLM-4.7 and Qwen3.6 support tool calling) can use `context7.search-docs` to fetch up-to-date library documentation (e.g. Tailwind v4, new FastAPI APIs).

## Caveats on local tool calling

Tool calling with local models works, but **it is not as reliable as Claude Sonnet 4.5+**. Expect:

- **Good**: single tool calls, correct JSON parameters, parallel calls (2-3 tools together)
- **Marginal**: chains of 5+ tool calls with shared state
- **Hard**: error recovery in multi-step loops, the complex decision "do I have enough info to answer?"

For long, critical agentic tasks (e.g. refactors on work projects), the Claude API remains preferable. Local is great for: brainstorming, personal prototypes, experiments.

## Mixed cloud + local strategy

| Use case | Tool |
|---|---|
| Agentic coding on work projects | Claude Code + Anthropic API |
| Personal experimentation | opencode + local |
| Architecture brainstorming | opencode + local Qwen3-Instruct |
| Critical multi-file refactor | Claude Code API |
| "Explain this library to me" | opencode + GLM-4.7 + context7 MCP |
| Inline editor autocomplete | local (Gemma-E4B) |

Local = privacy, free, offline. Cloud = top quality, tool calling reliability, low latency.

## Debugging opencode + local

If opencode does not see the models:

1. **Check the server is up**: `curl http://127.0.0.1:1234/v1/models`
2. **Check the path in the config**: the model ID must match EXACTLY what the server exposes
3. **Server logs**: `tmux attach -t llm` (if started via `llm-up` with tmux)
4. **opencode logs**: launch opencode with `--debug` or check `~/.config/opencode/logs/`

If tool calling fails:
- Check that the context window in `opencode.json` is ≥ 64k (below that, opencode truncates tool results and breaks the loop)
- Check that `THINK=false` (default from `config/llm-dash.toml` for build/coder, read via `_config.py`)
