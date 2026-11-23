# Dashboard - Stack & Architecture

Mini web control plane for managing the local models. Available at `http://127.0.0.1:1230`.

## Stack

### Backend Python

```
fastapi        ~0.x      REST + SSE framework
uvicorn        0.46      ASGI server
httpx          ~0.x      async HTTP client (proxy to mlx_lm.server)
psutil         7.x       cross-platform memory/process snapshot
sse-starlette  3.4       EventSourceResponse helper for chat streaming
jinja2         ~3.x      HTML template engine
```

All managed through `uv`, see `pyproject.toml`.

### Frontend (no build for JS, build for CSS)

| | From | Role |
|---|---|---|
| Tailwind v4 built | `pnpm run build` (native CLI) | CSS utilities, output `static/output.css` |
| Alpine.js 3.14 | static asset `/static/alpine.min.js` | reactivity, state management |
| marked.js 15 | static asset | markdown rendering |
| highlight.js 11 | static asset | syntax highlighting, applied to the DOM after parsing (marked >= 5 no longer accepts the `highlight` option in `setOptions`: passing it there is dead code and the blocks stay uncolored) |
| Geist + JetBrains Mono | Google Fonts CDN | typography |

No React, no Vite, no JS bundler. Edit `index.html` or `app.js` and reload the browser.

## File structure

```
llm-dash/
├── main.py                   ← FastAPI app + endpoints
├── pyproject.toml            ← uv project
├── package.json              ← pnpm + tailwindcss CLI
├── src/
│   └── input.css             ← Tailwind v4 source with @theme + @layer components
├── templates/
│   └── index.html            ← main markup (Jinja2 template)
└── static/
    ├── output.css            ← built CSS (~18 KB minified)
    ├── app.js                ← Alpine logic: dash(), chat(), conversations(), logsView()
    ├── alpine.min.js         ← Alpine 3.14
    ├── marked.min.js         ← markdown
    ├── highlight.min.js      ← highlight
    └── highlight.css         ← atom-one-dark theme
```

## API endpoints

| Endpoint | Method | What it does |
|---|---|---|
| `/` | GET | HTML page (Jinja2 template) |
| `/static/*` | GET | static files (CSS, JS) |
| `/api/status` | GET | `{running, pid, uptime, model, profile, port, switching}` |
| `/api/memory` | GET | `{total_gb, available_gb, used_gb, wired_gb, active_gb, inactive_gb, compressed_gb, swap_used_gb, swap_total_gb, percent, pressure}` |
| `/api/profiles` | GET | catalog of the 4 static profiles (includes `ctx` = context window in tokens) |
| `/api/switch/{profile}` | POST | runs `llm-up <profile>` as a subprocess, async |
| `/api/stop` | POST | runs `llm-down` |
| `/api/logs` | GET | last 50 switch/stop events |
| `/api/chat` | POST | SSE stream, body `{message, history}`, proxy to mlx_lm.server. Events: `reasoning` (reasoning delta: `delta.reasoning` from mlx_lm.server, or `reasoning_content`), `token` (content delta), `done` (`{tps, tokens, elapsed, prompt_tokens, completion_tokens}`), `error`. |

## Client ↔ server communication

### Polling for cyclic data (every 2s)

```js
// app.js
const fetchAll = async () => {
  const [s, m, p] = await Promise.all([
    fetch('/api/status').then(r=>r.json()),
    fetch('/api/memory').then(r=>r.json()),
    fetch('/api/profiles').then(r=>r.json()),
  ]);
  this.status = s; this.mem = m; this.profiles = p;
};
setInterval(fetchAll, 2000);
```

3 GETs in parallel, ~600 bytes total, local latency <5ms. Negligible.

### SSE for chat streaming

Server (Python):

```python
@app.post("/api/chat")
async def api_chat(req: Request) -> EventSourceResponse:
    async def stream():
        payload = {..., "stream": True, "stream_options": {"include_usage": True}}
        async with httpx.AsyncClient() as c:
            async with c.stream("POST", f"{LLM_BASE}/chat/completions", json=payload) as r:
                async for line in r.aiter_lines():
                    if line.startswith("data: "):
                        chunk = json.loads(line[6:])
                        # the usage chunk arrives AFTER the deltas (choices: []), include_usage enabled
                        if (u := chunk.get("usage")):
                            prompt_tokens = u["prompt_tokens"]
                            completion_tokens = u["completion_tokens"]
                        if chunk.get("choices"):
                            content = chunk["choices"][0]["delta"].get("content")
                            if content:
                                yield {"event": "token", "data": content}
        yield {"event": "done", "data": json.dumps({
            "tps": ..., "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens
        })}
    return EventSourceResponse(stream())
```

`stream_options: {include_usage: true}` is the OpenAI-compatible key: the last chunk before `[DONE]` carries `usage` with the real `prompt_tokens` and `completion_tokens` (not an estimate). It works on `mlx_lm.server` 0.31+.

Client (JS):

