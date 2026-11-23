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

models: ## Lista i profili (modelli) avviabili
	@bin/llm-serve list

llm-up: ## Avvia mlx_lm.server col profilo default (server.default_profile)
	@~/.local/bin/llm-up

llm-down: ## Ferma tutti i mlx_lm.server
	@~/.local/bin/llm-down

up: ## Avvia stack completo (LLM + dashboard) in tmux session "llm"
	@command -v tmux >/dev/null || { echo "tmux non installato"; exit 1; }
	@~/.local/bin/llm-up
	@sleep 1
	@if tmux list-panes -t llm:server 2>/dev/null | grep -q '^1:'; then \
		echo "Dashboard pane gia' presente nella session 'llm'"; \
	else \
		tmux split-window -t llm:server -h "cd $(CURDIR) && uv run python main.py"; \
		tmux select-layout -t llm:server even-horizontal; \
		echo "Dashboard avviata nella session 'llm' (pane 1)"; \
	fi
	@echo ""
	@echo "Stack online (sopravvive alla chiusura del terminale):"
	@echo "  Dashboard:  http://127.0.0.1:1230"
	@echo "  Attach:     tmux attach -t llm"
	@echo "  Stop tutto: make down"

down: ## Ferma stack completo (LLM + dashboard + tmux session)
	@~/.local/bin/llm-dash stop 2>/dev/null || true
	@~/.local/bin/llm-down 2>/dev/null || true
	@tmux kill-session -t llm 2>/dev/null || true
	@echo "Stack fermato"

status: ## Stato runtime (server attivo + memoria)
	@curl -s http://127.0.0.1:1230/api/status 2>/dev/null | python3 -m json.tool || echo "dashboard offline - lancia: make up"

clean: ## Rimuovi cache build
	rm -rf static/output.css node_modules/.cache .venv/__pycache__ __pycache__

setup: install build-css ## Setup completo: symlink script + build CSS

.PHONY: help install install-check build-css watch-css dev dash dash-stop models llm-up llm-down up down status clean setup
