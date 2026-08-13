#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

patterns=(
  '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'
  'AKIA[0-9A-Z]{16}'
  'AIza[0-9A-Za-z_-]{35}'
  'gh[pousr]_[0-9A-Za-z]{30,}'
  'github_pat_[0-9A-Za-z_]{30,}'
  'sk_live_[0-9A-Za-z]{16,}'
  'rk_live_[0-9A-Za-z]{16,}'
)

for pattern in "${patterns[@]}"; do
  if rg -n --hidden \
    --glob '!.git/**' \
    --glob '!node_modules/**' \
    --glob '!package-lock.json' \
    --glob '!scripts/secret-scan.sh' \
    -- "${pattern}" .; then
    echo "Potential secret matched pattern: ${pattern}" >&2
    exit 1
  fi
done

if find . -type f \( \
  -name '*.jks' -o -name '*.keystore' -o -name '*.p12' -o \
  -name '*.pfx' -o -name '*.mobileprovision' -o -name '.env' -o \
  -name '.env.local' -o -name 'local.properties' \
\) -not -path './.git/*' -print -quit | grep -q .; then
  echo "Local credentials or signing material found" >&2
  exit 1
fi

echo "Repository secret scan: OK"
