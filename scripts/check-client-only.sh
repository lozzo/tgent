#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

for forbidden in \
  tgent-web server daemon daemonhost hub control-plane deployment deploy \
  cmd/tgent cmd/tgent-hub internal/agent internal/daemon internal/hub \
  internal/hubgrpc internal/hubserver internal/providers internal/server; do
  if [[ -e "${forbidden}" ]]; then
    echo "Client-only boundary violation: ${forbidden}" >&2
    exit 1
  fi
done

if rg -n --hidden \
  --glob '!scripts/check-client-only.sh' \
  --glob '!README*' \
  --glob '!docs/**' \
  'github\.com/lozzo/tgent/(daemonhost|internal/(agent|daemon|hub|hubgrpc|hubserver|providers|server))' .; then
  echo "Client code imports a service-side package" >&2
  exit 1
fi

if rg -n --hidden \
  --glob '!scripts/check-client-only.sh' \
  --glob '!README*' \
  --glob '!docs/**' \
  '(deploy-hub|sync-hub-tls|docker-compose|tgent-hub)' .; then
  echo "Service deployment or Hub implementation artifact found" >&2
  exit 1
fi

echo "Client-only repository boundary: OK"
