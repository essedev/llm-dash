#!/usr/bin/env bash
# install.sh - link the platform scripts into ~/.local/bin/.
# bin/ in this repo stays the source of truth: edit there and changes are live.
#
# Usage:
#   ./install.sh             # symlink the scripts + print config hints
#   ./install.sh --check     # show what it would do, without changing anything

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/.local/bin"
SCRIPTS=(llm-serve llm-up llm-switch llm-down llm-dash)
CHECK_MODE="${1:-}"

mkdir -p "$TARGET_DIR"

echo "==> Repo:   $REPO_DIR"
echo "==> Target: $TARGET_DIR"
echo

for script in "${SCRIPTS[@]}"; do
  src="$REPO_DIR/bin/$script"
  dst="$TARGET_DIR/$script"

  if [[ ! -f "$src" ]]; then
    echo "  [skip] $script (non trovato in bin/)"
    continue
  fi

  if [[ -L "$dst" ]]; then
    current_target=$(readlink "$dst")
    if [[ "$current_target" == "$src" ]]; then
      echo "  [ok]   $script -> $src"
      continue
    fi
  fi

  if [[ "$CHECK_MODE" == "--check" ]]; then
    if [[ -e "$dst" ]]; then
      echo "  [would replace] $dst -> $src"
    else
      echo "  [would link]    $dst -> $src"
    fi
  else
    if [[ -e "$dst" && ! -L "$dst" ]]; then
      cp "$dst" "${dst}.bak.$(date +%s)"
      echo "  [backup] $dst -> ${dst}.bak.*"
    fi
    ln -sf "$src" "$dst"
    chmod +x "$src"
    echo "  [link]   $script"
  fi
done

echo
echo "==> Done."
echo
echo "Verifica con: which llm-up && llm-up --help 2>&1 | head -5"
echo
echo "Note finali (manuali):"
echo "  1. Wired memory limit (richiede sudo, una volta sola):"
echo "       sudo sysctl iogpu.wired_limit_mb=28000"
echo "     Per persistere al boot, copia il LaunchDaemon:"
echo "       sudo cp $REPO_DIR/config/com.local.wired-limit.plist /Library/LaunchDaemons/"
echo "       sudo launchctl load /Library/LaunchDaemons/com.local.wired-limit.plist"
echo
echo "  2. Config opencode:"
echo "       cp $REPO_DIR/config/opencode.json.example ~/.config/opencode/opencode.json"
echo "     (poi edita i path dei modelli se diversi dal default ~/.lmstudio/models/...)"
echo
echo "  3. Modelli MLX richiesti (verifica con: lms ls):"
echo "     - lmstudio-community/GLM-4.7-Flash-MLX-4bit"
echo "     - unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit"
echo "     - lmstudio-community/Qwen3-30B-A3B-Instruct-2507-MLX-4bit"
echo "     - lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-MLX-4bit"
echo
echo "  4. Avvio dashboard: llm-dash --bg  (poi http://127.0.0.1:1230)"
