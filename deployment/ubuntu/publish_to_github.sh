#!/usr/bin/env bash
set -eo pipefail

runtime_dir="${SOUL_RUNTIME_DIR:-/home/jincl/soul-runtime}"
repository_dir="${SOUL_REPOSITORY_DIR:-/home/jincl/soul-repository}"
source_json="${runtime_dir}/public/live.json"
target_json="${repository_dir}/data/live.json"
target_image="${repository_dir}/docs/existence-field.png"
renderer="${repository_dir}/processing/render_field.py"
deploy_key="${SOUL_DEPLOY_KEY:-/home/jincl/.ssh/soul_extractor_deploy}"
lock_file="${runtime_dir}/publish.lock"

mkdir -p "${runtime_dir}/log"
exec 9>"${lock_file}"
flock -n 9 || exit 0

if [[ ! -s "${source_json}" ]]; then
  echo "$(date -Is) No abstract field is available; skipping publish." >&2
  exit 2
fi

if [[ ! -d "${repository_dir}/.git" ]]; then
  echo "$(date -Is) GitHub checkout is not initialized at ${repository_dir}." >&2
  exit 3
fi

mkdir -p "${repository_dir}/data" "${repository_dir}/docs"
cp "${source_json}" "${target_json}.tmp"
mv "${target_json}.tmp" "${target_json}"
python3 "${renderer}" "${target_json}" "${target_image}"

stamp="$(date -u +%Y%m%d%H%M%S)"
python3 - "${repository_dir}/README.md" "${stamp}" <<'PY'
import re
import sys

path, stamp = sys.argv[1:]
with open(path, "r", encoding="utf-8") as source:
    content = source.read()
content = re.sub(r'existence-field\.png\?v=[0-9]+', 'existence-field.png?v=' + stamp, content)
content = re.sub(r'<!-- FIELD_UPDATED -->.*', '<!-- FIELD_UPDATED -->最后同步：' + stamp + ' UTC', content)
with open(path + ".tmp", "w", encoding="utf-8") as target:
    target.write(content)
__import__("os").replace(path + ".tmp", path)
PY

cd "${repository_dir}"
git add README.md data/live.json docs/existence-field.png
if git diff --cached --quiet; then
  echo "$(date -Is) Abstract field is unchanged."
  exit 0
fi

git commit -m "field: update $(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_SSH_COMMAND="ssh -i ${deploy_key} -o IdentitiesOnly=yes" git push origin main
