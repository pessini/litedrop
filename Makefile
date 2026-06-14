# litedrop — local dev orchestration.
#
#   make up         Spin up the full stack with MinIO as the S3 provider.
#   make up azure   Same, but with Azurite as the Azure Blob provider.
#   make down       Stop the dev servers and containers; KEEP data (volumes).
#   make clean      Like down, but also wipe all volumes (Postgres + storage).
#   make logs       Tail the backend + dashboard dev-server logs.
#   make ps         Show the running litedrop containers.
#
# What "up" does: brings up Postgres + the selected storage emulator in Docker
# (over the shared litedrop_net network), applies DB migrations, then starts the
# backend (:8080) and dashboard SPA (:5173) as background host processes — mirroring
# the README dev flow. The compose `backend` service is intentionally NOT
# started, so it can't collide with the host backend on :8080.
#
# Storage config is exported into the backend's environment here. Because the
# backend's .env loader never overrides real env vars (see backend/src/env.ts),
# these win over backend/.env — so switching providers never edits your .env.

SHELL := /usr/bin/env bash
RUN_DIR := .run
COMPOSE := docker compose

# `make up azure` passes two goals — `up` and `azure`. Detect the `azure` goal
# and select the profile; `azure` itself is a no-op target (defined below) so
# make doesn't error on it.
ifeq (azure,$(filter azure,$(MAKECMDGOALS)))
  PROFILE     := azure
  SERVICES    := postgres azurite createcontainer
  WAIT_JOB    := litedrop-createcontainer-1
  # Azurite: well-known dev account; the account lives in the URL PATH, and the
  # backend reaches the emulator by its compose hostname over litedrop_net.
  STORAGE_ENV := \
    STORAGE_PROVIDER=azure \
    AZURE_STORAGE_ACCOUNT=devstoreaccount1 \
    AZURE_STORAGE_KEY='Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==' \
    AZURE_STORAGE_CONTAINER=litedrop \
    AZURE_BLOB_ENDPOINT=http://azurite:10000/devstoreaccount1
else
  PROFILE     := r2
  SERVICES    := postgres minio createbuckets
  WAIT_JOB    := litedrop-createbuckets-1
  # MinIO speaks the S3 API: custom endpoint implies path-style addressing.
  # Creds + bucket mirror the minio/createbuckets services in docker-compose.yml.
  STORAGE_ENV := \
    STORAGE_PROVIDER=s3 \
    S3_ENDPOINT=http://minio:9000 \
    S3_BUCKET=litedrop \
    S3_REGION=us-east-1 \
    S3_ACCESS_KEY_ID=litedrop \
    S3_SECRET_ACCESS_KEY=litedrop-secret \
    S3_FORCE_PATH_STYLE=true
endif

.PHONY: up azure down clean logs ps migrate _infra _dev _stop-dev

up: _infra migrate _dev
	@echo ""
	@echo "litedrop is up — storage provider: $(if $(filter azure,$(PROFILE)),azure (Azurite),s3 (MinIO))"
	@echo "  backend  → http://localhost:8080  (log: $(RUN_DIR)/backend.log)"
	@echo "  dashboard → http://localhost:5173  (log: $(RUN_DIR)/dashboard.log)"
	@echo "  tail logs: make logs    tear down: make down"

# No-op: lets `make up azure` treat `azure` as a goal without a missing-rule error.
azure:
	@:

_infra:
	$(COMPOSE) --profile $(PROFILE) up -d $(SERVICES)
	@echo "waiting for the storage bucket/container job to finish…"
	-@docker wait $(WAIT_JOB) >/dev/null 2>&1 || true

migrate:
	npm run -w @litedrop/backend db:migrate

_dev: | $(RUN_DIR)
	@echo "starting backend (:8080) and dashboard (:5173) dev servers…"
	@setsid bash -c '$(STORAGE_ENV) exec npm run -w @litedrop/backend dev' \
		> $(RUN_DIR)/backend.log 2>&1 & echo $$! > $(RUN_DIR)/backend.pid
	@setsid bash -c 'exec npm run -w @litedrop/dashboard dev' \
		> $(RUN_DIR)/dashboard.log 2>&1 & echo $$! > $(RUN_DIR)/dashboard.pid
	@for i in $$(seq 1 40); do \
		curl -sf localhost:8080/healthz >/dev/null 2>&1 && { echo "backend healthy."; break; }; \
		sleep 0.5; \
	done

# Stop services, KEEP data (Postgres + stored blobs persist across restarts).
down: _stop-dev
	@echo "removing containers (volumes kept)…"
	$(COMPOSE) --profile r2 --profile azure down --remove-orphans

# Destructive: like `down`, but also drops the volumes (pgdata + object storage).
clean: _stop-dev
	@echo "removing containers AND volumes (all data wiped)…"
	$(COMPOSE) --profile r2 --profile azure down -v --remove-orphans

# Kill the background dev servers (process-group kill via the recorded PIDs,
# with a pattern-match fallback for servers not started by this Makefile).
_stop-dev:
	@echo "stopping dev servers…"
	-@for s in backend dashboard; do \
		if [ -f $(RUN_DIR)/$$s.pid ]; then \
			kill -- -$$(cat $(RUN_DIR)/$$s.pid) 2>/dev/null || true; \
			rm -f $(RUN_DIR)/$$s.pid; \
		fi; \
	done
	-@pkill -f 'node --watch src/index.ts' 2>/dev/null || true
	-@pkill -f '@litedrop/dashboard' 2>/dev/null || true

logs:
	@tail -n +1 -F $(RUN_DIR)/backend.log $(RUN_DIR)/dashboard.log

ps:
	@docker ps --filter name=litedrop --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

$(RUN_DIR):
	@mkdir -p $(RUN_DIR)
