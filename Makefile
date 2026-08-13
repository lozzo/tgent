.PHONY: bootstrap test typecheck check build-web-client build-app \
	build-desktop-frontend dev-desktop build-desktop

bootstrap:
	cd client-go && go mod download
	cd tgent-desktop && go mod download
	npm --prefix shared ci
	npm --prefix tgent-app ci --ignore-scripts

test:
	cd client-go && go test ./...
	cd tgent-desktop && go test ./...

typecheck:
	npm --prefix shared run typecheck

check: test typecheck
	bash scripts/check-client-only.sh
	bash scripts/secret-scan.sh
	npm --prefix shared audit --audit-level=moderate
	npm --prefix tgent-app audit --audit-level=moderate

build-web-client:
	bash client-go/scripts/build-web-client.sh

build-app: build-web-client
	npm --prefix shared run build:app

build-desktop-frontend:
	npm --prefix shared run build:desktop

dev-desktop:
	cd tgent-desktop && wails dev

build-desktop:
	cd tgent-desktop && wails build
