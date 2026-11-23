SHELL := /bin/bash
.DEFAULT_GOAL := help

help: ## List the available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Symlink the scripts into ~/.local/bin/
	@./install.sh

install-check: ## Show what install.sh would do, without changing anything
	@./install.sh --check

build-css: ## Build the Tailwind CSS (static/output.css)
	pnpm run build

watch-css: ## Watch mode for Tailwind (rebuild on change)
	pnpm run watch

dev: ## Run the dashboard in the foreground (port 1230)
	uv run python main.py

dash: ## Run the dashboard in the background
	@~/.local/bin/llm-dash --bg

dash-stop: ## Stop the dashboard
	@~/.local/bin/llm-dash stop 2>/dev/null || pkill -f "llm-dash/main.py" || true

models: ## List the startable profiles (models)
	@bin/llm-serve list

llm-up: ## Start mlx_lm.server with the default profile (server.default_profile)
	@~/.local/bin/llm-up

llm-down: ## Stop every mlx_lm.server
	@~/.local/bin/llm-down

up: ## Start the full stack (LLM + dashboard) in the tmux session "llm"
	@command -v tmux >/dev/null || { echo "tmux is not installed"; exit 1; }
	@~/.local/bin/llm-up
	@sleep 1
	@if tmux list-panes -t llm:server 2>/dev/null | grep -q '^1:'; then \
		echo "Dashboard pane already present in the 'llm' session"; \
	else \
		tmux split-window -t llm:server -h "cd $(CURDIR) && uv run python main.py"; \
		tmux select-layout -t llm:server even-horizontal; \
		echo "Dashboard started in the 'llm' session (pane 1)"; \
	fi
	@echo ""
	@echo "Stack online (survives closing the terminal):"
	@echo "  Dashboard:  http://127.0.0.1:1230"
	@echo "  Attach:     tmux attach -t llm"
	@echo "  Stop all:   make down"

down: ## Stop the full stack (LLM + dashboard + tmux session)
	@~/.local/bin/llm-dash stop 2>/dev/null || true
	@~/.local/bin/llm-down 2>/dev/null || true
	@tmux kill-session -t llm 2>/dev/null || true
	@echo "Stack stopped"

status: ## Runtime status (active server + memory)
	@curl -s http://127.0.0.1:1230/api/status 2>/dev/null | python3 -m json.tool || echo "dashboard offline, run: make up"

clean: ## Remove build caches
	rm -rf static/output.css node_modules/.cache .venv/__pycache__ __pycache__

setup: install build-css ## Full setup: symlink scripts + build CSS

.PHONY: help install install-check build-css watch-css dev dash dash-stop models llm-up llm-down up down status clean setup
