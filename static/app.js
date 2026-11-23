// llm-dash client logic - Alpine + marked + highlight.js + localStorage

// How close to the bottom the chat must be to keep following the generation (stick to bottom).
const STICK_THRESHOLD_PX = 120;
// Global events: 'conv:select', 'conv:new', 'conv:delete', 'conv:list'

const STORAGE_KEY = 'llmdash:conversations:v1';
const CURRENT_KEY = 'llmdash:current:v1';

// Dialog store (custom alert/confirm).
document.addEventListener('alpine:init', () => {
  window.Alpine.store('dialog', {
    open: false,
    title: '',
    message: '',
    variant: 'info',          // 'info' | 'warn' | 'danger'
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    showCancel: true,
    _resolve: null,

    confirm(opts = {}) {
      return new Promise((resolve) => {
        this.title = opts.title || 'Confirm';
        this.message = opts.message || '';
        this.variant = opts.variant || 'danger';
        this.confirmLabel = opts.confirmLabel || 'Confirm';
        this.cancelLabel = opts.cancelLabel || 'Cancel';
        this.showCancel = true;
        this._resolve = resolve;
        this.open = true;
        requestAnimationFrame(() => document.querySelector('[data-dialog-confirm]')?.focus());
      });
    },

    alert(opts = {}) {
      return new Promise((resolve) => {
        this.title = opts.title || 'Notice';
        this.message = opts.message || '';
        this.variant = opts.variant || 'warn';
        this.confirmLabel = opts.confirmLabel || 'OK';
        this.showCancel = false;
        this._resolve = resolve;
        this.open = true;
        requestAnimationFrame(() => document.querySelector('[data-dialog-confirm]')?.focus());
      });
    },

    _close(result) {
      if (!this.open) return;
      this.open = false;
      const r = this._resolve;
      this._resolve = null;
      if (r) r(result);
    },

    variantTag() {
      if (this.variant === 'danger') return 'CRITICAL';
      if (this.variant === 'warn')   return 'CAUTION';
      return 'NOTICE';
    },

    variantGlyph() {
      if (this.variant === 'danger') return '!!';
      if (this.variant === 'warn')   return '/!\\';
      return 'i';
    },
  });
});

// Markdown setup.
// marked >= 5 no longer accepts the `highlight` option in setOptions: highlighting
// is applied to the DOM after parsing, in enhanceCode().
function setupMarked() {
  if (typeof window.marked === 'undefined') return;
  window.marked.setOptions({ breaks: true, gfm: true });
}
document.addEventListener('DOMContentLoaded', setupMarked);

function renderMd(text) {
  if (typeof window.marked === 'undefined') return escapeHtml(text);
  try { return window.marked.parse(text || ''); } catch (e) { return escapeHtml(text); }
}

// While streaming the text is half-written markdown: a still-open ``` would
// swallow everything after it into one code block and the answer would look
// like it vanished. The open code fence is closed virtually, for rendering only.
// CommonMark rules apply: inside an open block only a line of nothing but
// backticks (or tildes), at least as long as the opening, closes it; a line
// like ```js is content, not a fence. If the text already ends with a newline
// the closing goes right after it: an extra "\n" would be a blank line in the
// code that disappears when the real closing arrives, shrinking the box.
function closeOpenFences(text) {
  let open = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!m) continue;
    const [, fence, rest] = m;
    if (!open) {
      if (fence[0] === '`' && rest.includes('`')) continue; // inline backtick, not a code fence
      open = fence;
    } else if (fence[0] === open[0] && fence.length >= open.length && !rest.trim()) {
      open = null;
    }
  }
  if (!open) return text;
  return text + (text.endsWith('\n') ? '' : '\n') + open;
}