```js
const reader = resp.body.getReader();
const dec = new TextDecoder();
let buf = '';
while (true) {
  const {done, value} = await reader.read();
  if (done) break;
  // sse_starlette emits CRLF, the parser looks for \n\n: normalize first
  buf += dec.decode(value, {stream:true}).replace(/\r\n/g, '\n');
  // then split on \n\n and parse `event: <e>\ndata: <d>` per chunk
}
```

Each token arrives immediately and rendering is limited to one per frame (`_scheduleRender`): tokens arriving in a burst collapse into a single render. DOM, highlighting and scroll update in the same `requestAnimationFrame`. `$nextTick` is not used: in Alpine it is a `setTimeout` and would split the update across different paints.

**Markdown rendering while streaming** (`StreamRenderer`): the text is half-written markdown, and the goal is for the box to grow without ever shrinking.

- **Incremental**: `marked.lexer` splits the text into top-level blocks. Blocks that are already closed enter the DOM only once, already highlighted and with the copy button; only the last one is rewritten on each frame. A closed block stays valid as long as its `raw` is a prefix of the new tokens (an indented line can reopen the previous list) and as long as the `[ref]: url` definitions do not change; otherwise rendering restarts from there. Replacing all the HTML on every frame also recreated the closed blocks, re-highlighted after the paint, with quadratic cost in length.
- `closeOpenFences()` virtually closes the open code fence, following the CommonMark rules (inside a block, only a line of just backticks or tildes, at least as long as the opening, closes it). Without it, a code block that is still open swallows the rest of the answer.
- `dropPartialLine()` hides the last line until its newline arrives, if it is syntax that changes the structure of the block above: one or two backticks, a `===`/`---` underline, a table separator. Shown as is, it would appear as text and vanish at the next token.
- The last block is not highlighted while it is being written: the final bubble does it when the message closes, via `x-init` with `queueMicrotask` (before the paint).
- The cursor is a `<span class="stream-cursor">` appended to the last line of text; it does not go into code, tables or `<hr>`.

**Reasoning** (models with `enable_thinking = true`): it arrives as a `reasoning` event, separate from the answer, and is shown in a `<details class="think">` above it. The box has a maximum height with internal scroll that sticks to the bottom, and stays open until the message ends: closing it when the answer starts would make the box jump. In the saved message (`reasoning`, `thinkSecs`) it is closed by default; only the one that just finished stays open (`openThinkIdx`, not persisted). Reasoning does not go back into the history sent to the model: the backend keeps only `role` and `content`. Its tokens count toward tok/s.

**Stick to bottom**: the chat follows the generation only while the user stays within
`STICK_THRESHOLD_PX` (120px) of the bottom. Beyond that distance it detaches and
streaming no longer drags the view; coming back within the threshold it reattaches by itself, and
the `.jump-bottom` button appears to go back down right away. Programmatic scroll is
instant on purpose: `smooth` would generate intermediate scroll events that detach
the stick on their own.

**Gotcha 1 - CRLF separator**: `sse_starlette` separates events with `\r\n\r\n`. Without the `replace(/\r\n/g, '\n')` the parser never finds the delimiter and events are silently discarded.

**Gotcha 2 - multi-line data**: when the model's content contains `\n` (code blocks, paragraphs), `sse_starlette` splits the data into several `data:` lines. Per the SSE spec, consecutive `data:` lines must be joined with a `\n` separator. Without this fix the newlines disappear ("def foo():" and "    return x" merge into "def foo():    return x"):

```js
let dataSeen = false;
for (const l of lines) {
  if (l.startsWith('data:')) {
    if (dataSeen) data += '\n';   // <- separator is mandatory
    data += l.startsWith('data: ') ? l.slice(6) : l.slice(5);
    dataSeen = true;
  }
}
```

**Stop / abort streaming**: the client keeps an `AbortController` for each `send()`. Clicking the Stop button calls `abort()` → the connection closes → Starlette cancels the generator → httpx ends the stream to mlx_lm.server. On the client side, the `catch` tells `AbortError` (shows `[interrupted]`) apart from real errors. An additional `_abortAndDiscard` pattern (with a `_discardStream` flag) is used when the user switches conversation mid-stream: it aborts AND discards the buffer so the partial answer is not attributed to the wrong conversation.

## Chat persistence (localStorage)

```js
// app.js
const STORAGE_KEY = 'llmdash:conversations:v1';
const CURRENT_KEY = 'llmdash:current:v1';

// Save format
{
  "c-abc123": {
    id: "c-abc123",
    title: "Refactor module X",
    messages: [{role: "user", content: "..."}, ...],
    created: 1740000000000,
    updated: 1740000123456
  }
}
```

5 MB of localStorage quota = ~5000 average conversations. Never a limit in practice.

Custom DOM events to coordinate the 3 Alpine components:

- `conv:select` (switch chat) - if streaming, abort and discard before loading the new one
- `conv:new` (new chat) - same abort-and-discard pattern
- `conv:list` (sidebar refresh)

Global Alpine store for modal dialogs: `Alpine.store('dialog')` with promise-based methods `confirm({title, message, variant, confirmLabel})` and `alert({title, message})`. It replaces the browser's native `alert()`/`confirm()`. It handles ESC/Enter, initial focus on the confirm button, and three variants (`info` / `warn` / `danger`) with colored border and tag.

