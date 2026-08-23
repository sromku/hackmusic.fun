#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

cd "${repo_root}"

if [[ ! -f ".openai/hosting.json" ]]; then
  printf 'Error: .openai/hosting.json was not found.\n' >&2
  exit 1
fi

project_id="$(node -e "const fs=require('node:fs'); const value=JSON.parse(fs.readFileSync('.openai/hosting.json','utf8')).project_id; if (typeof value !== 'string' || !value) process.exit(1); process.stdout.write(value)")" || {
  printf 'Error: .openai/hosting.json has no valid project_id.\n' >&2
  exit 1
}

if [[ -n "$(git status --porcelain)" ]]; then
  printf 'Error: commit or stash all changes before preparing a Sites release.\n\n' >&2
  git status --short >&2
  exit 1
fi

commit_sha="$(git rev-parse HEAD)"
short_sha="$(git rev-parse --short=12 HEAD)"

printf 'Preparing OpenAI Sites release for %s (%s)\n' "${project_id}" "${short_sha}"
printf 'Running tests...\n'
npm test

printf 'Running lint...\n'
npm run lint

if command -v gitleaks >/dev/null 2>&1; then
  printf 'Scanning Git history for secrets...\n'
  gitleaks git --redact .
else
  printf 'Error: gitleaks is required. Install it with: brew install gitleaks\n' >&2
  exit 1
fi

codex_root="${CODEX_HOME:-${HOME}/.codex}"
package_script=""
for candidate in "${codex_root}"/plugins/cache/openai-bundled/sites/*/scripts/package-site.sh; do
  if [[ -x "${candidate}" ]]; then
    package_script="${candidate}"
  fi
done

if [[ -z "${package_script}" ]]; then
  printf 'Error: the OpenAI Sites packaging helper is unavailable.\n' >&2
  printf 'Open this project in Codex with the Sites plugin installed, then retry.\n' >&2
  exit 1
fi

output_dir="${repo_root}/outputs/sites"
archive_path="${output_dir}/hackmusic-sites-${short_sha}.tar.gz"
mkdir -p "${output_dir}"

printf 'Packaging the committed source...\n'
"${package_script}" "${repo_root}" "${archive_path}"

printf '\nRelease package is ready.\n'
printf 'Project: %s\n' "${project_id}"
printf 'Commit:  %s\n' "${commit_sha}"
printf 'Archive: %s\n\n' "${archive_path}"
printf 'Next, ask Codex:\n'
printf '  Deploy commit %s to OpenAI Sites using %s\n' "${commit_sha}" "${archive_path}"
printf '\nThe final deploy needs Codex because Sites uses a short-lived credential; no token is stored locally.\n'
