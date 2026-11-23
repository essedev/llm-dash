"""LLM Dash - mini control plane per mlx_lm.server locale."""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import time
import tomllib
from collections import deque
from pathlib import Path
from typing import Any

import httpx
import psutil
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sse_starlette.sse import EventSourceResponse

BASE_DIR = Path(__file__).parent

_CONFIG_PATH = BASE_DIR / "config" / "llm-dash.toml"
with open(_CONFIG_PATH, "rb") as _f:
    CONFIG: dict = tomllib.load(_f)

DASH_PORT = int(os.environ.get("DASH_PORT", str(CONFIG["server"]["dash_port"])))
LLM_PORT = CONFIG["server"]["llm_port"]
LLM_BASE = f"http://127.0.0.1:{LLM_PORT}/v1"

PROFILES: dict[str, dict[str, Any]] = CONFIG["profiles"]

LOG_RING: deque[str] = deque(maxlen=200)
SWITCH_TASK: dict[str, Any] = {"running": False, "profile": None, "started": 0.0}


# ---------- helpers ----------

def _listens_on_llm_port(p: psutil.Process) -> bool:
    try:
        return any(
            c.status == psutil.CONN_LISTEN and c.laddr and c.laddr.port == LLM_PORT
            for c in p.net_connections(kind="tcp")
        )
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return False


def _is_llm_server(p: psutil.Process, cmdline: list[str]) -> bool:
    """mlx_lm.server, or omlx serve listening on LLM_PORT.

    omlx retitles its processes omlx-server, short-lived helpers included, so
    the title alone does not identify the server: the listening port does.
    """
    if any("mlx_lm.server" in c for c in cmdline):
        return True
    return bool(cmdline and cmdline[0].startswith("omlx-server")) and (
        _listens_on_llm_port(p)
    )


def find_mlx_server_pid() -> int | None:
    found: dict[int, int] = {}  # pid -> parent pid
    for p in psutil.process_iter(["pid", "ppid", "cmdline"]):
        try:
            cmdline = p.info["cmdline"] or []
            if _is_llm_server(p, cmdline):
                found[p.info["pid"]] = p.info["ppid"]
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    # omlx's forked helpers inherit the listening socket: the server is the
    # candidate whose parent is not a candidate itself.
    roots = [pid for pid, ppid in found.items() if ppid not in found]
    return min(roots) if roots else None


def server_uptime(pid: int) -> int:
    try:
        return int(time.time() - psutil.Process(pid).create_time())
    except psutil.NoSuchProcess:
        return 0


def fmt_uptime(s: int) -> str:
    if s < 60:
        return f"{s}s"
    if s < 3600:
        return f"{s // 60}m {s % 60}s"
    return f"{s // 3600}h {(s % 3600) // 60}m"


_VMSTAT_RE = re.compile(r"^([A-Z][^:]+):\s+(\d+)\.?\s*$", re.MULTILINE)


def _vm_stat_extras() -> dict[str, float]:
    """Parse vm_stat for compressor + inactive (macOS only)."""
    try:
        out = subprocess.run(
            ["vm_stat"], capture_output=True, text=True, timeout=2
        ).stdout
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        return {}
    page_match = re.search(r"page size of (\d+) bytes", out)
    page_size = int(page_match.group(1)) if page_match else 16384
    pages = {m.group(1).strip(): int(m.group(2)) for m in _VMSTAT_RE.finditer(out)}
    g = lambda k: pages.get(k, 0) * page_size / 1024**3
    return {
        "compressed_gb": round(g("Pages occupied by compressor"), 2),
        "inactive_gb": round(g("Pages inactive"), 2),
        "speculative_gb": round(g("Pages speculative"), 2),
        "active_gb": round(g("Pages active"), 2),
    }


