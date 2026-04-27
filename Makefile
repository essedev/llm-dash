SHELL := /bin/bash
.DEFAULT_GOAL := help

help: ## Lista comandi disponibili
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Symlink degli script in ~/.local/bin/
	@./install.sh

install-check: ## Mostra cosa farebbe install.sh, senza modificare
	@./install.sh --check

build-css: ## Buildare Tailwind CSS (statics/output.css)
	pnpm run build

watch-css: ## Watch mode Tailwind (rebuild on change)
	pnpm run watch

dev: ## Avvia dashboard in foreground (porta 1230)
	uv run python main.py

dash: ## Avvia dashboard in background
	@~/.local/bin/llm-dash --bg

dash-stop: ## Ferma dashboard
	@~/.local/bin/llm-dash stop 2>/dev/null || pkill -f "llm-dash/main.py" || true

llm-up: ## Avvia mlx_lm.server (default profile: build)
	@~/.local/bin/llm-up build

llm-down: ## Ferma tutti i mlx_lm.server
	@~/.local/bin/llm-down

status: ## Stato runtime (server attivo + memoria)
	@curl -s http://127.0.0.1:1230/api/status 2>/dev/null | python3 -m json.tool || echo "dashboard offline - lancia: make dash"

clean: ## Rimuovi cache build
	rm -rf static/output.css node_modules/.cache .venv/__pycache__ __pycache__

setup: install build-css ## Setup completo: symlink script + build CSS

.PHONY: help install install-check build-css watch-css dev dash dash-stop llm-up llm-down status clean setup