// Until its newline arrives, the last line can be a piece of syntax that changes
// the structure of the block above: one or two backticks (a code fence being
// typed), a === / --- underline (the paragraph becomes a heading, two lines
// become one) or a table separator (the rows become a header).
// Rendered as is it would show up as text and vanish on the next token,
// shrinking the box: it is shown only once complete.
const PARTIAL_LINE = [
  /^ {0,3}`{1,2}$/,
  /^ {0,3}(=+|-+) *$/,
  /^ {0,3}[|:\- ]*\|[|:\- ]*$/,
];
function dropPartialLine(text) {
  const i = text.lastIndexOf('\n');
  const last = text.slice(i + 1);
  return PARTIAL_LINE.some(re => re.test(last)) ? text.slice(0, i + 1) : text;
}

function htmlToFragment(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content;
}

// Incremental render of the incoming answer. Re-parsing and replacing all the
// HTML on every frame also recreates the already closed blocks: they lose their
// highlighting and copy button, get re-highlighted in a later task (after paint),
// and the cost grows with the square of the length. Here the closed top-level
// blocks enter the DOM once, already highlighted; each frame rewrites only the
// last one, the only block that can still change.
class StreamRenderer {
  constructor(root) {
    this.root = root;
    this.committed = []; // [{raw, nodes}] in document order
    this.tail = [];      // nodes of the last block, rewritten on every update
    this.links = '{}';   // [ref]: url definitions seen at the last update
  }

  update(text) {
    if (typeof window.marked === 'undefined') {
      this.root.textContent = text;
      return;
    }
    let tokens;
    try {
      tokens = window.marked.lexer(closeOpenFences(dropPartialLine(text)));
    } catch (e) {
      this.reset();
      this.root.textContent = text;
      return;
    }
    const stable = Math.max(tokens.length - 1, 0);

    // A [ref]: url definition that has just arrived (or grown) changes the links of
    // already closed blocks without changing their raw text: in that case rebuild everything.
    const links = JSON.stringify(tokens.links || {});
    if (links !== this.links) {
      this.links = links;
      for (const c of this.committed.splice(0)) c.nodes.forEach(n => n.remove());
    }

    // A closed block can still reopen (an indented line after a blank line extends
    // the previous list): commits hold while their raw text is still a prefix of
    // the new tokens, and are rebuilt from there on.
    let same = 0;
    while (same < this.committed.length && same < stable
           && this.committed[same].raw === tokens[same].raw) same++;
    for (const c of this.committed.splice(same)) c.nodes.forEach(n => n.remove());

    this._clearTail();
    for (let i = same; i < stable; i++) {
      const frag = htmlToFragment(window.marked.parser([tokens[i]]));
      enhanceCode(frag);
      const nodes = Array.from(frag.childNodes);
      this.root.appendChild(frag);
      this.committed.push({raw: tokens[i].raw, nodes});
    }
    const frag = htmlToFragment(window.marked.parser(tokens.slice(stable)));
    this.tail = Array.from(frag.childNodes);
    this.root.appendChild(frag);
    this._placeCursor();
  }

  // The cursor goes at the end of the last block's text, on the same line.
  // An ::after on the last child would land on its own line below a code block,
  // list or table, and that line would vanish on the next block.
  // The cursor stays out of code, tables and horizontal rules: there the growing
  // block is enough to show that generation is in progress.
  _placeCursor() {
    if (!this.cursor) {
      this.cursor = document.createElement('span');
      this.cursor.className = 'stream-cursor';
      this.cursor.setAttribute('aria-hidden', 'true');
      this.cursor.textContent = '▌';
    }
    this.cursor.remove();
    let el = this.root.lastElementChild;
    while (el && el.lastElementChild && CURSOR_DESCEND.has(el.lastElementChild.tagName)) {
      el = el.lastElementChild;
    }
    if (el && !CURSOR_SKIP.has(el.tagName)) el.appendChild(this.cursor);
  }

  _clearTail() {
    this.tail.forEach(n => n.remove());
    this.tail = [];
  }

  reset() {
    this.committed = [];
    this.tail = [];
    this.links = '{}';
    this.root.replaceChildren();
  }
}

// Blocks the cursor descends into to reach the last line of text, and blocks it
// never enters.
const CURSOR_DESCEND = new Set(['UL', 'OL', 'LI', 'BLOCKQUOTE', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                                'PRE', 'TABLE', 'HR']);
const CURSOR_SKIP = new Set(['PRE', 'TABLE', 'HR']);

function makeCopyButton(code) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'code-copy';
  btn.textContent = 'copy';
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(code.textContent || '');
      btn.textContent = 'copied';
      btn.classList.add('ok');
    } catch (_) {
      // Clipboard denied or insecure context: without feedback the click looks broken.
      btn.textContent = 'failed';
      btn.classList.add('err');
    }
    setTimeout(() => {
      btn.textContent = 'copy';
      btn.classList.remove('ok', 'err');
    }, 1500);
  });
  return btn;
}

// Highlighting plus copy button on code blocks that are already rendered.
// While streaming it never touches the block still being written (StreamRenderer
// passes only closed blocks): highlighting on every token would be costly and
// make colors flicker on syntactically incomplete code.
function enhanceCode(root) {
  if (!root) return;
  root.querySelectorAll('pre > code').forEach((code) => {
    const pre = code.parentElement;
    if (pre.dataset.enhanced === '1') return;
    pre.dataset.enhanced = '1';
    pre.classList.add('code-wrap');
    if (window.hljs) {
      try { window.hljs.highlightElement(code); } catch (_) {}
    }
    pre.appendChild(makeCopyButton(code));
  });
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
  );
}

// Storage.
function loadConversations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function saveConversations(map) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch (e) {}
}

function getCurrentId() {
  return localStorage.getItem(CURRENT_KEY) || null;
}

function setCurrentId(id) {
  if (id) localStorage.setItem(CURRENT_KEY, id);
  else localStorage.removeItem(CURRENT_KEY);
}

function uuid() {
  return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Dash component (status / memory / profiles / switch).
function dash() {
  return {
    status: {running:false, model:null, profile:null, pid:null, port:1234, uptime:'-', switching:false, switching_profile:null},
    mem: {total_gb:32, used_gb:0, percent:0, swap_used_gb:0, swap_total_gb:0, wired_gb:0, available_gb:0, active_gb:0, inactive_gb:0, compressed_gb:0, pressure:'low'},
    profiles: {},

    // Profiles split by tier: the default ones vs the "other" ones present on disk.
    get defaultProfiles() {
      return Object.fromEntries(
        Object.entries(this.profiles).filter(([, p]) => (p.tier || 'default') === 'default')
      );
    },
    get otherProfiles() {
      return Object.fromEntries(
        Object.entries(this.profiles).filter(([, p]) => p.tier === 'other')
      );
    },

    async poll() {
      const fetchAll = async () => {
        try {
          const [s, m, p] = await Promise.all([
            fetch('/api/status').then(r=>r.json()),
            fetch('/api/memory').then(r=>r.json()),
            fetch('/api/profiles').then(r=>r.json()),
          ]);
          this.status = s; this.mem = m; this.profiles = p;
          window.__lastStatus = s;
          window.__lastProfiles = p;
        } catch (e) { console.error(e); }
      };
      await fetchAll();
      setInterval(fetchAll, 2000);
    },

    async switchTo(profile) {
      const r = await fetch('/api/switch/' + profile, {method:'POST'});
      if (!r.ok) {
        const j = await r.json().catch(()=>({error:'http '+r.status}));
        await window.Alpine.store('dialog').alert({
          title: 'Switch failed',
          message: String(j.error || ('HTTP ' + r.status)),
          variant: 'danger',
        });
      }
    },

    async stopServer() {
      const ok = await window.Alpine.store('dialog').confirm({
        title: 'Stop the server?',
        message: 'mlx_lm.server will be stopped. Any in-flight responses will be interrupted.',
        confirmLabel: 'Halt',
        variant: 'danger',
      });
      if (!ok) return;
      await fetch('/api/stop', {method:'POST'});
    },

    pressureColor(level) {
      if (level === 'high') return 'text-[var(--color-crit)]';
      if (level === 'medium') return 'text-[var(--color-warm)]';
      return 'text-[var(--color-accent)]';
    },

    memSegments(m) {
      const total = Math.max(m.total_gb || 1, 1);
      const wired = m.wired_gb || 0;
      const active = m.active_gb || 0;
      const compressed = m.compressed_gb || 0;
      const inactive = m.inactive_gb || 0;
      const known = wired + active + compressed + inactive;
      const free = Math.max(0, total - known);
      const pct = (gb) => (gb / total) * 100;
      return [
        {label:'Wired',      cls:'wired',      gb:wired,      pct:pct(wired)},
        {label:'Active',     cls:'active',     gb:active,     pct:pct(active)},
        {label:'Compressed', cls:'compressed', gb:compressed, pct:pct(compressed)},
        {label:'Inactive',   cls:'inactive',   gb:inactive,   pct:pct(inactive)},
        {label:'Free',       cls:'free',       gb:free,       pct:pct(free)},
      ];
    },

    fitMessage(avail, profile) {
      const p = (window.__lastProfiles || {})[profile];
      const need = p ? p.size_gb : null;
      if (!need) return 'RAM riusabile (libera + cache + compressa)';
      const margin = avail - (need + 6); // weights + ~6 GB estimated KV cache
      if (margin > 4) return `Profile attivo (${need + 6} GB stimati): margine ${margin.toFixed(1)} GB`;
      if (margin > 0) return `Profile attivo (${need + 6} GB stimati): margine stretto ${margin.toFixed(1)} GB`;
      return `Profile attivo (${need + 6} GB stimati): ${(-margin).toFixed(1)} GB sotto - rischio swap`;
    }
  };
}

// Chat component.
function chat() {
  return {
    currentId: null,
    title: '',
    messages: [],
    input: '',
    streaming: false,
    streamBuf: '',
    // The model reasoning (delta.reasoning), kept apart from the answer.
    streamReasoning: '',
    thinkSecs: null,      // reasoning duration, fixed at the first answer token
    _thinkT0: 0,
    openThinkIdx: -1,     // just-closed message whose reasoning stays open
    stuck: true,
    lastStats: {tps:null, tokens:0, elapsed:0},
    lastUsage: {prompt_tokens:0, completion_tokens:0},
    status_running: false,
    status_switching: false,
    status_switching_profile: null,
    _ctxLimit: 0,
    _scrollPending: false,
    _renderPending: false,
    _abort: null,
    _discardStream: false,

    bindStorage() {
      // load current conversation on init and listen for conv:select
      this.currentId = getCurrentId();
      this._bindScroll();
      this._loadCurrent();
      window.addEventListener('conv:select', (e) => {
        this._abortAndDiscard();
        this.currentId = e.detail.id;
        setCurrentId(this.currentId);
        this._loadCurrent();
      });
      window.addEventListener('conv:new', (e) => {
        this._abortAndDiscard();
        this.currentId = e.detail.id;
        setCurrentId(this.currentId);
        this.title = '';
        this.messages = [];
        this.lastStats = {tps:null, tokens:0, elapsed:0};
        this.lastUsage = {prompt_tokens:0, completion_tokens:0};
      });
      // poll status flags for empty-state + composer messaging
      const syncStatus = () => {
        const s = window.__lastStatus || {};
        const profiles = window.__lastProfiles || {};
        this.status_running = !!s.running;
        this.status_switching = !!s.switching;
        this.status_switching_profile = s.switching_profile || null;
        this._ctxLimit = profiles[s.profile]?.ctx || 0;
      };
      syncStatus();
      setInterval(syncStatus, 1000);
    },

    _loadCurrent() {
      this.openThinkIdx = -1;
      const all = loadConversations();
      const c = this.currentId ? all[this.currentId] : null;
      if (!c) {
        this.title = '';
        this.messages = [];
        this.lastStats = {tps:null, tokens:0, elapsed:0};
        this.lastUsage = {prompt_tokens:0, completion_tokens:0};
        return;
      }
      this.title = c.title || '';
      this.messages = (c.messages || []).slice();
      this.lastUsage = {prompt_tokens:0, completion_tokens:0};
      this.$nextTick(() => {
        this.stuck = true;
        this._scrollBottom(true);
        enhanceCode(this.$refs.msgs);
      });
    },

    persist() {
      if (!this.currentId) {
        this.currentId = uuid();
        setCurrentId(this.currentId);
      }
      const all = loadConversations();
      const existing = all[this.currentId] || {};
      all[this.currentId] = {
        id: this.currentId,
        title: this.title || existing.title || (this.messages[0]?.content?.slice(0, 40)) || 'Untitled',
        messages: this.messages,
        updated: Date.now(),
        created: existing.created || Date.now(),
      };
      saveConversations(all);
      window.dispatchEvent(new CustomEvent('conv:list'));
    },

    renderMd, escapeHtml, enhanceCode,

    // Stick to bottom: follow the generation while the user stays within the threshold.
    // If they scroll further up it detaches and stops pulling them down; once they
    // are back within the threshold it re-attaches by itself. Programmatic scrolling
    // lands at distance ~0, so it never detaches by itself.
    _bindScroll() {
      const el = this.$refs.msgs;
      if (!el) return;
      el.addEventListener('scroll', () => {
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        this.stuck = distance < STICK_THRESHOLD_PX;
      }, {passive: true});
    },

    _scrollBottom(force) {
      if (!this.$refs.msgs) return;
      if (!force && !this.stuck) return;
      this.$refs.msgs.scrollTop = this.$refs.msgs.scrollHeight;
    },

    jumpToBottom() {
      this.stuck = true;
      this._scrollBottom(true);
    },

    _scheduleScroll(force) {
      if (this._scrollPending) return;
      this._scrollPending = true;
      this.$nextTick(() => {
        requestAnimationFrame(() => {
          this._scrollPending = false;
          this._scrollBottom(force);
        });
      });
    },

    // The markdown of the incoming text is re-parsed at most once per frame:
    // bursts of tokens collapse into a single render. DOM, highlighted code and
    // scroll update in the same frame: going through $nextTick (a setTimeout in
    // Alpine) would split them across different paints.
    _scheduleRender() {
      if (this._renderPending) return;
      this._renderPending = true;
      requestAnimationFrame(() => {
        this._renderPending = false;
        this._renderThinking();
        const box = this.$refs.streamBox;
        if (this.streamBuf && box) {
          // The renderer lives on the element: x-if recreates it for every new answer,
          // and outside Alpine state the DOM nodes do not end up in a reactive proxy.
          if (!box._stream) box._stream = new StreamRenderer(box);
          box._stream.update(this.streamBuf);
        }
        this._scrollBottom();
      });
    },

    // Reasoning is plain text: only the new part is appended. The box has a maximum
    // height and follows the bottom by itself, until the user scrolls inside it
    // to reread.
    _renderThinking() {
      const tb = this.$refs.thinkBox;
      if (!tb) return;
      const text = this.streamReasoning.trimStart();
      const shown = tb._shown || 0;
      if (text.length <= shown) return;
      const follow = tb.scrollHeight - tb.scrollTop - tb.clientHeight < 24;
      tb.append(text.slice(shown));
      tb._shown = text.length;
      if (follow) tb.scrollTop = tb.scrollHeight;
    },

    thinkLabel(secs) {
      return secs == null ? 'Thinking' : 'Thought for ' + secs + 's';
    },

    _resetStream() {
      this.streamBuf = '';
      this.streamReasoning = '';
      this.thinkSecs = null;
      this._thinkT0 = 0;
    },

    _thinkElapsed() {
      return Math.max(1, Math.round((performance.now() - this._thinkT0) / 1000));
    },

    async send() {
      const text = this.input.trim();
      if (!text || this.streaming || this.status_switching || !this.status_running) return;
      const history = this.messages.slice();
      this.messages.push({role:'user', content:text});
      this.input = '';
      this._resetStream();
      this.openThinkIdx = -1;
      this.streaming = true;
      this._abort = new AbortController();
      this.persist();
      // A new send brings the user back to the bottom even if they were reading further up.
      this.stuck = true;
      this._scheduleScroll(true);

      try {
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({message: text, history: history}),
          signal: this._abort.signal,
        });
        if (!resp.ok || !resp.body) {
          this.streamBuf = '[errore HTTP ' + resp.status + ']';
          this.flush();
          return;
        }
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          // SSE separator may be \n\n or \r\n\r\n - normalize CRLF
          buf += dec.decode(value, {stream:true}).replace(/\r\n/g, '\n');
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const ev = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            this.handleEvent(ev);
          }
        }
        this.flush();
      } catch (e) {
        if (this._discardStream) {
          this.streaming = false;
          this._abort = null;
          this._resetStream();
          this._discardStream = false;
          return;
        }
        if (e.name === 'AbortError') {
          if (this.streamBuf) this.streamBuf += ' [interrotto]';
          else this.streamBuf = '[interrotto]';
        } else {
          this.streamBuf += '\n[errore: ' + e.message + ']';
        }
        this.flush();
      }
    },

    stopGen() {
      if (this._abort) {
        this._abort.abort();
        this._abort = null;
      }
    },

    // Stop and discard everything: used when the user switches conversation or
    // deletes the chat while it is streaming. Keeps the final flush from pushing
    // the partial answer into the wrong conversation.
    _abortAndDiscard() {
      if (!this.streaming) return;
      this._discardStream = true;
      if (this._abort) {
        this._abort.abort();
        this._abort = null;
      }
    },

    handleEvent(raw) {
      const lines = raw.split('\n');
      let event = 'message', data = '';
      let dataSeen = false;
      for (const l of lines) {
        if (l.startsWith('event: ')) {
          event = l.slice(7);
        } else if (l.startsWith('data:')) {
          // Per the SSE spec, each data line is appended with a \n separator.
          // Needed for tokens that contain newlines (sse-starlette splits on \n,
          // the frontend must reassemble).
          if (dataSeen) data += '\n';
          data += l.startsWith('data: ') ? l.slice(6) : l.slice(5);
          dataSeen = true;
        }
      }
      if (event === 'reasoning') {
        if (!this.streamReasoning) this._thinkT0 = performance.now();
        this.streamReasoning += data;
        this._scheduleRender();
      } else if (event === 'token') {
        if (this.streamReasoning && this.thinkSecs === null) this.thinkSecs = this._thinkElapsed();
        this.streamBuf += data;
        this._scheduleRender();
      } else if (event === 'done') {
        try {
          const stats = JSON.parse(data);
          this.lastStats = {tps: stats.tps, tokens: stats.tokens, elapsed: stats.elapsed};
          if (stats.prompt_tokens != null) {
            this.lastUsage = {
              prompt_tokens: stats.prompt_tokens || 0,
              completion_tokens: stats.completion_tokens || 0,
            };
          }
        } catch(e) {}
      } else if (event === 'error') {
        this.streamBuf += '\n[errore: ' + data + ']';
      }
    },

    flush() {
      if (this.streamBuf || this.streamReasoning) {
        const msg = {role:'assistant', content: this.streamBuf};
        if (this.streamReasoning.trim()) {
          msg.reasoning = this.streamReasoning.trim();
          msg.thinkSecs = this.thinkSecs ?? this._thinkElapsed();
          this.openThinkIdx = this.messages.length;
        }
        this.messages.push(msg);
      }
      this._resetStream();
      this.streaming = false;
      this._abort = null;
      this.persist();
      // The closed message becomes a normal bubble: highlighting and copy button
      // come from its x-init, also on the last block skipped while streaming.
      this._scheduleScroll();
    },

    // Token count: use the real value from the last round trip if available,
    // otherwise estimate ~4 chars/token (mixed IT/EN text).
    ctxUsed() {
      const real = (this.lastUsage.prompt_tokens || 0) + (this.lastUsage.completion_tokens || 0);
      if (real > 0 && !this.streaming) return real;
      let chars = 0;
      for (const m of this.messages) chars += (m.content || '').length;
      if (this.streaming) chars += (this.streamBuf || '').length + (this.streamReasoning || '').length;
      return Math.ceil(chars / 4);
    },

    ctxLimit() {
      return this._ctxLimit;
    },

    ctxPercent() {
      const lim = this.ctxLimit();
      if (!lim) return 0;
      return Math.min(100, (this.ctxUsed() / lim) * 100);
    },

    fmtCtx(n) {
      if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
      return String(n);
    }
  };
}

// Conversations sidebar component.
function conversations() {
  return {
    list: {},
    currentId: null,

    init() {
      this.refresh();
      this.currentId = getCurrentId();
      window.addEventListener('conv:list', () => this.refresh());
      window.addEventListener('conv:select', (e) => { this.currentId = e.detail.id; });
      window.addEventListener('conv:new', (e) => { this.currentId = e.detail.id; this.refresh(); });
    },

    refresh() {
      this.list = loadConversations();
    },

    get sortedList() {
      return Object.values(this.list).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    },

    select(id) {
      window.dispatchEvent(new CustomEvent('conv:select', {detail: {id}}));
    },

    newChat() {
      const id = uuid();
      window.dispatchEvent(new CustomEvent('conv:new', {detail: {id}}));
    },

    async deleteConv(id, title) {
      const ok = await window.Alpine.store('dialog').confirm({
        title: 'Erase this conversation?',
        message: '"' + (title || 'Untitled') + '" will be removed from local storage.',
        confirmLabel: 'Erase',
        variant: 'danger',
      });
      if (!ok) return;
      const all = loadConversations();
      delete all[id];
      saveConversations(all);
      // If it is the active conversation, clear the chat panel through conv:new(null).
      if (getCurrentId() === id) {
        setCurrentId(null);
        window.dispatchEvent(new CustomEvent('conv:new', {detail: {id: null}}));
      }
      this.refresh();
      window.dispatchEvent(new CustomEvent('conv:list'));
    },

    async clearAll() {
      const ok = await window.Alpine.store('dialog').confirm({
        title: 'Purge ALL conversations?',
        message: 'Irreversible: the entire local archive will be removed.',
        confirmLabel: 'Purge All',
        variant: 'danger',
      });
      if (!ok) return;
      saveConversations({});
      setCurrentId(null);
      this.refresh();
      window.dispatchEvent(new CustomEvent('conv:new', {detail: {id: null}}));
    },

    formatDate(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const today = new Date();
      const sameDay = d.toDateString() === today.toDateString();
      if (sameDay) return d.toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit'});
      return d.toLocaleDateString('it-IT', {day:'2-digit', month:'2-digit'});
    }
  };
}

// Logs viewer component.
function logsView() {
  return {
    lines: [],
    async poll() {
      const fetchLogs = async () => {
        try {
          const r = await fetch('/api/logs');
          const j = await r.json();
          this.lines = j.lines || [];
        } catch (e) {}
      };
      await fetchLogs();
      setInterval(fetchLogs, 3000);
    }
  };
}

// expose to Alpine
window.dash = dash;
window.chat = chat;
window.conversations = conversations;
window.logsView = logsView;
window.renderMd = renderMd;
window.escapeHtml = escapeHtml;
