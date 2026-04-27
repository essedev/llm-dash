// llm-dash client logic - Alpine + marked + highlight.js + localStorage
// Eventi globali: 'conv:select', 'conv:new', 'conv:delete', 'conv:list'

const STORAGE_KEY = 'llmdash:conversations:v1';
const CURRENT_KEY = 'llmdash:current:v1';

// ---- dialog store (custom alert/confirm) ----
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

// ---- markdown setup ----
function setupMarked() {
  if (typeof window.marked === 'undefined') return;
  window.marked.setOptions({
    breaks: true,
    gfm: true,
    highlight: function(code, lang) {
      if (window.hljs && lang && window.hljs.getLanguage(lang)) {
        try { return window.hljs.highlight(code, {language: lang}).value; } catch (_) {}
      }
      if (window.hljs) {
        try { return window.hljs.highlightAuto(code).value; } catch (_) {}
      }
      return code;
    }
  });
}
document.addEventListener('DOMContentLoaded', setupMarked);

function renderMd(text) {
  if (typeof window.marked === 'undefined') return escapeHtml(text);
  try { return window.marked.parse(text || ''); } catch (e) { return escapeHtml(text); }
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
  );
}

// ---- storage ----
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

// ---- dash component (status / memory / profiles / switch) ----
function dash() {
  return {
    status: {running:false, model:null, profile:null, pid:null, port:1234, uptime:'-', switching:false, switching_profile:null},
    mem: {total_gb:32, used_gb:0, percent:0, swap_used_gb:0, swap_total_gb:0, wired_gb:0, available_gb:0, active_gb:0, inactive_gb:0, compressed_gb:0, pressure:'low'},
    profiles: {},

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
      const sizes = {build:16, coder:20, plan:17, 'coder-old':16};
      const need = profile && sizes[profile] ? sizes[profile] : null;
      if (!need) return 'RAM riusabile (libera + cache + compressa)';
      const margin = avail - (need + 6); // weights + ~6GB KV cache stima
      if (margin > 4) return `Profile attivo (${need + 6} GB stimati): margine ${margin.toFixed(1)} GB`;
      if (margin > 0) return `Profile attivo (${need + 6} GB stimati): margine stretto ${margin.toFixed(1)} GB`;
      return `Profile attivo (${need + 6} GB stimati): ${(-margin).toFixed(1)} GB sotto - rischio swap`;
    }
  };
}

// ---- chat component ----
function chat() {
  return {
    currentId: null,
    title: '',
    messages: [],
    input: '',
    streaming: false,
    streamBuf: '',
    lastStats: {tps:null, tokens:0, elapsed:0},
    lastUsage: {prompt_tokens:0, completion_tokens:0},
    status_running: false,
    status_switching: false,
    status_switching_profile: null,
    _ctxLimit: 0,
    _scrollPending: false,
    _abort: null,
    _discardStream: false,

    bindStorage() {
      // load current conversation on init and listen for conv:select
      this.currentId = getCurrentId();
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
      this.$nextTick(() => this._scrollBottom());
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

    renderMd, escapeHtml,

    _scrollBottom() {
      if (!this.$refs.msgs) return;
      this.$refs.msgs.scrollTop = this.$refs.msgs.scrollHeight;
    },

    _scheduleScroll() {
      if (this._scrollPending) return;
      this._scrollPending = true;
      this.$nextTick(() => {
        requestAnimationFrame(() => {
          this._scrollPending = false;
          this._scrollBottom();
        });
      });
    },

    async send() {
      const text = this.input.trim();
      if (!text || this.streaming || this.status_switching || !this.status_running) return;
      const history = this.messages.slice();
      this.messages.push({role:'user', content:text});
      this.input = '';
      this.streamBuf = '';
      this.streaming = true;
      this._abort = new AbortController();
      this.persist();
      this._scheduleScroll();

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
          this.streamBuf = '';
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

    // Stop + scarta tutto: usato quando l'utente cambia conversazione
    // o cancella la chat mentre stai streamando. Evita che il flush
    // finale spinga la risposta parziale nella conversazione sbagliata.
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
          // Per SSE spec: ogni data line si appende con \n separator.
          // Necessario per i token che contengono newline (sse-starlette
          // splitta su \n, frontend deve riassemblare).
          if (dataSeen) data += '\n';
          data += l.startsWith('data: ') ? l.slice(6) : l.slice(5);
          dataSeen = true;
        }
      }
      if (event === 'token') {
        this.streamBuf += data;
        this._scheduleScroll();
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
      if (this.streamBuf) this.messages.push({role:'assistant', content: this.streamBuf});
      this.streamBuf = '';
      this.streaming = false;
      this._abort = null;
      this.persist();
      this._scheduleScroll();
    },

    // Token count: usa il valore reale dell'ultimo round-trip se disponibile,
    // altrimenti stima ~4 char/token (testo misto IT/EN).
    ctxUsed() {
      const real = (this.lastUsage.prompt_tokens || 0) + (this.lastUsage.completion_tokens || 0);
      if (real > 0 && !this.streaming) return real;
      let chars = 0;
      for (const m of this.messages) chars += (m.content || '').length;
      if (this.streaming) chars += (this.streamBuf || '').length;
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

// ---- conversations sidebar component ----
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
      // Se è la conv attiva, svuota il pannello chat tramite conv:new(null)
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

// ---- logs viewer component ----
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