## Design system - "Quiet Instrument"

See `src/input.css` for the full CSS tokens.

### Colori

```css
--color-bg: #08080a;          /* near-black background, slightly cool */
--color-surface: #14141a;     /* frame */
--color-surface-2: #1c1c24;   /* nested elements */
--color-surface-3: #25252e;   /* deepest hover */
--color-line: #34343f;        /* visible borders */
--color-line-soft: #25252e;   /* divider */

--color-fg: #fafafa;          /* text primary */
--color-fg-strong: #ffffff;   /* important labels */
--color-fg-dim: #c4c4cc;      /* secondary */
--color-fg-mute: #8e8e96;     /* tertiary */
--color-fg-faint: #5e5e66;    /* hint */

/* SINGLE accent: lime electric (oscilloscope green) */
--color-accent: #a3e635;
--color-accent-strong: #bef264;
--color-accent-dim: #65a30d;
```

### Tipografia

- **Geist** (300-700) for UI
- **JetBrains Mono** (400-700) for numeric data, small-caps labels, code

### Component classes notevoli

| Class | What it is |
|---|---|
| `.frame` | panel with a hairline border, no shadow |
| `.caption` | mono uppercase small-caps for section labels |
| `.mono-num` | tabular-nums numbers |
| `.kpi-num` | large LCD-style number (memory % used) |
| `.profile-btn` | profile button with a 2px side bar (lime when active) |
| `.meter` + `.meter-fill` | LCD-style bar with vertical texture |
| `.stack-meter` + `.stack-seg` | 5-band segmented bar for the RAM breakdown (wired/active/compressed/inactive/free) |
| `.pressure-badge` | low/medium/high pill for memory pressure |
| `.dot-legend` | small legend square for the stack-meter |
| `.bubble-user` / `.bubble-asst` | chat bubbles |
| `.markdown-body.streaming` | answer in progress, rendered as markdown by `StreamRenderer` |
| `.think` / `.think-head` / `.think-body` | reasoning box; `.live` while the model is still thinking |
| `.stream-cursor` | streaming cursor, appended to the last line of text so it never takes a line of its own |
| `.code-copy` | copy button on the code block (opacity 0.35 → 1 on hover, `.ok` / `.err` states for 1.5s) |
| `.jump-bottom` | floating "back to bottom" pill, visible only when the stick has detached |
| `.btn-accent` | lime call-to-action (Transmit) - flex-center, min-width to avoid jumps between different labels |
| `.btn-stop` | Stop streaming button - crit outline with `.stop-square` glyph + red glow |
| `.btn-crit` | filled critical (destructive CTA in confirm dialogs) |
| `.spinner-dot` | small spinning ring (inline loading) |
| `.load-banner` | amber "Loading model" banner above the chat during a switch |
| `.typing-dots` | three pulsing dots before the first token |
| `.dialog-backdrop` + `.dialog-frame` | custom modal (`.variant-{info,warn,danger}` variants with colored border+glow), header `.dialog-glyph` + `.dialog-tag` + `.dialog-rule` |
| `.ctx-meter` + `.ctx-meter-fill` | context usage bar in the chat header (green/warm/crit at 65%/85%) |
| `.conv-item-del` | trash icon on hover on the conversation item (absolute right, opacity 0 → 1, hover crit) |

### Animazioni

- `.rise` + `.rise-1..4`: staggered entrance on page load (6px translateY + opacity)
- `.status-dot.live` / `.warn` / `.crit`: breathing animation with a glow in the matching color
- `.cursor-blink`: inline mono blink in the text during streaming
- `.spinner-dot`: 0.7s linear rotation (loading)
- `.typing-dots`: 3 dots with dot-pulse staggered 0.15s

## Start / stop / dev

```bash
# Via Makefile
make dev               # foreground
make dash              # background
make dash-stop         # stop

# Manual
llm-dash               # foreground
llm-dash --bg          # background, log in /tmp/llm-dash.log
llm-dash stop          # stop the background instance

# Build CSS
pnpm run build         # one-shot
pnpm run watch         # watch mode (rebuilds on edits to src/input.css or templates/)
```

## Possible extensions (not implemented)

- **Chart.js** via CDN for a RAM/swap timeline chart (not really needed, 2s polling is enough)
- **WebSocket** to push status instead of polling (overkill for data that changes every 2s)
- **Auth** if the dashboard ever has to be exposed beyond localhost (for now it binds to 127.0.0.1)
- **KaTeX markdown rendering** for math formulas in assistant messages
- **Conversation export** to `.md` (trivial addition via a JS blob download)

## Debug

```bash
# Dashboard not responding
curl http://127.0.0.1:1230/api/status        # if 200 ok, it's the UI
tail -f /tmp/llm-dash.log                    # uvicorn log

# Asset 404
ls static/                                   # does output.css exist?
pnpm run build                               # rebuild

# LLM server not detected
curl http://127.0.0.1:1234/v1/models         # is it up?
ps -axo pid,comm | grep mlx_lm               # process alive?

# Wrong memory numbers
curl http://127.0.0.1:1230/api/memory | python3 -m json.tool
```
