#!/usr/bin/env bash

set -Eeuo pipefail

readonly VERCEL_CLI_VERSION="59.11.2"
readonly REQUIRED_CONFIRMATION="--confirm-production"

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_directory="$(cd -- "${script_directory}/.." && pwd)"

cd "${project_directory}"

if [[ "${1:-}" != "${REQUIRED_CONFIRMATION}" ]]; then
  echo "Refusing to deploy without explicit production confirmation." >&2
  echo "Usage: pnpm deploy:production:bom1 -- ${REQUIRED_CONFIRMATION}" >&2
  exit 2
fi

if [[ ! -f ".vercel/project.json" ]] &&
  { [[ -z "${VERCEL_ORG_ID:-}" ]] || [[ -z "${VERCEL_PROJECT_ID:-}" ]]; }; then
  echo "This directory is not linked to a Vercel project." >&2
  echo "Run: npx --yes vercel@${VERCEL_CLI_VERSION} link" >&2
  echo "Then rerun the production deployment command." >&2
  exit 1
fi

echo "Deploying the linked Vercel project to production in Mumbai (bom1)."

exec npx --yes "vercel@${VERCEL_CLI_VERSION}" deploy \
  --prod \
  --force \
  --regions bom1 \
  --logs
