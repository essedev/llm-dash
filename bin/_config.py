#!/usr/bin/env python3
"""Internal helper: read config/llm-dash.toml for use in bash scripts.

Usage:
  _config.py list                  list the profiles by tier
  _config.py profile <name>        print MODEL=, LABEL=, NOTE=, CHAT_ARGS=, PORT=
  _config.py server <field>        print one value from [server]
"""
from __future__ import annotations

import json
import os
import sys
import tomllib
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "llm-dash.toml"


def _load() -> dict:
    """Return the parsed config/llm-dash.toml, exiting if the file is missing."""
    if not CONFIG_PATH.exists():
        print(f"ERROR: {CONFIG_PATH} not found", file=sys.stderr)
        sys.exit(1)
    with open(CONFIG_PATH, "rb") as f:
        return tomllib.load(f)


def _sq(s: str) -> str:
    """Single-quote for safe bash eval. Handles embedded single quotes."""
    return "'" + s.replace("'", "'\\''") + "'"


def cmd_list() -> None:
    """Print the startable profiles grouped by tier."""
    cfg = _load()
    profiles = cfg.get("profiles", {})
    port = cfg["server"]["llm_port"]
    models_dir = os.path.expanduser(cfg["server"]["models_dir"])

    defaults = {k: v for k, v in profiles.items() if v.get("tier") == "default"}
    others = {k: v for k, v in profiles.items() if v.get("tier") != "default"}

    print("Startable profiles (llm-up <profile> / llm-switch <profile>):")
    print()
    if defaults:
        print("  default (agentic MoE models, tool calling parsed by mlx_lm.server):")
        for key, p in defaults.items():
            print(f"    {key:<12} {p['label']:<30} {p.get('note', '')}")
    if others:
        print()
        print("  others (startable, but not agentic daily drivers, see docs/MODELS.md):")
        for key, p in others.items():
            print(f"    {key:<12} {p['label']:<30} {p.get('note', '')}")
    print()
    print(f"All run on port {port} (one active model at a time).")
    print(f"Model store: {models_dir}")


def cmd_profile(name: str) -> None:
    """Print the shell assignments (MODEL, LABEL, NOTE, THINK, CHAT_ARGS, PORT) for one profile."""
    cfg = _load()
    profiles = cfg.get("profiles", {})

    if name not in profiles:
        available = ", ".join(sorted(profiles.keys()))
        print(f"ERROR: profile '{name}' not found", file=sys.stderr)
        print(f"Available profiles: {available}", file=sys.stderr)
        sys.exit(1)

    p = profiles[name]
    models_dir = os.path.expanduser(cfg["server"]["models_dir"])
    model_path = os.path.join(models_dir, p["path"])

    print(f"MODEL={_sq(model_path)}")
    print(f"LABEL={_sq(p['label'])}")
    print(f"NOTE={_sq(p.get('note', ''))}")

    chat_args = dict(p.get("chat_template_args", {}))
    if "enable_thinking" in chat_args:
        think_env = os.environ.get("THINK")
        if think_env is not None:
            chat_args["enable_thinking"] = think_env.lower() == "true"
        # else: keep the TOML value as default
    # Emit the effective THINK value (resolved from TOML + env override)
    if "enable_thinking" in chat_args:
        print(f"THINK={'true' if chat_args['enable_thinking'] else 'false'}")
    else:
        print("THINK=n/a")

    if chat_args:
        print(f"CHAT_ARGS={_sq(json.dumps(chat_args))}")
    else:
        print("CHAT_ARGS=''")

    print(f"PORT={cfg['server']['llm_port']}")


def cmd_server(field: str) -> None:
    """Print one field of the [server] table."""
    cfg = _load()
    server = cfg.get("server", {})
    if field not in server:
        print(f"ERROR: field '{field}' not found in [server]", file=sys.stderr)
        sys.exit(1)
    val = server[field]
    if isinstance(val, str):
        val = os.path.expanduser(val)
    print(val)


def main() -> None:
    """Dispatch the command-line subcommand."""
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "list":
        cmd_list()
    elif cmd == "profile" and len(sys.argv) >= 3:
        cmd_profile(sys.argv[2])
    elif cmd == "server" and len(sys.argv) >= 3:
        cmd_server(sys.argv[2])
    else:
        print(f"Usage: {Path(sys.argv[0]).name} <list|profile <name>|server <field>>",
              file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