def _pressure_level(
    percent: float, compressed_gb: float, total_gb: float, swap_used_gb: float
) -> str:
    """Derive low/medium/high from used%, compressor activity, swap usage.

    Thresholds from config/llm-dash.toml [hardware].
    """
    hw = CONFIG["hardware"]
    compressor_ratio = compressed_gb / max(total_gb, 1)
    if (percent >= hw["pressure_high_percent"]
            or compressor_ratio > 0.18
            or swap_used_gb > hw["swap_high_gb"]):
        return "high"
    if (percent >= hw["pressure_medium_percent"]
            or compressor_ratio > 0.08
            or swap_used_gb > hw["swap_medium_gb"]):
        return "medium"
    return "low"


def memory_snapshot() -> dict[str, float]:
    vm = psutil.virtual_memory()
    swap = psutil.swap_memory()
    extras = _vm_stat_extras()
    total_gb = round(vm.total / 1024**3, 2)
    compressed_gb = extras.get("compressed_gb", 0.0)
    return {
        "total_gb": total_gb,
        "available_gb": round(vm.available / 1024**3, 2),
        "used_gb": round(vm.used / 1024**3, 2),
        "wired_gb": round(getattr(vm, "wired", 0) / 1024**3, 2),
        "active_gb": extras.get("active_gb", round(getattr(vm, "active", 0) / 1024**3, 2)),
        "inactive_gb": extras.get("inactive_gb", round(getattr(vm, "inactive", 0) / 1024**3, 2)),
        "compressed_gb": compressed_gb,
        "swap_used_gb": round(swap.used / 1024**3, 2),
        "swap_total_gb": round(swap.total / 1024**3, 2),
        "percent": vm.percent,
        "pressure": _pressure_level(
            vm.percent, compressed_gb, total_gb, round(swap.used / 1024**3, 2)
        ),
    }


def served_model_path() -> str | None:
    """Modello effettivamente servito, letto dal --model del processo.

    /v1/models elenca tutti i modelli che mlx_lm.server trova in cache, non
    solo quello caricato, quindi data[0] non è affidabile.
    """
    for proc in psutil.process_iter(["cmdline"]):
        try:
            cmd = proc.info["cmdline"] or []
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        if not any("mlx_lm.server" in part for part in cmd):
            continue
        if "--model" in cmd:
            idx = cmd.index("--model")
            if idx + 1 < len(cmd):
                return cmd[idx + 1]
    return None


async def fetch_active_full_path() -> str | None:
    served = served_model_path()
    if served:
        return served
    try:
        async with httpx.AsyncClient(timeout=1.0) as c:
            r = await c.get(f"{LLM_BASE}/models")
            r.raise_for_status()
            data = r.json().get("data", [])
            if data:
                return data[0]["id"]
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    return None


async def fetch_active_model() -> str | None:
    full = await fetch_active_full_path()
    return Path(full).name if full else None


def detect_active_profile(model_name: str | None) -> str | None:
    """Reverse lookup: model basename → profile key, via config paths."""
    if not model_name:
        return None
    for key, prof in PROFILES.items():
        if Path(prof["path"]).name == model_name:
            return key
    return None


def run_cmd(cmd: list[str]) -> tuple[int, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        out = (proc.stdout or "") + (proc.stderr or "")
        return proc.returncode, out
    except subprocess.TimeoutExpired:
        return 124, "timeout"
    except FileNotFoundError as e:
        return 127, str(e)


# ---------- app ----------

app = FastAPI(title="LLM Dash")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "index.html", {})


@app.get("/api/status")
async def api_status() -> JSONResponse:
    pid = find_mlx_server_pid()
    model_name = await fetch_active_model() if pid else None
    profile = detect_active_profile(model_name)
    return JSONResponse({
        "running": pid is not None,
        "pid": pid,
        "uptime_s": server_uptime(pid) if pid else 0,
        "uptime": fmt_uptime(server_uptime(pid)) if pid else "-",
        "model": model_name,
        "profile": profile,
        "port": LLM_PORT,
        "switching": SWITCH_TASK["running"],
        "switching_profile": SWITCH_TASK["profile"],
    })


@app.get("/api/memory")
async def api_memory() -> JSONResponse:
    return JSONResponse(memory_snapshot())


@app.get("/api/profiles")
async def api_profiles() -> JSONResponse:
    return JSONResponse(PROFILES)


