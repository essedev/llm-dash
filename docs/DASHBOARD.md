# Dashboard - Stack & Architettura

Mini control plane web per gestire i modelli locali. Disponibile su `http://127.0.0.1:1230`.

## Stack

### Backend Python

```
fastapi        ~0.x      framework REST + SSE
uvicorn        0.46      ASGI server
httpx          ~0.x      client HTTP async (proxy verso mlx_lm.server)
psutil         7.x       memory/process snapshot cross-platform
sse-starlette  3.4       helper EventSourceResponse per streaming chat
jinja2         ~3.x      template engine per HTML
```

Tutte gestite via `uv`, vedi `pyproject.toml`.

### Frontend (no build per JS, build per CSS)

| | Da | Ruolo |
|---|---|---|
| Tailwind v4 buildato | `pnpm run build` (CLI nativa) | utility CSS, output `static/output.css` |
| Alpine.js 3.14 | asset statico `/static/alpine.min.js` | reattività, state management |
| marked.js 15 | asset statico | render markdown |
| highlight.js 11 | asset statico | syntax highlighting, applicato al DOM dopo il parse (marked >= 5 non accetta più l'opzione `highlight` in `setOptions`: passarla lì è codice morto e i blocchi restano senza colore) |
| Geist + JetBrains Mono | Google Fonts CDN | tipografia |

Niente React, niente Vite, niente bundler JS. Si edita `index.html` o `app.js` e si refresha il browser.

## File structure

```
llm-dash/
├── main.py                   ← FastAPI app + endpoints
├── pyproject.toml            ← uv project
├── package.json              ← pnpm + tailwindcss CLI
├── src/
│   └── input.css             ← Tailwind v4 source con @theme + @layer components
├── templates/
│   └── index.html            ← markup principale (Jinja2 template)
└── static/
    ├── output.css            ← CSS buildato (~18 KB minified)
    ├── app.js                ← logica Alpine: dash(), chat(), conversations(), logsView()
    ├── alpine.min.js         ← Alpine 3.14
    ├── marked.min.js         ← markdown
    ├── highlight.min.js      ← highlight
    └── highlight.css         ← atom-one-dark theme
```

## API endpoints

| Endpoint | Method | Cosa fa |
|---|---|---|
| `/` | GET | HTML page (Jinja2 template) |
| `/static/*` | GET | static files (CSS, JS) |
| `/api/status` | GET | `{running, pid, uptime, model, profile, port, switching}` |
| `/api/memory` | GET | `{total_gb, available_gb, used_gb, wired_gb, active_gb, inactive_gb, compressed_gb, swap_used_gb, swap_total_gb, percent, pressure}` |
| `/api/profiles` | GET | catalogo dei 4 profili statici (include `ctx` = context window in token) |
| `/api/switch/{profile}` | POST | invoca `llm-up <profile>` come subprocess, async |
| `/api/stop` | POST | invoca `llm-down` |
| `/api/logs` | GET | ultimi 50 eventi switch/stop |
| `/api/chat` | POST | SSE stream, body `{message, history}`, proxy verso mlx_lm.server. Eventi: `reasoning` (delta del ragionamento: `delta.reasoning` di mlx_lm.server, o `reasoning_content`), `token` (delta content), `done` (`{tps, tokens, elapsed, prompt_tokens, completion_tokens}`), `error`. |

## Comunicazione client ↔ server

### Polling per dati ciclici (ogni 2s)

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

3 GET in parallelo, ~600 byte totali, latenza locale <5ms. Trascurabile.

### SSE per chat streaming

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
                        # usage chunk arriva DOPO i delta (choices: []), include_usage abilitato
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

`stream_options: {include_usage: true}` è la chiave OpenAI-compatible: l'ultimo chunk prima di `[DONE]` riporta `usage` con `prompt_tokens` e `completion_tokens` reali (non stima). Funziona su `mlx_lm.server` 0.31+.

Client (JS):

```js
const reader = resp.body.getReader();
const dec = new TextDecoder();
let buf = '';
while (true) {
  const {done, value} = await reader.read();
  if (done) break;
  // sse_starlette emette CRLF, il parser cerca \n\n: normalizzare prima
  buf += dec.decode(value, {stream:true}).replace(/\r\n/g, '\n');
  // poi split su \n\n e parse `event: <e>\ndata: <d>` per chunk
}
```

Ogni token arriva immediatamente e il render è limitato a uno per frame (`_scheduleRender`): i token che arrivano in raffica collassano in un render solo. DOM, evidenziazione e scroll si aggiornano nello stesso `requestAnimationFrame`. Non si passa da `$nextTick`, che in Alpine è un `setTimeout` e spezzerebbe l'aggiornamento su paint diversi.

**Render markdown durante lo streaming** (`StreamRenderer`): il testo è markdown a metà, e l'obiettivo è che il box cresca senza mai accorciarsi.

- **Incrementale**: `marked.lexer` divide il testo in blocchi di primo livello. I blocchi già chiusi entrano nel DOM una volta sola, già evidenziati e col bottone copia; a ogni frame si riscrive solo l'ultimo. Un blocco chiuso resta valido finché il suo `raw` è prefisso dei token nuovi (una riga indentata può riaprire la lista di prima) e finché non cambiano le definizioni `[ref]: url`; altrimenti si rifà da lì. Sostituire tutto l'HTML a ogni frame ricreava anche i blocchi chiusi, rievidenziati dopo il paint, con costo quadratico sulla lunghezza.
- `closeOpenFences()` chiude virtualmente il recinto aperto, con le regole di CommonMark (dentro un blocco solo una riga di soli backtick o tilde, lunga almeno quanto l'apertura, lo chiude). Senza, un blocco di codice ancora aperto inghiotte il resto della risposta.
- `dropPartialLine()` nasconde l'ultima riga finché non arriva il suo a capo, se è sintassi che cambia la struttura del blocco sopra: uno o due backtick, una sottolineatura `===`/`---`, il separatore di una tabella. Mostrata così com'è comparirebbe come testo e sparirebbe al token dopo.
- L'ultimo blocco non viene evidenziato finché è in scrittura: lo fa il bubble definitivo alla chiusura del messaggio, via `x-init` con `queueMicrotask` (prima del paint).
- Il cursore è uno `<span class="stream-cursor">` messo in coda all'ultima riga di testo; non entra in codice, tabelle e `<hr>`.

**Ragionamento** (modelli con `enable_thinking = true`): arriva come evento `reasoning`, separato dalla risposta, e si mostra in un `<details class="think">` sopra di essa. Il riquadro ha un'altezza massima con scroll interno che segue il fondo, e resta aperto fino a fine messaggio: chiuderlo quando parte la risposta farebbe saltare il box. Nel messaggio salvato (`reasoning`, `thinkSecs`) è chiuso di default; resta aperto solo quello appena finito (`openThinkIdx`, non persistito). Il ragionamento non torna nella history mandata al modello: il backend tiene solo `role` e `content`. I suoi token contano per tok/s.

**Aggancio al fondo**: la chat segue la generazione solo finché l'utente resta entro
`STICK_THRESHOLD_PX` (120px) dal fondo. Sopra quella distanza l'aggancio si stacca e lo
streaming non trascina più la vista; rientrando nella soglia si riaggancia da solo, e
compare il pulsante `.jump-bottom` per tornare giù subito. Lo scroll programmatico è
istantaneo di proposito: `smooth` genererebbe eventi di scroll intermedi che sganciano
l'aggancio da soli.

**Gotcha 1 - separator CRLF**: `sse_starlette` separa gli eventi con `\r\n\r\n`. Senza la `replace(/\r\n/g, '\n')` il parser non trova mai il delimitatore e gli eventi vengono scartati silenziosamente.

**Gotcha 2 - data multi-line**: quando il content del modello contiene `\n` (code block, paragrafi), `sse_starlette` splitta il dato in più righe `data:`. Per spec SSE le righe `data:` consecutive vanno concatenate con `\n` separator. Senza questo fix le newline spariscono ("def foo():" e "    return x" si fondono in "def foo():    return x"):

```js
let dataSeen = false;
for (const l of lines) {
  if (l.startsWith('data:')) {
    if (dataSeen) data += '\n';   // <- separator obbligatorio
    data += l.startsWith('data: ') ? l.slice(6) : l.slice(5);
    dataSeen = true;
  }
}
```

**Stop / abort streaming**: il client tiene un `AbortController` per ogni `send()`. Cliccare il bottone Stop chiama `abort()` → la connection si chiude → Starlette cancella il generator → httpx termina lo stream verso mlx_lm.server. Lato client, il `catch` distingue `AbortError` (mostra `[interrotto]`) da errori reali. Pattern aggiuntivo `_abortAndDiscard` (con flag `_discardStream`) usato quando l'utente cambia conversazione mid-stream: aborta E scarta il buffer per evitare che la risposta parziale venga attribuita alla conversazione sbagliata.

## Persistenza chat (localStorage)

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

5 MB di quota localStorage = ~5000 conversazioni medie. Mai limitato in pratica.

Eventi DOM custom per coordinare i 3 component Alpine:

- `conv:select` (switch chat) - se streaming, aborta e scarta prima di caricare la nuova
- `conv:new` (nuova chat) - stesso pattern abort-and-discard
- `conv:list` (refresh sidebar)

Store globale Alpine per dialog modal: `Alpine.store('dialog')` con metodi promise-based `confirm({title, message, variant, confirmLabel})` e `alert({title, message})`. Sostituisce `alert()`/`confirm()` nativi del browser. Gestisce ESC/Enter, focus iniziale sul confirm button, tre varianti (`info` / `warn` / `danger`) con bordo e tag colorati.

## Design system - "Quiet Instrument"

Vedi `src/input.css` per i token CSS completi.

### Colori

```css
--color-bg: #08080a;          /* background quasi-nero, slight cool */
--color-surface: #14141a;     /* frame */
--color-surface-2: #1c1c24;   /* nested elements */
--color-surface-3: #25252e;   /* deepest hover */
--color-line: #34343f;        /* borders visibili */
--color-line-soft: #25252e;   /* divider */

--color-fg: #fafafa;          /* text primary */
--color-fg-strong: #ffffff;   /* labels importanti */
--color-fg-dim: #c4c4cc;      /* secondary */
--color-fg-mute: #8e8e96;     /* tertiary */
--color-fg-faint: #5e5e66;    /* hint */

/* SINGLE accent: lime electric (oscilloscope green) */
--color-accent: #a3e635;
--color-accent-strong: #bef264;
--color-accent-dim: #65a30d;
```

### Tipografia

- **Geist** (300-700) per UI
- **JetBrains Mono** (400-700) per dati numerici, label small-caps, code

### Component classes notevoli

| Class | Cosa è |
|---|---|
| `.frame` | pannello con bordo hairline, niente shadow |
| `.caption` | small-caps mono uppercase per label sezione |
| `.mono-num` | numeri tabular-nums |
| `.kpi-num` | numero grande LCD-style (% used memoria) |
| `.profile-btn` | bottone profilo con bar laterale 2px (lime su attivo) |
| `.meter` + `.meter-fill` | barra LCD-style con texture verticale |
| `.stack-meter` + `.stack-seg` | barra segmentata 5-band per breakdown RAM (wired/active/compressed/inactive/free) |
| `.pressure-badge` | pill low/medium/high per la pressione memoria |
| `.dot-legend` | quadratino legenda per la stack-meter |
| `.bubble-user` / `.bubble-asst` | bubble chat |
| `.markdown-body.streaming` | risposta in corso, renderizzata come markdown da `StreamRenderer` |
| `.think` / `.think-head` / `.think-body` | riquadro del ragionamento; `.live` mentre il modello sta ancora pensando |
| `.stream-cursor` | cursore dello streaming, inserito in coda all'ultima riga di testo così non occupa mai una riga sua |
| `.code-copy` | bottone copia sul blocco di codice (opacity 0.35 → 1 in hover, stati `.ok` / `.err` per 1,5s) |
| `.jump-bottom` | pill flottante "torna in fondo", visibile solo quando l'aggancio si è staccato |
| `.btn-accent` | call-to-action lime (Transmit) - flex-center, min-width per evitare jump fra label diverse |
| `.btn-stop` | bottone Stop streaming - outline crit con `.stop-square` glyph + glow rossa |
| `.btn-crit` | filled critical (CTA distruttiva nei dialog confirm) |
| `.spinner-dot` | mini ring rotante (loading inline) |
| `.load-banner` | banner ambra "Loading model" sopra la chat durante switch |
| `.typing-dots` | tre puntini pulsanti prima del primo token |
| `.dialog-backdrop` + `.dialog-frame` | modal custom (varianti `.variant-{info,warn,danger}` con bordo+glow colorato), header `.dialog-glyph` + `.dialog-tag` + `.dialog-rule` |
| `.ctx-meter` + `.ctx-meter-fill` | barra context usage in header chat (verde/warm/crit a 65%/85%) |
| `.conv-item-del` | icona cestino on-hover sull'item conversazione (absolute right, opacity 0 → 1, hover crit) |

### Animazioni

- `.rise` + `.rise-1..4`: stagger entrance al page load (6px translateY + opacity)
- `.status-dot.live` / `.warn` / `.crit`: breath animation con glow del colore corrispondente
- `.cursor-blink`: blink mono inline nel testo durante streaming
- `.spinner-dot`: rotazione 0.7s linear (loading)
- `.typing-dots`: 3 puntini con dot-pulse staggered 0.15s

## Avvio / arresto / dev

```bash
# Comandi via Makefile
make dev               # foreground
make dash              # background
make dash-stop         # stop

# Manuali
llm-dash               # foreground
llm-dash --bg          # background, log in /tmp/llm-dash.log
llm-dash stop          # stop background

# Build CSS
pnpm run build         # one-shot
pnpm run watch         # watch mode (ribuilda su edit src/input.css o templates/)
```

## Estensioni possibili (non implementate)

- **Chart.js** via CDN per grafico timeline RAM/swap (non serve davvero, polling 2s rende abbastanza)
- **WebSocket** per push status invece di polling (overkill per dati che cambiano ogni 2s)
- **Auth** se mai dovessi esporre la dashboard fuori da localhost (per ora bind 127.0.0.1)
- **Markdown rendering KaTeX** per formule matematiche nei messaggi assistant
- **Export conversazione** in `.md` (banale aggiunta via JS blob download)

## Debug

```bash
# Dashboard non risponde
curl http://127.0.0.1:1230/api/status        # se 200 ok, è la UI
tail -f /tmp/llm-dash.log                    # log uvicorn

# Asset 404
ls static/                                   # output.css esiste?
pnpm run build                               # rebuild

# Server LLM non viene rilevato
curl http://127.0.0.1:1234/v1/models         # è up?
ps -axo pid,comm | grep mlx_lm               # processo vivo?

# Memoria sballata
curl http://127.0.0.1:1230/api/memory | python3 -m json.tool
```
