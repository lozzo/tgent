#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace_root="$(cd "${repo_root}/.." && pwd)"
output_root="${1:-${workspace_root}/tgent-app/public/wasm}"
go_root="$(go env GOROOT)"

mkdir -p "${output_root}"
(cd "${repo_root}" && GOOS=js GOARCH=wasm go build -trimpath -ldflags='-s -w' -o "${output_root}/tgent-client.wasm" ./wasm)

if [[ -f "${go_root}/lib/wasm/wasm_exec.js" ]]; then
  cp "${go_root}/lib/wasm/wasm_exec.js" "${output_root}/wasm_exec.js"
else
  cp "${go_root}/misc/wasm/wasm_exec.js" "${output_root}/wasm_exec.js"
fi

echo "Built ${output_root}/tgent-client.wasm"