@app.post("/api/switch/{profile}")
async def api_switch(profile: str) -> JSONResponse:
    if profile not in PROFILES:
        return JSONResponse({"error": f"unknown profile: {profile}"}, status_code=400)
    if SWITCH_TASK["running"]:
        return JSONResponse({"error": "switch already in progress"}, status_code=409)
    SWITCH_TASK.update({"running": True, "profile": profile, "started": time.time()})

    async def _run() -> None:
        try:
            code, out = run_cmd([os.path.expanduser("~/.local/bin/llm-up"), profile])
            LOG_RING.append(f"[{time.strftime('%H:%M:%S')}] switch -> {profile} (exit {code}) {out.strip()[:200]}")
        finally:
            SWITCH_TASK.update({"running": False, "profile": None, "started": 0.0})

    asyncio.create_task(_run())
    return JSONResponse({"ok": True, "profile": profile})


@app.post("/api/stop")
async def api_stop() -> JSONResponse:
    code, out = run_cmd([os.path.expanduser("~/.local/bin/llm-down")])
    LOG_RING.append(f"[{time.strftime('%H:%M:%S')}] stop (exit {code}) {out.strip()[:150]}")
    return JSONResponse({"ok": code == 0, "out": out})


@app.get("/api/logs")
async def api_logs() -> JSONResponse:
    return JSONResponse({"lines": list(LOG_RING)[-50:]})


@app.post("/api/chat")
async def api_chat(req: Request) -> EventSourceResponse:
    body = await req.json()
    user_msg: str = body.get("message", "")
    history: list[dict[str, str]] = body.get("history", [])

    pid = find_mlx_server_pid()
    full_path = await fetch_active_full_path() if pid else None

    async def stream():
        if not pid:
            yield {"event": "error", "data": "server non in esecuzione"}
            return
        if not full_path:
            yield {"event": "error", "data": "modello non disponibile"}
            return

        messages = [
            {"role": m["role"], "content": m["content"]}
            for m in history
            if m.get("role") in ("user", "assistant") and m.get("content")
        ]
        messages.append({"role": "user", "content": user_msg})

        payload = {
            "model": full_path,
            "messages": messages,
            "max_tokens": 4096,
            "temperature": 0.0,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        t0 = time.time()
        n_tokens = 0
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        try:
            async with httpx.AsyncClient(timeout=300.0) as client:
                async with client.stream("POST", f"{LLM_BASE}/chat/completions",
                                         json=payload) as r:
                    if r.status_code >= 400:
                        text = await r.aread()
                        yield {"event": "error",
                               "data": f"HTTP {r.status_code}: {text.decode()[:200]}"}
                        return
                    async for line in r.aiter_lines():
                        if not line.strip() or not line.startswith("data: "):
                            continue
                        data = line[6:].strip()
                        if data == "[DONE]":
                            elapsed = time.time() - t0
                            tps = n_tokens / elapsed if elapsed else 0
                            yield {"event": "done",
                                   "data": json.dumps({
                                       "tps": round(tps, 1),
                                       "tokens": n_tokens,
                                       "elapsed": round(elapsed, 2),
                                       "prompt_tokens": prompt_tokens,
                                       "completion_tokens": completion_tokens,
                                   })}
                            return
                        try:
                            chunk = json.loads(data)
                            usage = chunk.get("usage")
                            if usage:
                                prompt_tokens = usage.get("prompt_tokens")
                                completion_tokens = usage.get("completion_tokens")
                            choices = chunk.get("choices") or []
                            if choices:
                                delta = choices[0].get("delta", {})
                                content = delta.get("content")
                                if content:
                                    n_tokens += 1
                                    yield {"event": "token", "data": content}
                        except (json.JSONDecodeError, KeyError, IndexError):
                            continue
        except httpx.HTTPError as e:
            yield {"event": "error", "data": str(e)}

    return EventSourceResponse(stream())


def main() -> None:
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=DASH_PORT,
                log_level="warning", reload=False)


if __name__ == "__main__":
    main()
